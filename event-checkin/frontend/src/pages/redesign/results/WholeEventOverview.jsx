import { useState } from 'react'
import { eventTime, summaryMetrics } from './resultsSummary.mjs'

const ratio = (a, b) => b ? Math.min(100, Math.round(Number(a || 0) / b * 100)) : 0
function Card({ eyebrow, title, children, action, onOpen }) {
  return <article className="er-summary-card er-whole-card"><div className="er-summary-card-head"><div><span>{eyebrow}</span><h3>{title}</h3></div>{onOpen && <button type="button" onClick={onOpen}>{action || 'Details'} →</button>}</div>{children}</article>
}
export function WholeEventTotals({ event, data }) {
  const summary = data.event_summary
  return <section className="er-whole-totals" aria-label="Entire event totals"><div className="er-whole-label"><strong>Entire event</strong><span>These totals stay visible when you filter a day or zone.</span></div>{summary ? <div className="er-whole-kpis">{summaryMetrics(summary).map(([label, value, detail]) => <article key={label}><span>{label}</span><strong>{value ?? '—'}</strong><small>{detail}</small></article>)}</div> : <div className="er-whole-notice">Event-wide summary is temporarily unavailable. Scoped operational data is shown below.</div>}{summary && <p className="er-whole-notice">{summary.exit_tracking_recorded ? 'Occupancy is a recorded entry/exit estimate; see the period and as-of time in the operational view.' : 'Current physical occupancy is unverified: no exit scans are recorded. Arrival totals do not prove who is still inside.'} All event times use {event?.timezone || 'UTC'}.</p>}</section>
}
export default function WholeEventOverview({ event, data, setActiveTab, setOverviewLayout, venueId }) {
  const [allDates, setAllDates] = useState(false)
  const summary = data.event_summary, r = summary?.rsvp || data.rsvp_funnel || {}
  const communication = data.communication || {}, overall = communication.overall
  const seating = summary?.seating, alerts = data.alerts || []
  const zones = (allDates ? summary?.zones_all_time : summary?.zones) || []
  const overlap = allDates ? summary?.zone_overlap_all_time : summary?.zone_overlap
  const union = allDates ? summary?.zone_unique_arrivals_all_time : summary?.zone_unique_arrivals
  const current = data.program?.in_progress?.[0], next = data.program?.up_next, uncertain = data.program?.status_unknown || []
  const denied = summary?.denied_scans, shared = summary?.shared_passes
  return <section className="er-whole-overview">
    <div className="er-executive-lead"><div><span className="er-section-eyebrow">Whole-event results</span><h2>{event?.name || 'Event'} at a glance</h2><p>Event totals, zone arrivals, seating, communications, and follow-up in one accountable view.</p></div><button type="button" className="er-whole-command" onClick={() => setOverviewLayout('command')}>Open command center →</button></div>
    <div className="er-whole-grid">
      <Card eyebrow="Attendance by zone" title="Where guests arrived" action="Access report" onOpen={() => setActiveTab('attendance')}>
        <label className="er-whole-period">Zone reporting period<select value={allDates ? 'all' : 'event'} onChange={e => setAllDates(e.target.value === 'all')}><option value="event">Configured event dates</option><option value="all">All recorded dates</option></select></label>
        {zones.length ? <div className="er-whole-table-wrap"><table className="er-whole-table"><thead><tr><th>Zone</th><th>Unique entries</th><th>Venue capacity</th></tr></thead><tbody>{zones.map(z => <tr key={z.id} className={venueId === z.id ? 'selected' : ''}><td>{z.name}</td><td><b>{z.unique_arrivals}</b></td><td>{z.capacity != null ? z.capacity : 'Not configured'}</td></tr>)}</tbody></table></div> : <p>No active zones configured.</p>}
        {zones.length > 0 && <><span className="er-whole-tag">Do not sum zone totals</span><p>{overlap ?? '—'} guest records entered more than one active zone. Deduplicated arrivals across these zones: <b>{union ?? '—'}</b>.</p><p>Counts follow {allDates ? 'all recorded dates, including entries outside the event dates' : 'the configured event dates'}. Capacity percentages require a configured venue capacity.</p></>}
      </Card>
      <Card eyebrow="Registration & arrival · Entire event" title="Two distinct journeys" onOpen={() => setActiveTab('invitations')}>
        {[['Invited',r.invited,r.guests],['Responded',r.responded,r.guests],['Confirmed',r.confirmed,r.guests],['Confirmed arrived',r.confirmed_arrived,r.confirmed],['All arrivals',r.checked_in,r.guests]].map(([label,value,total]) => <div className="er-whole-progress" key={label}><span>{label}</span><div><i style={{width:`${ratio(value,total)}%`}}/></div><b>{value ?? '—'} / {total ?? '—'}</b></div>)}
        <p>All arrivals include <b>{r.other_arrivals ?? '—'}</b> records not currently RSVP-confirmed. Those arrivals are separate from the confirmed cohort.</p>
      </Card>
      <Card eyebrow="Seating & guest services · Entire event" title="The actual table inventory" onOpen={() => setActiveTab('operations')}>
        {seating ? <div className="er-whole-facts"><div><strong>{seating.tables}</strong><span>Tables configured</span></div><div><strong>{seating.seats}</strong><span>Total table seats</span></div><div><strong>{seating.assigned}</strong><span>Guest records assigned a table</span></div></div> : <p>Table inventory is unavailable.</p>}
        <p>{data.table_group_capacity?.length || 0} table groups. Ordinary tables are included above even when no table groups exist. Table seats are not venue capacity.</p>
        <p><b>Meals:</b> {data.meals?.categories?.length ? `${data.meals.served_total ?? 0} guest records served out of ${data.meals.eligible_total ?? 0} eligible; ${data.meals.categories.length} tracked categories.` : 'Meal tracking not configured. No meal-service outcome is inferred.'}</p>
      </Card>
      <Card eyebrow="Communications · Entire event" title="Delivery, with its denominator" onOpen={() => setActiveTab('communications')}>
        {overall ? <><div className="er-whole-facts"><div><strong>{overall.sent}</strong><span>Tracked message attempts</span></div><div><strong>{overall.delivered}</strong><span>Confirmed deliveries</span></div><div><strong>{overall.rate == null ? '—' : `${overall.rate}%`}</strong><span>Overall delivery rate</span></div></div><table className="er-whole-table"><tbody>{['email','whatsapp','sms','mms'].filter(k => communication[k]?.sent > 0).map(k => <tr key={k}><td>{({email:'Email',whatsapp:'WhatsApp',sms:'SMS',mms:'MMS'})[k]}</td><td>{communication[k].delivered} delivered / {communication[k].sent} attempts</td></tr>)}</tbody></table><p>{overall.failed} failed; {overall.pending} pending; {overall.unknown || 0} unknown. Message attempts are not distinct people reached.</p></> : <p>No tracked delivery summary available.</p>}
      </Card>
      <Card eyebrow="Exceptions · Entire event" title={`${alerts.length} exception categor${alerts.length === 1 ? 'y' : 'ies'}`} action="Review exceptions" onOpen={() => setActiveTab('exceptions')}>
        {alerts.length ? alerts.map(alert => <div className="er-whole-action" key={alert.id}><div><b>{alert.title}</b><p>{alert.type === 'denied_scans' && denied ? `${denied.attempts} attempts affecting ${denied.affected_guests} distinct guest records.` : alert.description}</p></div><strong>{alert.count}</strong></div>) : <p>No recorded exceptions need attention.</p>}
        <p>Categories can overlap and use different units. Do not add their counts as a total of affected guests.</p>
      </Card>
      <Card eyebrow="Programme & data confidence" title="Honest status, useful follow-up" onOpen={() => setActiveTab('program')}>
        {current && <div className="er-whole-action"><div><b>Live now: {current.topic}</b><p>{current.start_time} · {event?.timezone || 'UTC'}</p></div></div>}
        {next && <div className="er-whole-action"><div><b>Next: {next.topic}</b><p>{next.day} · {next.start_time} · {event?.timezone || 'UTC'}</p></div></div>}
        {uncertain.slice(0,3).map(s => <div className="er-whole-action" key={s.step_id}><div><b>{s.topic}</b><p>{s.day} · {s.start_time || 'Start time not set'} · {event?.timezone || 'UTC'}. {s.start_at ? 'The scheduled start has passed; an end time is missing. Completion is not established.' : 'The schedule is incomplete; programme status is unknown.'}</p></div></div>)}
        {!current && !next && !uncertain.length && <p>No current or next programme item is recorded.</p>}
        {shared && <div className="er-whole-action"><div><b>Shared passes</b><p>{shared.passes} configured passes · {shared.admission_slots} admission slots · {shared.members} linked member records. Slots are not unique arrivals.</p></div></div>}
        <div className="er-whole-action"><div><b>One timezone throughout</b><p>Event clock and programme times use {event?.timezone || 'UTC'}.</p></div></div>
        <button type="button" className="er-whole-services" onClick={() => setActiveTab('services')}>View all enabled services →</button>
      </Card>
    </div>
  </section>
}
