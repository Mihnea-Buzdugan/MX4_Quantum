import { routes } from '../data/routes'
import type { IntermediateLogEntry } from '../components/IntermediateLog'
import type { Conflict, PathId, RailwayPlanResponse } from '../services/railwayPlannerTypes'

// The "intermediate data" entries shown for a planner response (Dashboard, batch page and batch PDF).

export function formatNumber(value: number | null | undefined) {
  return value === undefined || value === null ? '—' : Number(value.toFixed(3)).toString()
}

export function formatList(values: number[] | undefined) {
  return values && values.length > 0 ? `[${values.map((v) => Number(v.toFixed(4))).join(', ')}]` : '—'
}

export function routeName(id: PathId) {
  const route = routes.find((r) => String(r.id) === String(id))
  return route ? `${route.from} → ${route.to}` : `route ${id}`
}

export function describeConflict(conflict: Conflict) {
  const pair = conflict.paths.map(routeName).join(' ↔ ')
  let where = ''
  if (conflict.type === 'too_close') {
    const km = conflict.distance_km
    where = km != null ? ` · ${formatNumber(km)} km apart` : conflict.distance != null ? ` · ${formatNumber(conflict.distance)} apart` : ''
  } else if (conflict.at) {
    where = ` · at ${conflict.at[0].toFixed(3)}, ${conflict.at[1].toFixed(3)}`
  }
  return `${pair} (${conflict.type}${where})`
}

export function makeResponseEntries(response: RailwayPlanResponse): IntermediateLogEntry[] {
  const entries: IntermediateLogEntry[] = [
    {
      label: 'Planner result',
      message: response.status === 'ok'
        ? `Connected network returned within the ${formatNumber(response.budget)} budget.`
        : response.reason ?? 'The selected network cannot be completed within the available budget.',
    },
  ]

  if (response.status === 'infeasible' && typeof response.minimum_connection_cost === 'number') {
    entries.push({
      label: 'Minimum connection cost',
      message: formatNumber(response.minimum_connection_cost),
    })
  }

  const stats = response.quantum
  if (stats) {
    const layers = stats.layers ?? stats.depth
    entries.push({
      label: 'QAOA configuration',
      message: [
        stats.sampler ?? (stats.skipped ? 'Skipped' : undefined),
        stats.qubits != null ? `${stats.qubits} qubits` : undefined,
        stats.route_qubits != null && stats.slack_qubits != null
          ? `${stats.route_qubits} route + ${stats.slack_qubits} slack` : undefined,
        layers != null ? `p = ${layers}` : undefined,
        stats.penalties?.budget_encoding,
        stats.cobyla_maxiter != null ? `${stats.cobyla_maxiter} COBYLA iterations` : undefined,
        stats.shots != null ? `${stats.shots} shots` : undefined,
      ].filter(Boolean).join(' · ') || stats.reason || 'Diagnostics returned.',
    })
    if (typeof stats.quantum_budget === 'number') {
      entries.push({ label: 'Quantum budget', message: formatNumber(stats.quantum_budget) })
    }
    if (stats.penalties) {
      const pen = stats.penalties
      entries.push({
        label: 'Penalty weights',
        message: [
          pen.budget_encoding,
          pen.lam != null ? `λ ${formatNumber(pen.lam)}` : undefined,
          pen.lam1 != null ? `λ₁ ${formatNumber(pen.lam1)}` : undefined,
          pen.lam2 != null ? `λ₂ ${formatNumber(pen.lam2)}` : undefined,
          pen.mu != null ? `μ (conflicts) ${formatNumber(pen.mu)}` : undefined,
          pen.beta != null ? `β (city cover) ${formatNumber(pen.beta)}` : undefined,
          pen.slack_weights && pen.slack_weights.length > 0 ? `slack weights ${pen.slack_weights.join(', ')}` : undefined,
          pen.budget_units != null ? `budget ${pen.budget_units} units` : undefined,
        ].filter(Boolean).join(' · '),
      })
    }
    if (stats.angles) {
      entries.push({
        label: 'Optimised angles',
        message: `γ ${formatList(stats.angles.gammas)} · β ${formatList(stats.angles.betas)}`,
      })
    }
    const training = stats.angles?.training ?? []
    if (training.length > 0) {
      const selected = stats.angles?.selected
      entries.push({
        label: 'Angle training (COBYLA)',
        message: `${training.length} optimiser run${training.length === 1 ? '' : 's'}, ${training.reduce((sum, t) => sum + (t.evaluations ?? 0), 0)} energy evaluations`
          + (stats.angles?.warm_start ? ` · warm start ${stats.angles.warm_start}` : '')
          + (selected ? ` · selected ${[selected.strategy, selected.start].filter(Boolean).join(' / ')}` : ''),
      })
      training.forEach((t, k) => {
        entries.push({
          label: `Optimiser run ${k + 1}${t.selected ? ' (selected)' : ''}`,
          message: [
            t.strategy,
            t.layers != null ? `p = ${t.layers}` : undefined,
            t.start ? `start ${t.start}` : undefined,
            t.start_energy != null ? `E ${formatNumber(t.start_energy)} → ${formatNumber(t.energy)}` : t.energy != null ? `E ${formatNumber(t.energy)}` : undefined,
            t.evaluations != null ? `${t.evaluations} evaluations` : undefined,
            t.gammas ? `γ ${formatList(t.gammas)}` : undefined,
            t.betas ? `β ${formatList(t.betas)}` : undefined,
          ].filter(Boolean).join(' · '),
        })
      })
    }
    if (stats.circuit && !stats.circuit.error) {
      entries.push({
        label: 'QAOA circuit',
        message: [
          stats.circuit.num_qubits != null ? `${stats.circuit.num_qubits} qubits` : undefined,
          stats.circuit.depth != null ? `depth ${stats.circuit.depth}` : undefined,
          stats.circuit.two_qubit_gates != null ? `${stats.circuit.two_qubit_gates} two-qubit gates` : undefined,
        ].filter(Boolean).join(' · ') || 'Circuit returned.',
      })
    }
    if (typeof stats.expected_energy === 'number') {
      entries.push({ label: 'Expected energy', message: formatNumber(stats.expected_energy) })
    }
    if (typeof stats.feasible_sample_rate === 'number') {
      entries.push({
        label: 'Feasible sample rate',
        message: `${(stats.feasible_sample_rate * 100).toFixed(2)}%`,
      })
    }
    if (typeof stats.p_feasible_qaoa === 'number') {
      entries.push({
        label: 'QAOA feasible probability',
        message: `${(stats.p_feasible_qaoa * 100).toFixed(2)}%${typeof stats.p_feasible_uniform === 'number' ? ` (uniform ${(stats.p_feasible_uniform * 100).toFixed(2)}%)` : ''}`,
      })
    }
    const probability = (label: string, value: number | null | undefined, uniform?: number | null) => {
      if (typeof value === 'number') {
        entries.push({
          label,
          message: `${(value * 100).toFixed(2)}%${typeof uniform === 'number' ? ` (uniform ${(uniform * 100).toFixed(2)}%)` : ''}`,
        })
      }
    }
    probability('P(valid) of the QAOA state', stats.p_valid_qaoa, stats.p_valid_uniform)
    probability('P(connected) of the QAOA state', stats.p_connected_qaoa)
    probability('P(optimum) of the QAOA state', stats.p_optimum_qaoa)
    probability('Valid sample rate', stats.valid_sample_rate)
    probability('Connected sample rate', stats.connected_sample_rate)
    if (typeof stats.best_sampled_value === 'number') {
      entries.push({ label: 'Best sampled value', message: formatNumber(stats.best_sampled_value) })
    }
    if (typeof stats.exact_optimum_value === 'number') {
      entries.push({ label: 'Exact optimum value', message: formatNumber(stats.exact_optimum_value) })
    }

    if (typeof stats.approximation_ratio === 'number') {
      entries.push({
        label: 'Approximation ratio',
        message: `${formatNumber(stats.approximation_ratio)}${stats.optimum_found ? ' · exact optimum found' : ''}`,
      })
    }
    if (stats.reference_optimum) {
      entries.push({
        label: 'Reference optimum (exhaustive check)',
        message: `value ${formatNumber(stats.reference_optimum.value)} · cost ${formatNumber(stats.reference_optimum.cost)} · ${stats.reference_optimum.routes.map(routeName).join(', ')}`,
      })
    }
    ;(stats.top_samples ?? []).forEach((sample, k) => {
      entries.push({
        label: `Top sample ${k + 1}`,
        message: `${sample.count} shots · value ${formatNumber(sample.value)} · cost ${formatNumber(sample.cost)} · ${sample.valid ? 'valid' : 'invalid'}${sample.valid ? (sample.connected ? ', connected' : ', not connected') : ''} · ${sample.routes.length ? sample.routes.map(routeName).join(', ') : 'no routes'}`,
      })
    })
    if (stats.timing) {
      entries.push({
        label: 'Planner timing',
        message: [
          stats.timing.penalty_tuning_seconds != null ? `penalty tuning ${formatNumber(stats.timing.penalty_tuning_seconds)} s` : undefined,
          stats.timing.training_seconds != null ? `angle training ${formatNumber(stats.timing.training_seconds)} s` : undefined,
          stats.timing.sampling_seconds != null ? `sampling ${formatNumber(stats.timing.sampling_seconds)} s` : undefined,
        ].filter(Boolean).join(' · '),
      })
    }

    const ex = stats.execution
    if (ex) {
      entries.push({
        label: 'Hardware execution',
        message: [
          ex.backend,
          ex.status ? `status ${ex.status}` : undefined,
          ex.shots != null ? `${ex.shots} shots` : undefined,
          ex.job_id ? `job ${ex.job_id}` : undefined,
          ex.layout_method ? `${ex.layout_method} layout` : undefined,
          ex.isa_depth != null ? `compiled depth ${ex.isa_depth}` : undefined,
          ex.isa_two_qubit_gates != null ? `${ex.isa_two_qubit_gates} two-qubit gates` : undefined,
          typeof ex.estimated_success === 'number' ? `estimated success ${(ex.estimated_success * 100).toFixed(2)}%` : undefined,
          ex.quantum_seconds != null ? `${formatNumber(ex.quantum_seconds)} s QPU time` : undefined,
          ex.error,
        ].filter(Boolean).join(' · '),
      })
    }
  }

  if (response.cost_breakdown) {
    entries.push({
      label: 'Cost breakdown',
      message: `Quantum ${formatNumber(response.cost_breakdown.quantum)} · connectors ${formatNumber(response.cost_breakdown.connectors)} · extra ${formatNumber(response.cost_breakdown.extra)}`,
    })
  }

  const conflicts = response.conflicts ?? []
  if (conflicts.length > 0) {
    entries.push({
      label: `Route conflicts (${conflicts.length})`,
      message: conflicts.map(describeConflict).join('; '),
    })
  }

  for (const note of response.notes ?? []) {
    entries.push({ label: 'Planner note', message: note })
  }

  for (const edge of response.graph?.edges ?? []) {
    entries.push({
      label: `${edge.stage} route`,
      message: `${edge.from} → ${edge.to} · cost ${formatNumber(edge.cost)} · reward +${formatNumber(edge.value)}`,
    })
  }

  return entries
}
