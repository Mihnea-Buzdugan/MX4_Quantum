import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import {
  fmt,
  meanStd,
  pct,
  toMetrics,
  type BatchRunResult,
  type BatchStatistics,
  type RunMetrics,
} from './batchStats'
import { makeResponseEntries, routeName } from './planLog'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CircuitDiagram } from '../components/Quantumdetails'
import { formatMatrixValue, matrixColor, matrixIntensity, matrixMaxAbs } from './matrix'
import { CIRCUIT_LEFT, CIRCUIT_STEP, GATE_COLOR, layoutGates, parseQasm3, qubitLabels } from './qasm'

export type BatchReportSetup = {
  algorithm: string
  budget: number
  nodes: string[]
  routes: string[]
  startedAt: number
  finishedAt: number | null
}

// The built-in PDF fonts only cover Latin-1: drop diacritics (ș -> s, ă -> a) and swap symbols.
const SYMBOLS: Record<string, string> = {
  'λ': 'lambda', 'μ': 'mu', 'β': 'beta', 'γ': 'gamma', 'Σ': 'sum', '₀': '0', '₁': '1', '₂': '2', '₃': '3',
  '↔': '<->', '≤': '<=', '≥': '>=', '≈': '~', '×': 'x', '÷': '/', '…': '...', '✓': 'yes', '✗': 'no', '−': '-',
}

function ascii(text: string) {
  return text
    .replace(/[λμβγΣ₀₁₂₃↔≤≥≈×÷…✓✗−]/g, (ch) => SYMBOLS[ch] ?? ch)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/→/g, '->')
    .replace(/±/g, '+/-')
    .replace(/[·•]/g, '|')
    .replace(/—/g, '-')
    .replace(/[^\x20-\x7e]/g, '')
}

const INK: [number, number, number] = [24, 32, 44]
const MUTED: [number, number, number] = [110, 120, 135]
const ACCENT: [number, number, number] = [8, 145, 178]
const GOOD: [number, number, number] = [22, 163, 74]
const BAD: [number, number, number] = [220, 38, 38]

type Doc = jsPDF & { lastAutoTable?: { finalY: number } }

function heading(doc: Doc, text: string, y: number) {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(...INK)
  doc.text(ascii(text), 14, y)
  return y + 3
}

function ensureSpace(doc: Doc, y: number, needed: number) {
  if (y + needed > doc.internal.pageSize.getHeight() - 16) {
    doc.addPage()
    return 18
  }
  return y
}

// Bar chart of one metric per run (bars coloured by valid / invalid plan).
function barChart(
  doc: Doc,
  y: number,
  title: string,
  metrics: RunMetrics[],
  value: (m: RunMetrics) => number | null,
  maxValue: number,
  label: (v: number) => string,
) {
  const left = 24
  const width = doc.internal.pageSize.getWidth() - left - 14
  const height = 48
  y = ensureSpace(doc, y, height + 22)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...INK)
  doc.text(ascii(title), 14, y)
  const top = y + 4
  const bottom = top + height

  // axis + grid lines at 0, 50 %, 100 % of maxValue
  doc.setDrawColor(220, 224, 230)
  doc.setLineWidth(0.2)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...MUTED)
  for (const f of [0, 0.5, 1]) {
    const gy = bottom - f * height
    doc.line(left, gy, left + width, gy)
    doc.text(label(f * maxValue), left - 2, gy + 1, { align: 'right' })
  }

  const slot = width / Math.max(metrics.length, 1)
  const barWidth = Math.min(slot * 0.7, 12)
  metrics.forEach((m, i) => {
    const v = value(m)
    const x = left + i * slot + (slot - barWidth) / 2
    if (v !== null && maxValue > 0) {
      const h = Math.max(0.4, Math.min(v / maxValue, 1) * height)
      doc.setFillColor(...(m.valid ? ACCENT : BAD))
      doc.rect(x, bottom - h, barWidth, h, 'F')
    }
    if (metrics.length <= 40 || i % Math.ceil(metrics.length / 40) === 0) {
      doc.setTextColor(...MUTED)
      doc.text(String(m.index), x + barWidth / 2, bottom + 4, { align: 'center' })
    }
  })
  doc.setFontSize(7)
  doc.setFillColor(...ACCENT)
  doc.rect(left, bottom + 7, 3, 3, 'F')
  doc.text('valid plan', left + 5, bottom + 9.5)
  doc.setFillColor(...BAD)
  doc.rect(left + 26, bottom + 7, 3, 3, 'F')
  doc.text('invalid / no valid sample', left + 31, bottom + 9.5)
  doc.text('simulation #', left + width, bottom + 9.5, { align: 'right' })
  return bottom + 16
}

function hexColor(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function mix(color: [number, number, number], amount: number): [number, number, number] {
  return color.map((c) => Math.round(255 - (255 - c) * amount)) as [number, number, number]
}

function subheading(doc: Doc, text: string, y: number) {
  y = ensureSpace(doc, y, 14)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...ACCENT)
  doc.text(ascii(text), 14, y)
  return y + 2.5
}

// Monospace text block that wraps to the page width and flows over pages.
function codeBlock(doc: Doc, y: number, text: string, maxLines = 400) {
  const width = doc.internal.pageSize.getWidth() - 28
  doc.setFont('courier', 'normal')
  doc.setFontSize(6.5)
  const lines: string[] = doc.splitTextToSize(ascii(text), width - 4)
  const shown = lines.slice(0, maxLines)
  if (lines.length > maxLines) shown.push(`... (${lines.length - maxLines} more lines)`)
  const lineHeight = 2.8
  for (const line of shown) {
    y = ensureSpace(doc, y, lineHeight + 2)
    doc.setFillColor(244, 246, 249)
    doc.rect(14, y - 2.2, width, lineHeight, 'F')
    doc.setTextColor(...INK)
    doc.setFont('courier', 'normal')
    doc.setFontSize(6.5)
    doc.text(line, 16, y)
    y += lineHeight
  }
  return y + 3
}

// ----------------------------------------------------------------------------- circuit
// The circuit is the page's own CircuitDiagram component (same gates, colours, labels and
// spacing), rendered off-screen to an image and cut at gate-column boundaries into strips.

const CIRCUIT_BG = '#ffffff' // light panel, as on the page
const CIRCUIT_INK = '#1f2933'
const CIRCUIT_SCALE = 2 // image pixels per drawing pixel (sharpness)
const COLUMNS_PER_STRIP = 24

type CircuitImage = { canvas: HTMLCanvasElement; width: number; height: number; cols: number }

async function renderCircuit(qasm: string, labels: string[]): Promise<CircuitImage | null> {
  const markup = renderToStaticMarkup(createElement(CircuitDiagram, { qasm, labels }))
  const found = /<svg[\s\S]*<\/svg>/.exec(markup)
  if (!found) return null // too many gates / nothing to draw: the component shows a note instead
  const svg = found[0]
    .replace('<svg', `<svg xmlns="http://www.w3.org/2000/svg" style="color:${CIRCUIT_INK}"`)
    .replace(/(<svg[^>]*>)/, `$1<style>text{fill:${CIRCUIT_INK};font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace}</style>`)
  const width = Number(/width="([\d.]+)"/.exec(svg)?.[1] ?? 0)
  const height = Number(/height="([\d.]+)"/.exec(svg)?.[1] ?? 0)
  if (!width || !height) return null

  const image = new Image()
  image.decoding = 'async'
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(width * CIRCUIT_SCALE)
  canvas.height = Math.ceil(height * CIRCUIT_SCALE)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = CIRCUIT_BG
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
  const parsed = parseQasm3(qasm)
  return { canvas, width, height, cols: layoutGates(parsed.n, parsed.gates).cols }
}

function drawCircuit(doc: Doc, y: number, circuit: CircuitImage) {
  const pageWidth = doc.internal.pageSize.getWidth()
  const stripPx = CIRCUIT_LEFT + COLUMNS_PER_STRIP * CIRCUIT_STEP + 12
  const mmPerPx = (pageWidth - 28) / stripPx
  const heightMm = circuit.height * mmPerPx
  const strips = Math.ceil(circuit.cols / COLUMNS_PER_STRIP)

  // legend, as on the page; kept on the same page as the first strip
  y = ensureSpace(doc, y, heightMm + 14)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  let lx = 14
  for (const [kind, text] of [['h', 'Hadamard'], ['rz', 'Rz / Rzz (cost, gamma)'], ['rx', 'Rx (mixer, beta)'], ['measure', 'Measure']] as const) {
    doc.setFillColor(...hexColor(GATE_COLOR[kind]))
    doc.roundedRect(lx, y, 3, 3, 0.5, 0.5, 'F')
    doc.setTextColor(...MUTED)
    doc.text(text, lx + 4, y + 2.4)
    lx += doc.getTextWidth(text) + 9
  }
  y += 6

  const s = CIRCUIT_SCALE
  for (let strip = 0; strip < strips; strip += 1) {
    const first = strip * COLUMNS_PER_STRIP
    const count = Math.min(COLUMNS_PER_STRIP, circuit.cols - first)
    const isLast = strip === strips - 1
    const widthPx = CIRCUIT_LEFT + count * CIRCUIT_STEP + (isLast ? 24 : 12)
    y = ensureSpace(doc, y, heightMm + 6)
    if (strips > 1) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6.5)
      doc.setTextColor(...MUTED)
      doc.text(`gate columns ${first + 1}-${first + count} of ${circuit.cols}`, 14 + widthPx * mmPerPx, y + 2, { align: 'right' })
      y += 3
    }
    // wire labels + this strip's gate columns
    const piece = document.createElement('canvas')
    piece.width = Math.ceil(widthPx * s)
    piece.height = circuit.canvas.height
    const ctx = piece.getContext('2d')!
    ctx.fillStyle = CIRCUIT_BG
    ctx.fillRect(0, 0, piece.width, piece.height)
    ctx.drawImage(circuit.canvas, 0, 0, CIRCUIT_LEFT * s, piece.height, 0, 0, CIRCUIT_LEFT * s, piece.height)
    // exactly this strip's columns (whole gates); the right padding only continues the wires
    const srcX = (CIRCUIT_LEFT + first * CIRCUIT_STEP) * s
    const srcW = Math.min(count * CIRCUIT_STEP * s, circuit.canvas.width - srcX)
    ctx.drawImage(circuit.canvas, srcX, 0, srcW, piece.height, CIRCUIT_LEFT * s, 0, srcW, piece.height)
    if (!isLast) {
      // extend the wires through the padding: copy a gate-free slice of wire from the label area
      const wireX = (CIRCUIT_LEFT - 6) * s
      for (let x = CIRCUIT_LEFT * s + srcW; x < piece.width; x += 2 * s) {
        ctx.drawImage(circuit.canvas, wireX, 0, 2 * s, piece.height, x, 0, 2 * s, piece.height)
      }
    }
    doc.addImage(piece.toDataURL('image/jpeg', 0.92), 'JPEG', 14, y, widthPx * mmPerPx, heightMm)
    y += heightMm + 4
  }
  return y + 2
}

// ----------------------------------------------------------------------------- QUBO matrix
// Square heat-map grid like the page: blue = negative, amber = positive, diagonal = linear terms.
function drawMatrix(doc: Doc, y: number, matrix: number[][], names: string[]) {
  const n = matrix.length
  const pageWidth = doc.internal.pageSize.getWidth()
  const labelWidth = 9
  const cell = Math.min(13, (pageWidth - 28 - labelWidth - 4) / n)
  const fontSize = Math.max(3.6, Math.min(6.5, cell * 0.62))
  const gridWidth = n * cell
  const left = 14 + labelWidth + (pageWidth - 28 - labelWidth - gridWidth) / 2
  const maxAbs = matrixMaxAbs(matrix)
  y = ensureSpace(doc, y, (n + 1) * cell + 14)

  // column headers
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(fontSize)
  doc.setTextColor(...INK)
  names.forEach((name, j) => doc.text(ascii(name), left + j * cell + cell / 2, y + cell * 0.6, { align: 'center' }))
  const top = y + cell

  for (let i = 0; i < n; i += 1) {
    const cy = top + i * cell
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(fontSize)
    doc.setTextColor(...INK)
    doc.text(ascii(names[i] ?? `q${i}`), left - 2.2, cy + cell / 2 + fontSize * 0.13, { align: 'right' })
    for (let j = 0; j < n; j += 1) {
      const cx = left + j * cell
      const value = matrix[i][j]
      if (j < i) {
        doc.setFillColor(246, 247, 249)
        doc.rect(cx + 0.15, cy + 0.15, cell - 0.3, cell - 0.3, 'F')
        continue
      }
      const t = matrixIntensity(value, maxAbs)
      doc.setFillColor(...(value === 0 ? [240, 242, 245] as [number, number, number] : mix(matrixColor(value), 0.14 + 0.76 * t)))
      doc.rect(cx + 0.15, cy + 0.15, cell - 0.3, cell - 0.3, 'F')
      if (i === j) {
        doc.setDrawColor(...INK)
        doc.setLineWidth(0.35)
        doc.rect(cx + 0.35, cy + 0.35, cell - 0.7, cell - 0.7, 'S')
      }
      doc.setFont('helvetica', t > 0.65 ? 'bold' : 'normal')
      doc.setFontSize(fontSize)
      if (value === 0) doc.setTextColor(...MUTED)
      else if (t > 0.65) doc.setTextColor(255, 255, 255)
      else doc.setTextColor(...INK)
      doc.text(formatMatrixValue(value), cx + cell / 2, cy + cell / 2 + fontSize * 0.13, { align: 'center' })
    }
  }

  // matrix brackets
  const bottom = top + n * cell
  doc.setDrawColor(...INK)
  doc.setLineWidth(0.4)
  for (const [x, dir] of [[left - 0.8, 1], [left + gridWidth + 0.8, -1]] as const) {
    doc.line(x, top, x, bottom)
    doc.line(x, top, x + dir * 1.4, top)
    doc.line(x, bottom, x + dir * 1.4, bottom)
  }

  // legend
  let ly = bottom + 5
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  let lx = left
  const legend: Array<[[number, number, number] | null, string]> = [
    [mix(matrixColor(-1), 0.8), 'negative (rewards)'],
    [mix(matrixColor(1), 0.8), 'positive (penalties)'],
    [null, 'diagonal = linear terms'],
  ]
  for (const [color, text] of legend) {
    if (color) {
      doc.setFillColor(...color)
      doc.rect(lx, ly - 2.4, 3, 3, 'F')
    } else {
      doc.setDrawColor(...INK)
      doc.setLineWidth(0.35)
      doc.rect(lx, ly - 2.4, 3, 3, 'S')
    }
    doc.setTextColor(...MUTED)
    doc.text(text, lx + 4, ly)
    lx += doc.getTextWidth(text) + 9
  }
  doc.text(`|max| = ${formatMatrixValue(maxAbs)}  |  colour strength ~ sqrt(|value| / |max|)`, lx, ly)
  ly += 4
  return ly + 2
}

export async function buildBatchReport(
  setup: BatchReportSetup,
  runs: BatchRunResult[],
  stats: BatchStatistics,
): Promise<jsPDF> {
  // render every circuit first (image decoding is asynchronous)
  const circuitImages = new Map<number, CircuitImage | null>()
  for (const run of runs) {
    const q = run.response?.quantum
    if (run.state !== 'done' || !q?.circuit?.qasm3 || q.circuit.error) continue
    try {
      circuitImages.set(run.index, await renderCircuit(q.circuit.qasm3, qubitLabels(q, routeName)))
    } catch {
      circuitImages.set(run.index, null)
    }
  }

  const doc: Doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const metrics = runs.filter((run) => run.state === 'done').map((run) => toMetrics(run, setup.budget))
  const failed = runs.filter((run) => run.state === 'failed')
  const tableStyle = {
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.6, textColor: INK },
    headStyles: { fillColor: [24, 32, 44] as [number, number, number], textColor: 255, fontStyle: 'bold' as const },
    alternateRowStyles: { fillColor: [244, 246, 249] as [number, number, number] },
    margin: { left: 14, right: 14 },
  }

  // ---- title
  doc.setFillColor(...INK)
  doc.rect(0, 0, pageWidth, 26, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text('Railway planner - batch simulation report', 14, 12)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(ascii(`${setup.algorithm} | ${runs.length} simulations | generated ${new Date().toLocaleString()}`), 14, 19)

  // ---- setup
  let y = heading(doc, 'Setup', 36)
  autoTable(doc, {
    ...tableStyle,
    startY: y,
    theme: 'plain',
    styles: { ...tableStyle.styles, cellPadding: 1 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 38 } },
    body: [
      ['Algorithm', setup.algorithm],
      ['Budget', fmt(setup.budget)],
      ['Nodes', `${setup.nodes.length}: ${setup.nodes.join(', ')}`],
      ['Candidate routes', `${setup.routes.length}: ${setup.routes.join('; ')}`],
      ['Started', new Date(setup.startedAt).toLocaleString()],
      ['Finished', setup.finishedAt ? new Date(setup.finishedAt).toLocaleString() : 'not finished'],
    ].map((row) => row.map(ascii)),
  })
  y = (doc.lastAutoTable?.finalY ?? y) + 8

  // ---- key statistics
  y = heading(doc, 'Overall statistics', y)
  autoTable(doc, {
    ...tableStyle,
    startY: y,
    head: [['Metric', 'Mean +/- std', 'Median', 'Min', 'Max', 'n']],
    body: ([
      ['Approximation ratio (best sample / optimum)', stats.approximationRatio, 4, false],
      ['Total value (valid plans)', stats.totalValue, 3, false],
      ['Total cost (valid plans)', stats.totalCost, 3, false],
      ['Valid sample rate', stats.validSampleRate, 1, true],
      ['Connected sample rate', stats.connectedSampleRate, 1, true],
      ['P(optimum) of the QAOA state', stats.pOptimum, 1, true],
      ['Planner runtime (s)', stats.serverSeconds, 2, false],
      ['Request time (s)', stats.requestSeconds, 2, false],
    ] as const).map(([name, s, digits, asPct]) => {
      const f = (v: number | null) => (asPct ? pct(v) : fmt(v, digits))
      return [name, meanStd(s, digits, asPct), f(s.median), f(s.min), f(s.max), String(s.count)].map(ascii)
    }),
  })
  y = (doc.lastAutoTable?.finalY ?? y) + 4
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...INK)
  const lines = [
    `Finished ${stats.finished} of ${stats.runs} simulations (${stats.failed} failed).`,
    `Valid plan rate: ${pct(stats.successRate)}   |   exact optimum found: ${pct(stats.optimumRate)}.`,
    stats.best
      ? `Best plan: simulation #${stats.best.index} (${stats.best.configKey}, seed ${stats.best.params.seed}) - value ${fmt(stats.best.totalValue)}, cost ${fmt(stats.best.totalCost)}.`
      : 'No simulation returned a valid plan.',
  ]
  lines.forEach((line, i) => doc.text(ascii(line), 14, y + 4 + i * 5))
  y += 4 + lines.length * 5 + 6

  // ---- charts
  if (metrics.length > 0) {
    y = ensureSpace(doc, y, 80)
    y = heading(doc, 'Charts', y) + 4
    y = barChart(doc, y, 'Approximation ratio per simulation', metrics, (m) => m.approximationRatio, 1, (v) => v.toFixed(1))
    const maxValue = Math.max(...metrics.map((m) => m.totalValue ?? 0), ...metrics.map((m) => m.optimumValue ?? 0), 1)
    y = barChart(doc, y, 'Total value per simulation', metrics, (m) => m.totalValue, maxValue, (v) => fmt(v, 1))
    y = barChart(doc, y, 'Connected sample rate per simulation', metrics, (m) => m.connectedSampleRate, 1, (v) => `${Math.round(v * 100)}%`)
  }

  // ---- by configuration
  if (stats.groups.length > 0) {
    y = ensureSpace(doc, y, 30)
    y = heading(doc, 'Statistics per parameter set', y)
    autoTable(doc, {
      ...tableStyle,
      startY: y,
      head: [['p', 'Slack', 'COBYLA it.', 'Shots', 'Runs', 'Valid', 'Optimum', 'Approx. ratio', 'Connected rate', 'Runtime (s)']],
      body: stats.groups.map((g) => [
        String(g.params.p),
        g.params.slack ? 'slack' : 'no slack',
        String(g.params.iterations),
        String(g.params.shots),
        String(g.runs),
        pct(g.successRate),
        pct(g.optimumRate),
        meanStd(g.approximationRatio, 3),
        meanStd(g.connectedSampleRate, 1, true),
        meanStd(g.serverSeconds, 2),
      ].map(ascii)),
    })
    y = (doc.lastAutoTable?.finalY ?? y) + 8
  }

  // ---- every run
  y = ensureSpace(doc, y, 30)
  y = heading(doc, 'All simulations', y)
  autoTable(doc, {
    ...tableStyle,
    startY: y,
    styles: { ...tableStyle.styles, fontSize: 7 },
    head: [['#', 'p', 'Slack', 'It.', 'Shots', 'Seed', 'Status', 'Cost', 'Value', 'Optimum', 'Ratio', 'Valid rate', 'Conn. rate', 'Qubits', 'Time (s)']],
    body: runs.map((run) => {
      const m = run.state === 'done' ? toMetrics(run, setup.budget) : null
      return [
        String(run.index),
        String(run.params.p),
        run.params.slack ? 'yes' : 'no',
        String(run.params.iterations),
        String(run.params.shots),
        String(run.params.seed),
        m ? (m.valid ? 'valid' : m.status) : run.state === 'failed' ? 'error' : run.state,
        fmt(m?.totalCost),
        fmt(m?.totalValue),
        fmt(m?.optimumValue),
        fmt(m?.approximationRatio, 3),
        pct(m?.validSampleRate),
        pct(m?.connectedSampleRate),
        m?.qubits != null ? String(m.qubits) : '-',
        fmt(m?.serverSeconds ?? (run.requestMs !== null ? run.requestMs / 1000 : null), 2),
      ].map(ascii)
    }),
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 6) {
        const text = String(data.cell.raw)
        data.cell.styles.textColor = text === 'valid' ? GOOD : text === 'queued' || text === 'skipped' ? MUTED : BAD
      }
    },
  })
  y = (doc.lastAutoTable?.finalY ?? y) + 8

  // ---- errors
  if (failed.length > 0) {
    y = ensureSpace(doc, y, 20)
    y = heading(doc, 'Errors', y)
    autoTable(doc, {
      ...tableStyle,
      startY: y,
      head: [['#', 'Message']],
      columnStyles: { 0: { cellWidth: 10 } },
      body: failed.map((run) => [String(run.index), ascii(run.error ?? 'unknown error')]),
    })
  }

  // ---- circuits and QUBOs of the whole batch
  const finished = runs.filter((run) => run.state === 'done' && run.response)
  if (finished.length > 0) {
    y = (doc.lastAutoTable?.finalY ?? y) + 8
    y = ensureSpace(doc, y, 30)
    y = heading(doc, 'Circuits and QUBOs of the batch', y)
    autoTable(doc, {
      ...tableStyle,
      startY: y,
      styles: { ...tableStyle.styles, fontSize: 7 },
      head: [['#', 'p', 'Slack', 'Qubits', 'Depth', '2q gates', 'Gate counts', 'QUBO lin./quad.', 'QUBO energy range', 'Expected energy']],
      body: finished.map((run) => {
        const q = run.response?.quantum
        const c = q?.circuit
        return [
          String(run.index),
          String(run.params.p),
          run.params.slack ? 'yes' : 'no',
          q?.qubits != null ? `${q.qubits}${q.slack_qubits ? ` (${q.slack_qubits} slack)` : ''}` : '-',
          c?.depth != null ? String(c.depth) : '-',
          c?.two_qubit_gates != null ? String(c.two_qubit_gates) : '-',
          c?.error ? c.error : Object.entries(c?.gate_counts ?? {}).filter(([k]) => k !== 'barrier').map(([k, v]) => `${k} ${v}`).join(', ') || '-',
          q?.qubo ? `${Object.keys(q.qubo.linear ?? {}).length} / ${Object.keys(q.qubo.quadratic ?? {}).length}` : '-',
          q?.qubo?.energy_range ? `${fmt(q.qubo.energy_range[0], 2)} ... ${fmt(q.qubo.energy_range[1], 2)}` : '-',
          fmt(q?.expected_energy, 3),
        ].map(ascii)
      }),
    })
  }

  // ---- one section per simulation: intermediate values, QUBO, circuit
  for (const run of finished) {
    const response = run.response!
    const q = response.quantum
    const m = toMetrics(run, setup.budget)
    doc.addPage()
    doc.setFillColor(...INK)
    doc.rect(0, 0, pageWidth, 18, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.text(`Simulation #${run.index}`, 14, 8.5)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.text(ascii(`p = ${run.params.p} | ${run.params.slack ? 'slack' : 'no slack'} | ${run.params.iterations} COBYLA iterations | ${run.params.shots} shots | seed ${run.params.seed} | ${m.valid ? 'valid plan' : response.status}`), 14, 14)
    let sy = 26

    sy = subheading(doc, 'Intermediate values', sy)
    autoTable(doc, {
      ...tableStyle,
      startY: sy,
      styles: { ...tableStyle.styles, fontSize: 7, cellPadding: 1.2 },
      columnStyles: { 0: { cellWidth: 8 }, 1: { cellWidth: 46, fontStyle: 'bold' } },
      head: [['#', 'Step', 'Value']],
      body: makeResponseEntries(response).map((entry, k) => [String(k + 1), ascii(entry.label), ascii(entry.message)]),
    })
    sy = (doc.lastAutoTable?.finalY ?? sy) + 8

    const qubo = q?.qubo
    sy = subheading(doc, 'QUBO', sy)
    if (!qubo) {
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(8)
      doc.setTextColor(...MUTED)
      doc.text('No QUBO in the response.', 14, sy + 3)
      sy += 9
    } else {
      autoTable(doc, {
        ...tableStyle,
        startY: sy,
        theme: 'plain',
        styles: { ...tableStyle.styles, fontSize: 7.5, cellPadding: 0.8 },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 40 } },
        body: [
          ['Budget encoding', q?.penalties?.budget_encoding ?? '-'],
          ['Offset', fmt(qubo.offset, 4)],
          ['Energy range', qubo.energy_range ? `${fmt(qubo.energy_range[0], 4)} ... ${fmt(qubo.energy_range[1], 4)}` : '-'],
          ['Terms', `${Object.keys(qubo.linear ?? {}).length} linear, ${Object.keys(qubo.quadratic ?? {}).length} quadratic`],
          ['Variables', Object.entries(q?.variables ?? {}).map(([name, v]) => `${name} = ${name.startsWith('x') ? routeName(v) : v}`).join('; ')],
        ].map((r) => r.map(ascii)),
      })
      sy = (doc.lastAutoTable?.finalY ?? sy) + 4
      if (qubo.formula) {
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(8)
        doc.setTextColor(...INK)
        sy = ensureSpace(doc, sy, 10)
        doc.text('Formula', 14, sy)
        sy = codeBlock(doc, sy + 4, qubo.formula)
      }
      const linear = Object.entries(qubo.linear ?? {})
      const quadratic = Object.entries(qubo.quadratic ?? {})
      if (linear.length > 0 || quadratic.length > 0) {
        // coefficients side by side, three (term, value) pairs per row
        const pairs = [
          ...linear.map(([k, v]) => [k, fmt(v, 4)]),
          ...quadratic.map(([k, v]) => [k, fmt(v, 4)]),
        ]
        const body: string[][] = []
        for (let k = 0; k < pairs.length; k += 3) {
          body.push([0, 1, 2].flatMap((o) => pairs[k + o] ?? ['', '']).map(ascii))
        }
        sy = ensureSpace(doc, sy, 20)
        autoTable(doc, {
          ...tableStyle,
          startY: sy,
          styles: { ...tableStyle.styles, fontSize: 6.5, cellPadding: 0.9 },
          head: [['Term', 'Coefficient', 'Term', 'Coefficient', 'Term', 'Coefficient']],
          body,
        })
        sy = (doc.lastAutoTable?.finalY ?? sy) + 6
      }
      const matrix = qubo.matrix
      if (matrix && matrix.length > 0) {
        const names = qubo.matrix_variables ?? matrix.map((_, k) => `q${k}`)
        sy = ensureSpace(doc, sy, Math.min(150, matrix.length * 12 + 30))
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(8)
        doc.setTextColor(...INK)
        doc.text(`QUBO matrix (${matrix.length} x ${matrix.length})`, 14, sy)
        if (qubo.matrix_convention) {
          doc.setFont('helvetica', 'normal')
          doc.setFontSize(6.5)
          doc.setTextColor(...MUTED)
          const note: string[] = doc.splitTextToSize(ascii(qubo.matrix_convention), pageWidth - 28)
          doc.text(note, 14, sy + 3.5)
          sy += 3.5 + (note.length - 1) * 2.6
        }
        sy = drawMatrix(doc, sy + 4, matrix, names)
      }
    }

    sy = subheading(doc, 'QAOA circuit', ensureSpace(doc, sy, 80))
    const circuit = q?.circuit
    if (!circuit || circuit.error || !circuit.qasm3) {
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(8)
      doc.setTextColor(...MUTED)
      doc.text(ascii(circuit?.error ?? 'No circuit in the response.'), 14, sy + 3)
      sy += 9
    } else {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.5)
      doc.setTextColor(...INK)
      const counts = Object.entries(circuit.gate_counts ?? {}).filter(([k]) => k !== 'barrier').map(([k, v]) => `${k} ${v}`).join(', ')
      doc.text(ascii(`${circuit.num_qubits ?? q?.qubits} qubits | depth ${circuit.depth ?? '-'} | ${circuit.two_qubit_gates ?? '-'} two-qubit gates | ${counts}`), 14, sy + 2)
      if (q?.angles?.gammas) {
        doc.text(ascii(`gamma = [${q.angles.gammas.map((v) => v.toFixed(4)).join(', ')}]   beta = [${(q.angles.betas ?? []).map((v) => v.toFixed(4)).join(', ')}]`), 14, sy + 6)
      }
      const image = circuitImages.get(run.index)
      if (image) {
        sy = drawCircuit(doc, sy + 9, image)
      } else {
        doc.setFont('helvetica', 'italic')
        doc.setFontSize(8)
        doc.setTextColor(...MUTED)
        doc.text('The circuit is too large to draw; see the QASM in the app.', 14, sy + 12)
        sy += 16
      }
    }
  }

  // ---- page numbers
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...MUTED)
    doc.text(`Page ${i} of ${pages}`, pageWidth - 14, doc.internal.pageSize.getHeight() - 8, { align: 'right' })
  }
  return doc
}
