import { useEffect, useState } from 'react'
import { LoadingSkeleton } from '../RedesignPrimitives'
import { api } from '../../../api'

// Standalone build-out of the real Attendance tab (ResultsPage.jsx:896-938),
// fed directly by GET /api/results/events/{id}/analytics/attendance
// (api.resultsAttendance) rather than the full command-center payload the
// real page reuses. That endpoint's handler (dashboard-service/app/main.py
// attendance_stats(), ~line 315) returns the metrics flat on the response
// plus a `by_day` array (attendance_by_day()) — it does NOT include
// venue_occupancy (that's only assembled into the command-center response),
// so the "Occupancy by zone" panel the real page conditionally shows isn't
// reproducible from this endpoint alone and is intentionally omitted here.

function fmtDay(iso) {
  const d = new Date(`${iso}T00:00:00`)
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

function StatTile({ label, value, hint }) {
  return (
    <div className="rr-panel er-stat" title={hint}>
      <span>{label}</span><strong>{value}</strong>
    </div>
  )
}

function HourlyChart({ hourly }) {
  if (!hourly || hourly.length === 0) {
    return <p className="rd-rowlink">No scans recorded in this window yet.</p>
  }
  const max = Math.max(1, ...hourly.map((h) => h.first_arrival + h.returning + h.exit))
  return (
    <div className="er-arrival-chart">
      {hourly.map((h) => {
        const total = h.first_arrival + h.returning + h.exit
        return (
          <div className="er-arrival-col" key={h.hour} title={`${h.hour} — ${h.first_arrival} first, ${h.returning} returning, ${h.exit} exit`}>
            <div className="er-arrival-track">
              <div className="er-arrival-bar" style={{ height: `${(total / max) * 100}%` }} />
            </div>
            <span>{h.hour}</span>
          </div>
        )
      })}
    </div>
  )
}

export default function AttendanceTab({ eventId, day, venueId }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!eventId) { setData(null); return }
    let cancelled = false
    setLoading(true)
    setError('')
    api.resultsAttendance(eventId, { day, venueId })
      .then((res) => { if (!cancelled) { setData(res); setLoading(false) } })
      .catch((err) => { if (!cancelled) { setError(err.message || 'Attendance data is temporarily unavailable.'); setLoading(false) } })
    return () => { cancelled = true }
  }, [eventId, day, venueId])

  if (loading) return <LoadingSkeleton rows={4} variant="card" />

  if (error) {
    return (
      <div className="rd-panel">
        <div className="rd-panel-body"><p className="rd-rowlink">{error}</p></div>
      </div>
    )
  }

  if (!data) return null

  const a = data
  const days = data.by_day || []

  const arrivalGapLabel = venueId
    ? 'Confirmed, not in zone'
    : a.arrival_gap_mode === 'expected' ? 'Not yet in' : 'Confirmed, not here'
  const arrivalGapHint = venueId
    ? 'Guests confirmed as attending who have not been scanned into this zone.'
    : a.arrival_gap_mode === 'expected'
      ? "Invited guests who haven't declined and haven't been scanned in yet — this event doesn't track RSVP confirmation, so it can't be narrowed to just those who said yes."
      : "Guests who confirmed they're coming (accepted RSVP) but have not been scanned in yet — excludes declined and no-response guests."

  const occupancyLabel = a.occupancy_mode === 'historical' ? 'Occupancy at day close'
    : a.occupancy_mode === 'future' ? 'On-site (not started)' : 'On-site now'
  const occupancyHint = a.occupancy_mode === 'historical'
    ? 'Net entries minus exits as of the end of this past day — not a live count.'
    : a.occupancy_mode === 'future'
      ? "This day hasn't happened yet, so there's no occupancy to show."
      : 'Net entries minus exits right now: guests scanned in who have not since been scanned out.'

  return (
    <div>
      <div className="rr-grid4">
        <StatTile
          label={venueId ? 'Expected (event-wide)' : 'Expected'}
          value={a.expected}
          hint="Invited guests who haven't declined — not the same as 'confirmed'. A guest who never responds still counts as expected until they explicitly decline."
        />
        <StatTile
          label="Checked in"
          value={a.checked_in}
          hint="Guests with at least one accepted (non-denied) entry scan recorded in this scope."
        />
        <StatTile
          label={occupancyLabel}
          value={a.occupancy_mode === 'future' ? '—' : a.on_site}
          hint={occupancyHint}
        />
        <StatTile
          label="First-time"
          value={a.first_time}
          hint="Guests scanned in for the very first time within this scope."
        />
        <StatTile
          label="Returning"
          value={a.returning}
          hint="Guests who had already checked in before and are entering again (e.g. a multi-day event, or leaving and coming back)."
        />
        <StatTile
          label="Checked out"
          value={a.checked_out}
          hint="Guests with an accepted exit scan — they may still return."
        />
      </div>

      <div className="rr-grid3" style={{ marginTop: 14 }}>
        <StatTile label={arrivalGapLabel} value={a.confirmed_not_here} hint={arrivalGapHint} />
        <StatTile label="Declined" value={a.declined} hint="Guests who explicitly declined the invitation." />
        <StatTile label="Walk-ins" value={a.walk_ins} />
      </div>

      <div className="rd-panel" style={{ marginTop: 14 }}>
        <div className="rd-panel-head"><h3>Hourly arrivals &amp; exits — {day ? fmtDay(day) : 'entire event'}</h3></div>
        <div className="rd-panel-body">
          <HourlyChart hourly={a.hourly} />
        </div>
      </div>

      {days.length > 0 && (
        <div className="rd-panel" style={{ marginTop: 14 }}>
          <div className="rd-panel-head"><h3>Attendance by day</h3></div>
          <div className="rd-panel-body">
            <table className="rr-table">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Expected</th>
                  <th>Checked in</th>
                  <th>Attendance</th>
                </tr>
              </thead>
              <tbody>
                {days.map((d, i) => (
                  <tr key={d.day}>
                    <td>
                      Day {i + 1} · {fmtDay(d.day)}
                      {d.status === 'live' && (
                        <span className="rr-pill live" style={{ marginLeft: 8 }}><i /> Live</span>
                      )}
                    </td>
                    <td>{d.expected}</td>
                    <td>{d.status === 'upcoming' ? '—' : d.checked_in}</td>
                    <td>{d.status === 'upcoming' ? 'Upcoming' : `${d.attendance_rate}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
