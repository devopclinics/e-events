import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, PUBLIC_BASE_URL } from '../api'
import { useCurrentEvent } from '../hooks/useCurrentEvent'
import { zonedWallTimeToUtcISOString } from '../timeutil'

// Full IANA zone list where the browser supports it, else a small curated set.
// Event times render in the chosen zone, so this is required at creation.
const TIMEZONES =
  typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('timeZone')
    : ['Europe/Zurich', 'Europe/London', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Asia/Dubai', 'Asia/Kolkata', 'UTC']
const DETECTED_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || ''

const featureOptions = [
  { key: 'qr', label: 'QR check-in', plan: 'tier50' },
  { key: 'seating', label: 'Seating/table allocation', plan: 'tier50' },
  { key: 'menu', label: 'Menu/orders', plan: 'tier50' },
  { key: 'access', label: 'Access zones/gates', plan: 'tier150' },
  { key: 'design', label: 'Design Studio (paid)', plan: 'tier50' },
  { key: 'logistics', label: 'Logistics/vendor lists', plan: 'tier50' },
  { key: 'registry', label: 'Registry public page', plan: 'tier50' },
  { key: 'experience', label: 'Experience workflows', plan: 'tier300' },
  { key: 'consent', label: 'Consent/scanner confirmations', plan: 'tier300' },
]

const planRank = { free: 0, tier50: 1, tier150: 2, tier300: 3, scale: 4 }
const planNames = {
  free: 'Free',
  tier50: 'Starter',
  tier150: 'Standard',
  tier300: 'Pro',
  scale: 'Scale',
}

const planGuestHints = {
  free: 'Up to 25 guests',
  tier50: 'Up to 50 guests',
  tier150: 'Up to 150 guests',
  tier300: 'Up to 300 guests',
  scale: 'Up to 1,000 guests',
}

function localDateTimeValue() {
  const d = new Date()
  d.setDate(d.getDate() + 14)
  d.setHours(18, 0, 0, 0)
  return d.toISOString().slice(0, 16)
}

function recommendedPlan(guestCount, channels, features) {
  let plan = Number(guestCount || 0) > 25 ? 'tier50' : 'free'
  if (Number(guestCount || 0) > 50) plan = 'tier150'
  if (Number(guestCount || 0) > 150) plan = 'tier300'
  if (Number(guestCount || 0) > 300) plan = 'scale'
  if (Number(guestCount || 0) > 1000) return 'enterprise'
  if (channels.sms || channels.whatsapp) plan = planRank[plan] < 1 ? 'tier50' : plan
  for (const feature of featureOptions) {
    if (features[feature.key] && planRank[feature.plan] > planRank[plan]) plan = feature.plan
  }
  return plan
}

export default function SetupWizardPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [, setCurrentEvent] = useCurrentEvent()
  const selectedPlan = params.get('plan') || ''
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [form, setForm] = useState({
    name: '',
    event_type: '',
    host_name: '',
    event_date: localDateTimeValue(),
    timezone: '',
    venue_name: '',
    venue_address: '',
    guest_count: params.get('guests') || '',
    currency: params.get('currency') || 'USD',
  })
  const [channels, setChannels] = useState({ email: true, sms: false, whatsapp: false })
  const [features, setFeatures] = useState({})

  const rec = useMemo(
    () => recommendedPlan(form.guest_count, channels, features),
    [form.guest_count, channels, features],
  )
  const displayedPlan = selectedPlan && planRank[selectedPlan] > planRank[rec] ? selectedPlan : rec

  function setField(key, value) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function toggleFeature(key) {
    setFeatures((current) => ({ ...current, [key]: !current[key] }))
  }

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setErr('')
    try {
      const event = await api.createEvent({
        name: form.name.trim(),
        couples_name: form.host_name.trim(),
        event_type: form.event_type || null,
        event_date: zonedWallTimeToUtcISOString(form.event_date, form.timezone),
        timezone: form.timezone,
        description: '',
        checkin_base_url: PUBLIC_BASE_URL,
        venue_name: form.venue_name.trim() || null,
        venue_address: form.venue_address.trim() || null,
      })
      await api.setBillingCurrency(event.id, form.currency)
      setCurrentEvent(event.id)
      navigate(`/admin?recommended=${encodeURIComponent(displayedPlan)}`, { replace: true })
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 focus:outline-none focus:ring-2 focus:ring-teal-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white'

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10 dark:bg-slate-950">
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1fr_22rem]">
        <form onSubmit={submit} className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="text-sm font-black uppercase tracking-widest text-teal-700 dark:text-teal-300">Event setup</p>
          <h1 className="mt-2 text-3xl font-black text-slate-950 dark:text-white">Create your draft event</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Create the free RSVP/email draft first. Checkout appears later when you activate paid modules.
          </p>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">Event name</span>
              <input className={input} value={form.name} onChange={(e) => setField('name', e.target.value)} required placeholder="Aisha & Omar Aqdu" />
            </label>
            <label>
              <span className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">Event type</span>
              <select className={input} value={form.event_type} onChange={(e) => setField('event_type', e.target.value)} required>
                <option value="" disabled>Select event type…</option>
                {[
                  'Wedding', 'Nikkah / Aqd', 'Graduation ceremony', 'Birthday party',
                  'Gala / banquet', 'Conference / seminar', 'Community / religious event',
                  'Corporate event', 'Concert / show', 'Private party', 'Other',
                ].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label>
              <span className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">Host / organizer name <span className="font-normal text-slate-400">(optional)</span></span>
              <input className={input} value={form.host_name} onChange={(e) => setField('host_name', e.target.value)} placeholder="Shown on invites, e.g. Al-Azeemah Schools" />
            </label>
            <label>
              <span className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">Date and time</span>
              <input className={input} type="datetime-local" value={form.event_date} onChange={(e) => setField('event_date', e.target.value)} required />
            </label>
            <label>
              <span className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">Timezone</span>
              <select className={input} value={form.timezone} onChange={(e) => setField('timezone', e.target.value)} required>
                <option value="" disabled>Select the event's timezone…</option>
                {DETECTED_TZ && <option value={DETECTED_TZ}>{DETECTED_TZ} (detected)</option>}
                {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
              </select>
              <span className="mt-1 block text-[11px] text-slate-400">All invite and guest times display in this zone.</span>
            </label>
            <label>
              <span className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">Venue name</span>
              <input className={input} value={form.venue_name} onChange={(e) => setField('venue_name', e.target.value)} placeholder="The Grand Hall" />
            </label>
            <label>
              <span className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">Location</span>
              <input className={input} value={form.venue_address} onChange={(e) => setField('venue_address', e.target.value)} placeholder="City, state or full address" />
            </label>
            <label>
              <span className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">Estimated guests</span>
              <input className={input} type="number" min="1" value={form.guest_count} onChange={(e) => setField('guest_count', e.target.value)} placeholder="150" />
            </label>
            <label>
              <span className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">Currency</span>
              <select className={input} value={form.currency} onChange={(e) => setField('currency', e.target.value)}>
                <option value="USD">USD - Stripe</option>
                <option value="NGN">NGN - Paystack</option>
              </select>
            </label>
          </div>

          <section className="mt-6">
            <h2 className="text-sm font-black text-slate-950 dark:text-white">Messaging channels needed</h2>
            <div className="mt-3 flex flex-wrap gap-3">
              {[
                ['email', 'Email'],
                ['sms', 'SMS'],
                ['whatsapp', 'WhatsApp'],
              ].map(([key, label]) => (
                <label key={key} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold dark:border-slate-700 dark:text-slate-200">
                  <input type="checkbox" checked={!!channels[key]} onChange={(e) => setChannels((c) => ({ ...c, [key]: e.target.checked }))} disabled={key === 'email'} />
                  {label}
                </label>
              ))}
            </div>
          </section>

          <section className="mt-6">
            <h2 className="text-sm font-black text-slate-950 dark:text-white">Features you expect to use</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {featureOptions.map((feature) => (
                <button key={feature.key} type="button" onClick={() => toggleFeature(feature.key)}
                  className={`rounded-lg border px-3 py-2 text-left text-sm font-semibold ${
                    features[feature.key]
                      ? 'border-teal-500 bg-teal-50 text-teal-900 dark:bg-teal-950/40 dark:text-teal-100'
                      : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'
                  }`}>
                  {feature.label}
                </button>
              ))}
            </div>
          </section>

          {err && <p className="mt-4 text-sm text-red-600">{err}</p>}
          <button disabled={busy} className="mt-6 min-h-12 rounded-lg bg-teal-600 px-5 py-3 text-sm font-black text-white hover:bg-teal-700 disabled:opacity-50">
            {busy ? 'Creating draft...' : 'Create draft event'}
          </button>
        </form>

        <aside className="h-fit rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-lg font-black text-slate-950 dark:text-white">Recommended plan</h2>
          <div className="mt-3 rounded-lg bg-teal-50 p-4 dark:bg-teal-950/30">
            <div className="text-2xl font-black text-teal-800 dark:text-teal-200">
              {displayedPlan === 'enterprise' ? 'Enterprise' : planNames[displayedPlan]}
            </div>
            <p className="mt-2 text-sm text-teal-900 dark:text-teal-100">
              {displayedPlan === 'enterprise'
                ? 'Your guest count is above 1,000 or needs custom operations.'
                : `${planGuestHints[displayedPlan]}. Based on guest count, messaging, feature selections, and any pass you selected from pricing. You can still start with the free RSVP/email workflow and pay when activating paid modules.`}
            </p>
          </div>
          {selectedPlan && selectedPlan !== displayedPlan && (
            <p className="mt-3 text-xs font-semibold text-slate-500 dark:text-slate-400">
              Selected pass: {planNames[selectedPlan] || selectedPlan}. The wizard will recommend the smallest pass that fits unless your selected pass is higher.
            </p>
          )}
          <ul className="mt-5 space-y-2 text-sm text-slate-600 dark:text-slate-300">
            <li>✓ Draft event is free to create.</li>
            <li>✓ Free includes RSVP, email invites, and up to 25 guests.</li>
            <li>✓ Design Studio starts with Starter Event Pass.</li>
            <li>✓ Payment gate appears only for paid activation.</li>
            <li>✓ Currency can be changed in Event Setup.</li>
          </ul>
        </aside>
      </div>
    </div>
  )
}
