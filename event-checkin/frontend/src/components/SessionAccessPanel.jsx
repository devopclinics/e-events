import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import './SessionAccessPanel.css'

export default function SessionAccessPanel({ eventId }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [query, setQuery] = useState(''), [selected, setSelected] = useState([]), [zoneId, setZoneId] = useState(''), [page, setPage] = useState(1)
  const [filter, setFilter] = useState('all'), [showAll, setShowAll] = useState(false)
  const generation = useRef(0)
  async function load(version = generation.current) {
    try {
      const result = await api.sessionAccess(eventId)
      if (version === generation.current) { setData(result); setError('') }
    } catch (e) { if (version === generation.current) setError(e.message || 'Session access could not be loaded.') }
  }
  useEffect(() => {
    const version = ++generation.current
    setData(null); setSelected([]); setPage(1); setZoneId(''); setQuery(''); setFilter('all'); setBusy(false); setError('')
    load(version)
    return () => { generation.current++ }
  }, [eventId])
  async function mutate(action) {
    const version = generation.current
    setBusy(true); setError('')
    try { await action(); if (version === generation.current) await load(version) }
    catch (e) { if (version === generation.current) setError(e.message || 'Changes could not be saved.') }
    finally { if (version === generation.current) setBusy(false) }
  }
  function save(zone, ids, decision) { return mutate(() => api.setSessionAccess(eventId, zone, ids, decision)) }
  function restrict(zone, value) {
    if (!value && !window.confirm('Remove approval requirement? Guests without a decision will follow the existing ticket and tag rules. Explicit blocks remain in effect.')) return
    return mutate(() => api.setSessionRestriction(eventId, zone, value))
  }
  if (!data) return <section className="sa-panel"><p>{error || 'Loading session access…'}</p>{error && <button onClick={() => load()}>Retry</button>}</section>
  const decisions = new Map(data.decisions.map(d => [`${d.guest_id}:${d.zone_id}`, d.decision]))
  const state = (gid, zid) => decisions.get(`${gid}:${zid}`) || 'review'
  const relevant = data.zones.filter(z => z.restricted || data.decisions.some(d => d.zone_id === z.id && d.decision !== 'review'))
  const zones = showAll || !relevant.length ? data.zones : relevant
  const needsReview = g => zones.some(z => z.restricted && state(g.id, z.id) === 'review')
  const blocked = g => zones.some(z => state(g.id, z.id) === 'block')
  const visible = data.guests.filter(g => `${g.name} ${g.email || ''} ${g.phone || ''}`.toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || (filter === 'block' ? blocked(g) : needsReview(g))))
  const pages = Math.max(1, Math.ceil(visible.length / 30)), currentPage = Math.min(page, pages)
  const rows = visible.slice((currentPage - 1) * 30, currentPage * 30)
  return <section className="sa-panel" aria-busy={busy}>
    <header className="sa-header"><div><span className="sa-eyebrow">GUEST ACCESS · SESSION BY SESSION</span><h2>The right guests.<br/>The right sessions.</h2><p>One guest list, separate access and check-in records. See who can attend, then update permissions in one place.</p></div><a className="sa-directory-link" href="/guests-redesign?tab=guests">View guest list ↗</a></header>
    <details className="sa-guide"><summary>How to set up session access <span>Add zones · choose guests · manage entry</span></summary>
      <ol><li><strong>Add your sessions or areas.</strong> Open <a href="/checkin-redesign?tab=zones">Zones</a> and add each one, such as Conference, Dinner, Workshop or VIP Lounge. Return to Session access when finished.</li><li><strong>Choose which zones need approval.</strong> Open Session settings below and tick Require explicit approval for each restricted zone. Guests without an Allowed decision cannot enter that zone. Online scanning is required.</li><li><strong>Set access beside each guest.</strong> Choose Allowed or Blocked in the relevant session column. For conference-only access, set Conference to Allowed and Dinner to Blocked. Each zone has its own decision.</li><li><strong>Update several guests together.</strong> Search or filter, tick the guests, choose a session in the selection bar, then select Allow selected or Block selected. Select results includes all matching guests, including other pages.</li><li><strong>Check entry at the right zone.</strong> Use that zone in the scanner, or assign the entry gate to it. The same guest pass can be used for separate session check-ins.</li></ol>
      <p><strong>What the statuses mean:</strong> Allowed grants session permission; other registration, ticket and gate rules still apply. Blocked prevents entry to that zone. Needs approval prevents entry until you allow the guest. Reset to review removes the explicit decision; unrestricted zones then follow existing rules.</p>
      <p><strong>More than two zones?</strong> Every restricted zone appears as a column. Use Show all zones to include unrestricted areas. On phones, every guest has a separate, labelled control for each session. On larger screens, scroll the table sideways for additional columns. Session badges also appear beneath guest names in the guest list.</p>
      <p>Changes save automatically. Wait for the update to finish and check for any error message. Existing tickets, tags and guest labels do not replace an explicit session decision.</p>
    </details>
    <div className="sa-summary"><article><span>Event guests</span><strong>{data.guests.length}</strong><small>One record per guest</small></article><article><span>Approval required</span><strong>{data.zones.filter(z => z.restricted).length}</strong><small>Sessions with controlled entry</small></article><article className="sa-stat-block"><span>With a restriction</span><strong>{data.guests.filter(blocked).length}</strong><small>Blocked from at least one shown session</small></article><article className="sa-stat-review"><span>Awaiting a decision</span><strong>{data.guests.filter(needsReview).length}</strong><small>Need approval for a shown session</small></article></div>
    {error && <div className="sa-error" role="alert">{error} <button onClick={() => load()}>Refresh access</button></div>}
    <details className="sa-settings"><summary>Session settings <span>{data.zones.length} zones · manage approval rules</span></summary><p>Choose seating separately for each session. No tables records attendance without allocating a seat. Use existing seating rules keeps assigned tables and allocates available seats when needed. Preassigned tables only sends guests without a table to the seating desk. Once session seating is configured, general event check-in does not allocate seats.</p><div className="sa-zones">{data.zones.map(z => <article key={z.id}><strong>{z.name}</strong><label><input type="checkbox" checked={z.restricted} disabled={busy} onChange={e => restrict(z.id, e.target.checked)}/> Require explicit approval</label><label>Seating<select aria-label={`${z.name} seating mode`} disabled={busy} value={z.seating_mode || 'default'} onChange={e => mutate(() => api.setSessionSeating(eventId, z.id, e.target.value))}><option value="default">Follow event-wide seating</option><option value="none">No tables (general seating)</option><option value="event">Use existing seating rules at entry</option><option value="assigned">Preassigned tables only</option></select></label><p>{z.restricted ? 'Guests need an Allow decision. Online scanning required.' : 'Existing ticket and tag rules apply. Explicit blocks still prevent entry.'}</p></article>)}</div>{!data.zones.length && <p>Add your sessions in Zones first.</p>}</details>
    <div className="sa-list"><div className="sa-list-heading"><div><h3>Guest permissions</h3><p>Changes apply to session entry. Other event admission rules still apply.</p></div><label className="sa-show-all"><input type="checkbox" checked={showAll} onChange={e => { setShowAll(e.target.checked); setPage(1) }}/> Show all zones</label></div>
    <div className="sa-actions"><input aria-label="Search session guests" placeholder="Search name, email or phone…" value={query} onChange={e => { setQuery(e.target.value); setPage(1) }}/><select aria-label="Filter session access" value={filter} onChange={e => { setFilter(e.target.value); setPage(1) }}><option value="all">All guests</option><option value="block">With a restriction</option><option value="review">Awaiting a decision</option></select><button disabled={busy || !visible.length} onClick={() => setSelected(visible.map(g => g.id))}>Select results ({visible.length})</button></div>
    {selected.length > 0 && <div className="sa-bulk"><strong>{selected.length} selected</strong><select aria-label="Session for bulk access" value={zoneId} onChange={e => setZoneId(e.target.value)}><option value="">Choose session</option>{data.zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}</select>{['allow', 'block', 'review'].map(d => <button className={`sa-bulk-${d}`} key={d} disabled={busy || !zoneId} onClick={() => save(zoneId, selected, d)}>{d === 'allow' ? 'Allow selected' : d === 'block' ? 'Block selected' : 'Reset to review'}</button>)}<button onClick={() => setSelected([])}>Clear</button></div>}
    <div className="sa-table-scroll"><table className="sa-table"><thead><tr><th className="sa-checkbox"><input type="checkbox" aria-label="Select guests on this page" checked={rows.length > 0 && rows.every(g => selected.includes(g.id))} onChange={e => setSelected(s => e.target.checked ? [...new Set([...s, ...rows.map(g => g.id)])] : s.filter(id => !rows.some(g => g.id === id)))}/></th><th scope="col">Guest</th>{zones.map(z => <th scope="col" className="sa-session-heading" key={z.id}>{z.name}<small>{z.restricted ? 'Approval required' : 'Existing rules apply'}</small></th>)}</tr></thead><tbody>{rows.map(g => <tr key={g.id} className={selected.includes(g.id) ? 'sa-selected' : ''}><td><input type="checkbox" aria-label={`Select ${g.name}`} checked={selected.includes(g.id)} onChange={e => setSelected(s => e.target.checked ? [...new Set([...s, g.id])] : s.filter(id => id !== g.id))}/></td><td><div className="sa-person"><span className="sa-avatar" aria-hidden="true">{g.name.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('')}</span><div><strong>{g.name}</strong><small>{g.email || g.phone || 'No contact details'}</small>{g.email && g.phone && <small>{g.phone}</small>}</div></div></td>{zones.map(z => <td className="sa-session-cell" key={z.id}><span className="sa-session-label"><strong>{z.name}</strong><small>{z.restricted ? 'Approval required' : 'Existing rules apply'}</small></span><select className={`sa-status sa-${state(g.id, z.id)}`} aria-label={`${g.name}: ${z.name} access`} disabled={busy} value={state(g.id, z.id)} onChange={e => save(z.id, [g.id], e.target.value)}><option value="review">{z.restricted ? 'Needs approval' : 'Existing rules'}</option><option value="allow">Allowed</option><option value="block">Blocked</option></select></td>)}</tr>)}</tbody></table></div>
    {!visible.length && <div className="sa-empty"><h3>No matching guests</h3><p>Try a different name or change the access filter.</p></div>}<footer><span>{visible.length ? (currentPage - 1) * 30 + 1 : 0}–{Math.min(currentPage * 30, visible.length)} of {visible.length} guests</span><div><button disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</button><span>{currentPage} / {pages}</span><button disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>Next</button></div></footer></div>
    <p className="sa-footnote">Allowed and blocked decisions are saved per session. Blocking a guest never deletes their record, and exits remain available.</p>
  </section>
}
