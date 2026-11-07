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
