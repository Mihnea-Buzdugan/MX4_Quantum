import { useCallback, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowDownRight,
  Atom,
  CircleCheck,
  CircleX,
  Construction,
  Cpu,
  LoaderCircle,
  Network,
  Orbit,
  Play,
  Repeat,
  RotateCw,
  Route,
  Scale,
  ScanLine,
  Target,
  Timer,
  X,
} from 'lucide-react'
import { Link, useOutletContext } from 'react-router-dom'
import IntermediateLog, { type IntermediateLogEntry } from '../components/IntermediateLog'
import NetworkDiagram from '../components/NetworkDiagram'
import QuantumDetails from '../components/Quantumdetails'
import SimulationOverlay from '../components/SimulationOverlay'
import { estimateQubits } from '../utils/qubits'
import { makeResponseEntries, routeName } from '../utils/planLog'
import type { RunHistoryRecord, WorkspaceContext } from '../components/AppShell'
import { cities, modelEvaluations, routes, startingBudget } from '../data/routes'
import {
  createRailwayPlanRequest,
  DEFAULT_PLANNER_OPTIONS,
  DEFAULT_QAOA_SETTINGS,
  planRailwayNetwork,
  QAOA_LIMITS,
  qaoaSettingsToOptions,
  type QaoaSettings,
} from '../services/railwayPlanner'
import {
  type PathId,
  type RailwayPlanResponse,
} from '../services/railwayPlannerTypes'

type Algorithm = 'quantum-simulated' | 'quantum-hardware' | 'classic'
type RunStatus = 'ready' | 'running' | 'complete' | 'infeasible' | 'pending' | 'error'

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

// Qubit limit the frontend sends as options.max_qubits.
const MAX_QUBITS = DEFAULT_PLANNER_OPTIONS.max_qubits

type QaoaInputs = { p: string; iterations: string; shots: string; slack: boolean }

function parseWholeNumber(value: string, min: number, max: number): number | null {
  const text = value.trim()
  if (!/^\d+$/.test(text)) return null
  const number = Number(text)
  return number >= min && number <= max ? number : null
}

function parseQaoaInputs(inputs: QaoaInputs): QaoaSettings | null {
  const p = parseWholeNumber(inputs.p, QAOA_LIMITS.p.min, QAOA_LIMITS.p.max)
  const iterations = parseWholeNumber(inputs.iterations, QAOA_LIMITS.iterations.min, QAOA_LIMITS.iterations.max)
  const shots = parseWholeNumber(inputs.shots, QAOA_LIMITS.shots.min, QAOA_LIMITS.shots.max)
  return p === null || iterations === null || shots === null
    ? null
    : { p, iterations, shots, slack: inputs.slack }
}

function formatNumber(value: number | null | undefined) {
  return value === undefined || value === null ? '—' : Number(value.toFixed(3)).toString()
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
  const [qaoaInputs, setQaoaInputs] = useState<QaoaInputs>(() => ({
    p: String(DEFAULT_QAOA_SETTINGS.p),
    iterations: String(DEFAULT_QAOA_SETTINGS.iterations),
    shots: String(DEFAULT_QAOA_SETTINGS.shots),
    slack: DEFAULT_QAOA_SETTINGS.slack,
  }))

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
  const includedRoutes = useMemo(
    () => availableRoutes.filter((route) => includedRouteIds.includes(route.id)),
    [availableRoutes, includedRouteIds],
  )
  // Only routes whose two endpoints are both selected nodes can be sent,
  // otherwise a path would reference a node that is not in `nodes`.
  const candidateRoutes = useMemo(
    () => includedRoutes.filter(
      (route) => selectedNodes.includes(route.from) && selectedNodes.includes(route.to),
    ),
    [includedRoutes, selectedNodes],
  )
  // Only the nodes the user selected on the map are sent to the planner.
  const networkCities = useMemo(
    () => cities.filter((city) => selectedNodes.includes(city.name)),
    [selectedNodes],
  )
  const candidateCostsValid = candidateRoutes.length > 0
    && candidateRoutes.every((route) => isValidCost(routeCosts[route.id]))
  const isQuantum = algorithm !== 'classic'
  const qaoaSettings = parseQaoaInputs(qaoaInputs)
  const qaoaSettingsValid = !isQuantum || qaoaSettings !== null
  const qubitEstimate = useMemo(
    () => estimateQubits(candidateRoutes.map((route) => route.constructionCost), numericBudget, qaoaInputs.slack),
    [candidateRoutes, numericBudget, qaoaInputs.slack],
  )
  const estimatedQubits = qubitEstimate.routeQubits + qubitEstimate.slackQubits
  const canStart = isBudgetValid && selectedNodes.length >= 2 && candidateCostsValid && qaoaSettingsValid && !isRunning(runStatus)
  const resultEdges = result?.graph?.edges ?? []
  const totalCost = result?.total_cost ?? 0
  const totalReward = result?.total_value ?? 0
  const remainingBudget = result?.remaining_budget ?? null
  const isPending = result?.status === 'pending'
  const hasPlanStatus = result !== null && !isPending
  const noValidSample = result?.status === 'disconnected' || result?.status === 'no_valid_sample'
  const isValidPlan = result?.status === 'ok'
    && result.connected
    && typeof result.total_cost === 'number'
    && result.total_cost <= numericBudget
  const routeStages: Record<string, 'quantum' | 'connector' | 'extra'> = Object.fromEntries(
    resultEdges.map((edge) => [String(edge.id), edge.stage]),
  )
  const sampler = result?.quantum?.sampler ?? null
  const usedRealHardware = sampler?.startsWith('ibm-qpu') === true
  const stableRouteName = useCallback((id: PathId) => routeName(id), [])

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

  function updateQaoaInput(field: 'p' | 'iterations' | 'shots', value: string) {
    if (isRunning(runStatus)) return
    resetResults()
    setQaoaInputs((current) => ({ ...current, [field]: value }))
  }

  function updateSlack(slack: boolean) {
    if (isRunning(runStatus)) return
    resetResults()
    setQaoaInputs((current) => ({ ...current, slack }))
  }

  function getValidationMessage() {
    if (!isBudgetValid) return 'Enter a valid budget of zero or more.'
    if (selectedNodes.length < 2) return 'Select at least two network nodes on the map.'
    if (candidateRoutes.length === 0) return 'Check at least one route that connects two selected nodes.'
    if (!candidateCostsValid) return 'Route costs must be non-negative values with at most two decimals.'
    if (!qaoaSettingsValid) return `QAOA settings must be whole numbers: p ${QAOA_LIMITS.p.min}–${QAOA_LIMITS.p.max}, COBYLA iterations ${QAOA_LIMITS.iterations.min}–${QAOA_LIMITS.iterations.max}, shots ${QAOA_LIMITS.shots.min}–${QAOA_LIMITS.shots.max}.`
    if (runStatus === 'infeasible' && noValidSample) return 'QAOA found no valid connected network in its samples. Try more shots, a larger p or more COBYLA iterations.'
    if (runStatus === 'infeasible') return 'The backend could not connect this network within budget; adjust nodes, routes, or costs.'
    if (runStatus === 'pending') return 'The IBM Quantum job is still running. Its job id is in the log; resubmit with that job id to collect the result.'
    if (runStatus === 'error') return 'The request failed. Check that the FastAPI planner is running and try again.'
    if (runStatus === 'complete') return 'Planner finished. Review the returned network, circuit and QAOA diagnostics below.'
    return 'Ready to submit the selected network to the FastAPI planner.'
  }

  async function startSimulation() {
    if (!canStart) return

    resetResults()
    setRunStatus('running')
    const startedAt = performance.now()
    // the algorithm label also picks options.execution (real IBM hardware or the simulator)
    // p, slack / no slack, COBYLA iterations and shots come from the QAOA settings panel
    const payload = createRailwayPlanRequest(
      numericBudget,
      networkCities,
      candidateRoutes,
      algorithmName,
      qaoaSettings ? qaoaSettingsToOptions(qaoaSettings) : {},
    )
    payload.include_qubo = true // keep the QUBO so the saved run shows it in the run history

    try {
      const response: RailwayPlanResponse = await planRailwayNetwork(payload)
      const elapsedMs = performance.now() - startedAt
      const finishedAt = Date.now()
      const completedSuccessfully = response.status === 'ok'
        && response.connected
        && typeof response.total_cost === 'number'
        && response.total_cost <= numericBudget

      setResult(response)
      setLogEntries(makeResponseEntries(response))
      setExecutionTime(elapsedMs)
      setRunStatus(response.status === 'ok' ? 'complete' : response.status === 'pending' ? 'pending' : 'infeasible')
      setRunMetrics({ executionMs: elapsedMs, simulatedMs: null })
      if (!completedSuccessfully && response.status === 'ok') {
        setSimulationError('The planner returned a network that is disconnected or exceeds the submitted budget.')
      }
      if (response.status === 'pending') return // no finished plan to record yet

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
      {result?.plan_id != null && (
        <p className="batch-saved-note" role="status">
          Saved to the run history as simulation #{result.plan_id} · <Link to={`/run-history/plans/${result.plan_id}`}>open it</Link>
        </p>
      )}

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
            <strong>{isPending ? 'IBM job pending' : !hasPlanStatus ? 'Plan not run' : isValidPlan ? 'Valid Plan' : noValidSample ? 'Invalid Plan (No Valid QAOA Sample)' : 'Invalid Plan (Over Budget / Infeasible)'}</strong>
            <span>{isPending ? result?.reason ?? 'The hardware job is still running.' : !hasPlanStatus ? 'Run the planner to evaluate the selected network.' : isValidPlan ? 'Connected network is within budget.' : result?.reason ?? 'Planner did not return a valid connected network.'}</span>
          </div>
        </article>
      </section>

      {isQuantum && (
        <section className="construction-scoreboard qaoa-config" aria-label="QAOA settings">
          <article className="panel score-card">
            <label className="score-card-label" htmlFor="qaoa-p"><span className="panel-icon"><Atom size={15} /></span><span>QAOA layers (p)</span></label>
            <input
              id="qaoa-p"
              className="budget-input"
              type="number"
              min={QAOA_LIMITS.p.min}
              max={QAOA_LIMITS.p.max}
              step="1"
              value={qaoaInputs.p}
              disabled={isRunningNow}
              onChange={(event) => updateQaoaInput('p', event.target.value)}
            />
            <small>Whole number {QAOA_LIMITS.p.min}–{QAOA_LIMITS.p.max}</small>
          </article>
          <article className="panel score-card">
            <label className="score-card-label" htmlFor="qaoa-slack"><span className="panel-icon"><Scale size={15} /></span><span>Budget encoding</span></label>
            <select
              id="qaoa-slack"
              className="budget-input"
              value={qaoaInputs.slack ? 'slack' : 'no-slack'}
              disabled={isRunningNow}
              onChange={(event) => updateSlack(event.target.value === 'slack')}
            >
              <option value="slack">Slack</option>
              <option value="no-slack">No slack</option>
            </select>
            <small>
              {qaoaInputs.slack
                ? `Exact budget limit · ≈ ${qubitEstimate.routeQubits} route + ${qubitEstimate.slackQubits} slack qubits`
                : `Penalty only, no extra qubits · ≈ ${qubitEstimate.routeQubits} qubits`}
            </small>
          </article>
          <article className="panel score-card">
            <label className="score-card-label" htmlFor="qaoa-iterations"><span className="panel-icon"><Repeat size={15} /></span><span>COBYLA iterations</span></label>
            <input
              id="qaoa-iterations"
              className="budget-input"
              type="number"
              min={QAOA_LIMITS.iterations.min}
              max={QAOA_LIMITS.iterations.max}
              step="1"
              value={qaoaInputs.iterations}
              disabled={isRunningNow}
              onChange={(event) => updateQaoaInput('iterations', event.target.value)}
            />
            <small>Per optimiser run · {QAOA_LIMITS.iterations.min}–{QAOA_LIMITS.iterations.max}</small>
          </article>
          <article className="panel score-card">
            <label className="score-card-label" htmlFor="qaoa-shots"><span className="panel-icon"><ScanLine size={15} /></span><span>Number of shots</span></label>
            <input
              id="qaoa-shots"
              className="budget-input"
              type="number"
              min={QAOA_LIMITS.shots.min}
              max={QAOA_LIMITS.shots.max}
              step="1"
              value={qaoaInputs.shots}
              disabled={isRunningNow}
              onChange={(event) => updateQaoaInput('shots', event.target.value)}
            />
            <small>Measurements of the final circuit{algorithm === 'quantum-hardware' ? ' (also on IBM hardware)' : ''}</small>
          </article>
          {estimatedQubits > MAX_QUBITS && (
            <p className="qaoa-config-warning" role="alert">
              ≈ {estimatedQubits} qubits needed, but the planner allows {MAX_QUBITS}.
              {qaoaInputs.slack && qubitEstimate.routeQubits <= MAX_QUBITS ? ' Choose "No slack" or use fewer routes.' : ' Use fewer candidate routes.'}
            </p>
          )}
        </section>
      )}

      <div className="construction-workspace algorithm-workspace">
        <section className="panel network-panel construction-network">
          <div className="panel-heading">
            <div>
              <div className="panel-title-row">
                <span className="panel-icon"><Network size={15} /></span>
                <h2>Romania railway network</h2>
                <span className="live-tag"><i /> {resultEdges.length} BUILT</span>
              </div>
              <p>Select at least two cities. Only checked routes between selected cities are sent to the planner.</p>
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
            <span><b>{selectedNodes.length.toString().padStart(2, '0')}</b> planner nodes</span><i />
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
              <p>Checked routes are candidate edges. Only routes between selected nodes are submitted to the planner.</p>
            </div>
            <span className={`algorithm-run-state ${runStatus}`} role="status">
              {runStatus === 'running'
                ? <><LoaderCircle size={11} /> Running</>
                : runStatus === 'complete'
                  ? <><CircleCheck size={11} /> Complete</>
                  : runStatus === 'infeasible'
                    ? <><CircleX size={11} /> Infeasible</>
                    : runStatus === 'pending'
                      ? <><LoaderCircle size={11} /> Pending</>
                      : runStatus === 'error'
                        ? <><CircleX size={11} /> Failed</>
                        : 'Ready'}
            </span>
          </div>
          <div className="route-list algorithm-route-list" aria-live="polite">
            {routes.map((route, index) => {
              const isIncluded = includedRouteIds.includes(route.id)
              const isAvailable = selectedNodes.includes(route.from) && selectedNodes.includes(route.to)
              const isActive = isIncluded && isAvailable
              const selectedEdge = resultEdges.find((edge) => String(edge.id) === route.id)
              const isCostValid = isValidCost(routeCosts[route.id])
              return (
                <div key={route.id} className={`construction-route algorithm-route config-route ${selectedEdge ? 'construction-route-built' : ''} ${!isActive ? 'config-route-excluded' : ''}`}>
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
                  <span className="route-value"><small>{selectedEdge?.stage.toUpperCase() ?? (isActive ? 'CANDIDATE' : isIncluded ? 'NODE NOT SELECTED' : 'REWARD')}</small><strong>+{selectedEdge ? formatNumber(selectedEdge.value) : route.value}</strong></span>
                  {isActive && !isCostValid && <span className="route-cost-error">Use a non-negative cost with up to 2 decimals</span>}
                </div>
              )
            })}
          </div>
          <div className="route-list-footer algorithm-list-footer">
            <span>{candidateRoutes.length} routes between selected nodes sent to planner</span>
            <span>{resultEdges.length} routes in returned network</span>
          </div>
        </section>
      </div>

      <IntermediateLog
        entries={logEntries}
        status={runStatus === 'ready' ? 'Waiting for run' : runStatus}
        remainingBudget={remainingBudget}
      />

      <QuantumDetails stats={result?.quantum} conflicts={result?.conflicts} routeName={stableRouteName} />

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

      <div className="demo-disclaimer">
        <span className="disclaimer-dot" />{' '}
        {sampler
          ? usedRealHardware
            ? `The last run sampled the final QAOA circuit on real IBM Quantum hardware (${result?.quantum?.execution?.backend ?? 'IBM backend'}); angles were trained on a local simulator.`
            : `The last run sampled the QAOA circuit with "${sampler}"; this was not real quantum hardware.`
          : 'All workspaces use the same hybrid FastAPI planner. The QAOA stage runs in the Python worker and only dispatches to IBM hardware when the server enables it.'}
      </div>
      <AnimatePresence>{isRunningNow && <SimulationOverlay statusMessage="Waiting for QAOA and network completion response" intervalMs={simulationSpeed === 'slow' ? 5600 : 2800} />}</AnimatePresence>
    </div>
  )
}

function isRunning(status: RunStatus) {
  return status === 'running'
}