import { useEffect, useState } from 'react'
import { api } from '../../api'
import '../../pages/SelfCheckinRedesignPage.css'

export function invitationToken(value) {
  const input = value.trim()
  if (/^[a-zA-Z0-9_-]{16,200}$/.test(input)) return input
  try {
    const url = new URL(input)
    const match = url.pathname.match(/^\/(?:r|scan|pass)\/([a-zA-Z0-9_-]{16,200})\/?$/)
    return match?.[1] || ''
  } catch { return '' }
}

function currentLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('Location is unavailable on this device. Please visit the check-in desk.')); return }
    navigator.geolocation.getCurrentPosition(position => resolve({
      latitude: position.coords.latitude, longitude: position.coords.longitude,
      accuracy_m: position.coords.accuracy, captured_at: new Date(position.timestamp).toISOString(),
    }), error => reject(new Error(error.code === 1
      ? 'Allow location access in your browser settings, then try again. The check-in desk can also help.'
      : 'Your location could not be verified. Move near the entrance and try again, or visit the check-in desk.')),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 })
  })
}

export default function VenuePartyCheckin({ code, info }) {
  const initialToken = new URLSearchParams(window.location.hash.slice(1)).get('token') || new URLSearchParams(window.location.search).get('token') || ''
  const [entry, setEntry] = useState(initialToken)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState([])
  const [lookupMessage, setLookupMessage] = useState('')
  const [token, setToken] = useState('')
  const [party, setParty] = useState(null)
  const [selected, setSelected] = useState([])
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [results, setResults] = useState(null)

  async function load(value) {
    const credential = value.startsWith('lookup.') ? value : invitationToken(value)
    if (!credential) { setError('Paste your personal invitation link from your confirmation message.'); return }
    setBusy('Loading your registration…'); setError(''); setResults(null); setParty(null); setSelected([]); setConfirmed(false)
    try {
      const data = await api.selfCheckinParty(code, { token: credential })
      setToken(credential); setParty(data)
      setSelected(data.members.filter(m => m.id === data.viewer_id && !m.admitted).map(m => m.id))
    } catch (err) { setError(err.message || 'Your registration could not be loaded. Please try again.') }
    finally { setBusy('') }
  }
  useEffect(() => { if (initialToken) load(initialToken) }, [code]) // eslint-disable-line react-hooks/exhaustive-deps

  async function search() {
    if (busy || query.trim().length < 3) return
    setBusy(info.location_required ? 'Verifying your location…' : 'Finding your registration…')
    setError(''); setMatches([]); setLookupMessage('')
    try {
      const location = info.location_required ? await currentLocation() : undefined
      setBusy('Finding your registration…')
      const data = await api.selfCheckinLookup(code, { query: query.trim(), location })
      setMatches(data.matches || []); setLookupMessage(data.message || '')
    } catch (err) { setError(err.message || 'Your registration could not be found. Please try again.') }
    finally { setBusy('') }
  }

  function restartSearch() {
    setParty(null); setToken(''); setSelected([]); setConfirmed(false)
    setMatches([]); setResults(null); setError(''); setLookupMessage('')
  }

  async function checkin() {
    if (busy || !confirmed || !selected.length) return
    setError(''); setResults(null); setBusy(info.location_required ? 'Verifying your location…' : 'Checking in…')
    try {
      const location = info.location_required ? await currentLocation() : undefined
      setBusy('Checking in…')
      const data = await api.selfCheckinPartyAdmit(code, { token, guest_ids: selected, confirm_arrived: true, location })
      setResults(data)
      const done = data.filter(r => ['admitted', 'already_admitted'].includes(r.status))
      // Refresh server state: failed admissions remain selectable for retry and
      // unselected companions remain untouched, including on partial success.
      const refreshed = await api.selfCheckinParty(code, { token })
      setParty(refreshed); setSelected([]); setConfirmed(false)
      if (!done.length && !data.length) setError('No check-ins were recorded. Please try again.')
    } catch (err) { setError(err.message || 'Check-in could not be confirmed. Please reload your registration before retrying.') }
    finally { setBusy('') }
  }

  return <main className="ki-kiosk"><section className="ki-card vp-card">
    <div className="ki-logo" aria-hidden="true">F</div>
    <h1 className="ki-title">{info.name}</h1>
    <h2 className="vp-heading">{info.party_enabled ? 'Check in your RSVP party' : 'Self check-in'}</h2>
    {info.location_required && <p className="ki-subtitle">Check in when you arrive at {info.venue_name || 'the venue'}. Allow location access to verify you are nearby.</p>}
    {!party && info.lookup_enabled && <form className="ki-form" onSubmit={e => { e.preventDefault(); search() }}>
      <label htmlFor="registration-query">Name, phone number or email</label>
      <input id="registration-query" className="ki-input" value={query} onChange={e => { setQuery(e.target.value); setMatches([]); setLookupMessage('') }} autoComplete="off" placeholder="Enter your name, phone number or email"/>
      <p className="vp-note">Enter your name or the full phone number or email used for your RSVP. Select your registration, then choose who has arrived.</p>
      <button className="ki-btn" disabled={!!busy || query.trim().length < 3}>Find my registration</button>
      {lookupMessage && <p className="vp-note" role="status">{lookupMessage}</p>}
      {matches.length > 0 && <div className="ki-results"><p className="ki-results-label">Select your registration</p>{matches.map(match => <button type="button" className="ki-result-row" disabled={!!busy} key={match.lookup_token} onClick={() => load(match.lookup_token)}>{match.name}<span aria-hidden="true"> →</span></button>)}</div>}
    </form>}
    {!party && !info.lookup_enabled && <form className="ki-form" onSubmit={e => { e.preventDefault(); load(entry) }}>
      <label htmlFor="personal-invitation">Your personal invitation link</label>
      <input id="personal-invitation" className="ki-input" value={entry} onChange={e => setEntry(e.target.value)} autoComplete="off" placeholder="Paste the link from your invitation"/>
      <p className="vp-note">Use the invitation or GuestHub link sent to you. Only you and guests you registered will appear. The check-in desk can help if you cannot find your link.</p>
      <button className="ki-btn" disabled={!!busy || !entry.trim()}>Find my registration</button>
    </form>}
    {party && <>
      <p className="ki-subtitle">Select only the guests who have arrived. Guests arriving later can check in later.</p>
      <fieldset className="vp-members" disabled={!!busy}>
        <legend>Who has arrived?</legend>
        {party.members.map(member => <label className="vp-member" key={member.id}>
          <input type="checkbox" checked={selected.includes(member.id)} disabled={member.admitted} onChange={e => {
            setSelected(ids => e.target.checked ? [...ids, member.id] : ids.filter(id => id !== member.id)); setConfirmed(false)
          }}/>
          <span><strong>{member.name}{member.id === party.viewer_id ? ' (You)' : ''}</strong><small>{member.admitted ? 'Already checked in' : 'Not checked in'}</small></span>
        </label>)}
      </fieldset>
      <label className="vp-confirm"><input type="checkbox" checked={confirmed} disabled={!!busy} onChange={e => setConfirmed(e.target.checked)}/>I confirm everyone selected is here with me at the venue.</label>
      <button className="ki-btn" disabled={!!busy || !confirmed || !selected.length} onClick={checkin}>Check in {selected.length || ''} {selected.length === 1 ? 'guest' : 'guests'}</button>
      <button className="vp-reload" disabled={!!busy} onClick={() => load(token)}>Refresh registration</button>
      {info.lookup_enabled && <button className="vp-reload" disabled={!!busy} onClick={restartSearch}>Find another registration</button>}
    </>}
    {busy && <p role="status" className="vp-note">{busy}</p>}
    {error && <p role="alert" className="vp-error">{error}</p>}
    {results && <section aria-live="polite" className="vp-results"><h2 className="vp-heading">Check-in results</h2>{results.map((result, index) => <div key={index} className="vp-result">
      <strong>{result.admitted_guest}</strong><p>{result.message || (result.status === 'admitted' ? 'Checked in. Welcome!' : 'Please visit the check-in desk.')}</p>
      {(result.table_name || result.seat_number) && <p>{result.table_name && `${result.seating_term || 'Table'} ${result.table_name} `}{result.seat_number && `${result.seat_term || 'Seat'} ${result.seat_number}`}</p>}
    </div>)}</section>}
    <p className="vp-note">Having trouble? Staff can check you in at the check-in desk.</p>
  </section></main>
}
