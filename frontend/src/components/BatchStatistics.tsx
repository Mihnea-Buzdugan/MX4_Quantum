import { BarChart3, CircleCheck, CircleX, Cpu, LoaderCircle } from 'lucide-react'
import {
  computeStatistics,
  fmt,
  meanStd,
  pct,
  toMetrics,
  type BatchRunResult,
  type RunMetrics,
} from '../utils/batchStats'

// Status cell of a simulation row (batch page and saved batches).
export function RunStateBadge({ run, metrics }: { run: BatchRunResult | undefined; metrics: RunMetrics | null }) {
  if (!run) return <span className="batch-state">—</span>
  if (run.state === 'running') return <span className="batch-state batch-state-running"><LoaderCircle size={11} /> running</span>
  if (run.state === 'failed') return <span className="batch-state batch-state-bad" title={run.error ?? ''}><CircleX size={11} /> error</span>
  if (run.state === 'done') {
    return metrics?.valid
      ? <span className="batch-state batch-state-good"><CircleCheck size={11} /> valid</span>
      : <span className="batch-state batch-state-bad" title={run.response?.reason ?? ''}><CircleX size={11} /> {metrics?.status}</span>
  }
  return <span className="batch-state">{run.state}</span>
}

type Props = {
  runs: BatchRunResult[]
  budget: number
  /** open the details of simulation #index */
  onView?: (index: number) => void
}

// Statistics of a batch: key figures, approximation-ratio chart, circuits / QUBOs and per-parameter-set table.
export default function BatchStatistics({ runs, budget, onView }: Props) {
  const stats = computeStatistics(runs, budget)
  if (stats.finished === 0) return null
  const finishedMetrics = runs.filter((run) => run.state === 'done').map((run) => toMetrics(run, budget))

  return (
    <section className="panel batch-panel" aria-label="Batch statistics">
      <div className="builder-heading">
        <div>
          <div className="panel-title-row">
            <span className="panel-icon"><BarChart3 size={15} /></span>
            <h2>Statistics</h2>
          </div>
          <p>{stats.finished} completed simulation{stats.finished === 1 ? '' : 's'}{stats.failed ? `, ${stats.failed} failed` : ''}. Mean ± sample standard deviation.</p>
        </div>
      </div>
      <div className="batch-stat-grid">
        <div><span>Valid plans</span><strong>{pct(stats.successRate)}</strong></div>
        <div><span>Exact optimum found</span><strong>{pct(stats.optimumRate)}</strong></div>
        <div><span>Approximation ratio</span><strong>{meanStd(stats.approximationRatio, 3)}</strong></div>
        <div><span>Total value (valid)</span><strong>{meanStd(stats.totalValue, 2)}</strong></div>
        <div><span>Connected sample rate</span><strong>{meanStd(stats.connectedSampleRate, 1, true)}</strong></div>
        <div><span>Valid sample rate</span><strong>{meanStd(stats.validSampleRate, 1, true)}</strong></div>
        <div><span>Planner runtime</span><strong>{stats.serverSeconds.mean === null ? '—' : `${meanStd(stats.serverSeconds, 2)} s`}</strong></div>
        <div><span>Best plan</span><strong>{stats.best ? `#${stats.best.index} · ${fmt(stats.best.totalValue)}` : '—'}</strong></div>
      </div>

      <div className="batch-chart" aria-label="Approximation ratio per simulation">
        <div className="batch-chart-title">Approximation ratio per simulation <small>(best valid connected sample ÷ exact optimum)</small></div>
        <div className="batch-chart-bars">
          {finishedMetrics.map((m) => (
            <div key={m.index} className="batch-chart-col" title={`#${m.index}: ${m.configKey}, seed ${m.params.seed} — ratio ${fmt(m.approximationRatio, 3)}`}>
              <i className={m.valid ? 'batch-bar-good' : 'batch-bar-bad'} style={{ height: `${Math.max(2, Math.min(m.approximationRatio ?? 0, 1) * 100)}%` }} />
              <span>{m.index}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="batch-subheading"><Cpu size={13} /> Circuits and QUBOs of the batch</div>
      <div className="batch-table-wrap">
        <table className="batch-table batch-table-stats">
          <thead>
            <tr><th>#</th><th>Parameters</th><th>Qubits</th><th>Circuit depth</th><th>Two-qubit gates</th><th>Gates</th><th>QUBO linear / quadratic terms</th><th>QUBO energy range</th><th>Expected energy</th>{onView && <th />}</tr>
          </thead>
          <tbody>
            {runs.filter((run) => run.state === 'done').map((run) => {
              const q = run.response?.quantum
              const c = q?.circuit
              const gates = Object.entries(c?.gate_counts ?? {}).filter(([k]) => k !== 'barrier').map(([k, v]) => `${k} ${v}`).join(', ')
              return (
                <tr key={run.index}>
                  <td>{run.index}</td>
                  <td>p={run.params.p} · {run.params.slack ? 'slack' : 'no slack'}</td>
                  <td>{q?.qubits ?? '—'}{q?.slack_qubits ? ` (${q.slack_qubits} slack)` : ''}</td>
                  <td>{c?.depth ?? '—'}</td>
                  <td>{c?.two_qubit_gates ?? '—'}</td>
                  <td className="batch-cell-wrap">{c?.error ? c.error : gates || '—'}</td>
                  <td>{q?.qubo ? `${Object.keys(q.qubo.linear ?? {}).length} / ${Object.keys(q.qubo.quadratic ?? {}).length}` : '—'}</td>
                  <td>{q?.qubo?.energy_range ? `${fmt(q.qubo.energy_range[0], 2)} … ${fmt(q.qubo.energy_range[1], 2)}` : '—'}</td>
                  <td>{fmt(q?.expected_energy, 3)}</td>
                  {onView && (
                    <td>
                      <button type="button" className="batch-link" onClick={() => onView(run.index)}>view</button>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="batch-subheading"><BarChart3 size={13} /> Per parameter set</div>
      <div className="batch-table-wrap">
        <table className="batch-table batch-table-stats">
          <thead>
            <tr><th>Parameters</th><th>Runs</th><th>Valid</th><th>Optimum</th><th>Approx. ratio</th><th>Value (valid)</th><th>Connected rate</th><th>Runtime (s)</th></tr>
          </thead>
          <tbody>
            {stats.groups.map((g) => (
              <tr key={g.configKey}>
                <td>{g.configKey}</td>
                <td>{g.runs}</td>
                <td>{pct(g.successRate)}</td>
                <td>{pct(g.optimumRate)}</td>
                <td>{meanStd(g.approximationRatio, 3)}</td>
                <td>{meanStd(g.totalValue, 2)}</td>
                <td>{meanStd(g.connectedSampleRate, 1, true)}</td>
                <td>{meanStd(g.serverSeconds, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
