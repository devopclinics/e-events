import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { validateEventList } from '../adapters/contractValidation'

// Phase 4 (shared hooks): the current event's full record (entitlement flags,
// RSVP/channel settings, lifecycle status, etc. — not just its id from
// useCurrentEvent) was fetched via a near-identical api.listEvents().find(id)
// snippet duplicated across ~9 redesign pages, each with slightly different
// loading/error/race-condition handling. Centralizes it. requestIdRef guards
// against a slow response for a previous eventId overwriting a newer one —
// several call sites had their own ad-hoc "cancelled" flag for this; this
// hook gives it to every consumer for free.
//
// setEvent is exposed as an escape hatch for optimistic-but-server-confirmed
// updates — e.g. after a mutation whose response body *is* the fresh event,
// callers should setEvent(response) directly rather than paying for a second
// full refetch.
export function useEventDetails(eventId) {
  const [event, setEvent] = useState(null)
  const [loading, setLoading] = useState(!!eventId)
  const [error, setError] = useState('')
  const requestIdRef = useRef(0)

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current
    if (!eventId) { setEvent(null); setLoading(false); setError(''); return }
    setLoading(true)
    setError('')
    try {
      const events = validateEventList(await api.listEvents())
      if (requestIdRef.current !== requestId) return
      setEvent(events.find((item) => item.id === eventId) || null)
    } catch (e) {
      if (requestIdRef.current !== requestId) return
      setError(e.message || 'Event could not be loaded')
    } finally {
      if (requestIdRef.current === requestId) setLoading(false)
    }
  }, [eventId])

  useEffect(() => { refresh() }, [refresh])

  return { event, setEvent, loading, error, refresh }
}
