import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, History, Layers, LoaderCircle, RotateCw, Route, Trash2 } from 'lucide-react'
import { Link, useOutletContext, useSearchParams } from 'react-router-dom'
import type { RunHistoryRecord, WorkspaceContext } from '../components/AppShell'
import {
  deleteBatch,
  deletePlan,
  listBatches,
  listPlans,
  type BatchSummary,
  type PlanSummary,
} from '../services/history'
import { isLoggedIn } from '../utils/auth'
import PlanStatusBadge from '../components/PlanStatusBadge'
import { fmt, meanStd, pct } from '../utils/batchStats'
import { describeParameters, formatDuration, formatTimestamp } from '../utils/historyFormat'

// Two-step delete button: first click arms it, second click deletes.
function DeleteButton({ onDelete, label }: { onDelete: () => Promise<void>; label: string }) {
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!armed) return undefined
    const timer = window.setTimeout(() => setArmed(false), 3000)
    return () => window.clearTimeout(timer)
  }, [armed])
  return (
    <button
      type="button"
      className={`history-action ${armed ? 'history-action-danger' : ''}`}
      disabled={busy}
      aria-label={armed ? `Confirm deleting ${label}` : `Delete ${label}`}
      onClick={async () => {
        if (!armed) {
          setArmed(true)
          return
        }
        setBusy(true)
        try {
          await onDelete()
        } finally {
          setBusy(false)
          setArmed(false)
        }
      }}
    >
      <Trash2 size={12} /> {armed ? 'Confirm' : 'Delete'}
    </button>
  )
}

type Tab = 'simulations' | 'batches'

export default function RunHistoryPage() {
  const { runHistory, clearRunHistory } = useOutletContext<WorkspaceContext>()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab: Tab = searchParams.get('tab') === 'batches' ? 'batches' : 'simulations'
  const loggedIn = isLoggedIn()
  const [plans, setPlans] = useState<PlanSummary[] | null>(null)
  const [batches, setBatches] = useState<BatchSummary[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!isLoggedIn()) return
    setLoading(true)
    setError(null)
    try {
      const [planRows, batchRows] = await Promise.all([listPlans('single'), listBatches()])
      setPlans(planRows)
      setBatches(batchRows)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the run history.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (!loggedIn) return <SessionHistory runHistory={runHistory} clearRunHistory={clearRunHistory} />

  return (
    <div className="run-history-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">RAILWAY PLANNING <i /> SAVED RUNS</span>
          <h1>Run History</h1>
          <p>Every simulation and batch you run is saved. Open one to see its network, intermediate values, circuit, QUBO and statistics again.</p>
        </div>
        <div className="heading-actions">
          <button type="button" className="button button-secondary" onClick={() => void load()} disabled={loading}>
            {loading ? <LoaderCircle size={14} /> : <RotateCw size={14} />} Refresh
          </button>
        </div>
      </div>

      <div className="history-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'simulations'} className={`history-tab ${tab === 'simulations' ? 'history-tab-active' : ''}`}
          onClick={() => setSearchParams({})}>
          <Route size={13} /> Simulations {plans ? <span>{plans.length}</span> : null}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'batches'} className={`history-tab ${tab === 'batches' ? 'history-tab-active' : ''}`}
          onClick={() => setSearchParams({ tab: 'batches' })}>
          <Layers size={13} /> Batches {batches ? <span>{batches.length}</span> : null}
        </button>
      </div>

      {error && <p className="simulation-error" role="alert">{error}</p>}

      {tab === 'simulations' ? (
        plans === null ? <LoadingPanel /> : plans.length === 0 ? (
          <EmptyPanel title="No saved simulations yet" text="Runs from the Classic, Simulated and Real Hardware workspaces appear here." />
        ) : (
          <section className="panel run-history-panel" aria-label="Saved simulations">
            <div className="run-history-table-wrap">
              <table className="run-history-table history-table">
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Date</th>
                    <th scope="col">Algorithm</th>
                    <th scope="col">Parameters</th>
                    <th scope="col">Network</th>
                    <th scope="col">Plan status</th>
                    <th scope="col">Cost / budget</th>
                    <th scope="col">Value</th>
                    <th scope="col">Time</th>
                    <th scope="col"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {plans.map((plan) => (
                    <tr key={plan.id}>
                      <td>{plan.id}</td>
                      <td>{formatTimestamp(plan.created_at)}</td>
                      <td>{plan.algorithm || '—'}</td>
                      <td>{describeParameters(plan.parameters)}</td>
                      <td>{plan.node_count ? `${plan.node_count} cities · ${plan.route_count} routes` : '—'}</td>
                      <td>
                        <PlanStatusBadge valid={plan.valid} status={plan.status} />
                        {!plan.valid && plan.reason && <small className="history-reason" title={plan.reason}>{plan.reason}</small>}
                      </td>
                      <td>{fmt(plan.total_cost)} / {fmt(plan.budget)}</td>
                      <td>{fmt(plan.total_value)}</td>
                      <td>{formatDuration(plan.execution_ms)}</td>
                      <td className="history-actions">
                        <Link className="history-action" to={`/run-history/plans/${plan.id}`}><ExternalLink size={12} /> Open</Link>
                        <DeleteButton label={`simulation ${plan.id}`} onDelete={async () => {
                          await deletePlan(plan.id)
                          setPlans((rows) => rows?.filter((row) => row.id !== plan.id) ?? rows)
                        }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )
      ) : batches === null ? <LoadingPanel /> : batches.length === 0 ? (
        <EmptyPanel title="No saved batches yet" text="Batches started from the Batch Simulations page appear here with all their runs and statistics." />
      ) : (
        <section className="panel run-history-panel" aria-label="Saved batches">
          <div className="run-history-table-wrap">
            <table className="run-history-table history-table">
              <thead>
                <tr>
                  <th scope="col">Batch</th>
                  <th scope="col">Date</th>
                  <th scope="col">Algorithm</th>
                  <th scope="col">Network</th>
                  <th scope="col">Simulations</th>
                  <th scope="col">Valid plans</th>
                  <th scope="col">Approx. ratio</th>
                  <th scope="col">Status</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => {
                  const ratio = batch.statistics?.approximationRatio
                  return (
                    <tr key={batch.id}>
                      <td>#{batch.id}{batch.name ? ` · ${batch.name}` : ''}</td>
                      <td>{formatTimestamp(batch.created_at)}</td>
                      <td>{batch.algorithm || '—'}</td>
                      <td>{batch.nodes.length} cities · budget {fmt(batch.budget)}</td>
                      <td>{batch.saved_runs ?? 0} / {batch.run_count} saved</td>
                      <td>{batch.saved_runs ? `${batch.valid_runs ?? 0} (${pct((batch.valid_runs ?? 0) / batch.saved_runs)})` : '—'}</td>
                      <td>{ratio && ratio.mean != null ? meanStd({ count: ratio.count ?? 0, min: null, max: null, median: null, mean: ratio.mean, std: ratio.std ?? null }, 3) : '—'}</td>
                      <td><span className={`run-plan-status ${batch.status === 'completed' ? 'valid' : 'invalid'}`}>{batch.status}</span></td>
                      <td className="history-actions">
                        <Link className="history-action" to={`/run-history/batches/${batch.id}`}><ExternalLink size={12} /> Open</Link>
                        <DeleteButton label={`batch ${batch.id}`} onDelete={async () => {
                          await deleteBatch(batch.id)
                          setBatches((rows) => rows?.filter((row) => row.id !== batch.id) ?? rows)
                        }} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

function LoadingPanel() {
  return (
    <section className="panel run-history-empty">
      <span className="panel-icon"><LoaderCircle size={17} /></span>
      <h2>Loading…</h2>
    </section>
  )
}

function EmptyPanel({ title, text }: { title: string; text: string }) {
  return (
    <section className="panel run-history-empty">
      <span className="panel-icon"><History size={17} /></span>
      <h2>{title}</h2>
      <p>{text}</p>
    </section>
  )
}

// Not signed in: nothing is saved, so show this browser session's runs (the previous behaviour).
function SessionHistory({ runHistory, clearRunHistory }: { runHistory: RunHistoryRecord[]; clearRunHistory: () => void }) {
  return (
    <div className="run-history-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">RAILWAY PLANNING <i /> SESSION LOG</span>
          <h1>Run History</h1>
          <p>Runs from this session only. <Link to="/login">Sign in</Link> to save every simulation and batch and reopen them later.</p>
        </div>
        <div className="heading-actions">
          <button type="button" className="button button-secondary" onClick={clearRunHistory} disabled={runHistory.length === 0}>
            <Trash2 size={14} /> Clear history
          </button>
        </div>
      </div>

      {runHistory.length === 0 ? (
        <EmptyPanel title="No runs yet" text="Completed simulations will appear here with their route selections and results." />
      ) : (
        <section className="panel run-history-panel" aria-label="Completed simulation runs">
          <div className="run-history-table-wrap">
            <table className="run-history-table">
              <thead>
                <tr>
                  <th scope="col">Timestamp</th>
                  <th scope="col">Algorithm</th>
                  <th scope="col">Execution time</th>
                  <th scope="col">Plan status</th>
                  <th scope="col">Total cost</th>
                  <th scope="col">Total reward</th>
                  <th scope="col">Selected routes</th>
                </tr>
              </thead>
              <tbody>
                {runHistory.map((run, index) => (
                  <tr key={`${run.timestamp}-${run.algorithm}-${index}`}>
                    <td>{formatTimestamp(run.timestamp)}</td>
                    <td>{run.algorithm}</td>
                    <td>{formatDuration(run.executionMs)}</td>
                    <td><span className={`run-plan-status ${run.planStatus}`}>{run.planStatus === 'valid' ? 'Valid Plan' : 'Invalid Plan'}</span></td>
                    <td>{run.totalCost}</td>
                    <td>{run.totalReward}</td>
                    <td>{run.selectedRoutes.length > 0 ? run.selectedRoutes.join(', ') : 'None'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
