import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import { zonedWallTimeToUtcISOString, utcToZonedInput } from '../timeutil'
import ProtectedRoute from '../components/ProtectedRoute'
import InvitationOpening from '../components/invitations/InvitationOpening'
import './QuickInvite.css'

const labels = { going: 'Going', maybe: 'Maybe', declined: "Can’t attend" }
const initial = () => {
  try { const saved = JSON.parse(localStorage.getItem('festio:quick-invite-draft')); if (saved?.request_id) return saved } catch {}
  return { name: '', localDate: '', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', venue_name: '', message: '', style: 'editorial', colour: 'mint', cover: '', envelope: false, request_id: crypto.randomUUID() }
}
function displayDate(data) {
  if (!data.event_date) return 'Your date & time'
  try { return new Intl.DateTimeFormat(undefined, { timeZone: data.timezone, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(data.event_date)) } catch { return 'Your date & time' }
}
export function InvitationCard({ data, children }) {
  return <article className={`qi-invitation qi-${data.style || 'editorial'} qi-${data.colour || 'mint'}`}>
    {data.cover && <img className="qi-cover" src={data.cover} alt="" referrerPolicy="no-referrer" />}
    <div className="qi-card-inner"><span className="qi-eyebrow">A MOMENT TO SHARE</span><span className="qi-flower" aria-hidden="true">✳</span>
      <h1>{data.name || 'Good company. A lovely occasion.'}</h1><p className="qi-message">{data.message || 'Some moments are better when we’re together. We’d love to see you there.'}</p>
      <div className="qi-date">{displayDate(data)}<small>{data.timezone}</small></div><p className="qi-place">{data.venue_name?.startsWith('https://') ? <a href={data.venue_name} target="_blank" rel="noopener noreferrer">Join online ↗</a> : data.venue_name || 'Location to be announced'}</p>{children}
    </div>
  </article>
}
function Frame({ children, publicView = false }) {
  return <div className={`qi-app${publicView ? ' qi-public' : ''}`}><header className="qi-header"><Link to="/" className="qi-brand"><b>F</b> Festio</Link><span>{publicView ? 'A little invitation. A lovely occasion.' : 'Invitations, made easy.'}</span><Link to="/create-invitation">Create a free invitation ↗</Link></header>{children}<footer className="qi-footer"><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link><span>Made for moments that bring people together.</span></footer></div>
}
export default function QuickInviteEntry() {
  const { user } = useAuth()
  const [params] = useSearchParams()
  const editor = <QuickInvite key={user?.id || 'anonymous'} />
  return params.get('event') ? <ProtectedRoute>{editor}</ProtectedRoute> : editor
}
function QuickInvite() {
  const { user } = useAuth(), [params, setParams] = useSearchParams(), navigate = useNavigate()
  const eventId = params.get('event')
  const [draft, setDraft] = useState(initial), [workspace, setWorkspace] = useState(null), [myInvites, setMyInvites] = useState([])
  const [editing, setEditing] = useState(!eventId), [emails, setEmails] = useState(''), [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [error, setError] = useState('')
  function update(key, value) { setDraft(prev => ({ ...prev, [key]: value })) }
  useEffect(() => { if (eventId) return; try { localStorage.setItem('festio:quick-invite-draft', JSON.stringify(draft)) } catch {} }, [draft, eventId])
  async function load() {
    if (!user) return
    setError('')
    try {
      if (eventId) {
        const result = await api.quickInviteWorkspace(eventId); setWorkspace(result)
        setDraft({ ...result.invitation, localDate: utcToZonedInput(result.invitation.event_date, result.invitation.timezone), request_id: draft.request_id })
      } else setMyInvites(await api.quickInvites())
    } catch (e) { setError(e.message) }
  }
  useEffect(() => { load() }, [user, eventId])
  useEffect(() => {
    if (!workspace?.recipients?.some(p => ['queued', 'sending'].includes(p.send_status))) return
    const timer = setInterval(async () => { try { setWorkspace(await api.quickInviteWorkspace(eventId)) } catch {} }, 5000)
    return () => clearInterval(timer)
  }, [workspace, eventId])
  let preview = { ...draft }
  try { if (draft.localDate) preview.event_date = zonedWallTimeToUtcISOString(draft.localDate, draft.timezone) } catch {}
  async function save(e) {
    e.preventDefault(); setError(''); setNotice('')
    if (!user) { navigate('/register?redesign=1&next=/create-invitation'); return }
    setBusy(true)
    try {
      const body = { ...draft, event_date: zonedWallTimeToUtcISOString(draft.localDate, draft.timezone) }; delete body.localDate
      if (utcToZonedInput(body.event_date, draft.timezone) !== draft.localDate) throw new Error('That local time does not exist in this timezone. Choose a different time.')
      const result = eventId ? await api.updateQuickInvite(eventId, body) : await api.createQuickInvite(body)
      if (!eventId) { try { localStorage.removeItem('festio:quick-invite-draft') } catch {} }
      setWorkspace(result); setParams({ event: result.id }); setEditing(false); setNotice('Your invitation is ready to share.')
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(workspace.url); setNotice('Invitation link copied.') } catch { setNotice('Copy the invitation link from the field below.') }
  }
  async function share() {
    if (!navigator.share) return copy()
    try { await navigator.share({ title: workspace.invitation.name, text: 'You’re invited!', url: workspace.url }) } catch (e) { if (e.name !== 'AbortError') setNotice('Sharing is unavailable. Copy the invitation link below.') }
  }
  async function send() {
    setBusy(true); setError(''); setNotice('')
    try {
      const recipients = [...new Set(emails.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean))].map(email => ({ email, name: '' }))
      if (!recipients.length) throw new Error('Add at least one email address.')
      if (recipients.length > 25) throw new Error('Enter up to 25 email addresses.')
      if (!window.confirm(`Send invitations to ${recipients.length} email addresses? Already queued or accepted invitations will be skipped.`)) return
      const result = await api.sendQuickInvite(eventId, { recipients, confirm: true }); setNotice(`${result.queued} queued; ${result.skipped} already queued, accepted, or awaiting review. Provider acceptance will appear below.`)
      setEmails(''); setWorkspace(await api.quickInviteWorkspace(eventId))
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return <Frame><main className="qi-studio"><div className="qi-intro"><span className="qi-eyebrow">START WITH SOMETHING SIMPLE</span><h1>A reason to gather.<br /><em>An invitation to remember.</em></h1><p>Make it yours. Email it or share a link. Keep every reply in one place.</p><div className="qi-chips"><span>Free first event</span><span>Up to 25 guests</span><span>No guest account needed</span></div></div>
    {error && <div className="qi-alert" role="alert">{error}<button onClick={load}>Retry</button></div>}{notice && <p className="qi-notice" role="status">{notice}</p>}
    {user && !eventId && myInvites.length > 0 && <section className="qi-existing"><h2>Your invitations</h2>{myInvites.map(item => <Link key={item.id} to={`/create-invitation?event=${item.id}`} onClick={() => setEditing(false)}>{item.name} <span>Open →</span></Link>)}</section>}
    <div className="qi-workspace"><section className="qi-controls">
      {editing ? <form onSubmit={save}><span className="qi-eyebrow">01 / THE DETAILS</span><h2>What’s the occasion?</h2><label>Invitation title<input required maxLength={160} value={draft.name} placeholder="Dinner under the stars" onChange={e => update('name', e.target.value)} /></label>
        <div className="qi-fields"><label>Date & time<input required type="datetime-local" value={draft.localDate} onChange={e => update('localDate', e.target.value)} /></label><label>Timezone<input required value={draft.timezone} list="qi-zones" onChange={e => update('timezone', e.target.value)} /></label><datalist id="qi-zones">{['America/Chicago', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Africa/Lagos', 'Asia/Dubai', 'UTC'].map(z => <option key={z}>{z}</option>)}</datalist></div>
        <label>Location or meeting link<input maxLength={300} value={draft.venue_name} onChange={e => update('venue_name', e.target.value)} placeholder="A place, address, or online meeting" /></label><label>A note to your guests<textarea maxLength={2000} value={draft.message} onChange={e => update('message', e.target.value)} placeholder="We’d love for you to join us…" rows={4} /></label>
        <span className="qi-eyebrow">02 / YOUR LOOK</span><h2>A little personality.</h2><div className="qi-options" aria-label="Invitation style">{['editorial', 'arch', 'minimal'].map(style => <button type="button" key={style} aria-pressed={draft.style === style} onClick={() => update('style', style)}>{style[0].toUpperCase() + style.slice(1)}</button>)}</div><div className="qi-options" aria-label="Invitation colour">{['mint', 'lavender', 'rose'].map(colour => <button type="button" key={colour} className={`qi-swatch qi-${colour}`} aria-pressed={draft.colour === colour} onClick={() => update('colour', colour)}>{colour}</button>)}</div>
        <label className="qi-checkbox"><input type="checkbox" checked={!!draft.envelope} onChange={e => update('envelope', e.target.checked)} />Open with an envelope — reveal the invitation automatically</label><details><summary>Add a cover image</summary><label>HTTPS image URL<input type="url" value={draft.cover} onChange={e => update('cover', e.target.value)} placeholder="https://…" /></label></details>
        <button className="qi-button primary" disabled={busy}>{busy ? 'Saving…' : eventId ? 'Save invitation' : user ? 'Create invitation & get link →' : 'Continue to share →'}</button>
        {!user && <div className="qi-auth"><p>Design first. Sign in when you’re ready to publish. Your draft stays here.</p><Link className="qi-button" to="/register?redesign=1&next=/create-invitation">Create free account</Link><Link to="/login?next=/create-invitation">Already have an account? Sign in</Link></div>}
        <small className="qi-help">Your first event includes up to 25 guests. Existing account limits apply. No card needed to start.</small>
      </form> : workspace ? <><span className="qi-eyebrow">YOUR INVITATION IS READY</span><h2>Let’s get people together.</h2><div className="qi-share-actions"><button className="qi-button primary" onClick={copy}>Copy invitation link</button><button className="qi-button" onClick={share}>Share invitation ↗</button></div><label>Shareable link<input readOnly value={workspace.url} onFocus={e => e.target.select()} /></label><a href={workspace.url} target="_blank" rel="noreferrer">Open invitation preview ↗</a><button className="qi-link" onClick={() => setEditing(true)}>Edit invitation details & design</button>
        <hr /><h2>Or send it by email.</h2><p>Paste email addresses, separated by spaces or commas. Each person receives a private reply link.</p><label>Email addresses<textarea rows={3} value={emails} onChange={e => setEmails(e.target.value)} placeholder="alex@example.com, sam@example.com" /></label><button className="qi-button primary" disabled={busy || !emails.trim()} onClick={send}>{busy ? 'Queuing…' : 'Review & send emails'}</button><small className="qi-help">Up to 25 contacts. {Math.max(0, workspace.email_limit - workspace.email_attempts)} free email attempts remain. No paid message credits are spent here.</small>
        <section className="qi-replies"><h2>The replies are coming in.</h2><div className="qi-counts">{['going', 'maybe', 'declined'].map(choice => <div key={choice}><b>{workspace.recipients.filter(p => p.response === choice).length}</b>{labels[choice]}</div>)}</div><button className="qi-link" onClick={load}>Refresh replies</button>{!workspace.recipients.length && <p>No replies yet. Share your invitation to get started.</p>}{workspace.recipients.map(p => <div className="qi-person" key={p.id}><span><strong>{p.name || p.email || 'Guest'}</strong><small>{p.name ? p.email : ''}</small></span><span>{({ ...labels, approval: 'Awaiting approval', waitlisted: 'Waitlisted' })[p.response] || 'Awaiting reply'}<small>{({ sent: 'Email provider accepted', queued: 'Email queued', sending: 'Sending email', failed: 'Email failed — retry by pasting the address again', uncertain: 'Email outcome unknown — contact support before resending', draft: '' })[p.send_status]}</small></span></div>)}</section></> : <p role="status">Loading your invitation…</p>}
    </section><aside className="qi-preview"><span className="qi-eyebrow">YOUR GUEST’S FIRST IMPRESSION</span><InvitationCard data={editing ? preview : workspace?.invitation || preview}><div className="qi-preview-reply"><span>Going ✓</span><span>Maybe</span><span>Can’t attend</span></div></InvitationCard><p>One link. A beautiful invitation. A simple reply.</p></aside></div>
    {workspace && <section className="qi-grow"><span className="qi-eyebrow">WHEN YOUR OCCASION GROWS</span><h2>Your invitation is just the beginning.</h2><p>Keep this event and its guests. Add the services you need, when you need them. Paid features show their price before activation.</p><div>{[['Design Studio', 'Give every guest touchpoint one connected look.', '/design-studio-redesign'], ['Tickets & payments', 'Turn an occasion into a ticketed event.', '/ticketing-redesign'], ['Seating & planning', 'Bring your venue, tables and team together.', '/planner-redesign'], ['Full event workspace', 'Guest lists, passes, check-in and more.', '/admin-redesign']].map(([title, text, route]) => <Link key={route} to={`${route}?event=${eventId}`}><h3>{title} ↗</h3><p>{text}</p></Link>)}</div></section>}
  </main></Frame>
}

export function QuickInvitePublic() {
  const { token } = useParams(), [params, setParams] = useSearchParams(), [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false), [opened, setOpened] = useState(false)
  const [name, setName] = useState(''), [email, setEmail] = useState(''), [choice, setChoice] = useState('going'), [requestId] = useState(() => crypto.randomUUID())
  const storageKey = `festio:invitation-reply:${token}`
  const credential = () => { if (params.get('reply')) return params.get('reply'); try { return localStorage.getItem(storageKey) } catch { return null } }
  async function load() {
    setError('')
    try { const result = await api.publicQuickInvite(token, credential()); setData(result); setName(result.recipient?.name || ''); setChoice(result.recipient?.response || 'going'); setSaved(!!result.recipient?.response) } catch (e) { setError(e.message) }
  }
  useEffect(() => { load(); const meta = document.createElement('meta'); meta.name = 'referrer'; meta.content = 'no-referrer'; document.head.append(meta); return () => meta.remove() }, [token])
  async function respond(e) {
    e.preventDefault(); setBusy(true); setError('')
    try { const result = await api.replyQuickInvite(token, { name, email: email || null, response: choice, reply_token: credential(), request_id: requestId }); try { localStorage.setItem(storageKey, result.reply_token) } catch {} setParams({ reply: result.reply_token }, { replace: true }); setSaved(true) } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return <Frame publicView>{data?.invitation.envelope && !opened && !saved && <InvitationOpening appearance={{ style: 'classic', palette: data.invitation.colour === 'lavender' ? 'navy' : data.invitation.colour === 'rose' ? 'blush' : 'emerald', initials: data.invitation.name[0] }} event={{ name: data.invitation.name }} openSignal={1} continueMode="auto" onDone={() => setOpened(true)} />}<main className="qi-guest"><div className="qi-guest-card">{data && <InvitationCard data={data.invitation}>{data.registration_url ? <section className="qi-thanks"><h2>There’s more to this occasion.</h2><p>Your organizer has added registration steps. Continue to the event page to complete them.</p><a className="qi-button primary" href={data.registration_url}>Continue to registration →</a></section> : saved ? <section className="qi-thanks" role="status"><h2>Thank you, {name}.</h2><p>Your reply: <strong>{labels[choice]}</strong></p><p>Your organizer can now see your response. Keep this reply link private.</p><button className="qi-button" onClick={() => setSaved(false)}>Change my reply</button></section> : <form className="qi-rsvp" onSubmit={respond}><h2>Will you join us?</h2><div className="qi-options">{Object.entries(labels).map(([value, label]) => <button key={value} type="button" aria-pressed={choice === value} onClick={() => setChoice(value)}>{label}</button>)}</div><label>Your name<input required maxLength={200} autoComplete="name" value={name} onChange={e => setName(e.target.value)} /></label>{!credential() && <label>Email <small>(optional)</small><input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /></label>}<button className="qi-button primary" disabled={busy}>{busy ? 'Saving your reply…' : 'Send my reply →'}</button><small>Your reply is private. No account needed.</small></form>}</InvitationCard>}{error && <div role="alert" className="qi-alert">{error}{!data && <button onClick={load}>Try again</button>}</div>}{!data && !error && <p role="status">Opening your invitation…</p>}</div><section className="qi-guest-promo"><span className="qi-eyebrow">YOUR NEXT OCCASION?</span><h2>Bring your people together.</h2><p>Create your own free invitation with Festio.</p><Link className="qi-button" to="/create-invitation?source=invitation">Make an invitation ↗</Link></section></main></Frame>
}
