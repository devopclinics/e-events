import { useState, useEffect } from 'react'
import RedesignShell, { Icon, Modal, ConfirmDialog, ChannelPreviewFrame } from './redesign/RedesignShell'
import { LoadingSkeleton, PermissionDeniedState } from './redesign/RedesignPrimitives'
import { useCurrentEvent } from '../hooks/useCurrentEvent'
import { useEventDetails } from '../hooks/useEventDetails'
import { api } from '../api'
import './ExperienceRedesignPage.css'

const FAILED = Symbol('experience-action-failed')

const WORKFLOW_TEMPLATES = [
  { name: 'VIP Dinner', steps: 5 },
  { name: 'Conference Registration', steps: 7 },
  { name: 'Wedding Reception', steps: 6 },
  { name: 'Simple Check-in', steps: 2 },
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

const FEEDBACK_TYPE_LABELS = { rating: 'Rating', nps: 'NPS', single_choice: 'Single choice', multi_choice: 'Multi choice', yes_no: 'Yes/No', text: 'Text' }
function feedbackTypeLabel(t) { return FEEDBACK_TYPE_LABELS[t] || t }

function blankStepForm() {
  return {
    id: null, key: '', type: 'custom', title: '', description: '', required: true, enabled: true,
    guest_message: '', staff_prompt: '', completion_message: '',
    session_topic: '', session_date: '', session_start_time: '', session_end_time: '', session_room: '', session_speaker: '', session_capacity: '',
    feedback_audience: 'all', feedback_status: 'open',
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

export default function ExperienceRedesignPage() {
  const [toast, setToast] = useState(null) // { text, error }
  const [selectedId, setSelectedId] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [activeTab, setActiveTab] = useState('Setup')
  const [feedbackSearch, setFeedbackSearch] = useState('')
  const [signatureGuest, setSignatureGuest] = useState(null)
  const [previewMessage, setPreviewMessage] = useState(null)
  const [actionKey, setActionKey] = useState('') // in-flight mutation marker, e.g. "wfId:publish"

  const [currentEventId] = useCurrentEvent()

  // ── Stage A (already real, read-only) ───────────────────────────────────
  const [dashboard, setDashboard] = useState(null)
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
  const [realGuests, setRealGuests] = useState(null)
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

  async function loadGuests() {
    if (!currentEventId) return
    try {
      const data = await api.listGuests(currentEventId)
      setRealGuests(data)
      const nextId = selectedGuestId && data.some((g) => g.id === selectedGuestId) ? selectedGuestId : (data[0]?.id || '')
      setSelectedGuestId(nextId)
      await loadGuestJourney(nextId)
    } catch {
      setRealGuests([])
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
    api.listExperienceAudit(currentEventId, 50).then(setExperienceAudit).catch(() => setExperienceAudit([]))
    api.listConsentSignatures(currentEventId).then(setRealSignatures).catch(() => setRealSignatures([]))
    api.templateAudit(currentEventId).then(setRealTemplateAudit).catch(() => setRealTemplateAudit([]))
    api.getFeedbackResults(currentEventId).then((r) => { setFeedbackResults(r); setFeedbackDenied(false) })
      .catch((err) => { if (err.status === 403) setFeedbackDenied(true); else setFeedbackResults(null) })
    loadEvent()
    loadWorkflows()
    loadGuests()
    loadConsentForm()
    loadTemplates()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentEventId])

  // ── derived ───────────────────────────────────────────────────────────
  const selectedWorkflow = (workflows || []).find((w) => w.id === selectedId) || null
  const isDraftSelected = selectedWorkflow?.status === 'draft'
  const sortedSteps = (selectedWorkflow?.steps || []).slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
  const filteredWorkflows = (workflows || []).filter((w) => filterMatchesStatus(w.status, statusFilter))
  const selectedGuest = (realGuests || []).find((g) => g.id === selectedGuestId) || null
  const liveWorkflowSteps = dashboard?.workflow?.steps || selectedWorkflow?.steps || []
  const feedbackStep = liveWorkflowSteps.find((s) => s.type === 'feedback') || null
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
    const wf = await runAction(`template-${t.name}`, () => api.createExperienceWorkflow(currentEventId, { name: t.name, steps: [] }),
      `"${t.name}" draft created — add its ${t.steps} steps in the Workflow tab.`)
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
  function openAddStep() { setStepForm(blankStepForm()) }
  function openEditStep(step) {
    const config = step.config || {}
    const messages = config.messages || {}
    const session = config.session || {}
    setStepForm({
      id: step.id, key: step.key, type: step.type, title: step.title, description: step.description || '',
      required: !!step.required, enabled: !!step.enabled,
      guest_message: messages.guest || '', staff_prompt: messages.staff || '', completion_message: messages.complete || '',
      session_topic: session.topic || '', session_date: session.date || '', session_start_time: session.start_time || '',
      session_end_time: session.end_time || '', session_room: session.room || '', session_speaker: session.speaker || '',
      session_capacity: session.capacity ?? '',
      feedback_audience: config.feedback?.audience || 'all', feedback_status: config.feedback?.status || 'open',
    })
  }
  function goEditFeedbackStep() {
    setActiveTab('Workflow')
    if (feedbackStep) openEditStep(feedbackStep)
    else notify('No Feedback step in the live workflow yet — add one from the Workflow tab, or use "Prepare feedback draft".')
  }

  function stepFormPayload() {
    if (!stepForm.title.trim()) throw new Error('Step title is required')
    if (!stepForm.id && !stepForm.key.trim()) throw new Error('Step key is required')
    const config = {}
    const messages = {}
    if (stepForm.guest_message.trim()) messages.guest = stepForm.guest_message.trim()
    if (stepForm.staff_prompt.trim()) messages.staff = stepForm.staff_prompt.trim()
    if (stepForm.completion_message.trim()) messages.complete = stepForm.completion_message.trim()
    if (Object.keys(messages).length) config.messages = messages
    if (stepForm.type === 'session_attendance') {
      const session = {}
      if (stepForm.session_topic.trim()) session.topic = stepForm.session_topic.trim()
      if (stepForm.session_date.trim()) session.date = stepForm.session_date.trim()
      if (stepForm.session_start_time.trim()) session.start_time = stepForm.session_start_time.trim()
      if (stepForm.session_end_time.trim()) session.end_time = stepForm.session_end_time.trim()
      if (stepForm.session_room.trim()) session.room = stepForm.session_room.trim()
      if (stepForm.session_speaker.trim()) session.speaker = stepForm.session_speaker.trim()
      if (stepForm.session_capacity !== '') session.capacity = Number(stepForm.session_capacity)
      if (Object.keys(session).length) config.session = session
    }
    if (stepForm.type === 'feedback') {
      const existingQuestions = stepForm.id ? (sortedSteps.find((s) => s.id === stepForm.id)?.config?.feedback?.questions || []) : []
      config.feedback = { audience: stepForm.feedback_audience, status: stepForm.feedback_status, questions: existingQuestions }
    }
    const payload = {
      key: stepForm.id ? stepForm.key : stepForm.key.trim(),
      type: stepForm.type,
      title: stepForm.title.trim(),
      description: stepForm.description.trim() || null,
      required: !!stepForm.required,
      enabled: !!stepForm.enabled,
      config: Object.keys(config).length ? config : null,
    }
    if (!stepForm.id) payload.sort_order = ((selectedWorkflow?.steps?.length || 0) + 1) * 10
    return payload
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
  async function startRemindFlow() {
    const form = feedbackResults?.forms?.[0]
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
    const result = await runAction('feedback:draft', () => api.prepareFeedbackDraft(currentEventId), 'Feedback draft prepared — review it in the Workflow tab, then publish when ready.')
    if (result !== FAILED) { await loadWorkflows(result.id); setActiveTab('Workflow') }
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
      setPreviewMessage({ step: item.label, channel: item.channels.includes('email') ? 'email' : item.channels[0], preview })
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
                    <strong>{t.name}</strong><span>{t.steps} steps · new draft</span>
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
                <div className="ex-step-list">
                  {sortedSteps.map((s, i) => (
                    <div className="ex-step-row" key={s.id}>
                      <span className="ex-step-handle" title="Drag to reorder">⠿</span>
                      <span className="ex-step-num">{i + 1}</span>
                      <span className="ex-step-icon"><Icon name={stepTypeIcon(s.type)} size={14}/></span>
                      <div className="ex-step-info">
                        <strong>{s.title}</strong>
                        <span>{s.description || s.type.replaceAll('_', ' ')}</span>
                      </div>
                      <div className="ex-step-actions">
                        <button title="Move up" disabled={!isDraftSelected || i === 0 || actionKey === `step:${s.id}:move`} onClick={() => moveStep(s, -1)}><Icon name="arrow" size={13} className="ex-icon-up"/></button>
                        <button title="Move down" disabled={!isDraftSelected || i === sortedSteps.length - 1 || actionKey === `step:${s.id}:move`} onClick={() => moveStep(s, 1)}><Icon name="arrow" size={13} className="ex-icon-down"/></button>
                        <button title="Edit" disabled={!isDraftSelected} onClick={() => openEditStep(s)}><Icon name="settings" size={13}/></button>
                        <button title="Delete" disabled={!isDraftSelected} onClick={() => requestDeleteStep(s)}><Icon name="more" size={13}/></button>
                      </div>
                    </div>
                  ))}
                  {sortedSteps.length === 0 && <p className="rd-rowlink">No steps yet.</p>}
                </div>

                {stepForm && (
                  <div className="ex-step-config">
                    <strong>{stepForm.id ? `${stepForm.title || 'Step'} — edit` : 'Add step'}</strong>
                    <div className="rd-row2" style={{ marginTop: 8 }}>
                      <div style={{ flex: 1 }}>
                        <label className="rd-field-label">Key</label>
                        <input className="rd-field" value={stepForm.key} disabled={!!stepForm.id}
                          onChange={(e) => setStepForm((f) => ({ ...f, key: e.target.value }))} placeholder="main_checkin" />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label className="rd-field-label">Type</label>
                        <select className="rr-select" value={stepForm.type} disabled={!!stepForm.id}
                          onChange={(e) => setStepForm((f) => ({ ...f, type: e.target.value }))}>
                          {STEP_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </div>
                    </div>
                    <label className="rd-field-label">Title</label>
                    <input className="rd-field" value={stepForm.title} onChange={(e) => setStepForm((f) => ({ ...f, title: e.target.value }))} />
                    <label className="rd-field-label">Description</label>
                    <input className="rd-field" value={stepForm.description} onChange={(e) => setStepForm((f) => ({ ...f, description: e.target.value }))} />
                    <div className="rd-row2">
                      <label className="gr-required-check"><input type="checkbox" checked={stepForm.required} onChange={(e) => setStepForm((f) => ({ ...f, required: e.target.checked }))}/> Required</label>
                      <label className="gr-required-check"><input type="checkbox" checked={stepForm.enabled} onChange={(e) => setStepForm((f) => ({ ...f, enabled: e.target.checked }))}/> Enabled</label>
                    </div>
                    <label className="rd-field-label">Guest-facing message</label>
                    <input className="rd-field" value={stepForm.guest_message} onChange={(e) => setStepForm((f) => ({ ...f, guest_message: e.target.value }))} />
                    <label className="rd-field-label">Staff prompt</label>
                    <input className="rd-field" value={stepForm.staff_prompt} onChange={(e) => setStepForm((f) => ({ ...f, staff_prompt: e.target.value }))} />
                    <label className="rd-field-label">Completion message</label>
                    <input className="rd-field" value={stepForm.completion_message} onChange={(e) => setStepForm((f) => ({ ...f, completion_message: e.target.value }))} />

                    {stepForm.type === 'session_attendance' && (
                      <>
                        <div className="rd-row2" style={{ marginTop: 8 }}>
                          <div style={{ flex: 1 }}><label className="rd-field-label">Topic</label><input className="rd-field" value={stepForm.session_topic} onChange={(e) => setStepForm((f) => ({ ...f, session_topic: e.target.value }))} /></div>
                          <div style={{ flex: 1 }}><label className="rd-field-label">Room</label><input className="rd-field" value={stepForm.session_room} onChange={(e) => setStepForm((f) => ({ ...f, session_room: e.target.value }))} /></div>
                        </div>
                        <div className="rd-row2">
                          <div style={{ flex: 1 }}><label className="rd-field-label">Date</label><input className="rd-field" value={stepForm.session_date} onChange={(e) => setStepForm((f) => ({ ...f, session_date: e.target.value }))} /></div>
                          <div style={{ flex: 1 }}><label className="rd-field-label">Start time</label><input className="rd-field" value={stepForm.session_start_time} onChange={(e) => setStepForm((f) => ({ ...f, session_start_time: e.target.value }))} /></div>
                          <div style={{ flex: 1 }}><label className="rd-field-label">End time</label><input className="rd-field" value={stepForm.session_end_time} onChange={(e) => setStepForm((f) => ({ ...f, session_end_time: e.target.value }))} /></div>
                        </div>
                        <div className="rd-row2">
                          <div style={{ flex: 1 }}><label className="rd-field-label">Speaker</label><input className="rd-field" value={stepForm.session_speaker} onChange={(e) => setStepForm((f) => ({ ...f, session_speaker: e.target.value }))} /></div>
                          <div style={{ flex: 1 }}><label className="rd-field-label">Capacity</label><input className="rd-field" type="number" value={stepForm.session_capacity} onChange={(e) => setStepForm((f) => ({ ...f, session_capacity: e.target.value }))} /></div>
                        </div>
                      </>
                    )}
                    {stepForm.type === 'feedback' && (
                      <div className="rd-row2" style={{ marginTop: 8 }}>
                        <div style={{ flex: 1 }}>
                          <label className="rd-field-label">Audience</label>
                          <select className="rr-select" value={stepForm.feedback_audience} onChange={(e) => setStepForm((f) => ({ ...f, feedback_audience: e.target.value }))}>
                            <option value="all">All guests</option><option value="session">Session attendees</option>
                          </select>
                        </div>
                        <div style={{ flex: 1 }}>
                          <label className="rd-field-label">Status</label>
                          <select className="rr-select" value={stepForm.feedback_status} onChange={(e) => setStepForm((f) => ({ ...f, feedback_status: e.target.value }))}>
                            <option value="open">Open</option><option value="closed">Closed</option>
                          </select>
                        </div>
                      </div>
                    )}
                    <div className="rd-row2" style={{ marginTop: 10 }}>
                      <button className="rr-btn secondary" onClick={() => setStepForm(null)}>Cancel</button>
                      <button className="rr-btn primary" disabled={actionKey.startsWith('step:')} onClick={saveStepForm}>
                        {actionKey.startsWith('step:') ? 'Saving…' : 'Save step'}
                      </button>
                    </div>
                  </div>
                )}

                {isDraftSelected && (
                  <div className="rd-row2" style={{ marginTop: 14 }}>
                    <button className="rr-link-btn" onClick={openAddStep}><Icon name="plus" size={13}/> Add step</button>
                    <button className="rr-link-btn" onClick={() => setSessionImportOpen(true)}><Icon name="upload" size={13}/> Import sessions (JSON)</button>
                  </div>
                )}
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
              {realGuests === null ? <LoadingSkeleton rows={5} variant="list" /> : realGuests.length === 0 ? <p className="rd-rowlink">No guests yet.</p> : (
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
        <div className="rd-wide-grid">
          <div className="rd-panel">
            <div className="rd-panel-head"><h3>Feedback form</h3><p>Sent after the Checkout step</p></div>
            <div className="rd-panel-body">
              {feedbackStepQuestions.length === 0 ? (
                <p className="rd-rowlink">No feedback step configured in the live workflow yet.</p>
              ) : (
                <div className="ex-question-list">
                  {feedbackStepQuestions.map((q, i) => (
                    <div className="ex-question" key={q.id || i}><span>{i + 1}</span>{q.prompt}<small className="rd-rowlink"> ({feedbackTypeLabel(q.type)})</small></div>
                  ))}
                </div>
              )}
              <button className="rr-link-btn" style={{ marginTop: 10 }} onClick={goEditFeedbackStep}>
                <Icon name="plus" size={13}/> {feedbackStep ? 'Edit questions in Workflow tab' : 'Add a Feedback step in Workflow tab'}
              </button>
            </div>
          </div>
          <div className="rd-panel">
            {feedbackDenied ? (
              <div className="rd-panel-body"><PermissionDeniedState message="You need dashboard access to view feedback results." /></div>
            ) : (
              <>
                <div className="rd-panel-head"><h3>Results</h3><p>{feedbackResults?.forms?.[0] ? `${feedbackResults.forms[0].response_count} of ${feedbackResults.forms[0].eligible_count} responses (${feedbackResults.forms[0].response_rate}%)` : ''}</p></div>
                <div className="rd-panel-body">
                  {feedbackResults === null ? <LoadingSkeleton rows={4} variant="list" /> : !feedbackResults.forms?.length ? (
                    <p className="rd-rowlink">No feedback form is live yet.</p>
                  ) : (
                    <>
                      <div className="rd-row2" style={{ marginTop: 0, marginBottom: 12 }}>
                        <button className="rr-btn secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => api.downloadFeedbackExport(currentEventId)}>Export CSV</button>
                        <button className="rr-btn secondary" style={{ flex: 1, justifyContent: 'center' }} disabled={actionKey === 'feedback:draft'} onClick={prepareDraft}>
                          {actionKey === 'feedback:draft' ? 'Preparing…' : 'Prepare feedback draft'}
                        </button>
                      </div>
                      <div className="rd-search" style={{ marginTop: 0 }}>
                        <Icon name="search" size={13}/>
                        <input placeholder="Search guests…" value={feedbackSearch} onChange={(e) => setFeedbackSearch(e.target.value)} />
                      </div>
                      <div className="ex-response-list">
                        {feedbackResults.forms[0].responses
                          .filter((r) => !feedbackSearch.trim() || (r.guest_name || '').toLowerCase().includes(feedbackSearch.trim().toLowerCase()))
                          .map((r) => <div key={r.id} className="ex-response-row">{r.guest_name || 'Anonymous'} <span className="rd-rowlink">{r.submitted_at ? new Date(r.submitted_at).toLocaleDateString() : ''}</span></div>)}
                        {feedbackResults.forms[0].responses.length === 0 && <p className="rd-rowlink">No responses yet.</p>}
                      </div>
                      <button className="rr-link-btn" style={{ marginTop: 8 }} onClick={startRemindFlow}>Remind non-responders</button>
                    </>
                  )}
                </div>
              </>
            )}
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
        <Modal title={`Preview: ${previewMessage.step}`} onClose={() => setPreviewMessage(null)} width={480}>
          <ChannelPreviewFrame channel={previewMessage.channel || 'email'} body={
            previewMessage.channel === 'sms' ? (previewMessage.preview.sms_body || '')
            : previewMessage.channel === 'whatsapp' ? (previewMessage.preview.whatsapp_body || '')
            : `${previewMessage.preview.subject ? `Subject: ${previewMessage.preview.subject}\n\n` : ''}${previewMessage.preview.email_body || ''}`
          } />
        </Modal>
      )}
    </RedesignShell>
  )
}
