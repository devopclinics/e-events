"""Published, versioned Festio staff curriculum. Content changes ship as a new version.

Lesson copy is grounded in the same product facts as the in-app Help Center
(see frontend/src/guideContent.mjs) so the Academy and Help stay consistent
with each other instead of drifting into separately-maintained descriptions.
"""

COURSE_KEY = "festio-platform-foundations"
COURSE_VERSION = 1

ALL_ROLES = {"owner", "admin", "staff"}
_MANAGER_ROLES = {"owner", "admin"}  # lessons about configuring the product, not running it day-of

_ORIENTATION_PREREQS = ["Sign in to your Festio staff account", "Have this lesson's guide image open for reference"]
_HANDS_ON_PREREQS = ["Sign in to your Festio staff account", "Use a safe training or staging event for practice"]

_modules = [
    ("foundations", "1. Platform foundations", [
        ("platform-overview", "Platform overview", "Festio_Complete_Platform.png"),
        ("audience", "Who Festio serves", "festio-target-audiences.png"),
        ("outcomes", "Value and outcomes", "festio-value-outcomes.png"),
        ("use-cases", "Use-case examples", "festio-use-case-examples.png"),
    ]),
    ("operations", "2. Operations flow", [
        ("event-operations", "Event operations flow", "festio-event-operations-flow.png"),
        ("guest-journey", "Guest journey flow", "festio-guest-journey-flow.png"),
        ("event-day", "Event-day operations map", "festio-event-day-operations-map.png"),
        ("roles", "Roles and responsibilities", "festio-roles-responsibilities-map.png"),
    ]),
    ("capabilities", "3. Product capabilities", [
        ("ecosystem", "Product ecosystem", "festio-product-ecosystem-map.png"),
        ("capability-landscape", "Complete capability landscape", "festio-complete-capability-landscape.png"),
        ("packages", "Packages and upgrade journey", "festio-packages-upgrade-journey.png"),
        ("security", "Security and trust", "festio-security-trust.png"),
        ("app-explainer", "How the Festio app works", "festio-app-explainer.png"),
    ]),
]

_setup = [
    ("event-setup", "Event Setup"), ("planner", "Planner"), ("ticketing", "Ticketing"),
    ("festiopass", "FestioPass"), ("guest-management", "Guest Management"),
    ("guest-communication", "Guest Communication"), ("festiohub", "FestioHub"),
    ("public-pages", "Public Pages"), ("design-studio", "Design Studio"),
    ("seating-floor-plan", "Seating & Floor Plan"), ("gifts", "Gifts"),
    ("registry", "Registry"), ("checkin-scanner", "Check-in & Scanner"),
    ("guest-experience", "Guest Experience"), ("task-management", "Task Management"),
    ("team-management", "Team Management"), ("live-command-center", "Live Command Center"),
    ("kitchen-logistics", "Kitchen & Logistics"), ("reporting-results", "Reporting & Results"),
    ("platform-api", "Platform & API"),
]
_modules.append(("setup", "4. Capability setup guides", [
    (key, title, f"steps/{i:02d}-festio-{key}-guide.png") for i, (key, title) in enumerate(_setup, 1)
]))


# Per-lesson content. Every key from `_modules` above must have an entry here.
# Each lesson gets its own objective, rationale, steps, pitfalls, practical
# exercise and quiz -- grounded in the same facts as guideContent.mjs -- so the
# "knowledge check" actually tests that lesson rather than a shared template.
LESSON_CONTENT = {
    # ---- 1. Platform foundations ----------------------------------------
    "platform-overview": {
        "objective": "Explain what Festio is, the ways an organizer can run guests through it (free RSVP, paid Ticket sales, and Check-in), and where each part of the product lives.",
        "why_it_matters": "Every other lesson in this course assumes you already know the shape of the product -- this is the map everything else hangs off of.",
        "steps": [
            "Open festio.events and sign in with the training account you were given.",
            "In Event Setup, note the sidebar groups: Start here, Guests, Invites & RSVP, Guest Communication, add-ons (Venue Access, Seating, Orders, Deliveries, Gift list -- shown only once turned on), FestioMe, Team, and Tasks.",
            "Open a training event and switch between Draft, Active, and Ended status in Start here -- Check-in only accepts scans while the event is Active.",
            "Identify the three separate paid tracks a customer can be on at once: an Event Pass unlocking add-ons on a free/RSVP event, paid Ticket sales checkout, and an org-wide API subscription.",
        ],
        "common_mistakes": [
            "Treating Event Pass and Ticket sales as the same feature -- they are two different paid tracks",
            "Trying to check guests in on a Draft event",
            "Assuming every organizer sees every sidebar item -- add-ons only appear once turned on",
        ],
        "practical": "In a training org, create one free event and list which sidebar items are visible before any add-on is turned on. Submit the list as evidence.",
        "quiz": [
            {"question": "Which statement about Festio's paid tracks is correct?", "options": [
                "Event Pass, Ticket sales, and the org API subscription are three separate paid tracks that can all apply to the same account",
                "Event Pass and Ticket sales are the same feature under two names",
                "Only one paid feature can be active on an account at a time",
                "Ticket sales is included free with every Event Pass",
            ], "correct": 0},
            {"question": "What has to be true for Check-in to accept scans for an event?", "options": [
                "The event must be set to Active", "The event must be set to Draft",
                "The organizer must have Ticket sales turned on", "The event must have Venue Access enabled",
            ], "correct": 0},
        ],
    },
    "audience": {
        "roles": _MANAGER_ROLES,
        "objective": "Identify the main categories of organizer Festio serves and how their priority features differ, so you can point a customer to the right tools quickly.",
        "why_it_matters": "Support and onboarding conversations go faster when you already know whether you're talking to a wedding planner, a conference organizer, or a school -- their priority features are different.",
        "steps": [
            "Review the target-audience guide image and note the segments: social/family events, corporate and conference organizers, schools and institutions, and ticketed public events.",
            "For a wedding/social organizer, identify the add-ons they reach for first -- typically Seating, Gift list, Deliveries (aso-ebi/gifts).",
            "For a conference/corporate organizer, identify what matters most -- typically Venue Access (zones/badges), Experience (sessions, consent), Ticket sales.",
            "For a school or institution running a ceremony, identify the feature built specifically for them -- invitation categories & automatic seating, where one submitter registers a whole party.",
        ],
        "common_mistakes": [
            "Recommending Venue Access to a small family event that just needs RSVP tracking",
            "Missing that invitation categories exist when a school or convention describes letting one person register their whole family or group",
            "Assuming ticketed public events and private RSVP events use the same checkout model",
        ],
        "practical": "Pick one guest list you've seen in training data, decide which audience segment it best fits, and which two add-ons you'd recommend first. Submit your reasoning.",
        "quiz": [
            {"question": "A school wants one parent to register their whole family for a graduation, seated together. Which feature answers this?", "options": [
                "Invitation categories & automatic seating", "Ticket sales waitlist",
                "Venue Access zone rules", "Kitchen prep tally",
            ], "correct": 0},
            {"question": "Which add-on is most associated with wedding/social organizers rather than conferences?", "options": [
                "Gift list", "Session attendance steps", "Badge/consent workflow", "Zone occupancy analytics",
            ], "correct": 0},
        ],
    },
    "outcomes": {
        "roles": _MANAGER_ROLES,
        "objective": "Describe the concrete operational outcomes Festio delivers -- accurate headcounts, no double-booked seats, live event-day visibility -- in terms a customer cares about, not just feature names.",
        "why_it_matters": "Customers buy outcomes, not feature lists. Framing training and support around outcomes keeps every other lesson grounded in why it matters.",
        "steps": [
            "Review the value/outcomes guide image and note the four outcome categories: accurate guest data, no double-booking, live event-day visibility, and reduced manual admin.",
            "Trace one guarantee end to end: 'a seat can't be double-booked' -- find where this is enforced (Seating tab capacity, and again at check-in denial).",
            "Trace 'live event-day visibility' -- open Results during an active event and identify which numbers update automatically without a page reload.",
            "Identify one manual-admin outcome -- re-importing a guest spreadsheet never creates duplicates, it only fills in missing fields.",
        ],
        "common_mistakes": [
            "Describing a feature by its tab name instead of the outcome it produces for the organizer",
            "Assuming Results needs a manual refresh -- it auto-updates",
            "Not knowing re-import is safe against duplicates, and telling a customer to delete and re-upload their guest list",
        ],
        "practical": "Pick one Festio feature and write one sentence describing the outcome it produces for an organizer, not what the feature is called.",
        "quiz": [
            {"question": "What happens if you re-import a guest spreadsheet that has some guests already loaded?", "options": [
                "Existing guests are matched and only missing fields are filled in -- no duplicates are created",
                "Every guest is duplicated", "The import is rejected", "All existing guests are deleted first",
            ], "correct": 0},
            {"question": "How does the Results page get its live numbers during an active event?", "options": [
                "It auto-refreshes on its own", "You must reload the page manually every time",
                "It only updates once the event ends", "It requires clicking a Refresh button each time",
            ], "correct": 0},
        ],
    },
    "use-cases": {
        "roles": _MANAGER_ROLES,
        "objective": "Match real event scenarios to the specific Festio configuration that fits them.",
        "why_it_matters": "Worked examples make the feature set click in a way abstract feature lists don't.",
        "steps": [
            "Review the use-case guide image and its scenarios (wedding with two entrances, tech conference with badges and sessions, school graduation, ticketed concert).",
            "For a wedding with two entrances, identify the fitting configuration: table groups as sections plus Section scanning, not Venue Access -- the two can't run together.",
            "For a tech conference with badges and sessions, identify the fitting configuration: Venue Access zones/gates plus an Experience workflow with badge pickup and session attendance steps.",
            "For a ticketed concert, identify the fitting configuration: Ticket sales checkout with ticket types linked to Venue Access tiers for zone entry.",
        ],
        "common_mistakes": [
            "Reaching for Venue Access on a two-entrance wedding instead of Section scanning, which are mutually exclusive on one event",
            "Forgetting a ticket type can be linked to a Venue Access tier so one purchase grants both admission and zone access",
            "Building an Experience workflow before the Seating/table groups it depends on exist",
        ],
        "practical": "Given a one-line event description from your manager, write the two or three add-ons you'd configure and in what order. Submit it as evidence.",
        "quiz": [
            {"question": "A wedding has two entrances, each seating a different side of the room. What should you configure?", "options": [
                "Table groups as sections, with Section scanning turned on", "Venue Access zones with Section scanning also on",
                "Ticket sales with two ticket types", "Experience session attendance steps",
            ], "correct": 0},
            {"question": "What can a single Ticket sales ticket type do besides charge for admission?", "options": [
                "Be linked to a Venue Access ticket type so purchase also grants zone access",
                "Automatically create a table group", "Replace the need for check-in entirely", "Disable RSVP for the event",
            ], "correct": 0},
        ],
    },

    # ---- 2. Operations flow ----------------------------------------------
    "event-operations": {
        "roles": _MANAGER_ROLES,
        "objective": "Walk the full operational sequence of a Festio event from creation to archive, in the correct order.",
        "why_it_matters": "Skipping or reordering a stage -- like sending invites before RSVP settings are configured -- causes real customer-facing problems: wrong-looking invites, guests unable to RSVP, or check-in refusing scans.",
        "steps": [
            "Review the event operations flow image and name the five stages in order: create & configure, build guest list, invite & collect RSVPs, run event day, report & archive.",
            "In a training event, complete 'create & configure': event details, timezone, currency, and only the add-ons this event actually needs.",
            "Move to 'build guest list' before touching Invites & RSVP, since RSVP settings often reference guest data such as categories and tags.",
            "Confirm the event must be Active before event-day actions work, and Ended before archiving.",
        ],
        "common_mistakes": [
            "Sending invitations before RSVP page settings -- deadline, approval, custom questions -- are finalized",
            "Leaving an event on Draft on the day of the event, so check-in refuses every scan",
            "Archiving an event before exporting the data an organizer will want later",
        ],
        "practical": "In a training event, move it through Draft, Active, and Ended, and note what changes in the sidebar and in Check-in at each status.",
        "quiz": [
            {"question": "What must happen before Check-in will accept any scans?", "options": [
                "The event must be set to Active", "The event must be set to Draft",
                "Guests must be exported first", "Results must be opened once",
            ], "correct": 0},
            {"question": "Which order avoids configuration problems?", "options": [
                "Configure event, build guest list, set up RSVP/invites, run event day, report",
                "Send invites, build guest list, configure event",
                "Run event day, configure event, build guest list",
                "Report, configure event, run event day",
            ], "correct": 0},
        ],
    },
    "guest-journey": {
        "objective": "Trace what a guest actually experiences end to end -- invite, RSVP, ticket/QR, arrival, and post-admission steps.",
        "why_it_matters": "Most support questions are really 'what is the guest seeing right now' questions. Knowing the guest-side journey lets you diagnose from a guest's description alone.",
        "steps": [
            "Review the guest journey flow image: open invite, RSVP, receive QR pass, arrive/scan, optional Experience next-steps, FestioHub afterward.",
            "Open a training invite link as a guest would, RSVP as Attending, and confirm a QR pass arrives by email.",
            "Note the guest's personal FestioHub link is sent automatically with their pass -- it's not something they have to find separately.",
            "For an Experience-enabled event, note that after admission the pass can show next steps such as consent, souvenir, room assignment, or sessions, gated by dependencies the organizer configured.",
        ],
        "common_mistakes": [
            "Telling a guest to 'download the Festio app' -- there is no app, everything runs in the phone browser",
            "Assuming a guest's QR pass is separate from their invite link -- it's delivered automatically on RSVP confirmation",
            "Not checking Experience step dependencies when a guest says a step won't unlock -- it's usually waiting on an earlier required step",
        ],
        "practical": "RSVP to a training event as a guest, note each screen you land on in order, and where the QR pass and FestioHub link appeared.",
        "quiz": [
            {"question": "How does a guest get their FestioHub link?", "options": [
                "It's included automatically with their pass once RSVP is confirmed", "They must request it separately from support",
                "It only exists if Experience is enabled", "They install the Festio mobile app",
            ], "correct": 0},
            {"question": "A guest says an Experience step 'won't unlock.' What's the most likely cause?", "options": [
                "An earlier required step in its dependency chain isn't complete yet", "Their QR code is broken",
                "The event is on Draft status", "They need to clear their browser cache",
            ], "correct": 0},
        ],
    },
    "event-day": {
        "objective": "Identify which staff role uses which screen on the day of the event, and how those screens stay in sync in real time.",
        "why_it_matters": "On event day several people work different screens at once -- door staff, kitchen, organizer desk. Knowing what each one sees prevents the classic 'the organizer's screen disagrees with the door' confusion.",
        "steps": [
            "Review the event-day operations map image and identify the roles shown: door/scanning staff, kitchen/fulfillment staff, and the organizer desk.",
            "Open Check-in as door staff would, and separately open Results as the organizer desk would, side by side.",
            "Simulate one admission and confirm it appears on Results within seconds without reloading.",
            "For an Orders event, open Kitchen and identify its three views -- Order queue, Prep tally, By table -- and how 'Mark served' only becomes available once that guest is checked in.",
        ],
        "common_mistakes": [
            "Having the organizer refresh Results manually and assume it was stale -- it auto-refreshes",
            "Marking a kitchen item served before the guest is checked in -- the action is disabled until then, by design",
            "Running two scanning stations on the same gate without agreeing the first confirmed admission should win",
        ],
        "practical": "With a partner, have one of you scan a training guest while the other watches Results update live, and note how many seconds it took to appear.",
        "quiz": [
            {"question": "In Kitchen, when does 'Mark served' become available for a guest's order item?", "options": [
                "Only after that guest is checked in", "As soon as the event is Active",
                "Immediately when the order is placed", "Only after the event ends",
            ], "correct": 0},
            {"question": "Two scanning stations might scan the same guest at once. What's the correct behavior?", "options": [
                "The first confirmed admission wins; the second device shows Already admitted",
                "Both devices should admit the guest", "The second scan should override the first",
                "Staff should manually pick which admission counts",
            ], "correct": 0},
        ],
    },
    "roles": {
        "objective": "Name each Festio role -- Owner, Admin, Staff, and per-staffer permissions -- and what each can and can't do.",
        "why_it_matters": "Getting roles wrong either locks a teammate out of something they need, or over-exposes settings and financial data they shouldn't be able to touch -- both are common support tickets.",
        "steps": [
            "Review the roles & responsibilities map image and note the three org-level roles: Owner, Admin, Staff.",
            "In a training org's Team tab, add a teammate as Staff and check which sidebar items they lose access to compared to Admin.",
            "For an assigned Staff member, toggle the three per-staffer permissions -- Seats, Orders, Dashboard -- one at a time and confirm what becomes visible.",
            "Note Planner has no separate permission level yet -- any teammate with Planner access can see and edit budget, vendor payments, and documents.",
        ],
        "common_mistakes": [
            "Assuming Staff can see event settings -- they can only check guests in unless given specific extra permissions",
            "Forgetting a Staff member also needs to be assigned to the specific event, not just added to the org",
            "Putting sensitive vendor payment or budget detail into Planner assuming only owners can see it -- every teammate with Planner access can",
        ],
        "practical": "Add a test staff account, assign it to a training event with only the Orders permission on, sign in as that account, and note exactly what it can and can't reach.",
        "quiz": [
            {"question": "What can a Staff member do by default, before any extra permission is toggled on?", "options": [
                "Check guests in on events they're assigned to", "Edit event settings", "View Results", "Manage seating",
            ], "correct": 0},
            {"question": "Who can see budget and vendor payment detail in Planner?", "options": [
                "Any team member with access to Planner -- there's no separate financial permission level yet",
                "Only the org Owner", "Only Admins, never Staff", "Nobody except platform superadmins",
            ], "correct": 0},
        ],
    },

    # ---- 3. Product capabilities ------------------------------------------
    "ecosystem": {
        "roles": _MANAGER_ROLES,
        "objective": "Describe how Festio's modules connect to each other -- shared table groups, tags, and ticket types -- rather than treating each add-on as isolated.",
        "why_it_matters": "Most real configuration mistakes come from treating add-ons as silos when they actually share data across Seating, Venue Access, Section scanning, and Experience.",
        "steps": [
            "Review the product ecosystem map image and trace table groups: used by Seating (buckets), Section scanning (per-entrance routing), and Experience (scoped room assignment).",
            "Trace tags: created in Venue Access Rules, can also be auto-mapped from an RSVP answer, and are what Zone rules key off.",
            "Trace ticket types: created in Venue Access, reusable as the access grant behind a Ticket sales purchase.",
            "Identify the one pairing that's mutually exclusive rather than connected: Venue Access and Section scanning cannot run on the same event.",
        ],
        "common_mistakes": [
            "Recreating table groups separately for Seating and Section scanning instead of reusing the same ones",
            "Not realizing a tag can be auto-assigned from an RSVP answer instead of set manually per guest",
            "Trying to turn on Section scanning and Venue Access on the same event",
        ],
        "practical": "Pick one shared concept -- table groups, tags, or ticket types -- and write down every module in this course where it reappears.",
        "quiz": [
            {"question": "Which two features share the same underlying table group concept?", "options": [
                "Seating and Section scanning", "Ticket sales and API keys", "Design Studio and Broadcast", "Planner and Tasks",
            ], "correct": 0},
            {"question": "Which pairing can never be turned on together for the same event?", "options": [
                "Venue Access and Section scanning", "Seating and Orders", "RSVP and Ticket sales", "Guest Chat and Event Updates",
            ], "correct": 0},
        ],
    },
    "capability-landscape": {
        "roles": _MANAGER_ROLES,
        "objective": "Locate any given Festio capability in its correct category -- core/free, paid Event Pass add-on, paid Ticket sales, or org-wide subscription -- without needing to look it up.",
        "why_it_matters": "This lesson is the reference map for the rest of the course -- once you can categorize a capability correctly, you know which settings area and billing model it falls under before you even open it.",
        "steps": [
            "Review the complete capability landscape image and sort what you see into four buckets: always-free core (RSVP, Guests, basic Check-in), Event Pass add-ons (Seating, Venue Access, Orders, Deliveries, Registry, Experience, Planner, FestioMe), Ticket sales, and org-wide subscription (read-write API access).",
            "For three add-ons of your choice, confirm in a training org where the on/off toggle lives (Sidebar, Features & messaging) and that it needs an Event Pass.",
            "Confirm Ticket sales lives in its own sidebar area, separate from Event Pass, with its own payout connection.",
            "Confirm the org-wide API subscription is managed from Org Settings, not from any single event.",
        ],
        "common_mistakes": [
            "Looking for Ticket sales settings inside the Event Pass area -- they're separate",
            "Assuming an add-on toggle in Sidebar, Features & messaging applies platform-wide instead of just that event",
            "Forgetting the org-wide API subscription is a fourth, separate paid track from Event Pass and Ticket sales",
        ],
        "practical": "Pick five capabilities from the landscape image and categorize each as core-free, Event Pass add-on, Ticket sales, or org subscription. Submit your list.",
        "quiz": [
            {"question": "Where do you turn a paid add-on like Seating or Venue Access on for one event?", "options": [
                "Sidebar, Features & messaging, on that event", "Org Settings, API", "Console, Pricing", "The public ticket page",
            ], "correct": 0},
            {"question": "Which paid capability is managed from Org Settings rather than per-event?", "options": [
                "Read-write API access (org subscription)", "Seating", "Venue Access", "Orders",
            ], "correct": 0},
        ],
    },
    "packages": {
        "roles": _MANAGER_ROLES,
        "objective": "Explain the free-to-paid upgrade path a typical organizer takes, and what unlocks at each step.",
        "why_it_matters": "Customers ask what they get if they upgrade constantly -- answering precisely, without over- or under-selling, is a core support and sales skill.",
        "steps": [
            "Review the packages & upgrade journey image and note the starting point: the free tier gives email invites, up to 25 guests, and Festio branding on invite pages.",
            "Identify what an Event Pass adds: SMS/WhatsApp invites, a higher guest cap, QR check-in, seating & orders, Venue Access, deliveries, gift list, and removed branding.",
            "Identify that Event Pass tiers are priced by guest cap, and an organizer can move to a higher tier if their list grows -- never needs to start over.",
            "Identify the two upgrade paths that are not Event Pass: Ticket sales and the org-wide API subscription.",
        ],
        "common_mistakes": [
            "Telling a customer they need to recreate their event to move to a bigger Event Pass tier -- they just upgrade the tier",
            "Conflating buying an Event Pass with turning on Ticket sales -- separate purchases, separate purposes",
            "Forgetting message credits are bought separately from the Event Pass itself",
        ],
        "practical": "Write the one-sentence pitch you'd give a customer currently on the free tier with 40 guests who wants QR check-in and seating.",
        "quiz": [
            {"question": "An organizer's guest list grows past their current Event Pass tier's cap. What do they do?", "options": [
                "Upgrade to a higher tier on the same event", "Delete the event and start over",
                "Nothing -- the free tier already covers it", "Switch to Ticket sales instead",
            ], "correct": 0},
            {"question": "What does the always-free tier include?", "options": [
                "Email invites, RSVP tracking, and up to 25 guests", "SMS and WhatsApp invites",
                "QR check-in", "Seating and Venue Access",
            ], "correct": 0},
        ],
    },
    "security": {
        "objective": "State the platform's core security practices you're responsible for reinforcing with customers: API key handling, payment webhook verification, and data privacy requests.",
        "why_it_matters": "Staff are often the first line a customer describes a security concern to -- knowing the correct, safe answer prevents both bad advice and unnecessary panic.",
        "steps": [
            "Review the security & trust guide image and note the three areas: API key handling, payment integrity, and guest data privacy.",
            "Confirm the rule for API keys: treat them like passwords, never in a public repo, screenshot, or support ticket -- revoke and recreate immediately if one leaks.",
            "For a 'my payment looks stuck' report, identify the correct first step: use 'Inspect webhook health' in Ticket sales before escalating, since payments are signature-verified.",
            "Locate where a guest's data privacy request is handled: their own order page (Download my data / Request data deletion), which the organizer approves or rejects.",
        ],
        "common_mistakes": [
            "Asking a customer to paste their API key or provider secret key into a support ticket to debug it",
            "Assuming a stuck payment is a Festio bug before checking webhook health",
            "Deleting guest data directly on request instead of routing it through the organizer's approval queue",
        ],
        "practical": "Write the exact reply you'd send a customer who pastes their live API key into a support message, asking for help.",
        "quiz": [
            {"question": "A customer pastes their live API key into a support message. What should you do first?", "options": [
                "Tell them to revoke and recreate it immediately, and never paste keys into tickets going forward",
                "Use it to test their integration for them", "Ignore it, it's not your responsibility", "Forward it to engineering unchanged",
            ], "correct": 0},
            {"question": "A guest wants their data deleted. Where does that request go?", "options": [
                "Through their order page, which the organizer approves or rejects", "Directly to a platform superadmin",
                "It happens automatically with no approval step", "Only through a support ticket to Festio",
            ], "correct": 0},
        ],
    },
    "app-explainer": {
        "objective": "Correctly explain that Festio runs in the browser with nothing to install, for organizers, staff, and guests alike, and what that means for device requirements.",
        "why_it_matters": "'Do I need to download an app' is one of the most common questions from every audience, and the answer -- no -- has real implications for device setup on event day.",
        "steps": [
            "Review the app explainer guide image and confirm: organizer admin, staff Check-in, and guest FestioHub all run in a standard mobile or desktop browser.",
            "Note the one exception: camera scanning needs the browser to have camera permission granted, and reliably needs HTTPS to work on a phone.",
            "Identify where a denied camera permission is fixed: browser Settings, Site permissions, Camera.",
            "Confirm a guest's QR pass works identically whether shown on a phone screen or printed on paper.",
        ],
        "common_mistakes": [
            "Telling a guest or staff member to download the Festio app from an app store -- there isn't one",
            "Not checking HTTPS when phone camera scanning is unreliable on a misconfigured domain",
            "Forgetting a printed QR code works identically to one shown on-screen",
        ],
        "practical": "Write down the exact troubleshooting steps you'd give a staff member whose phone camera won't start in Check-in.",
        "quiz": [
            {"question": "What should you tell a guest asking where to download the Festio app?", "options": [
                "There is no app to install -- everything runs in their browser", "Search the App Store for Festio",
                "It's only available on Android", "They need to ask the organizer for an installer link",
            ], "correct": 0},
            {"question": "A staff member's phone camera won't start when scanning. What's the most likely first thing to check?", "options": [
                "That the browser has camera permission granted and the page is loaded over HTTPS",
                "That they installed the Festio app", "That the event is on the free tier", "That Venue Access is turned off",
            ], "correct": 0},
        ],
    },

    # ---- 4. Capability setup guides ---------------------------------------
    "event-setup": {
        "roles": _MANAGER_ROLES,
        "objective": "Create a new Festio event with the correct details (timezone, currency, type) and turn on only the add-ons this event actually needs.",
        "why_it_matters": "Every downstream feature -- invite times, ticket display, check-in -- depends on the timezone and add-ons chosen here; fixing a wrong timezone after guests are invited is disruptive.",
        "steps": [
            "In Event Setup, click New Event and enter the name, event type, date/time, timezone, venue, and currency.",
            "Confirm the timezone matches the venue, not your own device -- Festio displays invite, ticket, and check-in times in the event's timezone.",
            "Save, then open the event and review the guided setup checklist -- each step can be skipped and finished later, it's a fast path, not a requirement.",
            "Under Sidebar, Features & messaging, turn on only the add-ons this event needs -- most require an Event Pass and appear in the sidebar immediately once turned on.",
        ],
        "common_mistakes": [
            "Leaving the timezone on the device's default instead of the venue's actual timezone",
            "Turning on every add-on just in case instead of only what the event needs",
            "Forgetting the event stays on Draft until deliberately set to Active",
        ],
        "practical": "Create a training event with a venue in a different timezone from your own, and confirm the RSVP page shows the venue's local time, not yours.",
        "quiz": [
            {"question": "Which timezone should an event use?", "options": [
                "The venue's local timezone, not the organizer's device timezone", "Always UTC",
                "The organizer's device timezone", "It doesn't matter",
            ], "correct": 0},
            {"question": "What determines whether an add-on shows in the sidebar?", "options": [
                "It's been turned on in Sidebar, Features & messaging for that event", "It's automatically on for every event",
                "It only appears after the event is Active", "It requires a support ticket to enable",
            ], "correct": 0},
        ],
    },
    "planner": {
        "roles": _MANAGER_ROLES,
        "objective": "Use Planner's budget, vendor, procurement, timeline, and runsheet tools for one event, and know when to use Tasks instead.",
        "why_it_matters": "Planner and Tasks look similar but serve different jobs -- using the wrong one means assignments, comments, or notifications silently don't reach the right person.",
        "steps": [
            "Sidebar, Features & messaging, turn on Planner, then open it from the sidebar.",
            "Budget tab: set a total budget and currency, add categories with allocated amounts, then add line items and log vendor quotes -- Festio ranks vendors cheapest first automatically.",
            "Vendors tab: add a vendor with contact details and track payments against them from that vendor's own detail view.",
            "Runsheet tab: build the minute-by-minute, timezone-aware day-of schedule -- conflicting times are flagged inline automatically.",
        ],
        "common_mistakes": [
            "Assigning a Planner milestone task expecting it to notify someone the way a Tasks card would -- Planner's own tasks don't sync with My Tasks, notifications, comments, or attachments",
            "Putting sensitive vendor payment data in Planner assuming only owners can see it -- any teammate with Planner access can view and edit it",
            "Confusing the Runsheet (day-of schedule) with the Timeline (pre-event milestone checklist) -- they're different tabs",
        ],
        "practical": "In a training event, add one budget category with two line items and one vendor quote, and note which vendor Festio ranks as cheapest.",
        "quiz": [
            {"question": "Do Planner's own milestone tasks sync with My Tasks, notifications, or comments?", "options": [
                "No -- they're a separate, local system", "Yes, fully", "Only notifications sync", "Only if the task has an assignee",
            ], "correct": 0},
            {"question": "Who can view and edit budget and vendor payment data in Planner?", "options": [
                "Any team member with access to Planner -- there's no separate financial permission yet",
                "Only the Owner", "Only Admins", "Only the person who created the event",
            ], "correct": 0},
        ],
    },
    "ticketing": {
        "roles": _MANAGER_ROLES,
        "objective": "Set up paid Ticket sales for an event: enable it, connect a payout account, create ticket types, and read the live sales report.",
        "why_it_matters": "Ticket sales is a different revenue model from Event Pass -- money moves through a real payment processor, so getting payouts, fees, and ticket types right the first time avoids refund and payout disputes.",
        "steps": [
            "Ticket sales, flip 'Sell tickets for this event' on; turning it off removes checkout from the guest page immediately.",
            "Connect a Stripe or Paystack payout account for the organizer -- reused automatically on future events once connected.",
            "Add ticket types (General Admission, VIP, Early Bird, tables) with price, currency, capacity, and min/max per order; optionally link a type to a Venue Access ticket type so purchase also grants zone access.",
            "Open the live sales report and confirm it shows gross collected, tickets sold, refunds, commission, and processor fees, refreshing every 15 seconds.",
        ],
        "common_mistakes": [
            "Never connecting a payout account, so buyers can pay but the organizer has nowhere for funds to land",
            "Approving a refund without first checking the order ledger and webhook health if a payment looks stuck",
            "Forgetting a promo code needs an explicit use limit if it shouldn't be reused indefinitely",
        ],
        "practical": "In a training event, create one free (zero-cost) ticket type and complete a test checkout end to end, then find it in the sales report.",
        "quiz": [
            {"question": "What connects a Festio event to real money for Ticket sales?", "options": [
                "A Stripe or Paystack payout account for the organizer", "The Event Pass", "Message credits", "The org API subscription",
            ], "correct": 0},
            {"question": "What should you check first if a payment looks stuck?", "options": [
                "Inspect webhook health, since payments are signature-verified", "Immediately issue a refund",
                "Ask the buyer to pay again", "Delete the order",
            ], "correct": 0},
        ],
    },
    "festiopass": {
        "roles": _MANAGER_ROLES,
        "objective": "Explain what a Festio Pass is, how a guest receives it, and how to customize its wording and preview it before an event goes live.",
        "why_it_matters": "The Festio Pass is the single artifact that gets a guest through the door -- knowing exactly how and when it's delivered lets you resolve 'I never got my ticket' reports quickly.",
        "steps": [
            "Confirm a guest's Festio Pass -- their personal QR code -- is sent automatically by email the moment they RSVP as Attending, or by SMS/WhatsApp if they have no email on file.",
            "Design Studio, Festio Pass tab: edit the wording on the pass and preview it with sample guest data, your colors, and your event photo.",
            "Design Studio, Email Preview tab: check how the Festio Pass email itself renders with your saved wording, colors, and photo.",
            "Confirm both a printed pass and a pass shown on-screen scan identically at check-in.",
        ],
        "common_mistakes": [
            "Assuming a guest has to separately download their pass -- it's emailed or texted automatically on RSVP confirmation",
            "Editing pass wording in the wrong place -- Invites & RSVP instead of Design Studio, Festio Pass -- and not seeing the change reflected",
            "Not checking the Email Preview tab, so a wording change looks different than expected once it's actually emailed",
        ],
        "practical": "Change the Festio Pass wording for a training event in Design Studio, then RSVP as a test guest and confirm the new wording appears on the pass they receive.",
        "quiz": [
            {"question": "When does a guest's Festio Pass get sent?", "options": [
                "Automatically, the moment they RSVP as Attending", "Only when staff generate it manually",
                "Only after check-in", "Only if they request it",
            ], "correct": 0},
            {"question": "Where do you edit the wording that appears on the Festio Pass itself?", "options": [
                "Design Studio, Festio Pass tab", "Invites & RSVP", "Team tab", "Results",
            ], "correct": 0},
        ],
    },
    "guest-management": {
        "roles": _MANAGER_ROLES,
        "objective": "Add guests to an event by import, live sync, or one at a time, and use the Guests tab to track RSVP status and details.",
        "why_it_matters": "Guest data is the foundation every other module reads from -- seating, tags, ticket types, and check-in all depend on it being accurate and imported correctly.",
        "steps": [
            "Start here, Download template, fill it in, and Upload guest file -- column names match flexibly regardless of case or spacing.",
            "For live sync, paste a Google Sheets or OneDrive share link and either import once or set a sync interval while the event is Active; watch the sync badge (green, amber, red).",
            "Confirm re-importing never creates duplicates -- it only fills in missing phone numbers, ticket types, addresses, or tags for guests who already exist.",
            "Guests tab, click any guest to review their RSVP status, contact info, ticket type, tags, seat assignment, order choices, and check-in history.",
        ],
        "common_mistakes": [
            "Importing phone numbers without a country code, which silently breaks SMS/WhatsApp delivery",
            "Deleting and re-uploading a guest list to fix it instead of just re-importing the corrected file",
            "Not checking the sync badge color, missing that amber means some rows imported with warnings",
        ],
        "practical": "Import a small test guest list with one row missing a country code, and note what warning appears.",
        "quiz": [
            {"question": "What happens when you re-import a guest list that already has some guests loaded?", "options": [
                "Existing guests are matched and only missing fields are filled in -- no duplicates", "All guests are duplicated",
                "The whole list is replaced", "Only new guests are kept, old ones deleted",
            ], "correct": 0},
            {"question": "What does an amber sync badge mean?", "options": [
                "Imported with warnings -- e.g. unknown ticket types or invalid phone numbers", "Sync failed completely",
                "Everything imported perfectly", "The sheet link is private",
            ], "correct": 0},
        ],
    },
    "guest-communication": {
        "roles": _MANAGER_ROLES,
        "objective": "Distinguish Event Updates, Guest Chat, Message Host, and FestioMe groups, and enable only the ones an event needs.",
        "why_it_matters": "These four channels have different audiences and privacy expectations -- mixing them up can leak a private guest message into a public group, which is a real trust problem, not just a UX slip.",
        "steps": [
            "Open Guest Communication for the event and review Event Updates, Guest Chat, Guest posting, and Message Host one at a time.",
            "Use Event Updates for host-to-guest announcements, choosing the intended audience -- attending, declined, checked-in, not checked-in -- before publishing.",
            "Use Guest Chat for a shared conversation, and turn Guest posting off if guests should read but not post.",
            "Use Message Host for private guest questions -- replies belong to that guest's private thread and must never be copied into Guest Chat or a FestioMe group.",
        ],
        "common_mistakes": [
            "Copying a private Message Host reply into a public announcement or Guest Chat while troubleshooting",
            "Turning off a communication module and assuming it also disables RSVP, QR tickets, or Check-in -- it must not, and should be tested",
            "Not choosing an audience before publishing an Event Update, sending it to guests it wasn't meant for",
        ],
        "practical": "Open one eligible and one ineligible test guest link in separate sessions after changing a communication toggle, and confirm only the intended module changed.",
        "quiz": [
            {"question": "Where do private guest questions belong?", "options": [
                "Message Host -- a private thread, never copied into Guest Chat or a group", "Guest Chat",
                "A FestioMe group", "Event Updates",
            ], "correct": 0},
            {"question": "Turning off a Guest Communication module should never also disable which of these?", "options": [
                "RSVP, QR tickets, or Check-in", "Guest Chat", "Event Updates", "FestioMe groups",
            ], "correct": 0},
        ],
    },
    "festiohub": {
        "objective": "Explain what FestioHub is, what's on it automatically, and how the separate FestioMe community layer connects to it.",
        "why_it_matters": "Guests and organizers often confuse the always-on personal FestioHub with the optional FestioMe community -- knowing the difference prevents promising a feature that isn't turned on.",
        "steps": [
            "Confirm every guest's pass includes a personal FestioHub link automatically -- their QR code, seating details, order choices, event updates, and a message thread to the team -- nothing to configure.",
            "FestioMe (top navigation) is the optional event community -- announcements, photos, and groups -- separate from the always-on personal hub.",
            "Create a group in FestioMe and set its privacy: open to all guests, join-on-request, or private (selected members only).",
            "Confirm guests reach the community from a link on their FestioHub, and that push notifications work for guests who allow them, even with the page closed.",
        ],
        "common_mistakes": [
            "Telling a guest to set up their FestioHub -- it's automatic, there's nothing to configure",
            "Assuming FestioMe groups exist by default -- the organizer has to create the community first",
            "Posting logistics as an SMS broadcast, spending credits, instead of a free FestioMe announcement",
        ],
        "practical": "Create one FestioMe group with join-on-request privacy in a training event, and confirm where a guest sees the request-to-join option from their hub.",
        "quiz": [
            {"question": "Does a guest need to do anything to get their personal FestioHub?", "options": [
                "No -- it's included automatically with their pass", "They must request access",
                "It only exists for Experience events", "They must download an app",
            ], "correct": 0},
            {"question": "What's the difference between FestioHub and FestioMe?", "options": [
                "FestioHub is each guest's automatic personal hub; FestioMe is the optional community the organizer creates",
                "They are the same feature", "FestioMe is automatic, FestioHub must be created", "FestioHub is only for staff",
            ], "correct": 0},
        ],
    },
    "public-pages": {
        "roles": _MANAGER_ROLES,
        "objective": "Identify Festio's public-facing pages -- event page, vendor packing list, gift registry, calendar -- and where each is configured.",
        "why_it_matters": "Public pages are what guests, vendors, and outside contacts see with no login -- getting the right page linked to the right audience matters for a professional impression.",
        "steps": [
            "Design Studio, Event Page tab: choose which sections show on the public guest-facing event page, previewing unsaved edits live.",
            "Confirm the Deliveries packing list and Gift list registry pages are separate public, read-only links -- no Festio account needed to view them.",
            "Org Settings, Calendars: create a public or private calendar that lists several events together, with a shareable public link or embed snippet.",
            "For a private calendar, confirm it requires a Contact List and gives each contact a personalized access token automatically.",
        ],
        "common_mistakes": [
            "Confusing the public Event Page (Design Studio) with a Calendar (Org Settings) -- a calendar lists multiple events, the event page is one event",
            "Sharing a private calendar's generic link instead of each contact's personalized token link",
            "Forgetting 'Hide past events' is on by default on a calendar, which can make curated events silently disappear once their date passes",
        ],
        "practical": "Create a public calendar with two training events on it, and confirm the public link and embed snippet both work.",
        "quiz": [
            {"question": "What's the difference between an Event Page and a Calendar?", "options": [
                "An Event Page is one event's public page; a Calendar lists several events together", "They're the same thing",
                "A Calendar is per-event, an Event Page is org-wide", "Only Calendars can be public",
            ], "correct": 0},
            {"question": "Why might a curated event silently disappear from a calendar's public view?", "options": [
                "'Hide past events' is on by default and filters out anything with a past date", "The event was deleted",
                "Calendars can only show one event", "The organizer's Event Pass expired",
            ], "correct": 0},
        ],
    },
    "design-studio": {
        "roles": _MANAGER_ROLES,
        "objective": "Navigate every tab in Design Studio and know which guest-facing surface each one controls.",
        "why_it_matters": "Design Studio is where branding gets set once and reused everywhere -- knowing the tab boundaries prevents time wasted looking for a setting in the wrong place.",
        "steps": [
            "Templates tab: apply a ready-made design across the whole event in one click.",
            "GuestHub tab vs FestioHub tab: GuestHub themes the RSVP page and hub together as one look; FestioHub tab separately picks the layout and style for the guest's personal hub after RSVP -- these are two different settings.",
            "Festio Pass tab and Flyer tab: edit the QR ticket wording with a live preview, and separately generate a shareable flyer image in multiple sizes.",
            "Publish tab: run the checklist confirming essentials -- title, date, venue, cover photo -- are set before guests start seeing live pages.",
        ],
        "common_mistakes": [
            "Editing the GuestHub template and expecting the FestioHub layout to also change -- they're separate settings",
            "Publishing before checking the Publish tab checklist, missing an essential field like the cover photo",
            "Not using Email Preview after a wording change, missing how it actually renders in the invitation or reminder email",
        ],
        "practical": "In a training event, change the GuestHub template and separately change the FestioHub layout, and note that they affect different screens.",
        "quiz": [
            {"question": "What's the difference between the GuestHub tab and the FestioHub tab in Design Studio?", "options": [
                "GuestHub themes the RSVP page and hub together; FestioHub separately styles the guest's personal hub after RSVP",
                "They control the same setting", "FestioHub is for staff, GuestHub is for guests", "GuestHub only applies to paid events",
            ], "correct": 0},
            {"question": "What does the Publish tab check before guests see live pages?", "options": [
                "That essentials like title, date, venue, and cover photo are set", "That all guests have RSVP'd",
                "That the event is on Ticket sales", "That message credits are purchased",
            ], "correct": 0},
        ],
    },
    "seating-floor-plan": {
        "roles": _MANAGER_ROLES,
        "objective": "Create tables, group them, and use the Floor Plan editor and auto-assignment to seat guests without double-booking anyone.",
        "why_it_matters": "A double-booked seat or an over-filled table is one of the most visible on-the-day failures -- Festio blocks it structurally, but only if tables and groups are set up correctly beforehand.",
        "steps": [
            "Seating tab, Create tables: name, capacity, display order, and an optional Category label used by invitation-category bucket mapping.",
            "Floor layout: drag-and-drop tables onto a venue canvas, add decor, optionally trace over an uploaded venue photo, and generate a view-only or edit share link for an outside collaborator.",
            "Use Auto-assign to seat guests by RSVP order, or drag individual guests to specific seats manually; click an empty seat to reserve it for a specific guest such as a head table or VVIP.",
            "Create table groups -- e.g. 'Family side', 'Friends side' -- so a guest assigned to a group can only be seated within that group's tables, enforced by auto-assign, manual seating, and check-in alike.",
        ],
        "common_mistakes": [
            "Setting a table's capacity too low and being surprised when auto-assign overflows to the next table",
            "Forgetting a table's Category label is what links it into the invitation-category bucket system -- leaving it blank breaks that mapping",
            "Assuming a guest whose table or group is full at check-in gets seated anyway -- they show as Denied so staff can re-seat them instead of double-booking",
        ],
        "practical": "Create two tables in the same table group, fill one to capacity with test guests, and confirm the next guest overflows correctly rather than double-booking a seat.",
        "quiz": [
            {"question": "What happens at check-in if a guest's table or group is already full?", "options": [
                "They show as Denied so staff can re-seat them, rather than being double-booked", "They're seated anyway, over capacity",
                "The scan is silently ignored", "The event pauses check-in for everyone",
            ], "correct": 0},
            {"question": "What does a table's Category label control?", "options": [
                "Which invitation-category bucket that table belongs to", "The table's color on the floor plan",
                "Whether it appears in Kitchen", "Its capacity limit",
            ], "correct": 0},
        ],
    },
    "gifts": {
        "roles": _MANAGER_ROLES,
        "objective": "Set up a Deliveries shipment for merch, aso-ebi, or gifts, and generate the vendor packing list.",
        "why_it_matters": "Fulfillment vendors need a clean, no-login packing list -- getting shipment items and guest addresses right the first time avoids a vendor chasing missing information mid-fulfillment.",
        "steps": [
            "Sidebar, Features & messaging, turn on Logistics -- it shows as 'Deliveries' in the sidebar.",
            "Deliveries tab, New Shipment, name it, and add items with name, optional size/variant, and quantity.",
            "Confirm guest addresses come from RSVP address collection, if turned on, or from ship_address columns in an import.",
            "Share the packing list -- a read-only page a fulfilment vendor can open without a Festio login -- and mark items packed/shipped per guest or in bulk.",
        ],
        "common_mistakes": [
            "Turning on Logistics without also turning on address collection in RSVP settings, leaving shipments with no delivery address",
            "Creating one shipment for two unrelated waves, such as pre-event aso-ebi and post-event gifts, instead of separate shipments",
            "Sending a vendor an internal admin screenshot instead of the shareable packing list link",
        ],
        "practical": "Create a training shipment with two items, mark one guest's items as shipped, and open the packing list link as the vendor would see it.",
        "quiz": [
            {"question": "How does the vendor see the packing list?", "options": [
                "A shareable, read-only link -- no Festio login needed", "They must be added as a team member",
                "Only via a CSV export you email them", "They can't see it, only the organizer can",
            ], "correct": 0},
            {"question": "Where do guest shipping addresses usually come from?", "options": [
                "RSVP address collection, or ship_address columns in an import", "They must be typed in manually one by one",
                "Design Studio", "Venue Access tags",
            ], "correct": 0},
        ],
    },
    "registry": {
        "roles": _MANAGER_ROLES,
        "objective": "Set up a Gift list with items and cash funds, and explain that no money moves through Festio.",
        "why_it_matters": "Guests and organizers sometimes assume the registry processes payments -- being clear it's a coordination tool only, not a payment system, avoids a real misunderstanding about where money goes.",
        "steps": [
            "Sidebar, Features & messaging, turn on Registry -- it shows as 'Gift list' in the sidebar.",
            "Gift list tab, Add items: paste a store link to auto-fill title, image, and price, or add a cash fund such as 'Honeymoon fund'.",
            "Write a welcome message shown at the top of the public gift list page, and share the public link directly.",
            "Confirm guests mark what they'll bring or contribute so nobody duplicates, and that you can see claims from the Gift list tab.",
        ],
        "common_mistakes": [
            "Telling a guest their card payment for a cash fund goes through Festio -- it doesn't, they pay the host directly",
            "Not sharing the actual public gift list link, so guests never find it",
            "Forgetting a guest can unclaim an item if their plans change -- treating claims as permanent",
        ],
        "practical": "Add one store-link item and one cash fund to a training event's gift list, and claim the item as a test guest.",
        "quiz": [
            {"question": "Does money move through Festio when a guest contributes to a cash fund?", "options": [
                "No -- guests pay or give directly to the host, Festio only coordinates", "Yes, Festio processes the payment",
                "Only for events with Ticket sales on", "Only if the fund is over a certain amount",
            ], "correct": 0},
            {"question": "What happens if two guests try to claim the same gift item?", "options": [
                "Once claimed, other guests see it's taken so nobody duplicates", "Both can claim it",
                "The item is removed from the list", "The host is not notified either way",
            ], "correct": 0},
        ],
    },
    "checkin-scanner": {
        "objective": "Run day-of check-in correctly: activate the event, assign staff, scan guests, and read every scan result color correctly.",
        "why_it_matters": "Check-in is the single highest-stakes, most time-pressured screen in the whole product -- a misread result color at a busy door creates a line and a frustrated guest.",
        "steps": [
            "The day before: set the event to Active in Start here -- check-in will not process guests otherwise.",
            "Confirm all scanning staff are added to Team and assigned to this specific event.",
            "Staff open Check-in, choose their gate (or set area and direction manually), and tap Start camera -- no app install needed, camera access must be granted.",
            "Read results correctly: green means admitted, yellow means already admitted (a duplicate scan, not necessarily an error), red means denied -- wrong zone, at capacity, table/section full, or needs an Event Pass.",
        ],
        "common_mistakes": [
            "Leaving the event on Draft on the day, so every scan is refused with 'Event not active'",
            "Treating a yellow 'Already admitted' result as an error requiring override, instead of checking when and where it was first scanned",
            "Overriding a red denial manually instead of sending the guest to the organizer desk for resolution",
        ],
        "practical": "Set a training event to Active, add yourself as staff, and scan one test guest, confirming the green admitted screen and the corresponding Results update.",
        "quiz": [
            {"question": "What does a yellow 'Already admitted' scan result mean?", "options": [
                "The QR was already scanned before -- check when and where, it's often fine such as moving between zones",
                "The guest is denied entry", "The event is not active", "The scanner is offline",
            ], "correct": 0},
            {"question": "What must be true before Check-in will process any guest?", "options": [
                "The event must be set to Active", "The event must have Ticket sales on",
                "All guests must have RSVP'd by email", "The organizer must be logged in at the same time",
            ], "correct": 0},
        ],
    },
    "guest-experience": {
        "objective": "Build a post-admission Experience workflow with dependent steps -- consent, souvenir, room assignment, sessions -- and run a guest through it.",
        "why_it_matters": "Experience adds real operational complexity after check-in -- getting step dependencies wrong either blocks guests who should be able to proceed, or lets a step happen out of order, such as a souvenir handed out before consent is signed.",
        "steps": [
            "Sidebar, Features & messaging, turn on Experience, then create or clone a workflow -- keep it Draft while editing, only one workflow Published at a time.",
            "Add steps in the order staff should follow -- Main check-in, Consent, Badge pickup, Souvenir, Room assignment, Session attendance -- and set Step dependencies, e.g. Souvenir depends on Consent.",
            "For multi-room seating, create the room's table group in Seating first, then set a Room assignment step to 'Separate seat for this step' with a unique assignment scope -- this doesn't replace the guest's main event seat.",
            "Publish the workflow, then run one test guest through every step end to end before sending it live.",
        ],
        "common_mistakes": [
            "Publishing a workflow without running a test guest through every dependency first",
            "Assuming a scoped Experience room assignment replaces the guest's main seat -- it doesn't, they're independent",
            "Manually completing a session-attendance step before its check-in window opens, bypassing the time gate the organizer set",
        ],
        "practical": "Build a two-step workflow, Consent depends on Main check-in, in a training event, and run one test guest through both steps in order.",
        "quiz": [
            {"question": "Does a scoped Experience room assignment replace a guest's main event seat?", "options": [
                "No -- they're independent; a guest can have a main seat plus separate scoped seats", "Yes, it overwrites the main seat",
                "Only if Seating is turned off", "Only for session steps",
            ], "correct": 0},
            {"question": "What blocks a session-attendance step from being completed early?", "options": [
                "Its configured check-in window, which staff can't bypass by tapping Complete early", "Nothing, staff can always complete any step",
                "The event must be Ended first", "It requires a platform superadmin",
            ], "correct": 0},
        ],
    },
    "task-management": {
        "objective": "Use the per-event Tasks board and My Tasks to run team coordination work, distinct from guest data.",
        "why_it_matters": "Tasks is where non-guest-data coordination lives -- knowing it, and My Tasks, exists keeps that work out of ad-hoc channels like text messages that no one else on the team can see.",
        "steps": [
            "Open the event's Tasks tab, add a task with a title, optional notes, assignee, and due date.",
            "Drag a card between Open, In progress, and Done, or change status from its detail panel.",
            "Open a task's detail panel to use its comment thread, subtasks, and file attachments -- available to whoever created it or is assigned to it.",
            "Use My Tasks (top nav) to see every task assigned to you across all events, grouped automatically into Overdue, Due soon, No due date, and Done.",
        ],
        "common_mistakes": [
            "Coordinating event-day logistics over text or WhatsApp instead of a Task, losing the activity history",
            "Not checking My Tasks as staff working multiple events, missing something assigned to you on an event you don't have open",
            "Forgetting every status change, reassignment, and attachment is logged in the task's own activity feed",
        ],
        "practical": "Create a task with one subtask and one attachment in a training event, then find it from My Tasks and change its status from there.",
        "quiz": [
            {"question": "What does My Tasks show that a single event's Tasks board doesn't?", "options": [
                "Every task assigned to you across all events, in one place", "Only tasks you created yourself",
                "Only tasks with no due date", "Nothing different -- they're identical views",
            ], "correct": 0},
            {"question": "Who can see and comment on a task's detail panel?", "options": [
                "Whoever created it or is assigned to it", "Only the event Owner",
                "Only platform superadmins", "Anyone with a Festio account, even outside the org",
            ], "correct": 0},
        ],
    },
    "team-management": {
        "roles": _MANAGER_ROLES,
        "objective": "Add teammates with the correct role and per-staffer permissions, and verify access changes actually take effect.",
        "why_it_matters": "Getting a teammate's role or permissions wrong is a routine support issue -- verifying the change, not just saving it, is what actually catches it before the event instead of during it.",
        "steps": [
            "Team tab, 'Add a teammate', enter their exact sign-in email and choose a role -- Owner/Admin can manage the event, Staff can only check guests in on assigned events.",
            "For assigned Staff, toggle per-staffer permissions -- Seats, Orders, Dashboard -- individually; all off by default.",
            "Assign the teammate to the specific events they need -- being added to the org alone isn't enough, they only see events they're assigned to.",
            "Sign in as the staff member in a separate session and verify their identity, assigned event, and permitted navigation match what was configured.",
        ],
        "common_mistakes": [
            "Adding a teammate to the org but forgetting to assign them to the specific event -- they'll see nothing",
            "Assuming a permission change takes effect without the staff member refreshing and retrying an action",
            "Using an email address that doesn't exactly match the one the teammate signs in with",
        ],
        "practical": "Add a test staff account, assign it to one training event with the Orders permission only, sign in as that account, and confirm exactly what it can reach.",
        "quiz": [
            {"question": "Is adding someone to the organization enough for them to see an event in Check-in?", "options": [
                "No -- they must also be assigned to that specific event", "Yes, org membership alone is enough",
                "Only if they're an Admin", "Only if Venue Access is on",
            ], "correct": 0},
            {"question": "What's the correct way to confirm a permission change actually worked?", "options": [
                "Sign in as that staff member and verify what they can access", "Trust that saving the change is enough",
                "Ask the staff member to describe what they think they can see", "Check the audit log only",
            ], "correct": 0},
        ],
    },
    "live-command-center": {
        "roles": _MANAGER_ROLES,
        "objective": "Use the Results page as a live, auto-refreshing command center during an active event to monitor arrivals, occupancy, and orders in real time.",
        "why_it_matters": "During the event itself, Results is the one screen that tells the organizer desk what's actually happening right now -- knowing it needs no manual refresh, and what each live widget means, is what makes it usable under pressure.",
        "steps": [
            "Open Results during an active event and note it auto-refreshes every few seconds without a manual reload.",
            "Read the top row -- total RSVP'd, total checked in, currently in venue -- and the check-in timeline showing arrivals per hour, to spot your peak entry window live.",
            "For Venue Access events, watch zone occupancy bars -- they turn red near capacity, giving an early warning before a zone is actually full.",
            "For Orders events, cross-reference the Orders summary and per-table report against what Kitchen is showing, to catch any mismatch early.",
        ],
        "common_mistakes": [
            "Manually refreshing the page repeatedly, assuming it's needed -- it auto-updates on its own",
            "Not putting Results on a dedicated screen at the organizer desk, missing a zone approaching capacity until it's already full",
            "Reading zone occupancy once at the start and not watching it live as the event progresses",
        ],
        "practical": "During a simulated check-in run in a training event, keep Results open on a second screen and note how quickly a scan appears there.",
        "quiz": [
            {"question": "Does the organizer need to manually refresh Results during an active event?", "options": [
                "No -- it auto-refreshes on its own every few seconds", "Yes, every time",
                "Only after each check-in", "Only if using Venue Access",
            ], "correct": 0},
            {"question": "What turns a zone's occupancy bar red on Results?", "options": [
                "The zone approaching its capacity limit", "The event being set to Ended",
                "A guest being denied at any gate", "Kitchen marking an item served",
            ], "correct": 0},
        ],
    },
    "kitchen-logistics": {
        "objective": "Set up Orders items and use the Kitchen view's three tabs to run event-day meal or item fulfillment.",
        "why_it_matters": "Kitchen is the fulfillment team's only screen on the day -- if it's not opened on the right device, or a mark-served happens before check-in, the caterer's counts go wrong.",
        "steps": [
            "Orders tab, add categories -- Meals, Drinks, Gifts, Merchandise -- and items with optional descriptions; guests pick before the RSVP deadline you set.",
            "Open Kitchen in the sidebar on a tablet for staff or the caterer -- it auto-refreshes and has three views: Order queue, Prep tally, and By table.",
            "In Order queue, note 'Mark served' per category is disabled until that guest is checked in -- this prevents serving someone who hasn't arrived.",
            "Use Prep tally for the kitchen's total outstanding count per item, and By table for pending/served/total counts per table.",
        ],
        "common_mistakes": [
            "Trying to mark an item served for a guest who hasn't checked in yet -- it's disabled by design, not a bug",
            "Using the RSVP deadline loosely, letting guests change item choices too close to the event and throwing off prep counts",
            "Opening Kitchen on a phone instead of a tablet for a busy service, making the three-view layout hard to work from",
        ],
        "practical": "Add two order categories with items to a training event, RSVP a test guest with a choice, check them in, then mark their item served in Kitchen.",
        "quiz": [
            {"question": "Why is 'Mark served' disabled for a guest in Kitchen's Order queue?", "options": [
                "Because that guest hasn't been checked in yet", "Because the item is out of stock",
                "Because the event is on Draft", "Because Orders wasn't turned on",
            ], "correct": 0},
            {"question": "What does Prep tally show?", "options": [
                "The kitchen's total outstanding count per item, for prep planning", "Per-guest order history",
                "Payment status for Ticket sales", "Zone occupancy",
            ], "correct": 0},
        ],
    },
    "reporting-results": {
        "roles": _MANAGER_ROLES,
        "objective": "Pull the post-event data an organizer needs -- guest status, seating, orders, deliveries -- and archive the event correctly.",
        "why_it_matters": "Once an event is archived, the organizer's active list gets cleaner, but the data must still be reachable -- knowing what's on-screen versus exportable prevents 'we lost our post-event data' tickets.",
        "steps": [
            "Guests tab: review final RSVP status, check-in time, seat, order choices, and custom question answers for every guest.",
            "Seating and Orders tabs: use the seating chart, table assignment list, and per-table item totals as the working record for caterer or fulfilment reconciliation.",
            "Results: check-in timeline and zone/area analytics are on-screen -- use a browser print or screenshot to capture them, since they're not currently a one-click export.",
            "After the event, set its status to Ended, then archive it -- archived events remain accessible for reporting but drop out of the active event list.",
        ],
        "common_mistakes": [
            "Archiving an event before capturing the Results analytics an organizer will want later, since there's no one-click export for those charts",
            "Assuming an archived event's data is deleted -- it's still accessible, just out of the active list",
            "Reporting only Guests-tab numbers when a customer also wants seating or order fulfillment totals",
        ],
        "practical": "Walk a training event from Ended to Archived, and confirm you can still open its Guests tab data afterward.",
        "quiz": [
            {"question": "What happens to an event's data when it's archived?", "options": [
                "It stays accessible for reporting, it just leaves the active event list", "It's permanently deleted",
                "Only the Guests tab remains accessible", "It becomes read-only for 30 days then deletes",
            ], "correct": 0},
            {"question": "How do you currently capture Results' check-in timeline and analytics for a report?", "options": [
                "Screenshot or browser print -- there's no one-click chart export yet", "A dedicated 'Export analytics' button",
                "It's emailed automatically after the event ends", "Through the public API only",
            ], "correct": 0},
        ],
    },
    "platform-api": {
        "roles": _MANAGER_ROLES,
        "objective": "Explain the difference between a read-only and read-write API key, where to find documentation, and how to debug a failing integration.",
        "why_it_matters": "API access is org-wide and can modify real guest and event data -- knowing the read/write boundary and where to look when something fails prevents both accidental data changes and unnecessary escalations.",
        "steps": [
            "Org Settings, API, 'Create key': every account can create a read-only key for free.",
            "Confirm read-write access -- create/update/delete via the API -- requires an active org subscription, managed from the Plan section of the same page.",
            "Browse the interactive API Explorer in the sidebar, or the full Swagger UI at /api/public/v1/swagger, to see every endpoint and try a live call.",
            "Use each key's recent request history, visible from the API section, to debug a failing integration before escalating.",
        ],
        "common_mistakes": [
            "Issuing a read-write key for an integration that only ever needs to display data",
            "Treating an API key casually -- like a password, it should never be committed to a public repo or pasted into a support ticket",
            "Not checking a key's request history first, escalating a debugging question the history would have answered",
        ],
        "practical": "Create a read-only API key in a training org, make one call against a documented endpoint in API Explorer, and find that call in the key's request history.",
        "quiz": [
            {"question": "What does read-write API access require that a read-only key doesn't?", "options": [
                "An active org subscription", "A platform superadmin account", "Ticket sales turned on", "A minimum guest count",
            ], "correct": 0},
            {"question": "What's the safe response if a customer pastes an API key into a support message?", "options": [
                "Have them revoke and recreate it immediately", "Use it to help debug, then delete it from the ticket",
                "Ignore it", "Forward it to another customer as an example",
            ], "correct": 0},
        ],
    },
}


def published_course(role=None):
    """Build the course, optionally scoped to one org role ('owner'/'admin'/'staff').

    Lessons tagged with a restricted `roles` set (see _MANAGER_ROLES) are about
    configuring the product rather than running it day-of, so a Staff-only
    learner's track skips them -- their lesson_count, order numbers, and
    estimated_minutes are all recomputed over just the lessons they'll see.
    """
    modules, order = [], 0
    for module_key, module_title, raw_lessons in _modules:
        lessons = []
        for key, title, image in raw_lessons:
            content = LESSON_CONTENT[key]
            if role and role not in content.get("roles", ALL_ROLES):
                continue
            order += 1
            is_setup = module_key == "setup"
            lessons.append({
                "key": key, "title": title, "order": order,
                "duration_minutes": content.get("duration_minutes", 8 if is_setup else 6),
                "image_url": f"/knowledge-transfer/assets/{image}",
                "objective": content["objective"],
                "why_it_matters": content["why_it_matters"],
                "prerequisites": content.get("prerequisites", _HANDS_ON_PREREQS if is_setup else _ORIENTATION_PREREQS),
                "steps": content["steps"],
                "common_mistakes": content["common_mistakes"],
                "practical": content["practical"],
                "quiz": content["quiz"],
            })
        if lessons:
            modules.append({"key": module_key, "title": module_title, "lessons": lessons})
    return {
        "key": COURSE_KEY, "version": COURSE_VERSION, "status": "published",
        "title": "Festio Platform & Operations Academy",
        "description": "Role-ready training for operating Festio safely from event setup through reporting.",
        "passing_score": 80, "requires_practical_approval": True, "modules": modules, "lesson_count": order,
        "estimated_minutes": sum(x["duration_minutes"] for m in modules for x in m["lessons"]),
    }


def lessons(role=None):
    return [lesson for module in published_course(role)["modules"] for lesson in module["lessons"]]
