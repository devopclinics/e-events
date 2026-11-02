import {parseUtc} from '../timeutil.js'
export const CUSTOMER_JOURNEY_ENABLED = import.meta.env?.VITE_CUSTOMER_JOURNEY_ENABLED === 'true'
export const STARTING_POINTS = [
 {id:'invitation',title:'Free invitation',description:'A beautiful link and simple replies.',type:'Private party',mode:'rsvp'},
 {id:'tickets',title:'Sell tickets',description:'Start with your event. Set up sales when ready.',type:'Other',mode:'ticketed'},
 {id:'conference',title:'Conference',description:'Bring sessions, speakers and guests together.',type:'Conference / seminar',mode:'rsvp'},
 {id:'celebration',title:'Private celebration',description:'Make a personal occasion feel special.',type:'Private party',mode:'rsvp'},
 {id:'fundraiser',title:'Fundraiser',description:'Bring people together around your cause.',type:'Community / religious event',mode:'rsvp'},
]
export const CUSTOMER_TOOLS = [
 {id:'seating',title:'Give everyone a seat',description:'Arrange tables, assign guests and keep seats on their pass.',flag:'seating_enabled',addon:'addon_seating',route:'/addons-redesign?tab=seating',group:'Welcome guests',icon:'chair'},
 {id:'programme',title:'Plan the programme',description:'Bring sessions, speakers and rooms into one guest timetable.',flag:'experience_enabled',addon:'addon_experience',route:'/experience-redesign',group:'Run a conference',icon:'calendar'},
 {id:'tickets',title:'Create your tickets',description:'Manage ticket types, sales and payment readiness.',route:'/ticketing-redesign',group:'Sell & fundraise',icon:'card'},
 {id:'giving',title:'Raise funds',description:'Create your giving campaign and review its publication settings.',flag:'engagement_enabled',addon:'addon_engagement',route:'/live-redesign?tab=Settings',group:'Sell & fundraise',icon:'heart'},
 {id:'community',title:'Help people connect',description:'Set up FestioMe and review adult eligibility and guest approvals.',flag:'festiome_addon_enabled',addon:'addon_festiome',route:'/festiome-redesign',group:'Engage people',icon:'users'},
 {id:'live',title:'Ask your audience',description:'Create a poll, Q&A or live activity for attendees.',flag:'engagement_enabled',addon:'addon_engagement',route:'/live-redesign',group:'Engage people',icon:'sparkles'},
 {id:'team',title:'Plan with your team',description:'Keep budgets, tasks, vendors and your run sheet connected.',flag:'planner_enabled',addon:'addon_planner',route:'/planner-redesign',group:'Plan together',icon:'users'},
 {id:'messages',title:'Keep guests in the loop',description:'Review recipients, channels and credits before sending.',route:'/guests-redesign?tab=invite',group:'Welcome guests',icon:'mail'},
 {id:'forms',title:'Collect guest information',description:'Create questions and review what guests need to complete.',flag:'experience_enabled',addon:'addon_experience',route:'/experience-redesign',group:'Welcome guests',icon:'check'},
]
export function registrationReadiness(event, now = Date.now()) {
 if (!event) return {ready:false,reason:'Select an event first.'}
 if (event.external_registration_url) return {ready:false,external:true,reason:'Registration is managed on the organizer’s website. Review that destination before sharing.'}
 if (event.status !== 'active') return {ready:false,reason:event.status==='draft'?'Activate the event before opening registration.':'This event is not active. Review its lifecycle before sharing.'}
 if (!event.rsvp_enabled) return {ready:false,reason:'Enable RSVP so guests can submit a reply.'}
 if (event.invite_mode === 'closed') return {ready:false,reason:'This event uses personal invitations. Send each guest their own link.'}
 if (event.rsvp_deadline && parseUtc(event.rsvp_deadline)?.getTime() <= now) return {ready:false,reason:'The RSVP deadline has passed. Review the deadline in invitation settings.'}
 return {ready:true,reason:'Registration is open. Check the guest destination before sharing.'}
}
export function toolAccess(tool, event, billing) {
 if (!tool.flag) return {state:'Open workspace',included:null}
 const enabled=!!event?.[tool.flag]
 const included=Array.isArray(billing?.available_addons) ? billing.available_addons.includes(tool.addon) : null
 return {state:enabled?'Enabled · review setup':included===true?'Included · not enabled':included===false?'Review access':'Checking access',included}
}
export function invitationPath(event) {
 const q=event?.setup_preferences?.quick_invite
 if(q) return `/i/${encodeURIComponent(q.share_slug || event.rsvp_token || event.id)}`
 return event?.rsvp_token?`/rsvp/${encodeURIComponent(event.rsvp_token)}`:`/invite/${encodeURIComponent(event?.id || '')}`
}
export function destinationFingerprint(event) {
 return JSON.stringify([event?.id,event?.status,event?.rsvp_enabled,event?.invite_mode,event?.rsvp_token,event?.rsvp_deadline,event?.external_registration_url])
}
