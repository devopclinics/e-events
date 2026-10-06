export const APP_SCREENS = ['home', 'programme', 'pass', 'inbox', 'more', 'party', 'experience', 'feedback', 'resources', 'communications', 'venue', 'profile'];
export function readAppRoute(hash = '') {
  const [path, query] = hash.replace(/^#\/?/, '').split('?');
  const params = new URLSearchParams(query);
  return {
    screen: APP_SCREENS.includes(path) ? path : 'home',
    member: params.get('member') || '',
    session: params.get('session') || '',
    day: params.get('day') || ''
  };
}
export function appHash(route) {
  const params = new URLSearchParams();
  for (const key of ['member', 'session', 'day']) if (route[key]) params.set(key, route[key]);
  return `#/${APP_SCREENS.includes(route.screen) ? route.screen : 'home'}${params.size ? `?${params}` : ''}`;
}
export function asTime(value) {
  if (!value) return NaN;
  return new Date(/(?:Z|[+-]\d\d:\d\d)$/i.test(value) ? value : `${value}Z`).getTime();
}
export function upcomingProgramme(program, now = Date.now()) {
  const source = [...(program?.days || []).flatMap(d => d.segments || []), ...(program?.current_segments || []), ...(program?.next_segments || [])];
  const unique = [...new Map(source.map(s => [s.step_id || `${s.starts_at}:${s.title}`, s])).values()];
  return unique.filter(s => Number.isFinite(asTime(s.starts_at)) && (Number.isFinite(asTime(s.ends_at)) ? asTime(s.ends_at) > now : asTime(s.starts_at) > now)).sort((a, b) => asTime(a.starts_at) - asTime(b.starts_at));
}
export function appPhase(event, guest, now = Date.now()) {
  if (event?.status === 'ended' || Number.isFinite(asTime(event?.event_end_date)) && asTime(event.event_end_date) <= now) return 'after';
  return guest?.admitted && !guest?.checked_out ? 'during' : 'before';
}
export function requiredActions(journey, guest) {
  const actions = [];
  if (guest?.admitted && journey?.consent?.required && !journey.consent.signed) actions.push({
    id: 'consent',
    title: `Complete ${journey.consent.form?.title || 'your consent form'}`,
    screen: 'experience'
  });
  for (const step of journey?.steps || []) if (step.required && step.actionable && !['completed', 'overridden', 'skipped'].includes(step.status) && step.type !== 'consent') actions.push({
    id: step.id,
    title: step.title,
    screen: 'experience'
  });
  return actions;
}
export function partyMembers(hub, authorized) {
  const own = hub?.guest;
  const rows = new Map((hub?.party || []).map(p => [p.id, {
    ...p,
    qr_token: undefined
  }]));
  if (own) rows.set(own.id, {
    ...rows.get(own.id),
    ...own,
    is_self: true
  });
  for (const p of authorized?.members || []) rows.set(p.id, {
    ...rows.get(p.id),
    ...p
  });
  return [...rows.values()].sort((a, b) => Number(!!b.is_self) - Number(!!a.is_self));
}
export function safeExternal(value) {
  try {
    const u = new URL(value);
    return ['https:', 'http:'].includes(u.protocol) ? u.href : '';
  } catch {
    return '';
  }
}
export function guestServices(event, hub, journey, visible = () => true) {
  return [event?.engagement_enabled && visible('live') && {
    id: 'live',
    title: 'Live Activities',
    icon: 'live',
    href: hub?.guest?.qr_token ? `/live/guest?event=${encodeURIComponent(event.id)}&pass=${encodeURIComponent(hub.guest.qr_token)}` : ''
  }, event?.festiome_enabled && visible('festiome') && {
    id: 'chat',
    title: 'FestioMe',
    icon: 'chat',
    href: hub?.capabilities?.festiome && hub?.guest?.qr_token ? `/festiome/guest?event=${encodeURIComponent(event.id)}&pass=${encodeURIComponent(hub.guest.qr_token)}` : ''
  }, (journey?.menu_enabled || journey?.menu_selectable) && {
    id: 'meal',
    title: 'Meals',
    icon: 'meal',
    href: hub?.guest?.qr_token ? `/scan/${encodeURIComponent(hub.guest.qr_token)}#orders` : ''
  }].filter(Boolean);
}
