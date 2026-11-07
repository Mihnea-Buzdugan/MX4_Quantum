import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowDownRight,
  CircleCheck,
  CircleX,
  Construction,
  Cpu,
  LoaderCircle,
  Network,
  Orbit,
  Play,
  RotateCw,
  Route,
  Target,
  Timer,
  X,
} from 'lucide-react'
import { useOutletContext } from 'react-router-dom'
import IntermediateLog, { type IntermediateLogEntry } from '../components/IntermediateLog'
import NetworkDiagram from '../components/NetworkDiagram'
import SimulationOverlay from '../components/SimulationOverlay'
import type { RunHistoryRecord, WorkspaceContext } from '../components/AppShell'
import { cities, modelEvaluations, routes, startingBudget } from '../data/routes'
import {
  createRailwayPlanRequest,
  planRailwayNetwork,
  type RailwayPlanResponse,
} from '../services/railwayPlanner'

type Algorithm = 'quantum-simulated' | 'quantum-hardware' | 'classic'
type RunStatus = 'ready' | 'running' | 'complete' | 'infeasible' | 'error'

type Props = {
  algorithm: Algorithm
}

function isValidCost(value: string) {
  const cost = Number(value)
  return value.trim() !== ''
    && Number.isFinite(cost)
    && cost >= 0
    && /^\d+(\.\d{1,2})?$/.test(value.trim())
}

function formatNumber(value: number | null | undefined) {
  return value === undefined || value === null ? '—' : Number(value.toFixed(3)).toString()
}

function makeResponseEntries(response: RailwayPlanResponse): IntermediateLogEntry[] {
  const entries: IntermediateLogEntry[] = [
    {
      label: 'Planner result',
      message: response.status === 'ok'
        ? `Connected network returned within the ${formatNumber(response.budget)} budget.`
        : response.reason ?? 'The selected network cannot be completed within the available budget.',
    },
  ]

  if (response.status === 'infeasible' && typeof response.minimum_connection_cost === 'number') {
    entries.push({
      label: 'Minimum connection cost',
      message: formatNumber(response.minimum_connection_cost),
    })
  }

  if (response.quantum) {
    const stats = response.quantum
    entries.push({
      label: 'QAOA configuration',
      message: [
        stats.sampler ?? (stats.skipped ? 'Skipped' : undefined),
        stats.qubits === undefined ? undefined : `${stats.qubits} qubits`,
        stats.depth === undefined ? undefined : `depth ${stats.depth}`,
      ].filter(Boolean).join(' · ') || stats.reason || 'Diagnostics returned.',
    })
    if (typeof stats.quantum_budget === 'number') {
      entries.push({ label: 'Quantum budget', message: formatNumber(stats.quantum_budget) })
    }
    if (typeof stats.feasible_sample_rate === 'number') {
      entries.push({
        label: 'Feasible sample rate',
        message: `${(stats.feasible_sample_rate * 100).toFixed(2)}%`,
      })
    }
    if (typeof stats.p_feasible_qaoa === 'number') {
      entries.push({
        label: 'QAOA feasible probability',
        message: `${(stats.p_feasible_qaoa * 100).toFixed(2)}%`,
      })
    }
    if (typeof stats.best_sampled_value === 'number') {
      entries.push({ label: 'Best sampled value', message: formatNumber(stats.best_sampled_value) })
    }
    if (typeof stats.exact_optimum_value === 'number') {
      entries.push({ label: 'Exact optimum value', message: formatNumber(stats.exact_optimum_value) })
    }
  }

  if (response.cost_breakdown) {
    entries.push({
      label: 'Cost breakdown',
      message: `Quantum ${formatNumber(response.cost_breakdown.quantum)} · connectors ${formatNumber(response.cost_breakdown.connectors)} · extra ${formatNumber(response.cost_breakdown.extra)}`,
    })
  }

  if (response.conflict_pairs.length > 0) {
    entries.push({
      label: 'Route conflicts',
      message: response.conflict_pairs.map((pair) => pair.join(' ↔ ')).join(', '),
    })
  }

  for (const note of response.notes) {
    entries.push({ label: 'Planner note', message: note })
  }

  for (const edge of response.graph?.edges ?? []) {
    entries.push({
      label: `${edge.stage} route`,
      message: `${edge.from} → ${edge.to} · cost ${formatNumber(edge.cost)} · reward +${formatNumber(edge.value)}`,
    })
  }

  return entries
}

export default function DashboardPage({ algorithm }: Props) {
  const { simulationSpeed, setRunMetrics, appendRunHistory } = useOutletContext<WorkspaceContext>()
  const [budgetInput, setBudgetInput] = useState(String(startingBudget))
  const [selectedNodes, setSelectedNodes] = useState<string[]>([])
  const [includedRouteIds, setIncludedRouteIds] = useState(() => routes.map((route) => route.id))
  const [routeCosts, setRouteCosts] = useState<Record<string, string>>(
    () => Object.fromEntries(routes.map((route) => [route.id, String(route.constructionCost)])),
  )
  const [runStatus, setRunStatus] = useState<RunStatus>('ready')
  const [result, setResult] = useState<RailwayPlanResponse | null>(null)
  const [logEntries, setLogEntries] = useState<IntermediateLogEntry[]>([])
  const [executionTime, setExecutionTime] = useState<number | null>(null)
  const [simulationError, setSimulationError] = useState<string | null>(null)

  const algorithmName = algorithm === 'classic'
    ? 'Classic Algorithm'
    : algorithm === 'quantum-simulated'
      ? 'Quantum Algorithm (Simulated)'
      : 'Quantum Algorithm (Real Hardware)'
  const numericBudget = budgetInput.trim() === '' ? Number.NaN : Number(budgetInput)
  const isBudgetValid = Number.isFinite(numericBudget) && numericBudget >= 0
  const availableRoutes = useMemo(
    () => routes.map((route) => ({
      ...route,
      constructionCost: Number(routeCosts[route.id]),
    })),
    [routeCosts],
  )
  const candidateRoutes = useMemo(
    () => availableRoutes.filter((route) => includedRouteIds.includes(route.id)),
    [availableRoutes, includedRouteIds],
  )
  const networkNodeNames = useMemo(
    () => [...new Set([
      ...selectedNodes,
      ...candidateRoutes.flatMap((route) => [route.from, route.to]),
    ])],
    [candidateRoutes, selectedNodes],
  )
  const networkCities = useMemo(
    () => cities.filter((city) => networkNodeNames.includes(city.name)),
    [networkNodeNames],
  )
  const candidateCostsValid = candidateRoutes.length > 0
    && candidateRoutes.every((route) => isValidCost(routeCosts[route.id]))
  const canStart = isBudgetValid && selectedNodes.length >= 2 && candidateCostsValid && !isRunning(runStatus)
  const resultEdges = result?.graph?.edges ?? []
  const totalCost = result?.total_cost ?? 0
  const totalReward = result?.total_value ?? 0
  const remainingBudget = result?.remaining_budget ?? null
  const hasPlanStatus = result !== null
  const isValidPlan = result?.status === 'ok'
    && result.connected
    && typeof result.total_cost === 'number'
    && result.total_cost <= numericBudget
  const routeStages: Record<string, 'quantum' | 'connector' | 'extra'> = Object.fromEntries(
    resultEdges.map((edge) => [String(edge.id), edge.stage]),
  )

  // Routes the planner actually used. Before a run (or if the planner returned
  // no edges) the map shows all candidate routes; after a successful run it
  // shows only the routes in the returned network.
  const usedRouteIds = resultEdges.map((edge) => String(edge.id))
  const displayedRouteIds = usedRouteIds.length > 0
    ? usedRouteIds
    : candidateRoutes.map((route) => route.id)

  function resetResults() {
    setResult(null)
    setLogEntries([])
    setExecutionTime(null)
    setRunStatus('ready')
    setSimulationError(null)
    setRunMetrics(null)
  }

  function toggleNode(cityName: string) {
    if (isRunning(runStatus)) return
    resetResults()
    setSelectedNodes((current) => current.includes(cityName)
      ? current.filter((name) => name !== cityName)
      : [...current, cityName])
  }

  function toggleRoute(routeId: string, included: boolean) {
    if (isRunning(runStatus)) return
    resetResults()
    setIncludedRouteIds((current) => included
      ? [...current, routeId]
      : current.filter((id) => id !== routeId))
  }

  function updateRouteCost(routeId: string, value: string) {
    if (isRunning(runStatus)) return
    resetResults()
    setRouteCosts((current) => ({ ...current, [routeId]: value }))
  }

  function getValidationMessage() {
    if (!isBudgetValid) return 'Enter a valid budget of zero or more.'
    if (selectedNodes.length < 2) return 'Select at least two network nodes on the map.'
    if (candidateRoutes.length === 0) return 'Check at least one route to include it as a candidate.'
    if (!candidateCostsValid) return 'Route costs must be non-negative values with at most two decimals.'
    if (runStatus === 'infeasible') return 'The backend could not connect this network within budget; adjust nodes, routes, or costs.'
    if (runStatus === 'error') return 'The request failed. Check that the FastAPI planner is running and try again.'
    if (runStatus === 'complete') return 'Planner finished. Review the returned network and QAOA diagnostics below.'
    return 'Ready to submit the selected network to the FastAPI planner.'
  }

  async function startSimulation() {
    if (!canStart) return

    resetResults()
    setRunStatus('running')
    const startedAt = performance.now()
    const payload = createRailwayPlanRequest(numericBudget, networkCities, candidateRoutes, algorithmName)

    try {
      const response = await planRailwayNetwork(payload)
      const elapsedMs = performance.now() - startedAt
      const finishedAt = Date.now()
      const completedSuccessfully = response.status === 'ok'
        && response.connected
        && typeof response.total_cost === 'number'
        && response.total_cost <= numericBudget

      setResult(response)
      setLogEntries(makeResponseEntries(response))
      setExecutionTime(elapsedMs)
      setRunStatus(response.status === 'ok' ? 'complete' : 'infeasible')
      setRunMetrics({ executionMs: elapsedMs, simulatedMs: null })
      if (!completedSuccessfully && response.status === 'ok') {
        setSimulationError('The planner returned a network that is disconnected or exceeds the submitted budget.')
      }

      const record: RunHistoryRecord = {
        timestamp: finishedAt,
        algorithm: algorithmName,
        speed: simulationSpeed,
        executionMs: elapsedMs,
        planStatus: completedSuccessfully ? 'valid' : 'invalid',
        totalCost: response.total_cost ?? 0,
        totalReward: response.total_value ?? 0,
        selectedRoutes: (response.graph?.edges ?? [])
          .map((edge) => `${edge.from} → ${edge.to} (${edge.stage})`),
      }
      appendRunHistory(record)
    } catch (error) {
      const elapsedMs = performance.now() - startedAt
      const message = error instanceof Error ? error.message : 'The railway planner request failed unexpectedly.'
      setExecutionTime(elapsedMs)
      setRunStatus('error')
      setSimulationError(message)
      setLogEntries([{ label: 'Request error', message }])
    }
  }

  const isRunningNow = isRunning(runStatus)

  return (
    <div className="dashboard-page construction-page algorithm-page">
      <motion.div className="page-heading" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <div>
          <span className="eyebrow">RAILWAY PLANNING <i /> ALGORITHM WORKSPACE</span>
          <h1>{algorithmName}</h1>
          <p>Configure a budget, choose network nodes and candidate routes, then run the FastAPI planner.</p>
        </div>
        <div className="heading-actions">
          <button
            type="button"
            className="button button-primary start-simulation-button"
            disabled={!canStart}
            onClick={() => void startSimulation()}
          >
            {isRunningNow ? <><LoaderCircle size={15} /> Planner running</> : <><Play size={14} /> Start Simulation</>}
          </button>
          <button
            type="button"
            className="button button-secondary reset-simulation-button"
            disabled={isRunningNow}
            onClick={resetResults}
          >
            <RotateCw size={14} /> Reset results
          </button>
        </div>
      </motion.div>

      <div className={`simulation-readiness ${canStart ? 'simulation-ready' : ''}`} role="status">
        <span className={`health-indicator ${canStart ? '' : 'simulation-not-ready-dot'}`} />
        {getValidationMessage()}
      </div>
      {simulationError && <p className="simulation-error" role="alert">{simulationError}</p>}

      <section className="construction-scoreboard" aria-label="Algorithm plan summary">
        <article className="panel score-card score-card-budget">
          <label className="score-card-label" htmlFor="simulation-budget"><span className="panel-icon"><Construction size={15} /></span><span>Starting budget</span></label>
          <input
            id="simulation-budget"
            className="budget-input"
            type="number"
            min="0"
            step="0.01"
            value={budgetInput}
            disabled={isRunningNow}
            onChange={(event) => {
              resetResults()
              setBudgetInput(event.target.value)
            }}
          />
          <small>Construction budget units</small>
        </article>
        <article className="panel score-card">
          <div className="score-card-label"><span className="panel-icon"><Timer size={15} /></span><span>Time Taken</span></div>
          <strong>{executionTime === null ? '—' : executionTime < 1000 ? `${executionTime.toFixed(1)} ms` : `${(executionTime / 1000).toFixed(2)} s`}</strong>
          <small>End-to-end API request time</small>
        </article>
        <article className="panel score-card">
          <div className="score-card-label"><span className="panel-icon"><Route size={15} /></span><span>Total construction cost</span></div>
          <strong>{hasPlanStatus ? formatNumber(totalCost) : '—'}<small> / {isBudgetValid ? numericBudget : '—'}</small></strong>
          <div className={`budget-progress ${hasPlanStatus && !isValidPlan ? 'budget-progress-over' : ''}`}><i style={{ width: `${isBudgetValid && numericBudget > 0 ? Math.min(totalCost / numericBudget * 100, 100) : 0}%` }} /></div>
          <small>{remainingBudget === null ? 'Waiting for planner result' : `${formatNumber(remainingBudget)} budget units remaining`}</small>
        </article>
        <article className="panel score-card">
          <div className="score-card-label"><span className="panel-icon score-icon-violet"><Target size={15} /></span><span>Total reward (score)</span></div>
          <strong>{hasPlanStatus ? formatNumber(totalReward) : '—'}</strong>
          <small>Reward returned for the completed network</small>
        </article>
        <article className={`panel plan-status ${!hasPlanStatus ? 'plan-status-pending' : isValidPlan ? 'plan-status-valid' : 'plan-status-invalid'}`} role="status" aria-live="polite">
          {!hasPlanStatus ? <Target size={19} /> : isValidPlan ? <CircleCheck size={19} /> : <CircleX size={19} />}
          <div>
            <strong>{!hasPlanStatus ? 'Plan not run' : isValidPlan ? 'Valid Plan' : 'Invalid Plan (Over Budget / Infeasible)'}</strong>
            <span>{!hasPlanStatus ? 'Run the planner to evaluate the selected network.' : isValidPlan ? 'Connected network is within budget.' : result?.reason ?? 'Planner did not return a valid connected network.'}</span>
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
                <span className="live-tag"><i /> {resultEdges.length} BUILT</span>
              </div>
              <p>Select at least two required cities. Checked route candidates add their endpoints to the network automatically.</p>
            </div>
          </div>
          <NetworkDiagram
            builtRouteIds={resultEdges.map((edge) => edge.id)}
            configuredRouteIds={displayedRouteIds}
            routeStages={routeStages}
            selectedNodes={selectedNodes}
            onCitySelect={toggleNode}
          />
          <div className="selected-stops" aria-label="Selected network nodes">
            <div className="selected-stops-heading">
              <span>NETWORK NODES</span>
              {selectedNodes.length > 0 && (
                <button type="button" className="clear-stops-button" disabled={isRunningNow} onClick={() => { resetResults(); setSelectedNodes([]) }}>
                  <X size={11} /> Clear nodes
                </button>
              )}
            </div>
            {selectedNodes.length === 0 ? (
              <p>Select at least two cities on the map.</p>
            ) : (
              <div className="selected-stop-list">
                {selectedNodes.map((cityName) => (
                  <button
                    type="button"
                    className="selected-stop-chip"
                    key={cityName}
                    disabled={isRunningNow}
                    onClick={() => toggleNode(cityName)}
                  >
                    <span>NODE</span>{cityName}<X size={11} />
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="network-panel-footer">
            <span><b>{selectedNodes.length.toString().padStart(2, '0')}</b> required · <b>{networkNodeNames.length.toString().padStart(2, '0')}</b> planner nodes</span><i />
            <span><b>{candidateRoutes.length.toString().padStart(2, '0')}</b> candidate routes</span><i />
            <span><b>{resultEdges.length.toString().padStart(2, '0')}</b> built</span>
          </div>
        </section>

        <section className="panel route-builder-panel algorithm-route-panel" aria-label="Route and cost configuration">
          <div className="builder-heading">
            <div>
              <div className="panel-title-row">
                <span className="panel-icon">{algorithm === 'classic' ? <Cpu size={15} /> : <Orbit size={15} />}</span>
                <h2>Routes &amp; costs</h2>
              </div>
              <p>Checked routes are candidate edges; their endpoint cities are added to the submitted network.</p>
            </div>
            <span className={`algorithm-run-state ${runStatus}`} role="status">
              {runStatus === 'running'
                ? <><LoaderCircle size={11} /> Running</>
                : runStatus === 'complete'
                  ? <><CircleCheck size={11} /> Complete</>
                  : runStatus === 'infeasible'
                    ? <><CircleX size={11} /> Infeasible</>
                    : runStatus === 'error'
                      ? <><CircleX size={11} /> Failed</>
                      : 'Ready'}
            </span>
          </div>
          <div className="route-list algorithm-route-list" aria-live="polite">
            {routes.map((route, index) => {
              const isIncluded = includedRouteIds.includes(route.id)
              const selectedEdge = resultEdges.find((edge) => String(edge.id) === route.id)
              const isCostValid = isValidCost(routeCosts[route.id])
              return (
                <div key={route.id} className={`construction-route algorithm-route config-route ${selectedEdge ? 'construction-route-built' : ''} ${!isIncluded ? 'config-route-excluded' : ''}`}>
                  <span className="route-index">{String(index + 1).padStart(2, '0')}</span>
                  <label className="route-include-control">
                    <input
                      type="checkbox"
                      aria-label={`Include ${route.from} to ${route.to}`}
                      checked={isIncluded}
                      disabled={isRunningNow}
                      onChange={(event) => toggleRoute(route.id, event.target.checked)}
                    />
                    <span />
                  </label>
                  <span className="route-endpoints"><strong>{route.from}</strong><ArrowDownRight size={12} /><strong>{route.to}</strong></span>
                  <label className="route-cost-editor">
                    <span>COST</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      aria-label={`Construction cost for ${route.from} to ${route.to}`}
                      value={routeCosts[route.id]}
                      disabled={isRunningNow}
                      onChange={(event) => updateRouteCost(route.id, event.target.value)}
                    />
                  </label>
                  <span className="route-value"><small>{selectedEdge?.stage.toUpperCase() ?? (isIncluded ? 'CANDIDATE' : 'REWARD')}</small><strong>+{selectedEdge ? formatNumber(selectedEdge.value) : route.value}</strong></span>
                  {isIncluded && !isCostValid && <span className="route-cost-error">Use a non-negative cost with up to 2 decimals</span>}
                </div>
              )
            })}
          </div>
          <div className="route-list-footer algorithm-list-footer">
            <span>{candidateRoutes.length} candidate routes sent to planner</span>
            <span>{resultEdges.length} routes in returned network</span>
          </div>
        </section>
      </div>

      <IntermediateLog
        entries={logEntries}
        status={runStatus === 'ready' ? 'Waiting for run' : runStatus}
        remainingBudget={remainingBudget}
      />

      <section className="panel model-evaluation-panel" id="model-evaluation">
        <div className="model-demo-header">
          <div><span className="eyebrow">QUANTUM OPTIMIZATION <i /> REFERENCE</span><h2>Model Evaluation Demo</h2><p>Example QAOA budget trade-offs; the live result above is returned by the Python planner.</p></div>
          <span className="model-tag">REFERENCE OUTPUT</span>
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
      </section>

      <div className="demo-disclaimer"><span className="disclaimer-dot" /> All workspaces currently use the same hybrid FastAPI planner; its QAOA stage runs in the Python worker and does not dispatch to real quantum hardware.</div>
      <AnimatePresence>{isRunningNow && <SimulationOverlay statusMessage="Waiting for QAOA and network completion response" intervalMs={simulationSpeed === 'slow' ? 5600 : 2800} />}</AnimatePresence>
    </div>
  )
}

function isRunning(status: RunStatus) {
  return status === 'running'
}