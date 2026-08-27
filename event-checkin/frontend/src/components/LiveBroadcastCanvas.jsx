import { useEffect, useMemo, useState } from 'react'
import './LiveBroadcastCanvas.css'
import './LiveGuidedShow.css'
import { DonutChart, DonutLegend, Histogram, RatingDistribution, RankingChart, StarRating, ImageChoiceGrid, TrendLine, ScatterPlot, Heatmap } from './charts/LiveCharts'

const FALLBACK_WORDS = [
  ['inspiring', 12], ['community', 9], ['connected', 8], ['action', 7],
  ['together', 10], ['future', 6], ['powerful', 5], ['hopeful', 4],
]

const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)) }

function guidedScene(state) {
  const phase = state.display_config?.show_phase
  const current = state.questions?.find((q) => q.question_id === state.current_question_id)
  if (phase === 'lobby') return 'join'
  if (phase === 'intro') return 'welcome'
  if (phase === 'question_preview' || phase === 'locked') return 'question'
  if (phase === 'answering') {
    if (state.type === 'q_and_a') return 'q_and_a'
    if (current?.question_type === 'word_cloud' || state.type === 'word_cloud') return 'word_cloud'
    return 'responding'
  }
  if (phase === 'reveal') return current?.correct_option_ids?.length ? 'correct_answer' : 'results'
  if (phase === 'results') {
    if (['survey', 'feedback'].includes(state.type)) return 'survey_insights'
    if (state.type === 'q_and_a') return 'q_and_a'
    if (current?.question_type === 'word_cloud') return 'word_cloud'
    return 'results'
  }
  if (phase === 'leaderboard') return 'leaderboard'
  if (phase === 'complete') return 'celebration'
  return null
}

function resolveScene(requested, state, settings) {
  if (settings.control_mode === 'guided' && state.display_config?.show_mode === 'guided') {
    return guidedScene(state) || 'join'
  }
  if (!settings.follow_activity) return requested || 'welcome'
  if (state.display_config?.show_mode === 'guided') return guidedScene(state) || 'join'
  const current = state.questions?.find((q) => q.question_id === state.current_question_id)
  if (!current) return state.status === 'live' ? 'join' : 'welcome'
  if (current.live_state === 'open') return current.response_count ? 'responding' : 'question'
  if (current.live_state === 'results_visible') return current.question_type === 'word_cloud' ? 'word_cloud' : 'results'
  if (current.live_state === 'answer_revealed') return 'correct_answer'
  return 'question'
}

function useRegisteredCount(eventId, enabled) {
  const [registeredCount, setRegisteredCount] = useState(null)
  useEffect(() => {
    if (!enabled || !eventId) return undefined
    let cancelled = false
    fetch(`/api/events/${encodeURIComponent(eventId)}/live/registered-count`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => { if (!cancelled && data) setRegisteredCount(data.count) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [enabled, eventId])
  return registeredCount
}

function displayJoinCode(state, settings) {
  return state.live_join_code || settings.join_code || state.display_config?.join_code || 'FESTIO'
}

function Brand({ state, settings }) {
  const joinCode = displayJoinCode(state, settings)
  return <div className="flb-top">
    <div className="flb-brand"><span className="flb-mark">F</span>Festio Live</div>
    <div className="flb-event-name"><small>Live event</small><strong>{settings.event_name || state.display_config?.event_name || state.title}</strong></div>
    <div className="flb-join-dock">
      <img src={`/api/events/${encodeURIComponent(state.event_id || '')}/live/join-qr.png`} alt="QR code to join Festio Live"/>
      <div><small>Join live</small><strong>{joinCode}</strong><span>festio.events/live</span></div>
      <b>● {state.participant_count || 0} connected</b>
    </div>
  </div>
}

function RegisteredProgressBanner({ state }) {
  const mode = state.display_config?.registered_progress_mode
  const registeredCount = useRegisteredCount(state.event_id, mode === 'full' || mode === 'percent')
  if (!mode || mode === 'off' || !registeredCount) return null
  // Unique people who've responded -- not the count of individual question
  // answers, which for a 9-question survey would be up to 9x inflated.
  const responders = state.participant_count || 0
  const percent = Math.round((responders / registeredCount) * 100)
  return <div className="flb-progress-banner">
    {mode === 'full' && <span className="flb-progress-banner-count">{responders} of {registeredCount} guests responded</span>}
    <span className="flb-progress-banner-percent">{percent}%<small>of guests — add yours!</small></span>
  </div>
}

function Footer({ left, right, live = false }) {
  return <div className="flb-footer"><span>{left}</span>{right && <span className={`flb-pill ${live ? 'is-live' : ''}`}>{right}</span>}</div>
}

function Kicker({ children }) { return <div className="flb-kicker">{children}</div> }

function EmptyState({ title = 'Waiting for the presenter', copy = 'The next live moment will appear automatically.' }) {
  return <div className="flb-center"><Kicker>Festio Live</Kicker><h1 className="flb-headline flb-small">{title}</h1><p className="flb-subhead">{copy}</p></div>
}

function ResultsBars({ question }) {
  const options = Object.entries(question?.option_labels || {})
  const total = Math.max(1, Object.values(question?.option_counts || {}).reduce((sum, value) => sum + value, 0))
  return <div className="flb-results">{options.map(([id, label], index) => {
    const count = question.option_counts?.[id] || 0
    const percent = Math.round((count / total) * 100)
    return <div className="flb-result" key={id}>
      <span>{label}</span><div className="flb-bar"><i style={{ width: `${Math.max(3, percent)}%`, '--bar-index': index }}>{count || ''}</i></div><strong>{percent}%</strong>
    </div>
  })}</div>
}

const SINGLE_SELECT_TYPES = ['single_choice', 'true_false', 'yes_no']

function ResultsVisual({ question }) {
  const images = question?.option_images || {}
  const hasImages = Object.keys(images).length > 0
  const labels = question?.option_labels || {}

  if (question?.question_type === 'ranking') {
    const items = Object.entries(question.ranking_scores || {}).map(([id, score]) => ({ id, label: labels[id] || id, score }))
    return items.length ? <RankingChart items={items}/> : <ResultsBars question={question}/>
  }
  if (question?.question_type === 'number') {
    return question.numeric_values?.length ? <Histogram values={question.numeric_values}/> : <EmptyState title="Waiting on numeric answers"/>
  }
  if (question?.question_type === 'quadrant') {
    return question.points?.length ? <ScatterPlot points={question.points} labels={question.axis_labels}/> : <EmptyState title="Waiting on the room's picks"/>
  }
  if (['rating_5', 'rating_10', 'nps'].includes(question?.question_type)) {
    if (question.average_rating == null) return <EmptyState title="Waiting on the first rating"/>
    const scaleMax = question.question_type === 'rating_5' ? 5 : 10
    const scaleMin = question.question_type === 'nps' ? 0 : 1
    return <div className="flb-rating-results"><div className="flb-rating-average"><strong>{question.average_rating.toFixed(1)}</strong><span>average of {scaleMax}</span></div>{scaleMax === 5 ? <StarRating average={question.average_rating} max={5}/> : null}{Object.keys(question.value_counts || {}).length ? <RatingDistribution valueCounts={question.value_counts} max={scaleMax} min={scaleMin}/> : null}</div>
  }
  if (question?.question_type === 'image_click') {
    return question.points?.length ? <Heatmap points={question.points} image={question.board_image}/> : <EmptyState title="Waiting on the room's taps"/>
  }
  if (hasImages) {
    const items = Object.entries(labels).map(([id, label]) => ({ id, label, image: images[id], count: question.option_counts?.[id] || 0 }))
    return <ImageChoiceGrid items={items}/>
  }
  if (SINGLE_SELECT_TYPES.includes(question?.question_type)) {
    const segments = Object.entries(labels).map(([id, label]) => ({ id, label, value: question.option_counts?.[id] || 0 }))
    return <div className="flb-donut-row"><DonutChart segments={segments}/><DonutLegend segments={segments}/></div>
  }
  return <ResultsBars question={question}/>
}

function CompactAnswerSummary({ question }) {
  const labels = question?.option_labels || {}
  const hasOptions = Object.keys(labels).length > 0
  if (hasOptions) {
    const total = Math.max(1, Object.values(question.option_counts || {}).reduce((sum, value) => sum + value, 0))
    if (total <= 1 && !Object.values(question.option_counts || {}).some((count) => count > 0)) return <span className="flb-survey-waiting">No responses yet</span>
    return <div className="flb-survey-bars">{Object.entries(labels).map(([id, label]) => {
      const count = question.option_counts?.[id] || 0
      const percent = Math.round((count / total) * 100)
      return <div className="flb-survey-bar-row" key={id}><span>{label}</span><i style={{ width: `${Math.max(3, percent)}%` }} /><b>{percent}%</b></div>
    })}</div>
  }
  if (['rating_5', 'rating_10', 'nps'].includes(question?.question_type)) {
    return question.average_rating != null ? <div className="flb-survey-stat"><strong>{question.average_rating.toFixed(1)}</strong><span>average</span></div> : <span className="flb-survey-waiting">No responses yet</span>
  }
  if (question?.question_type === 'number' && question.numeric_values?.length) {
    const average = question.numeric_values.reduce((sum, value) => sum + value, 0) / question.numeric_values.length
    return <div className="flb-survey-stat"><strong>{average.toFixed(1)}</strong><span>average</span></div>
  }
  return <span className="flb-survey-waiting">{question?.response_count || 0} response{question?.response_count === 1 ? '' : 's'}</span>
}

function SurveySummaryGrid({ state }) {
  const questions = state.questions || []
  return <div className="flb-survey-grid">
    {questions.map((q) => (
      <div className="flb-survey-cell" key={q.question_id}>
        <h4>{q.prompt}</h4>
        <CompactAnswerSummary question={q} />
        <small>{q.response_count || 0} response{q.response_count === 1 ? '' : 's'}</small>
      </div>
    ))}
  </div>
}

function FinalQuestionSummary({ question, index }) {
  const words = (question.word_cloud || []).slice(0, 4)
  return <article className="flb-final-question" style={{ '--delay': `${index * .06}s` }}>
    <header><span>Q{index + 1}</span><h3>{question.prompt}</h3><b>{question.response_count || 0}</b></header>
    {words.length ? <div className="flb-final-words">{words.map((entry) => <span key={entry.word}>{entry.word}<b>{entry.count}</b></span>)}</div> : <CompactAnswerSummary question={question}/>}
  </article>
}

function FinalResultsScene({ state, settings }) {
  const byId = new Map((state.questions || []).map((question) => [question.question_id, question]))
  const questions = settings.results_question_ids?.length
    ? settings.results_question_ids.map((questionId) => byId.get(questionId)).filter(Boolean)
    : state.questions || []
  const summary = state.activity_summary || {}
  const pageSize = 6
  const pageCount = Math.max(1, Math.ceil(questions.length / pageSize))
  const requestedPage = clamp(Number(settings.results_page) || 0, 0, pageCount - 1)
  const [page, setPage] = useState(requestedPage)
  useEffect(() => { setPage(requestedPage) }, [state.activity_id, questions.length, requestedPage])
  useEffect(() => {
    if (pageCount <= 1 || settings.motion === false || settings.results_auto_rotate === false) return undefined
    const timer = setInterval(() => setPage((value) => (value + 1) % pageCount), Math.max(3, Number(settings.results_page_seconds) || 8) * 1000)
    return () => clearInterval(timer)
  }, [pageCount, settings.motion, settings.results_auto_rotate, settings.results_page_seconds])
  const shown = questions.slice(page * pageSize, (page + 1) * pageSize)
  return <><div className="flb-confetti">{Array.from({ length: 24 }, (_, i) => <i style={{ '--x': `${3 + i * 4}%`, '--delay': `${-i * .27}s` }} key={i}/>)}</div><Brand state={state} settings={settings}/><div className="flb-content flb-final-wrap">
    <div className="flb-final-title"><div><Kicker>{settings.rehearsal_mode ? 'Rehearsal preview · analytics unaffected' : settings.results_frozen ? 'Frozen verified snapshot' : 'Live activity summary'}</Kicker><h1>{settings.final_title || 'Every question. One shared result.'}</h1></div>{pageCount > 1 && <span>Results {page * pageSize + 1}–{Math.min(questions.length, (page + 1) * pageSize)} of {questions.length}</span>}</div>
    <section className="flb-final-kpis">
      <article><span>Voices</span><strong>{summary.participant_count ?? state.participant_count ?? 0}</strong><small>participants</small></article>
      <article><span>Answers</span><strong>{summary.response_count ?? state.response_count ?? 0}</strong><small>across all questions</small></article>
      <article><span>Response rate</span><strong>{summary.response_rate || 0}%</strong><small>of possible answers</small></article>
      <article><span>Completed</span><strong>{summary.completion_rate || 0}%</strong><small>{summary.completed_count || 0} answered every required question</small></article>
    </section>
    <section className={`flb-final-grid is-${shown.length}`}>{shown.map((question, index) => <FinalQuestionSummary key={question.question_id} question={question} index={page * pageSize + index}/>)}</section>
    {pageCount > 1 && <div className="flb-final-pages">{Array.from({ length: pageCount }, (_, index) => <i className={index === page ? 'active' : ''} key={index}/>)}</div>}
  </div><Footer left={`${questions.length} questions · ${settings.rehearsal_mode ? 'simulated rehearsal' : settings.results_frozen ? 'snapshot frozen' : 'updating live'}`} right={settings.results_auto_rotate === false && pageCount > 1 ? `Page ${page + 1} of ${pageCount}` : 'Thank you for taking part'} live={!settings.results_frozen}/></>
}

const RATING_TYPES = ['rating_5', 'rating_10', 'nps']

// A curated aggregate view for a survey/feedback activity's public display —
// used instead of SurveySummaryGrid once a survey has more than a handful of
// questions (see the scene dispatch below), where one raw tile per question
// stops being readable on a TV. Fixed-height, no-scroll dashboard: two
// columns (headline rating + compact experience-ratings list on the left,
// choice donuts + a ranking chart on the right) plus a footer strip for
// number stats and "+N more in the full report" — a TV/projector isn't
// scrollable by anyone in the room, so every section is capped hard enough
// to fit in one screen rather than growing with the question count. Never
// shows raw open-text content (per Festio Live's own moderation-first
// design — AI-analyzed themes belong in the organizer's report, not here).
const DASHBOARD_MAX_RATINGS = 8
const DASHBOARD_MAX_CHOICES = 2
// A donut's legend column only has room for short labels in a handful of
// options — "Labor Day weekend / early September" as one of six options
// doesn't fit no matter how the legend wraps. Past this, a compact bar list
// (already used below for multiple_choice) reads far better on a TV.
const DASHBOARD_DONUT_MAX_OPTIONS = 4
const DASHBOARD_DONUT_MAX_LABEL_LEN = 18
function isDonutFriendly(q) {
  const labels = Object.values(q.option_labels || {})
  return labels.length > 0 && labels.length <= DASHBOARD_DONUT_MAX_OPTIONS && !labels.some((label) => (label || '').length > DASHBOARD_DONUT_MAX_LABEL_LEN)
}

function SurveyDashboard({ state }) {
  const questions = state.questions || []
  const ratings = questions.filter((q) => RATING_TYPES.includes(q.question_type))
  const choices = questions.filter((q) => SINGLE_SELECT_TYPES.includes(q.question_type))
  const multi = questions.filter((q) => q.question_type === 'multiple_choice')
  const numbers = questions.filter((q) => q.question_type === 'number')
  const textCount = questions.filter((q) => ['short_text', 'long_text', 'word_cloud'].includes(q.question_type))
    .reduce((sum, q) => sum + (q.response_count || 0), 0)

  const [headline, ...otherRatings] = ratings
  const shownRatings = otherRatings.slice(0, DASHBOARD_MAX_RATINGS)
  const shownChoices = choices.slice(0, DASHBOARD_MAX_CHOICES)
  const donutChoices = shownChoices.filter(isDonutFriendly)
  const barChoices = shownChoices.filter((q) => !isDonutFriendly(q))
  const hiddenCount = (choices.length - shownChoices.length) + Math.max(0, otherRatings.length - shownRatings.length) + Math.max(0, multi.length - 1)

  return (
    <div className="flb-survey-dashboard">
      <div className="flb-survey-col">
        {headline && (
          <div className="flb-survey-headline-card">
            <span>{headline.prompt}</span>
            {headline.average_rating != null
              ? <div className="flb-survey-headline-value"><strong>{headline.average_rating.toFixed(1)}</strong><StarRating average={headline.average_rating} max={headline.question_type === 'rating_5' ? 5 : 10}/></div>
              : <span className="flb-survey-waiting">No ratings yet</span>}
          </div>
        )}
        {shownRatings.length > 0 && (
          <div className="flb-survey-section">
            <Kicker>Experience ratings</Kicker>
            <div className="flb-survey-bars flb-survey-bars-compact">
              {shownRatings.map((q) => (
                <div className="flb-survey-bar-row" key={q.question_id}>
                  <span>{q.prompt.replace(/^How would you rate:?\s*/i, '').replace(/\?$/, '')}</span>
                  {q.average_rating != null
                    ? <><i style={{ width: `${(q.average_rating / 5) * 100}%` }} /><b>{q.average_rating.toFixed(1)}</b></>
                    : <><i style={{ width: '0%' }} /><b className="flb-survey-waiting">—</b></>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="flb-survey-col">
        {shownChoices.length > 0 && (
          <div className="flb-survey-section">
            <Kicker>What people chose</Kicker>
            {donutChoices.length > 0 && (
              <div className="flb-survey-choice-grid flb-survey-choice-grid-compact">
                {donutChoices.map((q) => {
                  const segments = Object.entries(q.option_labels || {}).map(([id, label]) => ({ id, label, value: q.option_counts?.[id] || 0 }))
                  const hasResponses = segments.some((segment) => segment.value > 0)
                  return (
                    <div className="flb-survey-cell" key={q.question_id}>
                      <h4>{q.prompt}</h4>
                      {hasResponses ? <div className="flb-donut-row"><DonutChart segments={segments}/><DonutLegend segments={segments}/></div> : <span className="flb-survey-waiting">No responses yet</span>}
                    </div>
                  )
                })}
              </div>
            )}
            {barChoices.map((q) => {
              const items = Object.entries(q.option_labels || {}).map(([id, label]) => ({ id, label, score: q.option_counts?.[id] || 0 }))
                .sort((a, b) => b.score - a.score).slice(0, 5)
              const hasResponses = items.some((item) => item.score > 0)
              return (
                <div className="flb-survey-cell flb-survey-cell-full" key={q.question_id}>
                  <h4>{q.prompt}</h4>
                  {hasResponses ? <RankingChart items={items}/> : <span className="flb-survey-waiting">No responses yet</span>}
                </div>
              )
            })}
          </div>
        )}
        {multi[0] && (() => {
          const q = multi[0]
          const items = Object.entries(q.option_labels || {}).map(([id, label]) => ({ id, label, score: q.option_counts?.[id] || 0 }))
          const hasResponses = items.some((item) => item.score > 0)
          return (
            <div className="flb-survey-section">
              <Kicker>{q.prompt}</Kicker>
              {hasResponses ? <RankingChart items={items}/> : <span className="flb-survey-waiting">No responses yet</span>}
            </div>
          )
        })()}
      </div>
      <div className="flb-survey-dashboard-footer">
        {numbers.slice(0, 2).map((q) => {
          const values = q.numeric_values || []
          const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
          return (
            <div className="flb-survey-stat flb-survey-stat-inline" key={q.question_id}>
              {average != null ? <strong>{average.toFixed(1)}</strong> : <span className="flb-survey-waiting">—</span>}
              <span>{q.prompt}</span>
            </div>
          )
        })}
        {textCount > 0 && <span className="flb-survey-more-note">+{textCount} written response{textCount === 1 ? '' : 's'} collected</span>}
        {hiddenCount > 0 && <span className="flb-survey-more-note">+{hiddenCount} more in the full report</span>}
      </div>
    </div>
  )
}

function formatSurveyDuration(seconds) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return '—'
  const rounded = Math.max(0, Math.round(Number(seconds)))
  return `${String(Math.floor(rounded / 60)).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}`
}

function surveyQuestionById(questions, questionId) {
  return questionId ? questions.find((question) => question.question_id === questionId) : null
}

function compactSurveySegments(question, limit = 4) {
  const ranked = Object.entries(question?.option_labels || {})
    .map(([id, label]) => ({ id, label, value: question.option_counts?.[id] || 0 }))
    .sort((a, b) => b.value - a.value)
  if (ranked.length <= limit) return ranked
  const visible = ranked.slice(0, limit - 1)
  const remainder = ranked.slice(limit - 1).reduce((sum, segment) => sum + segment.value, 0)
  return [...visible, { id: `${question.question_id}-other`, label: 'Other choices', value: remainder }]
}

function SurveyInsightKpi({ icon, label, value, note, tone }) {
  return <div className={`flb-si-kpi flb-si-tone-${tone}`}>
    <span className="flb-si-kpi-icon" aria-hidden="true">{icon}</span>
    <div><small>{label}</small><strong>{value}</strong>{note && <em>{note}</em>}</div>
  </div>
}

function SurveyInsightDonutCard({ question, title }) {
  const segments = compactSurveySegments(question)
  const total = Math.max(1, segments.reduce((sum, segment) => sum + segment.value, 0))
  return <article className="flb-si-card flb-si-choice-card">
    <h2>{title || question?.prompt || 'Audience choice'}</h2>
    {segments.some((segment) => segment.value > 0) ? <div className="flb-si-donut-body">
      <DonutChart segments={segments} size={7.2}/>
      <div className="flb-si-legend">{segments.map((segment, index) => <div key={segment.id}>
        <i style={{ background: segment.color || `var(--flb-chart-${(index % 6) + 1})` }}/>
        <span title={segment.label}>{segment.label}</span>
        <b>{Math.round((segment.value / total) * 100)}%</b>
      </div>)}</div>
    </div> : <span className="flb-survey-waiting">Waiting for responses</span>}
  </article>
}

function SurveyInsightPriorityCard({ question, title }) {
  const denominator = Math.max(1, question?.response_count || 0)
  const items = Object.entries(question?.option_labels || {})
    .map(([id, label]) => ({ id, label, count: question.option_counts?.[id] || 0 }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
  return <article className="flb-si-card flb-si-priorities">
    <h2>{title || 'What Attendees Want More Of'}</h2>
    {items.length ? <div className="flb-si-priority-bars">{items.map((item, index) => {
      const percent = Math.round((item.count / denominator) * 100)
      return <div className="flb-si-priority-row" key={item.id}>
        <span title={item.label}>{item.label}</span>
        <i><b style={{ width: `${percent}%`, '--priority-index': index }}/></i>
        <strong>{percent}%</strong>
      </div>
    })}</div> : <span className="flb-survey-waiting">Waiting for priorities</span>}
  </article>
}

function SurveyInsightHouseholdCard({ householdQuestion, youthQuestion }) {
  const householdValues = householdQuestion?.numeric_values || []
  const youthValues = youthQuestion?.numeric_values || []
  const householdTotal = householdValues.reduce((sum, value) => sum + Number(value || 0), 0)
  const youthTotal = youthValues.reduce((sum, value) => sum + Number(value || 0), 0)
  const householdAverage = householdValues.length ? householdTotal / householdValues.length : null
  const youthAverage = youthValues.length ? youthTotal / youthValues.length : null
  const metrics = [
    ['◎', householdValues.length ? householdTotal.toLocaleString() : '—', 'likely attendees'],
    ['◌', youthValues.length ? youthTotal.toLocaleString() : '—', 'youth'],
    ['⌂', householdAverage != null ? householdAverage.toFixed(1) : '—', 'average household'],
    ['◉', youthAverage != null ? youthAverage.toFixed(1) : '—', 'youth per household'],
  ]
  return <article className="flb-si-card flb-si-household">
    <h2>Household Attendance</h2>
    <div className="flb-si-household-grid">{metrics.map(([icon, value, label], index) => <div key={label}>
      <span className={`flb-si-household-icon is-${index}`} aria-hidden="true">{icon}</span>
      <strong>{value}</strong><small>{label}</small>
    </div>)}</div>
  </article>
}

function SurveyInsightRatingCard({ question }) {
  const valueCounts = question?.value_counts || {}
  const total = Math.max(1, Object.values(valueCounts).reduce((sum, count) => sum + count, 0))
  const average = question?.average_rating
  return <article className="flb-si-card flb-si-rating-card">
    <h2>Overall Summit Rating</h2>
    <div className="flb-si-rating-body">
      <div className="flb-si-rating-score"><strong>{average != null ? average.toFixed(1) : '—'}</strong><StarRating average={average || 0} max={5}/><small>out of 5</small></div>
      <div className="flb-si-rating-bars">{[5, 4, 3, 2, 1].map((rating) => {
        const count = valueCounts[String(rating)] || 0
        const percent = Math.round((count / total) * 100)
        return <div key={rating}><span>{rating} Star{rating === 1 ? '' : 's'}</span><i><b style={{ width: `${percent}%` }}/></i><strong>{percent}%</strong></div>
      })}</div>
    </div>
  </article>
}

function SurveyInsightsScene({ state, settings }) {
  const questions = state.questions || []
  const layout = state.display_config?.survey_insights_layout || settings.survey_insights_layout || {}
  const ratings = questions.filter((question) => RATING_TYPES.includes(question.question_type))
  const choices = questions.filter((question) => SINGLE_SELECT_TYPES.includes(question.question_type))
  const numbers = questions.filter((question) => question.question_type === 'number')
  const priorities = questions.filter((question) => question.question_type === 'multiple_choice')
  const overallRating = surveyQuestionById(questions, layout.overall_rating_question_id)
    || ratings.find((question) => /overall/i.test(question.prompt)) || ratings[0]
  const configuredChoices = (layout.choice_question_ids || []).map((id) => surveyQuestionById(questions, id)).filter(Boolean)
  const shownChoices = (configuredChoices.length ? configuredChoices : choices.slice(-4)).slice(0, 4)
  const priorityQuestion = surveyQuestionById(questions, layout.priority_question_id)
    || priorities.find((question) => /more of/i.test(question.prompt)) || priorities.at(-1)
  const householdQuestions = (layout.household_question_ids || []).map((id) => surveyQuestionById(questions, id)).filter(Boolean)
  const [householdQuestion, youthQuestion] = householdQuestions.length ? householdQuestions : numbers.slice(0, 2)
  const summary = state.survey_summary
  const completed = summary?.completed_count
  const completionRate = summary?.completion_rate
  const choiceTitles = layout.choice_titles || {}
  const priorityItems = Object.entries(priorityQuestion?.option_labels || {})
    .map(([id, label]) => ({ id, label, count: priorityQuestion.option_counts?.[id] || 0 }))
    .filter((item) => item.count > 0).sort((a, b) => b.count - a.count).slice(0, 3)
  const joinCode = state.live_join_code || settings.join_code || state.display_config?.join_code || 'FESTIO'
  const title = settings.title || state.title || 'Live audience insights'

  return <div className="flb-survey-insights-scene">
    <header className="flb-si-header">
      <div className="flb-si-brand"><span className="flb-si-mark">F</span><b>FESTIO LIVE</b></div>
      <div className="flb-si-title"><h1>{title}</h1><p>{settings.subtitle || 'Live audience insights'}</p></div>
      <div className="flb-si-live"><span>● LIVE</span><b>◎ {state.participant_count || 0} connected</b></div>
      <div className="flb-si-join"><img src={`/api/events/${encodeURIComponent(state.event_id || '')}/live/join-qr.png`} alt="QR code to join Festio Live"/><div><small>JOIN CODE</small><strong>{joinCode}</strong></div></div>
    </header>

    <section className="flb-si-kpis" aria-label="Survey metrics">
      <SurveyInsightKpi tone="mint" icon="◎" label="Participants" value={state.participant_count || 0} note="unique voices"/>
      <SurveyInsightKpi tone="blue" icon="✓" label="Completion" value={completionRate != null ? `${completionRate}%` : '—'} note={completed != null ? `${completed} completed` : 'final submissions'}/>
      <SurveyInsightKpi tone="violet" icon="◷" label="Avg. Time" value={formatSurveyDuration(summary?.avg_completion_seconds)} note="mm:ss"/>
      <SurveyInsightKpi tone="gold" icon="☆" label="Overall Rating" value={overallRating?.average_rating != null ? `${overallRating.average_rating.toFixed(1)} / 5` : '—'} note={`${overallRating?.response_count || 0} ratings`}/>
      <SurveyInsightKpi tone="coral" icon="▤" label="Answers" value={(summary?.answer_count ?? state.response_count ?? 0).toLocaleString()} note="across the survey"/>
    </section>

    <section className="flb-si-choice-grid">
      {shownChoices.map((question, index) => <SurveyInsightDonutCard key={question.question_id} question={question} title={choiceTitles[question.question_id] || ['Preferred Summit Time', 'Preferred Experience', 'Travel Distance', 'Price Per Person'][index]}/>) }
    </section>

    <section className="flb-si-detail-grid">
      <SurveyInsightPriorityCard question={priorityQuestion} title={layout.priority_title}/>
      <SurveyInsightHouseholdCard householdQuestion={householdQuestion} youthQuestion={youthQuestion}/>
      <SurveyInsightRatingCard question={overallRating}/>
    </section>

    <section className="flb-si-insights" aria-label="Emerging priorities">
      <div className="flb-si-insights-title"><span>✦</span><div><strong>Emerging Priorities</strong><small>Live aggregate choices</small></div></div>
      {priorityItems.length ? priorityItems.map((item, index) => <div className={`flb-si-insight-chip is-${index}`} key={item.id}><span>{['◇', '◎', '◷'][index]}</span><strong>{item.label}</strong></div>) : <div className="flb-si-insight-chip"><strong>Insights gathering</strong></div>}
      <div className="flb-si-privacy"><span>✓</span><small>Anonymous<br/>aggregate insights</small></div>
    </section>
  </div>
}

function QuestionOptions({ question }) {
  return <div className="flb-options">{Object.entries(question?.option_labels || {}).slice(0, 6).map(([id, label], index) => (
    <div className="flb-option" key={id}><b>{OPTION_LETTERS[index]}</b><span>{label}</span></div>
  ))}</div>
}

function sceneQuestion(state, currentQuestion, types) {
  if (currentQuestion && types.includes(currentQuestion.question_type)) return currentQuestion
  return (state.questions || []).find((question) => types.includes(question.question_type)) || currentQuestion
}

function optionResults(question) {
  const scores = Object.keys(question?.ranking_scores || {}).length ? question.ranking_scores : (question?.option_counts || {})
  return Object.entries(question?.option_labels || {})
    .map(([id, label]) => ({ id, label, score: Number(scores[id] || 0) }))
    .sort((a, b) => b.score - a.score)
}

function SpectrumScene({ state, settings, currentQuestion }) {
  const question = sceneQuestion(state, currentQuestion, ['rating_10', 'nps', 'rating_5', 'number', 'single_choice'])
  const min = question?.question_type === 'nps' ? 0 : 1
  const max = question?.question_type === 'rating_5' ? 5 : 10
  let values = (question?.numeric_values || []).map(Number).filter(Number.isFinite)
  if (!values.length && Object.keys(question?.value_counts || {}).length) {
    values = Object.entries(question.value_counts).flatMap(([value, count]) => Array.from({ length: Math.min(Number(count), 8) }, () => Number(value)))
  }
  if (!values.length && Object.keys(question?.option_counts || {}).length) {
    const options = Object.keys(question.option_labels || {})
    values = options.flatMap((id, index) => Array.from({ length: Math.min(Number(question.option_counts[id] || 0), 8) }, () => min + ((max - min) * index / Math.max(1, options.length - 1))))
  }
  const dots = values.slice(0, 18)
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
  const labels = settings.spectrum_labels || ['Not ready yet', 'Exploring', 'Ready now']
  return <><Brand state={state} settings={settings}/><div className="flb-content"><Kicker>Live opinion spectrum</Kicker><h1 className="flb-headline flb-small">{question?.prompt || settings.message || 'How ready are we to turn these ideas into action?'}</h1><div className="flb-spectrum flb-glass"><div className="flb-spectrum-labels"><span>{labels[0]}</span><span>{labels[1]}</span><span>{labels[2]}</span></div><div className="flb-spectrum-track">{dots.map((value, index) => <i key={index} style={{ '--x': `${clamp(((value - min) / Math.max(1, max - min)) * 100, 2, 98)}%`, '--delay': `${index * .04}s` }}>{String.fromCharCode(65 + (index % 26))}</i>)}</div><div className="flb-spectrum-summary"><span>Room average <strong>{average == null ? '—' : `${average.toFixed(1)} / ${max}`}</strong></span><span>Responses <strong>{question?.response_count || values.length}</strong></span><span>Live range <strong>{min}–{max}</strong></span></div></div></div><Footer left="Anonymous positions · no individual profiling" right="Updating live" live/></>
}

function QuadrantScene({ state, settings, currentQuestion }) {
  const question = sceneQuestion(state, currentQuestion, ['quadrant'])
  const points = question?.points || []
  const labels = question?.axis_labels || {}
  const buckets = [
    { x: .73, y: .27, count: 0, label: 'High impact · less effort' },
    { x: .27, y: .27, count: 0, label: 'High impact · more effort' },
    { x: .73, y: .72, count: 0, label: 'Lower impact · less effort' },
    { x: .27, y: .72, count: 0, label: 'Lower impact · more effort' },
  ]
  points.forEach(([x, y]) => { buckets[(y >= .5 ? 2 : 0) + (x < .5 ? 1 : 0)].count += 1 })
  const strongest = [...buckets].sort((a, b) => b.count - a.count)[0]
  return <><Brand state={state} settings={settings}/><div className="flb-content"><div className="flb-quadrant-layout"><div><Kicker>Map the opportunity</Kicker><h1 className="flb-headline flb-small">{question?.prompt || settings.message || 'Where should we focus first?'}</h1><div className="flb-signature-quadrant"><span className="top">{labels.y_label_high || 'High impact'}</span><span className="bottom">{labels.y_label_low || 'Lower impact'}</span><span className="left">{labels.x_label_low || 'More effort'}</span><span className="right">{labels.x_label_high || 'Less effort'}</span>{buckets.filter((bucket) => bucket.count).map((bucket, index) => <i key={bucket.label} style={{ '--x': `${bucket.x * 100}%`, '--y': `${bucket.y * 100}%`, '--size': `${2.4 + Math.min(2.5, bucket.count / 6)}cqw`, '--delay': `${index * .1}s` }}>{bucket.count}</i>)}</div></div><aside className="flb-quadrant-side"><article className="flb-glass"><small>Strongest opportunity</small><strong>{points.length ? strongest.label : 'Gathering responses'}</strong><span>{strongest.count || 0} placements</span></article><article className="flb-glass"><small>High-impact share</small><strong>{points.length ? `${Math.round(((buckets[0].count + buckets[1].count) / points.length) * 100)}%` : '—'}</strong><span>of all placements</span></article><article className="flb-glass"><small>Participation</small><strong>{points.length}</strong><span>anonymous placements</span></article></aside></div></div><Footer left="Aggregate clusters · exact identities remain private" right="Quadrant live" live/></>
}

function ImageHeatmapScene({ state, settings, currentQuestion }) {
  const question = sceneQuestion(state, currentQuestion, ['image_click'])
  const points = question?.points || []
  const image = question?.board_image
  return <><Brand state={state} settings={settings}/><div className="flb-content"><div className="flb-heatmap-layout"><div><Kicker>Tap what matters</Kicker><h1 className="flb-headline flb-small">{question?.prompt || settings.message || 'Which part of this image needs attention?'}</h1><div className={`flb-signature-heatmap ${image ? 'has-image' : ''}`} style={image ? { backgroundImage: `linear-gradient(#06131b42,#06131b42),url("${image}")` } : undefined}>{points.slice(0, 36).map(([x, y], index) => <i key={index} style={{ '--x': `${x * 100}%`, '--y': `${(1 - y) * 100}%`, '--delay': `${index * -.08}s` }}/>)}</div></div><aside className="flb-heatmap-side"><article className="flb-glass"><span>Interaction</span><strong>{points.length} taps</strong><p>Anonymous visual choices</p></article><article className="flb-glass"><span>Coverage</span><strong>{points.length ? `${Math.min(100, Math.round(points.length * 1.7))}%` : '—'}</strong><p>of the visual explored</p></article><article className="flb-glass"><span>Status</span><strong>{points.length ? 'Heat rising' : 'Waiting'}</strong><p>Updates as taps arrive</p></article></aside></div></div><Footer left="Privacy-safe visual aggregation" right="Heatmap live" live/></>
}

function RankingRaceScene({ state, settings, currentQuestion }) {
  const question = sceneQuestion(state, currentQuestion, ['ranking', 'multiple_choice', 'single_choice'])
  const items = optionResults(question).slice(0, 5)
  const peak = Math.max(1, ...items.map((item) => item.score))
  return <><Brand state={state} settings={settings}/><div className="flb-content"><Kicker>Preferences in motion</Kicker><h1 className="flb-headline flb-small">{question?.prompt || settings.message || 'What should lead next?'}</h1>{items.length ? <div className="flb-ranking-race">{items.map((item, index) => <article key={item.id} style={{ '--delay': `${index * .08}s` }}><strong>{index + 1}</strong><div><h3>{item.label}</h3><i><b style={{ width: `${Math.max(4, (item.score / peak) * 100)}%` }}/></i></div><span><b>{item.score.toLocaleString()}</b><small>{index === 0 ? 'leading now' : 'live score'}</small></span></article>)}</div> : <EmptyState title="The ranking race is ready" copy="Ranked preferences appear as soon as the first answers arrive."/>}</div><Footer left="Positions reorder as verified answers arrive" right={`${question?.response_count || 0} responses`} live/></>
}

function PredictionRevealScene({ state, settings, currentQuestion }) {
  const question = sceneQuestion(state, currentQuestion, ['single_choice', 'true_false', 'yes_no', 'multiple_choice'])
  const items = optionResults(question)
  const total = Math.max(1, items.reduce((sum, item) => sum + item.score, 0))
  const winner = items[0]
  const actual = winner ? Math.round((winner.score / total) * 100) : null
  const prediction = settings.prediction || {}
  return <><Brand state={state} settings={settings}/><div className="flb-content"><Kicker>{prediction.locked === false ? 'Prediction open' : 'Prediction locked'}</Kicker><h1 className="flb-headline flb-small">{question?.prompt || settings.message || 'Will the room predict the real result?'}</h1><div className="flb-prediction-grid"><article className="flb-prediction-card flb-glass"><span>Audience predicted</span><strong>{prediction.percent != null ? `${prediction.percent}%` : '—'}</strong><p>{prediction.label || 'Set a prediction in Design scene'}</p></article><b className="flb-reveal-bolt">◆</b><article className="flb-prediction-card flb-glass"><span>Actual result</span><strong>{actual == null ? '—' : `${actual}%`}</strong><p>{winner ? `${winner.label} leads the final choice` : 'Waiting for verified responses'}</p></article></div></div><Footer left="Prediction and outcome remain clearly labelled" right={actual == null ? 'Awaiting result' : 'Outcome revealed'} live/></>
}

function CommitmentWallScene({ state, settings, currentQuestion }) {
  const entries = (settings.commitments || []).filter((entry) => entry && (typeof entry === 'string' || entry.text)).slice(0, 8)
  return <><Brand state={state} settings={settings}/><div className="flb-content"><Kicker>From intention to action</Kicker><h1 className="flb-headline flb-small">{currentQuestion?.prompt || settings.message || 'What will you commit to in the next 30 days?'}</h1>{entries.length ? <div className="flb-commitments">{entries.map((entry, index) => { const item = typeof entry === 'string' ? { text: entry } : entry; return <article key={`${item.text}-${index}`} style={{ '--delay': `${index * .06}s` }}><span>{item.theme || 'Commitment'}</span><p>{item.text}</p><small>{item.author || 'Anonymous'} · moderator approved</small></article> })}</div> : <EmptyState title="Approved commitments will appear here" copy="Add curated commitments in Design scene; unmoderated open text is never projected."/>}</div><Footer left="Moderator-approved commitments only" right={`${entries.length} on the wall`} live/></>
}

function PhotoMosaicScene({ state, settings }) {
  const configured = (settings.photo_mosaic_entries || []).filter((entry) => entry?.consent === true)
  const safeLeaders = configured.length ? [] : (state.leaderboard || []).map((entry) => ({ name: entry.display_name }))
  const entries = [...configured, ...safeLeaders]
  const count = Math.max(entries.length, Math.min(72, state.participant_count || 0))
  const tiles = Array.from({ length: count }, (_, index) => entries[index % Math.max(1, entries.length)] || { name: 'Guest' })
  return <><Brand state={state} settings={settings}/><div className="flb-content"><div className="flb-mosaic-layout"><div className="flb-photo-mosaic flb-glass"><span>F</span>{tiles.map((entry, index) => <i key={index} style={entry.image_url ? { backgroundImage: `url("${entry.image_url}")`, '--delay': `${index * .01}s` } : { '--delay': `${index * .01}s` }}>{entry.image_url ? '' : (entry.name || 'Guest').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</i>)}</div><div className="flb-mosaic-copy"><Kicker>Every face builds the picture</Kicker><strong>{state.participant_count || configured.length || 0}</strong><p>{configured.length ? 'consent-verified portraits have joined the living event mosaic.' : 'privacy-safe participant tiles are assembling live.'}</p><div><span>{configured.length ? 'Consent verified' : 'Private by design'}</span><span>Updating live</span></div></div></div></div><Footer left="Only consented portraits or privacy-safe aliases" right="Living mosaic" live/></>
}

function LocationMapScene({ state, settings }) {
  const regions = (settings.location_regions || []).filter((region) => region?.name).slice(0, 5)
  const positions = [[43, 69], [68, 48], [24, 44], [57, 35], [77, 58]]
  return <><Brand state={state} settings={settings}/><div className="flb-content"><div className="flb-location-layout"><div><Kicker>Our community has reach</Kicker><h1 className="flb-headline flb-small">{settings.message || 'Where the room is joining from.'}</h1><div className="flb-live-map"><svg viewBox="0 0 900 430" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="3" d="M102 238L144 151 225 119 287 71 373 89 444 61 527 94 589 87 640 124 713 132 770 184 753 244 690 258 653 310 592 293 549 347 480 319 419 350 359 302 292 320 247 276 176 284Z"/><path fill="none" stroke="currentColor" strokeOpacity=".3" d="M210 124L250 278M360 90L360 302M510 94L505 319M638 126L612 291M146 201L752 203"/></svg>{regions.map((region, index) => <i key={region.name} style={{ '--x': `${positions[index][0]}%`, '--y': `${positions[index][1]}%`, '--delay': `${index * -.4}s` }}/>)}</div></div><aside className="flb-region-list">{regions.length ? regions.map((region) => <div className="flb-glass" key={region.name}><i/><span>{region.name}</span><strong>{Number(region.count || 0).toLocaleString()}</strong></div>) : <EmptyState title="No location aggregates yet" copy="Add privacy-safe regional totals in Design scene. Exact locations are never displayed."/>}</aside></div></div><Footer left="Regions only · exact locations remain private" right={`${regions.reduce((sum, region) => sum + Number(region.count || 0), 0)} represented`} live/></>
}

function JourneyRecapScene({ state, settings }) {
  const configured = (settings.journey_steps || []).filter((step) => step?.title).slice(0, 5)
  const derived = [
    { icon: '⌗', title: 'We gathered', value: `${state.participant_count || 0} voices`, note: 'joined the live experience' },
    { icon: '◌', title: 'We chose', value: `${state.response_count || 0} answers`, note: 'across every live moment' },
    { icon: '?', title: 'We asked', value: `${state.featured_qna ? 1 : 0} featured`, note: 'audience question elevated' },
    { icon: '✦', title: 'We discovered', value: `${state.ai_insight?.themes?.length || state.word_cloud?.length || 0} themes`, note: 'from shared reflections' },
    { icon: '✓', title: 'We committed', value: `${settings.commitments?.length || 0} actions`, note: 'ready for what comes next' },
  ]
  const steps = configured.length ? configured : derived
  return <><Brand state={state} settings={settings}/><div className="flb-content"><Kicker>Your event story</Kicker><h1 className="flb-headline flb-small">{settings.message || 'Five moments. One unforgettable journey.'}</h1><div className="flb-journey"><div/><section>{steps.map((step, index) => <article key={`${step.title}-${index}`} style={{ '--delay': `${index * .08}s` }}><i>{step.icon || ['⌗', '◌', '?', '✦', '✓'][index]}</i><h3>{step.title}</h3><strong>{step.value || step.metric || '—'}</strong><p>{step.note || step.description}</p></article>)}</section></div></div><Footer left="A live recap built from verified event activity" right="Journey complete" live/></>
}

function SpotlightWheelScene({ state, settings }) {
  const eligible = (settings.spotlight_entries || []).filter((entry) => entry?.consent === true && entry?.name)
  const winner = eligible.find((entry) => entry.selected) || eligible[0]
  return <><Brand state={state} settings={settings}/><div className="flb-content"><div className="flb-wheel-layout"><div><Kicker>The room decides who is next</Kicker><h1 className="flb-headline flb-small">Ready for the <span className="flb-gradient">spotlight?</span></h1><p className="flb-subhead">Selection is random, auditable and limited to opted-in participants.</p><div className="flb-wheel-notes"><span>{eligible.length} eligible</span><span>No repeat winners</span><span>Consent on</span></div></div><div><div className="flb-wheel"/><article className="flb-winner flb-glass"><small>{winner ? 'Selected' : 'Waiting for entrants'}</small><i>{winner ? winner.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() : '?'}</i><strong>{winner?.name || 'No eligible participant'}</strong><p>{winner?.detail || 'Opted-in names can be added in Design scene.'}</p></article></div></div></div><Footer left="Consent-gated · random selection · no repeat winners" right="Spotlight ready" live/></>
}

function SceneContent({ scene, state, settings, currentQuestion, countdown, questionSeconds }) {
  const questionNumber = Math.max(1, (state.questions || []).findIndex((q) => q.question_id === state.current_question_id) + 1)
  const questionTotal = state.questions?.length || 1
  const questionResponseRate = state.participant_count ? Math.round(((currentQuestion?.response_count || 0) / state.participant_count) * 100) : 0
  const joinCode = displayJoinCode(state, settings)
  const title = settings.title || state.title || 'Welcome to Festio Live'
  const subtitle = settings.subtitle || state.description || 'A live experience shaped by every voice in the room.'
  const featured = state.featured_qna
  const pulse = state.room_pulse || {}
  const teams = state.teams || []
  const cloud = state.word_cloud?.length ? state.word_cloud : FALLBACK_WORDS.map(([word, count]) => ({ word, count }))
  const insight = state.ai_insight
  const themes = insight?.themes?.length ? insight.themes : cloud.slice(0, 3).map((w) => w.word)
  const correctLabels = (currentQuestion?.correct_option_ids || []).map((id) => currentQuestion.option_labels?.[id]).filter(Boolean)

  if (scene === 'welcome') return <><Brand state={state} settings={settings}/><div className="flb-content"><div className="flb-welcome"><div><Kicker>{settings.kicker || 'The room is ready'}</Kicker><h1 className="flb-headline">{title} <span className="flb-gradient">together.</span></h1><p className="flb-subhead">{subtitle}</p></div><div className="flb-date flb-glass"><span>{settings.date_label || 'Live today'}</span><strong>{state.participant_count || '—'}</strong><span>voices connected</span></div></div></div><Footer left={(settings.sponsors || []).join(' · ') || settings.venue || 'Powered by Festio'} right={settings.status_label || 'Doors open'} live/></>

  if (scene === 'join') return <><Brand state={state} settings={settings}/><div className="flb-content"><div className="flb-join"><div><Kicker>Your voice belongs here</Kicker><h1 className="flb-headline flb-small">Scan. Join. <span className="flb-gradient">Shape the room.</span></h1><p className="flb-subhead">Vote, ask questions, react and collaborate live. No app or account required.</p><div className="flb-code">{joinCode}</div></div><div className="flb-qr flb-glass"><img src={`/api/events/${encodeURIComponent(state.event_id || '')}/live/join-qr.png`} alt="QR code to join Festio Live"/><span>Scan to join</span></div></div></div><Footer left="Open your camera and point it at the QR code" right={`${state.participant_count || 0} already here`} live/></>

  if (scene === 'agenda') {
    const agenda = settings.agenda?.length ? settings.agenda : [{ time: 'Now', title: state.title, speaker: 'Main stage', live: true }, { time: 'Up next', title: 'Audience discussion', speaker: 'Interactive session' }, { time: 'Later', title: 'Ideas into action', speaker: 'Community lab' }]
    return <><Brand state={state} settings={settings}/><div className="flb-content"><Kicker>What’s happening now</Kicker><h1 className="flb-headline flb-small">Your live event journey</h1><div className="flb-card-grid">{agenda.slice(0, 3).map((item, i) => <div className={`flb-card flb-glass ${item.live || i === 0 ? 'active' : ''}`} key={`${item.time}-${i}`}>{(item.live || i === 0) && <em>LIVE NOW</em>}<span>{item.time}</span><h3>{item.title}</h3><p>{item.speaker || item.room}</p></div>)}</div></div><Footer left="Schedule updates appear automatically" right="On schedule"/></>
  }

  if (scene === 'question') {
    const locked = state.display_config?.show_mode === 'guided' && state.display_config?.show_phase === 'locked'
    return <><Brand state={state} settings={settings}/><div className="flb-content">{currentQuestion ? <><div className="flb-progress"><span>Question {questionNumber} of {questionTotal}</span><i><b style={{ width: `${(questionNumber / questionTotal) * 100}%` }}/></i><span>{currentQuestion.question_type.replaceAll('_', ' ')}</span></div><Kicker>{locked ? 'Answers locked' : 'Read it. Think it through.'}</Kicker><h1 className="flb-headline flb-small">{currentQuestion.prompt}</h1><QuestionOptions question={currentQuestion}/></> : <EmptyState/>}</div><Footer left={locked ? `${currentQuestion?.response_count || 0} verified responses` : 'Voting opens when the presenter is ready'} right={currentQuestion ? (locked ? 'Locked' : 'Get ready') : 'Standing by'} live={locked}/></>
  }

  if (scene === 'responding') return <><Brand state={state} settings={settings}/><div className="flb-content">{currentQuestion ? <div className="flb-vote"><div><Kicker>Voting is open · Question {questionNumber} of {questionTotal}</Kicker><h1 className="flb-headline flb-small">{currentQuestion.prompt}</h1><QuestionOptions question={currentQuestion}/><div className="flb-live-response"><strong>{currentQuestion.response_count || 0}</strong><span>responses · {questionResponseRate}% of connected participants</span></div></div><div className={`flb-timer ${questionSeconds === 0 ? 'is-finished' : ''}`}><span>{questionSeconds == null ? '∞' : questionSeconds}</span><small>{questionSeconds == null ? 'open' : 'seconds'}</small></div></div> : <div className="flb-vote"><div><Kicker>The room is responding</Kicker><h1 className="flb-headline flb-small">{state.title}</h1><div className="flb-stats"><div><strong>{state.participant_count || 0}</strong><span>participants connected</span></div><div><strong>{state.response_count || 0}</strong><span>answers saved</span></div></div></div><div className="flb-timer"><span>●</span><small>live</small></div></div>}</div>{settings.show_reactions !== false && <div className="flb-reactions"><i>♥</i><i>✦</i><i>●</i><i>◆</i></div>}<Footer left={`${state.participant_count || 0} participants connected`} right="Voting open" live/></>

  if (scene === 'results' && ['survey', 'feedback'].includes(state.type)) {
    // A handful of questions still reads fine as one tile each; a longer
    // survey (this is what a 15+ question Event Feedback form needs) gets
    // the curated highlights view instead of a wall of "no responses yet"
    // cards — see SurveyHighlights above.
    const useDashboard = (state.questions?.length || 0) > 6
    return <><Brand state={state} settings={settings}/><div className="flb-content">{state.questions?.length ? <><Kicker>Live so far</Kicker><h1 className="flb-headline flb-result-title">{title}</h1>{useDashboard ? <SurveyDashboard state={state}/> : <SurveySummaryGrid state={state}/>}<RegisteredProgressBanner state={state}/></> : <EmptyState title="Waiting on the first response"/>}</div><Footer left={`${state.response_count || 0} responses across ${state.questions?.length || 0} questions`} right="Results live" live/></>
  }

  if (scene === 'survey_insights' && ['survey', 'feedback'].includes(state.type)) return <SurveyInsightsScene state={state} settings={settings}/>

  if (scene === 'results') return <><Brand state={state} settings={settings}/><div className="flb-content">{currentQuestion ? <><Kicker>The room has spoken</Kicker><h1 className="flb-headline flb-result-title">{currentQuestion.prompt}</h1><ResultsVisual question={currentQuestion}/></> : <EmptyState title="Results are ready when the room is"/>}</div><Footer left={`${currentQuestion?.response_count || 0} verified responses`} right="Results live" live/></>

  if (scene === 'correct_answer') return <><Brand state={state} settings={settings}/><div className="flb-content">{currentQuestion ? <><Kicker>Smart reveal</Kicker><h1 className="flb-headline flb-small">{correctLabels.join(', ') || 'Answer revealed'}</h1><div className="flb-answer flb-glass"><div className="flb-check">✓</div><div><h2>{questionResponseRate}% of connected participants responded</h2><p>{currentQuestion.explanation || 'The explanation and source are now available on each participant’s phone.'}</p></div></div></> : <EmptyState/>}</div><Footer left="Accuracy, speed and confidence captured" right="Answer revealed"/></>

  if (scene === 'leaderboard') return <><Brand state={state} settings={settings}/><div className="flb-content"><Kicker>The race is close</Kicker><h1 className="flb-headline flb-small">Who moved up?</h1>{state.leaderboard?.length ? <div className="flb-leaders">{state.leaderboard.slice(0, 5).map((entry, i) => <div className="flb-leader" key={entry.participant_id}><strong>{String(entry.rank).padStart(2, '0')}</strong><i>{entry.display_name.slice(0, 2).toUpperCase()}</i><span>{entry.display_name}{i === 0 && <small> New leader</small>}</span><b>{entry.score.toLocaleString()} pts</b></div>)}</div> : <EmptyState title="Scores are building" copy="The leaderboard appears after scored answers arrive."/>}</div><Footer left="Privacy-safe display names" right={`${state.leaderboard?.length || 0} ranked`}/></>

  if (scene === 'team_battle') return <><Brand state={state} settings={settings}/><div className="flb-content"><Kicker>Collective challenge</Kicker><h1 className="flb-headline flb-small">One answer can change everything.</h1><div className="flb-teams">{teams.slice(0, 2).map((team, i) => <div className="flb-team flb-glass" key={i}><span>{i ? '⚡' : '◈'}</span><h2>{settings.team_names?.[i] || team.name}</h2><strong>{team.score.toLocaleString()}</strong><div><i style={{ width: `${clamp(team.score / Math.max(1, ...teams.map((t) => t.score)) * 100, 5, 100)}%` }}/></div><small>{team.players} players</small></div>)}</div></div><Footer left="Accuracy, speed and participation combine" right="Team mode" live/></>

  if (scene === 'rating') {
    const average = currentQuestion?.average_rating
    const scaleMax = currentQuestion?.question_type === 'rating_10' || currentQuestion?.question_type === 'nps' ? 10 : 5
    const scaleMin = currentQuestion?.question_type === 'nps' ? 0 : 1
    const hasDistribution = currentQuestion && Object.keys(currentQuestion.value_counts || {}).length > 0
    return <><Brand state={state} settings={settings}/><div className="flb-content"><Kicker>A five-second check-in</Kicker><h1 className="flb-headline flb-small">{currentQuestion?.prompt || settings.message || 'How useful was this session?'}</h1>{scaleMax === 5 ? <StarRating average={average || 0} max={5}/> : <div className="flb-rating">{Array.from({ length: scaleMax - scaleMin + 1 }, (_, i) => i + scaleMin).map((n) => <span className={average != null && n === Math.round(average) ? 'selected' : ''} key={n}>{n}</span>)}</div>}<div className="flb-scale"><span>Not useful</span><span>Extremely useful</span></div>{hasDistribution && <RatingDistribution valueCounts={currentQuestion.value_counts} max={scaleMax} min={scaleMin}/>}</div><Footer left={average ? `Live average ${average.toFixed(1)} from ${currentQuestion.response_count} ratings` : 'Responses can be anonymous'} right="Rating open" live/></>
  }

  if (scene === 'feedback') return <><Brand state={state} settings={settings}/><div className="flb-content"><Kicker>Turn insight into action</Kicker><h1 className="flb-headline flb-small">{currentQuestion?.prompt || settings.message || 'What will you do differently after today?'}</h1><div className="flb-feedback"><div className="flb-glass"><span>Live response stream</span><p>Thoughtful responses appear after moderation.</p></div><div className="flb-glass"><span>Completion</span><strong>{questionResponseRate}%</strong><p>{currentQuestion?.response_count || 0} responses</p></div></div></div><Footer left="Sensitive responses remain private" right="Listening" live/></>

  if (scene === 'live_spectrum') return <SpectrumScene state={state} settings={settings} currentQuestion={currentQuestion}/>

  if (scene === 'interactive_quadrant') return <QuadrantScene state={state} settings={settings} currentQuestion={currentQuestion}/>

  if (scene === 'image_heatmap') return <ImageHeatmapScene state={state} settings={settings} currentQuestion={currentQuestion}/>

  if (scene === 'ranking_race') return <RankingRaceScene state={state} settings={settings} currentQuestion={currentQuestion}/>

  if (scene === 'prediction_reveal') return <PredictionRevealScene state={state} settings={settings} currentQuestion={currentQuestion}/>

  if (scene === 'commitment_wall') return <CommitmentWallScene state={state} settings={settings} currentQuestion={currentQuestion}/>

  if (scene === 'photo_mosaic') return <PhotoMosaicScene state={state} settings={settings}/>

  if (scene === 'location_map') return <LocationMapScene state={state} settings={settings}/>

  if (scene === 'journey_recap') return <JourneyRecapScene state={state} settings={settings}/>

  if (scene === 'spotlight_wheel') return <SpotlightWheelScene state={state} settings={settings}/>

  if (scene === 'word_cloud') {
    const max = Math.max(1, ...cloud.map((item) => item.count))
    return <><Brand state={state} settings={settings}/><div className="flb-content"><div className="flb-cloud">{cloud.slice(0, 24).map((item, i) => <span style={{ fontSize: `${1.2 + (item.count / max) * 3.5}cqw` }} key={`${item.word}-${i}`}>{item.word}</span>)}</div></div><Footer left={`${currentQuestion?.response_count || state.response_count || 0} responses · automatically grouped`} right="Updating live" live/></>
  }

  if (scene === 'q_and_a') return <><Brand state={state} settings={settings}/><div className="flb-content">{featured ? <><Kicker>The room’s top question</Kicker><div className="flb-qna flb-glass"><blockquote>{featured.text}</blockquote><div><span>Audience question</span><strong>▲ {featured.upvote_count} upvotes</strong></div></div><p className="flb-subhead">Related questions can be merged by the moderator so strong ideas rise together.</p></> : <EmptyState title="Questions are coming in" copy="A moderator can feature the next question at any time."/>}</div><Footer left="Moderator-approved audience Q&A" right={featured ? 'Speaker view ready' : 'Listening'} live/></>

  if (scene === 'room_pulse') return <><Brand state={state} settings={settings}/><div className="flb-content"><Kicker>Know the room, not just the answers</Kicker><h1 className="flb-headline flb-small">Audience energy is <span className="flb-gradient">{pulse.energy > 70 ? 'rising.' : 'building.'}</span></h1><div className="flb-pulse"><div className="flb-energy flb-glass"><div><strong>{pulse.energy || 0}</strong><small>/100</small></div><p>Live energy score</p></div><div className="flb-signals"><div className="flb-glass"><span>Participation</span><strong>{pulse.participation_percent || 0}%</strong><small>{pulse.responses || 0} current responses</small></div><div className="flb-glass"><span>Sentiment</span><strong>{pulse.sentiment || 'Gathering'}</strong><small>From analyzed feedback</small></div><div className="flb-glass"><span>Consensus</span><strong>{pulse.consensus_percent || 0}%</strong><small>Top response share</small></div><div className="flb-glass"><span>Connected</span><strong>{state.participant_count || 0}</strong><small>Active participants</small></div></div></div></div><Footer left="Privacy-safe aggregate — no individual profiling" right="Room pulse" live/></>

  if (scene === 'ai_insight') return <><Brand state={state} settings={settings}/><div className="flb-content">{insight ? <><Kicker>Hundreds of voices, one clear picture</Kicker><h1 className="flb-headline flb-small">What the room is really saying</h1><div className="flb-insights"><div className="flb-glass"><span>✦ Themes emerging</span>{themes.slice(0, 3).map((theme, i) => <div className="flb-topic" key={theme}><div><span>{theme}</span><b>{Math.max(20, 48 - i * 11)}%</b></div><i><b style={{ width: `${Math.max(20, 48 - i * 11)}%` }}/></i></div>)}</div><div className="flb-glass"><span>Shared insight</span><h3>{insight.summary}</h3><p>AI-generated synthesis. Source responses remain available to authorized staff.</p></div></div></> : <EmptyState title="Festio Intelligence is listening" copy="Run AI analysis from Analytics to project a privacy-safe synthesis."/>}</div><Footer left="AI-generated · source responses remain inspectable" right={insight ? `Sentiment ${insight.sentiment || 'mixed'}` : 'Awaiting analysis'}/></>

  if (scene === 'idea_galaxy') return <><Brand state={state} settings={settings}/><div className="flb-content"><Kicker>Collective intelligence, made visible</Kicker><div className="flb-galaxy">{cloud.slice(0, 10).map((item, i) => <span className={i < 2 ? 'large' : ''} style={{ '--x': `${8 + ((i * 23) % 78)}%`, '--y': `${8 + ((i * 37) % 72)}%`, '--delay': `${-i * .4}s` }} key={item.word}>{item.word}</span>)}</div></div><Footer left="Nearby ideas share meaning and momentum" right={`${cloud.length} ideas clustered`} live/></>

  if (scene === 'announcement') return <><Brand state={state} settings={settings}/><div className="flb-content"><div className="flb-announcement"><div>↗</div><div><Kicker>{settings.kicker || 'Event update'}</Kicker><h1 className="flb-headline flb-small">{settings.message || 'The next session begins shortly.'}</h1><p className="flb-subhead">{settings.subtitle || 'Check your event schedule for the latest room and accessibility information.'}</p></div></div></div><Footer left="Posted by Event Operations" right={settings.status_label || 'Important update'}/></>

  if (scene === 'break') {
    const agenda = settings.agenda || []
    const nextSession = agenda.find((item) => !item.live) || agenda[1] || agenda[0]
    return <><Brand state={state} settings={settings}/><div className="flb-content"><div className="flb-break"><div><Kicker>We’ll be right back</Kicker><h1 className="flb-headline">{settings.title || 'Stretch. Connect.'} <span className="flb-gradient">Recharge.</span></h1><p className="flb-subhead">{settings.message || 'Refreshments and quiet space are available in the lobby.'}</p></div><div className="flb-upnext flb-glass"><strong>{settings.status_label || nextSession?.time || 'Soon'}</strong><span>{settings.status_label ? 'until we resume' : 'scheduled start'}</span><h3>Up next</h3><p>{nextSession?.title || state.title}</p><small>{nextSession?.speaker || nextSession?.room || 'Live captioning available'}</small></div></div></div><Footer left="The display resumes automatically" right="Intermission"/></>
  }

  if (scene === 'countdown') return <><Brand state={state} settings={settings}/><div className="flb-content flb-center"><div className="flb-countdown flb-gradient">{String(Math.floor(countdown / 60)).padStart(2, '0')}:{String(countdown % 60).padStart(2, '0')}</div><div className="flb-count-label">Until we begin together</div><p className="flb-subhead">{state.participant_count || 0} people are connected. Join now to take part.</p></div><Footer left="Live captions and interpretation available" right="Starting soon" live/></>

  if (scene === 'all_results') return <FinalResultsScene state={state} settings={settings}/>

  if (scene === 'celebration' && state.display_config?.show_mode === 'guided' && state.display_config?.show_phase === 'complete') return <FinalResultsScene state={state} settings={settings}/>

  if (scene === 'celebration') return <><div className="flb-confetti">{Array.from({ length: 28 }, (_, i) => <i style={{ '--x': `${3 + i * 3.6}%`, '--delay': `${-i * .27}s` }} key={i}/>)}</div><Brand state={state} settings={settings}/><div className="flb-content flb-center"><div className="flb-trophy">◆</div><Kicker>{settings.kicker || 'Collective milestone unlocked'}</Kicker><h1 className="flb-headline flb-gradient">{settings.title || `${state.response_count || 0} ideas shared!`}</h1><p className="flb-subhead">{settings.message || 'This room just turned participation into shared momentum.'}</p></div><Footer left="Every contribution helped reach this moment" right="Celebrate" live/></>

  return <><Brand state={state} settings={settings}/><div className="flb-content"><div className="flb-custom flb-glass"><Kicker>{settings.kicker || 'A message from your hosts'}</Kicker><h1 className="flb-headline">{settings.title || 'Thank you for building the future'} <span className="flb-gradient">with us.</span></h1><p className="flb-subhead">{settings.message || subtitle}</p></div></div><Footer left={settings.event_name || state.title} right={settings.status_label || 'Feedback open'} live/></>
}

export default function LiveBroadcastCanvas({ state, connected = true, onPresent }) {
  const display = state.display || {}
  const settings = display.settings || {}
  const scene = resolveScene(display.scene || state.display_config?.display_scene || 'welcome', state, settings)
  const currentQuestion = useMemo(() => state.questions?.find((q) => q.question_id === (settings.results_question_id || state.current_question_id)), [state.questions, state.current_question_id, settings.results_question_id])
  const [countdown, setCountdown] = useState(settings.countdown_seconds ?? 298)
  const [clock, setClock] = useState(Date.now())

  useEffect(() => { setCountdown(settings.countdown_seconds ?? 298) }, [settings.countdown_seconds, display.id])
  useEffect(() => {
    if (scene !== 'countdown' || countdown <= 0) return undefined
    const timer = setInterval(() => setCountdown((value) => Math.max(0, value - 1)), 1000)
    return () => clearInterval(timer)
  }, [scene, countdown])
  useEffect(() => {
    if (!(state.display_config?.show_automation_enabled && state.display_config?.show_phase_deadline_at) && (scene !== 'responding' || !currentQuestion?.time_limit_seconds || !currentQuestion?.opened_at)) return undefined
    const timer = setInterval(() => setClock(Date.now()), 250)
    return () => clearInterval(timer)
  }, [scene, currentQuestion?.question_id, currentQuestion?.time_limit_seconds, currentQuestion?.opened_at, state.display_config?.show_automation_enabled, state.display_config?.show_phase_deadline_at])
  const phaseSeconds = state.display_config?.show_automation_enabled && state.display_config?.show_phase_deadline_at
    ? Math.max(0, Math.ceil((new Date(state.display_config.show_phase_deadline_at).getTime() - clock) / 1000))
    : null
  const questionSeconds = currentQuestion?.time_limit_seconds && currentQuestion?.opened_at
    ? Math.max(0, Math.ceil(currentQuestion.time_limit_seconds - (clock - new Date(currentQuestion.opened_at).getTime()) / 1000))
    : phaseSeconds

  return <div className="flb-root">
    <div className={`flb-screen flb-${settings.theme || 'aurora'} flb-scene-${scene.replaceAll('_', '-')} ${settings.motion === false ? 'flb-motion-off' : ''} ${settings.safe_area ? 'flb-safe' : ''}`}>
      <div className="flb-orb flb-orb-a"/><div className="flb-orb flb-orb-b"/><div className="flb-noise"/>
      <SceneContent scene={scene} state={state} settings={settings} currentQuestion={currentQuestion} countdown={countdown} questionSeconds={questionSeconds}/>
      {phaseSeconds != null && <div className="flb-auto-clock"><span>Auto</span><strong>{phaseSeconds}s</strong><small>next scene</small></div>}
      {!connected && <div className="flb-offline">Reconnecting · showing the last verified state</div>}
    </div>
    <button type="button" className="flb-present" onClick={onPresent} aria-label="Enter fullscreen presentation">Present ↗</button>
  </div>
}
