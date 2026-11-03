import {CUSTOMER_TOOLS} from '../../pages/customerJourneyModel.mjs'
export const TOOL_GUIDES = {
  "seating": {
    "methods": [
      "listTables",
      "getFloorPlan"
    ],
    "steps": [
      "Set table count and seats, then review the floor plan.",
      "Assign a controlled guest and inspect capacity conflicts.",
      "The selected guest sees the correct table and seat on their pass."
    ],
    "checklist": "seating",
    "preview": "guest",
    "guestTab": "pass"
  },
  "programme": {
    "methods": [
      "listExperienceWorkflows"
    ],
    "steps": [
      "Add sessions with dates, rooms and speakers in Workflow.",
      "Publish the workflow and enable programme visibility in GuestHub.",
      "An eligible guest sees the intended published sessions at the event timezone."
    ],
    "checklist": "programme",
    "preview": "guest",
    "guestTab": "programme"
  },
  "forms": {
    "methods": [
      "listEventForms"
    ],
    "steps": [
      "In Forms & consent, choose Create form and set its audience.",
      "Save the version, publish it and review who may complete or sign it.",
      "The intended guest can submit once and their completion is recorded."
    ],
    "checklist": "journey",
    "preview": "guest",
    "guestTab": "more"
  },
  "community": {
    "methods": [
      "eventFestioMeStatus",
      "festiomeManageGroups",
      "festiomeAccessPolicy"
    ],
    "steps": [
      "Create your community with Enable FestioMe, then configure channels and moderation.",
      "Review adult eligibility and approval policy before enabling guest access.",
      "An approved adult can enter; an ineligible or unapproved guest stays blocked."
    ],
    "checklist": "community",
    "preview": "guest",
    "guestTab": "more"
  },
  "tickets": {
    "methods": [
      "ticketingConfig",
      "ticketingProducts"
    ],
    "steps": [
      "Save a paused catalog and draft ticket types in the event currency.",
      "Review inventory, sales settings and the paid-sales checklist before opening checkout.",
      "A controlled checkout produces the expected order, guest and pass; free checkout does not verify paid collection."
    ],
    "checklist": "tickets",
    "preview": "tickets",
    "guestTab": null
  },
  "giving": {
    "methods": [
      "donationCampaign"
    ],
    "steps": [
      "Set a campaign title, currency, goal and allowed giving methods.",
      "Save changes, then explicitly enable the campaign before sharing its public page.",
      "A test pledge stays separate from received money; confirmed money requires payment evidence."
    ],
    "checklist": "giving",
    "preview": "giving",
    "guestTab": null
  },
  "live": {
    "methods": [
      "liveActivities"
    ],
    "steps": [
      "Create an activity and add the question or answer choices.",
      "Review moderation, make the activity live and open the question for responses.",
      "A controlled guest response appears once in the operator results."
    ],
    "checklist": "activities",
    "preview": "guest",
    "guestTab": "more"
  },
  "team": {
    "methods": [
      "plannerDashboard",
      "listTasks"
    ],
    "steps": [
      "Set the budget currency, milestones and owners; add vendors or documents as needed.",
      "Review role permissions, deadlines and the run sheet before handoff.",
      "An assigned collaborator can perform their work and cannot access restricted records."
    ],
    "checklist": "planner",
    "preview": "workspace",
    "guestTab": null
  },
  "messages": {
    "methods": [
      "listTemplates",
      "listScheduledCommunications"
    ],
    "steps": [
      "Review recipients, consent and the invitation or update template.",
      "Choose only configured channels and review delivery credits before sending.",
      "Only an explicitly authorized test recipient receives the intended message; inspect final delivery status."
    ],
    "checklist": "channels",
    "preview": "guest",
    "guestTab": "pass"
  },
  "guests": {
    "methods": [
      "listGuests"
    ],
    "steps": [
      "Import or add the correct people; review duplicates and party relationships.",
      "Edit an existing guest as an existing record, then inspect registration status.",
      "A controlled registration or import appears in the right event without a duplicate guest."
    ],
    "checklist": "rsvp",
    "preview": "guest",
    "guestTab": "more"
  },
  "passes": {
    "methods": [
      "listGuests"
    ],
    "steps": [
      "Choose the correct guest and review confirmation and admission rules.",
      "Generate or send a pass only when the guest is eligible; review the delivery channel.",
      "The personal pass shows the right identity, event details and usable admission QR."
    ],
    "checklist": "pass",
    "preview": "guest",
    "guestTab": "pass"
  },
  "checkin": {
    "methods": [
      "listGuests"
    ],
    "steps": [
      "Open the intended scanner and admission mode.",
      "Scan a controlled pass, then repeat the scan and inspect its result and history.",
      "Valid admission is recorded; duplicate, invalid and wrong-event credentials are handled correctly."
    ],
    "checklist": "checkin",
    "preview": "guest",
    "guestTab": "pass"
  },
  "access": {
    "methods": [
      "listZones",
      "listGates"
    ],
    "steps": [
      "Create venue areas and gates with the correct capacity and access rules.",
      "Review allowed tickets, staff roles and entry/exit behavior.",
      "A permitted test pass enters the intended zone and a forbidden pass is denied with a reason."
    ],
    "checklist": "access",
    "preview": "guest",
    "guestTab": "pass"
  },
  "meals": {
    "methods": [
      "listMenuCategories"
    ],
    "steps": [
      "Add menu categories and choices; set when guests can select them.",
      "Review requirements for admission and serving before using the kitchen view.",
      "A controlled guest selects an allowed meal and serving it preserves the selection and repeat-service locks."
    ],
    "checklist": "orders",
    "preview": "guest",
    "guestTab": "more"
  },
  "deliveries": {
    "methods": [
      "listShipments"
    ],
    "steps": [
      "Create the shipment or collection and check its recipients and items.",
      "Review packing, vendor access and dispatch settings before fulfilment.",
      "The correct controlled guest has the right items and collection or delivery status."
    ],
    "checklist": "logistics",
    "preview": "guest",
    "guestTab": "more"
  },
  "gifts": {
    "methods": [
      "listRegistryItems",
      "getRegistrySettings"
    ],
    "steps": [
      "Create gifts or registry links and check quantities and public instructions.",
      "Review public visibility and the difference between a claim and a payment.",
      "A controlled claim updates quantity and privacy correctly and can be released when supported."
    ],
    "checklist": "gifts",
    "preview": "registry",
    "guestTab": null
  },
  "speakers": {
    "methods": [
      "listSpeakers",
      "getSpeakerSettings"
    ],
    "steps": [
      "Add speaker names, bios and approved photos.",
      "Review listing visibility and session assignments before publishing.",
      "The intended public speaker page contains the correct profile, image and event links."
    ],
    "checklist": "speakers",
    "preview": "speakers",
    "guestTab": null
  },
  "partners": {
    "methods": [
      "listPartners",
      "getPartnerSettings"
    ],
    "steps": [
      "Add partner categories, names, logos and approved links.",
      "Review public listing and any conference deliverables before launch.",
      "The public listing shows the intended sponsors and no private operational notes."
    ],
    "checklist": "partners",
    "preview": "partners",
    "guestTab": null
  },
  "reminders": {
    "methods": [
      "listScheduledCommunications"
    ],
    "steps": [
      "Choose the audience and event-timezone schedule.",
      "Select only usable channels and review consent, credits and the final send time.",
      "Only the intended controlled recipient receives the reminder at the configured stage."
    ],
    "checklist": "automation",
    "preview": "workspace",
    "guestTab": null
  },
  "design": {
    "methods": [
      "getEventDesign",
      "designOutputs"
    ],
    "steps": [
      "Choose the template, colours, wording and event assets.",
      "Review each surface on desktop and phone, then publish the intended version.",
      "The public invitation uses the saved design and its main guest action works."
    ],
    "checklist": "design",
    "preview": "invitation",
    "guestTab": null
  },
  "website": {
    "methods": [
      "website",
      "websiteReleases"
    ],
    "steps": [
      "Review event content, links, speakers and registration destination.",
      "Generate a fresh preview and publish the intended website version.",
      "The live website shows the published content and sends guests to the right registration page."
    ],
    "checklist": "design",
    "preview": "website",
    "guestTab": null
  },
  "guesthub": {
    "methods": [
      "getEventDesign",
      "messagingSettings"
    ],
    "steps": [
      "Choose the personal-hub layout and guest modules.",
      "Publish the design and review which modules are visible to each audience.",
      "An authorized guest sees their own pass, services and updates, with the correct permissions."
    ],
    "checklist": "guesthub",
    "preview": "guest",
    "guestTab": "pass"
  },
  "conference": {
    "methods": [
      "getConferenceCenter"
    ],
    "steps": [
      "Create tracks, calls and submission requirements.",
      "Review the call, accept the controlled submission, and deliberately connect it to the programme.",
      "The submission reaches review and accepted work connects to the correct speaker and session."
    ],
    "checklist": "calls",
    "preview": "workspace",
    "guestTab": null
  },
  "certificates": {
    "methods": [
      "listCertificateTemplates",
      "listEventCertificates"
    ],
    "steps": [
      "Create a template and the eligibility rules.",
      "Preview the certificate, review eligible recipients and issue only the intended records.",
      "The issued controlled certificate verifies publicly with the correct identity, design and eligibility."
    ],
    "checklist": "certificates",
    "preview": "certificate",
    "guestTab": null
  },
  "resources": {
    "methods": [
      "listPresenterMaterials"
    ],
    "steps": [
      "Upload or link the material and assign the intended session and audience.",
      "Review visibility, published version and presenter access.",
      "The intended viewer can open the correct resource; a restricted viewer cannot."
    ],
    "checklist": "live_materials",
    "preview": "workspace",
    "guestTab": null
  },
  "displays": {
    "methods": [
      "liveDisplays",
      "liveWorkflows"
    ],
    "steps": [
      "Create the content workflow and connect the intended display or projector.",
      "Rehearse presenter controls and check each assigned screen before going live.",
      "The intended screen receives the correct content and competing control or display access is handled correctly."
    ],
    "checklist": "control",
    "preview": "workspace",
    "guestTab": null
  },
  "meetings": {
    "methods": [
      "listMeetings"
    ],
    "steps": [
      "Create the meeting with title, timezone, venue or join URL and invitation design.",
      "Save a draft; review reusable or personalized invitation links before sending.",
      "The invitation page shows the meeting details and a separate working join action."
    ],
    "checklist": "rsvp",
    "preview": "workspace",
    "guestTab": null
  },
  "staff": {
    "methods": [
      "listMembers",
      "listTasks"
    ],
    "steps": [
      "Invite the correct collaborator and choose effective event permissions.",
      "Assign a controlled task and review the access matrix as that role.",
      "The collaborator can complete the assigned work and is denied unrelated privileged actions."
    ],
    "checklist": "team",
    "preview": "workspace",
    "guestTab": null
  },
  "inbox": {
    "methods": [
      "messagingSettings",
      "listAnnouncements"
    ],
    "steps": [
      "Review GuestHub messaging settings and the audience for each update.",
      "Preview the announcement or conversation and confirm recipients before sending.",
      "Only the intended guest sees the update and private conversations remain scoped."
    ],
    "checklist": "channels",
    "preview": "guest",
    "guestTab": "more"
  },
  "collections": {
    "methods": [
      "listContactLists",
      "listCalendars"
    ],
    "steps": [
      "Create reusable contact lists or organization calendars.",
      "Review visibility, selected events and the difference between contacts and registered guests.",
      "The right audience sees the calendar; adding a contact does not create an RSVP or pass."
    ],
    "checklist": "reuse",
    "preview": "workspace",
    "guestTab": null
  },
  "reports": {
    "methods": [
      "resultsCommandCenter"
    ],
    "steps": [
      "Choose the event, reporting period and intended result view.",
      "Reconcile the displayed counts with the selected guest, order or operational records.",
      "The named report and export agree with the records in scope without leaking another event."
    ],
    "checklist": "results",
    "preview": "workspace",
    "guestTab": null
  },
  "integrations": {
    "methods": [
      "listApiKeys",
      "listWebhooks"
    ],
    "steps": [
      "Choose the integration, credential scope and destination.",
      "Review permissions, webhook setup and any provider requirements before connecting.",
      "The scoped test request or webhook reaches only the intended system and failures remain visible."
    ],
    "checklist": "integrations",
    "preview": "workspace",
    "guestTab": null
  },
  "marketing": {
    "methods": [
      "marketingMe"
    ],
    "steps": [
      "Confirm your account has marketing access and the right audience.",
      "Review consent, credits and campaign content before any outbound action.",
      "Only the authorized audience is targeted; blocked or unapproved access is explained."
    ],
    "checklist": "channels",
    "preview": "workspace",
    "guestTab": null
  },
  "academy": {
    "methods": [
      "trainingMe"
    ],
    "steps": [
      "Choose the guide or training module for the job you need.",
      "Review the steps and apply them to a rehearsal event where appropriate.",
      "The intended organizer can access the lesson and save the relevant learning progress."
    ],
    "checklist": "help",
    "preview": "workspace",
    "guestTab": null
  }
}
export function toolWorkspaceHref(tool) {const [path,search='']=tool.route.split('?');const params=new URLSearchParams(search);params.set('toolGuide',tool.id);return `${path}?${params}`}
export function toolForLocation(pathname,search) {
 const query=new URLSearchParams(search),explicit=CUSTOMER_TOOLS.find(t=>t.id===query.get('toolGuide')&&t.route.split('?')[0]===pathname&&[...new URLSearchParams(t.route.split('?')[1])].every(([k,v])=>(query.get(k)||'').toLowerCase()===v.toLowerCase()))
 if(explicit)return explicit
 if(pathname==='/billing-redesign')return null
 const candidates=CUSTOMER_TOOLS.filter(t=>t.route.split('?')[0]===pathname)
 const exact=candidates.filter(t=>{const qs=new URLSearchParams(t.route.split('?')[1]);return [...qs].every(([k,v])=>(query.get(k)||'').toLowerCase()===v.toLowerCase())}).sort((a,b)=>b.route.length-a.route.length)
 return exact[0]||null
}
