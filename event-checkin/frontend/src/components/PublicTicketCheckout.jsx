import { useEffect, useMemo, useState } from 'react'

const ticketingAvailable = typeof window !== 'undefined' && ['festio.events', 'staging.festio.events', 'localhost'].includes(window.location.hostname)
const isStagingHost = typeof window !== 'undefined' && ['staging.festio.events', 'localhost'].includes(window.location.hostname)
const cash = (n, c) => new Intl.NumberFormat(undefined, { style: 'currency', currency: c }).format(Number(n || 0) / 100)

export default function PublicTicketCheckout({ eventId, tone, onAvailabilityChange, requirePhone = false }) {
  const [catalog, setCatalog] = useState(null)
  const [buyer, setBuyer] = useState({ firstName: '', lastName: '', email: '', phone: '' })
  const [lines, setLines] = useState({})
  const [names, setNames] = useState({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [waitlisted, setWaitlisted] = useState({})
  const [offer, setOffer] = useState(null)
  const [promoCode, setPromoCode] = useState('')
  const [customAnswers, setCustomAnswers] = useState({})
  const [donationAmounts, setDonationAmounts] = useState({})
  useEffect(() => {
    if (!ticketingAvailable || !eventId) { onAvailabilityChange?.(false); return }
    fetch(`/api/ticketing/public/events/${encodeURIComponent(eventId)}/tickets`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null).then(async data => { setCatalog(data); onAvailabilityChange?.(!!data?.enabled && !!data?.tickets?.length); const token=new URLSearchParams(window.location.search).get('offer'); if(token){const response=await fetch(`/api/ticketing/public/waitlist/offers/${encodeURIComponent(token)}`);if(response.ok){const value=await response.json();if(value.event_id===eventId){const parts=value.name.trim().split(/\s+/);setOffer({...value,token});setBuyer({firstName:parts.shift()||'',lastName:parts.join(' '),email:value.email,phone:''});setLines({[value.product_id]:value.quantity});setNames({[value.product_id]:Array.from({length:value.quantity},()=>({first_name:'',last_name:'',email:''}))})}}} })
      .catch(() => { setCatalog(null); onAvailabilityChange?.(false) })
    return () => onAvailabilityChange?.(false)
  }, [eventId, onAvailabilityChange])
  const selected = useMemo(() => (catalog?.tickets || []).filter(t => Number(lines[t.id] || 0) > 0), [catalog, lines])
  if (!catalog?.enabled || !catalog.tickets?.length) return null
  // Some or all tickets may be external-registration-only listings (price
  // display, no Festio checkout -- see ProductIn's product_type docstring).
  // When NONE of this event's tickets are actually sellable through Festio,
  // the buyer-info form + "secure checkout" button below have nothing to do
  // (checkout would always fail with "choose at least one ticket") and the
  // copy promising a live Stripe/Paystack charge would be actively wrong.
  const hasSellableTickets = catalog.tickets.some(t => t.product_type !== 'external')

  function changeQuantity(ticketId, raw) {
    const quantity = Math.max(0, Number(raw) || 0)
    setLines({...lines, [ticketId]: quantity})
    const current = Array.isArray(names[ticketId]) ? names[ticketId] : []
    setNames({...names, [ticketId]: Array.from({length: quantity}, (_, i) => current[i] || {first_name:'',last_name:'',email:''})})
  }

  function changeAttendee(ticketId, index, field, value) {
    const current = [...(names[ticketId] || [])]
    current[index] = {...current[index], [field]: value}
    setNames({...names, [ticketId]: current})
  }

  function changeDonationAmount(ticket, raw) {
    setDonationAmounts({...donationAmounts, [ticket.id]: raw})
    const cents = Math.round(Number(raw) * 100)
    setLines({...lines, [ticket.id]: cents >= ticket.price ? 1 : 0})
  }

  async function joinWaitlist(ticket) {
    setError('')
    if (!buyer.firstName.trim() || !buyer.lastName.trim() || !buyer.email.trim()) { setError('Enter your first name, last name and email above to join the waitlist.'); return }
    try {
      const res=await fetch(`/api/ticketing/public/events/${encodeURIComponent(eventId)}/waitlist`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({product_id:ticket.id,name:`${buyer.firstName} ${buyer.lastName}`.trim(),email:buyer.email,quantity:1})})
      const data=await res.json().catch(()=>({})); if(!res.ok) throw new Error(data.detail||'Could not join the waitlist.')
      setWaitlisted({...waitlisted,[ticket.id]:true})
    } catch(e) { setError(e.message) }
  }

  async function checkout(e) {
    e.preventDefault(); setError(''); setBusy(true)
    try {
      const orderLines = selected.map(ticket => {
        const quantity = Number(lines[ticket.id])
        const isCustomDonation = ticket.product_type === 'donation' && ticket.allow_custom_amount
        // Donations skip the per-attendee sub-form entirely (no pass is
        // issued, so there's no individual identity to collect) — every
        // attendee slot is just filled from the buyer's own details.
        const ticketAttendees = ticket.product_type === 'donation' ? [] : (names[ticket.id] || [])
        return {
          product_id: ticket.id, quantity,
          attendees: Array.from({length:quantity},(_,index) => ticketAttendees[index] || {first_name:'',last_name:'',email:''}).map((attendee) => ({
            first_name: attendee.first_name.trim() || buyer.firstName, last_name: attendee.last_name.trim() || buyer.lastName,
            email: attendee.email.trim() || buyer.email, phone: buyer.phone || null,
          })),
          ...(isCustomDonation ? { custom_amount: Math.round(Number(donationAmounts[ticket.id]) * 100) } : {}),
        }
      })
      if (!orderLines.length) throw new Error('Choose at least one ticket.')
      const res = await fetch(`/api/ticketing/public/events/${encodeURIComponent(eventId)}/orders`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buyer_name: `${buyer.firstName} ${buyer.lastName}`.trim(), buyer_email: buyer.email, buyer_phone: buyer.phone || null, lines: orderLines, promo_code: promoCode.trim() || null, custom_answers:customAnswers, waitlist_token: offer?.token || null }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || 'Checkout could not be started.')
      window.location.assign(data.checkout_url)
    } catch (e2) { setError(e2.message); setBusy(false) }
  }

  return <section className="scroll-mt-6 py-9" id="tickets" aria-labelledby="ticket-checkout-title">
    <div className="rounded-3xl border p-6 shadow-xl sm:p-8" style={{ background: tone.panelStrong, borderColor: tone.border, color: tone.text }}>
      <div className="mb-5">
        {hasSellableTickets && <span className="text-xs font-extrabold uppercase tracking-[.18em]" style={{ color: tone.accent }}>{isStagingHost ? 'Staging test mode' : 'Secure checkout'}</span>}
        <h2 id="ticket-checkout-title" className="mt-1 text-3xl font-extrabold">{hasSellableTickets ? 'Buy tickets' : 'Registration'}</h2>
        <p id="checkout-help" style={{ color: tone.muted }}>{hasSellableTickets ? `Secure checkout through ${catalog.currency === 'NGN' ? 'Paystack' : 'Stripe'}.${isStagingHost ? ' No live charge will be made.' : ''}` : 'Registration is handled on the organizer’s own site — pricing shown here for reference.'}</p>
      </div>
      <form onSubmit={checkout} className="space-y-5">
        {hasSellableTickets && <div className="grid gap-3 sm:grid-cols-2"><input required className="rounded-xl border bg-transparent px-4 py-3" style={{ borderColor: tone.border }} placeholder="First name" value={buyer.firstName} onChange={e => setBuyer({...buyer,firstName:e.target.value})}/><input required className="rounded-xl border bg-transparent px-4 py-3" style={{ borderColor: tone.border }} placeholder="Last name" value={buyer.lastName} onChange={e => setBuyer({...buyer,lastName:e.target.value})}/><input required type="email" className="rounded-xl border bg-transparent px-4 py-3" style={{ borderColor: tone.border }} placeholder="Email" value={buyer.email} onChange={e => setBuyer({...buyer,email:e.target.value})}/><input required={requirePhone} className="rounded-xl border bg-transparent px-4 py-3" style={{ borderColor: tone.border }} placeholder={requirePhone ? 'Phone' : 'Phone (optional)'} value={buyer.phone} onChange={e => setBuyer({...buyer,phone:e.target.value})}/></div>}
        {catalog.tickets.map(t => t.product_type==='external' ? <div key={t.id} className="grid gap-3 rounded-2xl border p-4 sm:grid-cols-[1fr_140px]" style={{ borderColor: tone.border }}>
          <div><strong className="text-lg">{t.name}</strong><p style={{ color: tone.muted }}>{t.description}</p><b style={{ color: tone.accent }}>{cash(t.price,t.currency)}</b></div>
          <a href={t.external_url} target="_blank" rel="noreferrer" className="flex min-h-11 items-center justify-center rounded-xl px-3 py-2 text-center font-bold" style={{background:tone.accent,color:'#07111f'}}>Register externally ↗</a>
        </div> : t.product_type==='donation' ? <div key={t.id} className="grid gap-3 rounded-2xl border p-4 sm:grid-cols-[1fr_140px]" style={{ borderColor: tone.border }}>
          <div><strong className="text-lg">{t.name} 🎁</strong><p style={{ color: tone.muted }}>{t.description}</p><b style={{ color: tone.accent }}>{t.allow_custom_amount?`${cash(t.price,t.currency)} minimum`:cash(t.price,t.currency)}</b>{!t.allow_custom_amount && ` · ${t.available} available`}</div>
          {t.allow_custom_amount
            ? <input aria-label={`${t.name} amount`} type="number" min={t.price/100} step="0.01" placeholder={(t.price/100).toFixed(2)} value={donationAmounts[t.id]||''} onChange={e=>changeDonationAmount(t,e.target.value)} className="rounded-xl border bg-transparent px-3 py-2" style={{ borderColor:tone.border }}/>
            : (t.available>0?<input aria-label={`${t.name} quantity`} type="number" min="0" max={Math.min(t.available,t.max_per_order)} value={lines[t.id] || 0} onChange={e => changeQuantity(t.id,e.target.value)} className="rounded-xl border bg-transparent px-3 py-2" style={{ borderColor:tone.border }}/>:<span className="rounded-xl px-3 py-2 font-bold text-center" style={{color:tone.muted}}>Sold out</span>)}
        </div> : <div key={t.id} className="grid gap-3 rounded-2xl border p-4 sm:grid-cols-[1fr_100px]" style={{ borderColor: tone.border }}><div><strong className="text-lg">{t.name}</strong><p style={{ color: tone.muted }}>{t.description}</p><b style={{ color: tone.accent }}>{cash(t.price,t.currency)}</b> · {t.available} available</div>{t.available>0?<input aria-label={`${t.name} quantity`} type="number" min="0" max={Math.min(t.available,t.max_per_order)} value={lines[t.id] || 0} onChange={e => changeQuantity(t.id,e.target.value)} className="rounded-xl border bg-transparent px-3 py-2" style={{ borderColor:tone.border }}/>:<button type="button" onClick={()=>joinWaitlist(t)} disabled={waitlisted[t.id]} className="rounded-xl px-3 py-2 font-bold" style={{background:tone.accent,color:'#07111f'}}>{waitlisted[t.id]?'Joined':'Waitlist'}</button>}{Number(lines[t.id]||0)>0 && <div className="space-y-2 sm:col-span-2"><p className="text-xs font-bold uppercase tracking-wider" style={{color:tone.muted}}>Attendee details are optional · every ticket still gets a unique QR</p>{(names[t.id]||[]).map((attendee,index)=><div key={index} className="grid gap-2 sm:grid-cols-3"><input className="rounded-xl border bg-transparent px-4 py-3" style={{borderColor:tone.border}} placeholder={`Ticket ${index+1} first name`} value={attendee.first_name} onChange={e=>changeAttendee(t.id,index,'first_name',e.target.value)}/><input className="rounded-xl border bg-transparent px-4 py-3" style={{borderColor:tone.border}} placeholder="Last name" value={attendee.last_name} onChange={e=>changeAttendee(t.id,index,'last_name',e.target.value)}/><input type="email" className="rounded-xl border bg-transparent px-4 py-3" style={{borderColor:tone.border}} placeholder="Individual email (optional)" value={attendee.email} onChange={e=>changeAttendee(t.id,index,'email',e.target.value)}/></div>)}</div>}</div>)}
        {hasSellableTickets && (catalog.checkout_fields||[]).map(field=><label key={field.id} className="block"><span className="mb-1 block text-sm font-bold">{field.label}{field.required?' *':''}</span>{field.type==='textarea'?<textarea required={field.required} className="w-full rounded-xl border bg-transparent px-4 py-3" style={{borderColor:tone.border}} value={customAnswers[field.id]||''} onChange={e=>setCustomAnswers({...customAnswers,[field.id]:e.target.value})}/>:field.type==='select'?<select required={field.required} className="w-full rounded-xl border bg-transparent px-4 py-3" style={{borderColor:tone.border}} value={customAnswers[field.id]||''} onChange={e=>setCustomAnswers({...customAnswers,[field.id]:e.target.value})}><option value="">Choose…</option>{field.options.map(x=><option key={x}>{x}</option>)}</select>:field.type==='checkbox'?<input type="checkbox" required={field.required} checked={!!customAnswers[field.id]} onChange={e=>setCustomAnswers({...customAnswers,[field.id]:e.target.checked})}/>:field.type==='date'?<input type="date" required={field.required} className="w-full rounded-xl border bg-transparent px-4 py-3" style={{borderColor:tone.border,colorScheme:'light'}} value={customAnswers[field.id]||''} onChange={e=>setCustomAnswers({...customAnswers,[field.id]:e.target.value})}/>:<input required={field.required} className="w-full rounded-xl border bg-transparent px-4 py-3" style={{borderColor:tone.border}} value={customAnswers[field.id]||''} onChange={e=>setCustomAnswers({...customAnswers,[field.id]:e.target.value})}/>}</label>)}
        {hasSellableTickets && catalog.tax?.enabled&&<p className="rounded-xl border p-3 text-sm" style={{borderColor:tone.border,color:tone.muted}}>{(catalog.tax.bps/100).toFixed(2)}% event tax {catalog.tax.paid_by==='buyer'?'will be added to the customer total at checkout.':'is included in the listed price and paid by the organizer.'}</p>}
        {hasSellableTickets && <label className="block max-w-md"><span className="mb-1 block text-sm font-bold">Promo code <small style={{color:tone.muted}}>(optional)</small></span><input className="w-full rounded-xl border bg-transparent px-4 py-3 uppercase" style={{borderColor:tone.border}} maxLength="40" autoComplete="off" placeholder="Enter discount code" value={promoCode} onChange={e=>setPromoCode(e.target.value)}/></label>}
        {error && <p id="checkout-error" role="alert" className="rounded-xl bg-red-500/15 p-3 font-semibold text-red-300">{error}</p>}
        {hasSellableTickets && <button disabled={busy} aria-busy={busy} className="min-h-12 rounded-2xl px-7 py-3 font-extrabold focus:outline-none focus:ring-4" style={{ background:tone.accent,color:'#07111f' }}>{busy ? 'Opening secure checkout…' : 'Continue to secure checkout'}</button>}
      </form>
    </div>
  </section>
}
