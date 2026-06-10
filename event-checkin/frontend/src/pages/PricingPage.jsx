import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'

function money(amount, currency) {
  const major = amount / 100
  return currency === 'NGN' ? `₦${major.toLocaleString()}` : `$${major.toLocaleString()}`
}

export default function PricingPage() {
  const [currency, setCurrency] = useState('USD')
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    api.getPricing(currency).then(setData).catch((e) => setErr(e.message))
  }, [currency])

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 to-cyan-100 dark:from-slate-900 dark:to-slate-800">
      <div className="max-w-5xl mx-auto px-4 py-12">
        <div className="text-center space-y-3">
          <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white">Simple, per-event pricing</h1>
          <p className="text-slate-600 dark:text-slate-300">
            Pay once per event — no subscription. Free events are email-only, capped at 25 guests.
            An Event Pass unlocks SMS/WhatsApp, more guests, and removes branding.
          </p>
          <div className="inline-flex rounded-lg border border-slate-300 dark:border-slate-600 overflow-hidden text-sm">
            {['USD', 'NGN'].map((c) => (
              <button key={c} onClick={() => setCurrency(c)}
                className={`px-4 py-1.5 font-semibold ${currency === c ? 'bg-teal-600 text-white' : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>
                {c}
              </button>
            ))}
          </div>
        </div>

        {err && <div className="mt-6 text-center text-sm text-red-600">{err}</div>}

        {data && (
          <>
            {/* Free plan */}
            <div className="mt-10 bg-white dark:bg-slate-800 rounded-2xl shadow p-6 border-2 border-teal-200 dark:border-teal-800 flex flex-col sm:flex-row sm:items-center gap-6">
              <div className="sm:w-1/4">
                <div className="font-semibold text-slate-900 dark:text-white">Free</div>
                <div className="text-3xl font-extrabold text-slate-900 dark:text-white">{currency === 'NGN' ? '₦0' : '$0'}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">per event, forever</div>
                <Link to="/register" className="mt-3 inline-block bg-teal-600 hover:bg-teal-700 text-white text-center px-4 py-2 rounded-lg text-sm font-semibold">
                  Get started free
                </Link>
              </div>
              <ul className="flex-1 grid sm:grid-cols-2 gap-y-1.5 gap-x-6 text-sm text-slate-600 dark:text-slate-400">
                <li>✓ Up to 25 guests</li>
                <li>✓ Email invitations</li>
                <li>✓ Self-serve RSVP page</li>
                <li>✓ Confirm / decline + custom questions</li>
                <li className="text-slate-400 dark:text-slate-500">— No SMS / WhatsApp</li>
                <li className="text-slate-400 dark:text-slate-500">— No QR check-in or paid add-ons (seating, menu, access zones, logistics, registry)</li>
                <li className="text-slate-400 dark:text-slate-500">— Shows EventQR branding</li>
              </ul>
            </div>

            <h2 className="text-xl font-bold text-slate-900 dark:text-white mt-12 mb-3">Event Passes — pay per event</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {data.tiers.map((t) => (
                <div key={t.key} className="bg-white dark:bg-slate-800 rounded-2xl shadow p-6 flex flex-col gap-3 border dark:border-slate-700">
                  <div className="font-semibold text-slate-900 dark:text-white">{t.label}</div>
                  <div className="text-3xl font-extrabold text-teal-700 dark:text-teal-300">{money(t.amount, t.currency)}</div>
                  <ul className="text-sm text-slate-600 dark:text-slate-400 space-y-1">
                    <li>✓ {t.guest_cap ? `Up to ${t.guest_cap} guests` : 'Unlimited guests'}</li>
                    <li>✓ SMS / WhatsApp + email invites</li>
                    <li>✓ {t.credits} message credits</li>
                    <li>✓ QR check-in, seating &amp; menu</li>
                    <li>✓ Access zones, logistics &amp; registry</li>
                    <li>✓ No EventQR branding</li>
                  </ul>
                  <Link to="/register" className="mt-auto bg-teal-600 hover:bg-teal-700 text-white text-center px-3 py-2 rounded-lg text-sm font-semibold">
                    Get started
                  </Link>
                </div>
              ))}
            </div>

            <div className="mt-12">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-3">Message-credit top-ups</h2>
              <div className="grid sm:grid-cols-3 gap-4">
                {data.packs.map((p) => (
                  <div key={p.key} className="bg-white dark:bg-slate-800 rounded-xl shadow p-5 border dark:border-slate-700">
                    <div className="font-semibold text-slate-900 dark:text-white">{p.label}</div>
                    <div className="text-2xl font-bold text-teal-700 dark:text-teal-300 mt-1">{money(p.amount, p.currency)}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        <div className="mt-12 text-center text-xs text-slate-500 dark:text-slate-400 space-x-4">
          <Link to="/refund-policy" className="hover:underline">Refund policy</Link>
          <span>·</span>
          <Link to="/login" className="hover:underline">Sign in</Link>
          <span>·</span>
          <span>Taxes calculated at checkout where applicable.</span>
        </div>
      </div>
    </div>
  )
}
