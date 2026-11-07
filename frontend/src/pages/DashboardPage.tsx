import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowDownRight,
  ArrowUpRight,
  CircleCheck,
  CircleX,
  Construction,
  Cpu,
  LoaderCircle,
  Network,
  Orbit,
  RotateCw,
  Route,
  Target,
  Timer,
} from 'lucide-react'
import { useOutletContext } from 'react-router-dom'
import NetworkDiagram from '../components/NetworkDiagram'
import type { RunHistoryRecord, RunMetrics, SimulationSpeed, WorkspaceContext } from '../components/AppShell'
import {
  bestPlanWithinBudget,
  cities,
  destinationGoals,
  modelEvaluations,
  routes,
  startingBudget,
  type RailRoute,
} from '../data/routes'

type Algorithm = 'quantum-simulated' | 'quantum-hardware' | 'classic'
type RunStatus = 'running' | 'complete'
type EvaluationState = {
  speed: SimulationSpeed
  selectedRouteIds: string[]
  evaluatedRouteIds: string[]
  currentRouteId: string | null
  status: RunStatus
}

type Props = {
  algorithm: Algorithm
}

const initialState: EvaluationState = {
  speed: 'realtime',
  selectedRouteIds: [],
  evaluatedRouteIds: [],
  currentRouteId: null,
  status: 'running',
}

function getQuantumCandidateOrder(availableRoutes: RailRoute[]) {
  return availableRoutes
    .map((route, index) => ({ route, index }))
    .sort((a, b) => (
      b.route.value * a.route.constructionCost - a.route.value * b.route.constructionCost
      || b.route.value - a.route.value
      || a.index - b.index
    ))
    .map(({ route }) => route)
}

export default function DashboardPage({ algorithm }: Props) {
  const [runKey, setRunKey] = useState(0)
  const [evaluation, setEvaluation] = useState<EvaluationState>(initialState)
  const { simulationSpeed, setRunMetrics, appendRunHistory } = useOutletContext<WorkspaceContext>()
  const [executionTime, setExecutionTime] = useState<{ speed: SimulationSpeed; milliseconds: number } | null>(null)
  const currentEvaluation = evaluation.speed === simulationSpeed ? evaluation : initialState
  const displayedExecutionTime = executionTime?.speed === simulationSpeed ? executionTime.milliseconds : null
  const isQuantum = algorithm !== 'classic'
  const algorithmName = algorithm === 'classic'
    ? 'Classic Algorithm'
    : algorithm === 'quantum-simulated'
      ? 'Quantum Algorithm (Simulated)'
      : 'Quantum Algorithm (Real Hardware)'
  const evaluationOrder = useMemo(
    () => isQuantum ? getQuantumCandidateOrder(routes) : routes,
    [isQuantum],
  )

  useEffect(() => {
    let step = 0
    let executionMs = 0
    let timeout: number | undefined
    let cancelled = false
    const startedAt = performance.now()
    const evaluatedIds = new Set<string>()
    const selectedIds = new Set<string>()
    const setupStartedAt = performance.now()
    const exactPlanIds = new Set(bestPlanWithinBudget(routes, startingBudget).map((route) => route.id))
    executionMs += performance.now() - setupStartedAt

    function evaluateRoute() {
      const currentRoute = evaluationOrder[step]
      if (!currentRoute) return null

      const calculationStartedAt = performance.now()
      step += 1
      evaluatedIds.add(currentRoute.id)
      if (isQuantum) {
        const selectedCost = routes
          .filter((route) => selectedIds.has(route.id))
          .reduce((sum, route) => sum + route.constructionCost, 0)
        if (selectedCost + currentRoute.constructionCost <= startingBudget) {
          selectedIds.add(currentRoute.id)
        }
      } else {
        const bestPlanForEvaluatedRoutes = bestPlanWithinBudget(
          routes.filter((route) => evaluatedIds.has(route.id)),
          startingBudget,
        )
        selectedIds.clear()
        bestPlanForEvaluatedRoutes.forEach((route) => selectedIds.add(route.id))
      }
      executionMs += performance.now() - calculationStartedAt

      const isComplete = step === evaluationOrder.length
      const nextEvaluation = {
        speed: simulationSpeed,
        selectedRouteIds: isComplete && !isQuantum ? [...exactPlanIds] : [...selectedIds],
        evaluatedRouteIds: [...evaluatedIds],
        currentRouteId: isComplete ? null : evaluationOrder[step].id,
        status: isComplete ? 'complete' : 'running',
      } satisfies EvaluationState

      return { isComplete, nextEvaluation }
    }

    function evaluateNextStep() {
      if (cancelled) return
      const result = evaluateRoute()
      if (!result) return
      setEvaluation(result.nextEvaluation)
      if (result.isComplete) {
        const simulatedMs = performance.now() - startedAt
        setExecutionTime({ speed: simulationSpeed, milliseconds: executionMs })
        const metrics: RunMetrics = { executionMs, simulatedMs }
        setRunMetrics(metrics)
        appendRunHistory(createRunRecord(result.nextEvaluation.selectedRouteIds, simulatedMs))
        return
      }
      timeout = window.setTimeout(evaluateNextStep, 480)
    }

    function createRunRecord(selectedRouteIds: string[], executionTimeMs: number): RunHistoryRecord {
      const selectedRoutes = routes.filter((route) => selectedRouteIds.includes(route.id))
      const totalCost = selectedRoutes.reduce((sum, route) => sum + route.constructionCost, 0)
      return {
        timestamp: Date.now(),
        algorithm: algorithmName,
        speed: simulationSpeed,
        executionMs: executionTimeMs,
        planStatus: totalCost <= startingBudget ? 'valid' : 'invalid',
        totalCost,
        totalReward: selectedRoutes.reduce((sum, route) => sum + route.value, 0),
        selectedRoutes: selectedRoutes.map((route) => `${route.from} → ${route.to}`),
      }
    }

    timeout = window.setTimeout(() => {
      timeout = undefined
      if (cancelled) return
      if (simulationSpeed === 'realtime') {
        while (step < evaluationOrder.length) {
          if (!evaluateRoute()) break
        }
        const simulatedMs = performance.now() - startedAt
        setEvaluation({
          speed: simulationSpeed,
          selectedRouteIds: !isQuantum ? [...exactPlanIds] : [...selectedIds],
          evaluatedRouteIds: [...evaluatedIds],
          currentRouteId: null,
          status: 'complete',
        })
        setExecutionTime({ speed: simulationSpeed, milliseconds: executionMs })
        const metrics: RunMetrics = { executionMs, simulatedMs }
        setRunMetrics(metrics)
        appendRunHistory(createRunRecord(!isQuantum ? [...exactPlanIds] : [...selectedIds], simulatedMs))
      } else {
        evaluateNextStep()
      }
    }, 0)

    return () => {
      cancelled = true
      if (timeout !== undefined) window.clearTimeout(timeout)
    }
  }, [algorithm, algorithmName, appendRunHistory, evaluationOrder, isQuantum, runKey, setRunMetrics, simulationSpeed])

  const selectedRoutes = useMemo(
    () => routes.filter((route) => currentEvaluation.selectedRouteIds.includes(route.id)),
    [currentEvaluation.selectedRouteIds],
  )
  const totalCost = selectedRoutes.reduce((sum, route) => sum + route.constructionCost, 0)
  const totalScore = selectedRoutes.reduce((sum, route) => sum + route.value, 0)
  const isValidPlan = totalCost <= startingBudget
  const remainingBudget = startingBudget - totalCost

  function getRouteStatus(route: RailRoute) {
    if (currentEvaluation.selectedRouteIds.includes(route.id)) return 'Selected'
    if (currentEvaluation.status === 'running' && currentEvaluation.currentRouteId === route.id) return 'Evaluating'
    if (currentEvaluation.evaluatedRouteIds.includes(route.id)) return 'Skipped'
    return 'Queued'
  }

  return (
    <div className="dashboard-page construction-page algorithm-page">
      <motion.div className="page-heading" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <div>
          <span className="eyebrow">RAILWAY PLANNING <i /> ALGORITHM WORKSPACE</span>
          <h1>{algorithmName}</h1>
          <p>
            {isQuantum
              ? algorithm === 'quantum-simulated'
                ? 'Watch a quantum-inspired candidate heuristic build a high-value plan in the simulator workspace.'
                : 'View the quantum algorithm workspace configured for real hardware execution.'
              : 'Watch an exact search compare route combinations and reveal the highest-value plan within budget.'}
          </p>
        </div>
        <div className="heading-actions">
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              setRunMetrics(null)
              setExecutionTime(null)
              setEvaluation({
                speed: simulationSpeed,
                selectedRouteIds: [],
                evaluatedRouteIds: [],
                currentRouteId: evaluationOrder[0]?.id ?? null,
                status: 'running',
              })
              setRunKey((key) => key + 1)
            }}
          >
            <RotateCw size={14} /> Run again
          </button>
        </div>
      </motion.div>

      <section className="construction-scoreboard" aria-label="Algorithm plan summary">
        <article className="panel score-card score-card-budget">
          <div className="score-card-label"><span className="panel-icon"><Construction size={15} /></span><span>Starting budget</span></div>
          <strong>{startingBudget}</strong>
          <small>Construction budget units</small>
        </article>
        <article className="panel score-card">
          <div className="score-card-label"><span className="panel-icon"><Timer size={15} /></span><span>Time Taken</span></div>
          <strong>{displayedExecutionTime === null ? '—' : displayedExecutionTime < 1000 ? `${displayedExecutionTime.toFixed(1)} ms` : `${(displayedExecutionTime / 1000).toFixed(1)} s`}</strong>
          <small>Algorithm processing time</small>
        </article>
        <article className="panel score-card">
          <div className="score-card-label"><span className="panel-icon"><Route size={15} /></span><span>Total construction cost</span></div>
          <strong>{totalCost}<small> / {startingBudget}</small></strong>
          <div className={`budget-progress ${isValidPlan ? '' : 'budget-progress-over'}`}><i style={{ width: `${Math.min(totalCost / startingBudget * 100, 100)}%` }} /></div>
          <small>{remainingBudget >= 0 ? `${remainingBudget} budget units remaining` : `${Math.abs(remainingBudget)} units over budget`}</small>
        </article>
        <article className="panel score-card">
          <div className="score-card-label"><span className="panel-icon score-icon-violet"><Target size={15} /></span><span>Total reward (score)</span></div>
          <strong>{totalScore}</strong>
          <small>Railway value from selected connections</small>
        </article>
        <article className={`panel plan-status ${isValidPlan ? 'plan-status-valid' : 'plan-status-invalid'}`} role="status" aria-live="polite">
          {isValidPlan ? <CircleCheck size={19} /> : <CircleX size={19} />}
          <div>
            <strong>{isValidPlan ? 'Valid Plan' : 'Invalid Plan - Over Budget'}</strong>
            <span>{isValidPlan ? 'Construction cost is within budget.' : `Plan exceeds budget by ${totalCost - startingBudget}.`}</span>
          </div>
        </article>
      </section>

      <div className="construction-workspace algorithm-workspace">
        <section className="panel network-panel construction-network">
          <div className="panel-heading">
            <div>
              <div className="panel-title-row">
                <span className="panel-icon"><Network size={15} /></span>
                <h2>Romania railway network</h2>
                <span className="live-tag"><i /> {selectedRoutes.length} SELECTED</span>
              </div>
              <p>Connections illuminate as the algorithm evaluates and selects them.</p>
            </div>
          </div>
          <NetworkDiagram
            builtRouteIds={currentEvaluation.selectedRouteIds}
            evaluatingRouteIds={currentEvaluation.currentRouteId ? [currentEvaluation.currentRouteId] : []}
          />
          <div className="network-panel-footer">
            <span><b>{cities.length.toString().padStart(2, '0')}</b> cities</span><i />
            <span><b>{routes.length.toString().padStart(2, '0')}</b> possible connections</span><i />
            <span><b>{selectedRoutes.length.toString().padStart(2, '0')}</b> selected</span>
          </div>
        </section>

        <section className="panel route-builder-panel algorithm-route-panel" aria-label="Algorithm route evaluation">
          <div className="builder-heading">
            <div>
              <div className="panel-title-row">
                <span className="panel-icon">{isQuantum ? <Orbit size={15} /> : <Cpu size={15} />}</span>
                <h2>Route evaluation</h2>
              </div>
              <p>{isQuantum ? 'Budget-aware candidate ranking' : 'Exact search across route combinations'}</p>
            </div>
            <span className={`algorithm-run-state ${currentEvaluation.status}`} role="status">
              {currentEvaluation.status === 'running' ? <><LoaderCircle size={11} /> Evaluating</> : <><CircleCheck size={11} /> Complete</>}
            </span>
          </div>
          <div className="route-list algorithm-route-list" aria-live="polite">
            {routes.map((route, index) => {
              const status = getRouteStatus(route)
              const isSelected = status === 'Selected'
              const isEvaluating = status === 'Evaluating'
              return (
                <div key={route.id} className={`construction-route algorithm-route ${isSelected ? 'construction-route-built' : ''} ${isEvaluating ? 'algorithm-route-evaluating' : ''}`}>
                  <span className="route-index">{String(index + 1).padStart(2, '0')}</span>
                  <span className="route-endpoints"><strong>{route.from}</strong><ArrowDownRight size={12} /><strong>{route.to}</strong></span>
                  <span className="route-construction-cost"><small>COST</small><strong>{route.constructionCost}</strong></span>
                  <span className="route-value"><small>VALUE</small><strong>+{route.value}</strong></span>
                  <span className={`algorithm-route-status ${status.toLowerCase()}`}>{status}</span>
                </div>
              )
            })}
          </div>
          <div className="route-list-footer algorithm-list-footer">
            <span>{currentEvaluation.evaluatedRouteIds.length} / {routes.length} routes evaluated</span>
            <span>{selectedRoutes.length} selected by algorithm</span>
          </div>
        </section>
      </div>

      <section className="panel destination-goals-panel" id="destination-goals">
        <div className="panel-heading"><div><div className="panel-title-row"><span className="panel-icon score-icon-violet"><Target size={15} /></span><h2>Destination goals</h2></div><p>Network objectives and their rewards.</p></div></div>
        <div className="destination-goals">
          {destinationGoals.map(({ from, to, reward }) => <article className="destination-goal" key={`${from}-${to}`}><span className="goal-route"><strong>{from}</strong><ArrowDownRight size={13} /><strong>{to}</strong></span><span className="goal-reward"><small>GOAL REWARD</small><strong>+{reward}</strong></span></article>)}
        </div>
      </section>

      <section className="panel model-evaluation-panel" id="model-evaluation">
        <div className="model-demo-header">
          <div><span className="eyebrow">QUANTUM OPTIMIZATION <i /> STATIC EXAMPLE</span><h2>Model Evaluation Demo</h2><p>How the Quantum Cost Hamiltonian evaluates route plans. A weak penalty can make overspending attractive.</p></div>
          <span className="model-tag">HAMILTONIAN OUTPUT</span>
        </div>
        <div className="model-table-wrap">
          <table className="model-table">
            <thead><tr><th>PLAN</th><th>ENERGY</th><th>CONSTRUCTION COST</th><th>SCORE</th><th>EVALUATION</th></tr></thead>
            <tbody>
              {modelEvaluations.map((example) => <tr key={example.plan} className={example.label ? `model-row-${example.label.toLowerCase().replaceAll(' ', '-')}` : ''}>
                <td><code>{example.plan}</code></td>
                <td className="model-energy">{example.energy}</td>
                <td>{example.constructionCost ?? '—'}{example.budgetStatus && <small className={example.budgetStatus === 'Matches Budget' ? 'model-budget-match' : 'model-budget-over'}> ({example.budgetStatus})</small>}</td>
                <td>{example.score ?? '—'}</td>
                <td>{example.label ? <span className={`evaluation-badge ${example.label === 'Best Valid Plan' ? 'evaluation-valid' : 'evaluation-over'}`}>{example.label}</span> : <span className="evaluation-dash">—</span>}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
        <div className="model-demo-note"><ArrowUpRight size={14} /><span>The lowest model energy belongs to an over-budget plan. This illustrates how a weak budget penalty can favor a higher-scoring but invalid plan.</span></div>
      </section>

      <div className="demo-disclaimer"><span className="disclaimer-dot" /> Workspaces use supplied static route data. The real-hardware workspace is a UI mode only and does not connect to quantum hardware.</div>
    </div>
  )
}
