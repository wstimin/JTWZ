import { useId } from 'react'

export function MetricChart({ data = [], secondary = [], labels }: { data?: number[]; secondary?: number[]; labels?: string[] }) {
  const gradientId = `chart-fill-${useId().replace(/:/g, '')}`
  const hasData = data.length > 1
  const safeData = data.length > 1 ? data : [0, 0]
  const max = Math.max(1, ...safeData, ...secondary)
  const toPoints = (values: number[]) => values
    .map((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * 100
      const y = 92 - (value / max) * 78
      return `${x},${y}`
    })
    .join(' ')
  const points = toPoints(safeData)
  const secondaryPoints = secondary.length > 1 ? toPoints(secondary) : ''
  const areaPoints = `0,100 ${points} 100,100`
  const displayLabels = labels?.length ? [labels[0], labels[Math.floor((labels.length - 1) / 3)], labels[Math.floor(((labels.length - 1) * 2) / 3)], labels[labels.length - 1]] : ['—', '—', '—', '今天']

  return (
    <div className="chart-wrap" aria-label="访问趋势">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g className="chart-grid">
          <line x1="0" x2="100" y1="24" y2="24" />
          <line x1="0" x2="100" y1="48" y2="48" />
          <line x1="0" x2="100" y1="72" y2="72" />
        </g>
        <polygon points={areaPoints} fill={`url(#${gradientId})`} />
        <polyline className="chart-line" points={points} />
        {secondaryPoints ? <polyline className="chart-line chart-line--secondary" points={secondaryPoints} /> : null}
      </svg>
      {!hasData ? <div className="chart-empty">暂无访问数据</div> : null}
      <div className="chart-labels">
        {displayLabels.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}
      </div>
    </div>
  )
}
