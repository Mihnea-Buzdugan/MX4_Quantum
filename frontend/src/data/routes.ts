export type RailCity = {
  name: string
  shortName: string
  x: number
  y: number
  lon: number
  lat: number
}

export type RailRoute = {
  id: string
  from: string
  to: string
  constructionCost: number
  value: number
}

export type DestinationGoal = {
  from: string
  to: string
  reward: number
}

export const startingBudget = 7

export const cities: RailCity[] = [
  { name: 'Iași', shortName: 'IAS', x: 587, y: 140, lon: 27.6, lat: 47.16667 },
  { name: 'București', shortName: 'BUC', x: 482, y: 345, lon: 26.10626, lat: 44.43225 },
  { name: 'Cluj-Napoca', shortName: 'CLJ', x: 308, y: 169, lon: 23.6, lat: 46.76667 },
  { name: 'Timișoara', shortName: 'TIM', x: 139, y: 245, lon: 21.22571, lat: 45.75372 },
  { name: 'Brașov', shortName: 'BRA', x: 446, y: 253, lon: 25.60613, lat: 45.64861 },
  { name: 'Sibiu', shortName: 'SIB', x: 343, y: 242, lon: 24.15, lat: 45.8 },
  { name: 'Craiova', shortName: 'CRA', x: 320, y: 352, lon: 23.8, lat: 44.31667 },
  { name: 'Constanța', shortName: 'CST', x: 659, y: 365, lon: 28.63432, lat: 44.18073 },
]

export const destinationGoals: DestinationGoal[] = [
  { from: 'Iași', to: 'Constanța', reward: 13 },
  { from: 'Iași', to: 'Timișoara', reward: 11 },
]

export const routes: RailRoute[] = [
  { id: 'iasi-brasov', from: 'Iași', to: 'Brașov', constructionCost: 2, value: 4 },
  { id: 'iasi-cluj', from: 'Iași', to: 'Cluj-Napoca', constructionCost: 3, value: 6 },
  { id: 'cluj-brasov', from: 'Cluj-Napoca', to: 'Brașov', constructionCost: 2, value: 5 },
  { id: 'timisoara-cluj', from: 'Timișoara', to: 'Cluj-Napoca', constructionCost: 4, value: 7 },
  { id: 'timisoara-sibiu', from: 'Timișoara', to: 'Sibiu', constructionCost: 3, value: 6 },
  { id: 'sibiu-brasov', from: 'Sibiu', to: 'Brașov', constructionCost: 2, value: 4 },
  { id: 'brasov-bucuresti', from: 'Brașov', to: 'București', constructionCost: 4, value: 9 },
  { id: 'sibiu-craiova', from: 'Sibiu', to: 'Craiova', constructionCost: 2, value: 4 },
  { id: 'bucuresti-constanta', from: 'București', to: 'Constanța', constructionCost: 4, value: 7 },
  { id: 'craiova-bucuresti', from: 'Craiova', to: 'București', constructionCost: 2, value: 5 },
  { id: 'cluj-sibiu', from: 'Cluj-Napoca', to: 'Sibiu', constructionCost: 2, value: 4 },
  { id: 'iasi-constanta', from: 'Iași', to: 'Constanța', constructionCost: 6, value: 11 },
]

export type ModelEvaluation = {
  plan: string
  energy: string
  constructionCost?: number
  budgetStatus?: 'Matches Budget' | 'Exceeds Budget'
  score?: number
  label?: string
}

export const modelEvaluations: ModelEvaluation[] = [
  { plan: '00100', energy: '+2.1' },
  { plan: '10100', energy: '-6.4' },
  { plan: '11100', energy: '-15.0', constructionCost: 7, budgetStatus: 'Matches Budget', score: 15, label: 'Best Valid Plan' },
  { plan: '10110', energy: '-17.3', constructionCost: 8, budgetStatus: 'Exceeds Budget', score: 18, label: 'Lowest Model Energy' },
]

export function bestPlanWithinBudget(availableRoutes: RailRoute[], budget: number): RailRoute[] {
  let best: RailRoute[] = []
  let bestScore = 0
  let bestCost = 0

  for (let mask = 1; mask < 1 << availableRoutes.length; mask += 1) {
    const candidate = availableRoutes.filter((_, index) => (mask & (1 << index)) !== 0)
    const cost = candidate.reduce((sum, route) => sum + route.constructionCost, 0)
    if (cost > budget) continue
    const score = candidate.reduce((sum, route) => sum + route.value, 0)
    if (score > bestScore || (score === bestScore && cost < bestCost)) {
      best = candidate
      bestScore = score
      bestCost = cost
    }
  }

  return best
}
