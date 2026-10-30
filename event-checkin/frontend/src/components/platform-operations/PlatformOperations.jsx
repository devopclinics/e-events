import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { api } from '../../api'
import { OPERATIONS_SECTIONS, operationsSection } from './sections.mjs'
import './PlatformOperations.css'

export default function PlatformOperations({ active, children }) {
  const [params] = useSearchParams()
  const location = useLocation()
  const heading = useRef(null)
  const previous = useRef(active)
  const section = operationsSection(active)
  const groups = [...new Set(OPERATIONS_SECTIONS.map(item => item.group))]
  function href(id) {
    const next = new URLSearchParams(params)
    next.set('tab', 'console')
    next.set('section', id)
    return `${location.pathname}?${next}`
  }
  useEffect(() => {
    if (previous.current !== active) {
      heading.current?.focus({ preventScroll: true })
      heading.current?.scrollIntoView({ block: 'start' })
      previous.current = active
    }
  }, [active])
  return <div className="po-workspace">
    <header className="po-hero">
      <div><span className="po-eyebrow">FESTIO / PLATFORM OPERATIONS</span><h1>A clear view.<br /><em>A connected platform.</em></h1><p>Accounts, access, billing and support, together in one workspace.</p></div>
      <div className="po-staff"><span>Platform staff only</span><p>Changes here can affect organizations across Festio.</p></div>
    </header>
    <div className="po-layout">
      <nav className="po-nav" aria-label="Platform operations">
        {groups.map(group => <div className="po-nav-group" key={group}><h2>{group}</h2>{OPERATIONS_SECTIONS.filter(item => item.group === group).map(item => <Link key={item.id} to={href(item.id)} aria-current={active === item.id ? 'page' : undefined}><span>{item.label}</span>{active === item.id && <span aria-hidden="true">↗</span>}</Link>)}</div>)}
        <div className="po-nav-group po-resources"><h2>Connected tools</h2><Link to="/marketing">Marketing <span aria-hidden="true">↗</span></Link><Link to="/media-redesign">Media Library <span aria-hidden="true">↗</span></Link></div>
      </nav>
      <div className="po-main">
        <div className="po-section-head"><span className="po-eyebrow">{section.group}</span><h2 ref={heading} tabIndex={-1}>{section.label}</h2><p>{section.description}</p></div>
        {active === 'dashboard' ? <OperationsOverview href={href} /> : <div className="po-content">{children}</div>}
      </div>
    </div>
  </div>
}

function OperationsOverview({ href }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [updated, setUpdated] = useState(null)
  const generation = useRef(0)
  async function load() {
    const current = ++generation.current
    setLoading(true); setError('')
    try {
      const data = await api.adminAccountsSummary()
      if (current === generation.current) { setRows(data); setUpdated(new Date()) }
    } catch (e) { if (current === generation.current) setError(e.message || 'Could not load the account overview.') }
    finally { if (current === generation.current) setLoading(false) }
  }
  useEffect(() => { load(); return () => { ++generation.current } }, [])
  const sum = key => rows?.reduce((total, row) => total + (Number(row[key]) || 0), 0)
  const suspended = rows?.filter(row => row.is_active === false)
  const stats = [['Organizations', rows?.length], ['Events', sum('event_count')], ['Message credits used', sum('message_credits_spent')], ['Suspended accounts', suspended?.length]]
  const tasks = [
    ['accounts', '01', 'Find an organization', 'Review accounts, members and access.'],
    ['overview', '02', 'Manage event access', 'Apply event grants and message credits.'],
    ['org-plans', '03', 'Review billing & plans', 'Manage organization plans and pricing.'],
    ['support', '04', 'Configure support', 'Manage organizer support chat settings.'],
    ['usage', '05', 'Understand usage', 'Review messaging activity by organization.'],
  ]
  const recent = rows ? [...rows].sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0)).slice(0, 5) : []
  return <div className="po-overview">
    <div className="po-snapshot"><p role="status">{loading ? 'Refreshing account snapshot…' : updated ? `Account snapshot · Updated ${updated.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Account snapshot unavailable'}</p><button disabled={loading} onClick={load}>{loading ? 'Refreshing…' : 'Refresh overview'}</button></div>
    {error && <div role="alert" className="po-error"><p>{error}{rows && ' Showing the previous account snapshot.'}</p><button disabled={loading} onClick={load}>Try again</button></div>}
    <div className="po-stats" aria-label="Account snapshot">{stats.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value == null ? '—' : value.toLocaleString()}</strong></div>)}</div>
    <section className="po-task-section" aria-label="Common platform tasks"><div className="po-subheading"><h3>What needs your attention?</h3><p>Go directly to the tools you need.</p></div><div className="po-task-grid">{tasks.map(([id, number, title, text]) => <Link key={id} to={href(id)}><span>{number} <b aria-hidden="true">↗</b></span><h4>{title}</h4><p>{text}</p></Link>)}</div></section>
    <section className="po-recent" aria-label="Recent organizations"><div className="po-subheading"><div><h3>Recent organizations</h3><p>Latest account creation dates in this snapshot.</p></div><Link to={href('accounts')}>All organizations ↗</Link></div>{rows === null ? <p className="po-empty">{loading ? 'Loading organizations…' : 'Refresh the overview to load organizations.'}</p> : recent.length === 0 ? <p className="po-empty">No organizations yet.</p> : recent.map(row => <Link className="po-org-row" key={row.id} to={href('accounts')}><span className="po-org-initial" aria-hidden="true">{row.name?.slice(0, 1) || 'O'}</span><div><strong>{row.name}</strong><small>{row.owner_email || row.owner_name || 'Owner details unavailable'}</small></div><span className="po-org-count">{row.event_count || 0} events</span><span className={`po-account-status ${row.is_active === false ? 'suspended' : ''}`}>{row.is_active === false ? 'Suspended' : row.is_active === true ? 'Active' : 'Status unavailable'}</span><span aria-hidden="true">↗</span></Link>)}</section>
  </div>
}
