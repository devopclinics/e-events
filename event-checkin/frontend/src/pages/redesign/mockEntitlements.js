import { useEffect, useState } from 'react'

const KEY = 'redesignMockEntitlements'

export const ADDON_KEYS = ['venueAccess', 'seating', 'orders', 'logistics', 'registry']

export const ADDON_LABELS = {
  venueAccess: 'Venue Access (Check-in)',
  seating: 'Seating',
  orders: 'Orders',
  logistics: 'Logistics (Deliveries)',
  registry: 'Registry (Gift list)',
}

function defaults() {
  return Object.fromEntries(ADDON_KEYS.map((k) => [k, true]))
}

function read() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaults()
    return { ...defaults(), ...JSON.parse(raw) }
  } catch {
    return defaults()
  }
}

// Design-exploration only: mirrors the real app's event.*_enabled gating
// (AdminPage.jsx sidebar conditionally renders Check-in/Seating/Orders/
// Logistics/Registry off these flags) so the mockup can demonstrate the
// same show/hide behavior without a live event.
export function useMockEntitlements() {
  const [flags, setFlagsState] = useState(read)

  useEffect(() => {
    function onStorage(e) {
      if (e.key === KEY) setFlagsState(read())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  function setFlag(key, value) {
    setFlagsState((prev) => {
      const next = { ...prev, [key]: value }
      localStorage.setItem(KEY, JSON.stringify(next))
      return next
    })
  }

  function reset() {
    localStorage.removeItem(KEY)
    setFlagsState(defaults())
  }

  return { flags, setFlag, reset }
}
