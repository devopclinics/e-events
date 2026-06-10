import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

import { CONTENT } from '../guideContent.mjs'

// ── UI ───────────────────────────────────────────────────────────────────────

function Topic({ t, open, onToggle, query }) {
  const hl = (s) => {
    if (!query) return s
    const i = s.toLowerCase().indexOf(query.toLowerCase())
    if (i < 0) return s
    return <>{s.slice(0, i)}<mark className="bg-yellow-200 dark:bg-yellow-500/40 rounded px-0.5">{s.slice(i, i + query.length)}</mark>{s.slice(i + query.length)}</>
  }
  return (
    <div id={t.id} className="scroll-mt-24 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
      <button onClick={onToggle}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
        <span className="text-xl leading-none">{t.icon}</span>
        <span className="font-semibold text-slate-900 dark:text-white flex-1">{hl(t.title)}</span>
        <svg className={`w-5 h-5 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="px-5 pb-5 pt-1 space-y-4">
          <ol className="space-y-3">
            {t.steps.map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className="shrink-0 w-6 h-6 rounded-full bg-teal-600 text-white text-xs font-bold flex items-center justify-center">{i + 1}</span>
                <span className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed pt-0.5">{hl(s)}</span>
              </li>
            ))}
          </ol>
          {(t.imgs || (t.img ? [t.img] : [])).map((src) => (
            <a key={src} href={src} target="_blank" rel="noopener noreferrer" className="block">
              <img src={src} alt={t.title} loading="lazy"
                className="rounded-xl border border-slate-200 dark:border-slate-700 w-full hover:opacity-95 transition-opacity" />
            </a>
          ))}
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
    // Public /guide: show the organizer/staff/guest guides to anyone (no
    // operator section, no account required).
    if (publicMode) return ['organizer', 'staff', 'guest']
    const r = []
    if (isAdmin || isSuper) r.push('organizer')
    r.push('staff', 'guest')
    if (isSuper) r.push('operator')
    return r
  }, [isAdmin, isSuper, publicMode])

  const [role, setRole] = useState(roles[0] || 'guest')
  const [query, setQuery] = useState('')
  const data = CONTENT[role]

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

      {/* Getting-started video — shown on the organizer guide */}
      {role === 'organizer' && (
        <div className="mb-6 rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-black">
          <video
            src="/media/getting-started.webm"
            controls
            preload="metadata"
            poster="/media/admin-overview.png"
            className="w-full block aspect-video"
          />
        </div>
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
