import { useState, useEffect, useRef, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import RedesignShell, { Icon, Modal } from './redesign/RedesignShell'
import { LoadingSkeleton } from './redesign/RedesignPrimitives'
import { useCurrentEvent } from '../hooks/useCurrentEvent'
import { api } from '../api'
import { auth } from '../firebase'
import AttendanceTab from './redesign/results/AttendanceTab'
import InvitationsTab from './redesign/results/InvitationsTab'
import ProgramTab from './redesign/results/ProgramTab'
import OperationsTab from './redesign/results/OperationsTab'
import './EventResultsRedesignPage.css'

// Live operations command center backed by dashboard-service's
// /api/results/* endpoints. All seven tabs are wired to production data.

const RESULTS_NAV = [
  { label: 'Event summary', items: [
    { id: 'executive', label: 'Executive overview', icon: 'barchart' },
    { id: 'command', label: 'Live command center', icon: 'trend' },
    { id: 'services', label: 'All services snapshot', icon: 'grid' },
    { id: 'exceptions', label: 'Exceptions & actions', icon: 'info', count: true },
  ] },
  { label: 'Audience', items: [
    { id: 'registration', label: 'Registration & RSVP', icon: 'users' },
    { id: 'communications', label: 'Communications', icon: 'mail' },
  ] },
  { label: 'Event delivery', items: [
    { id: 'attendance', label: 'Attendance & access', icon: 'check' },
    { id: 'programme', label: 'Programme', icon: 'calendar' },
    { id: 'engagement', label: 'Engagement', icon: 'trend' },
    { id: 'operations', label: 'Operations', icon: 'settings' },
  ] },
  { label: 'Finance', items: [
    { id: 'revenue', label: 'Ticket revenue', icon: 'card' },
    { id: 'giving', label: 'Giving', icon: 'card' },
  ] },
  { label: 'Finish', items: [
    { id: 'feedback', label: 'Feedback', icon: 'trend' },
    { id: 'closeout', label: 'Closeout & exports', icon: 'file' },
  ] },
]

const VIEW_META = {
  executive: ['Executive overview', 'One accountable view across the entire event lifecycle.'],
  command: ['Live command center', 'A dense, real-time operating view for the event team during event delivery.'],
  services: ['All services snapshot', 'Every enabled event service, visible together with its headline result and source workspace.'],
  exceptions: ['Exceptions & actions', 'Prioritized issues linked to the record and workspace where they can be resolved.'],
  registration: ['Registration & RSVP', 'Invitations, responses, approvals, delivery, and guest conversion.'],
  communications: ['Communications', 'Channel delivery, broadcasts, failures, and guest reach.'],
  attendance: ['Attendance & access', 'Arrivals, zones, credentials, capacity, and attendance gaps.'],
  programme: ['Programme', 'Session status, attendance, rooms, speakers, and schedule delivery.'],
  engagement: ['Engagement', 'Festio Live participation, activities, responses, moderation, and insights.'],
  operations: ['Operations', 'Meals, consent, venue occupancy, denied scans, and live service delivery.'],
  revenue: ['Ticket revenue', 'Orders, payments, refunds, settlements, and reconciliation.'],
  giving: ['Giving', 'Donors, pledges, confirmed contributions, channels, and finance verification.'],
  feedback: ['Feedback', 'Response collection, ratings, themes, and follow-up actions.'],
  closeout: ['Closeout & exports', 'Finish the event with a complete, auditable record.'],
}

function fmtDay(iso) {
  const d = new Date(`${iso}T00:00:00`)
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

function pct(part, total) {
  return total ? Math.min(Math.max(Math.round((Number(part || 0) / Number(total)) * 100), 0), 100) : 0
}

function fmtEventDate(event) {
  if (!event?.event_date) return 'Date to be announced'
  return new Date(event.event_date).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    ...(event.timezone && { timeZone: event.timezone }),
  })
}

function fmtEventTime(event) {
  if (!event?.event_date) return ''
  const options = {
    hour: 'numeric', minute: '2-digit',
    ...(event.timezone && { timeZone: event.timezone }),
  }
  const start = new Date(event.event_date).toLocaleTimeString([], options)
  if (!event.event_end_date) return start
  return `${start} – ${new Date(event.event_end_date).toLocaleTimeString([], options)}`
}

function fmtActivityTime(value, timezone) {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return parsed.toLocaleTimeString([], {
    hour: 'numeric', minute: '2-digit',
    ...(timezone && { timeZone: timezone }),
  })
}

function Sparkline({ values = [], tone = 'teal' }) {
  const clean = values.map(Number).filter(Number.isFinite)
  if (clean.length < 2 || Math.max(...clean) === Math.min(...clean)) {
    return <span className="er-ops-spark-empty" aria-hidden="true" />
  }
  const max = Math.max(...clean)
  const min = Math.min(...clean)
  const points = clean.map((value, index) => {
    const x = (index / Math.max(clean.length - 1, 1)) * 100
    const y = 27 - ((value - min) / Math.max(max - min, 1)) * 22
    return `${x},${y}`
  }).join(' ')
  return (
    <svg className={`er-ops-spark er-ops-spark-${tone}`} viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} />
    </svg>
  )
}

function MetricTile({ icon, label, value, detail, values, tone = 'teal', title }) {
  return (
    <article className={`er-ops-metric er-tone-${tone}`} title={title}>
      <span className="er-ops-metric-icon"><Icon name={icon} size={17} /></span>
      <div className="er-ops-metric-copy">
        <span>{label}</span>
        <strong>{value ?? '—'}</strong>
        <small>{detail}</small>
        <Sparkline values={values} tone={tone} />
      </div>
    </article>
  )
}

function ResultsSidebar({ event, activeView, onChange, exceptionCount }) {
  const eventRange = event?.event_end_date
    ? `${fmtEventDate(event)} – ${new Date(event.event_end_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
    : fmtEventDate(event)
  return <aside className="er-results-sidebar" aria-label="Results sections">
    <div className="er-results-event-mini"><strong>{event?.name || 'Selected event'}</strong><span>{eventRange} · {event?.status || 'Draft'}</span></div>
    {RESULTS_NAV.map(group => <div className="er-results-nav-group" key={group.label}><div className="er-results-nav-label">{group.label}</div>{group.items.map(item => <button type="button" key={item.id} className={`er-results-nav-button${activeView===item.id?' active':''}`} onClick={()=>onChange(item.id)}><Icon name={item.icon} size={15}/><span>{item.label}</span>{item.count && <small>{exceptionCount}</small>}</button>)}</div>)}
  </aside>
}

function ResultsPageHeader({ activeView }) {
  const [title, subtitle] = VIEW_META[activeView] || VIEW_META.executive
  return <header className="er-results-pagehead"><div><span>Unified event intelligence</span><h1>{title}</h1><p>{subtitle}</p></div><div><button type="button" onClick={()=>window.print()}><Icon name="upload" size={14}/> Export report</button></div></header>
}

function ExceptionsResultsView({ data }) {
  const alerts=data.alerts||[]
  const routes={missing_meal_selection:'/event-results-redesign?view=operations',tables_over_capacity:'/event-results-redesign?view=operations',no_contact_info:'/guests-redesign?tab=guests',failed_invitations:'/event-results-redesign?view=communications',denied_scans:'/event-results-redesign?view=attendance',low_credits:'/billing-redesign?tab=billing'}
  return <section className="er-results-record-panel"><div className="er-results-record-head"><div><h2>Exceptions requiring action</h2><p>Every unresolved item is linked to the workspace where it can be resolved.</p></div><span>{alerts.length} open</span></div>{alerts.length?<div className="er-results-record-list">{alerts.map(alert=><a key={alert.id} href={routes[alert.type]||alert.action_url||'#'}><em className={alert.severity}>{alert.severity||'review'}</em><span><strong>{alert.title}</strong><small>{alert.description}</small></span><b>{alert.count}</b><Icon name="arrow" size={13}/></a>)}</div>:<div className="er-results-all-clear"><Icon name="check" size={20}/><strong>All clear</strong><span>No unresolved exceptions were returned for this event.</span></div>}</section>
}

const WORKSPACE_VIEWS={
  engagement:{eyebrow:'Festio Live',title:'Engagement results',body:'Review participation, responses, moderation, activity analytics, displays, and downloadable reports in the connected Festio Live workspace.',href:'/live-redesign?tab=Analytics',action:'Open engagement analytics'},
  revenue:{eyebrow:'Ticket sales',title:'Ticket revenue and reconciliation',body:'Review orders, gross and net revenue, refunds, settlements, provider readiness, disputes, and the complete transaction ledger.',href:'/ticketing-redesign',action:'Open ticket revenue'},
  giving:{eyebrow:'Giving Hub',title:'Giving and pledge reconciliation',body:'Review donors, pledges, confirmed contributions, payment channels, anonymous gifts, and finance verification in one contribution ledger.',href:'/live-redesign?tab=Donations',action:'Open Giving Hub'},
  feedback:{eyebrow:'Guest feedback',title:'Feedback intelligence',body:'Review feedback activities, response details, ratings, moderation, downloadable reports, and follow-up themes.',href:'/live-redesign?tab=Activities',action:'Open feedback results'},
}
function ResultsWorkspaceView({ kind, enabled=true }) {
  const item=WORKSPACE_VIEWS[kind]
  return <section className="er-results-workspace"><span>{item.eyebrow}</span><h2>{item.title}</h2><p>{item.body}</p>{enabled?<a href={item.href}>{item.action}<Icon name="arrow" size={14}/></a>:<div className="er-results-workspace-disabled">This service is not enabled for the selected event.</div>}</section>
}

function CloseoutResultsView({ event, data }) {
  const alerts=data.alerts||[]
  const checks=[
    {label:'Review registration and attendance totals',done:true,detail:`${data.attendance?.checked_in??0} checked in`},
    {label:'Resolve operational exceptions',done:alerts.length===0,detail:alerts.length?`${alerts.length} open`:'Complete'},
    {label:'Reconcile ticket payments, pledges and refunds',done:false,detail:'Review finance'},
    {label:'Complete live activities and feedback review',done:false,detail:'Review engagement'},
    {label:'Export event records and reports',done:false,detail:'Ready to export'},
    {label:'Mark the event ended or archived',done:['ended','archived'].includes(String(event?.status||'').toLowerCase()),detail:event?.status||'Draft'},
  ]
  const complete=checks.filter(item=>item.done).length
  return <section className="er-closeout-view"><article><span>Event closeout</span><h2>Finish with a complete, auditable record.</h2><p>Complete each step in order. Every action remains in the service that owns its source record.</p><div className="er-closeout-list">{checks.map(item=><div className={item.done?'done':'pending'} key={item.label}><i>{item.done?'✓':'!'}</i><strong>{item.label}</strong><small>{item.detail}</small></div>)}</div></article><aside><span>Closeout readiness</span><strong>{complete}/{checks.length}</strong><p>Required reviews completed</p><button type="button" onClick={()=>window.print()}><Icon name="download" size={14}/> Export current report</button><a href="/setup-redesign?view=closeout">Open guided closeout<Icon name="arrow" size={13}/></a></aside></section>
}

function ExecutiveResultsOverview({ event, data, attendance, setActiveTab, setOverviewLayout }) {
  const alerts = data.alerts || [], funnel = data.rsvp_funnel || {}, communication = data.communication || {}
  const onSite = attendance.on_site ?? Math.max(Number(attendance.checked_in || 0) - Number(attendance.checked_out || 0), 0)
  const arrivalRate = pct(attendance.checked_in, attendance.expected), responseRate = pct(funnel.responded, funnel.guests)
  const criticalCount = alerts.filter(alert => alert.severity === 'critical').length, warningCount = alerts.length - criticalCount
  const rates = ['email','sms','whatsapp','mms'].map(channel => communication[channel]).filter(item => Number(item?.sent || 0) > 0 && Number.isFinite(Number(item?.rate))).map(item => Number(item.rate))
  const deliveryRate = rates.length ? Math.round(rates.reduce((sum, value) => sum + value, 0) / rates.length) : null
  const currentProgram = data.program?.in_progress?.[0], nextProgram = data.program?.up_next
  const healthLabel = criticalCount ? 'Needs attention' : warningCount ? 'Watch items' : 'On track'
  const healthTone = criticalCount ? 'danger' : warningCount ? 'warning' : 'success'
  return <section className="er-executive">
    <div className="er-executive-lead"><div><span className="er-section-eyebrow">Event performance</span><h2>{event?.name || 'Event'} at a glance</h2><p>One decision-ready view of guest response, arrivals, communication reach, programme status, and items that need action.</p></div><div className={`er-health-badge ${healthTone}`}><span>Overall status</span><strong>{healthLabel}</strong><small>{alerts.length ? `${alerts.length} open action${alerts.length === 1 ? '' : 's'}` : 'No open actions'}</small></div></div>
    <div className="er-executive-kpis">
      <MetricTile icon="users" label="Expected guests" value={attendance.expected ?? 0} detail={`${funnel.confirmed ?? 0} confirmed`} tone="neutral"/>
      <MetricTile icon="check" label="Checked in" value={attendance.checked_in ?? 0} detail={`${arrivalRate}% arrival rate`} tone="green"/>
      <MetricTile icon="users" label="On site now" value={onSite} detail={`${attendance.checked_out ?? 0} checked out`} tone="teal"/>
      <MetricTile icon="send" label="RSVP response" value={`${responseRate}%`} detail={`${funnel.responded ?? 0} of ${funnel.guests ?? 0}`} tone="blue"/>
      <MetricTile icon="mail" label="Delivery health" value={deliveryRate == null ? '—' : `${deliveryRate}%`} detail={deliveryRate == null ? 'No sends recorded' : 'Average active channels'} tone="teal"/>
      <MetricTile icon="info" label="Action queue" value={alerts.length} detail={`${criticalCount} critical · ${warningCount} other`} tone={criticalCount ? 'red' : warningCount ? 'amber' : 'green'}/>
    </div>
    <div className="er-executive-grid">
      <article className="er-summary-card"><div className="er-summary-card-head"><div><span>Guest journey</span><h3>Invitation to arrival</h3></div><button onClick={() => setActiveTab('invitations')}>Details <Icon name="arrow" size={12}/></button></div>
        {[['Invited',funnel.invited,funnel.guests],['Responded',funnel.responded,funnel.guests],['Confirmed',funnel.confirmed,funnel.guests],['Checked in',funnel.checked_in,funnel.confirmed || funnel.guests]].map(([label,value,total]) => <div className="er-summary-progress-row" key={label}><div><span>{label}</span><b>{value ?? 0}</b></div><div className="er-summary-track"><i style={{width:`${pct(value,total)}%`}}/></div><small>{pct(value,total)}%</small></div>)}
      </article>
      <article className="er-summary-card"><div className="er-summary-card-head"><div><span>Programme now</span><h3>Current and next</h3></div><button onClick={() => setActiveTab('program')}>Programme <Icon name="arrow" size={12}/></button></div>
        {currentProgram ? <div className="er-now-card"><span>Live now · {currentProgram.start_time || 'Time not set'}</span><strong>{currentProgram.topic}</strong><small>{currentProgram.room || 'Room not specified'}{currentProgram.speaker ? ` · ${currentProgram.speaker}` : ''}</small></div> : <div className="er-summary-empty">No programme item is currently in progress.</div>}
        {nextProgram && <div className="er-next-card"><span>Next up · {nextProgram.start_time || 'Time not set'}</span><strong>{nextProgram.topic}</strong></div>}
      </article>
      <article className="er-summary-card"><div className="er-summary-card-head"><div><span>Attention required</span><h3>Priority action queue</h3></div><button onClick={() => setOverviewLayout('command')}>Command center <Icon name="arrow" size={12}/></button></div>
        {alerts.length ? alerts.slice(0,4).map(alert => <div className={`er-summary-alert er-severity-${alert.severity}`} key={alert.id}><span><Icon name="info" size={13}/></span><div><strong>{alert.title}</strong><small>{alert.description}</small></div><b>{alert.count}</b></div>) : <div className="er-summary-clear"><Icon name="check" size={18}/><strong>All clear</strong><span>No operational exceptions need attention.</span></div>}
      </article>
    </div>
  </section>
}

function ServiceResultCard({ icon, title, state='Available', metric, detail, action, onOpen, tone='teal' }) {
  return <article className={`er-service-card er-service-${tone}`}><div className="er-service-card-head"><span><Icon name={icon} size={17}/></span><em>{state}</em></div><h3>{title}</h3><strong>{metric}</strong><p>{detail}</p><button type="button" onClick={onOpen}>{action}<Icon name="arrow" size={12}/></button></article>
}

function AllServicesResultsSnapshot({ event, data, attendance, setActiveTab }) {
  const funnel=data.rsvp_funnel||{}, communication=data.communication||{}
  const cards=[
    {key:'registration',icon:'users',title:'Registration & RSVP',metric:`${funnel.confirmed??0} confirmed`,detail:`${funnel.responded??0} responses from ${funnel.guests??0} guests`,action:'Open invitations',tab:'invitations',enabled:true},
    {key:'attendance',icon:'check',title:'Attendance & access',metric:`${attendance.checked_in??0} checked in`,detail:`${attendance.on_site??Math.max(Number(attendance.checked_in||0)-Number(attendance.checked_out||0),0)} currently on site`,action:'Open attendance',tab:'attendance',enabled:true,tone:'green'},
    {key:'communications',icon:'send',title:'Guest communications',metric:`${communication.credits_remaining??0} credits`,detail:`${communication.email?.sent??0} email · ${communication.sms?.sent??0} SMS · ${communication.whatsapp?.sent??0} WhatsApp`,action:'Open invitations',tab:'invitations',enabled:true,tone:'blue'},
    {key:'program',icon:'calendar',title:'Programme & sessions',metric:`${data.program?.in_progress?.length??0} live now`,detail:data.program?.up_next?.topic?`Next: ${data.program.up_next.topic}`:'No next session scheduled',action:'Open programme',tab:'program',enabled:event?.experience_enabled!==false},
    {key:'experience',icon:'layers',title:'Guest experience',metric:data.consent?`${data.consent.rate??pct(data.consent.signed,data.consent.eligible)}% consent`:'Workflow results',detail:data.consent?`${data.consent.signed} of ${data.consent.eligible} signed`:'Review journey completion and blockers',action:'Open experience',tab:'experience',enabled:!!event?.experience_enabled,tone:'purple'},
    {key:'meals',icon:'card',title:'Meals & orders',metric:data.meals?`${data.meals.served_total??0} served`:'Service results',detail:data.meals?`${data.meals.eligible_total??0} eligible guests`:'Review selections and fulfilment',action:'Open meals',tab:'meals',enabled:!!event?.menu_enabled,tone:'amber'},
    {key:'seating',icon:'chair',title:'Seating & venue',metric:`${data.table_group_capacity?.length??0} groups`,detail:'Capacity, assignment, and venue readiness',action:'Open operations',tab:'operations',enabled:!!(event?.seating_enabled||event?.venue_access_enabled),tone:'amber'},
    {key:'live',icon:'trend',title:'Festio Live',metric:'Live participation',detail:'Activities, participants, responses, and displays',action:'Open operations',tab:'operations',enabled:!!event?.engagement_enabled,tone:'green'},
    {key:'gifts',icon:'card',title:'Gifts & giving',metric:'Giving workspace',detail:'Registry, pledges, confirmed gifts, and reconciliation',action:'Open gift list',href:'/addons-redesign?tab=registry',enabled:!!event?.registry_enabled,tone:'purple'},
    {key:'speakers',icon:'users',title:'Speakers',metric:'Speaker workspace',detail:'Profiles, programme assignments, and presenter materials',action:'Open speakers',href:'/addons-redesign?tab=speakers',enabled:!!event?.speaker_enabled,tone:'blue'},
    {key:'partners',icon:'grid',title:'Partners & exhibitors',metric:'Partner workspace',detail:'Profiles, participation, and event presence',action:'Open partners',href:'/addons-redesign?tab=partners',enabled:!!event?.partner_enabled,tone:'blue'},
    {key:'planner',icon:'check',title:'Planner & tasks',metric:'Planning workspace',detail:'Tasks, owners, milestones, and event readiness',action:'Open planner',href:'/planner-redesign',enabled:!!event?.planner_enabled,tone:'neutral'},
  ].filter(card=>card.enabled)
  return <section className="er-services-overview"><div className="er-services-intro"><div><span className="er-section-eyebrow">Configured for this event</span><h2>All service results</h2><p>Only services enabled for this event appear here. Open a card for its complete report or operating workspace.</p></div><span>{cards.length} active service{cards.length===1?'':'s'}</span></div><div className="er-service-grid">{cards.map(card=><ServiceResultCard key={card.key} {...card} onOpen={()=>card.tab?setActiveTab(card.tab):window.location.assign(card.href)}/>)}</div></section>
}

function ArrivalPulse({ hourly = [], expected = 0 }) {
  if (!hourly.length) {
    return <div className="er-ops-empty"><Icon name="barchart" size={20} /> No arrivals recorded in this scope yet.</div>
  }

  const width = 720
  const height = 205
  const left = 12
  const right = 708
  const top = 16
  const bottom = 168
  const firstArrivals = hourly.map((item) => Number(item.first_arrival || 0))
  const cumulative = firstArrivals.reduce((values, value) => {
    values.push((values.at(-1) || 0) + value)
    return values
  }, [])
  const max = Math.max(Number(expected || 0), cumulative.at(-1) || 0, 1)
  const xAt = (index) => left + ((index + 1) / hourly.length) * (right - left)
  const yAt = (value) => bottom - (value / max) * (bottom - top)
  const actual = [[left, bottom], ...cumulative.map((value, index) => [xAt(index), yAt(value)])]
  const planned = [[left, bottom], ...hourly.map((_item, index) => {
    const value = Number(expected || 0) * ((index + 1) / hourly.length)
    return [xAt(index), yAt(value)]
  })]
  const path = (points) => points.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const area = `${path(actual)} L${right} ${bottom} L${left} ${bottom} Z`
  const latest = actual.at(-1)
  const peak = Math.max(...hourly.map((item) => Number(item.first_arrival || 0) + Number(item.returning || 0)), 1)

  return (
    <div className="er-ops-arrival">
      <div className="er-ops-chart-legend">
        <span><i className="actual" /> Cumulative checked in</span>
        <span><i className="pace" /> Even expected pace</span>
      </div>
      <svg className="er-ops-arrival-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Cumulative guest arrivals compared with an even expected pace">
        {[0.25, 0.5, 0.75, 1].map((ratio) => (
          <line key={ratio} x1={left} x2={right} y1={yAt(max * ratio)} y2={yAt(max * ratio)} className="grid" />
        ))}
        <path d={area} className="area" />
        <path d={path(planned)} className="pace" />
        <path d={path(actual)} className="actual" />
        <line x1={latest[0]} x2={latest[0]} y1={top} y2={bottom} className="now" />
        <circle cx={latest[0]} cy={latest[1]} r="4" className="point" />
        <text x={Math.min(latest[0] + 8, right - 68)} y={Math.max(latest[1] - 10, top + 10)} className="latest-label">
          {cumulative.at(-1)} arrived
        </text>
      </svg>
      <div className="er-ops-hourly">
        {hourly.map((item) => {
          const volume = Number(item.first_arrival || 0) + Number(item.returning || 0)
          return (
            <div key={item.hour} className="er-ops-hour">
              <b>{volume || '—'}</b>
              <i style={{ height: `${Math.max((volume / peak) * 100, volume ? 7 : 2)}%` }} />
              <span>{item.hour}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CapacityRow({ name, value, capacity, detail }) {
  const progress = capacity ? pct(value, capacity) : 0
  return (
    <div className="er-ops-capacity-row">
      <div><span>{name}</span><b>{capacity ? `${value} / ${capacity}` : value}</b></div>
      <div className="er-ops-progress"><i className={progress >= 95 ? 'danger' : progress >= 80 ? 'warning' : ''} style={{ width: `${progress}%` }} /></div>
      {detail && <small>{detail}</small>}
    </div>
  )
}

function ResultsHero({ event, events, eventId, connected, now, updatedAt, onEventChange }) {
  const [eventMenuOpen, setEventMenuOpen] = useState(false)
  const pickerRef = useRef(null)

  useEffect(() => {
    if (!eventMenuOpen) return undefined
    function closeOnOutsideClick(e) {
      if (!pickerRef.current?.contains(e.target)) setEventMenuOpen(false)
    }
    function closeOnEscape(e) {
      if (e.key === 'Escape') setEventMenuOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [eventMenuOpen])

  return (
    <header className="er-ops-hero">
      <div className="er-ops-brandmark">F</div>
      <div className="er-ops-identity">
        <div className="er-ops-event-title">
          <span className="er-ops-live"><i /> {connected ? 'LIVE' : 'POLLING'}</span>
          <h1>{event?.name || 'Event command center'}</h1>
        </div>
        <div className="er-ops-event-meta">
          <span><Icon name="calendar" size={13} />{fmtEventDate(event)}</span>
          {fmtEventTime(event) && <span><Icon name="clock" size={13} />{fmtEventTime(event)}</span>}
          {event?.venue_name && <span><Icon name="grid" size={13} />{event.venue_name}</span>}
          <span className="er-ops-updated"><i /> Updated {updatedAt ? fmtActivityTime(updatedAt, event?.timezone) : 'just now'}</span>
        </div>
      </div>
      <div className="er-ops-hero-controls">
        <div className="er-ops-event-picker" ref={pickerRef}>
          <button
            type="button"
            className="er-ops-event-trigger"
            aria-label="Choose event"
            aria-haspopup="listbox"
            aria-expanded={eventMenuOpen}
            onClick={() => setEventMenuOpen((open) => !open)}
          >
            <span>{event?.name || 'Choose an event'}</span>
            <Icon name="chevrondown" size={14} />
          </button>
          {eventMenuOpen && (
            <div className="er-ops-event-menu" role="listbox" aria-label="Events">
              {events.map((item) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={item.id === eventId}
                  className={item.id === eventId ? 'active' : ''}
                  key={item.id}
                  onClick={() => {
                    onEventChange(item.id)
                    setEventMenuOpen(false)
                  }}
                >
                  <span>{item.name}</span>
                  {item.id === eventId && <Icon name="check" size={13} />}
                </button>
              ))}
            </div>
          )}
        </div>
        <time>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
      </div>
    </header>
  )
}

const GUEST_ALERT_TYPES = new Set([
  'failed_invitations', 'no_contact_info', 'tables_over_capacity',
  'missing_meal_selection', 'unsigned_consent', 'denied_scans', 'zone_capacity',
])

const ALERT_WORKSPACES = {
  failed_invitations: '/guests-redesign?tab=invite',
  no_contact_info: '/guests-redesign?tab=guests',
  tables_over_capacity: '/floorplan-redesign',
  missing_meal_selection: '/event-results-redesign?tab=meals',
  unsigned_consent: '/event-results-redesign?tab=experience',
  denied_scans: '/event-results-redesign?tab=attendance',
  zone_capacity: '/event-results-redesign?tab=attendance',
  low_credits: '/billing-redesign?tab=billing',
}

function AlertDetailModal({ eventId, state, onClose, onNavigate }) {
  if (!state?.alert) return null
  const { alert, loading, error, guests = [] } = state
  const workspace = ALERT_WORKSPACES[alert.type] || alert.action_url
  return (
    <Modal title={alert.title} onClose={onClose} width={680}>
      <div className="er-alert-detail">
        <div className={`er-alert-detail-summary er-severity-${alert.severity}`}>
          <span className="er-ops-alert-icon"><Icon name="info" size={16} /></span>
          <div><strong>{alert.description}</strong><small>{alert.count} item{alert.count === 1 ? '' : 's'} need attention</small></div>
        </div>

        {loading ? <LoadingSkeleton rows={5} variant="list" /> : error ? (
          <div className="er-ops-empty">{error}</div>
        ) : guests.length ? (
          <div className="er-alert-guest-list" aria-label={`Guests for ${alert.title}`}>
            {guests.map((guest) => (
              <button
                type="button"
                key={guest.id}
                aria-label={`Open guest record for ${guest.name}`}
                onClick={() => onNavigate(`/guests-redesign?tab=guests&guest=${encodeURIComponent(guest.id)}`)}
              >
                <span className="er-alert-guest-avatar">{guest.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span>
                <span><strong>{guest.name}</strong><small>{guest.context || guest.email || guest.phone || 'No contact information'}</small></span>
                <Icon name="arrow" size={14} />
              </button>
            ))}
          </div>
        ) : <div className="er-ops-empty compact">No affected guest records remain.</div>}

        <div className="er-alert-detail-actions">
          <button type="button" className="rr-btn secondary" onClick={onClose}>Close</button>
          {workspace && (
            <button type="button" className="rr-btn primary" onClick={() => onNavigate(workspace)}>
              Open workspace <Icon name="arrow" size={13} />
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}

function OverviewDashboard({
  event, eventId, data, attendance, zones, venueId, hasScopeFilter,
  arrivalGapLabel, autoRefresh, setAutoRefresh, setActiveTab,
}) {
  const [alertDetail, setAlertDetail] = useState(null)
  const hourly = attendance.hourly || []
  const firstArrivals = hourly.map((item) => Number(item.first_arrival || 0))
  const exits = hourly.map((item) => Number(item.exit || 0))
  const cumulative = firstArrivals.reduce((values, value) => {
    values.push((values.at(-1) || 0) + value)
    return values
  }, [])
  const reverseGap = cumulative.map((value) => Math.max(Number(attendance.expected || 0) - value, 0))
  const arrivalRate = pct(attendance.checked_in, attendance.expected)
  const onSite = attendance.on_site ?? Math.max(Number(attendance.checked_in || 0) - Number(attendance.checked_out || 0), 0)
  const selectedVenue = zones.find((zone) => zone.id === venueId)
  const occupancyCapacity = selectedVenue?.capacity || attendance.expected || 0
  const occupancyRate = pct(onSite, occupancyCapacity)
  const capacityRemaining = occupancyCapacity ? Math.max(occupancyCapacity - onSite, 0) : null
  const alerts = data.alerts || []
  const groups = data.table_group_capacity || []
  const currentProgram = data.program?.in_progress?.[0]
  const nextProgram = data.program?.up_next
  const funnel = data.rsvp_funnel || {}
  const funnelItems = [
    ['Guests', funnel.guests, 'users'],
    ['Invited', funnel.invited, 'send'],
    ['Responded', funnel.responded, 'check'],
    ['Confirmed', funnel.confirmed, 'ticket'],
    ['Checked in', funnel.checked_in, 'external'],
  ]
  const alertIcon = {
    missing_meal_selection: 'card',
    tables_over_capacity: 'chair',
    no_contact_info: 'users',
    failed_invitations: 'mail',
    denied_scans: 'shield',
    low_credits: 'message',
  }

  function navigate(url) {
    if (url) window.location.href = url
  }

  async function openAlert(alert) {
    if (!GUEST_ALERT_TYPES.has(alert.type)) {
      navigate(ALERT_WORKSPACES[alert.type] || alert.action_url)
      return
    }
    setAlertDetail({ alert, loading: true, error: '', guests: [] })
    try {
      const response = await api.resultsAlertGuests(eventId, alert.id)
      setAlertDetail({ alert, loading: false, error: '', guests: response.guests || [] })
    } catch (err) {
      setAlertDetail({ alert, loading: false, error: err.message || 'Could not load the affected guests.', guests: [] })
    }
  }

  return (
    <>
    <section className="er-ops-dashboard">
      <aside className="er-ops-rail">
        <div className="er-ops-rail-title"><i /><span>Live status</span></div>
        {[
          ['On site now', onSite, 'users', `${occupancyRate}% of ${selectedVenue ? 'capacity' : 'expected'}`, 'green'],
          ['Checked in', attendance.checked_in, 'check', `${arrivalRate}% of expected`, 'teal'],
          ['Arrival rate', `${arrivalRate}%`, 'trend', `${attendance.checked_in} arrivals`, 'amber'],
          [arrivalGapLabel, attendance.confirmed_not_here, 'clock', 'Still expected', 'red'],
          ['Walk-ins', attendance.walk_ins, 'plus', 'Added at the door', 'green'],
          ['Checked out', attendance.checked_out, 'external', 'Exit scans', 'blue'],
        ].map(([label, value, icon, detail, tone]) => (
          <div key={label} className={`er-ops-rail-stat er-tone-${tone}`}>
            <span><Icon name={icon} size={15} /></span>
            <div><small>{label}</small><strong>{value ?? '—'}</strong><em>{detail}</em></div>
          </div>
        ))}
        <a className="er-ops-rail-action" href="/scanner-redesign"><Icon name="ticket" size={15} /> Open scanner <Icon name="arrow" size={13} /></a>
      </aside>

      <div className="er-ops-main">
        <div className="er-ops-toolbar">
          <span>{hasScopeFilter ? 'Filtered operational view' : 'Entire event operational view'}</span>
          <label className="er-ops-refresh">
            <Icon name="trend" size={13} /> Auto refresh
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            <i />
          </label>
        </div>

        <div className="er-ops-kpis">
          <MetricTile icon="users" label="Expected" value={attendance.expected} detail="Event total" tone="neutral"
            title="Invited guests who have not declined." />
          <MetricTile icon="check" label="Checked in" value={attendance.checked_in} detail={`${attendance.first_time ?? attendance.checked_in} first arrivals`}
            values={cumulative} tone="green" title="Distinct guests with an accepted entry or legacy admission." />
          <MetricTile icon="trend" label="Arrival rate" value={`${arrivalRate}%`} detail={`${attendance.checked_in} of ${attendance.expected}`}
            values={cumulative.map((value) => pct(value, attendance.expected))} tone="teal" />
          <MetricTile icon="clock" label={arrivalGapLabel} value={attendance.confirmed_not_here} detail="Still expected"
            values={reverseGap} tone="amber" />
          <MetricTile icon="plus" label="Walk-ins" value={attendance.walk_ins} detail="Added at the door" tone="green" />
          <MetricTile icon="external" label="Checked out" value={attendance.checked_out} detail="Accepted exits"
            values={exits} tone="blue" />
        </div>

        <div className="er-ops-top-grid">
          <article className="er-ops-panel er-ops-arrival-panel">
            <div className="er-ops-panel-head">
              <div><h2>Arrival pulse</h2><p>First arrivals, return scans, and an even expected pace</p></div>
              <span className="er-ops-scope-chip">{venueId ? selectedVenue?.name : 'All entrances'}</span>
            </div>
            <ArrivalPulse hourly={hourly} expected={attendance.expected} />
          </article>

          <div className="er-ops-stack">
            <article className="er-ops-panel er-ops-occupancy-card">
              <div className="er-ops-panel-head"><div><h2>Venue occupancy</h2><p>{selectedVenue?.name || 'Current event occupancy'}</p></div></div>
              <div className="er-ops-donut-row">
                <div className="er-ops-donut" style={{ '--er-value': `${occupancyRate * 3.6}deg` }}>
                  <div><strong>{onSite ?? '—'}</strong><span>On site now</span></div>
                </div>
                <div className="er-ops-occupancy-numbers">
                  <strong>{occupancyRate}%</strong><span>of {selectedVenue ? 'capacity' : 'expected'}</span>
                  <b>{occupancyCapacity || '—'}</b><span>{selectedVenue ? 'Venue capacity' : 'Expected guests'}</span>
                </div>
              </div>
              <div className="er-ops-card-foot"><span>Capacity remaining</span><b>{capacityRemaining ?? '—'}</b></div>
            </article>

            <article className="er-ops-panel er-ops-groups-card">
              <div className="er-ops-panel-head"><div><h2>Table group readiness</h2><p>Checked in against available seats</p></div></div>
              <div className="er-ops-panel-body">
                {groups.length ? groups.slice(0, 5).map((group) => (
                  <CapacityRow key={group.id} name={group.name} value={group.checked_in} capacity={group.capacity}
                    detail={`${group.assigned} assigned`} />
                )) : <div className="er-ops-empty compact">No table groups configured.</div>}
              </div>
            </article>

            {data.consent && (
              <article className="er-ops-panel er-ops-consent-card">
                <div className="er-ops-panel-head"><div><h2>Consent signed</h2><p>Entire-event completion</p></div></div>
                <div className="er-ops-panel-body">
                  <CapacityRow name="Consent" value={data.consent.signed} capacity={data.consent.eligible}
                    detail={`${data.consent.rate}% complete`} />
                  <div className="er-ops-card-foot"><span>Expected</span><b>{data.consent.eligible}</b></div>
                  <div className="er-ops-card-foot"><span>Signed</span><b>{data.consent.signed}</b></div>
                  <div className="er-ops-card-foot"><span>Not yet signed</span><b>{data.consent.eligible - data.consent.signed}</b></div>
                </div>
              </article>
            )}
          </div>

          <article className="er-ops-panel er-ops-alerts-card">
            <div className="er-ops-panel-head">
              <div><h2>Action queue</h2><p>Items requiring an operator</p></div>
              <span className={`er-ops-alert-count${alerts.length ? '' : ' clear'}`}>{alerts.length}</span>
            </div>
            <div className="er-ops-alert-list">
              {alerts.length ? alerts.slice(0, 5).map((alert) => (
                <button key={alert.id} className={`er-ops-alert er-severity-${alert.severity}`} onClick={() => openAlert(alert)}>
                  <span className="er-ops-alert-icon"><Icon name={alertIcon[alert.type] || 'info'} size={15} /></span>
                  <span className="er-ops-alert-copy"><b>{alert.title}</b><small>{alert.description}</small></span>
                  <em>{alert.severity}</em>
                  <strong>{alert.count}</strong>
                  <Icon name="arrow" size={13} />
                </button>
              )) : (
                <div className="er-ops-all-clear"><Icon name="check" size={18} /><b>All clear</b><span>Nothing needs attention right now.</span></div>
              )}
            </div>
          </article>
        </div>

        <div className="er-ops-bottom-grid">
          <article className="er-ops-panel er-ops-funnel-card">
            <div className="er-ops-panel-head"><div><h2>RSVP conversion funnel</h2><p>Entire-event invitation journey</p></div></div>
            <div className="er-ops-funnel">
              {funnelItems.map(([label, value, icon], index) => (
                <div className="er-ops-funnel-wrap" key={label}>
                  <div className="er-ops-funnel-node">
                    <span><Icon name={icon} size={15} /></span>
                    <small>{label}</small>
                    <strong>{value ?? 0}</strong>
                    <em>{index ? `${pct(value, funnel.guests)}%` : 'Event total'}</em>
                  </div>
                  {index < funnelItems.length - 1 && <Icon name="arrow" size={15} className="er-ops-funnel-arrow" />}
                </div>
              ))}
            </div>
            <div className="er-ops-funnel-track"><i style={{ width: `${pct(funnel.checked_in, funnel.guests)}%` }} /></div>
          </article>

          <article className="er-ops-panel er-ops-comm-card">
            <div className="er-ops-panel-head"><div><h2>Communications delivery</h2><p>Entire-event channel reach</p></div></div>
            <div className="er-ops-panel-body">
              {['email', 'sms', 'whatsapp', 'mms'].filter((channel) => channel !== 'mms' || data.communication.mms?.sent > 0).map((channel) => {
                const item = data.communication[channel] || {}
                const label = channel === 'email' ? 'Email' : channel === 'sms' ? 'SMS' : channel === 'mms' ? 'MMS' : 'WhatsApp'
                return (
                  <div className="er-ops-channel" key={channel}>
                    <span><Icon name={channel === 'email' ? 'mail' : channel === 'whatsapp' ? 'whatsapp' : 'message'} size={14} />{label}</span>
                    <div><i style={{ width: `${item.rate || 0}%` }} /></div>
                    <b>{item.rate == null ? '—' : `${item.rate}%`}</b>
                  </div>
                )
              })}
              {data.communication.email?.breakdown?.tracked > 0 && (
                <div className="er-ops-email-outcomes">
                  <span>{data.communication.email.breakdown.delivered} delivered</span>
                  <span>{data.communication.email.breakdown.opened + data.communication.email.breakdown.clicked} engaged</span>
                  <span>{data.communication.email.breakdown.bounced + data.communication.email.breakdown.failed} failed</span>
                </div>
              )}
              {(data.communication.sms?.sent > 0 || data.communication.whatsapp?.sent > 0) && (
                <div className="er-ops-email-outcomes">
                  {data.communication.sms?.sent > 0 && <span>SMS: {data.communication.sms.delivered} delivered · {data.communication.sms.failed} failed</span>}
                  {data.communication.whatsapp?.sent > 0 && <span>WhatsApp: {data.communication.whatsapp.delivered} delivered · {data.communication.whatsapp.failed} failed</span>}
                </div>
              )}
              {(() => {
                const bc = data.communication.broadcast || {}
                const active = ['email', 'sms', 'whatsapp', 'mms'].filter((ch) => bc[ch]?.sent > 0)
                if (!active.length) return null
                return (
                  <>
                    <div className="er-ops-card-foot" style={{ marginTop: 10 }}><span>Broadcast delivery</span><b>Sent via Messages tab</b></div>
                    <div className="er-ops-email-outcomes">
                      {active.map((ch) => {
                        const item = bc[ch]
                        const label = ch === 'email' ? 'Email' : ch === 'sms' ? 'SMS' : ch === 'mms' ? 'MMS' : 'WhatsApp'
                        const delivered = ch === 'email' ? item.reached : item.delivered
                        return <span key={ch}>{label}: {delivered} delivered{ch !== 'email' ? ` · ${item.failed} failed` : ''} ({item.sent} sent)</span>
                      })}
                    </div>
                  </>
                )
              })()}
              <div className="er-ops-card-foot"><span>Credits remaining</span><b>{data.communication.credits_remaining}</b></div>
              <div className="er-ops-quick-actions">
                <a href="/scanner-redesign"><Icon name="ticket" size={14} />Open scanner<Icon name="arrow" size={12} /></a>
                {event?.experience_enabled && <a href="/experience-redesign"><Icon name="layers" size={14} />Open Experience<Icon name="arrow" size={12} /></a>}
                <a href="/communications-redesign"><Icon name="send" size={14} />Broadcast update<Icon name="arrow" size={12} /></a>
                <a href="/floorplan-redesign"><Icon name="grid" size={14} />View floor plan<Icon name="arrow" size={12} /></a>
                <button onClick={() => window.print()}><Icon name="upload" size={14} />Export report<Icon name="arrow" size={12} /></button>
              </div>
            </div>
          </article>

          <article className="er-ops-panel er-ops-program-card">
            <div className="er-ops-panel-head"><div><h2>Program</h2><p>Live schedule status</p></div></div>
            <div className="er-ops-panel-body">
              {currentProgram ? (
                <div className="er-ops-program-block current">
                  <span>Current · {currentProgram.start_time}{currentProgram.end_time ? ` – ${currentProgram.end_time}` : ''}</span>
                  <strong>{currentProgram.topic}</strong>
                  <div className="er-ops-program-progress"><i /></div>
                </div>
              ) : <div className="er-ops-program-empty">No segment in progress.</div>}
              {nextProgram && (
                <div className="er-ops-program-block">
                  <span>Next up · {nextProgram.start_time || 'Time not set'}</span>
                  <strong>{nextProgram.topic}</strong>
                </div>
              )}
              <button className="er-ops-text-action" onClick={() => setActiveTab('program')}>Open program <Icon name="arrow" size={13} /></button>
            </div>
          </article>

          <article className="er-ops-panel er-ops-activity-card">
            <div className="er-ops-panel-head"><div><h2>Live activity</h2><p>{venueId ? selectedVenue?.name : 'All entrances'}</p></div><span className="er-ops-live-mini"><i />Live</span></div>
            <div className="er-ops-activity-list">
              {(data.recent_activity || []).slice(0, 6).map((item, index) => (
                <div className="er-ops-activity" key={`${item.guest_name}-${item.at}-${index}`}>
                  <span className={item.action.includes('out') ? 'blue' : item.action.includes('Walk') ? 'amber' : 'green'}>
                    <Icon name={item.action.includes('out') ? 'external' : item.action.includes('Walk') ? 'plus' : 'check'} size={12} />
                  </span>
                  <div><b>{item.guest_name}</b><small>{item.action}{item.location ? ` · ${item.location}` : ''}</small></div>
                  <time>{fmtActivityTime(item.at, event?.timezone)}</time>
                </div>
              ))}
              {!(data.recent_activity || []).length && <div className="er-ops-empty compact">No activity recorded yet.</div>}
            </div>
            <button className="er-ops-text-action" onClick={() => setActiveTab('attendance')}>View attendance <Icon name="arrow" size={13} /></button>
          </article>
        </div>
      </div>
    </section>
    <AlertDetailModal
      eventId={eventId}
      state={alertDetail}
      onClose={() => setAlertDetail(null)}
      onNavigate={navigate}
    />
    </>
  )
}

export default function EventResultsRedesignPage() {
  const [currentEventId, setCurrentEventId] = useCurrentEvent()
  const [events, setEvents] = useState([])
  const [eventId, setEventId] = useState(currentEventId || '')
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedView = searchParams.get('view') || searchParams.get('layout') || searchParams.get('tab')
  const allViews = RESULTS_NAV.flatMap((group) => group.items.map((item) => item.id))
  const legacyView = { overview: 'executive', invitations: 'registration', program: 'programme', experience: 'engagement', meals: 'operations' }[requestedView] || requestedView
  const [activeView, setActiveViewState] = useState(allViews.includes(legacyView) ? legacyView : 'executive')
  const setActiveView = (id) => {
    setActiveViewState(id)
    setSearchParams((prev) => { const next = new URLSearchParams(prev); next.delete('tab'); next.delete('layout'); next.set('view', id); return next })
  }
  const setActiveTab = (id) => setActiveView({ invitations: 'registration', program: 'programme', experience: 'engagement', meals: 'operations' }[id] || id)
  const setOverviewLayout = setActiveView
  const [day, setDay] = useState('')
  const [venueId, setVenueId] = useState('')
  const [zones, setZones] = useState([])
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [connected, setConnected] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [now, setNow] = useState(() => new Date())
  const esRef = useRef(null)

  useEffect(() => {
    api.listEvents().then((evs) => {
      setEvents(evs)
      if (!eventId && evs.length) setEventId(currentEventId && evs.some((e) => e.id === currentEventId) ? currentEventId : evs[0].id)
    }).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!eventId) { setZones([]); return }
    api.listZones(eventId).then(setZones).catch(() => setZones([]))
  }, [eventId])

  const load = useCallback(async (id, d, v) => {
    if (!id) return
    try {
      setData(await api.resultsCommandCenter(id, { day: d || undefined, venueId: v || undefined }))
      setUpdatedAt(new Date())
      setError('')
    } catch (err) {
      setError(err.message || 'Results are temporarily unavailable.')
    }
  }, [])

  useEffect(() => {
    if (!eventId) { setData(null); return }
    load(eventId, day, venueId)
    if (!autoRefresh) return undefined
    const poll = setInterval(() => load(eventId, day, venueId), 20000)
    return () => clearInterval(poll)
  }, [eventId, day, venueId, load, autoRefresh])

  useEffect(() => {
    const tick = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(tick)
  }, [])

  // Real live updates: same authenticated admission SSE stream DashboardPage/
  // ResultsPage use — any admission triggers an immediate refetch.
  useEffect(() => {
    if (!eventId) { setConnected(false); return }
    let es, closed = false
    ;(async () => {
      let token = ''
      try { token = (await auth.currentUser?.getIdToken()) || '' } catch { /* not signed in */ }
      if (closed) return
      es = new EventSource(`/api/events/${eventId}/stream?token=${encodeURIComponent(token)}`)
      esRef.current = es
      es.onopen = () => setConnected(true)
      es.onerror = () => setConnected(false)
      es.onmessage = () => load(eventId, day, venueId)
    })()
    return () => { closed = true; if (es) es.close(); setConnected(false) }
  }, [eventId, day, venueId, load])

  const event = events.find((e) => e.id === eventId)
  const a = data?.attendance
  const days = data?.attendance_by_day || []
  const hasScopeFilter = Boolean(day || venueId)
  const arrivalGapLabel = venueId ? 'Confirmed, not in zone' : a?.arrival_gap_mode === 'expected' ? 'Not yet in' : 'Confirmed, not here'
  function changeEvent(nextEventId) {
    setEventId(nextEventId)
    setCurrentEventId(nextEventId)
    setDay('')
    setVenueId('')
  }

  return (
    <RedesignShell topActive="results" withEventSidebar={false}>
      {!eventId ? <LoadingSkeleton rows={4} variant="card" /> : error ? (
        <div className="rd-panel"><div className="rd-panel-body"><p className="rd-rowlink">{error}</p></div></div>
      ) : !data ? <LoadingSkeleton rows={4} variant="card" /> : (
        <div className="er-results-shell">
          <ResultsSidebar event={event} activeView={activeView} onChange={setActiveView} exceptionCount={(data.alerts || []).length} />
          <main className="er-results-content">
            <ResultsPageHeader activeView={activeView} />
            {(days.length > 1 || zones.length > 0) && (
              <div className="er-scope-bar">
                {days.length > 1 && <div className="er-scope-days"><button className={!day ? 'active' : ''} onClick={() => setDay('')}>Entire event</button>{days.map((d, i) => <button key={d.day} className={day === d.day ? 'active' : ''} onClick={() => setDay(d.day)}>Day {i + 1} · {fmtDay(d.day)}</button>)}</div>}
                {zones.length > 0 && <select className="rr-select" style={{ marginBottom: 0 }} value={venueId} onChange={(e) => setVenueId(e.target.value)}><option value="">All venues</option>{zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</select>}
              </div>
            )}
            {activeView === 'executive' && a && <ExecutiveResultsOverview event={event} data={data} attendance={a} setActiveTab={setActiveTab} setOverviewLayout={setOverviewLayout} />}
            {activeView === 'command' && a && <><ResultsHero event={event} events={events} eventId={eventId} connected={connected} now={now} updatedAt={updatedAt} onEventChange={changeEvent}/><OverviewDashboard event={event} eventId={eventId} data={data} attendance={a} zones={zones} venueId={venueId} hasScopeFilter={hasScopeFilter} arrivalGapLabel={arrivalGapLabel} autoRefresh={autoRefresh} setAutoRefresh={setAutoRefresh} setActiveTab={setActiveTab}/></>}
            {activeView === 'services' && a && <AllServicesResultsSnapshot event={event} data={data} attendance={a} setActiveTab={setActiveTab} />}
            {activeView === 'exceptions' && <ExceptionsResultsView data={data} />}
            {activeView === 'registration' && <InvitationsTab eventId={eventId} />}
            {activeView === 'communications' && <InvitationsTab eventId={eventId} />}
            {activeView === 'attendance' && <AttendanceTab eventId={eventId} day={day} venueId={venueId} />}
            {activeView === 'programme' && <ProgramTab eventId={eventId} day={day} />}
            {activeView === 'engagement' && <ResultsWorkspaceView kind="engagement" enabled={!!event?.engagement_enabled} />}
            {activeView === 'operations' && <OperationsTab eventId={eventId} />}
            {activeView === 'revenue' && <ResultsWorkspaceView kind="revenue" />}
            {activeView === 'giving' && <ResultsWorkspaceView kind="giving" enabled={!!event?.registry_enabled || !!event?.engagement_enabled} />}
            {activeView === 'feedback' && <ResultsWorkspaceView kind="feedback" enabled={!!event?.engagement_enabled || !!event?.experience_enabled} />}
            {activeView === 'closeout' && <CloseoutResultsView event={event} data={data} />}
          </main>
        </div>
      )}
    </RedesignShell>
  )
}
