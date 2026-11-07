import type { PathId, QuantumStats } from '../services/railwayPlannerTypes'

// Shared by the circuit drawing on the page (Quantumdetails.tsx) and in the PDF (batchReport.ts).
// Circuit drawing geometry in px (CircuitDiagram in Quantumdetails.tsx); the PDF slices the
// drawing at gate-column boundaries using the same numbers.
export const CIRCUIT_STEP = 36
export const CIRCUIT_ROW = 36
export const CIRCUIT_LEFT = 180 // room for the longest wire label (x0 · 18 characters)
export const CIRCUIT_TOP = 16
export const MAX_DRAWN_GATES = 1500

export type GateKind = 'h' | 'rz' | 'rx' | 'rzz' | 'measure'
export type Gate = { kind: GateKind; qubits: number[]; angle?: number }
export type Placed = Gate & { col: number; lo: number; hi: number }

export const GATE_COLOR: Record<GateKind, string> = {
  h: '#3b82f6',
  rz: '#a855f7',
  rzz: '#a855f7',
  rx: '#f59e0b',
  measure: '#9ca3af',
}
export const GATE_LABEL: Record<GateKind, string> = { h: 'H', rz: 'Rz', rzz: 'ZZ', rx: 'Rx', measure: 'M' }

/** Reads the OpenQASM 3 text produced by the planner (h, rz, rx, rzz, measure on q[i]). */
export function parseQasm3(src: string): { n: number; gates: Gate[] } {
  const gates: Gate[] = []
  let n = Number(/qubit\[(\d+)\]\s+q\s*;/.exec(src)?.[1] ?? 0)
  for (const raw of src.split('\n')) {
    const line = raw.trim()
    const m = /^meas\[\d+\]\s*=\s*measure\s+q\[(\d+)\]/.exec(line)
    if (m) {
      gates.push({ kind: 'measure', qubits: [Number(m[1])] })
      continue
    }
    const g = /^(h|rz|rx|rzz)(?:\(([^)]*)\))?\s+(.+);$/.exec(line)
    if (!g) continue
    const qubits = [...g[3].matchAll(/q\[(\d+)\]/g)].map((x) => Number(x[1]))
    if (qubits.length === 0) continue // inside the "gate rzz ..." definition
    const angle = g[2] !== undefined ? Number(g[2]) : undefined
    gates.push({ kind: g[1] as GateKind, qubits, angle: Number.isFinite(angle) ? angle : undefined })
  }
  if (!n) n = gates.reduce((m, g) => Math.max(m, ...g.qubits), -1) + 1
  return { n, gates }
}

export function layoutGates(n: number, gates: Gate[]): { placed: Placed[]; cols: number } {
  const free = new Array<number>(n).fill(0)
  const placed: Placed[] = []
  for (const g of gates.filter((x) => x.kind !== 'measure')) {
    const lo = Math.min(...g.qubits)
    const hi = Math.max(...g.qubits)
    let col = 0
    for (let q = lo; q <= hi; q++) col = Math.max(col, free[q])
    for (let q = lo; q <= hi; q++) free[q] = col + 1
    placed.push({ ...g, col, lo, hi })
  }
  const measureCol = Math.max(0, ...free)
  for (const g of gates.filter((x) => x.kind === 'measure')) {
    placed.push({ ...g, col: measureCol, lo: g.qubits[0], hi: g.qubits[0] })
  }
  return { placed, cols: measureCol + 1 }
}


/** Wire labels: qubit i holds variable i (x{i} = route, s{k} = slack bit). */
export function qubitLabels(stats: QuantumStats, routeName: (id: PathId) => string, maxLength = 18): string[] {
  const nq = stats.qubits ?? 0
  const nr = stats.route_qubits ?? nq
  return Array.from({ length: nq }, (_, i) => {
    const name = i < nr ? `x${i}` : `s${i - nr}`
    const v = stats.variables?.[name]
    if (v === undefined) return `q${i} · ${name}`
    const text = i < nr ? routeName(v) : String(v)
    return `${name} · ${text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text}`
  })
}
