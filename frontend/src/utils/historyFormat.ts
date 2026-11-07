import type { SavedParameters } from '../services/history'

// Formatting shared by the run history pages.

export function formatDuration(durationMs: number | null | undefined) {
  if (durationMs === null || durationMs === undefined) return '—'
  if (durationMs < 1000) return `${durationMs.toFixed(1)} ms`
  if (durationMs < 120_000) return `${(durationMs / 1000).toFixed(2)} s`
  return `${Math.floor(durationMs / 60_000)} min ${Math.round((durationMs % 60_000) / 1000)} s`
}

export function formatTimestamp(timestamp: number | string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp))
}

export function describeParameters(parameters: SavedParameters | null | undefined) {
  if (!parameters) return '—'
  const parts = [
    parameters.p != null ? `p = ${parameters.p}` : undefined,
    parameters.slack != null ? (parameters.slack ? 'slack' : 'no slack') : undefined,
    parameters.iterations != null ? `${parameters.iterations} it.` : undefined,
    parameters.shots != null ? `${parameters.shots} shots` : undefined,
    parameters.seed != null ? `seed ${parameters.seed}` : undefined,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : '—'
}

export const STATUS_LABEL: Record<string, string> = {
  ok: 'OK',
  infeasible: 'Infeasible',
  pending: 'IBM job pending',
  disconnected: 'No connected sample',
  no_valid_sample: 'No valid sample',
  error: 'Error',
}
