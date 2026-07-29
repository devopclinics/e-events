import { useEffect, useState } from 'react'
import { Icon } from '../RedesignShell'
import { LoadingSkeleton } from '../RedesignPrimitives'
import { api } from '../../../api'

// Standalone Meals tab for the /results redesign command center
// (EventResultsRedesignPage.jsx wires this in — see that file's TAB_WIRED).
//
// Mirrors the real Meals tab: ResultsPage.jsx:998-1033. Backed by
// dashboard-service's GET /api/results/events/{id}/analytics/meals
// (app/main.py meals_breakdown(), ~line 780), which returns the FULL
// per-category breakdown:
//   { categories: [{ category_id, name, day_label, eligible, served,
//                     remaining, rate }],
//     eligible_total, served_total, missing_selection }
//
// This is a different (richer) shape than the small summary object the
// Overview tab's "Meals" card reads off the command-center payload
// (data.meals.categories / served_total / eligible_total) — that one is
// just enough for a teaser card, this endpoint has the real per-category
// numbers this tab needs.
//
// Per the backend comment directly above meals_breakdown(): eligible_total /
// served_total are DISTINCT-GUEST counts, not a sum of the per-category
// numbers — a guest eligible for breakfast, lunch, and dinner is one guest,
// not three. So the per-category rows and the headline tiles are rendered
// from separate fields on purpose; do not derive one from the other.

function StatTile({ label, value, sub, hint, tone }) {
  return (
    <div className={`rr-panel er-stat ${tone || ''}`} title={hint}>
      <span>{label}</span>
      <strong>{value}</strong>
      {sub && <small>{sub}</small>}
    </div>
  )
}

export default function MealsTab({ eventId }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!eventId) { setData(null); setError(''); return }
    let cancelled = false
    setData(null)
    setError('')
    api.resultsMeals(eventId).then((res) => {
      if (!cancelled) setData(res)
    }).catch((err) => {
      if (!cancelled) setError(err.message || 'Meal data is temporarily unavailable.')
    })
    return () => { cancelled = true }
  }, [eventId])

  if (error) {
    return (
      <div className="rd-panel">
        <div className="rd-panel-body"><p className="rd-rowlink">{error}</p></div>
      </div>
    )
  }

  if (data === null) {
    return (
      <div className="rd-panel">
        <div className="rd-panel-body"><LoadingSkeleton rows={4} variant="card" /></div>
      </div>
    )
  }

  if (data.categories.length === 0) {
    return (
      <div className="rd-panel">
        <div className="rd-panel-body">
          <p className="rd-rowlink">No selectable meal categories — this event's menu is display-only (informational), so there's nothing to serve.</p>
        </div>
      </div>
    )
  }

  const remainingTotal = data.eligible_total - data.served_total

  return (
    <div>
      <div className="rr-grid4">
        <StatTile label="Served" value={data.served_total} sub="Distinct guests"
          hint="Distinct guests with at least one meal category marked served, across all categories." />
        <StatTile label="Made a selection" value={data.eligible_total} sub="Distinct guests"
          hint="Distinct guests with at least one menu choice recorded — based on who actually picked something, regardless of RSVP status." />
        <StatTile label="Remaining to serve" value={remainingTotal}
          hint="Made a selection minus Served." />
        {data.missing_selection > 0 && (
          <StatTile label="No selection yet" value={data.missing_selection} sub="Not counted above"
            hint="Invited guests (not declined) with no menu choice on file — a different, and not necessarily overlapping, group from 'Made a selection', which only counts guests who did pick something." />
        )}
      </div>

      <div className="rd-panel" style={{ marginTop: 14 }}>
        <div className="rd-panel-head">
          <h3>By category</h3>
          <p>Guests who chose that category's item — a guest with 3 categories counts once per category here, but only once in the totals above.</p>
        </div>
        <div className="rd-panel-body">
          <table className="rr-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Eligible</th>
                <th>Served</th>
                <th>Remaining</th>
                <th>Progress</th>
              </tr>
            </thead>
            <tbody>
              {data.categories.map((c) => (
                <tr key={c.category_id}>
                  <td>{c.day_label ? `${c.name} — ${c.day_label}` : c.name}</td>
                  <td>{c.eligible}</td>
                  <td>{c.served}</td>
                  <td>{c.remaining}</td>
                  <td>
                    <div className="er-chan-row">
                      <div className="rd-mini-bar" style={{ flex: 1, marginRight: 10 }}>
                        <i style={{ width: `${c.rate ?? 0}%` }} />
                      </div>
                      <b>{c.rate ?? 0}%</b>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="rd-rowlink" style={{ marginTop: 10 }}>
            <Icon name="info" size={12} /> Mark guests served from the Menu panel's serving station in Event Setup — this tab is read-only.
          </p>
        </div>
      </div>
    </div>
  )
}
