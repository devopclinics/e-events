// Phase 1 observability scaffolding for the admin-UI redesign, per
// FESTIO_ADMIN_REDESIGN_WIRING_PROMPT.md ("Add observability context").
import { useCallback } from 'react'
import { api } from '../../api'

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
    route,
    module,
    event_id: eventId,
    org_id: orgId,
    release_version: releaseVersion || import.meta.env.VITE_APP_VERSION,
    feature_flag_cohort: featureFlagCohort || rest.cohort,
    endpoint: rest.endpoint,
    status: Number.isInteger(rest.status) ? rest.status : undefined,
    action: rest.action || rest.workflow,
    duration_ms: Number.isFinite(rest.durationMs) ? Math.round(rest.durationMs) : undefined,
    success: typeof rest.success === 'boolean' ? rest.success : undefined,
    reason: rest.reason,
    mode: rest.mode,
  }

  api.logRedesignTelemetry({ event_type: eventType, ...mergedPayload }).catch(() => {})
  if (import.meta.env.DEV) console.debug('[redesign-telemetry]', eventType, mergedPayload)

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
