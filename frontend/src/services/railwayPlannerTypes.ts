// Response types for the new railway planner API (see schemas.py: SolveResponse).
// Optional fields may arrive as null (pydantic) or be absent, so check with `!= null`.

export type PathId = number | string

export type PlanStatus = 'ok' | 'infeasible' | 'pending' | 'disconnected' | 'no_valid_sample'

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
  shots?: number | null
  cobyla_maxiter?: number | null
  valid_sample_rate?: number | null
  connected_sample_rate?: number | null
  approximation_ratio?: number | null
  optimum_found?: boolean | null
  p_optimum_qaoa?: number | null
  mode?: string | null
  p_valid_uniform?: number | null
  p_valid_qaoa?: number | null
  p_connected_qaoa?: number | null
  top_samples?: Array<{
    routes: PathId[]
    count: number
    value: number
    cost: number
    valid: boolean
    connected: boolean
  }> | null
  reference_optimum?: { routes: PathId[]; value: number; cost: number; note?: string } | null
  timing?: { penalty_tuning_seconds?: number; training_seconds?: number; sampling_seconds?: number } | null
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
    budget_encoding?: string
    lam?: number
    lam1?: number
    lam2?: number
    beta?: number
    budget_units?: number
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
    warm_start?: string
    selected?: { strategy?: string; start?: string; layers?: number }
    training?: Array<{
      strategy?: string
      layers?: number
      start?: string
      start_energy?: number
      energy?: number
      evaluations?: number
      gammas?: number[]
      betas?: number[]
      selected?: boolean
    }>
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
    matrix?: number[][]
    matrix_variables?: string[]
    matrix_convention?: string
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
  // Id of the saved plan, added by Django when the user is logged in.
  plan_id?: number
  conflicts: Conflict[]
  notes: string[]
  reason?: string | null
  minimum_connection_cost?: number | null
  total_cost?: number | null
  total_value?: number | null
  remaining_budget?: number | null
  runtime_seconds?: number | null
  cost_breakdown?: { quantum: number; connectors: number; extra: number } | null
  graph?: { nodes: PlanNode[]; edges: PlanEdge[] } | null
  quantum?: QuantumStats | null
}