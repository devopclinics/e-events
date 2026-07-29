import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import './SelfCheckinRedesignPage.css'

const OUTCOMES = {
  admitted: { label: 'Welcome!', sub: "You're checked in. Enjoy the event!", icon: '✅', tone: 'green' },
  already_admitted: { label: 'Already checked in', sub: 'Your check-in was recorded earlier. Please see the check-in desk if you need help.', icon: '✓', tone: 'amber' },
  invalid: { label: 'Unable to check in', sub: 'Please visit the check-in desk for assistance.', icon: '!', tone: 'red' },
  not_active: { label: 'Check-in is not open', sub: 'Please see the organizer for assistance.', icon: '◷', tone: 'amber' },
}

function PublicError({ title, message, onRetry }) {
  return <div className="ki-outcome-step ki-tone-red" role="alert">
    <div className="ki-outcome-icon">!</div><h2 className="ki-outcome-title">{title}</h2>
    <p className="ki-outcome-sub">{message}</p>
    {onRetry && <button className="ki-btn ki-btn-restart" onClick={onRetry}>Try again</button>}
  </div>
}

function SearchStep({ eventName, code, onFound }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searched, setSearched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleSearch() {
    if (query.trim().length < 2 || busy) return
    setBusy(true); setError('')
    try {
      const response = await api.selfCheckinSearch(code, query.trim())
      if (response.status !== 'ok') throw new Error(response.message || 'Check-in is not available.')
      setResults(response.guests || []); setSearched(true)
    } catch (err) { setError(err.message || 'Search could not be completed. Check your connection and try again.') }
    finally { setBusy(false) }
  }

  return <div className="ki-search-step">
    <div className="ki-logo">F</div>
    <h1 className="ki-title">{eventName || 'Welcome!'}</h1>
    <p className="ki-subtitle">Enter your name or phone number to find your registration.</p>
    <div className="ki-form">
      <input className="ki-input" aria-label="Name or phone" autoComplete="name" placeholder="Name or phone number…" value={query}
        onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && handleSearch()}/>
      <button className="ki-btn" disabled={query.trim().length < 2 || busy} onClick={handleSearch}>{busy ? 'Searching…' : 'Search'}</button>
    </div>
    {error && <p className="ki-outcome-sub" role="alert">{error}</p>}
    {searched && results.length === 0 && <p className="ki-outcome-sub">No matching registration was found. Try another spelling or visit the check-in desk.</p>}
    {results.length > 0 && <div className="ki-results">
      <p className="ki-results-label">Select your name</p>
      {results.map((guest) => <button key={guest.id} className="ki-result-row" onClick={() => onFound(guest)}>
        <div className="ki-result-avatar">{guest.name?.[0] || '?'}</div>
        <div className="ki-result-info"><strong>{guest.name}</strong><small>Registration match</small></div>
        <div className="ki-result-arrow">→</div>
      </button>)}
    </div>}
  </div>
}

function ConfirmStep({ guest, busy, error, onConfirm, onBack }) {
  return <div className="ki-confirm-step">
    <div className="ki-logo">F</div><p className="ki-confirm-prompt">Is this you?</p>
    <div className="ki-confirm-card"><div className="ki-confirm-avatar">{guest.name?.[0] || '?'}</div><strong className="ki-confirm-name">{guest.name}</strong></div>
    {error && <p className="ki-outcome-sub" role="alert">{error}</p>}
    <div className="ki-confirm-actions">
      <button className="ki-btn ki-btn-yes" disabled={busy} onClick={onConfirm}>{busy ? 'Checking in…' : "Yes, that's me"}</button>
      <button className="ki-btn ki-btn-no" disabled={busy} onClick={onBack}>No, go back</button>
    </div>
  </div>
}

function OutcomeStep({ result, onReset }) {
  const info = OUTCOMES[result.status] || OUTCOMES.invalid
  const seat = [result.table_name && `${result.seating_term || 'Table'} ${result.table_name}`, result.seat_number && `Seat ${result.seat_number}`].filter(Boolean).join(', ')
  return <div className={`ki-outcome-step ki-tone-${info.tone}`} role="status">
    <div className="ki-outcome-icon">{info.icon}</div><h2 className="ki-outcome-title">{info.label}</h2>
    <p className="ki-outcome-sub">{result.message || info.sub}</p>
    {seat && <div className="ki-outcome-seat">Your seat: <strong>{seat}</strong></div>}
    <button className="ki-btn ki-btn-restart" onClick={onReset}>Check in another guest</button>
  </div>
}

export default function SelfCheckinRedesignPage() {
  const params = useParams()
  const [searchParams] = useSearchParams()
  const code = params.code || searchParams.get('code') || ''
  const [bootstrap, setBootstrap] = useState(null)
  const [bootstrapError, setBootstrapError] = useState('')
  const [pending, setPending] = useState(null)
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [admitError, setAdmitError] = useState('')

  async function load() {
    if (!code) { setBootstrap({ status: 'invalid', message: 'This check-in link is missing its event code.' }); return }
    setBootstrap(null); setBootstrapError('')
    try {
      const response = await api.selfCheckinInfo(code)
      setBootstrap(response)
    } catch (error) { setBootstrapError(error.message || 'Check-in could not be loaded. Check your connection and try again.') }
  }
  useEffect(() => { load() }, [code]) // eslint-disable-line react-hooks/exhaustive-deps

  async function confirm() {
    if (!pending || busy) return
    setBusy(true); setAdmitError('')
    try { setResult(await api.selfCheckinAdmit(code, pending.id)) }
    catch (error) { setAdmitError(error.message || 'Check-in could not be recorded. Check your connection and try again.') }
    finally { setBusy(false) }
  }

  function reset() { setPending(null); setResult(null); setAdmitError('') }

  return <div className="ki-kiosk"><div className="ki-card">
    {bootstrapError ? <PublicError title="Connection problem" message={bootstrapError} onRetry={load}/> :
      !bootstrap ? <div className="ki-search-step"><div className="ki-logo">F</div><p className="ki-subtitle">Loading check-in…</p></div> :
      bootstrap.status !== 'ok' ? <PublicError title={bootstrap.status === 'not_active' ? 'Check-in is not open' : 'Invalid check-in link'} message={bootstrap.message}/> :
      result ? <OutcomeStep result={result} onReset={reset}/> :
      pending ? <ConfirmStep guest={pending} busy={busy} error={admitError} onConfirm={confirm} onBack={reset}/> :
      <SearchStep eventName={bootstrap.name} code={code} onFound={setPending}/>}
  </div></div>
}
