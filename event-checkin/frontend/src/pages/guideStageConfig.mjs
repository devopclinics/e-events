import { GUIDE_DEPENDENCIES } from './guideReadiness.mjs'
import {phaseTwoReadiness, PHASE_TWO_RECIPES} from './guidedSetupPhaseTwoModel.mjs'
import {phaseThreeReadiness, PHASE_THREE_RECIPES} from './guidedSetupPhaseThreeModel.mjs'
import {phaseFourReadiness, PHASE_FOUR_RECIPES} from './guidedSetupPhaseFourModel.mjs'
import {phaseFiveReadiness, PHASE_FIVE_RECIPES} from './guidedSetupPhaseFiveModel.mjs'
import {phaseSixReadiness, PHASE_SIX_RECIPES} from './guidedSetupPhaseSixModel.mjs'
export const GUIDE_STAGES = {
2: {model:phaseTwoReadiness, recipes:PHASE_TWO_RECIPES, view:"audience", label:"Audience & registration", testKeys:{"rsvp": "rsvp_test", "tickets": "ticket_test", "pass": "pass_test", "channels": "channel_test", "automation": "automation_test"}, services:[["guests", "Guest list", "listGuests"], ["questions", "RSVP questions", "listRSVPQuestions"], ["ticketConfig", "Ticket configuration", "ticketingConfig"], ["ticketProducts", "Ticket products", "ticketingProducts"], ["payoutAccounts", "Payout accounts", "ticketingPayoutAccounts"], ["schedules", "Scheduled messages", "listScheduledCommunications"]]},
3: {model:phaseThreeReadiness, recipes:PHASE_THREE_RECIPES, view:"experience", label:"Design & guest experience", testKeys:{"design": "design_review", "invitation": "invitation_test", "materials": "materials_review", "guesthub": "guesthub_test", "community": "community_test"}, services:[["design", "Event design", "getEventDesign"], ["outputs", "Generated materials", "designOutputs"], ["website", "Website draft", "website"], ["releases", "Website releases", "websiteReleases"], ["guestHubSettings", "GuestHub settings", "messagingSettings"], ["festiomeStatus", "FestioMe status", "eventFestioMeStatus"], ["festiomeGroups", "FestioMe groups", "festiomeManageGroups"], ["speakers", "Speakers", "listSpeakers"], ["speakerSettings", "Speaker publishing", "getSpeakerSettings"], ["partners", "Partners", "listPartners"], ["partnerSettings", "Partner publishing", "getPartnerSettings"]]},
4: {model:phaseFourReadiness, recipes:PHASE_FOUR_RECIPES, view:"operations", label:"Operations & giving", testKeys:{"team": "team_review", "planner": "planner_review", "seating": "seating_test", "orders": "orders_test", "logistics": "logistics_test", "access": "access_test", "checkin": "checkin_test", "journey": "journey_test", "gifts": "gift_test", "giving": "giving_test", "finance": "finance_review"}, services:[["members", "Event team", "listMembers"], ["planner", "Planner", "plannerDashboard"], ["tasks", "Tasks", "listTasks"], ["tables", "Tables", "listTables"], ["floorPlan", "Floor plan", "getFloorPlan"], ["menuCategories", "Meal menu", "listMenuCategories"], ["shipments", "Deliveries", "listShipments"], ["zones", "Access zones", "listZones"], ["gates", "Access gates", "listGates"], ["guests", "Guest passes", "listGuests"], ["workflows", "Guest workflows", "listExperienceWorkflows"], ["registryItems", "Gift items", "listRegistryItems"], ["registrySettings", "Gift settings", "getRegistrySettings"], ["campaign", "Giving campaign", "donationCampaign"], ["contributions", "Contributions", "donationContributions"], ["donationAudit", "Finance audit", "donationAudit"]]},
5: {model:phaseFiveReadiness, recipes:PHASE_FIVE_RECIPES, view:"live", label:"Conference & Live", testKeys:{"conference": "conference_review", "calls": "call_test", "programme": "programme_review", "speakers": "speaker_review", "partners": "partner_review", "activities": "activity_test", "control": "control_rehearsal", "materials": "materials_rehearsal", "certificates": "certificate_test", "analytics": "analytics_review"}, services:[["conference", "Conference Center", "getConferenceCenter"], ["sessions", "Programme sessions", "liveProgramSessions"], ["speakers", "Speakers", "listSpeakers"], ["partners", "Partners", "listPartners"], ["activities", "Live activities", "liveActivities"], ["displays", "Live displays", "liveDisplays"], ["workflows", "Show workflows", "liveWorkflows"], ["materials", "Presenter materials", "listPresenterMaterials"], ["certificateTemplates", "Certificate templates", "listCertificateTemplates"], ["certificates", "Issued certificates", "listEventCertificates"]]},
6: {model:phaseSixReadiness, recipes:PHASE_SIX_RECIPES, view:"closeout", label:"Results & closeout", testKeys:{"results": "results_review", "closeout": "closeout_review", "reuse": "reuse_test", "help": "help_review", "integrations": "integration_test"}, services:[["results", "Event results", "resultsCommandCenter"], ["apiKeys", "API connections", "listApiKeys"], ["webhooks", "Webhooks", "listWebhooks"]]},
}
export function selectedRecipes(phase, selected) {
  return GUIDE_STAGES[phase].recipes.filter(r=>!r.outcome && !r.outcomes || (r.outcome ? selected.includes(r.outcome) : r.outcomes.some(x=>selected.includes(x))))
}
export function requiredServices(phase, recipes, selected = []) {
  const keys = new Set(recipes.flatMap(r=>GUIDE_DEPENDENCIES[phase][r.id] || []))
  if(phase===2 && !selected.includes("tickets"))keys.delete("ticketProducts")
  return GUIDE_STAGES[phase].services.filter(([key])=>keys.has(key))
}
// Exclude guest answers, counters, wallet amounts and connection timestamps.
// Revisions identify configuration relevant to a recorded test, not event activity.
const configKeys = new Set('id name title status enabled active published is_published selected_template_id published_release_id draft_is_newer live_release_outdated provider provider_account_id currency price allow_custom_amount product_type config settings design eligibility questions options starts_at ends_at timezone room capacity selection_type items guest_hub_enabled mode adult_guest_ids'.split(' '))
const nestedConfiguration = new Set(['config','settings','design','eligibility','questions','options','items'])
const volatile = new Set(['updated_at','created_at','last_seen_at','connected','connected_count','devices','response_count','responses','views','balance'])
function stable(value, nested = false) {
  if(Array.isArray(value))return value.map(v=>stable(v,nested))
  if(value && typeof value==='object')return Object.fromEntries(Object.keys(value).filter(k=>!volatile.has(k) && (nested || configKeys.has(k))).sort().map(k=>[k,stable(value[k],nested || nestedConfiguration.has(k))]))
  return value
}
export function taskRevision(phase, id, data) {
  const eventFields = {
    rsvp:['rsvp_enabled','rsvp_token','invite_mode','rsvp_capacity','rsvp_deadline','rsvp_invitee_types'],
    invitation:['rsvp_enabled','rsvp_token','invite_mode'],channels:['notify_email','notify_sms','notify_whatsapp','channel_policy'],automation:['notify_email','notify_sms','notify_whatsapp','channel_policy'],
    orders:['menu_enabled','menu_selection_timing'],checkin:['manual_checkin_enabled','checkout_enabled','junior_guardian_handoff_enabled'],access:['venue_access_enabled','guardian_authorizations'],
  }
  const e=data.event || {}
  const event=Object.fromEntries(['id','event_date','event_end_date','timezone',...(eventFields[id]||[])].map(k=>[k,e[k]]))
  const dynamic = new Set(['guests','contributions','donationAudit','certificates','results','tasks','shipments','payoutAccounts'])
  const values=(GUIDE_DEPENDENCIES[phase][id]||[]).filter(k=>!dynamic.has(k)).map(k=>[k,stable(data[k])])
  const text=JSON.stringify({event,values})
  let hash=2166136261
  for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619)}
  return `v1-${(hash>>>0).toString(16)}-${text.length}`
}
export function effectiveProgress(phase,data) {
  const progress={...(data.progress||{})}
  for(const [id,key] of Object.entries(GUIDE_STAGES[phase].testKeys)){
    const stepKey=`phase${phase}_${key}`
    const latest=(data.evidence||[]).find(r=>r.step_key===stepKey)
    progress[stepKey]=latest?.result==='passed' && latest.config_revision===taskRevision(phase,id,data) ? 'completed' : 'pending'
  }
  return progress
}
