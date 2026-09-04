import { useState, useEffect, useRef, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import RedesignShell, { Icon, Modal } from './redesign/RedesignShell'
import { LoadingSkeleton } from './redesign/RedesignPrimitives'
import { useCurrentEvent } from '../hooks/useCurrentEvent'
import { api } from '../api'
import { auth } from '../firebase'
import AttendanceTab from './redesign/results/AttendanceTab'
import InvitationsTab from './redesign/results/InvitationsTab'
import MealsTab from './redesign/results/MealsTab'
import ProgramTab from './redesign/results/ProgramTab'
import ExperienceTab from './redesign/results/ExperienceTab'
import OperationsTab from './redesign/results/OperationsTab'
import './EventResultsRedesignPage.css'

// Live operations command center backed by dashboard-service's
// /api/results/* endpoints. All seven tabs are wired to production data.

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'invitations', label: 'Invitations' },
  { id: 'meals', label: 'Meals' },
  { id: 'program', label: 'Program' },
  { id: 'experience', label: 'Experience' },
  { id: 'operations', label: 'Operations' },
]

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
  const requestedTab = searchParams.get('tab')
  const [activeTab, setActiveTabState] = useState(TABS.some((t) => t.id === requestedTab) ? requestedTab : 'overview')
  const setActiveTab = (id) => { setActiveTabState(id); setSearchParams((prev) => { const next = new URLSearchParams(prev); next.set('tab', id); return next }) }
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
      <ResultsHero
        event={event}
        events={events}
        eventId={eventId}
        connected={connected}
        now={now}
        updatedAt={updatedAt}
        onEventChange={changeEvent}
      />

      {!eventId ? <LoadingSkeleton rows={4} variant="card" /> : error ? (
        <div className="rd-panel"><div className="rd-panel-body"><p className="rd-rowlink">{error}</p></div></div>
      ) : !data ? <LoadingSkeleton rows={4} variant="card" /> : (
      <>
      {(days.length > 1 || zones.length > 0) && (
        <div className="er-scope-bar">
          {days.length > 1 && (
            <div className="er-scope-days">
              <button className={!day ? 'active' : ''} onClick={() => setDay('')}>Entire event</button>
              {days.map((d, i) => (
                <button key={d.day} className={day === d.day ? 'active' : ''} onClick={() => setDay(d.day)}>Day {i + 1} · {fmtDay(d.day)}</button>
              ))}
            </div>
          )}
          {zones.length > 0 && (
            <select className="rr-select" style={{ marginBottom: 0 }} value={venueId} onChange={(e) => setVenueId(e.target.value)}>
              <option value="">All venues</option>
              {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
          )}
        </div>
      )}

      <div className="er-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={activeTab === t.id} className={activeTab === t.id ? 'active' : ''} onClick={() => setActiveTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && a && (
        <OverviewDashboard
          event={event}
          eventId={eventId}
          data={data}
          attendance={a}
          zones={zones}
          venueId={venueId}
          hasScopeFilter={hasScopeFilter}
          arrivalGapLabel={arrivalGapLabel}
          autoRefresh={autoRefresh}
          setAutoRefresh={setAutoRefresh}
          setActiveTab={setActiveTab}
        />
      )}

      {activeTab === 'attendance' && <AttendanceTab eventId={eventId} day={day} venueId={venueId} />}
      {activeTab === 'invitations' && <InvitationsTab eventId={eventId} />}
      {activeTab === 'meals' && <MealsTab eventId={eventId} />}
      {activeTab === 'program' && <ProgramTab eventId={eventId} day={day} />}
      {activeTab === 'experience' && <ExperienceTab eventId={eventId} />}
      {activeTab === 'operations' && <OperationsTab eventId={eventId} />}
      </>
      )}
    </RedesignShell>
  )
}
