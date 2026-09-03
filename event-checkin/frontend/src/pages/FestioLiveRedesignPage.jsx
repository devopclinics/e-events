import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import RedesignShell, { Icon } from './redesign/RedesignShell'
import { useCurrentEvent } from '../hooks/useCurrentEvent'
import { useEventDetails } from '../hooks/useEventDetails'
import { api } from '../api'
import { DonutChart, StarRating, RatingDistribution, PALETTE } from '../components/charts/LiveCharts'
import './FestioLiveRedesignPage.css'

const ExperienceWorkflowsPanel = lazy(() => import('../components/live/ExperienceWorkflowsPanel'))

const TABS = ['Overview', 'Activities', 'Experiences', 'Question Bank', 'Live Control', 'Displays', 'Responses', 'Analytics', 'Settings', 'Help']

const ACTIVITY_TYPES = [
  ['quiz', 'Quiz'], ['poll', 'Poll'], ['survey', 'Survey'], ['rating', 'Rating'],
  ['feedback', 'Feedback'], ['q_and_a', 'Q&A'], ['word_cloud', 'Word Cloud'],
  ['voting', 'Live Voting'],
]
const QUESTION_TYPES = [
  ['single_choice', 'Single choice'], ['multiple_choice', 'Multiple choice'],
  ['true_false', 'True / False'], ['yes_no', 'Yes / No'], ['rating_5', 'Rating (5)'],
  ['rating_10', 'Rating (10)'], ['nps', 'NPS'], ['short_text', 'Open text'],
  ['long_text', 'Long text'], ['number', 'Number'], ['word_cloud', 'Word cloud prompt'],
  ['ranking', 'Ranking'], ['quadrant', 'Quadrant (2x2 grid)'], ['image_click', 'Image click / heatmap'],
]
const TEXT_QUESTION_TYPES = new Set(['short_text', 'long_text', 'word_cloud'])
const STATUS_TONE = { draft: 'neutral', scheduled: 'info', live: 'ok', paused: 'warn', closed: 'neutral', completed: 'ok', archived: 'neutral' }
const SHOW_PHASE_LABELS = { lobby: 'Lobby', intro: 'Introduction', question_preview: 'Question preview', answering: 'Voting open', locked: 'Answers locked', reveal: 'Answer reveal', results: 'Results', leaderboard: 'Leaderboard', complete: 'Complete' }
const SHOW_AUTOMATION_DEFAULTS = { lobby: 10, intro: 8, question_preview: 5, answering: 30, locked: 3, reveal: 6, results: 10, leaderboard: 8 }
const SHOW_AUTOMATION_LABELS = { lobby: 'Join screen', intro: 'Introduction', question_preview: 'Prompt preview', answering: 'Participation', locked: 'Locked pause', reveal: 'Answer reveal', results: 'Question results', leaderboard: 'Leaderboard' }
function automationDraftFor(activity) {
  return {
    enabled: !!activity?.config?.show_automation_enabled,
    timings: { ...SHOW_AUTOMATION_DEFAULTS, ...(activity?.config?.show_automation_timings || {}) },
  }
}
function guidedActionLabel(activity) {
  if (activity?.config?.show_mode !== 'guided') return 'Start guided show'
  const phase = activity.config?.show_phase || 'lobby'
  const questions = (activity.questions || []).filter((question) => question.status === 'active')
  const currentIndex = questions.findIndex((question) => question.id === activity.config?.current_question_id)
  const current = questions[currentIndex]
  if (phase === 'lobby') return 'Show activity intro →'
  if (phase === 'intro') return ['survey', 'feedback', 'q_and_a'].includes(activity.type) ? 'Open participation →' : 'Preview first question →'
  if (phase === 'question_preview') return 'Open voting →'
  if (phase === 'answering') return 'Lock responses →'
  if (phase === 'locked') return current?.options?.some((option) => option.is_correct) ? 'Reveal answer →' : 'Reveal results →'
  if (phase === 'reveal') return 'Show full results →'
  if (phase === 'results' && activity.type === 'quiz' && activity.config?.leaderboard_enabled) return 'Show leaderboard →'
  if (phase === 'results' || phase === 'leaderboard') return currentIndex < questions.length - 1 ? 'Preview next question →' : 'Finish show →'
  return 'Restart guided show'
}
const DISPLAY_SCENES = [
  ['welcome', 'Opening moment'], ['join', 'Join / QR'], ['agenda', 'Live agenda'],
  ['question', 'Question'], ['responding', 'Voting + reactions'], ['results', 'Current result'], ['all_results', 'All results'],
  ['survey_insights', 'Survey insights wall'],
  ['correct_answer', 'Smart reveal'], ['leaderboard', 'Leaderboard'], ['team_battle', 'Team battle'],
  ['rating', 'Rating'], ['feedback', 'Feedback'], ['word_cloud', 'Living word cloud'],
  ['q_and_a', 'Q&A spotlight'], ['room_pulse', 'Room pulse'], ['ai_insight', 'AI synthesis'],
  ['idea_galaxy', 'Idea galaxy'], ['live_spectrum', 'Live spectrum'],
  ['interactive_quadrant', 'Interactive quadrant'], ['image_heatmap', 'Image heatmap'],
  ['ranking_race', 'Ranking race'], ['prediction_reveal', 'Prediction reveal'],
  ['commitment_wall', 'Commitment wall'], ['photo_mosaic', 'Photo mosaic'],
  ['location_map', 'Live location map'], ['journey_recap', 'Event journey recap'],
  ['spotlight_wheel', 'Spotlight wheel'], ['announcement', 'Announcement'],
  ['break', 'Break / up next'], ['countdown', 'Countdown'], ['celebration', 'Celebration'],
  ['custom_message', 'Custom message'],
]
// Several scenes only know how to render a single "current question" (quiz-
// style advance) or a specific activity type's own data (Q&A, word cloud) —
// picking one of those for an incompatible activity silently shows nothing
// useful. Restrict the picker instead of letting that combination happen.
const SCENES_ALWAYS_SAFE = ['welcome', 'join', 'agenda', 'photo_mosaic', 'location_map', 'journey_recap', 'spotlight_wheel', 'announcement', 'break', 'countdown', 'celebration', 'custom_message']
function compatibleScenes(activityType) {
  if (!activityType) return DISPLAY_SCENES.map(([key]) => key)
  if (activityType === 'survey' || activityType === 'feedback') return [...SCENES_ALWAYS_SAFE, 'results', 'all_results', 'survey_insights', 'commitment_wall', 'prediction_reveal']
  if (activityType === 'q_and_a') return [...SCENES_ALWAYS_SAFE, 'q_and_a']
  if (activityType === 'word_cloud') return [...SCENES_ALWAYS_SAFE, 'word_cloud', 'results', 'all_results', 'commitment_wall']
  if (activityType === 'rating') return [...SCENES_ALWAYS_SAFE, 'rating', 'results', 'all_results', 'live_spectrum']
  if (activityType === 'quiz') return [...SCENES_ALWAYS_SAFE, 'question', 'responding', 'results', 'all_results', 'correct_answer', 'leaderboard', 'team_battle', 'ranking_race', 'prediction_reveal']
  return DISPLAY_SCENES.map(([key]) => key) // poll, voting, and anything else — built to use most scenes
}
const DISPLAY_THEMES = [
  ['aurora', 'Aurora', 'linear-gradient(135deg,#65f5c6,#a45bff)'],
  ['citrus', 'Citrus', 'linear-gradient(135deg,#ffd84d,#ff5f94)'],
  ['ocean', 'Ocean', 'linear-gradient(135deg,#37d8ff,#5575ff)'],
  ['festio', 'Festio', 'linear-gradient(135deg,#ffad72,#b75c32)'],
  ['mono', 'High contrast', 'linear-gradient(135deg,#fff 50%,#111 50%)'],
]

const QUESTION_TYPE_KEYS = new Set(QUESTION_TYPES.map(([key]) => key))

function parseCsv(text) {
  const rows = []; let row = []; let value = ''; let quoted = false
  const source = String(text || '').replace(/^\uFEFF/, '')
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (character === '"' && quoted && source[index + 1] === '"') { value += '"'; index += 1 }
    else if (character === '"') quoted = !quoted
    else if (character === ',' && !quoted) { row.push(value.trim()); value = '' }
    else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && source[index + 1] === '\n') index += 1
      row.push(value.trim()); value = ''; if (row.some(Boolean)) rows.push(row); row = []
    } else value += character
  }
  row.push(value.trim()); if (row.some(Boolean)) rows.push(row)
  return rows
}

function StatusChip({ status }) {
  const tone = STATUS_TONE[status] || 'neutral'
  const bg = { ok: '#e7f6ee', info: '#eaf0ff', warn: '#fbf1de', neutral: '#eee' }[tone]
  const fg = { ok: '#176344', info: '#1f54b5', warn: '#765000', neutral: '#4f4b47' }[tone]
  return <span style={{ background: bg, color: fg, fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: '.03em' }}>{status}</span>
}

function MetricCard({ label, value, note, tone = 'copper', icon }) {
  return <article className={`fl-metric fl-metric-${tone}`}>
    <div className="fl-metric-top"><span>{label}</span><b aria-hidden="true">{icon}</b></div>
    <strong>{value}</strong><small>{note}</small>
  </article>
}

// The Event Feedback / Survey "Engagement Analytics" dashboard — see the big
// block comment above SurveyAnalyticsOverlay for the architecture. Quiz,
// poll, rating, word_cloud, voting, and Q&A never render any of this; they
// keep the existing plain per-question results list untouched.
const FLA_NAV_ITEMS = ['Overview', 'Live Results', 'Responses', 'Analytics', 'Questions', 'Participants', 'Exports', 'Settings']
const FLA_CHOICE_TYPES = ['single_choice', 'true_false', 'yes_no']
const FLA_RATING_TYPES = ['rating_5', 'rating_10', 'nps']
const FLA_TEXT_TYPES = ['short_text', 'long_text', 'word_cloud']

// Merges an activity's own question definition (options, config, sequence)
// with its aggregated result row (response_count, option_counts, etc.) into
// one object every chart component below can read from directly.
function buildQuestionView(defQuestion, resultsById) {
  const qr = resultsById.get(defQuestion.id)
  if (!qr) return null
  return { ...qr, options: defQuestion.options || [], section: defQuestion.config?.section || null }
}

// The visualization resolver (spec: "resolveVisualization"). Decides chart
// type from question type + answer cardinality — never from a question id —
// so this keeps working unmodified for any future Event Feedback survey.
function resolveVisualization(view) {
  if (FLA_CHOICE_TYPES.includes(view.question_type)) {
    const n = view.options.length
    const hasLongLabel = view.options.some((o) => (o.label || '').length > 24)
    return (n > 0 && n <= 5 && !hasLongLabel) ? 'donut' : 'bar'
  }
  if (view.question_type === 'multiple_choice') return 'bar'
  if (FLA_RATING_TYPES.includes(view.question_type)) return 'rating'
  if (view.question_type === 'number') return 'number'
  if (FLA_TEXT_TYPES.includes(view.question_type)) return 'text'
  return 'bar'
}

// Groups questions by their own config.section (an organizer-authored
// heading, e.g. "Planning the Next Summit" — see the seed script's comment
// on ActivityQuestion.config). Questions with no section at all are almost
// always the survey's entry/gating question(s); bucket choice-type ones
// under a default "What People Chose" heading rather than dropping them.
function sectionsFor(views) {
  const bySection = new Map()
  const defaultBucket = []
  const overflow = []
  views.forEach((v) => {
    if (v.section) {
      if (!bySection.has(v.section)) bySection.set(v.section, [])
      bySection.get(v.section).push(v)
    } else if (FLA_CHOICE_TYPES.includes(v.question_type) || v.question_type === 'multiple_choice') {
      defaultBucket.push(v)
    } else {
      overflow.push(v)
    }
  })
  const sections = []
  if (defaultBucket.length) sections.push({ name: 'What People Chose', questions: defaultBucket })
  bySection.forEach((questions, name) => sections.push({ name, questions }))
  if (overflow.length) sections.push({ name: 'More Questions', questions: overflow })
  return sections
}

// Branching means a targeted question's response_count already excludes
// anyone routed away from it — but an organizer still wants to know how many
// people were even ELIGIBLE to answer. Derived from the ActivityRule that
// shows this section (not stored anywhere as its own aggregate).
function eligibleCountFor(sectionQuestions, rules, results) {
  for (const v of sectionQuestions) {
    const rule = rules.find((r) => r.target_question_id === v.question_id && r.action === 'show')
    if (!rule) continue
    const source = results.questions.find((qr) => qr.question_id === rule.source_question_id)
    if (source && ['equals', 'contains'].includes(rule.operator)) {
      const n = source.option_counts?.[rule.comparison_value]
      if (n != null) return n
    }
  }
  return null
}

function AnalyticsEmptyState({ message }) {
  return <p className="fla-empty-note">{message || 'No responses yet — results will appear here as participants respond.'}</p>
}

function AnalyticsKpiCard({ label, value, secondary, icon, color }) {
  return <div className="fla-stat">
    <i className={`fla-stat-icon ${color}`} aria-hidden="true">{icon}</i>
    <div><span>{label}</span><strong>{value}</strong>{secondary && <small>{secondary}</small>}</div>
  </div>
}

// Donut + a legend that keeps each answer's percentage AND raw count right
// next to its label (spec: never on the opposite side of the card).
function DonutQuestionCard({ view }) {
  const segments = view.options.map((o) => ({ id: o.id, label: o.label, value: view.option_counts?.[o.id] || 0 }))
  const total = segments.reduce((sum, s) => sum + s.value, 0)
  if (total === 0) return <AnalyticsEmptyState />
  const top = [...segments].sort((a, b) => b.value - a.value)[0]
  return <>
    <div className="fla-donut-block">
      <DonutChart segments={segments} size={30} />
      <div className="fla-legend2">
        {segments.map((s, i) => (
          <div className="fla-legend2-row" key={s.id}>
            <i style={{ background: PALETTE[i % PALETTE.length] }} />
            <span>{s.label}</span>
            <b>{Math.round((s.value / total) * 100)}%</b>
            <small>{s.value}</small>
          </div>
        ))}
      </div>
    </div>
    <p className="fla-card-footnote">Most popular: <strong>{top.label}</strong> · {view.response_count} response{view.response_count === 1 ? '' : 's'}</p>
  </>
}

// Ranked horizontal bars for multi-select and any single-choice question
// whose options are too numerous or too long to read as a donut legend.
function BarQuestionCard({ view }) {
  const denom = Math.max(1, view.response_count || 0)
  const items = view.options.map((o) => ({ id: o.id, label: o.label, value: view.option_counts?.[o.id] || 0 }))
  const total = items.reduce((sum, item) => sum + item.value, 0)
  if (total === 0) return <AnalyticsEmptyState />
  const sorted = [...items].sort((a, b) => b.value - a.value)
  const peak = Math.max(1, ...sorted.map((item) => item.value))
  return <>
    <div className="fla-bar-list">
      {sorted.map((item, i) => (
        <div className="fla-bar-row" key={item.id}>
          <b>{i + 1}</b>
          <span>{item.label}</span>
          <div className="fla-bar-track"><i style={{ width: `${Math.max(3, (item.value / peak) * 100)}%` }} /></div>
          <em>{item.value} · {Math.round((item.value / denom) * 100)}%</em>
        </div>
      ))}
    </div>
    <p className="fla-card-footnote">{view.response_count} response{view.response_count === 1 ? '' : 's'}{view.question_type === 'multiple_choice' ? ' · respondents could pick more than one, so totals may exceed 100%' : ''}</p>
  </>
}

function RatingQuestionCard({ view }) {
  if (view.average_rating == null) return <AnalyticsEmptyState message="No ratings yet." />
  const max = view.question_type === 'rating_10' ? 10 : 5
  return <div className="fla-rating-breakdown">
    <div className="fla-rating-big"><strong>{view.average_rating.toFixed(1)}</strong><StarRating average={view.average_rating} max={max} /><span>out of {max}</span></div>
    {view.value_counts && <RatingDistribution valueCounts={view.value_counts} max={max} min={1} />}
    <p className="fla-card-footnote">{view.response_count} response{view.response_count === 1 ? '' : 's'}</p>
  </div>
}

// A comparative view across several related rating questions in the same
// section (e.g. rating each of 8 experience areas) — the spec's "matrix"
// visualization. Sorted worst-to-best isn't useful; sorted best-to-worst
// with the top and bottom rows flagged is (spec: "Highest Rated" /
// "Needs Attention").
function MatrixRatingChart({ views }) {
  const rated = views.filter((v) => v.average_rating != null)
  if (!rated.length) return <AnalyticsEmptyState message="No ratings yet." />
  const sorted = [...rated].sort((a, b) => b.average_rating - a.average_rating)
  return <div className="fla-matrix">
    {sorted.map((v, i) => {
      const max = v.question_type === 'rating_10' ? 10 : 5
      const label = v.prompt.replace(/^How would you rate:?\s*/i, '').replace(/\?$/, '')
      return <div className="fla-matrix-row" key={v.question_id}>
        <span>{label}
          {i === 0 && <em className="fla-tag fla-tag-good">Highest rated</em>}
          {i === sorted.length - 1 && sorted.length > 1 && <em className="fla-tag fla-tag-warn">Needs attention</em>}
        </span>
        <div className="fla-bar-track"><i style={{ width: `${(v.average_rating / max) * 100}%` }} /></div>
        <b>{v.average_rating.toFixed(1)}</b>
      </div>
    })}
  </div>
}

function NumberQuestionCard({ view }) {
  const values = view.numeric_values || []
  if (!values.length) return <AnalyticsEmptyState />
  const total = values.reduce((sum, value) => sum + value, 0)
  const avg = total / values.length
  return <div className="fla-number-card">
    <strong>{total.toLocaleString()}</strong>
    <small>Reported across {view.response_count} response{view.response_count === 1 ? '' : 's'} · avg {avg.toFixed(1)} each</small>
  </div>
}

function TextQuestionCard({ view, analysis, busy, onAnalyze }) {
  if (!view.response_count) return <AnalyticsEmptyState />
  return <div className="fla-text-card">
    <p className="fla-card-footnote">{view.response_count} response{view.response_count === 1 ? '' : 's'}</p>
    {analysis?.themes?.length > 0
      ? <ul className="fla-theme-list">{analysis.themes.slice(0, 6).map((theme) => <li key={theme}>{theme}</li>)}</ul>
      : <button className="rr-btn secondary" disabled={busy} onClick={onAnalyze}>{busy ? 'Analyzing…' : 'Generate insights'}</button>}
  </div>
}

function QuestionAnalyticsCard({ view, aiAnalyses, aiBusy, runAiAnalysis }) {
  const vis = resolveVisualization(view)
  return <div className="fla-card">
    <h4>{view.prompt}</h4>
    {vis === 'donut' && <DonutQuestionCard view={view} />}
    {vis === 'bar' && <BarQuestionCard view={view} />}
    {vis === 'rating' && <RatingQuestionCard view={view} />}
    {vis === 'number' && <NumberQuestionCard view={view} />}
    {vis === 'text' && <TextQuestionCard view={view} analysis={aiAnalyses[view.question_id]} busy={aiBusy === view.question_id} onAnalyze={() => runAiAnalysis(view.question_id)} />}
  </div>
}

function AnalyticsSection({ title, eligibleCount, children }) {
  return <section className="fla-section">
    <h3 className="fla-section-title">{title}{eligibleCount != null && <span className="fla-eligible-badge">{eligibleCount} eligible respondent{eligibleCount === 1 ? '' : 's'}</span>}</h3>
    <div className="fla-section-grid">{children}</div>
  </section>
}

// Full-screen "Engagement Analytics" overlay for a survey/feedback
// activity's results — a dedicated dark dashboard (its own mini nav, KPI
// row, and a per-question chart chosen by resolveVisualization()) rather
// than another tab inside the regular light-themed Festio Live admin page.
// Opened via the "Open Engagement Analytics" button in the Activities tab;
// closing it returns there exactly as it was.
function SurveyAnalyticsOverlay({ event, selected, results, summary, aiAnalyses, aiBusy, runAiAnalysis, responseDetails, rules, onClose, onExportCsv, onGenerateReport, displayUrl }) {
  const [showResponses, setShowResponses] = useState(false)
  const resultsById = new Map(results.questions.map((qr) => [qr.question_id, qr]))
  const views = selected.questions.map((q) => buildQuestionView(q, resultsById)).filter(Boolean)

  const ratingViews = views.filter((v) => FLA_RATING_TYPES.includes(v.question_type))
  const [headlineRating, ...otherRatings] = ratingViews
  const useMatrix = otherRatings.length >= 3
  const matrixIds = new Set(useMatrix ? otherRatings.map((v) => v.question_id) : [])

  const sections = sectionsFor(views)
  const textViews = views.filter((v) => FLA_TEXT_TYPES.includes(v.question_type) && v.response_count > 0)
  const sentimentSource = textViews.find((v) => aiAnalyses[v.question_id]?.sentiment)

  const participantCount = summary?.participant_count ?? results.participant_count ?? 0
  const completedCount = summary?.completed_count ?? 0
  const completionRate = participantCount ? Math.round((completedCount / participantCount) * 100) : 0
  const avgSeconds = summary?.avg_completion_seconds
  const avgTimeLabel = avgSeconds != null
    ? `${String(Math.floor(avgSeconds / 60)).padStart(2, '0')}:${String(Math.round(avgSeconds % 60)).padStart(2, '0')}`
    : null
  const startedLabel = selected.created_at ? new Date(selected.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

  const kpis = [
    { key: 'total', label: 'Total Responses', icon: '☺', color: 'mint', value: completedCount, secondary: participantCount ? `${completionRate}% of participants` : null },
    { key: 'completion', label: 'Completion Rate', icon: '✓', color: 'blue', value: `${completionRate}%`, secondary: `${completedCount} completed` },
    avgTimeLabel && { key: 'time', label: 'Avg. Time to Complete', icon: '◷', color: 'violet', value: avgTimeLabel, secondary: 'mm:ss' },
    headlineRating && { key: 'rating', label: 'Overall Rating', icon: '★', color: 'gold', value: headlineRating.average_rating != null ? `${headlineRating.average_rating.toFixed(1)} / ${headlineRating.question_type === 'rating_10' ? 10 : 5}` : '—', secondary: `${headlineRating.response_count} responses` },
    { key: 'participation', label: 'Participation', icon: '↗', color: 'coral', value: participantCount, secondary: 'Unique participants' },
  ].filter(Boolean)

  return (
    <div className="fla-overlay" role="dialog" aria-label="Engagement analytics">
      <aside className="fla-sidebar">
        <div className="fla-brand"><span className="fla-mark">◈</span><div><b>festio live</b><small>ENGAGEMENT ANALYTICS</small></div></div>
        <div className="fla-event-select">{event?.name || 'Event'}</div>
        <nav className="fla-nav">
          {FLA_NAV_ITEMS.map((item) => (
            <button key={item} type="button" className={item === 'Overview' ? 'active' : ''}
              onClick={item === 'Responses' ? () => setShowResponses((v) => !v) : item === 'Exports' ? onExportCsv : undefined}
              disabled={!['Overview', 'Responses', 'Exports'].includes(item)}>
              {item}
            </button>
          ))}
        </nav>
        <div className="fla-status-card">
          <span>Survey Status</span>
          <div className="fla-status-live"><i className={selected.status === 'live' ? 'on' : ''} />{selected.status === 'live' ? 'Live' : selected.status}</div>
          <div className="fla-status-row">Started: {startedLabel}</div>
          <div className="fla-status-row">Responses: {completedCount}</div>
          <button type="button" className="fla-view-survey" onClick={onClose}>View Survey</button>
        </div>
      </aside>

      <main className="fla-main">
        <header className="fla-header">
          <div><h1>{selected.title}</h1><p>See how participants answered key questions.</p></div>
          <div className="fla-header-actions">
            <button type="button" className="fla-chip" onClick={onGenerateReport}>⬇ Export</button>
            <button type="button" className="fla-close" onClick={onClose} aria-label="Close analytics">✕</button>
          </div>
        </header>

        <div className="fla-stats-row" role="group" aria-label="Key metrics">
          {kpis.map((k) => <AnalyticsKpiCard key={k.key} {...k} />)}
        </div>

        {sections.map((sec) => {
          const isMatrixSection = useMatrix && sec.questions.some((v) => matrixIds.has(v.question_id))
          const cardQuestions = sec.questions.filter((v) => !matrixIds.has(v.question_id))
          const eligible = eligibleCountFor(sec.questions, rules, results)
          return (
            <AnalyticsSection key={sec.name} title={sec.name} eligibleCount={eligible}>
              {cardQuestions.map((v) => <QuestionAnalyticsCard key={v.question_id} view={v} aiAnalyses={aiAnalyses} aiBusy={aiBusy} runAiAnalysis={runAiAnalysis} />)}
              {isMatrixSection && <div className="fla-card fla-matrix-card"><h4>Detailed Ratings</h4><MatrixRatingChart views={otherRatings} /></div>}
            </AnalyticsSection>
          )
        })}

        {textViews.length > 0 && (
          <div className="fla-row fla-bottom-row">
            <div className="fla-card fla-ai-panel">
              <h4>AI Summary Insights</h4>
              <div className="fla-ai-grid">
                {textViews.slice(0, 2).map((v) => (
                  <div className="fla-ai-cell" key={v.question_id}>
                    <span>{v.prompt.length > 46 ? `${v.prompt.slice(0, 46)}…` : v.prompt}</span>
                    {aiAnalyses[v.question_id]?.themes?.length > 0
                      ? <ul>{aiAnalyses[v.question_id].themes.slice(0, 4).map((theme) => <li key={theme}>{theme}</li>)}</ul>
                      : <button className="rr-btn secondary" disabled={aiBusy === v.question_id} onClick={() => runAiAnalysis(v.question_id)}>{aiBusy === v.question_id ? 'Analyzing…' : 'Generate insights'}</button>}
                  </div>
                ))}
                <div className="fla-ai-cell fla-sentiment-cell">
                  <span>Overall Sentiment</span>
                  {sentimentSource ? (
                    <>
                      <div className={`fla-sentiment-badge fla-sentiment-${aiAnalyses[sentimentSource.question_id].sentiment}`}>
                        <i aria-hidden="true">{aiAnalyses[sentimentSource.question_id].sentiment === 'positive' ? '☺' : aiAnalyses[sentimentSource.question_id].sentiment === 'negative' ? '☹' : '😐'}</i>
                        <b>{aiAnalyses[sentimentSource.question_id].sentiment}</b>
                      </div>
                      <small className="fla-ai-disclaimer">AI-generated analysis, not objective measurement</small>
                    </>
                  ) : <p className="fla-empty-note">Generate insights on a written response to see sentiment.</p>}
                </div>
              </div>
            </div>
            <div className="fla-card fla-quick-actions">
              <h4>Quick Actions</h4>
              <button type="button" onClick={() => setShowResponses((v) => !v)}><i>◈</i><div><b>{showResponses ? 'Hide' : 'View'} All Responses</b><small>See individual anonymous responses</small></div><span>›</span></button>
              <button type="button" onClick={onGenerateReport}><i>▤</i><div><b>Generate Report</b><small>Download a summary report</small></div><span>›</span></button>
              {displayUrl && <button type="button" onClick={() => window.open(displayUrl, '_blank', 'noopener')}><i>▣</i><div><b>Live Display</b><small>Show results on projector/TV</small></div><span>›</span></button>}
            </div>
          </div>
        )}

        {showResponses && (
          <div className="fla-card fla-responses-panel">
            <h4>Individual responses</h4>
            {responseDetails?.length > 0 ? (
              <div className="fla-responses-table">
                {responseDetails.map((response) => (
                  <div className="fla-responses-row" key={response.id}>
                    <strong>{response.participant}</strong><span>{response.question_prompt}</span><span>{response.selected_options?.length ? response.selected_options.join(' → ') : String(response.answer_value ?? '—')}</span>
                  </div>
                ))}
              </div>
            ) : <AnalyticsEmptyState />}
          </div>
        )}
      </main>
    </div>
  )
}

function EmptyActivity({ onCreate }) {
  return <div className="fl-empty">
    <span className="fl-empty-orbit">✦</span>
    <h3>Your live command center is ready</h3>
    <p>Create a poll, quiz, rating, Q&amp;A, survey, feedback wall, or word cloud and send it live in minutes.</p>
    <button className="rr-btn primary" onClick={onCreate}>Create the first activity</button>
  </div>
}

function OverviewPanel({ eventId, joinInfo, activities, displays, onCreate, onOpen, onTab }) {
  const rows = activities || []
  const live = rows.filter((item) => ['live', 'paused'].includes(item.status))
  const overviewRows = [...live, ...rows.filter((item) => !['live', 'paused'].includes(item.status))]
  const participants = rows.reduce((sum, item) => sum + (item.participant_count || 0), 0)
  const responses = rows.reduce((sum, item) => sum + (item.response_count || 0), 0)
  const engagement = participants ? Math.min(100, Math.round((responses / participants) * 100)) : 0
  const bars = rows.length ? rows.slice(-7).map((item) => Math.max(1, item.response_count || 0)) : [8, 14, 11, 19, 26, 22, 31]
  const maxBar = Math.max(...bars, 1)
  return <div className="fl-overview">
    <section className="fl-hero">
      <div><span className="fl-eyebrow">Live engagement command center</span><h2>Make the whole room part of the moment.</h2><p>Run activities, direct every screen, and understand your audience from one place.</p></div>
      <div className="fl-hero-actions"><button className="rr-btn secondary" onClick={() => onTab('Displays')}>Open Broadcast</button><button className="rr-btn primary" onClick={onCreate}>+ New activity</button></div>
    </section>
    <div className="fl-metrics">
      <MetricCard label="Live now" value={live.length} note={live.length ? `${live.length} room${live.length === 1 ? '' : 's'} need your attention` : 'Nothing is live yet'} tone="mint" icon="●" />
      <MetricCard label="Participants" value={participants.toLocaleString()} note="Connected across activities" tone="violet" icon="◌" />
      <MetricCard label="Responses" value={responses.toLocaleString()} note={`${engagement}% response-to-participant rate`} tone="coral" icon="↗" />
      <MetricCard label="Broadcasts" value={(displays || []).length} note={`${(displays || []).filter((item) => item.status !== 'offline').length} screens connected`} tone="sky" icon="▣" />
    </div>
    <div className="fl-overview-grid">
      <section className="fl-card fl-live-card">
        <header><div><h3>Live activities</h3><p>Realtime event activity</p></div><button onClick={() => onTab('Live Control')}>Open control room →</button></header>
        {rows.length === 0 ? <EmptyActivity onCreate={onCreate} /> : <div className="fl-activity-list">{overviewRows.slice(0, 5).map((item) => <button key={item.id} onClick={() => onOpen(item.id)} className="fl-activity-row">
          <span className={`fl-type-icon fl-type-${item.type}`}>{({ quiz: '✦', poll: '▥', survey: '≋', rating: '★', feedback: '↗', q_and_a: '?', word_cloud: 'Aa' })[item.type] || '◉'}</span>
          <span className="fl-activity-copy"><strong>{item.title}</strong><small>{String(item.type).replaceAll('_', ' ')} · {item.participant_count || 0} participants</small></span>
          <span className="fl-activity-responses">{item.response_count || 0}<small>responses</small></span><StatusChip status={item.status} />
        </button>)}</div>}
      </section>
      <section className="fl-card fl-chart-card">
        <header><div><h3>Audience pulse</h3><p>Responses by activity</p></div><span className="fl-realtime">● Realtime</span></header>
        <div className="fl-chart">{bars.map((value, index) => <div key={index} className="fl-chart-column"><span>{value}</span><i style={{ height: `${Math.max(12, (value / maxBar) * 100)}%` }} /></div>)}</div>
        <div className="fl-chart-foot"><span>Earlier</span><strong>{responses.toLocaleString()} total responses</strong><span>Now</span></div>
      </section>
    </div>
    <section className="fl-launch-grid" aria-label="Live event tools">
      <button onClick={() => window.open(joinInfo?.url || `${window.location.origin}/live/guest?event=${eventId}`, '_blank')}><span>09</span><b>Guest mobile</b><small>Preview the participant experience</small></button>
      <button onClick={() => onTab('Settings')}><span>10</span><b>Presenter mobile</b><small>Create a pressure-ready control link</small></button>
      <button onClick={() => onTab('Activities')}><span>11</span><b>Moderator queue</b><small>Review and feature audience Q&amp;A</small></button>
      <button onClick={() => onTab('Displays')}><span>12</span><b>TV / Projector</b><small>Direct 32 cinematic scenes</small></button>
    </section>
  </div>
}

function ParticipantReviewPreview({ activity, results, onClose }) {
  return <div className="fl-participant-preview-backdrop" role="dialog" aria-modal="true" aria-label="Participant results review preview" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div className="fl-participant-preview-shell">
      <header><div><span>PARTICIPANT PHONE PREVIEW</span><h3>Review every result</h3><p>This is the aggregate view. Each real participant also sees their own recorded answer and revealed correctness.</p></div><button onClick={onClose} aria-label="Close participant preview">×</button></header>
      <div className="fl-participant-phone"><div className="fl-participant-phone-top">FESTIO LIVE</div><div className="fl-participant-complete"><span>ACTIVITY COMPLETE</span><strong>{activity.title}</strong><small>{results.participant_count} participants · {results.response_count} answers</small></div>{results.questions.map((result, index) => {
        const question = activity.questions.find((item) => item.id === result.question_id)
        const total = Object.values(result.option_counts || {}).reduce((sum, value) => sum + value, 0)
        return <article key={result.question_id}><header><b>Q{index + 1}</b><strong>{result.prompt}</strong><span>{result.response_count}</span></header>{question?.options?.map((option) => { const count = result.option_counts?.[option.id] || 0; const percent = total ? Math.round(count / total * 100) : 0; return <div className="fl-participant-option" key={option.id}><span>{option.label}</span><b>{percent}%</b><i><em style={{ width: `${percent}%` }}/></i></div> })}{result.average_rating != null && <div className="fl-participant-rating">{result.average_rating.toFixed(1)} <small>average</small></div>}{result.word_cloud?.length > 0 && <div className="fl-participant-words">{result.word_cloud.slice(0, 8).map((entry) => <span key={entry.word}>{entry.word} <b>{entry.count}</b></span>)}</div>}<footer>Your response and correct answer appear here for the actual participant.</footer></article>
      })}</div>
    </div>
  </div>
}

function DisplayCard({ display, eventId, activities, programSessions, busy, onUpdate, onDelete, onPresentResults, onRehearsal }) {
  const [editing, setEditing] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [pushReceipt, setPushReceipt] = useState('')
  const [livePreviewVersion, setLivePreviewVersion] = useState(0)
  const settings = display.settings || {}
  const link = `${window.location.origin}/live/${display.display_code}?token=${encodeURIComponent(display.access_token)}`

  // Pending selection — nothing here touches the real screen until "Push to
  // display" is pressed. Resets to whatever's actually live whenever the
  // display's committed state changes underneath it (including auto-follow).
  const [pendingSessionId, setPendingSessionId] = useState(display.assigned_session_id || '')
  const [pendingActivityId, setPendingActivityId] = useState(display.assigned_activity_id || '')
  const [pendingScene, setPendingScene] = useState(display.scene)
  const [activityDetail, setActivityDetail] = useState(null)
  const [resultQuestionIds, setResultQuestionIds] = useState([])
  const [resultPageSeconds, setResultPageSeconds] = useState(settings.results_page_seconds || 8)
  useEffect(() => {
    setPendingSessionId(display.assigned_session_id || '')
    setPendingActivityId(display.assigned_activity_id || '')
    setPendingScene(display.scene)
  }, [display.assigned_session_id, display.assigned_activity_id, display.scene])
  useEffect(() => { setPushReceipt('') }, [pendingSessionId, pendingActivityId, pendingScene])
  useEffect(() => {
    if (!pendingActivityId) { setActivityDetail(null); setResultQuestionIds([]); return }
    let cancelled = false
    api.liveGetActivity(eventId, pendingActivityId).then((activity) => {
      if (cancelled) return
      setActivityDetail(activity)
      const activeIds = activity.questions.filter((question) => question.status === 'active').map((question) => question.id)
      const configured = (display.settings?.results_question_ids || []).filter((questionId) => activeIds.includes(questionId))
      setResultQuestionIds(configured.length ? configured : activeIds)
    }).catch(() => { if (!cancelled) setActivityDetail(null) })
    return () => { cancelled = true }
  }, [eventId, pendingActivityId, display.settings?.results_question_ids])

  // Reuses the activity's read-only TV payload (real component and real data)
  // inside an iframe with a local-only scene override. This makes selection
  // immediately visible without changing the actual projector until pushed.
  const pendingActivity = activities.find((a) => a.id === pendingActivityId)
  const previewToken = pendingActivity?.config?.display_token
  const previewLink = pendingActivityId && pendingActivityId === (display.assigned_activity_id || '')
    ? `${link}&previewScene=${encodeURIComponent(pendingScene)}`
    : previewToken
      ? `${window.location.origin}/live-display/${pendingActivityId}?token=${encodeURIComponent(previewToken)}&previewScene=${encodeURIComponent(pendingScene)}`
      : null
  const allowedScenes = compatibleScenes(pendingActivity?.type)
  const availableScenes = DISPLAY_SCENES.filter(([key]) => allowedScenes.includes(key))

  // A manual scene choice must take control from follow_activity; otherwise
  // the projector resolves to question/responding/results and differs from the
  // exact scene shown in the preview.
  const isDirty = pendingSessionId !== (display.assigned_session_id || '') || pendingActivityId !== (display.assigned_activity_id || '') || pendingScene !== display.scene || !!settings.follow_activity || settings.control_mode === 'guided'
  async function pushToDisplay() {
    setPushing(true)
    setPushReceipt('')
    const updated = await onUpdate(display.id, {
      assigned_session_id: pendingSessionId || null,
      assigned_activity_id: pendingActivityId || null,
      scene: pendingScene,
      settings: { control_mode: 'manual', follow_activity: false },
    })
    if (updated) {
      setLivePreviewVersion((version) => version + 1)
      setPushReceipt(`Main screen refreshed ✓ ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`)
    }
    setPushing(false)
  }

  function moveResultQuestion(questionId, direction) {
    setResultQuestionIds((current) => {
      const index = current.indexOf(questionId)
      const target = index + direction
      if (index < 0 || target < 0 || target >= current.length) return current
      const next = [...current]; [next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  async function presentResults(mode, extra = {}) {
    if (!pendingActivityId || !resultQuestionIds.length) return
    setPushing(true); setPushReceipt('')
    const configuredCurrent = resultQuestionIds.includes(settings.results_question_id) ? settings.results_question_id : null
    const activityCurrent = resultQuestionIds.includes(activityDetail?.config?.current_question_id) ? activityDetail.config.current_question_id : null
    const updated = await onPresentResults(display.id, {
      activity_id: pendingActivityId, mode,
      question_id: mode === 'current' ? (extra.question_id || configuredCurrent || activityCurrent || resultQuestionIds[0]) : null,
      question_ids: resultQuestionIds,
      freeze: extra.freeze ?? !!settings.results_frozen,
      page: extra.page ?? Number(settings.results_page || 0),
      auto_rotate: extra.auto_rotate ?? settings.results_auto_rotate !== false,
      page_seconds: Number(resultPageSeconds) || 8,
    })
    if (updated) {
      setPendingScene(mode === 'all' ? 'all_results' : 'results')
      setLivePreviewVersion((version) => version + 1)
      setPushReceipt(`Results sent to main screen ✓ ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`)
    }
    setPushing(false)
  }

  const assignableActivities = activities
    .filter((activity) => activity.status !== 'archived')
    .filter((activity) => !pendingSessionId || activity.session_id === pendingSessionId)
  const sessionHasLive = new Map()
  for (const activity of activities) {
    if (!activity.session_id) continue
    const count = sessionHasLive.get(activity.session_id) || { live: 0, other: 0 }
    if (activity.status === 'live') count.live += 1; else if (activity.status !== 'archived') count.other += 1
    sessionHasLive.set(activity.session_id, count)
  }
  const resultQuestions = (activityDetail?.questions || []).filter((question) => question.status === 'active')
  const resultPageCount = Math.max(1, Math.ceil(resultQuestionIds.length / 6))
  const resultPage = Math.min(resultPageCount - 1, Number(settings.results_page || 0))

  return <article className="fl-display-card">
    <div className="fl-display-preview">
      <iframe title={`${display.name} broadcast preview`} src={`${link}&adminRefresh=${livePreviewVersion}`} tabIndex="-1" />
      <div className="fl-display-preview-shade"><span>{DISPLAY_SCENES.find(([key]) => key === display.scene)?.[1] || display.scene}</span><button onClick={() => window.open(link, '_blank', 'noopener,noreferrer')}>Open fullscreen ↗</button></div>
    </div>
    <div className="fl-display-body">
    <div className="fl-display-heading">
      <div style={{ flex: '1 1 180px' }}><strong style={{ fontSize: 15 }}>{display.name}</strong><div className="rd-hint">{display.status} · {DISPLAY_SCENES.find(([key]) => key === display.scene)?.[1] || display.scene}</div></div>
      <select className="rr-select" style={{ minWidth: 200 }} aria-label={`Program session for ${display.name}`} value={pendingSessionId} onChange={(event) => {
        const assignedSessionId = event.target.value || ''
        const currentActivity = activities.find((activity) => activity.id === pendingActivityId)
        setPendingSessionId(assignedSessionId)
        if (assignedSessionId && currentActivity?.session_id !== assignedSessionId) setPendingActivityId('')
      }}><option value="">Whole event</option>{programSessions.filter((session) => session.status === 'published').map((session) => {
        const counts = sessionHasLive.get(session.source_step_id)
        const tag = counts?.live ? ` (${counts.live} live)` : counts?.other ? ` (${counts.other} draft)` : ' (none)'
        return <option key={session.source_step_id} value={session.source_step_id}>{session.title}{tag}</option>
      })}</select>
      <select className="rr-select" style={{ minWidth: 220 }} aria-label={`Activity for ${display.name}`} disabled={!!settings.auto_follow_program} value={pendingActivityId} onChange={(e) => setPendingActivityId(e.target.value)}>
        <option value="">No activity</option>
        {assignableActivities.map((a) => <option key={a.id} value={a.id}>{a.title} — {a.status}</option>)}
      </select>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }} title="Automatically points this screen at whatever's live for whatever program session is happening right now — no one has to reassign it as the day moves.">
        <input type="checkbox" checked={!!settings.auto_follow_program} onChange={(e) => onUpdate(display.id, { settings: { auto_follow_program: e.target.checked } })} /> Auto-follow program
      </label>
      <button className="rr-btn secondary" onClick={() => navigator.clipboard?.writeText(link)}>Copy link</button>
      <button className="rr-btn primary" onClick={() => setEditing((value) => !value)}>{editing ? 'Close studio' : 'Design scene'}</button>
    </div>
    <div className="fl-results-quickbar" aria-label="Results and rehearsal controls">
      <div><span>RESULTS &amp; REHEARSAL</span><strong>Put results on screen or practise safely</strong></div>
      {!pendingActivityId && <small>Select an activity above to unlock these controls.</small>}
      {pendingActivityId && !activityDetail && <small>Loading activity questions…</small>}
      {activityDetail && resultQuestions.length === 0 && <small>This activity has no active questions yet. Add a question first.</small>}
      {resultQuestions.length > 0 && <>
        <button className="rr-btn primary" disabled={busy || pushing} onClick={() => presentResults('all')}>Show all results</button>
        <button className="rr-btn secondary" disabled={busy || pushing} onClick={() => onRehearsal(display.id, { activity_id: pendingActivityId, enabled: true, participants: 10 })}>Rehearse with 10 guests</button>
        <button className="rr-btn secondary" onClick={() => document.getElementById(`results-control-${display.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>Full results controls ↓</button>
      </>}
    </div>
    <div className="fl-scene-strip">{availableScenes.map(([key, label]) => <button key={key} title={label} className={pendingScene === key ? 'active' : ''} onClick={() => setPendingScene(key)}><span>{({ welcome: '✦', join: '⌗', agenda: '≡', question: '?', responding: '◌', results: '▥', all_results: '▦', survey_insights: '◫', correct_answer: '✓', leaderboard: '♛', rating: '★', q_and_a: '?', word_cloud: 'Aa', live_spectrum: '↔', interactive_quadrant: '⊞', image_heatmap: '◉', ranking_race: '≋', prediction_reveal: '◐', commitment_wall: '▦', photo_mosaic: '▦', location_map: '⌖', journey_recap: '⌁', spotlight_wheel: '◎' })[key] || '◉'}</span>{label}</button>)}</div>
    {pendingActivity && availableScenes.length < DISPLAY_SCENES.length && <p className="rd-hint" style={{ marginTop: -6, marginBottom: 10 }}>Only showing scenes that work with a {pendingActivity.type.replace('_', ' ')} activity — others would show nothing useful.</p>}

    <div className="fl-display-preview-box">
      <div className="fl-display-preview-box-head">
        <span>{pendingActivityId
          ? isDirty
            ? `Preview: ${DISPLAY_SCENES.find(([key]) => key === pendingScene)?.[1] || pendingScene} — not on the main screen yet`
            : `Live preview: ${DISPLAY_SCENES.find(([key]) => key === pendingScene)?.[1] || pendingScene} — currently on the main screen`
          : 'No activity selected'}</span>
        {pendingActivityId && <button className="rr-btn primary" disabled={busy || pushing} onClick={pushToDisplay}>{pushing ? 'Sending to main screen…' : isDirty ? 'Push to main screen →' : 'Repush to main screen ↻'}</button>}
      </div>
      {pushReceipt && <div className="fl-display-push-receipt" role="status" aria-live="polite">{pushReceipt}</div>}
      {previewLink && <div className="fl-display-preview-canvas"><iframe title={`${display.name} pending preview`} src={previewLink} tabIndex="-1" /></div>}
    </div>

    {activityDetail && resultQuestions.length > 0 && <section className="fl-results-control" id={`results-control-${display.id}`}>
      <header><div><span>RESULTS-ONLY CONTROL</span><h4>Put the outcome on screen</h4><p>Choose exactly what the room sees. This never changes responses or analytics.</p></div><b>{settings.rehearsal_mode ? 'Rehearsal' : settings.results_frozen ? 'Frozen' : display.scene === 'all_results' || display.scene === 'results' ? 'Live results' : 'Ready'}</b></header>
      <div className="fl-results-actions">
        <button className="rr-btn secondary" disabled={busy || pushing} onClick={() => presentResults('current', { question_id: settings.results_question_id || resultQuestionIds[0] })}>Show current result</button>
        <button className="rr-btn primary" disabled={busy || pushing} onClick={() => presentResults('all')}>Show all results</button>
        <button className="rr-btn secondary" disabled={busy || pushing || !['results', 'all_results'].includes(display.scene)} onClick={() => presentResults(settings.results_mode || 'all', { freeze: !settings.results_frozen })}>{settings.results_frozen ? 'Return to live results' : 'Freeze results'}</button>
        <button className="rr-btn secondary" disabled={busy} onClick={() => onUpdate(display.id, { assigned_activity_id: pendingActivityId, scene: 'join', settings: { control_mode: 'manual', follow_activity: false, rehearsal_mode: false, results_frozen: false, results_snapshot: null } })}>Return to join screen</button>
        <button className="rr-btn secondary" disabled={busy} onClick={() => onUpdate(display.id, { assigned_activity_id: pendingActivityId, settings: { control_mode: 'guided', follow_activity: true, rehearsal_mode: false, results_frozen: false, results_snapshot: null } })}>Resume guided display</button>
      </div>
      <div className="fl-results-playback">
        <label><input type="checkbox" checked={settings.results_auto_rotate !== false} onChange={(event) => presentResults('all', { auto_rotate: event.target.checked, page: resultPage })}/> Auto-rotate pages</label>
        <label>Every <input type="number" min="3" max="60" value={resultPageSeconds} onChange={(event) => setResultPageSeconds(event.target.value)}/> sec</label>
        <button className="rr-btn secondary" disabled={busy || resultPage <= 0} onClick={() => presentResults('all', { auto_rotate: false, page: resultPage - 1 })}>← Previous page</button>
        <span>Page {resultPage + 1} of {resultPageCount}</span>
        <button className="rr-btn secondary" disabled={busy || resultPage >= resultPageCount - 1} onClick={() => presentResults('all', { auto_rotate: false, page: resultPage + 1 })}>Next page →</button>
      </div>
      <details><summary>Select and arrange result cards ({resultQuestionIds.length}/{resultQuestions.length})</summary><div className="fl-results-question-list">{resultQuestions.map((question) => { const selectedIndex = resultQuestionIds.indexOf(question.id); const included = selectedIndex >= 0; return <div key={question.id}><label><input type="checkbox" checked={included} onChange={(event) => setResultQuestionIds((current) => event.target.checked ? [...current, question.id] : current.filter((questionId) => questionId !== question.id))}/><span>{question.prompt}</span></label><button disabled={!included || selectedIndex === 0} onClick={() => moveResultQuestion(question.id, -1)}>↑</button><button disabled={!included || selectedIndex === resultQuestionIds.length - 1} onClick={() => moveResultQuestion(question.id, 1)}>↓</button><button disabled={!included} onClick={() => presentResults('current', { question_id: question.id })}>Show</button></div> })}</div></details>
      <div className="fl-rehearsal-actions"><button className="rr-btn secondary" disabled={busy || pushing} onClick={() => onRehearsal(display.id, { activity_id: pendingActivityId, enabled: true, participants: 10 })}>Rehearse with 10 simulated guests</button>{settings.rehearsal_mode && <button className="rr-btn secondary" disabled={busy} onClick={() => onRehearsal(display.id, { enabled: false })}>End rehearsal</button>}<small>Simulation exists only on this display and never creates response records.</small></div>
    </section>}

    {editing && <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--rr-line, #eee)', display: 'grid', gap: 14 }}>
      <div><div className="rd-hint" style={{ marginBottom: 7 }}>Presentation scene</div><select className="rr-select" aria-label={`Presentation scene for ${display.name}`} style={{ width: '100%' }} value={pendingScene} onChange={(e) => setPendingScene(e.target.value)}>{availableScenes.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
      <div><div className="rd-hint" style={{ marginBottom: 7 }}>Art direction</div><div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{DISPLAY_THEMES.map(([key, label, background]) => <button type="button" key={key} title={label} aria-label={label} onClick={() => onUpdate(display.id, { settings: { theme: key } })} style={{ width: 34, height: 34, borderRadius: 999, background, border: settings.theme === key || (!settings.theme && key === 'aurora') ? '3px solid #17131f' : '3px solid #fff', boxShadow: '0 0 0 1px #d8d3ca', cursor: 'pointer' }}/>)}</div></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 10 }}>
        <label><span className="rd-hint">Headline</span><input key={`title-${settings.title || ''}`} className="rr-input" defaultValue={settings.title || ''} placeholder="Use activity title" onBlur={(e) => onUpdate(display.id, { settings: { title: e.target.value || null } })}/></label>
        <label><span className="rd-hint">Kicker</span><input key={`kicker-${settings.kicker || ''}`} className="rr-input" defaultValue={settings.kicker || ''} placeholder="The room is ready" onBlur={(e) => onUpdate(display.id, { settings: { kicker: e.target.value || null } })}/></label>
        <label><span className="rd-hint">Status / countdown label</span><input key={`status-${settings.status_label || ''}`} className="rr-input" defaultValue={settings.status_label || ''} placeholder="Doors open" onBlur={(e) => onUpdate(display.id, { settings: { status_label: e.target.value || null } })}/></label>
        <label><span className="rd-hint">Event name</span><input key={`event-${settings.event_name || ''}`} className="rr-input" defaultValue={settings.event_name || ''} placeholder="Convention 2026" onBlur={(e) => onUpdate(display.id, { settings: { event_name: e.target.value || null } })}/></label>
        <label><span className="rd-hint">Venue</span><input key={`venue-${settings.venue || ''}`} className="rr-input" defaultValue={settings.venue || ''} placeholder="Main stage · Chicago" onBlur={(e) => onUpdate(display.id, { settings: { venue: e.target.value || null } })}/></label>
        <label><span className="rd-hint">Date label</span><input key={`date-${settings.date_label || ''}`} className="rr-input" defaultValue={settings.date_label || ''} placeholder="August 23, 2026" onBlur={(e) => onUpdate(display.id, { settings: { date_label: e.target.value || null } })}/></label>
        <label><span className="rd-hint">Join code</span><input key={`join-${settings.join_code || ''}`} className="rr-input" defaultValue={settings.join_code || ''} placeholder="FESTIO-26" onBlur={(e) => onUpdate(display.id, { settings: { join_code: e.target.value || null } })}/></label>
        <label><span className="rd-hint">Countdown seconds</span><input key={`countdown-${settings.countdown_seconds || ''}`} className="rr-input" type="number" min="0" max="604800" defaultValue={settings.countdown_seconds ?? 298} onBlur={(e) => onUpdate(display.id, { settings: { countdown_seconds: Math.max(0, Number(e.target.value) || 0) } })}/></label>
        <label><span className="rd-hint">Team names (comma-separated)</span><input key={`teams-${(settings.team_names || []).join(',')}`} className="rr-input" defaultValue={(settings.team_names || []).join(', ')} placeholder="Lakefront, Skyline" onBlur={(e) => onUpdate(display.id, { settings: { team_names: e.target.value.split(',').map((value) => value.trim()).filter(Boolean).slice(0, 4) } })}/></label>
        <label><span className="rd-hint">Sponsors (comma-separated)</span><input key={`sponsors-${(settings.sponsors || []).join(',')}`} className="rr-input" defaultValue={(settings.sponsors || []).join(', ')} placeholder="IEDPU USA, Partner" onBlur={(e) => onUpdate(display.id, { settings: { sponsors: e.target.value.split(',').map((value) => value.trim()).filter(Boolean).slice(0, 8) } })}/></label>
        <label style={{ gridColumn: '1 / -1' }}><span className="rd-hint">Message</span><input key={`message-${settings.message || ''}`} className="rr-input" defaultValue={settings.message || ''} placeholder="Optional scene message" onBlur={(e) => onUpdate(display.id, { settings: { message: e.target.value || null } })}/></label>
        <label style={{ gridColumn: '1 / -1' }}><span className="rd-hint">Subtitle / supporting copy</span><input key={`subtitle-${settings.subtitle || ''}`} className="rr-input" defaultValue={settings.subtitle || ''} placeholder="Optional supporting copy" onBlur={(e) => onUpdate(display.id, { settings: { subtitle: e.target.value || null } })}/></label>
      </div>
      {pendingScene === 'agenda' && <div><div className="rd-hint" style={{ marginBottom: 7 }}>Agenda cards — enter “time | title | speaker or room”</div><div style={{ display: 'grid', gap: 7 }}>{[0, 1, 2].map((index) => { const item = settings.agenda?.[index] || {}; return <input key={`agenda-${index}-${item.title || ''}`} className="rr-input" defaultValue={[item.time, item.title, item.speaker || item.room].filter(Boolean).join(' | ')} placeholder={`${index ? '11:15' : '10:30'} | Session title | Speaker`} onBlur={(e) => { const [time, title, speaker] = e.target.value.split('|').map((value) => value.trim()); const agenda = [...(settings.agenda || [])]; agenda[index] = { time: time || '', title: title || '', speaker: speaker || '', live: index === 0 }; onUpdate(display.id, { settings: { agenda: agenda.filter((entry) => entry.title) } }) }}/> })}</div></div>}
      {pendingScene === 'live_spectrum' && <label><span className="rd-hint">Spectrum labels — left | center | right</span><input className="rr-input" defaultValue={(settings.spectrum_labels || []).join(' | ')} placeholder="Not ready yet | Exploring | Ready now" onBlur={(e) => onUpdate(display.id, { settings: { spectrum_labels: e.target.value.split('|').map((value) => value.trim()).filter(Boolean).slice(0, 3) } })}/></label>}
      {pendingScene === 'prediction_reveal' && <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}><label><span className="rd-hint">Locked prediction label</span><input className="rr-input" defaultValue={settings.prediction?.label || ''} placeholder="The room predicts July" onBlur={(e) => onUpdate(display.id, { settings: { prediction: { ...(settings.prediction || {}), label: e.target.value, locked: true } } })}/></label><label><span className="rd-hint">Predicted percentage</span><input className="rr-input" type="number" min="0" max="100" defaultValue={settings.prediction?.percent ?? ''} placeholder="68" onBlur={(e) => onUpdate(display.id, { settings: { prediction: { ...(settings.prediction || {}), percent: e.target.value === '' ? null : Math.min(100, Math.max(0, Number(e.target.value))), locked: true } } })}/></label></div>}
      {pendingScene === 'commitment_wall' && <label><span className="rd-hint">Moderator-approved commitments — one per line: theme | commitment | author</span><textarea className="rr-input" rows="6" defaultValue={(settings.commitments || []).map((entry) => typeof entry === 'string' ? entry : [entry.theme, entry.text, entry.author].filter(Boolean).join(' | ')).join('\n')} placeholder="Youth | Invite two younger voices into our planning circle | Anonymous" onBlur={(e) => onUpdate(display.id, { settings: { commitments: e.target.value.split('\n').map((line) => { const [theme, text, author] = line.split('|').map((value) => value.trim()); return { theme: theme || 'Commitment', text: text || '', author: author || 'Anonymous' } }).filter((entry) => entry.text).slice(0, 8) } })}/></label>}
      {pendingScene === 'photo_mosaic' && <label><span className="rd-hint">Consent-verified portraits — one per line: name | image URL (URL optional)</span><textarea className="rr-input" rows="5" defaultValue={(settings.photo_mosaic_entries || []).map((entry) => [entry.name, entry.image_url].filter(Boolean).join(' | ')).join('\n')} placeholder="Amina Yusuf | https://…" onBlur={(e) => onUpdate(display.id, { settings: { photo_mosaic_entries: e.target.value.split('\n').map((line) => { const [name, image_url] = line.split('|').map((value) => value.trim()); return { name, image_url: image_url || null, consent: true } }).filter((entry) => entry.name).slice(0, 72) } })}/></label>}
      {pendingScene === 'location_map' && <label><span className="rd-hint">Privacy-safe regions — one per line: region | participant count</span><textarea className="rr-input" rows="5" defaultValue={(settings.location_regions || []).map((entry) => `${entry.name} | ${entry.count || 0}`).join('\n')} placeholder={'Houston area | 86\nEast Coast | 34'} onBlur={(e) => onUpdate(display.id, { settings: { location_regions: e.target.value.split('\n').map((line) => { const [name, count] = line.split('|').map((value) => value.trim()); return { name, count: Math.max(0, Number(count) || 0) } }).filter((entry) => entry.name).slice(0, 5) } })}/></label>}
      {pendingScene === 'journey_recap' && <label><span className="rd-hint">Journey moments — one per line: icon | title | metric | note</span><textarea className="rr-input" rows="5" defaultValue={(settings.journey_steps || []).map((entry) => [entry.icon, entry.title, entry.value, entry.note].filter(Boolean).join(' | ')).join('\n')} placeholder={'⌗ | We gathered | 184 voices | joined in under 90 seconds\n◌ | We chose | 1,284 votes | across seven decisions'} onBlur={(e) => onUpdate(display.id, { settings: { journey_steps: e.target.value.split('\n').map((line) => { const [icon, title, value, note] = line.split('|').map((part) => part.trim()); return { icon, title, value, note } }).filter((entry) => entry.title).slice(0, 5) } })}/></label>}
      {pendingScene === 'spotlight_wheel' && <label><span className="rd-hint">Opted-in spotlight participants — one per line: name | detail. Saving confirms consent.</span><textarea className="rr-input" rows="5" defaultValue={(settings.spotlight_entries || []).map((entry) => [entry.name, entry.detail].filter(Boolean).join(' | ')).join('\n')} placeholder="Zainab A. | Table 14 · Community challenge" onBlur={(e) => onUpdate(display.id, { settings: { spotlight_entries: e.target.value.split('\n').map((line, index) => { const [name, detail] = line.split('|').map((value) => value.trim()); return { name, detail, consent: true, selected: index === 0 } }).filter((entry) => entry.name).slice(0, 200) } })}/></label>}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {[['motion', 'Motion'], ['show_reactions', 'Audience reactions'], ['safe_area', 'Safe area'], ['follow_activity', 'Follow activity automatically']].map(([key, label]) => <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 700 }}><input type="checkbox" checked={key === 'motion' || key === 'show_reactions' ? settings[key] !== false : !!settings[key]} onChange={(e) => onUpdate(display.id, { settings: { [key]: e.target.checked } })}/>{label}</label>)}
      </div>
      <div><button className="rr-link-btn gr-danger-link" disabled={busy} onClick={() => onDelete(display.id)}>Delete display</button></div>
    </div>}
    </div>
  </article>
}

export default function FestioLiveRedesignPage() {
  const [eventId] = useCurrentEvent()
  const { event, loading: eventLoading } = useEventDetails(eventId)
  const liveQuery = new URLSearchParams(window.location.search)
  const presenterEntry = liveQuery.has('present')
  const requestedTab = liveQuery.get('tab')
  const [tab, setTab] = useState(presenterEntry ? 'Experiences' : (TABS.find((item) => item.toLowerCase() === requestedTab?.toLowerCase()) || 'Overview'))

  const [activities, setActivities] = useState(null)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [newActivity, setNewActivity] = useState({ type: 'quiz', title: '', description: '', session_id: '', config: { anonymous: false, allow_answer_changes: false, live_results_enabled: true, moderation_enabled: false } })
  const [programSessions, setProgramSessions] = useState(null)
  const [programFilter, setProgramFilter] = useState('')
  const [activitySearch, setActivitySearch] = useState('')
  const [activityStatusFilter, setActivityStatusFilter] = useState('')
  const [selected, setSelected] = useState(null) // full activity, with questions
  const [editingActivity, setEditingActivity] = useState(false)
  const [activityDraft, setActivityDraft] = useState({ title: '', description: '', session_id: '', moderation_enabled: false, auto_close_enabled: true, auto_start_enabled: false, registered_progress_mode: 'off' })
  const [automationDraft, setAutomationDraft] = useState({ enabled: false, timings: { ...SHOW_AUTOMATION_DEFAULTS } })
  const [editingQuestionId, setEditingQuestionId] = useState(null)
  const [questionPromptDraft, setQuestionPromptDraft] = useState('')
  const [results, setResults] = useState(null)
  const [leaderboard, setLeaderboard] = useState(null)
  const [wordClouds, setWordClouds] = useState({}) // question_id -> entries
  const [aiAnalyses, setAiAnalyses] = useState({}) // question_id -> analysis
  const [aiBusy, setAiBusy] = useState(null) // question_id currently analyzing
  const [qnaItems, setQnaItems] = useState(null)
  const [moderationItems, setModerationItems] = useState(null)
  const [responseDetails, setResponseDetails] = useState(null)
  const [analyticsOverlayOpen, setAnalyticsOverlayOpen] = useState(false)
  const [participantPreviewOpen, setParticipantPreviewOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const [bank, setBank] = useState(null)
  const [newBankItem, setNewBankItem] = useState({ question_type: 'single_choice', prompt: '', options: ['', ''], category: '', tags: '' })
  const [bankSearch, setBankSearch] = useState('')
  const [bankImportStatus, setBankImportStatus] = useState('')
  const bankFileRef = useRef(null)

  const [newQuestion, setNewQuestion] = useState({ question_type: 'single_choice', prompt: '', options: ['', ''], imageUrls: ['', ''], correct: [], points: 100, time_limit_seconds: '', scoring_strategy: 'fixed', boardImage: '', axisLabels: { x_label_low: '', x_label_high: '', y_label_low: '', y_label_high: '' } })

  const [shareRole, setShareRole] = useState('presenter')
  const [shareHours, setShareHours] = useState(12)
  const [shareLinks, setShareLinks] = useState([])
  const [shareBusy, setShareBusy] = useState(false)
  const [displays, setDisplays] = useState(null)
  const [newDisplayName, setNewDisplayName] = useState('Main stage')
  const [liveDefaults, setLiveDefaults] = useState({ guest_hub_participation: true, broadcast_join_enabled: true, allow_answer_changes: false, moderation_enabled: false, profanity_filtering: true, leaderboard_name_style: 'first_last_initial', response_retention_months: 12 })
  const [joinInfo, setJoinInfo] = useState(null)
  const [settingsSaved, setSettingsSaved] = useState(false)
  const [rules, setRules] = useState([])
  const [newRule, setNewRule] = useState({ source_question_id: '', operator: 'equals', comparison_value: '', target_question_id: '', action: 'show' })

  const enabled = !!event?.engagement_enabled

  // Opening an activity's controls (or the new-activity form) is a drill-down
  // within this page, not a route change — react-router never sees it, so
  // without this the browser's Back button skips straight past it and leaves
  // Festio Live entirely. Push one history entry per drill-down and, on Back,
  // just close it instead of letting the browser navigate away.
  const drilledDown = !!selected || creating
  useEffect(() => {
    if (!drilledDown) return undefined
    window.history.pushState({ festioLiveDrilldown: true }, '')
    const onPopState = () => { setSelected(null); setCreating(false) }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [drilledDown]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadActivities() {
    if (!eventId || !enabled) return
    try { setActivities(await api.liveActivities(eventId)) }
    catch (e) { setError(e.message) }
  }
  useEffect(() => { loadActivities() }, [eventId, enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadProgramSessions() {
    if (!eventId || !enabled) return
    try { setProgramSessions(await api.liveProgramSessions(eventId)) }
    catch { setProgramSessions([]) }
  }
  useEffect(() => { loadProgramSessions() }, [eventId, enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (eventId && enabled && displays === null) api.liveDisplays(eventId).then(setDisplays).catch((e) => setError(e.message))
  }, [eventId, enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (eventId && enabled) api.liveSettings(eventId).then(setLiveDefaults).catch((e) => setError(e.message))
  }, [eventId, enabled])

  useEffect(() => {
    if (eventId && enabled) api.liveJoinInfo(eventId).then(setJoinInfo).catch((e) => setError(e.message))
  }, [eventId, enabled])

  async function saveLiveDefaults() {
    setBusy(true); setError(''); setSettingsSaved(false)
    try { setLiveDefaults(await api.liveUpdateSettings(eventId, liveDefaults)); setSettingsSaved(true) }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  async function loadBank() {
    if (!eventId || !enabled) return
    try { setBank(await api.liveQuestionBank(eventId)) }
    catch (e) { setError(e.message) }
  }
  useEffect(() => { if (tab === 'Question Bank') loadBank() }, [tab, eventId, enabled]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (tab === 'Displays' && eventId && enabled) api.liveDisplays(eventId).then(setDisplays).catch((e) => setError(e.message))
  }, [tab, eventId, enabled])

  useEffect(() => {
    if (!eventId || !selected?.id || !selected.config?.show_automation_enabled || selected.config?.show_phase === 'complete') return undefined
    const timer = setInterval(() => {
      api.liveGetActivity(eventId, selected.id).then(setSelected).catch(() => {})
    }, 2000)
    return () => clearInterval(timer)
  }, [eventId, selected?.id, selected?.config?.show_automation_enabled, selected?.config?.show_phase])

  async function createDisplay() {
    if (!newDisplayName.trim()) return
    setBusy(true); setError('')
    try {
      await api.liveCreateDisplay(eventId, { name: newDisplayName.trim(), assigned_activity_id: activities?.[0]?.id || null, scene: 'welcome', settings: { theme: 'aurora', motion: true, show_reactions: true } })
      setDisplays(await api.liveDisplays(eventId))
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  async function updateDisplay(displayId, patch) {
    setBusy(true); setError('')
    try {
      const updated = await api.liveUpdateDisplay(eventId, displayId, patch)
      setDisplays((current) => (current || []).map((display) => display.id === displayId ? updated : display))
      return updated
    } catch (e) { setError(e.message); return null } finally { setBusy(false) }
  }

  async function presentDisplayResults(displayId, body) {
    setBusy(true); setError('')
    try {
      const updated = await api.livePresentDisplayResults(eventId, displayId, body)
      setDisplays((current) => (current || []).map((display) => display.id === displayId ? updated : display))
      return updated
    } catch (e) { setError(e.message); return null } finally { setBusy(false) }
  }

  async function setDisplayRehearsal(displayId, body) {
    setBusy(true); setError('')
    try {
      const updated = await api.liveSetDisplayRehearsal(eventId, displayId, body)
      setDisplays((current) => (current || []).map((display) => display.id === displayId ? updated : display))
      return updated
    } catch (e) { setError(e.message); return null } finally { setBusy(false) }
  }

  async function deleteDisplay(displayId) {
    if (!window.confirm('Delete this display link? Any screen using it will stop updating.')) return
    setBusy(true); setError('')
    try {
      await api.liveDeleteDisplay(eventId, displayId)
      setDisplays((current) => (current || []).filter((display) => display.id !== displayId))
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  async function createRule() {
    if (!selected || !newRule.source_question_id || !newRule.target_question_id) return
    setBusy(true); setError('')
    try {
      const comparison = ['answered', 'not_answered'].includes(newRule.operator) ? null : (['greater_than', 'less_than'].includes(newRule.operator) ? Number(newRule.comparison_value) : newRule.comparison_value)
      await api.liveCreateRule(eventId, selected.id, { ...newRule, comparison_value: comparison })
      setRules(await api.liveRules(eventId, selected.id))
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  async function openActivity(id) {
    setError(''); setResults(null); setLeaderboard(null); setWordClouds({}); setAiAnalyses({}); setQnaItems(null); setModerationItems(null); setResponseDetails(null)
    try {
      const full = await api.liveGetActivity(eventId, id)
      setSelected(full)
      setAutomationDraft(automationDraftFor(full))
      setEditingActivity(false)
      setActivityDraft({ title: full.title, description: full.description || '', session_id: full.session_id || '' })
      setEditingQuestionId(null)
      api.liveRules(eventId, id).then(setRules).catch(() => setRules([]))
      if (full.type === 'q_and_a') {
        try { setQnaItems(await api.liveQnaList(eventId, id)) } catch { /* non-fatal */ }
      } else {
        try { setModerationItems(await api.liveModerationItems(eventId, id)) } catch { setModerationItems([]) }
      }
    } catch (e) { setError(e.message) }
  }

  async function createActivity() {
    if (!newActivity.title.trim()) return
    setBusy(true); setError('')
    try {
      const created = await api.liveCreateActivity(eventId, { ...newActivity, session_id: newActivity.session_id || null })
      setNewActivity({ type: 'quiz', title: '', description: '', session_id: '', config: { anonymous: false, allow_answer_changes: false, live_results_enabled: true, moderation_enabled: false } })
      setCreating(false)
      await loadActivities()
      await openActivity(created.id)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  async function setStatus(status) {
    if (!selected) return
    setBusy(true); setError('')
    try {
      const updated = await api.liveUpdateActivity(eventId, selected.id, { status })
      setSelected(updated)
      await loadActivities()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  async function saveActivityDetails() {
    if (!selected || !activityDraft.title.trim()) return
    setBusy(true); setError('')
    try {
      const updated = await api.liveUpdateActivity(eventId, selected.id, {
        title: activityDraft.title.trim(), description: activityDraft.description.trim() || null,
        session_id: activityDraft.session_id || null,
        config: { moderation_enabled: activityDraft.moderation_enabled, auto_close_enabled: activityDraft.auto_close_enabled, auto_start_enabled: activityDraft.auto_start_enabled, registered_progress_mode: activityDraft.registered_progress_mode },
      })
      setSelected(updated); setEditingActivity(false); await loadActivities()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  async function saveQuestionPrompt(questionId) {
    if (!selected || !questionPromptDraft.trim()) return
    setBusy(true); setError('')
    try {
      await api.liveUpdateQuestion(eventId, questionId, { prompt: questionPromptDraft.trim() })
      await openActivity(selected.id)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  async function addQuestion() {
    if (!selected || !newQuestion.prompt.trim()) return
    setBusy(true); setError('')
    try {
      const needsOptions = ['single_choice', 'multiple_choice', 'true_false', 'yes_no', 'ranking'].includes(newQuestion.question_type)
      const automaticOptions = newQuestion.question_type === 'true_false' ? ['True', 'False'] : newQuestion.question_type === 'yes_no' ? ['Yes', 'No'] : newQuestion.options
      const body = {
        question_type: newQuestion.question_type,
        prompt: newQuestion.prompt,
        sequence: selected.questions.length,
        time_limit_seconds: newQuestion.time_limit_seconds === '' ? null : Number(newQuestion.time_limit_seconds),
        config: newQuestion.question_type === 'image_click' ? { image_url: newQuestion.boardImage.trim() }
          : newQuestion.question_type === 'quadrant' ? Object.fromEntries(Object.entries(newQuestion.axisLabels).filter(([, v]) => v.trim()))
          : selected.type === 'quiz' ? { points: Number(newQuestion.points) || 0, scoring_strategy: newQuestion.scoring_strategy }
          : {},
        options: needsOptions ? newQuestion.options
          .map((label, index) => ({ label, is_correct: newQuestion.correct.includes(index), config: newQuestion.imageUrls[index]?.trim() ? { image_url: newQuestion.imageUrls[index].trim() } : {} }))
          .filter((o) => o.label.trim()) : [],
      }
      if (newQuestion.question_type === 'true_false' || newQuestion.question_type === 'yes_no') {
        body.options = automaticOptions.map((label, index) => ({ label, is_correct: newQuestion.correct.includes(index) }))
      }
      await api.liveAddQuestion(eventId, selected.id, body)
      setNewQuestion({ question_type: 'single_choice', prompt: '', options: ['', ''], imageUrls: ['', ''], correct: [], points: 100, time_limit_seconds: '', scoring_strategy: 'fixed', boardImage: '', axisLabels: { x_label_low: '', x_label_high: '', y_label_low: '', y_label_high: '' } })
      await openActivity(selected.id)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  async function deleteQuestion(qid) {
    setBusy(true); setError('')
    try { await api.liveDeleteQuestion(eventId, qid); await openActivity(selected.id) }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  async function archiveQuestion(qid) {
    setBusy(true); setError('')
    try { await api.liveUpdateQuestion(eventId, qid, { status: 'archived' }); await openActivity(selected.id) }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  async function viewResults() {
    if (!selected) return
    try {
      setResults(await api.liveResults(eventId, selected.id))
      setResponseDetails(await api.liveResponseDetails(eventId, selected.id))
      if (selected.type !== 'q_and_a') setModerationItems(await api.liveModerationItems(eventId, selected.id))
      if (selected.config?.leaderboard_enabled) setLeaderboard((await api.liveLeaderboard(eventId, selected.id)).entries)
    } catch (e) { setError(e.message) }
  }

  async function openParticipantPreview() {
    if (!selected) return
    try {
      const payload = await api.liveResults(eventId, selected.id)
      setResults(payload)
      setParticipantPreviewOpen(true)
    } catch (e) { setError(e.message) }
  }

  async function viewWordCloud(questionId) {
    try {
      const entries = await api.liveWordCloud(eventId, questionId)
      setWordClouds((v) => ({ ...v, [questionId]: entries }))
    } catch (e) { setError(e.message) }
  }

  async function runAiAnalysis(questionId) {
    setAiBusy(questionId); setError('')
    try {
      let job = await api.liveAiAnalysis(eventId, questionId)
      // The worker retries a failed/unreachable local-ai call up to 3 times
      // with its own 60s timeout each -- poll for the worst case (~180s),
      // not just the common case, so this doesn't give up while the backend
      // is still legitimately working.
      for (let attempt = 0; attempt < 90 && ['queued', 'running'].includes(job.status); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000))
        job = await api.liveAiAnalysisStatus(eventId, job.id)
      }
      if (job.status === 'completed') { setAiAnalyses((v) => ({ ...v, [questionId]: job.result })); return }
      if (job.status === 'failed') throw new Error(job.error || 'AI analysis failed.')
      // Still queued/running after the poll window -- not a failure, it may
      // still complete; don't tell the organizer something broke.
      setError('AI analysis is taking longer than usual and is still running in the background — check back in a minute.')
    } catch (e) { setError(e.message) } finally { setAiBusy(null) }
  }

  async function advanceQuestion(questionId) {
    if (!selected) return
    setBusy(true); setError('')
    try {
      const updated = await api.liveAdvance(eventId, selected.id, selected.config?.current_question_id === questionId ? null : questionId)
      setSelected(updated)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  async function startGuidedShow() {
    if (!selected) return
    setBusy(true); setError('')
    try {
      const updated = await api.liveStartGuidedShow(eventId, selected.id)
      const assigned = (displays || []).filter((display) => display.assigned_activity_id === selected.id)
      if (assigned.length) {
        const refreshed = await Promise.all(assigned.map((display) => api.liveUpdateDisplay(eventId, display.id, { settings: { control_mode: 'guided', follow_activity: true } })))
        setDisplays((current) => (current || []).map((display) => refreshed.find((item) => item.id === display.id) || display))
      }
      setSelected(updated)
      await loadActivities()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  async function advanceGuidedShow() {
    if (!selected) return
    setBusy(true); setError('')
    try {
      const updated = await api.liveAdvanceGuidedShow(eventId, selected.id)
      setSelected(updated)
      await loadActivities()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  async function saveGuidedAutomation() {
    if (!selected) return
    setBusy(true); setError('')
    try {
      const body = {
        enabled: automationDraft.enabled,
        timings: Object.fromEntries(Object.entries(automationDraft.timings).map(([phase, seconds]) => [phase, Math.min(3600, Math.max(1, Number(seconds) || SHOW_AUTOMATION_DEFAULTS[phase]))])),
      }
      const updated = await api.liveConfigureGuidedShowAutomation(eventId, selected.id, body)
      setSelected(updated)
      setAutomationDraft(automationDraftFor(updated))
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  async function changeQuestionState(questionId, state) {
    setBusy(true); setError('')
    try { await api.liveQuestionState(eventId, questionId, state); await openActivity(selected.id) }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  async function extendActivity(minutes) {
    if (!selected) return
    setBusy(true); setError('')
    try { const updated = await api.liveExtendActivity(eventId, selected.id, minutes); setSelected(updated) }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  async function loadQna() {
    if (!selected) return
    try { setQnaItems(await api.liveQnaList(eventId, selected.id)) }
    catch (e) { setError(e.message) }
  }

  async function moderateQna(qnaId, status) {
    setBusy(true); setError('')
    try { await api.liveQnaModerate(eventId, qnaId, status); await loadQna() }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  async function moderateText(itemId, status) {
    setBusy(true); setError('')
    try {
      await api.liveModerationDecision(eventId, itemId, status)
      setModerationItems(await api.liveModerationItems(eventId, selected.id))
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  async function generateShareLink() {
    setShareBusy(true); setError('')
    try {
      const created = await api.liveShareLink(eventId, shareRole, Number(shareHours) || 12)
      const url = created.url || `${window.location.origin}/p/${created.code}`
      setShareLinks((v) => [{ role: shareRole, url, hours: shareHours }, ...v])
    } catch (e) { setError(e.message) } finally { setShareBusy(false) }
  }

  async function createBankItem() {
    if (!newBankItem.prompt.trim()) return
    setBusy(true); setError('')
    try {
      const needsOptions = ['single_choice', 'multiple_choice'].includes(newBankItem.question_type)
      await api.liveCreateBankItem(eventId, {
        question_type: newBankItem.question_type, prompt: newBankItem.prompt,
        options: needsOptions ? newBankItem.options.filter((o) => o.trim()).map((label) => ({ label })) : [],
        category: newBankItem.category.trim() || null,
        tags: newBankItem.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      })
      setNewBankItem({ question_type: 'single_choice', prompt: '', options: ['', ''], category: '', tags: '' })
      await loadBank()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  async function importFromBank(itemId) {
    if (!selected) return
    setBusy(true); setError('')
    try { await api.liveImportBankItem(eventId, selected.id, itemId); await openActivity(selected.id) }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  function exportQuestionBankCsv() {
    if (!bank?.length) return
    const escape = (value) => {
      const text = String(value ?? '')
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
    }
    const headers = ['question_type', 'prompt', 'description', 'category', 'tags', 'options', 'correct_options']
    const rows = bank.map((item) => [
      item.question_type, item.prompt, item.description || '', item.category || '',
      (item.tags || []).join('|'),
      (item.options || []).map((option) => option.label).join('|'),
      (item.options || []).filter((option) => option.is_correct).map((option) => option.label).join('|'),
    ])
    const csv = [headers, ...rows].map((row) => row.map(escape).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url; link.download = 'question-bank.csv'
    document.body.appendChild(link); link.click(); link.remove()
    URL.revokeObjectURL(url)
  }

  async function importQuestionBankCsv(file) {
    if (!file) return
    setBusy(true); setError(''); setBankImportStatus('')
    try {
      const rows = parseCsv(await file.text())
      if (rows.length < 2) throw new Error('CSV needs a header and at least one question row.')
      const headers = rows[0].map((header) => header.toLowerCase().replace(/\s+/g, '_'))
      const items = rows.slice(1).map((row, index) => {
        const record = Object.fromEntries(headers.map((header, column) => [header, row[column] || '']))
        const questionType = record.question_type || 'single_choice'
        if (!QUESTION_TYPE_KEYS.has(questionType)) throw new Error(`Row ${index + 2}: unknown question_type “${questionType}”.`)
        if (!record.prompt.trim()) throw new Error(`Row ${index + 2}: prompt is required.`)
        const optionLabels = (record.options || '').split('|').map((option) => option.trim()).filter(Boolean)
        const correct = new Set((record.correct_options || '').split('|').map((option) => option.trim()).filter(Boolean))
        return { question_type: questionType, prompt: record.prompt.trim(), description: record.description || null, category: record.category || null, tags: (record.tags || '').split('|').map((tag) => tag.trim()).filter(Boolean), options: optionLabels.map((label) => ({ label, is_correct: correct.has(label) })) }
      })
      await api.liveImportBankItems(eventId, items)
      setBankImportStatus(`${items.length} question${items.length === 1 ? '' : 's'} imported.`)
      await loadBank()
    } catch (e) { setError(e.message) } finally { setBusy(false); if (bankFileRef.current) bankFileRef.current.value = '' }
  }

  if (eventId && !eventLoading && !enabled) {
    return (
      <RedesignShell topActive="live" withEventSidebar eventActive="live">
        <div className="rr-pagehead"><div><div className="rr-title-row"><h1>Festio Live</h1></div></div></div>
        <div className="rr-panel rr-locked">
          <div className="rd-panel-body">
            <span className="rr-locked-badge"><Icon name="lock" size={11} /> Not enabled</span>
            <h3 style={{ marginTop: 8 }}>Festio Live isn't turned on for this event</h3>
            <p className="rd-hint">Live quizzes, polls, ratings and feedback guests join from their phone live here once the Festio Live add-on is enabled.</p>
            <a className="rr-btn primary rr-locked-cta" href="/communications-redesign?tab=settings">Enable Festio Live</a>
          </div>
        </div>
      </RedesignShell>
    )
  }

  const searchTerm = activitySearch.trim().toLowerCase()
  const isFiltering = !!searchTerm || !!activityStatusFilter
  const passesActivityFilters = (activity) =>
    (!searchTerm || activity.title.toLowerCase().includes(searchTerm) || activity.type.toLowerCase().includes(searchTerm))
    // Archived activities are retired history, not something to present by
    // default -- they only reappear when someone deliberately filters for them.
    && (activityStatusFilter ? activity.status === activityStatusFilter : activity.status !== 'archived')

  const programSessionById = new Map((programSessions || []).map((session) => [session.source_step_id, session]))
  const groupedActivities = (programSessions || []).filter((session) => !programFilter || programFilter === session.source_step_id).map((session) => ({
    session,
    activities: (activities || []).filter((activity) => activity.session_id === session.source_step_id && passesActivityFilters(activity)),
  }))
  const eventWideActivities = (activities || []).filter((activity) => (!activity.session_id || !programSessionById.has(activity.session_id)) && passesActivityFilters(activity))
  // Event-wide activities aren't tied to a program moment, so they sort after
  // every session-linked one — everything else follows the actual Experience
  // program order rather than creation order.
  const sessionStartMs = (activity) => {
    const session = programSessionById.get(activity.session_id)
    return session?.starts_at ? new Date(session.starts_at).getTime() : Infinity
  }
  const sortByProgram = (list) => [...list].sort((a, b) => sessionStartMs(a) - sessionStartMs(b))
  const visibleActivities = sortByProgram((programFilter === 'event-wide'
    ? eventWideActivities
    : programFilter ? (activities || []).filter((activity) => activity.session_id === programFilter) : (activities || [])
  ).filter(passesActivityFilters))
  const visibleDisplays = programFilter === 'event-wide'
    ? (displays || []).filter((display) => !display.assigned_session_id)
    : programFilter ? (displays || []).filter((display) => display.assigned_session_id === programFilter) : (displays || [])
  const currentProgramSession = (programSessions || []).find((session) => {
    const now = Date.now()
    return session.starts_at && new Date(session.starts_at).getTime() <= now && (!session.ends_at || now < new Date(session.ends_at).getTime())
  })
  const suggestedActivity = currentProgramSession && (activities || []).find((activity) => activity.session_id === currentProgramSession.source_step_id && ['draft', 'scheduled', 'paused'].includes(activity.status))

  function ActivityListRow({ activity }) {
    const session = programSessionById.get(activity.session_id)
    return <div onClick={() => openActivity(activity.id)} className="fl-program-activity-row">
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5 }}>{activity.title}</div>
        <div style={{ fontSize: 12, color: '#5b6a5c', textTransform: 'capitalize' }}>{activity.type}{session ? ` · ${session.room || 'Program session'}` : ''}</div>
      </div>
      <div style={{ fontSize: 12, color: '#5b6a5c' }}>{activity.response_count} responses</div>
      <StatusChip status={activity.status} />
    </div>
  }

  return (
    <RedesignShell topActive="live" withEventSidebar eventActive="live">
      <div className="fl-app">
      <div className="rr-pagehead fl-pagehead">
        <div><span className="fl-eyebrow">Audience engagement suite</span><div className="rr-title-row"><h1>Festio Live</h1><span className="fl-live-badge">● LIVE READY</span></div><div className="rr-meta">Create moments people remember — before, during, and after the event.</div></div>
        <div className="fl-page-actions"><button className="rr-btn secondary" onClick={() => setTab('Displays')}>Broadcast studio</button><button className="rr-btn primary" onClick={() => { setTab('Activities'); setSelected(null); setCreating(true) }}>+ New activity</button></div>
      </div>

      {error && <div style={{ background: '#fbe9e7', color: '#a3271e', padding: '10px 14px', borderRadius: 10, fontSize: 13, marginBottom: 14 }}><Icon name="info" size={14} /> {error}</div>}

      <nav className="fl-tabs" aria-label="Festio Live sections">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>
        ))}
      </nav>

      {event?.experience_enabled && ['Activities', 'Live Control', 'Displays', 'Responses', 'Analytics'].includes(tab) && <div className="fl-program-filter">
        <span>Experience program</span>
        <select className="rr-select" aria-label="Filter by Experience program session" value={programFilter} onChange={(event) => setProgramFilter(event.target.value)}>
          <option value="">All program sessions</option>
          <option value="event-wide">Event-wide only</option>
          {(programSessions || []).map((session) => <option key={session.source_step_id} value={session.source_step_id}>{session.title}{session.room ? ` · ${session.room}` : ''}</option>)}
        </select>
        {programFilter && <button type="button" onClick={() => setProgramFilter('')}>Clear filter</button>}
      </div>}

      {['Activities', 'Live Control'].includes(tab) && <div className="fl-program-filter">
        <input className="rr-input" style={{ flex: '1 1 240px', minWidth: 180 }} type="search" placeholder="Search activities by name or type…" aria-label="Search activities" value={activitySearch} onChange={(event) => setActivitySearch(event.target.value)} />
        <select className="rr-select" aria-label="Filter by status" value={activityStatusFilter} onChange={(event) => setActivityStatusFilter(event.target.value)}>
          <option value="">Any status</option>
          {['draft', 'scheduled', 'live', 'paused', 'closed', 'completed', 'archived'].map((status) => <option key={status} value={status}>{status[0].toUpperCase() + status.slice(1)}</option>)}
        </select>
        {isFiltering && <button type="button" onClick={() => { setActivitySearch(''); setActivityStatusFilter('') }}>Clear</button>}
      </div>}

      {tab === 'Overview' && <OverviewPanel eventId={eventId} joinInfo={joinInfo} activities={activities} displays={displays} onCreate={() => { setTab('Activities'); setSelected(null); setCreating(true) }} onOpen={async (id) => { await openActivity(id); setTab('Activities') }} onTab={setTab} />}

      {tab === 'Experiences' && (
        <Suspense fallback={<div className="fl-loading">Loading experiences…</div>}>
          <ExperienceWorkflowsPanel eventId={eventId} activities={activities || []} displays={displays || []} presenterEntry={presenterEntry}/>
        </Suspense>
      )}

      {tab === 'Activities' && !selected && (
        <div className="rr-panel fl-section-panel">
          <div className="rd-panel-head">
            <div><span className="fl-eyebrow">Activity studio</span><h3>Activities</h3><p>Create, schedule, and reuse interactive moments.</p></div>
            <button className="rr-btn primary" onClick={() => setCreating((v) => !v)}>{creating ? 'Cancel' : '+ New Activity'}</button>
          </div>
          <div className="rd-panel-body">
            {event?.experience_enabled && <div className="fl-program-sync-banner"><span>✦</span><div><strong>Experience program connected</strong><small>{programSessions === null ? 'Loading synchronized sessions…' : `${programSessions.length} synchronized session${programSessions.length === 1 ? '' : 's'} · schedules remain owned by Experience`}</small></div><a href="/experience-redesign">Open Experience →</a></div>}
            {creating && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div>
                  <label className="rd-field-label">Type</label>
                  <select className="rr-select" aria-label="Activity type" value={newActivity.type} onChange={(e) => setNewActivity((v) => ({ ...v, type: e.target.value }))}>
                    {ACTIVITY_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <label className="rd-field-label">Title</label>
                  <input className="rr-input" value={newActivity.title} onChange={(e) => setNewActivity((v) => ({ ...v, title: e.target.value }))} placeholder="e.g. Leadership Poll" />
                </div>
                <div style={{ flex: 2, minWidth: 240 }}><label className="rd-field-label">Description</label><input className="rr-input" value={newActivity.description} onChange={(e) => setNewActivity((value) => ({ ...value, description: e.target.value }))} placeholder="What guests will experience" /></div>
                <div style={{ minWidth: 220 }}><label className="rd-field-label">Experience program session</label><select className="rr-select" aria-label="Experience program session" value={newActivity.session_id || ''} onChange={(event) => setNewActivity((value) => ({ ...value, session_id: event.target.value }))}><option value="">Event-wide activity</option>{(programSessions || []).filter((session) => session.status === 'published').map((session) => <option key={session.source_step_id} value={session.source_step_id}>{session.title}{session.room ? ` · ${session.room}` : ''}</option>)}</select></div>
                {newActivity.type === 'quiz' && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: '#5b6a5c', paddingBottom: 9 }}>
                    <input type="checkbox" checked={!!newActivity.config?.leaderboard_enabled}
                      onChange={(e) => setNewActivity((v) => ({ ...v, config: { ...v.config, leaderboard_enabled: e.target.checked } }))} />
                    Leaderboard
                  </label>
                )}
                {[['anonymous', 'Truly anonymous'], ['allow_answer_changes', 'Allow changes'], ['live_results_enabled', 'Guest results'], ['moderation_enabled', 'Moderate text']].map(([key, label]) => <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, paddingBottom: 9 }}><input type="checkbox" checked={!!newActivity.config?.[key]} onChange={(event) => setNewActivity((value) => ({ ...value, config: { ...value.config, [key]: event.target.checked } }))}/>{label}</label>)}
                <button className="rr-btn primary" disabled={busy || !newActivity.title.trim()} onClick={createActivity}>{busy ? 'Creating…' : 'Create'}</button>
              </div>
            )}
            {activities === null ? <p className="rd-hint">Loading…</p> : activities.length === 0 ? (
              <p className="rd-hint">No activities yet — create your first quiz, poll, or feedback form above.</p>
            ) : <div className="fl-program-groups">
              {groupedActivities.filter((group) => group.activities.length || (!isFiltering && group.session.status === 'published')).map((group) => <section className="fl-program-group" key={group.session.source_step_id}><header><div><strong>{group.session.title}</strong><small>{group.session.starts_at ? new Date(group.session.starts_at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'Program session'}{group.session.room ? ` · ${group.session.room}` : ''}{group.session.speaker ? ` · ${group.session.speaker}` : ''}</small></div><a className="fl-experience-return" href={`/experience-redesign?step=${encodeURIComponent(group.session.source_step_id)}`}>Open in Experience ↗</a><span className={`fl-sync-chip ${group.session.status}`}>{group.session.status === 'published' ? '✓ Synchronized' : group.session.status}</span></header>{group.activities.length ? group.activities.map((activity) => <ActivityListRow key={activity.id} activity={activity}/>) : <button className="fl-add-session-activity" onClick={() => { setNewActivity((value) => ({ ...value, session_id: group.session.source_step_id, title: `${group.session.title} Pulse` })); setCreating(true) }}>+ Add Live moment</button>}</section>)}
              {(!programFilter || programFilter === 'event-wide') && eventWideActivities.length > 0 && <section className="fl-program-group"><header><div><strong>Event-wide activities</strong><small>Not linked to an Experience program session</small></div></header>{eventWideActivities.map((activity) => <ActivityListRow key={activity.id} activity={activity}/>)}</section>}
              {isFiltering && !groupedActivities.some((group) => group.activities.length) && !eventWideActivities.length && <p className="rd-hint">No activities match "{activitySearch}"{activityStatusFilter ? ` with status "${activityStatusFilter}"` : ''}.</p>}
            </div>}
          </div>
        </div>
      )}

      {tab === 'Activities' && selected && (
        <div className="fl-builder-view">
          <button className="rr-link-btn" style={{ marginBottom: 10 }} onClick={() => { setSelected(null); setResults(null) }}>← All activities</button>
          <div className="rr-panel fl-section-panel">
            <div className="rd-panel-head">
              <div><h3>{selected.title}</h3><p style={{ margin: 0, fontSize: 12, color: '#5b6a5c', textTransform: 'capitalize' }}>{selected.type}</p></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><button className="rr-btn secondary" onClick={() => { setActivityDraft({ title: selected.title, description: selected.description || '', session_id: selected.session_id || '', moderation_enabled: !!selected.config?.moderation_enabled, auto_close_enabled: selected.config?.auto_close_enabled !== false, auto_start_enabled: !!selected.config?.auto_start_enabled, registered_progress_mode: selected.config?.registered_progress_mode || 'off' }); setEditingActivity((value) => !value) }}>{editingActivity ? 'Cancel edit' : 'Edit details'}</button><StatusChip status={selected.status} /></div>
            </div>
            <div className="rd-panel-body">
              {editingActivity && <div style={{ display: 'grid', gap: 9, padding: 14, marginBottom: 14, borderRadius: 10, background: '#f7f6f0' }}>
                <label><span className="rd-field-label">Activity title</span><input className="rr-input" aria-label="Activity title" value={activityDraft.title} onChange={(event) => setActivityDraft((value) => ({ ...value, title: event.target.value }))}/></label>
                <label><span className="rd-field-label">Description</span><input className="rr-input" aria-label="Activity description" value={activityDraft.description} onChange={(event) => setActivityDraft((value) => ({ ...value, description: event.target.value }))}/></label>
                <label><span className="rd-field-label">Experience program session</span><select className="rr-select" aria-label="Linked Experience program session" value={activityDraft.session_id || ''} onChange={(event) => setActivityDraft((value) => ({ ...value, session_id: event.target.value }))}><option value="">Event-wide activity</option>{(programSessions || []).filter((session) => session.status === 'published').map((session) => <option key={session.source_step_id} value={session.source_step_id}>{session.title}{session.room ? ` · ${session.room}` : ''}</option>)}</select></label>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <input type="checkbox" style={{ marginTop: 3 }} checked={activityDraft.moderation_enabled} onChange={(event) => setActivityDraft((value) => ({ ...value, moderation_enabled: event.target.checked }))} />
                  <span><span className="rd-field-label" style={{ display: 'block' }}>Moderate text before it's public</span><span style={{ fontSize: 12, color: '#5b6a5c' }}>Word cloud, feedback, and open-text answers wait for your approval before appearing on projectors or public word clouds. Off by default — flagged content is always held for review regardless.</span></span>
                </label>
                {activityDraft.session_id && (
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <input type="checkbox" style={{ marginTop: 3 }} checked={activityDraft.auto_close_enabled} onChange={(event) => setActivityDraft((value) => ({ ...value, auto_close_enabled: event.target.checked }))} />
                    <span><span className="rd-field-label" style={{ display: 'block' }}>Auto-close when the linked session ends</span><span style={{ fontSize: 12, color: '#5b6a5c' }}>Closes itself ~20 min after the session's scheduled end, so guests don't stumble onto a stale activity from an earlier session. Running long? Use "Extend +30 min" instead of turning this off.</span></span>
                  </label>
                )}
                {activityDraft.session_id && (
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <input type="checkbox" style={{ marginTop: 3 }} checked={activityDraft.auto_start_enabled} onChange={(event) => setActivityDraft((value) => ({ ...value, auto_start_enabled: event.target.checked }))} />
                    <span><span className="rd-field-label" style={{ display: 'block' }}>Auto-start when the linked session begins</span><span style={{ fontSize: 12, color: '#5b6a5c' }}>Goes live on its own the moment the session's scheduled start time arrives — no one has to press Go Live. Off by default; Festio Live never starts anything without this switched on.</span></span>
                  </label>
                )}
                <label>
                  <span className="rd-field-label" style={{ display: 'block' }}>Show response progress on the display</span>
                  <select className="rr-select" value={activityDraft.registered_progress_mode} onChange={(event) => setActivityDraft((value) => ({ ...value, registered_progress_mode: event.target.value }))}>
                    <option value="off">Off — don't show</option>
                    <option value="full">Full — count and percent of guests</option>
                    <option value="percent">Percent only</option>
                  </select>
                  <span style={{ display: 'block', fontSize: 12, color: '#5b6a5c', marginTop: 4 }}>Compares unique responders against your total registered guest count, shown as a banner under the results on the big screen. Off by default.</span>
                </label>
                <div><button className="rr-btn primary" disabled={busy || !activityDraft.title.trim()} onClick={saveActivityDetails}>{busy ? 'Saving…' : 'Save details'}</button></div>
              </div>}
              <div className="fl-guided-console">
                <div><span>GUIDED SHOW MODE</span><h3>{SHOW_PHASE_LABELS[selected.config?.show_phase] || 'Ready to begin'}</h3><p>One presenter action keeps the main screen, guest phones, timer, voting and results synchronized.</p></div>
                <button className="rr-btn primary" disabled={busy} onClick={selected.config?.show_mode === 'guided' && selected.config?.show_phase !== 'complete' ? advanceGuidedShow : startGuidedShow}>{busy ? 'Updating every screen…' : guidedActionLabel(selected)}</button>
                <small>{(displays || []).some((display) => display.assigned_activity_id === selected.id) ? `${(displays || []).filter((display) => display.assigned_activity_id === selected.id).length} assigned display(s) will follow this show.` : 'Assign a display in the Displays tab; the activity flow can still be rehearsed here.'}</small>
              </div>
              <section className="fl-automation-panel">
                <header>
                  <div><span>FULL AUTOMATION</span><h4>Time every phase</h4><p>Festio advances the projector, guest phones and every question from the server clock. The presenter button remains an instant override.</p></div>
                  <label className="fl-automation-switch"><input type="checkbox" checked={automationDraft.enabled} onChange={(event) => setAutomationDraft((value) => ({ ...value, enabled: event.target.checked }))}/><b>{automationDraft.enabled ? 'Automatic' : 'Manual'}</b></label>
                </header>
                <div className="fl-automation-grid">
                  {Object.entries(SHOW_AUTOMATION_LABELS).map(([phase, label]) => <label key={phase}><span>{label}</span><div><input type="number" min="1" max="3600" value={automationDraft.timings[phase]} onChange={(event) => setAutomationDraft((value) => ({ ...value, timings: { ...value.timings, [phase]: event.target.value } }))}/><em>sec</em></div></label>)}
                </div>
                <footer><span>{selected.type === 'word_cloud' ? 'Participation controls how long words are collected for each prompt.' : 'A question’s own timer overrides Participation for that question.'} The final slide automatically summarizes every question.</span><button className="rr-btn primary" disabled={busy} onClick={saveGuidedAutomation}>{busy ? 'Saving…' : automationDraft.enabled ? 'Save and enable automation' : 'Save manual mode'}</button></footer>
              </section>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                {selected.status === 'draft' && <button className="rr-btn primary" disabled={busy} onClick={() => setStatus('live')}>Go Live</button>}
                {selected.status === 'live' && <button className="rr-btn" disabled={busy} onClick={() => setStatus('paused')}>Pause</button>}
                {selected.status === 'paused' && <button className="rr-btn primary" disabled={busy} onClick={() => setStatus('live')}>Resume</button>}
                {['live', 'paused'].includes(selected.status) && <button className="rr-btn" disabled={busy} onClick={() => setStatus('closed')}>Close</button>}
                {selected.status === 'closed' && <button className="rr-btn primary" disabled={busy} onClick={() => window.confirm('End this activity and mark it completed?') && setStatus('completed')}>End activity</button>}
                <button className="rr-btn secondary" onClick={viewResults}>View Results</button>
                <button className="rr-btn secondary" onClick={openParticipantPreview}>Preview participant review</button>
                <button className="rr-btn secondary" onClick={() => {
                  const url = selected.short_code
                    ? `${window.location.origin}/d/${selected.short_code}`
                    : `${window.location.origin}/live-display/${selected.id}?token=${encodeURIComponent(selected.config?.display_token || '')}`
                  navigator.clipboard?.writeText(url)
                }}>Copy TV Display Link</button>
                {selected.session_id && ['live', 'paused'].includes(selected.status) && selected.config?.auto_close_enabled !== false && (
                  <button className="rr-btn secondary" disabled={busy} onClick={() => extendActivity(30)} title="Running long? Push back the auto-close deadline.">Extend +30 min</button>
                )}
              </div>
              {selected.session_id && ['live', 'paused'].includes(selected.status) && (
                selected.config?.auto_close_enabled === false ? (
                  <p className="rd-hint" style={{ marginTop: -6, marginBottom: 12 }}>Auto-close is off for this activity — it stays open until you close it.</p>
                ) : (
                  <p className="rd-hint" style={{ marginTop: -6, marginBottom: 12 }}>
                    Closes automatically {selected.config?.auto_close_grace_minutes ?? 20} min after its linked session ends
                    {selected.config?.extended_until ? `, extended to ${new Date(selected.config.extended_until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''} — running long? Use Extend above.
                  </p>
                )
              )}

              {selected.status === 'live' && selected.type !== 'q_and_a' && (
                selected.questions.some((question) => question.status !== 'archived' && question.live_state === 'open') ? (
                  <div role="status" className="fl-live-state fl-live-state-open"><b>Activity live</b><span>Question open — accepting responses</span></div>
                ) : (
                  <div role="status" className="fl-live-state fl-live-state-ready">
                    <span><b>Activity live</b><small>Question closed — not accepting responses</small></span>
                    {selected.questions.some((question) => question.status !== 'archived') && <button className="rr-btn primary" disabled={busy} onClick={() => changeQuestionState(selected.questions.find((question) => question.status !== 'archived')?.id, 'open')}>Open question</button>}
                  </div>
                )
              )}

              {selected.type !== 'q_and_a' && (
                <>
                  <h4 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '.05em', color: '#5b6a5c', margin: '0 0 10px' }}>Questions</h4>
                  {selected.questions.length === 0 && <p className="rd-hint">No questions yet — add one below.</p>}
                  {selected.questions.map((q, i) => (
                <div key={q.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--rr-line, #eee)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13.5 }}>{i + 1}. {q.prompt}</div>
                      <div style={{ fontSize: 11.5, color: '#5b6a5c', textTransform: 'capitalize' }}>{q.question_type.replace('_', ' ')}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      {q.status === 'archived' && <span className="fl-question-archived">Archived</span>}
                      {q.status !== 'archived' && ['draft', 'scheduled'].includes(selected.status) && <button className="rr-link-btn" onClick={() => { setEditingQuestionId(q.id); setQuestionPromptDraft(q.prompt) }}>Edit question</button>}
                      {q.status !== 'archived' && ['live', 'paused'].includes(selected.status) && (
                        <>
                          {q.live_state === 'pending' && <button className="rr-link-btn" disabled={busy || selected.status !== 'live'} onClick={() => changeQuestionState(q.id, 'open')}>Open question</button>}
                          {q.live_state === 'open' && <button className="rr-link-btn" disabled={busy} onClick={() => changeQuestionState(q.id, 'closed')}>Close voting</button>}
                          {q.live_state === 'closed' && <><button className="rr-link-btn" disabled={busy} onClick={() => changeQuestionState(q.id, 'open')}>Reopen question</button><button className="rr-link-btn" disabled={busy} onClick={() => changeQuestionState(q.id, 'results_visible')}>Reveal results</button></>}
                          {q.live_state === 'results_visible' && q.options.some((o) => o.is_correct) && <button className="rr-link-btn" disabled={busy} onClick={() => changeQuestionState(q.id, 'answer_revealed')}>Show answer</button>}
                          {['results_visible', 'answer_revealed'].includes(q.live_state) && <button className="rr-link-btn" disabled={busy} onClick={() => changeQuestionState(q.id, 'closed')}>Hide results</button>}
                        </>
                      )}
                      {q.status !== 'archived' && ['draft', 'scheduled'].includes(selected.status) && <button className="rr-link-btn gr-danger-link" onClick={() => deleteQuestion(q.id)}>Remove</button>}
                      {q.status !== 'archived' && ['closed', 'completed'].includes(selected.status) && <button className="rr-link-btn" disabled={busy} onClick={() => archiveQuestion(q.id)}>Archive</button>}
                    </div>
                  </div>
                  {editingQuestionId === q.id && <div style={{ display: 'flex', gap: 8, marginTop: 9, flexWrap: 'wrap' }}><input className="rr-input" style={{ flex: 1, minWidth: 220 }} aria-label={`Edit question ${i + 1}`} value={questionPromptDraft} onChange={(event) => setQuestionPromptDraft(event.target.value)}/><button className="rr-btn primary" disabled={busy || !questionPromptDraft.trim()} onClick={() => saveQuestionPrompt(q.id)}>Save question</button><button className="rr-btn secondary" onClick={() => setEditingQuestionId(null)}>Cancel</button></div>}
                  {q.options.length > 0 && (
                    <ul style={{ margin: '6px 0 0', paddingLeft: 20, fontSize: 12.5, color: '#5b6a5c' }}>
                      {q.options.map((o) => <li key={o.id}>{o.label}</li>)}
                    </ul>
                  )}
                </div>
              ))}

              <div style={{ marginTop: 16, padding: 14, background: '#f7f6f0', borderRadius: 10 }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                  <select className="rr-select" aria-label="Question type" value={newQuestion.question_type} onChange={(e) => setNewQuestion((v) => ({ ...v, question_type: e.target.value, correct: [] }))}>
                    {QUESTION_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                  <input className="rr-input" style={{ flex: 1, minWidth: 200 }} placeholder="Question prompt" value={newQuestion.prompt} onChange={(e) => setNewQuestion((v) => ({ ...v, prompt: e.target.value }))} />
                </div>
                {['single_choice', 'multiple_choice', 'ranking'].includes(newQuestion.question_type) && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                    {newQuestion.options.map((opt, idx) => (
                      <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input className="rr-input" placeholder={`Option ${idx + 1}`} value={opt}
                          onChange={(e) => setNewQuestion((v) => ({ ...v, options: v.options.map((o, i2) => i2 === idx ? e.target.value : o) }))} />
                        {['single_choice', 'multiple_choice'].includes(newQuestion.question_type) && <input className="rr-input" style={{ maxWidth: 220 }} placeholder="Image URL (optional)" value={newQuestion.imageUrls[idx] || ''}
                          onChange={(e) => setNewQuestion((v) => ({ ...v, imageUrls: v.options.map((_, i2) => i2 === idx ? e.target.value : (v.imageUrls[i2] || '')) }))} />}
                        {selected.type === 'quiz' && newQuestion.question_type !== 'ranking' && <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12, whiteSpace: 'nowrap' }}>
                          <input type={newQuestion.question_type === 'single_choice' ? 'radio' : 'checkbox'} name="correct-answer"
                            checked={newQuestion.correct.includes(idx)} onChange={() => setNewQuestion((v) => ({ ...v, correct: v.question_type === 'single_choice' ? [idx] : (v.correct.includes(idx) ? v.correct.filter((n) => n !== idx) : [...v.correct, idx]) }))} /> Correct
                        </label>}
                      </div>
                    ))}
                    <button className="rr-link-btn" onClick={() => setNewQuestion((v) => ({ ...v, options: [...v.options, ''], imageUrls: [...v.imageUrls, ''] }))}>+ Add option</button>
                  </div>
                )}
                {newQuestion.question_type === 'image_click' && (
                  <div style={{ marginBottom: 8 }}>
                    <input className="rr-input" style={{ width: '100%' }} placeholder="Image URL guests will tap on" value={newQuestion.boardImage}
                      onChange={(e) => setNewQuestion((v) => ({ ...v, boardImage: e.target.value }))} />
                  </div>
                )}
                {newQuestion.question_type === 'quadrant' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                    <input className="rr-input" placeholder="X axis — left label" value={newQuestion.axisLabels.x_label_low}
                      onChange={(e) => setNewQuestion((v) => ({ ...v, axisLabels: { ...v.axisLabels, x_label_low: e.target.value } }))} />
                    <input className="rr-input" placeholder="X axis — right label" value={newQuestion.axisLabels.x_label_high}
                      onChange={(e) => setNewQuestion((v) => ({ ...v, axisLabels: { ...v.axisLabels, x_label_high: e.target.value } }))} />
                    <input className="rr-input" placeholder="Y axis — bottom label" value={newQuestion.axisLabels.y_label_low}
                      onChange={(e) => setNewQuestion((v) => ({ ...v, axisLabels: { ...v.axisLabels, y_label_low: e.target.value } }))} />
                    <input className="rr-input" placeholder="Y axis — top label" value={newQuestion.axisLabels.y_label_high}
                      onChange={(e) => setNewQuestion((v) => ({ ...v, axisLabels: { ...v.axisLabels, y_label_high: e.target.value } }))} />
                  </div>
                )}
                {selected.type === 'quiz' && ['single_choice', 'multiple_choice', 'true_false', 'yes_no'].includes(newQuestion.question_type) && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}><label className="rd-field-label">Points<input className="rr-input" type="number" min="0" max="1000000" value={newQuestion.points} onChange={(event) => setNewQuestion((value) => ({ ...value, points: event.target.value }))}/></label><label className="rd-field-label">Timer (seconds)<input className="rr-input" type="number" min="1" value={newQuestion.time_limit_seconds} onChange={(event) => setNewQuestion((value) => ({ ...value, time_limit_seconds: event.target.value }))} placeholder="No timer"/></label><label className="rd-field-label">Scoring<select className="rr-select" value={newQuestion.scoring_strategy} onChange={(event) => setNewQuestion((value) => ({ ...value, scoring_strategy: event.target.value }))}><option value="fixed">Fixed points</option><option value="time_weighted">Time weighted</option><option value="no_speed_bonus">No speed bonus</option><option value="partial">Partial points</option></select></label></div>}
                {['true_false', 'yes_no'].includes(newQuestion.question_type) && selected.type === 'quiz' && (
                  <div style={{ display: 'flex', gap: 12, marginBottom: 8, fontSize: 12 }}>
                    {(newQuestion.question_type === 'true_false' ? ['True', 'False'] : ['Yes', 'No']).map((label, idx) => (
                      <label key={label}><input type="radio" name="correct-answer" checked={newQuestion.correct.includes(idx)} onChange={() => setNewQuestion((v) => ({ ...v, correct: [idx] }))} /> {label} is correct</label>
                    ))}
                  </div>
                )}
                <button className="rr-btn primary" disabled={busy || !newQuestion.prompt.trim()} onClick={addQuestion}>{busy ? 'Adding…' : 'Add Question'}</button>
              </div>
                </>
              )}

              {selected.type === 'q_and_a' && (
                <div>
                  <h4 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '.05em', color: '#5b6a5c', margin: '0 0 10px' }}>Q&A moderation</h4>
                  {qnaItems === null ? <p className="rd-hint">Loading…</p> : qnaItems.length === 0 ? (
                    <p className="rd-hint">No questions submitted yet.</p>
                  ) : qnaItems.map((q) => (
                    <div key={q.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--rr-line, #eee)' }}>
                      <div style={{ fontWeight: 700, fontSize: 13.5 }}>{q.text}</div>
                      <div style={{ fontSize: 11.5, color: '#5b6a5c', marginBottom: 6 }}>{q.upvote_count} upvotes · {q.status}</div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="rr-link-btn" disabled={busy} onClick={() => moderateQna(q.id, 'featured')}>Feature</button>
                        <button className="rr-link-btn" disabled={busy} onClick={() => moderateQna(q.id, 'answered')}>Answered</button>
                        <button className="rr-link-btn gr-danger-link" disabled={busy} onClick={() => moderateQna(q.id, 'dismissed')}>Dismiss</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {selected.type !== 'q_and_a' && selected.questions.length >= 2 && ['draft', 'scheduled'].includes(selected.status) && (
                <div style={{ marginTop: 18, padding: 14, background: '#f7f6f0', borderRadius: 10 }}>
                  <h4 style={{ margin: '0 0 10px' }}>Conditional branching</h4>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <select className="rr-select" aria-label="Branch source question" value={newRule.source_question_id} onChange={(e) => setNewRule((v) => ({ ...v, source_question_id: e.target.value }))}><option value="">If question…</option>{selected.questions.map((q) => <option key={q.id} value={q.id}>{q.prompt}</option>)}</select>
                    <select className="rr-select" aria-label="Branch condition" value={newRule.operator} onChange={(e) => setNewRule((v) => ({ ...v, operator: e.target.value }))}>{['equals', 'not_equals', 'greater_than', 'less_than', 'contains', 'answered', 'not_answered'].map((op) => <option key={op} value={op}>{op.replace('_', ' ')}</option>)}</select>
                    {!['answered', 'not_answered'].includes(newRule.operator) && <input className="rr-input" style={{ width: 130 }} placeholder="Value" value={newRule.comparison_value} onChange={(e) => setNewRule((v) => ({ ...v, comparison_value: e.target.value }))} />}
                    <select className="rr-select" aria-label="Branch target question" value={newRule.target_question_id} onChange={(e) => setNewRule((v) => ({ ...v, target_question_id: e.target.value }))}><option value="">Then question…</option>{selected.questions.map((q) => <option key={q.id} value={q.id}>{q.prompt}</option>)}</select>
                    <select className="rr-select" aria-label="Branch action" value={newRule.action} onChange={(e) => setNewRule((v) => ({ ...v, action: e.target.value }))}><option value="show">Show</option><option value="hide">Hide</option></select>
                    <button className="rr-btn primary" disabled={busy} onClick={createRule}>Add rule</button>
                  </div>
                  {rules.map((rule) => <div key={rule.id} style={{ marginTop: 8, fontSize: 12 }}>Rule: {rule.operator} → {rule.action} <button className="rr-link-btn gr-danger-link" onClick={async () => { await api.liveDeleteRule(eventId, rule.id); setRules(await api.liveRules(eventId, selected.id)) }}>Remove</button></div>)}
                </div>
              )}

              {results && ['survey', 'feedback'].includes(selected.type) && (
                <div style={{ marginTop: 20 }}>
                  <button className="rr-btn primary" onClick={() => setAnalyticsOverlayOpen(true)}>Open Engagement Analytics →</button>
                </div>
              )}

              {results && !['survey', 'feedback'].includes(selected.type) && (
                <div style={{ marginTop: 20 }}>
                  <h4 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '.05em', color: '#5b6a5c', margin: '0 0 10px' }}>
                    Results — {results.participant_count} participants, {results.response_count} responses
                  </h4>
                  {leaderboard && leaderboard.length > 0 && (
                    <div style={{ marginBottom: 16, padding: 12, background: '#f7f6f0', borderRadius: 10 }}>
                      <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', color: '#5b6a5c', marginBottom: 6 }}>Leaderboard</div>
                      {leaderboard.map((e) => (
                        <div key={e.participant_id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700, padding: '3px 0' }}>
                          <span>#{e.rank} {e.display_name}</span><span>{e.score} pts</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {results.questions.map((qr) => (
                    <div key={qr.question_id} style={{ marginBottom: 14 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{qr.prompt}</div>
                      <div style={{ fontSize: 12, color: '#5b6a5c' }}>{qr.response_count} responses{qr.average_rating != null ? ` · avg ${qr.average_rating.toFixed(1)}` : ''}</div>
                      {Object.keys(qr.option_counts).length > 0 && (
                        <div style={{ marginTop: 4, fontSize: 12, color: '#5b6a5c' }}>
                          {Object.entries(qr.option_counts).map(([optId, count]) => <div key={optId}>{selected.questions.find((question) => question.id === qr.question_id)?.options.find((option) => option.id === optId)?.label || 'Option'}: {count}</div>)}
                        </div>
                      )}
                      {Object.keys(qr.ranking_scores || {}).length > 0 && <div style={{ marginTop: 4, fontSize: 12, color: '#5b6a5c' }}>{Object.entries(qr.ranking_scores).sort((left, right) => right[1] - left[1]).map(([optionId, score], rank) => <div key={optionId}>#{rank + 1} {selected.questions.find((question) => question.id === qr.question_id)?.options.find((option) => option.id === optionId)?.label || 'Option'} · {score} ranking points</div>)}</div>}
                      {TEXT_QUESTION_TYPES.has(qr.question_type) && (
                        <div style={{ marginTop: 6 }}>
                          <button className="rr-link-btn" onClick={() => viewWordCloud(qr.question_id)}>View word cloud</button>
                          {wordClouds[qr.question_id] && (
                            <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                              {wordClouds[qr.question_id].length === 0 ? <span className="rd-hint">No words yet.</span> : wordClouds[qr.question_id].map((w) => (
                                <span key={w.word} style={{ fontSize: 11 + Math.min(w.count, 6) * 2, fontWeight: 700, color: 'var(--rr-brand, #0b3b2e)' }}>{w.word}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      {TEXT_QUESTION_TYPES.has(qr.question_type) && qr.question_type !== 'word_cloud' && (
                        <div style={{ marginTop: 6 }}>
                          <button className="rr-link-btn" disabled={aiBusy === qr.question_id} onClick={() => runAiAnalysis(qr.question_id)}>
                            {aiBusy === qr.question_id ? 'Analyzing…' : 'AI summary'}
                          </button>
                          {aiAnalyses[qr.question_id] && (
                            <div style={{ marginTop: 6, padding: 10, background: '#f7f6f0', borderRadius: 8, fontSize: 12.5 }}>
                              <div>{aiAnalyses[qr.question_id].summary}</div>
                              {aiAnalyses[qr.question_id].themes.length > 0 && (
                                <div style={{ marginTop: 6, color: '#5b6a5c' }}>Themes: {aiAnalyses[qr.question_id].themes.join(', ')}</div>
                              )}
                              {aiAnalyses[qr.question_id].sentiment && (
                                <div style={{ marginTop: 2, color: '#5b6a5c', textTransform: 'capitalize' }}>Sentiment: {aiAnalyses[qr.question_id].sentiment}</div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  {responseDetails?.length > 0 && <div style={{ marginTop: 18 }}><h4 style={{ marginBottom: 8 }}>Individual responses</h4><div style={{ maxHeight: 360, overflow: 'auto', border: '1px solid var(--rr-line, #eee)', borderRadius: 10 }}>{responseDetails.map((response) => <div key={response.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, .8fr) minmax(180px, 1.4fr) minmax(160px, 1fr)', gap: 10, padding: 10, borderBottom: '1px solid var(--rr-line, #eee)', fontSize: 12 }}><strong>{response.participant}</strong><span>{response.question_prompt}</span><span>{response.selected_options?.length ? response.selected_options.join(' → ') : String(response.answer_value ?? '—')}</span></div>)}</div></div>}
                </div>
              )}
              {selected.type !== 'q_and_a' && moderationItems && <div style={{ marginTop: 20, padding: 14, background: '#f7f6f0', borderRadius: 10 }}><h4 style={{ margin: '0 0 4px' }}>Public text moderation</h4><p className="rd-hint">Only approved text can appear on projectors, public word clouds, or AI insight scenes.</p>{moderationItems.length === 0 ? <p className="rd-hint">No text submissions to review.</p> : moderationItems.map((item) => <div key={item.id} style={{ padding: '10px 0', borderTop: '1px solid var(--rr-line, #e8e4d8)' }}><div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}><strong style={{ flex: 1, fontSize: 13 }}>{item.content}</strong><StatusChip status={item.status}/></div>{item.flagged && <div style={{ color: '#a3271e', fontSize: 11.5, marginTop: 3 }}>Flagged: {item.flag_reason}</div>}{item.status === 'pending' ? <div style={{ display: 'flex', gap: 8, marginTop: 7 }}><button className="rr-link-btn" disabled={busy} onClick={() => moderateText(item.id, 'approved')}>Approve</button><button className="rr-link-btn gr-danger-link" disabled={busy} onClick={() => moderateText(item.id, 'rejected')}>Reject from public display</button></div> : <div style={{ display: 'flex', gap: 8, marginTop: 7, alignItems: 'center' }}><span className="rd-hint" style={{ fontSize: 11.5 }}>{item.status === 'approved' ? "Already approved — didn't need review, or you approved it." : 'Already rejected — hidden from public display.'}</span><button className="rr-link-btn" disabled={busy} onClick={() => moderateText(item.id, item.status === 'approved' ? 'rejected' : 'approved')}>{item.status === 'approved' ? 'Reject instead' : 'Approve instead'}</button></div>}</div>)}</div>}
            </div>
          </div>
        </div>
      )}

      {tab === 'Question Bank' && (
        <div className="rr-panel fl-section-panel">
          <div className="rd-panel-head"><div><span className="fl-eyebrow">Reusable content library</span><h3>Question Bank</h3><p>Create once, organize, and reuse across events and activities.</p></div><div style={{ display: 'flex', gap: 8 }}><input ref={bankFileRef} type="file" accept=".csv,text/csv" hidden onChange={(event) => importQuestionBankCsv(event.target.files?.[0])}/><button className="rr-btn secondary" disabled={busy} onClick={() => bankFileRef.current?.click()}>Import CSV</button><button className="rr-btn secondary" disabled={!bank?.length} onClick={exportQuestionBankCsv}>Export CSV</button></div></div>
          <div className="rd-panel-body">
            <div style={{ padding: 14, background: '#f7f6f0', borderRadius: 10, marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                <select className="rr-select" aria-label="Question bank item type" value={newBankItem.question_type} onChange={(e) => setNewBankItem((v) => ({ ...v, question_type: e.target.value }))}>
                  {QUESTION_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <input className="rr-input" style={{ flex: 1, minWidth: 200 }} placeholder="Question prompt" value={newBankItem.prompt} onChange={(e) => setNewBankItem((v) => ({ ...v, prompt: e.target.value }))} />
                <input className="rr-input" style={{ minWidth: 150 }} placeholder="Category" value={newBankItem.category} onChange={(event) => setNewBankItem((value) => ({ ...value, category: event.target.value }))}/>
                <input className="rr-input" style={{ minWidth: 180 }} placeholder="Tags, comma separated" value={newBankItem.tags} onChange={(event) => setNewBankItem((value) => ({ ...value, tags: event.target.value }))}/>
              </div>
              {['single_choice', 'multiple_choice'].includes(newBankItem.question_type) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                  {newBankItem.options.map((opt, idx) => (
                    <input key={idx} className="rr-input" placeholder={`Option ${idx + 1}`} value={opt}
                      onChange={(e) => setNewBankItem((v) => ({ ...v, options: v.options.map((o, i2) => i2 === idx ? e.target.value : o) }))} />
                  ))}
                  <button className="rr-link-btn" onClick={() => setNewBankItem((v) => ({ ...v, options: [...v.options, ''] }))}>+ Add option</button>
                </div>
              )}
              <button className="rr-btn primary" disabled={busy || !newBankItem.prompt.trim()} onClick={createBankItem}>{busy ? 'Saving…' : '+ New Question'}</button>
              {bankImportStatus && <span style={{ marginLeft: 10, color: '#1f8a5f', fontSize: 12, fontWeight: 700 }}>{bankImportStatus}</span>}
              <p className="rd-hint" style={{ marginTop: 8 }}>CSV columns: prompt, question_type, description, category, tags, options, correct_options. Separate tags and options with |.</p>
            </div>
            <input className="rr-input" style={{ marginBottom: 12 }} placeholder="Search question bank" value={bankSearch} onChange={(e) => setBankSearch(e.target.value)} />
            {bank === null ? <p className="rd-hint">Loading…</p> : bank.length === 0 ? (
              <p className="rd-hint">No saved questions yet.</p>
            ) : bank.filter((item) => item.prompt.toLowerCase().includes(bankSearch.toLowerCase())).map((item) => (
              <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--rr-line, #eee)' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{item.prompt}</div>
                  <div style={{ fontSize: 11.5, color: '#5b6a5c' }}>{item.question_type.replace('_', ' ')}{item.category ? ` · ${item.category}` : ''} · used {item.usage_count}x{item.tags?.length ? ` · ${item.tags.join(', ')}` : ''}</div>
                </div>
                {selected && <button className="rr-btn" disabled={busy} onClick={() => importFromBank(item.id)}>Import</button>}
                <button className="rr-link-btn" disabled={busy} onClick={async () => { await api.liveDuplicateBankItem(eventId, item.id); await loadBank() }}>Duplicate</button>
                <button className="rr-link-btn gr-danger-link" disabled={busy} onClick={async () => { await api.liveDeleteBankItem(eventId, item.id); await loadBank() }}>Archive</button>
              </div>
            ))}
            {!selected && <p className="rd-hint" style={{ marginTop: 8 }}>Open an activity from the Activities tab to import a question into it.</p>}
          </div>
        </div>
      )}

      {tab === 'Live Control' && (
        <div className="rr-panel fl-section-panel">
          <div className="rd-panel-head"><div><span className="fl-eyebrow">Pressure-ready control room</span><h3>Live Control</h3><p>See every live room and jump into presenter controls instantly.</p></div><span className="fl-realtime">● Realtime</span></div>
          <div className="rd-panel-body">
            {suggestedActivity && <div className="fl-program-cue"><span>✦ PROGRAM CUE</span><div><strong>{currentProgramSession.title} is happening now</strong><small>{suggestedActivity.title} is ready.{suggestedActivity.config?.auto_start_enabled ? ' Auto-start is on — it will go live on its own any moment.' : ' Festio will never start it automatically.'}</small></div><button className="rr-btn secondary" onClick={async () => { await openActivity(suggestedActivity.id); setTab('Activities') }}>Review and start manually →</button></div>}
            {visibleActivities.some((a) => a.status === 'live') && (() => { const current = visibleActivities.find((a) => a.status === 'live' && a.response_count > 0) || visibleActivities.find((a) => a.status === 'live'); const rate = current.participant_count ? Math.min(100, Math.round((current.response_count / current.participant_count) * 100)) : 0; return <div className="fl-control-hero"><div><span>● LIVE NOW · {String(current.type).replaceAll('_', ' ')}</span><h2>{current.title}</h2><div><b>{current.participant_count || 0}<small>participants</small></b><b>{current.response_count || 0}<small>responses</small></b><b>{rate}%<small>response rate</small></b></div></div><button onClick={async () => { await openActivity(current.id); setTab('Activities') }}>Open live controls →</button></div> })()}
            {visibleActivities.filter((a) => !['completed', 'archived'].includes(a.status)).map((a) => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--rr-line, #eee)' }}>
                <div style={{ flex: 1 }}><strong>{a.title}</strong><div className="rd-hint">{programSessionById.get(a.session_id)?.title || 'Event-wide'} · {a.participant_count} participants · {a.response_count} responses</div></div>
                <StatusChip status={a.status} />
                <button className="rr-btn primary" onClick={async () => { await openActivity(a.id); setTab('Activities') }}>Open controls</button>
              </div>
            ))}
            {visibleActivities.length === 0 && <p className="rd-hint">No activities match this program session.</p>}
          </div>
        </div>
      )}

      {tab === 'Displays' && (
        <div className="rr-panel fl-section-panel fl-displays-panel">
          <div className="rd-panel-head"><div><span className="fl-eyebrow">Scene manager · 22 presentation styles</span><h3>Festio Broadcast</h3><p>Direct every projector, TV, and LED wall independently in realtime.</p></div><button className="rr-btn primary" disabled={busy} onClick={createDisplay}>+ Add display</button></div>
          <div className="rd-panel-body">
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, maxWidth: 520 }}><input className="rr-input" aria-label="New display name" placeholder="Main stage, lobby, breakout room…" value={newDisplayName} onChange={(e) => setNewDisplayName(e.target.value)} /></div>
            <div className="fl-display-grid">{visibleDisplays.map((display) => <DisplayCard key={display.id} display={display} eventId={eventId} activities={activities || []} programSessions={programSessions || []} busy={busy} onUpdate={updateDisplay} onDelete={deleteDisplay} onPresentResults={presentDisplayResults} onRehearsal={setDisplayRehearsal}/>)}</div>
            {visibleDisplays.length === 0 && <p className="rd-hint">No displays match this program session. Create one or assign an existing display to the session.</p>}
          </div>
        </div>
      )}

      {tab === 'Responses' && (
        <div className="rr-panel fl-section-panel">
          <div className="rd-panel-head"><div><span className="fl-eyebrow">Response explorer</span><h3>Responses</h3><p>Search, review, and export audience input by activity.</p></div><strong>{visibleActivities.reduce((sum, a) => sum + (a.response_count || 0), 0).toLocaleString()} total</strong></div>
          <div className="rd-panel-body">
            {visibleActivities.map((a) => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--rr-line, #eee)' }}>
                <div style={{ flex: 1 }}><strong>{a.title}</strong><div className="rd-hint">{programSessionById.get(a.session_id)?.title || 'Event-wide'} · {a.participant_count} participants</div></div>
                <strong>{a.response_count} responses</strong>
                <button className="rr-btn secondary" onClick={() => api.liveDownloadExport(eventId, a.id, a.title).catch((e) => setError(e.message))}>Export CSV</button>
                <button className="rr-btn secondary" onClick={async () => { setError(''); try { const [full, data, details, moderation, activityRules] = await Promise.all([api.liveGetActivity(eventId, a.id), api.liveResults(eventId, a.id), api.liveResponseDetails(eventId, a.id), a.type === 'q_and_a' ? Promise.resolve([]) : api.liveModerationItems(eventId, a.id), ['survey', 'feedback'].includes(a.type) ? api.liveRules(eventId, a.id) : Promise.resolve([])]); setSelected(full); setResults(data); setResponseDetails(details); setModerationItems(moderation); setRules(activityRules); setTab('Activities') } catch (e) { setError(e.message) } }}>Review</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'Analytics' && (
        <div className="rr-panel fl-section-panel">
          <div className="rd-panel-head"><div><span className="fl-eyebrow">Event performance</span><h3>Engagement Analytics</h3><p>Understand participation, completion, and audience momentum.</p></div><button className="rr-btn secondary" onClick={() => api.liveDownloadEventReport(eventId).catch((e) => setError(e.message))}>Download report</button></div>
          <div className="rd-panel-body fl-analytics-grid">
            {[
              ['Activities', visibleActivities.length],
              ['Live now', visibleActivities.filter((a) => a.status === 'live').length],
              ['Participants', visibleActivities.reduce((sum, a) => sum + a.participant_count, 0)],
              ['Responses', visibleActivities.reduce((sum, a) => sum + a.response_count, 0)],
            ].map(([label, value], index) => <MetricCard key={label} label={label} value={value.toLocaleString()} note={index === 0 ? (programFilter ? 'In this program scope' : 'Across this event') : index === 1 ? 'Updating in realtime' : 'Visible live activities'} tone={['copper', 'mint', 'violet', 'coral'][index]} icon={['✦', '●', '◌', '↗'][index]} />)}
          </div>
          <div className="fl-analytics-detail"><div><h3>Engagement by activity</h3>{visibleActivities.slice(0, 6).map((a) => { const pct = a.type === 'q_and_a' ? (a.participant_count ? 100 : 0) : a.participant_count ? Math.min(100, Math.round((a.response_count / a.participant_count) * 100)) : 0; return <div className="fl-progress-row" key={a.id}><span><b>{a.title}</b><small>{programSessionById.get(a.session_id)?.title || 'Event-wide'} · {a.participant_count || 0} participants</small></span><i><em style={{ width: `${pct}%` }} /></i><strong>{pct}%</strong></div> })}</div><div className="fl-insight-card"><span>✦ FESTIO INTELLIGENCE</span><h3>Audience insight</h3><p>{visibleActivities.length ? `This view has collected ${visibleActivities.reduce((sum, a) => sum + (a.response_count || 0), 0).toLocaleString()} responses across ${visibleActivities.length} activities. Open any text response set to generate themes, sentiment, and an executive summary.` : 'Create or link an activity to begin building a realtime picture of audience interests and sentiment.'}</p><button onClick={() => setTab('Responses')}>Explore responses →</button></div></div>
        </div>
      )}

      {tab === 'Settings' && <section className="fl-settings-head"><div><span className="fl-eyebrow">Event defaults</span><h2>Festio Live Settings</h2><p>Choose safe defaults for new activities. Individual activities can override them.</p></div><button className="rr-btn primary" disabled={busy} onClick={saveLiveDefaults}>{busy ? 'Saving…' : settingsSaved ? '✓ Saved' : 'Save changes'}</button></section>}

      {tab === 'Settings' && <div className="fl-settings-grid">
        <section className="fl-card"><header><div><h3>Participation</h3><p>How guests enter and respond</p></div></header><div className="fl-setting-list">
          {[['guest_hub_participation', 'Guest Hub participation', 'Use existing guest identity and event context'], ['broadcast_join_enabled', 'Broadcast join link', 'Allow room-wide QR participation'], ['allow_answer_changes', 'Answer changes', 'Allow changes while a question remains open']].map(([key, label, note]) => <button key={key} className="fl-setting-row" onClick={() => { setSettingsSaved(false); setLiveDefaults((value) => ({ ...value, [key]: !value[key] })) }}><span><b>{label}</b><small>{note}</small></span><i className={liveDefaults[key] ? 'on' : ''}><em /></i></button>)}
        </div></section>
        <section className="fl-card"><header><div><h3>Safety &amp; privacy</h3><p>Public content guardrails</p></div></header><div className="fl-setting-list">
          {[['moderation_enabled', 'Moderate public text', 'Review Q&A, feedback, and words before display'], ['profanity_filtering', 'Profanity filtering', 'Flag potentially unsafe submissions']].map(([key, label, note]) => <button key={key} className="fl-setting-row" onClick={() => { setSettingsSaved(false); setLiveDefaults((value) => ({ ...value, [key]: !value[key] })) }}><span><b>{label}</b><small>{note}</small></span><i className={liveDefaults[key] ? 'on' : ''}><em /></i></button>)}
          <label className="fl-select-setting"><span>Leaderboard names</span><select className="rr-select" value={liveDefaults.leaderboard_name_style} onChange={(e) => { setSettingsSaved(false); setLiveDefaults((value) => ({ ...value, leaderboard_name_style: e.target.value })) }}><option value="first_last_initial">First name + last initial</option><option value="first_name">First name only</option><option value="anonymous_alias">Anonymous aliases</option></select></label>
        </div></section>
      </div>}

      {tab === 'Settings' && (
        <div className="rr-panel fl-section-panel" style={{ marginBottom: 18 }}>
          <div className="rd-panel-head"><h3>Broadcast Join</h3><p>Let a whole room join without a personal Guest Hub link</p></div>
          <div className="rd-panel-body">
            <p className="rd-hint" style={{ marginBottom: 14 }}>
              Guests normally reach Festio Live through their own Guest Hub — no setup needed. For a keynote or
              conference session where you'd rather put one link or QR code on screen, this join link works for
              anyone, no guest record required. It always shows whatever's live right now.
            </p>
            <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <img src={api.liveJoinQrUrl(eventId)} alt="QR code to join Festio Live" width={140} height={140}
                style={{ border: '1px solid var(--rr-line, #e6e2d3)', borderRadius: 10 }} />
              <div style={{ flex: 1, minWidth: 220 }}>
                <label className="rd-field-label">Join code</label>
                <div style={{ fontSize: 34, fontWeight: 900, letterSpacing: '.18em', color: '#6d28d9', margin: '3px 0 14px' }}>{joinInfo?.code || '••••••'}</div>
                <label className="rd-field-label">Join link</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input className="rr-input" aria-label="Festio Live guest join link" readOnly value={joinInfo?.url || 'Creating short link…'} style={{ flex: 1, fontSize: 12 }} onFocus={(e) => e.target.select()} />
                  <button className="rr-btn secondary" disabled={!joinInfo?.url} onClick={() => navigator.clipboard?.writeText(joinInfo.url)}>Copy</button>
                </div>
                <p className="rd-hint" style={{ marginTop: 8 }}>
                  Anonymous participants show up as "Guest" (or whatever name they type in) on results and the leaderboard.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'Settings' && (
        <div className="rr-panel fl-section-panel">
          <div className="rd-panel-head"><h3>Share Links</h3><p>Hand off Live Control or Q&A moderation without a Festio login</p></div>
          <div className="rd-panel-body">
            <p className="rd-hint" style={{ marginBottom: 14 }}>
              A Presenter link can go live/pause/close activities and advance questions from any phone or laptop.
              A Moderator link can feature, mark answered, or dismiss Q&A submissions. Neither can edit activities,
              questions, or delete anything — that stays admin-only in the Activities tab.
            </p>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div>
                <label className="rd-field-label">Role</label>
                <select className="rr-select" aria-label="Share link role" value={shareRole} onChange={(e) => setShareRole(e.target.value)}>
                  <option value="presenter">Presenter</option>
                  <option value="moderator">Moderator</option>
                  <option value="analyst">Analyst (read-only)</option>
                </select>
              </div>
              <div>
                <label className="rd-field-label">Expires in (hours)</label>
                <input className="rr-input" aria-label="Share link expiry in hours" type="number" min={1} max={48} style={{ width: 90 }} value={shareHours} onChange={(e) => setShareHours(e.target.value)} />
              </div>
              <button className="rr-btn primary" disabled={shareBusy} onClick={generateShareLink}>{shareBusy ? 'Generating…' : 'Generate Link'}</button>
            </div>
            {shareLinks.map((l, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--rr-line, #eee)' }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#5b6a5c', width: 90 }}>{l.role}</span>
                <input className="rr-input" readOnly value={l.url} style={{ flex: 1, fontSize: 12 }} onFocus={(e) => e.target.select()} />
                <button className="rr-link-btn" onClick={() => navigator.clipboard?.writeText(l.url)}>Copy</button>
              </div>
            ))}
            <p className="rd-hint" style={{ marginTop: 16 }}>
              Each activity also has its own TV/projector display link — open an activity in the Activities tab and use
              "Copy TV Display Link". That link never expires and needs no login; it's meant to stay open on one screen for the event.
            </p>
          </div>
        </div>
      )}

      {tab === 'Help' && (
        <div style={{ display: 'grid', gap: 18 }}>
          <div className="rr-panel fl-section-panel">
            <div className="rd-panel-head"><div><span className="fl-eyebrow">How it works</span><h3>Running one activity</h3><p>Create it, send it live, guests answer on their phone, results show up everywhere at once.</p></div></div>
            <div className="rd-panel-body">
              <div className="fl-help-steps">
                <div className="fl-help-step"><b>1</b><div><h4>Create the activity</h4><p>Pick a type — poll, quiz, rating, word cloud, ranking, Q&amp;A, quadrant, or image click — write the prompt, add options if it needs them.</p><span className="fl-help-where">Activities → + New activity</span></div></div>
                <div className="fl-help-step"><b>2</b><div><h4>Link it to a program session — if it belongs to one</h4><p>Scopes it so guests only see it during that session, and it's what auto-close and auto-start key off. Skip this for anything meant to run all event.</p><span className="fl-help-where">Edit details → Experience program session</span></div></div>
                <div className="fl-help-step"><b>3</b><div><h4>Send it live</h4><p>Press Go Live yourself, or turn on Auto-start beforehand so it opens the instant the linked session's scheduled time arrives.</p><span className="fl-help-where">Activity detail → Go Live · or Edit details → Auto-start</span></div></div>
                <div className="fl-help-step"><b>4</b><div><h4>Guests join and answer</h4><p>They scan the QR code, tap the join code, or use their personal Guest Hub link — straight to the activity, no app, no account.</p><span className="fl-help-where">Displays → join scene, or shared from Guest Hub</span></div></div>
                <div className="fl-help-step"><b>5</b><div><h4>Watch it fill in live</h4><p>Participant count, response count, and response rate update in real time as answers come in.</p><span className="fl-help-where">Live Control</span></div></div>
                <div className="fl-help-step"><b>6</b><div><h4>Put it on the big screen</h4><p>Assign the activity to a display and pick a scene — results bars, a donut chart, the leaderboard, a word cloud, a heatmap. Copy the TV link once and leave it running.</p><span className="fl-help-where">Displays → Broadcast studio</span></div></div>
                <div className="fl-help-step"><b>7</b><div><h4>Reveal, review, and wrap up</h4><p>Show one result or every question together, freeze the final numbers, and let participants review the revealed results on their phones. Close manually, or leave Auto-close on.</p><span className="fl-help-where">Displays → Results &amp; rehearsal · Activity detail → Preview participant review</span></div></div>
              </div>
            </div>
          </div>

          <div className="rr-panel fl-section-panel">
            <div className="rd-panel-head"><div><span className="fl-eyebrow">A strong opening sequence</span><h3>Formal opening / joint session playbook</h3><p>Keep ceremonial moments respectful while giving the room a few short, memorable ways to participate.</p></div><span className="fl-help-duration">8–12 min total</span></div>
            <div className="rd-panel-body">
              <div className="fl-help-runofshow">
                <article><b>Before start</b><span>JOIN / QR</span><h4>Welcome the room</h4><p>Leave the join code and QR on screen while guests arrive. Ask everyone to join once; the same link follows the live activity.</p><small>5–10 minutes before</small></article>
                <article><b>Opening</b><span>WORD CLOUD</span><h4>One shared intention</h4><p>“In one word, what do you hope this summit creates for our community?”</p><small>60–90 seconds</small></article>
                <article><b>After welcome</b><span>POLL / VOTING</span><h4>Take the room's pulse</h4><p>“Which outcome should guide this summit most?” Keep it to four clear options and reveal the result immediately.</p><small>90 seconds</small></article>
                <article><b>During speakers</b><span>MODERATED Q&amp;A</span><h4>Collect questions quietly</h4><p>Guests submit and upvote without interrupting the program. A moderator approves and features the best questions.</p><small>Open throughout</small></article>
                <article><b>Closing</b><span>COMMITMENT + RESULTS</span><h4>Turn inspiration into action</h4><p>Ask for one action each person will take, then show All results as the session's visual recap.</p><small>2–3 minutes</small></article>
              </div>
              <div className="fl-help-tip"><b>Keep it focused:</b> for a formal opening, use one word cloud, one poll, and moderated Q&amp;A as the core. Save a competitive quiz or leaderboard for a later energizer unless it fits the tone of the program.</div>
            </div>
          </div>

          <div className="rr-panel fl-section-panel">
            <div className="rd-panel-head"><div><span className="fl-eyebrow">Choose how hands-free it should be</span><h3>Three levels of automation</h3><p>You can automate the event schedule, the activity's question flow, and the final result pages independently.</p></div></div>
            <div className="rd-panel-body">
              <div className="fl-help-automation">
                <article><span>1</span><div><h4>Program timing</h4><p>Link the activity to an Experience session. Enable Auto-start and Auto-close only after its start time and duration are correct.</p><b>Activity → Edit details</b></div></article>
                <article><span>2</span><div><h4>Question flow</h4><p>Enable Full automation and set the duration of the join, question, participation, results, transition, and final slides. A presenter can still override instantly.</p><b>Activity → Full automation</b></div></article>
                <article><span>3</span><div><h4>Display and results</h4><p>Use Auto-follow program for a venue screen, then use All results with Auto-rotate when several result pages need to cycle.</p><b>Displays → Results &amp; rehearsal</b></div></article>
              </div>
              <div className="fl-help-tip"><b>Recommended first event:</b> use manual Go Live with automated question flow. Once the timing feels right in rehearsal, enable session Auto-start.</div>
            </div>
          </div>

          <div className="rr-panel fl-section-panel">
            <div className="rd-panel-head"><div><span className="fl-eyebrow">Rehearse the real room</span><h3>Four-screen control-room checklist</h3><p>Separate operating controls from what guests and the audience see.</p></div></div>
            <div className="rd-panel-body">
              <div className="fl-help-gallery fl-help-roles">
                <div className="fl-help-gcard"><span>1</span><h4>Admin laptop</h4><p>Create activities, edit questions, configure automation, assign displays, and monitor responses.</p><b>Festio Live admin</b></div>
                <div className="fl-help-gcard"><span>2</span><h4>Presenter phone</h4><p>Start, pause, advance, reveal results, freeze the screen, and return to the join slide.</p><b>Presenter share link</b></div>
                <div className="fl-help-gcard"><span>3</span><h4>Projector / TV</h4><p>Open the copied display link once, enter fullscreen, and leave the browser on that page.</p><b>Displays → Copy link</b></div>
                <div className="fl-help-gcard"><span>4</span><h4>Moderator device</h4><p>Approve public text and feature or dismiss Q&amp;A while the presenter stays focused on the room.</p><b>Moderator share link</b></div>
              </div>
              <div className="fl-help-checks"><span>□ Rehearse with 10 guests</span><span>□ Scan the real QR from a phone</span><span>□ Test projector fullscreen</span><span>□ Check question and result timing</span><span>□ Confirm moderation</span><span>□ End rehearsal before doors open</span></div>
            </div>
          </div>

          <div className="rr-panel fl-section-panel">
            <div className="rd-panel-head"><div><span className="fl-eyebrow">Before you link anything</span><h3>Experience is where the schedule lives</h3><p>Festio Live borrows its program from Experience — sessions, meals, prayers, breakouts, all as timed steps in a guest journey.</p></div></div>
            <div className="rd-panel-body">
              <div className="fl-help-bridge">
                <div className="fl-help-bcard"><span className="fl-help-bnum">1</span><h4>Mark a step as a session</h4><p>Open a step in Experience and switch on Live Program timing. Give it a start offset and duration.</p></div>
                <div className="fl-help-barrow" aria-hidden="true">→</div>
                <div className="fl-help-bcard"><span className="fl-help-bnum">2</span><h4>Publish the workflow</h4><p>A draft never reaches Festio Live — only a published workflow's timed steps sync over.</p></div>
                <div className="fl-help-barrow" aria-hidden="true">→</div>
                <div className="fl-help-bcard mint"><span className="fl-help-bnum">3</span><h4>Pick it in Festio Live</h4><p>It appears in Experience program session when you edit an activity — link it, and the two stay in sync.</p></div>
              </div>
              <p className="rd-hint">Right activity, right time — guests only ever see the activity for whatever session they're currently in, and Live Control lists activities in the order sessions actually happen, not the order they were created.</p>
            </div>
          </div>

          <div className="rr-panel fl-section-panel">
            <div className="rd-panel-head"><div><span className="fl-eyebrow">Pick the right shape</span><h3>Activity types</h3><p>Choose the activity for the moment, then choose question formats inside it.</p></div></div>
            <div className="rd-panel-body">
              <div className="fl-help-gallery">
                <div className="fl-help-gcard"><span>P</span><h4>Poll</h4><p>Quick single or multi-choice — a temperature check, no right answer.</p></div>
                <div className="fl-help-gcard"><span>Q</span><h4>Quiz</h4><p>Scored, timed, correct-answer questions with a live leaderboard.</p></div>
                <div className="fl-help-gcard"><span>S</span><h4>Survey</h4><p>Several question formats in one guided flow, with a combined final result.</p></div>
                <div className="fl-help-gcard"><span>★</span><h4>Rating</h4><p>5-star, 10-point, or NPS — how something landed, in one tap.</p></div>
                <div className="fl-help-gcard"><span>↗</span><h4>Feedback</h4><p>Structured and open-text reflections for post-session learning and analysis.</p></div>
                <div className="fl-help-gcard"><span>☁</span><h4>Word cloud</h4><p>One word each, sized by how often it's repeated.</p></div>
                <div className="fl-help-gcard"><span>?</span><h4>Q&amp;A</h4><p>Guests submit and upvote their own questions; you moderate and feature.</p></div>
                <div className="fl-help-gcard"><span>✓</span><h4>Live voting</h4><p>A clear decision moment with visible choices and an immediate room result.</p></div>
              </div>
              <p className="rd-hint">Inside surveys and other multi-question activities you can also use ranking, quadrant, open text, image click, rating, choice, and word-cloud question formats.</p>
            </div>
          </div>

          <div className="rr-panel fl-section-panel">
            <div className="rd-panel-head"><div><span className="fl-eyebrow">Two switches worth knowing</span><h3>Auto-close vs. auto-start</h3><p>Both only apply to session-linked activities — Festio has nothing to time itself against otherwise.</p></div></div>
            <div className="rd-panel-body">
              <div className="fl-help-compare">
                <div className="fl-help-tcard on"><span className="fl-help-tstate">● on by default</span><h4>Auto-close</h4><p>Closes itself about 20 minutes after the linked session's scheduled end.</p><p>Running long? Use Extend +30 min instead of turning it off.</p></div>
                <div className="fl-help-tcard"><span className="fl-help-tstate">○ off by default</span><h4>Auto-start</h4><p>Goes live the moment the linked session's scheduled start time arrives — nobody presses Go Live.</p><p>Turn it on per activity, in Edit details, once you trust the schedule.</p></div>
              </div>
            </div>
          </div>

          <div className="rr-panel fl-section-panel">
            <div className="rd-panel-head"><div><span className="fl-eyebrow">When something does not appear</span><h3>Fast troubleshooting</h3><p>Most event-day issues can be fixed without closing the display link.</p></div></div>
            <div className="rd-panel-body">
              <div className="fl-help-troubleshoot">
                <article><h4>The activity is missing</h4><p>Confirm the correct event and program filter, then check that the activity is not archived and is linked to the intended session.</p></article>
                <article><h4>The projector did not change</h4><p>In Displays, choose the activity and scene, then press Push to main screen. Use Repush if it is already selected.</p></article>
                <article><h4>Results are empty</h4><p>Confirm the question is active and guests submitted answers. Use Rehearse with 10 guests to verify the presentation safely.</p></article>
                <article><h4>Preview and live differ</h4><p>Preview is only a draft until you press Push to main screen. Open the copied display link to confirm what the venue actually sees.</p></article>
                <article><h4>Unsafe text is not visible</h4><p>Moderated or flagged words and Q&amp;A wait for staff approval before appearing publicly.</p></article>
                <article><h4>The schedule is wrong</h4><p>Correct the session time in Experience, publish the workflow, and verify the activity's linked session before using Auto-start.</p></article>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>

      {analyticsOverlayOpen && results && selected && ['survey', 'feedback'].includes(selected.type) && (
        <SurveyAnalyticsOverlay
          event={event} selected={selected} results={results}
          summary={visibleActivities.find((a) => a.id === selected.id)}
          aiAnalyses={aiAnalyses} aiBusy={aiBusy} runAiAnalysis={runAiAnalysis}
          responseDetails={responseDetails} rules={rules}
          onClose={() => setAnalyticsOverlayOpen(false)}
          onExportCsv={() => api.liveDownloadExport(eventId, selected.id, selected.title).catch((e) => setError(e.message))}
          onGenerateReport={() => api.liveDownloadExport(eventId, selected.id, selected.title).catch((e) => setError(e.message))}
          displayUrl={selected.short_code ? `/d/${selected.short_code}` : selected.config?.display_token ? `/live-display/${selected.id}?token=${selected.config.display_token}` : null}
        />
      )}
      {participantPreviewOpen && results && selected && <ParticipantReviewPreview activity={selected} results={results} onClose={() => setParticipantPreviewOpen(false)}/>}
    </RedesignShell>
  )
}
