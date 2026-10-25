import { useEffect, useState } from 'react'
import { api } from '../api'
import { useCurrentEvent } from '../hooks/useCurrentEvent'
import RedesignShell from './redesign/RedesignShell'
import TicketingOperationsPanel from '../components/TicketingOperationsPanel'
import './TicketingRedesignPage.css'
import './TicketingAnalytics.css'

const emptyProduct = { name: '', description: '', price: '', currency: 'USD', capacity: '', min_per_order: 1, max_per_order: 10, access_ticket_type_id: null, active: true, product_type: 'ticket', allow_custom_amount: false, external_url: '' }
const money = (amount, currency) => new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(amount || 0) / 100)
const usableSettings = (cfg) => {
  const saved = cfg.config || { enabled: false, provider_account_id: '', fee_bps: 500, fees_paid_by: 'buyer' }
  // Never silently change an existing settlement currency or payment provider.
  if (cfg.config) return saved
  const currency = cfg.default_currency || 'USD'
  return { ...saved, currency, provider: currency === 'NGN' ? 'paystack' : 'stripe' }
}

function SalesPulse({ orders = [], currency = 'USD', summary = {} }) {
  const days = Array.from({length:7},(_,i)=>{const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-(6-i));return d})
  const points=days.map(day=>{const next=new Date(day);next.setDate(day.getDate()+1);const rows=orders.filter(o=>{const d=new Date(o.created_at);return d>=day&&d<next});return {label:day.toLocaleDateString(undefined,{weekday:'short'}),orders:rows.length,revenue:rows.reduce((n,o)=>n+Number(o.total||0)-Number(o.refunded_amount||0),0)}})
  const max=Math.max(1,...points.map(p=>p.revenue)), statuses=orders.reduce((all,o)=>({...all,[o.status]:(all[o.status]||0)+1}),{})
  const gross=Number(summary.gross||0), proceeds=Number(summary.organizer_proceeds||0), fees=Number(summary.platform_fees||0), refunds=Number(summary.refunds||0)
  return <div className="tk-insights"><section><div className="tk-insight-title"><div><strong>Net sales · last 7 days</strong><small>Revenue after recorded refunds</small></div><span>Last 7 days</span></div><div className="tk-bars">{points.map(p=><div key={p.label} title={`${p.orders} orders · ${money(p.revenue,currency)}`}><i style={{height:`${Math.max(4,p.revenue/max*100)}%`}}/><b>{p.label}</b><small>{p.orders}</small></div>)}</div></section><section><div className="tk-insight-title"><div><strong>Where the money goes</strong><small>Current event totals</small></div></div><div className="tk-money-flow"><div><span>Organizer proceeds</span><b>{money(proceeds,currency)}</b><i style={{width:`${gross?proceeds/gross*100:0}%`}}/></div><div><span>Festio commission</span><b>{money(fees,currency)}</b><i style={{width:`${gross?fees/gross*100:0}%`}}/></div><div><span>Refunded</span><b>{money(refunds,currency)}</b><i style={{width:`${gross?refunds/gross*100:0}%`}}/></div></div><div className="tk-status-mix">{Object.entries(statuses).map(([status,count])=><span key={status}><i className={`tk-dot ${status}`}/>{status.replaceAll('_',' ')} <b>{count}</b></span>)}</div></section></div>
}

function ReliabilityConsole({eventId, onError, onRefresh}) {
  const [events,setEvents]=useState([]), [journal,setJournal]=useState(null), [recipient,setRecipient]=useState(''), [notice,setNotice]=useState(''), [working,setWorking]=useState('')
  async function run(kind, fn){setWorking(kind);setNotice('');try{const result=await fn();setNotice(result)}catch(e){onError(e.message)}finally{setWorking('')}}
  const checkWebhooks=()=>run('webhooks',async()=>{const rows=await api.ticketingPaymentEvents(eventId);setEvents(rows);const failed=rows.filter(x=>x.last_error);return `${rows.length} provider events checked · ${failed.length} need attention`})
  const checkJournal=()=>run('journal',async()=>{const result=await api.ticketingJournal(eventId);setJournal(result);return result.balanced?'Accounting journal is balanced.':'Accounting journal needs review.'})
  return <section className="rr-panel tk-section tk-ops" aria-labelledby="ticket-operations-title"><div className="tk-section-head"><div><span className="tk-step">Operations & assurance</span><h2 id="ticket-operations-title">Financial and delivery controls</h2><p>Run safe maintenance, verify provider events, and inspect the accounting journal without leaving this page.</p></div><span className="tk-health" aria-live="polite">{working?'Checking…':notice||'Ready'}</span></div><div className="tk-op-grid"><button disabled={!!working} onClick={()=>run('maintenance',async()=>{const r=await api.runTicketingOperations(eventId);await onRefresh();return `Maintenance complete · ${r.expired_orders} abandoned orders released`})}><b>Run maintenance</b><span>Release expired holds and progress operational queues</span></button><button disabled={!!working} onClick={checkWebhooks}><b>Inspect webhook health</b><span>Show provider events and delivery errors</span></button><button disabled={!!working} onClick={checkJournal}><b>Verify accounting journal</b><span>Confirm immutable debit and credit lines balance</span></button></div><form className="tk-report-email" onSubmit={e=>{e.preventDefault();run('email',async()=>{await api.emailTicketSalesReport(eventId,recipient);setRecipient('');return 'Sales report queued for secure email delivery.'})}}><label htmlFor="ticket-report-email"><b>Email a sales report</b><span>Send the current event report to an authorized recipient.</span></label><input id="ticket-report-email" required type="email" value={recipient} onChange={e=>setRecipient(e.target.value)} placeholder="finance@example.com"/><button disabled={!!working}>Send report</button></form>{events.length>0&&<div className="tk-op-table" role="region" aria-label="Provider webhook events" tabIndex="0"><div className="head"><span>Provider event</span><span>Status</span><span>Received</span><span>Issue</span></div>{events.slice(0,20).map((row,index)=><div className="row" key={row.id||index}><span><b>{row.event_type||row.type||'Payment event'}</b><small>{row.provider||'provider'} · {(row.provider_event_id||row.id||'').slice(0,18)}</small></span><span className={row.last_error?'bad':'good'}>{row.last_error?'Needs attention':'Processed'}</span><span>{row.received_at?new Date(row.received_at).toLocaleString():'—'}</span><span>{row.last_error||'No processing error'}</span></div>)}</div>}{journal&&<div className={`tk-journal-result ${journal.balanced?'good':'bad'}`}><strong>{journal.balanced?'✓ Journal balanced':'! Review required'}</strong><span>{journal.lines?.length||0} immutable lines inspected</span></div>}</section>
}

export default function TicketingRedesignPage() {
  const [eventId, setEventId] = useCurrentEvent()
  const [events, setEvents] = useState([])
  const [config, setConfig] = useState(null)
  const [products, setProducts] = useState([])
  const [accessTypes, setAccessTypes] = useState([])
  const [payoutAccounts, setPayoutAccounts] = useState([])
  const [banks, setBanks] = useState([])
  const [connectProvider, setConnectProvider] = useState('')
  const [feeScope, setFeeScope] = useState('event')
  const [payoutDraft, setPayoutDraft] = useState({ business_name: '', settlement_bank: '', account_number: '', contact_name: '', contact_email: '', contact_phone: '', email: '', country: 'US' })
  const [sales, setSales] = useState(null)
  const [reconciliation, setReconciliation] = useState(null)
  const [draft, setDraft] = useState(emptyProduct)
  const [compDraft, setCompDraft] = useState({product_id:'',quantity:1,first_name:'',last_name:'',buyer_email:'',reason:'Organizer complimentary ticket',attendees:[{first_name:'',last_name:'',email:'',phone:null}]})
  const [settingsDraft, setSettingsDraft] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [section, setSection] = useState('sales')

  async function load() {
    if (!eventId) return
    setError('')
    try {
      const cfg = await api.ticketingConfig(eventId)
      setConfig(cfg)
      setSettingsDraft(usableSettings(cfg))
      if (cfg.service_enabled) {
        const [p, s, types, accounts, recon] = await Promise.all([api.ticketingProducts(eventId), api.ticketingSales(eventId), api.listTicketTypes(eventId).catch(() => []), api.ticketingPayoutAccounts(eventId),api.ticketingReconciliation(eventId).catch(()=>null)])
        setProducts(p); setSales(s); setAccessTypes(types); setPayoutAccounts(accounts); setReconciliation(recon)
      }
    } catch (e) { setError(e.message) }
  }
  useEffect(() => {
    api.listEvents().then((items) => {
      setEvents(items)
      if (!eventId && items.length) setEventId(items[0].id)
    }).catch((e) => setError(e.message))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setConfig(null); setProducts([]); setSales(null); setSettingsDraft(null); setPayoutAccounts([]); setConnectProvider('')
    load()
  }, [eventId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!eventId || !config?.config?.enabled) return
    const timer = window.setInterval(() => api.ticketingSales(eventId).then(setSales).catch(()=>{}), 15000)
    return () => window.clearInterval(timer)
  }, [eventId, config?.config?.enabled])

  async function saveConfig(enabled) {
    setBusy(true); setError('')
    try {
      const current = usableSettings({ ...config, config: settingsDraft || config?.config })
      await api.saveTicketingConfig(eventId, {
        enabled, currency: current.currency || 'USD', provider: current.provider || 'stripe',
        provider_account_id: current.provider_account_id || null, fees_paid_by: current.fees_paid_by || 'buyer',
        public_listing: !!current.public_listing,
        tax_enabled: !!current.tax_enabled, tax_bps: Number(current.tax_bps||0), tax_paid_by: current.tax_paid_by||'buyer',
      }); await load()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  async function saveFeePolicy(e) {
    e.preventDefault(); setBusy(true); setError('')
    try {
      await api.setTicketingFeePolicy(eventId, { scope: feeScope, fee_bps: Number(settingsDraft.fee_bps), fees_paid_by: settingsDraft.fees_paid_by })
      await load()
    } catch (e2) { setError(e2.message) } finally { setBusy(false) }
  }

  async function saveFeeArrangement(e) {
    e.preventDefault(); setBusy(true); setError('')
    try {
      const current = settingsDraft || config?.config
      await api.saveTicketingConfig(eventId, { enabled: current.enabled, currency: current.currency,
        provider: current.provider, provider_account_id: current.provider_account_id || null,
        fees_paid_by: current.fees_paid_by, public_listing: !!current.public_listing,
        tax_enabled: !!current.tax_enabled, tax_bps: Number(current.tax_bps||0), tax_paid_by: current.tax_paid_by||'buyer' })
      await load()
    } catch (e2) { setError(e2.message) } finally { setBusy(false) }
  }

  async function createProduct(e) {
    e.preventDefault(); setBusy(true); setError('')
    try {
      await api.createTicketingProduct(eventId, { ...draft, price: Math.round(Number(draft.price) * 100), capacity: Number(draft.capacity), currency: config.config.currency })
      setDraft({ ...emptyProduct, currency: config.config.currency }); await load()
    } catch (e2) { setError(e2.message) } finally { setBusy(false) }
  }

  async function issueComplimentary(e) {
    e.preventDefault(); setBusy(true); setError('')
    try { const quantity=Number(compDraft.quantity); const attendees=(quantity===1?[{first_name:compDraft.first_name,last_name:compDraft.last_name,email:compDraft.buyer_email,phone:null}]:compDraft.attendees.slice(0,quantity).map(a=>({...a,email:a.email||compDraft.buyer_email,phone:null}))); await api.createComplimentaryTicketOrder(eventId,{product_id:compDraft.product_id,quantity,buyer_name:`${compDraft.first_name} ${compDraft.last_name}`.trim(),buyer_email:compDraft.buyer_email,reason:compDraft.reason,attendees}); setCompDraft({...compDraft,quantity:1,first_name:'',last_name:'',buyer_email:'',attendees:[{first_name:'',last_name:'',email:'',phone:null}]}); await load() }
    catch(e2){setError(e2.message)}finally{setBusy(false)}
  }

  async function setPublicListing(value) {
    const current = settingsDraft || config?.config
    setBusy(true); setError('')
    try {
      await api.saveTicketingConfig(eventId, {...current, enabled:current.enabled, public_listing:value,
        provider_account_id:current.provider_account_id || null})
      await load()
    } catch(e) { setError(e.message) } finally { setBusy(false) }
  }

  async function saveTax(e) {
    e.preventDefault(); setBusy(true); setError('')
    try {
      const current=settingsDraft||config?.config
      await api.saveTicketingConfig(eventId,{...current,provider_account_id:current.provider_account_id||null,
        tax_enabled:!!current.tax_enabled,tax_bps:Math.round(Number(current.tax_bps||0)),tax_paid_by:current.tax_paid_by||'buyer'})
      await load()
    } catch(e2) { setError(e2.message) } finally { setBusy(false) }
  }

  async function saveCheckoutFields(fields) {
    const current=settingsDraft||config?.config
    await api.saveTicketingConfig(eventId,{...current,provider_account_id:current.provider_account_id||null,checkout_fields:fields})
    await load()
  }

  async function saveDeliverySettings(deliverySettings) {
    const current=settingsDraft||config?.config
    await api.saveTicketingConfig(eventId,{...current,provider_account_id:current.provider_account_id||null,delivery_settings:deliverySettings})
    await load()
  }

  function copy(value) { navigator.clipboard.writeText(value).catch(()=>window.prompt('Copy this value', value)) }

  function downloadReport() {
    const columns = ['Order ID','Created','Buyer','Email','Provider','Status','Tickets','Gross','Refunded','Tax','Festio fee','Organizer proceeds','Currency','Delivery','Additional answers','Payment reference']
    const quote = value => `"${String(value??'').replaceAll('"','""')}"`
    const rows = (sales?.orders||[]).map(o=>[o.id,o.created_at,o.buyer_name,o.buyer_email,o.provider,o.status,o.ticket_count,(o.total/100).toFixed(2),(o.refunded_amount/100).toFixed(2),(o.effective_tax/100).toFixed(2),(o.effective_platform_fee/100).toFixed(2),(o.organizer_proceeds/100).toFixed(2),o.currency,o.delivery_status,JSON.stringify(o.custom_answers||{}),o.payment_reference||o.provider_reference])
    const blob = new Blob([[columns,...rows].map(row=>row.map(quote).join(',')).join('\n')],{type:'text/csv;charset=utf-8'})
    const url=URL.createObjectURL(blob), a=document.createElement('a'); a.href=url; a.download=`festio-ticket-report-${eventId}.csv`; a.click(); URL.revokeObjectURL(url)
  }

  async function openConnector(name) {
    setConnectProvider(name); setError('')
    if (name === 'paystack' && !banks.length) {
      try { setBanks(await api.ticketingPaystackBanks(eventId)) } catch (e) { setError(e.message) }
    }
  }

  async function connectPaystack(e) {
    e.preventDefault(); setBusy(true); setError('')
    try {
      const account = await api.createPaystackPayoutAccount(eventId, {
        business_name: payoutDraft.business_name, settlement_bank: payoutDraft.settlement_bank,
        account_number: payoutDraft.account_number,
        contact_name: payoutDraft.contact_name || null, contact_email: payoutDraft.contact_email || null,
        contact_phone: payoutDraft.contact_phone || null,
      })
      await api.selectTicketingPayoutAccount(eventId, account.id); setConnectProvider(''); await load()
    } catch (e2) { setError(e2.message) } finally { setBusy(false) }
  }

  async function connectStripe(e) {
    e.preventDefault(); setBusy(true); setError('')
    try {
      const account = await api.createStripePayoutAccount(eventId, { business_name: payoutDraft.business_name, email: payoutDraft.email, country: payoutDraft.country })
      window.location.assign(account.onboarding_url)
    } catch (e2) { setError(e2.message); setBusy(false) }
  }

  async function choosePayoutAccount(id) {
    setBusy(true); setError('')
    try { await api.selectTicketingPayoutAccount(eventId, id); await load() }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  async function resumeStripe(accountId) {
    setBusy(true); setError('')
    try { const result = await api.resumeStripePayoutOnboarding(eventId, accountId); window.location.assign(result.onboarding_url) }
    catch (e) { setError(e.message); setBusy(false) }
  }

  const paymentMode = config?.test_mode === true ? 'Test mode' : config?.test_mode === false ? 'Live mode' : 'Checking payment mode…'
  const selectedProvider = settingsDraft?.provider || config?.config?.provider
  const providerConfigured = !!config?.providers?.[selectedProvider]
  const eventCurrency = config?.default_currency
  const ticketCurrency = config?.config?.currency

  return <RedesignShell title="Ticket sales" subtitle={paymentMode}>
    <div className="tk-workspace">
    <header className="tk-hero">
      <div><span className="tk-eyebrow">YOUR EVENT · YOUR BOX OFFICE</span><h1>Great events.<br/><em>A seamless way in.</em></h1><p>Shape your tickets, welcome your guests, and keep every sale in view.</p><div className="tk-hero-tags"><span>Ticket sales</span><span>Guest passes</span><span>Organizer payouts</span></div></div>
      <div className="tk-hero-tools"><label className="tk-event-picker"><span>Managing event</span><select value={eventId || ''} onChange={(e) => setEventId(e.target.value)}><option value="" disabled>Choose an event…</option>{events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}</select></label><div className={`tk-mode ${config?.test_mode === false ? 'live' : 'test'}`}><span></span>{paymentMode}<strong>{!config ? 'Wait for configuration' : !providerConfigured ? 'Provider not configured' : config.test_mode ? 'No live charges' : 'Live credentials configured'}</strong></div></div>
    </header>
    <nav className="tk-navigation" aria-label="Ticket sales sections">{[
      ['sales','Sales & orders','Performance and customer orders','↗'],
      ['tickets','Tickets','Types, complimentary passes and sharing','▤'],
      ['payments','Payments','Availability, currency and payouts','◎'],
      ['operations','Operations','Messages, reports and customer care','✦']
    ].map(([id,label,description,icon]) => <button key={id} type="button" aria-pressed={section===id} onClick={()=>setSection(id)}><span className="tk-nav-icon" aria-hidden="true">{icon}</span><span><strong>{label}</strong><small>{description}</small></span></button>)}</nav>
    <details className="tk-guide"><summary>New to ticket sales? Start here</summary><div><p><b>1 · Set up payments.</b> In Payments, confirm your currency, connect the organizer’s account, and enable ticket sales.</p><p><b>2 · Build your tickets.</b> In Tickets, add ticket types, check quantities and prices, then copy your hosted ticket link.</p><p><b>3 · Follow every sale.</b> Sales & orders shows payments, delivery status and refund actions. Operations contains ticket messages, reports and customer support tools.</p><p>Test mode does not take live payments. Currency is locked once products exist.</p></div></details>
    {error && <div role="alert" className="tk-error">{error}</div>}
    {eventCurrency && ticketCurrency && eventCurrency !== ticketCurrency && <div className="tk-error" role="status">Event currency is {eventCurrency}; existing tickets settle in {ticketCurrency} through {config.config.provider}. Existing ticket amounts are preserved. Currency cannot change after tickets are created; contact support to plan a new event catalog or a reviewed migration for a different currency.</div>}
    {!eventId ? <div className="rr-panel tk-empty">Choose an event above to open its box office.</div> : !config ? <div className="rr-panel tk-empty" role="status">{error ? 'Ticket sales could not be loaded. Select another event or reload the page.' : 'Loading your event’s ticket sales…'}</div> : !config.service_enabled ?
      <div className="rr-panel"><h2>Ticketing is switched off</h2><p>The ticketing master switch hides ticket sales everywhere and rejects checkout requests.</p></div> : <>
      <div hidden={section!=='payments'}>
      <section className="rr-panel tk-switch"><div><span className="tk-step">Availability</span><h2>Sell tickets for this event</h2><p>Turn this off anytime to remove checkout from the guest page immediately.</p></div><button disabled={busy} className={config?.config?.enabled ? 'on' : ''} onClick={() => saveConfig(!config?.config?.enabled)}><i></i>{config?.config?.enabled ? 'On' : 'Off'}</button></section>
      {config && settingsDraft && <section className="rr-panel tk-section tk-currency-settings"><h2>Ticket settlement currency</h2><label><span>Currency and provider</span><select aria-label="Ticket settlement currency" value={settingsDraft.currency} disabled={busy || products.length > 0} onChange={e => setSettingsDraft(current => ({ ...current, currency: e.target.value, provider: e.target.value === 'NGN' ? 'paystack' : 'stripe', provider_account_id: '' }))}><option value="USD">USD · Stripe</option><option value="NGN">NGN · Paystack</option></select></label><p>{products.length > 0 ? 'Currency is locked because this event has ticket products. Contact support to plan a new event catalog or a reviewed migration; existing prices and orders keep their original currency.' : 'Confirm the settlement currency before creating tickets. The selected provider must be configured for paid checkout.'}</p>{products.length === 0 && <button disabled={busy} onClick={() => saveConfig(!!settingsDraft.enabled)}>Save currency and provider</button>}</section>}
      </div>
      {!config?.config?.enabled && section!=='payments' && <section className="rr-panel tk-empty"><span aria-hidden="true">◎</span><h2>Get your box office ready</h2><p>Start with currency and payouts, then enable ticket sales to add tickets and receive orders.</p><button onClick={()=>setSection('payments')}>Set up payments →</button></section>}
      {config?.config?.enabled && <>
        <div hidden={section!=='payments'}>
        <section className="rr-panel tk-section"><div className="tk-section-head"><div><span className="tk-step">Organizer payouts</span><h2>Connect the organizer’s account</h2><p>Connect once, then reuse the verified payout account on any event.</p></div><span className="tk-saved">{paymentMode}</span></div>
          <div className="tk-connect-actions"><button onClick={()=>openConnector('paystack')} disabled={busy || !config?.providers?.paystack}>＋ Connect Paystack</button><button onClick={()=>openConnector('stripe')} disabled={busy || !config?.providers?.stripe}>＋ Connect Stripe{!config?.providers?.stripe?' · credentials required':''}</button></div>
          {connectProvider === 'paystack' && <form className="tk-connect-form" onSubmit={connectPaystack}><div className="tk-connect-title"><strong>New Paystack payout account</strong><button type="button" onClick={()=>setConnectProvider('')}>×</button></div><label><span>Business name</span><input required value={payoutDraft.business_name} onChange={e=>setPayoutDraft({...payoutDraft,business_name:e.target.value})}/></label><label><span>Settlement bank</span><select required value={payoutDraft.settlement_bank} onChange={e=>setPayoutDraft({...payoutDraft,settlement_bank:e.target.value})}><option value="">Choose bank…</option>{banks.map(bank=><option key={bank.code} value={bank.code}>{bank.name}</option>)}</select></label><label><span>Account number</span><input required inputMode="numeric" value={payoutDraft.account_number} onChange={e=>setPayoutDraft({...payoutDraft,account_number:e.target.value.replace(/\D/g,'')})}/></label><label><span>Contact name</span><input value={payoutDraft.contact_name} onChange={e=>setPayoutDraft({...payoutDraft,contact_name:e.target.value})}/></label><label><span>Contact email</span><input type="email" value={payoutDraft.contact_email} onChange={e=>setPayoutDraft({...payoutDraft,contact_email:e.target.value})}/></label><button disabled={busy}>Verify bank & create account</button></form>}
          {connectProvider === 'stripe' && <form className="tk-connect-form" onSubmit={connectStripe}><div className="tk-connect-title"><strong>Start Stripe-hosted onboarding</strong><button type="button" onClick={()=>setConnectProvider('')}>×</button></div><label><span>Business name</span><input required value={payoutDraft.business_name} onChange={e=>setPayoutDraft({...payoutDraft,business_name:e.target.value})}/></label><label><span>Organizer email</span><input required type="email" value={payoutDraft.email} onChange={e=>setPayoutDraft({...payoutDraft,email:e.target.value})}/></label><label><span>Country</span><input required maxLength="2" value={payoutDraft.country} onChange={e=>setPayoutDraft({...payoutDraft,country:e.target.value.toUpperCase()})}/></label><button disabled={busy}>Continue securely with Stripe ↗</button></form>}
          {payoutAccounts.length ? <div className="tk-accounts">{payoutAccounts.map(account=><div className={account.selected?'selected':''} key={account.id}><span className={`tk-provider ${account.provider}`}>{account.provider==='paystack'?'P':'S'}</span><span><strong>{account.business_name}</strong><small>{account.provider==='paystack'?'Paystack':'Stripe'} · {account.account_name || 'Onboarding'}{account.account_last4?` · •••• ${account.account_last4}`:''}</small></span><span className={`tk-status ${account.status}`}>{account.status}</span>{account.provider==='stripe' && account.status!=='verified'?<button disabled={busy} onClick={()=>resumeStripe(account.id)}>Continue onboarding</button>:account.selected?<strong className="tk-selected">Used for this event</strong>:<button disabled={busy} onClick={()=>choosePayoutAccount(account.id)}>Use for this event</button>}</div>)}</div>:<div className="tk-empty tk-account-empty"><span>🏦</span><strong>No connected payout accounts</strong><p>Connect Paystack or Stripe above. Festio will create and save the provider account automatically.</p></div>}
          <div className="tk-fee-summary"><div><span>Festio service share</span><strong>{((config?.fee_policy?.fee_bps ?? 500)/100).toFixed(2)}%</strong></div><div><span>Applied from</span><strong>{(config?.fee_policy?.source || 'platform default').replace('_',' ')}</strong></div><form className="tk-arrangement" onSubmit={saveFeeArrangement}><label><span>How should the fee be handled?</span><select value={settingsDraft?.fees_paid_by || 'buyer'} onChange={e=>setSettingsDraft({...settingsDraft,fees_paid_by:e.target.value})}><option value="buyer">Add it to the buyer’s total</option><option value="organizer">Deduct it from my proceeds</option></select></label><button disabled={busy}>Save choice</button></form></div>
          {config?.fee_policy?.can_manage && <form className="tk-fee-form" onSubmit={saveFeePolicy}><label><span>Override level</span><select value={feeScope} onChange={e=>setFeeScope(e.target.value)}><option value="global">Global default</option><option value="organization">This organization</option><option value="event">This event</option></select></label><label><span>Festio share (basis points)</span><input type="number" min="0" max="5000" value={settingsDraft?.fee_bps ?? 500} onChange={e=>setSettingsDraft({...settingsDraft,fee_bps:e.target.value})}/></label><button disabled={busy}>Apply superadmin override</button></form>}
          <form className="tk-tax-form" onSubmit={saveTax}><div><strong>Event tax</strong><small>Organizer-configured tax tracking. Confirm the applicable rate with your tax adviser.</small></div><label className="tk-tax-toggle"><input type="checkbox" checked={!!settingsDraft?.tax_enabled} onChange={e=>setSettingsDraft({...settingsDraft,tax_enabled:e.target.checked})}/><span>Enable tax for ticket sales</span></label>{settingsDraft?.tax_enabled&&<><label><span>Tax rate (%)</span><input required type="number" min="0" max="100" step="0.01" value={Number(settingsDraft?.tax_bps||0)/100} onChange={e=>setSettingsDraft({...settingsDraft,tax_bps:Math.round(Number(e.target.value)*100)})}/></label><label><span>Who pays the tax?</span><select value={settingsDraft?.tax_paid_by||'buyer'} onChange={e=>setSettingsDraft({...settingsDraft,tax_paid_by:e.target.value})}><option value="buyer">Add tax to customer total</option><option value="organizer">Organizer absorbs the tax</option></select></label></>}<button disabled={busy}>Save tax settings</button></form>
        </section>
        </div>
        <div hidden={section!=='tickets'}>
        <section className="rr-panel tk-section"><div className="tk-section-head"><div><span className="tk-step">Ticket types</span><h2>Add tickets</h2><p>Add General Admission, VIP, Early Bird, tables, donation tiers, or any other line item. Submit this form again for every type.</p></div><span className="tk-count">{products.length} {products.length===1?'type':'types'}</span></div><form className="tk-form tk-ticket-form" onSubmit={createProduct}>
          <label><span>Type</span><select value={draft.product_type} onChange={e=>setDraft({...draft, product_type:e.target.value, allow_custom_amount: e.target.value==='donation'?draft.allow_custom_amount:false})}><option value="ticket">Ticket (grants admission)</option><option value="donation">Donation / sponsorship (payment only, no pass)</option><option value="external">External registration (price shown here, buyer registers/pays elsewhere)</option></select></label>
          <label><span>{draft.product_type==='donation'?'Tier name':'Ticket name'}</span><input required placeholder={draft.product_type==='donation'?'e.g. Gold Sponsor':'e.g. VIP Admission'} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}/></label>
          <label><span>{draft.product_type==='donation'&&draft.allow_custom_amount?`Minimum amount (${config.config.currency})`:`Price (${config.config.currency})`}</span><input required type="number" min="0" step="0.01" placeholder="0.00" value={draft.price} onChange={e => setDraft({ ...draft, price: e.target.value })}/></label>
          <label><span>{draft.product_type==='donation'?'Number available':'Quantity available'}</span><input required type="number" min="1" placeholder="100" value={draft.capacity} onChange={e => setDraft({ ...draft, capacity: e.target.value })}/></label>
          {draft.product_type==='external' && (
            <label className="tk-wide"><span>Registration link</span><input required type="url" placeholder="https://your-registration-site.example/register" value={draft.external_url} onChange={e => setDraft({ ...draft, external_url: e.target.value })}/></label>
          )}
          {draft.product_type==='donation' ? (
            <label className="tk-wide"><input type="checkbox" checked={draft.allow_custom_amount} onChange={e=>setDraft({...draft, allow_custom_amount:e.target.checked})}/> Let the donor pledge more than the amount above</label>
          ) : (
            <label><span>Admission access</span><select value={draft.access_ticket_type_id || ''} onChange={e=>setDraft({...draft,access_ticket_type_id:e.target.value||null})}><option value="">All-access/default QR pass</option>{accessTypes.map(t=><option value={t.id} key={t.id}>{t.name}</option>)}</select></label>
          )}
          <label className="tk-wide"><span>Description</span><textarea placeholder={draft.product_type==='donation'?'Tell donors what this tier supports':'Tell guests what this ticket includes'} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })}/></label>
          <button className="tk-add" disabled={busy}>＋ Add this {draft.product_type==='donation'?'donation tier':'ticket type'}</button>
        </form></section>
        </div>
        <div hidden={section!=='operations'}>
        <ReliabilityConsole eventId={eventId} onError={setError} onRefresh={load}/>
        <TicketingOperationsPanel eventId={eventId} sales={sales} checkoutFields={config?.config?.checkout_fields||[]} onSaveCheckoutFields={saveCheckoutFields} deliverySettings={config?.config?.delivery_settings||{}} onSaveDeliverySettings={saveDeliverySettings} canBootstrap={!!config?.fee_policy?.can_manage} onError={setError} onRefresh={load}/>
        </div>
        <div hidden={section!=='payments'}>
        {reconciliation&&<section className="rr-panel tk-section"><div className="tk-section-head"><div><span className="tk-step">Provider reconciliation</span><h2>Settlements & processing fees</h2><p>Actual provider-reported movement, separate from Festio’s expected ledger.</p></div><span className="tk-saved">{reconciliation.provider||'Provider'} · {reconciliation.status.replaceAll('_',' ')}</span></div>{reconciliation.settlements?.length?<div className="tk-list">{reconciliation.settlements.slice(0,20).map(row=><div key={row.id}><span className="tk-ticket-name"><strong>Settlement {row.id}</strong><small>{row.settled_at?new Date(row.settled_at).toLocaleString():'Pending date'} · {row.status}</small></span><span>Gross {money(row.gross,row.currency)}</span><span>Fees {money(row.processor_fees,row.currency)}</span><strong>Net {money(row.net,row.currency)}</strong></div>)}</div>:<div className="tk-empty"><strong>No provider settlements reported yet</strong><p>Expected for test transactions or before the first payout cycle.</p></div>}</section>}
        </div>
        <div hidden={section!=='operations'}>
        {sales?.waitlist?.length>0&&<section className="rr-panel tk-section"><div className="tk-section-head"><div><span className="tk-step">Waitlist</span><h2>Customers waiting for tickets</h2><p>When inventory is available, create a timed reservation and share the secure offer link.</p></div><span className="tk-count">{sales.summary?.waitlist_count||0} waiting</span></div><div className="tk-list">{sales.waitlist.map(row=><div key={row.id}><span className="tk-ticket-name"><strong>{row.name}</strong><small>{row.email} · wants {row.quantity} · {row.status}{row.offer_expires_at?` until ${new Date(row.offer_expires_at).toLocaleTimeString()}`:''}</small></span>{row.status==='waiting'&&<button onClick={async()=>{try{const result=await api.offerWaitlistTicket(eventId,row.id,{minutes:30});window.prompt('Send this 30-minute offer link to the customer:',result.offer_url);await load()}catch(e){setError(e.message)}}}>Create 30-minute offer</button>}</div>)}</div></section>}
        </div>
        <div hidden={section!=='tickets'}>
        <section className="rr-panel tk-section"><div className="tk-section-head"><div><span className="tk-step">Your catalog</span><h2>Your tickets</h2></div></div>{products.length ? <div className="tk-list">{products.map(p => <div key={p.id}><span className="tk-ticket-icon">{p.name.slice(0,1).toUpperCase()}</span><span className="tk-ticket-name"><strong>{p.name}{p.product_type==='donation' && ' 🎁'}{p.product_type==='external' && ' ↗'}{!p.active && ' (hidden)'}</strong><small>{p.product_type==='external'?<>External registration · <a href={p.external_url} target="_blank" rel="noreferrer">{p.external_url}</a></>:p.product_type==='donation'?(p.allow_custom_amount?`${money(p.price,p.currency)}+ pledged`:'fixed tier'):`${p.sold} sold`}{p.product_type!=='external' && <> · {p.capacity-p.sold} remaining</>}</small></span><strong>{money(p.price, p.currency)}{p.product_type==='donation'&&p.allow_custom_amount?'+':''}</strong><button disabled={busy} onClick={async()=>{if(!window.confirm(`Hide ${p.name} from sale?`))return;setBusy(true);try{await api.deleteTicketingProduct(eventId,p.id);await load()}catch(e){setError(e.message)}finally{setBusy(false)}}}>Hide</button></div>)}</div> : <div className="tk-empty"><span>🎟</span><strong>No ticket types yet</strong><p>Create your first ticket above. You can add as many types as the event needs.</p></div>}</section>
        {products.length>0&&<section className="rr-panel tk-section"><div className="tk-section-head"><div><span className="tk-step">Complimentary admission</span><h2>Issue tickets without payment</h2><p>For one pass, the recipient name is printed automatically. Add individual attendee names only when issuing multiple passes.</p></div></div><form className="tk-form tk-comp-form" onSubmit={issueComplimentary}><label><span>Ticket type</span><select required value={compDraft.product_id} onChange={e=>setCompDraft({...compDraft,product_id:e.target.value})}><option value="">Choose ticket…</option>{products.filter(p=>p.active&&p.capacity>p.sold).map(p=><option value={p.id} key={p.id}>{p.name} · {p.capacity-p.sold} left</option>)}</select></label><label><span>Quantity</span><input required type="number" min="1" max="500" value={compDraft.quantity} onChange={e=>{const quantity=Math.max(1,Number(e.target.value)||1);setCompDraft({...compDraft,quantity,attendees:Array.from({length:quantity},(_,i)=>compDraft.attendees[i]||(i===0?{first_name:compDraft.first_name,last_name:compDraft.last_name,email:compDraft.buyer_email,phone:null}:{first_name:'',last_name:'',email:'',phone:null}))})}}/></label><label><span>Recipient first name</span><input required value={compDraft.first_name} onChange={e=>setCompDraft({...compDraft,first_name:e.target.value})}/></label><label><span>Recipient last name</span><input required value={compDraft.last_name} onChange={e=>setCompDraft({...compDraft,last_name:e.target.value})}/></label><label><span>Delivery email</span><input required type="email" value={compDraft.buyer_email} onChange={e=>setCompDraft({...compDraft,buyer_email:e.target.value})}/></label><label><span>Reason</span><input required value={compDraft.reason} onChange={e=>setCompDraft({...compDraft,reason:e.target.value})}/></label>{Number(compDraft.quantity)>1&&<div className="tk-comp-attendees"><div className="tk-comp-attendees-head"><b>Names printed on each pass</b><span>Each attendee receives a unique QR code. Blank emails use the delivery email above.</span></div>{compDraft.attendees.slice(0,Number(compDraft.quantity)).map((a,i)=><fieldset className="tk-comp-attendee" key={i}><legend>Pass {i+1}</legend><label><span>First name</span><input required value={a.first_name} onChange={e=>{const attendees=[...compDraft.attendees];attendees[i]={...a,first_name:e.target.value};setCompDraft({...compDraft,attendees})}}/></label><label><span>Last name</span><input required value={a.last_name} onChange={e=>{const attendees=[...compDraft.attendees];attendees[i]={...a,last_name:e.target.value};setCompDraft({...compDraft,attendees})}}/></label><label><span>Email (optional)</span><input type="email" value={a.email} onChange={e=>{const attendees=[...compDraft.attendees];attendees[i]={...a,email:e.target.value};setCompDraft({...compDraft,attendees})}}/></label></fieldset>)}</div>}<button className="tk-comp-submit" disabled={busy}>Issue complimentary {Number(compDraft.quantity)===1?'pass':'passes'}</button></form></section>}
        <section className="rr-panel tk-section"><div className="tk-section-head"><div><span className="tk-step">Publish & share</span><h2>Put tickets anywhere</h2><p>The hosted page works in messages, social profiles, QR codes, and email. The embed code adds checkout to the client’s own website.</p></div></div><div className="tk-list"><div><span className="tk-ticket-name"><strong>Festio Find Events</strong><small>Published automatically while ticket sales are enabled. Turning ticketing off removes it immediately.</small></span><button onClick={()=>window.open('/tickets','_blank')}>View events</button></div><div><span className="tk-ticket-name"><strong>Hosted ticket page</strong><small>{`${window.location.origin}/tickets/e/${eventId}`}</small></span><button onClick={()=>copy(`${window.location.origin}/tickets/e/${eventId}`)}>Copy link</button></div><div><span className="tk-ticket-name"><strong>Website embed</strong><small>Responsive iframe checkout</small></span><button onClick={()=>copy(`<iframe src="${window.location.origin}/embed/tickets/${eventId}" title="Buy tickets" width="100%" height="900" style="border:0" loading="lazy"></iframe>`)}>Copy embed</button></div></div></section>
        </div>
        <div hidden={section!=='sales'}>
        <SalesPulse orders={sales?.orders} summary={sales?.summary} currency={config.config.currency}/>
        <section className="rr-panel tk-report"><div className="tk-report-head"><div><span className="tk-step">Live sales report</span><h2>Ticket performance & money</h2><p>Refreshes every 15 seconds · Last calculated {sales?.summary?.generated_at?new Date(sales.summary.generated_at).toLocaleTimeString():'—'}</p></div><button onClick={downloadReport} disabled={!sales?.orders?.length}>Download CSV report</button></div><div className="tk-kpis"><div><span>Gross collected</span><strong>{money(sales?.summary?.gross,config.config.currency)}</strong><small>Successful charges before refunds</small></div><div><span>Tickets sold</span><strong>{sales?.summary?.tickets_sold||0}</strong><small>{sales?.summary?.sold_orders||0} active paid orders</small></div><div><span>Refunded</span><strong>{money(sales?.summary?.refunds,config.config.currency)}</strong><small>{sales?.summary?.refunded_orders||0} fully refunded orders</small></div><div><span>Festio commission</span><strong>{money(sales?.summary?.platform_fees,config.config.currency)}</strong><small>After refunded amounts</small></div><div className="featured"><span>Organizer proceeds</span><strong>{money(sales?.summary?.organizer_proceeds,config.config.currency)}</strong><small>Net collected less Festio commission</small></div><div><span>Tax collected</span><strong>{sales?.summary?.tax_status==='not_configured'?'Not configured':money(sales?.summary?.tax_collected,config.config.currency)}</strong><small>{sales?.summary?.tax_status==='not_configured'?'No tax rules are currently applied':'Organizer-configured event tax'}</small></div><div><span>Processor fees</span><strong>{sales?.summary?.processor_fees==null?'Awaiting provider data':money(sales.summary.processor_fees,config.config.currency)}</strong><small>Not deducted from proceeds above</small></div><div><span>Needs attention</span><strong>{(sales?.summary?.pending_cancellations||0)+(sales?.summary?.disputed_orders||0)}</strong><small>{sales?.summary?.pending_cancellations||0} cancellations · {sales?.summary?.disputed_orders||0} disputes</small></div></div><div className="tk-order-head"><h3>Complete order ledger</h3><span>{sales?.orders?.length||0} total orders</span></div><div className="tk-order-table" role="region" aria-label="Ticket orders" tabIndex="0"><div className="head"><span>Customer / order</span><span>Tickets</span><span>Gross</span><span>Refund</span><span>Festio fee</span><span>Organizer</span><span>Status / actions</span></div>{sales?.orders?.map(o => <div className="row" key={o.id}><span><b>{o.buyer_name}</b><small>{o.buyer_email}<br/>{o.id.slice(0,8).toUpperCase()} · {new Date(o.created_at).toLocaleString()}</small></span><span>{o.ticket_count||0}</span><span>{money(o.total,o.currency)}</span><span>{money(o.refunded_amount,o.currency)}</span><span>{money(o.effective_platform_fee,o.currency)}</span><span><b>{money(o.organizer_proceeds,o.currency)}</b></span><span><em className={`tk-order-status ${o.status}`}>{o.status.replaceAll('_',' ')}</em><small>{o.provider} · delivery {o.delivery_status||'pending'}</small><div className="tk-order-actions">{o.cancellation?.status==='pending' && <><button onClick={() => api.decideTicketCancellation(eventId,o.cancellation.id,{action:'approve',note:null}).then(load)}>Approve & refund</button><button onClick={() => api.decideTicketCancellation(eventId,o.cancellation.id,{action:'reject',note:null}).then(load)}>Reject</button></>}{o.status === 'paid' && <button onClick={() => api.retryTicketFulfillment(eventId,o.id).then(load)}>Retry fulfillment</button>}{o.status === 'fulfilled' && <button onClick={() => api.resendTicketOrder(eventId,o.id).then(load)}>Resend</button>}{['paid','fulfilled','partially_refunded'].includes(o.status) && o.cancellation?.status!=='pending' && <button onClick={() => api.refundTicketOrder(eventId,o.id,{reason:'requested_by_customer'}).then(load)}>Refund</button>}</div></span></div>)}</div>{!sales?.orders?.length && <div className="tk-empty"><strong>Your first sale starts here</strong><p>Orders will appear here after guests purchase tickets. Build and share your ticket page from Tickets.</p></div>}</section>
        </div>
      </>}
    </>}
    </div>
  </RedesignShell>
}
