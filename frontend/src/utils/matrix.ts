// Shared by the QUBO matrix on the page (QuboMatrix.tsx) and in the PDF (batchReport.ts).

export type Rgb = [number, number, number]

export const NEGATIVE_COLOR: Rgb = [59, 130, 246] // blue
export const POSITIVE_COLOR: Rgb = [245, 158, 11] // amber

export function matrixMaxAbs(matrix: number[][]) {
  return matrix.reduce((m, row) => row.reduce((r, v) => Math.max(r, Math.abs(v)), m), 0)
}

/** 0..1 strength of a coefficient; square-root scale so small terms stay visible next to large penalties. */
export function matrixIntensity(value: number, maxAbs: number) {
  return maxAbs > 0 ? Math.sqrt(Math.min(Math.abs(value) / maxAbs, 1)) : 0
}

export function matrixColor(value: number): Rgb {
  return value < 0 ? NEGATIVE_COLOR : POSITIVE_COLOR
}

/** Short cell text: 2112, 342.5, 36.67, -0.25 (full value goes in the tooltip). */
export function formatMatrixValue(value: number) {
  if (value === 0) return '0'
  const abs = Math.abs(value)
  const digits = abs >= 1000 ? 0 : abs >= 100 ? 1 : abs >= 1 ? 2 : 3
  return Number(value.toFixed(digits)).toString()
}
