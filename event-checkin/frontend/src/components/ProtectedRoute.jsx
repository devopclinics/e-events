import { useEffect, useRef, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../api'
import { useCurrentEvent } from '../hooks/useCurrentEvent'
import { eventIdentityFromQuery } from '../pages/organizerGuidance.mjs'

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
  const returnKey=(user?.id||'')+':'+location.pathname+location.search
  const eventQuery=eventIdentityFromQuery(location.search)
  const requestedEvent=eventQuery.id
  const appliedReturn=useRef(null)
  const [eventReturn,setEventReturn]=useState({key:null,status:'checking'})
  useEffect(()=>{
    appliedReturn.current=null
    setEventReturn({key:returnKey,status:'checking'})
    if(!user||!requestedEvent||eventQuery.conflict)return
    let alive=true
    api.listEvents().then(events=>{
      if(!alive)return
      // Event authorization is independent of login return-URL sanitization.
      // Registered legacy/presenter routes keep their own query parameters.
      const allowed=events.some(event=>event.id===requestedEvent)
      if(allowed)setCurrentEvent(requestedEvent)
      setEventReturn({key:returnKey,status:allowed?'verified':'denied'})
    }).catch(()=>{if(alive)setEventReturn({key:returnKey,status:'denied'})})
    return()=>{alive=false}
  },[user,returnKey,requestedEvent,eventQuery.conflict])
  useEffect(()=>{
    if(eventReturn.key===returnKey&&eventReturn.status==='verified'&&currentEventId===requestedEvent)
      appliedReturn.current={key:returnKey,user:user?.id}
  },[returnKey,eventReturn,currentEventId,requestedEvent,user])
  const eventLocation=id=>{
    const params=new URLSearchParams(location.search)
    const keys=['event','event_id','eventId'].filter(key=>params.has(key))
    if(id){for(const key of keys.length?keys:['event'])params.set(key,id)}
    else for(const key of keys)params.delete(key)
    const search=params.toString()
    return location.pathname+(search?'?'+search:'')+(location.hash||'')
  }
  // paidOnly: the route is a paid perk (Design Studio, Help) — allowed when the
  // selected event is paid (mirrors the nav's canUseDesignStudio flag), or the
  // user is a platform superadmin.
  const paidKey=(user?.id||'')+':'+currentEventId
  const [paidState, setPaidState] = useState({key:null,status:'checking'})

  useEffect(() => {
    if (!paidOnly || !user) return
    let alive=true
    const finish=status=>{if(alive)setPaidState({key:paidKey,status})}
    finish('checking')
    if (user.is_platform_superadmin) { finish('ok'); return }
    if (!currentEventId) { finish('denied'); return }
    api.listEvents()
      .then((evs) => finish(evs.find((e) => e.id === currentEventId)?.is_paid ? 'ok' : 'denied'))
      .catch(() => finish('denied'))
    return()=>{alive=false}
  }, [paidOnly, user, currentEventId,paidKey])

  if (loading) return <Spinner />

  if (!user) return <Navigate to="/login" state={{organizerReturn:location.pathname+location.search}} replace />
  if(eventQuery.conflict)return <div role="alert">Conflicting event parameters are not allowed.</div>
  // Never mount event tasks while a deep link still points at another event.
  if(requestedEvent){
    if(eventReturn.key!==returnKey||eventReturn.status==='checking')return <Spinner />
    if(eventReturn.status==='denied')return <div role="alert">This event link is unavailable or access could not be verified.</div>
    if(currentEventId!==requestedEvent){
      if(appliedReturn.current?.key===returnKey&&appliedReturn.current?.user===user.id)
        return <Navigate to={eventLocation(currentEventId)} replace />
      return <div role="alert">Review the pending event change before opening this link. <a href={eventLocation(null)}>Keep the current event</a></div>
    }
  }
  if (platformSuperadminOnly && !user.is_platform_superadmin) return <Navigate to="/admin" replace />
  if (adminOnly && user.role !== 'admin') return <Navigate to="/scanner" replace />
  if (setupOnly && !['admin', 'event_manager'].includes(user.role)) return <Navigate to="/scanner" replace />
  if (paidOnly) {
    if (paidState.key!==paidKey||paidState.status==='checking') return <Spinner />
    if (paidState.status==='denied') return <Navigate to="/admin" replace />
  }

  return children
}
