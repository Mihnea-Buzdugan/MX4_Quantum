import { STATUS_LABEL } from '../utils/historyFormat'

export default function PlanStatusBadge({ valid, status }: { valid: boolean; status: string }) {
  return (
    <span className={`run-plan-status ${valid ? 'valid' : 'invalid'}`}>
      {valid ? 'Valid Plan' : STATUS_LABEL[status] ?? status}
    </span>
  )
}
