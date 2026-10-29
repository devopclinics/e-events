import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import './DonationGivingPage.css'

const LABELS = { festio_pay: 'Debit / Credit Card', cash_app: 'Cash App', zelle: 'Zelle', paypal: 'PayPal', bank_transfer: 'Bank Transfer', offline: 'Cash / Cheque', pledge: 'Pledge' }
const CHANNEL_COPY = { festio_pay:'Continue to checkout', cash_app:'Pay with Cash App', zelle:'Send through your bank', paypal:'Pay with PayPal', bank_transfer:'Use bank account details', offline:'Arrange with the organizer' }
const ICONS = { festio_pay: '▣', cash_app: '$', zelle: 'Z', paypal: 'P', bank_transfer: '▥', offline: '▤', pledge: '♡' }
const money = (minor, currency='USD') => new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: minor % 100 ? 2 : 0, minimumFractionDigits: minor % 100 ? 2 : 0 }).format((minor || 0) / 100)

// Official bank websites only -- never a constructed or guessed deep link.
// Each bank opens its own real site; Zelle/ACH access happens after the
// donor signs in there, same as it would if they typed the URL themselves.
const BANKS = [
  { name: 'Chase', url: 'https://www.chase.com/' },
  { name: 'Bank of America', url: 'https://www.bankofamerica.com/' },
  { name: 'Wells Fargo', url: 'https://www.wellsfargo.com/' },
  { name: 'Capital One', url: 'https://www.capitalone.com/' },
  { name: 'Citibank', url: 'https://www.citi.com/' },
  { name: 'U.S. Bank', url: 'https://www.usbank.com/' },
  { name: 'PNC Bank', url: 'https://www.pnc.com/' },
  { name: 'Truist', url: 'https://www.truist.com/' },
]

async function copyToClipboard(value) {
  if (!value) return false
  try { await navigator.clipboard.writeText(value); return true }
  catch {
    try {
      const el = document.createElement('textarea')
      el.value = value; el.style.position = 'fixed'; el.style.opacity = '0'
      document.body.appendChild(el); el.select()
      const copied = document.execCommand('copy'); el.remove()
      return copied
    } catch { return false }
  }
}

function CopyButton({ value, label }) {
  const [copied, setCopied] = useState(false)
  if (!value) return null
  return <button type="button" className="dg-copy" onClick={async () => { if (await copyToClipboard(value)) { setCopied(true); setTimeout(() => setCopied(false), 1800) } }}>
    {copied ? 'Copied ✓' : `Copy ${label}`}
  </button>
}

function BankSelector({ open, onClose, onPick, purpose }) {
  const [query, setQuery] = useState('')
  const [otherBank, setOtherBank] = useState('')
  const dialog = useRef(null)
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close() }, [open])
  if (!open) return null
  const matches = BANKS.filter((b) => b.name.toLowerCase().includes(query.trim().toLowerCase()))
  return <dialog ref={dialog} className="dg-modal-card" aria-label="Select your bank" onCancel={onClose}>
      <span className="dg-eyebrow">Select your bank</span>
      <h2>Where do you bank?</h2>
      <p>{purpose === 'zelle' ? "We'll open your bank's official site — sign in there to access Zelle and send to the recipient email below." : "We'll open your bank's official site — sign in there to set up a transfer to the account details below."}</p>
      <input className="dg-bank-search" aria-label="Search your bank" placeholder="Search your bank…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus/>
      <div className="dg-bank-list">
        {matches.map((b) => <button type="button" key={b.name} onClick={() => { onPick(b); onClose() }}>{b.name}</button>)}
        {!matches.length && <p className="dg-bank-empty">No match — use "Other bank" below.</p>}
      </div>
      <div className="dg-bank-other">
        <label><span>Other bank</span><input placeholder="Type your bank's name" value={otherBank} onChange={(e) => setOtherBank(e.target.value)}/></label>
        <p className="dg-bank-note">We only open banks' official, verified websites — never an address you or we type in directly. Search for "{otherBank || 'your bank'}" and sign in at their real site to continue.</p>
        <a className="dg-bank-search-link" href={`https://www.google.com/search?q=${encodeURIComponent((otherBank || 'my bank') + ' official online banking login')}`} target="_blank" rel="noreferrer" onClick={onClose}>Search for "{otherBank || 'my bank'}" →</a>
      </div>
      <button type="button" className="dg-modal-close" onClick={onClose}>Cancel</button>
  </dialog>
}

// Pre-submission preview of the selected channel's real recipient details --
// mirrors the reviewed mockup: bold recipient value, no "submit this form"
// copy (the donor hasn't submitted anything yet at this step).
function ChannelPreview({ item }) {
  if (!item) return null
  const type = item.type
  let value = null, secondary = null, note = null
  if (type === 'cash_app') {
    value = (item.checkout_url || '').replace(/^https?:\/\/(www\.)?cash\.app\//i, '') || item.checkout_url || null
    note = value && 'Opens the Cash App link once you submit below — verify the recipient before sending.'
  } else if (type === 'zelle') {
    value = item.recipient_email || null
    note = value && "You'll choose your bank and send through Zelle after submitting below."
  } else if (type === 'paypal') {
    value = item.recipient_email || null
    secondary = item.recipient_phone || null
    note = value && "You'll send via PayPal to this recipient after submitting below."
  } else if (type === 'bank_transfer') {
    value = item.bank_name || null
    secondary = item.account_number || null
    const missing = [!item.routing_number && 'routing number', !item.account_type && 'account type', !item.account_holder_name && 'account holder name'].filter(Boolean)
    note = missing.length ? `${missing.join(', ')} pending verification.` : null
  } else {
    value = item.public_instructions || null
  }
  if (!value) return null
  return <aside className="dg-payment-instructions">
    <b>Payment instructions</b>
    <span>{item.label || LABELS[type]}</span>
    <p className="dg-preview-value">{value}</p>
    {secondary && <p className={`dg-preview-secondary${type === 'bank_transfer' ? ' mono' : ''}`}>{secondary}</p>}
    {note && <small>{note}</small>}
  </aside>
}
const relativeTime = (value) => {
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`
  return `${Math.floor(seconds / 86400)} day${seconds < 172800 ? '' : 's'} ago`
}

function StepHeading({ number, title, copy }) {
  return <div className="dg-step"><span>{number}</span><div><h2>{title}</h2>{copy && <p>{copy}</p>}</div></div>
}

function AmountPicker({ amount, setAmount, currency }) {
  const [custom, setCustom] = useState(!['25','50','100','250'].includes(amount))
  const choose = (value) => { setCustom(false); setAmount(String(value)) }
  return <div className="dg-amount-grid">
    {[25,50,100,250].map((value) => <button aria-pressed={!custom && amount === String(value)} type="button" className={!custom && amount === String(value) ? 'selected' : ''} onClick={() => choose(value)} key={value}>{money(value * 100, currency)}</button>)}
    <button aria-pressed={custom} type="button" className={custom ? 'selected' : ''} onClick={() => setCustom(true)}>Other</button>
    {custom && <label className="dg-custom-amount"><span>{currency}</span><input autoFocus aria-label="Custom contribution amount" required min="1" step="0.01" type="number" value={amount} onChange={(e) => setAmount(e.target.value)}/></label>}
  </div>
}

function PrivacyOptions({ form, setForm }) {
  const hasContact = Boolean(form.donor_email.trim() || form.donor_phone.trim())
  const consentTitle = form.donor_phone.trim() ? 'Send me a thank-you or pledge reminder' : 'Send me a thank-you by email'
  const consentCopy = form.donor_phone.trim() ? 'Optional. Festio may email or text the contact details you provided.' : 'Optional. Add a phone number if you also want text reminders.'
  return <div className="dg-privacy">
    <label><input type="checkbox" checked={form.anonymous_publicly} onChange={(e) => setForm({...form, anonymous_publicly:e.target.checked})}/><span><b>Give anonymously</b><small>Your name will not appear publicly.</small></span></label>
    <label><input type="checkbox" checked={form.hide_amount_publicly} onChange={(e) => setForm({...form, hide_amount_publicly:e.target.checked})}/><span><b>Hide my amount publicly</b><small>Your contribution counts toward totals, but the amount will not be displayed publicly.</small></span></label>
    {hasContact && <label className="dg-contact-consent"><input type="checkbox" checked={form.contact_consent} onChange={(e) => setForm({...form, contact_consent:e.target.checked})}/><span><b>{consentTitle}</b><small>{consentCopy}</small></span></label>}
  </div>
}

function DonorFields({ form, setForm }) {
  return <div className="dg-details">
    <label><span>Full name <em>*</em></span><input required autoComplete="name" value={form.donor_name} onChange={(e) => setForm({...form, donor_name:e.target.value})} placeholder="Your name"/></label>
    <label><span>Email address</span><input type="email" autoComplete="email" value={form.donor_email} onChange={(e) => setForm({...form, donor_email:e.target.value})} placeholder="you@example.com"/></label>
    <label><span>Phone (optional)</span><input type="tel" autoComplete="tel" value={form.donor_phone} onChange={(e) => setForm({...form, donor_phone:e.target.value})} placeholder="+1 555 123 4567"/></label>
    <label className="wide"><span>Message (optional)</span><textarea maxLength="1000" value={form.message} onChange={(e) => setForm({...form, message:e.target.value})} placeholder="Share an encouraging message"/></label>
  </div>
}

// Renders the real payment mechanics for a contribution: channel-specific
// recipient details / copy buttons / bank picker, plus the donor-side
// "I've completed my payment" self-report. Reporting is never proof of
// receipt -- only staff verification in Finance can confirm and count it.
function PaymentPanel({ result, onReport, onConvertPledge, directChannels, busy }) {
  const [bankOpen, setBankOpen] = useState(false)
  const [bankPurpose, setBankPurpose] = useState('zelle')
  const [pickedBank, setPickedBank] = useState(null)
  const [reportOpen, setReportOpen] = useState(false)
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')

  const isPledge = result.status === 'pledged'
  const reported = Boolean(result.payment_reported_at)
  const amountText = ((result.amount_minor || 0) / 100).toFixed(2)

  function openBank(purpose) { setBankPurpose(purpose); setPickedBank(null); setBankOpen(true) }
  function pickBank(bank) { setPickedBank(bank); window.open(bank.url, '_blank', 'noopener') }

  async function submitReport(event) {
    event.preventDefault()
    await onReport({ provider_reference: reference.trim() || undefined, evidence_note: note.trim() || undefined })
    setReportOpen(false); setReference(''); setNote('')
  }

  if (result.status === 'confirmed') {
    return <div className="dg-payment-panel dg-payment-confirmed"><b>Payment confirmed</b><p>The organizer's finance team has verified and confirmed this contribution.</p></div>
  }
  if (result.status === 'cancelled' || result.status === 'failed') {
    return <div className="dg-payment-panel dg-payment-cancelled"><b>{result.status === 'cancelled' ? 'Contribution cancelled' : 'Payment not completed'}</b><p>Contact the organizer if you believe this is a mistake.</p></div>
  }

  if (isPledge) {
    return <div className="dg-payment-panel">
      <p className="dg-pledge-ready-copy">Ready to pay your pledge now? Choose a method below -- this updates your existing pledge rather than creating a new contribution.</p>
      <div className="dg-channels">{directChannels.map((item) => <button type="button" disabled={busy} className="dg-channel-convert" onClick={() => onConvertPledge(item.type)} key={item.type}><i aria-hidden="true">{ICONS[item.type] || '•'}</i><span><b>{item.label || LABELS[item.type]}</b><small>{CHANNEL_COPY[item.type]}</small></span></button>)}</div>
    </div>
  }

  if (reported) {
    return <div className="dg-payment-panel dg-payment-reported">
      <b>Payment Reported — Awaiting Verification</b>
      <p>Thanks — this has not yet been counted as received. The organizer's finance team will verify your payment and confirm it.</p>
    </div>
  }

  const showReport = ['cash_app','paypal','zelle','bank_transfer'].includes(result.channel)

  return <div className="dg-payment-panel">
    {result.channel === 'cash_app' && result.checkout_url && <>
      <a className="dg-primary-cta dg-external-link" href={result.checkout_url} target="_blank" rel="noreferrer">Continue to Cash App →</a>
      <p className="dg-payment-note">Opens Cash App if it's installed, otherwise cash.app in your browser. Verify the recipient before sending.</p>
    </>}

    {result.channel === 'paypal' && <>
      <div className="dg-copy-row">
        <CopyButton value={result.recipient_email} label="PayPal Email"/>
        <CopyButton value={result.recipient_phone} label="PayPal Phone"/>
        <CopyButton value={amountText} label="Donation Amount"/>
      </div>
      <a className="dg-primary-cta dg-external-link" href="https://www.paypal.com/" target="_blank" rel="noreferrer">Open PayPal →</a>
      <p className="dg-payment-note">In PayPal, choose Send, enter {result.recipient_email || 'the recipient email above'}, verify the recipient, then send {money(result.amount_minor, result.currency)}.</p>
    </>}

    {result.channel === 'zelle' && <>
      <div className="dg-copy-row">
        <CopyButton value={result.recipient_email} label="Zelle Email"/>
        <CopyButton value={amountText} label="Donation Amount"/>
      </div>
      <button type="button" className="dg-primary-cta" onClick={() => openBank('zelle')}>Select Your Bank →</button>
      {pickedBank && bankPurpose === 'zelle' && <p className="dg-payment-note">Opened {pickedBank.name} — sign in, open Zelle, enter {result.recipient_email}, verify the recipient, and send {money(result.amount_minor, result.currency)}.</p>}
    </>}

    {result.channel === 'bank_transfer' && <>
      <div className="dg-bank-details">
        <div><small>Receiving bank</small><b>{result.bank_name || 'Pending verification'}</b></div>
        <div><small>Account number</small><b>{result.account_number || 'Pending verification'}</b></div>
        <div><small>Routing number</small><b>{result.routing_number || 'Pending verification'}</b></div>
        <div><small>Account type</small><b>{result.account_type || 'Pending verification'}</b></div>
        <div><small>Account holder</small><b>{result.account_holder_name || 'Pending verification'}</b></div>
      </div>
      <div className="dg-copy-row">
        <CopyButton value={result.account_number} label="Account Number"/>
        <CopyButton value={amountText} label="Donation Amount"/>
      </div>
      <button type="button" className="dg-primary-cta" onClick={() => openBank('bank_transfer')}>Select Your Bank →</button>
      {pickedBank && bankPurpose === 'bank_transfer' && <p className="dg-payment-note">Opened {pickedBank.name} — sign in and set up a transfer using the account details above.</p>}
    </>}

    {showReport && !reportOpen && <button type="button" className="dg-report-toggle" onClick={() => setReportOpen(true)}>I've Completed My Payment</button>}
    {reportOpen && <form className="dg-report-form" onSubmit={submitReport}>
      <label><span>Transaction reference (optional)</span><input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. confirmation code"/></label>
      <label><span>Note (optional)</span><textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything the finance team should know"/></label>
      <div className="dg-report-actions"><button type="button" onClick={() => setReportOpen(false)}>Cancel</button><button className="dg-primary-cta" disabled={busy}>{busy ? 'Saving…' : 'Confirm I Paid'}</button></div>
    </form>}

    <BankSelector open={bankOpen} onClose={() => setBankOpen(false)} onPick={pickBank} purpose={bankPurpose}/>
  </div>
}

function GivingArtwork() {
  return <svg className="dg-artwork" viewBox="0 0 520 400" fill="none" aria-hidden="true"><defs><linearGradient id="dg-arch" x1="110" y1="30" x2="410" y2="390" gradientUnits="userSpaceOnUse"><stop stopColor="#d7e3d2"/><stop offset="1" stopColor="#92b19e"/></linearGradient><linearGradient id="dg-gold" x1="210" y1="180" x2="360" y2="340" gradientUnits="userSpaceOnUse"><stop stopColor="#f5e2a7"/><stop offset="1" stopColor="#bf9650"/></linearGradient></defs><circle cx="270" cy="196" r="176" stroke="#b7c8b2" strokeDasharray="3 8"/><path d="M145 348V167a125 125 0 0 1 250 0v181" fill="url(#dg-arch)"/><path d="M174 348V173a96 96 0 0 1 192 0v175" stroke="#f7f7e8" strokeOpacity=".65"/><path d="M198 348V180a72 72 0 0 1 144 0v168" stroke="#f7f7e8" strokeOpacity=".5"/><ellipse cx="273" cy="348" rx="161" ry="17" fill="#244e3c" fillOpacity=".08"/><path d="M139 278l129-34 133 34-133 58z" fill="#244c3c"/><path d="M139 270l129-34 133 34-133 58z" fill="#f3ebd5"/><path d="M151 251q61-24 117 4v59q-60-29-117-3z" fill="#fffaf0"/><path d="M268 255q58-28 119-4v60q-59-26-119 3z" fill="url(#dg-gold)"/><path d="M268 255v59M169 268q39-12 78 4M169 282q39-12 78 4M289 273q38-15 78-5M289 287q38-15 78-5" stroke="#ac976c" strokeOpacity=".55"/><path d="M270 103l6 15 15 6-15 6-6 15-6-15-15-6 15-6z" stroke="#fff9e8" strokeWidth="2"/><circle cx="404" cy="109" r="32" fill="#efe2ba"/><path d="M393 109l8 8 15-16" stroke="#6c7546" strokeWidth="2"/><path d="M100 192v25m-12-12h25M415 216v19m-9-9h19" stroke="#8da68e"/><circle cx="120" cy="132" r="4" fill="#bc985b"/><circle cx="404" cy="300" r="4" fill="#bc985b"/></svg>
}

export default function DonationGivingPage() {
  const { token } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const [campaign, setCampaign] = useState(null)
  const [channel, setChannel] = useState('')
  const [amount, setAmount] = useState('50')
  const [pledgeOpen, setPledgeOpen] = useState(false)
  const [form, setForm] = useState({ donor_name: '', donor_email: '', donor_phone: '', contact_consent: false, message: '', anonymous_publicly: false, hide_amount_publicly: false, expected_payment_channel: 'bank_transfer', expected_payment_date: '' })
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { api.publicDonationCampaign(token).then((data) => {
    setCampaign(data)
    const direct = data.channels?.find((item) => item.type !== 'pledge')
    setChannel(direct?.type || '')
    if (data.pledge_payment_channels?.[0]?.type) {
      setForm((current) => ({ ...current, expected_payment_channel: data.pledge_payment_channels[0].type }))
    }
  }).catch((e) => setError(e.message)) }, [token])

  // Donor-return flow: a bookmarkable/shareable ?ref= link reopens the same
  // contribution (via its access_token) without re-entering any details.
  useEffect(() => {
    const ref = searchParams.get('ref')
    if (!ref || !campaign) return
    api.donationContributionStatus(token, ref).then((data) => setResult(data)).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign, token])

  const fundId = searchParams.get('fund') || ''
  const selectedFund = useMemo(() => campaign?.funds?.find((item) => item.id === fundId) || null, [campaign, fundId])
  const directChannels = useMemo(() => campaign?.channels?.filter((item) => item.type !== 'pledge') || [], [campaign])
  const selected = useMemo(() => directChannels.find((item) => item.type === channel), [directChannels, channel])
  const pledgeOption = useMemo(() => campaign?.channels?.find((item) => item.type === 'pledge'), [campaign])
  const pledgeChannels = campaign?.pledge_payment_channels || []
  const progress = campaign?.goal_minor ? Math.min(100, Math.round(campaign.confirmed_minor / campaign.goal_minor * 100)) : 0
  const amountMinor = Math.round(Number(amount || 0) * 100)
  const donationIntro = !campaign?.description
    ? `Support ${campaign?.event_name || 'this event'}. Every contribution helps make the event possible.`
    : campaign.description

  async function submit(event, useChannel) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const body = { ...form, registry_item_id: selectedFund?.id || null, contact_consent: Boolean((form.donor_email.trim() || form.donor_phone.trim()) && form.contact_consent), channel: useChannel, amount_minor: amountMinor, donor_email: form.donor_email.trim() || null, expected_payment_date: form.expected_payment_date ? new Date(`${form.expected_payment_date}T12:00:00`).toISOString() : null }
      if (useChannel !== 'pledge') { body.expected_payment_channel = null; body.expected_payment_date = null }
      const next = await api.createDonationContribution(token, body)
      setResult(next)
      setSearchParams({ ref: next.access_token, ...(selectedFund ? { fund: selectedFund.id } : {}) }, { replace: true })
      setCampaign(await api.publicDonationCampaign(token))
      // Only Festio Pay is a real hosted checkout redirect. Cash App/PayPal/
      // Zelle/Bank Transfer show the payment panel so the donor sees their
      // contribution was saved before choosing to leave for an external site.
      if (useChannel === 'festio_pay' && next.checkout_url) window.location.assign(next.checkout_url)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  async function reportPayment(body) {
    setBusy(true); setError('')
    try {
      const next = await api.reportDonationPayment(token, result.access_token, body)
      setResult(next)
      setCampaign(await api.publicDonationCampaign(token))
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  function convertPledge(channelType) { return reportPayment({ channel: channelType }) }

  if (error && !campaign) return <main className="dg-shell"><section className="dg-error" role="alert"><b>Giving page unavailable</b><p>{error}</p></section></main>
  if (!campaign) return <main className="dg-shell"><div className="dg-loading">Opening the Giving Hub…</div></main>

  if (result) {
    const pledged = result.status === 'pledged'
    const pending = result.status === 'pending_verification'
    const statusLabel = pledged ? 'Pledge recorded' : result.status === 'cancelled' ? 'Cancelled' : result.status === 'failed' ? 'Payment not completed' : result.status === 'confirmed' ? 'Confirmed' : result.payment_reported_at ? 'Payment reported' : 'Awaiting confirmation'
    return <main className="dg-shell dg-success-shell"><section className="dg-success-card"><span className="dg-success-mark">{['failed','cancelled'].includes(result.status) ? '!' : '✓'}</span><p>{campaign.event_name}</p><h1>{result.status === 'failed' ? 'Payment not completed' : result.status === 'cancelled' ? 'Contribution cancelled' : pledged ? 'Thank you for your pledge' : 'Thank you for your support'}</h1><strong>{money(result.amount_minor, result.currency)}</strong><div className="dg-success-details"><article><small>Payment method</small><b>{LABELS[pledged ? result.expected_payment_channel : result.channel] || result.expected_payment_channel || result.channel}</b></article><article><small>Status</small><b>{statusLabel}</b></article>{pledged && result.expected_payment_date && <article><small>Expected date</small><b>{new Date(result.expected_payment_date).toLocaleDateString()}</b></article>}<article><small>Reference</small><b>{result.reference}</b></article></div>{result.instructions && <aside className="dg-payment-instructions"><b>Payment instructions</b><p>{result.instructions}</p></aside>}{error && <p className="dg-form-error" role="alert">{error}</p>}<PaymentPanel result={result} onReport={reportPayment} onConvertPledge={convertPledge} directChannels={directChannels} busy={busy}/><p>{pledged ? 'No payment was collected. Your pledge remains separate from received funds until the organizer confirms payment.' : pending && !result.payment_reported_at ? 'Complete payment using the selected method. Festio records your contribution; the organizer confirms it after payment is received.' : result.status === 'confirmed' ? 'Your contribution has been confirmed.' : null}</p><p className="dg-return-note">Bookmark this page to return to your contribution any time.</p><button disabled={busy} onClick={() => { setResult(null); setPledgeOpen(false); setSearchParams(selectedFund ? { fund: selectedFund.id } : {}, { replace: true }) }}>Return to campaign</button></section></main>
  }

  const pledgeValid = form.donor_name.trim() && form.expected_payment_channel && form.expected_payment_date && amountMinor > 0

  return <main className="dg-shell" style={{ '--dg-primary':'#006b4f', '--dg-accent':'#e0a928' }}>
    <header className={`dg-campaign-hero ${campaign.cover_image_url ? 'has-image' : ''}`}>
      <nav className="dg-topbar" aria-label="Campaign"><div className="dg-org-line">{campaign.logo_url ? <img src={campaign.logo_url} alt=""/> : <span>{campaign.event_name.slice(0,1)}</span>}<div><b>{campaign.event_name}</b><small>GIVING WITH PURPOSE</small></div></div><a href="#giving-options">Support this campaign <span aria-hidden="true">↗</span></a></nav>
      <div className="dg-hero-content"><div className="dg-hero-copy"><span className="dg-eyebrow">A LITTLE GENEROSITY. A LASTING DIFFERENCE.</span><h1>{selectedFund ? selectedFund.title : campaign.title}<span className="dg-title-dot" aria-hidden="true">.</span></h1><p>{selectedFund?.description || donationIntro}</p>{selectedFund && <div className="dg-fund-context">Gift List fund · {money(selectedFund.confirmed_minor, selectedFund.currency)} received{selectedFund.goal_minor > 0 ? ` of ${money(selectedFund.goal_minor, selectedFund.currency)}` : ''}</div>}<div className="dg-values"><span><i aria-hidden="true">↗</i> Give your way</span><span><i aria-hidden="true">◇</i> Choose your privacy</span>{pledgeOption && <span><i aria-hidden="true">♡</i> Pledge for later</span>}</div></div><div className="dg-hero-visual">{campaign.cover_image_url ? <img className="dg-cover" src={campaign.cover_image_url} alt=""/> : <GivingArtwork/>}<div className="dg-visual-caption"><span>SMALL ACTS. SHARED POSSIBILITIES.</span><b>Better, together.</b></div></div></div>
    </header>

    <div className="dg-page-grid" id="giving-options"><div className="dg-main">
      {directChannels.length > 0 && <form className="dg-donation-card" onSubmit={(e) => submit(e, channel)}><div className="dg-card-heading"><span className="dg-eyebrow">YOUR GENEROSITY STARTS HERE</span><h2>Make a difference.</h2><p>A gift today. A possibility tomorrow.</p></div>
        <StepHeading number="01" title="Choose an amount" copy="Select a giving amount or enter your own."/>
        <AmountPicker amount={amount} setAmount={setAmount} currency={campaign.currency}/>
        <StepHeading number="02" title="Choose a payment method" copy="Select a payment method. Instructions appear before you submit."/>
        <div className="dg-channels">{directChannels.map((item) => <button aria-pressed={channel === item.type} type="button" className={channel === item.type ? 'selected' : ''} onClick={() => setChannel(item.type)} key={item.type}><i aria-hidden="true">{ICONS[item.type] || '•'}</i><span><b>{item.label || LABELS[item.type]}</b><small>{CHANNEL_COPY[item.type]}</small></span><em aria-hidden="true">{channel === item.type ? '✓' : ''}</em></button>)}</div>
        {channel !== 'festio_pay' && <ChannelPreview item={selected}/>}
        <StepHeading number="03" title="Your details" copy="Provide your information so the organizer can acknowledge your support."/>
        <DonorFields form={form} setForm={setForm}/><PrivacyOptions form={form} setForm={setForm}/>
        {error && !pledgeOpen && <p className="dg-form-error" role="alert">{error}</p>}
        <button className="dg-primary-cta" disabled={busy || !channel || amountMinor <= 0 || !form.donor_name.trim()}>{busy ? 'Saving…' : channel === 'festio_pay' ? `Continue with ${money(amountMinor, campaign.currency)} →` : `Record ${money(amountMinor, campaign.currency)} gift →`}</button>
        <p className="dg-next-copy">{channel === 'festio_pay' ? 'You will be redirected to the configured payment provider to complete payment.' : 'Festio records and tracks your contribution. Payment is completed using the selected method and confirmed by the organizer.'}</p>
      </form>}

      {!directChannels.length && !pledgeOption && <section className="dg-donation-card"><span className="dg-eyebrow">CAMPAIGN UPDATE</span><h2>Giving will be available soon.</h2><p>The organizer has not made a giving method available yet. Please check back or contact the organizer.</p></section>}
      {pledgeOption && <section className={`dg-pledge-section ${pledgeOpen ? 'open' : ''}`}><div className="dg-pledge-intro"><span>▣</span><div><h2>Not ready to give today?</h2><p>Make a pledge and fulfil it later. Pledges remain separate until payment is confirmed.</p></div><button type="button" aria-expanded={pledgeOpen} onClick={() => { setPledgeOpen(!pledgeOpen); setError('') }}>{pledgeOpen ? 'Close' : 'Make a pledge →'}</button></div>{pledgeOpen && <form className="dg-pledge-form" onSubmit={(e) => submit(e, 'pledge')}><div className="dg-pledge-banner"><b>This is a pledge</b><span>No payment is collected now.</span></div><AmountPicker amount={amount} setAmount={setAmount} currency={campaign.currency}/><div className="dg-pledge-fields"><label><span>Expected payment method</span><select value={form.expected_payment_channel} onChange={(e) => setForm({...form, expected_payment_channel:e.target.value})}>{pledgeChannels.map((item)=><option value={item.type} key={item.type}>{item.label}</option>)}</select></label><label><span>Expected payment date</span><input required type="date" value={form.expected_payment_date} onChange={(e) => setForm({...form, expected_payment_date:e.target.value})}/></label></div><DonorFields form={form} setForm={setForm}/><PrivacyOptions form={form} setForm={setForm}/>{error && <p className="dg-form-error" role="alert">{error}</p>}<button className="dg-pledge-submit" disabled={busy || !pledgeValid}>{busy ? 'Saving…' : `Record ${money(amountMinor, campaign.currency)} pledge`}</button></form>}</section>}
    </div>

    <aside className="dg-sidebar"><section className="dg-support-card"><span className="dg-support-icon">♡</span><div><h2>Your support matters</h2><p>Every contribution helps support {campaign.event_name} and the community behind it.</p></div></section><section className="dg-status-card"><article><i aria-hidden="true">↗</i><div><small>Received</small><strong>{money(campaign.confirmed_minor, campaign.currency)}</strong><em>Funds received and verified</em></div></article><article><i>▤</i><div><small>Pledged</small><strong>{money(campaign.pledged_minor, campaign.currency)}</strong><em>{campaign.pledge_count || 0} active pledge{campaign.pledge_count === 1 ? '' : 's'}</em></div></article>{campaign.goal_minor > 0 && <div className="dg-progress"><div className="dg-progress-meter" role="progressbar" aria-label="Campaign received toward goal" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><i style={{width:`${progress}%`}}/></div><span><b>{money(campaign.confirmed_minor, campaign.currency)}</b> of {money(campaign.goal_minor, campaign.currency)}</span></div>}</section><section className="dg-info-card"><h2><i>▤</i> Ways to support</h2><ul>{directChannels.length > 0 && <li>Give today</li>}{pledgeOption && <li>Make a pledge and fulfil it later</li>}<li>Choose from the available payment methods</li></ul></section>{campaign.recent_public?.length > 0 && <section className="dg-info-card dg-recent"><h2><i>♟</i> Recent support</h2>{campaign.recent_public.slice(0,5).map((item)=><article key={item.id}><span>{item.name.split(/\s+/).map((part)=>part[0]).join('').slice(0,2).toUpperCase()}</span><div><b>{item.name}</b><small>{item.kind === 'pledge' ? 'Pledged' : 'Gave'}{item.amount_minor != null ? ` ${money(item.amount_minor, campaign.currency)}` : ''}</small></div><time>{relativeTime(item.created_at)}</time></article>)}</section>}<section className="dg-info-card dg-trust"><span>◆</span><div><h2>Transparent tracking</h2><p>Only organizer-confirmed payments increase the received total. Pledges and pending payments remain separate.</p></div></section></aside>
    </div>
    <footer className="dg-footer"><a href="https://festio.events" aria-label="Festio home"><b>F</b> Festio</a><span>Thoughtful giving. Transparent tracking.</span><small>Your public name and amount follow your privacy choices.</small></footer>
  </main>
}
