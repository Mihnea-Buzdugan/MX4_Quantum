import type { RailCity, RailRoute } from '../data/routes'
import { authFetch } from '../utils/auth'

export type RailwayPlanRequest = {
  budget: number
  nodes: Record<string, [number, number]>
  paths: Array<{
    id: string
    from: string
    to: string
    cost: number
    value: number
  }>
  conflict_pairs: Array<[string, string]>
  options: Record<string, never>
  // Label stored with the saved plan; Django removes it before calling FastAPI.
  algorithm?: string
}

export type RailwayPlanEdge = {
  id: string | number
  from: string
  to: string
  cost: number
  value: number
  stage: 'quantum' | 'connector' | 'extra'
}

export type RailwayPlanResponse = {
  status: 'ok' | 'infeasible'
  connected: boolean
  budget: number
  conflict_pairs: Array<Array<string | number>>
  notes: string[]
  reason?: string
  // Id of the saved plan, added by Django when the user is logged in.
  plan_id?: number
  minimum_connection_cost?: number | null
  total_cost?: number | null
  total_value?: number | null
  remaining_budget?: number | null
  cost_breakdown?: {
    quantum: number
    connectors: number
    extra: number
  }
  graph?: {
    nodes: Array<{ name: string; lon: number; lat: number }>
    edges: RailwayPlanEdge[]
  }
  quantum?: {
    skipped?: boolean
    reason?: string
    sampler?: string
    qubits?: number | null
    route_qubits?: number | null
    slack_qubits?: number | null
    depth?: number | null
    quantum_budget?: number | null
    feasible_sample_rate?: number | null
    p_feasible_qaoa?: number | null
    best_sampled_value?: number | null
    exact_optimum_value?: number | null
    [key: string]: unknown
  }
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

export function createRailwayPlanRequest(
  budget: number,
  selectedCities: RailCity[],
  selectedRoutes: RailRoute[],
  algorithm?: string,
): RailwayPlanRequest {
  return {
    budget,
    nodes: Object.fromEntries(
      selectedCities.map((city) => [city.name, [city.lon, city.lat]]),
    ),
    paths: selectedRoutes.map((route) => ({
      id: route.id,
      from: route.from,
      to: route.to,
      cost: route.constructionCost,
      value: route.value,
    })),
    conflict_pairs: [],
    options: {},
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
    return body as RailwayPlanResponse
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

  return body as RailwayPlanResponse
}