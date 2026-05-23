import { useState, useEffect } from 'react'

export function useGoogleStatus() {
  const [enabled, setEnabled] = useState(null)
  useEffect(() => {
    fetch('/api/auth/google-status')
      .then((r) => r.json())
      .then((d) => setEnabled(d.enabled))
      .catch(() => setEnabled(false))
  }, [])
  return enabled
}
