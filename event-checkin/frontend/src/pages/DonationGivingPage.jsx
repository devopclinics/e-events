import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api'
import './DonationGivingPage.css'

const LABELS = { festio_pay: 'Debit / Credit Card', cash_app: 'Cash App', zelle: 'Zelle', paypal: 'PayPal', bank_transfer: 'Bank Transfer', offline: 'Cash / Cheque', pledge: 'Pledge' }
const ICONS = { festio_pay: '▣', cash_app: '$', zelle: 'Z', paypal: 'P', bank_transfer: '▥', offline: '▤', pledge: '♡' }
const money = (minor, currency='USD') => new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format((minor || 0) / 100)
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

export default function DonationGivingPage() {
  const { token } = useParams()
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
      setResult({ ...next, expected_payment_channel: body.expected_payment_channel })
      setCampaign(await api.publicDonationCampaign(token))
      if (next.checkout_url) window.location.assign(next.checkout_url)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  if (error && !campaign) return <main className="dg-shell"><section className="dg-error" role="alert"><b>Giving page unavailable</b><p>{error}</p></section></main>
  if (!campaign) return <main className="dg-shell"><div className="dg-loading">Opening the Giving Hub…</div></main>

  if (result) {
    const pledged = result.status === 'pledged'
    const pending = result.status === 'pending_verification'
    return <main className="dg-shell dg-success-shell"><section className="dg-success-card"><span className="dg-success-mark">✓</span><p>{campaign.event_name}</p><h1>{pledged ? 'Thank you for your pledge' : 'Thank you for your support'}</h1><strong>{money(result.amount_minor, result.currency)}</strong><div className="dg-success-details"><article><small>Payment method</small><b>{LABELS[pledged ? result.expected_payment_channel : result.channel] || result.expected_payment_channel || result.channel}</b></article><article><small>Status</small><b>{pledged ? 'Pledge recorded' : pending ? 'Awaiting confirmation' : 'Confirmed'}</b></article>{pledged && result.expected_payment_date && <article><small>Expected date</small><b>{new Date(result.expected_payment_date).toLocaleDateString()}</b></article>}<article><small>Reference</small><b>{result.reference}</b></article></div>{result.instructions && <aside className="dg-payment-instructions"><b>Payment instructions</b><p>{result.instructions}</p></aside>}<p>{pledged ? 'No payment was collected. Your pledge remains separate from received funds until the organizer confirms payment.' : pending ? 'Complete payment using the selected method. Festio records your contribution; the organizer confirms it after payment is received.' : 'Your contribution has been confirmed.'}</p><button onClick={() => { setResult(null); setPledgeOpen(false) }}>Return to campaign</button></section></main>
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
