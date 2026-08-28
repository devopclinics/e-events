import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useTheme } from '../context/ThemeContext'
import { useAuth } from '../context/AuthContext'
import { api } from '../api'
import './PricingRedesignPage.css'

// Kept in sync with the same role split LandingRedesignPage.jsx uses so
// "Open app" always reaches the redesign, independent of redesign_cohort.
function redesignHome(role) {
  return role === 'admin' || role === 'event_manager' ? '/admin-redesign' : '/scanner-redesign'
}

function SunIcon() {
  return (
    <svg width="17" height="17" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
      <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="17" height="17" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
    </svg>
  )
}

function money(amount, currency) {
  if (amount == null) return 'Custom'
  const major = amount / 100
  return currency === 'NGN' ? `₦${major.toLocaleString()}` : `$${major.toLocaleString()}`
}

const INCLUDED_IN_EVERY_PLAN = [
  'Guest communication', 'QR check-in', 'RSVP & invite management', 'Guest list management',
  'Reports dashboard', 'Team & task management', 'FestioHub', 'FestioPass',
  'Design Studio', 'SMS & WhatsApp sending', 'Festio branding removed',
]

const ADDON_ICON = {
  addon_registry: '✦', addon_menu: '◐', addon_planner: '▦',
  addon_logistics: '⇄', addon_festiome: '✷',
  addon_seating: '▦', addon_experience: '◎', addon_venue_access: '⚡',
  addon_speakers: '◈', addon_partners: '❖', addon_reminders: '◷',
}

function AddonCard({ addon, unlocked, eventId, promoActive }) {
  const buyHref = eventId ? `/admin-redesign?buy_addon=${encodeURIComponent(addon.key)}` : '/register?redesign=1'
  return (
    <article className={`pr-addon-card${addon.key === 'addon_venue_access' ? ' featured' : ''}`}>
      <div className="pr-addon-top">
        <div className="pr-addon-ic">{ADDON_ICON[addon.key] || '✦'}</div>
        {unlocked ? (
          promoActive ? (
            <span className="pr-addon-promo">Included</span>
          ) : (
            <div className="pr-addon-price"><b>{money(addon.amount, addon.currency)}</b><i>per event</i></div>
          )
        ) : (
          <span className="pr-addon-locked">&#128274; Starter+</span>
        )}
      </div>
      <h3>{addon.label}</h3>
      <p>{addon.description}</p>
      <ul className="pr-addon-includes">
        {(addon.capabilities || []).map((c) => <li key={c}>{c}</li>)}
      </ul>
      {unlocked ? (
        <Link className="pr-addon-btn primary" to={buyHref}>Add to event</Link>
      ) : (
        <button className="pr-addon-btn" disabled>Create a paid event to unlock</button>
      )}
    </article>
  )
}

// Same real comparison/FAQ copy as the legacy PricingPage. The plan cards and
// packs below come from the live api.getPricing() contract, not hardcoded.
const compareRows = [
  ['Events per free account', '1', 'Unlimited', 'Unlimited', 'Unlimited', 'Unlimited', 'Unlimited'],
  ['Guest limit', '25', '50', '150', '300', '500', 'Custom'],
  ['Email invitations', 'Yes', 'Yes', 'Yes', 'Yes', 'Yes', 'Yes'],
  ['SMS/WhatsApp', 'No', 'Yes', 'Yes', 'Yes', 'Yes', 'Custom'],
  ['QR check-in', 'Yes', 'Yes', 'Yes', 'Yes', 'Yes', 'Yes'],
  ['Design Studio', 'No', 'Standard templates', 'Expanded templates', 'Expanded templates', 'Expanded templates', 'Custom'],
  ['Seating/table groups', 'Preview', 'Basic', 'Advanced', 'Advanced', 'Advanced', 'Custom'],
  ['Access zones/gates', 'No', 'No', 'Yes', 'Yes', 'Yes', 'Custom'],
  ['Experience workflows', 'Preview', 'No', 'No', 'Yes', 'Yes', 'Custom'],
  ['Consent/scanner confirmations', 'No', 'No', 'No', 'Yes', 'Yes', 'Custom'],
  ['Support', 'Self-serve', 'Self-serve', 'Self-serve', 'Priority queue', 'Priority', 'Dedicated'],
]

const faqs = [
  ['Can I create before paying?', 'Yes. Create a draft event and use the free RSVP/email workflow for up to 25 guests, including QR check-in. Paid modules like Design Studio, seating, access, logistics, registry, and Experience activate after an Event Pass. Free accounts can create 1 event; additional events need an Event Pass on an existing one first.'],
  ['What counts as a message credit?', 'SMS/WhatsApp/MMS/RCS usage consumes credits. Email is included for normal RSVP and invitation flows.'],
  ['Do failed messages count?', 'Failed messages should not permanently consume credits. Full reserve/refund ledger behavior is planned as the next messaging phase.'],
  ['Can I buy more credits?', 'Yes. Paid events can buy top-ups from Event Setup.'],
  ['Can I use this for Nigerian events?', 'Yes. NGN pricing uses Paystack. Nigerian/local SMS routing is treated as a provider setup item before high-volume sending.'],
  ['Can I remove Festio branding?', 'Yes, on paid Event Passes.'],
]

function PlanCard({ name, price, detail, meta, description, features, limitations = [], cta, to, highlighted }) {
  const isExternal = to?.startsWith('mailto:')
  return (
    <article className={`pr-plan-card${highlighted ? ' featured' : ''}`}>
      <div className="pr-plan-name">{name}</div>
      <div className="pr-plan-price">{price}</div>
      <div className="pr-plan-detail">{detail}</div>
      <div className="pr-plan-meta">
        {meta.map((line) => <span key={line}>{line}</span>)}
      </div>
      {description && <p className="pr-plan-desc">{description}</p>}
      <ul className="pr-plan-features">
        {features.map((f) => <li key={f}>{f}</li>)}
        {limitations.map((f) => <li key={f} className="limitation">{f}</li>)}
      </ul>
      <div className="pr-plan-cta">
        {isExternal ? (
          <a className="pr-btn primary" style={{ width: '100%' }} href={to}>{cta}</a>
        ) : (
          <Link className="pr-btn primary" style={{ width: '100%' }} to={to}>{cta}</Link>
        )}
      </div>
    </article>
  )
}

export default function PricingRedesignPage() {
  const { dark, toggle } = useTheme()
  const { user } = useAuth()
  const appHome = user ? redesignHome(user.role) : null
  const [currency, setCurrency] = useState('USD')
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    api.getPricing(currency).then(setData).catch((e) => setErr(e.message))
  }, [currency])

  const tiers = data?.tiers || []
  const packs = data?.packs || []
  const addonPlans = data?.addon_plans || []
  const addonsUnlocked = !!data?.addon_plans_unlocked
  const free = data?.free
  const enterprise = data?.enterprise
  const promoUntil = data?.addon_promo_until ? new Date(data.addon_promo_until) : null
  const addonPromoActive = promoUntil && promoUntil > new Date()

  return (
    <div className="pricing-redesign">
      <nav className="pr-nav">
        <div className="pr-nav-inner">
          <Link className="pr-brand" to="/"><span className="pr-brand-mark">F</span>Festio</Link>
          <div className="pr-nav-links">
            <Link to="/#journey">Product</Link>
            <Link to="/#configurable">Design Studio</Link>
            <Link to="/#ops">Live Ops</Link>
            <Link to="/#community">Community</Link>
            <Link to="/pricing" className="active">Pricing</Link>
          </div>
          <div className="pr-nav-actions">
            <button type="button" className="pr-theme-btn" onClick={toggle} aria-label="Toggle theme">
              {dark ? <SunIcon /> : <MoonIcon />}
            </button>
            {user ? (
              <Link className="pr-btn primary" to={appHome}>Open app</Link>
            ) : (
              <>
                <Link className="pr-signin" to="/login">Sign in</Link>
                <Link className="pr-btn primary" to="/register?redesign=1">Create free event</Link>
              </>
            )}
          </div>
        </div>
      </nav>

      <div className="pr-shell">
        <div className="pr-head">
          <div className="pr-head-copy">
            <span className="pr-eyebrow"><i /> Pay once per event</span>
            <h1>Pricing for event operations</h1>
            <p>Start free for RSVP and email invites, then pay only when you activate premium tools like SMS/WhatsApp, QR check-in, Design Studio, seating, access control, logistics, registry, or Experience workflows.</p>
          </div>
          <div className="pr-currency">
            {['USD', 'NGN'].map((c) => (
              <button key={c} type="button" className={currency === c ? 'active' : ''} onClick={() => setCurrency(c)}>{c}</button>
            ))}
          </div>
        </div>

        {err && <div className="pr-error">{err}</div>}

        {addonPromoActive && (
          <div className="pr-promo-banner">
            <div>
              <span>Limited-time offer for paid events</span>
              <strong>All add-ons are included at no extra charge for six months.</strong>
              <p>Activate an Event Pass and use Seating, Venue Access, Orders, Logistics, Registry, Experience, Planner, and FestioMe through {promoUntil.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}.</p>
            </div>
            <Link className="pr-btn primary" to="/register?redesign=1">Create a paid event</Link>
          </div>
        )}

        {data && (
          <>
            <div className="pr-plan-grid">
              <PlanCard
                name="Free"
                price={money(0, currency)}
                detail="Create and preview"
                meta={[`Up to ${free?.guest_cap || 25} guests`, 'Email only · 75 emails/event']}
                features={free?.capabilities || []}
                limitations={free?.limitations || []}
                cta="Start free"
                to="/register?redesign=1"
              />
              {tiers.map((tier) => (
                <PlanCard
                  key={tier.key}
                  name={tier.name || tier.label}
                  price={money(tier.amount, tier.currency)}
                  detail="Per event"
                  meta={[`Up to ${tier.guest_cap?.toLocaleString()} guests`, `${tier.credits.toLocaleString()} message credits`]}
                  description={tier.description}
                  features={INCLUDED_IN_EVERY_PLAN}
                  cta="Create event"
                  to={`/register?redesign=1&plan=${encodeURIComponent(tier.key)}`}
                  highlighted={tier.key === 'tier300'}
                />
              ))}
              <PlanCard
                name={enterprise?.name || 'Enterprise'}
                price="Custom"
                detail="For 750+ guests"
                meta={['Custom guest volume', 'Custom message volume']}
                features={enterprise?.capabilities || []}
                cta="Contact sales"
                to="/#contact"
              />
            </div>

            <div className="pr-included">
              <div className="pr-included-head">
                <span className="pr-eyebrow"><i /> Included in every paid plan</span>
                <h2>Starter, Standard, Pro, and Scale all include this. No exceptions, no upsell.</h2>
              </div>
              <div className="pr-included-grid">
                {INCLUDED_IN_EVERY_PLAN.map((item) => (
                  <div className="pr-inc-item" key={item}><b>&#10003;</b>{item}</div>
                ))}
              </div>
            </div>

            <section className="pr-section">
              <div className="pr-section-head">
                <div>
                  <h2>Add-ons</h2>
                  <p>{addonPromoActive ? 'Every add-on is included with paid Event Passes during the six-month promotion. Free events cannot use add-ons.' : "Build the event you're actually running. Buy only the modules your paid event needs."}</p>
                </div>
              </div>
              <div className="pr-addon-grid">
                {addonPlans.map((addon) => (
                  <AddonCard key={addon.key} addon={addon} unlocked={addonsUnlocked} promoActive={addonPromoActive} />
                ))}
              </div>
              <p className="pr-addon-note">Advanced messaging (MMS and rich media) is not a separate add-on. It is available on paid tiers and uses message credits, just like SMS and WhatsApp.</p>
            </section>

            <section className="pr-section">
              <div className="pr-section-head">
                <div>
                  <h2>Message-credit top-ups</h2>
                  <p>Top-ups are available after an Event Pass is active.</p>
                </div>
                <span className="pr-section-head-note">Email is included for normal RSVP and invite flows.</span>
              </div>
              <div className="pr-pack-grid">
                {packs.map((p) => (
                  <div className="pr-pack-card" key={p.key}>
                    <div className="pr-pack-label">{p.label}</div>
                    <div className="pr-pack-price">{money(p.amount, p.currency)}</div>
                  </div>
                ))}
              </div>
            </section>

            <section className="pr-section">
              <div className="pr-compare-wrap">
                <table className="pr-compare">
                  <thead>
                    <tr>
                      {['Feature', 'Free', 'Starter', 'Standard', 'Pro', 'Scale', 'Enterprise'].map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {compareRows.map((row) => (
                      <tr key={row[0]}>
                        {row.map((cell, i) => <td key={`${row[0]}-${i}`}>{cell}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="pr-section">
              <div className="pr-faq-grid">
                {faqs.map(([q, a]) => (
                  <div className="pr-faq-card" key={q}>
                    <h3>{q}</h3>
                    <p>{a}</p>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}

        <div className="pr-bottom">
          <Link to="/refund-policy">Refund policy</Link>
          <Link to="/login">Sign in</Link>
          <span>Taxes calculated at checkout where applicable.</span>
        </div>
      </div>
    </div>
  )
}
