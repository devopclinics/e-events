import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

// Internal-only rendering surface for one activity's full survey report,
// fetched by the export's headless browser (see report_export.py) and by
// nobody else -- it needs the same short-lived staff token as the request
// it renders. Deliberately independent of LiveDisplay: it reads every
// question straight from the database via /activities/{id}/report, so a
// report can never be truncated to a display's curated question list, and
// generating one can never conflict with (or be knocked out by) an
// actively-connected projector.
//
// Front matter (cover, executive summary, ratings/choices/priorities
// dashboards) is built generically from question_type, never from anything
// specific to one activity -- so it works the same way for any survey or
// feedback activity, not just the one it was designed against. Only the
// per-question appendix at the end existed before this file was rewritten;
// everything above it is new.

const BRAND = '#4f46e5'
const PALETTE = ['#4f46e5', '#0ea5a4', '#e11d48', '#d97706', '#0284c7', '#9333ea', '#4d7c0f', '#ea580c']
const colorFor = (i) => PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length]
const tint = (hex, alpha) => `${hex}${alpha}`

const RATING_MAX = { rating_5: 5, rating_10: 10, nps: 10 }
const CHOICE_TYPES = ['single_choice', 'true_false', 'yes_no']
const PRIORITY_TYPES = ['multiple_choice', 'ranking']

function formatMMSS(seconds) {
  if (seconds == null) return '—'
  const total = Math.round(seconds)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function barRows(counts, labels) {
  const entries = Object.entries(counts || {})
  const max = Math.max(1, ...entries.map(([, count]) => count))
  return entries
    .sort((a, b) => b[1] - a[1])
    .map(([id, count]) => ({ id, label: labels?.[id] || id, count, pct: Math.round((count / max) * 100) }))
}

function categorize(questions) {
  const rating = [], choice = [], priority = []
  for (const q of questions) {
    if (q.question_type in RATING_MAX) rating.push(q)
    else if (CHOICE_TYPES.includes(q.question_type) || q.question_type === 'word_cloud') choice.push(q)
    else if (PRIORITY_TYPES.includes(q.question_type)) priority.push(q)
  }
  return { rating, choice, priority }
}

function pickOverallRating(rating) {
  return rating.find((q) => /overall/i.test(q.prompt)) || rating[0] || null
}

function topOption(question) {
  const entries = Object.entries(question.option_counts || {})
  if (!entries.length) return null
  entries.sort((a, b) => b[1] - a[1])
  const [id, count] = entries[0]
  const total = entries.reduce((sum, [, c]) => sum + c, 0)
  return { label: question.option_labels?.[id] || id, count, total, pct: total ? Math.round((count / total) * 100) : 0 }
}

function topPriority(question) {
  const source = question.question_type === 'ranking' ? question.ranking_scores : question.option_counts
  const entries = Object.entries(source || {})
  if (!entries.length) return null
  entries.sort((a, b) => b[1] - a[1])
  const [id, count] = entries[0]
  return { label: question.option_labels?.[id] || id, count }
}

function buildFindings(data, rating, choice, priority) {
  const findings = []
  const summary = data.survey_summary
  if (summary) {
    findings.push(`${summary.completion_rate}% of participants who started completed the survey, averaging ${formatMMSS(summary.avg_completion_seconds)}.`)
  }
  const rated = rating.filter((q) => q.average_rating != null)
  if (rated.length > 1) {
    const sorted = [...rated].sort((a, b) => b.average_rating - a.average_rating)
    const best = sorted[0], worst = sorted[sorted.length - 1]
    findings.push(`"${best.prompt}" was the highest-rated aspect at ${best.average_rating.toFixed(2)}/${RATING_MAX[best.question_type]}, while "${worst.prompt}" was the lowest at ${worst.average_rating.toFixed(2)}/${RATING_MAX[worst.question_type]} — the clearest opportunity for improvement.`)
  } else if (rated.length === 1) {
    findings.push(`Overall rating averaged ${rated[0].average_rating.toFixed(2)}/${RATING_MAX[rated[0].question_type]} across ${rated[0].response_count} responses.`)
  }
  const choiceHits = choice
    .filter((q) => q.question_type !== 'word_cloud')
    .map((q) => ({ q, top: topOption(q) }))
    .filter((x) => x.top)
    .sort((a, b) => b.top.pct - a.top.pct)
  if (choiceHits.length) {
    const { q, top } = choiceHits[0]
    findings.push(`Most respondents (${top.count} of ${top.total}, ${top.pct}%) answered "${top.label}" for "${q.prompt}".`)
  }
  const priorityHits = priority.map((q) => ({ q, top: topPriority(q) })).filter((x) => x.top).sort((a, b) => b.top.count - a.top.count)
  if (priorityHits.length) {
    const { q, top } = priorityHits[0]
    findings.push(`"${top.label}" was the top pick for "${q.prompt}" (${top.count} mentions).`)
  }
  const cloudHits = choice
    .filter((q) => q.question_type === 'word_cloud' && q.word_cloud?.length)
    .map((q) => ({ q, top: [...q.word_cloud].sort((a, b) => b.count - a.count)[0] }))
  if (cloudHits.length) {
    const { q, top } = cloudHits[0]
    findings.push(`"${top.word}" was the most-mentioned word for "${q.prompt}" (${top.count} mentions).`)
  }
  return findings.slice(0, 6)
}

function StatTiles({ stats }) {
  return (
    <div className="stat-row">
      {stats.map((s, i) => {
        const color = colorFor(i)
        return (
          <div className="stat" key={s.label} style={{ background: `linear-gradient(145deg, ${tint(color, '22')}, ${tint(color, '0a')})`, borderColor: tint(color, '40') }}>
            <span className="num" style={{ color }}>{s.value}</span>
            <span className="label">{s.label}</span>
          </div>
        )
      })}
    </div>
  )
}

function Donut({ rows, size = 108 }) {
  const total = rows.reduce((s, r) => s + r.count, 0) || 1
  let cumulative = 0
  return (
    <svg width={size} height={size} viewBox="0 0 42 42">
      <circle cx="21" cy="21" r="15.5" fill="none" stroke="#f1f1f8" strokeWidth="5" />
      {rows.map((row) => {
        const pct = (row.count / total) * 100
        const rotation = -90 + (cumulative / 100) * 360
        cumulative += pct
        return <circle key={row.id} cx="21" cy="21" r="15.5" fill="none" stroke={row.color} strokeWidth="5" strokeDasharray={`${pct} ${100 - pct}`} transform={`rotate(${rotation} 21 21)`} />
      })}
      <text x="21" y="19.5" textAnchor="middle" fontSize="7.5" fontWeight="800" fill="#1a1f2e">{total}</text>
      <text x="21" y="25" textAnchor="middle" fontSize="3" fontWeight="700" letterSpacing=".05em" fill="#9ca3af">RESPONSES</text>
    </svg>
  )
}

function gradientFill(color) {
  return `linear-gradient(90deg, ${tint(color, 'b3')}, ${color})`
}

function ChoiceTile({ question, tileIndex }) {
  const baseColor = colorFor(tileIndex)
  const tileStyle = { background: `linear-gradient(160deg, ${tint(baseColor, '14')}, #ffffff)`, borderColor: tint(baseColor, '35') }
  if (question.question_type === 'word_cloud') {
    const words = [...(question.word_cloud || [])].sort((a, b) => b.count - a.count).slice(0, 24)
    return (
      <div className="choice-tile" style={tileStyle}>
        <h4>{question.prompt}</h4>
        {words.length
          ? <div className="cloud">{words.map((w) => <span key={w.word} className="cloud-tag" style={{ color: baseColor, fontSize: `${11 + Math.min(w.count, 14)}px` }}>{w.word}</span>)}</div>
          : <div className="empty">No responses yet</div>}
      </div>
    )
  }
  const rows = barRows(question.option_counts, question.option_labels)
  if (!rows.length) {
    return <div className="choice-tile" style={tileStyle}><h4>{question.prompt}</h4><div className="empty">No responses yet</div></div>
  }
  if (rows.length <= 5) {
    const donutRows = rows.map((r, i) => ({ ...r, color: colorFor(tileIndex * 2 + i) }))
    return (
      <div className="choice-tile" style={tileStyle}>
        <h4>{question.prompt}</h4>
        <div className="donut-card">
          <Donut rows={donutRows} />
          <div className="donut-legend">
            {donutRows.map((r) => <div className="row" key={r.id}><span className="swatch" style={{ background: r.color }} />{r.label}<b>{r.count}</b></div>)}
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="choice-tile choice-tile--wide" style={tileStyle}>
      <h4>{question.prompt}</h4>
      <div className="bars">
        {rows.map((r) => (
          <div className="bar-row" key={r.id}>
            <div className="bar-label">{r.label}</div>
            <div className="bar-track"><div className="bar-fill" style={{ width: `${r.pct}%`, background: gradientFill(baseColor) }} /></div>
            <div className="bar-count">{r.count}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function PriorityBlock({ question, index }) {
  const color = colorFor(index + 3)
  const baseRows = question.question_type === 'ranking' ? barRows(question.ranking_scores, question.option_labels) : barRows(question.option_counts, question.option_labels)
  const rows = baseRows.map((r, i) => ({ ...r, rank: i + 1 }))
  const split = rows.length > 8
  const cols = split ? [rows.slice(0, Math.ceil(rows.length / 2)), rows.slice(Math.ceil(rows.length / 2))] : [rows]
  return (
    <div className="priority-block">
      <div className="subsection-title" style={{ '--accent': color }}>{question.prompt} — all {rows.length} response{rows.length === 1 ? '' : 's'}</div>
      {rows.length ? (
        <div className={split ? 'two-col' : ''}>
          {cols.map((col, ci) => (
            <div className="bars" key={ci}>
              {col.map((r) => (
                <div className="bar-row bar-row--ranked" key={r.id}>
                  <span className={`rank-badge${r.rank === 1 ? ' rank-badge--gold' : ''}`}>{r.rank}</span>
                  <div className="bar-label">{r.label}</div>
                  <div className="bar-track"><div className="bar-fill" style={{ width: `${r.pct}%`, background: gradientFill(color) }} /></div>
                  <div className="bar-count">{r.count}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : <div className="empty">No responses yet</div>}
    </div>
  )
}

function QuestionCard({ question, index }) {
  const type = question.question_type
  const isRating = type in RATING_MAX
  const isChoice = CHOICE_TYPES.includes(type)
  const isRanking = type === 'ranking'
  const isNumber = type === 'number'
  const isWordCloud = type === 'word_cloud'
  const isSpatial = type === 'quadrant' || type === 'image_click'
  const isText = type === 'short_text' || type === 'long_text'
  const textSamples = question.text_samples || []

  return (
    <section className="q-card">
      <div className="q-head">
        <span className="q-index">Q{index + 1}</span>
        <h2>{question.prompt}</h2>
      </div>
      <div className="q-meta">{question.response_count} response{question.response_count === 1 ? '' : 's'}</div>

      {isChoice && (
        <div className="bars">
          {barRows(question.option_counts, question.option_labels).map((row) => (
            <div className="bar-row" key={row.id}>
              <div className="bar-label">{row.label}</div>
              <div className="bar-track"><div className="bar-fill" style={{ width: `${row.pct}%` }} /></div>
              <div className="bar-count">{row.count}</div>
            </div>
          ))}
          {!Object.keys(question.option_counts || {}).length && <div className="empty">No responses yet</div>}
        </div>
      )}

      {isRanking && (
        <div className="bars">
          {barRows(question.ranking_scores, question.option_labels).map((row) => (
            <div className="bar-row" key={row.id}>
              <div className="bar-label">{row.label}</div>
              <div className="bar-track"><div className="bar-fill bar-fill--ranking" style={{ width: `${row.pct}%` }} /></div>
              <div className="bar-count">{row.count}</div>
            </div>
          ))}
          {!Object.keys(question.ranking_scores || {}).length && <div className="empty">No responses yet</div>}
        </div>
      )}

      {isRating && (
        <div className="rating">
          <div className="rating-avg">
            <span className="rating-avg-num">{question.average_rating != null ? question.average_rating.toFixed(1) : '—'}</span>
            <span className="rating-avg-max">/ {RATING_MAX[type]}</span>
          </div>
          <div className="bars">
            {barRows(question.value_counts, null).map((row) => (
              <div className="bar-row" key={row.id}>
                <div className="bar-label">{row.label}</div>
                <div className="bar-track"><div className="bar-fill" style={{ width: `${row.pct}%` }} /></div>
                <div className="bar-count">{row.count}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {isNumber && (
        <div className="q-meta">
          {question.numeric_values?.length
            ? `Average: ${(question.numeric_values.reduce((a, b) => a + b, 0) / question.numeric_values.length).toFixed(1)} (n=${question.numeric_values.length})`
            : 'No responses yet'}
        </div>
      )}

      {isWordCloud && (
        <div className="cloud">
          {(question.word_cloud || []).length
            ? question.word_cloud.map((entry) => (
                <span className="cloud-tag" key={entry.word} style={{ fontSize: `${12 + Math.min(entry.count, 20)}px` }}>{entry.word}</span>
              ))
            : <div className="empty">No responses yet</div>}
        </div>
      )}

      {isSpatial && (
        <div className="q-meta">
          {question.points?.length ? `${question.points.length} placements recorded` : 'No responses yet'}
        </div>
      )}

      {(isText || isWordCloud) && textSamples.length > 0 && (
        <ul className="samples">
          {textSamples.map((sample, i) => <li key={i}>&ldquo;{sample}&rdquo;</li>)}
        </ul>
      )}
      {isText && textSamples.length === 0 && <div className="empty">No responses yet</div>}
    </section>
  )
}

export default function SurveyReportPage() {
  const { activityId } = useParams()
  const query = new URLSearchParams(window.location.search)
  const token = query.get('token') || ''
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch(`/api/engagement/v1/activities/${activityId}/report`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => { if (!res.ok) throw new Error(`Report failed (${res.status})`); return res.json() })
      .then((data) => { if (!cancelled) setReport(data) })
      .catch((err) => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true }
  }, [activityId, token])

  if (error) return <div className="report-error">{error}</div>
  if (!report) return <div className="report-loading">Loading report…</div>

  const questions = report.questions || []
  const { rating, choice, priority } = categorize(questions)
  const overall = pickOverallRating(rating)
  const findings = buildFindings(report, rating, choice, priority)
  const generatedAt = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
  const stats = [
    { label: 'Participants', value: report.participant_count ?? 0 },
    { label: 'Completion', value: report.survey_summary ? `${report.survey_summary.completion_rate}%` : (report.activity_summary ? `${report.activity_summary.response_rate}%` : '—') },
    { label: 'Avg Time', value: report.survey_summary ? formatMMSS(report.survey_summary.avg_completion_seconds) : '—' },
    { label: 'Overall Rating', value: overall?.average_rating != null ? `${overall.average_rating.toFixed(1)}/${RATING_MAX[overall.question_type]}` : '—' },
    { label: 'Answers', value: report.response_count ?? 0 },
  ]
  const sections = [
    'Executive Summary',
    rating.length && 'Ratings Breakdown',
    choice.length && 'Response Breakdown',
    priority.length && 'Priorities & Requests',
    'Full Question-by-Question Detail',
  ].filter(Boolean)
  let sectionCounter = 1
  const execSectionNum = sectionCounter++
  const ratingSectionNum = rating.length ? sectionCounter++ : null
  const choiceSectionNum = choice.length ? sectionCounter++ : null
  const prioritySectionNum = priority.length ? sectionCounter++ : null

  return (
    <div className="report-page">
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; }
        .report-page { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1a1f2e; background: #fff; max-width: 900px; margin: 0 auto; }
        .report-loading, .report-error { font-family: sans-serif; padding: 40px; color: #1a1f2e; }
        .pdf-section { padding: 8px 4px 4px; break-after: page; page-break-after: always; }

        /* ---- cover ---- */
        .cover-band { height: 68px; border-radius: 6px; margin-bottom: 18px; background: linear-gradient(100deg, #4f46e5, #0ea5a4 35%, #d97706 65%, #e11d48); position: relative; }
        .cover-band span { position: absolute; left: 18px; bottom: 12px; color: #fff; font-size: 11px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; opacity: .92; }
        .cover-eyebrow { font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: ${BRAND}; margin-bottom: 12px; }
        .cover-title { font-size: 30px; line-height: 1.25; margin: 0 0 8px; font-weight: 800; }
        .cover-sub { font-size: 14px; color: #6b7280; margin-bottom: 18px; }
        .cover-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; border-top: 1px solid #e5e7eb; padding-top: 14px; margin-bottom: 20px; font-size: 12.5px; }
        .cover-meta div span { display: block; color: #6b7280; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 2px; }
        .cover-toc { margin-top: 16px; }
        .cover-toc h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: #6b7280; margin: 0 0 10px; }
        .cover-toc ol { list-style: none; margin: 0; padding: 0; counter-reset: toc; }
        .cover-toc li { counter-increment: toc; display: flex; align-items: baseline; gap: 10px; font-size: 13px; padding: 5px 0; border-bottom: 1px dotted #e5e7eb; }
        .cover-toc li::before { content: counter(toc); font-weight: 700; color: ${BRAND}; width: 16px; }

        /* ---- headers ---- */
        .sec-eyebrow { font-size: 10.5px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #6b7280; display: flex; align-items: center; gap: 8px; }
        .sec-eyebrow::before { content: ""; width: 16px; height: 3px; border-radius: 2px; background: ${BRAND}; }
        .sec-title { font-size: 20px; font-weight: 800; margin: 5px 0 20px; padding-bottom: 12px; border-bottom: 2px solid ${BRAND}; }
        .subsection-title { font-size: 12.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: #1a1f2e; margin: 22px 0 12px; display: flex; align-items: center; gap: 8px; }
        .subsection-title:first-of-type { margin-top: 0; }
        .subsection-title::before { content: ""; width: 4px; height: 14px; background: var(--accent, ${BRAND}); border-radius: 2px; }

        /* ---- stats ---- */
        .stat-row { display: flex; gap: 12px; margin-bottom: 20px; }
        .stat { flex: 1; border: 1px solid; border-radius: 12px; padding: 14px 10px; text-align: center; box-shadow: 0 1px 2px rgba(20,22,55,.04); }
        .stat .num { display: block; font-size: 22px; font-weight: 800; font-variant-numeric: tabular-nums; }
        .stat .label { display: block; margin-top: 3px; font-size: 9.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: #6b7280; }

        /* ---- findings ---- */
        .findings { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 13px; }
        .findings li { display: flex; gap: 13px; font-size: 13px; line-height: 1.6; }
        .findings .num-badge { flex: none; width: 24px; height: 24px; border-radius: 50%; color: #fff; font-weight: 700; font-size: 11.5px; display: flex; align-items: center; justify-content: center; }

        /* ---- donut ---- */
        .donut-card { display: flex; align-items: center; gap: 16px; }
        .donut-legend { font-size: 11px; }
        .donut-legend .row { display: flex; align-items: center; gap: 7px; margin-bottom: 6px; }
        .donut-legend .swatch { width: 9px; height: 9px; border-radius: 2px; flex: none; }
        .donut-legend .row b { font-variant-numeric: tabular-nums; margin-left: auto; padding-left: 12px; }

        /* ---- bars ---- */
        .bars { display: flex; flex-direction: column; gap: 9px; }
        .bar-row { display: grid; grid-template-columns: 160px 1fr 32px; align-items: center; gap: 10px; font-size: 12px; }
        .bar-row--ranked { grid-template-columns: 20px 150px 1fr 32px; }
        .bar-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .bar-track { background: #f1f1f8; border-radius: 999px; height: 11px; overflow: hidden; box-shadow: inset 0 1px 2px rgba(20,22,55,.06); }
        .bar-fill { height: 100%; border-radius: 999px; background: ${gradientFill(BRAND)}; }
        .bar-fill--ranking { background: ${gradientFill('#0d9488')}; }
        .bar-count { text-align: right; color: #6b7280; font-variant-numeric: tabular-nums; font-weight: 600; }
        .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 0 24px; }
        .rank-badge { display: flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 6px; background: #f1f1f8; color: #6b7280; font-size: 9.5px; font-weight: 800; }
        .rank-badge--gold { background: linear-gradient(135deg, #fcd34d, #d97706); color: #fff; }

        /* ---- rating table ---- */
        .rating-list { display: flex; flex-direction: column; gap: 10px; }
        .rating-row { display: grid; grid-template-columns: 1fr 140px 40px; align-items: center; gap: 10px; font-size: 12px; }
        .rating-row.overall { background: #fef3e2; margin: -4px -10px 4px; padding: 9px 10px; border-radius: 8px; }
        .rating-row.overall .rating-label { font-weight: 700; }
        .rating-track { background: #f1f1f8; border-radius: 999px; height: 11px; overflow: hidden; box-shadow: inset 0 1px 2px rgba(20,22,55,.06); }
        .rating-fill { height: 100%; border-radius: 999px; }
        .rating-val { text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; }

        /* ---- choice grid ---- */
        .choice-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
        .choice-tile { border: 1px solid; border-radius: 16px; padding: 17px 19px; break-inside: avoid; page-break-inside: avoid; box-shadow: 0 2px 8px rgba(20,22,55,.05); }
        .choice-tile--wide { grid-column: 1 / -1; }
        .choice-tile h4 { font-size: 12.5px; margin: 0 0 12px; }

        /* ---- cloud ---- */
        .cloud { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; }
        .cloud-tag { font-weight: 700; }

        /* ---- priority blocks ---- */
        .priority-block { margin-bottom: 24px; break-inside: avoid; page-break-inside: avoid; }
        .priority-block:last-child { margin-bottom: 0; }

        /* ---- appendix divider ---- */
        .appendix-divider { display: flex; align-items: center; gap: 14px; margin: 4px 4px 22px; }
        .appendix-divider .line { flex: 1; height: 1px; background: #e5e7eb; }
        .appendix-divider span { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: #6b7280; white-space: nowrap; }

        /* ---- appendix question cards ---- */
        .q-card { break-inside: avoid; page-break-inside: avoid; border: 1px solid #e5e7eb; border-radius: 12px; padding: 18px 20px; margin: 0 4px 16px; }
        .q-head { display: flex; align-items: baseline; gap: 10px; }
        .q-index { font-size: 12px; font-weight: 700; color: ${BRAND}; background: ${tint(BRAND, '14')}; border-radius: 6px; padding: 2px 8px; }
        .q-head h2 { font-size: 16px; margin: 0; }
        .q-meta { color: #6b7280; font-size: 12px; margin: 6px 0 12px; }
        .rating-avg { display: flex; align-items: baseline; gap: 4px; margin-bottom: 12px; }
        .rating-avg-num { font-size: 28px; font-weight: 700; color: ${BRAND}; }
        .rating-avg-max { color: #6b7280; font-size: 13px; }
        .samples { margin: 8px 0 0; padding-left: 18px; font-size: 13px; color: #374151; }
        .samples li { margin-bottom: 6px; }
        .empty { color: #9ca3af; font-size: 12px; font-style: italic; }
      `}</style>

      {/* COVER */}
      <div className="pdf-section">
        <div className="cover-band"><span>Festio Live · Survey Report</span></div>
        <div className="cover-eyebrow">Survey Results Report</div>
        <div className="cover-title">{report.title}</div>
        <div className="cover-sub">{report.description || 'Full results from this event’s feedback survey'}</div>
        <div className="cover-meta">
          <div><span>Survey type</span>{report.type === 'feedback' ? 'Feedback' : 'Survey'}</div>
          <div><span>Prepared for</span>The event organizing team</div>
          <div><span>Questions</span>{questions.length}</div>
          <div><span>Generated</span>{generatedAt}</div>
        </div>
        <StatTiles stats={stats} />
        <div className="cover-toc">
          <h3>Contents</h3>
          <ol>{sections.map((s) => <li key={s}>{s}</li>)}</ol>
        </div>
      </div>

      {/* EXECUTIVE SUMMARY */}
      <div className="pdf-section">
        <div className="sec-eyebrow">Section {execSectionNum}</div>
        <div className="sec-title">Executive Summary</div>
        <StatTiles stats={stats} />
        {findings.length > 0 && <>
          <div className="subsection-title">Key findings</div>
          <ol className="findings">
            {findings.map((text, i) => (
              <li key={i}><span className="num-badge" style={{ background: colorFor(i) }}>{i + 1}</span><span>{text}</span></li>
            ))}
          </ol>
        </>}
      </div>

      {/* RATINGS */}
      {rating.length > 0 && (
        <div className="pdf-section">
          <div className="sec-eyebrow">Section {ratingSectionNum} · Survey Insights Wall</div>
          <div className="sec-title">Ratings Breakdown</div>
          <div className="rating-list">
            {rating.map((q, i) => {
              const isOverall = q === overall
              const max = RATING_MAX[q.question_type]
              const pct = q.average_rating != null ? (q.average_rating / max) * 100 : 0
              return (
                <div className={`rating-row${isOverall ? ' overall' : ''}`} key={q.question_id}>
                  <div className="rating-label">{q.prompt}</div>
                  <div className="rating-track"><div className="rating-fill" style={{ width: `${pct}%`, background: isOverall ? gradientFill('#d97706') : gradientFill(colorFor(i)) }} /></div>
                  <div className="rating-val">{q.average_rating != null ? q.average_rating.toFixed(2) : '—'}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* CHOICE BREAKDOWN */}
      {choice.length > 0 && (
        <div className="pdf-section">
          <div className="sec-eyebrow">Section {choiceSectionNum} · Survey Insights Wall</div>
          <div className="sec-title">Response Breakdown</div>
          <div className="choice-grid">
            {choice.map((q, i) => <ChoiceTile key={q.question_id} question={q} tileIndex={i} />)}
          </div>
        </div>
      )}

      {/* PRIORITIES */}
      {priority.length > 0 && (
        <div className="pdf-section">
          <div className="sec-eyebrow">Section {prioritySectionNum} · Survey Insights Wall</div>
          <div className="sec-title">Priorities &amp; Requests</div>
          {priority.map((q, i) => <PriorityBlock key={q.question_id} question={q} index={i} />)}
        </div>
      )}

      {/* APPENDIX */}
      <div className="appendix-divider"><div className="line" /><span>Full question-by-question detail</span><div className="line" /></div>
      {questions.map((question, index) => <QuestionCard key={question.question_id} question={question} index={index} />)}

      <div className="flb-report-ready" style={{ display: 'none' }} />
    </div>
  )
}
