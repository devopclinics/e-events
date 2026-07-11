import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, PUBLIC_BASE_URL, publicBaseUrl } from '../api'
import { utcToLocalInput } from '../timeutil'
import { useAuth } from '../context/AuthContext'
import { useCurrentEvent } from '../hooks/useCurrentEvent'

// ── helpers ──────────────────────────────────────────────────────────────────

const STATUS_CFG = {
  draft:  { label: 'Draft',  dot: 'bg-gray-400',    text: 'text-gray-600 dark:text-slate-300',  bg: 'bg-gray-100 dark:bg-slate-700'   },
  active: { label: 'Active', dot: 'bg-green-500 animate-pulse', text: 'text-green-700 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-900/40' },
  ended:  { label: 'Ended',  dot: 'bg-slate-400',   text: 'text-slate-600 dark:text-slate-400', bg: 'bg-slate-100 dark:bg-slate-700'  },
}

function StatusBadge({ status }) {
  const cfg = STATUS_CFG[status] || STATUS_CFG.draft
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${cfg.bg} ${cfg.text}`}>
      <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  )
}

function StatusControls({ event, onChanged }) {
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const actions = {
    draft:  [{ label: '▶ Start Event',  next: 'active', cls: 'bg-green-600 hover:bg-green-700 text-white' }],
    active: [{ label: '⏹ End Event',    next: 'ended',  cls: 'bg-red-600 hover:bg-red-700 text-white' }],
    ended:  [{ label: '↩ Reopen',       next: 'active', cls: 'bg-amber-500 hover:bg-amber-600 text-white' }],
  }[event.status] || []

  async function change(next) {
    setLoading(true); setErr('')
    try {
      const updated = await api.changeStatus(event.id, next)
      onChanged(updated)
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <StatusBadge status={event.status} />
      {actions.map(({ label, next, cls }) => (
        <button key={next} onClick={() => change(next)} disabled={loading}
          className={`px-4 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-50 transition-colors ${cls}`}>
          {loading ? '…' : label}
        </button>
      ))}
      {err && <span className="text-red-600 text-xs">{err}</span>}
      {event.status === 'draft' && (
        <span className="text-xs text-gray-400">Start the event to enable scanning.</span>
      )}
      {event.status === 'ended' && (
        <span className="text-xs text-gray-400">Event ended — scanning is disabled.</span>
      )}
    </div>
  )
}

function GuestCommunicationPanel({ event }) {
  const [settings, setSettings] = useState(null)
  const [announcements, setAnnouncements] = useState([])
  const [inbox, setInbox] = useState([])
  const [chatMessages, setChatMessages] = useState([])
  const [thread, setThread] = useState(null)
  const [draft, setDraft] = useState({ title: '', body: '', audience_type: 'attending_only' })
  const [reply, setReply] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  async function load() {
    setErr('')
    try {
      const [s, a, i, c] = await Promise.all([
        api.messagingSettings(event.id),
        api.listAnnouncements(event.id),
        api.messageInbox(event.id),
        api.guestChatMessages(event.id),
      ])
      setSettings(s); setAnnouncements(a); setInbox(i); setChatMessages(c)
    } catch (e) {
      setErr(e.message || 'Guest communication is temporarily unavailable.')
    }
  }

  useEffect(() => {
    if (!event?.id) return
    load()
    const id = setInterval(load, 30000)
    return () => clearInterval(id)
  }, [event?.id])

  async function saveSetting(key, value) {
    setLoading(true); setErr(''); setMsg('')
    try {
      setSettings(await api.updateMessagingSettings(event.id, { [key]: value }))
      setMsg('Settings saved.')
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  async function sendAnnouncement(e) {
    e.preventDefault()
    if (!draft.title.trim() || !draft.body.trim()) return
    setLoading(true); setErr(''); setMsg('')
    try {
      const sent = await api.createAnnouncement(event.id, draft)
      setAnnouncements((p) => [sent, ...p])
      setDraft({ title: '', body: '', audience_type: 'attending_only' })
      setMsg(`Announcement sent to ${sent.reached ?? 0} guest${sent.reached === 1 ? '' : 's'}.`)
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  async function openThread(threadId) {
    setErr('')
    try { setThread(await api.messageThread(event.id, threadId)) }
    catch (e) { setErr(e.message) }
  }

  async function sendReply(e) {
    e.preventDefault()
    if (!reply.trim() || !thread) return
    setLoading(true); setErr(''); setMsg('')
    try {
      await api.replyMessageThread(event.id, thread.thread_id, reply.trim())
      setReply('')
      await openThread(thread.thread_id)
      await load()
      setMsg('Reply sent.')
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  async function moderateChatMessage(messageId, status) {
    setLoading(true); setErr(''); setMsg('')
    try {
      const updated = await api.moderateGuestChatMessage(event.id, messageId, status)
      setChatMessages((p) => p.map((m) => m.id === messageId ? updated : m))
      setMsg(status === 'hidden' ? 'Chat message hidden.' : 'Chat message restored.')
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  const field = 'w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-700 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500'

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold text-base dark:text-white">Guest Communication</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Send event updates and respond to guest questions. Messaging never blocks RSVP or QR admission.</p>
          </div>
          <button onClick={load} className="text-xs font-semibold text-teal-600 hover:underline">Refresh</button>
        </div>
        {err && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
        {msg && <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{msg}</div>}
        {settings && (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {[
              ['guest_hub_enabled', 'Guest Hub', 'Show the post-RSVP hub for accepted attendees.'],
              ['announcements_enabled', 'Event Updates', 'Show organizer updates in Guest Hub.'],
              ['direct_host_messages_enabled', 'Message Host', 'Let guests send private questions to the organizer.'],
              ['guest_chat_enabled', 'Guest Chat', 'Show a shared guest-to-guest chat.'],
              ['guest_chat_posting_enabled', 'Guest Posts', 'Allow guests to add new chat messages.'],
            ].map(([key, label, help]) => (
              <label key={key} className="flex min-h-[92px] flex-col justify-between gap-3 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700 dark:text-slate-200">
                <span>
                  <span className="block font-semibold">{label}</span>
                  <span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-slate-400">{help}</span>
                </span>
                <span className="flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {settings[key] ? 'Enabled' : 'Disabled'}
                  <input type="checkbox" checked={!!settings[key]} disabled={loading} onChange={(e) => saveSetting(key, e.target.checked)} className="h-4 w-4 accent-teal-600" />
                </span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
        <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6">
          <h3 className="font-semibold text-base dark:text-white">Announcements</h3>
          <form onSubmit={sendAnnouncement} className="mt-4 space-y-3">
            <input className={field} value={draft.title} onChange={(e) => setDraft((p) => ({ ...p, title: e.target.value }))} placeholder="Update title, e.g. Parking Update" maxLength={255} />
            <textarea className={field} rows={4} value={draft.body} onChange={(e) => setDraft((p) => ({ ...p, body: e.target.value }))} placeholder="Write a warm update for your guests..." maxLength={5000} />
            <div className="flex flex-col gap-3 sm:flex-row">
              <select className={field} value={draft.audience_type} onChange={(e) => setDraft((p) => ({ ...p, audience_type: e.target.value }))}>
                <option value="attending_only">Attending only</option>
                <option value="all_invited">All invited</option>
                <option value="declined_only">Declined only</option>
                <option value="checked_in_only">Checked in</option>
                <option value="not_checked_in">Not checked in</option>
              </select>
              <button disabled={loading || !draft.title.trim() || !draft.body.trim()} className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50">
                Send update
              </button>
            </div>
          </form>
          <div className="mt-5 space-y-3">
            {announcements.length ? announcements.map((a) => (
              <div key={a.id} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                <div className="font-semibold text-sm dark:text-white">{a.title}</div>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{a.body}</p>
                <div className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{a.audience_type?.replaceAll('_', ' ')}</div>
              </div>
            )) : <p className="text-sm text-slate-400 mt-4">No announcements yet.</p>}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6">
          <h3 className="font-semibold text-base dark:text-white">Guest Questions Inbox</h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Questions sent through Message Host appear here. Replies are visible to that guest in their Guest Hub.</p>
          <div className="mt-4 space-y-2">
            {inbox.length ? inbox.map((t) => (
              <button key={t.thread_id} onClick={() => openThread(t.thread_id)} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 p-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold text-sm dark:text-white">{t.guest_name}</span>
                  <span className="text-[11px] text-slate-400">{t.rsvp_status}</span>
                </div>
                <p className="mt-1 truncate text-sm text-slate-500 dark:text-slate-400">{t.last_message}</p>
              </button>
            )) : <p className="text-sm text-slate-400">No guest messages yet.</p>}
          </div>
          {thread && (
            <div className="mt-5 border-t border-slate-200 dark:border-slate-700 pt-4">
              <div className="font-semibold text-sm dark:text-white">{thread.guest?.name}</div>
              <div className="mt-3 max-h-64 space-y-2 overflow-auto">
                {thread.messages.map((m) => (
                  <div key={m.id} className={`rounded-lg px-3 py-2 text-sm ${m.sender_type === 'organizer' ? 'bg-teal-50 text-teal-900 dark:bg-teal-900/30 dark:text-teal-100' : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200'}`}>
                    <div className="text-[11px] font-bold uppercase tracking-wide opacity-70">{m.sender_name}</div>
                    <div className="mt-1">{m.body}</div>
                  </div>
                ))}
              </div>
              <form onSubmit={sendReply} className="mt-3 flex gap-2">
                <input className={field} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply to guest..." />
                <button disabled={loading || !reply.trim()} className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50">Reply</button>
              </form>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-semibold text-base dark:text-white">Guest Chat Moderation</h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Hide messages that should not appear in the guest-facing chat.</p>
          </div>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500 dark:bg-slate-700 dark:text-slate-300">
            {chatMessages.filter((m) => m.status === 'active').length} visible
          </span>
        </div>
        <div className="mt-4 space-y-3">
          {chatMessages.length ? chatMessages.map((m) => (
            <div key={m.id} className={`rounded-lg border p-3 ${m.status === 'hidden' ? 'border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20' : 'border-slate-200 dark:border-slate-700'}`}>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wide text-slate-400">{m.sender_name} · {m.status}</div>
                  <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">{m.body}</p>
                </div>
                <button
                  disabled={loading}
                  onClick={() => moderateChatMessage(m.id, m.status === 'hidden' ? 'active' : 'hidden')}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  {m.status === 'hidden' ? 'Restore' : 'Hide'}
                </button>
              </div>
            </div>
          )) : <p className="text-sm text-slate-400">No guest chat messages yet.</p>}
        </div>
      </div>
    </div>
  )
}

// ── Feature Toggles ───────────────────────────────────────────────────────────

function ChannelToggles({ event, onChanged, onGate }) {
  const [loading, setLoading]   = useState(false)
  const [testing, setTesting]   = useState(null)        // channel currently being tested
  const [testMsg, setTestMsg]   = useState('')          // success / error banner
  async function toggle(key) {
    setLoading(true)
    try {
      const updated = await api.toggleFeatures(event.id, { [key]: !event[key] })
      onChanged(updated)
    } catch (e) {
      if (e.status === 402) onGate?.({ title: 'Activate messaging channels', message: e.message, requiredPlan: FEATURE_PLAN[key] || requiredPlanFromError(e), error: e })
      else console.error(e)
    }
    finally { setLoading(false) }
  }
  async function sendTest(channel) {
    const phone = prompt(`Send a test ${channel.toUpperCase()} to which number?\n(US 10-digit or full E.164 e.g. +18327941707)`)
    if (!phone || !phone.trim()) return
    setTesting(channel); setTestMsg('')
    try {
      const res = await api.sendTestMessage(event.id, channel, phone.trim())
      setTestMsg(`✓ Test ${channel} sent to ${res.to}`)
      setTimeout(() => setTestMsg(''), 6000)
    } catch (e) { setTestMsg(`✗ ${e.message}`) }
    finally { setTesting(null) }
  }
  const channels = [
    { key: 'notify_email',    label: 'Email',    icon: '✉', test: null },
    { key: 'notify_sms',      label: 'SMS',      icon: '📱', test: 'sms' },
    { key: 'notify_whatsapp', label: 'WhatsApp', icon: '💬', test: 'whatsapp' },
  ]
  return (
    <div className="pt-3 border-t dark:border-slate-700 mt-3 space-y-2">
      <div className="flex flex-wrap gap-3 items-center">
        <span className="text-xs font-semibold text-gray-500 dark:text-slate-400">Notify on:</span>
        {channels.map(({ key, label, icon, test }) => (
          <div key={key} className="flex items-center gap-1">
            <button onClick={() => toggle(key)} disabled={loading}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-50 ${
                event[key]
                  ? 'bg-teal-600 text-white border-teal-600 hover:bg-teal-700'
                  : 'bg-white dark:bg-slate-700 text-gray-600 dark:text-slate-300 border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-600'
              }`}>
              {icon} {label} {event[key] ? 'ON' : 'OFF'}
            </button>
            {test && (
              <button
                onClick={() => sendTest(test)}
                disabled={testing === test}
                title={`Send a test ${test.toUpperCase()} to verify provider creds`}
                className="text-[10px] text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50">
                {testing === test ? '…sending' : 'test'}
              </button>
            )}
          </div>
        ))}
      </div>
      {testMsg && (
        <div className={`text-xs px-2 py-1 rounded inline-block ${testMsg.startsWith('✓')
          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
          : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'}`}>
          {testMsg}
        </div>
      )}
      <p className="text-[10px] text-gray-400 dark:text-slate-500 italic">
        SMS / WhatsApp need a phone number on each guest + provider creds in .env
      </p>
    </div>
  )
}

function FeatureToggles({ event, onChanged, onGate }) {
  const [loading, setLoading] = useState(false)

  const [err, setErr] = useState('')
  const locked = !event.is_paid

  async function toggle(key) {
    if (locked) {
      const requiredPlan = FEATURE_PLAN[key] || 'tier50'
      onGate?.({
        title: `Activate ${key.replace(/_enabled$/, '').replace(/_/g, ' ')}`,
        message: `This module requires ${PLAN_LABELS[requiredPlan] || 'an Event Pass'}. You can preview the setup now and pay only when activating it.`,
        requiredPlan,
      })
      setErr('Choose an Event Pass to activate this module.')
      return
    }
    setLoading(true); setErr('')
    try {
      const updated = await api.toggleFeatures(event.id, { [key]: !event[key] })
      onChanged(updated)
    } catch (e) {
      if (e.status === 402) onGate?.({ title: 'Upgrade required', message: e.message, requiredPlan: FEATURE_PLAN[key] || requiredPlanFromError(e), error: e })
      setErr(e.message)
    }
    finally { setLoading(false) }
  }

  return (
    <div className="flex flex-wrap gap-3 pt-3 border-t dark:border-slate-700 mt-3">
      <span className="text-xs font-semibold text-gray-500 dark:text-slate-400 self-center">Event extras:</span>
      {[
        { key: 'seating_enabled', label: 'Seating' },
        { key: 'partner_pairing_enabled', label: 'Partner pairing' },
        { key: 'menu_enabled',    label: 'Orders' },
        { key: 'logistics_enabled', label: 'Deliveries' },
        { key: 'registry_enabled', label: 'Gift list' },
        { key: 'venue_access_enabled', label: 'Entry rules' },
      ].map(({ key, label }) => (
        <button
          key={key}
          onClick={() => toggle(key)}
          disabled={loading || locked}
          title={locked ? 'Requires an Event Pass' : ''}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-50 ${
            event[key]
              ? 'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700'
              : 'bg-white dark:bg-slate-700 text-gray-600 dark:text-slate-300 border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-600'
          }`}
        >
          {label} {event[key] ? 'ON' : 'OFF'}{locked ? ' 🔒' : ''}
        </button>
      ))}
      {err && <span className="text-xs text-amber-600 dark:text-amber-400 self-center">{err}</span>}
    </div>
  )
}

function SelfCheckinPanel({ event, onChanged, onFlash, onGate }) {
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const code = event.event_code
  const url = code ? api.selfCheckinUrl(code, event) : ''

  async function toggle() {
    setLoading(true)
    try {
      const updated = await api.setSelfCheckin(event.id, !event.self_checkin_enabled)
      onChanged(updated)
      onFlash?.(`Self check-in ${updated.self_checkin_enabled ? 'enabled' : 'disabled'}.`)
    } catch (e) {
      if (e.status === 402) onGate?.({ title: 'Activate self check-in', message: e.message, requiredPlan: FEATURE_PLAN.self_checkin_enabled, error: e })
      else onFlash?.(e.message, true)
    } finally {
      setLoading(false)
    }
  }

  async function copyLink() {
    if (!url) return
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  async function downloadQR() {
    if (!code) return
    try {
      const resp = await fetch(api.selfCheckinQrUrl(code))
      const blob = await resp.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `self-checkin-qr-${code}.png`
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(a.href)
    } catch (e) { onFlash?.(e.message, true) }
  }

  return (
    <div className="border-t dark:border-slate-700 pt-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold text-base dark:text-white">Check-in options</h2>
          <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">Let guests scan one event QR and find themselves by name or phone.</p>
        </div>
        <button onClick={toggle} disabled={loading}
          className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-colors disabled:opacity-50 ${
            event.self_checkin_enabled
              ? 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700'
              : 'bg-white dark:bg-slate-700 text-gray-700 dark:text-slate-200 border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-600'
          }`}>
          Self Check-in: {event.self_checkin_enabled ? 'ON' : 'OFF'}
        </button>
      </div>

      {event.self_checkin_enabled && code && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-4 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="min-w-0 space-y-2">
            <div>
              <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">Event code</div>
              <div className="text-xl font-bold tracking-widest text-slate-950 dark:text-white">{code}</div>
            </div>
            <div className="flex gap-2">
              <input readOnly value={url}
                className="min-w-0 flex-1 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-600 dark:text-slate-300" />
              <button onClick={copyLink}
                className="shrink-0 rounded-lg bg-slate-900 dark:bg-slate-100 px-3 py-2 text-xs font-semibold text-white dark:text-slate-900">
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
          <div className="justify-self-center flex flex-col items-center gap-2">
            <a href={api.selfCheckinQrUrl(code)} target="_blank" rel="noopener noreferrer"
              className="rounded-lg bg-white p-2 shadow-sm">
              <img src={api.selfCheckinQrUrl(code)} alt="Self check-in QR code" className="h-32 w-32" />
            </a>
            <button onClick={downloadQR}
              className="text-xs font-semibold text-teal-600 dark:text-teal-400 hover:underline">
              ⬇ Download QR
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Seating Panel ─────────────────────────────────────────────────────────────

function VipBadge({ className = '' }) {
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 ${className}`}
      title="VVIP">
      <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118L10 13.347l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L3.567 7.819c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
      </svg>
      VIP
    </span>
  )
}

// Preset seating categories. The form's input is free-text backed by these
// suggestions, so organizers can also type a custom label (e.g. "Sponsors").
const TABLE_CATEGORIES = ['General', 'Male', 'Female', 'Kids', 'Youth', 'Couples', 'VIP', 'Family', 'Staff']

function CategoryBadge({ value, className = '' }) {
  if (!value) return null
  const c = String(value).toLowerCase()
  const tone =
    c === 'male'   ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
    : c === 'female' ? 'bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300'
    : c === 'kids'   ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
    : c === 'youth'  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
    : c === 'vip'    ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'
    : 'bg-slate-200 text-slate-600 dark:bg-slate-600 dark:text-slate-200'
  return (
    <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded ${tone} ${className}`}>
      {value}
    </span>
  )
}

function SeatingPanel({ eventId }) {
  const [tables, setTables]       = useState([])
  const [chart, setChart]         = useState(null)
  const [showChart, setShowChart] = useState(false)
  const [form, setForm]           = useState(null)
  const [loading, setLoading]     = useState(false)
  const [msg, setMsg]             = useState('')
  // Reserve modal — when admin clicks an empty seat we open a guest picker.
  const [assignSlot, setAssignSlot] = useState(null)  // {tableId, tableName, seat}
  const [allGuests, setAllGuests]   = useState([])
  const [guestQuery, setGuestQuery] = useState('')

  const fieldCls = 'border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white'

  useEffect(() => {
    api.listTables(eventId).then(setTables).catch(console.error)
  }, [eventId])

  async function loadChart() {
    const [chartData, guestData] = await Promise.all([
      api.getSeatingChart(eventId),
      api.listGuests(eventId),
    ])
    setChart(chartData)
    setAllGuests(guestData)
    setShowChart(true)
  }

  async function reserveSeat(guestId) {
    if (!assignSlot) return
    setLoading(true)
    try {
      await api.assignSeat(eventId, guestId, {
        table_id: assignSlot.tableId,
        seat_number: String(assignSlot.seat),
      })
      setAssignSlot(null)
      setGuestQuery('')
      const [chartData, guestData, tableData] = await Promise.all([
        api.getSeatingChart(eventId),
        api.listGuests(eventId),
        api.listTables(eventId),
      ])
      setChart(chartData); setAllGuests(guestData); setTables(tableData)
    } catch (e) { setMsg(e.message) }
    finally { setLoading(false) }
  }

  async function addVvipAndReserve(vvip) {
    if (!assignSlot) return
    setLoading(true)
    try {
      const created = await api.addGuest(eventId, vvip)
      await api.assignSeat(eventId, created.id, {
        table_id: assignSlot.tableId,
        seat_number: String(assignSlot.seat),
      })
      setAssignSlot(null); setGuestQuery('')
      const [chartData, guestData, tableData] = await Promise.all([
        api.getSeatingChart(eventId),
        api.listGuests(eventId),
        api.listTables(eventId),
      ])
      setChart(chartData); setAllGuests(guestData); setTables(tableData)
      setMsg(`${created.first_name} ${created.last_name} added & seated.`)
      setTimeout(() => setMsg(''), 4000)
    } catch (e) { setMsg(e.message) }
    finally { setLoading(false) }
  }

  async function unassignSeat(guestId) {
    if (!confirm('Remove this guest from their seat?')) return
    setLoading(true)
    try {
      await api.assignSeat(eventId, guestId, { table_id: null, seat_number: null })
      const [chartData, guestData, tableData] = await Promise.all([
        api.getSeatingChart(eventId),
        api.listGuests(eventId),
        api.listTables(eventId),
      ])
      setChart(chartData); setAllGuests(guestData); setTables(tableData)
    } catch (e) { setMsg(e.message) }
    finally { setLoading(false) }
  }

  async function saveTable(e) {
    e.preventDefault()
    setLoading(true)
    try {
      const payload = { name: form.name, capacity: Number(form.capacity), category: form.category?.trim() || null,
                        sort_order: form.sort_order === '' || form.sort_order == null ? 0 : Number(form.sort_order) }
      if (form.id) {
        const updated = await api.updateTable(eventId, form.id, payload)
        setTables((prev) => prev.map((t) => (t.id === form.id ? updated : t)))
      } else {
        const created = await api.createTable(eventId, payload)
        setTables((prev) => [...prev, created])
      }
      setForm(null)
      if (showChart) loadChart()
    } catch (e) { setMsg(e.message) }
    finally { setLoading(false) }
  }

  async function deleteTable(id) {
    if (!confirm('Delete this table? Assigned guests will be unassigned.')) return
    setLoading(true)
    try {
      await api.deleteTable(eventId, id)
      setTables((prev) => prev.filter((t) => t.id !== id))
      if (showChart) loadChart()
    } catch (e) { setMsg(e.message) }
    finally { setLoading(false) }
  }

  async function autoAssign(clear) {
    if (clear && !confirm('Clear all seat assignments and reassign everyone?')) return
    setLoading(true)
    try {
      const res = await api.autoAssign(eventId, clear)
      setMsg(`Assigned: ${res.assigned}, remaining unassigned: ${res.unassigned}`)
      setTimeout(() => setMsg(''), 4000)
      api.listTables(eventId).then(setTables)
      if (showChart) loadChart()
    } catch (e) { setMsg(e.message) }
    finally { setLoading(false) }
  }

  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-semibold text-base dark:text-white">Seating</h2>
        <div className="flex gap-2 flex-wrap">
          <a href={`/floor-plan/${eventId}`}
            className="bg-teal-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-teal-700">
            🪑 Floor layout
          </a>
          <button onClick={() => autoAssign(false)} disabled={loading || tables.length === 0}
            className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-blue-700 disabled:opacity-50">
            Auto-Assign
          </button>
          <button onClick={() => autoAssign(true)} disabled={loading || tables.length === 0}
            className="bg-amber-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-amber-600 disabled:opacity-50">
            Reassign All
          </button>
          <button onClick={() => setForm({ name: '', capacity: 10, category: '', sort_order: tables.length })} disabled={loading}
            className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-indigo-700">
            + Table
          </button>
        </div>
      </div>

      {tables.length === 0 && !form ? (
        <p className="text-sm text-gray-400 dark:text-slate-500">No tables yet. Add tables to enable seating.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-slate-700 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">
              <tr>
                <th className="px-4 py-2 text-center">Order</th>
                <th className="px-4 py-2 text-left">Table</th>
                <th className="px-4 py-2 text-center">Category</th>
                <th className="px-4 py-2 text-center">Capacity</th>
                <th className="px-4 py-2 text-center">Assigned</th>
                <th className="px-4 py-2 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
              {tables.map((t) => (
                <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-slate-700">
                  <td className="px-4 py-2.5 text-center text-xs text-gray-400 dark:text-slate-500">{t.sort_order ?? 0}</td>
                  <td className="px-4 py-2.5 font-medium dark:text-slate-100">{t.name}</td>
                  <td className="px-4 py-2.5 text-center">
                    {t.category ? <CategoryBadge value={t.category} /> : <span className="text-xs text-gray-300 dark:text-slate-600">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-center dark:text-slate-300">{t.capacity}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`text-xs font-semibold ${t.assigned_count >= t.capacity ? 'text-red-500' : 'text-green-600'}`}>
                      {t.assigned_count}/{t.capacity}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <div className="flex justify-center gap-3">
                      <button onClick={() => setForm({ id: t.id, name: t.name, capacity: t.capacity, category: t.category || '', sort_order: t.sort_order ?? 0 })}
                        className="text-xs text-indigo-600 hover:underline">Edit</button>
                      <button onClick={() => deleteTable(t.id)} disabled={loading}
                        className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <form onSubmit={saveTable} className="flex flex-wrap gap-2 items-end bg-gray-50 dark:bg-slate-700 rounded-lg p-3 border dark:border-slate-600">
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Table Name</label>
            <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required
              className={fieldCls} placeholder="Table 1" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Category</label>
            <input list="table-category-list" value={form.category || ''}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              className={`${fieldCls} w-44`} placeholder="General · or type your own" />
            <datalist id="table-category-list">
              {TABLE_CATEGORIES.map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Capacity</label>
            <input type="number" min="1" max="200" value={form.capacity}
              onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))} required
              className={`${fieldCls} w-24`} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Order</label>
            <input type="number" min="0" value={form.sort_order ?? 0}
              onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))}
              className={`${fieldCls} w-20`} title="Lower numbers come first" />
          </div>
          <button type="submit" disabled={loading}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
            {form.id ? 'Save' : 'Add'}
          </button>
          <button type="button" onClick={() => setForm(null)}
            className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-sm dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-600">
            Cancel
          </button>
        </form>
      )}

      {tables.length > 0 && (
        <div className="pt-2 border-t dark:border-slate-700">
          <button
            onClick={showChart ? () => setShowChart(false) : loadChart}
            disabled={loading}
            className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            {showChart ? '▲ Hide Seating Chart' : '▼ Show Seating Chart'}
          </button>
          {showChart && chart && (
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {chart.map((t) => (
                <div key={t.id} className="border dark:border-slate-700 rounded-lg overflow-hidden">
                  <div className="bg-slate-100 dark:bg-slate-700 px-3 py-2 flex justify-between items-center">
                    <span className="text-sm font-semibold dark:text-white flex items-center gap-2">
                      {t.name}
                      <CategoryBadge value={t.category} />
                    </span>
                    <span className="text-xs text-gray-500 dark:text-slate-400">
                      {t.seats.filter((s) => s.guest_id).length}/{t.capacity}
                    </span>
                  </div>
                  <div className="divide-y dark:divide-slate-700 max-h-64 overflow-y-auto">
                    {t.seats.map((s) => (
                      <button
                        key={s.seat}
                        type="button"
                        onClick={() => s.guest_id
                          ? unassignSeat(s.guest_id)
                          : setAssignSlot({ tableId: t.id, tableName: t.name, seat: s.seat })}
                        className={`w-full px-3 py-1.5 flex items-center gap-2 text-sm text-left transition-colors ${
                          s.guest_id
                            ? 'hover:bg-rose-50 dark:hover:bg-rose-900/20'
                            : 'hover:bg-teal-50 dark:hover:bg-teal-900/20'
                        }`}
                        title={s.guest_id ? 'Click to unassign' : 'Click to reserve for a guest'}
                      >
                        <span className="w-6 text-xs font-mono text-gray-400 dark:text-slate-500 shrink-0">{s.seat}</span>
                        {s.guest_id ? (
                          <>
                            <span className="flex-1 dark:text-slate-200 truncate">{s.name}</span>
                            {s.is_vip && <VipBadge />}
                            {s.admitted && <span className="text-xs text-green-600 shrink-0" title="Arrived">✓</span>}
                            {s.meal_served && <span className="text-xs text-amber-600 shrink-0" title="Order served">✓</span>}
                          </>
                        ) : (
                          <span className="flex-1 text-xs italic text-teal-600 dark:text-teal-400">+ reserve</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {msg && <p className="text-sm text-indigo-600">{msg}</p>}

      {assignSlot && (
        <ReserveSeatModal
          slot={assignSlot}
          guests={allGuests}
          loading={loading}
          query={guestQuery}
          onQuery={setGuestQuery}
          onPick={reserveSeat}
          onAddVvip={addVvipAndReserve}
          onClose={() => { setAssignSlot(null); setGuestQuery('') }}
        />
      )}
    </div>
  )
}

// ── Table Groups panel ─────────────────────────────────────────────────────────
// Group existing tables under a tag and assign guests to the group. Guests with a
// group can only be seated/checked-in at tables in that group (enforced server-side).

function TableGroupsPanel({ eventId }) {
  const [groups, setGroups] = useState([])
  const [tables, setTables] = useState([])
  const [form, setForm]     = useState(null)   // {id?, name, tag, description, table_ids:[]}
  const [loading, setLoading] = useState(false)
  const [err, setErr]       = useState('')

  const fieldCls = 'border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white'

  async function reload() {
    try {
      const [g, t] = await Promise.all([api.listTableGroups(eventId), api.listTables(eventId)])
      setGroups(g); setTables(t)
    } catch (e) { setErr(e.message) }
  }
  useEffect(() => { reload() }, [eventId])

  const tableName = (id) => tables.find((t) => t.id === id)?.name || id

  function toggleTable(id) {
    setForm((f) => {
      const has = f.table_ids.includes(id)
      return { ...f, table_ids: has ? f.table_ids.filter((x) => x !== id) : [...f.table_ids, id] }
    })
  }

  async function save(e) {
    e.preventDefault()
    setLoading(true); setErr('')
    try {
      const payload = {
        name: form.name.trim(),
        tag: (form.tag || '').trim() || form.name.trim(),
        description: form.description?.trim() || null,
        sort_order: form.sort_order === '' || form.sort_order == null ? 0 : Number(form.sort_order),
        table_ids: form.table_ids,
        table_orders: Object.fromEntries(form.table_ids.map((id) => [id, Number(form.table_orders?.[id] ?? 0)])),
      }
      if (form.id) await api.updateTableGroup(eventId, form.id, payload)
      else await api.createTableGroup(eventId, payload)
      setForm(null)
      await reload()
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  async function remove(id) {
    if (!confirm('Delete this table group?')) return
    setLoading(true); setErr('')
    try {
      await api.deleteTableGroup(eventId, id)
      await reload()
    } catch (e) { setErr(e.message) }   // 409 surfaces the "reassign first" message
    finally { setLoading(false) }
  }

  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6 space-y-4 mt-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-semibold text-base dark:text-white">Table Groups</h2>
          <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">
            Group tables (e.g. VIP, Family) and tag guests to them. Tagged guests can only be seated within their group.
          </p>
        </div>
        <button onClick={() => setForm({ name: '', tag: '', description: '', sort_order: groups.length, table_ids: [], table_orders: {} })} disabled={loading}
          className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-indigo-700">
          + Table Group
        </button>
      </div>

      {err && <p className="text-sm text-red-500">{err}</p>}

      {groups.length === 0 && !form ? (
        <p className="text-sm text-gray-400 dark:text-slate-500">No table groups yet.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {groups.map((g) => (
            <div key={g.id} className="border dark:border-slate-700 rounded-lg p-3">
              <div className="flex justify-between items-start gap-2">
                <div>
                  <div className="font-semibold text-sm dark:text-white">{g.name} <span className="text-[11px] font-normal text-gray-400">· order {g.sort_order ?? 0}</span></div>
                  <span className="inline-block mt-0.5 text-[11px] font-mono bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.5 rounded">{g.tag}</span>
                </div>
                <div className="flex gap-3 shrink-0">
                  <button onClick={() => setForm({ id: g.id, name: g.name, tag: g.tag, description: g.description || '', sort_order: g.sort_order ?? 0, table_ids: g.table_ids || [], table_orders: Object.fromEntries((g.table_ids || []).map((id) => [id, tables.find((t) => t.id === id)?.sort_order ?? 0])) })}
                    className="text-xs text-indigo-600 hover:underline">Edit</button>
                  <button onClick={() => remove(g.id)} disabled={loading}
                    className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40">Delete</button>
                </div>
              </div>
              {g.description && <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">{g.description}</p>}
              <div className="mt-2 text-xs text-gray-500 dark:text-slate-400">
                Tables: {(g.table_ids || []).length ? (g.table_ids).map(tableName).join(', ') : <span className="italic">none</span>}
              </div>
              <div className="mt-1 flex items-center gap-3 text-xs">
                <span className="dark:text-slate-300">👤 {g.assigned_guest_count} assigned</span>
                <span className={g.remaining_seats < 0 ? 'text-red-500 font-semibold' : 'text-green-600'}>
                  {g.remaining_seats} of {g.total_seats} seats free
                </span>
              </div>
              {g.over_capacity && (
                <p className="mt-1 text-xs text-red-500">⚠ More guests assigned than available seats in this group.</p>
              )}
            </div>
          ))}
        </div>
      )}

      {form && (
        <form onSubmit={save} className="bg-gray-50 dark:bg-slate-700 rounded-lg p-3 border dark:border-slate-600 space-y-3">
          <div className="flex flex-wrap gap-2">
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Group name</label>
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required
                className={fieldCls} placeholder="VIP Tables" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Tag (for import/assign)</label>
              <input value={form.tag} onChange={(e) => setForm((f) => ({ ...f, tag: e.target.value }))}
                className={`${fieldCls} w-40`} placeholder="VIP" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Order</label>
              <input type="number" min="0" value={form.sort_order ?? 0}
                onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))}
                className={`${fieldCls} w-20`} title="Lower numbers come first" />
            </div>
            <div className="flex-1 min-w-[12rem]">
              <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Description</label>
              <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className={`${fieldCls} w-full`} placeholder="Optional" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Tables in this group</label>
            {tables.length === 0 ? (
              <p className="text-xs text-gray-400">Create tables first (in Seating above).</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {tables.map((t) => (
                  <button key={t.id} type="button" onClick={() => toggleTable(t.id)}
                    className={`text-xs px-2.5 py-1 rounded-full border ${
                      form.table_ids.includes(t.id)
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white dark:bg-slate-800 text-gray-600 dark:text-slate-300 border-gray-300 dark:border-slate-600'
                    }`}>
                    {t.name} <span className="opacity-60">({t.capacity})</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {form.table_ids.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Order of tables in this group</label>
              <div className="flex flex-wrap gap-2">
                {form.table_ids.map((id) => (
                  <div key={id} className="flex items-center gap-1 text-xs">
                    <span className="dark:text-slate-300">{tableName(id)}</span>
                    <input type="number" min="0" value={form.table_orders?.[id] ?? 0}
                      onChange={(e) => setForm((f) => ({ ...f, table_orders: { ...f.table_orders, [id]: e.target.value } }))}
                      className={`${fieldCls} w-16 py-1`} />
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <button type="submit" disabled={loading}
              className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
              {form.id ? 'Save' : 'Create'}
            </button>
            <button type="button" onClick={() => setForm(null)}
              className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-sm dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-600">
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

// ── Check-out toggle ─────────────────────────────────────────────────────────
// Shows/hides the scanner's Check-out mode. When on, staff can scan a guest's
// ticket/checkout QR to record their exit; guests see it in their Guest Hub and
// (if experience is on) as a check_out step in the workflow.

function CheckoutToggle({ event, onChanged, onFlash }) {
  const [loading, setLoading] = useState(false)
  async function toggle() {
    setLoading(true)
    try {
      const updated = await api.toggleFeatures(event.id, { checkout_enabled: !event.checkout_enabled })
      onChanged(updated)
      onFlash?.(`Check-out ${updated.checkout_enabled ? 'enabled' : 'disabled'}.`)
    } catch (e) { onFlash?.(e.message, true) }
    finally { setLoading(false) }
  }
  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6 mt-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold text-base dark:text-white">Guest check-out</h2>
          <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">Record when guests leave. Adds a Check-out mode to the Scanner; the exit time shows in the Guest Hub{event.experience_enabled ? ' and as a check-out step in the experience' : ''}.</p>
        </div>
        <button onClick={toggle} disabled={loading}
          className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-colors disabled:opacity-50 ${
            event.checkout_enabled
              ? 'bg-teal-600 text-white border-teal-600 hover:bg-teal-700'
              : 'bg-white dark:bg-slate-700 text-gray-700 dark:text-slate-200 border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-600'
          }`}>
          Check-out: {event.checkout_enabled ? 'ON' : 'OFF'}
        </button>
      </div>
    </div>
  )
}

// ── Walk-in toggle (ported from prod) ───────────────────────────────────────────
// Lets staff register walk-in guests at the door (Scanner -> Manual / Walk-in). New walk-ins
// are auto-assigned to a chosen table group.

function WalkInToggle({ event, onChanged, onFlash }) {
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(false)
  useEffect(() => { api.listTableGroups(event.id).then(setGroups).catch(() => setGroups([])) }, [event.id])

  async function toggle() {
    setLoading(true)
    try {
      const updated = await api.setWalkIn(event.id, !event.walk_in_enabled)
      onChanged(updated)
      onFlash?.(`Walk-in registration ${updated.walk_in_enabled ? 'enabled' : 'disabled'}.`)
    } catch (e) { onFlash?.(e.message, true) }
    finally { setLoading(false) }
  }

  async function setGroup(gid) {
    try {
      onChanged(await api.setWalkInGroup(event.id, gid || null))
    } catch (e) { onFlash?.(e.message, true) }
  }

  async function toggleSection() {
    setLoading(true)
    try {
      const updated = await api.toggleFeatures(event.id, { section_mode_enabled: !event.section_mode_enabled })
      onChanged(updated)
      onFlash?.(`Section scanning ${updated.section_mode_enabled ? 'enabled' : 'disabled'}.`)
    } catch (e) { onFlash?.(e.message, true) }
    finally { setLoading(false) }
  }

  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6 space-y-3 mt-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold text-base dark:text-white">Walk-in guests</h2>
          <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">Let staff register guests who arrive without an invite (Scanner: Manual / Walk-in tab).</p>
        </div>
        <button onClick={toggle} disabled={loading}
          className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-colors disabled:opacity-50 ${
            event.walk_in_enabled
              ? 'bg-amber-500 text-white border-amber-500 hover:bg-amber-600'
              : 'bg-white dark:bg-slate-700 text-gray-700 dark:text-slate-200 border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-600'
          }`}>
          Walk-ins: {event.walk_in_enabled ? 'ON' : 'OFF'}
        </button>
      </div>
      {event.walk_in_enabled && !event.section_mode_enabled && (
        <div>
          <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Auto-assign walk-ins to table group</label>
          <select value={event.walk_in_table_group_id || ''} onChange={(e) => setGroup(e.target.value)}
            className="border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white">
            <option value="">— none (seat anywhere) —</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>
      )}

      {/* Section-based scanning: only useful with table groups to use as sections
          (e.g. men's / women's entrance). An admin assigns each staff member a
          section on the Event Team page; replaces the single walk-in group while on. */}
      {groups.length > 0 && (
        <div className="border-t border-gray-100 dark:border-slate-700/60 pt-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h3 className="font-semibold text-sm dark:text-white">Section scanning</h3>
              <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">
                Assign each staff member a section (table group) on the Event Team page. Walk-ins and
                ungrouped manual check-ins they handle are seated in their section.
              </p>
            </div>
            <button onClick={toggleSection} disabled={loading || (!event.section_mode_enabled && event.venue_access_enabled)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                event.section_mode_enabled
                  ? 'bg-teal-600 text-white border-teal-600 hover:bg-teal-700'
                  : 'bg-white dark:bg-slate-700 text-gray-700 dark:text-slate-200 border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-600'
              }`}>
              Sections: {event.section_mode_enabled ? 'ON' : 'OFF'}
            </button>
          </div>
          {!event.section_mode_enabled && event.venue_access_enabled && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
              Entry rules is on for this event. Turn it off first — Entry rules and Section
              scanning can’t run on the same event.
            </p>
          )}
          {event.section_mode_enabled && (
            <p className="text-xs text-teal-700 dark:text-teal-300 mt-2">
              Each staffer’s assigned section replaces the single walk-in group while this is on.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function ReserveSeatModal({ slot, guests, loading, query, onQuery, onPick, onAddVvip, onClose }) {
  const [mode, setMode] = useState('search') // 'search' | 'vvip'
  const [vvip, setVvip] = useState({ first_name: '', last_name: '', email: '', phone: '' })
  const q = (query || '').trim().toLowerCase()
  const matches = guests.filter((g) => {
    if (!q) return true
    return (`${g.first_name} ${g.last_name} ${g.email}`).toLowerCase().includes(q)
  })

  function submitVvip(e) {
    e.preventDefault()
    if (!vvip.first_name.trim() || !vvip.last_name.trim()) return
    onAddVvip({
      first_name: vvip.first_name.trim(),
      last_name:  vvip.last_name.trim(),
      email:      vvip.email.trim(),
      phone:      vvip.phone.trim() || null,
      is_vip:     true,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm"
      onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-slate-900 dark:border dark:border-slate-700 rounded-xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b dark:border-slate-700 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-slate-900 dark:text-white">Reserve seat</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              <strong>{slot.tableName}</strong> · Seat <strong>{slot.seat}</strong>
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 dark:hover:text-white text-2xl leading-none">×</button>
        </div>

        <div className="flex gap-1 px-4 pt-3 border-b dark:border-slate-700">
          <button onClick={() => setMode('search')}
            className={`px-3 py-2 text-xs font-bold border-b-2 -mb-px ${
              mode === 'search' ? 'border-teal-500 text-teal-700 dark:text-teal-300' : 'border-transparent text-slate-500 dark:text-slate-400'
            }`}>From guest list</button>
          <button onClick={() => setMode('vvip')}
            className={`px-3 py-2 text-xs font-bold border-b-2 -mb-px ${
              mode === 'vvip' ? 'border-purple-500 text-purple-700 dark:text-purple-300' : 'border-transparent text-slate-500 dark:text-slate-400'
            }`}>+ Add VVIP</button>
        </div>

        {mode === 'search' && <>
          <div className="p-4">
            <input
              autoFocus
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder="Search by name or email…"
              className="w-full border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
            />
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 border-t dark:border-slate-700">
            {matches.length === 0 && (
              <div className="p-6 text-center text-sm text-slate-400 dark:text-slate-500 italic">
                No guests match. Use <button onClick={() => setMode('vvip')} className="text-purple-600 hover:underline font-semibold">+ Add VVIP</button> instead.
              </div>
            )}
            {matches.map((g) => {
              const alreadyAssigned = g.table_id != null
              return (
                <button key={g.id}
                  onClick={() => onPick(g.id)}
                  disabled={loading}
                  className="w-full px-4 py-2.5 text-left hover:bg-teal-50 dark:hover:bg-teal-900/20 disabled:opacity-50 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                      {g.first_name} {g.last_name}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{g.email || <em>no email</em>}</div>
                  </div>
                  {alreadyAssigned ? (
                    <span className="text-[10px] uppercase font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 px-2 py-0.5 rounded-full">
                      move from seat {g.seat_number ?? '–'}
                    </span>
                  ) : g.admitted ? (
                    <span className="text-[10px] uppercase font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 px-2 py-0.5 rounded-full">
                      arrived
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
        </>}

        {mode === 'vvip' && (
          <form onSubmit={submitVvip} className="p-4 space-y-3 overflow-y-auto">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Add someone who isn't on the imported guest list. Email is optional — no invite will be sent.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <input autoFocus required value={vvip.first_name} onChange={(e) => setVvip((v) => ({ ...v, first_name: e.target.value }))}
                placeholder="First name *"
                className="border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
              <input required value={vvip.last_name} onChange={(e) => setVvip((v) => ({ ...v, last_name: e.target.value }))}
                placeholder="Last name *"
                className="border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
            </div>
            <input type="email" value={vvip.email} onChange={(e) => setVvip((v) => ({ ...v, email: e.target.value }))}
              placeholder="Email (optional)"
              className="w-full border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
            <input value={vvip.phone} onChange={(e) => setVvip((v) => ({ ...v, phone: e.target.value }))}
              placeholder="Phone E.164 (optional, e.g. +447911123456)"
              className="w-full border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
            <button type="submit" disabled={loading || !vvip.first_name.trim() || !vvip.last_name.trim()}
              className="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold py-2.5 rounded-lg disabled:opacity-50">
              {loading ? 'Saving…' : `Reserve ${slot.tableName} · Seat ${slot.seat}`}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

// ── Menu Panel ────────────────────────────────────────────────────────────────

const SELECTION_TYPES = [
  { value: 'single', label: 'Single (pick 1)' },
  { value: 'multi',  label: 'Multi (pick several)' },
  { value: 'combo',  label: 'Combo (preset sets)' },
]

function CombinationsSection({ eventId, cat, loading, setLoading, onCatsChange, setMsg }) {
  const [form, setForm] = useState(null)

  const fieldCls = 'border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white'
  const combos = cat.combinations || []

  function openNew() {
    setForm({
      name: '',
      description: '',
      sort_order: combos.length,
      items: Object.fromEntries(cat.items.map((i) => [i.id, { checked: false, quantity: 1 }])),
    })
  }

  function openEdit(c) {
    const items = Object.fromEntries(cat.items.map((i) => [i.id, { checked: false, quantity: 1 }]))
    for (const ci of c.items || []) {
      items[ci.menu_item_id] = { checked: true, quantity: ci.quantity || 1 }
    }
    setForm({ id: c.id, name: c.name, description: c.description || '', sort_order: c.sort_order ?? 0, items })
  }

  async function save(e) {
    e.preventDefault()
    const items = Object.entries(form.items)
      .filter(([, v]) => v.checked)
      .map(([menu_item_id, v]) => ({ menu_item_id, quantity: Number(v.quantity) || 1 }))
    if (items.length === 0) {
      setMsg('Pick at least one item for the combination.')
      return
    }
    setLoading(true)
    try {
      const payload = {
        name: form.name,
        description: form.description || '',
        sort_order: Number(form.sort_order) || 0,
        items,
      }
      if (form.id) {
        const updated = await api.updateCombination(eventId, form.id, payload)
        onCatsChange((prev) => prev.map((c) =>
          c.id === cat.id
            ? { ...c, combinations: (c.combinations || []).map((x) => x.id === form.id ? updated : x) }
            : c
        ))
      } else {
        const created = await api.createCombination(eventId, cat.id, payload)
        onCatsChange((prev) => prev.map((c) =>
          c.id === cat.id
            ? { ...c, combinations: [...(c.combinations || []), created] }
            : c
        ))
      }
      setForm(null)
    } catch (err) { setMsg(err.message) }
    finally { setLoading(false) }
  }

  async function remove(comboId) {
    if (!confirm('Delete this combination?')) return
    setLoading(true)
    try {
      await api.deleteCombination(eventId, comboId)
      onCatsChange((prev) => prev.map((c) =>
        c.id === cat.id
          ? { ...c, combinations: (c.combinations || []).filter((x) => x.id !== comboId) }
          : c
      ))
    } catch (err) { setMsg(err.message) }
    finally { setLoading(false) }
  }

  const itemName = (id) => cat.items.find((i) => i.id === id)?.name || '—'

  return (
    <div className="px-4 py-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">Combinations</div>
        <button
          type="button"
          onClick={openNew}
          disabled={loading || cat.items.length === 0}
          className="text-xs text-green-600 hover:underline font-semibold disabled:opacity-40"
        >
          + Add combination
        </button>
      </div>

      {cat.items.length === 0 && (
        <p className="text-xs text-gray-400 dark:text-slate-500 italic">
          Add items to this category first (use the items list above… or temporarily switch type to Single).
        </p>
      )}

      {combos.length === 0 && cat.items.length > 0 && !form && (
        <p className="text-xs text-gray-400 dark:text-slate-500 italic">No combinations yet.</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {combos.map((c) => (
          <div key={c.id} className="border dark:border-slate-700 rounded-lg p-3 bg-white dark:bg-slate-800">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold dark:text-slate-100 truncate">{c.name}</div>
                {c.description && (
                  <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{c.description}</div>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                <button type="button" onClick={() => openEdit(c)}
                  className="text-xs text-indigo-600 hover:underline">Edit</button>
                <button type="button" onClick={() => remove(c.id)} disabled={loading}
                  className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40">Delete</button>
              </div>
            </div>
            <ul className="mt-2 space-y-0.5">
              {(c.items || []).map((ci, idx) => (
                <li key={idx} className="text-xs text-gray-600 dark:text-slate-300 flex justify-between gap-2">
                  <span className="truncate">{itemName(ci.menu_item_id)}</span>
                  <span className="text-gray-400 dark:text-slate-500 shrink-0">× {ci.quantity}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {form && (
        <form onSubmit={save} className="bg-gray-50 dark:bg-slate-700/50 border dark:border-slate-600 rounded-lg p-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Name</label>
              <input value={form.name} required onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className={fieldCls} placeholder="VIP Package" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Sort Order</label>
              <input type="number" value={form.sort_order}
                onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))}
                className={`${fieldCls} w-24`} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Description</label>
            <input value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className={fieldCls} placeholder="Optional" />
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Items in this combo</div>
            <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {cat.items.map((it) => {
                const row = form.items[it.id] || { checked: false, quantity: 1 }
                return (
                  <div key={it.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={row.checked}
                      onChange={(e) => setForm((f) => ({
                        ...f,
                        items: { ...f.items, [it.id]: { ...row, checked: e.target.checked } },
                      }))}
                      className="cursor-pointer"
                    />
                    <span className="text-sm dark:text-slate-200 flex-1 truncate">{it.name}</span>
                    <input
                      type="number"
                      min={1}
                      value={row.quantity}
                      disabled={!row.checked}
                      onChange={(e) => setForm((f) => ({
                        ...f,
                        items: { ...f.items, [it.id]: { ...row, quantity: e.target.value } },
                      }))}
                      className={`${fieldCls} w-20 disabled:opacity-40`}
                    />
                  </div>
                )
              })}
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={loading}
              className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
              {form.id ? 'Save' : 'Add'}
            </button>
            <button type="button" onClick={() => setForm(null)}
              className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-sm dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-600">
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

// ── Logistics Panel ───────────────────────────────────────────────────────────

const SHIP_STATUS = ['pending', 'shipped', 'delivered']

function LogisticsPanel({ eventId, event }) {
  const [shipments, setShipments] = useState([])
  const [form, setForm]           = useState(null)   // create/edit shipment form
  const [activeId, setActiveId]   = useState(null)   // shipment whose lines are shown
  const [lines, setLines]         = useState([])
  const [rowEdit, setRowEdit]     = useState({})     // guest_id -> editable buffer
  const [pickerOpen, setPickerOpen] = useState(false)
  const [allGuests, setAllGuests] = useState([])
  const [guestQuery, setGuestQuery] = useState('')
  const [loading, setLoading]     = useState(false)
  const [msg, setMsg]             = useState('')

  const fieldCls = 'border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white'

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 4000) }

  function load() {
    api.listShipments(eventId).then(setShipments).catch((e) => setMsg(e.message))
  }
  useEffect(() => { load() }, [eventId])

  async function loadLines(sid) {
    setLoading(true)
    try {
      const data = await api.listShipmentLines(eventId, sid)
      setLines(data); setActiveId(sid); setRowEdit({})
    } catch (e) { setMsg(e.message) } finally { setLoading(false) }
  }

  async function saveShipment(e) {
    e.preventDefault()
    setLoading(true)
    try {
      const payload = {
        name: form.name,
        phase: form.phase,
        collect_size: form.collect_size,
        auto_add: form.auto_add,
        size_options: (form.size_options || '').split(',').map((s) => s.trim()).filter(Boolean),
        notes: form.notes || null,
        vendor_name: form.vendor_name || null,
        vendor_email: form.vendor_email || null,
        vendor_phone: form.vendor_phone || null,
      }
      if (form.id) await api.updateShipment(eventId, form.id, payload)
      else await api.createShipment(eventId, payload)
      setForm(null); load()
    } catch (e) { setMsg(e.message) } finally { setLoading(false) }
  }

  async function removeShipment(sid) {
    if (!confirm('Delete this shipment and all its guest lines?')) return
    setLoading(true)
    try {
      await api.deleteShipment(eventId, sid)
      if (activeId === sid) { setActiveId(null); setLines([]) }
      load()
    } catch (e) { setMsg(e.message) } finally { setLoading(false) }
  }

  async function populate(sid) {
    setLoading(true)
    try {
      const res = await api.populateShipment(eventId, sid)
      flash(`Added ${res.added} confirmed guest(s).`)
      await loadLines(sid); load()
    } catch (e) { setMsg(e.message) } finally { setLoading(false) }
  }

  async function openPicker() {
    try {
      const gs = await api.listGuests(eventId)
      setAllGuests(gs); setGuestQuery(''); setPickerOpen(true)
    } catch (e) { setMsg(e.message) }
  }

  async function addGuest(gid) {
    try {
      await api.addShipmentGuest(eventId, activeId, gid)
      await loadLines(activeId); load()
    } catch (e) { setMsg(e.message) }
  }

  async function removeGuest(gid) {
    if (!confirm('Remove this guest from the shipment?')) return
    setLoading(true)
    try {
      await api.removeShipmentGuest(eventId, activeId, gid)
      await loadLines(activeId); load()
    } catch (e) { setMsg(e.message) } finally { setLoading(false) }
  }

  async function sendToVendor(s) {
    if (!s.vendor_email) { setMsg('Add a vendor email to this shipment first (Edit).'); return }
    if (!confirm(`Email the shipping list to ${s.vendor_email}?`)) return
    setLoading(true)
    try {
      await api.sendShipmentToVendor(eventId, s.id)
      flash(`Sent to ${s.vendor_email}.`); load()
    } catch (e) { setMsg(e.message) } finally { setLoading(false) }
  }

  function copyVendorLink(s) {
    const url = `${publicBaseUrl(event)}/vendor/${s.share_token}`
    navigator.clipboard?.writeText(url)
    flash('Vendor link copied to clipboard.')
  }

  async function saveRow(gid) {
    const buf = rowEdit[gid]
    if (!buf) return
    setLoading(true)
    try {
      await api.updateShipmentLine(eventId, activeId, gid, {
        item: buf.item || null,
        size: buf.size ?? null,
        quantity: Number(buf.quantity) || 1,
        ship_status: buf.ship_status,
        tracking_number: buf.tracking_number || null,
      })
      await api.updateGuestShipping(eventId, gid, {
        ship_address1: buf.ship_address1 || null,
        ship_address2: buf.ship_address2 || null,
        ship_city: buf.ship_city || null,
        ship_state: buf.ship_state || null,
        ship_postal: buf.ship_postal || null,
        ship_country: buf.ship_country || null,
      })
      setRowEdit((p) => { const n = { ...p }; delete n[gid]; return n })
      await loadLines(activeId)
      flash('Saved.')
    } catch (e) { setMsg(e.message) } finally { setLoading(false) }
  }

  const editRow = (ln) => setRowEdit((p) => ({ ...p, [ln.guest_id]: { ...ln } }))
  const setBuf = (gid, k, v) => setRowEdit((p) => ({ ...p, [gid]: { ...p[gid], [k]: v } }))
  const addrText = (ln) => [ln.ship_address1, ln.ship_address2, ln.ship_city, ln.ship_state, ln.ship_postal, ln.ship_country].filter(Boolean).join(', ')

  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-semibold text-base dark:text-white">📦 Deliveries</h2>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
            Collect shipping addresses and sizes on the RSVP form, then send a packing list to your vendor.
          </p>
        </div>
        <button onClick={() => setForm({ name: '', phase: 'pre', collect_size: true, auto_add: true, size_options: 'S, M, L, XL, 2XL', notes: '', vendor_name: '', vendor_email: '', vendor_phone: '' })}
          disabled={loading}
          className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50">
          + New shipment
        </button>
      </div>

      {shipments.length === 0 && !form && (
        <p className="text-sm text-gray-400 dark:text-slate-500">No shipments yet. Create one for pre-event merchandise (e.g. aso-ebi) or a post-event gift.</p>
      )}

      {/* Shipment cards */}
      <div className="space-y-3">
        {shipments.map((s) => (
          <div key={s.id} className="border dark:border-slate-700 rounded-lg p-3">
            <div className="flex items-start justify-between flex-wrap gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm dark:text-white">{s.name}</span>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${s.phase === 'post' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' : 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300'}`}>
                    {s.phase === 'post' ? 'Post-event' : 'Pre-event'}
                  </span>
                  <span className="text-xs text-gray-500 dark:text-slate-400">{s.line_count} guest(s)</span>
                </div>
                <div className="text-xs text-gray-400 dark:text-slate-500 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                  {s.vendor_email ? <span>Vendor: {s.vendor_email}</span> : <span className="text-amber-500">No vendor email set</span>}
                  {s.sent_at && <span className="text-green-600">✓ Sent {new Date(s.sent_at).toLocaleDateString()}</span>}
                  {s.viewed_at && <span className="text-blue-500">👁 Viewed {new Date(s.viewed_at).toLocaleDateString()}</span>}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <button onClick={() => (activeId === s.id ? (setActiveId(null), setLines([])) : loadLines(s.id))}
                  className="text-indigo-600 dark:text-indigo-400 hover:underline">{activeId === s.id ? 'Hide list' : 'Manage list'}</button>
                <button onClick={() => api.downloadShipmentXlsx(eventId, s.id, `${s.name}.xlsx`).catch((e) => setMsg(e.message))}
                  className="text-teal-600 hover:underline">Download Excel</button>
                <button onClick={() => copyVendorLink(s)} className="text-slate-500 hover:underline">Copy vendor link</button>
                <button onClick={() => sendToVendor(s)} className="text-blue-600 hover:underline">Send to vendor</button>
                <button onClick={() => setForm({ id: s.id, name: s.name, phase: s.phase, collect_size: s.collect_size, auto_add: s.auto_add, size_options: (s.size_options || []).join(', '), notes: s.notes || '', vendor_name: s.vendor_name || '', vendor_email: s.vendor_email || '', vendor_phone: s.vendor_phone || '' })}
                  className="text-gray-500 hover:underline">Edit</button>
                <button onClick={() => removeShipment(s.id)} className="text-red-400 hover:text-red-600">Delete</button>
              </div>
            </div>

            {/* Per-guest lines */}
            {activeId === s.id && (
              <div className="mt-3 border-t dark:border-slate-700 pt-3">
                <div className="flex justify-between items-center mb-2 flex-wrap gap-2">
                  <span className="text-xs font-semibold text-gray-500 dark:text-slate-400">Recipients</span>
                  <div className="flex gap-2">
                    <button onClick={openPicker} disabled={loading}
                      className="text-xs bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 px-2 py-1 rounded hover:bg-indigo-200 dark:hover:bg-indigo-900/60">+ Add guest</button>
                    <button onClick={() => populate(s.id)} disabled={loading}
                      className="text-xs bg-slate-100 dark:bg-slate-700 px-2 py-1 rounded hover:bg-slate-200 dark:hover:bg-slate-600 dark:text-slate-200">+ Add all confirmed</button>
                  </div>
                </div>
                {lines.length === 0 ? (
                  <p className="text-xs text-gray-400 dark:text-slate-500">No recipients yet. Use "+ Add guest" to hand-pick, "+ Add all confirmed" for everyone{s.auto_add ? ', or they appear automatically when guests RSVP with an address.' : '.'}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-gray-500 dark:text-slate-400 text-left">
                        <tr><th className="py-1 pr-2">Guest</th><th className="py-1 pr-2">Address</th><th className="py-1 pr-2">Item</th><th className="py-1 pr-2">Size</th><th className="py-1 pr-2">Qty</th><th className="py-1 pr-2">Status</th><th className="py-1 pr-2">Tracking</th><th></th></tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-slate-700 align-top">
                        {lines.map((ln) => {
                          const buf = rowEdit[ln.guest_id]
                          return (
                            <tr key={ln.guest_id}>
                              <td className="py-1.5 pr-2 dark:text-slate-200 whitespace-nowrap">{ln.first_name} {ln.last_name}</td>
                              {buf ? (
                                <>
                                  <td className="py-1.5 pr-2 space-y-1">
                                    <input className={`${fieldCls} w-full py-1`} placeholder="Address" value={buf.ship_address1 || ''} onChange={(e) => setBuf(ln.guest_id, 'ship_address1', e.target.value)} />
                                    <div className="flex gap-1">
                                      <input className={`${fieldCls} w-1/2 py-1`} placeholder="City" value={buf.ship_city || ''} onChange={(e) => setBuf(ln.guest_id, 'ship_city', e.target.value)} />
                                      <input className={`${fieldCls} w-1/2 py-1`} placeholder="State" value={buf.ship_state || ''} onChange={(e) => setBuf(ln.guest_id, 'ship_state', e.target.value)} />
                                    </div>
                                    <div className="flex gap-1">
                                      <input className={`${fieldCls} w-1/2 py-1`} placeholder="Postal" value={buf.ship_postal || ''} onChange={(e) => setBuf(ln.guest_id, 'ship_postal', e.target.value)} />
                                      <input className={`${fieldCls} w-1/2 py-1`} placeholder="Country" value={buf.ship_country || ''} onChange={(e) => setBuf(ln.guest_id, 'ship_country', e.target.value)} />
                                    </div>
                                  </td>
                                  <td className="py-1.5 pr-2"><input className={`${fieldCls} w-28 py-1`} placeholder={s.name} value={buf.item || ''} onChange={(e) => setBuf(ln.guest_id, 'item', e.target.value)} /></td>
                                  <td className="py-1.5 pr-2"><input className={`${fieldCls} w-16 py-1`} value={buf.size || ''} onChange={(e) => setBuf(ln.guest_id, 'size', e.target.value)} /></td>
                                  <td className="py-1.5 pr-2"><input type="number" min="1" className={`${fieldCls} w-14 py-1`} value={buf.quantity || 1} onChange={(e) => setBuf(ln.guest_id, 'quantity', e.target.value)} /></td>
                                  <td className="py-1.5 pr-2">
                                    <select className={`${fieldCls} py-1`} value={buf.ship_status} onChange={(e) => setBuf(ln.guest_id, 'ship_status', e.target.value)}>
                                      {SHIP_STATUS.map((st) => <option key={st} value={st}>{st}</option>)}
                                    </select>
                                  </td>
                                  <td className="py-1.5 pr-2"><input className={`${fieldCls} w-28 py-1`} value={buf.tracking_number || ''} onChange={(e) => setBuf(ln.guest_id, 'tracking_number', e.target.value)} /></td>
                                  <td className="py-1.5 whitespace-nowrap">
                                    <button onClick={() => saveRow(ln.guest_id)} className="text-green-600 hover:underline mr-2">Save</button>
                                    <button onClick={() => setRowEdit((p) => { const n = { ...p }; delete n[ln.guest_id]; return n })} className="text-gray-400 hover:underline">Cancel</button>
                                  </td>
                                </>
                              ) : (
                                <>
                                  <td className={`py-1.5 pr-2 max-w-xs ${ln.has_address ? 'dark:text-slate-300' : 'text-amber-500 italic'}`}>{ln.has_address ? addrText(ln) : 'No address yet'}</td>
                                  <td className={`py-1.5 pr-2 ${ln.item ? 'dark:text-slate-300' : 'text-gray-400 dark:text-slate-500'}`}>{ln.item || s.name}</td>
                                  <td className="py-1.5 pr-2 dark:text-slate-300">{ln.size || '—'}</td>
                                  <td className="py-1.5 pr-2 dark:text-slate-300">{ln.quantity}</td>
                                  <td className="py-1.5 pr-2">
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${ln.ship_status === 'delivered' ? 'bg-green-100 text-green-700' : ln.ship_status === 'shipped' ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-600 dark:bg-slate-600 dark:text-slate-200'}`}>{ln.ship_status}</span>
                                  </td>
                                  <td className="py-1.5 pr-2 dark:text-slate-300">{ln.tracking_number || '—'}</td>
                                  <td className="py-1.5 whitespace-nowrap">
                                    <button onClick={() => editRow(ln)} className="text-indigo-600 dark:text-indigo-400 hover:underline mr-2">Edit</button>
                                    <button onClick={() => removeGuest(ln.guest_id)} className="text-red-400 hover:text-red-600">Remove</button>
                                  </td>
                                </>
                              )}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Create / edit shipment form */}
      {form && (
        <form onSubmit={saveShipment} className="bg-gray-50 dark:bg-slate-700/50 border dark:border-slate-600 rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Shipment name *</label>
              <input className={`${fieldCls} w-full`} required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Aso-Ebi Cloth / Thank-you Gift" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">When</label>
              <select className={`${fieldCls} w-full`} value={form.phase} onChange={(e) => setForm((f) => ({ ...f, phase: e.target.value }))}>
                <option value="pre">Pre-event (collect on RSVP)</option>
                <option value="post">Post-event (gift after)</option>
              </select>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <label className="flex items-center gap-2 text-xs font-semibold text-gray-600 dark:text-slate-300">
              <input type="checkbox" checked={form.collect_size} onChange={(e) => setForm((f) => ({ ...f, collect_size: e.target.checked }))} />
              Ask guests for a size
            </label>
            <label className="flex items-center gap-2 text-xs font-semibold text-gray-600 dark:text-slate-300">
              <input type="checkbox" checked={form.auto_add} onChange={(e) => setForm((f) => ({ ...f, auto_add: e.target.checked }))} />
              Auto-add guests who RSVP
              <span className="font-normal text-gray-400 dark:text-slate-500">(off = hand-pick the list)</span>
            </label>
          </div>
          {form.collect_size && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Size options (comma-separated)</label>
              <input className={`${fieldCls} w-full`} value={form.size_options} onChange={(e) => setForm((f) => ({ ...f, size_options: e.target.value }))} placeholder="S, M, L, XL, 2XL" />
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Vendor name</label>
              <input className={`${fieldCls} w-full`} value={form.vendor_name} onChange={(e) => setForm((f) => ({ ...f, vendor_name: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Vendor email</label>
              <input type="email" className={`${fieldCls} w-full`} value={form.vendor_email} onChange={(e) => setForm((f) => ({ ...f, vendor_email: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Vendor phone</label>
              <input className={`${fieldCls} w-full`} value={form.vendor_phone} onChange={(e) => setForm((f) => ({ ...f, vendor_phone: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Notes for vendor</label>
            <textarea className={`${fieldCls} w-full`} rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Delivery instructions, deadlines, etc." />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={loading} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">{form.id ? 'Save' : 'Create'}</button>
            <button type="button" onClick={() => setForm(null)} className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-sm dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-600">Cancel</button>
          </div>
        </form>
      )}

      {msg && <p className="text-sm text-indigo-600 dark:text-indigo-400">{msg}</p>}

      {/* Add-guest picker */}
      {pickerOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setPickerOpen(false)}>
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl w-full max-w-md max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b dark:border-slate-700">
              <div className="flex justify-between items-center mb-2">
                <h3 className="font-semibold text-sm dark:text-white">Add a guest to this shipment</h3>
                <button onClick={() => setPickerOpen(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
              </div>
              <input autoFocus className={`${fieldCls} w-full`} placeholder="Search guests…" value={guestQuery} onChange={(e) => setGuestQuery(e.target.value)} />
            </div>
            <div className="overflow-y-auto p-2">
              {(() => {
                const onList = new Set(lines.map((l) => l.guest_id))
                const q = guestQuery.trim().toLowerCase()
                const available = allGuests.filter((g) => !onList.has(g.id) &&
                  (!q || `${g.first_name} ${g.last_name} ${g.email || ''}`.toLowerCase().includes(q)))
                if (available.length === 0) return <p className="text-xs text-gray-400 p-3">No matching guests (everyone may already be on the list).</p>
                return available.slice(0, 100).map((g) => (
                  <button key={g.id} onClick={() => addGuest(g.id)}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-indigo-50 dark:hover:bg-slate-700 flex justify-between items-center">
                    <span className="text-sm dark:text-slate-200">{g.first_name} {g.last_name}</span>
                    <span className="text-xs text-gray-400">{g.email || g.phone || ''}</span>
                  </button>
                ))
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Registry Panel ────────────────────────────────────────────────────────────

// Reuses the existing module-level `fmtMoney(minorAmount, currency)` (hoisted).
const toMinor = (major) => {
  const n = parseFloat(major)
  return Number.isFinite(n) ? Math.round(n * 100) : null
}

const REGISTRY_KINDS = [
  { value: 'item', label: 'Gift item' },
  { value: 'fund', label: 'Cash fund' },
  { value: 'link', label: 'External registry link' },
]

function RegistryPanel({ eventId, event }) {
  const [items, setItems]     = useState([])
  const [claims, setClaims]   = useState([])
  const [showClaims, setShowClaims] = useState(false)
  const [form, setForm]       = useState(null)
  const [message, setMessage] = useState(event?.registry_message || '')
  const [token, setToken]     = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg]         = useState('')

  const fieldCls = 'border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white'
  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 4000) }

  function load() {
    api.listRegistryItems(eventId).then(setItems).catch((e) => setMsg(e.message))
  }
  useEffect(() => {
    load()
    api.getRegistrySettings(eventId)
      .then((s) => { setToken(s.registry_token || ''); if (s.registry_message != null) setMessage(s.registry_message) })
      .catch((e) => setMsg(e.message))
  }, [eventId])

  async function saveMessage() {
    try {
      await api.updateRegistrySettings(eventId, { registry_message: message })
      flash('Intro message saved.')
    } catch (e) { setMsg(e.message) }
  }

  async function sendGiftList() {
    if (!registryUrl) return flash('Preparing link...')
    if (!confirm('Send the gift list link to confirmed guests by email, SMS, and WhatsApp?')) return
    setLoading(true)
    try {
      await api.updateRegistrySettings(eventId, { registry_message: message })
      const res = await api.sendRegistryMessage(eventId, ['email', 'sms', 'whatsapp'])
      flash(`Gift list queued for ${res.queued} guest(s).`)
    } catch (e) { setMsg(e.message) } finally { setLoading(false) }
  }

  async function fetchDetails() {
    if (!form.external_url) { setMsg('Paste a product link first.'); return }
    setLoading(true)
    try {
      const d = await api.unfurlRegistryLink(eventId, form.external_url)
      setForm((f) => ({
        ...f,
        title: f.title || d.title || '',
        image_url: f.image_url || d.image_url || '',
        amountMajor: f.amountMajor || (d.amount_minor != null ? String(d.amount_minor / 100) : ''),
        currency: d.currency || f.currency,
      }))
      const nothing = !d.title && !d.image_url && d.amount_minor == null
      flash(nothing ? 'No details found — please fill them in manually.' : 'Details fetched — review and edit as needed.')
    } catch (e) { setMsg(e.message) } finally { setLoading(false) }
  }

  async function saveItem(e) {
    e.preventDefault()
    setLoading(true)
    try {
      const payload = {
        kind: form.kind,
        title: form.title,
        description: form.description || null,
        image_url: form.image_url || null,
        external_url: form.external_url || null,
        amount_minor: form.amountMajor ? toMinor(form.amountMajor) : null,
        currency: form.currency || 'USD',
        quantity_wanted: Number(form.quantity_wanted) || 1,
        payment_instructions: form.payment_instructions || null,
      }
      if (form.id) await api.updateRegistryItem(eventId, form.id, payload)
      else await api.createRegistryItem(eventId, payload)
      setForm(null); load()
    } catch (e) { setMsg(e.message) } finally { setLoading(false) }
  }

  async function removeItem(id) {
    if (!confirm('Delete this registry entry?')) return
    setLoading(true)
    try { await api.deleteRegistryItem(eventId, id); load() }
    catch (e) { setMsg(e.message) } finally { setLoading(false) }
  }

  async function loadClaims() {
    try { setClaims(await api.listRegistryClaims(eventId)); setShowClaims(true) }
    catch (e) { setMsg(e.message) }
  }

  const openNew = () => setForm({ kind: 'item', title: '', description: '', image_url: '', external_url: '', amountMajor: '', currency: 'USD', quantity_wanted: 1, payment_instructions: '' })
  const openEdit = (it) => setForm({
    id: it.id, kind: it.kind, title: it.title, description: it.description || '',
    image_url: it.image_url || '', external_url: it.external_url || '',
    amountMajor: it.amount_minor != null ? String(it.amount_minor / 100) : '',
    currency: it.currency || 'USD', quantity_wanted: it.quantity_wanted || 1,
    payment_instructions: it.payment_instructions || '',
  })

  const registryUrl = token ? `${publicBaseUrl(event)}/registry/${token}` : ''

  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-semibold text-base dark:text-white">🎁 Gift list</h2>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">Mark-only — guests buy from your links or send cash to your own details. No money passes through Festio.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { if (!registryUrl) return flash('Preparing link...'); navigator.clipboard?.writeText(registryUrl); flash('Gift list link copied.') }}
            className="text-xs border border-gray-300 dark:border-slate-600 px-3 py-1.5 rounded-lg dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700">Copy registry link</button>
          <button onClick={sendGiftList} disabled={loading}
            className="text-xs border border-indigo-300 dark:border-indigo-700 px-3 py-1.5 rounded-lg text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-slate-700 disabled:opacity-50">Send to guests</button>
          <button onClick={() => (showClaims ? setShowClaims(false) : loadClaims())}
            className="text-xs border border-gray-300 dark:border-slate-600 px-3 py-1.5 rounded-lg dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700">{showClaims ? 'Hide claims' : 'Claims & pledges'}</button>
          <button onClick={openNew} className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-indigo-700">+ Add entry</button>
        </div>
      </div>

      {/* Intro message */}
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Intro message (shown atop your registry)</label>
          <input className={`${fieldCls} w-full`} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Your presence is the greatest gift — but if you'd like to give…" />
        </div>
        <button onClick={saveMessage} className="text-xs bg-slate-100 dark:bg-slate-700 px-3 py-2 rounded-lg dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600">Save</button>
      </div>

      {/* Claims view */}
      {showClaims && (
        <div className="border dark:border-slate-700 rounded-lg p-3">
          <div className="text-xs font-semibold text-gray-500 dark:text-slate-400 mb-2">Who's giving what</div>
          {claims.length === 0 ? <p className="text-xs text-gray-400">No reservations or pledges yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-gray-500 dark:text-slate-400 text-left"><tr><th className="py-1 pr-2">Guest</th><th className="py-1 pr-2">Gift</th><th className="py-1 pr-2">Qty / Amount</th><th className="py-1 pr-2">Message</th></tr></thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                  {claims.map((c) => (
                    <tr key={c.id}>
                      <td className="py-1.5 pr-2 dark:text-slate-200">{c.claimer_name}{c.claimer_email ? <span className="text-gray-400"> · {c.claimer_email}</span> : ''}</td>
                      <td className="py-1.5 pr-2 dark:text-slate-300">{c.item_title}</td>
                      <td className="py-1.5 pr-2 dark:text-slate-300">{c.amount_minor != null ? (c.amount_minor / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : `×${c.quantity}`}</td>
                      <td className="py-1.5 pr-2 text-gray-500 dark:text-slate-400 max-w-xs truncate">{c.message || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Entries */}
      {items.length === 0 && !form ? (
        <p className="text-sm text-gray-400 dark:text-slate-500">No registry entries yet. Add a gift item, a cash fund, or a link to an external registry (Amazon, Jumia…).</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {items.map((it) => (
            <div key={it.id} className="border dark:border-slate-700 rounded-lg p-3 flex gap-3">
              {it.image_url && <img src={it.image_url} alt="" className="w-14 h-14 rounded object-cover shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 dark:bg-slate-600 dark:text-slate-200">{REGISTRY_KINDS.find((k) => k.value === it.kind)?.label || it.kind}</span>
                  {!it.is_active && <span className="text-[10px] text-amber-500">hidden</span>}
                </div>
                <div className="font-semibold text-sm dark:text-white truncate mt-1">{it.title}</div>
                {it.kind === 'item' && (
                  <div className="text-xs text-gray-500 dark:text-slate-400">
                    {it.amount_minor != null && <span>{fmtMoney(it.amount_minor, it.currency)} · </span>}
                    Reserved {it.reserved_qty}/{it.quantity_wanted}
                  </div>
                )}
                {it.kind === 'fund' && (
                  <div className="text-xs text-gray-500 dark:text-slate-400">
                    Raised {fmtMoney(it.raised_minor, it.currency)}{it.amount_minor != null && ` of ${fmtMoney(it.amount_minor, it.currency)}`} · {it.claim_count} pledge(s)
                  </div>
                )}
                {it.kind === 'link' && it.external_url && <div className="text-xs text-indigo-500 truncate">{it.external_url}</div>}
                <div className="flex gap-3 mt-1.5 text-xs">
                  <button onClick={() => openEdit(it)} className="text-indigo-600 dark:text-indigo-400 hover:underline">Edit</button>
                  <button onClick={() => removeItem(it.id)} className="text-red-400 hover:text-red-600">Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / edit entry form */}
      {form && (
        <form onSubmit={saveItem} className="bg-gray-50 dark:bg-slate-700/50 border dark:border-slate-600 rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Type</label>
              <select className={`${fieldCls} w-full`} value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}>
                {REGISTRY_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Title *</label>
              <input className={`${fieldCls} w-full`} required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder={form.kind === 'fund' ? 'Honeymoon Fund' : form.kind === 'link' ? 'Our Amazon registry' : 'KitchenAid Mixer'} />
            </div>
          </div>

          {form.kind === 'item' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Price</label>
                  <div className="flex gap-1">
                    <select className={`${fieldCls} w-20`} value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}>
                      <option value="USD">USD</option><option value="NGN">NGN</option>
                    </select>
                    <input className={`${fieldCls} w-full`} type="number" step="0.01" value={form.amountMajor} onChange={(e) => setForm((f) => ({ ...f, amountMajor: e.target.value }))} placeholder="0.00" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Quantity wanted</label>
                  <input className={`${fieldCls} w-full`} type="number" min="1" value={form.quantity_wanted} onChange={(e) => setForm((f) => ({ ...f, quantity_wanted: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Image URL</label>
                  <input className={`${fieldCls} w-full`} value={form.image_url} onChange={(e) => setForm((f) => ({ ...f, image_url: e.target.value }))} placeholder="https://…" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Store / buy link</label>
                <div className="flex gap-2">
                  <input className={`${fieldCls} w-full`} value={form.external_url} onChange={(e) => setForm((f) => ({ ...f, external_url: e.target.value }))} placeholder="https://www.amazon.com/… or any store" />
                  <button type="button" onClick={fetchDetails} disabled={loading}
                    className="shrink-0 text-xs bg-slate-100 dark:bg-slate-700 px-3 rounded-lg dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50">Fetch details</button>
                </div>
                <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-1">Paste a link from any store and Fetch details to auto-fill — best-effort, edit anything that looks off.</p>
              </div>
            </>
          )}

          {form.kind === 'fund' && (
            <>
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Target amount (optional)</label>
                <div className="flex gap-1 max-w-xs">
                  <select className={`${fieldCls} w-20`} value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}>
                    <option value="USD">USD</option><option value="NGN">NGN</option>
                  </select>
                  <input className={`${fieldCls} w-full`} type="number" step="0.01" value={form.amountMajor} onChange={(e) => setForm((f) => ({ ...f, amountMajor: e.target.value }))} placeholder="0.00" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">How to send money *</label>
                <textarea className={`${fieldCls} w-full`} rows={2} value={form.payment_instructions} onChange={(e) => setForm((f) => ({ ...f, payment_instructions: e.target.value }))} placeholder="Bank: GTBank 0123456789 (Jane Doe) · or Paystack/PayPal link" />
              </div>
            </>
          )}

          {form.kind === 'link' && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Gift link *</label>
              <input className={`${fieldCls} w-full`} value={form.external_url} onChange={(e) => setForm((f) => ({ ...f, external_url: e.target.value }))} placeholder="https://www.amazon.com/wedding/registry/…" />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Description (optional)</label>
            <input className={`${fieldCls} w-full`} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>

          <div className="flex gap-2">
            <button type="submit" disabled={loading} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">{form.id ? 'Save' : 'Add'}</button>
            <button type="button" onClick={() => setForm(null)} className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-sm dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-600">Cancel</button>
          </div>
        </form>
      )}

      {msg && <p className="text-sm text-indigo-600 dark:text-indigo-400">{msg}</p>}
    </div>
  )
}

// ── Venue Access Panel ────────────────────────────────────────────────────────

const DIRECTION_MODES = [
  { value: 'both', label: 'Entry & Exit' },
  { value: 'entry', label: 'Entry only' },
  { value: 'exit', label: 'Exit only' },
]
const TICKET_COLORS = ['slate', 'indigo', 'emerald', 'amber', 'rose', 'purple', 'blue', 'teal']
function ticketTint(c) {
  const m = {
    slate: 'bg-slate-200 text-slate-700', indigo: 'bg-indigo-100 text-indigo-700',
    emerald: 'bg-emerald-100 text-emerald-700', amber: 'bg-amber-100 text-amber-700',
    rose: 'bg-rose-100 text-rose-700', purple: 'bg-purple-100 text-purple-700',
    blue: 'bg-blue-100 text-blue-700', teal: 'bg-teal-100 text-teal-700',
  }
  return m[c] || m.slate
}

// ── Access Rules: tags → zones, gates (tag-based access add-on) ──────────────
function AccessRulesPanel({ eventId }) {
  const [view, setView] = useState('tags')   // tags | assign | zones | gates
  const [tags, setTags] = useState([])
  const [zones, setZones] = useState([])
  const [questions, setQuestions] = useState([])
  const [msg, setMsg] = useState('')

  const field = 'border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white'
  function flash(m, isErr) { setMsg((isErr ? '⚠ ' : '') + m); setTimeout(() => setMsg(''), 3000) }
  function loadTags() { api.listTags(eventId).then(setTags).catch((e) => flash(e.message, true)) }

  useEffect(() => {
    loadTags()
    api.listZones(eventId).then(setZones).catch(() => {})
    api.listRSVPQuestions(eventId).then(setQuestions).catch(() => {})
  }, [eventId]) // eslint-disable-line

  const TABS = [['tags', 'Tags'], ['assign', 'Assign'], ['zones', 'Zone rules'], ['gates', 'Gates']]
  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-semibold text-base dark:text-white">🏷️ Access Rules</h2>
          <p className="text-xs text-gray-500 dark:text-slate-400">Tag guests (from RSVP / import / manually), allow tags into zones, and bind scanners to gates for auto-zone scanning.</p>
        </div>
        <div className="flex gap-1 flex-wrap">
          {TABS.map(([k, label]) => (
            <button key={k} onClick={() => setView(k)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${view === k ? 'bg-teal-600 text-white' : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300'}`}>{label}</button>
          ))}
        </div>
      </div>
      {msg && <div className="text-xs text-teal-600 dark:text-teal-400">{msg}</div>}

      {view === 'tags' && <TagsView eventId={eventId} tags={tags} questions={questions} field={field} reload={loadTags} flash={flash} />}
      {view === 'assign' && <TagAssignView eventId={eventId} tags={tags} flash={flash} />}
      {view === 'zones' && <ZoneRulesView eventId={eventId} tags={tags} zones={zones} flash={flash} />}
      {view === 'gates' && <GatesView eventId={eventId} zones={zones} field={field} flash={flash} />}
    </div>
  )
}

function TagsView({ eventId, tags, questions, field, reload, flash }) {
  const [form, setForm] = useState({ name: '', color: '#0ea5e9', rsvp_question_id: '', rsvp_value: '' })
  async function add() {
    if (!form.name.trim()) return
    try {
      await api.createTag(eventId, {
        name: form.name.trim(), color: form.color,
        rsvp_question_id: form.rsvp_question_id || null,
        rsvp_value: form.rsvp_value.trim() || null,
      })
      setForm({ name: '', color: '#0ea5e9', rsvp_question_id: '', rsvp_value: '' }); reload()
    } catch (e) { flash(e.message, true) }
  }
  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 items-end">
        <input className={field} placeholder="Tag name (e.g. VIP, Press, 21+)" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        <input type="color" className="h-9 w-14 rounded border border-gray-300 dark:border-slate-700" value={form.color} onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))} />
        <button onClick={add} className="bg-teal-600 text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-teal-700">+ Add tag</button>
      </div>
      <div className="text-[11px] text-gray-500 dark:text-slate-400">Optional auto-tag from an RSVP answer:</div>
      <div className="grid sm:grid-cols-3 gap-2 items-end">
        <select className={field} value={form.rsvp_question_id} onChange={(e) => setForm((f) => ({ ...f, rsvp_question_id: e.target.value }))}>
          <option value="">— no RSVP mapping —</option>
          {questions.map((q) => <option key={q.id} value={q.id}>{q.question}</option>)}
        </select>
        <input className={field} placeholder="…answer equals (e.g. Yes)" value={form.rsvp_value} onChange={(e) => setForm((f) => ({ ...f, rsvp_value: e.target.value }))} />
        <button onClick={() => api.syncRsvpTags(eventId).then((r) => flash(`Synced — ${r.linked} tag link(s) added.`)).catch((e) => flash(e.message, true))}
          className="bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 rounded-lg px-4 py-2 text-sm font-semibold">Sync from RSVP</button>
      </div>
      <div className="divide-y divide-gray-100 dark:divide-slate-700">
        {tags.map((t) => (
          <div key={t.id} className="py-2 flex items-center gap-3 text-sm">
            <span className="w-3 h-3 rounded-full" style={{ background: t.color || '#94a3b8' }} />
            <span className="font-medium dark:text-slate-100">{t.name}</span>
            <span className="text-xs text-slate-400">{t.guest_count} guest(s){t.rsvp_question_id ? ' · from RSVP' : ''}</span>
            <button onClick={() => api.deleteTag(eventId, t.id).then(reload).catch((e) => flash(e.message, true))}
              className="ml-auto text-xs text-red-500 hover:text-red-700">Delete</button>
          </div>
        ))}
        {tags.length === 0 && <div className="text-xs text-slate-400 py-2">No tags yet.</div>}
      </div>
    </div>
  )
}

function TagAssignView({ eventId, tags, flash }) {
  const [guests, setGuests] = useState([])
  const [search, setSearch] = useState('')
  const [sel, setSel] = useState(null)     // selected guest id
  const [guestTags, setGuestTags] = useState([])

  useEffect(() => { api.listGuests(eventId).then(setGuests).catch(() => {}) }, [eventId])
  function pick(g) {
    setSel(g.id)
    api.getGuestTags(eventId, g.id).then(setGuestTags).catch(() => setGuestTags([]))
  }
  function toggle(tagId) {
    const next = guestTags.includes(tagId) ? guestTags.filter((x) => x !== tagId) : [...guestTags, tagId]
    setGuestTags(next)
    api.setGuestTags(eventId, sel, next).catch((e) => flash(e.message, true))
  }
  const filtered = guests.filter((g) => `${g.first_name} ${g.last_name} ${g.email || ''}`.toLowerCase().includes(search.toLowerCase()))
  return (
    <div className="grid sm:grid-cols-2 gap-4">
      <div>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search guests…"
          className="w-full border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white mb-2" />
        <div className="max-h-64 overflow-y-auto divide-y divide-gray-100 dark:divide-slate-700 border border-gray-100 dark:border-slate-700 rounded-lg">
          {filtered.slice(0, 100).map((g) => (
            <button key={g.id} onClick={() => pick(g)}
              className={`w-full text-left px-3 py-2 text-sm ${sel === g.id ? 'bg-teal-50 dark:bg-teal-900/30' : 'hover:bg-gray-50 dark:hover:bg-slate-700/50'}`}>
              {g.first_name} {g.last_name}<span className="text-xs text-slate-400 ml-2">{g.email}</span>
            </button>
          ))}
        </div>
      </div>
      <div>
        {sel ? (
          <div className="flex flex-wrap gap-2">
            {tags.map((t) => (
              <button key={t.id} onClick={() => toggle(t.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${guestTags.includes(t.id) ? 'bg-teal-600 text-white border-teal-600' : 'bg-white dark:bg-slate-700 text-gray-600 dark:text-slate-300 border-gray-300 dark:border-slate-600'}`}>
                {t.name}
              </button>
            ))}
            {tags.length === 0 && <div className="text-xs text-slate-400">Create tags first.</div>}
          </div>
        ) : <div className="text-xs text-slate-400">Pick a guest to set their tags.</div>}
      </div>
    </div>
  )
}

function ZoneRulesView({ eventId, tags, zones, flash }) {
  const [rules, setRules] = useState({})   // zoneId -> [tagId]
  useEffect(() => {
    zones.forEach((z) => api.getZoneTags(eventId, z.id).then((ids) => setRules((r) => ({ ...r, [z.id]: ids }))).catch(() => {}))
  }, [zones, eventId]) // eslint-disable-line
  function toggle(zoneId, tagId) {
    const cur = rules[zoneId] || []
    const next = cur.includes(tagId) ? cur.filter((x) => x !== tagId) : [...cur, tagId]
    setRules((r) => ({ ...r, [zoneId]: next }))
    api.setZoneTags(eventId, zoneId, next).catch((e) => flash(e.message, true))
  }
  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500 dark:text-slate-400">A zone with no tags selected admits everyone. Otherwise a guest needs at least one matching tag.</p>
      {zones.map((z) => (
        <div key={z.id} className="border border-gray-100 dark:border-slate-700 rounded-lg p-3">
          <div className="font-medium text-sm dark:text-slate-100 mb-2">{z.name}</div>
          <div className="flex flex-wrap gap-2">
            {tags.map((t) => (
              <button key={t.id} onClick={() => toggle(z.id, t.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${(rules[z.id] || []).includes(t.id) ? 'bg-teal-600 text-white border-teal-600' : 'bg-white dark:bg-slate-700 text-gray-600 dark:text-slate-300 border-gray-300 dark:border-slate-600'}`}>
                {t.name}
              </button>
            ))}
            {tags.length === 0 && <div className="text-xs text-slate-400">Create tags first.</div>}
          </div>
        </div>
      ))}
      {zones.length === 0 && <div className="text-xs text-slate-400">Create zones in the Access tab first.</div>}
    </div>
  )
}

function GatesView({ eventId, zones, field, flash }) {
  const [gates, setGates] = useState([])
  const [form, setForm] = useState({ name: '', zone_id: '', direction: 'in' })
  function load() { api.listGates(eventId).then(setGates).catch(() => {}) }
  useEffect(load, [eventId]) // eslint-disable-line
  async function add() {
    if (!form.name.trim() || !form.zone_id) { flash('Name and zone are required.', true); return }
    try { await api.createGate(eventId, form); setForm({ name: '', zone_id: '', direction: 'in' }); load() }
    catch (e) { flash(e.message, true) }
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500 dark:text-slate-400">A gate pins a scanner to a zone (location) + direction. Staff pick the gate once; every scan auto-registers there and checks the guest's tags.</p>
      <div className="grid sm:grid-cols-4 gap-2 items-end">
        <input className={field} placeholder="Gate name (e.g. VIP Door)" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        <select className={field} value={form.zone_id} onChange={(e) => setForm((f) => ({ ...f, zone_id: e.target.value }))}>
          <option value="">— zone / location —</option>
          {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
        </select>
        <select className={field} value={form.direction} onChange={(e) => setForm((f) => ({ ...f, direction: e.target.value }))}>
          <option value="in">Entry →</option>
          <option value="out">← Exit</option>
        </select>
        <button onClick={add} className="bg-teal-600 text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-teal-700">+ Add gate</button>
      </div>
      <div className="divide-y divide-gray-100 dark:divide-slate-700">
        {gates.map((g) => (
          <div key={g.id} className="py-2 flex items-center gap-3 text-sm">
            <span className="font-medium dark:text-slate-100">{g.name}</span>
            <span className="text-xs text-slate-400">{g.zone_name} · {g.direction === 'out' ? 'Exit ←' : 'Entry →'}</span>
            <button onClick={() => api.deleteGate(eventId, g.id).then(load).catch((e) => flash(e.message, true))}
              className="ml-auto text-xs text-red-500 hover:text-red-700">Delete</button>
          </div>
        ))}
        {gates.length === 0 && <div className="text-xs text-slate-400 py-2">No gates yet.</div>}
      </div>
    </div>
  )
}

function AccessPanel({ eventId }) {
  const [view, setView] = useState('zones')   // zones | tickets | assign | analytics
  const [zones, setZones] = useState([])
  const [tickets, setTickets] = useState([])
  const [zoneForm, setZoneForm] = useState(null)
  const [ticketForm, setTicketForm] = useState(null)
  const [guests, setGuests] = useState([])
  const [occ, setOcc] = useState(null)
  const [peak, setPeak] = useState([])
  const [flow, setFlow] = useState([])
  const [journeyGuest, setJourneyGuest] = useState(null)
  const [journey, setJourney] = useState([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')

  const fieldCls = 'border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white'
  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 4000) }

  function loadZones() { api.listZones(eventId).then(setZones).catch((e) => setMsg(e.message)) }
  function loadTickets() { api.listTicketTypes(eventId).then(setTickets).catch((e) => setMsg(e.message)) }
  useEffect(() => { loadZones(); loadTickets() }, [eventId])

  // Analytics: load on entry + poll occupancy live.
  useEffect(() => {
    if (view !== 'analytics') return
    const refresh = () => {
      api.accessOccupancy(eventId).then(setOcc).catch(() => {})
      api.accessPeak(eventId).then(setPeak).catch(() => {})
      api.accessFlow(eventId).then(setFlow).catch(() => {})
    }
    refresh()
    const t = setInterval(() => api.accessOccupancy(eventId).then(setOcc).catch(() => {}), 5000)
    return () => clearInterval(t)
  }, [view, eventId])

  useEffect(() => {
    if (view === 'assign') api.listGuests(eventId).then(setGuests).catch((e) => setMsg(e.message))
  }, [view, eventId])

  // ── Zones ──
  async function saveZone(e) {
    e.preventDefault(); setLoading(true)
    try {
      const payload = { name: zoneForm.name, capacity: zoneForm.capacity === '' ? null : Number(zoneForm.capacity),
        direction_mode: zoneForm.direction_mode, description: zoneForm.description || null }
      if (zoneForm.id) await api.updateZone(eventId, zoneForm.id, payload)
      else await api.createZone(eventId, payload)
      setZoneForm(null); loadZones()
    } catch (e) { setMsg(e.message) } finally { setLoading(false) }
  }
  async function delZone(id) {
    if (!confirm('Delete this zone? Its scan history stays but it disappears from analytics.')) return
    try { await api.deleteZone(eventId, id); loadZones() } catch (e) { setMsg(e.message) }
  }

  // ── Ticket types ──
  async function saveTicket(e) {
    e.preventDefault(); setLoading(true)
    try {
      const payload = { name: ticketForm.name, color: ticketForm.color, capacity: ticketForm.capacity === '' ? null : Number(ticketForm.capacity),
        allowed_zone_ids: ticketForm.allowAll ? [] : ticketForm.allowed_zone_ids }
      if (ticketForm.id) await api.updateTicketType(eventId, ticketForm.id, payload)
      else await api.createTicketType(eventId, payload)
      setTicketForm(null); loadTickets()
    } catch (e) { setMsg(e.message) } finally { setLoading(false) }
  }
  async function delTicket(id) {
    if (!confirm('Delete this ticket type? Guests keep their records but lose this type.')) return
    try { await api.deleteTicketType(eventId, id); loadTickets() } catch (e) { setMsg(e.message) }
  }
  function toggleAllowed(zid) {
    setTicketForm((f) => {
      const set = new Set(f.allowed_zone_ids || [])
      set.has(zid) ? set.delete(zid) : set.add(zid)
      return { ...f, allowed_zone_ids: [...set] }
    })
  }

  async function assign(gid, ticketTypeId) {
    try { await api.assignTicketType(eventId, gid, ticketTypeId || null); loadTickets()
      setGuests((prev) => prev.map((g) => g.id === gid ? { ...g, ticket_type_id: ticketTypeId || null } : g))
    } catch (e) { setMsg(e.message) }
  }

  async function showJourney(g) {
    setJourneyGuest(g)
    try { setJourney(await api.guestJourney(eventId, g.id)) } catch (e) { setMsg(e.message) }
  }

  const TABS = [['zones', 'Zones'], ['tickets', 'Ticket types'], ['assign', 'Assign'], ['analytics', 'Analytics']]
  const peakMax = Math.max(1, ...peak.map((b) => b.ins))

  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-semibold text-base dark:text-white">🎟️ Entry areas</h2>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">Zones, ticket types, live occupancy, room flow, peak times & guest journeys. Officials scan in/out per zone.</p>
        </div>
        <div className="flex gap-1 flex-wrap">
          {TABS.map(([id, label]) => (
            <button key={id} onClick={() => setView(id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${view === id ? 'bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-600'}`}>{label}</button>
          ))}
        </div>
      </div>

      {/* ZONES */}
      {view === 'zones' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={() => setZoneForm({ name: '', capacity: '', direction_mode: 'both', description: '' })}
              className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-indigo-700">+ Zone</button>
          </div>
          {zones.length === 0 && !zoneForm && <p className="text-sm text-gray-400 dark:text-slate-500">No zones yet. Add rooms/areas guests are scanned into (Main Gate, Hall A, VIP Lounge…).</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {zones.map((z) => (
              <div key={z.id} className="border dark:border-slate-700 rounded-lg p-3 flex justify-between items-start">
                <div>
                  <div className="font-semibold text-sm dark:text-white">{z.name}</div>
                  <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                    {DIRECTION_MODES.find((m) => m.value === z.direction_mode)?.label} · inside now: <strong>{z.occupancy}</strong>{z.capacity != null && ` / ${z.capacity}`}
                  </div>
                </div>
                <div className="flex gap-2 text-xs shrink-0">
                  <button onClick={() => setZoneForm({ id: z.id, name: z.name, capacity: z.capacity ?? '', direction_mode: z.direction_mode, description: z.description || '' })} className="text-indigo-600 dark:text-indigo-400 hover:underline">Edit</button>
                  <button onClick={() => delZone(z.id)} className="text-red-400 hover:text-red-600">Delete</button>
                </div>
              </div>
            ))}
          </div>
          {zoneForm && (
            <form onSubmit={saveZone} className="bg-gray-50 dark:bg-slate-700/50 border dark:border-slate-600 rounded-lg p-3 flex flex-wrap gap-2 items-end">
              <div><label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Zone name *</label>
                <input className={fieldCls} required value={zoneForm.name} onChange={(e) => setZoneForm((f) => ({ ...f, name: e.target.value }))} placeholder="Hall A" /></div>
              <div><label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Capacity</label>
                <input type="number" min="1" className={`${fieldCls} w-24`} value={zoneForm.capacity} onChange={(e) => setZoneForm((f) => ({ ...f, capacity: e.target.value }))} placeholder="—" /></div>
              <div><label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Scan mode</label>
                <select className={fieldCls} value={zoneForm.direction_mode} onChange={(e) => setZoneForm((f) => ({ ...f, direction_mode: e.target.value }))}>
                  {DIRECTION_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select></div>
              <button type="submit" disabled={loading} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">{zoneForm.id ? 'Save' : 'Add'}</button>
              <button type="button" onClick={() => setZoneForm(null)} className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-sm dark:text-slate-300">Cancel</button>
            </form>
          )}
        </div>
      )}

      {/* TICKET TYPES */}
      {view === 'tickets' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={() => setTicketForm({ name: '', color: 'indigo', capacity: '', allowAll: true, allowed_zone_ids: [] })}
              className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-indigo-700">+ Ticket type</button>
          </div>
          {tickets.length === 0 && !ticketForm && <p className="text-sm text-gray-400 dark:text-slate-500">No ticket types yet. Define GA, VIP, Press… and which zones each may enter.</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {tickets.map((t) => (
              <div key={t.id} className="border dark:border-slate-700 rounded-lg p-3 flex justify-between items-start">
                <div>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded ${ticketTint(t.color)}`}>{t.name}</span>
                  <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                    {t.assigned_count} assigned · {(!t.allowed_zone_ids || t.allowed_zone_ids.length === 0) ? 'all zones' : `${t.allowed_zone_ids.length} zone(s)`}
                  </div>
                </div>
                <div className="flex gap-2 text-xs shrink-0">
                  <button onClick={() => setTicketForm({ id: t.id, name: t.name, color: t.color || 'indigo', capacity: t.capacity ?? '', allowAll: !t.allowed_zone_ids || t.allowed_zone_ids.length === 0, allowed_zone_ids: t.allowed_zone_ids || [] })} className="text-indigo-600 dark:text-indigo-400 hover:underline">Edit</button>
                  <button onClick={() => delTicket(t.id)} className="text-red-400 hover:text-red-600">Delete</button>
                </div>
              </div>
            ))}
          </div>
          {ticketForm && (
            <form onSubmit={saveTicket} className="bg-gray-50 dark:bg-slate-700/50 border dark:border-slate-600 rounded-lg p-3 space-y-3">
              <div className="flex flex-wrap gap-2 items-end">
                <div><label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Name *</label>
                  <input className={fieldCls} required value={ticketForm.name} onChange={(e) => setTicketForm((f) => ({ ...f, name: e.target.value }))} placeholder="VIP" /></div>
                <div><label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Color</label>
                  <select className={fieldCls} value={ticketForm.color} onChange={(e) => setTicketForm((f) => ({ ...f, color: e.target.value }))}>
                    {TICKET_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select></div>
                <div><label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Capacity</label>
                  <input type="number" min="1" className={`${fieldCls} w-24`} value={ticketForm.capacity} onChange={(e) => setTicketForm((f) => ({ ...f, capacity: e.target.value }))} placeholder="—" /></div>
              </div>
              <div>
                <label className="flex items-center gap-2 text-xs font-semibold text-gray-600 dark:text-slate-300 mb-2">
                  <input type="checkbox" checked={ticketForm.allowAll} onChange={(e) => setTicketForm((f) => ({ ...f, allowAll: e.target.checked }))} />
                  Can enter all zones
                </label>
                {!ticketForm.allowAll && (
                  <div className="flex flex-wrap gap-2">
                    {zones.map((z) => (
                      <label key={z.id} className={`text-xs px-2 py-1 rounded border cursor-pointer ${(ticketForm.allowed_zone_ids || []).includes(z.id) ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-300 dark:border-slate-600 dark:text-slate-300'}`}>
                        <input type="checkbox" className="hidden" checked={(ticketForm.allowed_zone_ids || []).includes(z.id)} onChange={() => toggleAllowed(z.id)} />
                        {z.name}
                      </label>
                    ))}
                    {zones.length === 0 && <span className="text-xs text-amber-500">Add zones first.</span>}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={loading} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">{ticketForm.id ? 'Save' : 'Add'}</button>
                <button type="button" onClick={() => setTicketForm(null)} className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-sm dark:text-slate-300">Cancel</button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* ASSIGN */}
      {view === 'assign' && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500 dark:text-slate-400">Assign a ticket type to each guest. (Guests with no type can enter any zone.)</p>
          <div className="max-h-96 overflow-y-auto divide-y divide-gray-100 dark:divide-slate-700">
            {guests.map((g) => (
              <div key={g.id} className="flex items-center justify-between py-2 gap-2">
                <span className="text-sm dark:text-slate-200 truncate">{g.first_name} {g.last_name}</span>
                <select className={`${fieldCls} py-1 shrink-0`} value={g.ticket_type_id || ''} onChange={(e) => assign(g.id, e.target.value)}>
                  <option value="">— none —</option>
                  {tickets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            ))}
            {guests.length === 0 && <p className="text-sm text-gray-400 py-3">No guests yet.</p>}
          </div>
        </div>
      )}

      {/* ANALYTICS */}
      {view === 'analytics' && (
        <div className="space-y-5">
          {/* Live occupancy */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold dark:text-white">Live occupancy</h3>
              <span className="text-xs text-gray-400">total inside: <strong>{occ?.total_inside ?? 0}</strong> · auto-refresh</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {(occ?.zones || []).map((z) => (
                <div key={z.id} className="border dark:border-slate-700 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">{z.occupancy}</div>
                  <div className="text-xs text-gray-500 dark:text-slate-400 truncate">{z.name}{z.capacity != null && <span className="text-gray-400"> / {z.capacity}</span>}</div>
                </div>
              ))}
              {(!occ || occ.zones.length === 0) && <p className="text-sm text-gray-400 col-span-full">No zones / no scans yet.</p>}
            </div>
          </div>

          {/* Peak times */}
          <div>
            <h3 className="text-sm font-semibold dark:text-white mb-2">Peak times (entries per 15 min)</h3>
            {peak.length === 0 ? <p className="text-sm text-gray-400">No scans recorded yet.</p> : (
              <div className="flex items-end gap-1 h-32 border-b dark:border-slate-700">
                {peak.map((b) => (
                  <div key={b.t} className="flex-1 flex flex-col justify-end items-center group" title={`${new Date(b.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} — ${b.ins} in`}>
                    <div className="w-full bg-indigo-500 rounded-t" style={{ height: `${(b.ins / peakMax) * 100}%` }} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Room flow */}
          <div>
            <h3 className="text-sm font-semibold dark:text-white mb-2">Room flow (most common movements)</h3>
            {flow.length === 0 ? <p className="text-sm text-gray-400">No movements yet.</p> : (
              <ul className="text-sm space-y-1">
                {flow.slice(0, 10).map((f, i) => (
                  <li key={i} className="flex items-center gap-2 dark:text-slate-300">
                    <span className="text-gray-400">{f.from_zone || 'Arrival'}</span>
                    <span className="text-indigo-400">→</span>
                    <span className="font-medium">{f.to_zone}</span>
                    <span className="text-xs text-gray-400 ml-auto">{f.count}×</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Guest journey */}
          <div>
            <h3 className="text-sm font-semibold dark:text-white mb-2">Guest journey</h3>
            <select className={`${fieldCls} w-full max-w-sm`} value={journeyGuest?.id || ''}
              onChange={(e) => { const g = guests.find((x) => x.id === e.target.value); if (g) showJourney(g) }}
              onClick={() => { if (guests.length === 0) api.listGuests(eventId).then(setGuests) }}>
              <option value="">Pick a guest…</option>
              {guests.map((g) => <option key={g.id} value={g.id}>{g.first_name} {g.last_name}</option>)}
            </select>
            {journeyGuest && (
              <ol className="mt-3 border-l-2 border-indigo-200 dark:border-slate-600 pl-4 space-y-2">
                {journey.length === 0 && <li className="text-sm text-gray-400">No scans for this guest.</li>}
                {journey.map((s, i) => (
                  <li key={i} className="text-sm">
                    <span className="font-medium dark:text-slate-200">{s.zone_name || '—'}</span>
                    <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${s.direction === 'in' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>{s.direction}</span>
                    {s.denied && <span className="ml-2 text-xs text-red-500">denied: {s.deny_reason}</span>}
                    <span className="text-xs text-gray-400 ml-2">{new Date(s.scanned_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}

      {msg && <p className="text-sm text-indigo-600 dark:text-indigo-400">{msg}</p>}
    </div>
  )
}

function MenuPanel({ eventId }) {
  const [categories, setCategories] = useState([])
  const [catForm, setCatForm]       = useState(null)
  const [itemForms, setItemForms]   = useState({})
  const [summary, setSummary]       = useState(null)
  const [showSummary, setShowSummary] = useState(false)
  const [loading, setLoading]       = useState(false)
  const [msg, setMsg]               = useState('')

  const fieldCls = 'border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white'

  useEffect(() => {
    api.listMenuCategories(eventId).then(setCategories).catch(console.error)
  }, [eventId])

  async function loadSummary() {
    const data = await api.getMenuSummary(eventId)
    setSummary(data)
    setShowSummary(true)
  }

  async function saveCat(e) {
    e.preventDefault()
    setLoading(true)
    try {
      const selType = catForm.selection_type || 'single'
      const payload = {
        name: catForm.name,
        sort_order: Number(catForm.sort_order) || 0,
        selection_type: selType,
        min_selections: selType === 'multi' ? Math.max(0, Number(catForm.min_selections) || 0) : 1,
        max_selections: selType === 'multi'
          ? (catForm.max_selections === '' || catForm.max_selections == null ? null : Number(catForm.max_selections))
          : 1,
        is_required: !!catForm.is_required,
      }
      if (catForm.id) {
        const updated = await api.updateMenuCategory(eventId, catForm.id, payload)
        setCategories((prev) => prev.map((c) => (c.id === catForm.id ? { ...c, ...updated } : c)))
      } else {
        const created = await api.createMenuCategory(eventId, payload)
        setCategories((prev) => [...prev, { items: [], combinations: [], ...created }])
      }
      setCatForm(null)
    } catch (e) { setMsg(e.message) }
    finally { setLoading(false) }
  }

  async function deleteCat(catId) {
    if (!confirm('Delete this category and all its items?')) return
    setLoading(true)
    try {
      await api.deleteMenuCategory(eventId, catId)
      setCategories((prev) => prev.filter((c) => c.id !== catId))
    } catch (e) { setMsg(e.message) }
    finally { setLoading(false) }
  }

  async function saveItem(e, catId) {
    e.preventDefault()
    const form = itemForms[catId]
    setLoading(true)
    try {
      const payload = { name: form.name, description: form.description || '' }
      if (form.id) {
        const updated = await api.updateMenuItem(eventId, form.id, payload)
        setCategories((prev) => prev.map((c) =>
          c.id === catId ? { ...c, items: c.items.map((i) => (i.id === form.id ? updated : i)) } : c
        ))
      } else {
        const created = await api.addMenuItem(eventId, catId, payload)
        setCategories((prev) => prev.map((c) =>
          c.id === catId ? { ...c, items: [...c.items, created] } : c
        ))
      }
      setItemForms((prev) => ({ ...prev, [catId]: null }))
    } catch (e) { setMsg(e.message) }
    finally { setLoading(false) }
  }

  async function deleteItem(catId, itemId) {
    if (!confirm('Delete this menu item? Existing guest selections for this item will be removed.')) return
    setLoading(true)
    try {
      await api.deleteMenuItem(eventId, itemId)
      setCategories((prev) => prev.map((c) =>
        c.id === catId ? { ...c, items: c.items.filter((i) => i.id !== itemId) } : c
      ))
    } catch (e) { setMsg(`Could not delete menu item: ${e.message}`) }
    finally { setLoading(false) }
  }

  function startNewCat() {
    setCatForm({
      name: '',
      sort_order: categories.length,
      selection_type: 'single',
      min_selections: 1,
      max_selections: '',
      is_required: false,
    })
  }

  function startEditCat(cat) {
    setCatForm({
      id: cat.id,
      name: cat.name,
      sort_order: cat.sort_order,
      selection_type: cat.selection_type || 'single',
      min_selections: cat.min_selections ?? 1,
      max_selections: cat.max_selections ?? '',
      is_required: !!cat.is_required,
    })
  }

  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-semibold text-base dark:text-white">Orders</h2>
        <div className="flex gap-2">
          <button
            onClick={showSummary ? () => setShowSummary(false) : loadSummary}
            className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            {showSummary ? 'Hide Summary' : 'View Summary'}
          </button>
          <button
            onClick={startNewCat}
            className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-indigo-700"
          >
            + Category
          </button>
        </div>
      </div>

      {categories.length === 0 && !catForm && (
        <p className="text-sm text-gray-400 dark:text-slate-500">No order categories yet. Add a category such as Drinks, Meals, Shirts, or Gift Bags.</p>
      )}

      <div className="space-y-3">
        {categories.map((cat) => {
          const selType = cat.selection_type || 'single'
          const isCombo = selType === 'combo'
          const isMulti = selType === 'multi'
          return (
            <div key={cat.id} className="border dark:border-slate-700 rounded-lg overflow-hidden">
              <div className="bg-slate-50 dark:bg-slate-700 px-4 py-2.5 flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold dark:text-white">{cat.name}</span>
                  <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                    {selType}
                  </span>
                  {isMulti && (
                    <span className="text-xs text-gray-500 dark:text-slate-400">
                      Min {cat.min_selections ?? 0}, Max {cat.max_selections ?? '∞'}
                    </span>
                  )}
                </div>
                <div className="flex gap-3">
                  <button onClick={() => startEditCat(cat)}
                    className="text-xs text-indigo-600 hover:underline">Edit</button>
                  <button onClick={() => deleteCat(cat.id)} disabled={loading}
                    className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40">Delete</button>
                  {!isCombo && (
                    <button
                      onClick={() => setItemForms((prev) => ({ ...prev, [cat.id]: { name: '', description: '' } }))}
                      className="text-xs text-green-600 hover:underline font-semibold"
                    >
                      + Item
                    </button>
                  )}
                </div>
              </div>

              {/* Combo: also keep an items strip (for editing the underlying pool) at the bottom of combos UI */}
              {isCombo ? (
                <>
                  <CombinationsSection
                    eventId={eventId}
                    cat={cat}
                    loading={loading}
                    setLoading={setLoading}
                    onCatsChange={setCategories}
                    setMsg={setMsg}
                  />
                  <details className="border-t dark:border-slate-700 bg-gray-50/40 dark:bg-slate-800/40">
                    <summary className="px-4 py-2 text-xs font-semibold text-gray-500 dark:text-slate-400 cursor-pointer select-none">
                      Manage underlying items ({cat.items.length})
                    </summary>
                    <div className="divide-y dark:divide-slate-700">
                      {cat.items.map((item) => (
                        <div key={item.id} className="px-4 py-2 flex items-center justify-between">
                          <div>
                            <span className="text-sm dark:text-slate-200">{item.name}</span>
                            {item.description && (
                              <span className="ml-2 text-xs text-gray-400 dark:text-slate-500">{item.description}</span>
                            )}
                          </div>
                          <div className="flex gap-3">
                            <button
                              onClick={() => setItemForms((prev) => ({ ...prev, [cat.id]: { id: item.id, name: item.name, description: item.description || '' } }))}
                              className="text-xs text-indigo-600 hover:underline"
                            >
                              Edit
                            </button>
                            <button onClick={() => deleteItem(cat.id, item.id)} disabled={loading}
                              className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40">Delete</button>
                          </div>
                        </div>
                      ))}
                      <div className="px-4 py-2 flex justify-end">
                        <button
                          onClick={() => setItemForms((prev) => ({ ...prev, [cat.id]: { name: '', description: '' } }))}
                          className="text-xs text-green-600 hover:underline font-semibold"
                        >
                          + Item
                        </button>
                      </div>
                      {itemForms[cat.id] && (
                        <ItemForm
                          form={itemForms[cat.id]}
                          fieldCls={fieldCls}
                          loading={loading}
                          onChange={(patch) => setItemForms((prev) => ({ ...prev, [cat.id]: { ...prev[cat.id], ...patch } }))}
                          onSubmit={(e) => saveItem(e, cat.id)}
                          onCancel={() => setItemForms((prev) => ({ ...prev, [cat.id]: null }))}
                        />
                      )}
                    </div>
                  </details>
                </>
              ) : (
                <div className="divide-y dark:divide-slate-700">
                  {cat.items.map((item) => (
                    <div key={item.id} className="px-4 py-2 flex items-center justify-between">
                      <div>
                        <span className="text-sm dark:text-slate-200">{item.name}</span>
                        {item.description && (
                          <span className="ml-2 text-xs text-gray-400 dark:text-slate-500">{item.description}</span>
                        )}
                      </div>
                      <div className="flex gap-3">
                        <button
                          onClick={() => setItemForms((prev) => ({ ...prev, [cat.id]: { id: item.id, name: item.name, description: item.description || '' } }))}
                          className="text-xs text-indigo-600 hover:underline"
                        >
                          Edit
                        </button>
                        <button onClick={() => deleteItem(cat.id, item.id)} disabled={loading}
                          className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40">Delete</button>
                      </div>
                    </div>
                  ))}
                  {cat.items.length === 0 && !itemForms[cat.id] && (
                    <div className="px-4 py-2 text-xs text-gray-400 dark:text-slate-500 italic">No items yet.</div>
                  )}
                  {itemForms[cat.id] && (
                    <ItemForm
                      form={itemForms[cat.id]}
                      fieldCls={fieldCls}
                      loading={loading}
                      onChange={(patch) => setItemForms((prev) => ({ ...prev, [cat.id]: { ...prev[cat.id], ...patch } }))}
                      onSubmit={(e) => saveItem(e, cat.id)}
                      onCancel={() => setItemForms((prev) => ({ ...prev, [cat.id]: null }))}
                    />
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {catForm && (
        <form onSubmit={saveCat} className="flex flex-wrap gap-2 items-end bg-gray-50 dark:bg-slate-700 rounded-lg p-3 border dark:border-slate-600">
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Category name</label>
            <input value={catForm.name} onChange={(e) => setCatForm((f) => ({ ...f, name: e.target.value }))} required
              className={fieldCls} placeholder="Drinks, Meals, Shirts..." />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Sort Order</label>
            <input type="number" value={catForm.sort_order} onChange={(e) => setCatForm((f) => ({ ...f, sort_order: e.target.value }))}
              className={`${fieldCls} w-20`} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Selection Type</label>
            <select
              value={catForm.selection_type}
              onChange={(e) => setCatForm((f) => ({ ...f, selection_type: e.target.value }))}
              className={fieldCls}
            >
              {SELECTION_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          {catForm.selection_type === 'multi' && (
            <>
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Min</label>
                <input type="number" min={0} value={catForm.min_selections}
                  onChange={(e) => setCatForm((f) => ({ ...f, min_selections: e.target.value }))}
                  className={`${fieldCls} w-20`} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Max</label>
                <input type="number" min={0} value={catForm.max_selections}
                  onChange={(e) => setCatForm((f) => ({ ...f, max_selections: e.target.value }))}
                  placeholder="∞"
                  className={`${fieldCls} w-20`} />
              </div>
            </>
          )}
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-200 select-none cursor-pointer">
            <input type="checkbox"
              checked={!!catForm.is_required}
              onChange={(e) => setCatForm((f) => ({ ...f, is_required: e.target.checked }))}
              className="w-4 h-4 accent-amber-500" />
            Required
          </label>
          <button type="submit" disabled={loading}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
            {catForm.id ? 'Save' : 'Add'}
          </button>
          <button type="button" onClick={() => setCatForm(null)}
            className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-sm dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-600">
            Cancel
          </button>
        </form>
      )}

      {showSummary && summary && (
        <div className="pt-3 border-t dark:border-slate-700 space-y-4">
        <h3 className="text-sm font-semibold dark:text-white">Order summary</h3>
          {summary.map((cat) => (
            <div key={cat.id}>
              <div className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase mb-1.5">{cat.category}</div>
              <div className="space-y-1">
                {cat.items.map((item) => (
                  <div key={item.id} className="flex items-center gap-2">
                    <span className="text-sm dark:text-slate-200 flex-1">{item.name}</span>
                    <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 w-8 text-right">{item.count}</span>
                  </div>
                ))}
                <div className="flex items-center gap-2 text-gray-400 dark:text-slate-500">
                  <span className="text-sm flex-1 italic">No selection</span>
                  <span className="text-xs font-bold w-8 text-right">{cat.no_choice}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {msg && <p className="text-sm text-red-600">{msg}</p>}
    </div>
  )
}

function ItemForm({ form, fieldCls, loading, onChange, onSubmit, onCancel }) {
  return (
    <form onSubmit={onSubmit} className="px-4 py-3 flex flex-wrap gap-2 items-end bg-gray-50 dark:bg-slate-700/50">
      <div>
        <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Item name</label>
        <input
          value={form.name}
          onChange={(e) => onChange({ name: e.target.value })}
          required className={fieldCls} placeholder="Water, Coffee, Chicken, T-shirt..."
        />
      </div>
      <div className="flex-1 min-w-0">
        <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Description</label>
        <input
          value={form.description}
          onChange={(e) => onChange({ description: e.target.value })}
          className={fieldCls} placeholder="Optional"
        />
      </div>
      <button type="submit" disabled={loading}
        className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
        {form.id ? 'Save' : 'Add'}
      </button>
      <button type="button" onClick={onCancel}
        className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-sm dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-600">
        ×
      </button>
    </form>
  )
}

// ── Menu Dashboard ───────────────────────────────────────────────────────────

function MenuDashboard({ eventId }) {
  const [data, setData]         = useState(null)
  const [loading, setLoading]   = useState(false)
  const [err, setErr]           = useState('')
  const [open, setOpen]         = useState(true)
  const [search, setSearch]     = useState('')
  const [statusF, setStatusF]   = useState('all') // all | served | pending
  const [tableF, setTableF]     = useState('all')
  const [working, setWorking]   = useState(null)
  const [viewMode, setViewMode] = useState('table') // 'table' | 'guest'

  async function load() {
    setLoading(true); setErr('')
    try {
      const res = await api.getMenuDashboard(eventId)
      setData(res)
    } catch (e) { setErr(e.message); setData(null) }
    finally { setLoading(false) }
  }

  useEffect(() => { if (open) load() }, [eventId, open])

  async function markServed(guestId) {
    setWorking(guestId)
    try {
      await api.markMealServed(eventId, guestId)
      setData((d) => d && {
        ...d,
        guests: d.guests.map((g) => g.guest_id === guestId ? { ...g, meal_served: true } : g),
      })
      // Refresh totals to reflect the change.
      load()
    } catch (e) { setErr(e.message) }
    finally { setWorking(null) }
  }

  const sortedItems = (data?.item_totals || []).slice().sort((a, b) => b.count - a.count)
  const sortedCombos = (data?.combination_totals || []).slice().sort((a, b) => b.count - a.count)

  const tables = Array.from(new Set((data?.guests || []).map((g) => g.table_name).filter(Boolean))).sort()

  const filtered = (data?.guests || []).filter((g) => {
    if (statusF === 'served' && !g.meal_served) return false
    if (statusF === 'pending' && g.meal_served) return false
    if (tableF !== 'all' && g.table_name !== tableF) return false
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      if (!(g.name || '').toLowerCase().includes(q) && !(g.email || '').toLowerCase().includes(q)) return false
    }
    return true
  })

  function renderChoices(g) {
    const pills = []
    for (const [catId, sel] of Object.entries(g.single || {})) {
      pills.push({ key: `s-${catId}`, label: sel.category_name, value: sel.item_name })
    }
    for (const [catId, sel] of Object.entries(g.multi || {})) {
      pills.push({ key: `m-${catId}`, label: sel.category_name, value: (sel.items || []).join(', ') })
    }
    for (const [catId, sel] of Object.entries(g.combo || {})) {
      const items = (sel.items || []).join(', ')
      pills.push({
        key: `c-${catId}`,
        label: sel.category_name,
        value: items ? `${sel.combination_name} (${items})` : sel.combination_name,
      })
    }
    if (pills.length === 0) {
      return <span className="text-xs italic text-gray-400 dark:text-slate-500">No selection</span>
    }
    return (
      <div className="flex flex-col gap-1">
        {pills.map((p) => (
          <span key={p.key}
            className="inline-block px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200">
            <strong className="font-semibold">{p.label}:</strong> {p.value || '—'}
          </span>
        ))}
      </div>
    )
  }

  // Group filtered guests by table name (unassigned guests go to a synthetic '— unassigned —' bucket)
  // and compute per-table item totals so staff can see "Table 5: Rice ×3, Water ×5" at a glance.
  function buildTableGroups(guestList) {
    const buckets = new Map()
    for (const g of guestList) {
      const key = g.table_name || '— unassigned —'
      if (!buckets.has(key)) buckets.set(key, [])
      buckets.get(key).push(g)
    }
    const result = []
    for (const [tableName, list] of buckets) {
      const sortedSeats = list.slice().sort((a, b) => {
        const an = Number(a.seat_number); const bn = Number(b.seat_number)
        if (!isNaN(an) && !isNaN(bn)) return an - bn
        return String(a.seat_number || '').localeCompare(String(b.seat_number || ''))
      })
      const itemCounts = new Map()
      const bump = (label) => itemCounts.set(label, (itemCounts.get(label) || 0) + 1)
      for (const g of list) {
        for (const sel of Object.values(g.single || {})) bump(sel.item_name)
        for (const sel of Object.values(g.multi || {})) for (const n of (sel.items || [])) bump(n)
        // Combos: count the combo as one unit. Don't unroll its items —
        // servers already know what's in each combo and we don't want noisy headers.
        for (const sel of Object.values(g.combo || {})) bump(sel.combination_name)
      }
      const totals = [...itemCounts.entries()].sort((a, b) => b[1] - a[1])
      const served = list.filter((g) => g.meal_served).length
      result.push({ tableName, guests: sortedSeats, totals, served, total: list.length })
    }
    // Sort: real tables alphabetically, unassigned last
    result.sort((a, b) => {
      if (a.tableName.startsWith('—')) return 1
      if (b.tableName.startsWith('—')) return -1
      return a.tableName.localeCompare(b.tableName, undefined, { numeric: true })
    })
    return result
  }

  const tableGroups = buildTableGroups(filtered)

  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6 space-y-4 border-l-4 border-l-amber-500">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-base dark:text-white">Orders dashboard</h2>
          <button onClick={() => setOpen((v) => !v)}
            className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">
            {open ? '▲ Hide' : '▼ Show'}
          </button>
        </div>
        {open && (
          <button onClick={load} disabled={loading}
            className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50">
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        )}
      </div>

      {!open ? null : err ? (
        <p className="text-sm text-red-600">{err}</p>
      ) : loading && !data ? (
        <p className="text-sm text-gray-400 dark:text-slate-500">Loading…</p>
      ) : !data ? null : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="border dark:border-slate-700 rounded-lg overflow-hidden">
              <div className="bg-slate-50 dark:bg-slate-700 px-4 py-2 text-sm font-semibold dark:text-white">Item totals</div>
              {sortedItems.length === 0 ? (
                <div className="px-4 py-3 text-xs text-gray-400 dark:text-slate-500 italic">No selections yet.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">
                    <tr>
                      <th className="px-4 py-2 text-left">Category</th>
                      <th className="px-4 py-2 text-left">Item</th>
                      <th className="px-4 py-2 text-right">Count</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y dark:divide-slate-700">
                    {sortedItems.map((it) => (
                      <tr key={it.item_id}>
                        <td className="px-4 py-1.5 text-xs text-gray-500 dark:text-slate-400">{it.category_name}</td>
                        <td className="px-4 py-1.5 dark:text-slate-200">{it.name}</td>
                        <td className="px-4 py-1.5 text-right font-bold text-indigo-600 dark:text-indigo-400">{it.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="border dark:border-slate-700 rounded-lg overflow-hidden">
              <div className="bg-slate-50 dark:bg-slate-700 px-4 py-2 text-sm font-semibold dark:text-white">Combination totals</div>
              {sortedCombos.length === 0 ? (
                <div className="px-4 py-3 text-xs text-gray-400 dark:text-slate-500 italic">No combo selections.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">
                    <tr>
                      <th className="px-4 py-2 text-left">Combination</th>
                      <th className="px-4 py-2 text-right">Count</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y dark:divide-slate-700">
                    {sortedCombos.map((c) => (
                      <tr key={c.combination_id}>
                        <td className="px-4 py-1.5 dark:text-slate-200">{c.name}</td>
                        <td className="px-4 py-1.5 text-right font-bold text-indigo-600 dark:text-indigo-400">{c.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="pt-2 border-t dark:border-slate-700 space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[12rem]">
                <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Search</label>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or email…"
                  className="w-full border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Status</label>
                <select value={statusF} onChange={(e) => setStatusF(e.target.value)}
                  className="border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white">
                  <option value="all">All</option>
                  <option value="pending">Only pending</option>
                  <option value="served">Only served</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Table</label>
                <select value={tableF} onChange={(e) => setTableF(e.target.value)}
                  className="border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white">
                  <option value="all">All tables</option>
                  {tables.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="flex gap-1 ml-auto rounded-lg bg-slate-100 dark:bg-slate-700 p-1">
                <button onClick={() => setViewMode('table')}
                  className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${
                    viewMode === 'table' ? 'bg-white dark:bg-slate-900 text-amber-700 dark:text-amber-300 shadow' : 'text-slate-600 dark:text-slate-300'
                  }`}>By table</button>
                <button onClick={() => setViewMode('guest')}
                  className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${
                    viewMode === 'guest' ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow' : 'text-slate-600 dark:text-slate-300'
                  }`}>By guest</button>
              </div>
              <span className="text-xs text-gray-500 dark:text-slate-400">
                {filtered.length} of {data.guests.length}
              </span>
            </div>

            {viewMode === 'table' && (
              <div className="space-y-4">
                {tableGroups.length === 0 && (
                  <div className="text-center text-sm text-gray-400 dark:text-slate-500 italic py-6">
                    No guests match these filters.
                  </div>
                )}
                {tableGroups.map((tg) => (
                  <div key={tg.tableName} className="border-2 border-amber-300 dark:border-amber-700 rounded-xl overflow-hidden">
                    <div className="bg-amber-400 dark:bg-amber-700 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-3">
                        <div className="text-lg font-bold text-white">{tg.tableName}</div>
                        <span className="text-xs font-semibold bg-white/20 text-white px-2 py-0.5 rounded">
                          {tg.guests.length} guest{tg.guests.length === 1 ? '' : 's'} · {tg.served}/{tg.total} served
                        </span>
                      </div>
                      {tg.totals.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 justify-end">
                          {tg.totals.map(([name, n]) => (
                            <span key={name} className="bg-white/95 dark:bg-slate-900 text-amber-800 dark:text-amber-300 px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap">
                              {name} × {n}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="divide-y dark:divide-slate-700 bg-white dark:bg-slate-900">
                      {tg.guests.map((g) => (
                        <div key={g.guest_id} className="p-3 flex flex-wrap items-start gap-3">
                          <div className="shrink-0 w-12 text-center">
                            <div className="text-[10px] uppercase text-slate-400 leading-none">Seat</div>
                            <div className="text-2xl font-extrabold text-slate-700 dark:text-slate-200 leading-tight">
                              {g.seat_number ?? '–'}
                            </div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold dark:text-slate-100 truncate">{g.name}</span>
                              {g.is_vip && <VipBadge />}
                            </div>
                            <div className="mt-1">{renderChoices(g)}</div>
                          </div>
                          <div className="flex flex-col items-end gap-1.5 shrink-0">
                            {!g.admitted && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400">
                                Not arrived
                              </span>
                            )}
                            <button
                              onClick={() => markServed(g.guest_id)}
                              disabled={g.meal_served || working === g.guest_id || !g.admitted}
                              title={!g.admitted ? 'Guest not admitted yet' : ''}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:cursor-not-allowed ${
                                g.meal_served
                                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                                  : 'bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-40'
                              }`}
                            >
                              {g.meal_served ? 'Served ✓' : working === g.guest_id ? '…' : 'Mark served'}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {viewMode === 'guest' && (
            <div className="overflow-x-auto border dark:border-slate-700 rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-slate-700 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase">
                  <tr>
                    <th className="px-4 py-2 text-left">Name</th>
                    <th className="px-4 py-2 text-left">Table / Seat</th>
                    <th className="px-4 py-2 text-center">Admitted</th>
                    <th className="px-4 py-2 text-left">Choices</th>
                    <th className="px-4 py-2 text-center">Order served</th>
                    <th className="px-4 py-2 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                  {filtered.map((g) => (
                    <tr key={g.guest_id} className="hover:bg-gray-50 dark:hover:bg-slate-700/60 align-top">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="font-medium dark:text-slate-100">{g.name}</span>
                          {g.is_vip && <VipBadge />}
                        </div>
                        {g.email && <div className="text-xs text-gray-400 dark:text-slate-500">{g.email}</div>}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-600 dark:text-slate-300">
                        {g.table_name
                          ? <>{g.table_name}{g.seat_number != null ? ` · seat ${g.seat_number}` : ''}</>
                          : <span className="italic text-gray-400 dark:text-slate-500">unassigned</span>}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {g.admitted
                          ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400">Yes</span>
                          : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-400">No</span>}
                      </td>
                      <td className="px-4 py-2.5">{renderChoices(g)}</td>
                      <td className="px-4 py-2.5 text-center">
                        {g.meal_served
                          ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">Served ✓</span>
                          : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-400">Pending</span>}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <button
                          onClick={() => markServed(g.guest_id)}
                          disabled={g.meal_served || working === g.guest_id || !g.admitted}
                          title={!g.admitted ? 'Guest not admitted yet' : ''}
                          className="bg-amber-500 text-white px-3 py-1 rounded-lg text-xs font-semibold hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {g.meal_served ? 'Served' : working === g.guest_id ? '…' : 'Mark served'}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-sm text-gray-400 dark:text-slate-500 italic">
                        No guests match these filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ── Invite & RSVP panel ───────────────────────────────────────────────────────

const INVITE_THEMES = [
  { id: 'default',  label: 'Teal (Default)' },
  { id: 'gold',     label: 'Gold' },
  { id: 'rose',     label: 'Rose' },
  { id: 'midnight', label: 'Midnight' },
  { id: 'forest',   label: 'Forest' },
]

const RSVP_QUESTION_TYPES = [
  { value: 'text', label: 'Short answer' },
  { value: 'select', label: 'Multiple choice' },
  { value: 'boolean', label: 'Yes / No' },
]

const RSVP_QUESTION_PRESETS = [
  { label: 'Dietary restriction', question: 'Do you have any dietary restrictions?', question_type: 'text', options: '', is_required: false },
  { label: 'Meal choice', question: 'Please choose your meal', question_type: 'select', options: 'Chicken, Fish, Vegetarian, No meal', is_required: true },
  { label: 'Plus-one', question: 'Will you be bringing a plus-one?', question_type: 'boolean', options: '', is_required: false },
  { label: 'T-shirt size', question: 'What is your T-shirt size?', question_type: 'select', options: 'XS, S, M, L, XL, XXL', is_required: false },
  { label: 'Accessibility needs', question: 'Do you need any accessibility assistance?', question_type: 'text', options: '', is_required: false },
  { label: 'Company name', question: 'What company or organization are you representing?', question_type: 'text', options: '', is_required: false },
]

function rsvpQuestionOptionsText(options) {
  if (!options) return ''
  if (Array.isArray(options)) return options.join(', ')
  try {
    const parsed = JSON.parse(options)
    return Array.isArray(parsed) ? parsed.join(', ') : String(options)
  } catch {
    return String(options)
  }
}

function InvitePanel({ event, onChanged }) {
  const [form, setForm] = useState({
    rsvp_enabled:      event.rsvp_enabled      ?? false,
    invite_theme:      event.invite_theme       ?? 'default',
    invite_message:    event.invite_message     ?? '',
    rsvp_collect_phone:event.rsvp_collect_phone ?? true,
    rsvp_collect_email:event.rsvp_collect_email ?? true,
    rsvp_allow_duplicate_emails: event.rsvp_allow_duplicate_emails ?? false,
    rsvp_capacity:     event.rsvp_capacity      ?? '',
    invite_mode:       event.invite_mode        ?? 'open',
    rsvp_deadline:     utcToLocalInput(event.rsvp_deadline),
    rsvp_require_approval: event.rsvp_require_approval ?? false,
    rsvp_multi_invitee_enabled: event.rsvp_multi_invitee_enabled ?? false,
    rsvp_multi_invitee_limit: event.rsvp_multi_invitee_limit ?? 10,
    rsvp_multi_invitee_limit_rules_text: JSON.stringify(event.rsvp_multi_invitee_limit_rules || {}, null, 2),
  })
  const [questions, setQuestions] = useState([])
  const [newQ, setNewQ] = useState({ question: '', question_type: 'text', options: '', is_required: false })
  const [editingQuestionId, setEditingQuestionId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [coverImage, setCoverImage] = useState(event.invite_cover_image ?? null)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    api.listRSVPQuestions(event.id).then(setQuestions).catch(console.error)
  }, [event.id])

  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  async function save() {
    setLoading(true); setMsg(''); setErr('')
    try {
      let limitRules = null
      if (form.rsvp_multi_invitee_limit_rules_text?.trim()) {
        limitRules = JSON.parse(form.rsvp_multi_invitee_limit_rules_text)
        if (!limitRules || Array.isArray(limitRules) || typeof limitRules !== 'object') {
          throw new Error('Category invitee limits must be a JSON object.')
        }
      }
      const { rsvp_multi_invitee_limit_rules_text, ...saveForm } = form
      const payload = {
        ...saveForm,
        rsvp_capacity: form.rsvp_capacity === '' ? null : Number(form.rsvp_capacity),
        rsvp_deadline: form.rsvp_deadline ? new Date(form.rsvp_deadline).toISOString() : null,
        rsvp_multi_invitee_limit: Math.max(1, Math.min(Number(form.rsvp_multi_invitee_limit) || 10, 100)),
        rsvp_multi_invitee_limit_rules: limitRules,
      }
      const updated = await api.updateInviteSettings(event.id, payload)
      onChanged(updated)
      setMsg('Invite settings saved!')
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  async function addQuestion() {
    if (!newQ.question.trim()) return
    if (newQ.question_type === 'select' && !newQ.options.split(',').map((s) => s.trim()).filter(Boolean).length) {
      setErr('Add at least one option for a multiple choice question.')
      return
    }
    try {
      const editingQuestion = editingQuestionId ? questions.find((q) => q.id === editingQuestionId) : null
      const payload = {
        question: newQ.question.trim(),
        question_type: newQ.question_type,
        is_required: newQ.is_required,
        sort_order: editingQuestion ? editingQuestion.sort_order : questions.length,
        options: newQ.question_type === 'select' && newQ.options.trim()
          ? JSON.stringify(newQ.options.split(',').map((s) => s.trim()).filter(Boolean))
          : null,
      }
      const q = editingQuestionId
        ? await api.updateRSVPQuestion(event.id, editingQuestionId, payload)
        : await api.createRSVPQuestion(event.id, payload)
      setQuestions((p) => editingQuestionId ? p.map((item) => item.id === q.id ? q : item) : [...p, q])
      setNewQ({ question: '', question_type: 'text', options: '', is_required: false })
      setEditingQuestionId(null)
    } catch (e) { setErr(e.message) }
  }

  function applyQuestionPreset(value) {
    const preset = RSVP_QUESTION_PRESETS.find((p) => p.label === value)
    if (!preset) return
    setNewQ({
      question: preset.question,
      question_type: preset.question_type,
      options: preset.options,
      is_required: preset.is_required,
    })
  }

  async function deleteQuestion(qId) {
    await api.deleteRSVPQuestion(event.id, qId)
    setQuestions((p) => p.filter((q) => q.id !== qId))
    if (editingQuestionId === qId) {
      setEditingQuestionId(null)
      setNewQ({ question: '', question_type: 'text', options: '', is_required: false })
    }
  }

  function editQuestion(q) {
    setErr('')
    setEditingQuestionId(q.id)
    setNewQ({
      question: q.question || '',
      question_type: q.question_type || 'text',
      options: q.question_type === 'select' ? rsvpQuestionOptionsText(q.options) : '',
      is_required: Boolean(q.is_required),
    })
  }

  function cancelQuestionEdit() {
    setEditingQuestionId(null)
    setNewQ({ question: '', question_type: 'text', options: '', is_required: false })
  }

  async function uploadCover(file) {
    if (!file) return
    setUploading(true); setMsg(''); setErr('')
    try {
      const data = await api.uploadCoverImage(event.id, file)
      setCoverImage(data.url)
      onChanged(data.event)
      setMsg('Cover image uploaded!')
    } catch (e) { setErr(e.message) }
    finally { setUploading(false) }
  }

  async function removeCover() {
    setUploading(true); setMsg(''); setErr('')
    try {
      const updated = await api.deleteCoverImage(event.id)
      setCoverImage(null)
      onChanged(updated)
      setMsg('Cover image removed.')
    } catch (e) { setErr(e.message) }
    finally { setUploading(false) }
  }

  const inviteUrl = api.inviteUrl(event)

  async function generateLink(regenerate = false) {
    if (regenerate && !confirm('Create a new RSVP link? The old public RSVP link will stop working.')) return
    setLoading(true); setMsg(''); setErr('')
    try {
      const updated = await api.generateRSVPLink(event.id, regenerate)
      onChanged(updated)
      setMsg(regenerate ? 'RSVP link regenerated.' : 'RSVP link generated.')
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  const inputCls = 'w-full border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500'

  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-base dark:text-white">Invitation page &amp; RSVP</h2>
        <a
          href={inviteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-teal-600 dark:text-teal-400 hover:underline font-medium"
        >
          Preview invite page ↗
        </a>
      </div>

      {/* Share link */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Public RSVP link</label>
        <div className="flex gap-2">
          <input readOnly value={inviteUrl} className={`${inputCls} text-slate-500`} />
          <button
            onClick={() => event.rsvp_token ? navigator.clipboard.writeText(inviteUrl).then(() => setMsg('Link copied!')) : generateLink(false)}
            className="shrink-0 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 px-3 py-2 rounded-lg text-sm hover:bg-slate-200 dark:hover:bg-slate-600"
          >
            {event.rsvp_token ? 'Copy' : 'Generate'}
          </button>
        </div>
        {event.rsvp_token && (
          <button onClick={() => generateLink(true)} disabled={loading}
            className="mt-2 text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50">
            Regenerate link
          </button>
        )}
      </div>

      {/* Cover image */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">Cover / banner image</label>
        {coverImage ? (
          <div className="space-y-2">
            <img src={coverImage} alt="Cover" className="w-full max-h-48 object-cover rounded-xl border border-slate-200 dark:border-slate-700" />
            <div className="flex gap-2">
              <label className="cursor-pointer shrink-0 bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-slate-200 dark:hover:bg-slate-600">
                {uploading ? 'Uploading…' : 'Replace image'}
                <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(e) => uploadCover(e.target.files?.[0])} />
              </label>
              <button onClick={removeCover} disabled={uploading} className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50">Remove</button>
            </div>
          </div>
        ) : (
          <label className={`flex flex-col items-center justify-center gap-2 w-full h-28 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 cursor-pointer hover:border-teal-500 transition-colors ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
            <span className="text-2xl">🖼️</span>
            <span className="text-xs text-slate-500 dark:text-slate-400">{uploading ? 'Uploading...' : 'Upload an image for the invitation page'}</span>
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(e) => uploadCover(e.target.files?.[0])} />
          </label>
        )}
      </div>

      {/* RSVP mode — one clear choice */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">How do you want to invite guests?</label>
        <div className="grid sm:grid-cols-2 gap-3">
          <button type="button"
            onClick={() => setForm((p) => ({ ...p, rsvp_enabled: false, invite_mode: 'open', rsvp_require_approval: false }))}
            className={`text-left rounded-xl border-2 p-4 transition-colors ${
              !form.rsvp_enabled
                ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/20'
                : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
            }`}>
            <div className="font-semibold text-sm dark:text-white flex items-center gap-2">
              {!form.rsvp_enabled && <span className="text-teal-600">✓</span>} Skip RSVP
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Send everyone their ticket (QR) straight away. No replies or confirmations needed.
            </div>
          </button>
          <button type="button"
            onClick={() => setForm((p) => ({ ...p, rsvp_enabled: true }))}
            className={`text-left rounded-xl border-2 p-4 transition-colors ${
              form.rsvp_enabled
                ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/20'
                : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
            }`}>
            <div className="font-semibold text-sm dark:text-white flex items-center gap-2">
              {form.rsvp_enabled && <span className="text-teal-600">✓</span>} With RSVP
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Ask guests to confirm first; tickets/updates follow. Adds an RSVP form to the invite page.
            </div>
          </button>
        </div>
      </div>

      {/* Page styling — always relevant */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Theme</label>
          <select value={form.invite_theme} onChange={set('invite_theme')} className={inputCls}>
            {INVITE_THEMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
      </div>

      {/* RSVP-only settings — hidden entirely in Skip-RSVP mode */}
      {form.rsvp_enabled && (
        <div className="space-y-4 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="flex items-center gap-2">
              <input id="collect_phone" type="checkbox" checked={form.rsvp_collect_phone} onChange={set('rsvp_collect_phone')} className="w-4 h-4 accent-teal-600" />
              <label htmlFor="collect_phone" className="text-sm font-medium text-slate-700 dark:text-slate-300 cursor-pointer">Ask for phone number</label>
            </div>
            <div className="flex items-center gap-2">
              <input id="collect_email" type="checkbox" checked={form.rsvp_collect_email} onChange={set('rsvp_collect_email')} className="w-4 h-4 accent-teal-600" />
              <label htmlFor="collect_email" className="text-sm font-medium text-slate-700 dark:text-slate-300 cursor-pointer">Ask for email address</label>
            </div>
            <div className="flex items-start gap-2 sm:col-span-2">
              <input id="allow_duplicate_emails" type="checkbox" checked={form.rsvp_allow_duplicate_emails} onChange={set('rsvp_allow_duplicate_emails')} className="w-4 h-4 mt-0.5 accent-teal-600" />
              <label htmlFor="allow_duplicate_emails" className="text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
                <span className="font-medium">Allow the same email on multiple RSVP guests</span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">Use this when one parent or coordinator submits several invitees. Phone duplicates are still blocked.</span>
              </label>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Guest limit (blank = no limit)</label>
              <input type="number" min="0" value={form.rsvp_capacity} onChange={set('rsvp_capacity')} className={inputCls} placeholder="e.g. 100" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Who can RSVP?</label>
              <select value={form.invite_mode} onChange={set('invite_mode')} className={inputCls}>
                <option value="open">Anyone with the event link</option>
                <option value="closed">Only guests with a personal invite link</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">RSVP deadline (optional)</label>
              <input type="datetime-local" value={form.rsvp_deadline} onChange={set('rsvp_deadline')} className={inputCls} />
            </div>
          </div>

          {form.invite_mode === 'closed' && (
            <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              Only personal links can RSVP. Send them from <span className="font-semibold">Invites &amp; RSVP</span>, or copy a guest's link from the Guests tab. Tickets are issued after the guest confirms.
            </div>
          )}

          {form.invite_mode === 'open' && (
            <div className="space-y-4">
              <div className="flex items-start gap-2">
                <input id="require_approval" type="checkbox" checked={form.rsvp_require_approval} onChange={set('rsvp_require_approval')} className="w-4 h-4 mt-0.5 accent-teal-600" />
                <label htmlFor="require_approval" className="text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
                  <span className="font-medium">Review RSVPs before sending tickets</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">New RSVPs show as "Pending". Approve them in Guests to send tickets.</span>
                </label>
              </div>
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                <div className="flex items-start gap-2">
                  <input id="multi_invitee" type="checkbox" checked={form.rsvp_multi_invitee_enabled} onChange={set('rsvp_multi_invitee_enabled')} className="w-4 h-4 mt-0.5 accent-teal-600" />
                  <label htmlFor="multi_invitee" className="text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
                    <span className="font-medium">Let one submitter register multiple invitees</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">Useful for schools and conventions. Each invitee becomes a separate guest with a separate QR pass after approval.</span>
                  </label>
                </div>
                {form.rsvp_multi_invitee_enabled && (
                  <div className="mt-3 grid gap-3 lg:grid-cols-[220px,1fr]">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Default max invitees</label>
                      <input type="number" min="0" max="100" value={form.rsvp_multi_invitee_limit} onChange={set('rsvp_multi_invitee_limit')} className={inputCls} />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Category invitee limits JSON</label>
                      <textarea
                        rows={5}
                        value={form.rsvp_multi_invitee_limit_rules_text}
                        onChange={set('rsvp_multi_invitee_limit_rules_text')}
                        className={`${inputCls} font-mono`}
                        placeholder={`{"Individual invited guest": 0, "Transition parent/guardian": 2, "Haflatul-Qur'an parent/guardian": 10}`}
                      />
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        Optional. Use 0 for submitter-only categories. The public RSVP page shows these categories and the backend enforces the selected additional guest limit.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div>
        <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Message for guests</label>
        <textarea rows={3} value={form.invite_message} onChange={set('invite_message')} className={inputCls} placeholder="Add a personal message to your guests…" />
      </div>

      {msg && <div className="text-xs text-green-600 dark:text-green-400">{msg}</div>}
      {err && <div className="text-xs text-red-600 dark:text-red-400">{err}</div>}

      <button onClick={save} disabled={loading}
        className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50">
        {loading ? 'Saving...' : 'Save invitation page'}
      </button>

      {/* RSVP questions */}
      <div className="border-t dark:border-slate-700 pt-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Questions for guests</h3>
        {questions.length === 0 && <p className="text-xs text-slate-400">No extra questions. Guests will only answer the basics.</p>}
        {questions.map((q) => (
          <div key={q.id} className="flex items-center justify-between gap-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg px-3 py-2 text-sm">
            <div>
              <span className="font-medium text-slate-800 dark:text-slate-200">{q.question}</span>
              <span className="ml-2 text-xs text-slate-400">({q.question_type}{q.is_required ? ', required' : ''})</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => editQuestion(q)} className="text-teal-500 hover:text-teal-300 text-xs">Edit</button>
              <button onClick={() => deleteQuestion(q.id)} className="text-red-400 hover:text-red-600 text-xs">Remove</button>
            </div>
          </div>
        ))}
        {/* Add question form */}
        {editingQuestionId && (
          <div className="rounded-lg border border-teal-500/40 bg-teal-50 dark:bg-teal-900/20 px-3 py-2 text-xs text-teal-700 dark:text-teal-200">
            Editing question. Save to update it, or cancel to add a new question.
          </div>
        )}
        <div className="grid sm:grid-cols-[1fr_auto] gap-2">
          <select
            value=""
            onChange={(e) => applyQuestionPreset(e.target.value)}
            className={inputCls}
            aria-label="Question preset"
          >
            <option value="">Use a common question...</option>
            {RSVP_QUESTION_PRESETS.map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
          </select>
          <select
            value={newQ.question_type}
            onChange={(e) => setNewQ((p) => ({ ...p, question_type: e.target.value, options: e.target.value === 'select' ? p.options : '' }))}
            className="border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500 min-w-[11rem]"
            aria-label="Question type"
          >
            {RSVP_QUESTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <input
            value={newQ.question}
            onChange={(e) => setNewQ((p) => ({ ...p, question: e.target.value }))}
            placeholder="Question to ask guests..."
            className={inputCls}
          />
        </div>
        {newQ.question_type === 'select' && (
          <div className="space-y-1">
            <input
              value={newQ.options}
              onChange={(e) => setNewQ((p) => ({ ...p, options: e.target.value }))}
              placeholder="Choices, comma separated: Chicken, Fish, Vegetarian"
              className={inputCls}
            />
            <p className="text-[11px] text-slate-400">Guests will choose one option from this list.</p>
          </div>
        )}
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
            <input type="checkbox" checked={newQ.is_required} onChange={(e) => setNewQ((p) => ({ ...p, is_required: e.target.checked }))} className="w-3 h-3 accent-teal-600" />
            Required
          </label>
          <button onClick={addQuestion}
            className="bg-slate-100 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-slate-200 dark:hover:bg-slate-600">
            {editingQuestionId ? 'Save question' : 'Add question'}
          </button>
          {editingQuestionId && (
            <button onClick={cancelQuestionEdit}
              className="text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Manual invite panel ───────────────────────────────────────────────────────

function ManualInvitePanel({ event }) {
  const [recipients, setRecipients] = useState([])
  const [nameInput, setNameInput] = useState('')
  const [contactInput, setContactInput] = useState('')
  const [channels, setChannels] = useState(['email'])
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [err, setErr] = useState('')

  const inputCls = 'border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500'

  function addRecipient() {
    const name = nameInput.trim()
    const contact = contactInput.trim()
    if (!name || !contact) return
    const isEmail = contact.includes('@')
    setRecipients((p) => [...p, { name, ...(isEmail ? { email: contact } : { phone: contact }) }])
    setNameInput('')
    setContactInput('')
  }

  function removeRecipient(idx) {
    setRecipients((p) => p.filter((_, i) => i !== idx))
  }

  function toggleChannel(ch) {
    setChannels((p) => p.includes(ch) ? p.filter((c) => c !== ch) : [...p, ch])
  }

  async function send() {
    if (recipients.length === 0) { setErr('Add at least one recipient'); return }
    if (channels.length === 0) { setErr('Select at least one channel'); return }
    if (!confirm(`Send invites to ${recipients.length} recipient(s)?`)) return
    setLoading(true); setResult(null); setErr('')
    try {
      const res = await api.sendInvites(event.id, { recipients, channels })
      setResult(res)
      setRecipients([])
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6 space-y-5">
      <div>
        <h2 className="font-semibold text-base dark:text-white">✉️ Send invitations by hand</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Add people one at a time when they are not already in your guest spreadsheet.
        </p>
      </div>

      {/* Add recipient row */}
      <div className="flex gap-2 flex-wrap">
        <input
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addRecipient()}
          placeholder="Name"
          className={`${inputCls} w-36`}
        />
        <input
          value={contactInput}
          onChange={(e) => setContactInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addRecipient()}
          placeholder="Email or phone"
          className={`${inputCls} flex-1 min-w-[180px]`}
        />
        <button
          onClick={addRecipient}
          className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg text-sm font-semibold"
        >
          + Add
        </button>
      </div>

      {/* Recipient chips */}
      {recipients.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {recipients.map((r, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 bg-teal-50 dark:bg-teal-900/30 text-teal-800 dark:text-teal-200 border border-teal-200 dark:border-teal-700 rounded-full px-3 py-1 text-xs font-medium">
              <span>{r.name}</span>
              <span className="text-teal-500 dark:text-teal-400">{r.email || r.phone}</span>
              <button onClick={() => removeRecipient(i)} className="ml-1 text-teal-400 hover:text-red-500">✕</button>
            </span>
          ))}
        </div>
      )}

      {/* Channels */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Send via</label>
        <div className="flex gap-4">
          {['email', 'sms', 'whatsapp'].map((ch) => (
            <label key={ch} className="flex items-center gap-1.5 text-sm cursor-pointer select-none text-slate-700 dark:text-slate-300">
              <input type="checkbox" checked={channels.includes(ch)} onChange={() => toggleChannel(ch)} className="w-4 h-4 accent-teal-600" />
              {ch === 'email' ? 'Email' : ch.toUpperCase()}
            </label>
          ))}
        </div>
      </div>

      {err && <div className="text-xs text-red-600 dark:text-red-400">{err}</div>}
      {result && (
        <div className="text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2">
          Sent to {result.sent} recipient(s){result.skipped > 0 ? ` · ${result.skipped} skipped (no contact)` : ''}
          {result.errors?.length > 0 && <div className="mt-1 text-red-600 dark:text-red-400">{result.errors.join(', ')}</div>}
        </div>
      )}

      <button onClick={send} disabled={loading || recipients.length === 0}
        className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50">
        {loading ? 'Sending...' : `Send invitation${recipients.length > 1 ? 's' : ''}${recipients.length > 0 ? ` (${recipients.length})` : ''}`}
      </button>
    </div>
  )
}

// ── Billing / Event Pass panel ──────────────────────────────────────────────

function fmtMoney(amount, currency) {
  const major = amount / 100
  return currency === 'NGN'
    ? `₦${major.toLocaleString()}`
    : `$${major.toLocaleString(undefined, { minimumFractionDigits: 0 })}`
}

const PLAN_ORDER = ['tier50', 'tier150', 'tier300', 'scale']
const PLAN_RANK = { free: 0, tier50: 1, tier150: 2, tier300: 3, scale: 4, unlimited: 4 }
const PLAN_LABELS = {
  tier50: 'Starter Event Pass',
  tier150: 'Standard Event Pass',
  tier300: 'Pro Event Pass',
  scale: 'Scale Event Pass',
  unlimited: 'Scale Event Pass',
}
const FEATURE_PLAN = {
  paid_channels: 'tier50',
  notify_sms: 'tier50',
  notify_whatsapp: 'tier50',
  qr_checkin: 'tier50',
  seating_enabled: 'tier50',
  partner_pairing_enabled: 'tier150',
  menu_enabled: 'tier50',
  logistics_enabled: 'tier50',
  registry_enabled: 'tier50',
  venue_access_enabled: 'tier150',
  source_sync: 'tier150',
  self_checkin_enabled: 'tier300',
  manual_checkin_enabled: 'tier300',
  notify_mms: 'tier300',
  experience_enabled: 'tier300',
  consent_forms: 'tier300',
}

function normalizeRequiredPlan(value, fallback = 'tier50') {
  const raw = String(value || '').toLowerCase()
  if (PLAN_RANK[raw]) return raw
  if (raw.includes('scale')) return 'scale'
  if (raw.includes('pro')) return 'tier300'
  if (raw.includes('standard')) return 'tier150'
  if (raw.includes('starter')) return 'tier50'
  return fallback
}

function planAtLeast(a, b) {
  return (PLAN_RANK[a] || 0) >= (PLAN_RANK[b] || 0)
}

function requiredPlanFromError(err, fallback = 'tier50') {
  return normalizeRequiredPlan(err?.requiredPlan || err?.message, fallback)
}

function recommendedPlanForEvent(event, fallback = 'tier50') {
  const count = Number(event?.guest_count || event?.guest_count_estimate || 0)
  let plan = fallback
  if (count > 50) plan = 'tier150'
  if (count > 150) plan = 'tier300'
  if (count > 300) plan = 'scale'
  return plan
}

function AddOnCatalog({ catalog }) {
  const addons = catalog?.addons
  if (!addons) return null
  const sections = [
    ['messaging', 'Messaging add-ons'],
    ['design_studio', 'Design Studio add-ons'],
    ['experience', 'Experience add-ons'],
    ['operations', 'Operations add-ons'],
    ['enterprise', 'Enterprise-only add-ons'],
  ]
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/40">
      <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">Add-ons and manual quotes</div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {sections.map(([key, title]) => (
          <div key={key}>
            <div className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</div>
            <ul className="mt-1 space-y-1 text-xs text-slate-600 dark:text-slate-300">
              {(addons[key] || []).slice(0, 5).map((item) => (
                <li key={typeof item === 'string' ? item : item.label}>- {typeof item === 'string' ? item : item.label}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

function CreditLedger({ eventId }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!eventId) return
    api.getCreditLedger(eventId).then(setData).catch((e) => setErr(e.message))
  }, [eventId])

  if (err) return <div className="text-xs text-red-600 dark:text-red-400">{err}</div>
  if (!data) return null
  const rows = data.rows || []
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900/40">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">Credit ledger</div>
        <div className="text-xs font-bold text-slate-500 dark:text-slate-400">{data.balance?.toLocaleString()} credits available</div>
      </div>
      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">No credit activity yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead className="text-left text-slate-500 dark:text-slate-400">
              <tr>
                <th className="py-1 pr-3">When</th>
                <th className="py-1 pr-3">Action</th>
                <th className="py-1 pr-3">Channel</th>
                <th className="py-1 pr-3">Provider</th>
                <th className="py-1 pr-3 text-right">Delta</th>
                <th className="py-1 text-right">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.slice(0, 12).map((r) => (
                <tr key={r.id} className="text-slate-700 dark:text-slate-300">
                  <td className="py-1.5 pr-3 whitespace-nowrap">{r.created_at ? new Date(r.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '-'}</td>
                  <td className="py-1.5 pr-3">{r.reason || r.action}</td>
                  <td className="py-1.5 pr-3 uppercase">{r.channel || '-'}</td>
                  <td className="py-1.5 pr-3">{r.provider || '-'}</td>
                  <td className={`py-1.5 pr-3 text-right font-bold ${r.delta >= 0 ? 'text-emerald-600' : 'text-slate-700 dark:text-slate-200'}`}>
                    {r.delta > 0 ? '+' : ''}{r.delta}
                  </td>
                  <td className="py-1.5 text-right">{r.balance_after?.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function UpgradeGateModal({ event, gate, onClose, onStarted }) {
  const [info, setInfo] = useState(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const required = normalizeRequiredPlan(gate?.requiredPlan || requiredPlanFromError(gate?.error), 'tier50')

  useEffect(() => {
    if (!gate || !event?.id) return
    setErr('')
    api.getBillingTiers(event.id).then(setInfo).catch((e) => setErr(e.message))
  }, [gate, event?.id])

  if (!gate) return null

  const tiers = info?.tiers || []
  const eligible = tiers.filter((t) => planAtLeast(t.key, required))
  const selected = eligible.find((t) => t.key === required) || eligible[0] || tiers.find((t) => t.key === required) || tiers[0]

  async function checkout(tierKey) {
    if (!tierKey) return
    setBusy(tierKey); setErr('')
    try {
      const { url } = await api.checkout(event.id, tierKey)
      onStarted?.(tierKey)
      window.location.href = url
    } catch (e) { setErr(e.message); setBusy('') }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-teal-700 dark:text-teal-300">Event Pass required</p>
            <h2 className="mt-1 text-xl font-black text-slate-950 dark:text-white">{gate.title || 'Upgrade to activate this feature'}</h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              {gate.message || gate.error?.message || `This action requires ${PLAN_LABELS[required] || 'an Event Pass'}.`}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-white">x</button>
        </div>

        <div className="mt-5 rounded-lg border border-teal-200 bg-teal-50 p-4 dark:border-teal-800 dark:bg-teal-950/30">
          <div className="text-sm font-semibold text-teal-900 dark:text-teal-100">Recommended</div>
          <div className="mt-1 text-lg font-black text-teal-800 dark:text-teal-200">
            {selected ? `${selected.name || selected.label} · ${fmtMoney(selected.amount, selected.currency)}` : PLAN_LABELS[required]}
          </div>
          {selected && (
            <p className="mt-1 text-xs text-teal-900 dark:text-teal-100">
              Up to {selected.guest_cap?.toLocaleString()} guests · {selected.credits?.toLocaleString()} message credits
            </p>
          )}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {eligible.map((t) => (
            <button key={t.key} onClick={() => checkout(t.key)} disabled={!info?.configured || !!busy}
              className={`rounded-xl border p-4 text-left transition disabled:opacity-50 ${
                t.key === selected?.key ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/30' : 'border-slate-200 hover:border-teal-300 dark:border-slate-700'
              }`}>
              <div className="text-sm font-black text-slate-950 dark:text-white">{t.name || t.label}</div>
              <div className="mt-1 text-2xl font-black text-teal-700 dark:text-teal-300">{fmtMoney(t.amount, t.currency)}</div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Up to {t.guest_cap?.toLocaleString()} guests · {t.credits?.toLocaleString()} credits</div>
              <div className="mt-3 text-xs font-bold text-teal-700 dark:text-teal-300">{busy === t.key ? 'Redirecting...' : 'Activate with this pass'}</div>
            </button>
          ))}
        </div>

        {info && !info.configured && (
          <div className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
            {info.provider?.toUpperCase()} checkout is not configured. Contact sales or enable billing credentials.
          </div>
        )}
        {err && <div className="mt-4 text-sm text-red-600 dark:text-red-400">{err}</div>}
      </div>
    </div>
  )
}

function BillingPanel({ event, recommendedPlan }) {
  const [info, setInfo] = useState(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')

  function loadInfo() {
    api.getBillingTiers(event.id).then(setInfo).catch((e) => setErr(e.message))
  }
  useEffect(() => { loadInfo() }, [event.id])

  async function changeCurrency(cur) {
    setErr('')
    try { await api.setBillingCurrency(event.id, cur); loadInfo() }
    catch (e) { setErr(e.message) }
  }

  async function upgrade(tier) {
    setBusy(tier); setErr('')
    try {
      const { url } = await api.checkout(event.id, tier)
      window.location.href = url   // hand off to Stripe/Paystack
    } catch (e) { setErr(e.message); setBusy('') }
  }

  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="font-semibold text-base dark:text-white">💳 Event Pass</h2>
        <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          Currency
          <select
            value={info?.currency || 'USD'}
            onChange={(e) => changeCurrency(e.target.value)}
            className="border border-gray-300 dark:border-slate-600 rounded-lg px-2 py-1 text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-white">
            <option value="USD">USD ($) · Stripe</option>
            <option value="NGN">NGN (₦) · Paystack</option>
          </select>
        </label>
      </div>

      {event.is_paid ? (
        <>
          <div className="rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 px-4 py-3 text-sm text-green-800 dark:text-green-300">
            ✓ This event is on the <span className="font-semibold">{event.plan_tier === 'scale' || event.plan_tier === 'unlimited' ? 'Scale' : event.plan_tier}</span> plan
            {event.guest_cap ? ` · up to ${event.guest_cap.toLocaleString()} guests` : ' · custom guest volume'}
            {` · ${event.message_credits} message credits left`}.
          </div>
          <div className="text-sm font-semibold text-slate-700 dark:text-slate-300 pt-1">Top up message credits</div>
          {info && !info.configured && (
            <div className="text-xs text-amber-700 dark:text-amber-300">Online payment isn’t set up yet.</div>
          )}
          <div className="grid sm:grid-cols-3 gap-3">
            {info?.packs?.map((p) => (
              <div key={p.key} className="border dark:border-slate-700 rounded-xl p-4 flex flex-col gap-2">
                <div className="font-semibold text-sm dark:text-white">{p.label}</div>
                <div className="text-xl font-bold text-teal-700 dark:text-teal-300">{fmtMoney(p.amount, p.currency)}</div>
                <button
                  onClick={() => upgrade(p.key)}
                  disabled={!info.configured || !!busy}
                  className="mt-1 bg-teal-600 hover:bg-teal-700 text-white px-3 py-2 rounded-lg text-sm font-semibold disabled:opacity-50">
                  {busy === p.key ? 'Redirecting…' : 'Buy credits'}
                </button>
              </div>
            ))}
          </div>
          <AddOnCatalog catalog={info?.catalog} />
          <CreditLedger eventId={event.id} />
        </>
      ) : (
        <>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Free events are email-only, capped at 25 guests. An Event Pass unlocks
            SMS/WhatsApp, more guests, and removes branding — one payment, no subscription.
          </p>
          {info && !info.configured && (
            <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              Online payment isn’t set up yet — contact the organizer to enable {info.provider}.
            </div>
          )}
          <div className="grid sm:grid-cols-2 gap-3">
            {info?.tiers.map((t) => (
              <div key={t.key} className={`border rounded-xl p-4 flex flex-col gap-2 ${
                t.key === recommendedPlan ? 'border-teal-500 bg-teal-50/70 dark:bg-teal-950/20' : 'dark:border-slate-700'
              }`}>
                <div className="font-semibold text-sm dark:text-white">{t.name || t.label}</div>
                {t.key === recommendedPlan && <div className="w-fit rounded-full bg-teal-600 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white">Recommended</div>}
                <div className="text-2xl font-bold text-teal-700 dark:text-teal-300">{fmtMoney(t.amount, t.currency)}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {t.guest_cap ? `Up to ${t.guest_cap.toLocaleString()} guests` : 'Custom guest volume'} · {t.credits.toLocaleString()} credits
                </div>
                {t.capabilities?.length > 0 && (
                  <ul className="space-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                    {t.capabilities.slice(0, 3).map((item) => <li key={item}>✓ {item}</li>)}
                  </ul>
                )}
                <button
                  onClick={() => upgrade(t.key)}
                  disabled={!info.configured || !!busy}
                  className="mt-1 bg-teal-600 hover:bg-teal-700 text-white px-3 py-2 rounded-lg text-sm font-semibold disabled:opacity-50">
                  {busy === t.key ? 'Redirecting…' : 'Buy pass'}
                </button>
              </div>
            ))}
          </div>
          <AddOnCatalog catalog={info?.catalog} />
          <CreditLedger eventId={event.id} />
        </>
      )}
      {err && <div className="text-xs text-red-600 dark:text-red-400">{err}</div>}
    </div>
  )
}

// ── Message Templates panel ─────────────────────────────────────────────────────
// View and customize the outbound messages (email/SMS/WhatsApp) per event.
// Event override → platform default; unedited templates send the built-in copy.

function MessageTemplatesPanel({
  eventId,
  title = 'Message Templates',
  description = 'Customize the emails, SMS and WhatsApp messages this event sends. Unedited templates use the platform default.',
  includeGroups = null,
  excludeGroups = ['Experience'],
}) {
  const [items, setItems]     = useState([])
  const [sel, setSel]         = useState(null)   // selected template key
  const [draft, setDraft]     = useState(null)   // {subject, email_body, sms_body, whatsapp_body}
  const [meta, setMeta]       = useState(null)   // full meta for selected
  const [preview, setPreview] = useState(null)
  const [audit, setAudit]     = useState([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg]         = useState('')
  const [err, setErr]         = useState('')
  const [testTo, setTestTo]   = useState('')
  const [testChannel, setTestChannel] = useState('email')
  const [activeGroup, setActiveGroup] = useState('')

  const fieldCls = 'border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white w-full'

  async function reloadList() {
    try { setItems(await api.listTemplates(eventId)) } catch (e) { setErr(e.message) }
  }
  useEffect(() => { reloadList(); api.templateAudit(eventId).then(setAudit).catch(() => {}) }, [eventId])

  function openTemplate(it) {
    setSel(it.key); setMeta(it); setMsg(''); setErr(''); setPreview(null)
    setDraft({
      subject: it.effective.subject || '',
      email_body: it.effective.email_body || '',
      sms_body: it.effective.sms_body || '',
      whatsapp_body: it.effective.whatsapp_body || '',
      mms_body: it.effective.mms_body || '',
    })
    setTestChannel((it.channels.filter((c) => c !== 'mms')[0]) || 'email')
  }

  function insertVar(field, v) {
    setDraft((d) => ({ ...d, [field]: (d[field] || '') + `{{${v}}}` }))
  }

  async function save() {
    setLoading(true); setErr(''); setMsg('')
    try {
      const payload = {}
      if (meta.channels.includes('email')) { payload.subject = draft.subject; payload.email_body = draft.email_body }
      if (meta.channels.includes('sms')) payload.sms_body = draft.sms_body
      if (meta.channels.includes('whatsapp')) payload.whatsapp_body = draft.whatsapp_body
      if (meta.channels.includes('mms')) payload.mms_body = draft.mms_body
      const updated = await api.saveTemplate(eventId, sel, payload)
      setMeta(updated); setMsg('Saved.'); setTimeout(() => setMsg(''), 3000)
      await reloadList(); api.templateAudit(eventId).then(setAudit).catch(() => {})
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  async function reset() {
    if (!confirm('Reset this template to the platform default?')) return
    setLoading(true); setErr('')
    try {
      const updated = await api.resetTemplate(eventId, sel)
      openTemplate(updated); setMsg('Reset to default.'); setTimeout(() => setMsg(''), 3000)
      await reloadList(); api.templateAudit(eventId).then(setAudit).catch(() => {})
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  async function doPreview() {
    setErr('')
    try { setPreview(await api.previewTemplate(eventId, sel, draft)) } catch (e) { setErr(e.message) }
  }

  async function doTestSend() {
    if (!testTo.trim()) { setErr('Enter a destination address/number'); return }
    setLoading(true); setErr(''); setMsg('')
    try {
      await api.testSendTemplate(eventId, sel, { ...draft, channel: testChannel, to: testTo.trim() })
      setMsg(`Test ${testChannel} sent to ${testTo}.`); setTimeout(() => setMsg(''), 4000)
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  const visibleItems = items.filter((it) => {
    if (includeGroups && !includeGroups.includes(it.group)) return false
    if (!includeGroups && excludeGroups.includes(it.group)) return false
    return true
  })
  // Group templates into tabs so long message catalogs stay scannable.
  const grouped = visibleItems.reduce((acc, it) => { (acc[it.group] = acc[it.group] || []).push(it); return acc }, {})
  const groupNames = Object.keys(grouped)
  const selectedGroup = groupNames.includes(activeGroup) ? activeGroup : (groupNames[0] || '')
  const activeList = grouped[selectedGroup] || []

  useEffect(() => {
    if (!groupNames.length) {
      if (activeGroup) setActiveGroup('')
      return
    }
    if (!groupNames.includes(activeGroup)) setActiveGroup(groupNames[0])
  }, [items, includeGroups, excludeGroups, activeGroup])

  function switchGroup(group) {
    setActiveGroup(group)
    const selected = visibleItems.find((it) => it.key === sel)
    if (!selected || selected.group !== group) {
      setSel(null); setMeta(null); setDraft(null); setPreview(null); setMsg(''); setErr('')
    }
  }

  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6">
      <h2 className="font-semibold text-base dark:text-white">{title}</h2>
      <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">
        {description}
      </p>
      {err && <p className="text-sm text-red-500 mt-2">{err}</p>}
      {msg && <p className="text-sm text-green-600 mt-2">{msg}</p>}

      {groupNames.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2 border-b border-gray-200 dark:border-slate-700 pb-3">
          {groupNames.map((group) => (
            <button key={group} type="button" onClick={() => switchGroup(group)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                selectedGroup === group
                  ? 'bg-indigo-600 text-white dark:bg-teal-500 dark:text-slate-950'
                  : 'border border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700'
              }`}>
              {group}
              <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] ${
                selectedGroup === group ? 'bg-white/20' : 'bg-gray-100 dark:bg-slate-800'
              }`}>{grouped[group].length}</span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* List */}
        <div className="lg:col-span-1">
          {groupNames.length === 0 && (
            <p className="text-sm text-gray-400 dark:text-slate-500">No templates in this section yet.</p>
          )}
          {selectedGroup && (
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase text-gray-400 dark:text-slate-500">{selectedGroup}</div>
              <div className="space-y-1 max-h-[32rem] overflow-auto pr-1">
                {activeList.map((it) => (
                <button key={it.key} onClick={() => openTemplate(it)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between gap-2 ${
                    sel === it.key ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-200'
                                   : 'hover:bg-gray-50 dark:hover:bg-slate-700 dark:text-slate-200'
                  }`}>
                  <span className="truncate">{it.label}</span>
                  {it.source === 'event-customized'
                    ? <span className="text-[10px] bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 rounded shrink-0">Custom</span>
                    : <span className="text-[10px] text-gray-400 shrink-0">Default</span>}
                </button>
              ))}
              </div>
            </div>
          )}
        </div>

        {/* Editor */}
        <div className="lg:col-span-2">
          {!draft ? (
            <p className="text-sm text-gray-400 dark:text-slate-500">Select a message to edit.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="font-semibold text-sm dark:text-white">{meta.label}</div>
                <div className="flex gap-2">
                  <button onClick={doPreview} className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-slate-600 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700">Preview</button>
                  <button onClick={save} disabled={loading} className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700 disabled:opacity-50">Save</button>
                  {meta.source === 'event-customized' && (
                    <button onClick={reset} disabled={loading} className="text-xs px-3 py-1.5 rounded-lg border border-red-300 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20">Reset</button>
                  )}
                </div>
              </div>
              {meta.note && <p className="text-xs text-amber-600 dark:text-amber-400">ℹ {meta.note}</p>}

              {/* Placeholder palette */}
              <div className="flex flex-wrap gap-1">
                {meta.placeholders.map((p) => (
                  <code key={p} className="text-[10px] bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300 px-1.5 py-0.5 rounded">{`{{${p}}}`}</code>
                ))}
              </div>

              {meta.channels.includes('email') && (<>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Email subject</label>
                  <input value={draft.subject} onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))} className={fieldCls} />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300">Email body (HTML)</label>
                    <select onChange={(e) => { if (e.target.value) { insertVar('email_body', e.target.value); e.target.value = '' } }} className="text-[11px] border dark:border-slate-600 rounded bg-white dark:bg-slate-700 dark:text-slate-200">
                      <option value="">+ insert variable</option>
                      {meta.placeholders.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <textarea value={draft.email_body} onChange={(e) => setDraft((d) => ({ ...d, email_body: e.target.value }))} rows={6} className={`${fieldCls} font-mono text-xs`} />
                </div>
              </>)}

              {meta.channels.includes('sms') && (
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">SMS body</label>
                  <textarea value={draft.sms_body} onChange={(e) => setDraft((d) => ({ ...d, sms_body: e.target.value }))} rows={2} className={fieldCls} />
                </div>
              )}

              {meta.channels.includes('whatsapp') && (
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">WhatsApp body</label>
                  <textarea value={draft.whatsapp_body} onChange={(e) => setDraft((d) => ({ ...d, whatsapp_body: e.target.value }))} rows={2} className={fieldCls} />
                </div>
              )}

              {meta.channels.includes('mms') && (
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">MMS body (caption sent with the ticket-card image)</label>
                  <textarea value={draft.mms_body} onChange={(e) => setDraft((d) => ({ ...d, mms_body: e.target.value }))} rows={2} className={fieldCls} />
                </div>
              )}

              {/* Test send (MMS isn't test-sendable — it needs a guest's card) */}
              <div className="border-t dark:border-slate-700 pt-3 flex flex-wrap items-end gap-2">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1">Test send</label>
                  <select value={testChannel} onChange={(e) => setTestChannel(e.target.value)} className="border dark:border-slate-600 rounded-lg px-2 py-2 text-sm bg-white dark:bg-slate-700 dark:text-slate-200">
                    {meta.channels.filter((c) => c !== 'mms').map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder={testChannel === 'email' ? 'you@example.com' : '+1832...'} className={`${fieldCls} flex-1 min-w-[10rem]`} />
                <button onClick={doTestSend} disabled={loading} className="text-xs px-3 py-2 rounded-lg border border-gray-300 dark:border-slate-600 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700">Send test</button>
              </div>

              {preview && (
                <div className="border dark:border-slate-700 rounded-lg p-3 bg-gray-50 dark:bg-slate-900/40">
                  <div className="text-[11px] font-semibold uppercase text-gray-400 mb-2">Preview (sample data)</div>
                  {meta.channels.includes('email') && (<>
                    <div className="text-xs text-gray-500 dark:text-slate-400">Subject: <span className="dark:text-slate-200">{preview.subject}</span></div>
                    <div className="mt-1 bg-white dark:bg-slate-800 rounded p-2 text-sm dark:text-slate-200 max-h-[26rem] overflow-auto" dangerouslySetInnerHTML={{ __html: preview.email_preview_html || preview.email_body }} />
                  </>)}
                  {meta.channels.includes('sms') && <div className="mt-2 text-sm dark:text-slate-200">📱 {preview.sms_body}</div>}
                  {meta.channels.includes('whatsapp') && <div className="mt-1 text-sm dark:text-slate-200">💬 {preview.whatsapp_body}</div>}
                  {meta.channels.includes('mms') && <div className="mt-1 text-sm dark:text-slate-200">🖼️ {preview.mms_body} <span className="text-xs text-gray-400">(+ ticket card image)</span></div>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {audit.length > 0 && (
        <div className="mt-6 border-t dark:border-slate-700 pt-3">
          <div className="text-[11px] font-semibold uppercase text-gray-400 dark:text-slate-500 mb-2">Recent changes</div>
          <ul className="space-y-1 text-xs text-gray-500 dark:text-slate-400">
            {audit.slice(0, 8).map((a, i) => (
              <li key={i}>{a.action === 'reset' ? 'Reset' : 'Saved'} <span className="font-mono">{a.template_key}</span> — {a.changed_by_email || 'unknown'} · {a.changed_at ? new Date(a.changed_at).toLocaleString() : ''}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// ── Broadcast panel ───────────────────────────────────────────────────────────

function BroadcastPanel({ event }) {
  const [msg, setMsg] = useState('')
  const [target, setTarget] = useState('all')
  const [channels, setChannels] = useState(['sms'])
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [err, setErr] = useState('')

  function toggleChannel(ch) {
    setChannels((p) => p.includes(ch) ? p.filter((c) => c !== ch) : [...p, ch])
  }

  const TARGET_LABELS = {
    all: 'all guests',
    admitted: 'checked-in guests',
    not_admitted: 'guests not yet checked in',
    confirmed: 'guests attending (RSVP yes)',
    declined: 'guests who declined',
    no_reply: 'guests with no RSVP reply',
  }

  async function send() {
    if (!msg.trim()) return
    if (channels.length === 0) { setErr('Select at least one channel'); return }
    if (!confirm(`Send broadcast to ${TARGET_LABELS[target] || 'selected guests'}?`)) return
    setLoading(true); setResult(null); setErr('')
    try {
      const res = await api.broadcast(event.id, { message: msg.trim(), target, channels })
      setResult(res)
      setMsg('')
    } catch (e) { setErr(e.message) }
    finally { setLoading(false) }
  }

  const inputCls = 'border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500'

  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6 space-y-4">
      <h2 className="font-semibold text-base dark:text-white">📣 Broadcast Message</h2>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Send an update to guests — running late, venue change, add-ons, etc.
      </p>

      <textarea
        rows={3}
        value={msg}
        onChange={(e) => setMsg(e.target.value)}
        placeholder="e.g. Doors open at 7pm. Parking on Main St."
        className={`w-full ${inputCls}`}
      />

      <div className="flex flex-wrap gap-4 items-center">
        <div>
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Send to</label>
          <select value={target} onChange={(e) => setTarget(e.target.value)} className={inputCls}>
            <option value="all">All guests</option>
            <option value="confirmed">RSVP: Attending</option>
            <option value="declined">RSVP: Declined</option>
            <option value="no_reply">RSVP: No reply</option>
            <option value="admitted">Checked in</option>
            <option value="not_admitted">Not yet checked in</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Channels</label>
          <div className="flex gap-3">
            {['email', 'sms', 'whatsapp'].map((ch) => (
              <label key={ch} className="flex items-center gap-1.5 text-sm cursor-pointer select-none text-slate-700 dark:text-slate-300">
                <input type="checkbox" checked={channels.includes(ch)} onChange={() => toggleChannel(ch)} className="w-4 h-4 accent-teal-600" />
                {ch.toUpperCase()}
              </label>
            ))}
          </div>
        </div>
      </div>

      {err && <div className="text-xs text-red-600 dark:text-red-400">{err}</div>}
      {result && (
        <div className="text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2">
          Queued: {result.queued} · Skipped (no contact): {result.skipped_no_contact} · Skipped (no consent): {result.skipped_no_consent}
          {result.skipped_no_credits ? ` · Skipped (out of credits): ${result.skipped_no_credits}` : ''}
        </div>
      )}

      <button onClick={send} disabled={loading || !msg.trim()}
        className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50">
        {loading ? 'Sending…' : '📤 Send Broadcast'}
      </button>
    </div>
  )
}

// ── Experience workflow panel ────────────────────────────────────────────────

const EXPERIENCE_STEP_TYPES = [
  ['custom', 'Custom'],
  ['check_in', 'Check-in'],
  ['consent', 'Consent'],
  ['seating_assignment', 'Seating assignment'],
  ['meal_selection', 'Meal selection'],
  ['souvenir', 'Souvenir'],
  ['badge', 'Badge'],
  ['room_assignment', 'Room assignment'],
  ['session_attendance', 'Session attendance'],
  ['certificate', 'Certificate'],
  ['checkout', 'Checkout'],
  ['rsvp', 'RSVP'],
  ['approval', 'Approval'],
]

function experienceGuestActionLabel(step, status) {
  if (status !== 'completed') {
    return {
      available: 'Available',
      blocked: 'Block',
      skipped: 'Skip',
      failed: 'Fail',
      overridden: 'Override',
    }[status] || status
  }
  if (step?.type === 'session_attendance') return 'Check in'
  if (step?.type === 'room_assignment') return 'Assign Room'
  return 'Complete'
}

const blankExperienceStep = () => ({
  key: '',
  type: 'custom',
  title: '',
  description: '',
  sort_order: 0,
  required: true,
  enabled: true,
  depends_on: '',
  guest_message: '',
  staff_prompt: '',
  completion_message: '',
  session_topic: '',
  session_date: '',
  session_start_time: '',
  session_end_time: '',
  session_room: '',
  session_speaker: '',
  session_capacity: '',
  session_checkin_window_minutes: '',
  room_assignment_mode: 'global',
  room_assignment_scope: '',
  room_assignment_room: '',
  room_assignment_table_group: '',
  conditions: '',
  config: '',
})

function normalizeSessionConfig(config = {}) {
  const raw = config.session || config.session_details || config.schedule || config.session_config
  const first = Array.isArray(config.sessions) ? config.sessions[0] : null
  const source = (raw && typeof raw === 'object' ? raw : null) || (first && typeof first === 'object' ? first : null) || {}
  const normalized = {
    topic: source.topic || source.title || source.name || '',
    date: source.date || source.session_date || '',
    start_time: source.start_time || source.startTime || source.start || '',
    end_time: source.end_time || source.endTime || source.end || '',
    room: source.room || source.location || source.venue || '',
    speaker: source.speaker || source.host || source.presenter || '',
    capacity: source.capacity ?? '',
    checkin_window_minutes: source.checkin_window_minutes ?? source.checkInWindowMinutes ?? source.checkin_window ?? '',
  }
  Object.keys(normalized).forEach((key) => {
    if (normalized[key] === '' || normalized[key] === null || Number.isNaN(normalized[key])) delete normalized[key]
  })
  return normalized
}

function normalizeRoomAssignmentConfig(config = {}) {
  const source = (config.room_assignment && typeof config.room_assignment === 'object')
    ? config.room_assignment
    : (config.assignment && typeof config.assignment === 'object')
      ? config.assignment
      : config
  const mode = source.mode || source.assignment_mode || (source.scoped || source.scope || source.assignment_scope ? 'scoped' : 'global')
  return {
    mode: String(mode || 'global').toLowerCase(),
    scope: source.assignment_scope || source.scope || '',
    room: source.room || source.hall || source.location || '',
    table_group: source.table_group || source.table_group_name || source.group || '',
  }
}

const EXPERIENCE_STEP_PRESETS = [
  {
    key: 'rsvp_approved',
    type: 'custom',
    title: 'RSVP approved',
    description: 'Guest has confirmed attendance and passed host approval.',
    required: true,
    config: { owner: 'host', source: 'guest_rsvp', visible_to_staff: true },
  },
  {
    key: 'main_check_in',
    type: 'check_in',
    title: 'Main entrance check-in',
    description: 'Admit the guest using their QR code or manual lookup.',
    required: true,
    config: { station: 'main_entrance', allow_manual_lookup: true, requires_event_pass: true },
  },
  {
    key: 'consent',
    type: 'consent',
    title: 'Consent',
    description: 'Guest signs the event consent form from their Festio Pass.',
    required: true,
    config: {
      owner: 'guest',
      guest_action: 'sign_consent',
      visible_to_staff: true,
      messages: {
        guest: 'Please review and sign the consent form from your Festio Pass before collecting gifts or souvenirs.',
        staff: 'Ask the guest to open their Festio Pass and sign the consent form.',
        complete: 'Consent signed.',
      },
    },
  },
  {
    key: 'seat_confirmed',
    type: 'seating_assignment',
    title: 'Seat confirmed',
    description: 'Confirm the guest table and seat before sending them into the dining area.',
    required: true,
    config: { show_table_name: true, show_seat_number: true },
  },
  {
    key: 'meal_confirmed',
    type: 'meal_selection',
    title: 'Meal confirmed',
    description: 'Confirm catering has the guest meal choice or dietary note.',
    required: false,
    config: { allow_staff_note: true, fallback_choice: 'Confirm at table' },
  },
  {
    key: 'welcome_pack',
    type: 'souvenir',
    title: 'Souvenir collected',
    description: 'Staff mark complete after consent is signed and the guest receives their souvenir, welcome pack, badge, or gift bag.',
    required: false,
    config: {
      station: 'gift_table',
      item: 'souvenir',
      prevent_duplicate_collection: true,
      depends_on: ['consent'],
      messages: {
        guest: 'Collect your souvenir after signing consent.',
        staff: 'Give the souvenir, welcome pack, badge, or gift bag, then mark this complete.',
        complete: 'Souvenir collected.',
      },
    },
  },
  {
    key: 'vip_host_greeting',
    type: 'custom',
    title: 'Host greeting complete',
    description: 'Mark complete after the host or protocol team has greeted the guest.',
    required: false,
    conditions: { guest_tags_include: ['vip'] },
    config: { owner: 'protocol_team', staff_prompt: 'Notify host before marking this complete.' },
  },
  {
    key: 'badge_pickup',
    type: 'badge',
    title: 'Badge pickup',
    description: 'Confirm badge, wristband, or credential pickup.',
    required: false,
    config: { station: 'registration' },
  },
  {
    key: 'session_attendance',
    type: 'session_attendance',
    title: 'Session attendance',
    description: 'Track guest attendance for a program segment or breakout.',
    required: false,
    config: {
      station: 'session_entry',
      session: {
        topic: 'Program session',
        date: '',
        start_time: '',
        end_time: '',
        room: '',
        speaker: '',
        capacity: null,
      },
      messages: {
        guest: 'Please proceed to the scheduled session and show your Festio Pass at the entrance.',
        staff: 'Confirm the guest is entering the correct session, then mark attendance complete.',
        complete: 'Session attendance recorded.',
      },
    },
  },
  {
    key: 'departure_noted',
    type: 'checkout',
    title: 'Departure noted',
    description: 'Mark complete when valet, transport, or guest departure is handled.',
    required: false,
    config: { station: 'exit', allow_note: true },
  },
]

const EXPERIENCE_WORKFLOW_TEMPLATES = [
  {
    id: 'vip_dinner',
    name: 'VIP Dinner Guest Journey',
    label: 'VIP dinner',
    description: 'RSVP approval, arrival, consent, seating, meal, souvenir, VIP greeting, and departure.',
    stepKeys: ['rsvp_approved', 'main_check_in', 'consent', 'seat_confirmed', 'meal_confirmed', 'welcome_pack', 'vip_host_greeting', 'departure_noted'],
  },
  {
    id: 'conference_registration',
    name: 'Conference Registration Journey',
    label: 'Conference',
    description: 'Registration desk flow with badge pickup, check-in, session attendance, and checkout.',
    stepKeys: ['rsvp_approved', 'badge_pickup', 'main_check_in', 'session_attendance', 'departure_noted'],
  },
  {
    id: 'wedding_reception',
    name: 'Wedding Reception Journey',
    label: 'Wedding reception',
    description: 'Guest admission, consent, table confirmation, meal handling, and gift pickup.',
    stepKeys: ['main_check_in', 'consent', 'seat_confirmed', 'meal_confirmed', 'welcome_pack'],
  },
  {
    id: 'simple_checkin',
    name: 'Simple Check-in Journey',
    label: 'Simple check-in',
    description: 'A minimal operational workflow for events that only need arrival tracking.',
    stepKeys: ['main_check_in'],
  },
]

const EXPERIENCE_PRESET_BY_KEY = Object.fromEntries(EXPERIENCE_STEP_PRESETS.map((preset) => [preset.key, preset]))

function listValue(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.map((v) => String(v).trim()).filter(Boolean)
  return String(raw).split(',').map((v) => v.trim()).filter(Boolean)
}

function listText(raw) {
  return listValue(raw).join(', ')
}

function toggleListText(raw, value) {
  const values = new Set(listValue(raw))
  values.has(value) ? values.delete(value) : values.add(value)
  return [...values].join(', ')
}

function sessionSummary(session = {}) {
  const parts = []
  if (session.topic) parts.push(session.topic)
  if (session.date) parts.push(session.date)
  if (session.start_time || session.end_time) parts.push([session.start_time, session.end_time].filter(Boolean).join('-'))
  if (session.room) parts.push(session.room)
  if (session.speaker) parts.push(`Speaker: ${session.speaker}`)
  if (session.capacity) parts.push(`Cap: ${session.capacity}`)
  if (session.checkin_window_minutes !== undefined && session.checkin_window_minutes !== '') parts.push(`Opens ${session.checkin_window_minutes}m before`)
  return parts.join(' · ')
}

function hasSessionDetails(session = {}) {
  return !!(session.topic || session.title || session.name || session.date || session.start_time || session.start || session.room || session.location)
}

function slugifyKey(value, fallback = 'session') {
  const key = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return key || fallback
}

function experienceStepPayload(preset, sortOrder = 10) {
  return {
    key: preset.key,
    type: preset.type,
    title: preset.title,
    description: preset.description,
    sort_order: sortOrder,
    required: preset.required,
    enabled: true,
    conditions: preset.conditions || null,
    config: preset.config || null,
  }
}

function ExperiencePanel({ event, onChanged, onFlash }) {
  const [workflows, setWorkflows] = useState([])
  const [dashboard, setDashboard] = useState(null)
  const [analytics, setAnalytics] = useState(null)
  const [guests, setGuests] = useState([])
  const [guestJourney, setGuestJourney] = useState(null)
  const [selectedGuestId, setSelectedGuestId] = useState('')
  const [guestJourneyOpen, setGuestJourneyOpen] = useState(true)
  const [workflowDetailsOpen, setWorkflowDetailsOpen] = useState(true)
  const [versionsOpen, setVersionsOpen] = useState(true)
  const [selectedId, setSelectedId] = useState('')
  const [stepForm, setStepForm] = useState(null)
  const [newName, setNewName] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [consentForm, setConsentForm] = useState({ title: 'Event consent', body: '', require_signature: true })
  const [consentSignatures, setConsentSignatures] = useState([])
  const [auditRows, setAuditRows] = useState([])
  const [consentOpen, setConsentOpen] = useState(false)
  const [workflowFilter, setWorkflowFilter] = useState('all')
  const [auditFilter, setAuditFilter] = useState('')
  const [sessionImportText, setSessionImportText] = useState('')
  const [draggedStepId, setDraggedStepId] = useState('')
  const [dragOverStepId, setDragOverStepId] = useState('')
  const [activeExperienceTab, setActiveExperienceTab] = useState('workflow')

  const fieldCls = 'border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white'
  const selected = workflows.find((w) => w.id === selectedId) || workflows[0]
  const isDraft = selected?.status === 'draft'
  const isArchived = selected?.status === 'archived'
  const publishedWorkflow = workflows.find((w) => w.status === 'published')
  const publishBlockedBy = isDraft && publishedWorkflow && publishedWorkflow.id !== selected?.id ? publishedWorkflow : null
  const activeWorkflow = dashboard?.workflow || selected
  const selectedGuest = guests.find((g) => g.id === selectedGuestId)
  const selectedGuestConsentSigned = !!consentSignatures.find((sig) => sig.guest_id === selectedGuestId)
  const filteredWorkflows = workflows.filter((w) => workflowFilter === 'all' || w.status === workflowFilter)
  const filteredAuditRows = auditRows.filter((row) => {
    const q = auditFilter.trim().toLowerCase()
    return !q || row.event_type.toLowerCase().includes(q) || row.source.toLowerCase().includes(q)
  })

  const storageKey = event?.id ? `festio:experience:${event.id}` : ''

  function rememberSelection(nextId = selectedId, nextFilter = workflowFilter) {
    if (!storageKey) return
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ selectedId: nextId || '', workflowFilter: nextFilter || 'all' }))
    } catch {
      // Session persistence is a convenience; ignore private-mode failures.
    }
  }

  function readRememberedSelection() {
    if (!storageKey) return {}
    try { return JSON.parse(sessionStorage.getItem(storageKey) || '{}') || {} }
    catch { return {} }
  }

  async function load(preferredId = selectedId) {
    if (!event?.id) return
    setErr('')
    try {
      const [data, dash, analyticsData, guestRows, form, signatures, audit] = await Promise.all([
        api.listExperienceWorkflows(event.id),
        api.getExperienceDashboard(event.id).catch(() => null),
        api.getExperienceAnalytics(event.id).catch(() => null),
        api.listGuests(event.id).catch(() => []),
        api.getConsentForm(event.id).catch(() => null),
        api.listConsentSignatures(event.id).catch(() => []),
        api.listExperienceAudit(event.id, 50).catch(() => []),
      ])
      setWorkflows(data)
      setDashboard(dash)
      setAnalytics(analyticsData)
      setGuests(guestRows)
      setConsentForm(form || { title: 'Event consent', body: '', require_signature: true })
      setConsentSignatures(signatures)
      setAuditRows(audit)
      if (data.length) {
        const remembered = readRememberedSelection()
        if (remembered.workflowFilter && remembered.workflowFilter !== workflowFilter) setWorkflowFilter(remembered.workflowFilter)
        const preferred = data.find((w) => w.id === preferredId)
        const rememberedWorkflow = data.find((w) => w.id === remembered.selectedId)
        const current = data.find((w) => w.id === selectedId)
        const published = data.find((w) => w.status === 'published')
        const next = preferred || rememberedWorkflow || current || published || data[0]
        setSelectedId(next.id)
        rememberSelection(next.id, remembered.workflowFilter || workflowFilter)
      } else {
        setSelectedId('')
      }
      if (guestRows.length) {
        const nextGuestId = selectedGuestId && guestRows.some((g) => g.id === selectedGuestId)
          ? selectedGuestId
          : guestRows[0].id
        setSelectedGuestId(nextGuestId)
        await loadGuestJourney(nextGuestId)
      } else {
        setSelectedGuestId('')
        setGuestJourney(null)
      }
    } catch (e) {
      setErr(e.message)
      setDashboard(null)
    }
  }

  async function loadGuestJourney(guestId = selectedGuestId) {
    if (!event?.id || !guestId) {
      setGuestJourney(null)
      return
    }
    try {
      setGuestJourney(await api.getGuestExperience(event.id, guestId))
    } catch (e) {
      setGuestJourney(null)
      setErr(e.message)
    }
  }

  useEffect(() => {
    const remembered = readRememberedSelection()
    if (remembered.workflowFilter) setWorkflowFilter(remembered.workflowFilter)
    load(remembered.selectedId || '')
    setStepForm(null)
    setNewName('')
  }, [event?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  function parseJsonMaybe(raw, label) {
    const text = (raw || '').trim()
    if (!text) return null
    try { return JSON.parse(text) }
    catch { throw new Error(`${label} must be valid JSON`) }
  }

  function stepToForm(step) {
    const config = step.config || {}
    const messages = config.messages || {}
    const session = normalizeSessionConfig(config)
    const assignment = normalizeRoomAssignmentConfig(config)
    return {
      id: step.id,
      key: step.key,
      type: step.type,
      title: step.title,
      description: step.description || '',
      sort_order: step.sort_order || 0,
      required: !!step.required,
      enabled: !!step.enabled,
      depends_on: listText(config.depends_on || config.depends_on_keys || config.prerequisites),
      guest_message: messages.guest || config.guest_message || '',
      staff_prompt: messages.staff || config.staff_prompt || '',
      completion_message: messages.complete || config.completion_message || '',
      session_topic: session.topic || '',
      session_date: session.date || '',
      session_start_time: session.start_time || '',
      session_end_time: session.end_time || '',
      session_room: session.room || '',
      session_speaker: session.speaker || '',
      session_capacity: session.capacity ?? '',
      session_checkin_window_minutes: session.checkin_window_minutes ?? '',
      room_assignment_mode: assignment.mode === 'scoped' ? 'scoped' : 'global',
      room_assignment_scope: assignment.scope || '',
      room_assignment_room: assignment.room || '',
      room_assignment_table_group: assignment.table_group || '',
      conditions: step.conditions ? JSON.stringify(step.conditions, null, 2) : '',
      config: step.config ? JSON.stringify(step.config, null, 2) : '',
    }
  }

  function formPayload() {
    if (!stepForm.key.trim() || !stepForm.title.trim()) throw new Error('Step key and title are required')
    const config = parseJsonMaybe(stepForm.config, 'Config') || {}
    const deps = listValue(stepForm.depends_on)
    if (deps.length) config.depends_on = deps
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
    } else {
      delete config.session
    }
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
      } else {
        assignment.scoped = true
      }
      Object.keys(assignment).forEach((key) => {
        if (assignment[key] === '' || assignment[key] === null || Number.isNaN(assignment[key])) delete assignment[key]
      })
      config.room_assignment = assignment
      delete config.assignment
    } else {
      delete config.room_assignment
    }
    return {
      key: stepForm.key.trim(),
      type: stepForm.type,
      title: stepForm.title.trim(),
      description: stepForm.description.trim() || null,
      sort_order: Number(stepForm.sort_order || 0),
      required: !!stepForm.required,
      enabled: !!stepForm.enabled,
      conditions: parseJsonMaybe(stepForm.conditions, 'Conditions'),
      config: Object.keys(config).length ? config : null,
    }
  }

  async function run(action, success) {
    setLoading(true); setErr('')
    try {
      const result = await action()
      if (success) onFlash?.(success)
      return result
    } catch (e) {
      setErr(e.message)
      return null
    } finally {
      setLoading(false)
    }
  }

  async function toggleExperience(active) {
    const updated = await run(() => api.toggleFeatures(event.id, { experience_enabled: active }), active ? 'Experience enabled.' : 'Experience disabled.')
    if (updated) onChanged(updated)
  }

  async function createDefault() {
    const workflow = await run(() => api.createDefaultExperienceWorkflow(event.id), 'Default workflow created.')
    if (workflow) {
      onChanged({ ...event, experience_enabled: true })
      await load(workflow.id)
    }
  }

  async function createWorkflow(e) {
    e.preventDefault()
    const workflow = await run(
      () => api.createExperienceWorkflow(event.id, { name: newName.trim() || 'New Experience', steps: [] }),
      'Workflow created.',
    )
    if (workflow) {
      setNewName('')
      await load(workflow.id)
    }
  }

  async function createWorkflowFromTemplate(template) {
    const steps = template.stepKeys.map((key, index) => experienceStepPayload(EXPERIENCE_PRESET_BY_KEY[key], (index + 1) * 10))
    const workflow = await run(
      () => api.createExperienceWorkflow(event.id, { name: template.name, steps }),
      `${template.name} created.`,
    )
    if (workflow) {
      onChanged({ ...event, experience_enabled: true })
      await load(workflow.id)
    }
  }

  async function addPresetStep(preset) {
    if (!selected || !isDraft) return
    const existing = new Set((selected.steps || []).map((step) => step.key))
    let payload = experienceStepPayload(preset, ((selected.steps?.length || 0) + 1) * 10)
    if (existing.has(payload.key)) {
      const suffix = selected.steps.length + 1
      payload = { ...payload, key: `${payload.key}_${suffix}`, title: `${payload.title} ${suffix}` }
    }
    const saved = await run(() => api.createExperienceStep(event.id, selected.id, payload), `${payload.title} added.`)
    if (saved) await load(selected.id)
  }

  async function importSessionSteps() {
    if (!selected || !isDraft) return
    let parsed
    try {
      parsed = JSON.parse(sessionImportText || '')
    } catch {
      setErr('Session import must be valid JSON')
      return
    }
    const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.sessions) ? parsed.sessions : []
    if (!rows.length) {
      setErr('Paste a JSON array of sessions, or an object with a sessions array.')
      return
    }
    const existing = new Set((selected.steps || []).map((step) => step.key))
    const baseOrder = Math.max(0, ...(selected.steps || []).map((step) => Number(step.sort_order) || 0))
    const payloads = rows.map((row, index) => {
      const session = normalizeSessionConfig({ session: row })
      const title = session.topic || row.title || row.name || `Session ${index + 1}`
      let key = slugifyKey(row.key || title, `session_${index + 1}`)
      let suffix = 2
      while (existing.has(key)) {
        key = `${slugifyKey(row.key || title, `session_${index + 1}`)}_${suffix}`
        suffix += 1
      }
      existing.add(key)
      return {
        key,
        type: 'session_attendance',
        title,
        description: row.description || 'Track guest attendance for a program segment or breakout.',
        sort_order: baseOrder + ((index + 1) * 10),
        required: row.required ?? true,
        enabled: row.enabled ?? true,
        conditions: row.conditions || null,
        config: {
          ...(row.config && typeof row.config === 'object' ? row.config : {}),
          session,
          messages: row.messages || {
            guest: 'Please proceed to the scheduled session and show your Festio Pass at the entrance.',
            staff: 'Confirm the guest is entering the correct session, then mark attendance complete.',
            complete: 'Session attendance recorded.',
          },
        },
      }
    })
    setLoading(true); setErr('')
    try {
      for (const payload of payloads) {
        await api.createExperienceStep(event.id, selected.id, payload)
      }
      setSessionImportText('')
      onFlash?.(`${payloads.length} session step${payloads.length === 1 ? '' : 's'} imported.`)
      await load(selected.id)
    } catch (e) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function saveStep(e) {
    e.preventDefault()
    const payload = (() => {
      try { return formPayload() }
      catch (error) { setErr(error.message); return null }
    })()
    if (!payload || !selected) return
    const saved = stepForm.id
      ? await run(() => api.updateExperienceStep(event.id, selected.id, stepForm.id, payload), 'Step updated.')
      : await run(() => api.createExperienceStep(event.id, selected.id, payload), 'Step added.')
    if (saved) {
      setStepForm(null)
      await load(selected.id)
    }
  }

  async function deleteStep(stepId) {
    if (!selected || !confirm('Delete this workflow step?')) return
    setLoading(true); setErr('')
    try {
      await api.deleteExperienceStep(event.id, selected.id, stepId)
      onFlash?.('Step deleted.')
      await load(selected.id)
    } catch (e) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function deleteWorkflow() {
    if (!selected || selected.status !== 'draft') return
    if (!confirm(`Delete draft workflow "${selected.name}"? This cannot be undone.`)) return
    setLoading(true); setErr('')
    try {
      await api.deleteExperienceWorkflow(event.id, selected.id)
      onFlash?.('Draft workflow deleted.')
      const remaining = workflows.filter((w) => w.id !== selected.id)
      await load(remaining[0]?.id || '')
    } catch (e) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function moveStep(index, direction) {
    if (!selected) return
    const ids = selected.steps.map((s) => s.id)
    const target = index + direction
    if (target < 0 || target >= ids.length) return
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    const updated = await run(() => api.reorderExperienceSteps(event.id, selected.id, ids), 'Step order saved.')
    if (updated) await load(selected.id)
  }

  async function dropStep(targetStepId) {
    if (!selected || !isDraft || !draggedStepId || draggedStepId === targetStepId) {
      setDraggedStepId('')
      setDragOverStepId('')
      return
    }
    const ids = selected.steps.map((s) => s.id)
    const from = ids.indexOf(draggedStepId)
    const to = ids.indexOf(targetStepId)
    if (from < 0 || to < 0) {
      setDraggedStepId('')
      setDragOverStepId('')
      return
    }
    ids.splice(to, 0, ids.splice(from, 1)[0])
    setDraggedStepId('')
    setDragOverStepId('')
    const updated = await run(() => api.reorderExperienceSteps(event.id, selected.id, ids), 'Step order saved.')
    if (updated) await load(selected.id)
  }

  async function saveConsent(e) {
    e.preventDefault()
    if (!consentForm.body.trim()) {
      setErr('Consent body is required')
      return
    }
    const saved = await run(
      () => api.saveConsentForm(event.id, {
        title: consentForm.title || 'Event consent',
        body: consentForm.body,
        require_signature: !!consentForm.require_signature,
      }),
      'Consent form saved.',
    )
    if (saved) await load(selected?.id)
  }

  async function exportProgress() {
    await run(() => api.downloadExperienceExport(event.id), 'Experience export downloaded.')
  }

  async function publish() {
    if (!selected || !confirm('Publish this workflow? Published workflows cannot be edited directly.')) return
    const workflow = await run(() => api.publishExperienceWorkflow(event.id, selected.id), 'Workflow published.')
    if (workflow) {
      onChanged({ ...event, experience_enabled: true })
      await load(workflow.id)
    }
  }

  async function unpublish() {
    if (!selected || !confirm(`Unpublish ${selected.name}? It will return to draft and stop being the live runbook.`)) return
    const workflow = await run(() => api.unpublishExperienceWorkflow(event.id, selected.id), 'Workflow unpublished.')
    if (workflow) {
      onChanged({ ...event, experience_enabled: false })
      await load(workflow.id)
    }
  }

  async function archiveWorkflow() {
    if (!selected || !confirm(`Archive ${selected.name}? It will be kept for history and removed from live use.`)) return
    const workflow = await run(() => api.archiveExperienceWorkflow(event.id, selected.id), 'Workflow archived.')
    if (workflow) {
      if (selected.status === 'published') onChanged({ ...event, experience_enabled: false })
      await load(workflow.id)
    }
  }

  async function unarchiveWorkflow() {
    if (!selected) return
    const workflow = await run(() => api.unarchiveExperienceWorkflow(event.id, selected.id), 'Workflow restored as draft.')
    if (workflow) await load(workflow.id)
  }

  async function clone() {
    if (!selected) return
    const name = prompt('Name for the draft copy', `${selected.name} copy`)
    if (name === null) return
    const workflow = await run(() => api.cloneExperienceWorkflow(event.id, selected.id, name.trim() || null), 'Workflow cloned.')
    if (workflow) await load(workflow.id)
  }

  async function updateGuestStep(step, status) {
    if (!selectedGuestId) return
    const reason = status === 'overridden' ? prompt('Override reason') : ''
    if (status === 'overridden' && reason === null) return
    const isSessionCheckIn = status === 'completed' && step?.type === 'session_attendance'
    const updated = await run(
      () => api.updateGuestExperienceStep(event.id, selectedGuestId, step.id, {
        status,
        override_reason: reason || null,
        metadata: {
          source: 'portal',
          ...(isSessionCheckIn ? { action: 'session_check_in' } : {}),
        },
      }),
      isSessionCheckIn ? 'Session check-in recorded.' : 'Guest journey updated.',
    )
    if (updated) {
      await Promise.all([loadGuestJourney(selectedGuestId), load(selected?.id)])
    }
  }

  async function resendGuestEmail(kind) {
    if (!selectedGuestId) return
    const labels = {
      invitation: 'Invitation resent.',
      admission: 'Admission email resent.',
      experience_next_steps: 'Experience steps email sent.',
      consent_copy: 'Consent copy resent.',
    }
    const sent = await run(() => api.resendGuestEmail(event.id, selectedGuestId, kind), labels[kind])
    if (sent) await load(selected?.id)
  }

  const progressByStep = new Map((guestJourney?.progress || []).map((p) => [p.step_id, p]))
  const journeySteps = (guestJourney?.workflow?.steps || activeWorkflow?.steps || []).slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
  const experienceTabs = [
    ['setup', 'Setup'],
    ['workflow', 'Workflow'],
    ['guests', 'Guests'],
    ['consent', 'Consent'],
    ['messages', 'Messages'],
    ['analytics', 'Analytics'],
  ]

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="font-semibold text-base dark:text-white">Experience workflow</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Configure attendee journey steps without changing the live scanner flow yet.</p>
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            <input type="checkbox" checked={!!event.experience_enabled} disabled={loading}
              onChange={(e) => toggleExperience(e.target.checked)}
              className="h-4 w-4 accent-teal-600" />
            Enabled
          </label>
        </div>
        {err && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

        <div className="mt-5 overflow-x-auto border-b border-slate-200 dark:border-slate-700">
          <div className="flex min-w-max gap-1">
            {experienceTabs.map(([key, label]) => (
              <button key={key} type="button" onClick={() => setActiveExperienceTab(key)}
                className={`rounded-t-lg px-4 py-2 text-sm font-semibold transition-colors ${
                  activeExperienceTab === key
                    ? 'bg-teal-50 text-teal-800 dark:bg-teal-900/30 dark:text-teal-100'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100'
                }`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {activeExperienceTab === 'setup' && (
          <>
            <div className="mt-5 flex flex-wrap gap-3">
              <button onClick={createDefault} disabled={loading}
                className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50">
                Create default workflow
              </button>
              <button type="button" onClick={exportProgress} disabled={loading || !dashboard?.workflow}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">
                Export progress
              </button>
              <form onSubmit={createWorkflow} className="flex min-w-[260px] flex-1 gap-2">
                <input className={`${fieldCls} min-w-0 flex-1`} value={newName}
                  onChange={(e) => setNewName(e.target.value)} placeholder="New workflow name" />
                <button disabled={loading} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">
                  Create
                </button>
              </form>
            </div>

            <div className="mt-5 border-t border-slate-200 pt-5 dark:border-slate-700">
              <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Workflow templates</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Create a complete draft workflow from a proven event pattern.</p>
                </div>
                {publishedWorkflow && (
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Live: <span className="font-semibold text-slate-700 dark:text-slate-200">{publishedWorkflow.name}</span>
                  </div>
                )}
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {EXPERIENCE_WORKFLOW_TEMPLATES.map((template) => (
                  <button key={template.id} type="button" onClick={() => createWorkflowFromTemplate(template)} disabled={loading}
                    className="rounded-lg border border-slate-200 p-3 text-left transition-colors hover:border-teal-300 hover:bg-teal-50 disabled:opacity-50 dark:border-slate-700 dark:hover:border-teal-800 dark:hover:bg-teal-900/20">
                    <div className="text-sm font-semibold text-slate-900 dark:text-white">{template.label}</div>
                    <div className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{template.description}</div>
                    <div className="mt-3 text-xs font-semibold text-teal-700 dark:text-teal-300">{template.stepKeys.length} steps</div>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {activeExperienceTab === 'analytics' && <div className="grid gap-4 sm:grid-cols-4">
        {[
          ['Guests', dashboard?.guest_total ?? 0],
          ['Steps', dashboard?.step_count ?? 0],
          ['Progress rows', dashboard?.progress_total ?? 0],
          ['Complete', `${dashboard?.completion_rate ?? 0}%`],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl bg-white p-4 text-center shadow dark:border dark:border-slate-700/60 dark:bg-slate-800">
            <div className="text-2xl font-bold text-teal-600 dark:text-teal-300">{value}</div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{label}</div>
          </div>
        ))}
      </div>}

      {activeExperienceTab === 'messages' && <MessageTemplatesPanel
        eventId={event.id}
        includeGroups={['Experience']}
        excludeGroups={[]}
        title="Experience messages"
        description="Customize messages generated by Experience workflows. These templates are separate from general invitations and day-of notices, but use the same placeholder and preview engine."
      />}

      {activeExperienceTab === 'analytics' && analytics?.workflow && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-xl bg-white p-4 shadow dark:border dark:border-slate-700/60 dark:bg-slate-800">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Consent completion</h3>
            <div className="mt-3 text-2xl font-bold text-teal-600 dark:text-teal-300">{analytics.consent?.rate ?? 0}%</div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {analytics.consent?.signed ?? 0} of {analytics.consent?.total ?? 0} guests signed
            </p>
          </div>
          <div className="rounded-xl bg-white p-4 shadow dark:border dark:border-slate-700/60 dark:bg-slate-800">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Top bottleneck</h3>
            {analytics.bottlenecks?.length ? (
              <>
                <div className="mt-3 text-sm font-bold text-slate-800 dark:text-slate-100">{analytics.bottlenecks[0].title}</div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {analytics.bottlenecks[0].open} open · {analytics.bottlenecks[0].completion_rate}% complete
                </p>
              </>
            ) : <p className="mt-3 text-sm text-slate-400">No bottlenecks yet.</p>}
          </div>
          <div className="rounded-xl bg-white p-4 shadow dark:border dark:border-slate-700/60 dark:bg-slate-800">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Overrides</h3>
            <div className="mt-3 text-2xl font-bold text-amber-600 dark:text-amber-300">{analytics.overrides?.length ?? 0}</div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Recent overridden steps in this workflow</p>
          </div>
        </div>
      )}

      {activeExperienceTab === 'consent' && <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="font-semibold text-base text-slate-900 dark:text-white">Consent form</h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Add a waiver, media release, or event terms for guests to sign from their pass.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-teal-50 px-2 py-1 text-xs font-semibold text-teal-700 dark:bg-teal-900/30 dark:text-teal-200">
              {consentSignatures.length} signed
            </span>
            <button type="button" onClick={() => setConsentOpen((v) => !v)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">
              {consentOpen ? 'Collapse' : 'Expand'}
            </button>
          </div>
        </div>
        {!consentOpen && consentForm?.body && (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
            Active: <span className="font-semibold">{consentForm.title}</span>
          </div>
        )}
        {consentOpen && (
          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
            <form onSubmit={saveConsent} className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">Title</span>
                <input className={`${fieldCls} w-full`} value={consentForm?.title || ''}
                  onChange={(e) => setConsentForm((f) => ({ ...f, title: e.target.value }))} placeholder="Event waiver and media consent" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">Form body</span>
                <textarea rows={8} className={`${fieldCls} w-full`}
                  value={consentForm?.body || ''}
                  onChange={(e) => setConsentForm((f) => ({ ...f, body: e.target.value }))}
                  placeholder="Paste the consent, release, waiver, or terms guests need to accept." />
              </label>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                  <input type="checkbox" checked={!!consentForm?.require_signature}
                    onChange={(e) => setConsentForm((f) => ({ ...f, require_signature: e.target.checked }))} className="h-4 w-4 accent-teal-600" />
                  Require typed signature
                </label>
                <button disabled={loading} className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50">
                  Save consent form
                </button>
              </div>
            </form>
            <div className="space-y-4">
              <div className="rounded-xl border border-teal-200 bg-teal-50 p-4 dark:border-teal-900 dark:bg-teal-900/20">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Guest preview</h4>
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">This is how the consent card appears on a guest pass.</p>
                  </div>
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold text-teal-700 dark:bg-slate-900 dark:text-teal-200">
                    v{consentForm?.version || 'new'}
                  </span>
                </div>
                <div className="mt-4 rounded-xl border border-teal-100 bg-white p-4 dark:border-teal-900 dark:bg-slate-900">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-slate-900 dark:text-white">{consentForm?.title || 'Event consent'}</p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Form version {consentForm?.version || 'new'}</p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-300">Unsigned</span>
                  </div>
                  <div className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                    {consentForm?.body?.trim() || 'Paste the consent, release, waiver, or terms guests need to accept.'}
                  </div>
                  <div className="mt-3 space-y-3">
                    <label className="block">
                      <span className="mb-1 block text-xs font-bold text-slate-600 dark:text-slate-300">Signer name</span>
                      <input disabled value="Guest Name"
                        className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400" />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-bold text-slate-600 dark:text-slate-300">Type your signature</span>
                      <input disabled value="Guest Name"
                        className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400" />
                    </label>
                    <button type="button" disabled
                      className="w-full rounded-lg bg-teal-600 px-4 py-2 text-sm font-bold text-white opacity-70">
                      Sign consent
                    </button>
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Recent signatures</h4>
                <div className="mt-3 space-y-2">
                  {consentSignatures.length === 0 ? (
                    <p className="text-sm text-slate-400">No signatures yet.</p>
                  ) : consentSignatures.slice(0, 6).map((sig) => {
                    const guest = guests.find((g) => g.id === sig.guest_id)
                    return (
                      <div key={sig.id} className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-900/50 dark:text-slate-300">
                        <div className="font-semibold">{sig.signer_name}</div>
                        <div className="mt-0.5 text-slate-400">
                          {guest ? `${guest.first_name} ${guest.last_name}` : sig.guest_id} · {new Date(sig.signed_at).toLocaleString()}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Recent activity</h4>
                <div className="mt-3 space-y-2">
                  <input className={`${fieldCls} mb-3 w-full`} value={auditFilter}
                    onChange={(e) => setAuditFilter(e.target.value)} placeholder="Filter activity" />
                  {filteredAuditRows.length === 0 ? (
                    <p className="text-sm text-slate-400">No Experience audit events yet.</p>
                  ) : filteredAuditRows.slice(0, 12).map((row) => (
                    <div key={row.id} className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-900/50 dark:text-slate-300">
                      <div className="font-semibold">{row.event_type.replaceAll('_', ' ')}</div>
                      <div className="mt-0.5 text-slate-400">{row.source} · {new Date(row.occurred_at).toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>}

      {activeExperienceTab === 'guests' && <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="font-semibold text-base text-slate-900 dark:text-white">Guest journey</h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Review and update one guest's workflow status.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {guestJourneyOpen && (
              <select className={`${fieldCls} min-w-[260px]`} value={selectedGuestId}
                onChange={(e) => { setSelectedGuestId(e.target.value); loadGuestJourney(e.target.value) }}>
                {guests.length === 0 && <option value="">No guests</option>}
                {guests.map((guest) => (
                  <option key={guest.id} value={guest.id}>
                    {guest.first_name} {guest.last_name}{guest.is_vip ? ' · VIP' : ''}
                  </option>
                ))}
              </select>
            )}
            <button type="button" onClick={() => setGuestJourneyOpen((v) => !v)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">
              {guestJourneyOpen ? 'Collapse' : 'Expand'}
            </button>
          </div>
        </div>

        {guestJourneyOpen && selectedGuest && (
          <div className="mt-4 flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <span className="font-semibold">{selectedGuest.first_name} {selectedGuest.last_name}</span>
              <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
                RSVP: {selectedGuest.rsvp_status || 'n/a'} · Check-in: {selectedGuest.admitted ? 'Admitted' : 'Not admitted'}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => resendGuestEmail('invitation')} disabled={loading || !selectedGuest.email}
                className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-white disabled:opacity-40 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
                Resend invite
              </button>
              <button type="button" onClick={() => resendGuestEmail('admission')} disabled={loading || !selectedGuest.email || !selectedGuest.admitted}
                className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-white disabled:opacity-40 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
                Resend admission
              </button>
              <button type="button" onClick={() => resendGuestEmail('experience_next_steps')} disabled={loading || !selectedGuest.email}
                className="rounded-lg bg-teal-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-40">
                Send Experience steps
              </button>
              <button type="button" onClick={() => resendGuestEmail('consent_copy')} disabled={loading || !selectedGuest.email || !selectedGuestConsentSigned}
                className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-white disabled:opacity-40 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800">
                Resend consent copy
              </button>
            </div>
          </div>
        )}

        {guestJourneyOpen && <div className="mt-4 space-y-3">
          {journeySteps.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-400 dark:border-slate-700">
              Publish a workflow and add guests to view journeys.
            </p>
          ) : journeySteps.map((step) => {
            const progress = progressByStep.get(step.id)
            const status = progress?.status || 'available'
            return (
              <div key={step.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-semibold text-slate-900 dark:text-white">{step.title}</h4>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold capitalize text-slate-600 dark:bg-slate-700 dark:text-slate-200">{status.replaceAll('_', ' ')}</span>
                      <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">{step.type.replaceAll('_', ' ')}</span>
                    </div>
                    {step.description && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{step.description}</p>}
                    {progress?.completed_at && <p className="mt-1 text-xs text-slate-400">Completed {new Date(progress.completed_at).toLocaleString()}</p>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {['completed', 'available', 'blocked', 'skipped', 'failed', 'overridden'].map((value) => (
                      <button key={value} onClick={() => updateGuestStep(step, value)} disabled={loading || !selectedGuestId || status === value}
                        className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">
                        {experienceGuestActionLabel(step, value)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )
          })}
        </div>}
      </div>}

      {activeExperienceTab === 'workflow' && <div className={`grid gap-6 ${versionsOpen ? 'xl:grid-cols-[18rem_1fr]' : 'xl:grid-cols-1'}`}>
        <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Versions</div>
            <div className="flex items-center gap-2">
              {versionsOpen && (
                <select className={`${fieldCls} py-1 text-xs`} value={workflowFilter} onChange={(e) => {
                  setWorkflowFilter(e.target.value)
                  rememberSelection(selected?.id, e.target.value)
                }}>
                  <option value="all">All</option>
                  <option value="published">Live</option>
                  <option value="draft">Draft</option>
                  <option value="archived">Archived</option>
                </select>
              )}
              <button type="button" onClick={() => setVersionsOpen((v) => !v)}
                className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">
                {versionsOpen ? 'Collapse' : 'Expand'}
              </button>
            </div>
          </div>
          {!versionsOpen ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {workflows.length} workflow version{workflows.length === 1 ? '' : 's'} hidden.
            </p>
          ) : filteredWorkflows.length === 0 ? (
            <p className="text-sm text-slate-400">No workflows yet.</p>
          ) : (
            <div className="space-y-2">
              {filteredWorkflows.map((w) => (
                <button key={w.id} onClick={() => { setSelectedId(w.id); rememberSelection(w.id, workflowFilter); setStepForm(null) }}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    selected?.id === w.id
                      ? 'border-teal-300 bg-teal-50 text-teal-900 dark:border-teal-800 dark:bg-teal-900/20 dark:text-teal-100'
                      : 'border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700'
                  }`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{w.name}</span>
                    <span className="text-xs">v{w.version}</span>
                  </div>
                  <div className="mt-1 text-xs capitalize text-slate-400">{w.status}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6">
          {!selected ? (
            <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">No workflow selected</h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Use a template above or create a blank workflow to start.</p>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-lg text-slate-900 dark:text-white">{selected.name}</h3>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${
                      isArchived
                        ? 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300'
                        : isDraft
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                        : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                    }`}>{selected.status}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500 dark:bg-slate-700 dark:text-slate-300">v{selected.version}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{selected.steps.length} step{selected.steps.length === 1 ? '' : 's'}</p>
                  {!isDraft && (
                    <p className="mt-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800 dark:border-green-900 dark:bg-green-900/20 dark:text-green-200">
                      {isArchived
                        ? 'Archived workflows are read-only until you unarchive them.'
                        : 'Published workflows are the live runbook. Unpublish to return it to draft, or clone it to edit the next version.'}
                    </p>
                  )}
                  {isDraft && (
                    <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
                      {publishBlockedBy
                        ? `Draft changes are not live. Unpublish ${publishBlockedBy.name} before publishing this version.`
                        : 'Draft changes are not live until you publish this version.'}
                    </p>
                  )}
	                </div>
	                <div className="flex flex-wrap gap-2">
	                  {isDraft && (
	                    <>
	                      <button onClick={() => setStepForm(blankExperienceStep())} disabled={loading}
	                        className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
	                        Add step
	                      </button>
	                      <button onClick={publish} disabled={loading || !!publishBlockedBy || selected.steps.filter((s) => s.enabled).length === 0}
	                        title={publishBlockedBy ? `Unpublish ${publishBlockedBy.name} first` : ''}
	                        className="rounded-lg bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50">
	                        Publish
	                      </button>
	                      <button onClick={deleteWorkflow} disabled={loading}
	                        className="rounded-lg border border-red-300 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-900/20">
	                        Delete draft
	                      </button>
	                    </>
	                  )}
                  {selected.status === 'published' && (
                    <button onClick={unpublish} disabled={loading}
                      className="rounded-lg border border-amber-300 px-3 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-900/20">
                      Unpublish
                    </button>
                  )}
                  {selected.status !== 'archived' && (
                    <button onClick={archiveWorkflow} disabled={loading}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">
                      Archive
                    </button>
                  )}
                  {selected.status === 'archived' && (
                    <button onClick={unarchiveWorkflow} disabled={loading}
                      className="rounded-lg border border-teal-300 px-3 py-2 text-sm font-semibold text-teal-700 hover:bg-teal-50 disabled:opacity-50 dark:border-teal-800 dark:text-teal-300 dark:hover:bg-teal-900/20">
                      Unarchive
                    </button>
                  )}
                  <button onClick={clone} disabled={loading}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">
                    Clone
                  </button>
                  <button type="button" onClick={() => setWorkflowDetailsOpen((v) => !v)}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">
                    {workflowDetailsOpen ? 'Collapse' : 'Expand'}
                  </button>
                </div>
              </div>

              {!workflowDetailsOpen && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
                  {selected.steps.length} step{selected.steps.length === 1 ? '' : 's'} hidden. Expand to edit steps, add presets, or review progress by step.
                </div>
              )}

              {workflowDetailsOpen && stepForm && (
                <form onSubmit={saveStep} className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/40">
                  {(() => {
                    const dependencyChoices = (selected?.steps || []).filter((step) => step.id !== stepForm.id && step.key !== stepForm.key)
                    return (
                      <>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">Key</span>
                      <input className={`${fieldCls} w-full`} value={stepForm.key}
                        onChange={(e) => setStepForm((f) => ({ ...f, key: e.target.value }))} placeholder="main_checkin" />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">Type</span>
                      <select className={`${fieldCls} w-full`} value={stepForm.type}
                        onChange={(e) => setStepForm((f) => ({ ...f, type: e.target.value }))}>
                        {EXPERIENCE_STEP_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">Title</span>
                      <input className={`${fieldCls} w-full`} value={stepForm.title}
                        onChange={(e) => setStepForm((f) => ({ ...f, title: e.target.value }))} placeholder="Main check-in" />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">Sort order</span>
                      <input type="number" className={`${fieldCls} w-full`} value={stepForm.sort_order}
                        onChange={(e) => setStepForm((f) => ({ ...f, sort_order: e.target.value }))} />
                    </label>
                    <label className="block md:col-span-2">
                      <span className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">Description</span>
                      <input className={`${fieldCls} w-full`} value={stepForm.description}
                        onChange={(e) => setStepForm((f) => ({ ...f, description: e.target.value }))} />
                    </label>
                    <div className="md:col-span-2 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Step dependencies</h4>
                          <p className="text-xs text-slate-500 dark:text-slate-400">Require another step to complete before this one appears to staff.</p>
                        </div>
                        {stepForm.depends_on && <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-700 dark:bg-teal-900/30 dark:text-teal-200">Depends on {stepForm.depends_on}</span>}
                      </div>
                      {dependencyChoices.length === 0 ? (
                        <p className="mt-3 text-xs text-slate-400">Add another step first to create dependencies.</p>
                      ) : (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {dependencyChoices.map((step) => {
                            const checked = listValue(stepForm.depends_on).includes(step.key)
                            return (
                              <label key={step.id} className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold ${
                                checked
                                  ? 'border-teal-300 bg-teal-50 text-teal-800 dark:border-teal-800 dark:bg-teal-900/30 dark:text-teal-100'
                                  : 'border-slate-300 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                              }`}>
                                <input type="checkbox" checked={checked}
                                  onChange={() => setStepForm((f) => ({ ...f, depends_on: toggleListText(f.depends_on, step.key) }))}
                                  className="h-4 w-4 accent-teal-600" />
                                {step.title}
                              </label>
                            )
                          })}
                        </div>
                      )}
                    </div>
                    <div className="md:col-span-2 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                      <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Experience step messages</h4>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">These messages belong to this step and can be used in guest emails, scanner prompts, and completion states.</p>
                      <div className="mt-3 grid gap-3 md:grid-cols-3">
                        <label className="block">
                          <span className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">Guest message</span>
                          <textarea rows={4} className={`${fieldCls} w-full`} value={stepForm.guest_message}
                            onChange={(e) => setStepForm((f) => ({ ...f, guest_message: e.target.value }))}
                            placeholder="What the guest should see for this step." />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">Staff scanner prompt</span>
                          <textarea rows={4} className={`${fieldCls} w-full`} value={stepForm.staff_prompt}
                            onChange={(e) => setStepForm((f) => ({ ...f, staff_prompt: e.target.value }))}
                            placeholder="What the official should do when this step appears." />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">Completion message</span>
                          <textarea rows={4} className={`${fieldCls} w-full`} value={stepForm.completion_message}
                            onChange={(e) => setStepForm((f) => ({ ...f, completion_message: e.target.value }))}
                            placeholder="What to show or record after completion." />
                        </label>
                      </div>
                    </div>
                    {stepForm.type === 'session_attendance' && (
                      <div className="md:col-span-2 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                        <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Session details</h4>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Use these fields to make this attendance step a real scheduled session.</p>
                        <div className="mt-3 grid gap-3 md:grid-cols-3">
                          <label className="block md:col-span-2">
                            <span className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">Topic</span>
                            <input className={`${fieldCls} w-full`} value={stepForm.session_topic}
                              onChange={(e) => setStepForm((f) => ({ ...f, session_topic: e.target.value }))}
                              placeholder="Building Event Operations with AI" />
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">Date</span>
                            <input type="date" className={`${fieldCls} w-full`} value={stepForm.session_date}
                              onChange={(e) => setStepForm((f) => ({ ...f, session_date: e.target.value }))} />
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">Start time</span>
                            <input type="time" className={`${fieldCls} w-full`} value={stepForm.session_start_time}
                              onChange={(e) => setStepForm((f) => ({ ...f, session_start_time: e.target.value }))} />
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">End time</span>
                            <input type="time" className={`${fieldCls} w-full`} value={stepForm.session_end_time}
                              onChange={(e) => setStepForm((f) => ({ ...f, session_end_time: e.target.value }))} />
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">Capacity</span>
                            <input type="number" min="0" className={`${fieldCls} w-full`} value={stepForm.session_capacity}
                              onChange={(e) => setStepForm((f) => ({ ...f, session_capacity: e.target.value }))}
                              placeholder="80" />
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">Check-in opens</span>
                            <input type="number" min="0" className={`${fieldCls} w-full`} value={stepForm.session_checkin_window_minutes}
                              onChange={(e) => setStepForm((f) => ({ ...f, session_checkin_window_minutes: e.target.value }))}
                              placeholder="60" />
                            <span className="mt-1 block text-[11px] text-slate-400">Minutes before start time. Leave blank for no time gate.</span>
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">Room / location</span>
                            <input className={`${fieldCls} w-full`} value={stepForm.session_room}
                              onChange={(e) => setStepForm((f) => ({ ...f, session_room: e.target.value }))}
                              placeholder="Hall B" />
                          </label>
                          <label className="block md:col-span-2">
                            <span className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">Speaker / host</span>
                            <input className={`${fieldCls} w-full`} value={stepForm.session_speaker}
                              onChange={(e) => setStepForm((f) => ({ ...f, session_speaker: e.target.value }))}
                              placeholder="Host Team" />
                          </label>
                        </div>
                      </div>
                    )}
                    {stepForm.type === 'room_assignment' && (
                      <div className="md:col-span-2 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                        <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Room assignment details</h4>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          Use scoped assignments when the same guest needs different seats for different sessions, halls, or days.
                        </p>
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          <label className="block">
                            <span className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">Assignment mode</span>
                            <select className={`${fieldCls} w-full`} value={stepForm.room_assignment_mode}
                              onChange={(e) => setStepForm((f) => ({ ...f, room_assignment_mode: e.target.value }))}>
                              <option value="global">Main guest seat</option>
                              <option value="scoped">Separate seat for this step</option>
                            </select>
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">Assignment scope</span>
                            <input className={`${fieldCls} w-full`} value={stepForm.room_assignment_scope}
                              onChange={(e) => setStepForm((f) => ({ ...f, room_assignment_scope: e.target.value }))}
                              placeholder="saturday_luncheon" />
                            <span className="mt-1 block text-[11px] text-slate-400">Required for scoped seating. Use one scope per hall/session seating plan.</span>
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">Room / hall</span>
                            <input className={`${fieldCls} w-full`} value={stepForm.room_assignment_room}
                              onChange={(e) => setStepForm((f) => ({ ...f, room_assignment_room: e.target.value }))}
                              placeholder="Luncheon Hall" />
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">Table group</span>
                            <input className={`${fieldCls} w-full`} value={stepForm.room_assignment_table_group}
                              onChange={(e) => setStepForm((f) => ({ ...f, room_assignment_table_group: e.target.value }))}
                              placeholder="Signature Luncheon" />
                            <span className="mt-1 block text-[11px] text-slate-400">Optional. Must match an existing seating table group name or tag.</span>
                          </label>
                        </div>
                      </div>
                    )}
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">Conditions JSON</span>
                      <textarea rows={4} className={`${fieldCls} w-full font-mono text-xs`} value={stepForm.conditions}
                        onChange={(e) => setStepForm((f) => ({ ...f, conditions: e.target.value }))} placeholder='{"ticket_type":"vip"}' />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">Config JSON</span>
                      <textarea rows={4} className={`${fieldCls} w-full font-mono text-xs`} value={stepForm.config}
                        onChange={(e) => setStepForm((f) => ({ ...f, config: e.target.value }))} placeholder='{"station":"north"}' />
                    </label>
                  </div>
                      </>
                    )
                  })()}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap gap-4">
                      <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                        <input type="checkbox" checked={!!stepForm.required}
                          onChange={(e) => setStepForm((f) => ({ ...f, required: e.target.checked }))} className="h-4 w-4 accent-indigo-600" />
                        Required
                      </label>
                      <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                        <input type="checkbox" checked={!!stepForm.enabled}
                          onChange={(e) => setStepForm((f) => ({ ...f, enabled: e.target.checked }))} className="h-4 w-4 accent-indigo-600" />
                        Enabled
                      </label>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setStepForm(null)}
                        className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">
                        Cancel
                      </button>
                      <button disabled={loading} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                        {stepForm.id ? 'Save step' : 'Add step'}
                      </button>
                    </div>
                  </div>
                </form>
              )}

              {workflowDetailsOpen && isDraft && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/40">
                  <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Step presets</h4>
                      <p className="text-xs text-slate-500 dark:text-slate-400">Add common operational steps without filling every field manually.</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {EXPERIENCE_STEP_PRESETS.map((preset) => (
                      <button key={preset.key} type="button" onClick={() => addPresetStep(preset)} disabled={loading}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-indigo-800 dark:hover:bg-indigo-900/20">
                        {preset.title}
                      </button>
                    ))}
                  </div>
                  <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h4 className="text-sm font-semibold text-slate-900 dark:text-white">Import program sessions</h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Paste a JSON array to create one session attendance step per program item.
                        </p>
                      </div>
                      <button type="button" onClick={importSessionSteps} disabled={loading || !sessionImportText.trim()}
                        className="rounded-lg bg-cyan-600 px-3 py-2 text-xs font-semibold text-white hover:bg-cyan-700 disabled:opacity-50">
                        Import sessions
                      </button>
                    </div>
                    <textarea rows={7} className={`${fieldCls} mt-3 w-full font-mono text-xs`} value={sessionImportText}
                      onChange={(e) => setSessionImportText(e.target.value)}
                      placeholder={`[
  {"topic":"Opening Keynote","date":"2026-07-28","start_time":"09:00","end_time":"10:00","room":"Main Hall","speaker":"Event Host","capacity":150,"checkin_window_minutes":60},
  {"topic":"Leadership Panel","date":"2026-07-28","start_time":"11:00","end_time":"11:45","room":"Lounge","speaker":"Community Team","capacity":60,"checkin_window_minutes":30}
]`} />
                  </div>
                </div>
              )}

              {workflowDetailsOpen && <div className="space-y-3">
                {selected.steps.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center dark:border-slate-700">
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">No steps in this workflow.</p>
                    <p className="mt-1 text-sm text-slate-400">Add a preset step or create a custom step to define the journey.</p>
                  </div>
                ) : selected.steps.map((step, index) => {
                  const config = step.config || {}
                  const messages = config.messages || {}
                  const session = normalizeSessionConfig(config)
                  const assignment = normalizeRoomAssignmentConfig(config)
                  const sessionInfo = sessionSummary(session)
                  const sessionReady = step.type === 'session_attendance' && hasSessionDetails(session)
                  const depends = listValue(config.depends_on || config.depends_on_keys || config.prerequisites)
                  const dependencyLabels = depends.map((key) => selected.steps.find((s) => s.key === key || s.id === key)?.title || key)
                  return (
                  <div key={step.id}
                    draggable={isDraft}
                    onDragStart={(e) => {
                      if (!isDraft) return
                      setDraggedStepId(step.id)
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('text/plain', step.id)
                    }}
                    onDragOver={(e) => {
                      if (!isDraft || !draggedStepId || draggedStepId === step.id) return
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'move'
                      setDragOverStepId(step.id)
                    }}
                    onDragLeave={() => setDragOverStepId((id) => id === step.id ? '' : id)}
                    onDrop={(e) => {
                      e.preventDefault()
                      dropStep(step.id)
                    }}
                    onDragEnd={() => { setDraggedStepId(''); setDragOverStepId('') }}
                    className={`rounded-xl border p-4 transition ${
                      dragOverStepId === step.id
                        ? 'border-teal-400 bg-teal-50/70 dark:border-teal-600 dark:bg-teal-900/20'
                        : 'border-slate-200 dark:border-slate-700'
                    } ${isDraft ? 'cursor-grab active:cursor-grabbing' : ''}`}>
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          {isDraft && <span title="Drag to reorder" className="text-sm font-bold text-slate-400">⋮⋮</span>}
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500 dark:bg-slate-700 dark:text-slate-300">{index + 1}</span>
                          <h4 className="font-semibold text-slate-900 dark:text-white">{step.title}</h4>
                          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">{step.type.replaceAll('_', ' ')}</span>
                          {!step.enabled && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-400 dark:bg-slate-700">Disabled</span>}
                          {step.required && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">Required</span>}
                        </div>
                        <div className="mt-1 text-xs font-mono text-slate-400">{step.key}</div>
                        {step.description && <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{step.description}</p>}
                        {step.type === 'session_attendance' && (
                          <div className={`mt-3 rounded-lg border px-3 py-2 text-xs font-semibold ${
                            sessionReady
                              ? 'border-cyan-200 bg-cyan-50 text-cyan-800 dark:border-cyan-900 dark:bg-cyan-900/20 dark:text-cyan-100'
                              : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-100'
                          }`}>
                            {sessionReady ? `Active session: ${sessionInfo}` : 'Setup needed: add topic, date/time, or room, then publish this workflow.'}
                          </div>
                        )}
                        {step.type === 'room_assignment' && (
                          <div className="mt-3 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs font-semibold text-cyan-800 dark:border-cyan-900 dark:bg-cyan-900/20 dark:text-cyan-100">
                            {assignment.mode === 'scoped'
                              ? `Scoped seating: ${assignment.scope || step.key}${assignment.room ? ` · ${assignment.room}` : ''}${assignment.table_group ? ` · ${assignment.table_group}` : ''}`
                              : `Main guest seat${assignment.table_group ? ` · ${assignment.table_group}` : ''}`}
                          </div>
                        )}
                        {(dependencyLabels.length > 0 || messages.guest || messages.staff || messages.complete) && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {dependencyLabels.length > 0 && (
                              <span className="rounded-full bg-teal-50 px-2 py-1 text-xs font-semibold text-teal-700 dark:bg-teal-900/30 dark:text-teal-200">
                                After: {dependencyLabels.join(', ')}
                              </span>
                            )}
                            {messages.guest && (
                              <span className="rounded-full bg-cyan-50 px-2 py-1 text-xs font-semibold text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-200">
                                Guest message
                              </span>
                            )}
                            {messages.staff && (
                              <span className="rounded-full bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-200">
                                Staff prompt
                              </span>
                            )}
                            {messages.complete && (
                              <span className="rounded-full bg-green-50 px-2 py-1 text-xs font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-200">
                                Completion text
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      {isDraft && (
                        <div className="flex shrink-0 flex-wrap gap-2">
                          <button onClick={() => moveStep(index, -1)} disabled={loading || index === 0}
                            className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">
                            Up
                          </button>
                          <button onClick={() => moveStep(index, 1)} disabled={loading || index === selected.steps.length - 1}
                            className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">
                            Down
                          </button>
                          <button onClick={() => setStepForm(stepToForm(step))}
                            className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">
                            Edit
                          </button>
                          <button onClick={() => deleteStep(step.id)} disabled={loading}
                            className="rounded-lg border border-red-300 px-2.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-40 dark:border-red-800 dark:hover:bg-red-900/20">
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  )
                })}
              </div>}

              {workflowDetailsOpen && dashboard?.steps?.length > 0 && (
                <div className="border-t border-slate-200 pt-5 dark:border-slate-700">
                  <h4 className="font-semibold text-slate-900 dark:text-white">Progress by step</h4>
                  <div className="mt-3 space-y-3">
                    {dashboard.steps.map((step) => (
                      <div key={step.step_id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{step.title}</div>
                            <div className="mt-0.5 text-xs text-slate-400">{step.type.replaceAll('_', ' ')}</div>
                          </div>
                          <div className="text-sm font-bold text-teal-600 dark:text-teal-300">{step.completion_rate}%</div>
                        </div>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                          <div className="h-full rounded-full bg-teal-500" style={{ width: `${Math.min(step.completion_rate, 100)}%` }} />
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 lg:grid-cols-7">
                          {[
                            ['Done', step.completed],
                            ['Available', step.available],
                            ['Blocked', step.blocked],
                            ['Skipped', step.skipped],
                            ['Overridden', step.overridden],
                            ['Failed', step.failed],
                            ['Total', step.total],
                          ].map(([label, value]) => (
                            <div key={label} className="rounded bg-slate-50 px-2 py-1 text-slate-600 dark:bg-slate-900/50 dark:text-slate-300">
                              <span className="font-semibold">{value}</span> {label}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>}
    </div>
  )
}

// ── Team panel ────────────────────────────────────────────────────────────────

function TeamPanel({ eventId }) {
  const [members, setMembers] = useState([])
  const [orgMembers, setOrgMembers] = useState([])
  const [groups, setGroups] = useState([])   // table groups = scanner sections
  const [selectedUserId, setSelectedUserId] = useState('')
  const [invite, setInvite] = useState({ email: '', role: 'staff' })
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')

  function loadOrgMembers() {
    api.listOrgMembers(eventId).then(setOrgMembers).catch((e) => setMsg(e.message))
  }

  useEffect(() => {
    api.listMembers(eventId).then(setMembers).catch(console.error)
    api.listTableGroups(eventId).then(setGroups).catch(() => setGroups([]))
    loadOrgMembers()
  }, [eventId])

  // Section assignment: which table groups a member may check guests into on the
  // scanner. Empty = all sections. Exactly one = that staffer auto-routes there.
  async function setSections(userId, ids) {
    setLoading(true)
    try {
      await api.setMemberSections(eventId, userId, ids)
      setMembers((prev) => prev.map((m) => m.user.id === userId ? { ...m, section_group_ids: ids } : m))
    } catch (e) { setMsg(e.message) }
    finally { setLoading(false) }
  }

  function toggleSection(m, gid) {
    const cur = m.section_group_ids || []
    setSections(m.user.id, cur.includes(gid) ? cur.filter((x) => x !== gid) : [...cur, gid])
  }

  const assignedIds = new Set(members.map((m) => m.user.id))
  const unassigned = orgMembers.map((om) => om.user).filter((u) => !assignedIds.has(u.id))

  async function inviteMember() {
    if (!invite.email.trim()) return
    setLoading(true); setMsg('')
    try {
      await api.inviteOrgMember(eventId, { email: invite.email.trim(), role: invite.role })
      setInvite({ email: '', role: 'staff' })
      loadOrgMembers()
      setMsg('Teammate added. They can now sign in and be assigned to events.')
      setTimeout(() => setMsg(''), 4000)
    } catch (e) { setMsg(e.message) }
    finally { setLoading(false) }
  }

  async function assign() {
    if (!selectedUserId) return
    setLoading(true)
    try {
      const m = await api.assignMember(eventId, selectedUserId)
      setMembers((prev) => [...prev, m])
      setSelectedUserId('')
      setMsg('Member assigned.')
      setTimeout(() => setMsg(''), 3000)
    } catch (e) { setMsg(e.message) }
    finally { setLoading(false) }
  }

  async function remove(userId) {
    setLoading(true)
    try {
      await api.removeMember(eventId, userId)
      setMembers((prev) => prev.filter((m) => m.user.id !== userId))
    } catch (e) { setMsg(e.message) }
    finally { setLoading(false) }
  }

  async function toggleSeatPerm(userId, current) {
    setLoading(true)
    try {
      await api.updateMemberPermissions(eventId, userId, { can_reassign_seats: !current })
      setMembers((prev) => prev.map((m) => m.user.id === userId ? { ...m, can_reassign_seats: !current } : m))
    } catch (e) { setMsg(e.message) }
    finally { setLoading(false) }
  }

  async function toggleMenuPerm(userId, current) {
    setLoading(true)
    try {
      await api.updateMemberPermissions(eventId, userId, { can_manage_menu: !current })
      setMembers((prev) => prev.map((m) => m.user.id === userId ? { ...m, can_manage_menu: !current } : m))
    } catch (e) { setMsg(e.message) }
    finally { setLoading(false) }
  }

  async function toggleDashPerm(userId, current) {
    setLoading(true)
    try {
      await api.updateMemberPermissions(eventId, userId, { can_view_dashboard: !current })
      setMembers((prev) => prev.map((m) => m.user.id === userId ? { ...m, can_view_dashboard: !current } : m))
    } catch (e) { setMsg(e.message) }
    finally { setLoading(false) }
  }

  async function updateEventAccess(userId, patch) {
    setLoading(true)
    try {
      await api.updateMemberPermissions(eventId, userId, patch)
      setMembers((prev) => prev.map((m) => m.user.id === userId ? { ...m, ...patch } : m))
      setMsg('Event access updated.')
      setTimeout(() => setMsg(''), 2500)
    } catch (e) { setMsg(e.message) }
    finally { setLoading(false) }
  }

  const roleTag = (role) => (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${role === 'admin' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300'}`}>
      {role}
    </span>
  )

  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6 space-y-4">
      <h2 className="font-semibold text-base dark:text-white">Event Team</h2>

      {members.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-slate-500">No members assigned yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-slate-700">
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between py-2.5 gap-2 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center text-indigo-700 dark:text-indigo-300 font-semibold text-sm">
                  {m.user.name[0].toUpperCase()}
                </div>
                <div>
                  <div className="text-sm font-medium dark:text-slate-100">{m.user.name}</div>
                  <div className="text-xs text-gray-400 dark:text-slate-500">{m.user.email}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {roleTag(m.user.role)}
                <select
                  value={m.event_role || 'staff'}
                  onChange={(e) => updateEventAccess(m.user.id, { event_role: e.target.value })}
                  disabled={loading}
                  title="Event-scoped access role"
                  className="text-xs border border-gray-300 dark:border-slate-600 rounded-full px-2 py-1 bg-white dark:bg-slate-700 dark:text-white disabled:opacity-50"
                >
                  <option value="staff">Staff</option>
                  <option value="manager">Event owner/admin</option>
                </select>
                {(m.event_role || 'staff') === 'manager' && (
                  <select
                    value={m.access_level || 'edit'}
                    onChange={(e) => updateEventAccess(m.user.id, { access_level: e.target.value })}
                    disabled={loading}
                    title="Edit or view-only access for this event"
                    className="text-xs border border-gray-300 dark:border-slate-600 rounded-full px-2 py-1 bg-white dark:bg-slate-700 dark:text-white disabled:opacity-50"
                  >
                    <option value="edit">Edit access</option>
                    <option value="view">View only</option>
                  </select>
                )}
                {m.user.role === 'official' && (
                  <>
                    <button
                      onClick={() => toggleSeatPerm(m.user.id, m.can_reassign_seats)}
                      disabled={loading}
                      title="Can reassign seats"
                      className={`text-xs px-2 py-0.5 rounded-full font-medium border transition-colors disabled:opacity-50 ${
                        m.can_reassign_seats
                          ? 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/40 dark:text-green-400 dark:border-green-800'
                          : 'bg-gray-100 text-gray-500 border-gray-200 dark:bg-slate-700 dark:text-slate-400 dark:border-slate-600'
                      }`}
                    >
                      Seats: {m.can_reassign_seats ? 'Yes' : 'No'}
                    </button>
                    <button
                      onClick={() => toggleMenuPerm(m.user.id, m.can_manage_menu)}
                      disabled={loading}
                      title="Can manage orders"
                      className={`text-xs px-2 py-0.5 rounded-full font-medium border transition-colors disabled:opacity-50 ${
                        m.can_manage_menu
                          ? 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/40 dark:text-green-400 dark:border-green-800'
                          : 'bg-gray-100 text-gray-500 border-gray-200 dark:bg-slate-700 dark:text-slate-400 dark:border-slate-600'
                      }`}
                    >
                      Orders: {m.can_manage_menu ? 'Yes' : 'No'}
                    </button>
                    <button
                      onClick={() => toggleDashPerm(m.user.id, m.can_view_dashboard)}
                      disabled={loading}
                      title="Can view the live dashboard"
                      className={`text-xs px-2 py-0.5 rounded-full font-medium border transition-colors disabled:opacity-50 ${
                        m.can_view_dashboard
                          ? 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/40 dark:text-green-400 dark:border-green-800'
                          : 'bg-gray-100 text-gray-500 border-gray-200 dark:bg-slate-700 dark:text-slate-400 dark:border-slate-600'
                      }`}
                    >
                      Dashboard: {m.can_view_dashboard ? 'Yes' : 'No'}
                    </button>
                  </>
                )}
                {groups.length > 0 && (
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-xs text-gray-400 dark:text-slate-500">Sections:</span>
                    <button
                      onClick={() => setSections(m.user.id, [])}
                      disabled={loading}
                      title="Can check guests into any section"
                      className={`text-xs px-2 py-0.5 rounded-full font-medium border transition-colors disabled:opacity-50 ${
                        (m.section_group_ids || []).length === 0
                          ? 'bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-300 dark:border-indigo-800'
                          : 'bg-gray-100 text-gray-500 border-gray-200 dark:bg-slate-700 dark:text-slate-400 dark:border-slate-600'
                      }`}
                    >
                      All
                    </button>
                    {groups.map((g) => {
                      const on = (m.section_group_ids || []).includes(g.id)
                      return (
                        <button key={g.id}
                          onClick={() => toggleSection(m, g.id)}
                          disabled={loading}
                          className={`text-xs px-2 py-0.5 rounded-full font-medium border transition-colors disabled:opacity-50 ${
                            on
                              ? 'bg-teal-100 text-teal-700 border-teal-200 dark:bg-teal-900/40 dark:text-teal-300 dark:border-teal-800'
                              : 'bg-gray-100 text-gray-500 border-gray-200 dark:bg-slate-700 dark:text-slate-400 dark:border-slate-600'
                          }`}
                        >
                          {g.name}
                        </button>
                      )
                    })}
                  </div>
                )}
                <button onClick={() => remove(m.user.id)} disabled={loading}
                  className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40 px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-950">
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Assign an existing org member to this event */}
      <div className="flex gap-2 pt-2 border-t dark:border-slate-700">
        <select value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)}
          className="flex-1 border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white">
          <option value="">— assign a teammate to this event —</option>
          {unassigned.map((u) => (
            <option key={u.id} value={u.id}>{u.name} · {u.email}</option>
          ))}
        </select>
        <button onClick={assign} disabled={loading || !selectedUserId}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
          Assign
        </button>
      </div>

      {/* Organization members & their roles */}
      <div className="pt-3 border-t dark:border-slate-700 space-y-2">
        <div className="text-xs font-semibold text-gray-500 dark:text-slate-400">Organization members &amp; roles</div>
        <ul className="divide-y divide-gray-100 dark:divide-slate-700">
          {orgMembers.map((m) => (
            <li key={m.user.id} className="flex items-center justify-between py-2 gap-2 text-sm">
              <span className="truncate min-w-0">
                <span className="font-medium dark:text-slate-100">{m.user.name}</span>
                <span className="text-gray-400 dark:text-slate-500"> · {m.user.email}</span>
              </span>
              <select value={m.role}
                onChange={async (e) => {
                  try { await api.setOrgMemberRole(eventId, m.user.id, e.target.value); loadOrgMembers(); setMsg('Role updated.'); setTimeout(() => setMsg(''), 2500) }
                  catch (err) { setMsg(err.message) }
                }}
                className="shrink-0 border border-gray-300 dark:border-slate-600 rounded-lg px-2 py-1 text-xs bg-white dark:bg-slate-700 dark:text-white">
                <option value="owner">Owner</option>
                <option value="admin">Admin</option>
                <option value="staff">Staff</option>
              </select>
            </li>
          ))}
        </ul>
        <p className="text-xs text-slate-400 dark:text-slate-500">Org Owners &amp; Admins can manage all org events. Staff can be promoted per event to Event owner/admin, with edit or view-only access.</p>
      </div>

      {/* Invite a new teammate to the organization by email */}
      <div className="pt-3 border-t dark:border-slate-700 space-y-2">
        <div className="text-xs font-semibold text-gray-500 dark:text-slate-400">Add a teammate to your organization</div>
        <div className="flex gap-2 flex-wrap">
          <input
            type="email"
            value={invite.email}
            onChange={(e) => setInvite((p) => ({ ...p, email: e.target.value }))}
            placeholder="teammate@email.com"
            className="flex-1 min-w-[180px] border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
          />
          <select value={invite.role} onChange={(e) => setInvite((p) => ({ ...p, role: e.target.value }))}
            className="border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white">
            <option value="staff">Staff (scan / day-of)</option>
            <option value="admin">Admin (manage events)</option>
          </select>
          <button onClick={inviteMember} disabled={loading || !invite.email.trim()}
            className="bg-teal-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-teal-700 disabled:opacity-50">
            Add teammate
          </button>
        </div>
        <p className="text-xs text-slate-400 dark:text-slate-500">
          They sign in with this email (Google/email) and the account links automatically.
          Staff also need assigning to a specific event above to scan it.
        </p>
      </div>
      {msg && <p className="text-sm text-indigo-600">{msg}</p>}
    </div>
  )
}

// ── EventForm ─────────────────────────────────────────────────────────────────

// NB: backend timestamps have no timezone suffix — parsing them with a bare
// `new Date()` reads them as LOCAL time, which made every edit+save cycle
// shift event_date by the viewer's UTC offset. utcToLocalInput tags them as
// UTC first, so the datetime-local round trip is stable.
const utcToLocal = utcToLocalInput

function EventForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(
    initial || { name: '', couples_name: '', event_date: '', description: '', admission_note: '', checkin_base_url: PUBLIC_BASE_URL }
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      await onSave({ ...form, event_date: new Date(form.event_date).toISOString() })
    } catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }

  const field = 'block w-full border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-700 text-gray-900 dark:text-white'

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="event-name" className="block text-xs font-semibold text-gray-600 mb-1">Event Name *</label>
          <input id="event-name" className={field} value={form.name} onChange={set('name')} required placeholder="Annual Gala / Acme Conference / Birthday Party" />
        </div>
        <div>
          <label htmlFor="event-host" className="block text-xs font-semibold text-gray-600 mb-1">Host / Organizer</label>
          <input id="event-host" className={field} value={form.couples_name} onChange={set('couples_name')} placeholder="e.g. Acme Corp, The Smiths, John &amp; Jane" />
        </div>
        <div>
          <label htmlFor="event-date" className="block text-xs font-semibold text-gray-600 mb-1">Event Date *</label>
          <input id="event-date" className={field} type="datetime-local" value={form.event_date?.slice(0, 16) || ''} onChange={set('event_date')} required />
        </div>
        <div>
          <label htmlFor="event-base-url" className="block text-xs font-semibold text-gray-600 mb-1">App Base URL *</label>
          <input id="event-base-url" className={field} value={form.checkin_base_url} onChange={set('checkin_base_url')} required placeholder="https://festio.events" />
        </div>
        <div>
          <label htmlFor="event-venue" className="block text-xs font-semibold text-gray-600 mb-1">Venue</label>
          <input id="event-venue" className={field} value={form.venue_name || ''} onChange={set('venue_name')} placeholder="e.g. Grand Ballroom" />
        </div>
        <div>
          <label htmlFor="event-venue-address" className="block text-xs font-semibold text-gray-600 mb-1">Venue address</label>
          <input id="event-venue-address" className={field} value={form.venue_address || ''} onChange={set('venue_address')} placeholder="Street, city" />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="event-admission-note" className="block text-xs font-semibold text-gray-600 mb-1">Admission note shown on invite page</label>
          <textarea
            id="event-admission-note"
            className={field}
            rows={2}
            value={form.admission_note || ''}
            onChange={set('admission_note')}
            placeholder="e.g. Show your QR pass at the entrance for check-in."
          />
        </div>
      </div>
      <div>
        <label htmlFor="event-description" className="block text-xs font-semibold text-gray-600 mb-1">Description</label>
        <textarea id="event-description" className={field} rows={2} value={form.description || ''} onChange={set('description')} />
      </div>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <div className="flex gap-3">
        <button type="submit" disabled={saving}
          className="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
          {saving ? 'Saving…' : initial ? 'Save Changes' : 'Create Event'}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="px-5 py-2 rounded-lg border border-gray-300 dark:border-slate-700 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-slate-700 dark:text-slate-200">
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}

function relativeTime(iso) {
  if (!iso) return 'never'
  const t = new Date(iso).getTime()
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function SourceSyncPanel({ event, onSave, onSyncNow, onToggleSync, loading }) {
  const [url, setUrl] = useState(event.source_url || '')
  const [interval, setInterval] = useState(event.source_sync_interval_seconds || 60)
  const [tick, setTick] = useState(0)

  useEffect(() => { setUrl(event.source_url || '') }, [event.id, event.source_url])
  useEffect(() => { setInterval(event.source_sync_interval_seconds || 60) }, [event.id, event.source_sync_interval_seconds])

  // Re-render once a second so "X seconds ago" stays live.
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000)
    return () => window.clearInterval(id)
  }, [])

  const dirty = url.trim() !== (event.source_url || '') ||
    Number(interval) !== (event.source_sync_interval_seconds || 60)
  // Master switch — backfilled true for existing events, so treat undefined as on.
  const enabled = event.source_sync_enabled !== false
  const polling = event.status === 'active' && !!event.source_url && enabled

  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-semibold text-base dark:text-white">Guest spreadsheet sync</h2>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
            Paste a Google Sheets or OneDrive share link. While the event is <strong>Active</strong>,
            Festio checks it every {event.source_sync_interval_seconds || 60} seconds and adds new guests.
            Existing guests stay untouched.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {polling && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-green-50 dark:bg-green-900/40 text-green-700 dark:text-green-300">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              Listening
            </span>
          )}
          {!enabled && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              Paused
            </span>
          )}
          {/* Master on/off — pauses the poll without clearing the URL. */}
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={() => onToggleSync?.(!enabled)}
            title={enabled ? 'Sync is on — click to pause' : 'Sync is paused — click to resume'}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${enabled ? 'bg-green-500' : 'bg-gray-300 dark:bg-slate-600'}`}>
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-5' : 'translate-x-1'}`} />
          </button>
          <span className="text-xs font-medium text-gray-600 dark:text-slate-300 w-14">{enabled ? 'Sync On' : 'Sync Off'}</span>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://1drv.ms/x/… or https://docs.google.com/spreadsheets/d/…"
          className="flex-1 border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
        />
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500 dark:text-slate-400 whitespace-nowrap">Every</label>
          <input
            type="number"
            min={15}
            max={3600}
            value={interval}
            onChange={(e) => setInterval(Number(e.target.value) || 60)}
            className="w-20 border border-gray-300 dark:border-slate-700 rounded-lg px-2 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
          />
          <span className="text-xs text-gray-500 dark:text-slate-400">sec</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => onSave(url.trim(), Number(interval) || 60)}
          disabled={!dirty}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
          Save
        </button>
        <button
          onClick={onSyncNow}
          disabled={loading || !event.source_url || !enabled}
          title={!enabled ? 'Turn Sync on to poll the spreadsheet' : undefined}
          className="bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-200 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-slate-600 disabled:opacity-50">
          {loading ? 'Syncing…' : 'Sync now'}
        </button>
        {event.source_url && (
          <button
            onClick={() => { setUrl(''); onSave('', Number(interval) || 60) }}
            className="text-xs text-red-500 hover:text-red-700 hover:underline px-2 py-2">
            Clear URL
          </button>
        )}
        <span className="text-xs text-gray-500 dark:text-slate-400 ml-auto" key={tick}>
          Last sync: <strong>{relativeTime(event.source_last_sync_at)}</strong>
        </span>
      </div>

      {event.source_last_error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-lg px-3 py-2 text-xs">
          {event.source_last_error}
        </div>
      )}
      {!event.source_last_error && event.source_last_warning && (
        <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 rounded-lg px-3 py-2 text-xs">
          ⚠ {event.source_last_warning}
        </div>
      )}
      {!enabled && event.source_url && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Sync is paused. The spreadsheet link is saved but won’t be polled until you turn Sync on.
        </p>
      )}
      {enabled && !polling && event.source_url && (
        <p className="text-xs text-gray-400 dark:text-slate-500">
          Auto-sync starts when you set the event to <strong>Active</strong>.
        </p>
      )}
    </div>
  )
}

function Badge({ on, labels }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${on ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400' : 'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-400'}`}>
      {on ? labels[0] : labels[1]}
    </span>
  )
}

function EmailDeliveryBadge({ guest }) {
  const status = guest?.email_delivery_status
  if (!status) {
    return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-400">No event</span>
  }
  const map = {
    delivered: { label: 'Delivered', cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
    opened: { label: 'Opened', cls: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300' },
    clicked: { label: 'Clicked', cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' },
    sent: { label: 'Sent', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300' },
    delivery_delayed: { label: 'Delayed', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
    bounced: { label: 'Bounced', cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
    failed: { label: 'Failed', cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
    complained: { label: 'Complaint', cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
    suppressed: { label: 'Suppressed', cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
  }
  const c = map[status] || { label: status.replace(/_/g, ' '), cls: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300' }
  const when = guest.email_delivery_at ? new Date(guest.email_delivery_at).toLocaleString() : ''
  const title = [guest.email_delivery_event_type, guest.email_delivery_kind, when].filter(Boolean).join(' · ')
  return <span title={title} className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${c.cls}`}>{c.label}</span>
}

function MessageDeliveryBadge({ guest, channel }) {
  const status = guest?.[`${channel}_delivery_status`]
  if (!status) {
    return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-400">Not sent</span>
  }
  const key = status.toLowerCase()
  const delivered = ['delivered', 'read'].includes(key)
  const failed = ['failed', 'undelivered', 'rejected', 'error', 'refunded'].includes(key)
  const label = delivered ? (key === 'read' ? 'Read' : 'Delivered') : failed ? 'Failed' : key === 'posted' ? 'Queued' : key.replace(/_/g, ' ')
  const cls = delivered
    ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
    : failed
      ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
      : 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300'
  const at = guest?.[`${channel}_delivery_at`]
  const provider = guest?.[`${channel}_provider`]
  const title = [provider, at ? new Date(at).toLocaleString() : ''].filter(Boolean).join(' · ')
  return <span title={title} className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${cls}`}>{label}</span>
}

function OnboardingChecklist({ event, stats, onTab }) {
  const key = `onb_${event.id}`
  // Non-destructive: "Hide" collapses to a re-expandable progress pill rather
  // than deleting the only guide. We persist the collapsed state, never a
  // permanent dismissal.
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(key) === '1')
  // Required steps gate a working event — these drive completion and the
  // "You're all set" state.
  const required = [
    { label: 'Create your event', done: true },
    { label: 'Import your guests', action: 'Import guests', hint: 'Upload a spreadsheet, connect Google Sheets, or download the template to fill in.', done: stats.total > 0, tab: 'overview' },
    { label: 'Turn on the RSVP form', action: 'Set up RSVP', hint: 'Let guests confirm or decline straight from their invite.', done: !!event.rsvp_enabled, tab: 'invite' },
    { label: 'Send invitations', action: 'Send invites', hint: 'Email, SMS, or WhatsApp each guest their personal pass.', done: stats.invited > 0, tab: 'invite' },
    { label: 'Enable check-in with an Event Pass', action: 'Choose pass', hint: 'Activate door scanning by choosing an Event Pass.', done: !!event.is_paid, tab: 'invite' },
  ]
  // Optional — a discovery nudge only. Never counts toward completion, so a host
  // who doesn't want extras can still reach 100%.
  const optional = [
    { label: 'Turn on your event extras', action: 'Add extras', hint: 'Optional: seating, orders, deliveries, gift list, or entry rules.', done: !!(event.seating_enabled || event.menu_enabled || event.logistics_enabled || event.registry_enabled || event.venue_access_enabled), tab: 'features' },
  ]
  const doneCount = required.filter((i) => i.done).length
  const pct = Math.round((doneCount / required.length) * 100)
  const allDone = doneCount === required.length
  // The single required step we actively guide the user toward right now.
  const currentIdx = required.findIndex((i) => !i.done)

  function setCollapsedPersist(v) {
    if (v) localStorage.setItem(key, '1'); else localStorage.removeItem(key)
    setCollapsed(v)
  }

  // Shared row renderer. `isCurrent` gets the highlighted card + inline primary
  // button; `optional` rows show their hint muted instead.
  const renderRow = (it, { isCurrent = false, optional = false } = {}) => {
    // The current step shows its own primary button, so its row isn't clickable
    // — avoids an interactive element nested in another.
    const rowClickable = !it.done && it.tab && !isCurrent
    return (
      <div
        onClick={rowClickable ? () => onTab(it.tab) : undefined}
        onKeyDown={rowClickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTab(it.tab) } } : undefined}
        role={rowClickable ? 'button' : undefined}
        tabIndex={rowClickable ? 0 : undefined}
        className={`rounded-lg px-2.5 py-2 transition-colors ${rowClickable ? 'cursor-pointer hover:bg-teal-100/70 dark:hover:bg-teal-800/30' : ''} ${isCurrent ? 'bg-white dark:bg-slate-800/70 ring-1 ring-teal-300 dark:ring-teal-700 shadow-sm' : ''}`}
      >
        <div className="flex items-center gap-3 text-sm">
          <span className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold ${it.done ? 'bg-teal-600 text-white' : 'border-2 border-slate-300 dark:border-slate-600 text-transparent'}`}>✓</span>
          <span className={`flex-1 ${it.done ? 'text-slate-400 line-through' : isCurrent ? 'font-semibold text-slate-900 dark:text-white' : 'text-slate-700 dark:text-slate-200'}`}>{it.label}</span>
          {rowClickable && (
            <span className="text-xs font-semibold text-teal-600">{it.action} →</span>
          )}
        </div>
        {isCurrent && it.hint && (
          <div className="mt-1.5 pl-8 flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500 dark:text-slate-400">{it.hint}</p>
            <button onClick={() => onTab(it.tab)}
              className="shrink-0 bg-teal-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-teal-700">{it.action} →</button>
          </div>
        )}
        {optional && !it.done && it.hint && (
          <p className="mt-1 pl-8 text-xs text-slate-400 dark:text-slate-500">{it.hint}</p>
        )}
      </div>
    )
  }

  // Collapsed → a thin progress pill that re-expands on click (never a dead end).
  if (collapsed) {
    return (
      <button onClick={() => setCollapsedPersist(false)}
        className="w-full flex items-center gap-3 rounded-xl border border-teal-200 dark:border-teal-800 bg-teal-50/60 dark:bg-teal-900/20 px-4 py-2.5 text-left hover:bg-teal-100/60 dark:hover:bg-teal-800/30 transition-colors">
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{allDone ? "You're all set" : 'Finish setup'}</span>
        <div className="flex-1 h-1.5 rounded-full bg-teal-100 dark:bg-teal-900/40 overflow-hidden">
          <div className="h-full bg-teal-600 transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-xs text-slate-500 dark:text-slate-400">{doneCount}/{required.length}</span>
      </button>
    )
  }

  return (
    <div className="rounded-2xl border border-teal-200 dark:border-teal-800 bg-teal-50/60 dark:bg-teal-900/20 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-slate-900 dark:text-white">{allDone ? "You're all set" : 'Get this event ready'}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{doneCount} of {required.length} complete</p>
        </div>
        <button onClick={() => setCollapsedPersist(true)}
          className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">{allDone ? 'Dismiss' : 'Hide'}</button>
      </div>
      <div className="mt-3 h-2 rounded-full bg-teal-100 dark:bg-teal-900/40 overflow-hidden">
        <div className="h-full bg-teal-600 transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
      <ul className="mt-4 space-y-1.5">
        {required.map((it, i) => (
          <li key={i}>{renderRow(it, { isCurrent: i === currentIdx })}</li>
        ))}
      </ul>
      <div className="mt-3 pt-3 border-t border-teal-200/70 dark:border-teal-800/70">
        <p className="px-2.5 mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Optional</p>
        <ul className="space-y-1.5">
          {optional.map((it, i) => (
            <li key={i}>{renderRow(it, { optional: true })}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function RsvpStatusBadge({ status }) {
  const map = {
    confirmed: { label: '✓ Attending', cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
    declined:  { label: '✗ Declined',  cls: 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300' },
    pending:   { label: '⏳ Pending',   cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
    invited:   { label: 'No reply',    cls: 'bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-400' },
  }
  const c = map[status] || map.invited
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${c.cls}`}>{c.label}</span>
}

// ── AdminPage ─────────────────────────────────────────────────────────────────

// ── Trial / plans onboarding banner ───────────────────────────────────────────
function trialMoney(amount, currency) {
  const major = (amount || 0) / 100
  return currency === 'NGN' ? `₦${major.toLocaleString()}` : `$${major.toLocaleString()}`
}

function TrialBanner({ events, user, onCreateDraft }) {
  const [tiers, setTiers] = useState([])
  const [requests, setRequests] = useState(null)   // null = loading
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ contact_name: '', phone: '', event_name: '', guest_count: '', use_case: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    api.getPricing().then((d) => setTiers(d.tiers || [])).catch(() => {})
    api.myTrialRequests().then(setRequests).catch(() => setRequests([]))
  }, [])

  useEffect(() => {
    if (user?.name) setForm((f) => ({ ...f, contact_name: f.contact_name || user.name }))
  }, [user])

  // Already paying for something → nothing to upsell here.
  const hasPaid = events.some((e) => e.is_paid)
  if (hasPaid || requests === null) return null

  const pending = requests.find((r) => r.status === 'pending')
  const approved = requests.find((r) => r.status === 'approved')

  async function submit() {
    setBusy(true); setMsg('')
    try {
      await api.submitTrialRequest({
        contact_name: form.contact_name,
        phone: form.phone || null,
        event_name: form.event_name || null,
        guest_count: form.guest_count ? Number(form.guest_count) : null,
        use_case: form.use_case || null,
      })
      setRequests(await api.myTrialRequests())
      setShowForm(false)
    } catch (e) { setMsg(e.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="rounded-2xl border border-teal-200 dark:border-teal-800 bg-teal-50/60 dark:bg-teal-900/20 p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-bold text-lg text-slate-900 dark:text-white">Create your draft event</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300 mt-1 max-w-2xl">
            Start with the free RSVP and email workflow for up to 25 guests. Design Studio, QR check-in,
            SMS/WhatsApp, seating, access rules, logistics, registry, and Experience workflows unlock with an Event Pass.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={onCreateDraft}
            className="shrink-0 bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg text-sm font-semibold">
            Create draft event
          </button>
          {approved ? (
            <span className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 text-xs font-semibold">
              Trial approved — check your events
            </span>
          ) : pending ? (
            <span className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-xs font-semibold">
              Trial request received — we’ll be in touch
            </span>
          ) : (
            <button onClick={() => setShowForm((v) => !v)}
              className="shrink-0 border border-teal-300 text-teal-700 hover:bg-teal-50 dark:border-teal-700 dark:text-teal-200 dark:hover:bg-teal-950/40 px-4 py-2 rounded-lg text-sm font-semibold">
              Request trial credits
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
          <div className="text-xs font-black uppercase tracking-wide text-slate-400 dark:text-slate-500">Free event</div>
          <h3 className="mt-1 text-sm font-bold text-slate-950 dark:text-white">RSVP and email only</h3>
          <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">
            Create a draft, publish a basic RSVP page, send email invitations, and manage up to 25 guests with Festio branding.
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
          <div className="text-xs font-black uppercase tracking-wide text-teal-600 dark:text-teal-300">Event Pass</div>
          <h3 className="mt-1 text-sm font-bold text-slate-950 dark:text-white">Operations and branded tools</h3>
          <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">
            Activate paid modules when you need Design Studio, QR check-in, SMS/WhatsApp, seating, access zones, registry, logistics, or Experience.
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
          <div className="text-xs font-black uppercase tracking-wide text-amber-600 dark:text-amber-300">How checkout works</div>
          <h3 className="mt-1 text-sm font-bold text-slate-950 dark:text-white">Draft first, pay at activation</h3>
          <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">
            The setup wizard asks for guest count, currency, channels, and modules, then recommends the smallest pass that fits.
          </p>
        </div>
      </div>

      {/* Plan tiers */}
      {tiers.length > 0 && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {tiers.map((t) => (
            <div key={t.key} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3">
              <div className="font-semibold text-sm text-slate-900 dark:text-white">{t.name || t.label}</div>
              <div className="text-xl font-extrabold text-teal-700 dark:text-teal-300">{trialMoney(t.amount, t.currency)}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {t.guest_cap ? `Up to ${t.guest_cap.toLocaleString()} guests` : 'Custom guest volume'} · {t.credits.toLocaleString()} credits
              </div>
            </div>
          ))}
        </div>
      )}
      <a href="/pricing" target="_blank" rel="noopener noreferrer" className="inline-block text-xs text-teal-700 dark:text-teal-300 hover:underline">
        See full pricing →
      </a>

      {/* Request form */}
      {showForm && !pending && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-600 dark:text-slate-300 text-xs font-semibold">Your name</span>
              <input value={form.contact_name} onChange={(e) => setForm((f) => ({ ...f, contact_name: e.target.value }))}
                className="mt-1 w-full border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-white" placeholder="Jane Doe" />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600 dark:text-slate-300 text-xs font-semibold">Phone</span>
              <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                className="mt-1 w-full border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-white" placeholder="+1 832 555 0100" />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600 dark:text-slate-300 text-xs font-semibold">Event</span>
              <input value={form.event_name} onChange={(e) => setForm((f) => ({ ...f, event_name: e.target.value }))}
                className="mt-1 w-full border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-white" placeholder="e.g. Spring Gala" />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600 dark:text-slate-300 text-xs font-semibold">Expected guests</span>
              <input type="number" min="0" value={form.guest_count} onChange={(e) => setForm((f) => ({ ...f, guest_count: e.target.value }))}
                className="mt-1 w-full border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-white" placeholder="120" />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600 dark:text-slate-300 text-xs font-semibold">What do you want to try?</span>
              <input value={form.use_case} onChange={(e) => setForm((f) => ({ ...f, use_case: e.target.value }))}
                className="mt-1 w-full border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-900 text-slate-900 dark:text-white" placeholder="SMS invites, check-in, venue zones…" />
            </label>
          </div>
          {msg && <p className="text-xs text-red-500">{msg}</p>}
          <div className="flex gap-2">
            <button onClick={submit} disabled={busy || !form.contact_name.trim()}
              className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50">
              {busy ? 'Sending…' : 'Send request'}
            </button>
            <button onClick={() => setShowForm(false)} className="text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 px-3">Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

// Grouped left-rail navigation (replaces the flat tab strip). Collapses to a
// labelled dropdown on mobile.
function Sidebar({ active, onChange, groups }) {
  return (
    <>
      <label htmlFor="setup-section" className="lg:hidden block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
        Setup section
      </label>
      <select
        id="setup-section"
        className="lg:hidden w-full border border-gray-300 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm font-medium bg-white dark:bg-slate-800 text-gray-900 dark:text-white mb-2"
        value={active} onChange={(e) => onChange(e.target.value)}>
        {groups.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.items.map((it) => <option key={it.id} value={it.id}>{it.label}{it.count != null ? ` (${it.count})` : ''}</option>)}
          </optgroup>
        ))}
      </select>
      <aside className="hidden lg:block lg:sticky lg:top-20 space-y-4 self-start">
        {groups.map((g) => (
          <div key={g.label}>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 px-2 mb-1">{g.label}</div>
            <div className="space-y-0.5">
              {g.items.map((it) => {
                const on = active === it.id
                return (
                  <button key={it.id} onClick={() => onChange(it.id)}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors ${on ? 'bg-teal-50 text-teal-800 dark:bg-teal-900/30 dark:text-teal-200 font-semibold' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/50'}`}>
                    <span>{it.icon ? `${it.icon} ` : ''}{it.label}</span>
                    {it.count != null && <span className={`text-xs ${on ? 'text-teal-600' : 'text-slate-400'}`}>{it.count}</span>}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </aside>
    </>
  )
}

// ── Reset event data (superadmin) ───────────────────────────────────────────────

const RESET_OPTIONS = [
  { key: 'guests',            label: 'Guests',                 hint: 'Delete all guests (+ their menu, RSVP answers, tags, shipments, scans) and pause source sync' },
  { key: 'checkins',          label: 'Check-ins',              hint: 'Clear admitted/served status and the scan log' },
  { key: 'seat_assignments',  label: 'Seat assignments',       hint: 'Clear each guest’s table & seat' },
  { key: 'group_assignments', label: 'Table-group tags',       hint: 'Clear each guest’s assigned table group' },
  { key: 'table_groups',      label: 'Table groups',           hint: 'Delete the table groups themselves' },
  { key: 'tables',            label: 'Tables',                 hint: 'Delete the seating tables' },
]

// ── Message Delivery card + Send History (ported from prod) ─────────────────────

function MessageDeliveryCard({ guests, onJump }) {
  const [openBatch, setOpenBatch] = useState(null)
  const delivered = guests.filter((g) => g.invite_status === 'sent')
  const failed = guests.filter((g) => g.invite_status === 'failed')
  const notSent = guests.filter((g) => !g.invite_sent_at)
  const noPhone = guests.filter((g) => !g.phone)

  // Group sent guests into batches — a new batch when the gap exceeds 10 minutes.
  const batches = (() => {
    const sent = guests.filter((g) => g.invite_sent_at)
      .sort((a, b) => new Date(a.invite_sent_at) - new Date(b.invite_sent_at))
    const out = []
    let cur = null
    for (const g of sent) {
      const t = new Date(g.invite_sent_at)
      if (!cur || t - cur.endTime > 10 * 60 * 1000) {
        cur = { startTime: t, endTime: t, guests: [] }
        out.push(cur)
      }
      cur.endTime = t
      cur.guests.push(g)
    }
    return out.reverse()
  })()

  const Tile = ({ label, count, cls, onClick }) => (
    <button onClick={onClick} disabled={!onClick}
      className={`rounded-lg p-3 text-left ${cls} ${onClick ? 'hover:opacity-90 cursor-pointer' : 'cursor-default'}`}>
      <div className="text-2xl font-bold">{count}</div>
      <div className="text-xs font-medium opacity-80">{label}</div>
    </button>
  )

  return (
    <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6 space-y-4">
      <h2 className="font-semibold text-base dark:text-white">Message sending</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile label="Sent by Festio" count={delivered.length} cls="bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300" onClick={() => onJump({ invited: 'sent' })} />
        <Tile label="Failed" count={failed.length} cls="bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300" onClick={() => onJump({ invited: 'failed' })} />
        <Tile label="Not sent yet" count={notSent.length} cls="bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300" onClick={() => onJump({ invited: 'unsent' })} />
        <Tile label="No phone" count={noPhone.length} cls="bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300" />
      </div>

      {batches.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase text-gray-400 dark:text-slate-500 mb-2">Send history</div>
          <div className="space-y-1.5">
            {batches.map((b, i) => {
              const sentN = b.guests.filter((g) => g.invite_status !== 'failed').length
              const failN = b.guests.length - sentN
              return (
                <div key={i} className="border dark:border-slate-700 rounded-lg">
                  <button onClick={() => setOpenBatch(openBatch === i ? null : i)}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="dark:text-slate-200">{new Date(b.startTime).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
                    <span className="text-xs text-gray-500 dark:text-slate-400">
                      {b.guests.length} guest{b.guests.length === 1 ? '' : 's'} · <span className="text-green-600">{sentN} sent</span>{failN ? <> · <span className="text-red-500">{failN} failed</span></> : null} {openBatch === i ? '▲' : '▼'}
                    </span>
                  </button>
                  {openBatch === i && (
                    <div className="px-3 pb-2 flex flex-wrap gap-1">
                      {b.guests.map((g) => (
                        <span key={g.id} className={`text-[11px] px-1.5 py-0.5 rounded ${
                          g.invite_status === 'failed' ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                        }`}>
                          {g.first_name} {g.last_name}{g.invite_status === 'failed' ? ' ✕' : ''}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {notSent.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase text-gray-400 dark:text-slate-500 mb-2">Not sent yet</div>
          <div className="flex flex-wrap gap-1">
            {notSent.map((g) => (
              <span key={g.id} className="text-[11px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">{g.first_name} {g.last_name}</span>
            ))}
          </div>
        </div>
      )}

      {failed.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase text-gray-400 dark:text-slate-500 mb-2">Failed (no reachable channel)</div>
          <div className="flex flex-wrap gap-1">
            {failed.map((g) => (
              <span key={g.id} className="text-[11px] px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">{g.first_name} {g.last_name}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Add Guest Modal (ported from prod) ──────────────────────────────────────────

function AddGuestModal({ onSave, onClose, loading }) {
  const [form, setForm] = useState({
    first_name: '', last_name: '', email: '', phone: '', is_vip: false, send_invite: false,
  })
  const inputCls = 'w-full border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white'

  function handleSubmit(e) {
    e.preventDefault()
    onSave({
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim() || null,
      is_vip: form.is_vip,
    }, form.send_invite)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-slate-900 dark:border dark:border-slate-700 rounded-xl shadow-2xl w-full max-w-md">
        <div className="px-5 py-4 border-b dark:border-slate-700 flex items-center justify-between">
          <h3 className="font-bold text-slate-900 dark:text-white">Add guest</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 dark:hover:text-white text-2xl leading-none">×</button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">First name *</label>
              <input autoFocus required className={inputCls} value={form.first_name}
                onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Last name *</label>
              <input required className={inputCls} value={form.last_name}
                onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Email</label>
            <input type="email" className={inputCls} value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Phone (E.164, e.g. +14155550123)</label>
            <input className={inputCls} value={form.phone} placeholder="+14155550123"
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          </div>
          <div className="flex flex-wrap gap-4 pt-1">
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
              <input type="checkbox" checked={form.is_vip}
                onChange={(e) => setForm((f) => ({ ...f, is_vip: e.target.checked }))} />
              VIP
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
              <input type="checkbox" checked={form.send_invite}
                onChange={(e) => setForm((f) => ({ ...f, send_invite: e.target.checked }))} />
              Send invite now
            </label>
          </div>
          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={loading || !form.first_name.trim() || !form.last_name.trim()}
              className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 rounded-lg disabled:opacity-50 text-sm">
              {loading ? 'Adding…' : 'Add guest'}
            </button>
            <button type="button" onClick={onClose}
              className="px-4 py-2.5 rounded-lg border border-slate-300 dark:border-slate-600 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Edit Guest Modal (ported from prod) ─────────────────────────────────────────

function EditGuestModal({ guest, eventId, seatingEnabled, onSave, onClose, loading }) {
  const [form, setForm] = useState({
    first_name: guest.first_name || '',
    last_name:  guest.last_name  || '',
    email:      guest.email      || '',
    phone:      guest.phone      || '',
    is_vip:     guest.is_vip     || false,
    sms_consent: guest.sms_consent !== false,
    whatsapp_consent: guest.whatsapp_consent !== false,
    table_id:   guest.table_id   || '',
    seat_number: guest.seat_number || '',
  })
  const [tables, setTables] = useState([])
  const [rsvpAnswers, setRsvpAnswers] = useState(null)

  // Load the event's tables so seat assignment can offer a real picker.
  useEffect(() => {
    if (!seatingEnabled || !eventId) return
    let alive = true
    api.listTables(eventId).then((t) => { if (alive) setTables(t) }).catch(() => {})
    return () => { alive = false }
  }, [eventId, seatingEnabled])

  // The guest's answers to the event's custom RSVP questions (read-only).
  useEffect(() => {
    if (!eventId || !guest?.id) return
    let alive = true
    api.guestRsvpAnswers(eventId, guest.id)
      .then((a) => { if (alive) setRsvpAnswers(a) })
      .catch(() => { if (alive) setRsvpAnswers([]) })
    return () => { alive = false }
  }, [eventId, guest?.id])

  function handleSubmit(e) {
    e.preventDefault()
    const payload = {
      first_name: form.first_name.trim(),
      last_name:  form.last_name.trim(),
      email:      form.email.trim(),
      phone:      form.phone.trim() || null,
      is_vip:     form.is_vip,
      sms_consent: form.sms_consent,
      whatsapp_consent: form.whatsapp_consent,
    }
    // Only send seating fields when the feature is on (server treats "" as clear).
    if (seatingEnabled) {
      payload.table_id = form.table_id
      payload.seat_number = form.table_id ? form.seat_number.trim() : ''
    }
    onSave(payload)
  }

  const inputCls = 'w-full border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-slate-900 dark:border dark:border-slate-700 rounded-xl shadow-2xl w-full max-w-md">
        <div className="px-5 py-4 border-b dark:border-slate-700 flex items-center justify-between">
          <h3 className="font-bold text-slate-900 dark:text-white">Edit guest</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 dark:hover:text-white text-2xl leading-none">×</button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">First name *</label>
              <input autoFocus required className={inputCls} value={form.first_name}
                onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Last name *</label>
              <input required className={inputCls} value={form.last_name}
                onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Email</label>
            <input type="email" className={inputCls} value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Phone (E.164, e.g. +14155550123)</label>
            <input className={inputCls} value={form.phone} placeholder="+14155550123"
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          </div>
          <div className="flex flex-wrap gap-4 pt-1">
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
              <input type="checkbox" checked={form.is_vip}
                onChange={(e) => setForm((f) => ({ ...f, is_vip: e.target.checked }))} />
              VIP
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
              <input type="checkbox" checked={form.sms_consent}
                onChange={(e) => setForm((f) => ({ ...f, sms_consent: e.target.checked }))} />
              SMS consent
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
              <input type="checkbox" checked={form.whatsapp_consent}
                onChange={(e) => setForm((f) => ({ ...f, whatsapp_consent: e.target.checked }))} />
              WhatsApp consent
            </label>
          </div>

          {seatingEnabled && (
            <div className="grid grid-cols-2 gap-2 pt-1 border-t dark:border-slate-700 mt-1">
              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1 mt-2">Table</label>
                <select className={inputCls} value={form.table_id}
                  onChange={(e) => setForm((f) => ({ ...f, table_id: e.target.value, seat_number: e.target.value ? f.seat_number : '' }))}>
                  <option value="">— No table —</option>
                  {tables.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}{t.capacity != null ? ` (${t.assigned_count ?? 0}/${t.capacity})` : ''}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1 mt-2">Seat</label>
                <input className={inputCls} value={form.seat_number} disabled={!form.table_id} placeholder="e.g. 4"
                  onChange={(e) => setForm((f) => ({ ...f, seat_number: e.target.value }))} />
              </div>
            </div>
          )}

          {rsvpAnswers && rsvpAnswers.length > 0 && (
            <div className="pt-3 border-t dark:border-slate-700 mt-1">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">RSVP answers</p>
              <dl className="space-y-2">
                {rsvpAnswers.map((a, i) => (
                  <div key={i}>
                    <dt className="text-xs text-slate-500 dark:text-slate-400">{a.question}</dt>
                    <dd className="text-sm text-slate-800 dark:text-slate-200 break-words">{a.answer || '—'}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button type="submit" disabled={loading || !form.first_name.trim() || !form.last_name.trim()}
              className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 rounded-lg disabled:opacity-50 text-sm">
              {loading ? 'Saving…' : 'Save changes'}
            </button>
            <button type="button" onClick={onClose}
              className="px-4 py-2.5 rounded-lg border border-slate-300 dark:border-slate-600 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// Read-only guest view: details + answers to the custom RSVP questions.
function ViewGuestModal({ guest, eventId, onClose }) {
  const [answers, setAnswers] = useState(null)
  useEffect(() => {
    if (!eventId || !guest?.id) return
    let alive = true
    api.guestRsvpAnswers(eventId, guest.id)
      .then((a) => { if (alive) setAnswers(a) })
      .catch(() => { if (alive) setAnswers([]) })
    return () => { alive = false }
  }, [eventId, guest?.id])

  const rows = [
    ['Email', guest.email],
    ['Phone', guest.phone],
    ['RSVP', guest.rsvp_status],
    ['Checked in', guest.admitted ? 'Yes' : 'No'],
    ['Table group', guest.table_group_name],
    ['Seat', guest.seat_number],
    ['VIP', guest.is_vip ? 'Yes' : null],
    ['Guest of', guest.rsvp_submitter_guest_id && guest.rsvp_submitter_guest_id === guest.id ? 'Self / main invited guest' : guest.rsvp_submitter_name],
    ['Submitter email', guest.rsvp_submitter_email],
    ['Submitter phone', guest.rsvp_submitter_phone],
    ['Relationship', guest.rsvp_relationship],
    ['Guest type', guest.rsvp_guest_type],
    ['RSVP notes', guest.rsvp_notes],
  ].filter(([, v]) => v)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-slate-900 dark:border dark:border-slate-700 rounded-xl shadow-2xl w-full max-w-md max-h-[85vh] overflow-y-auto">
        <div className="px-5 py-4 border-b dark:border-slate-700 flex items-center justify-between">
          <h3 className="font-bold text-slate-900 dark:text-white">{guest.first_name} {guest.last_name}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 dark:hover:text-white text-2xl leading-none">×</button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            {rows.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4 py-1.5 border-b border-slate-100 dark:border-slate-700/60 last:border-0">
                <span className="text-xs text-slate-500 dark:text-slate-400">{label}</span>
                <span className="text-sm text-slate-800 dark:text-slate-200 text-right break-words">{value}</span>
              </div>
            ))}
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">RSVP answers</p>
            {answers === null ? (
              <p className="text-sm text-slate-400">Loading…</p>
            ) : answers.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-slate-500">No custom questions answered.</p>
            ) : (
              <dl className="space-y-2">
                {answers.map((a, i) => (
                  <div key={i}>
                    <dt className="text-xs text-slate-500 dark:text-slate-400">{a.question}</dt>
                    <dd className="text-sm text-slate-800 dark:text-slate-200 break-words">{a.answer || '—'}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
          <button onClick={onClose}
            className="w-full py-2.5 rounded-lg border border-slate-300 dark:border-slate-600 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function ResetEventModal({ event, onClose, onDone }) {
  const [flags, setFlags] = useState({})
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const anyChecked = Object.values(flags).some(Boolean)
  const canReset = anyChecked && confirm.trim().toUpperCase() === 'RESET'

  async function run() {
    setLoading(true); setErr('')
    try {
      const res = await api.adminResetEvent(event.id, flags)
      onDone(res.cleared || {})
    } catch (e) { setErr(e.message); setLoading(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-md w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div>
          <h2 className="font-semibold text-base text-red-600 dark:text-red-400">Reset “{event.name}”</h2>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
            Choose what to permanently delete. This can’t be undone. The event and its settings/templates are kept.
          </p>
        </div>

        <div className="space-y-2">
          {RESET_OPTIONS.map((o) => (
            <label key={o.key} className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" checked={!!flags[o.key]}
                onChange={(e) => setFlags((f) => ({ ...f, [o.key]: e.target.checked }))}
                className="mt-0.5 w-4 h-4 accent-red-600" />
              <span>
                <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{o.label}</span>
                <span className="block text-xs text-gray-400 dark:text-slate-500">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-500 dark:text-slate-400 mb-1">
            Type <span className="font-mono text-red-600">RESET</span> to confirm
          </label>
          <input value={confirm} onChange={(e) => setConfirm(e.target.value)}
            className="border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white w-full"
            placeholder="RESET" />
        </div>

        {err && <p className="text-sm text-red-500">{err}</p>}

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-sm dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700">Cancel</button>
          <button onClick={run} disabled={!canReset || loading}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold disabled:opacity-40">
            {loading ? 'Resetting…' : 'Reset selected data'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function AdminPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [events, setEvents] = useState([])
  const [selectedId, setSelectedId] = useCurrentEvent()
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(false)
  const [guests, setGuests] = useState([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [page, setPage] = useState(0)
  const [sheetUrl, setSheetUrl] = useState('')
  const [showUrlInput, setShowUrlInput] = useState(false)
  const [selectedGuests, setSelectedGuests] = useState(new Set())
  const [activeTab, setActiveTab] = useState('overview')
  const [tableGroups, setTableGroups] = useState([])
  const [groupFilter, setGroupFilter] = useState('')   // '' = all, 'none' = unassigned
  const [guestFilter, setGuestFilter] = useState({ invited: 'all', admitted: 'all', qr: 'all', relationship: 'all', submitter: 'all' })
  const [showReset, setShowReset] = useState(false)
  const [editingGuest, setEditingGuest] = useState(null)
  const [viewingGuest, setViewingGuest] = useState(null)
  const [showAddGuest, setShowAddGuest] = useState(false)
  const [upgradeGate, setUpgradeGate] = useState(null)
  const [recommendedPlan, setRecommendedPlan] = useState(() => localStorage.getItem('festio.recommendedPlan') || '')
  const fileRef = useRef()

  const PAGE_SIZE = 50
  const event = events.find((e) => e.id === selectedId)

  useEffect(() => { api.listEvents().then((evs) => {
    setEvents(evs)
    if (selectedId && !evs.some((e) => e.id === selectedId)) setSelectedId('')
  }).catch(console.error) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Returning from a successful Event Pass checkout (Stripe/Paystack).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('upgraded')) {
      setMsg('Payment received — your Event Pass is being applied. Refresh in a moment if the plan hasn’t updated.')
      setTimeout(() => setMsg(''), 8000)
      window.history.replaceState({}, '', '/admin')
      api.listEvents().then(setEvents).catch(console.error)
    } else if (params.get('tab') === 'billing') {
      setActiveTab('overview')
      setMsg('Open the Event Pass panel below to activate or upgrade this event.')
      setTimeout(() => setMsg(''), 7000)
      window.history.replaceState({}, '', '/admin')
    } else if (params.get('recommended')) {
      const labels = { free: 'Free', tier50: 'Starter', tier150: 'Standard', tier300: 'Pro', scale: 'Scale', enterprise: 'Enterprise' }
      const plan = params.get('recommended')
      setRecommendedPlan(plan)
      localStorage.setItem('festio.recommendedPlan', plan)
      setMsg(`Draft created. Recommended plan: ${labels[plan] || plan}. You can preview first and pay only when activating paid modules.`)
      setTimeout(() => setMsg(''), 9000)
      window.history.replaceState({}, '', '/admin')
    }
  }, [])

  useEffect(() => {
    setPage(0)
    setSelectedGuests(new Set())
    setActiveTab('overview')
    setGroupFilter('')
    if (!selectedId) { setGuests([]); setTableGroups([]); return }
    api.listGuests(selectedId).then(setGuests).catch(console.error)
    api.listTableGroups(selectedId).then(setTableGroups).catch(() => setTableGroups([]))
  }, [selectedId])

  // Poll the event list every 15s while a sync-enabled event is selected,
  // so the "Last sync" timestamp and guest count stay live without a refresh.
  useEffect(() => {
    if (!selectedId) return
    const id = setInterval(async () => {
      try {
        const evs = await api.listEvents()
        setEvents(evs)
        const guests = await api.listGuests(selectedId)
        setGuests(guests)
      } catch { /* swallow — network blips shouldn't surface here */ }
    }, 15000)
    return () => clearInterval(id)
  }, [selectedId])

  function flash(m, isErr = false) {
    isErr ? setError(m) : setMsg(m)
    setTimeout(() => { setMsg(''); setError('') }, 4000)
  }

  function openUpgradeGate({ title, message, requiredPlan, error } = {}) {
    const fallback = requiredPlan || recommendedPlanForEvent(event, 'tier50')
    setUpgradeGate({
      title,
      message,
      error,
      requiredPlan: requiredPlan || requiredPlanFromError(error, fallback),
    })
  }

  function gateOrFlash(err, fallbackPlan = 'tier50') {
    if (err?.status === 402) {
      openUpgradeGate({ message: err.message, requiredPlan: requiredPlanFromError(err, fallbackPlan), error: err })
    } else {
      flash(err.message, true)
    }
  }

  function updateEvent(updated) {
    setEvents((prev) => prev.map((e) => (e.id === updated.id ? updated : e)))
  }

  // Server-side export so the file includes each guest's RSVP-question answers
  // (the in-memory guest list doesn't carry them), with proper escaping.
  async function handleExportGuests(fmt = 'csv') {
    try { await api.downloadGuestList(selectedId, fmt) }
    catch (err) { flash(err.message, true) }
  }

  async function handleBulkAssignGroup(groupId) {
    const ids = [...selectedGuests]
    if (ids.length === 0) return
    setLoading(true)
    try {
      await api.bulkAssignTableGroup(selectedId, ids, groupId || null)
      const [gs, tg] = await Promise.all([api.listGuests(selectedId), api.listTableGroups(selectedId)])
      setGuests(gs); setTableGroups(tg); setSelectedGuests(new Set())
      flash(groupId ? 'Table group assigned.' : 'Table group cleared.')
    } catch (e) { flash(e.message, true) }
    finally { setLoading(false) }
  }

  async function handleCreate(data) {
    const ev = await api.createEvent(data)
    setEvents([ev, ...events])
    setSelectedId(ev.id)
    setShowForm(false)
    flash('Event created!')
  }

  async function handleUpdate(data) {
    const ev = await api.updateEvent(selectedId, data)
    updateEvent(ev)
    setEditing(false)
    flash('Event updated!')
  }

  async function handleDeleteEvent() {
    if (!event) return
    if (!confirm(`Delete "${event.name}"? This removes all guests and cannot be undone.`)) return
    try {
      await api.deleteEvent(selectedId)
      setEvents((prev) => prev.filter((e) => e.id !== selectedId))
      setSelectedId('')
      setGuests([])
      flash('Event deleted.')
    } catch (err) { gateOrFlash(err, 'tier50') }
  }

  function flashImportResult(res) {
    let msg = `${res.added} guests added, ${res.skipped} skipped.`
    if (res.sample_rows_skipped) msg += ` ${res.sample_rows_skipped} template sample row${res.sample_rows_skipped === 1 ? '' : 's'} ignored.`
    if (res.ticket_types_assigned) msg += ` ${res.ticket_types_assigned} ticket type${res.ticket_types_assigned === 1 ? '' : 's'} assigned.`
    if (res.tags_assigned) msg += ` ${res.tags_assigned} tag${res.tags_assigned === 1 ? '' : 's'} assigned${res.tags_created ? ` (${res.tags_created} new)` : ''}.`
    if (res.addresses_added) msg += ` ${res.addresses_added} shipping address${res.addresses_added === 1 ? '' : 'es'} added.`
    let warn = false
    if (res.unknown_ticket_types?.length) {
      msg += ` Unknown ticket types ignored: ${res.unknown_ticket_types.join(', ')} — create them in the Access tab, then re-import to assign.`
      warn = true
    }
    if (res.cap_note) {
      msg += ` ${res.cap_note}`
      warn = true
    }
    flash(msg, warn)
  }

  async function handleUpload(e) {
    const file = e.target.files[0]
    if (!file) return
    setLoading(true)
    try {
      const res = await api.uploadGuests(selectedId, file)
      flashImportResult(res)
      setGuests(await api.listGuests(selectedId))
    } catch (err) { gateOrFlash(err, 'tier50') }
    finally { setLoading(false); fileRef.current.value = '' }
  }

  async function handleDownloadTemplate(fmt) {
    try { await api.downloadGuestTemplate(selectedId, fmt) }
    catch (err) { flash(err.message, true) }
  }

  async function handleGenQR() {
    setLoading(true)
    try {
      const res = await api.generateQR(selectedId)
      flash(`QR codes generated for ${res.generated} guests.`)
      setGuests(await api.listGuests(selectedId))
    } catch (err) { gateOrFlash(err, 'tier50') }
    finally { setLoading(false) }
  }

  async function handleSendInvites() {
    setLoading(true)
    try {
      const res = await api.sendInvites(selectedId)
      flash(`Invite emails queued for ${res.queued} guests.`)
      setGuests(await api.listGuests(selectedId))
    } catch (err) { gateOrFlash(err, 'tier50') }
    finally { setLoading(false) }
  }

  async function handleSendBatch({ ids = null, force = false, label }) {
    setLoading(true)
    try {
      const res = await api.sendInvitesBatch(selectedId, ids, force)
      flash(`${label}: ${res.queued} invite${res.queued === 1 ? '' : 's'} queued.`)
      setGuests(await api.listGuests(selectedId))
      setSelectedGuests(new Set())
    } catch (err) { gateOrFlash(err, 'tier50') }
    finally { setLoading(false) }
  }

  function toggleSelectGuest(id) {
    setSelectedGuests((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleSelectPage(pageGuests, allSelected) {
    setSelectedGuests((prev) => {
      const next = new Set(prev)
      for (const g of pageGuests) {
        allSelected ? next.delete(g.id) : next.add(g.id)
      }
      return next
    })
  }

  async function handleImportUrl() {
    if (!sheetUrl.trim()) return
    setLoading(true)
    try {
      const res = await api.importGuestsFromUrl(selectedId, sheetUrl.trim())
      flashImportResult(res)
      setGuests(await api.listGuests(selectedId))
      setSheetUrl('')
      setShowUrlInput(false)
    } catch (err) { gateOrFlash(err, 'tier150') }
    finally { setLoading(false) }
  }

  async function handleSaveSource(url, interval) {
    try {
      const updated = await api.updateSource(selectedId, {
        source_url: url,
        source_sync_interval_seconds: interval,
      })
      updateEvent(updated)
      flash(url ? 'Spreadsheet URL saved.' : 'Spreadsheet URL cleared.')
    } catch (err) { gateOrFlash(err, 'tier150') }
  }

  async function handleToggleSync(enabled) {
    try {
      const updated = await api.updateSource(selectedId, { source_sync_enabled: enabled })
      updateEvent(updated)
      flash(enabled ? 'Sync turned on.' : 'Sync paused — the spreadsheet will not be polled.')
    } catch (err) { gateOrFlash(err, 'tier150') }
  }

  async function handleSyncNow() {
    setLoading(true)
    try {
      const res = await api.syncNow(selectedId)
      flash(`Synced: ${res.added} added, ${res.skipped} skipped.`)
      setGuests(await api.listGuests(selectedId))
      // Refresh the event so last_sync_at updates locally.
      const refreshed = await api.listEvents()
      setEvents(refreshed)
    } catch (err) { gateOrFlash(err, 'tier150') }
    finally { setLoading(false) }
  }

  async function handleAddGuest(data, sendInvite) {
    setLoading(true)
    try {
      const created = await api.addGuest(selectedId, data)
      if (sendInvite) await api.sendInvitesBatch(selectedId, [created.id], true)
      setGuests(await api.listGuests(selectedId))
      setShowAddGuest(false)
      flash(sendInvite ? 'Guest added and invite sent.' : 'Guest added.')
    } catch (err) { gateOrFlash(err, 'tier50') }
    finally { setLoading(false) }
  }

  async function handleUpdateGuest(guestId, data) {
    setLoading(true)
    try {
      const updated = await api.updateGuest(selectedId, guestId, data)
      setGuests((prev) => prev.map((g) => (g.id === guestId ? { ...g, ...updated } : g)))
      setEditingGuest(null)
      flash('Guest updated.')
    } catch (err) { flash(err.message, true) }
    finally { setLoading(false) }
  }

  async function handleDeleteGuest(guestId) {
    if (!confirm('Remove this guest?')) return
    try {
      await api.deleteGuest(selectedId, guestId)
      setGuests((prev) => prev.filter((g) => g.id !== guestId))
      flash('Guest removed.')
    } catch (err) { flash(err.message, true) }
  }

  async function handleResendInvite(guestId) {
    setLoading(true)
    try {
      await api.resendGuestEmail(selectedId, guestId, 'invitation')
      flash('Invite resent.')
    } catch (err) { flash(err.message, true) }
    finally { setLoading(false) }
  }

  async function handleResendGuestEmail(guestId, kind) {
    const labels = {
      admission: 'Admission email resent.',
      experience_next_steps: 'Experience steps email sent.',
      consent_copy: 'Consent copy resent.',
    }
    setLoading(true)
    try {
      await api.resendGuestEmail(selectedId, guestId, kind)
      flash(labels[kind] || 'Email queued.')
    } catch (err) { flash(err.message, true) }
    finally { setLoading(false) }
  }

  async function handleCopyInviteLink(guestId) {
    try {
      const { invite_url } = await api.ensureInviteToken(selectedId, guestId)
      await navigator.clipboard.writeText(invite_url)
      flash('RSVP link copied to clipboard.')
    } catch (err) { flash(err.message, true) }
  }

  async function handleApproveRsvp(guestId) {
    setLoading(true)
    try {
      await api.approveRsvp(selectedId, guestId)
      flash('RSVP approved — ticket sent.')
      setGuests(await api.listGuests(selectedId))
    } catch (err) { flash(err.message, true) }
    finally { setLoading(false) }
  }

  async function handleRejectRsvp(guestId) {
    if (!confirm('Reject this RSVP? The guest will be marked declined (no ticket).')) return
    setLoading(true)
    try {
      await api.rejectRsvp(selectedId, guestId)
      flash('RSVP rejected.')
      setGuests(await api.listGuests(selectedId))
    } catch (err) { flash(err.message, true) }
    finally { setLoading(false) }
  }

  async function handleApproveAll() {
    const pendingIds = guests.filter((g) => g.rsvp_status === 'pending').map((g) => g.id)
    if (pendingIds.length === 0) return
    if (!confirm(`Approve all ${pendingIds.length} pending RSVP(s) and send their tickets?`)) return
    setLoading(true)
    try {
      for (const id of pendingIds) await api.approveRsvp(selectedId, id)
      flash(`Approved ${pendingIds.length} RSVP(s).`)
      setGuests(await api.listGuests(selectedId))
    } catch (err) { flash(err.message, true) }
    finally { setLoading(false) }
  }

  const stats = {
    total: guests.length,
    qr: guests.filter((g) => g.qr_generated_at).length,
    invited: guests.filter((g) => g.invite_sent_at).length,
    admitted: guests.filter((g) => g.admitted).length,
    pending: guests.filter((g) => g.rsvp_status === 'pending').length,
    delivered: guests.filter((g) => g.invite_status === 'sent').length,
    failed: guests.filter((g) => g.invite_status === 'failed').length,
    notSent: guests.filter((g) => !g.invite_sent_at).length,
    noPhone: guests.filter((g) => !g.phone).length,
  }
  const effectiveRecommendedPlan = recommendedPlan && PLAN_RANK[recommendedPlan]
    ? recommendedPlan
    : event ? recommendedPlanForEvent(event, 'tier50') : ''

  return (
    <div className="space-y-6">
      {event && (
        <UpgradeGateModal
          event={event}
          gate={upgradeGate}
          onClose={() => setUpgradeGate(null)}
          onStarted={(plan) => {
            localStorage.setItem('festio.recommendedPlan', plan)
            setRecommendedPlan(plan)
          }}
        />
      )}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold dark:text-white">Event Setup</h1>
        <button onClick={() => navigate('/setup')}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700">
          New Event
        </button>
      </div>

      {!event && <TrialBanner events={events} user={user} onCreateDraft={() => navigate('/setup')} />}

      {showForm && (
        <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6">
          <h2 className="font-semibold text-lg mb-4 dark:text-white">New Event</h2>
          <EventForm onSave={handleCreate} onCancel={() => setShowForm(false)} />
        </div>
      )}

      {events.length > 0 && (
        <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6">
          <label className="block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-2">Current event</label>
          <div className="flex gap-3 items-center">
            <select className="border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm flex-1 bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
              value={selectedId}
              onChange={(e) => { setSelectedId(e.target.value); setEditing(false) }}>
              <option value="">— choose an event —</option>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.couples_name ? `${ev.name} — ${ev.couples_name}` : ev.name}
                </option>
              ))}
            </select>
            {event && (
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => setEditing(!editing)} className="text-sm text-indigo-600 hover:underline whitespace-nowrap">
                  {editing ? 'Cancel' : 'Edit'}
                </button>
                <button onClick={handleDeleteEvent}
                  className="text-sm text-red-500 hover:text-red-700 hover:underline whitespace-nowrap">
                  Delete
                </button>
              </div>
            )}
          </div>

          {editing && event && (
            <div className="mt-4 pt-4 border-t dark:border-slate-700">
              <EventForm
                initial={{ ...event, event_date: utcToLocal(event.event_date) }}
                onSave={handleUpdate}
                onCancel={() => setEditing(false)}
              />
            </div>
          )}
        </div>
      )}

      {msg && <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 rounded-lg px-4 py-3 text-sm">{msg}</div>}
      {error && <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-lg px-4 py-3 text-sm">{error}</div>}

      {event && (
        <>
          <OnboardingChecklist event={event} stats={stats} onTab={setActiveTab} />
          <div className="lg:grid lg:grid-cols-[15rem_1fr] lg:gap-6 lg:items-start">
            <Sidebar active={activeTab} onChange={setActiveTab} groups={[
              { label: 'Setup', items: [
                { id: 'overview', label: 'Start here', icon: '🏠' },
                { id: 'guests', label: 'Guests', icon: '👥', count: guests.length },
                { id: 'invite', label: 'Invites & RSVP', icon: '✉️' },
                { id: 'communication', label: 'Guest Communication', icon: '💬' },
              ]},
              ...(event.venue_access_enabled ? [{ label: 'Venue & access', items: [
                { id: 'access', label: 'Entry areas', icon: '🎟️' },
                { id: 'rules', label: 'Entry rules', icon: '🏷️' },
              ]}] : []),
              ...((event.seating_enabled || event.menu_enabled || event.logistics_enabled || event.registry_enabled) ? [{ label: 'Add-ons', items: [
                ...(event.seating_enabled ? [{ id: 'seating', label: 'Seating', icon: '🪑' }] : []),
                ...(event.menu_enabled ? [{ id: 'menu', label: 'Orders', icon: '☑' }] : []),
                ...(event.logistics_enabled ? [{ id: 'logistics', label: 'Deliveries', icon: '📦' }] : []),
                ...(event.registry_enabled ? [{ id: 'registry', label: 'Gift list', icon: '🎁' }] : []),
              ]}] : []),
              { label: 'Team & settings', items: [
                { id: 'team', label: 'Team', icon: '🧑‍🤝‍🧑' },
                { id: 'experience', label: 'Experience', icon: '🧭' },
                { id: 'messages', label: 'Messages', icon: '✏️' },
                { id: 'features', label: 'Features & messaging', icon: '⚙️' },
              ]},
            ]} />
            <div className="space-y-6 min-w-0 mt-4 lg:mt-0">

          {activeTab === 'overview' && <>

          {/* Status controls */}
          <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6">
            <div className="flex items-center justify-between flex-wrap gap-3">
            <h2 className="font-semibold text-base dark:text-white">Event status</h2>
              <StatusControls event={event} onChanged={updateEvent} />
            </div>
            <p className="text-xs text-gray-400 dark:text-slate-500 mt-3">
              <strong>Draft</strong> → set up guests and invites &nbsp;·&nbsp;
              <strong>Active</strong> → scanning enabled &nbsp;·&nbsp;
              <strong>Ended</strong> → read-only record
            </p>
          </div>

          </>}

          {activeTab === 'features' && (
            <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6 space-y-5">
              <div>
              <h2 className="font-semibold text-base dark:text-white">Event extras</h2>
              <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">Turn optional tools on or off. Enabled tools appear in the sidebar. Requires an Event Pass.</p>
                <FeatureToggles event={event} onChanged={updateEvent} onGate={openUpgradeGate} />
              </div>
              <div className="border-t dark:border-slate-700 pt-5">
                <h2 className="font-semibold text-base dark:text-white">Messaging channels</h2>
                <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">Which channels fire for invites &amp; admission notifications.</p>
                <ChannelToggles event={event} onChanged={updateEvent} onGate={openUpgradeGate} />
                <label className="mt-4 flex items-start gap-2 cursor-pointer">
                  <input type="checkbox" checked={!!event.notify_rsvp_responses}
                    onChange={async (e) => {
                      try { updateEvent(await api.toggleFeatures(event.id, { notify_rsvp_responses: e.target.checked })) }
                      catch (err) { flash(err.message, true) }
                    }}
                    className="mt-0.5 w-4 h-4 accent-teal-600" />
                  <span>
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Notify guests who decline or are rejected</span>
                    <span className="block text-xs text-gray-400 dark:text-slate-500">Off by default. When on, declined/rejected guests get a polite notice (edit the wording in Messages → RSVP decline / Approval rejected).</span>
                  </span>
                </label>
              </div>

              <SelfCheckinPanel event={event} onChanged={updateEvent} onFlash={flash} onGate={openUpgradeGate} />

              {user?.is_platform_superadmin && (
                <div className="border-t dark:border-slate-700 pt-5">
                  <h2 className="font-semibold text-base text-indigo-600 dark:text-indigo-400">Operator settings</h2>
                  <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">Visible only to platform operators.</p>
                  <label className="mt-3 flex items-start gap-2 cursor-pointer">
                    <input type="checkbox" checked={!!event.manual_checkin_enabled}
                      onChange={async (e) => {
                        const val = e.target.checked
                        try {
                          await api.adminSetManualCheckin(event.id, val)
                          updateEvent({ ...event, manual_checkin_enabled: val })
                          flash(`Manual check-in ${val ? 'enabled' : 'disabled'}.`)
                        } catch (err) { flash(err.message, true) }
                      }}
                      className="mt-0.5 w-4 h-4 accent-indigo-600" />
                    <span>
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Manual check-in (no QR)</span>
                      <span className="block text-xs text-gray-400 dark:text-slate-500">Adds a Manual / Walk-in tab on the Scanner so staff can admit guests by search or register a walk-in at the door.</span>
                    </span>
                  </label>
                  <label className="mt-3 flex items-start gap-2 cursor-pointer">
                    <input type="checkbox" checked={!!event.notify_mms}
                      onChange={async (e) => {
                        const val = e.target.checked
                        try {
                          await api.adminSetMms(event.id, val)
                          updateEvent({ ...event, notify_mms: val })
                          flash(`MMS ticket card ${val ? 'enabled' : 'disabled'}.`)
                        } catch (err) { flash(err.message, true) }
                      }}
                      className="mt-0.5 w-4 h-4 accent-indigo-600" />
                    <span>
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">MMS ticket card</span>
                      <span className="block text-xs text-gray-400 dark:text-slate-500">Sends the styled ticket-card image by MMS at invite time and check-in (needs an MMS-capable provider configured).</span>
                    </span>
                  </label>
                </div>
              )}

              {user?.is_platform_superadmin && (
                <div className="border-t border-red-200 dark:border-red-900/50 pt-5">
                  <h2 className="font-semibold text-base text-red-600 dark:text-red-400">⚠ Danger zone (operator only)</h2>
                  <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">
                    Reset operational data for this event so it can be reused or re-tested. The event and its settings are kept.
                  </p>
                  <button onClick={() => setShowReset(true)}
                    className="mt-3 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-semibold">
                    Reset event data…
                  </button>
                </div>
              )}
            </div>
          )}

          {showReset && (
            <ResetEventModal
              event={event}
              onClose={() => setShowReset(false)}
              onDone={async (cleared) => {
                setShowReset(false)
                const [gs, tg] = await Promise.all([
                  api.listGuests(selectedId).catch(() => guests),
                  api.listTableGroups(selectedId).catch(() => []),
                ])
                setGuests(gs); setTableGroups(tg); setSelectedGuests(new Set())
                flash('Event data reset: ' + (Object.keys(cleared).length ? JSON.stringify(cleared) : 'nothing to clear'))
              }}
            />
          )}

          {editingGuest && (
            <EditGuestModal
              guest={editingGuest}
              eventId={selectedId}
              seatingEnabled={!!event?.seating_enabled}
              loading={loading}
              onSave={(data) => handleUpdateGuest(editingGuest.id, data)}
              onClose={() => setEditingGuest(null)}
            />
          )}

          {viewingGuest && (
            <ViewGuestModal
              guest={viewingGuest}
              eventId={selectedId}
              onClose={() => setViewingGuest(null)}
            />
          )}

          {showAddGuest && (
            <AddGuestModal
              loading={loading}
              onSave={handleAddGuest}
              onClose={() => setShowAddGuest(false)}
            />
          )}

          {activeTab === 'overview' && <>

          {/* Stats — hidden until there's data, so a fresh event leads with the
              one action that matters (importing guests) instead of four zeros. */}
          {stats.total > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Total Guests', value: stats.total, cls: 'text-indigo-600' },
              { label: 'QR Generated', value: stats.qr,    cls: 'text-blue-600'   },
              { label: 'Invites Sent', value: stats.invited,cls: 'text-amber-600'  },
              { label: 'Admitted',     value: stats.admitted,cls: 'text-green-600' },
            ].map(({ label, value, cls }) => (
              <div key={label} className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-4 text-center">
                <div className={`text-3xl font-bold ${cls}`}>{value}</div>
                <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">{label}</div>
              </div>
            ))}
          </div>
          )}

          {stats.total > 0 && (
            <MessageDeliveryCard
              guests={guests}
              onJump={(patch) => { setGuestFilter({ invited: 'all', admitted: 'all', qr: 'all', relationship: 'all', submitter: 'all', ...patch }); setPage(0); setActiveTab('guests') }}
            />
          )}

          {/* Guest management */}
          <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6 space-y-4">
            <div>
              <h2 className="font-semibold text-base dark:text-white">Import guests</h2>
              <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                Start with a spreadsheet template, upload a file, or connect a shared sheet.
              </p>
            </div>

            {/* Import row */}
            <div className="flex flex-wrap gap-3 items-center">
              <div>
                <input type="file" accept=".csv,.xlsx,.xls" ref={fileRef} onChange={handleUpload} className="hidden" />
                <button onClick={() => fileRef.current.click()} disabled={loading}
                  className="bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-200 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-50">
                  Upload guest file
                </button>
                <span className="text-xs text-gray-400 dark:text-slate-500 ml-2">
                  {['first_name, last_name, email, phone',
                    ...(event.venue_access_enabled ? ['ticket_type'] : []),
                    ...(event.logistics_enabled ? ['ship_address…'] : [])].join(', ')}
                </span>
              </div>
              <button onClick={() => setShowUrlInput((v) => !v)} disabled={loading}
                className="bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-200 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-50">
                Import from Google Sheets or Excel
              </button>
              <div className="flex items-center gap-1">
                <button onClick={() => handleDownloadTemplate('xlsx')} disabled={loading}
                  className="bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-200 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-slate-700 disabled:opacity-50"
                  title="Excel template with the columns this event imports — includes a ticket-type dropdown when Venue Access is on">
                  Download template
                </button>
                <button onClick={() => handleDownloadTemplate('csv')} disabled={loading}
                  className="text-xs text-gray-400 dark:text-slate-500 hover:text-teal-600 dark:hover:text-teal-400 px-1 disabled:opacity-50"
                  title="Same template as plain CSV">
                  CSV
                </button>
              </div>
            </div>

            {/* Spreadsheet URL input */}
            {showUrlInput && (
              <div className="flex gap-2 items-center bg-gray-50 dark:bg-slate-700 rounded-lg p-3 border border-gray-200 dark:border-slate-700">
                <input
                  type="url"
                  value={sheetUrl}
                  onChange={(e) => setSheetUrl(e.target.value)}
                  placeholder="Paste Google Sheets or Excel Online share link…"
                  className="flex-1 border border-gray-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-slate-800 text-gray-900 dark:text-white"
                />
                <button onClick={handleImportUrl} disabled={loading || !sheetUrl.trim()}
                  className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap">
                  {loading ? 'Importing…' : 'Import'}
                </button>
                <button onClick={() => { setShowUrlInput(false); setSheetUrl('') }}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 px-2 text-lg leading-none">×</button>
              </div>
            )}
            {showUrlInput && (
              <p className="text-xs text-gray-400 dark:text-slate-500">
                Google Sheets: share with "Anyone with link can view". OneDrive/Excel: use Share → Copy link with "Anyone with the link can view", not the browser address bar URL.
                The sheet must include <strong>first_name, last_name, email, phone</strong>. Extra columns are ignored unless an add-on uses them.
              </p>
            )}

            {/* Low message-credit warning — surfaces WHY paid channels show
                "Not sent" so operators know to top up before/while sending. */}
            {(() => {
              const paidOn = event.is_paid && event.paid_channels
              const chans = []
              if (event.notify_sms) chans.push('SMS')
              if (event.notify_whatsapp) chans.push('WhatsApp')
              if (event.notify_mms) chans.push('MMS')
              if (!paidOn || chans.length === 0) return null
              // Cheapest enabled paid channel: SMS/WhatsApp cost 1 credit, MMS costs 3.
              const minCost = (event.notify_sms || event.notify_whatsapp) ? 1 : 3
              const bal = event.message_credits || 0
              const names = chans.join('/')
              if (bal < minCost) {
                return (
                  <div className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/30 px-3 py-2 text-sm text-red-800 dark:text-red-200">
                    ⚠️ <strong>{bal} message credits left.</strong> {names} messages won’t be sent — they’ll show “Not sent.” Add message credits (Event Pass → Top up credits) to send {names}.
                  </div>
                )
              }
              if (bal < minCost * 20) {
                return (
                  <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
                    Low balance: <strong>{bal} message credits</strong> left. Top up soon to keep {names} sending.
                  </div>
                )
              }
              return null
            })()}

            {/* Action buttons */}
            <div className="flex flex-wrap gap-3 pt-1 border-t dark:border-slate-700">
              <button onClick={handleGenQR} disabled={loading || stats.total === 0}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
                Generate QR codes
              </button>
              <button onClick={() => handleSendBatch({ force: false, label: 'Send unsent' })}
                disabled={loading || stats.total === 0 || stats.total - stats.invited === 0}
                className="bg-amber-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-amber-600 disabled:opacity-50">
                Send invitations ({stats.total - stats.invited})
              </button>
              <button onClick={() => {
                  if (!confirm(`Re-send invite to ALL ${stats.total} guests, including those already invited?`)) return
                  handleSendBatch({ force: true, label: 'Resend all' })
                }}
                disabled={loading || stats.total === 0}
                className="bg-white dark:bg-slate-700 border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-amber-50 dark:hover:bg-slate-600 disabled:opacity-50">
                Resend to all
              </button>
            </div>
          </div>

          {/* Live spreadsheet sync — advanced; collapsed by default so it never
              competes with the primary import step. Auto-opens once configured. */}
          <details className="group" open={!!event.source_url}>
            <summary className="cursor-pointer select-none inline-flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-teal-600 dark:hover:text-teal-400">
              <span className="text-slate-400 transition-transform group-open:rotate-90">▸</span>
              Advanced · live spreadsheet sync
              {event.source_url && <span className="ml-1 text-xs font-semibold text-teal-600">· connected</span>}
            </summary>
            <div className="mt-3">
              <SourceSyncPanel
                event={event}
                onSave={handleSaveSource}
                onSyncNow={handleSyncNow}
                onToggleSync={handleToggleSync}
                loading={loading}
              />
            </div>
          </details>

          </>}{/* end overview tab */}

          {activeTab === 'team' && <TeamPanel eventId={selectedId} />}

          {activeTab === 'experience' && <ExperiencePanel event={event} onChanged={updateEvent} onFlash={flash} />}

          {activeTab === 'communication' && <GuestCommunicationPanel event={event} />}

          {activeTab === 'invite' && <>
            {event.invite_mode === 'closed' && (() => {
              const notInvited = guests.filter((g) => !g.invite_sent_at)
              const noReply = guests.filter((g) => g.rsvp_status === 'invited')
              const btn = 'px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50'
              return (
                <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-6 space-y-4">
                  <div>
                    <h2 className="font-semibold text-base dark:text-white">✉️ Send personal RSVP links</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      Each guest receives their own RSVP link. They can confirm or decline, and tickets are issued after confirmation.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button
                      onClick={() => handleSendBatch({ ids: notInvited.map((g) => g.id), force: true, label: 'RSVP invites' })}
                      disabled={loading || notInvited.length === 0}
                      className={`bg-teal-600 text-white hover:bg-teal-700 ${btn}`}>
                      Send first invitations ({notInvited.length})
                    </button>
                    <button
                      onClick={() => {
                        if (noReply.length === 0) return
                        if (!confirm(`Re-send the RSVP link to ${noReply.length} guest(s) who haven't replied yet?`)) return
                        handleSendBatch({ ids: noReply.map((g) => g.id), force: true, label: 'RSVP reminders' })
                      }}
                      disabled={loading || noReply.length === 0}
                      className={`bg-amber-500 text-white hover:bg-amber-600 ${btn}`}>
                      Remind guests with no reply ({noReply.length})
                    </button>
                    <button
                      onClick={() => {
                        if (guests.length === 0) return
                        if (!confirm(`Resend the RSVP link to ALL ${guests.length} guests, including those who already replied?`)) return
                        handleSendBatch({ ids: null, force: true, label: 'RSVP invites' })
                      }}
                      disabled={loading || guests.length === 0}
                      className={`bg-white dark:bg-slate-700 border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-slate-600 ${btn}`}>
                      Resend to all ({guests.length})
                    </button>
                  </div>
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    Guests without a usable contact for any enabled channel are skipped. Manage individual links in the <button onClick={() => setActiveTab('guests')} className="text-teal-600 hover:underline font-semibold">Guests</button> tab.
                  </p>
                </div>
              )
            })()}
            <BillingPanel event={event} recommendedPlan={effectiveRecommendedPlan} />
            <InvitePanel event={event} onChanged={updateEvent} />
            <ManualInvitePanel event={event} />
            <BroadcastPanel event={event} />
          </>}

          {activeTab === 'seating' && event.seating_enabled && <>
            <SeatingPanel eventId={selectedId} />
            <TableGroupsPanel eventId={selectedId} />
            <WalkInToggle event={event} onChanged={updateEvent} onFlash={flash} />
            <CheckoutToggle event={event} onChanged={updateEvent} onFlash={flash} />
          </>}

          {activeTab === 'messages' && <MessageTemplatesPanel eventId={selectedId} event={event} />}

          {activeTab === 'menu' && event.menu_enabled && <>
            <MenuPanel eventId={selectedId} />
            <MenuDashboard eventId={selectedId} />
          </>}

          {activeTab === 'logistics' && event.logistics_enabled && (
            <LogisticsPanel eventId={selectedId} event={event} />
          )}

          {activeTab === 'registry' && event.registry_enabled && (
            <RegistryPanel eventId={selectedId} event={event} />
          )}

          {activeTab === 'access' && event.venue_access_enabled && (
            <AccessPanel eventId={selectedId} />
          )}

          {activeTab === 'rules' && event.venue_access_enabled && (
            <AccessRulesPanel eventId={selectedId} />
          )}

          {/* Guest list */}
          {activeTab === 'guests' && guests.length === 0 && (
            <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow p-10 text-center space-y-3">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                No guests yet. Go to <button onClick={() => setActiveTab('overview')} className="text-teal-600 hover:underline font-semibold">Start here</button> to upload a guest file, connect Google Sheets, or download the template.
              </p>
              <button onClick={() => setShowAddGuest(true)}
                className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700">+ Add guest</button>
            </div>
          )}
          {activeTab === 'guests' && guests.length > 0 && (() => {
            const textKey = (value) => String(value || '').trim().toLowerCase()
            const submitterOptions = Array.from(new Map(
              guests
                .filter((g) => g.rsvp_submitter_guest_id === g.id || g.rsvp_submitter_name)
                .map((g) => {
                  const id = g.rsvp_submitter_guest_id === g.id ? g.id : g.rsvp_submitter_guest_id
                  const name = g.rsvp_submitter_guest_id === g.id
                    ? `${g.first_name || ''} ${g.last_name || ''}`.trim()
                    : g.rsvp_submitter_name
                  return id && name ? [id, name] : null
                })
                .filter(Boolean)
            ).entries()).sort((a, b) => a[1].localeCompare(b[1]))
            const byGroup = groupFilter === '' ? guests
              : groupFilter === 'none' ? guests.filter((g) => !g.assigned_table_group_id)
              : guests.filter((g) => g.assigned_table_group_id === groupFilter)
            const filteredGuests = byGroup.filter((g) => {
              if (guestFilter.invited === 'sent'   && g.invite_status !== 'sent')   return false
              if (guestFilter.invited === 'failed' && g.invite_status !== 'failed') return false
              if (guestFilter.invited === 'unsent' && g.invite_sent_at)             return false
              if (guestFilter.admitted === 'yes'   && !g.admitted)                  return false
              if (guestFilter.admitted === 'no'    && g.admitted)                   return false
              if (guestFilter.qr === 'pending'     && g.qr_generated_at)            return false
              if (guestFilter.relationship === 'main' && g.rsvp_submitter_guest_id !== g.id) return false
              if (guestFilter.relationship === 'additional' && !(g.rsvp_submitter_guest_id && g.rsvp_submitter_guest_id !== g.id)) return false
              if (guestFilter.relationship === 'parent' && !textKey(g.rsvp_guest_type).includes('parent') && !textKey(g.rsvp_guest_type).includes('guardian') && !textKey(g.rsvp_relationship).includes('parent') && !textKey(g.rsvp_relationship).includes('guardian')) return false
              if (guestFilter.relationship === 'teacher' && !textKey(g.rsvp_guest_type).includes('teacher') && !textKey(g.rsvp_guest_type).includes('staff') && !textKey(g.rsvp_relationship).includes('teacher') && !textKey(g.rsvp_relationship).includes('staff')) return false
              if (guestFilter.relationship === 'vip' && !g.is_vip && !textKey(g.rsvp_guest_type).includes('vip') && !textKey(g.rsvp_guest_type).includes('dignitary')) return false
              if (guestFilter.submitter !== 'all') {
                const guestSubmitterId = g.rsvp_submitter_guest_id === g.id ? g.id : g.rsvp_submitter_guest_id
                if (guestSubmitterId !== guestFilter.submitter) return false
              }
              return true
            })
            const anyFilter = guestFilter.invited !== 'all' || guestFilter.admitted !== 'all' || guestFilter.qr !== 'all' || guestFilter.relationship !== 'all' || guestFilter.submitter !== 'all'
            const setGF = (patch) => { setGuestFilter((f) => ({ ...f, ...patch })); setPage(0) }
            const totalPages = Math.ceil(filteredGuests.length / PAGE_SIZE)
            const pageGuests = filteredGuests.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
            const pageSelectedCount = pageGuests.filter((g) => selectedGuests.has(g.id)).length
            const pageAllSelected = pageGuests.length > 0 && pageSelectedCount === pageGuests.length
            return (
              <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow overflow-hidden">
                {stats.pending > 0 && (
                  <div className="px-4 sm:px-6 py-3 bg-amber-50 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-800 flex items-center gap-3 flex-wrap">
                    <span className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                      ⏳ {stats.pending} RSVP{stats.pending === 1 ? '' : 's'} awaiting approval
                    </span>
                    <button onClick={handleApproveAll} disabled={loading}
                      className="bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-green-700 disabled:opacity-50 ml-auto">
                      Approve all
                    </button>
                  </div>
                )}
                {selectedGuests.size > 0 && (
                  <div className="px-4 sm:px-6 py-3 bg-indigo-50 dark:bg-indigo-900/30 border-b border-indigo-200 dark:border-indigo-800 flex items-center gap-3 flex-wrap">
                    <span className="text-sm font-semibold text-indigo-900 dark:text-indigo-100">
                      {selectedGuests.size} selected
                    </span>
                    <button
                      onClick={() => handleSendBatch({ ids: [...selectedGuests], force: true, label: 'Send to selected' })}
                      disabled={loading}
                      className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50">
                      Send invite to selected
                    </button>
                    {pageAllSelected && selectedGuests.size < filteredGuests.length && (
                      <button onClick={() => setSelectedGuests(new Set(filteredGuests.map((g) => g.id)))}
                        className="text-xs text-indigo-600 dark:text-indigo-300 underline font-semibold">
                        Select all {filteredGuests.length} guests
                      </button>
                    )}
                    {event?.seating_enabled && tableGroups.length > 0 && (
                      <select
                        defaultValue=""
                        onChange={(e) => { const v = e.target.value; e.target.value = ''; if (v) handleBulkAssignGroup(v === 'none' ? null : v) }}
                        disabled={loading}
                        className="text-xs border border-indigo-300 dark:border-indigo-700 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-700 dark:text-slate-200">
                        <option value="">Assign table group…</option>
                        {tableGroups.map((tg) => <option key={tg.id} value={tg.id}>{tg.name}</option>)}
                        <option value="none">— Clear group —</option>
                      </select>
                    )}
                    <button
                      onClick={() => setSelectedGuests(new Set())}
                      className="text-xs text-gray-600 dark:text-slate-300 hover:underline ml-auto">
                      Clear selection
                    </button>
                  </div>
                )}
                <div className="px-4 sm:px-6 py-4 border-b dark:border-slate-700 flex items-center justify-between gap-2 flex-wrap">
                  {(() => {
                    const paidOn = event.is_paid && event.paid_channels
                    const chans = []
                    if (event.notify_sms) chans.push('SMS')
                    if (event.notify_whatsapp) chans.push('WhatsApp')
                    if (event.notify_mms) chans.push('MMS')
                    if (!paidOn || chans.length === 0) return null
                    const minCost = (event.notify_sms || event.notify_whatsapp) ? 1 : 3
                    const bal = event.message_credits || 0
                    const names = chans.join('/')
                    if (bal < minCost) {
                      return (
                        <div className="w-full rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/30 px-3 py-2 text-sm text-red-800 dark:text-red-200">
                          ⚠️ <strong>{bal} message credits left.</strong> {names} won’t be sent (they show “Not sent”). Add message credits (Event Pass → Top up credits) to send {names}.
                        </div>
                      )
                    }
                    if (bal < minCost * 20) {
                      return (
                        <div className="w-full rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
                          Low balance: <strong>{bal} message credits</strong> left. Top up soon to keep {names} sending.
                        </div>
                      )
                    }
                    return null
                  })()}
                  <h2 className="font-semibold text-sm sm:text-base dark:text-white">Guest List ({filteredGuests.length}{groupFilter ? ` of ${guests.length}` : ''})</h2>
                  {event?.seating_enabled && tableGroups.length > 0 && (
                    <select value={groupFilter} onChange={(e) => { setGroupFilter(e.target.value); setPage(0) }}
                      className="text-xs border dark:border-slate-700 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-700 dark:text-slate-200">
                      <option value="">All table groups</option>
                      <option value="none">Unassigned</option>
                      {tableGroups.map((tg) => <option key={tg.id} value={tg.id}>{tg.name}</option>)}
                    </select>
                  )}
                  <select value={guestFilter.relationship} onChange={(e) => setGF({ relationship: e.target.value })}
                    className="text-xs border dark:border-slate-700 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-700 dark:text-slate-200">
                    <option value="all">All guest roles</option>
                    <option value="main">Main invited guests</option>
                    <option value="additional">Additional guests</option>
                    <option value="parent">Parents / guardians</option>
                    <option value="teacher">Teachers / staff</option>
                    <option value="vip">VIP / dignitaries</option>
                  </select>
                  {submitterOptions.length > 0 && (
                    <select value={guestFilter.submitter} onChange={(e) => setGF({ submitter: e.target.value })}
                      className="text-xs border dark:border-slate-700 rounded-lg px-2 py-1.5 bg-white dark:bg-slate-700 dark:text-slate-200">
                      <option value="all">All submitters / guest of</option>
                      {submitterOptions.map(([id, name]) => <option key={id} value={id}>Guest of {name}</option>)}
                    </select>
                  )}
                  <button onClick={() => handleSendBatch({ force: false, label: 'Send unsent' })}
                    disabled={loading || stats.total - stats.invited === 0}
                    title={stats.total - stats.invited === 0 ? 'Everyone has been invited' : 'Send to everyone not yet invited'}
                    className="text-xs px-2.5 py-1.5 rounded-lg bg-amber-500 text-white font-semibold hover:bg-amber-600 disabled:opacity-50">
                    ✉ Send invitations ({stats.total - stats.invited})
                  </button>
                  <button onClick={() => {
                      if (stats.total === 0) return
                      if (!confirm(`Re-send the invite to ALL ${stats.total} guests, including those already invited?`)) return
                      handleSendBatch({ force: true, label: 'Resend all' })
                    }}
                    disabled={loading || stats.total === 0}
                    className="text-xs px-2.5 py-1.5 rounded-lg border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-slate-700 disabled:opacity-50">
                    Resend to all
                  </button>
                  <button onClick={() => setShowAddGuest(true)}
                    className="text-xs px-2.5 py-1.5 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700">
                    + Add guest
                  </button>
                  <button onClick={() => handleExportGuests('csv')}
                    className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-slate-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700">
                    ⬇ Full CSV
                  </button>
                  <button onClick={() => handleExportGuests('xlsx')}
                    className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-slate-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700">
                    ⬇ Full XLSX
                  </button>
                  {totalPages > 1 && (
                    <div className="flex items-center gap-2">
                      <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
                        className="px-2 py-1 border dark:border-slate-700 rounded text-gray-600 dark:text-slate-300 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-slate-700 text-sm">←</button>
                      <span className="text-gray-500 dark:text-slate-400 text-xs">{page + 1} / {totalPages}</span>
                      <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}
                        className="px-2 py-1 border dark:border-slate-700 rounded text-gray-600 dark:text-slate-300 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-slate-700 text-sm">→</button>
                    </div>
                  )}
                </div>

                {/* Filter chips */}
                <div className="px-4 sm:px-6 py-2 border-b dark:border-slate-700 flex items-center gap-2 flex-wrap text-xs">
                  {[
                    ['Delivered', guestFilter.invited === 'sent',   () => setGF({ invited: guestFilter.invited === 'sent' ? 'all' : 'sent' }),   'bg-green-600'],
                    ['Failed',    guestFilter.invited === 'failed', () => setGF({ invited: guestFilter.invited === 'failed' ? 'all' : 'failed' }), 'bg-red-600'],
                    ['Not sent',  guestFilter.invited === 'unsent', () => setGF({ invited: guestFilter.invited === 'unsent' ? 'all' : 'unsent' }), 'bg-amber-600'],
                    ['Admitted',  guestFilter.admitted === 'yes',   () => setGF({ admitted: guestFilter.admitted === 'yes' ? 'all' : 'yes' }),    'bg-teal-600'],
                    ['Not admitted', guestFilter.admitted === 'no', () => setGF({ admitted: guestFilter.admitted === 'no' ? 'all' : 'no' }),     'bg-slate-600'],
                    ['No QR',     guestFilter.qr === 'pending',     () => setGF({ qr: guestFilter.qr === 'pending' ? 'all' : 'pending' }),       'bg-slate-600'],
                  ].map(([label, active, onClick, color]) => (
                    <button key={label} onClick={onClick}
                      className={`px-2.5 py-1 rounded-full font-semibold border ${
                        active ? `${color} text-white border-transparent`
                               : 'bg-white dark:bg-slate-700 text-gray-600 dark:text-slate-300 border-gray-300 dark:border-slate-600'
                      }`}>
                      {label}
                    </button>
                  ))}
                  {anyFilter && (
                    <button onClick={() => setGF({ invited: 'all', admitted: 'all', qr: 'all', relationship: 'all', submitter: 'all' })}
                      className="text-gray-500 dark:text-slate-400 hover:underline ml-1">Clear filters</button>
                  )}
                </div>

                {/* Desktop table */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-slate-700 text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">
                      <tr>
                        <th className="px-3 py-3 w-8">
                          <input
                            type="checkbox"
                            checked={pageAllSelected}
                            ref={(el) => { if (el) el.indeterminate = pageSelectedCount > 0 && !pageAllSelected }}
                            onChange={() => toggleSelectPage(pageGuests, pageAllSelected)}
                            className="cursor-pointer"
                            aria-label="Select page"
                          />
                        </th>
                        <th className="px-4 py-3 text-left">Name</th>
                        <th className="px-4 py-3 text-left">Email</th>
                        {event?.seating_enabled && <th className="px-4 py-3 text-left">Table Group</th>}
                        <th className="px-4 py-3 text-center">QR</th>
                        <th className="px-4 py-3 text-center">Invited</th>
                        <th className="px-4 py-3 text-center">Email</th>
                        {event?.notify_sms && <th className="px-4 py-3 text-center">SMS</th>}
                        {event?.notify_mms && <th className="px-4 py-3 text-center">MMS</th>}
                        {event?.notify_whatsapp && <th className="px-4 py-3 text-center">WhatsApp</th>}
                        <th className="px-4 py-3 text-center">RSVP</th>
                        <th className="px-4 py-3 text-center">Admitted</th>
                        <th className="px-4 py-3 text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                      {pageGuests.map((g) => (
                        <tr key={g.id} className={`hover:bg-gray-50 dark:hover:bg-slate-700 ${selectedGuests.has(g.id) ? 'bg-indigo-50/60 dark:bg-indigo-900/20' : ''}`}>
                          <td className="px-3 py-3">
                            <input
                              type="checkbox"
                              checked={selectedGuests.has(g.id)}
                              onChange={() => toggleSelectGuest(g.id)}
                              className="cursor-pointer"
                              aria-label={`Select ${g.first_name} ${g.last_name}`}
                            />
                          </td>
                          <td className="px-4 py-3 font-medium dark:text-slate-100">
                            <span className="inline-flex items-center gap-2">{g.first_name} {g.last_name}{g.is_vip && <VipBadge />}</span>
                            {(g.rsvp_submitter_guest_id || g.rsvp_submitter_name || g.rsvp_guest_type) && (
                              <div className="mt-1 space-y-0.5 text-[11px] leading-tight text-slate-500 dark:text-slate-400">
                                {g.rsvp_guest_type && <div>Type: {g.rsvp_guest_type}</div>}
                                {g.rsvp_submitter_guest_id === g.id ? (
                                  <div>Main invited guest</div>
                                ) : g.rsvp_submitter_name && (
                                  <div>
                                    Guest of {g.rsvp_submitter_name}
                                    {g.rsvp_relationship ? ` · ${g.rsvp_relationship}` : ''}
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-500 dark:text-slate-400 text-xs">{g.email}</td>
                          {event?.seating_enabled && (
                            <td className="px-4 py-3 text-xs">
                              {g.table_group_name
                                ? <span className="inline-block bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.5 rounded">{g.table_group_name}</span>
                                : <span className="text-gray-300 dark:text-slate-600">—</span>}
                            </td>
                          )}
                          <td className="px-4 py-3 text-center"><Badge on={!!g.qr_generated_at} labels={['Ready', 'Pending']} /></td>
                          <td className="px-4 py-3 text-center">
                            {g.invite_status === 'failed'
                              ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">Failed</span>
                              : <Badge on={!!g.invite_sent_at} labels={['Sent', 'Unsent']} />}
                          </td>
                          <td className="px-4 py-3 text-center"><EmailDeliveryBadge guest={g} /></td>
                          {event?.notify_sms && <td className="px-4 py-3 text-center"><MessageDeliveryBadge guest={g} channel="sms" /></td>}
                          {event?.notify_mms && <td className="px-4 py-3 text-center"><MessageDeliveryBadge guest={g} channel="mms" /></td>}
                          {event?.notify_whatsapp && <td className="px-4 py-3 text-center"><MessageDeliveryBadge guest={g} channel="whatsapp" /></td>}
                          <td className="px-4 py-3 text-center"><RsvpStatusBadge status={g.rsvp_status} /></td>
                          <td className="px-4 py-3 text-center">
                            {g.admitted
                              ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                                  {g.admitted_at ? new Date(g.admitted_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Yes'}
                                </span>
                              : <Badge on={false} labels={['', 'Pending']} />}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <div className="flex items-center justify-center gap-3">
                              {g.rsvp_status === 'pending' && (
                                <>
                                  <button onClick={() => handleApproveRsvp(g.id)} disabled={loading}
                                    className="text-xs font-semibold text-green-600 hover:underline disabled:opacity-40">Approve</button>
                                  <button onClick={() => handleRejectRsvp(g.id)} disabled={loading}
                                    className="text-xs text-red-500 hover:underline disabled:opacity-40">Reject</button>
                                </>
                              )}
                              {event?.invite_mode === 'closed' && (
                                <button onClick={() => handleCopyInviteLink(g.id)}
                                  className="text-xs text-teal-600 hover:underline">Copy link</button>
                              )}
                              {g.qr_generated_at && (
                                <a href={api.guestQrUrl(selectedId, g.id)} target="_blank" rel="noopener noreferrer"
                                  className="text-xs text-indigo-600 hover:underline">QR</a>
                              )}
                              {(g.qr_generated_at || event?.invite_mode === 'closed') && (
                                <button onClick={() => handleResendInvite(g.id)} disabled={loading}
                                  className="text-xs text-amber-600 hover:underline disabled:opacity-40">Invite</button>
                              )}
                              {g.admitted && (
                                <button onClick={() => handleResendGuestEmail(g.id, 'admission')} disabled={loading}
                                  className="text-xs text-green-600 hover:underline disabled:opacity-40">Admission</button>
                              )}
                              {event?.experience_enabled && (
                                <button onClick={() => handleResendGuestEmail(g.id, 'experience_next_steps')} disabled={loading}
                                  className="text-xs text-teal-600 hover:underline disabled:opacity-40">Experience</button>
                              )}
                              <button onClick={() => setViewingGuest(g)}
                                className="text-xs text-slate-500 dark:text-slate-300 hover:underline">View</button>
                              <button onClick={() => setEditingGuest(g)} disabled={loading}
                                className="text-xs text-teal-600 hover:underline disabled:opacity-40">Edit</button>
                              <button onClick={() => handleDeleteGuest(g.id)} disabled={loading}
                                className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40">Remove</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile cards */}
                <div className="sm:hidden divide-y divide-gray-100 dark:divide-slate-700">
                  {pageGuests.map((g) => (
                    <div key={g.id} className={`px-4 py-4 space-y-2 ${selectedGuests.has(g.id) ? 'bg-indigo-50/60 dark:bg-indigo-900/20' : ''}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={selectedGuests.has(g.id)}
                            onChange={() => toggleSelectGuest(g.id)}
                            className="mt-1 cursor-pointer"
                            aria-label={`Select ${g.first_name} ${g.last_name}`}
                          />
                          <div>
                            <div className="font-semibold text-sm dark:text-slate-100 flex items-center gap-2">{g.first_name} {g.last_name}{g.is_vip && <VipBadge />}</div>
                            <div className="text-xs text-gray-500 dark:text-slate-400 break-all">{g.email}</div>
                            {event?.seating_enabled && g.table_group_name && (
                              <div className="mt-1 inline-block text-[11px] bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.5 rounded">{g.table_group_name}</div>
                            )}
                          </div>
                        </div>
                        {g.admitted && (
                          <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                            ✓ {g.admitted_at ? new Date(g.admitted_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'In'}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge on={!!g.qr_generated_at} labels={['QR Ready', 'No QR']} />
                        <Badge on={!!g.invite_sent_at} labels={['Invited', 'Unsent']} />
                        <EmailDeliveryBadge guest={g} />
                        {event?.notify_sms && <MessageDeliveryBadge guest={g} channel="sms" />}
                        {event?.notify_mms && <MessageDeliveryBadge guest={g} channel="mms" />}
                        {event?.notify_whatsapp && <MessageDeliveryBadge guest={g} channel="whatsapp" />}
                        <RsvpStatusBadge status={g.rsvp_status} />
                      </div>
                      <div className="flex gap-4 pt-1">
                        {g.rsvp_status === 'pending' && (
                          <>
                            <button onClick={() => handleApproveRsvp(g.id)} disabled={loading}
                              className="text-xs font-semibold text-green-600 hover:underline disabled:opacity-40">Approve</button>
                            <button onClick={() => handleRejectRsvp(g.id)} disabled={loading}
                              className="text-xs text-red-500 hover:underline disabled:opacity-40">Reject</button>
                          </>
                        )}
                        {event?.invite_mode === 'closed' && (
                          <button onClick={() => handleCopyInviteLink(g.id)}
                            className="text-xs text-teal-600 hover:underline">Copy RSVP link</button>
                        )}
                        {g.qr_generated_at && (
                          <a href={api.guestQrUrl(selectedId, g.id)} target="_blank" rel="noopener noreferrer"
                            className="text-xs text-indigo-600 hover:underline">View QR</a>
                        )}
                        {(g.qr_generated_at || event?.invite_mode === 'closed') && (
                          <button onClick={() => handleResendInvite(g.id)} disabled={loading}
                            className="text-xs text-amber-600 hover:underline disabled:opacity-40">Resend invite</button>
                        )}
                        {g.admitted && (
                          <button onClick={() => handleResendGuestEmail(g.id, 'admission')} disabled={loading}
                            className="text-xs text-green-600 hover:underline disabled:opacity-40">Admission email</button>
                        )}
                        {event?.experience_enabled && (
                          <button onClick={() => handleResendGuestEmail(g.id, 'experience_next_steps')} disabled={loading}
                            className="text-xs text-teal-600 hover:underline disabled:opacity-40">Experience steps</button>
                        )}
                        <button onClick={() => setViewingGuest(g)}
                          className="text-xs text-slate-500 dark:text-slate-300 hover:underline">View</button>
                        <button onClick={() => setEditingGuest(g)} disabled={loading}
                          className="text-xs text-teal-600 hover:underline disabled:opacity-40">Edit</button>
                        <button onClick={() => handleDeleteGuest(g.id)} disabled={loading}
                          className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40 ml-auto">Remove</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
