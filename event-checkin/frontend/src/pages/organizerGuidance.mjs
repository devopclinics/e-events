import {CHECKLISTS} from './guideChecklists.mjs'

const WORKSPACES = new Set(['/marketing','/setup-redesign','/admin-redesign','/guests-redesign','/tickets-redesign',
  '/ticketing-redesign','/messaging-redesign','/design-redesign','/addons-redesign','/kitchen-redesign',
  '/planner-redesign','/team-redesign','/live-redesign','/results-redesign','/experience-redesign',
  '/festiome-redesign','/guesthub-redesign','/checkin-redesign','/integrations-redesign',
  '/design-studio-redesign','/design-studio-redesign/website','/communications-redesign','/conference-center'])

// This validates navigation only. Destination APIs must still authorize the
// selected event; a URL or local-storage resume entry never grants access.
export function safeOrganizerDestination(route, eventId, accessibleEvents, orgId) {
  const event = accessibleEvents?.find(e=>e.id===eventId)
  if (!event || (orgId && event.org_id!==orgId) || typeof route!=='string' ||
      !route.startsWith('/') || route.startsWith('//') || /[\\\u0000-\u0020]/.test(route)) return null
  const url = new URL(route, 'https://festio.events')
  if (url.origin!=='https://festio.events' || !WORKSPACES.has(url.pathname)) return null
  for (const key of ['event','event_id','eventId']) {
    if (url.searchParams.has(key) && url.searchParams.get(key)!==eventId) return null
  }
  // Never propagate nested redirect destinations or actions from supplied URLs.
  if ([...url.searchParams.keys()].some(k=>!['tab','view','task','event','event_id','eventId'].includes(k))) return null
  url.searchParams.set('event', eventId)
  return url.pathname+url.search+url.hash
}

export function authenticatedOrganizerReturn(route, accessibleEvents) {
  if (typeof route!=='string' || !route.startsWith('/') || route.startsWith('//') || /[\\\u0000-\u0020]/.test(route)) return null
  const url=new URL(route,'https://festio.events')
  if (url.origin!=='https://festio.events' || !WORKSPACES.has(url.pathname)) return null
  const event=url.searchParams.get('event')||url.searchParams.get('event_id')||url.searchParams.get('eventId')
  if(event)return safeOrganizerDestination(route,event,accessibleEvents)
  if (![...url.searchParams.keys()].every(k=>['tab','view','task'].includes(k)))return null
  return url.pathname+url.search+url.hash
}

export function contextualGuidance({event, accessibleEvents, recipes=[], orgId, now=new Date()}) {
  if (!event || !accessibleEvents?.some(e=>e.id===event.id && e.org_id===event.org_id) ||
      (orgId && event.org_id!==orgId)) return {error:'Event access must be verified.', next:[]}
  let timing='unknown', localDate=null
  try {
    if (event.timezone) {
      const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:event.timezone,year:'numeric',month:'2-digit',day:'2-digit'})
      const day=value=>{const parts=formatter.formatToParts(value);const get=k=>parts.find(p=>p.type===k)?.value;return `${get('year')}-${get('month')}-${get('day')}`}
      const instant=value=>new Date(/(Z|[+-]\d\d:\d\d)$/.test(value||'')?value:`${value}Z`)
      localDate=day(now)
      const start=day(instant(event.event_date)), end=day(instant(event.event_end_date||event.event_date))
      if (/^\d{4}-\d{2}-\d{2}$/.test(start||'') && /^\d{4}-\d{2}-\d{2}$/.test(end||''))
        timing=localDate<start?'upcoming':localDate>end?'past':'event_day'
    }
  } catch { /* Ask for a valid timezone; never infer completion from a date. */ }
  const cancelled=event.cancelled===true || event.status==='cancelled'
  let candidates=recipes.filter(r=>!r.complete&&!r.notApplicable)
  if(cancelled||timing==='past') {
    candidates=candidates.filter(r=>['results','closeout','help','integrations'].includes(r.id))
    if(!candidates.length)candidates=[{id:'closeout',title:'Review results and closeout',route:'/setup-redesign?view=closeout'}]
  } else if(timing==='event_day') {
    const rank=['checkin','access','team','control']
    candidates.sort((a,b)=>(rank.includes(a.id)?rank.indexOf(a.id):100)-(rank.includes(b.id)?rank.indexOf(b.id):100))
  }
  const next=candidates.map(r=>({
    ...r, route:safeOrganizerDestination(r.route,event.id,accessibleEvents,orgId),
    checklist:CHECKLISTS[r.id]||[],
  })).filter(r=>r.route)
  return {timing, localDate, cancelled, next:next.slice(0,3),
    note:cancelled?'Review cancellation and unresolved delivery or payment exceptions.':
      timing==='past'?'Review results and closeout; the event date alone does not prove completion.':
      timing==='event_day'?'Review outstanding operations and staff readiness.':
      timing==='unknown'?'Confirm the event date and timezone before scheduling guidance.':
      'Complete outstanding configuration and rehearse the selected guest experience.'}
}
