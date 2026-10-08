// Shared decision rules. Failed checks are not empty datasets.
export const GUIDE_DEPENDENCIES = {
  2: {audience:['guests'],rsvp:['guests','questions'],tickets:['ticketConfig','ticketProducts','payoutAccounts'],pass:['guests','ticketProducts'],channels:[],automation:['schedules']},
  3: {design:['design'],website:['design','website','releases'],invitation:['design'],materials:['design','outputs'],guesthub:['guestHubSettings'],community:['festiomeStatus','festiomeGroups'],speakers:['speakers','speakerSettings'],partners:['partners','partnerSettings']},
  4: {team:['members'],planner:['planner'],tasks:['tasks'],seating:['tables','floorPlan'],orders:['menuCategories'],logistics:['shipments'],access:['zones','gates'],checkin:['guests'],journey:['workflows'],gifts:['registryItems','registrySettings'],giving:['campaign'],finance:['contributions','donationAudit']},
  5: {conference:['conference'],calls:['conference'],programme:['sessions'],speakers:['speakers'],partners:['partners'],activities:['activities'],control:['displays','workflows'],materials:['materials'],certificates:['certificateTemplates','certificates'],analytics:['activities']},
  6: {results:['results'],closeout:[],reuse:['events'],help:[],integrations:['apiKeys','webhooks']},
}
export const GUIDE_SERVICE_KEYS = {
  2:['guests','questions','ticketConfig','ticketProducts','payoutAccounts','schedules'],
  3:['design','outputs','website','releases','guestHubSettings','festiomeStatus','festiomeGroups','speakers','speakerSettings','partners','partnerSettings'],
  4:['members','planner','tasks','tables','floorPlan','menuCategories','shipments','zones','gates','guests','workflows','registryItems','registrySettings','campaign','contributions','donationAudit'],
  5:['conference','sessions','speakers','partners','activities','displays','workflows','materials','certificateTemplates','certificates'],
  6:['results','apiKeys','webhooks'],
}
const fixes = {
 audience:'Add or import invited guests',rsvp:'Configure the RSVP link or add a test invitee',tickets:'Configure ticket products and required payouts',pass:'Create a named test guest or ticket',channels:'Enable a delivery channel',automation:'Enable a channel and configure routing',
 design:'Choose an event design',website:'Choose a design and review the website draft',invitation:'Configure the public RSVP link',materials:'Choose a design or add materials',guesthub:'Enable GuestHub',community:'Enable FestioMe',speakers:'Add speaker profiles',partners:'Add partner profiles',
 team:'Assign an event team member',planner:'Enable and configure Planner',tasks:'Assign a task owner',seating:'Create tables and a floor plan',orders:'Configure a meal category and menu',logistics:'Create a shipment group',access:'Configure zones and gates',checkin:'Create a named test pass',journey:'Create and publish a guest workflow',gifts:'Add a gift or fund',giving:'Configure a campaign and payment channel',finance:'Record a contribution before reconciliation',
 conference:'Create a conference track',calls:'Configure and open the call',programme:'Create and publish programme sessions',activities:'Create a Live activity',control:'Connect a display and publish the show workflow',certificates:'Create a certificate template',analytics:'Create an activity to collect responses',results:'Load event results',closeout:'Review event status before closeout',reuse:'Create a source event',
}
export function finalizeReadiness(phase, recipes, dataFailures = []) {
  const failures = dataFailures.map(f => typeof f === 'number' ? {key:GUIDE_SERVICE_KEYS[phase][f],label:GUIDE_SERVICE_KEYS[phase][f]} : f)
  const visible = recipes.map(r => {
    const required = r.dependencies || GUIDE_DEPENDENCIES[phase][r.id] || []
    const unavailable = failures.filter(f => required.includes(f.key))
    const unknown = unavailable.length > 0
    return {...r, unknown, unavailable, complete:!unknown && !!r.complete, blocked:!unknown && !!r.blocked,
      resolution:r.resolution || fixes[r.id] || 'Review this task’s settings'}
  })
  const applicable = visible.filter(r=>!r.notApplicable)
  const ready = applicable.find(r=>!r.complete && !r.blocked && !r.unknown)
  const unresolved = applicable.find(r=>!r.complete)
  const next = ready || (unresolved ? {...unresolved,title:unresolved.unknown ? `Retry ${unresolved.unavailable.map(f=>f.label).join(', ')}` : unresolved.resolution,
    action:unresolved.unknown ? 'Retry service checks' : unresolved.resolution,
    description:unresolved.unknown ? 'This task cannot be verified until its service responds.' : unresolved.evidence} : null)
  return {recipes:visible,complete:applicable.filter(r=>r.complete).length,total:applicable.length,blocked:applicable.filter(r=>r.blocked).length,
    unknown:applicable.filter(r=>r.unknown).length,next,dataFailures:failures.filter(f=>visible.some(r=>r.unavailable.includes(f)))}
}
