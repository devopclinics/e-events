import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'

// This is a staff-only PDF surface. It is intentionally separate from the
// live display so it can read complete survey structure without claiming a
// projector connection or inheriting display curation.
const RATING_MAX = { rating_5: 5, rating_10: 10, nps: 10 }
const SINGLE_SELECT_TYPES = new Set(['single_choice', 'true_false', 'yes_no'])
const MULTI_SELECT_TYPES = new Set(['multiple_choice'])
const TEXT_TYPES = new Set(['short_text', 'long_text'])
const EMPTY_COPY = 'No responses were recorded for this question.'

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(Number(value || 0))
}

function formatDuration(seconds) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return '—'
  const total = Math.max(0, Math.round(Number(seconds)))
  const minutes = Math.floor(total / 60)
  const remainder = String(total % 60).padStart(2, '0')
  return minutes ? `${minutes}m ${remainder}s` : `${remainder}s`
}

function ratingMax(question) {
  return RATING_MAX[question.question_type] || 5
}

function displayRating(question, digits = 2) {
  return question.average_rating == null ? '—' : Number(question.average_rating).toFixed(digits)
}

function normalizedRating(question) {
  if (question.average_rating == null) return null
  const max = ratingMax(question)
  return max ? Number(question.average_rating) / max : null
}

function rowsFromCounts(counts, labels = {}) {
  const entries = Object.entries(counts || {})
  const total = entries.reduce((sum, [, count]) => sum + Number(count || 0), 0)
  const largest = Math.max(1, ...entries.map(([, count]) => Number(count || 0)))
  return entries
    .map(([id, count]) => ({
      id,
      label: labels?.[id] || id,
      count: Number(count || 0),
      percentOfSelections: total ? Math.round((Number(count || 0) / total) * 100) : 0,
      percentOfLargest: Math.round((Number(count || 0) / largest) * 100),
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

function questionRows(question) {
  return rowsFromCounts(
    question.question_type === 'ranking' ? question.ranking_scores : question.option_counts,
    question.option_labels,
  )
}

function topRow(question) {
  return questionRows(question)[0] || null
}

function categorizeQuestions(questions) {
  return {
    ratings: questions.filter((question) => question.question_type in RATING_MAX),
    priorities: questions.filter((question) => question.question_type === 'ranking' || MULTI_SELECT_TYPES.has(question.question_type)),
    selections: questions.filter((question) => SINGLE_SELECT_TYPES.has(question.question_type)),
    clouds: questions.filter((question) => question.question_type === 'word_cloud'),
    text: questions.filter((question) => TEXT_TYPES.has(question.question_type)),
  }
}

function getRatingSignals(ratings) {
  const measured = ratings
    .map((question) => ({ question, normalized: normalizedRating(question) }))
    .filter((item) => item.normalized != null)
    .sort((a, b) => b.normalized - a.normalized)
  return { strongest: measured[0]?.question || null, weakest: measured.at(-1)?.question || null }
}

function collectVoices(questions) {
  return questions
    .flatMap((question) => (question.text_samples || []).map((text) => ({ text, prompt: question.prompt })))
    .filter((voice) => voice.text?.trim())
    .slice(0, 6)
}

function reportTitle(report) {
  return report.title?.trim() || 'Event feedback briefing'
}

function reportDeck(report) {
  return report.description?.trim() || `A decision brief built from ${formatNumber(report.participant_count)} participant voices.`
}

function pageLabel(report) {
  return report.type === 'feedback' ? 'Feedback intelligence' : 'Survey intelligence'
}

function stateForRating(question) {
  const normalized = normalizedRating(question)
  if (normalized == null) return 'No score'
  if (normalized >= 0.84) return 'Strong'
  if (normalized >= 0.7) return 'Steady'
  return 'Needs attention'
}

function toneForRating(question) {
  const normalized = normalizedRating(question)
  if (normalized == null) return 'neutral'
  if (normalized >= 0.84) return 'positive'
  if (normalized >= 0.7) return 'planning'
  return 'attention'
}

function ReportMasthead({ report, section }) {
  return (
    <header className="report-masthead">
      <div className="report-brand"><span className="report-mark">f</span><span>FESTIO</span></div>
      <div className="report-masthead-meta"><span>{pageLabel(report)}</span><i /> <span>{section}</span></div>
    </header>
  )
}

function SectionHeading({ eyebrow, title, children }) {
  return (
    <header className="section-heading">
      <div>
        <p className="section-eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      {children && <div className="section-heading-aside">{children}</div>}
    </header>
  )
}

function MetricStrip({ metrics }) {
  return (
    <div className="metric-strip">
      {metrics.map((metric) => (
        <div className="metric" key={metric.label}>
          <strong>{metric.value}</strong>
          <span>{metric.label}</span>
          {metric.detail && <small>{metric.detail}</small>}
        </div>
      ))}
    </div>
  )
}

function DecisionCard({ kind, title, value, detail, description }) {
  return (
    <article className={`decision-card decision-card--${kind}`}>
      <span className="decision-label">{kind === 'positive' ? 'Preserve' : kind === 'attention' ? 'Improve' : 'Plan next'}</span>
      <h3>{title}</h3>
      {value && <strong className="decision-value">{value}</strong>}
      {detail && <span className="decision-detail">{detail}</span>}
      {description && <p>{description}</p>}
    </article>
  )
}

function BarList({ rows, responseCount, multiple = false, ranked = false, limit = null }) {
  const visibleRows = limit ? rows.slice(0, limit) : rows
  const highest = Math.max(1, ...visibleRows.map((row) => row.count))
  if (!visibleRows.length) return <p className="empty-state">{EMPTY_COPY}</p>
  return (
    <div className="bar-list">
      {visibleRows.map((row, index) => {
        const respondentsText = responseCount
          ? multiple
            ? `Selected by ${row.count} of ${responseCount}`
            : `${row.count} of ${responseCount} · ${Math.round((row.count / responseCount) * 100)}%`
          : `${row.count}`
        return (
          <div className="bar-row" key={row.id}>
            {ranked && <span className="rank">{index + 1}</span>}
            <div className="bar-copy"><span>{row.label}</span><small>{respondentsText}</small></div>
            <div className="bar-track" aria-hidden="true"><i style={{ width: `${Math.round((row.count / highest) * 100)}%` }} /></div>
            <strong className="bar-value">{row.count}</strong>
          </div>
        )
      })}
    </div>
  )
}

function RatingScorecard({ ratings, overall }) {
  if (!ratings.length) return null
  const ordered = [...ratings].sort((left, right) => (normalizedRating(right) ?? -1) - (normalizedRating(left) ?? -1))
  return (
    <section className="report-section report-section--new-page" aria-label="Experience quality scorecard">
      <SectionHeading eyebrow="Experience quality" title="Protect what people valued. Repair what held them back.">
        <p>Scores are ordered by relative strength, with each rating kept on its original scale.</p>
      </SectionHeading>
      <div className="scorecard">
        {ordered.map((question) => {
          const normalized = normalizedRating(question) || 0
          const tone = toneForRating(question)
          return (
            <article className={`score-row score-row--${tone}`} key={question.question_id}>
              <div className="score-topic"><h3>{question.prompt}</h3><span>{question.response_count || 0} responses</span></div>
              <div className="score-bar"><i style={{ width: `${Math.round(normalized * 100)}%` }} /></div>
              <div className="score-number"><strong>{displayRating(question)}</strong><span>/ {ratingMax(question)}</span></div>
              <span className="score-state">{question === overall ? 'Overall · ' : ''}{stateForRating(question)}</span>
            </article>
          )
        })}
      </div>
      {overall && <aside className="score-note"><strong>{displayRating(overall, 1)} / {ratingMax(overall)}</strong><span>Overall experience score</span><p>This score appears once as context; the ranked detail shows where the experience gained or lost confidence.</p></aside>}
    </section>
  )
}

function PrioritiesSection({ questions }) {
  if (!questions.length) return null
  return (
    <section className="report-section" aria-label="Planning priorities">
      <SectionHeading eyebrow="Planning priorities" title="Turn repeated requests into the next program.">
        <p>Ranked and multi-select responses are shown with their respondent context, so prominence is never mistaken for consensus.</p>
      </SectionHeading>
      <div className="priority-grid">
        {questions.map((question) => {
          const rows = questionRows(question)
          const multiple = MULTI_SELECT_TYPES.has(question.question_type)
          return (
            <article className="priority-card" key={question.question_id}>
              <div className="question-kicker">{question.question_type === 'ranking' ? 'Ranked preference' : 'Selected themes'}</div>
              <h3>{question.prompt}</h3>
              <p className="question-meta">{question.response_count || 0} responses{multiple ? ' · guests could select more than one answer' : ''}</p>
              <BarList rows={rows} responseCount={question.response_count} multiple={multiple} ranked={question.question_type === 'ranking'} limit={12} />
              {rows.length > 12 && <p className="truncated-note">+ {rows.length - 12} more options appear in the question appendix.</p>}
            </article>
          )
        })}
      </div>
    </section>
  )
}

function ResponsePatterns({ selections, clouds }) {
  if (!selections.length && !clouds.length) return null
  return (
    <section className="report-section" aria-label="Response patterns">
      <SectionHeading eyebrow="Response patterns" title="The choices behind the headline findings.">
        <p>Every label is allowed to wrap so the report preserves participants’ language instead of shortening it for a chart.</p>
      </SectionHeading>
      <div className="pattern-grid">
        {selections.map((question) => (
          <article className="pattern-card" key={question.question_id}>
            <h3>{question.prompt}</h3>
            <p className="question-meta">{question.response_count || 0} responses</p>
            <BarList rows={questionRows(question)} responseCount={question.response_count} />
          </article>
        ))}
        {clouds.map((question) => {
          const words = [...(question.word_cloud || [])].sort((left, right) => right.count - left.count).slice(0, 28)
          return (
            <article className="pattern-card pattern-card--cloud" key={question.question_id}>
              <h3>{question.prompt}</h3>
              <p className="question-meta">{question.response_count || 0} responses</p>
              {words.length ? <div className="word-cloud">{words.map((word) => <span key={word.word} style={{ fontSize: `${12 + Math.min(16, Number(word.count || 0))}px` }}>{word.word}<small>{word.count}</small></span>)}</div> : <p className="empty-state">{EMPTY_COPY}</p>}
            </article>
          )
        })}
      </div>
    </section>
  )
}

function GuestVoices({ voices }) {
  if (!voices.length) return null
  return (
    <section className="voices" aria-label="Guest voices">
      <div className="voices-heading"><span>What guests said</span><p>Representative staff-visible excerpts. Responses are not attributed to individuals.</p></div>
      <div className="voice-grid">
        {voices.map((voice, index) => <blockquote key={`${voice.prompt}-${index}`}><p>“{voice.text}”</p><footer>{voice.prompt}</footer></blockquote>)}
      </div>
    </section>
  )
}

function NumericSummary({ question }) {
  const values = (question.numeric_values || []).map(Number).filter(Number.isFinite)
  if (!values.length) return <p className="empty-state">{EMPTY_COPY}</p>
  const total = values.reduce((sum, value) => sum + value, 0)
  return <div className="numeric-summary"><div><strong>{(total / values.length).toFixed(1)}</strong><span>Average</span></div><div><strong>{Math.min(...values)}</strong><span>Lowest</span></div><div><strong>{Math.max(...values)}</strong><span>Highest</span></div></div>
}

function SpatialSummary({ question }) {
  const points = question.points || []
  if (!points.length) return <p className="empty-state">{EMPTY_COPY}</p>
  return <div className="spatial-summary"><strong>{points.length}</strong><span>placements recorded</span><p>Spatial responses are retained in the activity data. This printable summary avoids inventing a heatmap when the source board or axes are unavailable.</p></div>
}

function QuestionCard({ question, index }) {
  const type = question.question_type
  const isRating = type in RATING_MAX
  const isRanking = type === 'ranking'
  const isSingle = SINGLE_SELECT_TYPES.has(type)
  const isMulti = MULTI_SELECT_TYPES.has(type)
  const isText = TEXT_TYPES.has(type)
  const isWordCloud = type === 'word_cloud'
  const isNumber = type === 'number'
  const isSpatial = type === 'quadrant' || type === 'image_click'
  const rows = questionRows(question)
  const samples = question.text_samples || []
  const textLike = isText || isWordCloud
  return (
    <article className={`question-card${textLike ? ' question-card--text' : ''}`}>
      <header className="question-header"><span>Q{index + 1}</span><div><h3>{question.prompt}</h3><p>{question.response_count || 0} response{question.response_count === 1 ? '' : 's'} · {type.replaceAll('_', ' ')}</p></div></header>
      {isRating && <div className="appendix-rating"><strong>{displayRating(question, 1)}</strong><span>/ {ratingMax(question)}</span><BarList rows={rowsFromCounts(question.value_counts)} responseCount={question.response_count} /></div>}
      {(isSingle || isMulti) && <BarList rows={rows} responseCount={question.response_count} multiple={isMulti} />}
      {isRanking && <BarList rows={rows} responseCount={question.response_count} ranked />}
      {isNumber && <NumericSummary question={question} />}
      {isWordCloud && <div className="word-cloud word-cloud--appendix">{(question.word_cloud || []).map((word) => <span key={word.word}>{word.word}<small>{word.count}</small></span>)}</div>}
      {isSpatial && <SpatialSummary question={question} />}
      {isText && !samples.length && <p className="empty-state">{EMPTY_COPY}</p>}
      {textLike && samples.length > 0 && <div className="response-excerpts"><span>Staff-visible response excerpts</span>{samples.map((sample, sampleIndex) => <p key={sampleIndex}>“{sample}”</p>)}</div>}
      {!isRating && !isSingle && !isMulti && !isRanking && !isNumber && !isWordCloud && !isSpatial && !isText && <p className="empty-state">This question type has no printable summary yet. Its response count is retained above.</p>}
    </article>
  )
}

function ReportStyles() {
  return <style>{`
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body { background: #edf1f6; margin: 0; }
    .report-loading, .report-error { color: #152238; font: 500 16px/1.5 Inter, ui-sans-serif, system-ui, sans-serif; padding: 48px; }
    .report-document { --ink:#13233d; --muted:#637086; --paper:#fffdf8; --line:#dce2ea; --violet:#6b5ce7; --teal:#159f91; --amber:#d88911; --pale-violet:#eeebff; --pale-teal:#e2f5f0; --pale-amber:#fff1d8; background:var(--paper); color:var(--ink); font-family:Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin:0 auto; max-width:1000px; padding:30px 38px 44px; }
    .report-document * { box-sizing:border-box; }
    .report-masthead { align-items:center; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; padding-bottom:15px; }
    .report-brand { align-items:center; display:flex; font-size:12px; font-weight:800; gap:9px; letter-spacing:.18em; }
    .report-mark { align-items:center; background:var(--ink); border-radius:7px; color:#fff; display:inline-flex; font-family:Georgia, serif; font-size:19px; font-weight:700; height:25px; justify-content:center; letter-spacing:-.08em; width:25px; }
    .report-masthead-meta { color:var(--muted); display:flex; font-size:10px; font-weight:750; gap:8px; letter-spacing:.12em; text-transform:uppercase; }
    .report-masthead-meta i { background:var(--line); height:12px; width:1px; }
    .report-cover { min-height:640px; padding:0 0 28px; }
    .cover-kicker, .section-eyebrow, .question-kicker { color:var(--violet); font-size:10px; font-weight:800; letter-spacing:.15em; margin:52px 0 14px; text-transform:uppercase; }
    .cover-title { font-family:Georgia, "Times New Roman", serif; font-size:46px; font-weight:600; letter-spacing:-.048em; line-height:1.03; margin:0; max-width:730px; }
    .cover-deck { color:#53627a; font-size:16px; line-height:1.55; margin:18px 0 26px; max-width:710px; }
    .cover-facts { align-items:center; color:var(--muted); display:flex; flex-wrap:wrap; font-size:11px; gap:12px; margin-bottom:30px; }
    .cover-facts strong { color:var(--ink); display:block; font-size:11px; }
    .cover-facts i { background:var(--line); height:25px; width:1px; }
    .metric-strip { border:1px solid var(--line); border-radius:16px; display:grid; grid-template-columns:repeat(4,1fr); margin:24px 0; overflow:hidden; }
    .metric { border-left:1px solid var(--line); min-height:86px; padding:17px 16px; }
    .metric:first-child { border-left:0; }
    .metric strong { display:block; font-family:Georgia, serif; font-size:30px; font-weight:600; letter-spacing:-.04em; line-height:1; }
    .metric span { color:var(--muted); display:block; font-size:9px; font-weight:800; letter-spacing:.1em; margin-top:7px; text-transform:uppercase; }
    .metric small { color:var(--muted); display:block; font-size:10px; margin-top:3px; }
    .cover-decision-heading { align-items:baseline; display:flex; gap:15px; justify-content:space-between; margin-top:28px; }
    .cover-decision-heading h2 { font-family:Georgia, serif; font-size:25px; font-weight:600; letter-spacing:-.03em; margin:0; }
    .cover-decision-heading p { color:var(--muted); font-size:11px; margin:0; text-align:right; }
    .decision-grid { display:grid; gap:12px; grid-template-columns:repeat(3,1fr); margin-top:14px; }
    .decision-card { border:1px solid var(--line); border-radius:14px; min-height:158px; padding:17px; }
    .decision-card--positive { background:var(--pale-teal); border-color:#cce9e2; }
    .decision-card--attention { background:var(--pale-amber); border-color:#f1d69d; }
    .decision-card--planning { background:var(--pale-violet); border-color:#dcd7ff; }
    .decision-label { color:var(--muted); display:block; font-size:9px; font-weight:800; letter-spacing:.12em; text-transform:uppercase; }
    .decision-card h3 { font-family:Georgia, serif; font-size:18px; font-weight:600; letter-spacing:-.025em; line-height:1.15; margin:9px 0 3px; overflow-wrap:anywhere; }
    .decision-value { display:inline-block; font-family:Georgia, serif; font-size:29px; font-weight:600; letter-spacing:-.045em; margin-top:5px; }
    .decision-detail { color:var(--muted); display:inline-block; font-size:10px; margin-left:5px; }
    .decision-card p { color:#4d5d73; font-size:11px; line-height:1.4; margin:8px 0 0; }
    .cover-footer, .section-footer { color:var(--muted); display:flex; font-size:9px; justify-content:space-between; letter-spacing:.1em; margin-top:32px; text-transform:uppercase; }
    .report-section { margin-top:38px; }
    .section-heading { align-items:end; border-bottom:1px solid var(--line); display:flex; gap:28px; justify-content:space-between; margin-bottom:22px; padding-bottom:18px; }
    .section-heading .section-eyebrow { margin:0 0 10px; }
    .section-heading h2 { font-family:Georgia, serif; font-size:34px; font-weight:600; letter-spacing:-.042em; line-height:1.08; margin:0; }
    .section-heading-aside { color:var(--muted); font-size:11px; line-height:1.45; max-width:250px; text-align:right; }
    .scorecard { display:flex; flex-direction:column; gap:11px; }
    .score-row { align-items:center; border-bottom:1px solid var(--line); display:grid; gap:14px; grid-template-columns:minmax(180px,1.1fr) minmax(130px,1fr) 72px 95px; padding:12px 0; }
    .score-topic h3, .pattern-card h3, .priority-card h3 { font-size:13px; font-weight:750; line-height:1.35; margin:0; overflow-wrap:anywhere; }
    .score-topic span, .question-meta { color:var(--muted); display:block; font-size:10px; margin-top:4px; }
    .score-bar { background:#e9edf3; border-radius:999px; height:8px; overflow:hidden; }
    .score-bar i { background:var(--violet); border-radius:inherit; display:block; height:100%; }
    .score-row--positive .score-bar i { background:var(--teal); }
    .score-row--attention .score-bar i { background:var(--amber); }
    .score-number { align-items:baseline; display:flex; gap:3px; justify-content:flex-end; }
    .score-number strong { font-family:Georgia, serif; font-size:24px; font-weight:600; letter-spacing:-.04em; }
    .score-number span { color:var(--muted); font-size:10px; }
    .score-state { color:var(--muted); font-size:10px; font-weight:750; text-align:right; }
    .score-note { align-items:baseline; background:var(--ink); border-radius:14px; color:#fff; display:grid; gap:4px 10px; grid-template-columns:auto 1fr; margin-top:20px; padding:17px 20px; }
    .score-note strong { color:#7ee3d4; font-family:Georgia, serif; font-size:28px; font-weight:600; letter-spacing:-.04em; }
    .score-note span { font-size:10px; font-weight:800; letter-spacing:.1em; text-transform:uppercase; }
    .score-note p { color:#d6e2f0; font-size:11px; grid-column:1 / -1; line-height:1.45; margin:3px 0 0; }
    .priority-grid, .pattern-grid { display:grid; gap:16px; grid-template-columns:repeat(2,minmax(0,1fr)); }
    .priority-card, .pattern-card { border:1px solid var(--line); border-radius:15px; break-inside:avoid; padding:18px; }
    .priority-card { background:#faf9ff; border-color:#e2ddff; }
    .question-kicker { margin:0 0 8px; }
    .truncated-note { color:var(--muted); font-size:10px; margin:12px 0 0; }
    .bar-list { display:flex; flex-direction:column; gap:10px; margin-top:16px; }
    .bar-row { align-items:center; display:grid; gap:9px; grid-template-columns:minmax(110px,1.2fr) minmax(60px,1fr) 28px; }
    .bar-row:has(.rank) { grid-template-columns:20px minmax(98px,1.2fr) minmax(60px,1fr) 28px; }
    .rank { align-items:center; background:var(--pale-violet); border-radius:6px; color:var(--violet); display:inline-flex; font-size:10px; font-weight:800; height:20px; justify-content:center; width:20px; }
    .bar-copy { min-width:0; }
    .bar-copy span { display:block; font-size:11px; font-weight:650; line-height:1.25; overflow-wrap:anywhere; }
    .bar-copy small { color:var(--muted); display:block; font-size:9px; line-height:1.3; margin-top:3px; }
    .bar-track { background:#e9edf3; border-radius:999px; height:7px; overflow:hidden; }
    .bar-track i { background:var(--violet); border-radius:inherit; display:block; height:100%; }
    .priority-card .bar-track i { background:linear-gradient(90deg, var(--violet), #a095ff); }
    .bar-value { font-family:Georgia, serif; font-size:17px; font-weight:600; text-align:right; }
    .word-cloud { align-items:baseline; display:flex; flex-wrap:wrap; gap:8px 12px; margin-top:18px; }
    .word-cloud span { color:var(--violet); font-weight:750; line-height:1; overflow-wrap:anywhere; }
    .word-cloud small { color:var(--muted); font-size:9px; margin-left:3px; vertical-align:top; }
    .voices { background:var(--ink); border-radius:17px; color:#fff; margin-top:24px; padding:22px; }
    .voices-heading { align-items:baseline; display:flex; justify-content:space-between; }
    .voices-heading span { font-family:Georgia, serif; font-size:25px; font-weight:600; letter-spacing:-.03em; }
    .voices-heading p { color:#c7d7eb; font-size:10px; line-height:1.35; margin:0; max-width:280px; text-align:right; }
    .voice-grid { display:grid; gap:10px; grid-template-columns:repeat(3,1fr); margin-top:18px; }
    .voice-grid blockquote { background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.12); border-radius:11px; margin:0; min-height:112px; padding:14px; }
    .voice-grid p { font-family:Georgia, serif; font-size:14px; line-height:1.32; margin:0; }
    .voice-grid footer { color:#91e4d7; font-size:9px; line-height:1.3; margin-top:13px; overflow-wrap:anywhere; }
    .appendix-heading { border-top:2px solid var(--ink); margin-top:38px; padding-top:25px; }
    .appendix-heading h2 { font-family:Georgia, serif; font-size:32px; font-weight:600; letter-spacing:-.04em; margin:0; }
    .appendix-heading p { color:var(--muted); font-size:12px; line-height:1.45; margin:9px 0 0; max-width:670px; }
    .question-card { border:1px solid var(--line); border-radius:14px; break-inside:avoid; margin-top:16px; padding:18px; }
    .question-card--text { break-inside:auto; }
    .question-header { align-items:flex-start; display:grid; gap:11px; grid-template-columns:auto 1fr; }
    .question-header > span { background:var(--pale-violet); border-radius:999px; color:var(--violet); font-size:10px; font-weight:850; letter-spacing:.08em; padding:6px 8px; }
    .question-header h3 { font-size:14px; line-height:1.34; margin:0; overflow-wrap:anywhere; }
    .question-header p { color:var(--muted); font-size:10px; margin:4px 0 0; text-transform:capitalize; }
    .appendix-rating { align-items:baseline; border-bottom:1px solid var(--line); display:flex; gap:4px; margin:15px 0 2px; padding-bottom:12px; }
    .appendix-rating > strong { color:var(--violet); font-family:Georgia, serif; font-size:34px; font-weight:600; letter-spacing:-.05em; }
    .appendix-rating > span { color:var(--muted); font-size:12px; }
    .appendix-rating .bar-list { flex:1; margin:0 0 0 22px; }
    .numeric-summary { display:flex; gap:28px; margin-top:18px; }
    .numeric-summary div { border-left:2px solid var(--violet); padding-left:10px; }
    .numeric-summary strong { display:block; font-family:Georgia, serif; font-size:26px; font-weight:600; }
    .numeric-summary span, .spatial-summary span { color:var(--muted); font-size:10px; font-weight:750; letter-spacing:.08em; text-transform:uppercase; }
    .spatial-summary { align-items:baseline; display:flex; flex-wrap:wrap; gap:7px; margin-top:18px; }
    .spatial-summary strong { color:var(--violet); font-family:Georgia, serif; font-size:31px; }
    .spatial-summary p { color:var(--muted); flex-basis:100%; font-size:11px; line-height:1.4; margin:3px 0 0; }
    .response-excerpts { border-left:2px solid var(--teal); margin-top:18px; padding-left:14px; }
    .response-excerpts > span { color:var(--muted); font-size:9px; font-weight:800; letter-spacing:.1em; text-transform:uppercase; }
    .response-excerpts p { font-family:Georgia, serif; font-size:14px; line-height:1.4; margin:9px 0 0; }
    .empty-state { color:var(--muted); font-size:12px; font-style:italic; margin:16px 0 0; }
    .flb-report-ready { display:none; }
    @media print {
      @page { size:A4 landscape; margin:0; }
      html, body { background:#fff; print-color-adjust:exact; -webkit-print-color-adjust:exact; }
      .report-document { max-width:none; padding:0; }
      .report-cover { break-after:page; min-height:166mm; page-break-after:always; }
      .report-section--new-page, .appendix-heading { break-before:page; page-break-before:always; }
      .report-section { margin-top:0; padding-top:0; }
      .section-heading { break-after:avoid-page; page-break-after:avoid; }
      .section-heading, .score-row, .priority-card, .pattern-card { break-inside:avoid; page-break-inside:avoid; }
      .question-card { break-inside:avoid; page-break-inside:avoid; }
      .question-card--text { break-inside:auto; page-break-inside:auto; }
      .report-masthead { margin-top:0; }
    }
  `}</style>
}

export default function SurveyReportPage() {
  const { activityId } = useParams()
  const token = new URLSearchParams(window.location.search).get('token') || ''
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch(`/api/engagement/v1/activities/${activityId}/report`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => { if (!response.ok) throw new Error(`Report failed (${response.status})`); return response.json() })
      .then((data) => { if (!cancelled) setReport(data) })
      .catch((reason) => { if (!cancelled) setError(reason.message) })
    return () => { cancelled = true }
  }, [activityId, token])

  const model = useMemo(() => {
    if (!report) return null
    const questions = report.questions || []
    const categories = categorizeQuestions(questions)
    const overall = categories.ratings.find((question) => /overall/i.test(question.prompt)) || categories.ratings[0] || null
    const signals = getRatingSignals(categories.ratings)
    const priorityCandidate = categories.priorities.map((question) => ({ question, row: topRow(question) })).filter((item) => item.row).sort((left, right) => right.row.count - left.row.count)[0]
    const voices = collectVoices(categories.text)
    const completion = report.survey_summary?.completion_rate ?? report.activity_summary?.response_rate
    const stats = [
      { label: 'Participant voices', value: formatNumber(report.participant_count), detail: 'Cohort reached' },
      { label: 'Completion', value: completion == null ? '—' : `${completion}%`, detail: 'Started the survey' },
      { label: 'Overall experience', value: overall ? `${displayRating(overall, 1)}/${ratingMax(overall)}` : '—', detail: overall ? `${overall.response_count || 0} ratings` : 'No rating question' },
      { label: 'Responses', value: formatNumber(report.response_count), detail: report.survey_summary ? `Average ${formatDuration(report.survey_summary.avg_completion_seconds)}` : `${questions.length} questions` },
    ]
    const decisions = []
    if (signals.strongest) decisions.push({ kind: 'positive', title: signals.strongest.prompt, value: `${displayRating(signals.strongest)}/${ratingMax(signals.strongest)}`, detail: `${signals.strongest.response_count || 0} ratings`, description: 'The strongest scored experience to protect as the program evolves.' })
    if (signals.weakest && signals.weakest !== signals.strongest) decisions.push({ kind: 'attention', title: signals.weakest.prompt, value: `${displayRating(signals.weakest)}/${ratingMax(signals.weakest)}`, detail: `${signals.weakest.response_count || 0} ratings`, description: 'The clearest evidence-backed improvement opportunity.' })
    if (priorityCandidate) decisions.push({ kind: 'planning', title: priorityCandidate.row.label, value: `${priorityCandidate.row.count}`, detail: 'mentions', description: `Most selected in “${priorityCandidate.question.prompt}”.` })
    return { questions, categories, overall, voices, stats, decisions, completion }
  }, [report])

  if (error) return <div className="report-error">{error}</div>
  if (!report || !model) return <div className="report-loading">Loading report…</div>

  const generatedAt = new Date().toLocaleDateString('en-US', { dateStyle: 'long' })
  return (
    <main className="report-document">
      <ReportStyles />
      <section className="report-cover">
        <ReportMasthead report={report} section="Post-event report" />
        <p className="cover-kicker">Decision brief · {generatedAt}</p>
        <h1 className="cover-title">{reportTitle(report)}</h1>
        <p className="cover-deck">{reportDeck(report)}</p>
        <div className="cover-facts"><span><strong>Prepared for</strong>Event organizing team</span><i /><span><strong>Report type</strong>{pageLabel(report)}</span><i /><span><strong>Questions covered</strong>{model.questions.length}</span></div>
        <MetricStrip metrics={model.stats} />
        {model.decisions.length > 0 && <><div className="cover-decision-heading"><h2>What should guide planning now</h2><p>Evidence first. Clear next moves.</p></div><div className="decision-grid">{model.decisions.map((decision) => <DecisionCard key={`${decision.kind}-${decision.title}`} {...decision} />)}</div></>}
        <footer className="cover-footer"><span>Festio · event intelligence</span><span>Report generated {generatedAt}</span></footer>
      </section>

      <section className="report-section report-section--new-page" aria-label="Executive planning brief">
        <SectionHeading eyebrow="Planning brief" title="A clearer way to read event feedback."><p>This report distinguishes evidence, planning choices, and response detail. It keeps the full question set without turning every answer into a dashboard.</p></SectionHeading>
        <MetricStrip metrics={model.stats} />
        <div className="decision-grid">{model.decisions.length ? model.decisions.map((decision) => <DecisionCard key={`brief-${decision.kind}-${decision.title}`} {...decision} />) : <p className="empty-state">There is not enough scored or ranked feedback yet to derive planning signals.</p>}</div>
        <GuestVoices voices={model.voices} />
        <footer className="section-footer"><span>Festio · planning brief</span><span>{model.questions.length} questions retained in appendix</span></footer>
      </section>

      <RatingScorecard ratings={model.categories.ratings} overall={model.overall} />
      <PrioritiesSection questions={model.categories.priorities} />
      <ResponsePatterns selections={model.categories.selections} clouds={model.categories.clouds} />

      <section className="appendix-heading" aria-label="Question-by-question detail"><p className="section-eyebrow">Complete evidence</p><h2>Question-by-question detail</h2><p>Every question is retained below. Open-text excerpts are the staff-visible samples supplied to this report, not attributed to individuals.</p></section>
      {model.questions.map((question, index) => <QuestionCard key={question.question_id || index} question={question} index={index} />)}
      <div className="flb-report-ready" aria-hidden="true" />
    </main>
  )
}
