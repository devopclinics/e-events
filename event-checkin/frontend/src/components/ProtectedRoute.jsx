import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../api'
import { useCurrentEvent } from '../hooks/useCurrentEvent'
import { authenticatedOrganizerReturn } from '../pages/organizerGuidance.mjs'

const Spinner = () => (
  <div className="min-h-screen flex items-center justify-center">
    <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
  </div>
)

export default function ProtectedRoute({
  children,
  adminOnly = false,
  setupOnly = false,
  paidOnly = false,
  platformSuperadminOnly = false,
}) {
  const { user, loading } = useAuth()
  const location = useLocation()
  const [currentEventId,setCurrentEvent] = useCurrentEvent()
  const returnKey=location.pathname+location.search
  const urlParams=new URLSearchParams(location.search)
  const requestedEvent=urlParams.get('event')||urlParams.get('event_id')||urlParams.get('eventId')
  const [eventReturn,setEventReturn]=useState({key:null,status:'checking'})
  useEffect(()=>{
    if(!user||!requestedEvent)return
    let alive=true
    setEventReturn({key:returnKey,status:'checking'})
    api.listEvents().then(events=>{
      if(!alive)return
      const target=authenticatedOrganizerReturn(returnKey,events)
      if(target)setCurrentEvent(requestedEvent)
      setEventReturn({key:returnKey,status:target?'verified':'denied'})
    }).catch(()=>{if(alive)setEventReturn({key:returnKey,status:'denied'})})
    return()=>{alive=false}
  },[user,returnKey,requestedEvent])
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

  if (!user) return <Navigate to="/login" state={{organizerReturn:location.pathname+location.search}} replace />
  // Never mount event tasks while a deep link still points at another event.
  if(requestedEvent){
    if(eventReturn.key!==returnKey||eventReturn.status==='checking')return <Spinner />
    if(eventReturn.status==='denied')return <div role="alert">This event link is unavailable or access could not be verified.</div>
    if(currentEventId!==requestedEvent)return <div role="alert">Review the pending event change before opening this link.</div>
  }
  if (platformSuperadminOnly && !user.is_platform_superadmin) return <Navigate to="/admin" replace />
  if (adminOnly && user.role !== 'admin') return <Navigate to="/scanner" replace />
  if (setupOnly && !['admin', 'event_manager'].includes(user.role)) return <Navigate to="/scanner" replace />
  if (paidOnly) {
    if (paidState === 'checking') return <Spinner />
    if (paidState === 'denied') return <Navigate to="/admin" replace />
  }

  return children
}
