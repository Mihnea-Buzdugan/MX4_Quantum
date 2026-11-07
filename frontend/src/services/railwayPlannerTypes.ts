// Response types for the new railway planner API (see schemas.py: SolveResponse).
// Optional fields may arrive as null (pydantic) or be absent, so check with `!= null`.

export type PathId = number | string

export type PlanStatus = 'ok' | 'infeasible' | 'pending'

export type PlanEdge = {
  id: PathId
  from: string
  to: string
  cost: number
  value: number
  stage: 'quantum' | 'connector' | 'extra'
}

export type PlanNode = { name: string; lon: number; lat: number }

export type Conflict = {
  paths: PathId[]
  type: 'crossing' | 'touching' | 'overlap' | 'too_close' | 'manual'
  at?: [number, number] | null
  distance_km?: number
  distance?: number
}

export type CircuitInfo = {
  num_qubits?: number
  depth?: number
  two_qubit_gates?: number
  gate_counts?: Record<string, number>
  bit_order?: string
  qasm3?: string
  qasm2?: string
  qasm3_parameterized?: string
  error?: string
}

export type ExecutionInfo = {
  mode?: string
  backend?: string
  job_id?: string
  status?: string
  shots?: number
  layout_method?: string
  physical_qubits?: number[]
  isa_depth?: number
  isa_two_qubit_gates?: number
  estimated_success?: number
  quantum_seconds?: number
  submitted_utc?: string
  fallback_used?: boolean
  error?: string
  candidates?: Record<string, { two_qubit_gates: number; estimated_success: number }>
  [key: string]: unknown
}

export type QuantumStats = {
  skipped?: boolean | null
  reason?: string | null
  sampler?: string | null
  qubits?: number | null
  route_qubits?: number | null
  slack_qubits?: number | null
  layers?: number | null
  depth?: number | null // legacy name, replaced by `layers`
  quantum_budget?: number | null
  expected_energy?: number | null
  p_feasible_uniform?: number | null
  p_feasible_qaoa?: number | null
  feasible_sample_rate?: number | null
  best_sampled_value?: number | null
  exact_optimum_value?: number | null
  variables?: Record<string, PathId> | null
  penalties?: {
    lam?: number
    mu?: number
    slack_weights?: number[]
    quantum_budget_units?: number
    cost_unit_scale?: number
    lam_ladder?: Record<string, boolean>
  } | null
  angles?: {
    gammas?: number[]
    betas?: number[]
    optimizer?: { method?: string; rhobeg?: number; maxiter?: number }
    starts?: Array<{
      kind: string
      selected: boolean
      energy: number
      evaluations: number
      final_gammas: number[]
      final_betas: number[]
    }>
  } | null
  qubo?: {
    offset?: number
    linear?: Record<string, number>
    quadratic?: Record<string, number>
    formula?: string
    formula_expanded?: string
    formula_latex?: string
    energy_range?: [number, number]
  } | null
  ising?: {
    constant?: number
    scale?: number
    h?: Record<string, number>
    J?: Record<string, number>
    formula?: string
    formula_latex?: string
  } | null
  circuit?: CircuitInfo | null
  execution?: ExecutionInfo | null
  embedding?: Record<string, unknown> | null
}

export type RailwayPlanResponse = {
  status: PlanStatus
  connected: boolean
  budget: number
  conflicts: Conflict[]
  notes: string[]
  reason?: string | null
  minimum_connection_cost?: number | null
  total_cost?: number | null
  total_value?: number | null
  remaining_budget?: number | null
  cost_breakdown?: { quantum: number; connectors: number; extra: number } | null
  graph?: { nodes: PlanNode[]; edges: PlanEdge[] } | null
  quantum?: QuantumStats | null
}

/**
 * Ask the API for the QAOA circuit (the server default is off to keep responses small).
 * Wrap the payload from createRailwayPlanRequest(): planRailwayNetwork(withCircuit(payload)).
 */
export function withCircuit<T extends object>(payload: T): T {
  const options = (payload as { options?: object }).options ?? {}
  return {
    ...payload,
    options: { ...options, include_circuit: true, circuit_formats: ['qasm3'] },
  } as T
}