import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  BarChart3,
  ChevronDown,
  ChevronRight,
  Construction,
  ExternalLink,
  FileDown,
  Layers,
  LoaderCircle,
  Network,
  Route,
  Timer,
} from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import BatchStatistics, { RunStateBadge } from '../components/BatchStatistics'
import NetworkDiagram from '../components/NetworkDiagram'
import RunDetails from '../components/RunDetails'
import { routes } from '../data/routes'
import { deleteBatch, getBatch, paramsOf, savedRunResult, type BatchDetail } from '../services/history'
import { computeStatistics, fmt, pct, toMetrics, type BatchRunResult } from '../utils/batchStats'
import { describeEncoding } from '../services/railwayPlanner'
import { formatDuration, formatTimestamp } from '../utils/historyFormat'

// A saved batch, reopened from the run history: every run with its details, the statistics and the PDF.
export default function BatchHistoryPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [batch, setBatch] = useState<BatchDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set())
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setBatch(null)
    setError(null)
    getBatch(Number(id))
      .then((data) => { if (!cancelled) setBatch(data) })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load this batch.') })
    return () => { cancelled = true }
  }, [id])

  // One row per planned simulation; runs that never reached the planner (stopped batch) show as skipped.
  const runs: BatchRunResult[] = useMemo(() => {
    if (!batch) return []
    const byIndex = new Map(batch.plans.map((plan) => [plan.batch_index ?? 0, plan]))
    const count = Math.max(batch.runs.length, ...batch.plans.map((plan) => plan.batch_index ?? 0))
    return Array.from({ length: count }, (_, k) => {
      const plan = byIndex.get(k + 1)
      const params = batch.runs[k] ?? paramsOf(plan?.parameters ?? {})
      return savedRunResult(k + 1, params, plan)
    })
  }, [batch])
  const stats = useMemo(() => computeStatistics(runs, batch?.budget ?? 0), [runs, batch])
  const planIdOf = useMemo(
    () => new Map((batch?.plans ?? []).map((plan) => [plan.batch_index ?? 0, plan.id])),
    [batch],
  )

  function toggle(index: number) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  async function downloadPdf() {
    if (!batch) return
    setPdfBusy(true)
    setPdfError(null)
    try {
      const { buildBatchReport } = await import('../utils/batchReport')
      const doc = await buildBatchReport(
        {
          algorithm: batch.algorithm,
          budget: batch.budget,
          nodes: batch.nodes,
          routes: batch.routes.map((route) => `${route.from} → ${route.to} (cost ${route.cost}, value ${route.value})`),
          startedAt: new Date(batch.created_at).getTime(),
          finishedAt: batch.finished_at ? new Date(batch.finished_at).getTime() : null,
        },
        runs,
        stats,
      )
      doc.save(`batch-${batch.id}-${batch.created_at.slice(0, 10)}.pdf`)
    } catch (err) {
      setPdfError(err instanceof Error ? `Could not create the PDF: ${err.message}` : 'Could not create the PDF.')
    } finally {
      setPdfBusy(false)
    }
  }

  if (error || !batch) {
    return (
      <div className="run-history-page">
        <BackLink />
        {error
          ? <p className="simulation-error" role="alert">{error}</p>
          : <section className="panel run-history-empty"><span className="panel-icon"><LoaderCircle size={17} /></span><h2>Loading…</h2></section>}
      </div>
    )
  }

  const best = stats.best ? batch.plans.find((plan) => plan.batch_index === stats.best?.index) : undefined
  const candidateIds = batch.routes.map((route) => route.id).filter((routeId) => routes.some((r) => r.id === routeId))
  const totalMs = batch.finished_at ? new Date(batch.finished_at).getTime() - new Date(batch.created_at).getTime() : null

  return (
    <div className="dashboard-page construction-page algorithm-page batch-page history-detail-page">
      <BackLink />
      <div className="page-heading">
        <div>
          <span className="eyebrow">RUN HISTORY <i /> SAVED BATCH</span>
          <h1>Batch #{batch.id}{batch.name ? ` · ${batch.name}` : ''}</h1>
          <p>{batch.algorithm || 'Railway planner'} · {formatTimestamp(batch.created_at)} · {batch.status}</p>
        </div>
        <div className="heading-actions">
          <button type="button" className="button button-primary" disabled={pdfBusy || stats.finished + stats.failed === 0} onClick={() => void downloadPdf()}>
            {pdfBusy ? <LoaderCircle size={14} /> : <FileDown size={14} />} Download PDF
          </button>
          <button type="button" className="button button-secondary" onClick={async () => {
            await deleteBatch(batch.id)
            navigate('/run-history?tab=batches')
          }}>Delete batch</button>
        </div>
      </div>
      {pdfError && <p className="simulation-error" role="alert">{pdfError}</p>}

      <section className="construction-scoreboard batch-scoreboard" aria-label="Batch summary">
        <article className="panel score-card">
          <div className="score-card-label"><span className="panel-icon"><Route size={15} /></span><span>Budget</span></div>
          <strong>{fmt(batch.budget)}</strong>
          <small>{batch.nodes.length} cities · {batch.routes.length} candidate routes</small>
        </article>
        <article className="panel score-card">
          <div className="score-card-label"><span className="panel-icon"><BarChart3 size={15} /></span><span>Simulations</span></div>
          <strong>{batch.plans.length}<small> / {runs.length}</small></strong>
          <small>{stats.failed ? `${stats.failed} failed · ` : ''}{runs.filter((run) => run.state === 'skipped').length ? `${runs.filter((run) => run.state === 'skipped').length} not run` : 'all saved'}</small>
        </article>
        <article className="panel score-card">
          <div className="score-card-label"><span className="panel-icon"><Construction size={15} /></span><span>Valid plans</span></div>
          <strong>{pct(stats.successRate)}</strong>
          <small>Exact optimum in {pct(stats.optimumRate)}</small>
        </article>
        <article className="panel score-card">
          <div className="score-card-label"><span className="panel-icon"><Timer size={15} /></span><span>Duration</span></div>
          <strong>{formatDuration(totalMs)}</strong>
          <small>{batch.finished_at ? `finished ${formatTimestamp(batch.finished_at)}` : 'not finished'}</small>
        </article>
      </section>

      <section className="panel network-panel construction-network history-network">
        <div className="panel-heading">
          <div>
            <div className="panel-title-row">
              <span className="panel-icon"><Network size={15} /></span>
              <h2>Network{best ? ` · best plan (simulation #${best.batch_index})` : ''}</h2>
            </div>
            <p>{batch.nodes.join(', ')}</p>
          </div>
        </div>
        <NetworkDiagram
          builtRouteIds={(best?.graph?.edges ?? []).map((edge) => edge.id)}
          configuredRouteIds={candidateIds}
          routeStages={Object.fromEntries((best?.graph?.edges ?? []).map((edge) => [String(edge.id), edge.stage]))}
          selectedNodes={batch.nodes}
        />
      </section>

      <section className="panel batch-panel" aria-label="Saved simulations">
        <div className="builder-heading">
          <div>
            <div className="panel-title-row">
              <span className="panel-icon"><Layers size={15} /></span>
              <h2>Simulations</h2>
            </div>
            <p>Open a row to see its intermediate values, circuit and QUBO.</p>
          </div>
          <div className="batch-toolbar">
            <button type="button" className="button button-secondary"
              onClick={() => setExpanded((current) => (current.size > 0 ? new Set() : new Set(runs.filter((run) => run.state === 'done' || run.state === 'failed').map((run) => run.index))))}>
              {expanded.size > 0 ? <><ChevronDown size={13} /> Collapse all</> : <><ChevronRight size={13} /> Expand all details</>}
            </button>
          </div>
        </div>
        <div className="batch-table-wrap">
          <table className="batch-table">
            <thead>
              <tr>
                <th aria-label="Details" /><th>#</th><th>p</th><th>Budget encoding</th><th>COBYLA iterations</th><th>Shots</th><th>Seed</th>
                <th>Status</th><th>Cost</th><th>Value</th><th>Ratio</th><th>Connected</th><th>Time</th><th />
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const m = run.state === 'done' ? toMetrics(run, batch.budget) : null
                const isOpen = expanded.has(run.index)
                const hasDetails = run.state === 'done' || run.state === 'failed'
                const planId = planIdOf.get(run.index)
                return (
                  <Fragment key={run.index}>
                    <tr className={isOpen ? 'batch-row-open' : ''}>
                      <td>
                        <button type="button" className="batch-expand" disabled={!hasDetails} aria-expanded={isOpen}
                          aria-label={`${isOpen ? 'Hide' : 'Show'} details of simulation ${run.index}`} onClick={() => toggle(run.index)}>
                          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                      </td>
                      <td>{run.index}</td>
                      <td>{run.params.p}</td>
                      <td>{describeEncoding(run.params)}</td>
                      <td>{run.params.iterations}</td>
                      <td>{run.params.shots}</td>
                      <td>{run.params.seed}</td>
                      <td><RunStateBadge run={run} metrics={m} /></td>
                      <td>{fmt(m?.totalCost)}</td>
                      <td>{fmt(m?.totalValue)}</td>
                      <td>{fmt(m?.approximationRatio, 3)}</td>
                      <td>{pct(m?.connectedSampleRate)}</td>
                      <td>{formatDuration(run.requestMs)}</td>
                      <td>{planId ? <Link className="batch-link" to={`/run-history/plans/${planId}`} title="Open as a full page"><ExternalLink size={12} /></Link> : null}</td>
                    </tr>
                    {isOpen && (
                      <tr className="batch-detail-row">
                        <td colSpan={14}>
                          <div className="batch-detail">
                            <div className="batch-detail-title">
                              Simulation #{run.index} · p = {run.params.p} · {describeEncoding(run.params)} · {run.params.iterations} COBYLA iterations · {run.params.shots} shots · seed {run.params.seed}
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
      </section>

      <BatchStatistics runs={runs} budget={batch.budget} onView={(index) => setExpanded((current) => new Set(current).add(index))} />
    </div>
  )
}

function BackLink() {
  return (
    <Link className="history-back" to="/run-history?tab=batches"><ArrowLeft size={13} /> Back to run history</Link>
  )
}
