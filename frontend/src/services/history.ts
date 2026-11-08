import { authFetch } from '../utils/auth'
import { withRouteIds } from './railwayPlanner'
import type { PathId, RailwayPlanResponse } from './railwayPlannerTypes'
import type { BatchRunParams, BatchStatistics } from '../utils/batchStats'

// Saved runs and batches (Django: api/plans/, api/batches/). Every run that goes through
// /api/railway/plan while logged in is saved; batch runs are linked to their batch.

export type SavedParameters = {
  p?: number
  slack?: boolean
  iterations?: number
  shots?: number
  seed?: number
  execution?: string
  max_qubits?: number
  mode?: 'qaoa_only' | 'hybrid'
  quantum_fraction?: number // saved plan parameters (planner option name)
  quantumFraction?: number // saved batch rows (frontend name)
}

export type SavedStatus = RailwayPlanResponse['status'] | 'error'

export type PlanSummary = {
  id: number
  created_at: string
  algorithm: string
  status: SavedStatus
  connected: boolean
  valid: boolean
  reason: string | null
  budget: number
  total_cost: number | null
  total_value: number | null
  execution_ms: number | null
  runtime_seconds: number | null
  parameters: SavedParameters
  batch_id: number | null
  batch_index: number | null
  node_count: number
  route_count: number
}

export type SavedRequest = {
  budget: number
  nodes: Record<string, [number, number]>
  paths: Array<{ id: PathId; from: string; to: string; cost: number; value: number }>
  options?: Record<string, unknown>
}

export type SavedPlan = Omit<RailwayPlanResponse, 'status'> & {
  status: SavedStatus
  id: number
  algorithm: string
  created_at: string
  execution_ms: number | null
  runtime_seconds: number | null
  http_status: number | null
  parameters: SavedParameters
  request: SavedRequest | null
  batch_id: number | null
  batch_index: number | null
  valid: boolean
}

export type BatchSummary = {
  id: number
  name: string
  algorithm: string
  status: 'running' | 'completed' | 'stopped'
  budget: number
  nodes: string[]
  run_count: number
  saved_runs: number | null
  valid_runs: number | null
  statistics: Partial<BatchStatistics> | null
  created_at: string
  finished_at: string | null
}

export type SavedBatchRoute = { id: string; from: string; to: string; cost: number; value: number }

export type BatchDetail = BatchSummary & {
  routes: SavedBatchRoute[]
  runs: BatchRunParams[]
  plans: SavedPlan[]
}

export class HistoryError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await authFetch(url, {
      ...init,
      headers: init.body ? { 'Content-Type': 'application/json', ...init.headers } : init.headers,
    })
  } catch (error) {
    throw new HistoryError(error instanceof Error ? error.message : 'Could not reach the server.', 0)
  }
  if (response.status === 204) return undefined as T
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // empty / non-JSON body
  }
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
      ? body.error
      : `Request failed (HTTP ${response.status}).`
    throw new HistoryError(message, response.status)
  }
  return body as T
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// Runs saved before the run history existed have no parameters / request: fill in safe defaults.
function normalizePlan(plan: SavedPlan): SavedPlan {
  const request = isObject(plan.request) && isObject(plan.request.nodes) && Array.isArray(plan.request.paths)
    ? plan.request
    : null
  return {
    ...plan,
    parameters: isObject(plan.parameters) ? plan.parameters : {},
    request,
    conflicts: Array.isArray(plan.conflicts) ? plan.conflicts : [],
    notes: Array.isArray(plan.notes) ? plan.notes : [],
    graph: plan.graph && Array.isArray(plan.graph.edges) && Array.isArray(plan.graph.nodes) ? plan.graph : { nodes: [], edges: [] },
    quantum: isObject(plan.quantum) ? plan.quantum : null,
  }
}

// Saved responses carry the planner's numeric route ids; the UI uses the app's route ids.
function toAppIds(plan: SavedPlan): SavedPlan {
  return withRouteIds(normalizePlan(plan) as unknown as RailwayPlanResponse) as unknown as SavedPlan
}

export async function listPlans(scope: 'single' | 'batch' | 'all' = 'all'): Promise<PlanSummary[]> {
  const rows = await request<PlanSummary[]>(`/api/plans/${scope === 'all' ? '' : `?scope=${scope}`}`)
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    ...row,
    parameters: isObject(row.parameters) ? row.parameters : {},
    node_count: row.node_count ?? 0,
    route_count: row.route_count ?? 0,
  }))
}

export const getPlan = async (id: number) => toAppIds(await request<SavedPlan>(`/api/plans/${id}/`))

export const deletePlan = (id: number) => request<void>(`/api/plans/${id}/`, { method: 'DELETE' })

export async function listBatches(): Promise<BatchSummary[]> {
  const rows = await request<BatchSummary[]>('/api/batches/')
  return (Array.isArray(rows) ? rows : []).map((row) => ({ ...row, nodes: Array.isArray(row.nodes) ? row.nodes : [] }))
}

export async function getBatch(id: number): Promise<BatchDetail> {
  const batch = await request<BatchDetail>(`/api/batches/${id}/`)
  return {
    ...batch,
    nodes: Array.isArray(batch.nodes) ? batch.nodes : [],
    routes: Array.isArray(batch.routes) ? batch.routes : [],
    runs: Array.isArray(batch.runs) ? batch.runs.map((run) => paramsOf(run ?? {})) : [],
    plans: (Array.isArray(batch.plans) ? batch.plans : []).map(toAppIds),
  }
}

export const deleteBatch = (id: number) => request<void>(`/api/batches/${id}/`, { method: 'DELETE' })

export const createBatch = (data: {
  name?: string
  algorithm: string
  budget: number
  nodes: string[]
  routes: SavedBatchRoute[]
  runs: BatchRunParams[]
}) => request<BatchSummary>('/api/batches/', { method: 'POST', body: JSON.stringify(data) })

export const finishBatch = (id: number, data: { status: 'completed' | 'stopped'; statistics?: unknown }) =>
  request<BatchSummary>(`/api/batches/${id}/`, { method: 'PATCH', body: JSON.stringify(data) })

// A saved run as a batch row: no saved plan = never ran (stopped batch); "error" = failed request.
export function savedRunResult(
  index: number,
  params: BatchRunParams,
  plan: SavedPlan | undefined,
): import('../utils/batchStats').BatchRunResult {
  if (!plan) return { index, params, state: 'skipped', requestMs: null, response: null, error: null }
  if (plan.status === 'error') {
    return { index, params, state: 'failed', requestMs: plan.execution_ms, response: null, error: plan.reason ?? 'The run failed.' }
  }
  return {
    index,
    params,
    state: 'done',
    requestMs: plan.execution_ms,
    response: plan as unknown as RailwayPlanResponse,
    error: null,
  }
}

// Parameters of a saved run in the batch-row shape (defaults = planner defaults).
export function paramsOf(saved: SavedParameters | null | undefined): BatchRunParams {
  saved = saved ?? {}
  return {
    p: saved.p ?? 2,
    slack: saved.slack ?? true,
    iterations: saved.iterations ?? 300,
    shots: saved.shots ?? 2048,
    mode: saved.mode ?? 'qaoa_only',
    quantumFraction: saved.quantumFraction ?? saved.quantum_fraction ?? 0.8,
    seed: saved.seed ?? 2026,
  }
}
