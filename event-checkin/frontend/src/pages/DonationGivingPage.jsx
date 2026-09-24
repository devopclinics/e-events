import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import './DonationGivingPage.css'

const LABELS = { festio_pay: 'Debit / Credit Card', cash_app: 'Cash App', zelle: 'Zelle', paypal: 'PayPal', bank_transfer: 'Bank Transfer', offline: 'Cash / Cheque', pledge: 'Pledge' }
const ICONS = { festio_pay: '▣', cash_app: '$', zelle: 'Z', paypal: 'P', bank_transfer: '▥', offline: '▤', pledge: '♡' }
const money = (minor, currency='USD') => new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format((minor || 0) / 100)

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
      document.execCommand('copy'); el.remove()
      return true
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
  if (!open) return null
  const matches = BANKS.filter((b) => b.name.toLowerCase().includes(query.trim().toLowerCase()))
  return <div className="dg-modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
    <div className="dg-modal-card">
      <span className="dg-eyebrow">Select your bank</span>
      <h2>Where do you bank?</h2>
      <p>{purpose === 'zelle' ? "We'll open your bank's official site — sign in there to access Zelle and send to the recipient email below." : "We'll open your bank's official site — sign in there to set up a transfer to the account details below."}</p>
      <input className="dg-bank-search" placeholder="Search your bank…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus/>
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
    </div>
  </div>
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
      <div className="dg-channels">{directChannels.map((item) => <button type="button" disabled={busy} className="dg-channel-convert" onClick={() => onConvertPledge(item.type)} key={item.type}><i>{ICONS[item.type] || '•'}</i><b>{item.label || LABELS[item.type]}</b></button>)}</div>
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
    const direct = data.channels?.find((item) => !['pledge','offline'].includes(item.type))
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

  const directChannels = useMemo(() => campaign?.channels?.filter((item) => !['pledge','offline'].includes(item.type)) || [], [campaign])
  const selected = useMemo(() => directChannels.find((item) => item.type === channel), [directChannels, channel])
  const pledgeOption = useMemo(() => campaign?.channels?.find((item) => item.type === 'pledge'), [campaign])
  const offlineOption = useMemo(() => campaign?.channels?.find((item) => item.type === 'offline'), [campaign])
  const pledgeChannels = campaign?.pledge_payment_channels || []
  const progress = campaign?.goal_minor ? Math.min(100, Math.round(campaign.confirmed_minor / campaign.goal_minor * 100)) : 0
  const amountMinor = Math.round(Number(amount || 0) * 100)
  const donationIntro = !campaign?.description || /pledge/i.test(campaign.description)
    ? `Support ${campaign?.event_name || 'this event'}. Every contribution helps make the event possible.`
    : campaign.description

  async function submit(event, useChannel) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const body = { ...form, contact_consent: Boolean((form.donor_email.trim() || form.donor_phone.trim()) && form.contact_consent), channel: useChannel, amount_minor: amountMinor, donor_email: form.donor_email.trim() || null, expected_payment_date: form.expected_payment_date ? new Date(`${form.expected_payment_date}T12:00:00`).toISOString() : null }
      if (useChannel !== 'pledge') { body.expected_payment_channel = null; body.expected_payment_date = null }
      const next = await api.createDonationContribution(token, body)
      setResult(next)
      setSearchParams({ ref: next.access_token }, { replace: true })
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
    return <main className="dg-shell dg-success-shell"><section className="dg-success-card"><span className="dg-success-mark">✓</span><p>{campaign.event_name}</p><h1>{pledged ? 'Thank you for your pledge' : 'Thank you for your support'}</h1><strong>{money(result.amount_minor, result.currency)}</strong><div className="dg-success-details"><article><small>Payment method</small><b>{LABELS[pledged ? result.expected_payment_channel : result.channel] || result.expected_payment_channel || result.channel}</b></article><article><small>Status</small><b>{pledged ? 'Pledge recorded' : result.payment_reported_at ? 'Payment reported' : pending ? 'Awaiting confirmation' : 'Confirmed'}</b></article>{pledged && result.expected_payment_date && <article><small>Expected date</small><b>{new Date(result.expected_payment_date).toLocaleDateString()}</b></article>}<article><small>Reference</small><b>{result.reference}</b></article></div>{result.instructions && <aside className="dg-payment-instructions"><b>Payment instructions</b><p>{result.instructions}</p></aside>}<PaymentPanel result={result} onReport={reportPayment} onConvertPledge={convertPledge} directChannels={directChannels} busy={busy}/><p>{pledged ? 'No payment was collected. Your pledge remains separate from received funds until the organizer confirms payment.' : pending && !result.payment_reported_at ? 'Complete payment using the selected method. Festio records your contribution; the organizer confirms it after payment is received.' : !pledged && !result.payment_reported_at ? 'Your contribution has been confirmed.' : null}</p><p className="dg-return-note">Bookmark this page to return to your contribution any time.</p><button onClick={() => { setResult(null); setPledgeOpen(false); setSearchParams({}, { replace: true }) }}>Return to campaign</button></section></main>
  }

  const pledgeValid = form.donor_name.trim() && form.expected_payment_channel && form.expected_payment_date && amountMinor > 0

  return <main className="dg-shell" style={{ '--dg-primary':'#006b4f', '--dg-accent':'#e0a928' }}>
    <header className={`dg-campaign-hero ${campaign.cover_image_url ? 'has-image' : ''}`}>
      {campaign.cover_image_url && <img className="dg-cover" src={campaign.cover_image_url} alt=""/>}<div className="dg-cover-shade"/>
      <div className="dg-hero-content"><div className="dg-org-line">{campaign.logo_url ? <img src={campaign.logo_url} alt=""/> : <span>{campaign.event_name.slice(0,1)}</span>}<div><b>{campaign.event_name}</b><small>FESTIO GIVING HUB</small></div></div><h1>{campaign.title}</h1><p>{donationIntro}</p><div className="dg-values"><span>◉ Community</span><span>▣ Knowledge</span><span>◇ Unity</span><span>↗ Stronger future</span></div></div>
    </header>

    <div className="dg-page-grid"><div className="dg-main">
      {directChannels.length > 0 && <form className="dg-donation-card" onSubmit={(e) => submit(e, channel)}>
        <StepHeading number="1" title="Choose an amount" copy="Select a giving amount or enter your own."/>
        <AmountPicker amount={amount} setAmount={setAmount} currency={campaign.currency}/>
        <StepHeading number="2" title="Choose a payment method" copy="Select a payment method. Instructions appear before you submit."/>
        <div className="dg-channels">{directChannels.map((item) => <button aria-pressed={channel === item.type} type="button" className={channel === item.type ? 'selected' : ''} onClick={() => setChannel(item.type)} key={item.type}><i>{ICONS[item.type] || '•'}</i><b>{item.label || LABELS[item.type]}</b></button>)}</div>
        {selected?.public_instructions && channel !== 'festio_pay' && <aside className="dg-payment-instructions"><b>Payment instructions</b><span>{selected.label || LABELS[selected.type]}</span><p>{selected.public_instructions}</p><small>After payment, submit this form so the organizer can confirm your contribution.</small></aside>}
        <StepHeading number="3" title="Your details" copy="Provide your information so the organizer can acknowledge your support."/>
        <DonorFields form={form} setForm={setForm}/><PrivacyOptions form={form} setForm={setForm}/>
        {error && !pledgeOpen && <p className="dg-form-error" role="alert">{error}</p>}
        <button className="dg-primary-cta" disabled={busy || !channel || amountMinor <= 0 || !form.donor_name.trim()}>{busy ? 'Saving…' : channel === 'festio_pay' ? `Continue with ${money(amountMinor, campaign.currency)} →` : `Donate ${money(amountMinor, campaign.currency)} now →`}</button>
        <p className="dg-next-copy">{channel === 'festio_pay' ? 'You will be redirected to the configured payment provider to complete payment.' : 'Festio records and tracks your contribution. Payment is completed using the selected method and confirmed by the organizer.'}</p>
      </form>}

      {pledgeOption && <section className={`dg-pledge-section ${pledgeOpen ? 'open' : ''}`}><div className="dg-pledge-intro"><span>▣</span><div><h2>Not ready to give today?</h2><p>Make a pledge and fulfil it later. Pledges remain separate until payment is confirmed.</p></div><button type="button" aria-expanded={pledgeOpen} onClick={() => { setPledgeOpen(!pledgeOpen); setError('') }}>{pledgeOpen ? 'Close' : 'Make a pledge →'}</button></div>{pledgeOpen && <form className="dg-pledge-form" onSubmit={(e) => submit(e, 'pledge')}><div className="dg-pledge-banner"><b>This is a pledge</b><span>No payment is collected now.</span></div><AmountPicker amount={amount} setAmount={setAmount} currency={campaign.currency}/><div className="dg-pledge-fields"><label><span>Expected payment method</span><select value={form.expected_payment_channel} onChange={(e) => setForm({...form, expected_payment_channel:e.target.value})}>{pledgeChannels.map((item)=><option value={item.type} key={item.type}>{item.label}</option>)}</select></label><label><span>Expected payment date</span><input required type="date" value={form.expected_payment_date} onChange={(e) => setForm({...form, expected_payment_date:e.target.value})}/></label></div><DonorFields form={form} setForm={setForm}/><PrivacyOptions form={form} setForm={setForm}/>{error && <p className="dg-form-error" role="alert">{error}</p>}<button className="dg-pledge-submit" disabled={busy || !pledgeValid}>{busy ? 'Saving…' : `Record ${money(amountMinor, campaign.currency)} pledge`}</button></form>}</section>}
    </div>

    <aside className="dg-sidebar"><section className="dg-support-card"><span className="dg-support-icon">♡</span><div><h2>Your support matters</h2><p>Every contribution helps support {campaign.event_name} and the community behind it.</p></div></section><section className="dg-status-card"><article><i>▣</i><div><small>Received</small><strong>{money(campaign.confirmed_minor, campaign.currency)}</strong><em>Funds received and verified</em></div></article><article><i>▤</i><div><small>Pledged</small><strong>{money(campaign.pledged_minor, campaign.currency)}</strong><em>{campaign.pledge_count || 0} active pledge{campaign.pledge_count === 1 ? '' : 's'}</em></div></article>{campaign.goal_minor > 0 && <div className="dg-progress"><span><b>{money(campaign.confirmed_minor, campaign.currency)}</b> of {money(campaign.goal_minor, campaign.currency)}</span><i><b style={{width:`${progress}%`}}/></i></div>}</section><section className="dg-info-card"><h2><i>▤</i> Ways to support</h2><ul><li>Give today</li>{pledgeOption && <li>Make a pledge and fulfil it later</li>}<li>Choose from the available payment methods</li></ul></section>{campaign.recent_public?.length > 0 && <section className="dg-info-card dg-recent"><h2><i>♟</i> Recent support</h2>{campaign.recent_public.slice(0,5).map((item)=><article key={item.id}><span>{item.name.split(/\s+/).map((part)=>part[0]).join('').slice(0,2).toUpperCase()}</span><div><b>{item.name}</b><small>{item.kind === 'pledge' ? 'Pledged' : 'Gave'}{item.amount_minor != null ? ` ${money(item.amount_minor, campaign.currency)}` : ''}</small></div><time>{relativeTime(item.created_at)}</time></article>)}</section>}<section className="dg-info-card dg-trust"><span>◆</span><div><h2>Transparent tracking</h2><p>Only organizer-confirmed payments increase the received total. Pledges and pending payments remain separate.</p></div></section></aside>
    </div>
    <footer className="dg-footer">Powered by Festio · Giving records are protected and visible only according to campaign privacy settings.</footer>
  </main>
}
