import { routes } from '../data/routes'
import type { RailCity, RailRoute } from '../data/routes'
import { authFetch } from '../utils/auth'
import type { RailwayPlanResponse } from './railwayPlannerTypes'

// Response types live in railwayPlannerTypes.ts; re-exported so existing imports keep working.
export type { RailwayPlanResponse, PlanEdge as RailwayPlanEdge } from './railwayPlannerTypes'

export type RailwayPlanOptions = {
  quantum_fraction: number
  qaoa_depth: number
  max_qubits: number
  seed: number
  auto_conflicts: boolean
  coordinate_system: string
  min_clearance: number
  include_circuit: boolean
  circuit_formats: string[]
  execution: string
  ibm_backend: string
  ibm_shots: number
  ibm_layout: string
  ibm_optimization_level: number
  ibm_dynamical_decoupling: boolean
  ibm_twirling: boolean
  ibm_timeout: number
  ibm_job_id: string
  ibm_fallback: boolean
}

export const DEFAULT_PLANNER_OPTIONS: RailwayPlanOptions = {
  quantum_fraction: 0.8,
  qaoa_depth: 1,
  max_qubits: 12,
  seed: 2026,
  auto_conflicts: true,
  coordinate_system: 'lonlat',
  min_clearance: 15,
  include_circuit: true,
  circuit_formats: ['qasm3'],
  execution: 'simulator',
  ibm_backend: '',
  ibm_shots: 4096,
  ibm_layout: 'best',
  ibm_optimization_level: 3,
  ibm_dynamical_decoupling: true,
  ibm_twirling: false,
  ibm_timeout: 3600, // the server caps this (PLANNER_MAX_IBM_TIMEOUT), then answers "pending"
  ibm_job_id: '',
  ibm_fallback: false,
}

export type RailwayPlanRequest = {
  budget: number
  nodes: Record<string, [number, number]>
  paths: Array<{
    id: number
    from: string
    to: string
    cost: number
    value: number
  }>
  options: RailwayPlanOptions
  // Label stored with the saved plan; Django removes it before calling FastAPI.
  algorithm?: string
}

export class RailwayPlannerError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'RailwayPlannerError'
    this.status = status
  }
}

function getPlannerUrl() {
  return import.meta.env.VITE_RAILWAY_PLANNER_URL || 'http://localhost:8000/api/railway/plan'
}

// Django drops `algorithm` before calling FastAPI, so the target of the final QAOA circuit is
// chosen here through options.execution: real IBM hardware for the "Real Hardware" algorithm,
// the simulator for everything else (simulated and classic).
export function executionForAlgorithm(algorithm?: string): 'simulator' | 'ibm' {
  return /hardware|ibm/i.test(algorithm ?? '') ? 'ibm' : 'simulator'
}

// The planner wants numeric path ids (0, 1, 2, ...). The app's routes use
// string ids (e.g. "cluj-brasov"), so the planner id is the route's position
// in the full `routes` list, and it is stable no matter which routes are sent.
function toPlannerId(route: RailRoute): number {
  const index = routes.findIndex((candidate) => candidate.id === route.id)
  if (index === -1) {
    throw new RailwayPlannerError(`Unknown route "${route.id}".`, 0)
  }
  return index
}

// Reverse of toPlannerId: planner id -> the app's route id.
// Anything that is not a valid index (e.g. "slack 4") is returned unchanged.
function toRouteId(plannerId: string | number): string | number {
  const index = Number(plannerId)
  return Number.isInteger(index) && routes[index] ? routes[index].id : plannerId
}

// The rest of the UI matches routes by their string id, so translate every
// route id in the response back to it: built edges, conflicts and QAOA variables.
function withRouteIds(response: RailwayPlanResponse): RailwayPlanResponse {
  const variables = response.quantum?.variables
  return {
    ...response,
    conflicts: (response.conflicts ?? []).map((conflict) => ({
      ...conflict,
      paths: conflict.paths.map(toRouteId),
    })),
    graph: response.graph
      ? {
        ...response.graph,
        edges: response.graph.edges.map((edge) => ({ ...edge, id: toRouteId(edge.id) })),
      }
      : response.graph,
    quantum: response.quantum && variables
      ? {
        ...response.quantum,
        variables: Object.fromEntries(
          Object.entries(variables).map(([name, value]) => [name, name.startsWith('x') ? toRouteId(value) : value]),
        ),
      }
      : response.quantum,
  }
}

export function createRailwayPlanRequest(
  budget: number,
  selectedCities: RailCity[],
  selectedRoutes: RailRoute[],
  algorithm?: string,
  options: Partial<RailwayPlanOptions> = {},
): RailwayPlanRequest {
  return {
    budget,
    nodes: Object.fromEntries(
      selectedCities.map((city) => [city.name, [city.lon, city.lat]]),
    ),
    paths: selectedRoutes.map((route) => ({
      id: toPlannerId(route),
      from: route.from,
      to: route.to,
      cost: route.constructionCost,
      value: route.value,
    })),
    // explicit `options` still win, e.g. { execution: 'ibm_fake' } to test without IBM credentials
    options: { ...DEFAULT_PLANNER_OPTIONS, execution: executionForAlgorithm(algorithm), ...options },
    algorithm,
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new RailwayPlannerError(
      `The railway planner returned a non-JSON response (HTTP ${response.status}).`,
      response.status,
    )
  }
}

export async function planRailwayNetwork(payload: RailwayPlanRequest): Promise<RailwayPlanResponse> {
  let response: Response
  try {
    // authFetch attaches the JWT access token (and refreshes it on a 401),
    // so Django knows which user to save the plan for.
    response = await authFetch(getPlannerUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch (error) {
    const reason = error instanceof Error ? ` ${error.message}` : ''
    throw new RailwayPlannerError(
      `Could not connect to the railway planner at ${getPlannerUrl()}.${reason}`,
      0,
    )
  }

  const body = await readJson(response)
  if (
    response.status === 422
    && typeof body === 'object'
    && body !== null
    && 'status' in body
    && body.status === 'infeasible'
  ) {
    return withRouteIds(body as RailwayPlanResponse)
  }

  if (!response.ok) {
    const detail = typeof body === 'object' && body !== null && 'detail' in body
      ? body.detail
      : typeof body === 'object' && body !== null && 'error' in body
        ? body.error
        : `HTTP ${response.status}`
    throw new RailwayPlannerError(
      typeof detail === 'string' ? detail : `Railway planner request failed: ${JSON.stringify(detail)}`,
      response.status,
    )
  }

  // 202: the IBM job was submitted but is still running; the body carries the job id.
  if (
    typeof body === 'object'
    && body !== null
    && 'status' in body
    && body.status === 'pending'
  ) {
    return withRouteIds(body as RailwayPlanResponse)
  }

  if (
    typeof body !== 'object'
    || body === null
    || !('status' in body)
    || body.status !== 'ok'
    || !('graph' in body)
    || typeof body.graph !== 'object'
    || body.graph === null
    || !('edges' in body.graph)
    || !Array.isArray(body.graph.edges)
  ) {
    throw new RailwayPlannerError('The railway planner returned an invalid success response.', response.status)
  }

  return withRouteIds(body as RailwayPlanResponse)
}