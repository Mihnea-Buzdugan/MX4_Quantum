import type { RailwayPlanResponse } from '../services/railwayPlannerTypes'
import type { QaoaSettings } from '../services/railwayPlanner'

// One simulation of a batch: its parameters plus what the planner returned.
export type BatchRunParams = QaoaSettings & { seed: number }

export type BatchRunState = 'queued' | 'running' | 'done' | 'failed' | 'skipped'

export type BatchRunResult = {
  index: number // 1-based simulation number
  params: BatchRunParams
  state: BatchRunState
  requestMs: number | null
  response: RailwayPlanResponse | null
  error: string | null
}

// Flat numbers for one finished run, used by the tables, charts and the PDF.
export type RunMetrics = {
  index: number
  params: BatchRunParams
  configKey: string
  status: string
  valid: boolean
  optimumFound: boolean
  totalCost: number | null
  totalValue: number | null
  optimumValue: number | null
  approximationRatio: number | null
  validSampleRate: number | null
  connectedSampleRate: number | null
  pOptimum: number | null
  qubits: number | null
  serverSeconds: number | null
  requestSeconds: number | null
  error: string | null
}

export type Summary = {
  count: number
  min: number | null
  max: number | null
  mean: number | null
  std: number | null
  median: number | null
}

export type GroupStats = {
  configKey: string
  params: Omit<BatchRunParams, 'seed'>
  runs: number
  successRate: number | null
  optimumRate: number | null
  approximationRatio: Summary
  totalValue: Summary
  validSampleRate: Summary
  connectedSampleRate: Summary
  serverSeconds: Summary
}

export type BatchStatistics = {
  runs: number
  finished: number
  failed: number
  successRate: number | null
  optimumRate: number | null
  approximationRatio: Summary
  totalValue: Summary
  totalCost: Summary
  validSampleRate: Summary
  connectedSampleRate: Summary
  pOptimum: Summary
  serverSeconds: Summary
  requestSeconds: Summary
  groups: GroupStats[]
  best: RunMetrics | null
}

export function configKey(params: Omit<BatchRunParams, 'seed'>) {
  return `p=${params.p} · ${params.slack ? 'slack' : 'no slack'} · ${params.iterations} it · ${params.shots} shots`
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function toMetrics(run: BatchRunResult, budget: number): RunMetrics {
  const r = run.response
  const q = r?.quantum
  const valid = r?.status === 'ok'
    && r.connected
    && typeof r.total_cost === 'number'
    && r.total_cost <= budget + 1e-9
  return {
    index: run.index,
    params: run.params,
    configKey: configKey(run.params),
    status: run.state === 'failed' ? 'error' : r?.status ?? run.state,
    valid,
    optimumFound: q?.optimum_found === true,
    totalCost: num(r?.total_cost),
    totalValue: num(r?.total_value),
    optimumValue: num(q?.exact_optimum_value),
    approximationRatio: num(q?.approximation_ratio),
    validSampleRate: num(q?.valid_sample_rate),
    connectedSampleRate: num(q?.connected_sample_rate),
    pOptimum: num(q?.p_optimum_qaoa),
    qubits: num(q?.qubits),
    serverSeconds: num(r?.runtime_seconds),
    requestSeconds: run.requestMs === null ? null : run.requestMs / 1000,
    error: run.error,
  }
}

export function summarize(values: Array<number | null>): Summary {
  const xs = values.filter((v): v is number => v !== null).sort((a, b) => a - b)
  if (xs.length === 0) return { count: 0, min: null, max: null, mean: null, std: null, median: null }
  const mean = xs.reduce((sum, v) => sum + v, 0) / xs.length
  // sample standard deviation (n - 1); 0 for a single run
  const variance = xs.length > 1 ? xs.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (xs.length - 1) : 0
  const mid = Math.floor(xs.length / 2)
  return {
    count: xs.length,
    min: xs[0],
    max: xs[xs.length - 1],
    mean,
    std: Math.sqrt(variance),
    median: xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2,
  }
}

function rate(flags: boolean[]): number | null {
  return flags.length === 0 ? null : flags.filter(Boolean).length / flags.length
}

export function computeStatistics(runs: BatchRunResult[], budget: number): BatchStatistics {
  const finishedRuns = runs.filter((run) => run.state === 'done')
  const metrics = finishedRuns.map((run) => toMetrics(run, budget))
  const byConfig = new Map<string, RunMetrics[]>()
  for (const m of metrics) {
    byConfig.set(m.configKey, [...(byConfig.get(m.configKey) ?? []), m])
  }
  const groups: GroupStats[] = [...byConfig.entries()].map(([key, items]) => {
    const { p, slack, iterations, shots } = items[0].params
    return {
      configKey: key,
      params: { p, slack, iterations, shots },
      runs: items.length,
      successRate: rate(items.map((m) => m.valid)),
      optimumRate: rate(items.map((m) => m.optimumFound)),
      approximationRatio: summarize(items.map((m) => m.approximationRatio)),
      totalValue: summarize(items.map((m) => (m.valid ? m.totalValue : null))),
      validSampleRate: summarize(items.map((m) => m.validSampleRate)),
      connectedSampleRate: summarize(items.map((m) => m.connectedSampleRate)),
      serverSeconds: summarize(items.map((m) => m.serverSeconds)),
    }
  })
  const validRuns = metrics.filter((m) => m.valid)
  const best = validRuns.reduce<RunMetrics | null>(
    (top, m) => (top === null || (m.totalValue ?? -Infinity) > (top.totalValue ?? -Infinity) ? m : top),
    null,
  )
  return {
    runs: runs.length,
    finished: finishedRuns.length,
    failed: runs.filter((run) => run.state === 'failed').length,
    successRate: rate(metrics.map((m) => m.valid)),
    optimumRate: rate(metrics.map((m) => m.optimumFound)),
    approximationRatio: summarize(metrics.map((m) => m.approximationRatio)),
    totalValue: summarize(validRuns.map((m) => m.totalValue)),
    totalCost: summarize(validRuns.map((m) => m.totalCost)),
    validSampleRate: summarize(metrics.map((m) => m.validSampleRate)),
    connectedSampleRate: summarize(metrics.map((m) => m.connectedSampleRate)),
    pOptimum: summarize(metrics.map((m) => m.pOptimum)),
    serverSeconds: summarize(metrics.map((m) => m.serverSeconds)),
    requestSeconds: summarize(metrics.map((m) => m.requestSeconds)),
    groups,
    best,
  }
}

export function fmt(value: number | null | undefined, digits = 3) {
  return value === null || value === undefined ? '—' : Number(value.toFixed(digits)).toString()
}

export function pct(value: number | null | undefined, digits = 1) {
  return value === null || value === undefined ? '—' : `${(value * 100).toFixed(digits)}%`
}

export function meanStd(summary: Summary, digits = 3, asPercent = false) {
  if (summary.mean === null) return '—'
  const f = (v: number | null) => (asPercent ? pct(v, 1) : fmt(v, digits))
  return summary.count > 1 ? `${f(summary.mean)} ± ${f(summary.std)}` : f(summary.mean)
}
