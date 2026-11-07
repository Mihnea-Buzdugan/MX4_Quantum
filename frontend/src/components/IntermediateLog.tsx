import { Activity } from 'lucide-react'

export type IntermediateLogEntry = {
  label: string
  message: string
}

type Props = {
  entries: IntermediateLogEntry[]
  status: string
  remainingBudget: number | null
}

export default function IntermediateLog({ entries, status, remainingBudget }: Props) {
  return (
    <section className="panel intermediate-log" aria-label="Simulation intermediate data">
      <div className="intermediate-log-heading">
        <div>
          <div className="panel-title-row">
            <span className="panel-icon"><Activity size={15} /></span>
            <h2>Intermediate data</h2>
          </div>
          <p>Backend QAOA diagnostics, conflict handling, and network completion.</p>
        </div>
        <span className="intermediate-node">
          {status}
        </span>
      </div>
      <div className="intermediate-budget">
        <span>REMAINING BUDGET</span>
        <strong>{remainingBudget === null ? '—' : remainingBudget}</strong>
      </div>
      <div className="intermediate-log-list" aria-live="polite" aria-relevant="additions">
        {entries.length === 0 ? (
          <p className="intermediate-log-empty">Start a simulation to see the planner response and its diagnostics.</p>
        ) : entries.map((entry, index) => (
          <div className="intermediate-log-entry" key={`${index}-${entry.label}-${entry.message}`}>
            <span>{String(index + 1).padStart(2, '0')}</span>
            <strong>{entry.label}</strong>
            <p>{entry.message}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
