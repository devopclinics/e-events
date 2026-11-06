export const STAFF_FEATURES = [
  ['overview','Dashboard & results'], ['guests','Guest list'], ['export','Export guest data'],
  ['scanner','QR check-in'], ['seating','Tables & seating'], ['menu','Menu & meals'],
  ['planner','Planner'], ['conference','Conference & sessions'], ['live','Festio Live'],
  ['access','Venue access'], ['logistics','Deliveries'], ['registry','Registry'],
  ['speakers','Speakers'], ['partners','Partners'], ['reminders','Reminders'],
  ['festiome','FestioMe'], ['guestservices','Guest Services'], ['team','Team'],
  ['tasks','Tasks'], ['experience','Experience'], ['messages','Messaging'],
  ['settings','Event settings'], ['design','Design Studio'], ['website','Event website'],
  ['donations','Donations'], ['ticketing','Tickets & registration'],
]
export function staffRouteFeature(path, search='') {
  if (/^\/(events(?:-redesign)?|help(?:-redesign)?|support-chat)$/.test(path)) return null
  if (path === '/guest-export') return 'export'
  const tab = new URLSearchParams(search).get('tab')
  if (/addons/.test(path)) return tab || 'settings'
  if (/communications/.test(path)) return tab === 'settings' ? 'settings' : 'messages'
  if (/guests/.test(path)) return tab === 'invite' ? 'messages' : 'guests'
  if (/team/.test(path)) return tab === 'tasks' ? 'tasks' : 'team'
  const routes = [['seating','seating'],['menu','menu'],['logistics','logistics'],['registry','registry'],['speakers','speakers'],['partners','partners'],['reminders','reminders'],['scanner','scanner'], ['checkin','access'], ['floor','seating'], ['kitchen','menu'], ['planner','planner'], ['conference','conference'], ['live','live'], ['festiome','festiome'], ['guest-services','guestservices'], ['experience','experience'], ['design','design'], ['website','website'], ['ticket','ticketing'], ['donation','donations'], ['setup','settings'], ['admin','overview'], ['billing','settings']]
  return routes.find(([part]) => path.includes(part))?.[1] || 'settings'
}
export function canSeeStaffFeature(event, feature) {
  if (feature == null) return true
  const policy=event?.my_feature_permissions
  return policy == null || ['view','manage'].includes(policy[feature])
}
