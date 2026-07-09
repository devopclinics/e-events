import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'

function money(amount, currency) {
  if (amount == null) return 'Custom'
  const major = amount / 100
  return currency === 'NGN' ? `₦${major.toLocaleString()}` : `$${major.toLocaleString()}`
}

const compareRows = [
  ['Guest limit', '25', '50', '150', '300', '1,000', 'Custom'],
  ['Email invitations', 'Yes', 'Yes', 'Yes', 'Yes', 'Yes', 'Yes'],
  ['SMS/WhatsApp', 'No', 'Yes', 'Yes', 'Yes', 'Yes', 'Custom'],
  ['QR check-in', 'Preview', 'Yes', 'Yes', 'Yes', 'Yes', 'Yes'],
  ['Design Studio', 'No', 'Standard templates', 'Expanded templates', 'Expanded templates', 'Expanded templates', 'Custom'],
  ['Seating/table groups', 'Preview', 'Basic', 'Advanced', 'Advanced', 'Advanced', 'Custom'],
  ['Access zones/gates', 'No', 'No', 'Yes', 'Yes', 'Yes', 'Custom'],
  ['Experience workflows', 'Preview', 'No', 'No', 'Yes', 'Yes', 'Custom'],
  ['Consent/scanner confirmations', 'No', 'No', 'No', 'Yes', 'Yes', 'Custom'],
  ['Support', 'Self-serve', 'Self-serve', 'Self-serve', 'Priority queue', 'Priority', 'Dedicated'],
]

const faqs = [
  ['Can I create before paying?', 'Yes. Create a draft event and use the free RSVP/email workflow for up to 25 guests. Paid modules like Design Studio, QR check-in, seating, access, logistics, registry, and Experience activate after an Event Pass.'],
  ['What counts as a message credit?', 'SMS/WhatsApp/MMS/RCS usage consumes credits. Email is included for normal RSVP and invitation flows.'],
  ['Do failed messages count?', 'Failed messages should not permanently consume credits. Full reserve/refund ledger behavior is planned as the next messaging phase.'],
  ['Can I buy more credits?', 'Yes. Paid events can buy top-ups from Event Setup.'],
  ['Can I use this for Nigerian events?', 'Yes. NGN pricing uses Paystack. Nigerian/local SMS routing is treated as a provider setup item before high-volume sending.'],
  ['Can I remove Festio branding?', 'Yes, on paid Event Passes.'],
]

export default function PricingPage() {
  const [currency, setCurrency] = useState('USD')
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    api.getPricing(currency).then(setData).catch((e) => setErr(e.message))
  }, [currency])

  const tiers = data?.tiers || []
  const packs = data?.packs || []
  const free = data?.free
  const enterprise = data?.enterprise

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="max-w-7xl mx-auto px-4 py-10 sm:py-14">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="max-w-3xl">
            <p className="text-sm font-black uppercase tracking-widest text-teal-700 dark:text-teal-300">Pay once per event</p>
            <h1 className="mt-2 text-3xl sm:text-5xl font-black text-slate-950 dark:text-white">Pricing for event operations</h1>
            <p className="mt-3 text-base text-slate-600 dark:text-slate-300">
              Start free for RSVP and email invites, then pay only when you activate premium tools like SMS/WhatsApp,
              QR check-in, Design Studio, seating, access control, logistics, registry, or Experience workflows.
            </p>
          </div>
          <div className="inline-flex w-fit rounded-lg border border-slate-300 dark:border-slate-700 overflow-hidden text-sm">
            {['USD', 'NGN'].map((c) => (
              <button key={c} onClick={() => setCurrency(c)}
                className={`px-4 py-2 font-bold ${currency === c ? 'bg-teal-600 text-white' : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200'}`}>
                {c}
              </button>
            ))}
          </div>
        </div>

        {err && <div className="mt-6 text-sm text-red-600">{err}</div>}

        {data && (
          <>
            <div className="mt-10 grid gap-4 lg:grid-cols-3 xl:grid-cols-6">
              <PlanCard
                name="Free"
                price={money(0, currency)}
                detail="Create and preview"
                guest={`Up to ${free?.guest_cap || 25} guests`}
                credits="Email only"
                features={free?.capabilities || []}
                limitations={free?.limitations || []}
                cta="Start free"
                to="/register"
              />
              {tiers.map((tier) => (
                <PlanCard
                  key={tier.key}
                  name={tier.name || tier.label}
                  price={money(tier.amount, tier.currency)}
                  detail="Per event"
                  guest={`Up to ${tier.guest_cap?.toLocaleString()} guests`}
                  credits={`${tier.credits.toLocaleString()} message credits`}
                  description={tier.description}
                  features={tier.capabilities || []}
                  cta="Create event"
                  to={`/register?plan=${encodeURIComponent(tier.key)}`}
                  highlighted={tier.key === 'tier300'}
                />
              ))}
              <PlanCard
                name={enterprise?.name || 'Enterprise'}
                price="Custom"
                detail="For 1,000+ guests"
                guest="Custom guest volume"
                credits="Custom message volume"
                features={enterprise?.capabilities || []}
                cta="Contact sales"
                to="mailto:hello@festio.events?subject=Festio%20Enterprise"
              />
            </div>

            <section className="mt-12">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-xl font-black text-slate-950 dark:text-white">Message-credit top-ups</h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400">Top-ups are available after an Event Pass is active.</p>
                </div>
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Email is included for normal RSVP and invite flows.</span>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                {packs.map((p) => (
                  <div key={p.key} className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                    <div className="text-sm font-bold text-slate-950 dark:text-white">{p.label}</div>
                    <div className="mt-1 text-2xl font-black text-teal-700 dark:text-teal-300">{money(p.amount, p.currency)}</div>
                  </div>
                ))}
              </div>
            </section>

            <section className="mt-12 overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <table className="min-w-[900px] w-full text-sm">
                <thead className="bg-slate-100 text-left text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  <tr>
                    {['Feature', 'Free', 'Starter', 'Standard', 'Pro', 'Scale', 'Enterprise'].map((h) => (
                      <th key={h} className="px-4 py-3 font-black">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {compareRows.map((row) => (
                    <tr key={row[0]} className="text-slate-600 dark:text-slate-300">
                      {row.map((cell, i) => <td key={`${row[0]}-${i}`} className="px-4 py-3">{cell}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="mt-12 grid gap-4 md:grid-cols-2">
              {faqs.map(([q, a]) => (
                <div key={q} className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                  <h3 className="font-black text-slate-950 dark:text-white">{q}</h3>
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{a}</p>
                </div>
              ))}
            </section>
          </>
        )}

        <div className="mt-12 flex flex-wrap items-center justify-center gap-4 text-xs text-slate-500 dark:text-slate-400">
          <Link to="/refund-policy" className="hover:underline">Refund policy</Link>
          <Link to="/login" className="hover:underline">Sign in</Link>
          <span>Taxes calculated at checkout where applicable.</span>
        </div>
      </div>
    </div>
  )
}

function PlanCard({ name, price, detail, guest, credits, description, features, limitations = [], cta, to, highlighted }) {
  const isMail = to?.startsWith('mailto:')
  const Cta = isMail ? 'a' : Link
  const ctaProps = isMail ? { href: to } : { to }
  return (
    <div className={`flex min-h-[30rem] flex-col rounded-lg border bg-white p-5 dark:bg-slate-900 ${
      highlighted ? 'border-teal-500 shadow-lg shadow-teal-900/10' : 'border-slate-200 dark:border-slate-800'
    }`}>
      <div className="min-h-24">
        <h2 className="text-base font-black text-slate-950 dark:text-white">{name}</h2>
        <div className="mt-2 text-3xl font-black text-slate-950 dark:text-white">{price}</div>
        <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">{detail}</div>
      </div>
      <div className="mt-4 space-y-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
        <div>{guest}</div>
        <div>{credits}</div>
      </div>
      {description && <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{description}</p>}
      <ul className="mt-4 flex-1 space-y-2 text-sm text-slate-600 dark:text-slate-300">
        {features.map((feature) => <li key={feature}>✓ {feature}</li>)}
        {limitations.map((feature) => <li key={feature} className="text-slate-400 dark:text-slate-500">- {feature}</li>)}
      </ul>
      <Cta {...ctaProps} className="mt-5 inline-flex min-h-11 items-center justify-center rounded-lg bg-teal-600 px-4 py-2 text-sm font-black text-white hover:bg-teal-700">
        {cta}
      </Cta>
    </div>
  )
}
