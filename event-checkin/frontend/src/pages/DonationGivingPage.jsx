import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api'
import './DonationGivingPage.css'

const LABELS = { festio_pay: 'Festio Pay', cash_app: 'Cash App', zelle: 'Zelle', bank_transfer: 'Bank transfer', offline: 'Cash / cheque', pledge: 'Pledge now' }
const ICONS = { festio_pay: '✦', cash_app: '$', zelle: 'Z', bank_transfer: '▦', offline: '▤', pledge: '♡' }
const money = (minor, currency='USD') => new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format((minor || 0) / 100)

export default function DonationGivingPage() {
  const { token } = useParams()
  const [campaign, setCampaign] = useState(null)
  const [channel, setChannel] = useState('')
  const [amount, setAmount] = useState('50')
  const [form, setForm] = useState({ donor_name: '', donor_email: '', message: '', anonymous_publicly: false, hide_amount_publicly: false, expected_payment_channel: 'bank_transfer', expected_payment_date: '' })
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.publicDonationCampaign(token).then((data) => { setCampaign(data); setChannel(data.channels?.[0]?.type || '') }).catch((e) => setError(e.message)) }, [token])
  const selected = useMemo(() => campaign?.channels?.find((item) => item.type === channel), [campaign, channel])
  const progress = campaign?.goal_minor ? Math.min(100, Math.round(campaign.confirmed_minor / campaign.goal_minor * 100)) : 0
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const body = { ...form, channel, amount_minor: Math.round(Number(amount) * 100), expected_payment_date: form.expected_payment_date ? new Date(`${form.expected_payment_date}T12:00:00`).toISOString() : null }
      if (channel !== 'pledge') { body.expected_payment_channel = null; body.expected_payment_date = null }
      const next = await api.createDonationContribution(token, body); setResult(next)
      setCampaign(await api.publicDonationCampaign(token))
      if (next.checkout_url) window.location.assign(next.checkout_url)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  if (error && !campaign) return <main className="dg-shell"><section className="dg-error"><b>Giving page unavailable</b><p>{error}</p></section></main>
  if (!campaign) return <main className="dg-shell"><div className="dg-loading">Opening the Giving Hub…</div></main>
  if (result) return <main className="dg-shell"><section className="dg-card dg-confirm"><span>✓</span><p>{campaign.event_name}</p><h1>{result.status === 'pledged' ? 'Your pledge is recorded' : result.status === 'pending_verification' ? 'Awaiting verification' : 'Thank you for giving'}</h1><strong>{money(result.amount_minor, result.currency)}</strong><div><small>Reference</small><b>{result.reference}</b></div>{result.instructions && <p className="dg-instructions">{result.instructions}</p>}{result.status === 'pledged' && <p>Your pledge is kept separate from confirmed funds until payment is received.</p>}<button onClick={() => setResult(null)}>Make another contribution</button></section></main>
  return <main className="dg-shell">
    <header className="dg-hero"><span>FESTIO GIVING HUB</span><p>{campaign.event_name}</p><h1>{campaign.title}</h1>{campaign.description && <div>{campaign.description}</div>}<section><strong>{money(campaign.confirmed_minor, campaign.currency)} raised</strong><small>of {money(campaign.goal_minor, campaign.currency)}</small><i><b style={{ width: `${progress}%` }}/></i><em>{progress}% confirmed</em>{campaign.show_pledged_total && campaign.pledged_minor > 0 && <mark>Plus {money(campaign.pledged_minor, campaign.currency)} pledged</mark>}</section></header>
    <form className="dg-card" onSubmit={submit}>
      <div className="dg-step"><span>01</span><div><h2>Choose how to give</h2><p>Select any option enabled by the event organizer.</p></div></div>
      <div className="dg-channels">{campaign.channels.map((item) => <button type="button" className={channel === item.type ? 'active' : ''} onClick={() => setChannel(item.type)} key={item.type}><i>{ICONS[item.type]}</i><b>{item.label || LABELS[item.type]}</b></button>)}</div>
      <div className="dg-step"><span>02</span><div><h2>{channel === 'pledge' ? 'Record your pledge' : 'Choose an amount'}</h2><p>{channel === 'pledge' ? 'A pledge is not counted as received until payment is confirmed.' : 'Your contribution updates the tracker after confirmation.'}</p></div></div>
      <div className="dg-amounts">{[25,50,100,250].map((value) => <button type="button" className={amount === String(value) ? 'active' : ''} onClick={() => setAmount(String(value))} key={value}>{money(value * 100, campaign.currency)}</button>)}<label><span>Other</span><input required min="1" step="0.01" type="number" value={amount} onChange={(e) => setAmount(e.target.value)}/></label></div>
      {channel === 'pledge' && <div className="dg-pledge-fields"><label><span>Expected payment channel</span><select value={form.expected_payment_channel} onChange={(e) => setForm({...form, expected_payment_channel:e.target.value})}>{campaign.channels.filter((item)=>!['pledge','offline'].includes(item.type)).map((item)=><option value={item.type} key={item.type}>{item.label}</option>)}</select></label><label><span>Expected payment date</span><input required type="date" value={form.expected_payment_date} onChange={(e) => setForm({...form, expected_payment_date:e.target.value})}/></label></div>}
      {selected?.public_instructions && channel !== 'festio_pay' && <aside className="dg-instructions"><b>{selected.label} instructions</b><p>{selected.public_instructions}</p></aside>}
      <div className="dg-contact"><label><span>Name</span><input value={form.donor_name} onChange={(e) => setForm({...form, donor_name:e.target.value})} placeholder="Your name"/></label><label><span>Email for confirmation</span><input type="email" value={form.donor_email} onChange={(e) => setForm({...form, donor_email:e.target.value})} placeholder="you@example.com"/></label><label className="wide"><span>Message (optional)</span><textarea maxLength="1000" value={form.message} onChange={(e) => setForm({...form, message:e.target.value})} placeholder="Share an encouraging message"/></label></div>
      <div className="dg-privacy"><label><input type="checkbox" checked={form.anonymous_publicly} onChange={(e) => setForm({...form, anonymous_publicly:e.target.checked})}/><span><b>Donate anonymously</b><small>Your identity remains visible only to authorized finance staff.</small></span></label><label><input type="checkbox" checked={form.hide_amount_publicly} onChange={(e) => setForm({...form, hide_amount_publicly:e.target.checked})}/><span><b>Hide my amount publicly</b><small>Your contribution still counts toward authorized totals.</small></span></label></div>
      {error && <p className="dg-form-error">{error}</p>}<button className="dg-submit" disabled={busy || !channel || Number(amount) <= 0}>{busy ? 'Saving…' : channel === 'pledge' ? 'Record my pledge →' : channel === 'festio_pay' ? 'Continue securely →' : 'Submit for verification →'}</button><footer>Secure event giving · Powered by Festio</footer>
    </form>
  </main>
}
