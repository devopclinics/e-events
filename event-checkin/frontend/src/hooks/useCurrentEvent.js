import { useState } from 'react'

// Shared "current event" across Admin / Dashboard / Scanner / Kitchen so users
// pick an event once. Backed by localStorage; each page validates the stored id
// against the events it can actually see on load.
const KEY = 'eq.currentEventId'

export function useCurrentEvent() {
  const [eventId, set] = useState(() => localStorage.getItem(KEY) || '')
  const setEventId = (id) => {
    set(id || '')
    if (id) localStorage.setItem(KEY, id)
    else localStorage.removeItem(KEY)
  }
  return [eventId, setEventId]
}
