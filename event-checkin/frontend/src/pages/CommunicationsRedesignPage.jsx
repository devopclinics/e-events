import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import RedesignShell, { Icon, Modal, ChannelPreviewFrame } from './redesign/RedesignShell'
import { useCurrentEvent } from '../hooks/useCurrentEvent'
import { useEventDetails } from '../hooks/useEventDetails'
import { useGuests } from '../hooks/useGuests'
import { api } from '../api'
import { seatingTerm } from '../seatingTerm'
import './CommunicationsRedesignPage.css'

/* ── Announcement audience options ─────────────────────────────────── */

const AUDIENCE_OPTIONS = [
  { label: 'All guests', value: 'all' },
  { label: 'Confirmed guests', value: 'attending_only' },
  { label: 'Declined only', value: 'declined_only' },
  { label: 'Checked in', value: 'checked_in_only' },
  { label: 'Not checked in', value: 'not_checked_in' },
]

const AUDIENCE_LABEL = Object.fromEntries(AUDIENCE_OPTIONS.map((o) => [o.value, o.label]))

function fmtRelTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const diff = Date.now() - d
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/* ── Features & Channels config ────────────────────────────────────── */

const ADDON_TOGGLES = [
  { key: 'venueAccess', label: 'Venue Access', desc: 'Zones, multi-zone scans, occupancy analytics.', on: true, settings: [
    ['Zones', '/checkin-redesign?tab=zones'], ['Ticket types', '/checkin-redesign?tab=tickets'],
    ['Assignments', '/checkin-redesign?tab=assign'], ['Rules', '/checkin-redesign?tab=rules'],
    ['Analytics', '/checkin-redesign?tab=analytics'],
  ] },
  { key: 'seating', label: 'Seating', desc: 'Table groups and seat assignments.', on: true, settings: [['Manage seating', '/addons-redesign?tab=seating']] },
  { key: 'partnerPairing', label: 'Partner pairing', desc: 'Link couples/partners so their RSVPs and seating stay in sync.', on: false, settings: [['Manage pairing', '/addons-redesign?tab=seating']] },
  { key: 'orders', label: 'Orders', desc: 'On-site food & merchandise ordering.', on: false, settings: [['Order settings', '/addons-redesign?tab=orders'], ['Kitchen', '/kitchen-redesign']] },
  { key: 'logistics', label: 'Logistics', desc: 'Ship merch and gifts to guests.', on: false, settings: [['Delivery settings', '/addons-redesign?tab=logistics']] },
  { key: 'registry', label: 'Registry', desc: 'Mark-only gift registry — items & cash funds.', on: true, settings: [['Gift-list settings', '/addons-redesign?tab=registry']] },
  { key: 'speakers', label: 'Speakers', desc: 'Public showcase page for your guest speakers.', on: false, settings: [['Speaker settings', '/addons-redesign?tab=speakers']] },
  { key: 'partners', label: 'Partners', desc: 'Public showcase page for sponsors and partners.', on: false, settings: [['Partner settings', '/addons-redesign?tab=partners']] },
  { key: 'reminders', label: 'Reminders', desc: 'Automated pre-event reminder series.', on: false, settings: [['Reminder settings', '/addons-redesign?tab=reminders']] },
  { key: 'experience', label: 'Experience', desc: 'Operational guest journeys, sessions, consent, and feedback.', on: false, settings: [['Experience settings', '/experience-redesign']] },
  { key: 'planner', label: 'Planner', desc: 'Budget, vendors, timeline, runsheet and documents for planning this event.', on: false, settings: [['Open planner', '/planner-redesign']] },
  { key: 'festioLive', label: 'Festio Live', desc: 'Live quizzes, polls, surveys and feedback guests join from their phone, with a presenter screen and TV display.', on: false, settings: [['Open Festio Live', '/live-redesign']] },
  { key: 'festiome', label: 'FestioMe', desc: 'Community chat space for this event\'s guests.', on: true, settings: [['Open FestioMe', '/festiome-redesign']] },
]

const ROUTING_ROWS = [
  { key: 'invites', label: 'Invites', email: true, sms: true, whatsapp: false, mms: false },
  { key: 'admission', label: 'Admission notifications', email: true, sms: false, whatsapp: false, mms: false },
  { key: 'rsvp', label: 'RSVP reminders', email: true, sms: true, whatsapp: true, mms: false },
  { key: 'approval', label: 'Approval notices', email: true, sms: false, whatsapp: false, mms: false },
  { key: 'deliveries', label: 'Deliveries', email: true, sms: true, whatsapp: false, mms: false },
]

const CHANNEL_TOGGLE_ROWS = [
  { key: 'email', label: 'Email', on: true },
  { key: 'sms', label: 'SMS', on: true },
  { key: 'whatsapp', label: 'WhatsApp', on: false },
]

const BROADCAST_PURPOSES = {
  general: {
    label: 'General update',
    description: 'A free-form announcement or operational update.',
    subject: 'Event update',
    message: '',
  },
  thank_you: {
    label: 'Thank you',
    description: 'Thank guests for attending or supporting the event.',
    subject: 'Thank you for being part of our event',
    message: 'Thank you for being part of this special event. We truly appreciate your presence and support.',
  },
  feedback: {
    label: 'Feedback request',
    description: 'Adds each guest’s personal feedback link automatically.',
    subject: 'We would value your feedback',
    message: 'Thank you for attending. Please take a moment to share your feedback—it will help us improve future events.',
  },
  experience_stage: {
    label: 'Experience stage',
    description: 'Send instructions for a selected live Experience step.',
    subject: 'Your next event step',
    message: '',
  },
}

/* ── shared bits ─────────────────────────────────────────────────────── */

function Switch({ checked, onChange, disabled = false }) {
  return (
    <label className={`rd-switch${disabled ? ' rd-switch-disabled' : ''}`}>
      <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} />
      <span className="track" /><span className="knob" />
    </label>
  )
}

/* ── Guest Communication (hub) tab ──────────────────────────────────── */

function HubTab({ eventId, notify }) {
  const [announcements, setAnnouncements] = useState([])
  const [annLoading, setAnnLoading] = useState(false)
  const [annTitle, setAnnTitle] = useState('')
  const [annBody, setAnnBody] = useState('')
  const [annAudience, setAnnAudience] = useState('all')
  const [annSending, setAnnSending] = useState(false)
  const [editingAnn, setEditingAnn] = useState(null)

  const [threads, setThreads] = useState([])
  const [threadsLoading, setThreadsLoading] = useState(false)
  const [openThread, setOpenThread] = useState(null)
  const [threadMessages, setThreadMessages] = useState([])
  const [threadLoading, setThreadLoading] = useState(false)
  const [reply, setReply] = useState('')
  const [replying, setReplying] = useState(false)

  const [chatMessages, setChatMessages] = useState([])
  const [chatLoading, setChatLoading] = useState(false)

  async function loadAll() {
    if (!eventId) return
    setAnnLoading(true); setThreadsLoading(true); setChatLoading(true)
    try {
      const [anns, inbox, chat] = await Promise.all([
        api.listAnnouncements(eventId),
        api.messageInbox(eventId),
        api.guestChatMessages(eventId),
      ])
      setAnnouncements(anns)
      setThreads(inbox)
      setChatMessages(chat)
    } catch (e) {
      notify(e.message || 'Guest communication data could not be loaded')
    } finally {
      setAnnLoading(false); setThreadsLoading(false); setChatLoading(false)
    }
  }

  useEffect(() => { loadAll() }, [eventId])

  async function loadThread(thread) {
    setOpenThread(thread); setThreadMessages([]); setThreadLoading(true)
    try {
      const data = await api.messageThread(eventId, thread.thread_id)
      setThreadMessages(data.messages || [])
    } catch (e) { notify(e.message || 'Thread could not be loaded') }
    finally { setThreadLoading(false) }
  }

  async function sendAnnouncement() {
    if (!annTitle.trim() || !annBody.trim()) return notify('Title and message are required')
    setAnnSending(true)
    try {
      const result = await api.createAnnouncement(eventId, { title: annTitle.trim(), body: annBody.trim(), audience_type: annAudience, send_in_app: true })
      setAnnouncements((prev) => [result, ...prev])
      setAnnTitle(''); setAnnBody('')
      notify(`Announcement sent · ${result.reached ?? 0} guests reached`)
    } catch (e) { notify(e.message || 'Announcement could not be sent') }
    finally { setAnnSending(false) }
  }

  async function saveAnnEdit(id) {
    if (!editingAnn) return
    try {
      const updated = await api.updateAnnouncement(eventId, id, { title: editingAnn.title, body: editingAnn.body })
      setAnnouncements((prev) => prev.map((a) => a.id === id ? { ...a, ...updated } : a))
      setEditingAnn(null); notify('Announcement updated')
    } catch (e) { notify(e.message || 'Update failed') }
  }

  async function sendReply() {
    if (!reply.trim() || !openThread) return
    setReplying(true)
    try {
      const msg = await api.replyMessageThread(eventId, openThread.thread_id, reply.trim())
      setThreadMessages((prev) => [...prev, msg])
      setReply('')
    } catch (e) { notify(e.message || 'Reply could not be sent') }
    finally { setReplying(false) }
  }

  async function moderateMessage(msg) {
    const newStatus = msg.status === 'hidden' ? 'active' : 'hidden'
    try {
      const updated = await api.moderateGuestChatMessage(eventId, msg.id, newStatus)
      setChatMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, ...updated } : m))
      notify(newStatus === 'hidden' ? `Message hidden` : `Message restored`)
    } catch (e) { notify(e.message || 'Moderation action failed') }
  }

  const hiddenChatCount = chatMessages.filter((m) => m.status === 'hidden').length
  const visibleChatCount = chatMessages.filter((m) => m.status === 'active').length

  return (
    <>
      <div className="cm-credit-row">
        <button className="rr-link-btn" onClick={loadAll}>Refresh</button>
      </div>

      <div className="rr-section-title">
        <div><h2>Announcements</h2><p>Post an update to everyone's Hub feed, or a filtered audience</p></div>
      </div>

      <div className="rd-wide-grid">
        <div className="rd-panel">
          <div className="rd-panel-head"><h3>New announcement</h3><p>Guests see this the next time they open their Hub</p></div>
          <div className="rd-panel-body">
            <label className="rd-field-label">Title</label>
            <input className="rd-field" value={annTitle} placeholder="e.g. Parking has moved to Lot C" onChange={(e) => setAnnTitle(e.target.value)} />
            <label className="rd-field-label">Message</label>
            <textarea className="rr-textarea cm-textarea" rows={4} value={annBody} placeholder="Write the update guests will see…" onChange={(e) => setAnnBody(e.target.value)} />
            <label className="rd-field-label">Audience</label>
            <select className="rr-select" value={annAudience} onChange={(e) => setAnnAudience(e.target.value)}>
              {AUDIENCE_OPTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
            <button className="rr-btn primary cm-send-btn" disabled={annSending || !annTitle.trim() || !annBody.trim()} onClick={sendAnnouncement}>
              <Icon name="send" size={14} /> {annSending ? 'Sending…' : 'Send announcement'}
            </button>
          </div>
        </div>

        <div className="rd-panel">
          <div className="rd-panel-head"><h3>Past announcements</h3><p>Reach reflects guests who had the Hub open</p></div>
          <div className="rd-panel-body cm-announce-list">
            {annLoading && <div className="rd-rowlink">Loading…</div>}
            {!annLoading && announcements.map((a) => (
              <div className="cm-announce-row" key={a.id}>
                {editingAnn?.id === a.id ? (
                  <div className="cm-announce-edit">
                    <input className="rd-field" value={editingAnn.title} style={{ marginBottom: 8 }} onChange={(e) => setEditingAnn({ ...editingAnn, title: e.target.value })} />
                    <textarea className="rr-textarea" rows={3} value={editingAnn.body} style={{ marginBottom: 8 }} onChange={(e) => setEditingAnn({ ...editingAnn, body: e.target.value })} />
                    <div className="rd-row2">
                      <button className="rr-btn secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setEditingAnn(null)}>Cancel</button>
                      <button className="rr-btn primary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => saveAnnEdit(a.id)}>Save changes</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div>
                      <strong>{a.title}</strong>
                      <span>{AUDIENCE_LABEL[a.audience_type] || a.audience_type} · {fmtRelTime(a.sent_at || a.created_at)}</span>
                    </div>
                    <div className="cm-announce-right">
                      <button className="rr-link-btn" onClick={() => setEditingAnn({ id: a.id, title: a.title, body: a.body })}>Edit</button>
                    </div>
                  </>
                )}
              </div>
            ))}
            {!annLoading && !announcements.length && <div className="rd-rowlink">No announcements yet.</div>}
          </div>
        </div>
      </div>

      <div className="rr-section-title">
        <div><h2>Guest inbox &amp; chat moderation</h2><p>Private messages to the host, and what's happening in Guest Chat</p></div>
      </div>

      <div className="rd-wide-grid">
        <div className="rd-panel">
          <div className="rd-panel-head"><h3>Guest inbox</h3><p>Private messages sent to the organizer</p></div>
          {threadsLoading ? <div className="rd-panel-body rd-rowlink">Loading…</div> : threads.length === 0 ? (
            <div className="rd-panel-body rd-rowlink">No messages from guests yet.</div>
          ) : (
            <div className="cm-inbox-split">
              <div className="cm-thread-list">
                {threads.map((t) => (
                  <button className={`cm-thread ${openThread?.thread_id === t.thread_id ? 'active' : ''}`} key={t.thread_id} onClick={() => loadThread(t)}>
                    <span className="rd-who-dot">{(t.guest_name || '?')[0].toUpperCase()}</span>
                    <span className="cm-thread-body">
                      <span className="cm-thread-top"><strong>{t.guest_name}</strong><small>{fmtRelTime(t.last_message_at)}</small></span>
                      <span className="cm-thread-preview">{t.last_message}</span>
                      <span className="cm-thread-rsvp">{t.rsvp_status}</span>
                    </span>
                    {t.guest_message_count > 0 && <span className="cm-unread-dot" aria-label="Has messages" />}
                  </button>
                ))}
              </div>
              <div className="cm-thread-view">
                {openThread ? (
                  <>
                    <div className="cm-thread-view-head"><strong>{openThread.guest_name}</strong><span className="rd-status-chip ok">{openThread.rsvp_status}</span></div>
                    <div className="cm-thread-messages">
                      {threadLoading && <div className="cm-msg"><p>Loading…</p></div>}
                      {threadMessages.map((m) => (
                        <div key={m.id} className={`cm-msg ${m.sender_type === 'organizer' ? 'host' : ''}`}>
                          <p>{m.body}</p>
                          <small>{fmtRelTime(m.created_at)}</small>
                        </div>
                      ))}
                    </div>
                    <div className="cm-reply-row">
                      <input className="rr-input" style={{ marginBottom: 0 }} placeholder="Write a reply…" value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendReply()} />
                      <button className="rr-btn primary" disabled={replying || !reply.trim()} onClick={sendReply}>{replying ? '…' : 'Send'}</button>
                    </div>
                  </>
                ) : <div className="rd-rowlink" style={{ padding: 16 }}>Select a conversation to read and reply.</div>}
              </div>
            </div>
          )}
        </div>

        <div className="rd-panel">
          <div className="rd-panel-head"><h3>Chat moderation</h3><p>{visibleChatCount} visible{hiddenChatCount ? ` · ${hiddenChatCount} hidden` : ''}</p></div>
          <div className="rd-panel-body cm-mod-list">
            {chatLoading && <div className="rd-rowlink">Loading…</div>}
            {!chatLoading && chatMessages.map((m) => (
              <div className="cm-mod-row" key={m.id}>
                <span className="rd-who-dot">{(m.sender_name || '?')[0].toUpperCase()}</span>
                <div className="cm-mod-body">
                  <div className="cm-mod-top"><strong>{m.sender_name}</strong><span className={`rd-status-chip ${m.status === 'hidden' ? 'fail' : 'ok'}`}>{m.status === 'hidden' ? 'Hidden' : 'Visible'}</span></div>
                  <p>{m.body}</p>
                </div>
                <button className="rr-btn secondary cm-mod-action" onClick={() => moderateMessage(m)}>{m.status === 'hidden' ? 'Restore' : 'Hide'}</button>
              </div>
            ))}
            {!chatLoading && !chatMessages.length && <div className="rd-rowlink">No chat messages.</div>}
          </div>
        </div>
      </div>
    </>
  )
}


/* ── Broadcast composer ──────────────────────────────────────────────── */

const BROADCAST_TARGETS = [
  { label: 'All guests', value: 'all' },
  { label: 'RSVP: Attending', value: 'confirmed' },
  { label: 'RSVP: Declined', value: 'declined' },
  { label: 'RSVP: No reply', value: 'no_reply' },
  { label: 'Checked in', value: 'admitted' },
  { label: 'Not yet checked in', value: 'not_admitted' },
  { label: 'No one else — just the recipients above', value: 'none' },
]

const BROADCAST_TARGET_LABELS = Object.fromEntries(
  BROADCAST_TARGETS.map(({ label, value }) => [value, label.toLowerCase()])
)

// Keep this calculation aligned with backend/services/messaging.py. SMS strips
// emoji before sending; all remaining non-GSM-7 characters force UCS-2.
const GSM7_CHARS = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\x1bÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà{}\\[~]|€^"

function stripSmsEmoji(text) {
  return text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{2B00}-\u{2BFF}\u{1F900}-\u{1F9FF}\u{FE0F}\u{200D}]/gu, '')
    .replace(/[ \t]{2,}/g, ' ')
}

function smsSegmentInfo(rawText) {
  const text = stripSmsEmoji(rawText)
  const hadEmoji = text.length !== rawText.length
  const chars = text.length
  if (!chars) return { chars: 0, segments: 0, gsm7: true, hadEmoji }
  const gsm7 = [...text].every((character) => GSM7_CHARS.includes(character))
  const singleCapacity = gsm7 ? 160 : 70
  const multipartCapacity = gsm7 ? 153 : 67
  return {
    chars,
    segments: chars <= singleCapacity ? 1 : Math.ceil(chars / multipartCapacity),
    gsm7,
    hadEmoji,
  }
}

function BroadcastComposer({ notify, onSent, eventId }) {
  const [searchParams] = useSearchParams()
  const requestedPurpose = searchParams.get('compose')
  const initialPurpose = BROADCAST_PURPOSES[requestedPurpose] ? requestedPurpose : 'general'
  const [purpose, setPurpose] = useState(initialPurpose)
  const [sendMode, setSendMode] = useState(searchParams.get('mode') === 'test' ? 'test' : 'audience')
  const [subject, setSubject] = useState(BROADCAST_PURPOSES[initialPurpose].subject)
  const [message, setMessage] = useState(BROADCAST_PURPOSES[initialPurpose].message)
  const [experienceSteps, setExperienceSteps] = useState([])
  const [experienceStepId, setExperienceStepId] = useState('')
  const [target, setTarget] = useState('all')
  const [channels, setChannels] = useState({ email: initialPurpose !== 'general', sms: initialPurpose === 'general', whatsapp: false, mms: false })
  const [mmsUrl, setMmsUrl] = useState('')
  const [guestQuery, setGuestQuery] = useState('')
  const [pickedGuests, setPickedGuests] = useState([])
  const { guests: allGuests } = useGuests(eventId)
  const [typedRecipients, setTypedRecipients] = useState([])
  const [typedName, setTypedName] = useState('')
  const [typedContact, setTypedContact] = useState('')
  const [costAck, setCostAck] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  const feedbackSteps = experienceSteps.filter((step) => step.enabled !== false && step.type === 'feedback')
  const stageSteps = experienceSteps.filter((step) => step.enabled !== false && step.type !== 'feedback')
  const contextualPurpose = purpose === 'feedback' || purpose === 'experience_stage'

  const smsInfo = channels.sms && message.trim() ? smsSegmentInfo(message) : null
  const overSegmentLimit = (smsInfo?.segments || 0) > 3
  const pickedIds = new Set(pickedGuests.map((g) => g.id))
  const query = guestQuery.trim().toLowerCase()
  const matches = query.length >= 2
    ? allGuests
        .filter((g) => !pickedIds.has(g.id))
        .filter((g) => {
          const name = [g.first_name, g.last_name].filter(Boolean).join(' ').toLowerCase()
          return name.includes(query)
            || (g.email || '').toLowerCase().includes(query)
            || (g.phone || '').toLowerCase().includes(query)
        })
        .map((g) => ({
          id: g.id,
          name: [g.first_name, g.last_name].filter(Boolean).join(' ') || g.email || g.phone || 'Unnamed guest',
          contact: g.email || g.phone || 'No contact information',
        }))
        .slice(0, 8)
    : []

  useEffect(() => { setCostAck(false) }, [message, channels.sms])

  useEffect(() => {
    let cancelled = false
    api.listExperienceWorkflows(eventId).then((workflows) => {
      if (cancelled) return
      const live = workflows.find((workflow) => workflow.status === 'published')
      const steps = (live?.steps || []).slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
      setExperienceSteps(steps)
      const choices = initialPurpose === 'feedback'
        ? steps.filter((step) => step.enabled !== false && step.type === 'feedback')
        : steps.filter((step) => step.enabled !== false && step.type !== 'feedback')
      if (choices.length) {
        setExperienceStepId(choices[0].id)
        if (initialPurpose === 'experience_stage') {
          const configMessage = choices[0].config?.messages?.guest || choices[0].config?.guest_message || choices[0].description || ''
          setMessage(configMessage)
          setSubject(`${choices[0].title} — event update`)
        }
      }
    }).catch(() => setExperienceSteps([]))
    return () => { cancelled = true }
    // The URL purpose is intentionally applied only when the composer opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId])

  function applyPurpose(nextPurpose) {
    const preset = BROADCAST_PURPOSES[nextPurpose]
    setPurpose(nextPurpose)
    setSubject(preset.subject)
    setMessage(preset.message)
    setChannels({ email: nextPurpose !== 'general', sms: nextPurpose === 'general', whatsapp: false, mms: false })
    setPickedGuests([])
    setTypedRecipients([])
    setGuestQuery('')
    setError('')
    setResult(null)
    if (nextPurpose === 'feedback') {
      setExperienceStepId(feedbackSteps[0]?.id || '')
    } else if (nextPurpose === 'experience_stage') {
      const step = stageSteps[0]
      setExperienceStepId(step?.id || '')
      if (step) {
        setSubject(`${step.title} — event update`)
        setMessage(step.config?.messages?.guest || step.config?.guest_message || step.description || '')
      }
    } else {
      setExperienceStepId('')
    }
  }

  function applyExperienceStep(stepId) {
    setExperienceStepId(stepId)
    const step = experienceSteps.find((item) => item.id === stepId)
    if (purpose === 'experience_stage' && step) {
      setSubject(`${step.title} — event update`)
      setMessage(step.config?.messages?.guest || step.config?.guest_message || step.description || '')
    }
  }

  function toggleChannel(ch) {
    setChannels((prev) => ({ ...prev, [ch]: !prev[ch] }))
  }

  function addTypedRecipient() {
    if (!typedName.trim() || !typedContact.trim()) {
      setError('Name and contact are both required to add a recipient')
      return
    }
    setError('')
    setTypedRecipients((prev) => [...prev, { name: typedName.trim(), contact: typedContact.trim() }])
    setTypedName('')
    setTypedContact('')
  }

  function audienceSummary() {
    if (sendMode === 'test') {
      return pickedGuests.length === 1 ? `${pickedGuests[0].name} (one-person test)` : 'one selected guest'
    }
    if (purpose === 'feedback') return 'eligible guests who have not responded'
    const audience = pickedGuests.length
      ? `${pickedGuests.length} selected guest${pickedGuests.length === 1 ? '' : 's'}`
      : BROADCAST_TARGET_LABELS[target]
    return typedRecipients.length
      ? `${audience} + ${typedRecipients.length} direct recipient${typedRecipients.length === 1 ? '' : 's'}`
      : audience
  }

  async function send() {
    if (overSegmentLimit && !costAck) {
      setError(`Check the SMS cost box before sending — this message is ${smsInfo.segments} segments per recipient.`)
      return
    }
    if (!message.trim()) {
      setError('Enter a message before sending')
      return
    }
    if (!Object.values(channels).some(Boolean)) {
      setError('Select at least one channel')
      return
    }
    if (contextualPurpose && !experienceStepId) {
      setError(purpose === 'feedback' ? 'Choose a live feedback form' : 'Choose an Experience stage')
      return
    }
    if (sendMode === 'test' && pickedGuests.length !== 1) {
      setError('Choose exactly one guest for the test send')
      return
    }
    if (channels.mms && !/^https:\/\//i.test(mmsUrl.trim())) {
      setError('MMS needs an image URL starting with https://')
      return
    }
    if (sendMode === 'audience' && target === 'none' && !pickedGuests.length && !typedRecipients.length) {
      setError('Add at least one guest or direct recipient')
      return
    }
    const costNote = smsInfo?.segments > 1
      ? ` This uses ${smsInfo.segments} SMS credits per recipient.`
      : ''
    if (!window.confirm(`Send broadcast to ${audienceSummary()}?${costNote}`)) return
    setSending(true)
    setError('')
    setResult(null)
    try {
      const result = await api.broadcast(eventId, {
        message: message.trim(),
        subject: subject.trim() || null,
        message_type: purpose,
        experience_step_id: contextualPurpose ? experienceStepId : null,
        target: sendMode === 'test'
          ? 'none'
          : purpose === 'feedback'
            ? 'feedback_nonresponders'
            : pickedGuests.length ? 'none' : target,
        guest_ids: pickedGuests.map((g) => g.id),
        channels: Object.entries(channels).filter(([, enabled]) => enabled).map(([channel]) => channel),
        extra_recipients: sendMode === 'test' || contextualPurpose ? [] : typedRecipients.map((recipient) => ({ name: recipient.name, ...(recipient.contact.includes('@') ? { email: recipient.contact } : { phone: recipient.contact }) })),
        mms_media_url: channels.mms ? mmsUrl.trim() : null,
      })
      setResult(result)
      setGuestQuery('')
      setPickedGuests([])
      setTypedRecipients([])
      setMmsUrl('')
      notify(`${sendMode === 'test' ? 'Test send' : BROADCAST_PURPOSES[purpose].label} confirmed — queued: ${result.queued}, skipped (no contact): ${result.skipped_no_contact}, skipped (no consent): ${result.skipped_no_consent}, skipped (no credits): ${result.skipped_no_credits}`)
      await onSent?.()
    } catch (e) {
      const detail = e.message || 'Broadcast was not sent'
      setError(detail)
      notify(detail)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="rr-panel cm-composer">
      <div className="rd-panel-head cm-broadcast-head">
        <div className="cm-broadcast-icon"><Icon name="send" size={16} /></div>
        <div>
          <h3>Broadcast message</h3>
          <p>Send a live event update to a guest segment, selected guests, or a direct contact</p>
        </div>
      </div>
      <div className="rd-panel-body">
        <div className="cm-purpose-grid">
          <div>
            <label className="rd-field-label">Message type</label>
            <select className="rr-select" aria-label="Message type" value={purpose} onChange={(event) => applyPurpose(event.target.value)}>
              {Object.entries(BROADCAST_PURPOSES).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}
            </select>
            <p className="rd-hint cm-broadcast-hint">{BROADCAST_PURPOSES[purpose].description}</p>
          </div>
          <div>
            <label className="rd-field-label">Send mode</label>
            <select className="rr-select" aria-label="Send mode" value={sendMode} onChange={(event) => {
              const mode = event.target.value
              setSendMode(mode)
              setPickedGuests([])
              setTypedRecipients([])
              setGuestQuery('')
              setError('')
            }}>
              <option value="audience">Send to an audience</option>
              <option value="test">Test with one guest</option>
            </select>
            <p className="rd-hint cm-broadcast-hint">{sendMode === 'test' ? 'Only the one guest you select will receive it.' : 'Use a guest segment or the feedback audience.'}</p>
          </div>
        </div>

        {purpose === 'feedback' && (
          <div className="cm-context-picker">
            <label className="rd-field-label">Feedback form</label>
            <select className="rr-select" value={experienceStepId} onChange={(event) => applyExperienceStep(event.target.value)}>
              <option value="">Choose a live feedback form…</option>
              {feedbackSteps.map((step) => <option key={step.id} value={step.id}>{step.title}</option>)}
            </select>
            {!feedbackSteps.length && <p className="cm-broadcast-feedback error">No feedback form is published in the live Experience workflow.</p>}
          </div>
        )}
        {purpose === 'experience_stage' && (
          <div className="cm-context-picker">
            <label className="rd-field-label">Experience stage</label>
            <select className="rr-select" value={experienceStepId} onChange={(event) => applyExperienceStep(event.target.value)}>
              <option value="">Choose a live Experience stage…</option>
              {stageSteps.map((step) => <option key={step.id} value={step.id}>{step.title}</option>)}
            </select>
            {!stageSteps.length && <p className="cm-broadcast-feedback error">No stages are published in the live Experience workflow.</p>}
          </div>
        )}

        {channels.email && <>
          <label className="rd-field-label">Email subject</label>
          <input className="rd-field" value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Email subject"/>
        </>}
        <label className="rd-field-label">Message</label>
        <textarea className="rr-textarea cm-broadcast-message" rows={4} placeholder="e.g. Doors open at 7pm. Parking is available on Main Street." value={message} onChange={(e) => setMessage(e.target.value)} />
        <p className="rd-hint cm-broadcast-hint">Email supports **bold**, bullet lines and links. SMS, WhatsApp and MMS send plain text.</p>
        {smsInfo && <div className={`cm-sms-meter ${overSegmentLimit ? 'over' : ''}`}>
          <Icon name="message" size={12} />
          {smsInfo.chars} character{smsInfo.chars === 1 ? '' : 's'} · {smsInfo.segments} SMS segment{smsInfo.segments === 1 ? '' : 's'} per recipient
          {smsInfo.hadEmoji ? ' · emoji will be removed from SMS' : (!smsInfo.gsm7 ? ' · Unicode encoding' : '')}
          {smsInfo.segments > 1 ? ` · ${smsInfo.segments}× SMS cost` : ''}
        </div>}
        {overSegmentLimit && (
          <label className="gr-required-check cm-cost-ack">
            <input type="checkbox" checked={costAck} onChange={(e) => setCostAck(e.target.checked)} />
            I understand this will use {smsInfo.segments} SMS credits per recipient and want to send anyway
          </label>
        )}

        {(sendMode === 'test' || purpose !== 'feedback') ? <>
          <label className="rd-field-label" style={{ marginTop: 12 }}>{sendMode === 'test' ? 'Choose one test guest' : 'Search guest list'} — {allGuests.length} guest{allGuests.length === 1 ? '' : 's'} loaded</label>
          <p className="rd-hint cm-broadcast-hint">{sendMode === 'test' ? 'This guest receives the real message on the selected channels.' : 'Optional — selecting guests overrides the audience segment below.'}</p>
          <div className="rd-search cm-broadcast-search">
            <Icon name="search" size={13} />
            <input placeholder="Search by name, email or phone…" value={guestQuery} onChange={(e) => setGuestQuery(e.target.value)} />
          </div>
          {query.length >= 2 && (
            <div className="cm-guest-matches">
              {matches.length ? matches.map((g) => (
                <button type="button" key={g.id} onClick={() => { setPickedGuests((prev) => sendMode === 'test' ? [g] : [...prev, g]); setGuestQuery('') }}>
                  <strong>{g.name}</strong><span>{g.contact}</span>
                </button>
              )) : <div className="cm-guest-empty">No matching guests found.</div>}
            </div>
          )}
          <div className="cm-picked-chips">
            {pickedGuests.map((g) => (
              <span className="rd-chip" key={g.id}>{g.name} <button type="button" aria-label={`Remove ${g.name}`} onClick={() => setPickedGuests((prev) => prev.filter((x) => x.id !== g.id))}>✕</button></span>
            ))}
          </div>
        </> : <div className="cm-fixed-audience cm-feedback-audience-note">Guests who already submitted this form are excluded automatically.</div>}

        {sendMode === 'audience' && !contextualPurpose && <>
          <label className="rd-field-label" style={{ marginTop: 10 }}>Or send directly to someone not on the guest list</label>
          <div className="cm-direct-recipient">
            <input className="rd-field" placeholder="Name (required)" value={typedName} onChange={(e) => setTypedName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTypedRecipient()} />
            <input className="rd-field" placeholder="Email or phone" value={typedContact} onChange={(e) => setTypedContact(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTypedRecipient()} />
            <button className="rr-btn secondary" disabled={!typedName.trim() || !typedContact.trim()} onClick={addTypedRecipient}>+ Add</button>
          </div>
          <div className="cm-picked-chips">
            {typedRecipients.map((r, i) => (
              <span className="rd-chip" key={`${r.contact}-${i}`}>{r.name} — {r.contact} <button type="button" aria-label={`Remove ${r.name}`} onClick={() => setTypedRecipients((prev) => prev.filter((_, idx) => idx !== i))}>✕</button></span>
            ))}
          </div>
        </>}

        <div className="cm-broadcast-controls">
          <div>
            <label className="rd-field-label">Send to</label>
            {sendMode === 'test'
              ? <div className="cm-fixed-audience">One selected guest</div>
              : purpose === 'feedback'
                ? <div className="cm-fixed-audience">Eligible guests who have not responded</div>
                : <select className="rr-select" aria-label="Send to" value={target} onChange={(e) => setTarget(e.target.value)} disabled={pickedGuests.length > 0}>
                    {BROADCAST_TARGETS.map(({ label, value }) => <option key={value} value={value}>{label}</option>)}
                  </select>}
            {sendMode === 'audience' && purpose !== 'feedback' && pickedGuests.length > 0 && <p className="rd-hint">Audience ignored — sending only to selected guests and direct recipients.</p>}
          </div>
          <div>
            <label className="rd-field-label">Channels</label>
            <div className="cm-channel-checks">
              {['email', 'sms', 'whatsapp', 'mms'].map((ch) => (
                <label key={ch}><input type="checkbox" checked={channels[ch]} onChange={() => toggleChannel(ch)} /> {ch.toUpperCase()}</label>
              ))}
            </div>
          </div>
        </div>
        {channels.mms && (
          <input className="rd-field" placeholder="MMS image URL (https://…)" value={mmsUrl} onChange={(e) => setMmsUrl(e.target.value)} style={{ marginTop: 6 }} />
        )}

        <div className="cm-broadcast-summary">
          <span><Icon name="users" size={14} /> Will send to: <strong>{audienceSummary()}</strong></span>
          <span>{Object.entries(channels).filter(([, enabled]) => enabled).map(([channel]) => channel.toUpperCase()).join(' · ') || 'No channel selected'}</span>
        </div>
        {error && <div className="cm-broadcast-feedback error" role="alert">{error}</div>}
        {result && (
          <div className="cm-broadcast-feedback success" role="status">
            Broadcast confirmed · {result.queued} queued · {result.skipped_no_contact || 0} no contact · {result.skipped_no_consent || 0} no consent
            {result.skipped_no_credits ? ` · ${result.skipped_no_credits} out of credits` : ''}
          </div>
        )}

        <div className="cm-broadcast-actions">
          <span>Sending starts immediately after confirmation.</span>
          <button className="rr-btn primary" disabled={sending || !message.trim() || (overSegmentLimit && !costAck)} onClick={send}>
            <Icon name="send" size={14} /> {sending ? 'Sending…' : sendMode === 'test' ? 'Send one-person test' : `Send ${BROADCAST_PURPOSES[purpose].label.toLowerCase()}`}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Messages tab (broadcast + templates) ───────────────────────────── */

function MessagesTab({ notify, onPreview, eventId }) {
  const [attnQuery, setAttnQuery] = useState('')
  const [attnFilter, setAttnFilter] = useState('all')
  const [templates, setTemplates] = useState([])
  const [templateAudit, setTemplateAudit] = useState([])
  const [templateError, setTemplateError] = useState('')
  const [templateBusy, setTemplateBusy] = useState('')
  const [templateEditor, setTemplateEditor] = useState(null)
  const [templateTest, setTemplateTest] = useState(null)
  const [templateQuery, setTemplateQuery] = useState('')
  const [broadcastOpen, setBroadcastOpen] = useState(true)
  const [deliveryOpen, setDeliveryOpen] = useState(false)
  const [templatesOpen, setTemplatesOpen] = useState(true)
  const [templateAuditOpen, setTemplateAuditOpen] = useState(false)
  const [orgMembers, setOrgMembers] = useState([])
  const [communication, setCommunication] = useState(null)
  const [broadcasts, setBroadcasts] = useState([])
  const { guests } = useGuests(eventId)
  const attentionGuests = guests.filter((g) => g.invite_status === 'failed' || !g.invite_sent_at)

  async function loadTemplates() {
    if (!eventId) {
      setTemplates([])
      setTemplateAudit([])
      setOrgMembers([])
      return
    }
    try {
      const [items, audit, members] = await Promise.all([
        api.listTemplates(eventId),
        api.templateAudit(eventId).catch(() => []),
        api.listOrgMembers(eventId).catch(() => []),
      ])
      setTemplates(items)
      setTemplateAudit(audit)
      setOrgMembers(members)
      setTemplateError('')
    } catch (e) {
      setTemplateError(e.message || 'Message templates could not be loaded')
    }
  }

  async function loadDeliveryData() {
    if (!eventId) {
      setCommunication(null)
      setBroadcasts([])
      return
    }
    try {
      const [inv, bc] = await Promise.all([
        api.resultsInvitations(eventId),
        api.resultsBroadcasts(eventId).catch(() => []),
      ])
      setCommunication(inv.communication)
      setBroadcasts(bc)
    } catch (e) {
      notify(e.message || 'Delivery data could not be loaded', true)
    }
  }

  function openTemplateEditor(template) {
    setTemplateEditor({
      template,
      subject: template.effective?.subject || '',
      email_body: template.effective?.email_body || '',
      sms_body: template.effective?.sms_body || '',
      whatsapp_body: template.effective?.whatsapp_body || '',
      mms_body: template.effective?.mms_body || '',
    })
  }

  async function saveTemplateEditor() {
    if (!templateEditor || templateBusy) return
    setTemplateBusy(templateEditor.template.key)
    try {
      await api.saveTemplate(eventId, templateEditor.template.key, {
        subject: templateEditor.subject || null,
        email_body: templateEditor.email_body || null,
        sms_body: templateEditor.sms_body || null,
        whatsapp_body: templateEditor.whatsapp_body || null,
        mms_body: templateEditor.mms_body || null,
      })
      setTemplateEditor(null)
      await loadTemplates()
      notify('Message template saved')
    } catch (error) {
      notify(error.message || 'Message template could not be saved', true)
    } finally {
      setTemplateBusy('')
    }
  }

  function openTemplateTest(template) {
    const channels = template.channels.filter((channel) => channel !== 'mms')
    setTemplateTest({
      template,
      channel: channels[0] || '',
      query: '',
      to: '',
      selectedLabel: '',
      sending: false,
    })
  }

  async function sendTemplateTest() {
    if (!templateTest?.channel || !templateTest.to.trim() || templateTest.sending) return
    setTemplateTest((current) => ({ ...current, sending: true }))
    try {
      await api.testSendTemplate(eventId, templateTest.template.key, {
        channel: templateTest.channel,
        to: templateTest.to.trim(),
      })
      notify(`Test ${templateTest.channel} sent to ${templateTest.to.trim()}`)
      setTemplateTest(null)
    } catch (error) {
      notify(error.message || 'Test message was not sent', true)
      setTemplateTest((current) => current ? { ...current, sending: false } : current)
    }
  }

  useEffect(() => { loadTemplates(); loadDeliveryData() }, [eventId])

  const CHANNEL_LABELS = { email: 'Email', sms: 'SMS', whatsapp: 'WhatsApp' }
  const channelStats = communication
    ? ['email', 'sms', 'whatsapp'].map((key) => {
        const c = communication[key] || {}
        const delivered = c.reached ?? c.delivered ?? 0
        return { key, label: CHANNEL_LABELS[key], rate: c.rate ?? null, sent: c.sent ?? 0, failed: Math.max(0, (c.sent ?? 0) - delivered) }
      })
    : []

  const filteredAttention = attentionGuests
    .map((g) => ({
      name: [g.first_name, g.last_name].filter(Boolean).join(' ') || g.email || g.phone || 'Unnamed guest',
      initials: ((g.first_name?.[0] || '') + (g.last_name?.[0] || '')).toUpperCase() || '—',
      status: g.invite_status === 'failed' ? 'fail' : 'warn',
      label: g.invite_status === 'failed' ? 'Failed' : 'Not sent',
      reason: g.invite_status === 'failed' ? 'Delivery failed' : (!g.email && !g.phone ? 'No contact info on file' : 'Not sent yet'),
      guestId: g.id,
    }))
    .filter((g) => {
      if (attnFilter === 'sent' && g.status !== 'warn') return false
      if (attnFilter === 'failed' && g.status !== 'fail') return false
      return g.name.toLowerCase().includes(attnQuery.trim().toLowerCase())
    })

  const testRecipientOptions = (() => {
    if (!templateTest) return []
    const isEmail = templateTest.channel === 'email'
    const options = []
    if (isEmail) {
      for (const member of orgMembers) {
        const email = member.user?.email?.trim()
        if (!email) continue
        options.push({
          id: `team-${member.user.id}`,
          name: member.user.name || email,
          contact: email,
          source: `Team · ${member.role || 'member'}`,
        })
      }
    }
    for (const guest of guests) {
      const contact = (isEmail ? guest.email : guest.phone)?.trim()
      if (!contact) continue
      options.push({
        id: `guest-${guest.id}`,
        name: [guest.first_name, guest.last_name].filter(Boolean).join(' ') || contact,
        contact,
        source: 'Guest',
      })
    }
    const seen = new Set()
    return options.filter((option) => {
      const key = option.contact.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  })()
  const testRecipientQuery = (templateTest?.query || '').trim().toLowerCase()
  const visibleTestRecipients = testRecipientOptions
    .filter((option) => !testRecipientQuery
      || option.name.toLowerCase().includes(testRecipientQuery)
      || option.contact.toLowerCase().includes(testRecipientQuery))
    .slice(0, 12)
  const normalizedTemplateQuery = templateQuery.trim().toLowerCase()
  const filteredTemplates = templates.filter((template) => {
    if (!normalizedTemplateQuery) return true
    const searchable = [
      template.label,
      template.key,
      template.group,
      template.source === 'event-customized' ? 'custom customized' : 'default',
      ...(template.channels || []),
    ].filter(Boolean).join(' ').toLowerCase()
    return searchable.includes(normalizedTemplateQuery)
  })

  return (
    <>
      <div className="rr-section-title cm-collapsible-title">
        <div><h2>Broadcast center</h2><p>Send one-off updates without leaving the communications workspace</p></div>
        <button className="rr-btn secondary cm-collapse-btn" type="button" aria-label={`${broadcastOpen ? 'Collapse' : 'Expand'} broadcast center`} aria-expanded={broadcastOpen} aria-controls="broadcast-center-content" onClick={() => setBroadcastOpen((open) => !open)}>
          {broadcastOpen ? 'Collapse' : 'Expand'} <span aria-hidden="true" className={broadcastOpen ? 'open' : ''}>⌄</span>
        </button>
      </div>

      {broadcastOpen && <div id="broadcast-center-content">
        <BroadcastComposer eventId={eventId} notify={notify} onSent={loadDeliveryData} />
      </div>}

      <div className="rr-section-title cm-collapsible-title">
        <div><h2>Delivery by channel</h2><p>Live send rates across every channel this event uses</p></div>
        <button className="rr-btn secondary cm-collapse-btn" type="button" aria-label={`${deliveryOpen ? 'Collapse' : 'Expand'} delivery by channel`} aria-expanded={deliveryOpen} aria-controls="delivery-by-channel-content" onClick={() => setDeliveryOpen((open) => !open)}>
          {deliveryOpen ? 'Collapse' : 'Expand'} <span aria-hidden="true" className={deliveryOpen ? 'open' : ''}>⌄</span>
        </button>
      </div>

      {deliveryOpen && <div className="rd-wide-grid" id="delivery-by-channel-content">
        <div className="rd-panel">
          <div className="rd-panel-body">
            <div className="rd-channels">
              {channelStats.map((c) => (
                <div className="rd-chan" key={c.key}>
                  <div className="top">
                    <span className="name">{c.label.toUpperCase()}</span>
                    <Icon name={c.key === 'sms' ? 'message' : c.key === 'email' ? 'mail' : 'whatsapp'} size={14} />
                  </div>
                  <div className="rate">{c.rate === null ? '—' : <>{c.rate}<small>%</small></>}</div>
                  <div className="rd-mini-bar"><i style={{ width: `${c.rate || 0}%` }} /></div>
                  <div className="foot"><span>{c.sent} sent</span>{c.failed > 0 ? <span className="fail">{c.failed} failed</span> : <span>—</span>}</div>
                </div>
              ))}
              {!channelStats.length && <p className="rd-rowlink">Channel delivery data is not available yet.</p>}
            </div>

            <div className="rd-attn-toolbar">
              <div className="rd-search">
                <Icon name="search" size={14} />
                <input placeholder="Search guests needing attention…" value={attnQuery} onChange={(e) => setAttnQuery(e.target.value)} />
              </div>
              <div className="rd-seg">
                <button className={attnFilter === 'all' ? 'on' : ''} onClick={() => setAttnFilter('all')}>All</button>
                <button className={attnFilter === 'sent' ? 'on' : ''} onClick={() => setAttnFilter('sent')}>Not sent</button>
                <button className={attnFilter === 'failed' ? 'on' : ''} onClick={() => setAttnFilter('failed')}>Failed</button>
              </div>
            </div>
            <table className="rd-attn">
              <thead><tr><th>Guest</th><th>Status</th><th>Reason</th><th /></tr></thead>
              <tbody>
                {filteredAttention.map((g) => (
                  <tr key={g.guestId}>
                    <td><div className="rd-who"><span className="dot">{g.initials}</span> {g.name}</div></td>
                    <td><span className={`rd-status-chip ${g.status}`}>{g.label}</span></td>
                    <td className="rd-rowlink">{g.reason}</td>
                    <td className="rd-rowlink"><a className="cm-linklike" href={`/guests-redesign?tab=guests&guest=${encodeURIComponent(g.guestId)}`}>Open in Guests →</a></td>
                  </tr>
                ))}
                {filteredAttention.length === 0 && (
                  <tr><td colSpan={4} className="rd-rowlink cm-empty-row">No matches.</td></tr>
                )}
              </tbody>
            </table>
            <div className="rd-attn-footer">
              <span>Showing {filteredAttention.length} of {attentionGuests.length} needing attention</span>
              <a className="rr-btn secondary cm-small-btn" href="/guests-redesign">View all in Guests →</a>
            </div>
          </div>
        </div>

        <div className="rd-panel">
          <div className="rd-panel-head"><h3>Send history</h3><p>Recent broadcasts, most recent first</p></div>
          <div className="rd-panel-body">
            <div className="rd-timeline">
              {broadcasts.map((b, i) => {
                const skipped = (b.skipped_no_contact || 0) + (b.skipped_no_consent || 0) + (b.skipped_no_credits || 0)
                return (
                  <details className="rd-batch" key={b.id} open={i === 0}>
                    <summary>
                      <Icon name="arrow" size={10} className="rd-chev" />
                      <span className={`rd-batch-dot ${i === 0 ? '' : 'old'}`} />
                      <span className="rd-batch-when">{new Date(b.created_at).toLocaleString()}</span>
                      <span className="rd-batch-tally">{(b.channels || []).join(', ')} · <b>{b.queued} queued</b>{skipped ? <> · <span className="f">{skipped} skipped</span></> : null}</span>
                    </summary>
                    <div className="rd-batch-guests">
                      <span className="rd-rowlink" title={b.message}>{b.message}</span>
                      {skipped > 0 && <span className="rd-rowlink">No contact {b.skipped_no_contact || 0} · No consent {b.skipped_no_consent || 0}{b.skipped_no_credits ? ` · Out of credits ${b.skipped_no_credits}` : ''}</span>}
                    </div>
                  </details>
                )
              })}
              {!broadcasts.length && <p className="rd-rowlink">No broadcasts sent yet.</p>}
            </div>
          </div>
        </div>
      </div>}

      <div className="rr-section-title cm-collapsible-title">
        <div><h2>Templates</h2><p>Each channel falls back to the default template unless it has its own override</p></div>
        <div className="cm-section-actions">
          <span className="cm-section-count">{filteredTemplates.length} of {templates.length}</span>
          <button className="rr-btn secondary cm-collapse-btn" type="button" aria-label={`${templatesOpen ? 'Collapse' : 'Expand'} templates`} aria-expanded={templatesOpen} aria-controls="message-templates-content" onClick={() => setTemplatesOpen((open) => !open)}>
            {templatesOpen ? 'Collapse' : 'Expand'} <span aria-hidden="true" className={templatesOpen ? 'open' : ''}>⌄</span>
          </button>
        </div>
      </div>

      {templatesOpen && <div id="message-templates-content">
      <div className="cm-template-toolbar">
        <div className="rd-search">
          <Icon name="search" size={14} />
          <input aria-label="Search templates" placeholder="Search templates by name, channel or status…" value={templateQuery} onChange={(event) => setTemplateQuery(event.target.value)} />
        </div>
        {templateQuery && <button type="button" className="cm-linklike" onClick={() => setTemplateQuery('')}>Clear search</button>}
      </div>
      <div className="cm-template-grid">
        {filteredTemplates.map((t) => (
          <article className="rr-panel cm-template-card" key={t.key}>
            <div className="cm-template-card-head">
              <div>
                <strong>{t.label}</strong>
                <span>{t.source === 'event-customized' ? 'Customized for this event' : 'Using Festio default'}</span>
              </div>
              <span className={`cm-badge ${t.source === 'event-customized' ? 'custom' : 'default'}`}>
                {t.source === 'event-customized' ? 'Custom' : 'Default'}
              </span>
            </div>
            <div className="cm-template-channels">
              {['email', 'sms', 'whatsapp', 'mms'].map((ch) => (
                <span key={ch} className={t.channels.includes(ch) ? 'on' : 'off'}>
                  <Icon name={ch === 'email' ? 'mail' : ch === 'whatsapp' ? 'whatsapp' : ch === 'mms' ? 'image' : 'message'} size={12}/>
                  {ch.toUpperCase()}
                </span>
              ))}
            </div>
            <div className="cm-tpl-actions">
                  <button className="cm-linklike" onClick={() => openTemplateEditor(t)}>Edit</button>
                  <button className="cm-linklike" onClick={async () => {
                    try {
                      const preview = await api.previewTemplate(eventId, t.key, {})
                      onPreview?.({ ...t, name: t.label, preview }, t.channels[0] || 'email')
                    } catch (e) { notify(e.message || 'Template preview could not be rendered') }
                  }}>Preview</button>
                  <button className="cm-linklike" onClick={() => openTemplateTest(t)}>Test send</button>
                  <button className="cm-linklike gr-danger-link" disabled={templateBusy === t.key || t.source !== 'event-customized'} onClick={async () => {
                    if (!window.confirm(`Reset “${t.label}” to the platform default?`)) return
                    setTemplateBusy(t.key)
                    try {
                      await api.resetTemplate(eventId, t.key)
                      await loadTemplates()
                      notify(`${t.label} reset to the platform default`)
                    } catch (e) { notify(e.message || 'Template could not be reset') } finally { setTemplateBusy('') }
                  }}>Reset</button>
            </div>
          </article>
        ))}
        {!templates.length && <div className="rr-panel rd-panel-body rd-rowlink">{templateError || 'No message templates available.'}</div>}
        {templates.length > 0 && !filteredTemplates.length && <div className="rr-panel rd-panel-body rd-rowlink cm-template-no-results">No templates match “{templateQuery}”.</div>}
      </div>

      </div>}

      <div className="rr-section-title cm-collapsible-title cm-audit-title">
        <div><h2>Recent template changes</h2><p>Review who changed a template and when</p></div>
        <div className="cm-section-actions">
          <span className="cm-section-count">{templateAudit.length} {templateAudit.length === 1 ? 'change' : 'changes'}</span>
          <button className="rr-btn secondary cm-collapse-btn" type="button" aria-label={`${templateAuditOpen ? 'Collapse' : 'Expand'} recent template changes`} aria-expanded={templateAuditOpen} aria-controls="recent-template-changes-content" onClick={() => setTemplateAuditOpen((open) => !open)}>
            {templateAuditOpen ? 'Collapse' : 'Expand'} <span aria-hidden="true" className={templateAuditOpen ? 'open' : ''}>⌄</span>
          </button>
        </div>
      </div>

      {templateAuditOpen && <div className="rd-panel cm-audit-panel" id="recent-template-changes-content">
        <div className="rd-panel-body">
          {templateAudit.map((a, i) => (
            <div className="cm-audit-row" key={i}>
              <strong>{a.changed_by_email || 'Festio operator'}</strong> — {a.action} {a.template_key} <span>{a.changed_at ? new Date(a.changed_at).toLocaleString() : ''}</span>
            </div>
          ))}
          {!templateAudit.length && <div className="cm-audit-row">No template changes recorded.</div>}
        </div>
      </div>}
      {templateEditor && (
        <Modal title={`Edit: ${templateEditor.template.label}`} onClose={() => setTemplateEditor(null)} width={680}>
          <p className="rd-hint">Available placeholders: {(templateEditor.template.placeholders || []).map((value) => `{{${value}}}`).join(', ') || 'none'}</p>
          {templateEditor.template.channels.includes('email') && <>
            <label className="rd-field-label">Email subject</label>
            <input className="rd-field" value={templateEditor.subject} onChange={(event) => setTemplateEditor((value) => ({ ...value, subject: event.target.value }))} />
            <label className="rd-field-label">Email HTML</label>
            <textarea className="rr-textarea" rows={7} value={templateEditor.email_body} onChange={(event) => setTemplateEditor((value) => ({ ...value, email_body: event.target.value }))} />
          </>}
          {['sms', 'whatsapp', 'mms'].filter((channel) => templateEditor.template.channels.includes(channel)).map((channel) => (
            <div key={channel}>
              <label className="rd-field-label">{channel.toUpperCase()} body</label>
              <textarea className="rr-textarea" rows={4} value={templateEditor[`${channel}_body`]} onChange={(event) => setTemplateEditor((value) => ({ ...value, [`${channel}_body`]: event.target.value }))} />
            </div>
          ))}
          <div className="rd-row2" style={{ marginTop: 12 }}>
            <button className="rr-btn secondary" onClick={() => setTemplateEditor(null)}>Cancel</button>
            <button className="rr-btn primary" disabled={templateBusy === templateEditor.template.key} onClick={saveTemplateEditor}>{templateBusy ? 'Saving…' : 'Save template'}</button>
          </div>
        </Modal>
      )}
      {templateTest && (
        <Modal title={`Test send: ${templateTest.template.label}`} onClose={() => setTemplateTest(null)} width={560}>
          <p className="rd-hint cm-test-send-note">Choose a team member or guest below. This sends one real message only; it does not contact the event audience.</p>
          <label className="rd-field-label">Channel</label>
          <select
            className="rr-select cm-test-channel"
            value={templateTest.channel}
            onChange={(event) => setTemplateTest((current) => ({ ...current, channel: event.target.value, query: '', to: '', selectedLabel: '' }))}
          >
            {templateTest.template.channels.filter((channel) => channel !== 'mms').map((channel) => (
              <option key={channel} value={channel}>{channel.toUpperCase()}</option>
            ))}
          </select>

          <label className="rd-field-label">Search names and {templateTest.channel === 'email' ? 'email addresses' : 'phone numbers'}</label>
          <div className="rd-search cm-test-recipient-search">
            <Icon name="search" size={14} />
            <input
              autoFocus
              placeholder={templateTest.channel === 'email' ? 'Search team and guests by name or email…' : 'Search guests by name or phone…'}
              value={templateTest.query}
              onChange={(event) => setTemplateTest((current) => ({ ...current, query: event.target.value }))}
            />
          </div>
          <div className="cm-test-recipient-list" role="listbox" aria-label="Test recipients">
            {visibleTestRecipients.map((option) => (
              <button
                type="button"
                role="option"
                aria-selected={templateTest.to === option.contact}
                className={templateTest.to === option.contact ? 'selected' : ''}
                key={option.id}
                onClick={() => setTemplateTest((current) => ({ ...current, to: option.contact, selectedLabel: option.name }))}
              >
                <span><strong>{option.name}</strong><small>{option.source}</small></span>
                <span>{option.contact}</span>
              </button>
            ))}
            {!visibleTestRecipients.length && <div className="cm-guest-empty">No matching recipient with a usable {templateTest.channel === 'email' ? 'email address' : 'phone number'}.</div>}
          </div>

          <label className="rd-field-label">Or enter a {templateTest.channel === 'email' ? 'direct email address' : 'direct phone number'}</label>
          <input
            className="rd-field"
            type={templateTest.channel === 'email' ? 'email' : 'tel'}
            placeholder={templateTest.channel === 'email' ? 'name@example.com' : '+234…'}
            value={templateTest.to}
            onChange={(event) => setTemplateTest((current) => ({ ...current, to: event.target.value, selectedLabel: '' }))}
          />
          {templateTest.selectedLabel && <p className="rd-hint cm-test-selected">Selected: <strong>{templateTest.selectedLabel}</strong> · {templateTest.to}</p>}

          <div className="rd-row2 cm-test-actions">
            <button className="rr-btn secondary" onClick={() => setTemplateTest(null)}>Cancel</button>
            <button className="rr-btn primary" disabled={!templateTest.to.trim() || templateTest.sending} onClick={sendTemplateTest}>
              {templateTest.sending ? 'Sending…' : `Send ${templateTest.channel.toUpperCase()} test`}
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}

/* ── Features & Channels tab ─────────────────────────────────────────── */

const ROUTE_API_KEY = { invites: 'invite', admission: 'admission', rsvp: 'reminder', approval: 'approval', deliveries: 'logistics' }

const ADDON_FEATURE_KEY = {
  venueAccess: 'venue_access_enabled', seating: 'seating_enabled', partnerPairing: 'partner_pairing_enabled',
  orders: 'menu_enabled', logistics: 'logistics_enabled', registry: 'registry_enabled',
  speakers: 'speaker_enabled', partners: 'partner_enabled', reminders: 'reminders_enabled',
  experience: 'experience_enabled', festiome: 'festiome_addon_enabled', planner: 'planner_enabled',
  festioLive: 'engagement_enabled',
}
const ADDON_PLAN_KEY = {
  venueAccess: 'addon_venue_access', seating: 'addon_seating', partnerPairing: 'addon_seating',
  orders: 'addon_menu', logistics: 'addon_logistics', registry: 'addon_registry',
  speakers: 'addon_speakers', partners: 'addon_partners', reminders: 'addon_reminders',
  experience: 'addon_experience', festiome: 'addon_festiome', planner: 'addon_planner',
  festioLive: 'addon_engagement',
}
const CHANNEL_FEATURE_KEY = { email: 'notify_email', sms: 'notify_sms', whatsapp: 'notify_whatsapp' }
const THANKYOU_AUDIENCE_KEY = { 'Checked in': 'admitted', 'Confirmed': 'confirmed', 'All guests': 'all' }

function SettingsTab({ notify, eventId, event, onEventChanged }) {
  const { guests } = useGuests(eventId)
  const [hubSettings, setHubSettings] = useState(null)
  const [hubSettingsBusy, setHubSettingsBusy] = useState('')
  const [addons, setAddons] = useState(() => Object.fromEntries(ADDON_TOGGLES.map((a) => [a.key, a.on])))
  const [channelToggles, setChannelToggles] = useState(() => Object.fromEntries(CHANNEL_TOGGLE_ROWS.map((c) => [c.key, c.on])))
  const [consentPromptEnabled, setConsentPromptEnabled] = useState(true)
  const [routing, setRouting] = useState(() =>
    Object.fromEntries(ROUTING_ROWS.map((r) => [r.key, { email: r.email, sms: r.sms, whatsapp: r.whatsapp, mms: r.mms, mode: 'all' }]))
  )
  const [declineNotify, setDeclineNotify] = useState(true)
  const [thankYou, setThankYou] = useState(true)
  const [thankYouAudience, setThankYouAudience] = useState('Checked in')
  const [thankYouDelay, setThankYouDelay] = useState(24)
  const [routingBusy, setRoutingBusy] = useState(false)
  const [featureBusy, setFeatureBusy] = useState('')
  const [purchasedAddons, setPurchasedAddons] = useState(new Set())

  // Check-in behavior — ported from AdminPage.jsx's CheckoutToggle/WalkInToggle.
  const [checkoutEnabled, setCheckoutEnabled] = useState(false)
  const [manualCheckinEnabled, setManualCheckinEnabled] = useState(false)
  const [walkInEnabled, setWalkInEnabled] = useState(false)
  const [walkInGroupId, setWalkInGroupId] = useState('')
  const [walkInGroupChoiceEnabled, setWalkInGroupChoiceEnabled] = useState(false)
  const [walkInGroupChoiceBusy, setWalkInGroupChoiceBusy] = useState(false)
  const [defaultGuestGroupId, setDefaultGuestGroupId] = useState('')
  const [sectionModeEnabled, setSectionModeEnabled] = useState(false)
  const [tableGroups, setTableGroups] = useState([])
  const [walkInBusy, setWalkInBusy] = useState(false)
  const [seatingTermValue, setSeatingTermValue] = useState('')
  const [seatingTermSaving, setSeatingTermSaving] = useState(false)
  const [seatTermValue, setSeatTermValue] = useState('')
  const [seatTermSaving, setSeatTermSaving] = useState(false)
  const [seatOrderValue, setSeatOrderValue] = useState('sequential')
  const [channelTestBusy, setChannelTestBusy] = useState('')
  const [thankYouBusy, setThankYouBusy] = useState('')
  const [thankYouTestGuestId, setThankYouTestGuestId] = useState('')

  // Hydrate local editable state only on first load of a given event, not on
  // every refresh of the `event` object (e.g. onEventChanged() after saving an
  // unrelated toggle) — otherwise a slow-to-arrive refresh can silently wipe
  // out whatever the organizer is mid-typing in another field on this tab.
  // Each toggle already applies its own confirmed value locally right after
  // its own save, so re-running this wholesale on every refresh isn't needed.
  const hydratedEventIdRef = useRef(null)
  useEffect(() => {
    if (!event || hydratedEventIdRef.current === event.id) return
    hydratedEventIdRef.current = event.id
    const policy = event.channel_policy || {}
    setRouting(Object.fromEntries(ROUTING_ROWS.map((row) => {
      const configured = policy[ROUTE_API_KEY[row.key]]
      const configuredChannels = Array.isArray(configured) ? configured : configured?.channels
      const enabled = configuredChannels || ['email', 'sms', 'whatsapp', 'mms'].filter((ch) => row[ch])
      const mode = Array.isArray(configured) ? 'priority' : (configured?.mode || 'all')
      return [row.key, { ...Object.fromEntries(['email', 'sms', 'whatsapp', 'mms'].map((ch) => [ch, enabled.includes(ch)])), mode }]
    })))
    setChannelToggles({ email: !!event.notify_email, sms: !!event.notify_sms, whatsapp: !!event.notify_whatsapp })
    setConsentPromptEnabled(event.notify_consent_prompt_enabled !== false)
    setAddons(Object.fromEntries(ADDON_TOGGLES.map((a) => [a.key, !!event[ADDON_FEATURE_KEY[a.key]]])))
    setDeclineNotify(!!event.notify_rsvp_responses)
    setThankYou(!!event.post_event_thankyou_enabled)
    setThankYouAudience(({ admitted: 'Checked in', confirmed: 'Confirmed', all: 'All guests' })[event.post_event_thankyou_audience] || 'Checked in')
    setThankYouDelay(event.post_event_thankyou_delay_hours ?? 24)
    setCheckoutEnabled(!!event.checkout_enabled)
    setManualCheckinEnabled(!!event.manual_checkin_enabled)
    setWalkInEnabled(!!event.walk_in_enabled)
    setWalkInGroupId(event.walk_in_table_group_id || '')
    setWalkInGroupChoiceEnabled(!!event.walk_in_group_choice_enabled)
    setDefaultGuestGroupId(event.default_guest_table_group_id || '')
    setSectionModeEnabled(!!event.section_mode_enabled)
    setSeatingTermValue(event.seating_term || '')
    setSeatTermValue(event.seat_term || '')
    setSeatOrderValue(event.seat_assignment_order || 'sequential')
  }, [event])

  useEffect(() => {
    if (!eventId) { setTableGroups([]); return }
    api.listTableGroups(eventId).then(setTableGroups).catch(() => setTableGroups([]))
    api.getBillingTiers(eventId)
      .then((billing) => setPurchasedAddons(new Set(billing.available_addons || billing.purchased_addons || [])))
      .catch(() => setPurchasedAddons(new Set(event?.purchased_addons || [])))
  }, [eventId])

  useEffect(() => {
    if (!eventId) { setHubSettings(null); return }
    let alive = true
    api.messagingSettings(eventId)
      .then((settings) => { if (alive) setHubSettings(settings) })
      .catch((error) => { if (alive) notify(error.message || 'FestioHub settings could not be loaded', true) })
    return () => { alive = false }
  }, [eventId])

  async function toggleHubSetting(key, label) {
    if (!hubSettings || hubSettingsBusy) return
    const next = !hubSettings[key]
    setHubSettingsBusy(key)
    try {
      const confirmed = await api.updateMessagingSettings(eventId, { [key]: next })
      setHubSettings(confirmed)
      notify(`${label} ${next ? 'enabled' : 'disabled'}`)
    } catch (error) {
      notify(error.message || `${label} could not be updated`, true)
    } finally {
      setHubSettingsBusy('')
    }
  }

  async function toggleCheckout() {
    const next = !checkoutEnabled
    setCheckoutEnabled(next)
    saveFeature('checkout', { checkout_enabled: next }, () => setCheckoutEnabled(!next))
    notify(`Check-out ${next ? 'enabled' : 'disabled'}`)
  }

  async function toggleManualCheckin() {
    const next = !manualCheckinEnabled
    setManualCheckinEnabled(next)
    saveFeature('manual_checkin', { manual_checkin_enabled: next }, () => setManualCheckinEnabled(!next))
    notify(`Manual check-in ${next ? 'enabled' : 'disabled'}`)
  }

  async function toggleWalkIn() {
    if (walkInBusy) return
    setWalkInBusy(true)
    try {
      const updated = await api.setWalkIn(eventId, !walkInEnabled)
      setWalkInEnabled(!!updated.walk_in_enabled)
      await onEventChanged?.()
      notify(`Walk-in registration ${updated.walk_in_enabled ? 'enabled' : 'disabled'}`)
    } catch (e) {
      notify(e.message || 'Walk-in setting could not be saved', true)
    } finally {
      setWalkInBusy(false)
    }
  }

  async function changeWalkInGroup(gid) {
    setWalkInGroupId(gid)
    try {
      const updated = await api.setWalkInGroup(eventId, gid || null)
      setWalkInGroupId(updated.walk_in_table_group_id || '')
      await onEventChanged?.()
    } catch (e) {
      notify(e.message || 'Walk-in group could not be saved', true)
    }
  }

  async function toggleWalkInGroupChoice() {
    if (walkInGroupChoiceBusy) return
    setWalkInGroupChoiceBusy(true)
    try {
      const updated = await api.setWalkInGroupChoice(eventId, !walkInGroupChoiceEnabled)
      setWalkInGroupChoiceEnabled(!!updated.walk_in_group_choice_enabled)
      await onEventChanged?.()
      notify(`Staff ${updated.walk_in_group_choice_enabled ? 'can now pick' : 'can no longer pick'} a ${seatingTerm(event, { lower: true })} group per walk-in`)
    } catch (e) {
      notify(e.message || 'Setting could not be saved', true)
    } finally {
      setWalkInGroupChoiceBusy(false)
    }
  }

  async function changeDefaultGuestGroup(gid) {
    setDefaultGuestGroupId(gid)
    try {
      const updated = await api.setDefaultGuestGroup(eventId, gid || null)
      setDefaultGuestGroupId(updated.default_guest_table_group_id || '')
      await onEventChanged?.()
      notify(gid ? 'Default group for unassigned guests saved' : 'Default group for unassigned guests cleared')
    } catch (e) {
      setDefaultGuestGroupId(event?.default_guest_table_group_id || '')
      notify(e.message || 'Default guest group could not be saved', true)
    }
  }

  async function changeSeatOrder(order) {
    const previous = seatOrderValue
    setSeatOrderValue(order)
    try {
      await api.toggleFeatures(eventId, { seat_assignment_order: order })
      await onEventChanged?.()
      notify(order === 'random' ? 'Now spreading guests across tables' : 'Now filling tables in order')
    } catch (e) {
      setSeatOrderValue(previous)
      notify(e.message || 'Assignment order could not be saved', true)
    }
  }

  async function toggleSectionMode() {
    const next = !sectionModeEnabled
    setSectionModeEnabled(next)
    saveFeature('sectionMode', { section_mode_enabled: next }, () => setSectionModeEnabled(!next))
    notify(`Section scanning ${next ? 'enabled' : 'disabled'}`)
  }

  async function saveSeatingTerm() {
    if (!eventId || seatingTermSaving) return
    setSeatingTermSaving(true)
    try {
      await api.toggleFeatures(eventId, { seating_term: seatingTermValue })
      await onEventChanged?.()
      notify(seatingTermValue ? `Now shown as "${seatingTermValue}" instead of "Table".` : 'Reset to "Table".')
    } catch (e) {
      notify(e.message || 'Could not save', true)
    } finally {
      setSeatingTermSaving(false)
    }
  }

  async function saveSeatTerm() {
    if (!eventId || seatTermSaving) return
    setSeatTermSaving(true)
    try {
      await api.toggleFeatures(eventId, { seat_term: seatTermValue })
      await onEventChanged?.()
      notify(seatTermValue ? `Now shown as "${seatTermValue}" instead of "Seat".` : 'Reset to "Seat".')
    } catch (e) {
      notify(e.message || 'Could not save', true)
    } finally {
      setSeatTermSaving(false)
    }
  }

  async function sendChannelTest(channel) {
    if (!eventId || channelTestBusy || channel === 'email') return
    const phone = window.prompt(`Send a test ${channel.toUpperCase()} to which number?\nUse full E.164 format, for example +2348103273233.`)
    if (!phone?.trim()) return
    setChannelTestBusy(channel)
    try {
      const result = await api.sendTestMessage(eventId, channel, phone.trim())
      notify(`Test ${channel.toUpperCase()} accepted for ${result.to}`)
    } catch (e) {
      notify(e.message || `Test ${channel.toUpperCase()} could not be sent`, true)
    } finally {
      setChannelTestBusy('')
    }
  }

  async function sendThankYouTest() {
    if (!thankYouTestGuestId || thankYouBusy) return
    setThankYouBusy('test')
    try {
      const result = await api.testSendPostEventThankyou(eventId, thankYouTestGuestId)
      notify(`Thank-you test sent on ${result.channels_sent} channel${result.channels_sent === 1 ? '' : 's'}`)
    } catch (e) {
      notify(e.message || 'Thank-you test could not be sent', true)
    } finally {
      setThankYouBusy('')
    }
  }

  async function sendThankYouNow() {
    if (thankYouBusy) return
    const alreadySent = !!event?.post_event_thankyou_sent_at
    const audience = guests.filter((guest) => {
      if (event?.post_event_thankyou_audience === 'confirmed') return guest.rsvp_status === 'confirmed'
      if (event?.post_event_thankyou_audience === 'all') return true
      return !!guest.admitted
    })
    if (!audience.length) {
      notify('No guests match the configured thank-you audience', true)
      return
    }
    const resend = alreadySent ? ' again' : ''
    if (!window.confirm(`Send the post-event thank-you${resend} to ${audience.length} guest${audience.length === 1 ? '' : 's'} now? This cannot be undone.`)) return
    setThankYouBusy('now')
    try {
      const result = await api.sendNowPostEventThankyou(eventId, alreadySent)
      await onEventChanged?.()
      notify(`${result.messages_sent} thank-you message${result.messages_sent === 1 ? '' : 's'} sent`)
    } catch (e) {
      notify(e.message || 'Thank-you messages could not be sent', true)
    } finally {
      setThankYouBusy('')
    }
  }

  async function saveFeature(key, body, revert) {
    if (!eventId || featureBusy) return false
    setFeatureBusy(key)
    try {
      await api.toggleFeatures(eventId, body)
      await onEventChanged?.()
      return true
    } catch (e) {
      revert()
      notify(e.message || 'This change could not be saved', true)
      return false
    } finally {
      setFeatureBusy('')
    }
  }

  async function toggleAddon(key, label) {
    const next = !addons[key]
    if (next && !purchasedAddons.has(ADDON_PLAN_KEY[key])) {
      notify(`${label} requires a separate add-on purchase`, true)
      return
    }
    setAddons((prev) => ({ ...prev, [key]: next }))
    const saved = await saveFeature(key, { [ADDON_FEATURE_KEY[key]]: next }, () => setAddons((prev) => ({ ...prev, [key]: !next })))
    if (saved) notify(`${label} ${next ? 'enabled' : 'disabled'}`)
  }

  function toggleConsentPrompt() {
    const next = !consentPromptEnabled
    setConsentPromptEnabled(next)
    saveFeature('consent_prompt', { notify_consent_prompt_enabled: next }, () => setConsentPromptEnabled(!next))
    notify(next ? 'Guest consent prompt turned on' : 'Guest consent prompt turned off')
  }

  function toggleChannel(key, label) {
    const next = !channelToggles[key]
    setChannelToggles((prev) => ({ ...prev, [key]: next }))
    saveFeature(key, { [CHANNEL_FEATURE_KEY[key]]: next }, () => setChannelToggles((prev) => ({ ...prev, [key]: !next })))
    notify(`${label} channel ${next ? 'turned on' : 'turned off'}`)
  }

  function applyRoutingResponse(updated) {
    if (!updated?.channel_policy) return
    setRouting(Object.fromEntries(ROUTING_ROWS.map((row) => {
      const configured = updated.channel_policy[ROUTE_API_KEY[row.key]]
      const configuredChannels = Array.isArray(configured) ? configured : configured?.channels
      const enabled = configuredChannels || []
      const mode = Array.isArray(configured) ? 'priority' : (configured?.mode || 'all')
      return [row.key, { ...Object.fromEntries(['email', 'sms', 'whatsapp', 'mms'].map((channel) => [channel, enabled.includes(channel)])), mode }]
    })))
  }

  async function saveRouting(next) {
    const payload = Object.fromEntries(Object.entries(next).map(([key, values]) => [
      ROUTE_API_KEY[key],
      { mode: values.mode, channels: ['email', 'sms', 'whatsapp', 'mms'].filter((channel) => values[channel]) },
    ]))
    setRoutingBusy(true)
    try {
      const updated = await api.setChannelPolicy(eventId, payload)
      setRouting(next)
      applyRoutingResponse(updated)
    } catch (e) {
      notify(e.message || 'Channel routing could not be saved')
    } finally {
      setRoutingBusy(false)
    }
  }

  async function toggleRoute(rowKey, ch, rowLabel) {
    if (!eventId || routingBusy) return
    const next = { ...routing, [rowKey]: { ...routing[rowKey], [ch]: !routing[rowKey][ch] } }
    if (!['email', 'sms', 'whatsapp', 'mms'].some((channel) => next[rowKey][channel])) {
      notify('At least one channel is required for each automated message flow.')
      return
    }
    notify(`${rowLabel} → ${ch.toUpperCase()} ${next[rowKey][ch] ? 'enabled' : 'disabled'}`)
    await saveRouting(next)
  }

  async function setRouteMode(rowKey, mode, rowLabel) {
    if (!eventId || routingBusy || routing[rowKey].mode === mode) return
    const next = { ...routing, [rowKey]: { ...routing[rowKey], mode } }
    notify(`${rowLabel} → ${mode === 'all' ? 'sends on every checked channel' : 'sends on the first available channel only'}`)
    await saveRouting(next)
  }

  return (
    <>
      <div className="rr-section-title">
        <div><h2>FestioHub features</h2><p>Control which communication surfaces guests can see and use</p></div>
      </div>
      <div className="rr-grid3 cm-toggle-grid">
        {[
          ['guest_hub_enabled', 'FestioHub', 'Show the post-RSVP guest hub.'],
          ['announcements_enabled', 'Event updates', 'Show organizer announcements in the hub.'],
          ['direct_host_messages_enabled', 'Message host', 'Allow private questions to the organizer.'],
          ['guest_chat_enabled', 'Guest chat', 'Show shared guest-to-guest chat.'],
          ['guest_chat_posting_enabled', 'Guest posting', 'Allow guests to publish messages in guest chat.'],
        ].map(([key, label, description]) => (
          <div className="rr-panel cm-toggle-card" key={key}>
            <div className="cm-toggle-top">
              <strong>{label}</strong>
              <Switch checked={!!hubSettings?.[key]} disabled={!hubSettings || !!hubSettingsBusy} onChange={() => toggleHubSetting(key, label)} />
            </div>
            <p>{description}</p>
          </div>
        ))}
      </div>

      <div className="rr-section-title">
        <div><h2>Messaging channels</h2><p>Turn a channel off entirely, or send a test to confirm it's wired up</p></div>
      </div>
      <div className="rr-grid3 cm-toggle-grid">
        {CHANNEL_TOGGLE_ROWS.map((c) => (
          <div className="rr-panel cm-toggle-card" key={c.key}>
            <div className="cm-toggle-top">
              <strong>{c.label}</strong>
              <Switch checked={!!channelToggles[c.key]} onChange={() => toggleChannel(c.key, c.label)} />
            </div>
            {c.key === 'email'
              ? <span className="rd-hint">Email delivery uses the configured event sender.</span>
              : <button className="rr-link-btn" disabled={!!channelTestBusy} onClick={() => sendChannelTest(c.key)}>{channelTestBusy === c.key ? 'Sending…' : 'Send test'} <Icon name="arrow" size={11} /></button>}
          </div>
        ))}
      </div>
      <div className="rr-panel cm-toggle-card">
        <div className="cm-toggle-top">
          <strong>Guest consent prompt</strong>
          <Switch checked={consentPromptEnabled} disabled={featureBusy === 'consent_prompt'} onChange={toggleConsentPrompt} />
        </div>
        <span className="rd-hint">
          Shows the SMS/WhatsApp opt-in checkboxes and STOP/HELP disclosure on the guest's check-in screen.
          {(channelToggles.sms || channelToggles.whatsapp)
            ? ' This event sends SMS or WhatsApp — carriers require this consent notice, so leave it on unless you have opt-in covered another way.'
            : ' This event only sends email, so it has no effect either way.'}
        </span>
      </div>

      <div className="rr-section-title">
        <div><h2>Add-ons</h2><p>Turn feature areas on or off for this event (subject to your plan's entitlements)</p></div>
      </div>

      <div className="rr-grid3 cm-toggle-grid">
        {ADDON_TOGGLES.map((a) => {
          const purchased = purchasedAddons.has(ADDON_PLAN_KEY[a.key])
          return <div className="rr-panel cm-toggle-card" key={a.key}>
            <div className="cm-toggle-top">
              <strong>{a.label}</strong>
              <Switch checked={!!addons[a.key]} disabled={!!featureBusy || (!addons[a.key] && !purchased)} onChange={() => toggleAddon(a.key, a.label)} />
            </div>
            <p>{a.desc}</p>
            {!purchased && !addons[a.key] && <Link className="rr-link-btn" to="/billing-redesign?tab=billing">Buy add-on <Icon name="arrow" size={10} /></Link>}
            {!!addons[a.key] && (
              <div className="gr-actions" aria-label={`${a.label} settings`}>
                {a.settings?.map(([label, to]) => (
                  <Link key={label} className="rr-link-btn" to={to}>{label} <Icon name="arrow" size={10} /></Link>
                ))}
              </div>
            )}
          </div>
        })}
      </div>

      <div className="rr-section-title">
        <div><h2>Channel routing</h2><p>Which channels fire for each kind of guest message</p></div>
      </div>

      <div className="rr-panel cm-matrix-wrap">
        <table className="rr-table cm-matrix">
          <thead>
            <tr>
              <th>Message type</th>
              <th><Icon name="mail" size={13} /> Email</th>
              <th><Icon name="message" size={13} /> SMS</th>
              <th><Icon name="whatsapp" size={13} /> WhatsApp</th>
              <th><Icon name="image" size={13} /> MMS</th>
              <th>Delivery</th>
            </tr>
          </thead>
          <tbody>
            {ROUTING_ROWS.map((r) => (
              <tr key={r.key}>
                <td><strong>{r.label}</strong></td>
                {['email', 'sms', 'whatsapp', 'mms'].map((ch) => (
                  <td key={ch} className="cm-matrix-cell">
                    <input
                      type="checkbox"
                      checked={!!routing[r.key][ch]}
                      disabled={routingBusy}
                      onChange={() => toggleRoute(r.key, ch, r.label)}
                    />
                  </td>
                ))}
                <td className="cm-matrix-mode">
                  <select
                    value={routing[r.key].mode}
                    disabled={routingBusy}
                    onChange={(e) => setRouteMode(r.key, e.target.value, r.label)}
                    title="How the checked channels above are used for this message type"
                  >
                    <option value="all">All checked channels</option>
                    <option value="priority">First available (cheapest)</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rr-section-title">
        <div><h2>Notification behavior</h2><p>Extra messages sent automatically around RSVP and event end</p></div>
      </div>

      <div className="rr-grid2">
        <div className="rr-panel cm-toggle-card cm-settings-card">
          <div className="cm-toggle-top">
            <strong>Notify guests who decline or are rejected</strong>
            <Switch checked={declineNotify} onChange={() => {
              const next = !declineNotify
              setDeclineNotify(next)
              saveFeature('declineNotify', { notify_rsvp_responses: next }, () => setDeclineNotify(!next))
              notify(`Decline/reject notice ${next ? 'enabled' : 'disabled'}`)
            }} />
          </div>
          <p>Sends a short courtesy message when a guest declines an invite or is rejected at the door, so they know their status either way.</p>
        </div>
        <div className="rr-panel cm-toggle-card cm-settings-card">
          <div className="cm-toggle-top">
            <strong>Post-event thank-you &amp; feedback</strong>
            <Switch checked={thankYou} onChange={() => {
              const next = !thankYou
              setThankYou(next)
              saveFeature('thankYou', { post_event_thankyou_enabled: next }, () => setThankYou(!next))
              notify(`Post-event thank-you ${next ? 'enabled' : 'disabled'}`)
            }} />
          </div>
          <p>Automatically sends a thank-you message with a short feedback prompt to attendees after the event ends.</p>
          {thankYou && (
            <div className="cm-thankyou-config">
              <label className="rd-field-label">Audience</label>
              <select className="rr-select gr-inline-select" value={thankYouAudience} onChange={(e) => {
                const prev = thankYouAudience
                const next = e.target.value
                setThankYouAudience(next)
                saveFeature('thankYouAudience', { post_event_thankyou_audience: THANKYOU_AUDIENCE_KEY[next] }, () => setThankYouAudience(prev))
              }}>
                <option>Checked in</option><option>Confirmed</option><option>All guests</option>
              </select>
              <label className="rd-field-label" style={{ marginTop: 8 }}>Send delay (hours after event ends)</label>
              <input className="rd-field" type="number" value={thankYouDelay} onChange={(e) => setThankYouDelay(e.target.value)} onBlur={() => {
                const hours = Math.max(0, Math.min(720, Number(thankYouDelay) || 0))
                setThankYouDelay(hours)
                saveFeature('thankYouDelay', { post_event_thankyou_delay_hours: hours }, () => {})
              }} style={{ maxWidth: 110 }} />
              <label className="rd-field-label" style={{ marginTop: 8 }}>Test recipient</label>
              <select className="rr-select" value={thankYouTestGuestId} onChange={(e) => setThankYouTestGuestId(e.target.value)}>
                <option value="">Choose a guest…</option>
                {guests.map((guest) => {
                  const name = [guest.first_name, guest.last_name].filter(Boolean).join(' ') || guest.email || guest.phone || guest.id
                  return <option key={guest.id} value={guest.id}>{name}</option>
                })}
              </select>
              <div className="rd-row2" style={{ marginTop: 8 }}>
                <button className="rr-btn secondary" disabled={!thankYouTestGuestId || !!thankYouBusy} style={{ flex: 1, justifyContent: 'center' }} onClick={sendThankYouTest}>{thankYouBusy === 'test' ? 'Sending…' : 'Test send'}</button>
                <button className="rr-btn primary" disabled={!!thankYouBusy} style={{ flex: 1, justifyContent: 'center' }} onClick={sendThankYouNow}>{thankYouBusy === 'now' ? 'Sending…' : event?.post_event_thankyou_sent_at ? 'Send again' : 'Send now'}</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="rr-section-title">
        <div><h2>Check-in behavior</h2><p>Walk-ins, section-based scanning, and check-out</p></div>
      </div>

      <div className="rr-panel cm-settings-card" style={{ marginBottom: 14 }}>
        <strong>What should we call it?</strong>
        <p>This event still uses ordinary Seating underneath — only the word "Table" changes, everywhere a guest or staff member sees it (pass, check-in, messages). Leave blank for the default.</p>
        <div className="rd-row2" style={{ maxWidth: 320 }}>
          <input className="rr-input" disabled={!event} value={seatingTermValue} onChange={(e) => setSeatingTermValue(e.target.value)} placeholder="Table" maxLength={30} />
          <button className="rr-btn primary" disabled={!event || seatingTermSaving || seatingTermValue === (event.seating_term || '')} onClick={saveSeatingTerm}>
            {seatingTermSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div className="rr-panel cm-settings-card" style={{ marginBottom: 14 }}>
        <strong>What should we call an individual seat?</strong>
        <p>Same idea, one level down — only the word "Seat" changes, everywhere a guest or staff member sees it (pass, check-in, messages). Leave blank for the default.</p>
        <div className="rd-row2" style={{ maxWidth: 320 }}>
          <input className="rr-input" disabled={!event} value={seatTermValue} onChange={(e) => setSeatTermValue(e.target.value)} placeholder="Seat" maxLength={30} />
          <button className="rr-btn primary" disabled={!event || seatTermSaving || seatTermValue === (event.seat_term || '')} onClick={saveSeatTerm}>
            {seatTermSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div className="rr-grid2">
        <div className="rr-panel cm-toggle-card cm-settings-card">
          <div className="cm-toggle-top">
            <strong>Manual check-in</strong>
            <Switch checked={manualCheckinEnabled} onChange={toggleManualCheckin} />
          </div>
          <p>Let staff find and admit a guest by name or phone when their QR isn't available. Adds a Manual search tab to the Scanner.</p>
        </div>

        <div className="rr-panel cm-toggle-card cm-settings-card">
          <div className="cm-toggle-top">
            <strong>Guest check-out</strong>
            <Switch checked={checkoutEnabled} onChange={toggleCheckout} />
          </div>
          <p>Record when guests leave. Adds a Check-out mode to the Scanner; the exit time shows in FestioHub{event?.experience_enabled ? ' and as a check-out step in the experience' : ''}.</p>
        </div>

        <div className="rr-panel cm-toggle-card cm-settings-card">
          <div className="cm-toggle-top">
            <strong>Walk-in guests</strong>
            <Switch checked={walkInEnabled} onChange={toggleWalkIn} />
          </div>
          <p>Let staff register guests who arrive without an invite (Scanner: Manual / Walk-in tab).</p>
          {walkInEnabled && !sectionModeEnabled && (
            <div style={{ marginTop: 8 }}>
              <label className="rd-field-label">Auto-assign walk-ins to {seatingTerm(event, { lower: true })} group</label>
              <select className="rr-select gr-inline-select" value={walkInGroupId} onChange={(e) => changeWalkInGroup(e.target.value)}>
                <option value="">— none (seat anywhere) —</option>
                {tableGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
          )}
          {walkInEnabled && !sectionModeEnabled && tableGroups.length > 1 && (
            <div className="cm-toggle-top" style={{ marginTop: 10 }}>
              <span style={{ fontSize: 13 }}>Let staff pick the {seatingTerm(event, { lower: true })} group per walk-in</span>
              <Switch checked={walkInGroupChoiceEnabled} onChange={toggleWalkInGroupChoice} disabled={walkInGroupChoiceBusy} />
            </div>
          )}
          {walkInEnabled && !sectionModeEnabled && walkInGroupChoiceEnabled && tableGroups.length > 1 && (
            <p style={{ marginTop: 4 }}>Staff registering a walk-in (Scanner: Manual / Walk-in tab) will see a {seatingTerm(event, { lower: true })} group picker, defaulting to the auto-assign group above.</p>
          )}
        </div>

        <div className="rr-panel cm-toggle-card cm-settings-card">
          <div className="cm-toggle-top">
            <strong>Invited guests without an assignment</strong>
          </div>
          <p>At check-in, route known guests who have no table or group into this group. {seatOrderValue === 'random' ? `${seatingTerm(event, { plural: true })} are picked in random order` : `${seatingTerm(event, { plural: true })} fill in order before the next ${seatingTerm(event, { lower: true })} is used`} — see {seatingTerm(event)} fill order below.</p>
          <div style={{ marginTop: 8 }}>
            <label className="rd-field-label">Default {seatingTerm(event, { lower: true })} group</label>
            <select className="rr-select gr-inline-select" value={defaultGuestGroupId} onChange={(e) => changeDefaultGuestGroup(e.target.value)}>
              <option value="">— none (seat anywhere) —</option>
              {tableGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
        </div>

        <div className="rr-panel cm-toggle-card cm-settings-card">
          <div className="cm-toggle-top">
            <strong>{seatingTerm(event)} fill order</strong>
          </div>
          <p>How candidate {seatingTerm(event, { lower: true, plural: true })} are tried during automatic assignment — walk-ins, unassigned guests routed to a group, and admission-time seating. Table-group restrictions (which {seatingTerm(event, { lower: true, plural: true })} are eligible at all) are unaffected either way.</p>
          <div style={{ marginTop: 8 }}>
            <select className="rr-select gr-inline-select" value={seatOrderValue} onChange={(e) => changeSeatOrder(e.target.value)}>
              <option value="sequential">Sequential — fill each {seatingTerm(event, { lower: true })} before the next</option>
              <option value="random">Random — spread guests across {seatingTerm(event, { lower: true, plural: true })}</option>
            </select>
          </div>
        </div>

        {tableGroups.length > 0 && (
          <div className="rr-panel cm-toggle-card cm-settings-card">
            <div className="cm-toggle-top">
              <strong>Section scanning</strong>
              <Switch
                checked={sectionModeEnabled}
                onChange={toggleSectionMode}
                disabled={!sectionModeEnabled && !!event?.venue_access_enabled}
              />
            </div>
            <p>Assign each staff member a section (table group) on the Event Team page. Walk-ins and ungrouped manual check-ins they handle are seated in their section.</p>
            {!sectionModeEnabled && event?.venue_access_enabled && (
              <p className="rd-hint" style={{ color: 'var(--danger)' }}>Entry rules is on for this event. Turn it off first — Entry rules and Section scanning can't run on the same event.</p>
            )}
            {sectionModeEnabled && (
              <p className="rd-hint">Each staffer's assigned section replaces the single walk-in group while this is on.</p>
            )}
          </div>
        )}
      </div>
    </>
  )
}

/* ── page ────────────────────────────────────────────────────────────── */

const TABS = [
  { key: 'hub', label: 'Guest Communication', eventActive: 'communication' },
  { key: 'messages', label: 'Messages', eventActive: 'messages' },
  { key: 'settings', label: 'Features & Channels', eventActive: 'features' },
]

export default function CommunicationsRedesignPage() {
  const [eventId] = useCurrentEvent()
  const { event, error: eventError, refresh: loadEvent } = useEventDetails(eventId)
  const [searchParams, setSearchParams] = useSearchParams()
  const [toast, setToast] = useState('')
  const [previewTemplate, setPreviewTemplate] = useState(null)
  const [previewChannel, setPreviewChannel] = useState('email')

  const rawTab = searchParams.get('tab')
  const tab = TABS.some((t) => t.key === rawTab) ? rawTab : 'hub'
  const activeTab = TABS.find((t) => t.key === tab)

  useEffect(() => {
    if (eventError) notify(eventError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventError])

  function notify(message) {
    setToast(message)
    window.setTimeout(() => setToast(''), 2600)
  }

  function goTab(next) {
    setSearchParams({ tab: next })
  }

  return (
    <RedesignShell topActive="setup" withEventSidebar eventActive={activeTab.eventActive}>
      <div className="rr-pagehead">
        <div>
          <div className="rr-title-row">
            <h1>Guest Communication</h1>
          </div>
          <div className="rr-meta">
            <Icon name="message" size={13} /> FestioHub, broadcasts &amp; channel settings
          </div>
        </div>
        <div className="rr-head-actions">
          <button className="rr-btn secondary" onClick={() => goTab('hub')}><Icon name="bell" size={15} /> Guest inbox</button>
          <button className="rr-btn primary" onClick={() => goTab('messages')}><Icon name="send" size={14} /> Broadcasts</button>
        </div>
      </div>

      <div className="rr-tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => goTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {tab === 'hub' && <HubTab eventId={eventId} notify={notify} />}
      {tab === 'messages' && <MessagesTab eventId={eventId} notify={notify} onPreview={(tpl, ch) => { setPreviewTemplate(tpl); setPreviewChannel(ch || 'email') }} />}
      {tab === 'settings' && <SettingsTab eventId={eventId} event={event} notify={notify} onEventChanged={loadEvent} />}

      {toast && <div className="rd-toast"><Icon name="check" />{toast}</div>}

      {previewTemplate && (
        <Modal title={`Preview: ${previewTemplate.name}`} onClose={() => setPreviewTemplate(null)} width={500}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {['email', 'sms', 'whatsapp', 'mms'].filter((ch) => previewTemplate.channels?.includes(ch)).map((ch) => (
              <button key={ch} className={`rr-btn${previewChannel === ch ? ' primary' : ' secondary'}`} onClick={() => setPreviewChannel(ch)} style={{ fontSize: '0.78rem', padding: '4px 10px' }}>{ch.toUpperCase()}</button>
            ))}
          </div>
          <ChannelPreviewFrame
            channel={previewChannel}
            html={previewChannel === 'email' ? previewTemplate.preview?.email_preview_html || '' : ''}
            body={previewTemplate.preview?.[`${previewChannel}_body`]
              || previewTemplate.effective?.[`${previewChannel}_body`]
              || `No ${previewChannel.toUpperCase()} body is configured for this template.`}
          />
        </Modal>
      )}
    </RedesignShell>
  )
}
