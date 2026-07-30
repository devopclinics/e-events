import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { validateGuestList } from '../adapters/contractValidation'

// Phase 4 (shared hooks): api.listGuests(eventId) was duplicated across several
// redesign pages, each with its own loading/error/race-condition handling.
// Mirrors useEventDetails's shape and requestId race guard. setGuests remains
// the escape hatch for optimistic-but-server-confirmed updates after a mutation
// whose response is the fresh guest (or list) — callers should setGuests(...)
// directly rather than paying for a full refetch.
export function useGuests(eventId) {
  const [guests, setGuests] = useState([])
  const [loading, setLoading] = useState(!!eventId)
  const [error, setError] = useState('')
  const requestIdRef = useRef(0)

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current
    if (!eventId) { setGuests([]); setLoading(false); setError(''); return }
    setLoading(true)
    setError('')
    try {
      const data = validateGuestList(await api.listGuests(eventId))
      if (requestIdRef.current !== requestId) return
      setGuests(data)
    } catch (e) {
      if (requestIdRef.current !== requestId) return
      setError(e.message || 'Guests could not be loaded')
    } finally {
      if (requestIdRef.current === requestId) setLoading(false)
    }
  }, [eventId])

  useEffect(() => { refresh() }, [refresh])

  return { guests, setGuests, loading, error, refresh }
}
