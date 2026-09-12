import { useEffect, useState } from 'react'

// Count down between server snapshots without polling or sending commands.
export default function usePresenterClock() {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [])
  return now
}

export function timerRemaining(timer, now, serverOffset = 0) {
  if (!timer) return null
  if (timer.status === 'running' && timer.ends_at) {
    return Math.max(0, Math.ceil((new Date(timer.ends_at).getTime() - now - serverOffset) / 1000))
  }
  return timer.remaining_seconds ?? 0
}
