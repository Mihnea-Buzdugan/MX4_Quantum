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
  { name: 'Galați', shortName: 'GAL', x: 618, y: 270, lon: 28.05, lat: 45.4353 },
  { name: 'Oradea', shortName: 'ORA', x: 188, y: 146, lon: 21.9189, lat: 47.0722 },
  { name: 'Ploiești', shortName: 'PLO', x: 475, y: 307, lon: 26.0129, lat: 44.9403 },
  { name: 'Brăila', shortName: 'BRL', x: 612, y: 283, lon: 27.9575, lat: 45.2692 },
  { name: 'Arad', shortName: 'ARA', x: 146, y: 212, lon: 21.3123, lat: 46.1866 },
  { name: 'Pitești', shortName: 'PIT', x: 395, y: 313, lon: 24.8692, lat: 44.8565 },
  { name: 'Bacău', shortName: 'BAC', x: 539, y: 185, lon: 26.9146, lat: 46.567 },
  { name: 'Târgu Mureș', shortName: 'TGM', x: 373, y: 186, lon: 24.5575, lat: 46.5425 },
  { name: 'Baia Mare', shortName: 'BMA', x: 305, y: 102, lon: 23.58, lat: 47.6567 },
  { name: 'Buzău', shortName: 'BUZ', x: 532, y: 291, lon: 26.8203, lat: 45.15 },
  { name: 'Botoșani', shortName: 'BOT', x: 522, y: 96, lon: 26.6667, lat: 47.75 },
  { name: 'Râmnicu Vâlcea', shortName: 'RMV', x: 360, y: 294, lon: 24.3692, lat: 45.1047 },
  { name: 'Drobeta-Turnu Severin', shortName: 'DTS', x: 239, y: 329, lon: 22.6567, lat: 44.6369 },
  { name: 'Satu Mare', shortName: 'SMR', x: 256, y: 92, lon: 22.8853, lat: 47.7928 },
  { name: 'Piatra Neamț', shortName: 'PNT', x: 502, y: 158, lon: 26.381, lat: 46.9275 },
  { name: 'Suceava', shortName: 'SUC', x: 493, y: 103, lon: 26.2556, lat: 47.6514 },
  { name: 'Târgu Jiu', shortName: 'TGJ', x: 283, y: 298, lon: 23.2747, lat: 45.045 },
  { name: 'Bistrița', shortName: 'BIS', x: 370, y: 142, lon: 24.5, lat: 47.1333 },
  { name: 'Focșani', shortName: 'FOC', x: 557, y: 250, lon: 27.1833, lat: 45.7 },
  { name: 'Tulcea', shortName: 'TUL', x: 671, y: 291, lon: 28.8, lat: 45.1667 },
  { name: 'Alba Iulia', shortName: 'ALB', x: 305, y: 222, lon: 23.58, lat: 46.0667 },
  { name: 'Deva', shortName: 'DEV', x: 257, y: 235, lon: 22.9, lat: 45.8833 },
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
  { id: 'cluj-bucuresti', from: 'Cluj-Napoca', to: 'București', constructionCost: 19, value: 21 },
  { id: 'timisoara-brasov', from: 'Timișoara', to: 'Brașov', constructionCost: 20, value: 7 },
  { id: 'iasi-sibiu', from: 'Iași', to: 'Sibiu', constructionCost: 18, value: 6 },
  { id: 'cluj-craiova', from: 'Cluj-Napoca', to: 'Craiova', constructionCost: 16, value: 8 },
  { id: 'timisoara-arad', from: 'Timișoara', to: 'Arad', constructionCost: 1, value: 15 },
  { id: 'arad-oradea', from: 'Arad', to: 'Oradea', constructionCost: 3, value: 8 },
  { id: 'oradea-satu-mare', from: 'Oradea', to: 'Satu Mare', constructionCost: 3, value: 7 },
  { id: 'satu-mare-baia-mare', from: 'Satu Mare', to: 'Baia Mare', constructionCost: 1, value: 7 },
  { id: 'oradea-cluj', from: 'Oradea', to: 'Cluj-Napoca', constructionCost: 5, value: 11 },
  { id: 'arad-deva', from: 'Arad', to: 'Deva', constructionCost: 5, value: 4 },
  { id: 'timisoara-deva', from: 'Timișoara', to: 'Deva', constructionCost: 5, value: 6 },
  { id: 'timisoara-drobeta', from: 'Timișoara', to: 'Drobeta-Turnu Severin', constructionCost: 10, value: 6 },
  { id: 'deva-alba-iulia', from: 'Deva', to: 'Alba Iulia', constructionCost: 1, value: 4 },
  { id: 'alba-iulia-cluj', from: 'Alba Iulia', to: 'Cluj-Napoca', constructionCost: 3, value: 8 },
  { id: 'alba-iulia-sibiu', from: 'Alba Iulia', to: 'Sibiu', constructionCost: 2, value: 7 },
  { id: 'deva-sibiu', from: 'Deva', to: 'Sibiu', constructionCost: 4, value: 5 },
  { id: 'cluj-baia-mare', from: 'Cluj-Napoca', to: 'Baia Mare', constructionCost: 4, value: 10 },
  { id: 'cluj-bistrita', from: 'Cluj-Napoca', to: 'Bistrița', constructionCost: 3, value: 9 },
  { id: 'baia-mare-bistrita', from: 'Baia Mare', to: 'Bistrița', constructionCost: 5, value: 5 },
  { id: 'oradea-baia-mare', from: 'Oradea', to: 'Baia Mare', constructionCost: 5, value: 6 },
  { id: 'cluj-targu-mures', from: 'Cluj-Napoca', to: 'Târgu Mureș', constructionCost: 3, value: 11 },
  { id: 'bistrita-targu-mures', from: 'Bistrița', to: 'Târgu Mureș', constructionCost: 2, value: 6 },
  { id: 'targu-mures-sibiu', from: 'Târgu Mureș', to: 'Sibiu', constructionCost: 3, value: 7 },
  { id: 'targu-mures-brasov', from: 'Târgu Mureș', to: 'Brașov', constructionCost: 5, value: 8 },
  { id: 'sibiu-ramnicu-valcea', from: 'Sibiu', to: 'Râmnicu Vâlcea', constructionCost: 5, value: 7 },
  { id: 'brasov-ploiesti', from: 'Brașov', to: 'Ploiești', constructionCost: 5, value: 12 },
  { id: 'brasov-bacau', from: 'Brașov', to: 'Bacău', constructionCost: 9, value: 8 },
  { id: 'brasov-buzau', from: 'Brașov', to: 'Buzău', constructionCost: 7, value: 8 },
  { id: 'targu-mures-piatra-neamt', from: 'Târgu Mureș', to: 'Piatra Neamț', constructionCost: 9, value: 4 },
  { id: 'bistrita-suceava', from: 'Bistrița', to: 'Suceava', constructionCost: 9, value: 4 },
  { id: 'targu-jiu-deva', from: 'Târgu Jiu', to: 'Deva', constructionCost: 6, value: 4 },
  { id: 'alba-iulia-targu-mures', from: 'Alba Iulia', to: 'Târgu Mureș', constructionCost: 3, value: 5 },
  { id: 'drobeta-craiova', from: 'Drobeta-Turnu Severin', to: 'Craiova', constructionCost: 2, value: 8 },
  { id: 'drobeta-targu-jiu', from: 'Drobeta-Turnu Severin', to: 'Târgu Jiu', constructionCost: 2, value: 6 },
  { id: 'targu-jiu-craiova', from: 'Târgu Jiu', to: 'Craiova', constructionCost: 2, value: 8 },
  { id: 'targu-jiu-ramnicu-valcea', from: 'Târgu Jiu', to: 'Râmnicu Vâlcea', constructionCost: 3, value: 5 },
  { id: 'craiova-pitesti', from: 'Craiova', to: 'Pitești', constructionCost: 3, value: 10 },
  { id: 'ramnicu-valcea-pitesti', from: 'Râmnicu Vâlcea', to: 'Pitești', constructionCost: 2, value: 9 },
  { id: 'ramnicu-valcea-craiova', from: 'Râmnicu Vâlcea', to: 'Craiova', constructionCost: 4, value: 8 },
  { id: 'pitesti-bucuresti', from: 'Pitești', to: 'București', constructionCost: 3, value: 25 },
  { id: 'pitesti-ploiesti', from: 'Pitești', to: 'Ploiești', constructionCost: 3, value: 9 },
  { id: 'ploiesti-bucuresti', from: 'Ploiești', to: 'București', constructionCost: 1, value: 40 },
  { id: 'ploiesti-buzau', from: 'Ploiești', to: 'Buzău', constructionCost: 2, value: 9 },
  { id: 'bucuresti-buzau', from: 'București', to: 'Buzău', constructionCost: 2, value: 23 },
  { id: 'buzau-braila', from: 'Buzău', to: 'Brăila', constructionCost: 2, value: 7 },
  { id: 'buzau-focsani', from: 'Buzău', to: 'Focșani', constructionCost: 2, value: 6 },
  { id: 'braila-galati', from: 'Brăila', to: 'Galați', constructionCost: 1, value: 22 },
  { id: 'galati-tulcea', from: 'Galați', to: 'Tulcea', constructionCost: 2, value: 8 },
  { id: 'tulcea-constanta', from: 'Tulcea', to: 'Constanța', constructionCost: 3, value: 7 },
  { id: 'braila-constanta', from: 'Brăila', to: 'Constanța', constructionCost: 3, value: 9 },
  { id: 'bucuresti-braila', from: 'București', to: 'Brăila', constructionCost: 4, value: 21 },
  { id: 'focsani-galati', from: 'Focșani', to: 'Galați', constructionCost: 2, value: 8 },
  { id: 'focsani-bacau', from: 'Focșani', to: 'Bacău', constructionCost: 2, value: 5 },
  { id: 'bacau-piatra-neamt', from: 'Bacău', to: 'Piatra Neamț', constructionCost: 1, value: 8 },
  { id: 'bacau-iasi', from: 'Bacău', to: 'Iași', constructionCost: 2, value: 11 },
  { id: 'piatra-neamt-suceava', from: 'Piatra Neamț', to: 'Suceava', constructionCost: 3, value: 5 },
  { id: 'suceava-iasi', from: 'Suceava', to: 'Iași', constructionCost: 3, value: 8 },
  { id: 'suceava-botosani', from: 'Suceava', to: 'Botoșani', constructionCost: 1, value: 9 },
  { id: 'botosani-iasi', from: 'Botoșani', to: 'Iași', constructionCost: 2, value: 9 },
  { id: 'iasi-galati', from: 'Iași', to: 'Galați', constructionCost: 5, value: 9 },
  { id: 'bacau-suceava', from: 'Bacău', to: 'Suceava', constructionCost: 3, value: 5 },
  { id: 'piatra-neamt-iasi', from: 'Piatra Neamț', to: 'Iași', constructionCost: 4, value: 8 },
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