import { useState, useEffect } from 'react'

// Shared "current event" across Admin / Dashboard / Scanner / Kitchen + the top
// bar — pick once, everywhere stays in sync. Backed by localStorage with a tiny
// pub/sub so all hook instances update live in the same tab.
const KEY = 'eq.currentEventId'
let current = localStorage.getItem(KEY) || ''
const subs = new Set()

function setCurrent(id) {
  current = id || ''
  if (id) localStorage.setItem(KEY, id)
  else localStorage.removeItem(KEY)
  subs.forEach((fn) => fn(current))
}

export function useCurrentEvent() {
  const [eventId, set] = useState(current)
  useEffect(() => {
    subs.add(set)
    set(current)
    return () => subs.delete(set)
  }, [])
  return [eventId, setCurrent]
}
