import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Construction, Layers, LoaderCircle, Network, Route, Target, Timer } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import NetworkDiagram from '../components/NetworkDiagram'
import PlanStatusBadge from '../components/PlanStatusBadge'
import RunDetails from '../components/RunDetails'
import { deletePlan, getPlan, type SavedPlan } from '../services/history'
import { toRouteId } from '../services/railwayPlanner'
import type { RailwayPlanResponse } from '../services/railwayPlannerTypes'
import { fmt } from '../utils/batchStats'
import { describeParameters, formatDuration, formatTimestamp } from '../utils/historyFormat'

// A saved single run, reopened from the run history: same map, intermediate values and quantum details.
export default function PlanHistoryPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [plan, setPlan] = useState<SavedPlan | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setPlan(null)
    setError(null)
    getPlan(Number(id))
      .then((data) => { if (!cancelled) setPlan(data) })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load this run.') })
    return () => { cancelled = true }
  }, [id])

  const edges = useMemo(() => plan?.graph?.edges ?? [], [plan])
  const nodes = useMemo(
    () => (plan?.request ? Object.keys(plan.request.nodes) : (plan?.graph?.nodes ?? []).map((node) => node.name)),
    [plan],
  )
  const candidateIds = useMemo(
    () => (plan?.request?.paths ?? []).map((path) => String(toRouteId(path.id))),
    [plan],
  )
  const stages = Object.fromEntries(edges.map((edge) => [String(edge.id), edge.stage]))

  if (error) {
    return (
      <div className="run-history-page">
        <BackLink />
        <p className="simulation-error" role="alert">{error}</p>
      </div>
    )
  }
  if (!plan) {
    return (
      <div className="run-history-page">
        <BackLink />
        <section className="panel run-history-empty"><span className="panel-icon"><LoaderCircle size={17} /></span><h2>Loading…</h2></section>
      </div>
    )
  }

  const inBatch = plan.batch_id !== null
  return (
    <div className="dashboard-page construction-page algorithm-page history-detail-page">
      <BackLink batchId={plan.batch_id} />
      <div className="page-heading">
        <div>
          <span className="eyebrow">RUN HISTORY <i /> {inBatch ? `BATCH #${plan.batch_id} · SIMULATION ${plan.batch_index}` : 'SAVED SIMULATION'}</span>
          <h1>Simulation #{plan.id}</h1>
          <p>{plan.algorithm || 'Railway planner'} · {formatTimestamp(plan.created_at)} · {describeParameters(plan.parameters)}</p>
        </div>
        <div className="heading-actions">
          {inBatch && (
            <Link className="button button-secondary" to={`/run-history/batches/${plan.batch_id}`}><Layers size={14} /> Open batch</Link>
          )}
          <button type="button" className="button button-secondary" onClick={async () => {
            await deletePlan(plan.id)
            navigate(inBatch ? `/run-history/batches/${plan.batch_id}` : '/run-history')
          }}>Delete</button>
        </div>
      </div>

      <section className="construction-scoreboard" aria-label="Saved run summary">
        <article className="panel score-card">
          <div className="score-card-label"><span className="panel-icon"><Construction size={15} /></span><span>Budget</span></div>
          <strong>{fmt(plan.budget)}</strong>
          <small>{nodes.length} cities · {candidateIds.length || '—'} candidate routes</small>
        </article>
        <article className="panel score-card">
          <div className="score-card-label"><span className="panel-icon"><Timer size={15} /></span><span>Time taken</span></div>
          <strong>{formatDuration(plan.execution_ms)}</strong>
          <small>{plan.runtime_seconds != null ? `planner ${fmt(plan.runtime_seconds, 2)} s` : 'End-to-end request time'}</small>
        </article>
        <article className="panel score-card">
          <div className="score-card-label"><span className="panel-icon"><Route size={15} /></span><span>Total construction cost</span></div>
          <strong>{fmt(plan.total_cost)}<small> / {fmt(plan.budget)}</small></strong>
          <small>{plan.remaining_budget != null ? `${fmt(plan.remaining_budget)} budget units remaining` : '—'}</small>
        </article>
        <article className="panel score-card">
          <div className="score-card-label"><span className="panel-icon score-icon-violet"><Target size={15} /></span><span>Total reward (score)</span></div>
          <strong>{fmt(plan.total_value)}</strong>
          <small>{plan.quantum?.exact_optimum_value != null ? `optimum ${fmt(plan.quantum.exact_optimum_value)}` : 'Reward of the returned network'}</small>
        </article>
        <article className={`panel plan-status ${plan.valid ? 'plan-status-valid' : 'plan-status-invalid'}`}>
          <div>
            <PlanStatusBadge valid={plan.valid} status={plan.status} />
            <span>{plan.valid ? 'Connected network within budget.' : plan.reason ?? 'No valid connected network.'}</span>
          </div>
        </article>
      </section>

      <section className="panel network-panel construction-network history-network">
        <div className="panel-heading">
          <div>
            <div className="panel-title-row">
              <span className="panel-icon"><Network size={15} /></span>
              <h2>Returned network</h2>
              <span className="live-tag"><i /> {edges.length} BUILT</span>
            </div>
            <p>Highlighted routes were built; the other lines are the candidate routes that were sent.</p>
          </div>
        </div>
        <NetworkDiagram
          builtRouteIds={edges.map((edge) => edge.id)}
          configuredRouteIds={edges.length ? edges.map((edge) => String(edge.id)) : candidateIds}
          routeStages={stages}
          selectedNodes={nodes}
        />
      </section>

      <RunDetails
        response={plan.status === 'error' ? null : (plan as unknown as RailwayPlanResponse)}
        error={plan.status === 'error' ? plan.reason ?? 'The run failed.' : null}
        valid={plan.valid}
      />
    </div>
  )
}

function BackLink({ batchId }: { batchId?: number | null }) {
  return (
    <Link className="history-back" to={batchId ? `/run-history/batches/${batchId}` : '/run-history'}>
      <ArrowLeft size={13} /> {batchId ? `Back to batch #${batchId}` : 'Back to run history'}
    </Link>
  )
}
