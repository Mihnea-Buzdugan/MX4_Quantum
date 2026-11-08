import { routes } from '../data/routes'
import type { RailCity, RailRoute } from '../data/routes'
import { authFetch } from '../utils/auth'
import type { RailwayPlanResponse } from './railwayPlannerTypes'

// Response types live in railwayPlannerTypes.ts; re-exported so existing imports keep working.
export type { RailwayPlanResponse, PlanEdge as RailwayPlanEdge } from './railwayPlannerTypes'

export type RailwayPlanOptions = {
  // ---- the four QAOA settings chosen on the dashboard
  qaoa_depth: number // p = number of QAOA layers
  slack: boolean // true = slack qubits for the budget, false = no slack (unbalanced penalization)
  maxiter: number // COBYLA iterations per optimiser run
  shots: number // measurements of the final QAOA circuit
  // ---- planner mode: QAOA picks the whole network, or QAOA + classical completion
  mode: PlannerMode
  quantum_fraction: number // hybrid only: share of the budget the QAOA stage may spend
  max_qubits: number
  seed: number
  auto_conflicts: boolean
  coordinate_system: string
  min_clearance: number
  include_circuit: boolean
  circuit_formats: string[]
  execution: string
  ibm_backend: string
  ibm_shots: number | null // null = same as `shots`
  ibm_layout: string
  ibm_optimization_level: number
  ibm_dynamical_decoupling: boolean
  ibm_twirling: boolean
  ibm_timeout: number
  ibm_job_id: string
  ibm_fallback: boolean
}

// Limits enforced by the FastAPI schema (schemas.py: Options).
export const QAOA_LIMITS = {
  p: { min: 1, max: 6 },
  iterations: { min: 1, max: 3000 },
  shots: { min: 1, max: 100_000 },
} as const

export type PlannerMode = 'qaoa_only' | 'hybrid'

export const QUANTUM_FRACTION_LIMITS = { min: 5, max: 100 } as const // percent of the budget

export type QaoaSettings = {
  p: number
  slack: boolean
  iterations: number
  shots: number
  // optional so runs saved before hybrid mode existed still read as qaoa_only
  mode?: PlannerMode
  quantumFraction?: number // 0..1, hybrid only
}

export const DEFAULT_QAOA_SETTINGS: Required<QaoaSettings> = {
  p: 1,
  slack: true,
  iterations: 300,
  shots: 2048,
  mode: 'qaoa_only',
  quantumFraction: 0.8,
}

export function isHybrid(settings: Pick<QaoaSettings, 'mode'> | null | undefined) {
  return settings?.mode === 'hybrid'
}

/** "slack" / "no slack" for QAOA only; "hybrid · 80 % quantum" for hybrid (which always uses slack). */
export function describeEncoding(settings: Pick<QaoaSettings, 'mode' | 'slack' | 'quantumFraction'>) {
  if (isHybrid(settings)) {
    const fraction = settings.quantumFraction ?? DEFAULT_QAOA_SETTINGS.quantumFraction
    return `hybrid · ${Math.round(fraction * 100)}% quantum`
  }
  return settings.slack ? 'slack' : 'no slack'
}

// Dashboard settings -> planner option names.
export function qaoaSettingsToOptions(settings: QaoaSettings): Partial<RailwayPlanOptions> {
  return {
    qaoa_depth: settings.p,
    slack: settings.slack,
    maxiter: settings.iterations,
    shots: settings.shots,
    mode: settings.mode ?? DEFAULT_QAOA_SETTINGS.mode,
    quantum_fraction: settings.quantumFraction ?? DEFAULT_QAOA_SETTINGS.quantumFraction,
  }
}

export const DEFAULT_PLANNER_OPTIONS: RailwayPlanOptions = {
  ...qaoaSettingsToOptions(DEFAULT_QAOA_SETTINGS) as Pick<RailwayPlanOptions, 'qaoa_depth' | 'slack' | 'maxiter' | 'shots' | 'mode' | 'quantum_fraction'>,
  max_qubits: 12,
  seed: 2026,
  auto_conflicts: true,
  coordinate_system: 'lonlat',
  min_clearance: 15,
  include_circuit: true,
  circuit_formats: ['qasm3'],
  execution: 'simulator',
  ibm_backend: '',
  ibm_shots: null, // the IBM job uses the same number of shots as the simulator
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
  // Keep the full QUBO, Ising model and optimiser trace in the response (large).
  include_qubo?: boolean
  // Batch runs: Django links the saved run to this batch (removed before calling FastAPI).
  batch_id?: number
  batch_index?: number
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
export function toRouteId(plannerId: string | number): string | number {
  const index = Number(plannerId)
  return Number.isInteger(index) && routes[index] ? routes[index].id : plannerId
}

// The rest of the UI matches routes by their string id, so translate every
// route id in the response back to it: built edges, conflicts and QAOA variables.
// Also used for runs loaded back from the run history (Django stores the planner's own ids).
export function withRouteIds<T extends RailwayPlanResponse>(response: T): T {
  const variables = response.quantum?.variables
  const quantum = response.quantum
    ? {
      ...response.quantum,
      top_samples: response.quantum.top_samples?.map((sample) => ({ ...sample, routes: sample.routes.map(toRouteId) })),
      reference_optimum: response.quantum.reference_optimum
        ? { ...response.quantum.reference_optimum, routes: response.quantum.reference_optimum.routes.map(toRouteId) }
        : response.quantum.reference_optimum,
    }
    : response.quantum
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
    quantum: quantum && variables
      ? {
        ...quantum,
        variables: Object.fromEntries(
          Object.entries(variables).map(([name, value]) => [name, name.startsWith('x') ? toRouteId(value) : value]),
        ),
      }
      : quantum,
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
  // disconnected / no_valid_sample: QAOA ran, but no measured sample was a connected / valid
  // network (more shots, a larger p or more iterations usually help). Shown as a normal result.
  if (
    typeof body === 'object'
    && body !== null
    && 'status' in body
    && (body.status === 'pending' || body.status === 'disconnected' || body.status === 'no_valid_sample')
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