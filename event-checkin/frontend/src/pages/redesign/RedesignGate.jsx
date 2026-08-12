import { useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { getUiPreference, preferenceFromSearch, setUiPreference } from './uiPreference'
import { logFallbackToLegacy } from './redesignTelemetry'

// ── RedesignGate ──────────────────────────────────────────────────────────────
// Wraps a legacy route element. Legacy is now retired for everyone except
// platform superadmins — non-superadmins are always redirected to the
// redesign route, full stop.
//
// This used to be decided per-org/per-event via a "redesign_cohort" fetched
// from api.listEvents(), but that chain had a standing gap: a brand-new
// organizer with zero events (or a stale/invalid currentEventId left over in
// localStorage) had no event to resolve a cohort from, and silently fell
// back to legacy — repeatedly locking new signups out of the redesign UI.
// Rather than keep patching edge cases in that resolution chain, legacy is
// now unreachable for regular users regardless of cohort/event state.
//
// Rules:
//  - Non-superadmins: always redirected to redesignRoute. No escape hatch —
//    ?ui=legacy and the stored UI preference no longer apply to them.
//  - Superadmins: default to redesign too, but can still reach legacy via
//    ?ui=legacy (persisted) or ?ui=redesign to switch back — this is the
//    operational/debug path for comparing the two UIs.
//  - The one-shot `location.state.forceLegacy` punt (a redesign page
//    deliberately sending a user to a legacy page for a feature not yet
//    ported) still works for everyone — it's not a user-facing loophole,
//    it's how incomplete redesign stages stay usable during the migration.
//
// Usage in App.jsx:
//   <RedesignGate redesignRoute="/admin-redesign"><AdminPage /></RedesignGate>

export default function RedesignGate({ redesignRoute, children }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  const requestedPreference = preferenceFromSearch(location.search)
  const [uiPreference] = useState(() => {
    if (requestedPreference) {
      setUiPreference(requestedPreference)
      return requestedPreference
    }
    return getUiPreference()
  })

  // One-shot bypass for a single navigation (e.g. a redesign page punting to
  // its not-yet-built legacy counterpart). Never persisted, applies to
  // everyone regardless of superadmin status.
  if (location.state?.forceLegacy) {
    return children
  }

  // Still resolving auth — avoid a flash of legacy before we know who's asking.
  if (loading) {
    return (
      <div
        role="status"
        aria-live="polite"
        style={{ minHeight: '45vh', display: 'grid', placeItems: 'center', fontSize: 14, color: 'var(--muted, #6b7280)' }}
      >
        Loading…
      </div>
    )
  }

  if (!user?.is_platform_superadmin) {
    return <Navigate to={redesignRoute} replace />
  }

  // Superadmin from here on — explicit legacy preference wins.
  if (uiPreference === 'legacy') {
    logFallbackToLegacy({ route: location.pathname, reason: 'superadmin_ui_preference' })
    return children
  }

  return <Navigate to={redesignRoute} replace />
}
