import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api'
import './VendorPortalPage.css'

function money(value, currency = 'USD') {
  try { return Number(value || 0).toLocaleString(undefined, { style: 'currency', currency }) }
  catch { return `${currency} ${Number(value || 0).toFixed(2)}` }
}

export default function VendorPortalPage() {
  const { token } = useParams()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [quote, setQuote] = useState({ title: '', amount: 0, currency: 'USD', comparison_group: '', line_items: [{ item: '', unit: '', quantity: 1, unit_price: '', notes: '' }], scope: '', valid_until: '', status: 'submitted' })
  const [change, setChange] = useState({ quote_id: '', title: '', amount_delta: '', description: '' })
  const [signerNames, setSignerNames] = useState({}) // { [contractId]: name }
  const [signing, setSigning] = useState('')

  async function load() {
    try { setData(await api.plannerVendorPortal(token)); setError('') }
    catch (e) { setError(e.message || 'This vendor link is unavailable.') }
  }
  useEffect(() => { load() }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  async function submitQuote(e) {
    e.preventDefault()
    try {
      await api.plannerVendorSubmitQuote(token, { ...quote, amount: 0, comparison_group: quote.comparison_group || data.vendor.category || 'General', line_items: quote.line_items.filter((line) => line.item.trim()).map((line) => ({ ...line, quantity: Number(line.quantity) || 1, unit_price: Number(line.unit_price) || 0 })), valid_until: quote.valid_until || null })
      setQuote({ title: '', amount: 0, currency: quote.currency, comparison_group: data.vendor.category || '', line_items: [{ item: '', unit: '', quantity: 1, unit_price: '', notes: '' }], scope: '', valid_until: '', status: 'submitted' })
      setNotice('Quote submitted to the event team.'); await load()
    } catch (err) { setNotice(err.message || 'Quote could not be submitted.') }
  }

  async function submitChange(e) {
    e.preventDefault()
    try {
      await api.plannerVendorRequestChange(token, { ...change, quote_id: change.quote_id || null, amount_delta: Number(change.amount_delta) || 0 })
      setChange({ quote_id: '', title: '', amount_delta: '', description: '' })
      setNotice('Change request submitted.'); await load()
    } catch (err) { setNotice(err.message || 'Change request could not be submitted.') }
  }

  async function signContract(contractId) {
    const name = (signerNames[contractId] || '').trim()
    if (!name) { setNotice('Type your full name to sign.'); return }
    setSigning(contractId)
    try {
      await api.plannerVendorSignContract(token, contractId, name)
      setNotice('Contract signed.'); await load()
    } catch (err) { setNotice(err.message || 'Contract could not be signed.') }
    finally { setSigning('') }
  }

  if (error) return <main className="vp-page"><section className="vp-card"><div className="vp-brand">FESTIO · VENDOR PORTAL</div><h1>Link unavailable</h1><p>{error}</p></section></main>
  if (!data) return <main className="vp-page"><section className="vp-card"><p>Loading secure workspace…</p></section></main>
  const approvedQuotes = data.quotes.filter((item) => item.status === 'approved')
  return (
    <main className="vp-page">
      <header className="vp-hero"><div className="vp-brand">FESTIO · VENDOR PORTAL</div><h1>{data.vendor.name}</h1><p>Submit commercial documents and track decisions from the event team.</p><small>Secure access expires {new Date(data.expires_at).toLocaleDateString()}.</small></header>
      {notice && <div className="vp-notice">{notice}</div>}
      <div className="vp-grid">
        <section className="vp-card"><h2>Contracts</h2>{data.contracts.map((c) => {
          const filename = (c.pdf_url || '').split('/').pop()
          const vendorPdfHref = filename ? `/api/planner/vendor-portal/${encodeURIComponent(token)}/contracts/${c.id}/pdf/${filename}` : null
          return (
            <article className="vp-row" key={c.id}>
              <div>
                <strong>{c.title}</strong>
                {vendorPdfHref && <small><a href={vendorPdfHref} target="_blank" rel="noreferrer">View PDF</a></small>}
              </div>
              {c.status === 'signed' ? (
                <div><span className="vp-status approved">signed {new Date(c.signed_at).toLocaleDateString()}</span></div>
              ) : (
                <div className="vp-sign">
                  <input placeholder="Type your full name to sign" value={signerNames[c.id] || ''} onChange={(e) => setSignerNames((s) => ({ ...s, [c.id]: e.target.value }))} />
                  <button className="vp-small" disabled={signing === c.id} onClick={() => signContract(c.id)}>{signing === c.id ? 'Signing…' : 'Sign & accept'}</button>
                </div>
              )}
            </article>
          )
        })}{!data.contracts.length && <p>No contracts yet.</p>}</section>
        <section className="vp-card"><h2>Your quotes</h2>{data.quotes.map((item) => <article className="vp-row" key={item.id}><div><strong>{item.title}</strong><small>{item.scope || 'No scope supplied'}</small></div><div><b>{money(item.amount, item.currency)}</b><span className={`vp-status ${item.status}`}>{item.status}</span></div></article>)}{!data.quotes.length && <p>No quotes submitted yet.</p>}</section>
        <section className="vp-card"><h2>Submit a quote</h2><form onSubmit={submitQuote}><label>Quote title<input required value={quote.title} onChange={(e) => setQuote({ ...quote, title: e.target.value })}/></label><div className="vp-fields"><label>Comparison group<input required placeholder="e.g. Catering" value={quote.comparison_group || data.vendor.category} onChange={(e) => setQuote({ ...quote, comparison_group: e.target.value })}/></label><label>Currency<input required maxLength="3" value={quote.currency} onChange={(e) => setQuote({ ...quote, currency: e.target.value.toUpperCase() })}/></label></div><strong>Items and unit prices</strong>{quote.line_items.map((line, index) => <div className="vp-line" key={index}><input required placeholder="Item" value={line.item} onChange={(e) => setQuote({ ...quote, line_items: quote.line_items.map((entry, i) => i === index ? { ...entry, item: e.target.value } : entry) })}/><input placeholder="Unit" value={line.unit} onChange={(e) => setQuote({ ...quote, line_items: quote.line_items.map((entry, i) => i === index ? { ...entry, unit: e.target.value } : entry) })}/><input required type="number" min="0" step="any" placeholder="Unit price" value={line.unit_price} onChange={(e) => setQuote({ ...quote, line_items: quote.line_items.map((entry, i) => i === index ? { ...entry, unit_price: e.target.value } : entry) })}/></div>)}<button type="button" className="vp-secondary" onClick={() => setQuote({ ...quote, line_items: [...quote.line_items, { item: '', unit: '', quantity: 1, unit_price: '', notes: '' }] })}>+ Add item</button><label>Scope and inclusions<textarea rows="4" value={quote.scope} onChange={(e) => setQuote({ ...quote, scope: e.target.value })}/></label><label>Valid until<input type="date" value={quote.valid_until} onChange={(e) => setQuote({ ...quote, valid_until: e.target.value })}/></label><button>Submit quote</button></form></section>
        <section className="vp-card"><h2>Change orders</h2>{data.change_orders.map((item) => <article className="vp-row" key={item.id}><div><strong>{item.title}</strong><small>{item.description || 'No description'}</small></div><div><b>{item.amount_delta >= 0 ? '+' : ''}{money(item.amount_delta)}</b><span className={`vp-status ${item.status}`}>{item.status}</span>{item.status === 'approved' && <button className="vp-small" onClick={async () => { await api.plannerVendorAcknowledgeChange(token, item.id); await load() }}>Acknowledge</button>}</div></article>)}{!data.change_orders.length && <p>No change orders.</p>}</section>
        <section className="vp-card"><h2>Request a change</h2><form onSubmit={submitChange}><label>Related contract<select value={change.quote_id} onChange={(e) => setChange({ ...change, quote_id: e.target.value })}><option value="">General request</option>{approvedQuotes.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><label>Change title<input required value={change.title} onChange={(e) => setChange({ ...change, title: e.target.value })}/></label><label>Price adjustment<input type="number" value={change.amount_delta} onChange={(e) => setChange({ ...change, amount_delta: e.target.value })}/></label><label>Reason and scope<textarea rows="4" value={change.description} onChange={(e) => setChange({ ...change, description: e.target.value })}/></label><button>Submit change request</button></form></section>
      </div>
    </main>
  )
}
