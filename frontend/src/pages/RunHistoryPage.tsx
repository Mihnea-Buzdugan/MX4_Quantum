import { History, Trash2 } from 'lucide-react'
import { useOutletContext } from 'react-router-dom'
import type { RunHistoryRecord, WorkspaceContext } from '../components/AppShell'

function formatDuration(durationMs: number) {
  return durationMs < 1000 ? `${durationMs.toFixed(1)} ms` : `${(durationMs / 1000).toFixed(2)} s`
}

function formatTimestamp(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp)
}

function formatSpeed(speed: RunHistoryRecord['speed']) {
  return speed === 'realtime' ? 'Realtime' : 'x0.5 Speed'
}

export default function RunHistoryPage() {
  const { runHistory, clearRunHistory } = useOutletContext<WorkspaceContext>()

  return (
    <div className="run-history-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">RAILWAY PLANNING <i /> SESSION LOG</span>
          <h1>Run History</h1>
          <p>Review completed algorithm runs from this session.</p>
        </div>
        <div className="heading-actions">
          <button
            type="button"
            className="button button-secondary"
            onClick={clearRunHistory}
            disabled={runHistory.length === 0}
          >
            <Trash2 size={14} /> Clear history
          </button>
        </div>
      </div>

      {runHistory.length === 0 ? (
        <section className="panel run-history-empty">
          <span className="panel-icon"><History size={17} /></span>
          <h2>No runs yet</h2>
          <p>Completed simulations will appear here with their route selections and results.</p>
        </section>
      ) : (
        <section className="panel run-history-panel" aria-label="Completed simulation runs">
          <div className="run-history-table-wrap">
            <table className="run-history-table">
              <thead>
                <tr>
                  <th scope="col">Timestamp</th>
                  <th scope="col">Algorithm</th>
                  <th scope="col">Speed</th>
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
                    <td>{formatSpeed(run.speed)}</td>
                    <td>{formatDuration(run.executionMs)}</td>
                    <td>
                      <span className={`run-plan-status ${run.planStatus}`}>
                        {run.planStatus === 'valid' ? 'Valid Plan' : 'Invalid Plan (Over Budget)'}
                      </span>
                    </td>
                    <td>{run.totalCost}</td>
                    <td>{run.totalReward}</td>
                    <td>
                      {run.selectedRoutes.length > 0
                        ? run.selectedRoutes.join(', ')
                        : 'None'}
                    </td>
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