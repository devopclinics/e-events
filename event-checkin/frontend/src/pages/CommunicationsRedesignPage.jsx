import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
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
  { key: 'venueAccess', label: 'Venue Access', desc: 'Zones, multi-zone scans, occupancy analytics.', on: true },
  { key: 'seating', label: 'Seating', desc: 'Table groups and seat assignments.', on: true },
  { key: 'partnerPairing', label: 'Partner pairing', desc: 'Link couples/partners so their RSVPs and seating stay in sync.', on: false },
  { key: 'orders', label: 'Orders', desc: 'On-site food & merchandise ordering.', on: false },
  { key: 'logistics', label: 'Logistics', desc: 'Ship merch and gifts to guests.', on: false },
  { key: 'registry', label: 'Registry', desc: 'Mark-only gift registry — items & cash funds.', on: true },
  { key: 'festiome', label: 'FestioMe', desc: 'Community chat space for this event\'s guests.', on: true },
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

  const flaggedChat = chatMessages.filter((m) => m.status === 'hidden')
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
          <div className="rd-panel-head"><h3>Chat moderation</h3><p>{visibleChatCount} visible{flaggedChat.length ? ` · ${flaggedChat.length} hidden` : ''}</p></div>
          <div className="rd-panel-body cm-mod-list">
            {chatLoading && <div className="rd-rowlink">Loading…</div>}
            {!chatLoading && flaggedChat.map((m) => (
              <div className="cm-mod-row" key={m.id}>
                <span className="rd-who-dot">{(m.sender_name || '?')[0].toUpperCase()}</span>
                <div className="cm-mod-body">
                  <div className="cm-mod-top"><strong>{m.sender_name}</strong><span className="rd-status-chip fail">Hidden</span></div>
                  <p>{m.body}</p>
                </div>
                <button className="rr-btn secondary cm-mod-action" onClick={() => moderateMessage(m)}>Restore</button>
              </div>
            ))}
            {!chatLoading && !flaggedChat.length && <div className="rd-rowlink">No hidden messages.</div>}
          </div>
        </div>
      </div>
    </>
  )
}


/* ── Broadcast composer ──────────────────────────────────────────────── */

const BROADCAST_TARGETS = ['Everyone', 'Confirmed guests only', 'Not yet responded', 'Checked in', 'No one else (typed recipients only)']

function gsmSegments(text) {
  const isGsm7 = /^[\x00-\x7F£€]*$/.test(text)
  const perSegment = isGsm7 ? 153 : 67
  const len = text.length || 0
  return { segments: Math.max(1, Math.ceil(len / perSegment) || (len === 0 ? 0 : 1)), gsm7: isGsm7, perSegment }
}

const BROADCAST_TARGET_MAP = {
  'Everyone': 'all',
  'Confirmed guests only': 'confirmed',
  'Not yet responded': 'no_reply',
  'Checked in': 'admitted',
  'No one else (typed recipients only)': 'none',
}

function BroadcastComposer({ notify, onClose, eventId }) {
  const [message, setMessage] = useState('')
  const [target, setTarget] = useState(BROADCAST_TARGETS[0])
  const [channels, setChannels] = useState({ email: true, sms: true, whatsapp: false, mms: false })
  const [mmsUrl, setMmsUrl] = useState('')
  const [guestQuery, setGuestQuery] = useState('')
  const [pickedGuests, setPickedGuests] = useState([])
  const { guests: allGuests } = useGuests(eventId)
  const [typedRecipients, setTypedRecipients] = useState([])
  const [typedName, setTypedName] = useState('')
  const [typedContact, setTypedContact] = useState('')
  const [costAck, setCostAck] = useState(false)

  const { segments, gsm7, perSegment } = gsmSegments(message)
  const overSegmentLimit = segments > 3
  const pickedIds = new Set(pickedGuests.map((g) => g.id))
  const matches = guestQuery.trim()
    ? allGuests
        .filter((g) => !pickedIds.has(g.id))
        .map((g) => ({ id: g.id, name: [g.first_name, g.last_name].filter(Boolean).join(' ') || g.email || g.phone || 'Unnamed guest' }))
        .filter((g) => g.name.toLowerCase().includes(guestQuery.trim().toLowerCase()))
        .slice(0, 8)
    : []

  function toggleChannel(ch) {
    setChannels((prev) => ({ ...prev, [ch]: !prev[ch] }))
  }

  function addTypedRecipient() {
    if (!typedName.trim() || !typedContact.trim()) return
    setTypedRecipients((prev) => [...prev, { name: typedName.trim(), contact: typedContact.trim() }])
    setTypedName('')
    setTypedContact('')
  }

  async function send() {
    if (overSegmentLimit && !costAck) {
      notify(`This message is ${segments} SMS segments — check the cost-acknowledgment box before sending`)
      return
    }
    if (!message.trim() || !Object.values(channels).some(Boolean)) return notify('Enter a message and select at least one channel')
    if (!window.confirm('Send this broadcast now? Protected environments accept only allowlisted recipients.')) return
    try {
      const result = await api.broadcast(eventId, {
        message: message.trim(),
        target: pickedGuests.length ? 'none' : (BROADCAST_TARGET_MAP[target] || 'all'),
        guest_ids: pickedGuests.map((g) => g.id),
        channels: Object.entries(channels).filter(([, enabled]) => enabled).map(([channel]) => channel),
        extra_recipients: typedRecipients.map((recipient) => ({ name: recipient.name, ...(recipient.contact.includes('@') ? { email: recipient.contact } : { phone: recipient.contact }) })),
        mms_media_url: channels.mms ? mmsUrl : null,
      })
      notify(`Broadcast confirmed — queued: ${result.queued}, skipped (no contact): ${result.skipped_no_contact}, skipped (no consent): ${result.skipped_no_consent}, skipped (no credits): ${result.skipped_no_credits}`)
      onClose()
    } catch (e) { notify(e.message || 'Broadcast was not sent') }
  }

  return (
    <div className="rr-panel cm-composer">
      <div className="rd-panel-head"><h3>Send a broadcast</h3><p>A one-off message, outside your automated templates</p></div>
      <div className="rd-panel-body">
        <label className="rd-field-label">Message (supports **bold** and links)</label>
        <textarea className="rr-textarea" rows={4} placeholder="Write your update…" value={message} onChange={(e) => setMessage(e.target.value)} />
        <div className={`cm-sms-meter ${overSegmentLimit ? 'over' : ''}`}>
          <Icon name="message" size={12} /> {segments} SMS segment{segments === 1 ? '' : 's'} ({gsm7 ? 'GSM-7' : 'Unicode/UCS-2'}, {perSegment} chars/segment){overSegmentLimit ? ' — this is expensive, review before sending' : ''}
        </div>
        {overSegmentLimit && (
          <label className="gr-required-check cm-cost-ack">
            <input type="checkbox" checked={costAck} onChange={(e) => setCostAck(e.target.checked)} />
            I understand this will use {segments} SMS credits per recipient and want to send anyway
          </label>
        )}

        <label className="rd-field-label" style={{ marginTop: 12 }}>Send to</label>
        <select className="rr-select" value={target} onChange={(e) => setTarget(e.target.value)} disabled={pickedGuests.length > 0}>
          {BROADCAST_TARGETS.map((t) => <option key={t}>{t}</option>)}
        </select>

        <label className="rd-field-label" style={{ marginTop: 10 }}>Send to specific guests instead</label>
        {pickedGuests.length > 0 && <div className="rd-hint">Picking guests here overrides the audience above — only the guests picked below will receive this broadcast.</div>}
        <div className="rd-search" style={{ marginBottom: 6 }}>
          <Icon name="search" size={13} />
          <input placeholder="Search guests to add…" value={guestQuery} onChange={(e) => setGuestQuery(e.target.value)} />
        </div>
        {matches.length > 0 && (
          <div className="cm-guest-matches">
            {matches.map((g) => (
              <button key={g.id} onClick={() => { setPickedGuests((prev) => [...prev, g]); setGuestQuery('') }}>{g.name}</button>
            ))}
          </div>
        )}
        <div className="cm-picked-chips">
          {pickedGuests.map((g) => (
            <span className="rd-chip" key={g.id}>{g.name} <button onClick={() => setPickedGuests((prev) => prev.filter((x) => x.id !== g.id))}>✕</button></span>
          ))}
        </div>

        <label className="rd-field-label" style={{ marginTop: 10 }}>Add people not on the guest list</label>
        <div className="rd-row2">
          <input className="rd-field" placeholder="Name" value={typedName} onChange={(e) => setTypedName(e.target.value)} />
          <input className="rd-field" placeholder="Email or phone" value={typedContact} onChange={(e) => setTypedContact(e.target.value)} />
          <button className="rr-btn secondary" onClick={addTypedRecipient}>Add</button>
        </div>
        <div className="cm-picked-chips">
          {typedRecipients.map((r, i) => (
            <span className="rd-chip" key={i}>{r.name} <button onClick={() => setTypedRecipients((prev) => prev.filter((_, idx) => idx !== i))}>✕</button></span>
          ))}
        </div>

        <label className="rd-field-label" style={{ marginTop: 10 }}>Channels</label>
        <div className="cm-channel-checks">
          {['email', 'sms', 'whatsapp', 'mms'].map((ch) => (
            <label key={ch}><input type="checkbox" checked={channels[ch]} onChange={() => toggleChannel(ch)} /> {ch.toUpperCase()}</label>
          ))}
        </div>
        {channels.mms && (
          <input className="rd-field" placeholder="MMS image URL (https://…)" value={mmsUrl} onChange={(e) => setMmsUrl(e.target.value)} style={{ marginTop: 6 }} />
        )}

        <div className="rd-row2" style={{ marginTop: 14 }}>
          <button className="rr-btn secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={onClose}>Cancel</button>
          <button className="rr-btn primary" style={{ flex: 1, justifyContent: 'center' }} onClick={send}>Send broadcast</button>
        </div>
      </div>
    </div>
  )
}

/* ── Messages tab (broadcast + templates) ───────────────────────────── */

function MessagesTab({ notify, onPreview, eventId }) {
  const [attnQuery, setAttnQuery] = useState('')
  const [attnFilter, setAttnFilter] = useState('all')
  const [composerOpen, setComposerOpen] = useState(false)
  const [templates, setTemplates] = useState([])
  const [templateAudit, setTemplateAudit] = useState([])
  const [templateError, setTemplateError] = useState('')
  const [templateBusy, setTemplateBusy] = useState('')
  const [templateEditor, setTemplateEditor] = useState(null)
  const [communication, setCommunication] = useState(null)
  const [broadcasts, setBroadcasts] = useState([])
  const [attentionGuests, setAttentionGuests] = useState([])

  async function loadTemplates() {
    if (!eventId) {
      setTemplates([])
      setTemplateAudit([])
      return
    }
    try {
      const [items, audit] = await Promise.all([
        api.listTemplates(eventId),
        api.templateAudit(eventId).catch(() => []),
      ])
      setTemplates(items)
      setTemplateAudit(audit)
      setTemplateError('')
    } catch (e) {
      setTemplateError(e.message || 'Message templates could not be loaded')
    }
  }

  async function loadDeliveryData() {
    if (!eventId) {
      setCommunication(null)
      setBroadcasts([])
      setAttentionGuests([])
      return
    }
    try {
      const [inv, bc, guests] = await Promise.all([
        api.resultsInvitations(eventId),
        api.resultsBroadcasts(eventId).catch(() => []),
        api.listGuests(eventId),
      ])
      setCommunication(inv.communication)
      setBroadcasts(bc)
      setAttentionGuests(guests.filter((g) => g.invite_status === 'failed' || !g.invite_sent_at))
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

  return (
    <>
      <div className="rr-section-title">
        <div><h2>Delivery by channel</h2><p>Live send rates across every channel this event uses</p></div>
        <button onClick={() => setComposerOpen((v) => !v)}>Send a broadcast <Icon name="arrow" size={15} /></button>
      </div>

      {composerOpen && <BroadcastComposer eventId={eventId} notify={notify} onClose={() => setComposerOpen(false)} />}

      <div className="rd-wide-grid">
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
                    <td className="rd-rowlink"><a className="cm-linklike" href="/guests-redesign">Open in Guests →</a></td>
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
      </div>

      <div className="rr-section-title">
        <div><h2>Templates</h2><p>Each channel falls back to the default template unless it has its own override</p></div>
      </div>

      <div className="rr-panel">
        <table className="rr-table cm-tpl-table">
          <thead>
            <tr>
              <th>Template</th>
              <th>Email</th>
              <th>SMS</th>
              <th>WhatsApp</th>
              <th>MMS</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.key}>
                <td><strong>{t.label}</strong></td>
                {['email', 'sms', 'whatsapp', 'mms'].map((ch) => (
                  <td key={ch}>
                    {t.channels.includes(ch)
                      ? <span className={`cm-badge ${t.source === 'event-customized' ? 'custom' : 'default'}`}>
                          {t.source === 'event-customized' ? 'Custom' : 'Default'}
                        </span>
                      : <span>—</span>}
                  </td>
                ))}
                <td className="rd-rowlink cm-tpl-actions">
                  <button className="cm-linklike" onClick={() => openTemplateEditor(t)}>Edit</button>
                  <button className="cm-linklike" onClick={async () => {
                    try {
                      const preview = await api.previewTemplate(eventId, t.key, {})
                      onPreview?.({ ...t, name: t.label, preview }, t.channels[0] || 'email')
                    } catch (e) { notify(e.message || 'Template preview could not be rendered') }
                  }}>Preview</button>
                  <button className="cm-linklike" onClick={async () => {
                    const channel = t.channels.find((item) => item !== 'mms') || t.channels[0]
                    const to = window.prompt(`Send a ${channel.toUpperCase()} test to an allowlisted recipient:`)
                    if (!to?.trim() || !window.confirm(`Send this test ${channel} message now?`)) return
                    try { await api.testSendTemplate(eventId, t.key, { channel, to: to.trim() }); notify(`Test ${channel} send confirmed`) }
                    catch (e) { notify(e.message || 'Test message was not sent') }
                  }}>Test send</button>
                  <button className="cm-linklike gr-danger-link" disabled={templateBusy === t.key || t.source !== 'event-customized'} onClick={async () => {
                    if (!window.confirm(`Reset “${t.label}” to the platform default?`)) return
                    setTemplateBusy(t.key)
                    try {
                      await api.resetTemplate(eventId, t.key)
                      await loadTemplates()
                      notify(`${t.label} reset to the platform default`)
                    } catch (e) { notify(e.message || 'Template could not be reset') } finally { setTemplateBusy('') }
                  }}>Reset</button>
                </td>
              </tr>
            ))}
            {!templates.length && <tr><td colSpan={6} className="rd-rowlink">{templateError || 'No message templates available.'}</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="rd-panel cm-audit-panel">
        <div className="rd-panel-head"><h3>Recent template changes</h3></div>
        <div className="rd-panel-body">
          {templateAudit.map((a, i) => (
            <div className="cm-audit-row" key={i}>
              <strong>{a.changed_by_email || 'Festio operator'}</strong> — {a.action} {a.template_key} <span>{a.changed_at ? new Date(a.changed_at).toLocaleString() : ''}</span>
            </div>
          ))}
          {!templateAudit.length && <div className="cm-audit-row">No template changes recorded.</div>}
        </div>
      </div>
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
    </>
  )
}

/* ── Features & Channels tab ─────────────────────────────────────────── */

const ROUTE_API_KEY = { invites: 'invite', admission: 'admission', rsvp: 'reminder', approval: 'approval', deliveries: 'logistics' }

const ADDON_FEATURE_KEY = {
  venueAccess: 'venue_access_enabled', seating: 'seating_enabled', partnerPairing: 'partner_pairing_enabled',
  orders: 'menu_enabled', logistics: 'logistics_enabled', registry: 'registry_enabled', festiome: 'festiome_addon_enabled',
}
const CHANNEL_FEATURE_KEY = { email: 'notify_email', sms: 'notify_sms', whatsapp: 'notify_whatsapp' }
const THANKYOU_AUDIENCE_KEY = { 'Checked in': 'admitted', 'Confirmed': 'confirmed', 'All guests': 'all' }

function SettingsTab({ notify, eventId, event, onEventChanged }) {
  const { guests } = useGuests(eventId)
  const [addons, setAddons] = useState(() => Object.fromEntries(ADDON_TOGGLES.map((a) => [a.key, a.on])))
  const [channelToggles, setChannelToggles] = useState(() => Object.fromEntries(CHANNEL_TOGGLE_ROWS.map((c) => [c.key, c.on])))
  const [routing, setRouting] = useState(() =>
    Object.fromEntries(ROUTING_ROWS.map((r) => [r.key, { email: r.email, sms: r.sms, whatsapp: r.whatsapp, mms: r.mms }]))
  )
  const [declineNotify, setDeclineNotify] = useState(true)
  const [thankYou, setThankYou] = useState(true)
  const [thankYouAudience, setThankYouAudience] = useState('Checked in')
  const [thankYouDelay, setThankYouDelay] = useState(24)
  const [routingBusy, setRoutingBusy] = useState(false)
  const [featureBusy, setFeatureBusy] = useState('')

  // Check-in behavior — ported from AdminPage.jsx's CheckoutToggle/WalkInToggle.
  const [checkoutEnabled, setCheckoutEnabled] = useState(false)
  const [walkInEnabled, setWalkInEnabled] = useState(false)
  const [walkInGroupId, setWalkInGroupId] = useState('')
  const [defaultGuestGroupId, setDefaultGuestGroupId] = useState('')
  const [sectionModeEnabled, setSectionModeEnabled] = useState(false)
  const [tableGroups, setTableGroups] = useState([])
  const [walkInBusy, setWalkInBusy] = useState(false)
  const [seatingTermValue, setSeatingTermValue] = useState('')
  const [seatingTermSaving, setSeatingTermSaving] = useState(false)
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
      const enabled = configured || ['email', 'sms', 'whatsapp', 'mms'].filter((ch) => row[ch])
      return [row.key, Object.fromEntries(['email', 'sms', 'whatsapp', 'mms'].map((ch) => [ch, enabled.includes(ch)]))]
    })))
    setChannelToggles({ email: !!event.notify_email, sms: !!event.notify_sms, whatsapp: !!event.notify_whatsapp })
    setAddons(Object.fromEntries(ADDON_TOGGLES.map((a) => [a.key, !!event[ADDON_FEATURE_KEY[a.key]]])))
    setDeclineNotify(!!event.notify_rsvp_responses)
    setThankYou(!!event.post_event_thankyou_enabled)
    setThankYouAudience(({ admitted: 'Checked in', confirmed: 'Confirmed', all: 'All guests' })[event.post_event_thankyou_audience] || 'Checked in')
    setThankYouDelay(event.post_event_thankyou_delay_hours ?? 24)
    setCheckoutEnabled(!!event.checkout_enabled)
    setWalkInEnabled(!!event.walk_in_enabled)
    setWalkInGroupId(event.walk_in_table_group_id || '')
    setDefaultGuestGroupId(event.default_guest_table_group_id || '')
    setSectionModeEnabled(!!event.section_mode_enabled)
    setSeatingTermValue(event.seating_term || '')
  }, [event])

  useEffect(() => {
    if (!eventId) { setTableGroups([]); return }
    api.listTableGroups(eventId).then(setTableGroups).catch(() => setTableGroups([]))
  }, [eventId])

  async function toggleCheckout() {
    const next = !checkoutEnabled
    setCheckoutEnabled(next)
    saveFeature('checkout', { checkout_enabled: next }, () => setCheckoutEnabled(!next))
    notify(`Check-out ${next ? 'enabled' : 'disabled'}`)
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
    if (!eventId || featureBusy) return
    setFeatureBusy(key)
    try {
      await api.toggleFeatures(eventId, body)
      await onEventChanged?.()
    } catch (e) {
      revert()
      notify(e.message || 'This change could not be saved', true)
    } finally {
      setFeatureBusy('')
    }
  }

  function toggleAddon(key, label) {
    const next = !addons[key]
    setAddons((prev) => ({ ...prev, [key]: next }))
    saveFeature(key, { [ADDON_FEATURE_KEY[key]]: next }, () => setAddons((prev) => ({ ...prev, [key]: !next })))
    notify(`${label} ${next ? 'enabled' : 'disabled'}`)
  }

  function toggleChannel(key, label) {
    const next = !channelToggles[key]
    setChannelToggles((prev) => ({ ...prev, [key]: next }))
    saveFeature(key, { [CHANNEL_FEATURE_KEY[key]]: next }, () => setChannelToggles((prev) => ({ ...prev, [key]: !next })))
    notify(`${label} channel ${next ? 'turned on' : 'turned off'}`)
  }

  async function toggleRoute(rowKey, ch, rowLabel) {
    if (!eventId || routingBusy) return
    const next = { ...routing, [rowKey]: { ...routing[rowKey], [ch]: !routing[rowKey][ch] } }
    if (!Object.values(next[rowKey]).some(Boolean)) {
      notify('At least one channel is required for each automated message flow.')
      return
    }
    const payload = Object.fromEntries(Object.entries(next).map(([key, values]) => [
      ROUTE_API_KEY[key],
      ['email', 'sms', 'whatsapp', 'mms'].filter((channel) => values[channel]),
    ]))
    setRoutingBusy(true)
    try {
      const updated = await api.setChannelPolicy(eventId, payload)
      setRouting(next)
      notify(`${rowLabel} → ${ch.toUpperCase()} ${next[rowKey][ch] ? 'enabled' : 'disabled'}`)
      if (updated?.channel_policy) {
        // Keep the confirmed server order/state as the source of truth.
        setRouting(Object.fromEntries(ROUTING_ROWS.map((row) => {
          const enabled = updated.channel_policy[ROUTE_API_KEY[row.key]] || []
          return [row.key, Object.fromEntries(['email', 'sms', 'whatsapp', 'mms'].map((channel) => [channel, enabled.includes(channel)]))]
        })))
      }
    } catch (e) {
      notify(e.message || 'Channel routing could not be saved')
    } finally {
      setRoutingBusy(false)
    }
  }

  return (
    <>
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

      <div className="rr-section-title">
        <div><h2>Add-ons</h2><p>Turn feature areas on or off for this event (subject to your plan's entitlements)</p></div>
      </div>

      <div className="rr-grid3 cm-toggle-grid">
        {ADDON_TOGGLES.map((a) => (
          <div className="rr-panel cm-toggle-card" key={a.key}>
            <div className="cm-toggle-top">
              <strong>{a.label}</strong>
              <Switch checked={!!addons[a.key]} onChange={() => toggleAddon(a.key, a.label)} />
            </div>
            <p>{a.desc}</p>
          </div>
        ))}
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

      <div className="rr-grid2">
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
        </div>

        <div className="rr-panel cm-toggle-card cm-settings-card">
          <div className="cm-toggle-top">
            <strong>Invited guests without an assignment</strong>
          </div>
          <p>At check-in, route known guests who have no table or group into this group. Tables fill in order before the next table is used.</p>
          <div style={{ marginTop: 8 }}>
            <label className="rd-field-label">Default {seatingTerm(event, { lower: true })} group</label>
            <select className="rr-select gr-inline-select" value={defaultGuestGroupId} onChange={(e) => changeDefaultGuestGroup(e.target.value)}>
              <option value="">— none (seat anywhere) —</option>
              {tableGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
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
  const [creditBlocked, setCreditBlocked] = useState(false)
  const [providerBlocked, setProviderBlocked] = useState(false)

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

      {creditBlocked && (
        <div className="cm-system-banner cm-banner-warn">
          <Icon name="warning" size={14} />
          <div>
            <strong>Not enough SMS credits to send this broadcast.</strong> You have 42 credits remaining — this send needs 220. <a href="/billing-redesign" onClick={(e) => { e.preventDefault(); notify('Opened Billing') }} className="rr-link-btn">Top up in Billing →</a>
          </div>
          <button className="cm-banner-dismiss" onClick={() => setCreditBlocked(false)}>×</button>
        </div>
      )}
      {providerBlocked && (
        <div className="cm-system-banner cm-banner-error">
          <Icon name="warning" size={14} />
          <div>
            <strong>SMS provider not configured.</strong> Outgoing SMS messages are paused until a valid provider API key is saved. <a href="/communications-redesign?tab=settings" onClick={(e) => { e.preventDefault(); goTab('settings') }} className="rr-link-btn">Go to Channel Settings →</a>
          </div>
          <button className="cm-banner-dismiss" onClick={() => setProviderBlocked(false)}>×</button>
        </div>
      )}

      {tab === 'hub' && <HubTab eventId={eventId} notify={notify} />}
      {tab === 'messages' && <MessagesTab eventId={eventId} notify={notify} onPreview={(tpl, ch) => { setPreviewTemplate(tpl); setPreviewChannel(ch || 'email') }} />}
      {tab === 'settings' && <SettingsTab eventId={eventId} event={event} notify={notify} onEventChanged={loadEvent} />}

      {toast && <div className="rd-toast"><Icon name="check" />{toast}</div>}

      {previewTemplate && (
        <Modal title={`Preview: ${previewTemplate.name}`} onClose={() => setPreviewTemplate(null)} width={500}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {['email', 'sms', 'whatsapp', 'mms'].filter((ch) => previewTemplate.channels[ch]).map((ch) => (
              <button key={ch} className={`rr-btn${previewChannel === ch ? ' primary' : ' secondary'}`} onClick={() => setPreviewChannel(ch)} style={{ fontSize: '0.78rem', padding: '4px 10px' }}>{ch.toUpperCase()}</button>
            ))}
          </div>
          <ChannelPreviewFrame
            channel={previewChannel}
            body={previewTemplate.preview?.[`${previewChannel}_body`]
              || previewTemplate.effective?.[`${previewChannel}_body`]
              || `No ${previewChannel.toUpperCase()} body is configured for this template.`}
          />
        </Modal>
      )}
    </RedesignShell>
  )
}
