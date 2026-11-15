import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api'
import './MediaLibrary.css'
import './InvoiceLibrary.css'

export default function InvoiceLibrary({ embedded = false }) {
  const [rows, setRows] = useState(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [status, setStatus] = useState('')
  async function load() {
    setError('')
    try { setRows(await api.listInvoiceFiles()) }
    catch (e) { setError(e.message) }
  }
  useEffect(() => { load() }, [])
  async function download(row) {
    setBusy(row.id); setError(''); setStatus('')
    try {
      const blob = await api.downloadInvoiceFile(row.id)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = row.filename
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 30000)
      setStatus(`${row.client} · ${row.title}: PDF downloaded.`)
    } catch (e) { setError(e.message) }
    finally { setBusy('') }
  }
  const filtered = (rows || []).filter(row => `${row.client} ${row.title} ${row.guests} ${row.status}`.toLowerCase().includes(query.toLowerCase()))
  const date = value => value ? new Intl.DateTimeFormat('en-GB', {dateStyle:'medium', timeZone:'UTC'}).format(new Date(value + 'T12:00:00Z')) : 'Tentative — to be confirmed'
  return <section className="invoice-library" aria-label="Invoice library">
    <div className="invoice-library-head">
      <div><p className="ml-eyebrow">FESTIO / CLIENT DOCUMENTS</p><h2>Invoices</h2><p>Saved client invoices, ready to find and download.</p></div>
      <Link className="ml-button" to={embedded ? '/invoices' : '/media-redesign'}>{embedded ? 'Open invoices page ↗' : 'Back to Media'}</Link>
    </div>
    <label className="ml-search"><span className="sr-only">Search invoices</span><input type="search" placeholder="Search client, event or guest count…" value={query} onChange={e => setQuery(e.target.value)} /></label>
    {status && <p role="status" className="ml-notice">{status}</p>}
    {error && <p role="alert" className="ml-notice">{error} <button className="ml-button" onClick={load}>Retry</button></p>}
    {!rows && !error && <p role="status">Loading invoices…</p>}
    {rows && filtered.length === 0 && <p>No invoices match your search.</p>}
    <div className="invoice-library-grid">{filtered.map(row => <article className="invoice-library-card" key={row.id}>
      <div className="invoice-library-card-top"><span className="ml-eyebrow">{row.client}</span><span className="invoice-library-status">{row.status}</span></div>
      <h3>{row.title}</h3><p>{row.guests} guests · PDF</p>
      <dl><div><dt>Event date</dt><dd>{date(row.event_date)}</dd></div><div><dt>Prepared</dt><dd>{date(row.prepared)}</dd></div></dl>
      <strong className="invoice-library-total">{new Intl.NumberFormat('en-NG', {style:'currency', currency:row.currency, maximumFractionDigits:0}).format(row.total)}</strong>
      <button className="ml-button primary" disabled={!!busy} onClick={() => download(row)}>{busy === row.id ? 'Preparing PDF…' : 'Download invoice PDF'}</button>
    </article>)}</div>
  </section>
}
