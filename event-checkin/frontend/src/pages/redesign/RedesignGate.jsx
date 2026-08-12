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
//  - Superadmins follow cohort like any other user — no standing exemption.
//    Anyone (including staff) who wants legacy can use the explicit
//    "Switch to legacy UI" link (?ui=legacy), which always wins.
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
    if (!user) {
      setCohort('legacy_only')
      return
    }
    if (!currentEventId) {
      // No event selected (e.g. a brand-new organizer with zero events) —
      // fall back to the org's own cohort from /auth/me rather than assuming
      // legacy_only, so new redesign_default orgs aren't stuck on the old
      // "New Event" flow before their first event exists to read a cohort from.
      setCohort(user.redesign_cohort ?? 'legacy_only')
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

  // One-shot bypass for a single navigation (e.g. a redesign page punting to
  // its not-yet-built legacy counterpart). Unlike ?ui=legacy this is never
  // persisted to the global UI preference — it only applies to this visit.
  if (location.state?.forceLegacy) {
    return children
  }

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

  // An explicit "redesign" preference (e.g. visiting once with ?ui=redesign)
  // always redirects, regardless of cohort.
  if (uiPreference === 'redesign' || requestedPreference === 'redesign') {
    return <Navigate to={redesignRoute} replace />
  }

  if (AUTO_REDIRECT_COHORTS.has(cohort)) {
    return <Navigate to={redesignRoute} replace />
  }

  return children
}
