import { useEffect, useState } from 'react'
import { LoadingSkeleton } from '../RedesignPrimitives'
import { api } from '../../../api'

// Standalone build-out of the real Operations tab (ResultsPage.jsx:1054-1108),
// fed directly by GET /api/results/events/{id}/analytics/operations
// (api.resultsOperations). Backend handler (dashboard-service/app/main.py
// get_operations(), ~line 941) assembles four independently-gated pieces:
//   - meals: {categories, eligible_total, served_total, missing_selection}
//       from meals_breakdown() — categories is [] when event.menu_enabled
//       is false (or no non-display-only categories exist).
//   - consent: {eligible, signed, rate} | null from consent_status() — null
//       when event.experience_enabled is false or no consent step exists.
//   - denied_scans: {total, by_reason: [{reason, count}]} from
//       denied_scans_breakdown() — total is 0 and by_reason is [] when there
//       are no denied scans; always present (not feature-gated).
//   - venue_occupancy: [{id, name, occupancy, capacity}] from
//       venue_occupancy() — [] when event.venue_access_enabled is false or
//       no active zones are configured.
//   - festio_live: {activities, participants, responses} | null from
//       festio_live_participation() — null when event.engagement_enabled is
//       false, the shared engagement token isn't configured, or the call to
//       engagement-service fails/times out for any reason (that service is
//       independently deployed with its own database; an outage there must
//       never break this report).
// The real page's ProgressBar (label/completed/total, teal fill, "n/total"
// caption) is reproduced here with er-chan-row + rd-mini-bar, matching the
// bar pattern already used for zones/channels/experience steps on the wired
// Overview tab, rather than introducing a new bar component. Its
// OccupancyBar (name/occupancy/capacity, color escalates teal→amber→red as
// it nears/exceeds capacity, dim static bar when capacity is 0/unset) is
// reproduced the same way for parity with the legacy page.

function pct(part, total) {
  return total ? Math.min(100, Math.round((part / total) * 100)) : 0
}

function ProgressRow({ label, completed, total }) {
  return (
    <div className="er-chan-row">
      <span style={{ minWidth: 90 }}>{label}</span>
      <div className="rd-mini-bar" style={{ flex: 1, margin: '0 10px' }}><i style={{ width: `${pct(completed, total)}%` }} /></div>
      <b>{completed}/{total}</b>
    </div>
  )
}

// rd-mini-bar's fill color is fixed to var(--teal) in RedesignShell.css (a
// shared file this task must not touch), so the occupancy escalation
// (teal → amber → red as a zone nears/exceeds capacity, matching the real
// OccupancyBar) is applied here as an inline background override rather
// than new CSS modifier classes.
function OccupancyRow({ name, occupancy, capacity }) {
  const p = pct(occupancy, capacity)
  const color = !capacity ? 'var(--surface-4, #cbd5e1)' : p >= 100 ? '#ef4444' : p >= 90 ? '#f59e0b' : 'var(--teal)'
  return (
    <div className="er-chan-row">
      <span style={{ minWidth: 90 }}>{name}</span>
      <div className="rd-mini-bar" style={{ flex: 1, margin: '0 10px' }}>
        <i style={{ width: `${capacity ? p : 100}%`, background: color, opacity: capacity ? 1 : 0.4 }} />
      </div>
      <b>{occupancy}{capacity ? `/${capacity}` : ''}</b>
    </div>
  )
}

export default function OperationsTab({ eventId }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!eventId) { setData(null); return }
    let cancelled = false
    setLoading(true)
    setError('')
    api.resultsOperations(eventId)
      .then((res) => { if (!cancelled) { setData(res); setLoading(false) } })
      .catch((err) => { if (!cancelled) { setError(err.message || 'Operations data is temporarily unavailable.'); setLoading(false) } })
    return () => { cancelled = true }
  }, [eventId])

  if (loading) return <LoadingSkeleton rows={4} variant="card" />

  if (error) {
    return (
      <div className="rd-panel">
        <div className="rd-panel-body"><p className="rd-rowlink">{error}</p></div>
      </div>
    )
  }

  if (!data) return null

  const { meals, consent, denied_scans: deniedScans, venue_occupancy: occupancy, festio_live: festioLive } = data

  return (
    <div>
      <div className="rr-grid2">
        <div className="rd-panel">
          <div className="rd-panel-head"><h3>Meals served</h3></div>
          <div className="rd-panel-body">
            {meals.categories.length === 0 ? (
              <p className="rd-rowlink">Not applicable for this event.</p>
            ) : (
              <>
                <ProgressRow label="All categories" completed={meals.served_total} total={meals.eligible_total} />
                {meals.missing_selection > 0 && (
                  <div className="er-provider-row" style={{ marginTop: 8 }}>
                    <span>Missing selection</span><b>{meals.missing_selection}</b>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="rd-panel">
          <div className="rd-panel-head"><h3>Consent signed</h3></div>
          <div className="rd-panel-body">
            {!consent ? (
              <p className="rd-rowlink">No consent step configured.</p>
            ) : (
              <>
                <ProgressRow label="Consent" completed={consent.signed} total={consent.eligible} />
                <div className="er-provider-row" style={{ marginTop: 8 }}>
                  <span>Expected</span><b>{consent.eligible}</b>
                </div>
                <div className="er-provider-row">
                  <span>Signed</span><b>{consent.signed}</b>
                </div>
                <div className="er-provider-row">
                  <span>Not yet signed</span><b>{consent.eligible - consent.signed}</b>
                </div>
                <div className="er-provider-row">
                  <span>Completion rate</span><b>{consent.rate}%</b>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="rr-grid2" style={{ marginTop: 14 }}>
        <div className="rd-panel">
          <div className="rd-panel-head"><h3>Denied scans</h3><p>{deniedScans.total} total</p></div>
          <div className="rd-panel-body">
            {deniedScans.by_reason.length === 0 ? (
              <p className="rd-rowlink">No denied scans.</p>
            ) : (
              deniedScans.by_reason.map((r) => (
                <div key={r.reason} className="er-provider-row">
                  <span>{r.reason}</span><b>{r.count}</b>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rd-panel">
          <div className="rd-panel-head"><h3>Zone occupancy</h3></div>
          <div className="rd-panel-body">
            {occupancy.length === 0 ? (
              <p className="rd-rowlink">No zones configured for this event.</p>
            ) : (
              occupancy.map((z) => <OccupancyRow key={z.id} {...z} />)
            )}
          </div>
        </div>
      </div>

      <div className="rr-grid2" style={{ marginTop: 14 }}>
        <div className="rd-panel">
          <div className="rd-panel-head"><h3>Festio Live participation</h3></div>
          <div className="rd-panel-body">
            {!festioLive ? (
              <p className="rd-rowlink">Festio Live is not enabled for this event, or no activity data yet.</p>
            ) : (
              <>
                <div className="er-provider-row"><span>Activities run</span><b>{festioLive.activities}</b></div>
                <div className="er-provider-row"><span>Participants</span><b>{festioLive.participants}</b></div>
                <div className="er-provider-row"><span>Responses</span><b>{festioLive.responses}</b></div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
