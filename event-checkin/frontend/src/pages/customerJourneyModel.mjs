import {parseUtc} from '../timeutil.js'
export const CUSTOMER_JOURNEY_ENABLED = import.meta.env?.VITE_CUSTOMER_JOURNEY_ENABLED === 'true'
export const STARTING_POINTS = [
 {id:'invitation',title:'Invite guests & collect RSVPs',description:'Share an invitation and keep every reply in one place.',mode:'rsvp',icon:'✉'},
 {id:'tickets',title:'Sell tickets & manage registration',description:'Let people book their place and receive their event pass.',mode:'ticketed',icon:'◈'},
 {id:'checkin',title:'Check guests in',description:'Create guest passes and manage arrival with QR scanning.',mode:'rsvp',icon:'▣'},
 {id:'seating',title:'Arrange tables & seating',description:'Assign guests to tables and help them find their seats.',mode:'rsvp',icon:'▦'},
 {id:'conference',title:'Organise a conference',description:'Bring registration, speakers, sessions and attendees together.',mode:'rsvp',icon:'▤'},
 {id:'fundraiser',title:'Collect donations',description:'Give guests a simple way to support your cause.',mode:'rsvp',icon:'♡'},
]
export const LAUNCH_EVENT_TYPES=['Wedding','Birthday','Conference / seminar','Corporate event','Fundraiser','Community / religious event','Concert / festival','Other']
export const LAUNCH_NEXT = {
 invitation:{title:'Preview your invitation, then share it.',description:'Your saved invitation is ready to review. Check its details and share the link when you are ready.',action:'Preview & share invitation',route:'/create-invitation',tool:'design'},
 seating:{title:'Add your guests and build your tables.',description:'Start with your guest list, then choose table counts and seats per table. Assign guests and arrange the floor plan when ready.',action:'Set up tables & seating',tool:'seating'},
 checkin:{title:'Import your guests and prepare their passes.',description:'Add or import your existing guest list first. Review personal passes before opening the scanner for arrivals.',action:'Add guests & prepare passes',route:'/guests-redesign?tab=guests',tool:'passes'},
 tickets:{title:'Create your tickets and set up payments.',description:'Add ticket types and prices, then review payment readiness before opening sales.',action:'Set up tickets & payments',route:'/ticketing-redesign',tool:'tickets'},
 conference:{title:'Build your conference programme.',description:'Start with sessions and speakers, then add registration and attendee tools in the same event.',action:'Set up the programme',tool:'programme'},
 fundraiser:{title:'Create your giving campaign.',description:'Choose a goal and giving options, then review collection readiness before publishing.',action:'Set up donations',tool:'giving'},
}
export function launchNext(event){const goal=event?.setup_preferences?.starting_point;return LAUNCH_NEXT[goal]||null}
export const CUSTOMER_TOOLS = [
  {
    "id": "seating",
    "title": "Give everyone a seat",
    "description": "Plan from guest count or table count, choose seats per table, then arrange and assign.",
    "route": "/addons-redesign?tab=seating",
    "group": "Welcome guests",
    "icon": "chair",
    "keywords": "floor plan tables capacity chairs indoor outdoor",
    "flag": "seating_enabled",
    "addon": "addon_seating"
  },
  {
    "id": "programme",
    "title": "Plan the programme",
    "description": "Publish sessions, speakers and rooms in the guest timetable.",
    "route": "/experience-redesign?tab=workflow",
    "group": "Run a conference",
    "icon": "calendar",
    "keywords": "agenda schedule workflow tracks attendance",
    "flag": "experience_enabled",
    "addon": "addon_experience"
  },
  {
    "id": "tickets",
    "title": "Create your tickets",
    "description": "Manage ticket types, sales, orders and payment readiness. Provider checks apply before paid sales.",
    "route": "/ticketing-redesign",
    "group": "Sell & fundraise",
    "icon": "ticket",
    "keywords": "payout refunds promos transfers box office payments"
  },
  {
    "id": "giving",
    "title": "Raise funds",
    "description": "Set up giving goals, pledges and a public campaign. Review collection and publication separately.",
    "route": "/live-redesign?tab=Donations",
    "group": "Sell & fundraise",
    "icon": "heart",
    "keywords": "donation tracker fundraiser offline verification",
    "flag": "engagement_enabled",
    "addon": "addon_engagement"
  },
  {
    "id": "community",
    "title": "Help people connect",
    "description": "Set up FestioMe channels, profiles and connections with adult eligibility and guest approvals.",
    "route": "/festiome-redesign",
    "group": "Engage people",
    "icon": "users",
    "keywords": "networking chat meetups community",
    "flag": "festiome_addon_enabled",
    "addon": "addon_festiome"
  },
  {
    "id": "live",
    "title": "Ask your audience",
    "description": "Run polls, quizzes, Q&A, word clouds, surveys and voting with Festio Live.",
    "route": "/live-redesign?tab=Activities",
    "group": "Engage people",
    "icon": "mic",
    "keywords": "participation feedback ratings question bank",
    "flag": "engagement_enabled",
    "addon": "addon_engagement"
  },
  {
    "id": "team",
    "title": "Plan with your team",
    "description": "Connect budgets, vendors, procurement, contracts, milestones, timeline, run sheet and documents.",
    "route": "/planner-redesign",
    "group": "Plan together",
    "icon": "book",
    "keywords": "finance operations project tasks planning",
    "flag": "planner_enabled",
    "addon": "addon_planner"
  },
  {
    "id": "messages",
    "title": "Send invitations & updates",
    "description": "Review recipients, consent, email, SMS, WhatsApp and credits before sending.",
    "route": "/guests-redesign?tab=invite",
    "group": "Welcome guests",
    "icon": "send",
    "keywords": "broadcast communication share personal pass"
  },
  {
    "id": "forms",
    "title": "Collect information & consent",
    "description": "Prepare guest questions, forms and consent steps. Review signing and eligibility rules in the editor.",
    "route": "/experience-redesign?tab=consent",
    "group": "Welcome guests",
    "icon": "check",
    "keywords": "registration answers guardian information waivers",
    "flag": "experience_enabled",
    "addon": "addon_experience"
  },
  {
    "id": "guests",
    "title": "Manage your guest list",
    "description": "Import or add guests, manage households and groups, edit records and export lists.",
    "route": "/guests-redesign?tab=guests",
    "group": "Welcome guests",
    "icon": "users",
    "keywords": "spreadsheet shared sheet bulk dedup contacts"
  },
  {
    "id": "passes",
    "title": "Issue personal guest passes",
    "description": "Manage guest passes and delivery from the guest list. Pass availability follows registration rules.",
    "route": "/guests-redesign?tab=guests",
    "group": "Welcome guests",
    "icon": "ticket",
    "keywords": "QR email digital admission confirmed"
  },
  {
    "id": "checkin",
    "title": "Welcome guests at the door",
    "description": "Scan personal QR passes, review admission and handle duplicate scans.",
    "route": "/scanner-redesign",
    "group": "Welcome guests",
    "icon": "check",
    "keywords": "scanner attendance check in entry exit"
  },
  {
    "id": "access",
    "title": "Manage venue access",
    "description": "Configure venue areas, gates and ticket-based access rules.",
    "route": "/checkin-redesign?tab=zones",
    "group": "Welcome guests",
    "icon": "shield",
    "keywords": "zones entrances restrictions",
    "flag": "venue_access_enabled",
    "addon": "addon_venue_access"
  },
  {
    "id": "meals",
    "title": "Organize meals & orders",
    "description": "Configure menus and guest selections, then run service from the kitchen workspace.",
    "route": "/addons-redesign?tab=orders",
    "group": "Welcome guests",
    "icon": "card",
    "keywords": "food drinks catering serving dietary",
    "flag": "menu_enabled",
    "addon": "addon_menu"
  },
  {
    "id": "deliveries",
    "title": "Organize deliveries & collections",
    "description": "Prepare shipments, packing lists, guest collections and vendor fulfilment.",
    "route": "/addons-redesign?tab=logistics",
    "group": "Welcome guests",
    "icon": "upload",
    "keywords": "merchandise welcome packs souvenirs aso ebi logistics",
    "flag": "logistics_enabled",
    "addon": "addon_logistics"
  },
  {
    "id": "gifts",
    "title": "Build a gift list",
    "description": "Create gifts, registry links and contribution wishes; review the available claim and payment options.",
    "route": "/addons-redesign?tab=registry",
    "group": "Sell & fundraise",
    "icon": "image",
    "keywords": "wishlist wedding registry honeymoon",
    "flag": "registry_enabled",
    "addon": "addon_registry"
  },
  {
    "id": "speakers",
    "title": "Showcase your speakers",
    "description": "Add reusable speaker profiles, bios, photos and public showcase settings.",
    "route": "/addons-redesign?tab=speakers",
    "group": "Run a conference",
    "icon": "mic",
    "keywords": "keynote panelists presenters",
    "flag": "speaker_enabled",
    "addon": "addon_speakers"
  },
  {
    "id": "partners",
    "title": "Recognize partners & sponsors",
    "description": "Organize partner categories, logos and sponsor information for guests.",
    "route": "/addons-redesign?tab=partners",
    "group": "Run a conference",
    "icon": "users",
    "keywords": "exhibitors sponsorship showcase",
    "flag": "partner_enabled",
    "addon": "addon_partners"
  },
  {
    "id": "reminders",
    "title": "Schedule reminders",
    "description": "Set audiences, timing and available channels. Review approvals and credits before scheduling.",
    "route": "/addons-redesign?tab=reminders",
    "group": "Welcome guests",
    "icon": "clock",
    "keywords": "automated followup RSVP reminder series",
    "flag": "reminders_enabled",
    "addon": "addon_reminders"
  },
  {
    "id": "design",
    "title": "Make the invitation yours",
    "description": "Choose invitation templates, envelopes, wording and colours in Design Studio.",
    "route": "/design-studio-redesign",
    "group": "Design & publish",
    "icon": "palette",
    "keywords": "media images branding assets reuse flyer email certificate templates"
  },
  {
    "id": "website",
    "title": "Publish your event website",
    "description": "Bring the event story, details, speakers and registration destination together.",
    "route": "/design-studio-redesign/website",
    "group": "Design & publish",
    "icon": "external",
    "keywords": "landing page public site theme"
  },
  {
    "id": "guesthub",
    "title": "Design the personal GuestHub",
    "description": "Choose how guests see their pass, programme, seat, forms and updates.",
    "route": "/design-studio-redesign?surface=hub",
    "group": "Design & publish",
    "icon": "eye",
    "keywords": "guest app FestioHub RSVP layouts"
  },
  {
    "id": "conference",
    "title": "Manage conference submissions",
    "description": "Organize calls, tracks, abstracts and reviews, then connect accepted speakers.",
    "route": "/conference-center",
    "group": "Run a conference",
    "icon": "layers",
    "keywords": "applications exhibitors proposals selection"
  },
  {
    "id": "certificates",
    "title": "Issue event certificates",
    "description": "Design templates, review eligibility and issue verifiable credentials. Email delivery is separate.",
    "route": "/live-redesign?tab=Certificates",
    "group": "Run a conference",
    "icon": "file",
    "keywords": "awards graduation accreditation participation attendance",
    "flag": "engagement_enabled",
    "addon": "addon_engagement"
  },
  {
    "id": "resources",
    "title": "Prepare presenter materials",
    "description": "Organize presentation materials and resources for your live event.",
    "route": "/live-redesign?tab=Materials",
    "group": "Run a conference",
    "icon": "book",
    "keywords": "slides resources PDFs content uploads",
    "flag": "engagement_enabled",
    "addon": "addon_engagement"
  },
  {
    "id": "displays",
    "title": "Run screens & presentations",
    "description": "Connect content channels and devices, then operate the live control room.",
    "route": "/live-redesign?tab=Displays",
    "group": "Engage people",
    "icon": "layers",
    "keywords": "projector TV slides presenter big screen",
    "flag": "engagement_enabled",
    "addon": "addon_engagement"
  },
  {
    "id": "meetings",
    "title": "Arrange a meeting",
    "description": "Create meetings, invitation designs and reusable or personal response links.",
    "route": "/meetings",
    "group": "Engage people",
    "icon": "calendar",
    "scope": "Organization",
    "keywords": "Google Meet calendar appointments"
  },
  {
    "id": "staff",
    "title": "Assign team roles & tasks",
    "description": "Invite collaborators, review effective access and assign event tasks.",
    "route": "/team-redesign?tab=team",
    "group": "Plan together",
    "icon": "users",
    "keywords": "permissions staff volunteers checklist"
  },
  {
    "id": "inbox",
    "title": "Keep the guest conversation together",
    "description": "Manage event announcements and guest messages in one communication workspace.",
    "route": "/communications-redesign?tab=hub",
    "group": "Welcome guests",
    "icon": "message",
    "keywords": "inbox chat updates direct message"
  },
  {
    "id": "collections",
    "title": "Organize contacts & calendars",
    "description": "Manage reusable contact lists and organization calendars without turning every contact into a guest.",
    "route": "/billing-redesign?tab=org",
    "group": "Workspace & growth",
    "icon": "calendar",
    "scope": "Organization",
    "keywords": "audience calendar share collection reusable"
  },
  {
    "id": "reports",
    "title": "Understand your event results",
    "description": "Review guest responses, communication outcomes, attendance and event operations.",
    "route": "/event-results-redesign",
    "group": "Workspace & growth",
    "icon": "barchart",
    "keywords": "analytics reporting exports insights"
  },
  {
    "id": "integrations",
    "title": "Connect your systems",
    "description": "Review available integrations and API tools. Credentials and service-specific setup still apply.",
    "route": "/api-explorer-redesign",
    "group": "Workspace & growth",
    "icon": "settings",
    "keywords": "webhooks developer integration API automation"
  },
  {
    "id": "marketing",
    "title": "Reach your next audience",
    "description": "Manage marketing audiences and campaigns where access has been approved.",
    "route": "/marketing",
    "group": "Workspace & growth",
    "icon": "send",
    "scope": "Approval required",
    "keywords": "growth campaigns leads outreach"
  },
  {
    "id": "academy",
    "scope": "Approval required",
    "title": "Learn what to do next",
    "description": "Use Festio Academy guides for setup, event operations and the guest journey.",
    "route": "/training",
    "group": "Workspace & growth",
    "icon": "book",
    "keywords": "help support training tutorials"
  }
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
 if (!tool.flag) return {state:tool.scope==='Approval required'?'Approved access required':'Open workspace',included:null}
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
 return JSON.stringify([event?.id,event?.status,event?.rsvp_enabled,event?.invite_mode,event?.rsvp_token,event?.rsvp_deadline,event?.external_registration_url,event?.setup_preferences?.quick_invite?.share_slug,event?.rsvp_capacity,event?.rsvp_require_approval,event?.event_date,event?.timezone])
}

export const EVENT_RECIPES = [
  {
    "id": "wedding",
    "title": "Wedding & Nikkah",
    "description": "A personal invitation, thoughtful seating and a smooth welcome.",
    "tools": [
      "design",
      "seating",
      "meals",
      "gifts",
      "checkin"
    ]
  },
  {
    "id": "conference",
    "title": "Conference & convention",
    "description": "Registration, speakers, sessions and participation in one journey.",
    "tools": [
      "programme",
      "speakers",
      "conference",
      "partners",
      "certificates",
      "live"
    ]
  },
  {
    "id": "fundraiser",
    "title": "Fundraiser & gala",
    "description": "Tell the story, welcome supporters and organize giving.",
    "tools": [
      "giving",
      "tickets",
      "seating",
      "partners",
      "website"
    ]
  },
  {
    "id": "celebration",
    "title": "Birthday & naming ceremony",
    "description": "A beautiful invitation and simple replies for family and friends.",
    "tools": [
      "design",
      "messages",
      "guests",
      "meals"
    ]
  },
  {
    "id": "community",
    "title": "Community & faith event",
    "description": "Welcome your community and coordinate the people helping.",
    "tools": [
      "guests",
      "checkin",
      "staff",
      "programme",
      "messages"
    ]
  },
  {
    "id": "corporate",
    "title": "Corporate & networking event",
    "description": "A professional programme, meaningful connections and useful feedback.",
    "tools": [
      "website",
      "programme",
      "community",
      "meetings",
      "live"
    ]
  },
  {
    "id": "ticketed",
    "title": "Concert & ticketed event",
    "description": "Organize sales, gate access and the team running the show.",
    "tools": [
      "tickets",
      "access",
      "checkin",
      "staff",
      "displays"
    ]
  },
  {
    "id": "graduation",
    "title": "Graduation & awards",
    "description": "Celebrate achievements with an organized programme and recognition.",
    "tools": [
      "programme",
      "certificates",
      "seating",
      "speakers",
      "design"
    ]
  }
]

export const FESTIO_ADVANTAGES = [
  {
    "title": "One connected guest journey",
    "description": "Keep invitations, replies, personal passes, seating and check-in tied to the same guest record.",
    "tool": "guests",
    "icon": "users"
  },
  {
    "title": "An invitation that feels personal",
    "description": "Choose your wording, colours, templates and optional envelope opening without recreating the event.",
    "tool": "design",
    "icon": "palette"
  },
  {
    "title": "A personal home for every guest",
    "description": "GuestHub brings the pass, programme, seat, forms and event updates together as those tools are configured.",
    "tool": "guesthub",
    "icon": "eye"
  },
  {
    "title": "Plan the room, then welcome your people",
    "description": "Connect tables and floor plans to guest assignments and the check-in workflow.",
    "tool": "seating",
    "icon": "chair"
  },
  {
    "title": "Participation beyond the RSVP",
    "description": "Add Festio Live polls and Q&A, or an eligible attendee community with FestioMe.",
    "tool": "live",
    "icon": "mic"
  },
  {
    "title": "Start simple. Add what the event needs.",
    "description": "Keep the same event and invitation as you add a programme, fundraising, team planning or other available tools.",
    "tool": "team",
    "icon": "layers"
  }
]

export function recommendedRecipe(event) {
 const text=String(event?.event_type || event?.setup_preferences?.starting_point || '').toLowerCase()
 if(/wedding|nikkah|aqd/.test(text))return 'wedding'
 if(/conference|seminar|convention/.test(text))return 'conference'
 if(/fundrais|gala|banquet/.test(text))return 'fundraiser'
 if(/community|religio|faith/.test(text))return 'community'
 if(/corporate|network/.test(text))return 'corporate'
 if(/concert|ticket/.test(text))return 'ticketed'
 if(/graduation|award/.test(text))return 'graduation'
 return 'celebration'
}
export function searchCustomerTools(tools, category, query) {
 const terms=query.toLowerCase().trim().split(/\s+/).filter(Boolean)
 return tools.filter(tool=>(category==='All'||tool.group===category)&&terms.every(term=>`${tool.id} ${tool.title} ${tool.description} ${tool.keywords||''}`.toLowerCase().includes(term)))
}
