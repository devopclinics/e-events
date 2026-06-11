import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

import { CONTENT } from '../guideContent.mjs'

// ── UI ───────────────────────────────────────────────────────────────────────

function Topic({ t, open, onToggle, query }) {
  // Highlight a plain string — returns string when no query, JSX fragment otherwise.
  const hl = (s) => {
    if (!query || typeof s !== 'string') return s
    const lower = s.toLowerCase()
    const q = query.toLowerCase()
    const i = lower.indexOf(q)
    if (i < 0) return s
    return (
      <>
        {s.slice(0, i)}
        <mark className="bg-yellow-200 dark:bg-yellow-500/40 rounded px-0.5">{s.slice(i, i + q.length)}</mark>
        {s.slice(i + q.length)}
      </>
    )
  }

  const images = t.imgs || (t.img ? [t.img] : [])
  const tipBadge = t.tip ? (
    <div className="rounded-xl bg-teal-50 dark:bg-teal-900/30 border border-teal-200 dark:border-teal-700 px-4 py-3 text-sm text-teal-800 dark:text-teal-200">
      💡 {t.tip}
    </div>
  ) : null
  const warnBadge = t.warn ? (
    <div className="rounded-xl bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
      ⚠️ {t.warn}
    </div>
  ) : null

  return (
    <div id={t.id} className="scroll-mt-24 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
      <button onClick={onToggle}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
        <span className="text-xl leading-none">{t.icon}</span>
        <div className="flex-1 min-w-0">
          <span className="font-semibold text-slate-900 dark:text-white">{hl(t.title)}</span>
          {t.badge && <span className="ml-2 text-xs font-semibold px-2 py-0.5 rounded-full bg-teal-100 dark:bg-teal-900 text-teal-700 dark:text-teal-300">{t.badge}</span>}
        </div>
        <svg className={`w-5 h-5 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="px-5 pb-5 pt-1 space-y-4">
          {t.intro && <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{t.intro}</p>}
          {tipBadge}
          {warnBadge}
          <ol className="space-y-3">
            {t.steps.map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full bg-teal-600 text-white text-xs font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                <span className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{hl(s)}</span>
              </li>
            ))}
          </ol>
          {images.length > 0 && (
            <div className={`grid gap-3 ${images.length > 1 ? 'sm:grid-cols-2' : ''}`}>
              {images.map((src) => (
                <a key={src} href={src} target="_blank" rel="noopener noreferrer" className="block">
                  <img src={src} alt={t.title} loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }}
                    className="rounded-xl border border-slate-200 dark:border-slate-700 w-full hover:opacity-95 transition-opacity" />
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function HelpPage({ publicMode = false }) {
  const { user } = useAuth()
  const isSuper = !!user?.is_platform_superadmin
  const isAdmin = user?.role === 'admin'

  const roles = useMemo(() => {
    if (publicMode) return ['organizer', 'staff', 'guest']
    const r = []
    if (isAdmin || isSuper) r.push('organizer')
    r.push('staff', 'guest')
    if (isSuper) r.push('operator')
    return r
  }, [isAdmin, isSuper, publicMode])

  // Keep role in sync when user data loads (fixes race where role initialises
  // as 'staff' because user is null on first render, then isAdmin becomes true)
  const [role, setRole] = useState(roles[0] || 'guest')
  useEffect(() => {
    if (!roles.includes(role)) setRole(roles[0] || 'guest')
  }, [roles]) // eslint-disable-line react-hooks/exhaustive-deps

  const [query, setQuery] = useState('')
  const data = CONTENT[role] || CONTENT['guest']

  const topics = useMemo(() => {
    if (!query.trim()) return data.topics
    const q = query.toLowerCase()
    return data.topics.filter((t) =>
      t.title.toLowerCase().includes(q) || t.steps.some((s) => s.toLowerCase().includes(q)))
  }, [data, query])

  // open topics: all open when searching, else first open
  const [openSet, setOpenSet] = useState(() => new Set([data.topics[0]?.id]))
  const isOpen = (id) => (query.trim() ? true : openSet.has(id))
  const toggle = (id) => setOpenSet((prev) => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  function pickRole(r) {
    setRole(r); setQuery('')
    setOpenSet(new Set([CONTENT[r].topics[0]?.id]))
  }
  function jump(id) {
    setOpenSet((prev) => new Set(prev).add(id))
    setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30)
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Public header — /guide has no app Nav around it */}
      {publicMode && (
        <div className="flex items-center justify-between mb-6">
          <Link to="/" className="flex items-center gap-2 font-bold text-lg text-slate-900 dark:text-white tracking-tight">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-teal-600 text-white text-sm">EQ</span>
            EventQR
          </Link>
          <div className="flex items-center gap-1 text-sm">
            <a href="/media/guide.pdf" className="px-3 py-2 rounded-md text-slate-600 dark:text-slate-300 hover:text-teal-700 dark:hover:text-teal-300">⬇ PDF</a>
            <Link to="/pricing" className="px-3 py-2 rounded-md text-slate-600 dark:text-slate-300 hover:text-teal-700 dark:hover:text-teal-300">Pricing</Link>
            <Link to="/login" className="px-3 py-2 rounded-md text-slate-600 dark:text-slate-300 hover:text-teal-700 dark:hover:text-teal-300">Sign in</Link>
            <Link to="/register" className="px-4 py-2 rounded-lg bg-teal-600 text-white font-semibold hover:bg-teal-700">Get started</Link>
          </div>
        </div>
      )}
      {/* Hero */}
      <div className="rounded-2xl bg-gradient-to-br from-teal-600 to-cyan-700 text-white p-7 sm:p-9 mb-6">
        <h1 className="text-2xl sm:text-3xl font-extrabold">Help &amp; How-To</h1>
        <p className="mt-2 text-white/85 text-sm sm:text-base max-w-2xl">
          Step-by-step instructions for everything in EventQR. Pick your role, or search.
        </p>
        {/* Role switcher */}
        <div className="mt-5 flex flex-wrap gap-2">
          {roles.map((r) => (
            <button key={r} onClick={() => pickRole(r)}
              className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors ${
                role === r ? 'bg-white text-teal-700' : 'bg-white/15 text-white hover:bg-white/25'}`}>
              {CONTENT[r].label}
            </button>
          ))}
        </div>
      </div>

      {/* Getting-started interactive tour — shown on the organizer guide */}
      {role === 'organizer' && (
        <a
          href="/media/getting-started.html"
          target="_blank"
          rel="noopener noreferrer"
          className="mb-6 flex items-center gap-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-900 hover:bg-slate-800 transition-colors overflow-hidden cursor-pointer group"
        >
          <div className="flex-shrink-0 w-32 sm:w-44 h-24 bg-gradient-to-br from-teal-600 to-cyan-700 flex items-center justify-center">
            <svg className="w-12 h-12 text-white/90 group-hover:scale-110 transition-transform" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z"/>
            </svg>
          </div>
          <div className="py-4 pr-4">
            <div className="font-bold text-white text-sm sm:text-base">▶ Getting Started — Interactive Tour</div>
            <div className="text-slate-400 text-xs sm:text-sm mt-1">7-step walkthrough with audio narration · ~1 min · opens in new tab</div>
          </div>
        </a>
      )}

      {/* Search */}
      <div className="relative mb-6">
        <svg className="w-5 h-5 absolute left-3 top-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
        </svg>
        <input value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search the ${data.label.toLowerCase()} guide…`}
          className="w-full pl-10 pr-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
      </div>

      <div className="grid lg:grid-cols-[210px_1fr] gap-6">
        {/* Sticky TOC */}
        <aside className="hidden lg:block">
          <div className="sticky top-24 space-y-1">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">{data.label}</div>
            {data.topics.map((t) => (
              <button key={t.id} onClick={() => jump(t.id)}
                className="block w-full text-left text-sm text-slate-600 dark:text-slate-400 hover:text-teal-700 dark:hover:text-teal-300 py-1">
                <span className="mr-2">{t.icon}</span>{t.title}
              </button>
            ))}
          </div>
        </aside>

        {/* Topics */}
        <div className="space-y-3">
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-1">{data.blurb}</p>
          {topics.length === 0 && <p className="text-sm text-slate-400">No matches for “{query}”.</p>}
          {topics.map((t) => (
            <Topic key={t.id} t={t} open={isOpen(t.id)} onToggle={() => toggle(t.id)} query={query} />
          ))}
          {role !== 'guest' && (
            <p className="text-xs text-slate-400 dark:text-slate-500 pt-2">
              Need more? <Link to="/pricing" className="text-teal-600 hover:underline">See pricing</Link> ·
              {' '}<a href="mailto:info@devopclinics.com" className="text-teal-600 hover:underline">Contact support</a>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
