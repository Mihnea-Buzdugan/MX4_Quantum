import IntermediateLog from './IntermediateLog'
import QuantumDetails from './Quantumdetails'
import type { RailwayPlanResponse } from '../services/railwayPlannerTypes'
import { makeResponseEntries, routeName } from '../utils/planLog'

type Props = {
  response: RailwayPlanResponse | null | undefined
  /** shown instead of the details when the run failed */
  error?: string | null
  valid?: boolean
}

// Intermediate values + the quantum details panel (circuit, QUBO, Ising, angles, ...) of one run.
// Used for batch simulations and for runs reopened from the run history.
export default function RunDetails({ response, error, valid }: Props) {
  if (error) return <p className="simulation-error" role="alert">{error}</p>
  if (!response) return null
  return (
    <>
      <IntermediateLog
        entries={makeResponseEntries(response)}
        status={valid ? 'valid' : response.status}
        remainingBudget={response.remaining_budget ?? null}
      />
      <QuantumDetails stats={response.quantum} conflicts={response.conflicts} routeName={routeName} />
    </>
  )
}
