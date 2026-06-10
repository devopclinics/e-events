import { Link } from 'react-router-dom'
import { useTheme } from '../context/ThemeContext'

function SunIcon() {
  return (
    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
      <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
    </svg>
  )
}

const features = [
  {
    icon: (
      <svg className="w-7 h-7 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      </svg>
    ),
    title: 'Smart Guest Lists',
    desc: 'Bring your guest list in seconds — we keep it clean and ready to go.',
  },
  {
    icon: (
      <svg className="w-7 h-7 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.24M16.24 12H19M12 12H9.76M7.76 12H5m7 0v3m0-3V9" />
      </svg>
    ),
    title: 'Instant QR Codes',
    desc: 'Every guest gets a personal ticket, right on their phone.',
  },
  {
    icon: (
      <svg className="w-7 h-7 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 10h.01M12 10h.01M16 10h.01M21 12a9 9 0 01-13.5 7.8L3 21l1.2-4.5A9 9 0 1121 12z" />
      </svg>
    ),
    title: 'WhatsApp, SMS & Email',
    desc: 'Reach every guest on the channel they actually use.',
  },
  {
    icon: (
      <svg className="w-7 h-7 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
      </svg>
    ),
    title: 'Self-Serve RSVP',
    desc: 'A beautiful invite page where guests RSVP themselves.',
  },
  {
    icon: (
      <svg className="w-7 h-7 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 10h18M3 10l1.5-5.5A1 1 0 015.46 4h13.08a1 1 0 01.96.5L21 10M5 10v9a1 1 0 001 1h12a1 1 0 001-1v-9M9 14h6" />
      </svg>
    ),
    title: 'Seating & Menu',
    desc: 'Plan tables, seats, and meals — all in one place.',
  },
  {
    icon: (
      <svg className="w-7 h-7 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
      </svg>
    ),
    title: 'Venue Access & Zones',
    desc: 'Control who gets in where, with real-time insight into your venue.',
  },
  {
    icon: (
      <svg className="w-7 h-7 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
      </svg>
    ),
    title: 'Merch & Gift Logistics',
    desc: 'Get merchandise and gifts to your guests, start to finish.',
  },
  {
    icon: (
      <svg className="w-7 h-7 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
      </svg>
    ),
    title: 'Gift Registry',
    desc: 'A shared registry of gifts and cash funds — no duplicates.',
  },
  {
    icon: (
      <svg className="w-7 h-7 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
    title: 'Live Dashboard',
    desc: 'Watch your event come to life in real time.',
  },
  {
    icon: (
      <svg className="w-7 h-7 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
    ),
    title: 'Mobile Scanner',
    desc: 'Check guests in from any phone — no app to install.',
  },
  {
    icon: (
      <svg className="w-7 h-7 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
    title: 'Team Access',
    desc: 'Add your team and control what each person can do.',
  },
]

const steps = [
  { n: '1', title: 'Create an event', desc: 'Set the event name, date, and your base URL.' },
  { n: '2', title: 'Upload your guest list', desc: 'CSV, Excel, or Google Sheets — we handle the import.' },
  { n: '3', title: 'Generate & send QR codes', desc: 'One click generates all QR codes and emails invites.' },
  { n: '4', title: 'Scan on the day', desc: 'Officials scan QR codes at the door. Admission is instant.' },
]

export default function LandingPage() {
  const { dark, toggle } = useTheme()

  return (
    <div className="app-shell min-h-screen text-slate-900 dark:text-white">

      {/* Nav */}
      <header className="app-nav sticky top-0 z-50 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-4">
          <div className="flex items-center gap-2 mr-auto">
            <div className="w-8 h-8 bg-teal-600 rounded-md flex items-center justify-center text-white text-sm font-bold">
              EQ
            </div>
            <span className="font-bold text-lg tracking-tight text-slate-950 dark:text-white">EventQR</span>
          </div>

          <button onClick={toggle}
            className="p-2 rounded-lg text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="Toggle theme">
            {dark ? <SunIcon /> : <MoonIcon />}
          </button>
          <Link to="/pricing"
            className="text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-teal-700 dark:hover:text-teal-300 transition-colors">
            Pricing
          </Link>
          <Link to="/login"
            className="text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-teal-700 dark:hover:text-teal-300 transition-colors">
            Sign In
          </Link>
          <Link to="/register"
            className="text-sm font-semibold bg-teal-600 text-white px-4 py-2 rounded-md hover:bg-teal-700 transition-colors">
            Get Started
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-slate-200/70 dark:border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-14 sm:py-20 lg:py-24">
          <div className="grid lg:grid-cols-[0.9fr_1.1fr] gap-10 lg:gap-14 items-center">
            <div>
              <div className="inline-flex items-center gap-2 bg-white dark:bg-slate-900 text-teal-800 dark:text-teal-200 text-xs font-semibold px-3 py-1.5 rounded-full border border-teal-200/80 dark:border-teal-800/80 mb-6 shadow-sm">
                <span className="w-1.5 h-1.5 bg-teal-500 rounded-full animate-pulse" />
                Live guest operations
              </div>

              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-slate-950 dark:text-white leading-tight">
                EventQR
              </h1>

              <p className="mt-5 text-lg sm:text-xl text-slate-600 dark:text-slate-300 max-w-xl leading-relaxed">
                Invitations, RSVPs, and check-in in one place — WhatsApp/SMS/email invites,
                self-serve RSVP, seating &amp; menu, zones &amp; access control, and QR check-in on the day.
                <span className="block mt-2 text-base text-slate-500 dark:text-slate-400">Free to start · pay per event, no subscription.</span>
              </p>

              <div className="mt-8 flex flex-col sm:flex-row gap-3">
                <Link to="/register"
                  className="inline-flex items-center justify-center gap-2 bg-teal-600 text-white px-6 py-3 rounded-md font-semibold text-sm hover:bg-teal-700 transition-colors shadow-lg shadow-teal-900/10">
                  Create event workspace
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </Link>
                <Link to="/login"
                  className="inline-flex items-center justify-center gap-2 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 px-6 py-3 rounded-md font-semibold text-sm hover:bg-white dark:hover:bg-slate-900 transition-colors">
                  Sign in
                </Link>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden">
              <div className="border-b border-slate-200 dark:border-slate-800 px-4 py-3 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-950 dark:text-white">Tonight's Gala</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Main entrance · Live check-in</div>
                </div>
                <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 dark:bg-emerald-950/50 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  Active
                </span>
              </div>
              <div className="grid sm:grid-cols-3 gap-0 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800">
                {[
                  ['Guest list', '426', 'Ready to scan'],
                  ['Admitted', '318', '74% complete'],
                  ['Pending', '108', 'Live queue'],
                ].map(([label, value, sub]) => (
                  <div key={label} className="p-5">
                    <div className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">{label}</div>
                    <div className="mt-2 text-3xl font-bold text-slate-950 dark:text-white">{value}</div>
                    <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{sub}</div>
                  </div>
                ))}
              </div>
              <div className="grid md:grid-cols-[1fr_0.8fr] gap-0 border-t border-slate-200 dark:border-slate-800">
                <div className="p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-semibold text-slate-950 dark:text-white">Recent admissions</h2>
                    <span className="text-xs text-teal-700 dark:text-teal-300 font-semibold">Live</span>
                  </div>
                  <div className="space-y-2">
                    {['Maya Chen', 'Jordan Lee', 'Avery Patel', 'Sam Rivera'].map((name, i) => (
                      <div key={name} className="flex items-center justify-between rounded-md bg-slate-50 dark:bg-slate-800/70 px-3 py-2">
                        <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{name}</span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">{i + 7}:4{i}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="p-5 bg-slate-50 dark:bg-slate-950/50 border-t md:border-t-0 md:border-l border-slate-200 dark:border-slate-800">
                  <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 text-center">
                    <div className="mx-auto grid h-28 w-28 grid-cols-4 gap-1 rounded-md bg-slate-950 p-2">
                      {Array.from({ length: 16 }).map((_, i) => (
                        <span key={i} className={`rounded-sm ${[0, 3, 5, 6, 9, 10, 12, 15].includes(i) ? 'bg-white' : 'bg-teal-400'}`} />
                      ))}
                    </div>
                    <div className="mt-3 text-sm font-semibold text-slate-950 dark:text-white">Mobile scanner ready</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">Browser-based QR admission</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-12 grid grid-cols-3 gap-4 max-w-xl">
            {[['Invites & RSVP', 'WhatsApp · SMS · Email'], ['QR Check-In', 'Zones & access control'], ['Seating, Menu & Registry', 'Built-in']].map(([label, sub]) => (
              <div key={label}>
                <div className="text-sm font-bold text-slate-950 dark:text-white">{label}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 border-t border-gray-100 dark:border-slate-800">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white">Everything you need for event day</h2>
            <p className="mt-3 text-gray-500 dark:text-slate-400 text-lg max-w-xl mx-auto">
              From guest import to real-time admission — one platform, zero hassle.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map(({ icon, title, desc }) => (
              <div key={title}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-6 hover:shadow-md transition-shadow">
                <div className="w-12 h-12 bg-teal-50 dark:bg-teal-950/50 rounded-lg flex items-center justify-center mb-4">
                  {icon}
                </div>
                <h3 className="font-semibold text-gray-900 dark:text-white mb-2">{title}</h3>
                <p className="text-gray-500 dark:text-slate-400 text-sm leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-20 bg-gray-50 dark:bg-slate-800/50 border-t border-gray-100 dark:border-slate-800">
        <div className="max-w-5xl mx-auto px-4">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white">Up and running in minutes</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {steps.map(({ n, title, desc }) => (
              <div key={n} className="relative text-center">
                <div className="w-10 h-10 bg-indigo-600 text-white rounded-full flex items-center justify-center font-bold text-lg mx-auto mb-4">
                  {n}
                </div>
                <h3 className="font-semibold text-gray-900 dark:text-white mb-2">{title}</h3>
                <p className="text-sm text-gray-500 dark:text-slate-400 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 border-t border-gray-100 dark:border-slate-800">
        <div className="max-w-2xl mx-auto px-4 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white mb-4">
            Ready for your next event?
          </h2>
          <p className="text-gray-500 dark:text-slate-400 mb-8 text-lg">
            Create your account and set up your first event in under five minutes.
            Free to start — upgrade with a one-time Event Pass when you're ready.
          </p>
          <Link to="/register"
            className="inline-flex items-center gap-2 bg-indigo-600 text-white px-10 py-4 rounded-xl font-semibold text-lg hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-500/25">
            Get Started Free
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </Link>
          <p className="mt-4 text-sm text-gray-400 dark:text-slate-500">
            No credit card required · <Link to="/pricing" className="text-teal-600 hover:underline">See pricing</Link>
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 dark:border-slate-800 py-8">
        <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-indigo-600 rounded flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.24M16.24 12H19M12 12H9.76M7.76 12H5m7 0v3m0-3V9" />
              </svg>
            </div>
            <span className="font-semibold text-gray-900 dark:text-white">EventQR</span>
          </div>
          <p className="text-xs text-gray-400 dark:text-slate-500">
            © {new Date().getFullYear()} EventQR. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  )
}
