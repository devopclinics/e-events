import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import RedesignShell, { Icon } from './redesign/RedesignShell'
import { useAuth } from '../context/AuthContext'
import { CONTENT } from '../guideContent.mjs'
import './HelpRedesignPage.css'

// guideContent.mjs is flat per role (label/blurb/topics[]) — no category
// grouping like the mockup's GUIDES had. We wrap each role's topics in a
// single pseudo-category (labelled with the role's own label) so the
// existing TOC / category-header layout below needs no structural changes.
const ROLE_ICON = { organizer: 'calendar', staff: 'users', guest: 'ticket', operator: 'shield' }

function highlight(text, query) {
  if (!query.trim()) return text
  const idx = text.toLowerCase().indexOf(query.trim().toLowerCase())
  if (idx === -1) return text
  return (
    <>
      {text.slice(0, idx)}<mark>{text.slice(idx, idx + query.trim().length)}</mark>{text.slice(idx + query.trim().length)}
    </>
  )
}

function TopicAccordion({ topic, query }) {
  return (
    <details className="rd-path hp-topic">
      <summary>
        <span className="rd-path-icon"><Icon name="help" size={13} /></span>
        <span style={{ flex: 1 }}>
          <span className="rd-path-title">{highlight(topic.title, query)}</span>
          <div className="rd-path-sub">{topic.intro}</div>
        </span>
      </summary>
      <div className="rd-path-body">
        <div className="rd-path-body-inner">
          {topic.steps && (
            <ol className="hp-steps">
              {topic.steps.map((s, i) => <li key={i}>{highlight(s, query)}</li>)}
            </ol>
          )}
          {topic.tip && <div className="hp-callout tip"><Icon name="info" size={12} /> {topic.tip}</div>}
          {topic.warn && <div className="hp-callout warn"><Icon name="info" size={12} /> {topic.warn}</div>}
          {topic.image && (
            <button className="hp-image-btn" onClick={() => window.open(topic.image, '_blank')}>
              <Icon name="image" size={14} /> View screenshot
            </button>
          )}
        </div>
      </div>
    </details>
  )
}

export default function HelpRedesignPage() {
  const { user } = useAuth()
  const [searchParams] = useSearchParams()
  const isSuper = !!user?.is_platform_superadmin
  const isAdmin = user?.role === 'admin'

  // Mirrors HelpPage.jsx's role derivation exactly: organizer only for
  // admin/superadmin, operator only for superadmin, everyone gets staff+guest.
  const roleKeys = useMemo(() => {
    const r = []
    if (isAdmin || isSuper) r.push('organizer')
    r.push('staff', 'guest')
    if (isSuper) r.push('operator')
    return r
  }, [isAdmin, isSuper])

  const ROLES = useMemo(
    () => roleKeys.map((key) => ({ key, label: CONTENT[key]?.label || key, blurb: CONTENT[key]?.blurb || '' })),
    [roleKeys]
  )

  const [role, setRole] = useState(() => {
    const requested = searchParams.get('role')
    return roleKeys.includes(requested) ? requested : roleKeys[0] || 'guest'
  })
  // Keep role in sync once user data loads (fixes race where role initialises
  // before isAdmin/isSuper are known) — same fix as HelpPage.jsx.
  useEffect(() => {
    if (!roleKeys.includes(role)) setRole(roleKeys[0] || 'guest')
  }, [roleKeys]) // eslint-disable-line react-hooks/exhaustive-deps

  const [query, setQuery] = useState('')
  const [toast, setToast] = useState('')

  function notify(msg) {
    setToast(msg)
    window.setTimeout(() => setToast(''), 2600)
  }

  const data = CONTENT[role] || CONTENT.guest
  const categories = useMemo(() => {
    if (!data?.topics?.length) return []
    return [{
      cat: data.label,
      icon: ROLE_ICON[role] || 'help',
      topics: data.topics.map((t) => ({
        id: t.id,
        title: t.title,
        intro: t.intro,
        steps: t.steps || [],
        tip: t.tip,
        warn: t.warn,
        image: t.img || (t.imgs && t.imgs[0]) || null,
      })),
    }]
  }, [data, role])

  const filtered = categories
    .map((c) => ({ ...c, topics: c.topics.filter((t) => !query.trim() || t.title.toLowerCase().includes(query.trim().toLowerCase())) }))
    .filter((c) => c.topics.length > 0)

  return (
    <RedesignShell topActive="help" withEventSidebar={false}>
      <div className="rr-pagehead">
        <div>
          <div className="rr-title-row"><h1>Help</h1></div>
          <div className="rr-meta">Guides for getting the most out of Festio</div>
        </div>
      </div>

      <div className="hp-role-row">
        {ROLES.map((r) => (
          <button key={r.key} className={`hp-role-pill ${role === r.key ? 'active' : ''}`} onClick={() => setRole(r.key)}>{r.label}</button>
        ))}
      </div>
      <p className="hp-role-blurb">{ROLES.find((r) => r.key === role)?.blurb}</p>

      <div className="rd-search hp-search">
        <Icon name="search" size={15} />
        <input placeholder="Search help articles…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {role === 'organizer' && (
        <div className="rr-panel hp-tour-card">
          <div>
            <strong>Getting Started — Interactive Tour</strong>
            <p>A guided walkthrough of setting up your first event, step by step.</p>
          </div>
          <button className="rr-btn primary" onClick={() => notify('Interactive tour opened in a new tab')}>Start tour <Icon name="arrow" size={13} /></button>
        </div>
      )}

      <div className="hp-layout">
        <aside className="hp-toc">
          <div className="hp-toc-head">On this page</div>
          {categories.map((c) => (
            <a key={c.cat} href={`#${c.cat}`} onClick={(e) => { e.preventDefault(); notify(`Jumped to ${c.cat}`) }}>
              <Icon name={c.icon} size={13} /> {c.cat}
            </a>
          ))}
        </aside>

        <div className="hp-content">
          {filtered.map((c) => (
            <div className="hp-category" key={c.cat} id={c.cat}>
              <div className="hp-category-head"><Icon name={c.icon} size={15} /> {c.cat}</div>
              {c.topics.map((t) => <TopicAccordion key={t.title} topic={t} query={query} />)}
            </div>
          ))}
          {filtered.length === 0 && <p className="rd-rowlink">No articles match "{query}" for {ROLES.find((r) => r.key === role)?.label}.</p>}
        </div>
      </div>

      <div className="hp-footer">
        <a href="/pricing" onClick={(e) => { e.preventDefault(); notify('Pricing page opened') }}>See pricing</a>
        <span className="rr-dot">·</span>
        <a href="#" onClick={(e) => { e.preventDefault(); notify('Support contact opened') }}>Contact support</a>
      </div>

      {toast && <div className="rd-toast"><Icon name="check" />{toast}</div>}
    </RedesignShell>
  )
}
