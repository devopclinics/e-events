export const CONTENT = {
  organizer: {
    label: 'Organizer',
    icon: '🗂️',
    blurb: 'Create an event, invite guests, and run check-in on the day.',
    topics: [
      { id: 'org-start', icon: '🚀', title: 'Get started', steps: [
        'Open the site and choose Get Started → sign in with Google or email.',
        'You land in the Admin panel with your own organization, ready to go.',
      ]},
      { id: 'org-create', icon: '📅', title: 'Create your event', img: '/media/admin-overview.png', steps: [
        'Admin → New Event.',
        'Enter the event name, host/organizer (optional), date & time, and base URL.',
        'Save. Open the event to see its tabs: Overview, Guests, Team, Invite.',
      ]},
      { id: 'org-guests', icon: '👥', title: 'Add your guest list', img: '/media/admin-guests.png', steps: [
        'Overview tab → Download template — it contains exactly the columns your event uses (ticket type, shipping address, …) with an Excel dropdown for ticket types.',
        'Fill it in and Upload CSV/Excel. Your own list works too: column names match in any case or spacing (First Name = first_name), and email is optional.',
        'Or paste a Google Sheets / OneDrive share link — import once, or save it as a source to auto-sync every minute while the event is Active.',
        'Watch the sync status: red = sync failed; amber = imported with warnings (unknown ticket types, rows over your plan limit, bad phone numbers).',
        'Re-importing never duplicates guests — it fills in missing phone numbers, ticket types, addresses, and tags instead.',
        'Venue Access events: add a "tags" column (e.g. "VIP; Press") to classify guests on import — unknown tags are created automatically and drive zone access.',
        'Or add people one at a time in the Guests tab.',
        'Free events allow up to 25 guests (imports included) — an Event Pass raises the limit.',
      ]},
      { id: 'org-rsvp', icon: '✉️', title: 'Set up RSVP & invite page', img: '/media/admin-invite.png', steps: [
        'Invite tab → "Invite Page & RSVP".',
        'Pick Open (one shared link) or Closed (a unique private link per guest).',
        'Optional: RSVP deadline, require approval, custom questions, cover image, message.',
        'Use "Preview invite page" to see exactly what guests will get.',
      ]},
      { id: 'org-send', icon: '📤', title: 'Send invitations', img: '/media/send-invites.png', steps: [
        'Open mode: share the event link, or use Manual invite for specific people.',
        'Closed mode: use Bulk RSVP invites — Send to not-yet-invited, Remind no-reply, or Resend to all.',
        'Email is always free; SMS/WhatsApp require an Event Pass + message credits.',
      ]},
      { id: 'org-track', icon: '✅', title: 'Track RSVPs & approvals', img: '/media/admin-guests.png', steps: [
        'Guests tab shows each person: Attending / Declined / Pending / No reply, plus check-in status.',
        'If approval is on, approve or reject pending RSVPs (or Approve all).',
      ]},
      { id: 'org-broadcast', icon: '📣', title: 'Broadcast an update', img: '/media/broadcast.png', steps: [
        'Invite tab → Broadcast Message.',
        'Pick a target: All, RSVP Attending/Declined/No-reply, Checked-in, or Not checked-in.',
        'Send via email / SMS / WhatsApp.',
      ]},
      { id: 'org-seating', icon: '🍽️', title: 'Seating & menu (paid)', steps: [
        'Overview → Features → turn on Seating / Menu (requires an Event Pass).',
        'Seating tab: create tables, auto-assign or place guests, reserve seats.',
        'Menu tab: add categories/items; guests pick meals; track catering.',
      ]},
      { id: 'org-access', icon: '🎫', title: 'Venue Access: zones & ticket types (paid)', imgs: ['/media/admin-access.png', '/media/admin-access-analytics.png'], steps: [
        'Overview → Features → turn on Access (requires an Event Pass).',
        'Access tab → Zones: create areas (Main Hall, VIP Lounge, …) with optional capacity and direction mode (entry / exit / both).',
        'Ticket types: create GA / VIP / Press and pick which zones each may enter — leave empty for all zones.',
        'Assign: set a guest\'s ticket type one by one, or add a ticket_type column to your imported list / synced sheet.',
        'Guests without a ticket type can enter every zone; capacity limits still apply.',
        'Analytics: live occupancy per zone, peak arrival times, room-to-room flow, and each guest\'s journey through the venue.',
      ]},
      { id: 'org-access-rules', icon: '🏷️', title: 'Access Rules: tags & gates (paid)', steps: [
        'Access Rules tab → Tags: create your own classifiers (VIP, Press, 21+, Speaker…). Optionally auto-fill a tag from an RSVP answer, then click "Sync from RSVP".',
        'Assign: search a guest and toggle their tags — or import a "tags" column on your guest list.',
        'Zone rules: pick which tags may enter each zone. A zone with no tags selected admits everyone; otherwise a guest needs at least one matching tag.',
        'Gates: pin a scanner to a zone (location) + direction (Entry/Exit). Staff pick the gate once and just scan — the zone is auto-detected and the guest\'s tags are checked automatically.',
        'Tags are the flexible, multi-value system (a guest can be VIP + Press); ticket types remain the simpler single-tier option.',
      ]},
      { id: 'org-logistics', icon: '📦', title: 'Logistics: ship merch & gifts (paid)', img: '/media/admin-logistics.png', steps: [
        'Overview → Features → turn on Logistics.',
        'Logistics tab: create shipments — merch before the event or gifts after — and add their items.',
        'Guest addresses come from RSVP (guests fill them in) or from the ship_address columns in your imported list.',
        'Share the packing-list page with your fulfilment vendor — they see addresses and items, no login needed.',
      ]},
      { id: 'org-registry', icon: '🎁', title: 'Gift registry (paid)', img: '/media/admin-registry.png', steps: [
        'Overview → Features → turn on Registry.',
        'Registry tab: add gift items (paste a store link to auto-fill details) and cash funds; write a welcome message.',
        'Share the public registry link — guests mark what they\'ll bring so nobody doubles up.',
        'No money moves through the platform — guests buy or give directly.',
      ]},
      { id: 'org-team', icon: '🧑‍🤝‍🧑', title: 'Add your team', img: '/media/admin-team.png', steps: [
        'Team tab → "Add a teammate" → enter email + role (Staff to scan, Admin to manage).',
        'They sign in with that email and the account links automatically.',
        'Assign staff to the specific event so they can scan it.',
      ]},
      { id: 'org-checkin', icon: '🎟️', title: 'Check-in day', steps: [
        'Check-in needs an Event Pass. Set the event to Active (Overview).',
        'You or your staff open Scanner and scan each guest’s QR — admission is instant.',
        'Watch it live on the Dashboard.',
      ]},
      { id: 'org-upgrade', icon: '💳', title: 'Upgrade & credits', img: '/media/pricing.png', steps: [
        'Invite tab → Event Pass. Free = email-only, 25 guests, branding, no paid features.',
        'Buy a pass to unlock SMS/WhatsApp, more guests, check-in, seating & menu, venue access zones, logistics, gift registry, and remove branding.',
        'Want to try paid features first? On a new account the Admin panel shows a "Request free trial credits" banner — send it and we\'ll set you up.',
        'Low on messages? Buy a credit top-up in the same panel. See all plans at /pricing.',
      ]},
    ],
  },
  staff: {
    label: 'Staff / Scanner',
    icon: '📷',
    blurb: 'Check guests in at the door.',
    topics: [
      { id: 'staff-join', icon: '🔑', title: 'Join & sign in', steps: [
        'Your organizer adds you by email — sign in with that exact email.',
        'They assign you to the event you’ll be working.',
      ]},
      { id: 'staff-scan', icon: '📷', title: 'Check guests in', img: '/media/scanner.png', steps: [
        'Open Scanner → Start Camera → point at each guest’s QR.',
        'No app to install — it runs right in the browser.',
      ]},
      { id: 'staff-results', icon: 'ℹ️', title: 'Reading the result', steps: [
        'Welcome — admitted successfully.',
        'Already admitted — the ticket was used before.',
        'Not assigned / needs pass — ask the organizer.',
      ]},
      { id: 'staff-zones', icon: '🚪', title: 'Zone scanning (Venue Access events)', img: '/media/scanner-zone.png', steps: [
        'If the event uses Venue Access, the Scanner shows a zone + direction picker — set it to where you\'re standing (e.g. Main Hall · In).',
        'Easier: if the organizer set up Gates, switch to "Gate" and pick your gate once — the zone and direction are filled in automatically for every scan.',
        'Each scan logs the guest in or out of that zone and shows Allowed (green) or Denied (red) with the live zone occupancy.',
        'Denied reasons: the guest\'s ticket type or tags aren\'t valid for this zone, or the zone is at capacity.',
        'A guest\'s first allowed entry also checks them in for the event — no separate check-in scan needed.',
      ]},
    ],
  },
  guest: {
    label: 'Guest',
    icon: '🎉',
    blurb: 'You received an invite.',
    topics: [
      { id: 'guest-open', icon: '🔗', title: 'Open your invite', img: '/media/invite-page.png', steps: [
        'Tap the link in your email, SMS, or WhatsApp.',
      ]},
      { id: 'guest-rsvp', icon: '📝', title: 'RSVP', steps: [
        'Fill in the form and any questions → Confirm (or Can’t make it).',
        'On a personal link you can change your answer until the deadline.',
      ]},
      { id: 'guest-ticket', icon: '🎟️', title: 'Get your ticket', steps: [
        'Once confirmed, your ticket QR is emailed to you.',
        'On the day, show the QR (phone or printed) at the entrance.',
        'Some events use ticket types (e.g. VIP) and zones — your ticket controls which areas you can enter.',
      ]},
      { id: 'guest-extras', icon: '🍽️', title: 'Meals & plus-ones', steps: [
        'If the host set a menu, pick your meal right on your ticket page before the deadline.',
        'Coming as a couple? Use the partner option on your ticket to link your plus-one so you\'re seated together.',
      ]},
      { id: 'guest-registry', icon: '🎁', title: 'Gift registry', steps: [
        'If the host shares a registry link, open it to browse gift ideas and cash funds.',
        'Mark what you\'ll bring so others don\'t double up — you buy or give directly, not through the platform.',
      ]},
    ],
  },
  operator: {
    label: 'Operator',
    icon: '🛠️',
    blurb: 'Run the EventQR platform.',
    topics: [
      { id: 'op-open', icon: '🛠️', title: 'Open the Console', steps: [
        'Operators see a Console link in the nav (/console).',
      ]},
      { id: 'op-grant', icon: '🎁', title: 'Comp events & credits', steps: [
        'Console → Overview lists every organization and its events.',
        'Comp an event onto a tier, or add message credits — one click, no payment.',
      ]},
      { id: 'op-trials', icon: '🎟️', title: 'Trial requests', steps: [
        'Console → Trial requests: customers asking to try paid features land here (with contact, phone, event & use case).',
        'Approve by comping one of their events onto a tier and/or adding credits. If they have no event yet, approve with no event selected — the grant applies to their next event automatically.',
        'Approving or declining emails the requester the decision automatically.',
      ]},
      { id: 'op-accounts', icon: '🧑‍💼', title: 'Manage accounts', steps: [
        'Console → Accounts: every organization with its members.',
        'Suspend / reactivate an org (members lose access to its events) — reversible, no data loss.',
        'Delete an org to permanently remove it and all its data (typed-name confirmation).',
        'Per member: change role (owner/admin/staff), remove from the org, or suspend/delete the user — deleting also disables their sign-in.',
        'Guards: you can\'t suspend/delete yourself, the last operator, or the default org.',
      ]},
      { id: 'op-pricing', icon: '💲', title: 'Edit pricing', steps: [
        'Console → Pricing: edit tiers/credit packs (price, credits, caps, active).',
        'Changes reflect on the live pricing page and checkout immediately.',
      ]},
      { id: 'op-operators', icon: '👤', title: 'Manage operators', steps: [
        'Console → Operators: add an operator by email, or revoke one (not yourself).',
      ]},
    ],
  },
}
