import { useState, useEffect } from 'react'
import RedesignShell, { Icon, Modal, ConfirmDialog, ChannelPreviewFrame } from './redesign/RedesignShell'
import { LoadingSkeleton, PermissionDeniedState } from './redesign/RedesignPrimitives'
import { useCurrentEvent } from '../hooks/useCurrentEvent'
import { useEventDetails } from '../hooks/useEventDetails'
import { useGuests } from '../hooks/useGuests'
import { api } from '../api'
import './ExperienceRedesignPage.css'

const FAILED = Symbol('experience-action-failed')

const STEP_PRESETS = [
  { key: 'feedback_prompt', type: 'feedback', title: 'Feedback', description: 'Invite attendees to share feedback after the event.', required: false, config: { owner: 'guest', messages: { guest: 'Please take a moment to share your feedback.', complete: 'Thank you for sharing your feedback.' }, feedback: { audience: 'all', anonymous: false, questions: [{ id: 'overall_rating', type: 'rating', prompt: 'How would you rate your overall experience?', required: true }, { id: 'recommend', type: 'nps', prompt: 'How likely are you to recommend this event?', required: true }, { id: 'comments', type: 'text', prompt: 'What should we keep or improve?', required: false }] } } },
  { key: 'rsvp_approved', type: 'custom', title: 'RSVP approved', description: 'Guest has confirmed attendance and passed host approval.', required: true, config: { owner: 'host', source: 'guest_rsvp', visible_to_staff: true } },
  { key: 'main_check_in', type: 'check_in', title: 'Main entrance check-in', description: 'Admit the guest using their QR code or manual lookup.', required: true, config: { station: 'main_entrance', allow_manual_lookup: true, requires_event_pass: true } },
  { key: 'consent', type: 'consent', title: 'Consent', description: 'Guest signs the event consent form from their Festio Pass.', required: true, config: { owner: 'guest', guest_action: 'sign_consent', visible_to_staff: true, messages: { guest: 'Please review and sign the consent form from your Festio Pass before collecting gifts or souvenirs.', staff: 'Ask the guest to open their Festio Pass and sign the consent form.', complete: 'Consent signed.' } } },
  { key: 'seat_confirmed', type: 'seating_assignment', title: 'Seat confirmed', description: 'Confirm the guest table and seat before sending them into the dining area.', required: true, config: { show_table_name: true, show_seat_number: true } },
  { key: 'meal_confirmed', type: 'meal_selection', title: 'Meal confirmed', description: 'Confirm catering has the guest meal choice or dietary note.', required: false, config: { allow_staff_note: true, fallback_choice: 'Confirm at table' } },
  { key: 'welcome_pack', type: 'souvenir', title: 'Souvenir collected', description: 'Staff mark complete after consent is signed and the guest receives their souvenir, welcome pack, badge, or gift bag.', required: false, config: { station: 'gift_table', item: 'souvenir', prevent_duplicate_collection: true, depends_on: ['consent'], messages: { guest: 'Collect your souvenir after signing consent.', staff: 'Give the souvenir, welcome pack, badge, or gift bag, then mark this complete.', complete: 'Souvenir collected.' } } },
  { key: 'vip_host_greeting', type: 'custom', title: 'Host greeting complete', description: 'Mark complete after the host or protocol team has greeted the guest.', required: false, conditions: { guest_tags_include: ['vip'] }, config: { owner: 'protocol_team', staff_prompt: 'Notify host before marking this complete.' } },
  { key: 'badge_pickup', type: 'badge', title: 'Badge pickup', description: 'Confirm badge, wristband, or credential pickup.', required: false, config: { station: 'registration' } },
  { key: 'session_attendance', type: 'session_attendance', title: 'Session attendance', description: 'Track guest attendance for a program segment or breakout.', required: false, config: { station: 'session_entry', session: { topic: 'Program session', date: '', start_time: '', end_time: '', room: '', speaker: '', capacity: null }, messages: { guest: 'Please proceed to the scheduled session and show your Festio Pass at the entrance.', staff: 'Confirm the guest is entering the correct session, then mark attendance complete.', complete: 'Session attendance recorded.' } } },
  { key: 'departure_noted', type: 'checkout', title: 'Departure noted', description: 'Mark complete when valet, transport, or guest departure is handled.', required: false, config: { station: 'exit', allow_note: true } },
]
const STEP_PRESET_BY_KEY = Object.fromEntries(STEP_PRESETS.map((preset) => [preset.key, preset]))

const WORKFLOW_TEMPLATES = [
  { id: 'vip_dinner', name: 'VIP Dinner Guest Journey', label: 'VIP dinner', description: 'RSVP approval, arrival, consent, seating, meal, souvenir, VIP greeting, and departure.', stepKeys: ['rsvp_approved', 'main_check_in', 'consent', 'seat_confirmed', 'meal_confirmed', 'welcome_pack', 'vip_host_greeting', 'departure_noted'] },
  { id: 'conference_registration', name: 'Conference Registration Journey', label: 'Conference', description: 'Registration desk flow with badge pickup, check-in, session attendance, and checkout.', stepKeys: ['rsvp_approved', 'badge_pickup', 'main_check_in', 'session_attendance', 'departure_noted'] },
  { id: 'wedding_reception', name: 'Wedding Reception Journey', label: 'Wedding reception', description: 'Guest admission, consent, table confirmation, meal handling, and gift pickup.', stepKeys: ['main_check_in', 'consent', 'seat_confirmed', 'meal_confirmed', 'welcome_pack'] },
  { id: 'simple_checkin', name: 'Simple Check-in Journey', label: 'Simple check-in', description: 'A minimal operational workflow for events that only need arrival tracking.', stepKeys: ['main_check_in'] },
]

const SUBTABS = ['Setup', 'Workflow', 'Guests', 'Consent', 'Feedback', 'Messages', 'Analytics']
const STATUS_FILTERS = ['All', 'Live', 'Draft', 'Archived']


const STEP_TYPES = [
  ['custom', 'Custom'], ['check_in', 'Check-in'], ['consent', 'Consent'], ['seating_assignment', 'Seating assignment'],
  ['meal_selection', 'Meal selection'], ['souvenir', 'Souvenir'], ['badge', 'Badge'], ['room_assignment', 'Room assignment'],
  ['session_attendance', 'Session attendance'], ['certificate', 'Certificate'], ['checkout', 'Checkout'],
  ['feedback', 'Feedback'], ['rsvp', 'RSVP'], ['approval', 'Approval'],
]

const STEP_TYPE_ICON = {
  check_in: 'ticket', consent: 'file', seating_assignment: 'chair', room_assignment: 'chair',
  meal_selection: 'card', souvenir: 'image', badge: 'shield', session_attendance: 'users',
  certificate: 'book', checkout: 'check', feedback: 'chat', rsvp: 'send', approval: 'lock', custom: 'file',
}
function stepTypeIcon(type) { return STEP_TYPE_ICON[type] || 'file' }

const FEEDBACK_QUESTION_TYPES = [
  ['rating', 'Rating (1–5)'], ['nps', 'Recommendation (0–10)'], ['single_choice', 'Multiple choice'],
  ['multi_choice', 'Choose multiple'], ['yes_no', 'Yes / No'], ['text', 'Written comments'],
]
const FEEDBACK_TYPE_LABELS = { rating: 'Rating', nps: 'NPS', single_choice: 'Single choice', multi_choice: 'Multi choice', yes_no: 'Yes/No', text: 'Text' }
function feedbackTypeLabel(t) { return FEEDBACK_TYPE_LABELS[t] || t }

function blankStepForm() {
  return {
    id: null, key: '', type: 'custom', title: '', description: '', sort_order: 0, required: true, enabled: true, depends_on: '',
    guest_message: '', staff_prompt: '', completion_message: '',
    session_topic: '', session_date: '', session_start_time: '', session_end_time: '', session_room: '', session_speaker: '', session_capacity: '', session_checkin_window_minutes: '',
    room_assignment_mode: 'global', room_assignment_scope: '', room_assignment_room: '', room_assignment_table_group: '',
    feedback_audience: 'all', feedback_session_step_id: '', feedback_anonymous: false, feedback_status: 'open',
    feedback_opens_at: '', feedback_closes_at: '', feedback_allow_edit: true, feedback_questions: [],
    program_is_segment: false, program_start_offset_seconds: '', program_duration_seconds: '', program_category: '',
    program_announce_enabled: false, program_announce_title: '', program_announce_body: '',
    program_feedback_step_key: '', program_feedback_window_seconds: '1800',
    conditions: '', config: '',
  }
}

function listValue(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.map((value) => String(value).trim()).filter(Boolean)
  return String(raw).split(',').map((value) => value.trim()).filter(Boolean)
}
function listText(raw) { return listValue(raw).join(', ') }
function toggleListText(raw, value) {
  const values = new Set(listValue(raw))
  values.has(value) ? values.delete(value) : values.add(value)
  return [...values].join(', ')
}
function parseJsonMaybe(raw, label) {
  const text = String(raw || '').trim()
  if (!text) return null
  try { return JSON.parse(text) } catch { throw new Error(`${label} must be valid JSON`) }
}
function normalizeSessionConfig(config = {}) {
  const raw = config.session || config.session_details || config.schedule || config.session_config
  const first = Array.isArray(config.sessions) ? config.sessions[0] : null
  const source = (raw && typeof raw === 'object' ? raw : null) || (first && typeof first === 'object' ? first : null) || {}
  return {
    topic: source.topic || source.title || source.name || '', date: source.date || source.session_date || '',
    start_time: source.start_time || source.startTime || source.start || '', end_time: source.end_time || source.endTime || source.end || '',
    room: source.room || source.location || source.venue || '', speaker: source.speaker || source.host || source.presenter || '',
    capacity: source.capacity ?? '', checkin_window_minutes: source.checkin_window_minutes ?? source.checkInWindowMinutes ?? source.checkin_window ?? '',
  }
}
function normalizeRoomAssignmentConfig(config = {}) {
  const source = (config.room_assignment && typeof config.room_assignment === 'object')
    ? config.room_assignment : (config.assignment && typeof config.assignment === 'object') ? config.assignment : config
  const mode = source.mode || source.assignment_mode || (source.scoped || source.scope || source.assignment_scope ? 'scoped' : 'global')
  return {
    mode: String(mode || 'global').toLowerCase(), scope: source.assignment_scope || source.scope || '',
    room: source.room || source.hall || source.location || '', table_group: source.table_group || source.table_group_name || source.group || '',
  }
}
function stepPresetPayload(preset, sortOrder) {
  return {
    key: preset.key, type: preset.type, title: preset.title, description: preset.description, sort_order: sortOrder,
    required: preset.required, enabled: true, conditions: preset.conditions || null, config: preset.config || null,
  }
}

function statusPillClass(status) {
  if (status === 'published') return 'rr-pill live'
  if (status === 'draft') return 'rr-pill draft'
  return 'rr-pill archived'
}
function statusLabel(status) {
  if (status === 'published') return 'Live'
  if (status === 'draft') return 'Draft'
  return 'Archived'
}
function filterMatchesStatus(status, filter) {
  if (filter === 'All') return true
  if (filter === 'Live') return status === 'published'
  if (filter === 'Draft') return status === 'draft'
  if (filter === 'Archived') return status === 'archived'
  return true
}

function StepField({ label, hint, children, wide = false }) {
  return <label className={`ex-editor-field${wide ? ' wide' : ''}`}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
}

function ExperienceStepEditor({ form, setForm, steps, busy, onClose, onSave }) {
  const dependencyChoices = steps.filter((step) => step.id !== form.id && step.key !== form.key)
  const sessionChoices = steps.filter((step) => step.type === 'session_attendance')
  const feedbackChoices = steps.filter((step) => step.type === 'feedback' && step.id !== form.id)
  const patch = (next) => setForm((current) => ({ ...current, ...next }))
  const updateQuestion = (index, next) => setForm((current) => ({
    ...current,
    feedback_questions: current.feedback_questions.map((question, questionIndex) => questionIndex === index ? { ...question, ...next } : question),
  }))
  const moveQuestion = (index, direction) => setForm((current) => {
    const questions = [...current.feedback_questions]
    const target = index + direction
    if (target < 0 || target >= questions.length) return current
    ;[questions[index], questions[target]] = [questions[target], questions[index]]
    return { ...current, feedback_questions: questions }
  })

  return (
    <aside className="rr-panel ex-step-editor">
      <div className="ex-step-editor-head">
        <div><span className="ex-step-icon"><Icon name={stepTypeIcon(form.type)} size={14}/></span><div><h3>{form.id ? form.title || 'Edit step' : 'Add step'}</h3><p>Workflow step settings</p></div></div>
        <button type="button" className="rr-link-btn" onClick={onClose}>Close ✕</button>
      </div>
      <div className="ex-step-editor-scroll">
        <section className="ex-editor-section">
          <div className="ex-editor-section-title"><strong>Identity &amp; order</strong><span>How this step is stored and shown</span></div>
          <div className="ex-editor-grid">
            <StepField label="Key"><input className="rr-input" aria-label="Step key" value={form.key} onChange={(event) => patch({ key: event.target.value })} placeholder="main_checkin"/></StepField>
            <StepField label="Type"><select className="rr-select" aria-label="Step type" value={form.type} onChange={(event) => patch({ type: event.target.value })}>{STEP_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></StepField>
            <StepField label="Title"><input className="rr-input" aria-label="Step title" value={form.title} onChange={(event) => patch({ title: event.target.value })}/></StepField>
            <StepField label="Sort order"><input className="rr-input" aria-label="Sort order" type="number" value={form.sort_order} onChange={(event) => patch({ sort_order: event.target.value })}/></StepField>
            <StepField label="Description" wide><textarea className="rr-textarea" rows={2} value={form.description} onChange={(event) => patch({ description: event.target.value })}/></StepField>
          </div>
          <div className="ex-editor-toggle-row">
            <label><input type="checkbox" checked={form.required} onChange={(event) => patch({ required: event.target.checked })}/> Required</label>
            <label><input type="checkbox" checked={form.enabled} onChange={(event) => patch({ enabled: event.target.checked })}/> Enabled</label>
          </div>
        </section>

        <section className="ex-editor-section">
          <div className="ex-editor-section-title"><strong>Step dependencies</strong><span>Require earlier steps before this becomes available</span></div>
          <div className="ex-dependency-pills">
            {!dependencyChoices.length && <small>No other steps are available yet.</small>}
            {dependencyChoices.map((step) => {
              const checked = listValue(form.depends_on).includes(step.key)
              return <label className={checked ? 'on' : ''} key={step.id}><input type="checkbox" checked={checked} onChange={() => patch({ depends_on: toggleListText(form.depends_on, step.key) })}/>{step.title}</label>
            })}
          </div>
        </section>

        <section className="ex-editor-section">
          <div className="ex-editor-section-title"><strong>Step messages</strong><span>Guest, scanner, and completion guidance</span></div>
          <StepField label="Guest message"><textarea className="rr-textarea" rows={3} value={form.guest_message} onChange={(event) => patch({ guest_message: event.target.value })} placeholder="What guests should see"/></StepField>
          <StepField label="Staff scanner prompt"><textarea className="rr-textarea" rows={3} value={form.staff_prompt} onChange={(event) => patch({ staff_prompt: event.target.value })} placeholder="What staff should do"/></StepField>
          <StepField label="Completion message"><textarea className="rr-textarea" rows={3} value={form.completion_message} onChange={(event) => patch({ completion_message: event.target.value })} placeholder="What appears after completion"/></StepField>
        </section>

        <section className="ex-editor-section accent">
          <div className="ex-editor-section-title with-control"><div><strong>Live Program timing</strong><span>Optional timed program segment</span></div><label><input type="checkbox" checked={form.program_is_segment} onChange={(event) => patch({ program_is_segment: event.target.checked })}/> Include</label></div>
          {form.program_is_segment && <div className="ex-editor-grid">
            <StepField label="Start offset (seconds)"><input className="rr-input" type="number" min="0" value={form.program_start_offset_seconds} onChange={(event) => patch({ program_start_offset_seconds: event.target.value })}/></StepField>
            <StepField label="Duration (seconds)"><input className="rr-input" type="number" min="1" value={form.program_duration_seconds} onChange={(event) => patch({ program_duration_seconds: event.target.value })}/></StepField>
            <StepField label="Category"><input className="rr-input" value={form.program_category} onChange={(event) => patch({ program_category: event.target.value })} placeholder="Main session"/></StepField>
            <StepField label="Feedback after segment"><select className="rr-select" value={form.program_feedback_step_key} onChange={(event) => patch({ program_feedback_step_key: event.target.value })}><option value="">No feedback prompt</option>{feedbackChoices.map((step) => <option value={step.key} key={step.id}>{step.title}</option>)}</select></StepField>
            {form.program_feedback_step_key && <StepField label="Feedback window (seconds)"><input className="rr-input" type="number" min="60" value={form.program_feedback_window_seconds} onChange={(event) => patch({ program_feedback_window_seconds: event.target.value })}/></StepField>}
            <StepField label="Announcement" wide><label className="ex-inline-check"><input type="checkbox" checked={form.program_announce_enabled} onChange={(event) => patch({ program_announce_enabled: event.target.checked })}/> Announce when this segment starts</label></StepField>
            {form.program_announce_enabled && <><StepField label="Announcement title" wide><input className="rr-input" value={form.program_announce_title} onChange={(event) => patch({ program_announce_title: event.target.value })}/></StepField><StepField label="Announcement message" wide><textarea className="rr-textarea" rows={2} value={form.program_announce_body} onChange={(event) => patch({ program_announce_body: event.target.value })}/></StepField></>}
          </div>}
        </section>

        {form.type === 'session_attendance' && <section className="ex-editor-section">
          <div className="ex-editor-section-title"><strong>Session details</strong><span>Schedule, location, capacity, and check-in window</span></div>
          <div className="ex-editor-grid">
            <StepField label="Topic" wide><input className="rr-input" value={form.session_topic} onChange={(event) => patch({ session_topic: event.target.value })}/></StepField>
            <StepField label="Date"><input className="rr-input" type="date" value={form.session_date} onChange={(event) => patch({ session_date: event.target.value })}/></StepField>
            <StepField label="Capacity"><input className="rr-input" type="number" min="0" value={form.session_capacity} onChange={(event) => patch({ session_capacity: event.target.value })}/></StepField>
            <StepField label="Start time"><input className="rr-input" type="time" value={form.session_start_time} onChange={(event) => patch({ session_start_time: event.target.value })}/></StepField>
            <StepField label="End time"><input className="rr-input" type="time" value={form.session_end_time} onChange={(event) => patch({ session_end_time: event.target.value })}/></StepField>
            <StepField label="Room / location"><input className="rr-input" value={form.session_room} onChange={(event) => patch({ session_room: event.target.value })}/></StepField>
            <StepField label="Check-in opens (minutes before)" hint="Leave blank for no time gate."><input className="rr-input" type="number" min="0" value={form.session_checkin_window_minutes} onChange={(event) => patch({ session_checkin_window_minutes: event.target.value })}/></StepField>
            <StepField label="Speaker / host" wide><input className="rr-input" value={form.session_speaker} onChange={(event) => patch({ session_speaker: event.target.value })}/></StepField>
          </div>
        </section>}

        {form.type === 'room_assignment' && <section className="ex-editor-section">
          <div className="ex-editor-section-title"><strong>Room assignment</strong><span>Use scoped seating for separate halls or sessions</span></div>
          <div className="ex-editor-grid">
            <StepField label="Assignment mode"><select className="rr-select" value={form.room_assignment_mode} onChange={(event) => patch({ room_assignment_mode: event.target.value })}><option value="global">Main guest seat</option><option value="scoped">Separate seat for this step</option></select></StepField>
            <StepField label="Assignment scope" hint="Required for scoped seating."><input className="rr-input" value={form.room_assignment_scope} onChange={(event) => patch({ room_assignment_scope: event.target.value })} placeholder="saturday_luncheon"/></StepField>
            <StepField label="Room / hall"><input className="rr-input" value={form.room_assignment_room} onChange={(event) => patch({ room_assignment_room: event.target.value })}/></StepField>
            <StepField label="Table group"><input className="rr-input" value={form.room_assignment_table_group} onChange={(event) => patch({ room_assignment_table_group: event.target.value })}/></StepField>
          </div>
        </section>}

        {form.type === 'feedback' && <section className="ex-editor-section feedback">
          <div className="ex-editor-section-title with-control"><div><strong>Feedback form</strong><span>Audience, availability, and questions</span></div><button type="button" className="rr-btn secondary" onClick={() => patch({ feedback_questions: [...form.feedback_questions, { id: `question_${form.feedback_questions.length + 1}`, type: 'rating', prompt: '', required: true, options: [] }] })}><Icon name="plus" size={11}/> Question</button></div>
          <div className="ex-editor-grid">
            <StepField label="Audience"><select className="rr-select" value={form.feedback_audience} onChange={(event) => patch({ feedback_audience: event.target.value })}><option value="all">All guests with a Festio Pass</option><option value="checked_in">Checked-in guests only</option><option value="session">Guests who attended a session</option></select></StepField>
            <StepField label="Form status"><select className="rr-select" value={form.feedback_status} onChange={(event) => patch({ feedback_status: event.target.value })}><option value="open">Open</option><option value="closed">Closed</option></select></StepField>
            {form.feedback_audience === 'session' && <StepField label="Attendance session" wide><select className="rr-select" value={form.feedback_session_step_id} onChange={(event) => patch({ feedback_session_step_id: event.target.value })}><option value="">Choose a session…</option>{sessionChoices.map((step) => <option key={step.id} value={step.id}>{step.title}</option>)}</select></StepField>}
            <StepField label="Opens at"><input className="rr-input" type="datetime-local" value={form.feedback_opens_at} onChange={(event) => patch({ feedback_opens_at: event.target.value })}/></StepField>
            <StepField label="Closes at"><input className="rr-input" type="datetime-local" value={form.feedback_closes_at} onChange={(event) => patch({ feedback_closes_at: event.target.value })}/></StepField>
          </div>
          <div className="ex-editor-toggle-row">
            <label><input type="checkbox" checked={form.feedback_anonymous} onChange={(event) => patch({ feedback_anonymous: event.target.checked })}/> Hide guest names</label>
            <label><input type="checkbox" checked={form.feedback_allow_edit} onChange={(event) => patch({ feedback_allow_edit: event.target.checked })}/> Allow response edits</label>
          </div>
          <div className="ex-feedback-questions">
            {!form.feedback_questions.length && <p>Add at least one feedback question.</p>}
            {form.feedback_questions.map((question, index) => <div className="ex-feedback-question" key={`${question.id}-${index}`}>
              <div className="ex-feedback-question-head"><strong>Question {index + 1}</strong><div><button type="button" disabled={index === 0} onClick={() => moveQuestion(index, -1)}>↑</button><button type="button" disabled={index === form.feedback_questions.length - 1} onClick={() => moveQuestion(index, 1)}>↓</button><button type="button" className="danger" onClick={() => patch({ feedback_questions: form.feedback_questions.filter((_, questionIndex) => questionIndex !== index) })}>Remove</button></div></div>
              <select className="rr-select" value={question.type || 'text'} onChange={(event) => updateQuestion(index, { type: event.target.value, options: ['single_choice', 'multi_choice'].includes(event.target.value) ? (question.options || []) : [] })}>{FEEDBACK_QUESTION_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
              <input className="rr-input" value={question.prompt || ''} onChange={(event) => updateQuestion(index, { prompt: event.target.value })} placeholder="Question shown to guests"/>
              {['single_choice', 'multi_choice'].includes(question.type) && <input className="rr-input" value={(question.options || []).join(', ')} onChange={(event) => updateQuestion(index, { options: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} placeholder="Choices separated by commas"/>}
              <input className="rr-input" value={question.help_text || ''} onChange={(event) => updateQuestion(index, { help_text: event.target.value })} placeholder="Optional help text"/>
              {index > 0 && <div className="ex-editor-grid"><StepField label="Conditional question"><select className="rr-select" value={question.show_if?.question_id || ''} onChange={(event) => updateQuestion(index, { show_if: { ...(question.show_if || {}), question_id: event.target.value } })}><option value="">Always show</option>{form.feedback_questions.slice(0, index).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.prompt || candidate.id}</option>)}</select></StepField>{question.show_if?.question_id && <StepField label="Answer equals"><input className="rr-input" value={question.show_if?.value || ''} onChange={(event) => updateQuestion(index, { show_if: { ...question.show_if, value: event.target.value } })}/></StepField>}</div>}
              <label className="ex-inline-check"><input type="checkbox" checked={!!question.required} onChange={(event) => updateQuestion(index, { required: event.target.checked })}/> Required question</label>
            </div>)}
          </div>
        </section>}

        <section className="ex-editor-section advanced">
          <div className="ex-editor-section-title"><strong>Advanced JSON</strong><span>Preserves custom legacy configuration</span></div>
          <StepField label="Conditions JSON"><textarea className="rr-textarea mono" rows={5} value={form.conditions} onChange={(event) => patch({ conditions: event.target.value })} placeholder='{"ticket_type":"vip"}'/></StepField>
          <StepField label="Config JSON"><textarea className="rr-textarea mono" rows={7} value={form.config} onChange={(event) => patch({ config: event.target.value })} placeholder='{"station":"north"}'/></StepField>
        </section>
      </div>
      <div className="ex-step-editor-footer">
        <button type="button" className="rr-btn secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="rr-btn primary" disabled={busy} onClick={onSave}>{busy ? 'Saving…' : form.id ? 'Save step' : 'Add step'}</button>
      </div>
    </aside>
  )
}

export default function ExperienceRedesignPage() {
  const [toast, setToast] = useState(null) // { text, error }
  const [selectedId, setSelectedId] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [activeTab, setActiveTab] = useState('Setup')
  const [feedbackSearch, setFeedbackSearch] = useState('')
  const [feedbackAdmitted, setFeedbackAdmitted] = useState('')
  const [signatureGuest, setSignatureGuest] = useState(null)
  const [previewMessage, setPreviewMessage] = useState(null)
  const [actionKey, setActionKey] = useState('') // in-flight mutation marker, e.g. "wfId:publish"

  const [currentEventId] = useCurrentEvent()

  // ── Stage A (already real, read-only) ───────────────────────────────────
  const [dashboard, setDashboard] = useState(null)
  const [analytics, setAnalytics] = useState(null)
  const [experienceAudit, setExperienceAudit] = useState(null)
  const [realSignatures, setRealSignatures] = useState(null)
  const [feedbackResults, setFeedbackResults] = useState(null)
  const [feedbackDenied, setFeedbackDenied] = useState(false)
  const [realTemplateAudit, setRealTemplateAudit] = useState(null)

  // ── Stage B (this pass — config/mutation state) ─────────────────────────
  const { event: realEvent, setEvent: setRealEvent, refresh: loadEvent } = useEventDetails(currentEventId)
  const [workflows, setWorkflows] = useState(null)
  const [stepForm, setStepForm] = useState(null)
  const [confirmWorkflow, setConfirmWorkflow] = useState(null) // { type: 'delete'|'archive', workflow }
  const [confirmStepDelete, setConfirmStepDelete] = useState(null)
  const [sessionImportOpen, setSessionImportOpen] = useState(false)
  const [sessionImportText, setSessionImportText] = useState('')
  const { guests: realGuests, loading: guestsLoading } = useGuests(currentEventId)
  const [selectedGuestId, setSelectedGuestId] = useState('')
  const [guestJourney, setGuestJourney] = useState(null)
  const [consentForm, setConsentForm] = useState(null)
  const [confirmDisableConsent, setConfirmDisableConsent] = useState(false)
  const [remindConfirm, setRemindConfirm] = useState(null) // { form, channels, preview }
  const [realTemplates, setRealTemplates] = useState(null)
  const [editingTemplate, setEditingTemplate] = useState(null)
  const [templateDraft, setTemplateDraft] = useState(null)
  const [confirmResetTemplate, setConfirmResetTemplate] = useState(null)

  function notify(message) {
    setToast({ text: message, error: false })
    window.setTimeout(() => setToast(null), 2600)
  }
  function notifyError(message) {
    setToast({ text: message, error: true })
    window.setTimeout(() => setToast(null), 4500)
  }

  // Single generic mutation runner: sets a busy key, awaits the real server
  // call, never flips UI state until the server has confirmed, and surfaces
  // real server errors via the toast instead of a canned success message.
  async function runAction(key, action, successMsg) {
    setActionKey(key)
    try {
      const result = await action()
      if (successMsg) notify(successMsg)
      return result === undefined ? true : result
    } catch (e) {
      notifyError(e?.message || 'Request failed')
      return FAILED
    } finally {
      setActionKey('')
    }
  }

  async function loadWorkflows(preferredId) {
    if (!currentEventId) return
    try {
      const data = await api.listExperienceWorkflows(currentEventId)
      setWorkflows(data)
      if (data.length) {
        const preferred = data.find((w) => w.id === preferredId)
        const current = data.find((w) => w.id === selectedId)
        const published = data.find((w) => w.status === 'published')
        setSelectedId((preferred || current || published || data[0]).id)
      } else {
        setSelectedId('')
      }
    } catch (e) {
      setWorkflows([])
      notifyError(e.message || 'Failed to load workflows')
    }
  }

  async function refreshDashboardAndAudit() {
    await Promise.all([
      api.getExperienceDashboard(currentEventId).then(setDashboard).catch(() => {}),
      api.getExperienceAnalytics(currentEventId).then(setAnalytics).catch(() => {}),
      api.listExperienceAudit(currentEventId, 50).then(setExperienceAudit).catch(() => {}),
    ])
  }

  async function loadGuestJourney(guestId) {
    if (!currentEventId || !guestId) { setGuestJourney(null); return }
    try {
      setGuestJourney(await api.getGuestExperience(currentEventId, guestId))
    } catch {
      setGuestJourney(null)
    }
  }

  async function loadConsentForm() {
    if (!currentEventId) return
    try {
      setConsentForm(await api.getConsentForm(currentEventId) || { title: 'Event consent', body: '', require_signature: true })
    } catch {
      setConsentForm({ title: 'Event consent', body: '', require_signature: true })
    }
  }

  async function loadTemplates() {
    if (!currentEventId) return
    try {
      const items = await api.listTemplates(currentEventId)
      setRealTemplates(items.filter((it) => it.group === 'Experience'))
    } catch {
      setRealTemplates([])
    }
  }

  useEffect(() => {
    if (!currentEventId) return
    api.getExperienceDashboard(currentEventId).then(setDashboard).catch(() => setDashboard(null))
    api.getExperienceAnalytics(currentEventId).then(setAnalytics).catch(() => setAnalytics(null))
    api.listExperienceAudit(currentEventId, 50).then(setExperienceAudit).catch(() => setExperienceAudit([]))
    api.listConsentSignatures(currentEventId).then(setRealSignatures).catch(() => setRealSignatures([]))
    api.templateAudit(currentEventId).then(setRealTemplateAudit).catch(() => setRealTemplateAudit([]))
    api.getFeedbackResults(currentEventId).then((r) => { setFeedbackResults(r); setFeedbackDenied(false) })
      .catch((err) => { if (err.status === 403) setFeedbackDenied(true); else setFeedbackResults(null) })
    loadEvent()
    loadWorkflows()
    loadConsentForm()
    loadTemplates()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentEventId])

  // Keeps the selected guest (and their journey) in sync whenever the shared
  // guest list loads or changes, since useGuests owns the fetch itself now.
  useEffect(() => {
    if (guestsLoading) return
    const nextId = selectedGuestId && realGuests.some((g) => g.id === selectedGuestId) ? selectedGuestId : (realGuests[0]?.id || '')
    if (nextId !== selectedGuestId) setSelectedGuestId(nextId)
    loadGuestJourney(nextId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realGuests, guestsLoading])

  // ── derived ───────────────────────────────────────────────────────────
  const selectedWorkflow = (workflows || []).find((w) => w.id === selectedId) || null
  const isDraftSelected = selectedWorkflow?.status === 'draft'
  const sortedSteps = (selectedWorkflow?.steps || []).slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
  const filteredWorkflows = (workflows || []).filter((w) => filterMatchesStatus(w.status, statusFilter))
  const selectedGuest = realGuests.find((g) => g.id === selectedGuestId) || null
  // The editor follows the workflow the operator selected. Falling back to the
  // live dashboard first made Feedback appear empty (and uneditable) whenever
  // an event had a selected draft alongside a published workflow.
  const selectedWorkflowSteps = selectedWorkflow?.steps || dashboard?.workflow?.steps || []
  const feedbackStep = selectedWorkflowSteps.find((s) => s.type === 'feedback') || null
  const feedbackStepQuestions = feedbackStep?.config?.feedback?.questions || []

  function guestLabel(g) { return g ? `${g.first_name || ''} ${g.last_name || ''}`.trim() : '' }
  function consentSignedFor(guestId) { return !!(realSignatures || []).find((s) => s.guest_id === guestId) }

  function currentGuestStep() {
    if (!guestJourney) return null
    const steps = (guestJourney.workflow?.steps || []).slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    if (!steps.length) return null
    const progressByStep = new Map((guestJourney.progress || []).map((p) => [p.step_id, p]))
    const pending = steps.find((s) => (progressByStep.get(s.id)?.status || 'available') !== 'completed')
    return pending || steps[steps.length - 1]
  }
  const guestStep = currentGuestStep()

  // ── Setup tab: module toggles ────────────────────────────────────────
  async function toggleModule(checked) {
    const result = await runAction('toggle-experience', () => api.toggleFeatures(currentEventId, { experience_enabled: checked }),
      checked ? 'Experience module enabled.' : 'Experience module disabled.')
    if (result !== FAILED) setRealEvent(result)
  }
  async function toggleLiveProgram(checked) {
    const result = await runAction('toggle-live-program', () => api.toggleFeatures(currentEventId, { live_program_enabled: checked }),
      checked ? 'Live Program enabled.' : 'Live Program disabled.')
    if (result !== FAILED) setRealEvent(result)
  }

  // ── Setup tab: create workflows ──────────────────────────────────────
  async function handleCreateWorkflow() {
    const name = window.prompt('Name for the new workflow')
    if (name === null) return
    const wf = await runAction('new-workflow', () => api.createExperienceWorkflow(currentEventId, { name: name.trim() || 'New Experience', steps: [] }), 'Workflow created.')
    if (wf !== FAILED) { await loadWorkflows(wf.id); setActiveTab('Workflow') }
  }
  async function handleCreateDefault() {
    const wf = await runAction('create-default', () => api.createDefaultExperienceWorkflow(currentEventId), 'Default workflow created.')
    if (wf !== FAILED) { await Promise.all([loadWorkflows(wf.id), loadEvent()]); setActiveTab('Workflow') }
  }
  async function handleCreateFromTemplate(t) {
    const steps = t.stepKeys.map((key, index) => stepPresetPayload(STEP_PRESET_BY_KEY[key], (index + 1) * 10))
    const wf = await runAction(`template-${t.name}`, () => api.createExperienceWorkflow(currentEventId, { name: t.name, steps }),
      `"${t.name}" created with ${steps.length} configured steps.`)
    if (wf !== FAILED) { await loadWorkflows(wf.id); setActiveTab('Workflow') }
  }
  async function handleExportProgress() {
    await runAction('export', () => api.downloadExperienceExport(currentEventId), 'Experience export downloaded.')
  }

  // ── Workflow cards: publish/unpublish/archive/unarchive/clone/delete ──
  async function handlePublish(w) {
    const alreadyPublished = (workflows || []).find((x) => x.status === 'published' && x.id !== w.id)
    if (alreadyPublished) { notifyError(`Cannot publish — "${alreadyPublished.name}" is already live. Unpublish it first.`); return }
    const updated = await runAction(`${w.id}:publish`, () => api.publishExperienceWorkflow(currentEventId, w.id), `${w.name} published.`)
    if (updated !== FAILED) { await Promise.all([loadWorkflows(w.id), loadEvent(), refreshDashboardAndAudit()]) }
  }
  async function handleUnpublish(w) {
    const updated = await runAction(`${w.id}:unpublish`, () => api.unpublishExperienceWorkflow(currentEventId, w.id), `${w.name} unpublished.`)
    if (updated !== FAILED) { await Promise.all([loadWorkflows(w.id), loadEvent(), refreshDashboardAndAudit()]) }
  }
  async function handleClone(w) {
    const name = window.prompt('Name for the draft copy', `${w.name} copy`)
    if (name === null) return
    const cloned = await runAction(`${w.id}:clone`, () => api.cloneExperienceWorkflow(currentEventId, w.id, name.trim() || null), `${w.name} cloned as a new draft.`)
    if (cloned !== FAILED) await loadWorkflows(cloned.id)
  }
  async function handleUnarchive(w) {
    const updated = await runAction(`${w.id}:unarchive`, () => api.unarchiveExperienceWorkflow(currentEventId, w.id), `${w.name} restored as draft.`)
    if (updated !== FAILED) await loadWorkflows(w.id)
  }
  function requestArchive(w) { setConfirmWorkflow({ type: 'archive', workflow: w }) }
  function requestDelete(w) { setConfirmWorkflow({ type: 'delete', workflow: w }) }
  async function confirmWorkflowActionRun() {
    const { type, workflow: w } = confirmWorkflow
    if (type === 'archive') {
      const updated = await runAction(`${w.id}:archive`, () => api.archiveExperienceWorkflow(currentEventId, w.id), `${w.name} archived.`)
      if (updated !== FAILED) { await Promise.all([loadWorkflows(), loadEvent(), refreshDashboardAndAudit()]) }
    } else if (type === 'delete') {
      const ok = await runAction(`${w.id}:delete`, () => api.deleteExperienceWorkflow(currentEventId, w.id), `${w.name} draft deleted.`)
      if (ok !== FAILED) { const remaining = (workflows || []).filter((x) => x.id !== w.id); await loadWorkflows(remaining[0]?.id) }
    }
    setConfirmWorkflow(null)
  }

  // ── Workflow tab: step CRUD + reorder + import ─────────────────────────
  function openAddStep() {
    setStepForm({ ...blankStepForm(), sort_order: ((selectedWorkflow?.steps?.length || 0) + 1) * 10 })
  }
  async function addPresetStep(preset) {
    if (!selectedWorkflow || !isDraftSelected) return
    const existing = new Set(sortedSteps.map((step) => step.key))
    let payload = stepPresetPayload(preset, (sortedSteps.length + 1) * 10)
    if (existing.has(payload.key)) {
      const suffix = sortedSteps.length + 1
      payload = { ...payload, key: `${payload.key}_${suffix}`, title: `${payload.title} ${suffix}` }
    }
    const saved = await runAction(`preset:${preset.key}`, () => api.createExperienceStep(currentEventId, selectedWorkflow.id, payload), `${payload.title} added.`)
    if (saved !== FAILED) await Promise.all([loadWorkflows(selectedWorkflow.id), refreshDashboardAndAudit()])
  }
  function openEditStep(step) {
    const config = step.config || {}
    const messages = config.messages || {}
    const session = normalizeSessionConfig(config)
    const assignment = normalizeRoomAssignmentConfig(config)
    setStepForm({
      id: step.id, key: step.key, type: step.type, title: step.title, description: step.description || '',
      sort_order: step.sort_order || 0,
      required: !!step.required, enabled: !!step.enabled,
      depends_on: listText(config.depends_on || config.depends_on_keys || config.prerequisites),
      guest_message: messages.guest || config.guest_message || '',
      staff_prompt: messages.staff || config.staff_prompt || '',
      completion_message: messages.complete || config.completion_message || '',
      session_topic: session.topic || '', session_date: session.date || '', session_start_time: session.start_time || '',
      session_end_time: session.end_time || '', session_room: session.room || '', session_speaker: session.speaker || '',
      session_capacity: session.capacity ?? '', session_checkin_window_minutes: session.checkin_window_minutes ?? '',
      room_assignment_mode: assignment.mode === 'scoped' ? 'scoped' : 'global',
      room_assignment_scope: assignment.scope || '', room_assignment_room: assignment.room || '',
      room_assignment_table_group: assignment.table_group || '',
      feedback_audience: config.feedback?.audience || 'all',
      feedback_session_step_id: config.feedback?.session_step_id || '',
      feedback_anonymous: !!config.feedback?.anonymous,
      feedback_status: config.feedback?.status || 'open',
      feedback_opens_at: config.feedback?.opens_at || '',
      feedback_closes_at: config.feedback?.closes_at || '',
      feedback_allow_edit: config.feedback?.allow_edit !== false,
      feedback_questions: Array.isArray(config.feedback?.questions) ? config.feedback.questions : [],
      program_is_segment: !!step.is_segment,
      program_start_offset_seconds: step.starts_offset_seconds ?? '',
      program_duration_seconds: step.duration_seconds ?? '',
      program_category: config.program?.category || '',
      program_announce_enabled: !!config.announce?.enabled,
      program_announce_title: config.announce?.title || '',
      program_announce_body: config.announce?.body || '',
      program_feedback_step_key: config.feedback?.step_key || '',
      program_feedback_window_seconds: config.feedback?.window_seconds ?? '1800',
      conditions: step.conditions ? JSON.stringify(step.conditions, null, 2) : '',
      config: step.config ? JSON.stringify(step.config, null, 2) : '',
    })
  }
  function goEditFeedbackStep() {
    setActiveTab('Workflow')
    if (!selectedWorkflow) {
      notifyError('Create or select an Experience workflow first.')
      return
    }
    if (!isDraftSelected) {
      notifyError('Published workflows are read-only. Prepare a feedback draft before editing.')
      return
    }
    if (feedbackStep) {
      openEditStep(feedbackStep)
      return
    }
    const preset = STEP_PRESET_BY_KEY.feedback_prompt
    const form = blankStepForm()
    setStepForm({
      ...form,
      key: preset.key,
      type: preset.type,
      title: preset.title,
      description: preset.description,
      sort_order: (sortedSteps.length + 1) * 10,
      required: preset.required,
      guest_message: preset.config?.messages?.guest || '',
      completion_message: preset.config?.messages?.complete || '',
      feedback_audience: preset.config?.feedback?.audience || 'all',
      feedback_questions: preset.config?.feedback?.questions || [],
      config: JSON.stringify(preset.config || {}, null, 2),
    })
  }

  function stepFormPayload() {
    if (!stepForm.key.trim() || !stepForm.title.trim()) throw new Error('Step key and title are required')
    const config = parseJsonMaybe(stepForm.config, 'Config') || {}
    const dependencies = listValue(stepForm.depends_on)
    if (dependencies.length) config.depends_on = dependencies
    else delete config.depends_on

    const messages = { ...(config.messages || {}) }
    const guestMessage = stepForm.guest_message.trim()
    const staffPrompt = stepForm.staff_prompt.trim()
    const completionMessage = stepForm.completion_message.trim()
    if (guestMessage) messages.guest = guestMessage
    else delete messages.guest
    if (staffPrompt) messages.staff = staffPrompt
    else delete messages.staff
    if (completionMessage) messages.complete = completionMessage
    else delete messages.complete
    if (Object.keys(messages).length) config.messages = messages
    else delete config.messages

    if (stepForm.type === 'session_attendance') {
      const jsonSession = normalizeSessionConfig(config)
      const session = {
        ...jsonSession,
        topic: stepForm.session_topic.trim() || jsonSession.topic || '',
        date: stepForm.session_date.trim() || jsonSession.date || '',
        start_time: stepForm.session_start_time.trim() || jsonSession.start_time || '',
        end_time: stepForm.session_end_time.trim() || jsonSession.end_time || '',
        room: stepForm.session_room.trim() || jsonSession.room || '',
        speaker: stepForm.session_speaker.trim() || jsonSession.speaker || '',
        capacity: stepForm.session_capacity === '' ? (jsonSession.capacity ?? null) : Number(stepForm.session_capacity),
        checkin_window_minutes: stepForm.session_checkin_window_minutes === '' ? (jsonSession.checkin_window_minutes ?? null) : Number(stepForm.session_checkin_window_minutes),
      }
      Object.keys(session).forEach((key) => {
        if (session[key] === '' || session[key] === null || Number.isNaN(session[key])) delete session[key]
      })
      if (Object.keys(session).length) config.session = session
      else delete config.session
      delete config.session_details
      delete config.session_config
      delete config.schedule
      delete config.sessions
    } else delete config.session

    if (stepForm.type === 'room_assignment') {
      const jsonAssignment = normalizeRoomAssignmentConfig(config)
      const assignment = {
        ...(config.room_assignment && typeof config.room_assignment === 'object' ? config.room_assignment : {}),
        assignment_mode: stepForm.room_assignment_mode || jsonAssignment.mode || 'global',
        scope: stepForm.room_assignment_scope.trim() || jsonAssignment.scope || stepForm.key.trim(),
        room: stepForm.room_assignment_room.trim() || jsonAssignment.room || '',
        table_group: stepForm.room_assignment_table_group.trim() || jsonAssignment.table_group || '',
      }
      if (assignment.assignment_mode !== 'scoped') {
        delete assignment.scope
        delete assignment.assignment_scope
        delete assignment.scoped
      } else assignment.scoped = true
      Object.keys(assignment).forEach((key) => {
        if (assignment[key] === '' || assignment[key] === null || Number.isNaN(assignment[key])) delete assignment[key]
      })
      config.room_assignment = assignment
      delete config.assignment
    } else delete config.room_assignment

    if (stepForm.type === 'feedback') {
      if (!stepForm.feedback_questions.length) throw new Error('Add at least one feedback question')
      config.owner = 'guest'
      config.feedback = {
        ...(config.feedback || {}),
        audience: stepForm.feedback_audience || 'all',
        ...(stepForm.feedback_audience === 'session' && stepForm.feedback_session_step_id ? { session_step_id: stepForm.feedback_session_step_id } : {}),
        anonymous: !!stepForm.feedback_anonymous,
        status: stepForm.feedback_status || 'open',
        ...(stepForm.feedback_opens_at ? { opens_at: stepForm.feedback_opens_at } : {}),
        ...(stepForm.feedback_closes_at ? { closes_at: stepForm.feedback_closes_at } : {}),
        allow_edit: !!stepForm.feedback_allow_edit,
        questions: stepForm.feedback_questions.map((question, index) => ({
          id: question.id || `question_${index + 1}`,
          type: question.type || 'text',
          prompt: String(question.prompt || '').trim(),
          required: !!question.required,
          ...(['single_choice', 'multi_choice'].includes(question.type) ? { options: (question.options || []).filter(Boolean) } : {}),
          ...(question.help_text ? { help_text: String(question.help_text).trim() } : {}),
          ...(question.show_if?.question_id && question.show_if?.value !== '' ? { show_if: question.show_if } : {}),
        })),
      }
      if (config.feedback.questions.some((question) => !question.prompt)) throw new Error('Every feedback question needs wording')
    } else delete config.feedback

    if (stepForm.program_is_segment) {
      const start = Number(stepForm.program_start_offset_seconds)
      const duration = Number(stepForm.program_duration_seconds)
      if (!Number.isFinite(start) || start < 0 || !Number.isFinite(duration) || duration <= 0) {
        throw new Error('Live Program segments need a valid start offset and duration')
      }
      config.program = { ...(config.program || {}), ...(stepForm.program_category.trim() ? { category: stepForm.program_category.trim() } : {}) }
      config.announce = {
        ...(config.announce || {}),
        enabled: !!stepForm.program_announce_enabled,
        ...(stepForm.program_announce_title.trim() ? { title: stepForm.program_announce_title.trim() } : {}),
        ...(stepForm.program_announce_body.trim() ? { body: stepForm.program_announce_body.trim() } : {}),
      }
      if (stepForm.program_feedback_step_key) {
        const feedbackWindow = Number(stepForm.program_feedback_window_seconds || 1800)
        if (!Number.isFinite(feedbackWindow) || feedbackWindow < 60) throw new Error('Feedback window must be at least 60 seconds')
        config.feedback = { step_key: stepForm.program_feedback_step_key, opens_on: 'segment_end', window_seconds: feedbackWindow }
      }
    } else {
      delete config.program
      delete config.announce
    }

    return {
      key: stepForm.key.trim(),
      type: stepForm.type,
      title: stepForm.title.trim(),
      description: stepForm.description.trim() || null,
      sort_order: Number(stepForm.sort_order || 0),
      required: !!stepForm.required,
      enabled: !!stepForm.enabled,
      is_segment: !!stepForm.program_is_segment,
      starts_offset_seconds: stepForm.program_is_segment ? Number(stepForm.program_start_offset_seconds) : null,
      duration_seconds: stepForm.program_is_segment ? Number(stepForm.program_duration_seconds) : null,
      conditions: parseJsonMaybe(stepForm.conditions, 'Conditions'),
      config: Object.keys(config).length ? config : null,
    }
  }

  async function saveStepForm() {
    if (!selectedWorkflow) return
    let payload
    try { payload = stepFormPayload() } catch (e) { notifyError(e.message); return }
    const result = stepForm.id
      ? await runAction(`step:${stepForm.id}:save`, () => api.updateExperienceStep(currentEventId, selectedWorkflow.id, stepForm.id, payload), 'Step updated.')
      : await runAction('step:new:save', () => api.createExperienceStep(currentEventId, selectedWorkflow.id, payload), 'Step added.')
    if (result !== FAILED) { setStepForm(null); await Promise.all([loadWorkflows(selectedWorkflow.id), refreshDashboardAndAudit()]) }
  }

  function requestDeleteStep(step) { setConfirmStepDelete(step) }
  async function confirmDeleteStepRun() {
    const step = confirmStepDelete
    const result = await runAction(`step:${step.id}:delete`, () => api.deleteExperienceStep(currentEventId, selectedWorkflow.id, step.id), 'Step deleted.')
    setConfirmStepDelete(null)
    if (result !== FAILED) { await Promise.all([loadWorkflows(selectedWorkflow.id), refreshDashboardAndAudit()]) }
  }

  async function moveStep(step, direction) {
    const steps = sortedSteps
    const index = steps.findIndex((s) => s.id === step.id)
    const target = index + direction
    if (target < 0 || target >= steps.length) return
    const ids = steps.map((s) => s.id)
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    const result = await runAction(`step:${step.id}:move`, () => api.reorderExperienceSteps(currentEventId, selectedWorkflow.id, ids), 'Step order saved.')
    if (result !== FAILED) await loadWorkflows(selectedWorkflow.id)
  }

  async function handleImportSessions() {
    let parsed
    try { parsed = JSON.parse(sessionImportText || '') } catch { notifyError('Session import must be valid JSON'); return }
    const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.sessions) ? parsed.sessions : []
    if (!rows.length) { notifyError('Paste a JSON array of sessions, or an object with a sessions array.'); return }
    setActionKey('import-sessions')
    try {
      const existing = new Set((selectedWorkflow.steps || []).map((s) => s.key))
      const baseOrder = Math.max(0, ...(selectedWorkflow.steps || []).map((s) => Number(s.sort_order) || 0))
      let i = 0
      for (const row of rows) {
        i += 1
        const title = row.topic || row.title || row.name || `Session ${i}`
        const base = String(row.key || title).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `session_${i}`
        let key = base
        let suffix = 2
        while (existing.has(key)) { key = `${base}_${suffix}`; suffix += 1 }
        existing.add(key)
        await api.createExperienceStep(currentEventId, selectedWorkflow.id, {
          key, type: 'session_attendance', title,
          description: row.description || 'Track guest attendance for a program segment or breakout.',
          sort_order: baseOrder + i * 10, required: row.required ?? true, enabled: row.enabled ?? true,
          config: { session: { topic: row.topic || title, date: row.date || '', start_time: row.start_time || '', end_time: row.end_time || '', room: row.room || '', speaker: row.speaker || '', capacity: row.capacity ?? null } },
        })
      }
      notify(`${rows.length} session step${rows.length === 1 ? '' : 's'} imported.`)
      setSessionImportText(''); setSessionImportOpen(false)
      await Promise.all([loadWorkflows(selectedWorkflow.id), refreshDashboardAndAudit()])
    } catch (e) {
      notifyError(e.message || 'Import failed')
    } finally {
      setActionKey('')
    }
  }

  // ── Guests tab ──────────────────────────────────────────────────────────
  async function selectGuest(id) { setSelectedGuestId(id); await loadGuestJourney(id) }

  async function overrideGuestStep(label) {
    const step = currentGuestStep()
    if (!step || !selectedGuestId) return
    const statusMap = { Complete: 'completed', Available: 'available', Block: 'blocked', Skip: 'skipped', Fail: 'failed' }
    const status = statusMap[label]
    let reason = null
    if (status === 'blocked' || status === 'failed') {
      reason = window.prompt(`Reason for marking this step "${label}"`, 'Manual override by admin')
      if (reason === null) return
    }
    const result = await runAction(`guest:${selectedGuestId}:override`, () => api.updateGuestExperienceStep(currentEventId, selectedGuestId, step.id, {
      status, override_reason: reason, metadata: { source: 'redesign_portal' },
    }), `Step marked ${label} for ${guestLabel(selectedGuest)}.`)
    if (result !== FAILED) { await Promise.all([loadGuestJourney(selectedGuestId), refreshDashboardAndAudit()]) }
  }

  async function resendGuest(kind) {
    if (!selectedGuestId) return
    const labels = { invitation: 'Invitation resent.', admission: 'Admission email resent.', experience_next_steps: 'Experience steps email sent.', consent_copy: 'Consent copy resent.' }
    await runAction(`guest:${selectedGuestId}:${kind}`, () => api.resendGuestEmail(currentEventId, selectedGuestId, kind), labels[kind])
  }

  // ── Consent tab: form editing ────────────────────────────────────────
  async function saveConsentFormAction() {
    if (!consentForm?.body?.trim()) { notifyError('Consent body is required'); return }
    const result = await runAction('consent:save', () => api.saveConsentForm(currentEventId, {
      title: consentForm.title || 'Event consent', body: consentForm.body, require_signature: !!consentForm.require_signature,
    }), 'Consent form saved.')
    if (result !== FAILED) {
      setConsentForm(result)
      await Promise.all([
        api.listConsentSignatures(currentEventId).then(setRealSignatures).catch(() => {}),
        api.listExperienceAudit(currentEventId, 50).then(setExperienceAudit).catch(() => {}),
      ])
    }
  }
  function requestDisableConsent() { setConfirmDisableConsent(true) }
  async function confirmDisableConsentRun() {
    const result = await runAction('consent:disable', () => api.disableConsentForm(currentEventId), 'Consent form disabled.')
    setConfirmDisableConsent(false)
    if (result !== FAILED) {
      setConsentForm({ title: 'Event consent', body: '', require_signature: true })
      await api.listExperienceAudit(currentEventId, 50).then(setExperienceAudit).catch(() => {})
    }
  }

  // ── Feedback tab: reminders + draft prep ─────────────────────────────
  async function startRemindFlow(form = feedbackResults?.forms?.[0]) {
    if (!form) return
    const channelText = window.prompt('Reminder channels (comma separated: email, sms, whatsapp)', 'email')
    if (!channelText) return
    const channels = channelText.split(',').map((c) => c.trim().toLowerCase()).filter(Boolean)
    if (!channels.length) return
    try {
      const preview = await api.getFeedbackReminderPreview(currentEventId, form.step_id, channels)
      setRemindConfirm({ form, channels, preview })
    } catch (e) { notifyError(e.message || 'Could not preview reminders') }
  }
  async function confirmRemind() {
    const { form, channels } = remindConfirm
    const result = await runAction('feedback:remind', () => api.sendFeedbackReminders(currentEventId, form.step_id, { channels }), 'Reminders queued for non-responders.')
    setRemindConfirm(null)
    if (result !== FAILED) await api.getFeedbackResults(currentEventId).then(setFeedbackResults).catch(() => {})
  }
  async function prepareDraft() {
    if (selectedWorkflow?.status === 'draft') {
      if (feedbackStep) {
        setActiveTab('Workflow')
        openEditStep(feedbackStep)
        notify('This draft already has a feedback step. Review it, then publish when ready.')
        return
      }
      const preset = STEP_PRESET_BY_KEY.feedback_prompt
      const saved = await runAction(
        'feedback:draft',
        () => api.createExperienceStep(
          currentEventId,
          selectedWorkflow.id,
          stepPresetPayload(preset, (sortedSteps.length + 1) * 10),
        ),
        'Feedback step added to the selected draft.',
      )
      if (saved !== FAILED) {
        await loadWorkflows(selectedWorkflow.id)
        setActiveTab('Workflow')
        openEditStep(saved)
      }
      return
    }
    const result = await runAction('feedback:draft', () => api.prepareFeedbackDraft(currentEventId), 'Feedback draft prepared — review it in the Workflow tab, then publish when ready.')
    if (result !== FAILED) { await loadWorkflows(result.id); setActiveTab('Workflow') }
  }
  async function refreshFeedbackResults() {
    const result = await runAction('feedback:filter', () => api.getFeedbackResults(currentEventId, {
      search: feedbackSearch.trim() || undefined,
      admitted: feedbackAdmitted || undefined,
    }))
    if (result !== FAILED) setFeedbackResults(result)
  }

  // ── Messages tab: template edit / preview / test-send / reset ───────────
  async function openTemplateEditor(item) {
    try {
      const full = await api.getTemplate(currentEventId, item.key)
      setEditingTemplate(full)
      setTemplateDraft({
        subject: full.effective.subject || '', email_body: full.effective.email_body || '',
        sms_body: full.effective.sms_body || '', whatsapp_body: full.effective.whatsapp_body || '', mms_body: full.effective.mms_body || '',
      })
    } catch (e) { notifyError(e.message || 'Could not load template') }
  }
  async function saveTemplateDraft() {
    if (!editingTemplate) return
    const payload = {}
    if (editingTemplate.channels.includes('email')) { payload.subject = templateDraft.subject; payload.email_body = templateDraft.email_body }
    if (editingTemplate.channels.includes('sms')) payload.sms_body = templateDraft.sms_body
    if (editingTemplate.channels.includes('whatsapp')) payload.whatsapp_body = templateDraft.whatsapp_body
    if (editingTemplate.channels.includes('mms')) payload.mms_body = templateDraft.mms_body
    const result = await runAction(`template:${editingTemplate.key}:save`, () => api.saveTemplate(currentEventId, editingTemplate.key, payload), 'Template saved.')
    if (result !== FAILED) {
      setEditingTemplate(null); setTemplateDraft(null)
      await Promise.all([loadTemplates(), api.templateAudit(currentEventId).then(setRealTemplateAudit).catch(() => {})])
    }
  }
  function requestResetTemplate(item) { setConfirmResetTemplate(item) }
  async function confirmResetTemplateRun() {
    const item = confirmResetTemplate
    const result = await runAction(`template:${item.key}:reset`, () => api.resetTemplate(currentEventId, item.key), `${item.label} reset to default.`)
    setConfirmResetTemplate(null)
    if (result !== FAILED) { await Promise.all([loadTemplates(), api.templateAudit(currentEventId).then(setRealTemplateAudit).catch(() => {})]) }
  }
  async function previewTemplateNow(item) {
    try {
      const draft = editingTemplate?.key === item.key ? templateDraft : {
        subject: item.effective.subject, email_body: item.effective.email_body,
        sms_body: item.effective.sms_body, whatsapp_body: item.effective.whatsapp_body, mms_body: item.effective.mms_body,
      }
      const preview = await api.previewTemplate(currentEventId, item.key, draft)
      setPreviewMessage({
        step: item.label,
        channel: item.channels.includes('email') ? 'email' : item.channels[0],
        channels: item.channels,
        preview,
      })
    } catch (e) { notifyError(e.message || 'Preview failed') }
  }
  async function testSendNow(item) {
    const channel = item.channels.filter((c) => c !== 'mms')[0] || 'email'
    const to = window.prompt(`Send a test ${channel} to:`, '')
    if (!to || !to.trim()) return
    const draft = editingTemplate?.key === item.key ? templateDraft : {
      subject: item.effective.subject, email_body: item.effective.email_body,
      sms_body: item.effective.sms_body, whatsapp_body: item.effective.whatsapp_body,
    }
    await runAction(`template:${item.key}:test`, () => api.testSendTemplate(currentEventId, item.key, { ...draft, channel, to: to.trim() }), `Test ${channel} sent to ${to.trim()}.`)
  }

  return (
    <RedesignShell topActive="setup" withEventSidebar eventActive="experience">
      <div className="rr-pagehead">
        <div>
          <div className="rr-title-row">
            <h1>Guest Experience</h1>
            <span className="rr-pill live"><i/> {(workflows || []).length} workflows</span>
          </div>
          <div className="rr-meta"><Icon name="barchart" size={13}/> Journey workflows for check-in, consent, seating, meals &amp; feedback</div>
        </div>
        <div className="rr-head-actions">
          <button className="rr-btn primary" disabled={actionKey === 'new-workflow'} onClick={handleCreateWorkflow}>
            <Icon name="plus" size={14}/> {actionKey === 'new-workflow' ? 'Creating…' : 'New workflow'}
          </button>
        </div>
      </div>

      <div className="rr-panel ex-module-gate">
        <div className="rd-toggle-row">
          <span style={{ fontSize: 12, fontWeight: 600 }}>Experience module enabled for this event</span>
          <label className="rd-switch">
            <input type="checkbox" checked={!!realEvent?.experience_enabled} disabled={!realEvent || actionKey === 'toggle-experience'}
              onChange={(e) => toggleModule(e.target.checked)} /><span className="track"/><span className="knob"/>
          </label>
        </div>
        <div className="rd-toggle-row">
          <span style={{ fontSize: 12, fontWeight: 600 }}>Live Program mode</span>
          <label className="rd-switch">
            <input type="checkbox" checked={!!realEvent?.live_program_enabled} disabled={!realEvent || actionKey === 'toggle-live-program'}
              onChange={(e) => toggleLiveProgram(e.target.checked)} /><span className="track"/><span className="knob"/>
          </label>
        </div>
      </div>

      <div className="ex-wf-toolbar">
        <div className="rd-seg">
          {STATUS_FILTERS.map((f) => <button key={f} className={statusFilter === f ? 'on' : ''} onClick={() => setStatusFilter(f)}>{f}</button>)}
        </div>
      </div>

      <div className="ex-workflow-grid">
        {workflows === null ? <LoadingSkeleton rows={3} variant="card" /> : filteredWorkflows.length === 0 ? (
          <p className="rd-rowlink">No workflows yet — create one from the Setup tab.</p>
        ) : filteredWorkflows.map((w) => {
          const busy = (suffix) => actionKey === `${w.id}:${suffix}`
          return (
            <div className={`rr-panel ex-wf-card ${w.id === selectedId ? 'is-selected' : ''}`} key={w.id}>
              <div className="ex-wf-top">
                <h3>{w.name} <small className="ex-version-badge">v{w.version}</small></h3>
                <span className={statusPillClass(w.status)}><i/> {statusLabel(w.status)}</span>
              </div>
              <div className="ex-wf-meta">
                <span><Icon name="layers" size={12}/> {(w.steps || []).length} steps</span>
              </div>
              <div className="ex-wf-updated">{w.updated_at ? `Updated ${new Date(w.updated_at).toLocaleDateString()}` : ''}</div>
              <div className="ex-wf-actions">
                <button className={`rr-btn ${w.id === selectedId ? 'primary' : 'secondary'}`} onClick={() => setSelectedId(w.id)}>
                  {w.id === selectedId ? <><Icon name="check" size={13}/> Selected</> : 'Select'}
                </button>
                {w.status === 'draft' && <button className="rr-btn secondary" disabled={busy('publish')} onClick={() => handlePublish(w)}>{busy('publish') ? 'Publishing…' : 'Publish'}</button>}
                {w.status === 'published' && <button className="rr-btn secondary" disabled={busy('unpublish')} onClick={() => handleUnpublish(w)}>{busy('unpublish') ? 'Unpublishing…' : 'Unpublish'}</button>}
                <button className="rr-link-btn" disabled={busy('clone')} onClick={() => handleClone(w)}>{busy('clone') ? 'Cloning…' : 'Clone'}</button>
                {w.status === 'archived'
                  ? <button className="rr-link-btn" disabled={busy('unarchive')} onClick={() => handleUnarchive(w)}>{busy('unarchive') ? 'Restoring…' : 'Unarchive'}</button>
                  : <button className="rr-link-btn" onClick={() => requestArchive(w)}>Archive</button>}
                {w.status === 'draft' && <button className="rr-link-btn gr-danger-link" onClick={() => requestDelete(w)}>Delete</button>}
              </div>
            </div>
          )
        })}
      </div>

      {selectedWorkflow && (
        <div className="rr-section-title" style={{ marginTop: 30 }}>
          <div><h2>{selectedWorkflow.name}</h2><p>{statusLabel(selectedWorkflow.status)} · v{selectedWorkflow.version} · {sortedSteps.length} steps</p></div>
        </div>
      )}

      <div className="rr-tabs">
        {SUBTABS.map((t) => <button key={t} className={activeTab === t ? 'active' : ''} onClick={() => setActiveTab(t)}>{t}</button>)}
      </div>

      {activeTab === 'Setup' && (
        <div className="rd-wide-grid">
          <div className="rd-panel">
            <div className="rd-panel-head"><h3>Quick start</h3><p>Start from a template, or build your own</p></div>
            <div className="rd-panel-body">
              <div className="rd-row2" style={{ marginBottom: 12 }}>
                <button className="rr-btn secondary" style={{ flex: 1, justifyContent: 'center' }} disabled={actionKey === 'create-default'} onClick={handleCreateDefault}>
                  {actionKey === 'create-default' ? 'Creating…' : 'Create default workflow'}
                </button>
                <button className="rr-btn secondary" style={{ flex: 1, justifyContent: 'center' }} disabled={actionKey === 'export' || !dashboard?.workflow} onClick={handleExportProgress}>
                  {actionKey === 'export' ? 'Exporting…' : 'Export progress'}
                </button>
              </div>
              <label className="rd-field-label">Templates</label>
              <div className="ex-template-grid">
                {WORKFLOW_TEMPLATES.map((t) => (
                  <button key={t.name} className="ex-template-card" disabled={actionKey === `template-${t.name}`} onClick={() => handleCreateFromTemplate(t)}>
                    <strong>{t.label}</strong><span>{t.description}</span><small>{t.stepKeys.length} configured steps · new draft</small>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="rd-panel">
            <div className="rd-panel-head"><h3>About this journey</h3></div>
            <div className="rd-panel-body">
              <div className="rd-hint">
                A journey workflow chains together the steps a guest moves through — check-in, consent, seating, meals,
                sessions, feedback and more. Each step can be targeted to specific ticket types via its own conditions
                (set per-step in the <b style={{ color: 'var(--ink)' }}>Workflow</b> tab), not at the workflow level.
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'Workflow' && (
        <div className="rd-panel">
          <div className="rd-panel-head"><h3>Steps</h3><p>Ordered path guests move through</p></div>
          <div className="rd-panel-body">
            {!selectedWorkflow ? <p className="rd-rowlink">Select or create a workflow above.</p> : (
              <>
                {!isDraftSelected && (
                  <div className="rd-hint" style={{ marginBottom: 10 }}>
                    {selectedWorkflow.status === 'archived' ? 'Archived workflows are read-only.' : 'Published workflows are the live runbook — read-only. Unpublish, or Clone to make changes.'}
                  </div>
                )}
                <div className={`ex-builder-layout${stepForm ? ' has-editor' : ''}`}>
                  <div className="ex-builder-main">
                    <div className="ex-step-list">
                      {sortedSteps.map((step, index) => (
                        <div className={`ex-step-row${stepForm?.id === step.id ? ' active' : ''}`} key={step.id}>
                          <span className="ex-step-handle" title="Use the arrows to reorder">⠿</span>
                          <span className="ex-step-num">{index + 1}</span>
                          <span className="ex-step-icon"><Icon name={stepTypeIcon(step.type)} size={14}/></span>
                          <div className="ex-step-info">
                            <strong>{step.title}</strong>
                            <span>{step.description || step.type.replaceAll('_', ' ')}</span>
                          </div>
                          <div className="ex-step-actions">
                            <button title="Move up" disabled={!isDraftSelected || index === 0 || actionKey === `step:${step.id}:move`} onClick={() => moveStep(step, -1)}><Icon name="arrow" size={13} className="ex-icon-up"/></button>
                            <button title="Move down" disabled={!isDraftSelected || index === sortedSteps.length - 1 || actionKey === `step:${step.id}:move`} onClick={() => moveStep(step, 1)}><Icon name="arrow" size={13} className="ex-icon-down"/></button>
                            <button title="Edit settings" aria-label={`Edit ${step.title}`} disabled={!isDraftSelected} onClick={() => openEditStep(step)}><Icon name="settings" size={13}/></button>
                            <button title="Delete" aria-label={`Delete ${step.title}`} disabled={!isDraftSelected} onClick={() => requestDeleteStep(step)}><Icon name="more" size={13}/></button>
                          </div>
                        </div>
                      ))}
                      {sortedSteps.length === 0 && <p className="rd-rowlink">No steps yet.</p>}
                    </div>

                    {isDraftSelected && <div className="ex-step-tools">
                      <div className="ex-step-tool-actions">
                        <button className="rr-btn primary" onClick={openAddStep}><Icon name="plus" size={13}/> Custom step</button>
                        <button className="rr-btn secondary" onClick={() => setSessionImportOpen(true)}><Icon name="upload" size={13}/> Import sessions</button>
                      </div>
                      <div className="ex-preset-panel">
                        <strong>Step presets</strong>
                        <span>Add a fully configured operational step.</span>
                        <div>{STEP_PRESETS.map((preset) => <button type="button" key={preset.key} disabled={actionKey === `preset:${preset.key}`} onClick={() => addPresetStep(preset)}><Icon name={stepTypeIcon(preset.type)} size={11}/>{preset.title}</button>)}</div>
                      </div>
                    </div>}
                  </div>

                  {stepForm && <ExperienceStepEditor
                    form={stepForm}
                    setForm={setStepForm}
                    steps={sortedSteps}
                    busy={actionKey.startsWith('step:')}
                    onClose={() => setStepForm(null)}
                    onSave={saveStepForm}
                  />}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {activeTab === 'Guests' && (
        <div className="rd-wide-grid">
          <div className="rd-panel">
            <div className="rd-panel-head"><h3>Guest progress</h3><p>Select a guest to view and override their journey</p></div>
            <div className="rd-panel-body">
              {guestsLoading ? <LoadingSkeleton rows={5} variant="list" /> : realGuests.length === 0 ? <p className="rd-rowlink">No guests yet.</p> : (
                <table className="rr-table">
                  <thead><tr><th>Guest</th><th>RSVP</th><th>Check-in</th><th/></tr></thead>
                  <tbody>
                    {realGuests.map((g) => (
                      <tr key={g.id} onClick={() => selectGuest(g.id)} className={selectedGuestId === g.id ? 'ex-row-active' : ''} style={{ cursor: 'pointer' }}>
                        <td><div className="rd-who"><span className="dot">{`${g.first_name?.[0] || ''}${g.last_name?.[0] || ''}`}</span> {g.first_name} {g.last_name}</div></td>
                        <td>{g.rsvp_status || '—'}</td>
                        <td><span className={`rd-status-chip ${g.admitted ? 'ok' : 'warn'}`}>{g.admitted ? 'Admitted' : 'Not yet'}</span></td>
                        <td className="rd-rowlink">{selectedGuestId === g.id ? 'Viewing' : 'View'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
          <div className="rd-panel">
            <div className="rd-panel-head"><h3>{selectedGuest ? guestLabel(selectedGuest) : 'Select a guest'}</h3><p>Actions &amp; per-step overrides</p></div>
            <div className="rd-panel-body">
              {!selectedGuest ? <p className="rd-rowlink">Select a guest from the list to manage their journey.</p> : (
                <>
                  <div className="rd-row2" style={{ marginBottom: 10 }}>
                    <button className="rr-btn secondary" style={{ flex: 1, justifyContent: 'center' }} disabled={!selectedGuest.email || actionKey === `guest:${selectedGuestId}:invitation`} onClick={() => resendGuest('invitation')}>Resend invite</button>
                    <button className="rr-btn secondary" style={{ flex: 1, justifyContent: 'center' }} disabled={!selectedGuest.email || !selectedGuest.admitted || actionKey === `guest:${selectedGuestId}:admission`} onClick={() => resendGuest('admission')}>Resend admission</button>
                  </div>
                  <div className="rd-row2" style={{ marginBottom: 14 }}>
                    <button className="rr-btn secondary" style={{ flex: 1, justifyContent: 'center' }} disabled={!selectedGuest.email || actionKey === `guest:${selectedGuestId}:experience_next_steps`} onClick={() => resendGuest('experience_next_steps')}>Send experience steps</button>
                    <button className="rr-btn secondary" style={{ flex: 1, justifyContent: 'center' }} disabled={!selectedGuest.email || !consentSignedFor(selectedGuestId) || actionKey === `guest:${selectedGuestId}:consent_copy`} onClick={() => resendGuest('consent_copy')}>Resend consent copy</button>
                  </div>
                  <label className="rd-field-label">Override current step{guestStep ? ` — ${guestStep.title}` : ''}</label>
                  {!guestStep ? <p className="rd-rowlink">No workflow steps to override yet.</p> : (
                    <div className="ex-override-row">
                      {['Complete', 'Available', 'Block', 'Skip', 'Fail'].map((a) => (
                        <button key={a} className="ex-override-btn" disabled={actionKey === `guest:${selectedGuestId}:override`} onClick={() => overrideGuestStep(a)}>{a}</button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'Consent' && (
        <div className="rd-wide-grid">
          <div className="rd-panel">
            <div className="rd-panel-head ex-panel-head-row">
              <div><h3>Consent form {consentForm?.version ? <small className="ex-version-badge">v{consentForm.version}</small> : null}</h3><p>Shown as part of the Consent step</p></div>
              {consentForm?.id && <button className="rr-link-btn gr-danger-link" disabled={actionKey === 'consent:disable'} onClick={requestDisableConsent}>Disable form</button>}
            </div>
            <div className="rd-panel-body">
              {consentForm === null ? <LoadingSkeleton rows={4} variant="list" /> : (
                <>
                  <label className="rd-field-label">Form title</label>
                  <input className="rd-field" value={consentForm.title || ''} onChange={(e) => setConsentForm((f) => ({ ...f, title: e.target.value }))} placeholder="Event Participation Consent" />
                  <label className="gr-required-check" style={{ marginBottom: 10 }}>
                    <input type="checkbox" checked={!!consentForm.require_signature} onChange={(e) => setConsentForm((f) => ({ ...f, require_signature: e.target.checked }))} /> Require typed signature (full legal name)
                  </label>
                  <label className="rd-field-label">Form body</label>
                  <textarea className="rr-textarea" rows={8} value={consentForm.body || ''}
                    onChange={(e) => setConsentForm((f) => ({ ...f, body: e.target.value }))}
                    placeholder="Paste the consent, release, waiver, or terms guests need to accept." />
                  <div className="rd-row2" style={{ marginTop: 10 }}>
                    <button className="rr-btn secondary" disabled={actionKey === 'consent:save'} onClick={saveConsentFormAction}>
                      {actionKey === 'consent:save' ? 'Saving…' : (consentForm.id ? 'Save new version' : 'Enable consent form')}
                    </button>
                  </div>
                  <div className="rr-section-title" style={{ margin: '16px 0 8px' }}><div><h2 style={{ fontSize: 12 }}>Live guest preview</h2></div></div>
                  <div className="ex-guest-preview">
                    <strong>{consentForm.title || 'Event consent'}</strong>
                    <p>{consentForm.body?.trim() || 'Paste the consent, release, waiver, or terms guests need to accept.'}</p>
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="rd-panel">
            <div className="rd-panel-head"><h3>Signatures</h3><p>Guests who have signed</p></div>
            <div className="rd-panel-body">
              {realSignatures === null ? <LoadingSkeleton rows={4} variant="list" /> : (
                <table className="rr-table">
                  <thead><tr><th>Guest</th><th>Signed</th><th/></tr></thead>
                  <tbody>
                    {realSignatures.map((s) => (
                      <tr key={s.id}><td>{s.signer_name}</td><td className="rd-rowlink">{s.signed_at ? new Date(s.signed_at).toLocaleString() : '—'}</td>
                        <td className="rd-rowlink"><button className="rr-link-btn" onClick={() => setSignatureGuest(s.signer_name)}>View signature</button></td>
                      </tr>
                    ))}
                    {realSignatures.length === 0 && <tr><td colSpan={3} className="rd-rowlink">No signatures yet.</td></tr>}
                  </tbody>
                </table>
              )}
              <div className="rr-section-title" style={{ margin: '14px 0 6px' }}><div><h2 style={{ fontSize: 12 }}>Recent activity</h2></div></div>
              {experienceAudit === null ? <LoadingSkeleton rows={3} variant="list" /> : (
                experienceAudit.length === 0
                  ? <p className="rd-rowlink">No recent activity.</p>
                  : experienceAudit.slice(0, 8).map((a) => <div key={a.id} className="ex-audit-row"><Icon name="clock" size={12}/><span>{a.event_type}{a.source ? ` · ${a.source}` : ''}</span><small>{a.occurred_at ? new Date(a.occurred_at).toLocaleString() : ''}</small></div>)
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'Feedback' && (
        <div className="ex-feedback-page">
          <div className="rr-panel">
            <div className="rd-panel-head ex-panel-head-row"><div><h3>Feedback configuration</h3><p>Questions submitted from FestioHub and Festio Pass</p></div><div className="rd-row2"><button className="rr-btn secondary" disabled={actionKey === 'feedback:draft'} onClick={prepareDraft}>{actionKey === 'feedback:draft' ? 'Preparing…' : 'Prepare feedback draft'}</button><button className="rr-btn primary" onClick={goEditFeedbackStep}>{feedbackStep ? 'Edit feedback step' : 'Add feedback step'}</button></div></div>
            <div className="rd-panel-body">
              {feedbackStepQuestions.length === 0 ? <p className="rd-rowlink">No feedback step is configured in the live workflow. Prepare a complete draft, or add one manually.</p> : <div className="ex-question-list">{feedbackStepQuestions.map((question, index) => <div className="ex-question" key={question.id || index}><span>{index + 1}</span><div><strong>{question.prompt}</strong><small>{feedbackTypeLabel(question.type)}{question.required ? ' · Required' : ''}</small></div></div>)}</div>}
            </div>
          </div>

          <div className="rr-panel">
            {feedbackDenied ? <div className="rd-panel-body"><PermissionDeniedState message="You need dashboard access to view feedback results." /></div> : <>
              <div className="rd-panel-head ex-panel-head-row"><div><h3>Feedback results</h3><p>All published feedback forms and response details</p></div><button className="rr-btn secondary" disabled={!feedbackResults?.forms?.some((form) => form.response_count)} onClick={() => api.downloadFeedbackExport(currentEventId)}>Export CSV</button></div>
              <div className="rd-panel-body">
                <div className="ex-feedback-filter">
                  <div className="rd-search"><Icon name="search" size={13}/><input placeholder="Search guest name or email…" value={feedbackSearch} onChange={(event) => setFeedbackSearch(event.target.value)}/></div>
                  <select className="rr-select" value={feedbackAdmitted} onChange={(event) => setFeedbackAdmitted(event.target.value)}><option value="">All guests</option><option value="true">Checked in</option><option value="false">Not checked in</option></select>
                  <button className="rr-btn primary" disabled={actionKey === 'feedback:filter'} onClick={refreshFeedbackResults}>Apply filters</button>
                </div>
                {feedbackResults === null ? <LoadingSkeleton rows={4} variant="list"/> : !feedbackResults.forms?.length ? <p className="rd-rowlink">No feedback form is live yet.</p> : <div className="ex-feedback-results">{feedbackResults.forms.map((form) => <section className="ex-feedback-result" key={form.step_id}>
                  <div className="ex-feedback-result-head"><div><h4>{form.title}</h4><span>{form.response_count} / {form.eligible_count} responses · {form.response_rate}%</span></div><button className="rr-btn secondary" disabled={!form.eligible_count} onClick={() => startRemindFlow(form)}>Remind non-responders</button></div>
                  {!!form.aggregates?.length && <div className="ex-feedback-metrics">{form.aggregates.map((metric) => <div key={metric.question_id}><span>{metric.prompt}</span>{metric.type === 'rating' && <strong>{metric.average ?? '—'} <small>/ 5</small></strong>}{metric.type === 'nps' && <strong>{metric.nps ?? '—'} <small>NPS</small></strong>}{!['rating', 'nps'].includes(metric.type) && <strong>{metric.answered ?? metric.count ?? '—'} <small>answers</small></strong>}</div>)}</div>}
                  <div className="ex-feedback-response-table"><table className="rr-table"><thead><tr><th>Guest</th><th>Submitted</th>{(form.questions || []).map((question) => <th key={question.id}>{question.prompt}</th>)}</tr></thead><tbody>{(form.responses || []).map((response) => <tr key={response.id}><td>{response.guest_name || 'Anonymous'}</td><td>{response.submitted_at ? new Date(response.submitted_at).toLocaleString() : '—'}</td>{(form.questions || []).map((question) => <td key={question.id}>{String(response.answers?.[question.id] ?? '—')}</td>)}</tr>)}{!form.responses?.length && <tr><td colSpan={(form.questions || []).length + 2} className="rd-rowlink">No responses yet.</td></tr>}</tbody></table></div>
                </section>)}</div>}
              </div>
            </>}
          </div>
        </div>
      )}

      {activeTab === 'Messages' && (
        <div className="rd-panel">
          <div className="rd-panel-head"><h3>Step notifications</h3><p>Which steps trigger a message, and where — placeholders like {'{{guest_first_name}}'} available</p></div>
          <div className="rd-panel-body">
            {realTemplates === null ? <LoadingSkeleton rows={4} variant="list" /> : (
              <table className="rr-table">
                <thead><tr><th>Step</th><th>Channel(s)</th><th>Template</th><th/></tr></thead>
                <tbody>
                  {realTemplates.map((m) => (
                    <tr key={m.key}>
                      <td>{m.label}</td>
                      <td>{m.channels.join(', ')}</td>
                      <td>{m.effective?.subject || m.label} <span className={`cm-badge ${m.source === 'event-customized' ? 'custom' : 'default'}`}>{m.source === 'event-customized' ? 'Custom' : 'Default'}</span></td>
                      <td className="gr-actions">
                        <button className="rr-link-btn" onClick={() => openTemplateEditor(m)}>Edit</button>
                        <button className="rr-link-btn" onClick={() => previewTemplateNow(m)}>Preview</button>
                        <button className="rr-link-btn" disabled={actionKey === `template:${m.key}:test`} onClick={() => testSendNow(m)}>{actionKey === `template:${m.key}:test` ? 'Sending…' : 'Test send'}</button>
                        {m.source === 'event-customized' && <button className="rr-link-btn gr-danger-link" onClick={() => requestResetTemplate(m)}>Reset</button>}
                      </td>
                    </tr>
                  ))}
                  {realTemplates.length === 0 && <tr><td colSpan={4} className="rd-rowlink">No Experience message triggers found.</td></tr>}
                </tbody>
              </table>
            )}
            <div className="rr-section-title" style={{ margin: '16px 0 8px' }}><div><h2 style={{ fontSize: 12 }}>Recent changes</h2></div></div>
            {realTemplateAudit === null ? <LoadingSkeleton rows={3} variant="list" /> : realTemplateAudit.length === 0 ? <p className="rd-rowlink">No template changes yet.</p> : (
              realTemplateAudit.slice(0, 10).map((a, i) => <div key={i} className="ex-audit-row"><Icon name="clock" size={12}/><strong>{a.changed_by_email || 'Unknown'}</strong><span>{a.action} {a.template_key}</span><small>{a.changed_at ? new Date(a.changed_at).toLocaleString() : ''}</small></div>)
            )}
          </div>
        </div>
      )}

      {activeTab === 'Analytics' && (
        dashboard === null ? <LoadingSkeleton rows={4} variant="card" /> : (
        <>
          <div className="rr-grid4">
            <div className="rr-panel er-stat"><span>Guests</span><strong>{dashboard.guest_total}</strong></div>
            <div className="rr-panel er-stat"><span>Steps</span><strong>{dashboard.step_count}</strong></div>
            <div className="rr-panel er-stat"><span>In progress</span><strong>{dashboard.progress_total}</strong></div>
            <div className="rr-panel er-stat teal"><span>Complete %</span><strong>{dashboard.completion_rate}%</strong></div>
          </div>
          <div className="rd-wide-grid" style={{ marginTop: 14 }}>
            <div className="rd-panel">
              <div className="rd-panel-head"><h3>Journey funnel</h3><p>Guests completed, per step</p></div>
              <div className="rd-panel-body">
                <div className="ex-funnel">
                  {dashboard.steps.map((s) => (
                    <div className="ex-funnel-row" key={s.step_id}>
                      <span className="ex-funnel-label">{s.title}</span>
                      <div className="ex-funnel-track"><i style={{ width: `${dashboard.steps[0]?.total ? (s.completed / dashboard.steps[0].total) * 100 : 0}%` }}/></div>
                      <span className="ex-funnel-count">{s.completed}</span>
                    </div>
                  ))}
                  {dashboard.steps.length === 0 && <p className="rd-rowlink">No workflow steps yet.</p>}
                </div>
              </div>
            </div>
            <div className="rd-panel">
              <div className="rd-panel-head"><h3>Audit log</h3><p>Recent journey events</p></div>
              <div className="rd-panel-body">
                <div className="ex-audit-list">
                  {experienceAudit === null ? <LoadingSkeleton rows={4} variant="list" /> : experienceAudit.length === 0 ? <p className="rd-rowlink">No activity yet.</p> : (
                    experienceAudit.slice(0, 10).map((a) => <div className="ex-audit-row" key={a.id}><Icon name="clock" size={12}/><span>{a.event_type}</span><small>{a.occurred_at ? new Date(a.occurred_at).toLocaleString() : ''}</small></div>)
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="rr-grid3" style={{ marginTop: 14 }}>
            <div className="rr-panel er-stat"><span>Consent signed</span><strong>{realSignatures ? `${realSignatures.length} / ${dashboard.guest_total}` : '—'}</strong></div>
            <div className="rr-panel er-stat amber"><span>Lowest-completion step</span><strong>{dashboard.steps.length ? [...dashboard.steps].sort((a, b) => a.completion_rate - b.completion_rate)[0].title : '—'}</strong></div>
            <div className="rr-panel er-stat"><span>Blocked / failed</span><strong>{dashboard.steps.reduce((sum, s) => sum + (s.blocked || 0) + (s.failed || 0), 0)}</strong></div>
          </div>
          {analytics?.workflow && <div className="rr-grid3" style={{ marginTop: 14 }}>
            <div className="rr-panel er-stat teal"><span>Consent completion</span><strong>{analytics.consent?.rate ?? 0}%</strong><small>{analytics.consent?.signed ?? 0} of {analytics.consent?.total ?? 0} guests signed</small></div>
            <div className="rr-panel er-stat amber"><span>Top bottleneck</span><strong>{analytics.bottlenecks?.[0]?.title || 'No bottlenecks'}</strong><small>{analytics.bottlenecks?.[0] ? `${analytics.bottlenecks[0].open} open · ${analytics.bottlenecks[0].completion_rate}% complete` : 'Journey is clear'}</small></div>
            <div className="rr-panel er-stat"><span>Recent overrides</span><strong>{analytics.overrides?.length ?? 0}</strong><small>Manually overridden workflow steps</small></div>
          </div>}
        </>
        )
      )}

      {toast && <div className={`rd-toast${toast.error ? ' error' : ''}`}><Icon name={toast.error ? 'info' : 'check'}/>{toast.text}</div>}

      {signatureGuest && (
        <Modal title={`Consent signature — ${signatureGuest}`} onClose={() => setSignatureGuest(null)} width={420}>
          <div style={{ padding: '12px 0' }}>
            <div style={{ fontStyle: 'italic', fontSize: '1.6rem', fontFamily: 'cursive', borderBottom: '1px solid #ddd', paddingBottom: 10, marginBottom: 12 }}>{signatureGuest.split(' ')[0]}</div>
            <p style={{ fontSize: '0.83rem', color: '#555', margin: 0 }}>Signed electronically — see the Consent audit trail for the exact timestamp, IP and device.</p>
          </div>
        </Modal>
      )}

      {sessionImportOpen && (
        <Modal title="Import sessions (JSON)" onClose={() => setSessionImportOpen(false)} width={480}>
          <label className="rd-field-label">Paste a JSON array of sessions</label>
          <textarea className="rr-textarea" rows={10} value={sessionImportText} onChange={(e) => setSessionImportText(e.target.value)}
            placeholder='[{"topic":"Opening keynote","date":"2026-08-01","start_time":"10:00","end_time":"11:00","room":"Hall A"}]' />
          <div className="rd-row2" style={{ marginTop: 10 }}>
            <button className="rr-btn secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setSessionImportOpen(false)}>Cancel</button>
            <button className="rr-btn primary" style={{ flex: 1, justifyContent: 'center' }} disabled={actionKey === 'import-sessions'} onClick={handleImportSessions}>
              {actionKey === 'import-sessions' ? 'Importing…' : 'Import'}
            </button>
          </div>
        </Modal>
      )}

      {editingTemplate && templateDraft && (
        <Modal title={`Edit — ${editingTemplate.label}`} onClose={() => { setEditingTemplate(null); setTemplateDraft(null) }} width={520}>
          {editingTemplate.channels.includes('email') && (<>
            <label className="rd-field-label">Email subject</label>
            <input className="rd-field" value={templateDraft.subject} onChange={(e) => setTemplateDraft((d) => ({ ...d, subject: e.target.value }))} />
            <label className="rd-field-label">Email body</label>
            <textarea className="rr-textarea" rows={6} value={templateDraft.email_body} onChange={(e) => setTemplateDraft((d) => ({ ...d, email_body: e.target.value }))} />
          </>)}
          {editingTemplate.channels.includes('sms') && (<>
            <label className="rd-field-label">SMS body</label>
            <textarea className="rr-textarea" rows={3} value={templateDraft.sms_body} onChange={(e) => setTemplateDraft((d) => ({ ...d, sms_body: e.target.value }))} />
          </>)}
          {editingTemplate.channels.includes('whatsapp') && (<>
            <label className="rd-field-label">WhatsApp body</label>
            <textarea className="rr-textarea" rows={3} value={templateDraft.whatsapp_body} onChange={(e) => setTemplateDraft((d) => ({ ...d, whatsapp_body: e.target.value }))} />
          </>)}
          {!!editingTemplate.placeholders?.length && (
            <div className="rd-hint" style={{ marginTop: 6 }}>Placeholders: {editingTemplate.placeholders.map((p) => `{{${p}}}`).join(', ')}</div>
          )}
          <div className="rd-row2" style={{ marginTop: 12 }}>
            <button className="rr-btn secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => { setEditingTemplate(null); setTemplateDraft(null) }}>Cancel</button>
            <button className="rr-btn primary" style={{ flex: 1, justifyContent: 'center' }} disabled={actionKey === `template:${editingTemplate.key}:save`} onClick={saveTemplateDraft}>
              {actionKey === `template:${editingTemplate.key}:save` ? 'Saving…' : 'Save'}
            </button>
          </div>
        </Modal>
      )}

      {remindConfirm && (
        <ConfirmDialog
          title="Remind non-responders"
          message={`Send a reminder to ${remindConfirm.preview.nonresponders} guest${remindConfirm.preview.nonresponders === 1 ? '' : 's'} who haven't responded, via ${remindConfirm.channels.join(', ')}. Credits required: ${remindConfirm.preview.credits_required} · available: ${remindConfirm.preview.credits_available}.`}
          confirmLabel="Send reminder"
          danger={false}
          onConfirm={confirmRemind}
          onCancel={() => setRemindConfirm(null)}
        />
      )}

      {confirmWorkflow && (
        <ConfirmDialog
          title={confirmWorkflow.type === 'delete' ? 'Delete draft workflow' : 'Archive workflow'}
          message={confirmWorkflow.type === 'delete'
            ? `Delete draft workflow "${confirmWorkflow.workflow.name}"? This cannot be undone.`
            : `Archive "${confirmWorkflow.workflow.name}"? It will be kept for history and removed from live use.`}
          confirmLabel={confirmWorkflow.type === 'delete' ? 'Delete' : 'Archive'}
          onConfirm={confirmWorkflowActionRun}
          onCancel={() => setConfirmWorkflow(null)}
        />
      )}

      {confirmStepDelete && (
        <ConfirmDialog title="Delete step" message={`Delete step "${confirmStepDelete.title}"? This cannot be undone.`} confirmLabel="Delete" onConfirm={confirmDeleteStepRun} onCancel={() => setConfirmStepDelete(null)} />
      )}

      {confirmDisableConsent && (
        <ConfirmDialog title="Disable consent form" message="Disable this consent form? It will disappear from FestioHub and Festio Pass. Existing signatures are preserved." confirmLabel="Disable" onConfirm={confirmDisableConsentRun} onCancel={() => setConfirmDisableConsent(false)} />
      )}

      {confirmResetTemplate && (
        <ConfirmDialog title="Reset template" message={`Reset "${confirmResetTemplate.label}" to the platform default? Your customization will be lost.`} confirmLabel="Reset" onConfirm={confirmResetTemplateRun} onCancel={() => setConfirmResetTemplate(null)} />
      )}

      {previewMessage && (
        <Modal title={`Preview: ${previewMessage.step}`} onClose={() => setPreviewMessage(null)} width={500}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {(previewMessage.channels || [previewMessage.channel]).map((channel) => (
              <button
                key={channel}
                className={`rr-btn${previewMessage.channel === channel ? ' primary' : ' secondary'}`}
                onClick={() => setPreviewMessage((current) => ({ ...current, channel }))}
                style={{ fontSize: '0.78rem', padding: '4px 10px' }}
              >
                {channel.toUpperCase()}
              </button>
            ))}
          </div>
          <ChannelPreviewFrame
            channel={previewMessage.channel || 'email'}
            html={previewMessage.channel === 'email' ? previewMessage.preview.email_preview_html || previewMessage.preview.email_body || '' : ''}
            body={previewMessage.preview[`${previewMessage.channel}_body`] || `No ${previewMessage.channel.toUpperCase()} body is configured for this template.`}
          />
        </Modal>
      )}
    </RedesignShell>
  )
}
