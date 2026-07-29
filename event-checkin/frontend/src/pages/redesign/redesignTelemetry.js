// Phase 1 observability scaffolding for the admin-UI redesign, per
// FESTIO_ADMIN_REDESIGN_WIRING_PROMPT.md ("Add observability context").
// There is no real telemetry backend yet — logRedesignEvent is the single
// choke point to swap in a real sink (e.g. fetch('/api/telemetry/redesign'))
// once one exists; every helper below routes through it.

import { useCallback } from 'react'

// Only log in dev builds so this stays side-effect-light in production
// consoles; swap the guard for a sampling/always-on strategy once a real
// backend sink exists.
const DEV_ONLY = true

export function logRedesignEvent(eventType, payload = {}) {
  const {
    route = typeof window !== 'undefined'
      ? window.location.pathname + window.location.search
      : undefined,
    module,
    eventId,
    orgId,
    userRole,
    releaseVersion,
    featureFlagCohort,
    ...rest
  } = payload

  const mergedPayload = {
    ui: 'redesign',
    route,
    module,
    eventId,
    orgId,
    userRole,
    releaseVersion,
    featureFlagCohort,
    ...rest,
  }

  if (!DEV_ONLY || import.meta.env.DEV) {
    // One-line swap point for a real backend call, e.g.:
    // fetch('/api/telemetry/redesign', { method: 'POST', body: JSON.stringify({ eventType, ...mergedPayload }) })
    console.debug('[redesign-telemetry]', eventType, mergedPayload)
  }

  return mergedPayload
}

export function logRenderError({ route, module, error, errorInfo, ...context } = {}) {
  return logRedesignEvent('render_error', { route, module, error, errorInfo, ...context })
}

export function logApiError({ route, module, endpoint, status, message, ...context } = {}) {
  return logRedesignEvent('api_error', { route, module, endpoint, status, message, ...context })
}

export function logValidationError({ route, module, field, message, ...context } = {}) {
  return logRedesignEvent('validation_error', { route, module, field, message, ...context })
}

export function logMutationDuration({ route, module, action, durationMs, success, ...context } = {}) {
  return logRedesignEvent('mutation_duration', { route, module, action, durationMs, success, ...context })
}

export function logAbandonedWorkflow({ route, module, workflow, stepReached, ...context } = {}) {
  return logRedesignEvent('abandoned_workflow', { route, module, workflow, stepReached, ...context })
}

export function logFeatureFlagCohort({ orgId, cohort, ...context } = {}) {
  return logRedesignEvent('feature_flag_cohort', { orgId, cohort, ...context })
}

export function logSyncMode({ route, module, mode, ...context } = {}) {
  return logRedesignEvent('sse_or_poll_mode', { route, module, mode, ...context })
}

export function logEditConflict({ route, module, entity, ...context } = {}) {
  return logRedesignEvent('edit_conflict', { route, module, entity, ...context })
}

export function logFallbackToLegacy({ route, module, reason, ...context } = {}) {
  return logRedesignEvent('fallback_to_legacy', { route, module, reason, ...context })
}

// Passthrough helper: binds a component's context (eventId/orgId/userRole/
// etc.) once, returning a logEvent(eventType, payload) closure so call sites
// don't repeat that boilerplate on every call.
export function useRedesignTelemetryContext(context = {}) {
  return useCallback(
    (eventType, payload = {}) => logRedesignEvent(eventType, { ...context, ...payload }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(context)]
  )
}
