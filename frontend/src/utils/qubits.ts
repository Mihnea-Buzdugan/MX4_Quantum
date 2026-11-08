function greatestCommonDivisor(a: number, b: number): number {
  return b === 0 ? a : greatestCommonDivisor(b, a % b)
}

// Same count as the planner (qaoa_only mode): one qubit per route, plus the slack qubits
// 1, 2, 4, ..., remainder that encode every budget value 0..B in integer cost units.
export function estimateQubits(costs: number[], budget: number, slack: boolean) {
  const routeQubits = costs.length
  if (!slack || !Number.isFinite(budget) || budget < 0) return { routeQubits, slackQubits: 0 }
  let unit = 1
  for (const cost of costs) {
    const hundredths = Math.round(cost * 100)
    const denominator = 100 / greatestCommonDivisor(hundredths, 100)
    unit = unit * denominator / greatestCommonDivisor(unit, denominator)
  }
  const bound = Math.floor(budget * unit + 1e-9)
  let slackQubits = 0
  let sum = 0
  for (let k = 1; sum + k <= bound; k *= 2) {
    sum += k
    slackQubits += 1
  }
  if (sum < bound) slackQubits += 1
  return { routeQubits, slackQubits }
}

// Hybrid mode (run_quantum_stage in the planner): QAOA only sees the routes that fit in
// quantum_fraction × budget, always with slack qubits for that quantum budget, and keeps the best
// value-per-cost routes when there are more than max_qubits − slack. It is never blocked by the
// route count; it only fails when the slack encoding alone needs max_qubits or more.
export function estimateHybridQubits(costs: number[], budget: number, fraction: number, maxQubits: number) {
  const quantumBudget = fraction * budget
  const fitting = Number.isFinite(quantumBudget) ? costs.filter((cost) => cost <= quantumBudget + 1e-9) : costs
  const { slackQubits } = estimateQubits(fitting.length ? fitting : [0], quantumBudget, true)
  const room = maxQubits - slackQubits
  const routeQubits = Math.max(0, Math.min(fitting.length, room))
  return {
    routeQubits,
    slackQubits,
    candidateRoutes: fitting.length,
    trimmed: fitting.length > routeQubits && room >= 1,
    impossible: room < 1,
  }
}
