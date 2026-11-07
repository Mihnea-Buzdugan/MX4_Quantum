import type { RailRoute } from '../data/routes'

export type SimulationDecision = {
  currentNode: string
  remainingBudget: number
  message: string
  routeId?: string
  selectedRouteIds: string[]
  totalCost: number
  totalReward: number
}

export type SimulationPlan = {
  routeIds: string[]
  totalCost: number
  totalReward: number
  calculationMs: number
}

function getNextStopIndex(currentNode: string, stops: string[], nextStopIndex: number) {
  if (stops.slice(nextStopIndex + 1).includes(currentNode)) return null
  return currentNode === stops[nextStopIndex] ? nextStopIndex + 1 : nextStopIndex
}

export function hasAffordableRoute(
  availableRoutes: RailRoute[],
  stops: string[],
  budget: number,
): boolean {
  if (stops.length < 2) return false

  function visit(
    currentNode: string,
    nextStopIndex: number,
    visitedNodes: Set<string>,
    spent: number,
  ): boolean {
    const updatedStopIndex = getNextStopIndex(currentNode, stops, nextStopIndex)
    if (updatedStopIndex === null || spent > budget) return false
    if (updatedStopIndex === stops.length) return true
    if (currentNode === stops[stops.length - 1]) return false

    return availableRoutes.some((route) => {
      const nextNode = route.from === currentNode
        ? route.to
        : route.to === currentNode
          ? route.from
          : null
      if (!nextNode || visitedNodes.has(nextNode)) return false
      const nextStopPosition = stops.indexOf(nextNode)
      if (nextStopPosition > updatedStopIndex) return false

      const nextVisitedNodes = new Set(visitedNodes)
      nextVisitedNodes.add(nextNode)
      return visit(nextNode, updatedStopIndex, nextVisitedNodes, spent + route.constructionCost)
    })
  }

  return visit(stops[0], 1, new Set([stops[0]]), 0)
}

export async function findBestRoutePlan(
  availableRoutes: RailRoute[],
  stops: string[],
  budget: number,
  delayMs: number,
  onDecision: (decision: SimulationDecision) => void,
): Promise<SimulationPlan | null> {
  const bestPlan: { current: SimulationPlan | null } = { current: null }
  let calculationMs = 0

  async function visit(
    currentNode: string,
    nextStopIndex: number,
    visitedNodes: Set<string>,
    selectedRoutes: RailRoute[],
    spent: number,
    reward: number,
  ): Promise<void> {
    const startedAt = performance.now()
    const updatedStopIndex = getNextStopIndex(currentNode, stops, nextStopIndex)
    onDecision({
      currentNode,
      remainingBudget: Math.max(0, budget - spent),
      message: updatedStopIndex === null
        ? `${currentNode} is out of waypoint order; reject this branch.`
        : `Evaluate ${currentNode} with ${Math.max(0, budget - spent)} budget units remaining.`,
      selectedRouteIds: selectedRoutes.map((route) => route.id),
      totalCost: spent,
      totalReward: reward,
    })
    calculationMs += performance.now() - startedAt
    await new Promise<void>((resolve) => window.setTimeout(resolve, delayMs))

    if (updatedStopIndex === null || spent > budget) return
    if (updatedStopIndex === stops.length) {
      if (
        !bestPlan.current
        || reward > bestPlan.current.totalReward
        || (reward === bestPlan.current.totalReward && spent < bestPlan.current.totalCost)
      ) {
        bestPlan.current = {
          routeIds: selectedRoutes.map((route) => route.id),
          totalCost: spent,
          totalReward: reward,
          calculationMs,
        }
        onDecision({
          currentNode,
          remainingBudget: Math.max(0, budget - spent),
          message: `New best plan reaches ${currentNode}: reward ${reward}, total cost ${spent}.`,
          selectedRouteIds: selectedRoutes.map((route) => route.id),
          totalCost: spent,
          totalReward: reward,
        })
      }
      return
    }
    if (currentNode === stops[stops.length - 1]) return

    const candidateRoutes = availableRoutes
      .filter((route) => route.from === currentNode || route.to === currentNode)
      .sort((left, right) => (
        right.value / Math.max(right.constructionCost, 0.01)
        - left.value / Math.max(left.constructionCost, 0.01)
      ))

    for (const route of candidateRoutes) {
      const nextNode = route.from === currentNode ? route.to : route.from
      const routeCost = route.constructionCost
      const nextStopPosition = stops.indexOf(nextNode)
      const routeStartedAt = performance.now()
      let rejection: string | null = null

      if (visitedNodes.has(nextNode)) rejection = `${nextNode} was already visited.`
      else if (nextStopPosition > updatedStopIndex) rejection = `${nextNode} is a later waypoint; visit stops in order.`
      else if (spent + routeCost > budget) rejection = `Skip ${currentNode} → ${nextNode}; it exceeds the remaining budget.`

      onDecision({
        currentNode,
        remainingBudget: Math.max(0, budget - spent),
        message: rejection ?? `Evaluate ${currentNode} → ${nextNode} (cost ${routeCost}, reward +${route.value}).`,
        routeId: route.id,
        selectedRouteIds: selectedRoutes.map((selectedRoute) => selectedRoute.id),
        totalCost: spent,
        totalReward: reward,
      })
      calculationMs += performance.now() - routeStartedAt
      await new Promise<void>((resolve) => window.setTimeout(resolve, delayMs))
      if (rejection) continue

      const nextVisitedNodes = new Set(visitedNodes)
      nextVisitedNodes.add(nextNode)
      await visit(
        nextNode,
        updatedStopIndex,
        nextVisitedNodes,
        [...selectedRoutes, route],
        spent + routeCost,
        reward + route.value,
      )
    }
  }

  await visit(stops[0], 1, new Set([stops[0]]), [], 0, 0)
  return bestPlan.current ? { ...bestPlan.current, calculationMs } : null
}
