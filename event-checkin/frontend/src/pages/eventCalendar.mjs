function parts(value, timezone) {
  if (!value) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.split('-').map(Number)
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`
  const date = new Date(normalized)
  if (!Number.isFinite(date.getTime())) return null
  try {
    const items = new Intl.DateTimeFormat('en-US',{timeZone:timezone || 'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date)
    return ['year','month','day'].map(k=>Number(items.find(p=>p.type===k).value))
  } catch { return null }
}
export function eventCalendarDays(start,end,timezone) {
  const a=parts(start,timezone),b=parts(end,timezone)
  if(!a || !b)return null
  const n=(Date.UTC(b[0],b[1]-1,b[2])-Date.UTC(a[0],a[1]-1,a[2]))/86400000+1
  return n>=1 ? n : null
}
export function eventCalendarLabel(value,timezone) {
  const p=parts(value,timezone)
  return p ? new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeZone:'UTC'}).format(new Date(Date.UTC(p[0],p[1]-1,p[2]))) : 'Date unavailable'
}
