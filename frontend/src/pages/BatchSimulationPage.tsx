import { Fragment, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  BarChart3,
  ChevronDown,
  ChevronRight,
  Copy,
  FileDown,
  Layers,
  LoaderCircle,
  Network,
  Play,
  Route,
  Shuffle,
  Square,
  X,
} from 'lucide-react'
import { Link, useOutletContext } from 'react-router-dom'
import BatchStatistics, { RunStateBadge } from '../components/BatchStatistics'
import NetworkDiagram from '../components/NetworkDiagram'
import RunDetails from '../components/RunDetails'
import type { WorkspaceContext } from '../components/AppShell'
import { cities, routes, startingBudget } from '../data/routes'
import {
  createRailwayPlanRequest,
  DEFAULT_PLANNER_OPTIONS,
  DEFAULT_QAOA_SETTINGS,
  planRailwayNetwork,
  QAOA_LIMITS,
  qaoaSettingsToOptions,
} from '../services/railwayPlanner'
import {
  computeStatistics,
  fmt,
  pct,
  toMetrics,
  type BatchRunParams,
  type BatchRunResult,
} from '../utils/batchStats'
import { createBatch, finishBatch } from '../services/history'
import { isLoggedIn } from '../utils/auth'
import { estimateQubits } from '../utils/qubits'

type Execution = 'simulated' | 'hardware'

// Raw text of one row of the simulations table (validated before the batch runs).
type ParamRow = { p: string; slack: boolean; iterations: string; shots: string; seed: string }

const MAX_SIMULATIONS = 100
const MAX_QUBITS = DEFAULT_PLANNER_OPTIONS.max_qubits
const DEFAULT_SEED = DEFAULT_PLANNER_OPTIONS.seed

const ALGORITHM_LABEL: Record<Execution, string> = {
  simulated: 'Quantum Algorithm (Simulated)',
  hardware: 'Quantum Algorithm (Real Hardware)',
}

function defaultRow(seed: number): ParamRow {
  return {
    p: String(DEFAULT_QAOA_SETTINGS.p),
    slack: DEFAULT_QAOA_SETTINGS.slack,
    iterations: String(DEFAULT_QAOA_SETTINGS.iterations),
    shots: String(DEFAULT_QAOA_SETTINGS.shots),
    seed: String(seed),
  }
}

function wholeNumber(value: string, min: number, max: number): number | null {
  const text = value.trim()
  if (!/^-?\d+$/.test(text)) return null
  const n = Number(text)
  return n >= min && n <= max ? n : null
}

function parseRow(row: ParamRow): BatchRunParams | null {
  const p = wholeNumber(row.p, QAOA_LIMITS.p.min, QAOA_LIMITS.p.max)
  const iterations = wholeNumber(row.iterations, QAOA_LIMITS.iterations.min, QAOA_LIMITS.iterations.max)
  const shots = wholeNumber(row.shots, QAOA_LIMITS.shots.min, QAOA_LIMITS.shots.max)
  const seed = wholeNumber(row.seed, 0, 2 ** 31 - 1)
  return p === null || iterations === null || shots === null || seed === null
    ? null
    : { p, slack: row.slack, iterations, shots, seed }
}

function formatSeconds(ms: number | null) {
  if (ms === null) return '—'
  return ms < 1000 ? `${ms.toFixed(0)} ms` : `${(ms / 1000).toFixed(2)} s`
}

export default function BatchSimulationPage() {
  const { simulationSpeed, appendRunHistory } = useOutletContext<WorkspaceContext>()
  const [execution, setExecution] = useState<Execution>('simulated')
  const [budgetInput, setBudgetInput] = useState(String(startingBudget))
  const [selectedNodes, setSelectedNodes] = useState<string[]>([])
  const [includedRouteIds, setIncludedRouteIds] = useState(() => routes.map((route) => route.id))
  const [countInput, setCountInput] = useState('3')
  const [rows, setRows] = useState<ParamRow[]>(() => [0, 1, 2].map((i) => defaultRow(DEFAULT_SEED + i)))
  const [runs, setRuns] = useState<BatchRunResult[]>([])
  const [running, setRunning] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [finishedAt, setFinishedAt] = useState<number | null>(null)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set())
  const [savedBatchId, setSavedBatchId] = useState<number | null>(null)
  const [saveNotice, setSaveNotice] = useState<string | null>(null)
  const stopRequested = useRef(false)

  const budget = budgetInput.trim() === '' ? Number.NaN : Number(budgetInput)
  const budgetValid = Number.isFinite(budget) && budget >= 0
  const candidateRoutes = useMemo(
    () => routes.filter((route) => includedRouteIds.includes(route.id)
      && selectedNodes.includes(route.from) && selectedNodes.includes(route.to)),
    [includedRouteIds, selectedNodes],
  )
  const networkCities = useMemo(() => cities.filter((city) => selectedNodes.includes(city.name)), [selectedNodes])
  const parsedRows = rows.map(parseRow)
  const rowsValid = parsedRows.every((row) => row !== null)
  const countValid = wholeNumber(countInput, 1, MAX_SIMULATIONS) !== null
  const canRun = !running && budgetValid && selectedNodes.length >= 2 && candidateRoutes.length > 0 && rowsValid && countValid

  const qubitsFor = (slack: boolean) => {
    const q = estimateQubits(candidateRoutes.map((route) => route.constructionCost), budget, slack)
    return q.routeQubits + q.slackQubits
  }
  const tooManyQubits = rows.some((row) => qubitsFor(row.slack) > MAX_QUBITS)

  const stats = useMemo(() => computeStatistics(runs, budget), [runs, budget])
  const doneCount = runs.filter((run) => run.state === 'done' || run.state === 'failed').length

  function clearResults() {
    if (running) return
    setRuns([])
    setExpanded(new Set())
    setSavedBatchId(null)
    setSaveNotice(null)
    setStartedAt(null)
    setFinishedAt(null)
    setPdfError(null)
  }

  function setCount(value: string) {
    if (running) return
    setCountInput(value)
    const n = wholeNumber(value, 1, MAX_SIMULATIONS)
    if (n === null) return
    clearResults()
    setRows((current) => {
      if (n <= current.length) return current.slice(0, n)
      const last = current[current.length - 1] ?? defaultRow(DEFAULT_SEED - 1)
      const lastSeed = wholeNumber(last.seed, 0, 2 ** 31 - 1) ?? DEFAULT_SEED - 1
      const extra = Array.from({ length: n - current.length }, (_, i) => ({ ...last, seed: String(lastSeed + i + 1) }))
      return [...current, ...extra]
    })
  }

  function updateRow(index: number, patch: Partial<ParamRow>) {
    if (running) return
    clearResults()
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  function copyFirstRowToAll() {
    if (running || rows.length === 0) return
    clearResults()
    setRows((current) => current.map((row, i) => ({ ...current[0], seed: i === 0 ? current[0].seed : row.seed })))
  }

  function sequentialSeeds() {
    if (running) return
    clearResults()
    const first = wholeNumber(rows[0]?.seed ?? '', 0, 2 ** 31 - 1) ?? DEFAULT_SEED
    setRows((current) => current.map((row, i) => ({ ...row, seed: String(first + i) })))
  }

  function toggleNode(name: string) {
    if (running) return
    clearResults()
    setSelectedNodes((current) => (current.includes(name) ? current.filter((n) => n !== name) : [...current, name]))
  }

  function toggleRoute(id: string, included: boolean) {
    if (running) return
    clearResults()
    setIncludedRouteIds((current) => (included ? [...current, id] : current.filter((r) => r !== id)))
  }

  function toggleExpanded(index: number) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  async function runBatch() {
    if (!canRun) return
    const params = parsedRows as BatchRunParams[]
    const algorithm = ALGORITHM_LABEL[execution]
    stopRequested.current = false
    setStopping(false)
    setRunning(true)
    setPdfError(null)
    setStartedAt(Date.now())
    setFinishedAt(null)
    // `local` mirrors the runs state so the final statistics can be saved at the end of the loop
    const local: BatchRunResult[] = params.map((p, i) => ({ index: i + 1, params: p, state: 'queued', requestMs: null, response: null, error: null }))
    setRuns(local)
    const update = (i: number, patch: Partial<BatchRunResult>) => {
      local[i] = { ...local[i], ...patch }
      setRuns((current) => current.map((run, k) => (k === i ? { ...run, ...patch } : run)))
    }

    // Register the batch in the database first, so every run is saved under it (logged-in users only).
    let batchId: number | null = null
    setSavedBatchId(null)
    if (isLoggedIn()) {
      try {
        const batch = await createBatch({
          algorithm,
          budget,
          nodes: selectedNodes,
          routes: candidateRoutes.map((route) => ({
            id: route.id, from: route.from, to: route.to, cost: route.constructionCost, value: route.value,
          })),
          runs: params,
        })
        batchId = batch.id
        setSavedBatchId(batch.id)
        setSaveNotice(null)
      } catch (error) {
        setSaveNotice(`This batch is not being saved to the run history: ${error instanceof Error ? error.message : 'unknown error'}`)
      }
    } else {
      setSaveNotice('Sign in to save batches to the run history.')
    }

    // One simulation at a time: the planner is CPU-bound and the timings stay comparable.
    for (let i = 0; i < params.length; i += 1) {
      if (stopRequested.current) {
        for (let k = i; k < params.length; k += 1) update(k, { state: 'skipped' })
        break
      }
      update(i, { state: 'running' })
      const started = performance.now()
      try {
        const payload = createRailwayPlanRequest(budget, networkCities, candidateRoutes, algorithm, {
          ...qaoaSettingsToOptions(params[i]),
          seed: params[i].seed,
          include_circuit: true,
          circuit_formats: ['qasm3'],
        })
        payload.include_qubo = true // QUBO, Ising model and optimiser trace for the details and the PDF
        if (batchId !== null) {
          payload.batch_id = batchId
          payload.batch_index = i + 1
        }
        const response = await planRailwayNetwork(payload)
        const requestMs = performance.now() - started
        update(i, { state: 'done', response, requestMs })
        const valid = response.status === 'ok' && response.connected
          && typeof response.total_cost === 'number' && response.total_cost <= budget + 1e-9
        if (response.status !== 'pending') {
          appendRunHistory({
            timestamp: Date.now(),
            algorithm: `${algorithm} · batch #${i + 1}`,
            speed: simulationSpeed,
            executionMs: requestMs,
            planStatus: valid ? 'valid' : 'invalid',
            totalCost: response.total_cost ?? 0,
            totalReward: response.total_value ?? 0,
            selectedRoutes: (response.graph?.edges ?? []).map((edge) => `${edge.from} → ${edge.to} (${edge.stage})`),
          })
        }
      } catch (error) {
        update(i, {
          state: 'failed',
          requestMs: performance.now() - started,
          error: error instanceof Error ? error.message : 'The railway planner request failed.',
        })
      }
    }
    setFinishedAt(Date.now())
    setRunning(false)
    setStopping(false)
    if (batchId !== null) {
      try {
        await finishBatch(batchId, {
          status: stopRequested.current ? 'stopped' : 'completed',
          statistics: computeStatistics(local, budget),
        })
      } catch (error) {
        setSaveNotice(`The runs were saved, but the batch summary was not: ${error instanceof Error ? error.message : 'unknown error'}`)
      }
    }
  }

  async function downloadPdf() {
    setPdfError(null)
    try {
      // loaded on demand so the PDF library is not part of the main bundle
      const { buildBatchReport } = await import('../utils/batchReport')
      const doc = await buildBatchReport(
        {
          algorithm: ALGORITHM_LABEL[execution],
          budget,
          nodes: selectedNodes,
          routes: candidateRoutes.map((route) => `${route.from} → ${route.to} (cost ${route.constructionCost}, value ${route.value})`),
          startedAt: startedAt ?? Date.now(),
          finishedAt,
        },
        runs,
        stats,
      )
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
      doc.save(`batch-simulation-${stamp}.pdf`)
    } catch (error) {
      setPdfError(error instanceof Error ? `Could not create the PDF: ${error.message}` : 'Could not create the PDF.')
    }
  }

  function readiness() {
    if (running) return stopping ? 'Stopping after the current simulation…' : `Running simulation ${Math.min(doneCount + 1, runs.length)} of ${runs.length}…`
    if (!budgetValid) return 'Enter a valid budget of zero or more.'
    if (!countValid) return `Number of simulations must be a whole number from 1 to ${MAX_SIMULATIONS}.`
    if (selectedNodes.length < 2) return 'Select at least two network nodes on the map.'
    if (candidateRoutes.length === 0) return 'Check at least one route that connects two selected nodes.'
    if (!rowsValid) return `Fix the highlighted parameters: p ${QAOA_LIMITS.p.min}–${QAOA_LIMITS.p.max}, iterations ${QAOA_LIMITS.iterations.min}–${QAOA_LIMITS.iterations.max}, shots ${QAOA_LIMITS.shots.min}–${QAOA_LIMITS.shots.max}, seed ≥ 0.`
    if (runs.length > 0) return `Batch finished: ${stats.finished} completed, ${stats.failed} failed. Statistics and the PDF report are below.`
    return `Ready to run ${rows.length} simulation${rows.length === 1 ? '' : 's'} one after another.`
  }

  return (
    <div className="dashboard-page construction-page algorithm-page batch-page">
      <motion.div className="page-heading" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <div>
          <span className="eyebrow">RAILWAY PLANNING <i /> BATCH WORKSPACE</span>
          <h1>Batch Simulations</h1>
          <p>Choose a network once, give every simulation its own QAOA parameters, run them in sequence and export the statistics as a PDF.</p>
        </div>
        <div className="heading-actions">
          {running ? (
            <button type="button" className="button button-secondary" disabled={stopping} onClick={() => { stopRequested.current = true; setStopping(true) }}>
              <Square size={13} /> {stopping ? 'Stopping…' : 'Stop batch'}
            </button>
          ) : (
            <button type="button" className="button button-primary start-simulation-button" disabled={!canRun} onClick={() => void runBatch()}>
              <Play size={14} /> Run {rows.length} simulation{rows.length === 1 ? '' : 's'}
            </button>
          )}
          <button type="button" className="button button-secondary" disabled={running || stats.finished + stats.failed === 0} onClick={() => void downloadPdf()}>
            <FileDown size={14} /> Download PDF
          </button>
        </div>
      </motion.div>

      <div className={`simulation-readiness ${canRun || running ? 'simulation-ready' : ''}`} role="status">
        <span className={`health-indicator ${canRun || running ? '' : 'simulation-not-ready-dot'}`} />
        {readiness()}
      </div>
      {pdfError && <p className="simulation-error" role="alert">{pdfError}</p>}
      {savedBatchId !== null && (
        <p className="batch-saved-note" role="status">
          {running ? 'Saving' : 'Saved'} to the run history as batch #{savedBatchId}
          {!running && <> · <Link to={`/run-history/batches/${savedBatchId}`}>open it</Link></>}
        </p>
      )}
      {saveNotice && <p className="batch-saved-note batch-saved-note-muted" role="status">{saveNotice}</p>}
      {tooManyQubits && (
        <p className="qaoa-config-warning batch-warning" role="alert">
          Some rows need more than {MAX_QUBITS} qubits with the selected routes (≈ {qubitsFor(true)} with slack, {qubitsFor(false)} without). Those simulations will fail; choose "No slack" or fewer routes.
        </p>
      )}

      <section className="construction-scoreboard batch-scoreboard" aria-label="Batch setup">
        <article className="panel score-card">
          <label className="score-card-label" htmlFor="batch-execution"><span className="panel-icon"><Layers size={15} /></span><span>Execution</span></label>
          <select id="batch-execution" className="budget-input batch-select" value={execution} disabled={running}
            onChange={(event) => { clearResults(); setExecution(event.target.value === 'hardware' ? 'hardware' : 'simulated') }}>
            <option value="simulated">Simulator</option>
            <option value="hardware">IBM real hardware</option>
          </select>
          <small>{execution === 'hardware' ? 'Each simulation is a separate IBM job' : 'Local QAOA simulation'}</small>
        </article>
        <article className="panel score-card">
          <label className="score-card-label" htmlFor="batch-budget"><span className="panel-icon"><Route size={15} /></span><span>Budget</span></label>
          <input id="batch-budget" className="budget-input" type="number" min="0" step="0.01" value={budgetInput} disabled={running}
            onChange={(event) => { clearResults(); setBudgetInput(event.target.value) }} />
          <small>Same budget for every simulation</small>
        </article>
        <article className="panel score-card">
          <label className="score-card-label" htmlFor="batch-count"><span className="panel-icon"><BarChart3 size={15} /></span><span>Number of simulations</span></label>
          <input id="batch-count" className="budget-input" type="number" min="1" max={MAX_SIMULATIONS} step="1" value={countInput} disabled={running}
            onChange={(event) => setCount(event.target.value)} />
          <small>1–{MAX_SIMULATIONS}, one parameter row each</small>
        </article>
        <article className="panel score-card">
          <div className="score-card-label"><span className="panel-icon"><LoaderCircle size={15} /></span><span>Progress</span></div>
          <strong>{doneCount}<small> / {runs.length || rows.length}</small></strong>
          <div className="budget-progress"><i style={{ width: `${runs.length ? (doneCount / runs.length) * 100 : 0}%` }} /></div>
          <small>{startedAt ? `${formatSeconds((finishedAt ?? Date.now()) - startedAt)} total` : 'Not started'}</small>
        </article>
      </section>

      <div className="construction-workspace algorithm-workspace">
        <section className="panel network-panel construction-network">
          <div className="panel-heading">
            <div>
              <div className="panel-title-row">
                <span className="panel-icon"><Network size={15} /></span>
                <h2>Network for every simulation</h2>
              </div>
              <p>Select at least two cities. Checked routes between selected cities are used by all simulations.</p>
            </div>
          </div>
          <NetworkDiagram
            builtRouteIds={stats.best ? (runs[stats.best.index - 1]?.response?.graph?.edges ?? []).map((edge) => edge.id) : []}
            configuredRouteIds={candidateRoutes.map((route) => route.id)}
            selectedNodes={selectedNodes}
            onCitySelect={toggleNode}
          />
          <div className="selected-stops" aria-label="Selected network nodes">
            <div className="selected-stops-heading">
              <span>NETWORK NODES</span>
              {selectedNodes.length > 0 && (
                <button type="button" className="clear-stops-button" disabled={running} onClick={() => { clearResults(); setSelectedNodes([]) }}>
                  <X size={11} /> Clear nodes
                </button>
              )}
            </div>
            {selectedNodes.length === 0 ? <p>Select at least two cities on the map.</p> : (
              <div className="selected-stop-list">
                {selectedNodes.map((name) => (
                  <button type="button" className="selected-stop-chip" key={name} disabled={running} onClick={() => toggleNode(name)}>
                    <span>NODE</span>{name}<X size={11} />
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="panel route-builder-panel algorithm-route-panel" aria-label="Candidate routes">
          <div className="builder-heading">
            <div>
              <div className="panel-title-row">
                <span className="panel-icon"><Route size={15} /></span>
                <h2>Candidate routes</h2>
              </div>
              <p>{candidateRoutes.length} route{candidateRoutes.length === 1 ? '' : 's'} between selected nodes · ≈ {qubitsFor(true)} qubits with slack, {qubitsFor(false)} without (limit {MAX_QUBITS})</p>
            </div>
          </div>
          <div className="route-list batch-route-list">
            {routes.map((route) => {
              const included = includedRouteIds.includes(route.id)
              const available = selectedNodes.includes(route.from) && selectedNodes.includes(route.to)
              return (
                <label key={route.id} className={`batch-route ${included && available ? '' : 'batch-route-off'}`}>
                  <input type="checkbox" checked={included} disabled={running} onChange={(event) => toggleRoute(route.id, event.target.checked)} />
                  <span>{route.from} → {route.to}</span>
                  <small>cost {route.constructionCost} · +{route.value}</small>
                </label>
              )
            })}
          </div>
        </section>
      </div>

      <section className="panel batch-panel" aria-label="Simulation parameters">
        <div className="builder-heading">
          <div>
            <div className="panel-title-row">
              <span className="panel-icon"><Layers size={15} /></span>
              <h2>Simulations</h2>
            </div>
            <p>Parameters for each run. Repeating the same parameters with different seeds shows how stable the result is.</p>
          </div>
          <div className="batch-toolbar">
            <button type="button" className="button button-secondary" disabled={running || rows.length < 2} onClick={copyFirstRowToAll}><Copy size={13} /> Copy row 1 to all</button>
            <button type="button" className="button button-secondary" disabled={running} onClick={sequentialSeeds}><Shuffle size={13} /> Sequential seeds</button>
            <button
              type="button"
              className="button button-secondary"
              disabled={runs.every((run) => run.state !== 'done' && run.state !== 'failed')}
              onClick={() => setExpanded((current) => (current.size > 0 ? new Set() : new Set(runs.filter((run) => run.state === 'done' || run.state === 'failed').map((run) => run.index))))}
            >
              {expanded.size > 0 ? <><ChevronDown size={13} /> Collapse all</> : <><ChevronRight size={13} /> Expand all details</>}
            </button>
          </div>
        </div>
        <div className="batch-table-wrap">
          <table className="batch-table">
            <thead>
              <tr>
                <th aria-label="Details" /><th>#</th><th>p</th><th>Budget encoding</th><th>COBYLA iterations</th><th>Shots</th><th>Seed</th>
                <th>Status</th><th>Cost</th><th>Value</th><th>Ratio</th><th>Connected</th><th>Time</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const run = runs[i]
                const m = run?.state === 'done' ? toMetrics(run, budget) : null
                const bad = (ok: boolean) => (ok ? '' : 'batch-input-invalid')
                const hasDetails = run?.state === 'done' || run?.state === 'failed'
                const isOpen = run !== undefined && expanded.has(run.index)
                return (
                  <Fragment key={i}>
                  <tr className={isOpen ? 'batch-row-open' : ''}>
                    <td>
                      <button
                        type="button"
                        className="batch-expand"
                        disabled={!hasDetails}
                        aria-expanded={isOpen}
                        aria-label={`${isOpen ? 'Hide' : 'Show'} details of simulation ${i + 1}`}
                        onClick={() => run && toggleExpanded(run.index)}
                      >
                        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                    </td>
                    <td>{i + 1}</td>
                    <td><input className={bad(wholeNumber(row.p, QAOA_LIMITS.p.min, QAOA_LIMITS.p.max) !== null)} type="number" min={QAOA_LIMITS.p.min} max={QAOA_LIMITS.p.max} value={row.p} disabled={running} aria-label={`p for simulation ${i + 1}`} onChange={(e) => updateRow(i, { p: e.target.value })} /></td>
                    <td>
                      <select value={row.slack ? 'slack' : 'no-slack'} disabled={running} aria-label={`Budget encoding for simulation ${i + 1}`} onChange={(e) => updateRow(i, { slack: e.target.value === 'slack' })}>
                        <option value="slack">Slack</option>
                        <option value="no-slack">No slack</option>
                      </select>
                    </td>
                    <td><input className={bad(wholeNumber(row.iterations, QAOA_LIMITS.iterations.min, QAOA_LIMITS.iterations.max) !== null)} type="number" min={QAOA_LIMITS.iterations.min} max={QAOA_LIMITS.iterations.max} value={row.iterations} disabled={running} aria-label={`COBYLA iterations for simulation ${i + 1}`} onChange={(e) => updateRow(i, { iterations: e.target.value })} /></td>
                    <td><input className={bad(wholeNumber(row.shots, QAOA_LIMITS.shots.min, QAOA_LIMITS.shots.max) !== null)} type="number" min={QAOA_LIMITS.shots.min} max={QAOA_LIMITS.shots.max} value={row.shots} disabled={running} aria-label={`Shots for simulation ${i + 1}`} onChange={(e) => updateRow(i, { shots: e.target.value })} /></td>
                    <td><input className={bad(wholeNumber(row.seed, 0, 2 ** 31 - 1) !== null)} type="number" min="0" value={row.seed} disabled={running} aria-label={`Seed for simulation ${i + 1}`} onChange={(e) => updateRow(i, { seed: e.target.value })} /></td>
                    <td>
                      <RunStateBadge run={run} metrics={m} />
                    </td>
                    <td>{fmt(m?.totalCost)}</td>
                    <td>{fmt(m?.totalValue)}</td>
                    <td>{fmt(m?.approximationRatio, 3)}</td>
                    <td>{pct(m?.connectedSampleRate)}</td>
                    <td>{formatSeconds(run?.requestMs ?? null)}</td>
                  </tr>
                  {isOpen && run && (
                    <tr className="batch-detail-row">
                      <td colSpan={13}>
                        <div className="batch-detail">
                          <div className="batch-detail-title">
                            Simulation #{run.index} · p = {run.params.p} · {run.params.slack ? 'slack' : 'no slack'} · {run.params.iterations} COBYLA iterations · {run.params.shots} shots · seed {run.params.seed}
                          </div>
                          <RunDetails response={run.response} error={run.state === 'failed' ? run.error : null} valid={m?.valid} />
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
        {runs.some((run) => run.state === 'failed') && (
          <ul className="batch-errors">
            {runs.filter((run) => run.state === 'failed').map((run) => <li key={run.index}><b>#{run.index}</b> {run.error}</li>)}
          </ul>
        )}
      </section>

      <BatchStatistics runs={runs} budget={budget} onView={(index) => setExpanded((current) => new Set(current).add(index))} />
    </div>
  )
}
