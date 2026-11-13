import { useEffect, useState } from 'react'
import { api } from '../../../api'
import { utcDate } from './resultsSummary.mjs'

export default function CertificatesTab({ eventId, registered, timezone = 'UTC', compact = false, onOpen }) {
  const [state, setState] = useState({ loading: true })
  const [revision, setRevision] = useState(0)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  useEffect(() => {
    let current = true
    setState({ loading: true }); setSearch(''); setStatus('all')
    api.certificateReport(eventId).then(report => { if (current) setState({ report }) })
      .catch(() => { if (current) setState({ error: 'Certificate results could not be loaded. Try refreshing.' }) })
    return () => { current = false }
  }, [eventId, revision])
  const rows = state.report?.rows || []
  const active = rows.filter(row => row.status === 'issued')
  const recipients = new Set(active.map(row => row.guest_id)).size
  const metrics = [
    ['Certificates issued', active.length],
    ['Recipients', recipients],
    ['Without an active certificate', registered == null ? '—' : Math.max(0, registered - recipients)],
    ['Email queued', rows.filter(row => row.sent_at).length],
    ['Viewed', rows.filter(row => row.viewed_at).length],
    ['Revoked', rows.filter(row => row.status === 'revoked').length],
  ]
  const visible = rows.filter(row => `${row.guest_name || ''} ${row.email || ''} ${row.certificate_number || ''} ${row.template_name || ''}`.toLowerCase().includes(search.toLowerCase().trim()) && (status === 'all' || row.status === status))
  const date = value => value ? utcDate(value)?.toLocaleString(undefined, { timeZone: timezone }) || '—' : '—'
  function exportCsv() {
    const safe = value => { const text = String(value ?? ''); return `"${(/^[\s]*[=+@-]/.test(text) ? "'" + text : text).replaceAll('"', '""')}"` }
    const values = [['Participant', 'Email', 'Template', 'Certificate number', 'Status', 'Issued at', 'Email queued at', 'Viewed at', 'Verification URL'], ...visible.map(row => [row.guest_name, row.email, row.template_name, row.certificate_number, row.status, row.issued_at, row.sent_at, row.viewed_at, row.verification_url])]
    const url = URL.createObjectURL(new Blob(['\ufeff' + values.map(row => row.map(safe).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = `certificate-results-${eventId}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <section className="er-certificates" aria-label="Certificate issuance results">
    <header><div><span>Certificates · Entire event</span><h2>Certificate issuance</h2></div><div>{compact ? <button onClick={onOpen}>View certificate results →</button> : <><button onClick={() => setRevision(value => value + 1)}>Refresh certificate results</button><button disabled={!state.report} onClick={exportCsv}>Export certificates CSV</button><a href="/live-redesign?tab=Certificates">Manage certificates →</a></>}</div></header>
    {state.loading ? <p role="status">Loading certificate results…</p> : state.error ? <p role="alert">{state.error} <button onClick={() => setRevision(value => value + 1)}>Retry</button></p> : <>
      <div className="er-certificate-metrics">{metrics.map(([label, value]) => <article key={label}><strong>{value}</strong><span>{label}</span></article>)}</div>
      <p>{registered == null ? 'Registration total unavailable.' : `${recipients} of ${registered} registered participant records have an active certificate.`} Multiple templates can produce several certificates per person. Email queued records a sending request, not confirmed inbox delivery.</p>
      {!compact && <><div className="er-certificate-filters"><label>Search certificates<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Name, email, template or certificate number"/></label><label>Certificate status<select aria-label="Certificate status" value={status} onChange={event => setStatus(event.target.value)}><option value="all">All statuses</option><option value="issued">Issued</option><option value="revoked">Revoked</option></select></label><span>{visible.length} of {rows.length} certificates</span></div>
      <div className="er-certificate-table"><table><thead><tr><th>Participant</th><th>Certificate</th><th>Status</th><th>Issued</th><th>Email queued</th><th>Viewed</th><th>Document</th></tr></thead><tbody>{visible.map(row => <tr key={row.id}><td><strong>{row.guest_name}</strong><small>{row.email || 'No email address'}</small></td><td>{row.template_name}<small>{row.certificate_number}</small></td><td>{row.status === 'issued' ? 'Issued' : row.status === 'revoked' ? 'Revoked' : row.status}</td><td>{date(row.issued_at)}</td><td>{date(row.sent_at)}</td><td>{date(row.viewed_at)}</td><td><a href={row.document_url} target="_blank" rel="noreferrer">PDF</a> · <a href={row.verification_url} target="_blank" rel="noreferrer">Verify</a></td></tr>)}</tbody></table>{!visible.length && <p>{rows.length ? 'No certificates match these filters.' : 'No certificates have been issued for this event.'}</p>}</div><p>Times use {timezone}. Registration coverage is event-wide; day and zone filters do not change it.</p></>}
    </>}
  </section>
}
