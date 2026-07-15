import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../api'
import { useCurrentEvent } from '../hooks/useCurrentEvent'

const Spinner = () => (
  <div className="min-h-screen flex items-center justify-center">
    <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
  </div>
)

export default function ProtectedRoute({ children, adminOnly = false, setupOnly = false, paidOnly = false }) {
  const { user, loading } = useAuth()
  const [currentEventId] = useCurrentEvent()
  // paidOnly: the route is a paid perk (Design Studio, Help) — allowed when the
  // selected event is paid (mirrors the nav's canUseDesignStudio flag), or the
  // user is a platform superadmin.
  const [paidState, setPaidState] = useState('checking') // checking | ok | denied

  useEffect(() => {
    if (!paidOnly || !user) return
    if (user.is_platform_superadmin) { setPaidState('ok'); return }
    if (!currentEventId) { setPaidState('denied'); return }
    api.listEvents()
      .then((evs) => setPaidState(evs.find((e) => e.id === currentEventId)?.is_paid ? 'ok' : 'denied'))
      .catch(() => setPaidState('denied'))
  }, [paidOnly, user, currentEventId])

  if (loading) return <Spinner />

  if (!user) return <Navigate to="/login" replace />
  if (adminOnly && user.role !== 'admin') return <Navigate to="/scanner" replace />
  if (setupOnly && !['admin', 'event_manager'].includes(user.role)) return <Navigate to="/scanner" replace />
  if (paidOnly) {
    if (paidState === 'checking') return <Spinner />
    if (paidState === 'denied') return <Navigate to="/admin" replace />
  }

  return children
}
