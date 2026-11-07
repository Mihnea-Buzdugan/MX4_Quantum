import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { Check, Copy, Download } from 'lucide-react'
import type { Conflict, PathId, QuantumStats } from '../services/railwayPlannerTypes'
import './QuantumDetails.css'
import QuboMatrix from './QuboMatrix'
import { CIRCUIT_LEFT, CIRCUIT_ROW, CIRCUIT_STEP, CIRCUIT_TOP, GATE_COLOR, GATE_LABEL, layoutGates, MAX_DRAWN_GATES, parseQasm3, qubitLabels } from '../utils/qasm'

type Props = {
  stats: QuantumStats | null | undefined
  conflicts?: Conflict[]
  /** route id -> "From → To", used to label qubits and conflicts */
  routeName: (id: PathId) => string
}

type TabId = 'circuit' | 'variables' | 'penalties' | 'qubo' | 'ising' | 'angles' | 'execution' | 'conflicts'

const fmt = (v: unknown, digits = 4): string => {
  if (typeof v === 'number') return Number.isFinite(v) ? Number(v.toFixed(digits)).toString() : String(v)
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  if (v === null || v === undefined) return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function KV({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="qd-kv">
      {rows.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>
      ))}
    </dl>
  )
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="qd-table-wrap">
      <table className="qd-table">
        <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}

// ----------------------------------------------------------------------------- circuit drawing
const STEP = CIRCUIT_STEP
const ROW = CIRCUIT_ROW
const LEFT = CIRCUIT_LEFT
const TOP = CIRCUIT_TOP

// Also rendered off-screen by the batch PDF so the report shows the very same drawing.
export function CircuitDiagram({ qasm, labels }: { qasm: string; labels: string[] }) {
  const parsed = useMemo(() => parseQasm3(qasm), [qasm])
  const { placed, cols } = useMemo(() => layoutGates(parsed.n, parsed.gates), [parsed])

  if (parsed.n === 0 || parsed.gates.length === 0) return <p className="qd-note">The QASM text could not be drawn.</p>
  if (parsed.gates.length > MAX_DRAWN_GATES) {
    return <p className="qd-note">{parsed.gates.length} gates is too many to draw; use the QASM text below.</p>
  }

  const width = LEFT + cols * STEP + 24
  const height = TOP * 2 + (parsed.n - 1) * ROW + 10
  const y = (q: number) => TOP + q * ROW

  return (
    <div className="qd-scroll">
      <svg width={width} height={height} role="img" aria-label="QAOA circuit">
        {Array.from({ length: parsed.n }, (_, q) => (
          <g key={q}>
            <text x={8} y={y(q) + 4} fontSize={11}>{labels[q] ?? `q${q}`}</text>
            <line x1={LEFT - 8} x2={width - 8} y1={y(q)} y2={y(q)} stroke="currentColor" strokeOpacity={0.3} />
          </g>
        ))}
        {placed.map((g, i) => {
          const cx = LEFT + g.col * STEP + STEP / 2
          const color = GATE_COLOR[g.kind]
          const title = g.angle !== undefined ? `${g.kind}(${g.angle.toFixed(4)}) on ${g.qubits.map((q) => `q${q}`).join(', ')}` : `${g.kind} on q${g.qubits[0]}`
          const box = (q: number) => (
            <g key={q}>
              <rect x={cx - 14} y={y(q) - 10} width={28} height={20} rx={4} fill={color} fillOpacity={0.22} stroke={color} />
              <text x={cx} y={y(q) + 4} fontSize={10} textAnchor="middle">{GATE_LABEL[g.kind]}</text>
            </g>
          )
          return (
            <g key={i}>
              <title>{title}</title>
              {g.kind === 'rzz' && <line x1={cx} x2={cx} y1={y(g.lo)} y2={y(g.hi)} stroke={color} strokeWidth={1.5} />}
              {g.qubits.map(box)}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function CircuitTab({ stats, labels }: { stats: QuantumStats; labels: string[] }) {
  const circuit = stats.circuit
  const [copied, setCopied] = useState(false)
  const qasm = circuit?.qasm3 ?? ''

  if (!circuit) {
    return <p className="qd-note">No circuit in the response. Send <code>options.include_circuit = true</code> with the request.</p>
  }
  if (circuit.error) return <p className="qd-error">{circuit.error}</p>

  const copy = async () => {
    await navigator.clipboard.writeText(qasm)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }
  const download = () => {
    const url = URL.createObjectURL(new Blob([qasm], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'qaoa-circuit.qasm'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <div className="qd-chips">
        {circuit.num_qubits != null && <span className="qd-chip">{circuit.num_qubits} qubits</span>}
        {circuit.depth != null && <span className="qd-chip">depth {circuit.depth}</span>}
        {circuit.two_qubit_gates != null && <span className="qd-chip">{circuit.two_qubit_gates} two-qubit gates</span>}
        {stats.layers != null && <span className="qd-chip">{stats.layers} QAOA layer{stats.layers === 1 ? '' : 's'}</span>}
        {Object.entries(circuit.gate_counts ?? {}).filter(([k]) => k !== 'barrier').map(([k, v]) => (
          <span className="qd-chip" key={k}>{k}: {v}</span>
        ))}
      </div>
      {qasm ? (
        <>
          <div className="qd-legend">
            <span><i style={{ background: GATE_COLOR.h }} />Hadamard</span>
            <span><i style={{ background: GATE_COLOR.rz }} />Rz / Rzz (cost, γ)</span>
            <span><i style={{ background: GATE_COLOR.rx }} />Rx (mixer, β)</span>
            <span><i style={{ background: GATE_COLOR.measure }} />Measure</span>
            <span>hover a gate for its angle</span>
          </div>
          <CircuitDiagram qasm={qasm} labels={labels} />
          <div className="qd-actions">
            <button type="button" className="qd-btn" onClick={() => void copy()}>
              {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy QASM'}
            </button>
            <button type="button" className="qd-btn" onClick={download}><Download size={13} /> Download .qasm</button>
          </div>
          <details className="qd-details">
            <summary>OpenQASM 3 source</summary>
            <pre className="qd-pre">{qasm}</pre>
          </details>
        </>
      ) : <p className="qd-note">The circuit statistics were returned without QASM (request format <code>qasm3</code>).</p>}
      {circuit.qasm2 && <details className="qd-details"><summary>OpenQASM 2 source</summary><pre className="qd-pre">{circuit.qasm2}</pre></details>}
      {circuit.qasm3_parameterized && <details className="qd-details"><summary>Parameterized OpenQASM 3</summary><pre className="qd-pre">{circuit.qasm3_parameterized}</pre></details>}
      {circuit.bit_order && <p className="qd-note">{circuit.bit_order}</p>}
    </>
  )
}

// ----------------------------------------------------------------------------- other tabs
function coefRows(obj: Record<string, number> | undefined): ReactNode[][] {
  return Object.entries(obj ?? {}).map(([k, v]) => [k, fmt(v)])
}

function QuboTab({ qubo, describe }: { qubo: NonNullable<QuantumStats['qubo']>; describe?: (name: string) => string | undefined }) {
  return (
    <>
      <KV rows={[
        ['Offset', fmt(qubo.offset)],
        ['Energy range', qubo.energy_range ? `${fmt(qubo.energy_range[0])} … ${fmt(qubo.energy_range[1])}` : undefined],
        ['Linear terms', qubo.linear ? Object.keys(qubo.linear).length : undefined],
        ['Quadratic terms', qubo.quadratic ? Object.keys(qubo.quadratic).length : undefined],
      ]} />
      {qubo.formula && <><h4>Formula</h4><pre className="qd-pre">{qubo.formula}</pre></>}
      {qubo.formula_expanded && <details className="qd-details"><summary>Expanded formula</summary><pre className="qd-pre">{qubo.formula_expanded}</pre></details>}
      {qubo.formula_latex && <details className="qd-details"><summary>LaTeX</summary><pre className="qd-pre">{qubo.formula_latex}</pre></details>}
      {qubo.linear && <details className="qd-details"><summary>Linear coefficients</summary><Table head={['Variable', 'Coefficient']} rows={coefRows(qubo.linear)} /></details>}
      {qubo.quadratic && <details className="qd-details"><summary>Quadratic coefficients</summary><Table head={['Pair', 'Coefficient']} rows={coefRows(qubo.quadratic)} /></details>}
      {qubo.matrix && qubo.matrix.length > 0 && (
        <details className="qd-details" open>
          <summary>QUBO matrix ({qubo.matrix.length} × {qubo.matrix.length})</summary>
          <QuboMatrix
            matrix={qubo.matrix}
            names={qubo.matrix_variables ?? qubo.matrix.map((_, i) => `q${i}`)}
            describe={describe}
            convention={qubo.matrix_convention}
          />
        </details>
      )}
    </>
  )
}

function IsingTab({ ising }: { ising: NonNullable<QuantumStats['ising']> }) {
  return (
    <>
      <KV rows={[['Constant', fmt(ising.constant)], ['Scale', fmt(ising.scale)]]} />
      <p className="qd-note">y<sub>i</sub> = (1 − Z<sub>i</sub>) / 2; the circuit applies exp(−iγ(H − constant)/scale).</p>
      {ising.formula && <pre className="qd-pre">{ising.formula}</pre>}
      {ising.formula_latex && <details className="qd-details"><summary>LaTeX</summary><pre className="qd-pre">{ising.formula_latex}</pre></details>}
      {ising.h && <details className="qd-details"><summary>Fields h</summary><Table head={['Term', 'Value']} rows={coefRows(ising.h)} /></details>}
      {ising.J && <details className="qd-details"><summary>Couplings J</summary><Table head={['Term', 'Value']} rows={coefRows(ising.J)} /></details>}
    </>
  )
}

function AnglesTab({ angles }: { angles: NonNullable<QuantumStats['angles']> }) {
  const g = angles.gammas ?? []
  const b = angles.betas ?? []
  return (
    <>
      <KV rows={[
        ['Optimiser', angles.optimizer ? `${angles.optimizer.method} · rhobeg ${angles.optimizer.rhobeg} · maxiter ${angles.optimizer.maxiter}` : undefined],
      ]} />
      <Table head={['Layer', 'γ (cost)', 'β (mixer)']} rows={g.map((gamma, i) => [i + 1, fmt(gamma, 6), fmt(b[i], 6)])} />
      {angles.training && angles.training.length > 0 && (
        <>
          <h4>Optimiser runs (COBYLA)</h4>
          <Table
            head={['Strategy', 'Layers', 'Start', 'Start energy', 'Final energy', 'Evaluations', 'Selected']}
            rows={angles.training.map((t) => [t.strategy ?? '—', t.layers ?? '—', t.start ?? '—', fmt(t.start_energy), fmt(t.energy), t.evaluations ?? '—', t.selected ? '✓' : ''])}
          />
        </>
      )}
      {angles.starts && angles.starts.length > 0 && (
        <>
          <h4>Optimiser starts</h4>
          <Table
            head={['Start', 'Energy', 'Evaluations', 'Final γ', 'Final β', 'Selected']}
            rows={angles.starts.map((s) => [s.kind, fmt(s.energy), s.evaluations, s.final_gammas.join(', '), s.final_betas.join(', '), s.selected ? '✓' : ''])}
          />
        </>
      )}
    </>
  )
}

function ExecutionTab({ stats }: { stats: QuantumStats }) {
  const ex = stats.execution
  if (!ex) return null
  const { candidates, ...rest } = ex
  return (
    <>
      <KV rows={Object.entries(rest).map(([k, v]) => [k.replaceAll('_', ' '), k === 'estimated_success' && typeof v === 'number' ? `${(v * 100).toFixed(2)}%` : fmt(v)])} />
      {candidates && (
        <>
          <h4>Compiled layouts tried</h4>
          <Table
            head={['Layout', 'Two-qubit gates', 'Estimated success']}
            rows={Object.entries(candidates).map(([k, c]) => [k, c.two_qubit_gates, `${(c.estimated_success * 100).toFixed(2)}%`])}
          />
        </>
      )}
    </>
  )
}

// ----------------------------------------------------------------------------- panel
export default function QuantumDetails({ stats, conflicts = [], routeName }: Props) {
  const tabs = useMemo(() => {
    const t: Array<{ id: TabId; label: string }> = []
    if (stats?.circuit || stats?.qubits) t.push({ id: 'circuit', label: 'Circuit' })
    if (stats?.variables) t.push({ id: 'variables', label: 'Variables' })
    if (stats?.penalties) t.push({ id: 'penalties', label: 'Penalties' })
    if (stats?.qubo) t.push({ id: 'qubo', label: 'QUBO' })
    if (stats?.ising) t.push({ id: 'ising', label: 'Ising' })
    if (stats?.angles) t.push({ id: 'angles', label: 'Angles' })
    if (stats?.execution) t.push({ id: 'execution', label: 'Execution' })
    if (conflicts.length > 0) t.push({ id: 'conflicts', label: `Conflicts (${conflicts.length})` })
    return t
  }, [stats, conflicts.length])

  const [chosen, setChosen] = useState<TabId>('circuit')

  // qubit i holds variable i: x{i} = route, s{k} = slack bit
  const labels = useMemo(() => (stats ? qubitLabels(stats, routeName) : []), [stats, routeName])
  const describeVariable = useCallback((name: string) => {
    const v = stats?.variables?.[name]
    if (v === undefined) return undefined
    return name.startsWith('x') ? routeName(v) : String(v)
  }, [stats, routeName])

  if (!stats || tabs.length === 0) return null
  const active = tabs.some((t) => t.id === chosen) ? chosen : tabs[0].id

  return (
    <section className="panel qd-panel" aria-label="Quantum details">
      <div className="qd-header">
        <div>
          <h2>Quantum details</h2>
          <p>Circuit and intermediate results returned by the planner{stats.sampler ? ` · sampled with ${stats.sampler}` : ''}</p>
        </div>
      </div>
      <div className="qd-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={active === t.id}
            className={`qd-tab ${active === t.id ? 'qd-tab-active' : ''}`} onClick={() => setChosen(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {active === 'circuit' && <CircuitTab stats={stats} labels={labels} />}

      {active === 'variables' && stats.variables && (
        <Table head={['Qubit', 'Variable', 'Meaning']} rows={Object.entries(stats.variables).map(([name, v], i) => [
          `q${i}`, name, name.startsWith('x') ? `route ${v} (${routeName(v)})` : String(v),
        ])} />
      )}

      {active === 'penalties' && stats.penalties && (
        <>
          <KV rows={[
            ['λ (budget penalty)', fmt(stats.penalties.lam)],
            ['μ (conflict penalty)', fmt(stats.penalties.mu)],
            ['Slack weights', stats.penalties.slack_weights?.join(', ')],
            ['Quantum budget (integer units)', fmt(stats.penalties.quantum_budget_units)],
            ['Cost unit scale', fmt(stats.penalties.cost_unit_scale)],
            ['Quantum budget', fmt(stats.quantum_budget)],
          ]} />
          {stats.penalties.lam_ladder && (
            <>
              <h4>λ ladder (every energy minimum feasible?)</h4>
              <Table head={['λ', 'Feasible']} rows={Object.entries(stats.penalties.lam_ladder).map(([k, v]) => [k, v ? '✓' : '✗'])} />
            </>
          )}
        </>
      )}

      {active === 'qubo' && stats.qubo && <QuboTab qubo={stats.qubo} describe={describeVariable} />}
      {active === 'ising' && stats.ising && <IsingTab ising={stats.ising} />}
      {active === 'angles' && stats.angles && <AnglesTab angles={stats.angles} />}
      {active === 'execution' && <ExecutionTab stats={stats} />}

      {active === 'conflicts' && (
        <Table
          head={['Route A', 'Route B', 'Type', 'Where']}
          rows={conflicts.map((c) => [
            routeName(c.paths[0]), routeName(c.paths[1]), c.type,
            c.at ? `${c.at[0].toFixed(3)}°E, ${c.at[1].toFixed(3)}°N`
              : c.distance_km != null ? `${fmt(c.distance_km)} km apart`
                : c.distance != null ? `${fmt(c.distance)} apart` : '—',
          ])}
        />
      )}
    </section>
  )
}