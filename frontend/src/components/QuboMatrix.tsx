import type { CSSProperties } from 'react'
import { formatMatrixValue, matrixColor, matrixIntensity, matrixMaxAbs } from '../utils/matrix'

type Props = {
  matrix: number[][]
  /** variable name per row / column (x0, x1, ..., s0, ...) */
  names: string[]
  /** optional meaning per variable, shown on hover (e.g. the route) */
  describe?: (name: string) => string | undefined
  convention?: string
}

// Square heat-map grid of the upper-triangular QUBO matrix Q (E(y) = offset + yᵀQy).
export default function QuboMatrix({ matrix, names, describe, convention }: Props) {
  const n = matrix.length
  const maxAbs = matrixMaxAbs(matrix)
  const name = (i: number) => names[i] ?? `q${i}`
  const style = { '--qm-n': n } as CSSProperties

  return (
    <div className="qm">
      <div className="qm-scroll">
        <div className="qm-grid" style={style} role="table" aria-label={`QUBO matrix ${n} by ${n}`}>
          <div className="qm-corner" role="columnheader">Q</div>
          {Array.from({ length: n }, (_, j) => (
            <div key={`c${j}`} className="qm-head" role="columnheader" title={describe?.(name(j))}>{name(j)}</div>
          ))}
          {matrix.map((row, i) => (
            <div key={`r${i}`} className="qm-row" role="row">
              <div className="qm-head qm-row-head" role="rowheader" title={describe?.(name(i))}>{name(i)}</div>
              {row.map((value, j) => {
                if (j < i) return <div key={j} className="qm-cell qm-lower" role="cell" aria-label="" />
                const [r, g, b] = matrixColor(value)
                const t = matrixIntensity(value, maxAbs)
                return (
                  <div
                    key={j}
                    role="cell"
                    className={`qm-cell ${i === j ? 'qm-diag' : ''} ${value === 0 ? 'qm-zero' : ''} ${t > 0.65 ? 'qm-strong' : ''}`}
                    style={value === 0 ? undefined : { background: `rgba(${r}, ${g}, ${b}, ${0.12 + 0.68 * t})` }}
                    title={`Q[${name(i)}, ${name(j)}] = ${value}${i === j ? ' (linear term)' : ''}`}
                  >
                    {formatMatrixValue(value)}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="qm-legend">
        <span><i style={{ background: 'rgba(59, 130, 246, .8)' }} /> negative (rewards)</span>
        <span><i style={{ background: 'rgba(245, 158, 11, .8)' }} /> positive (penalties)</span>
        <span><i className="qm-legend-diag" /> diagonal = linear terms</span>
        <span>|max| = {formatMatrixValue(maxAbs)}</span>
      </div>
      {convention && <p className="qd-note">{convention}</p>}
    </div>
  )
}
