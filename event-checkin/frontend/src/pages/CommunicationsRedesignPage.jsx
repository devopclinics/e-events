import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import RedesignShell, { Icon, Modal, ChannelPreviewFrame } from './redesign/RedesignShell'
import { useCurrentEvent } from '../hooks/useCurrentEvent'
import { useEventDetails } from '../hooks/useEventDetails'
import { api } from '../api'
import './CommunicationsRedesignPage.css'

/* ── Guest Communication (FestioHub) mock data ──────────────────────── */

const HUB_FEATURES = [
  { key: 'hub', label: 'FestioHub', desc: 'Turn on the guest-facing portal guests land on after they RSVP.', on: true },
  { key: 'announcements', label: 'Event Updates', desc: 'Post announcements guests see inside their Hub feed.', on: true },
  { key: 'messageHost', label: 'Message Host', desc: 'Let guests send the organizer a private message.', on: true },
  { key: 'guestChat', label: 'Guest Chat', desc: 'Shared chat space where every guest can see the conversation.', on: false },
  { key: 'guestPosting', label: 'Guest posting', desc: 'Allow guests to post into Guest Chat themselves, not just read it.', on: false },
]

const ANNOUNCEMENTS = [
  { title: 'Parking has moved to Lot C', audience: 'All guests', reach: 612, sentAt: 'Jul 24', body: 'We have moved overflow parking to Lot C, just north of the main entrance. Signs will be posted starting 6am.' },
  { title: 'Dress code reminder', audience: 'Confirmed guests', reach: 564, sentAt: 'Jul 20', body: 'A quick reminder that this is a semi-formal event. We look forward to seeing you!' },
  { title: 'Livestream link is now live', audience: 'All guests', reach: 612, sentAt: 'Jul 15', body: 'Can\'t make it in person? Watch the livestream at festio.app/live/womens-convention-2026.' },
]

const AUDIENCES = ['All guests', 'Confirmed guests', 'Declined only', 'Checked in', 'Not checked in']

const INBOX_THREADS = [
  {
    name: 'Sara Guest0003', initials: 'SG', preview: 'Can I bring a wheelchair companion with me?', unread: true, time: '10m ago', rsvp: 'Confirmed',
    messages: [
      { from: 'guest', text: 'Can I bring a wheelchair companion with me? Just want to make sure the venue is accessible.', time: '10m ago' },
    ],
  },
  {
    name: 'Omar Guest0044', initials: 'OG', preview: 'Thank you for the update on parking!', unread: false, time: '2h ago', rsvp: 'Declined',
    messages: [
      { from: 'host', text: 'Overflow parking is now in Lot C, just north of the entrance.', time: '3h ago' },
      { from: 'guest', text: 'Thank you for the update on parking!', time: '2h ago' },
    ],
  },
  {
    name: 'Fatima Guest0006', initials: 'FG', preview: 'Is the vegetarian meal option still available?', unread: true, time: 'Yesterday', rsvp: 'Pending',
    messages: [
      { from: 'guest', text: 'Is the vegetarian meal option still available? I forgot to select it on my RSVP.', time: 'Yesterday' },
    ],
  },
]

const MOD_MESSAGES = [
  { name: 'Idris Guest0092', initials: 'IG', text: 'Anyone know a good hotel nearby? Also check out my shop at…', flag: 'Possible spam', hidden: false },
  { name: 'Zaid Guest0007', initials: 'ZG', text: 'This event looks amazing, can’t wait to see everyone!', flag: null, hidden: true },
]
const MOD_VISIBLE_COUNT = 47

/* ── Messages (broadcast + templates) mock data ─────────────────────── */

const CHANNELS = [
  { key: 'email', label: 'Email', rate: null, sent: 0, failed: 0 },
  { key: 'sms', label: 'SMS', rate: 89, sent: 9, failed: 1 },
  { key: 'whatsapp', label: 'WhatsApp', rate: null, sent: 0, failed: 0 },
  { key: 'mms', label: 'MMS', rate: 100, sent: 1, failed: 0 },
]

const NEEDS_ATTENTION = [
  { name: 'Aaliyah Guest0002', initials: 'AG', status: 'warn', label: 'Not sent', reason: 'No phone on file', action: 'Add contact' },
  { name: 'Hamza Guest0025', initials: 'HG', status: 'warn', label: 'Not sent', reason: 'No phone on file', action: 'Add contact' },
  { name: 'Zaid Guest0007', initials: 'ZG', status: 'fail', label: 'Failed', reason: 'Carrier rejected — no A2P registration', action: 'Retry' },
  { name: 'Maryam Guest0009', initials: 'MG', status: 'warn', label: 'Not sent', reason: 'No phone on file', action: 'Add contact' },
  { name: 'Sara Guest0003', initials: 'SG', status: 'warn', label: 'Not sent', reason: 'No phone on file', action: 'Add contact' },
]

const SEND_BATCHES = [
  { when: 'Jul 26, 12:36 AM', sent: 1, failed: 0, open: true, guests: [{ name: 'Karim Guest0308', failed: false }] },
  { when: 'Jul 21, 1:09 AM', sent: 1, failed: 1, guests: [{ name: 'Noor Guest0071', failed: false }, { name: 'Idris Guest0092', failed: true }] },
  { when: 'Jul 20, 3:40 AM', sent: 2, failed: 1, guests: [{ name: 'Bilal Guest0106', failed: false }, { name: 'Omar Guest0044', failed: false }, { name: 'Fatima Guest0006', failed: true }] },
]

const TEMPLATES = [
  { name: 'Invitation', channels: { email: 'custom', sms: 'default', whatsapp: 'default', mms: 'default' } },
  { name: 'RSVP Reminder', channels: { email: 'custom', sms: 'custom', whatsapp: 'default', mms: 'default' } },
  { name: 'Admission Confirmation', channels: { email: 'default', sms: 'default', whatsapp: 'default', mms: 'default' } },
  { name: 'Post-Event Thank You', channels: { email: 'custom', sms: 'default', whatsapp: 'custom', mms: 'default' } },
]

const TEMPLATE_AUDIT = [
  { who: 'Amina Yusuf', what: 'Edited Invitation → Email', when: 'Jul 24, 3:12 PM' },
  { who: 'Karim Haddad', what: 'Reset RSVP Reminder → SMS to default', when: 'Jul 20, 11:02 AM' },
]

/* ── Features & Channels mock data ──────────────────────────────────── */

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

function Switch({ checked, onChange }) {
  return (
    <label className="rd-switch">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className="track" /><span className="knob" />
    </label>
  )
}

/* ── Guest Communication (hub) tab ──────────────────────────────────── */

function HubTab({ notify }) {
  const [features, setFeatures] = useState(() => Object.fromEntries(HUB_FEATURES.map((f) => [f.key, f.on])))
  const [audience, setAudience] = useState(AUDIENCES[0])
  const [editingTitle, setEditingTitle] = useState(null)
  const [openThread, setOpenThread] = useState(INBOX_THREADS[0])
  const [reply, setReply] = useState('')

  function toggleFeature(key, label) {
    setFeatures((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      notify(`${label} ${next[key] ? 'enabled' : 'disabled'}`)
      return next
    })
  }

  function sendReply() {
    if (!reply.trim()) return
    notify(`Reply sent to ${openThread.name}`)
    setReply('')
  }

  return (
    <>
      <div className="cm-credit-row">
        <button className="cm-credit-pill" onClick={() => notify('Opened Billing to top up credits')}>
          <Icon name="card" size={12} /> 1,240 credits left
        </button>
        <button className="rr-link-btn" onClick={() => notify('Guest communication data refreshed')}>Refresh</button>
      </div>

      <div className="rr-grid3 cm-toggle-grid">
        {HUB_FEATURES.map((f) => (
          <div className="rr-panel cm-toggle-card" key={f.key}>
            <div className="cm-toggle-top">
              <strong>{f.label}</strong>
              <Switch checked={!!features[f.key]} onChange={() => toggleFeature(f.key, f.label)} />
            </div>
            <p>{f.desc}</p>
          </div>
        ))}
      </div>

      <div className="rr-section-title">
        <div><h2>Announcements</h2><p>Post an update to everyone’s Hub feed, or a filtered audience</p></div>
      </div>

      <div className="rd-wide-grid">
        <div className="rd-panel">
          <div className="rd-panel-head"><h3>New announcement</h3><p>Guests see this the next time they open their Hub</p></div>
          <div className="rd-panel-body">
            <label className="rd-field-label">Title</label>
            <input className="rd-field" placeholder="e.g. Parking has moved to Lot C" />
            <label className="rd-field-label">Message</label>
            <textarea className="rr-textarea cm-textarea" rows={4} placeholder="Write the update guests will see…" />
            <label className="rd-field-label">Audience</label>
            <select className="rr-select" value={audience} onChange={(e) => setAudience(e.target.value)}>
              {AUDIENCES.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <button className="rr-btn primary cm-send-btn" onClick={() => notify(`Announcement sent to ${audience}`)}>
              <Icon name="send" size={14} /> Send announcement
            </button>
          </div>
        </div>

        <div className="rd-panel">
          <div className="rd-panel-head"><h3>Past announcements</h3><p>Reach reflects guests who had the Hub open</p></div>
          <div className="rd-panel-body cm-announce-list">
            {ANNOUNCEMENTS.map((a) => (
              <div className="cm-announce-row" key={a.title}>
                {editingTitle === a.title ? (
                  <div className="cm-announce-edit">
                    <input className="rd-field" defaultValue={a.title} style={{ marginBottom: 8 }} />
                    <textarea className="rr-textarea" rows={3} defaultValue={a.body} style={{ marginBottom: 8 }} />
                    <div className="rd-row2">
                      <button className="rr-btn secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setEditingTitle(null)}>Cancel</button>
                      <button className="rr-btn primary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => { notify(`"${a.title}" updated`); setEditingTitle(null) }}>Save changes</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div>
                      <strong>{a.title}</strong>
                      <span>{a.audience} · {a.sentAt}</span>
                    </div>
                    <div className="cm-announce-right">
                      <span className="cm-reach">{a.reach} reached</span>
                      <button className="rr-link-btn" onClick={() => setEditingTitle(a.title)}>Edit</button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rr-section-title">
        <div><h2>Guest inbox &amp; chat moderation</h2><p>Private messages to the host, and what’s happening in Guest Chat</p></div>
      </div>

      <div className="rd-wide-grid">
        <div className="rd-panel">
          <div className="rd-panel-head"><h3>Guest inbox</h3><p>Private messages sent to the organizer</p></div>
          <div className="cm-inbox-split">
            <div className="cm-thread-list">
              {INBOX_THREADS.map((t) => (
                <button className={`cm-thread ${openThread.name === t.name ? 'active' : ''}`} key={t.name} onClick={() => setOpenThread(t)}>
                  <span className="rd-who-dot">{t.initials}</span>
                  <span className="cm-thread-body">
                    <span className="cm-thread-top"><strong>{t.name}</strong><small>{t.time}</small></span>
                    <span className="cm-thread-preview">{t.preview}</span>
                    <span className="cm-thread-rsvp">{t.rsvp}</span>
                  </span>
                  {t.unread && <span className="cm-unread-dot" aria-label="Unread" />}
                </button>
              ))}
            </div>
            <div className="cm-thread-view">
              <div className="cm-thread-view-head"><strong>{openThread.name}</strong><span className="rd-status-chip ok">{openThread.rsvp}</span></div>
              <div className="cm-thread-messages">
                {openThread.messages.map((m, i) => (
                  <div key={i} className={`cm-msg ${m.from === 'host' ? 'host' : ''}`}>
                    <p>{m.text}</p>
                    <small>{m.time}</small>
                  </div>
                ))}
              </div>
              <div className="cm-reply-row">
                <input className="rr-input" style={{ marginBottom: 0 }} placeholder="Write a reply…" value={reply} onChange={(e) => setReply(e.target.value)} />
                <button className="rr-btn primary" onClick={sendReply}>Send</button>
              </div>
            </div>
          </div>
        </div>

        <div className="rd-panel">
          <div className="rd-panel-head"><h3>Chat moderation</h3><p>{MOD_VISIBLE_COUNT} visible · flagged for review below</p></div>
          <div className="rd-panel-body cm-mod-list">
            {MOD_MESSAGES.map((m) => (
              <div className="cm-mod-row" key={m.name}>
                <span className="rd-who-dot">{m.initials}</span>
                <div className="cm-mod-body">
                  <div className="cm-mod-top">
                    <strong>{m.name}</strong>
                    {m.flag && <span className="rd-status-chip warn">{m.flag}</span>}
                    {m.hidden && <span className="rd-status-chip fail">Hidden</span>}
                  </div>
                  <p>{m.text}</p>
                </div>
                <button
                  className="rr-btn secondary cm-mod-action"
                  onClick={() => notify(m.hidden ? `Restored message from ${m.name}` : `Hid message from ${m.name}`)}
                >
                  {m.hidden ? 'Restore' : 'Hide'}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

/* ── Broadcast composer ──────────────────────────────────────────────── */

const BROADCAST_TARGETS = ['Everyone', 'Confirmed guests only', 'Not yet responded', 'Checked in', 'No one else (typed recipients only)']
const GUEST_PICKER = ['Karim Guest0308', 'Noor Guest0071', 'Idris Guest0092', 'Bilal Guest0106', 'Fatima Guest0006', 'Omar Guest0044']

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
  const [allGuests, setAllGuests] = useState([])
  const [typedRecipients, setTypedRecipients] = useState([])
  const [typedName, setTypedName] = useState('')
  const [typedContact, setTypedContact] = useState('')
  const [costAck, setCostAck] = useState(false)

  useEffect(() => {
    if (!eventId) { setAllGuests([]); return }
    api.listGuests(eventId).then(setAllGuests).catch(() => setAllGuests([]))
  }, [eventId])

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
        <button onClick={() => notify('New template opened')}><Icon name="plus" size={14} /> New template</button>
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
                  <button className="cm-linklike" onClick={() => notify('Template editing remains in the legacy editor while its rich-text controls are migrated.')}>Edit</button>
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

  useEffect(() => {
    if (!event) return
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
  }, [event])

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
            <button className="rr-link-btn" onClick={() => notify(`Test ${c.label} sent to your own contact info`)}>Send test <Icon name="arrow" size={11} /></button>
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
              <div className="rd-row2" style={{ marginTop: 8 }}>
                <button className="rr-btn secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => notify('Test send is available on the legacy interface during rollout')}>Test send</button>
                <button className="rr-btn primary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => notify('Manual send-now is available on the legacy interface during rollout')}>Send now</button>
              </div>
            </div>
          )}
        </div>
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

      {tab === 'hub' && <div className="rr-panel rd-panel-body">
        <h3>Guest inbox migration in progress</h3>
        <p>The redesign inbox prototype is not connected to live announcements or replies, so its mutation controls are hidden during Stage C. Use the legacy Guest Communication page for supported inbox operations.</p>
      </div>}
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
