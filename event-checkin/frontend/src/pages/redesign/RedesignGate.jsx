import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { api } from '../../api'
import { useAuth } from '../../context/AuthContext'
import { useCurrentEvent } from '../../hooks/useCurrentEvent'
import { getUiPreference, preferenceFromSearch, setUiPreference } from './uiPreference'
import { logFeatureFlagCohort } from './redesignTelemetry'

// ── RedesignGate ──────────────────────────────────────────────────────────────
// Wraps a legacy route element. If the user's organisation is on the
// 'redesign_default' or 'legacy_retired' cohort, silently redirects to the
// given redesignRoute instead of rendering the legacy page.
//
// Rules:
//  - Platform superadmins are never auto-redirected (they need to test both).
//  - While the event list is loading a minimal spinner is shown — the legacy
//    page never flashes before the redirect fires.
//  - If the event list call fails the legacy page is shown (safe fallback).
//
// Usage in App.jsx:
//   <RedesignGate redesignRoute="/admin-redesign"><AdminPage /></RedesignGate>

const AUTO_REDIRECT_COHORTS = new Set(['redesign_default', 'legacy_retired'])

export default function RedesignGate({ redesignRoute, children }) {
  const { user } = useAuth()
  const location = useLocation()
  const [currentEventId] = useCurrentEvent()
  const requestedPreference = preferenceFromSearch(location.search)
  const [uiPreference, setLocalUiPreference] = useState(
    () => requestedPreference || getUiPreference(),
  )
  // null = still loading, string = resolved cohort
  const [cohort, setCohort] = useState(null)

  useEffect(() => {
    if (!requestedPreference) return
    setUiPreference(requestedPreference)
    setLocalUiPreference(requestedPreference)
  }, [requestedPreference])

  useEffect(() => {
    let cancelled = false
    if (!user || !currentEventId) {
      // No event selected — stay on legacy (no event context to gate on).
      setCohort('legacy_only')
      return
    }
    api.listEvents()
      .then((evs) => {
        if (cancelled) return
        const ev = evs.find((e) => e.id === currentEventId)
        const resolved = ev?.my_redesign_cohort ?? 'legacy_only'
        setCohort(resolved)
        logFeatureFlagCohort({ orgId: ev?.organization_id, eventId: currentEventId, cohort: resolved })
      })
      .catch(() => {
        if (!cancelled) setCohort('legacy_only')
      })
    return () => { cancelled = true }
  }, [user, currentEventId])

  // An explicit legacy choice always wins over cohort defaults. This is the
  // operational rollback path exposed by the redesign shell.
  if (uiPreference === 'legacy' || requestedPreference === 'legacy') {
    return children
  }

  // Still resolving — show a minimal inline loader rather than mounting the
  // legacy page (avoids a visible flash before redirect).
  if (cohort === null) {
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

  // Superadmins are excluded from auto-redirect so they can test both UIs.
  if (!user?.is_platform_superadmin && AUTO_REDIRECT_COHORTS.has(cohort)) {
    return <Navigate to={redesignRoute} replace />
  }

  return children
}
