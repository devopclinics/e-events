import { asTime } from './appModel.mjs';
export function sessionKind(session) {
  const category = String(session.category || '').trim();
  const text = (category || session.title || '').toLowerCase();
  if (/meal|break|lunch|dinner|breakfast/.test(text)) return {label:category || 'Break', icon:'meal', tone:'warm'};
  if (/prayer|salah|salat/.test(text)) return {label:category || 'Prayer', icon:'moon', tone:'mint'};
  if (/sport|play|outdoor/.test(text)) return {label:category || 'Activities', icon:'star', tone:'warm'};
  if (/junior|child/.test(text)) return {label:category || 'Junior', icon:'star', tone:'warm'};
  if (/quran|learning|lecture|workshop|quiz|sheikh|q&a/.test(text)) return {label:category || 'Learning', icon:'book', tone:'blue'};
  return {label:category || 'Programme', icon:'people', tone:'lilac'};
}
export const sessionLive = (s, now) => asTime(s.starts_at) <= now && asTime(s.ends_at) > now;
export function dayHighlights(sessions, now) {
  const sorted = [...sessions].sort((a,b)=>asTime(a.starts_at)-asTime(b.starts_at));
  const current = sorted.filter(s=>sessionLive(s,now));
  const future = sorted.filter(s=>asTime(s.starts_at)>now);
  const featured=current[0] || future[0] || sorted[0];
  const next=future.find(s=>asTime(s.starts_at)>asTime(featured?.starts_at));
  return {current,featured,next};
}
export const activityLabels = {quiz:'Join quiz',q_and_a:'Ask a question',voting:'Cast your vote',poll:'Answer poll',survey:'Open survey',feedback:'Share feedback',form:'Review form'};
export function activityHref(eventId, token, activity) {
  if (!token || !activity?.session_id || activity.status !== 'live') return '';
  return `/live/guest?${new URLSearchParams({event:eventId,pass:token,session:activity.session_id,activity:activity.id})}`;
}
export function readSavedSessions(key) {
  try {const list=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(list)?list.filter(x=>typeof x==='string').slice(0,1000):[];}catch{return [];}
}
export function startsIn(value, now=Date.now()) {
 const minutes=Math.ceil((asTime(value)-now)/60000);
 if(minutes<=0)return 'In progress';
 if(minutes<60)return `Starts in ${minutes} ${minutes===1?'minute':'minutes'}`;
 const hours=Math.ceil(minutes/60);
 if(hours<24)return `Starts in ${hours} ${hours===1?'hour':'hours'}`;
 const days=Math.ceil(minutes/1440);return `Starts in ${days} ${days===1?'day':'days'}`;
}
export function timezoneLabel(zone, now=Date.now()) {
 try {const name=new Intl.DateTimeFormat('en-US',{timeZone:zone,timeZoneName:'longGeneric'}).formatToParts(now).find(p=>p.type==='timeZoneName')?.value;const city=zone.split('/').pop().replaceAll('_',' ');return `${name||zone}${name&&name!==city?` (${city})`:''}`;}catch{return zone;}
}
export function groupSessions(sessions) {
 const groups=new Map();
 [...sessions].sort((a,b)=>asTime(a.starts_at)-asTime(b.starts_at)).forEach(s=>{const key=String(asTime(s.starts_at));if(!groups.has(key))groups.set(key,[]);groups.get(key).push(s)});
 return [...groups].map(([key,sessions])=>({key,sessions,starts_at:sessions[0].starts_at}));
}
export const programmeRoom=s=>s.room||s.location||'Room to be announced';
export const programmeGroups=s=>s.age_groups?.length?s.age_groups:[s.title?.match(/\bGroup\s+[A-Za-z0-9]+\b/i)?.[0]||'Shared / other'];

// Bucket by the event's local clock, never the viewer's device timezone.
export function programmePeriod(value, zone) {
 if (!Number.isFinite(asTime(value))) return 'Time to be announced';
 let hour;
 try {hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric',hourCycle:'h23'}).format(asTime(value)));}
 catch {hour=new Date(asTime(value)).getUTCHours();}
 return hour<12?'Morning':hour<17?'Afternoon':'Evening';
}
export function programmePeriods(sessions, zone) {
 const groups=groupSessions(sessions);
 return ['Morning','Afternoon','Evening','Time to be announced'].map(label=>({label,groups:groups.filter(g=>programmePeriod(g.starts_at,zone)===label)})).filter(p=>p.groups.length);
}

// Visual accents only; these do not alter audience, access or session type.
export function programmePalette(session) {
 const text=String(session.category || session.title || '').toLowerCase();
 if (/meal|break|lunch|dinner|breakfast|snack/.test(text)) return 'meals';
 if (/prayer|salah|salat/.test(text)) return 'prayer';
 if (/sport|play|outdoor/.test(text)) return 'sports';
 if (/junior|child|guardian|pickup|handoff/.test(text)) return 'junior';
 if (/quran|learning|lecture|workshop|quiz|sheikh|q&a/.test(text)) return 'learning';
 return 'community';
}
