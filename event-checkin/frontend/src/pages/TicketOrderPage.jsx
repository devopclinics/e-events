import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import './TicketOrderPage.css'
import './TicketOrderEnhancements.css'

const money = (amount, currency) => new Intl.NumberFormat(undefined, {style:'currency',currency}).format(Number(amount||0)/100)

export default function TicketOrderPage() {
  const { orderId } = useParams()
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const [order, setOrder] = useState(null)
  const [error, setError] = useState('')
  const [reason, setReason] = useState('')
  const [sending, setSending] = useState(false)
  const [transfer, setTransfer] = useState(null)
  const [transferResult, setTransferResult] = useState(null)
  const [transferBusy, setTransferBusy] = useState(false)

  useEffect(() => {
    if (!token) { setError('This ticket link is incomplete. Use the link from your confirmation email.'); return }
    let stopped = false
    let timer
    const load = () => fetch(`/api/ticketing/public/orders/${encodeURIComponent(orderId)}?token=${encodeURIComponent(token)}`, {cache:'no-store'})
      .then(async r => { if (!r.ok) throw new Error(r.status===404?'Ticket order not found.':'Could not load this order.'); return r.json() })
      .then(data => {
        if (stopped) return
        setOrder(data); setError('')
        if (['pending','payment_processing','paid'].includes(data.status)) timer = window.setTimeout(load, 2000)
      }).catch(e => { if (!stopped) setError(e.message) })
    load()
    return () => { stopped=true; window.clearTimeout(timer) }
  }, [orderId, token])

  const cancelled = order?.status === 'refunded'
  // A fulfilled order can legitimately have zero passes (a pure donation/
  // sponsorship order has no admission line items) — status alone decides
  // readiness; hasPasses only controls ticket-specific copy/sections below.
  const ready = order?.status === 'fulfilled'
  const hasPasses = ready && order.passes?.length > 0
  async function requestCancellation(e) {
    e.preventDefault(); setSending(true); setError('')
    try {
      const res = await fetch(`/api/ticketing/public/orders/${encodeURIComponent(orderId)}/cancellations?token=${encodeURIComponent(token)}`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason})})
      const data = await res.json().catch(()=>({}))
      if (!res.ok) throw new Error(data.detail || 'Could not submit the request.')
      setOrder({...order,cancellation:data}); setReason('')
    } catch(e2) { setError(e2.message) } finally { setSending(false) }
  }
  async function transferTicket(e) {
    e.preventDefault()
    const recipient_name=transfer.recipient_name.trim(), recipient_email=transfer.recipient_email.trim()
    if(!recipient_name || !recipient_email)return
    setTransferBusy(true); setError('')
    try {
      const res=await fetch(`/api/ticketing/public/orders/${encodeURIComponent(orderId)}/transfers?token=${encodeURIComponent(token)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({guest_id:transfer.pass.guest_id,recipient_name,recipient_email})})
      const data=await res.json().catch(()=>({})); if(!res.ok)throw new Error(data.detail||'Transfer could not be created.')
      setTransferResult({...data,recipient_name,recipient_email}); setTransfer(null)
    } catch(e2){setError(e2.message)} finally { setTransferBusy(false) }
  }
  async function privacyRequest(kind) {
    if(kind==='delete'&&!window.confirm('Request deletion of attendee personal information? Financial records must be retained, and approved deletion will permanently disable these passes.'))return
    try{
      const res=await fetch(`/api/ticketing/public/orders/${encodeURIComponent(orderId)}/privacy-requests?token=${encodeURIComponent(token)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind})})
      const data=await res.json();if(!res.ok)throw new Error(data.detail||'Privacy request failed.')
      if(kind==='export'){
        const blob=new Blob([JSON.stringify(data.data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`festio-order-${orderId}.json`;a.click();URL.revokeObjectURL(url)
      }else window.alert('Your deletion request was submitted for protected review.')
    }catch(e){setError(e.message)}
  }
  return <main className="to-page">
    <header className="to-header"><a href="/">F <b>Festio</b></a><span>Secure ticket wallet</span></header>
    <section className="to-shell">
      {error ? <div className="to-message error" role="alert"><h1>We couldn’t open these tickets</h1><p>{error}</p></div> : !order ? <div className="to-message" role="status" aria-live="polite"><div className="to-spinner" aria-hidden="true"/><h1>Loading your order…</h1></div> : <>
        <div className={`to-status ${cancelled?'cancelled':ready?'ready':'waiting'}`}><span>{cancelled?'×':ready?'✓':'…'}</span><div><small>Order {order.id.slice(0,8).toUpperCase()}</small><h1>{cancelled?'This order was refunded':!ready?'Payment received — preparing your passes':hasPasses?'Your tickets are ready':'Thank you for your contribution'}</h1><p>{cancelled?'The QR passes below are cancelled and cannot be used.':!ready?'This page updates automatically after payment confirmation.':hasPasses?`${order.passes.length} unique pass${order.passes.length===1?'':'es'} · ${money(order.total,order.currency)} · Sent to ${order.buyer_email}`:`${money(order.total,order.currency)} · Receipt sent to ${order.buyer_email}`}</p></div></div>
        {hasPasses && !cancelled && <div className="to-tools"><button onClick={()=>window.print()}>Print or save all as PDF</button><span>Delivery: {order.delivery_status}</span></div>}
        {ready&&<section className="to-receipt"><div className="to-receipt-head"><div><small>OFFICIAL PAYMENT RECEIPT</small><h2>Festio ticket purchase</h2></div><div><span>Receipt date</span><strong>{new Date(order.paid_at||order.fulfilled_at).toLocaleDateString()}</strong></div></div><div className="to-receipt-meta"><p><span>Order reference</span><b>{order.id.toUpperCase()}</b></p><p><span>Billed to</span><b>{order.buyer_email}</b></p><p><span>Payment status</span><b className="to-paid">Paid</b></p></div><div className="to-receipt-lines"><span>Tickets</span><b>{money(order.subtotal,order.currency)}</b>{order.discount>0&&<><span>Discount</span><b>−{money(order.discount,order.currency)}</b></>}<span>Event tax</span><b>{money(order.tax_amount,order.currency)}</b><span>Festio service fee</span><b>{money(order.platform_fee,order.currency)}</b><strong>Total paid</strong><strong>{money(order.total,order.currency)}</strong></div><div className="to-receipt-actions"><button onClick={()=>window.print()}>Print / save receipt as PDF</button><small>Keep this receipt for your records.</small></div></section>}
        {order.passes?.length>0 && <div className={`to-passes ${cancelled?'disabled':''}`}>{order.passes.map((pass,index)=><article key={pass.ticket_id} className="to-pass"><div className="to-pass-top"><span>Festio Pass</span><b>#{index+1}</b></div><h2>{pass.name}</h2><img src={pass.qr_url} alt={`Unique QR ticket for ${pass.name}`}/><code>Ticket {pass.ticket_id}</code><p>{cancelled?'CANCELLED — DO NOT ADMIT':'Present this unique QR code at check-in.'}</p><div><a href={pass.pass_url}>Open mobile pass</a><a href={pass.card_url} download={`Festio-${pass.name}.jpg`}>Download ticket</a>{!cancelled&&pass.guest_id&&<button onClick={()=>{setTransferResult(null);setTransfer({pass,recipient_name:'',recipient_email:''})}}>Transfer</button>}</div></article>)}</div>}
        {ready && !cancelled && <section className="to-cancel"><h2>Need to cancel?</h2>{order.cancellation ? <p>Your cancellation request is <strong>{order.cancellation.status}</strong>. {order.cancellation.status==='pending'?'The organizer will review it; your tickets remain valid until a refund is approved.':''}</p> : <form onSubmit={requestCancellation}><p>Send a request to the organizer. Your QR codes remain valid until it is approved and refunded.</p><textarea required minLength="5" maxLength="1000" placeholder="Tell the organizer why you need to cancel" value={reason} onChange={e=>setReason(e.target.value)}/><button disabled={sending}>{sending?'Sending…':'Request cancellation'}</button></form>}</section>}
        {!ready && !cancelled && <div className="to-message"><div className="to-spinner"/><p>Do not close this page. Your passes will appear here shortly.</p></div>}
        {ready&&<section className="to-cancel"><h2>Your data</h2><p>Download the personal and order data held for this purchase, or request reviewed anonymization. Financial records are retained where required.</p><div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button onClick={()=>privacyRequest('export')}>Download my data</button><button onClick={()=>privacyRequest('delete')}>Request data deletion</button></div></section>}
        <footer>Each QR belongs to one attendee and can be admitted independently. Keep this private link secure.</footer>
      </>}
    </section>
    {transfer&&<div className="to-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setTransfer(null)}}><section className="to-modal" role="dialog" aria-modal="true" aria-labelledby="transfer-title"><button className="to-modal-close" onClick={()=>setTransfer(null)} aria-label="Close">×</button><small>SECURE TICKET TRANSFER</small><h2 id="transfer-title">Send this ticket to someone else</h2><p>You are transferring <strong>{transfer.pass.name}</strong>. The recipient must accept before their new QR is created.</p><form onSubmit={transferTicket}><label><span>Recipient’s full name</span><input autoFocus required maxLength="160" value={transfer.recipient_name} onChange={e=>setTransfer({...transfer,recipient_name:e.target.value})} placeholder="e.g. Amina Bello"/></label><label><span>Recipient’s email</span><input required type="email" value={transfer.recipient_email} onChange={e=>setTransfer({...transfer,recipient_email:e.target.value})} placeholder="amina@example.com"/></label><div className="to-modal-warning"><b>What happens next?</b><span>The recipient receives a secure acceptance link. After acceptance, this QR is permanently replaced with a new one.</span></div><div className="to-modal-actions"><button type="button" className="secondary" onClick={()=>setTransfer(null)}>Keep my ticket</button><button disabled={transferBusy}>{transferBusy?'Creating transfer…':'Create secure transfer'}</button></div></form></section></div>}
    {transferResult&&<div className="to-modal-backdrop"><section className="to-modal to-success" role="dialog" aria-modal="true"><span className="to-success-mark">✓</span><small>TRANSFER CREATED</small><h2>Send the acceptance link</h2><p><strong>{transferResult.recipient_name}</strong> must accept this transfer. Until then, your existing ticket remains in your wallet.</p><div className="to-copy-link"><input readOnly value={transferResult.acceptance_url}/><button onClick={()=>navigator.clipboard.writeText(transferResult.acceptance_url)}>Copy link</button></div><p className="to-fine">Only share this private link with {transferResult.recipient_email}.</p><button className="to-done" onClick={()=>setTransferResult(null)}>Done</button></section></div>}
  </main>
}
