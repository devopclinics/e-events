import { asTime } from './appModel.mjs';
export function sessionKind(session) {
  const category = String(session.category || '').trim();
  const text = (category || session.title || '').toLowerCase();
  if (/meal|break|lunch|dinner|breakfast/.test(text)) return {label:category || 'Break', icon:'meal', tone:'warm'};
  if (/junior|child/.test(text)) return {label:category || 'Junior', icon:'star', tone:'warm'};
  if (/quran|learning|lecture|workshop|quiz|sheikh|q&a/.test(text)) return {label:category || 'Learning', icon:'book', tone:'blue'};
  return {label:category || 'Programme', icon:'people', tone:'lilac'};
}
export const sessionLive = (s, now) => asTime(s.starts_at) <= now && asTime(s.ends_at) > now;
export function dayHighlights(sessions, now) {
  const sorted = [...sessions].sort((a,b)=>asTime(a.starts_at)-asTime(b.starts_at));
  const current = sorted.filter(s=>sessionLive(s,now));
  const future = sorted.filter(s=>asTime(s.starts_at)>now);
  return {current, featured:current[0] || future[0] || sorted[0], next:current.length ? future[0] : future[1]};
}
export const activityLabels = {quiz:'Join quiz',q_and_a:'Ask a question',voting:'Cast your vote',poll:'Answer poll',survey:'Open survey',feedback:'Share feedback',form:'Review form'};
export function activityHref(eventId, token, activity) {
  if (!token || !activity?.session_id || activity.status !== 'live') return '';
  return `/live/guest?${new URLSearchParams({event:eventId,pass:token,session:activity.session_id,activity:activity.id})}`;
}
export function readSavedSessions(key) {
  try {const list=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(list)?list.filter(x=>typeof x==='string').slice(0,1000):[];}catch{return [];}
}
