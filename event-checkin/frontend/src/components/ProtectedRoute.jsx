import { useContext, useEffect, useRef, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, UNSAFE_LocationContext, UNSAFE_RouteContext, UNSAFE_NavigationContext } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../api'
import { useCurrentEvent } from '../hooks/useCurrentEvent'
import { eventIdentityFromQuery } from '../pages/organizerGuidance.mjs'

const Spinner = () => (
  <div className="min-h-screen flex items-center justify-center">
    <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
  </div>
)

function AccessNotice({ title, children, upgrade = false }) {
  return <main className="max-w-xl mx-auto p-8" role="region" aria-label="Access information"><h1 className="text-2xl font-bold">{title}</h1><p className="my-4">{children}</p><nav className="flex flex-wrap gap-4" aria-label="Available next steps"><Link to="/events-redesign">Choose an event</Link><Link to="/scanner-redesign">Open scanner</Link><Link to="/help-redesign">Get help</Link>{upgrade && <Link to="/pricing">View plans</Link>}</nav></main>
}

export default function ProtectedRoute({
  children,
  adminOnly = false,
  setupOnly = false,
  paidOnly = false,
  platformSuperadminOnly = false,
}) {
  const { user, loading } = useAuth()
  const location = useLocation()
  const navigate=useNavigate()
  const locationContext=useContext(UNSAFE_LocationContext)
  const routeContext=useContext(UNSAFE_RouteContext)
  const navigation=useContext(UNSAFE_NavigationContext)
  const historyIndex=()=>navigation?.navigator?.index ?? globalThis.window?.history?.state?.idx
  const committed=useRef(null)
  const rollback=useRef(null)
  const [currentEventId,setCurrentEvent] = useCurrentEvent()
  const eventQuery=eventIdentityFromQuery(location.search)
  const requestedEvent=eventQuery.id
  // View/task/tab changes are not a new event authorization request and must
  // not unmount the already-verified workspace or discard its local state.
  const returnKey=(user?.id||'')+':'+location.pathname+':'+requestedEvent
  const appliedReturn=useRef(null)
  const [eventReturn,setEventReturn]=useState({key:null,status:'checking'})
  useEffect(()=>{
    if(rollback.current&&rollback.current.user===user?.id&&rollback.current.authorization.key===returnKey&&
      rollback.current.url===location.pathname+location.search+(location.hash||'')){
      appliedReturn.current=rollback.current.applied
      setEventReturn(rollback.current.authorization)
      rollback.current=null
      return
    }
    rollback.current=null
    appliedReturn.current=null
    setEventReturn({key:returnKey,status:'checking'})
    let alive=true
    const restoreCommitted=()=>{
      const previous=committed.current
      if(previous?.user!==user.id||previous.event!==currentEventId)return false
      rollback.current={user:previous.user,url:previous.location.pathname+previous.location.search+(previous.location.hash||''),
        applied:previous.applied,authorization:previous.authorization}
      const index=historyIndex(),delta=previous.index-index
      if(Number.isInteger(index)&&Number.isInteger(previous.index)&&delta)navigate(delta)
      else navigate(previous.location.pathname+previous.location.search+(previous.location.hash||''),{replace:true})
      return true
    }
    if(!user)return
    if(eventQuery.conflict){restoreCommitted();return}
    if(!requestedEvent)return
    api.listEvents().then(events=>{
      if(!alive)return
      // Event authorization is independent of login return-URL sanitization.
      // Keep the committed editor alive even if the target was revoked/deleted
      // or its authorization lookup fails. Cold links still fail closed.
      const allowed=events.some(event=>event.id===requestedEvent)
      if(!allowed&&restoreCommitted())return
      if(allowed&&setCurrentEvent(requestedEvent)===false&&restoreCommitted())return
      setEventReturn({key:returnKey,status:allowed?'verified':'denied'})
    }).catch(()=>{if(alive&&!restoreCommitted())setEventReturn({key:returnKey,status:'denied'})})
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
  // paidOnly: the route is a paid product tool (for example Design Studio), allowed when the
  // selected event is paid (mirrors the nav's canUseDesignStudio flag), or the
  // user is a platform superadmin.
  const paidKey=(user?.id||'')+':'+currentEventId
  const [paidState, setPaidState] = useState({key:null,status:'checking'})
  const [paidRetry, setPaidRetry] = useState(0)

  useEffect(() => {
    if (!paidOnly || !user) return
    let alive=true
    const finish=status=>{if(alive)setPaidState({key:paidKey,status})}
    finish('checking')
    if (user.is_platform_superadmin) { finish('ok'); return }
    if (!currentEventId) { finish('denied'); return }
    api.listEvents()
      .then((evs) => finish(evs.find((e) => e.id === currentEventId)?.is_paid ? 'ok' : 'denied'))
      .catch(() => finish('error'))
    return()=>{alive=false}
  }, [paidOnly, user, currentEventId,paidKey,paidRetry])

  const ready=!loading&&user&&!eventQuery.conflict&&(!requestedEvent||(
    eventReturn.key===returnKey&&eventReturn.status==='verified'&&currentEventId===requestedEvent))&&
    (!paidOnly||(paidState.key===paidKey&&paidState.status==='ok'))&&
    (!platformSuperadminOnly||user.is_platform_superadmin)&&(!adminOnly||user.role==='admin')&&
    (!setupOnly||['admin','event_manager'].includes(user.role))
  useEffect(()=>{
    if(ready)committed.current={user:user.id,event:currentEventId,children,location,locationContext,routeContext,
      index:historyIndex(),authorization:eventReturn,applied:{key:returnKey,user:user.id}}
  },[ready,user,currentEventId,children,location,eventReturn,returnKey])
  const workspace=(snapshot,waiting=false)=>(
    <UNSAFE_LocationContext.Provider value={snapshot.locationContext}>
      <UNSAFE_RouteContext.Provider value={snapshot.routeContext}>
        <div aria-busy={waiting} inert={waiting?'':undefined}>{snapshot.children}</div>
      </UNSAFE_RouteContext.Provider>
    </UNSAFE_LocationContext.Provider>
  )
  // Keep the committed editor and its registered dirty guard alive while a
  // history/deep-link event change is authorized and offered to that guard.
  const previous=committed.current
  const roleAllowed=(!platformSuperadminOnly||user?.is_platform_superadmin)&&(!adminOnly||user?.role==='admin')&&
    (!setupOnly||['admin','event_manager'].includes(user?.role))
  if(roleAllowed&&!loading&&user&&previous?.user===user.id&&previous.event===currentEventId&&(requestedEvent||eventQuery.conflict)&&
    (eventReturn.key!==returnKey||eventReturn.status==='checking'||eventQuery.conflict))
    return workspace(previous,true)
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
  if (platformSuperadminOnly && !user.is_platform_superadmin) return <AccessNotice title="Platform administration access required">This page is for authorised platform administrators. Contact your administrator if you need access.</AccessNotice>
  if (adminOnly && user.role !== 'admin') return <AccessNotice title="Organiser access required">Your current role cannot edit this page. Ask your organisation administrator for the appropriate access.</AccessNotice>
  if (setupOnly && !['admin', 'event_manager'].includes(user.role)) return <AccessNotice title="Event setup access required">Your current role is for assigned event operations. Ask your administrator if you need setup access.</AccessNotice>
  if (paidOnly) {
    if (paidState.key!==paidKey||paidState.status==='checking') return <Spinner />
    if (paidState.status==='error') return <main className="max-w-xl mx-auto p-8"><h1>Event access could not be verified</h1><p>Check your connection and retry. This does not mean you need to buy another pass.</p><button type="button" onClick={() => setPaidRetry(v => v + 1)}>Retry access check</button><Link to="/help-redesign">Get help</Link></main>
    if (paidState.status==='denied') return <AccessNotice title="An active Event Pass is required" upgrade>Select the correct event and check its Event Pass. If access was recently purchased, retry after the payment is confirmed.</AccessNotice>
  }

  return workspace({children,locationContext,routeContext})
}
