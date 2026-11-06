import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowDownRight, ArrowUpRight, CircleCheck, CircleX, Construction, Network, Route, Target } from 'lucide-react'
import NetworkDiagram from '../components/NetworkDiagram'
import { cities, destinationGoals, modelEvaluations, routes, startingBudget } from '../data/routes'

export default function DashboardPage() {
  const [builtRouteIds, setBuiltRouteIds] = useState<string[]>([])
  const selectedRoutes = useMemo(
    () => routes.filter((route) => builtRouteIds.includes(route.id)),
    [builtRouteIds],
  )
  const totalCost = selectedRoutes.reduce((sum, route) => sum + route.constructionCost, 0)
  const totalScore = selectedRoutes.reduce((sum, route) => sum + route.value, 0)
  const isValidPlan = totalCost <= startingBudget
  const remainingBudget = startingBudget - totalCost

  function toggleRoute(routeId: string) {
    setBuiltRouteIds((current) => current.includes(routeId)
      ? current.filter((id) => id !== routeId)
      : [...current, routeId])
  }

  return (
    <div className="dashboard-page construction-page">
      <motion.div className="page-heading" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <div>
          <span className="eyebrow">RAILWAY PLANNING <i /> CONSTRUCTION MODE</span>
          <h1>Build the network</h1>
          <p>Choose connections to build. Keep the construction plan within your budget.</p>
        </div>
        <div className="heading-actions"><a href="#route-builder" className="button button-primary"><Construction size={15} /> Edit construction plan</a></div>
      </motion.div>

      <section className="construction-scoreboard" aria-label="Construction plan summary">
        <article className="panel score-card score-card-budget">
          <div className="score-card-label"><span className="panel-icon"><Construction size={15} /></span><span>Starting budget</span></div>
          <strong>{startingBudget}</strong>
          <small>Construction budget units</small>
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
          <small>Railway value from built connections</small>
        </article>
        <article className={`panel plan-status ${isValidPlan ? 'plan-status-valid' : 'plan-status-invalid'}`} role="status" aria-live="polite">
          {isValidPlan ? <CircleCheck size={19} /> : <CircleX size={19} />}
          <div><strong>{isValidPlan ? 'Valid Plan' : 'Invalid Plan - Over Budget'}</strong><span>{isValidPlan ? 'Construction cost is within budget.' : `Plan exceeds budget by ${totalCost - startingBudget}.`}</span></div>
        </article>
      </section>

      <div className="construction-workspace">
        <section className="panel network-panel construction-network">
          <div className="panel-heading">
            <div><div className="panel-title-row"><span className="panel-icon"><Network size={15} /></span><h2>Railway construction map</h2><span className="live-tag"><i /> {selectedRoutes.length} BUILT</span></div><p>Toggle a route to add or remove a railway connection.</p></div>
          </div>
          <NetworkDiagram builtRouteIds={builtRouteIds} />
          <div className="network-panel-footer"><span><b>{cities.length.toString().padStart(2, '0')}</b> cities</span><i /><span><b>{routes.length.toString().padStart(2, '0')}</b> possible connections</span><i /><span><b>{selectedRoutes.length.toString().padStart(2, '0')}</b> selected</span></div>
        </section>

        <section className="panel route-builder-panel" id="route-builder">
          <div className="builder-heading">
            <div><div className="panel-title-row"><span className="panel-icon"><Construction size={15} /></span><h2>Available routes</h2></div><p>Select the connections you want to build.</p></div>
            <span className="builder-count">{selectedRoutes.length} / {routes.length}</span>
          </div>
          <div className="route-list" role="group" aria-label="Railway connections to build">
            {routes.map((route, index) => {
              const isBuilt = builtRouteIds.includes(route.id)
              return (
                <label key={route.id} className={`construction-route ${isBuilt ? 'construction-route-built' : ''}`}>
                  <input
                    type="checkbox"
                    checked={isBuilt}
                    onChange={() => toggleRoute(route.id)}
                    aria-label={`Build ${route.from} to ${route.to}`}
                  />
                  <span className="route-toggle" aria-hidden="true"><i /></span>
                  <span className="route-index">{String(index + 1).padStart(2, '0')}</span>
                  <span className="route-endpoints"><strong>{route.from}</strong><ArrowDownRight size={12} /><strong>{route.to}</strong></span>
                  <span className="route-construction-cost"><small>BUILD COST</small><strong>{route.constructionCost}</strong></span>
                  <span className="route-value"><small>VALUE</small><strong>+{route.value}</strong></span>
                </label>
              )
            })}
          </div>
          <div className="route-list-footer"><span>All costs are infrastructure construction costs.</span><button type="button" className="clear-plan-button" onClick={() => setBuiltRouteIds([])} disabled={builtRouteIds.length === 0}>Clear plan</button></div>
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
              {modelEvaluations.map((evaluation) => <tr key={evaluation.plan} className={evaluation.label ? `model-row-${evaluation.label.toLowerCase().replaceAll(' ', '-')}` : ''}>
                <td><code>{evaluation.plan}</code></td>
                <td className="model-energy">{evaluation.energy}</td>
                <td>{evaluation.constructionCost ?? '—'}{evaluation.budgetStatus && <small className={evaluation.budgetStatus === 'Matches Budget' ? 'model-budget-match' : 'model-budget-over'}> ({evaluation.budgetStatus})</small>}</td>
                <td>{evaluation.score ?? '—'}</td>
                <td>{evaluation.label ? <span className={`evaluation-badge ${evaluation.label === 'Best Valid Plan' ? 'evaluation-valid' : 'evaluation-over'}`}>{evaluation.label}</span> : <span className="evaluation-dash">—</span>}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
        <div className="model-demo-note"><ArrowUpRight size={14} /><span>The lowest model energy belongs to an over-budget plan. This illustrates how a weak budget penalty can favor a higher-scoring but invalid plan.</span></div>
      </section>

      <div className="demo-disclaimer"><span className="disclaimer-dot" /> Construction costs, route values, goals, and model evaluation values are the supplied static planning data.</div>
    </div>
  )
}
