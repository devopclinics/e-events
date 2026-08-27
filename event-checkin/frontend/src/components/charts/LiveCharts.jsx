import { useId } from 'react'
import './LiveCharts.css'

// Hand-authored SVG charts for Festio Live's broadcast display — no charting
// library, matching the rest of LiveBroadcastCanvas. Colors come from the
// screen's --flb-accent* theme variables so every chart follows whichever
// theme (aurora/citrus/ocean/festio/mono) the presenter picked.
export const PALETTE = ['var(--flb-accent)', 'var(--flb-accent2)', 'var(--flb-accent3)', 'var(--flb-good)', '#f3a526', '#20a4f3']
const STAR_PATH = 'M12 2.5l2.97 6.28 6.78.82-5.1 4.75 1.4 6.9L12 17.9l-6.05 3.35 1.4-6.9-5.1-4.75 6.78-.82L12 2.5z'

function clamp01(value) { return Math.max(0, Math.min(1, value)) }

export function DonutChart({ segments, size = 14 }) {
  const total = segments.reduce((sum, seg) => sum + seg.value, 0)
  const radius = 15.5
  const circumference = 2 * Math.PI * radius
  let offset = 0
  return (
    <div className="flb-donut" style={{ '--flb-donut-size': `${size}cqw` }}>
      <svg viewBox="0 0 36 36" className="flb-donut-svg" role="img" aria-label={`${total} responses across ${segments.length} options`}>
        <circle cx="18" cy="18" r={radius} fill="none" stroke="#ffffff14" strokeWidth="4.4" />
        {total > 0 && segments.map((seg, i) => {
          if (!seg.value) return null
          const fraction = seg.value / total
          const length = fraction * circumference
          const circle = <circle key={seg.id} cx="18" cy="18" r={radius} fill="none"
            stroke={seg.color || PALETTE[i % PALETTE.length]} strokeWidth="4.4"
            strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-offset}
            transform="rotate(-90 18 18)" strokeLinecap={segments.filter((s) => s.value).length > 1 ? 'butt' : 'round'} />
          offset += length
          return circle
        })}
      </svg>
      <div className="flb-donut-center"><strong>{total}</strong><span>responses</span></div>
    </div>
  )
}

export function DonutLegend({ segments }) {
  const total = Math.max(1, segments.reduce((sum, seg) => sum + seg.value, 0))
  return (
    <div className="flb-donut-legend">
      {segments.map((seg, i) => (
        <div className="flb-donut-legend-row" key={seg.id}>
          <i style={{ background: seg.color || PALETTE[i % PALETTE.length] }} />
          <span>{seg.label}</span>
          <b>{Math.round((seg.value / total) * 100)}%</b>
        </div>
      ))}
    </div>
  )
}

export function Histogram({ values, bins = 8 }) {
  if (!values.length) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = Math.max(max - min, 1)
  const width = span / bins
  const counts = Array.from({ length: bins }, () => 0)
  values.forEach((value) => {
    const index = Math.min(bins - 1, Math.max(0, Math.floor((value - min) / width)))
    counts[index] += 1
  })
  const peak = Math.max(1, ...counts)
  return (
    <div className="flb-histogram">
      <div className="flb-histogram-bars">
        {counts.map((count, i) => (
          <div className="flb-histogram-bar" key={i}><i style={{ height: `${count ? Math.max(6, (count / peak) * 100) : 0}%` }}>{count || ''}</i></div>
        ))}
      </div>
      <div className="flb-histogram-axis"><span>{min}</span><span>{values.length} answers</span><span>{max}</span></div>
    </div>
  )
}

export function RatingDistribution({ valueCounts, max, min = 1 }) {
  const scale = Array.from({ length: max - min + 1 }, (_, i) => i + min)
  const peak = Math.max(1, ...Object.values(valueCounts))
  return (
    <div className="flb-histogram flb-histogram-discrete">
      <div className="flb-histogram-bars">
        {scale.map((n) => {
          const count = valueCounts[String(n)] || 0
          return <div className="flb-histogram-bar" key={n}><i style={{ height: `${count ? Math.max(6, (count / peak) * 100) : 0}%` }}>{count || ''}</i><small>{n}</small></div>
        })}
      </div>
    </div>
  )
}

export function TrendLine({ buckets }) {
  if (!buckets?.length || !buckets.some((v) => v > 0)) return null
  const peak = Math.max(1, ...buckets)
  const last = buckets.length - 1
  const points = buckets.map((v, i) => `${(i / (last || 1)) * 100},${32 - (v / peak) * 28}`).join(' ')
  return (
    <svg className="flb-trend" viewBox="0 0 100 32" preserveAspectRatio="none" role="img" aria-label="Responses received over time">
      <polygon className="flb-trend-fill" points={`0,32 ${points} 100,32`} />
      <polyline className="flb-trend-line" points={points} />
    </svg>
  )
}

export function RankingChart({ items }) {
  const sorted = [...items].sort((a, b) => b.score - a.score)
  const peak = Math.max(1, ...sorted.map((item) => item.score))
  return (
    <div className="flb-ranking">
      {sorted.map((item, i) => (
        <div className="flb-rank-row" key={item.id}>
          <b>{i + 1}</b>
          <span>{item.label}</span>
          <div className="flb-bar"><i style={{ width: `${Math.max(4, (item.score / peak) * 100)}%` }} /></div>
          <strong>{item.score}</strong>
        </div>
      ))}
    </div>
  )
}

export function StarRating({ average = 0, max = 5 }) {
  const uid = useId()
  const stars = Array.from({ length: max }, (_, i) => i + 1)
  return (
    <div className="flb-stars" role="img" aria-label={`${average.toFixed(1)} out of ${max} stars`}>
      {stars.map((n) => {
        const fill = clamp01(average - (n - 1))
        const clipId = `${uid}-star-${n}`
        return (
          <svg key={n} viewBox="0 0 24 24" className="flb-star">
            <path d={STAR_PATH} className="flb-star-bg" />
            <clipPath id={clipId}><rect x="0" y="0" width={24 * fill} height="24" /></clipPath>
            <path d={STAR_PATH} className="flb-star-fg" clipPath={`url(#${clipId})`} />
          </svg>
        )
      })}
    </div>
  )
}

export function ScatterPlot({ points, labels = {} }) {
  return (
    <div className="flb-scatter">
      <svg viewBox="0 0 100 100" className="flb-scatter-svg" role="img" aria-label={`${points.length} responses plotted on a quadrant`}>
        <line x1="0" y1="50" x2="100" y2="50" className="flb-scatter-axis" />
        <line x1="50" y1="0" x2="50" y2="100" className="flb-scatter-axis" />
        {points.map(([x, y], i) => <circle key={i} cx={x * 100} cy={(1 - y) * 100} r="1.7" className="flb-scatter-dot" />)}
      </svg>
      {labels.y_label_high && <span className="flb-scatter-label flb-scatter-label-top">{labels.y_label_high}</span>}
      {labels.y_label_low && <span className="flb-scatter-label flb-scatter-label-bottom">{labels.y_label_low}</span>}
      {labels.x_label_low && <span className="flb-scatter-label flb-scatter-label-left">{labels.x_label_low}</span>}
      {labels.x_label_high && <span className="flb-scatter-label flb-scatter-label-right">{labels.x_label_high}</span>}
    </div>
  )
}

export function Heatmap({ points, image }) {
  const uid = useId()
  const gradId = `${uid}-heat-dot`
  return (
    <div className="flb-heatmap" style={{ backgroundImage: image ? `url("${image}")` : 'none' }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="flb-heatmap-svg" role="img" aria-label={`Heat map of ${points.length} taps`}>
        <defs>
          <radialGradient id={gradId}>
            <stop offset="0%" stopColor="#ff3b3b" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#ff3b3b" stopOpacity="0" />
          </radialGradient>
        </defs>
        {points.map(([x, y], i) => <circle key={i} cx={x * 100} cy={(1 - y) * 100} r="7" fill={`url(#${gradId})`} />)}
      </svg>
    </div>
  )
}

export function ImageChoiceGrid({ items }) {
  const total = Math.max(1, items.reduce((sum, item) => sum + item.count, 0))
  return (
    <div className="flb-image-grid">
      {items.map((item) => {
        const percent = Math.round((item.count / total) * 100)
        return (
          <div className="flb-image-card" key={item.id}>
            <div className="flb-image-thumb" style={{ backgroundImage: `url("${item.image}")` }} />
            <div className="flb-image-meta"><span>{item.label}</span><strong>{percent}%</strong></div>
            <div className="flb-bar"><i style={{ width: `${Math.max(3, percent)}%` }} /></div>
          </div>
        )
      })}
    </div>
  )
}
