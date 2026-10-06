# Festio product documentation

Generated from frontend/src/guideContent.mjs — do not edit by hand, run
support-service/scripts/build_knowledge_base.mjs to regenerate.

## Organizer

Create an event, invite guests, and run check-in on the day.

### Get started

Everything begins with a free account — no credit card required.

1. Go to festio.events and click Get Started.
2. Sign in with Google (fastest) or create an account with any email address.
3. You land straight in Event Setup with your own organisation already created.
4. Click New Event to create your first event — you can run a free event with up to 25 guests right away.
5. Want to try all paid features before buying? Use the trial request banner in Event Setup and send a request — we'll set you up.

Tip: The free tier includes email invites, RSVP tracking, and up to 25 guests. Upgrade to an Event Pass to unlock SMS/WhatsApp, QR check-in, seating, entry areas, and more.

### Just need RSVPs? Start here

Not every event needs seating, orders, or entry rules — sometimes you just want a clean guest list and RSVP count.

1. When creating your event, choose attendance mode "Invitation / RSVP" and leave the RSVP form checkbox on — skip the other add-on checkboxes (Seating, Orders, Planner, etc.) entirely.
2. Using the guided setup wizard instead? The RSVP step offers two cards: "Skip RSVP" or "With RSVP" — pick "With RSVP".
3. That's it — you get a free-tier event with an invite page, RSVP tracking, and up to 25 guests, with no paid features enabled.
4. You can always turn on more add-ons later from Guest Communication → Features & Channels once you actually need them.

Tip: This path is the fastest way to get a shareable RSVP link out the door — add seating, check-in, or messaging channels only when the event actually needs them.

### Create your event

Each event is a self-contained workspace with its own guests, invites, settings, and day-of tools.

1. In Event Setup, click New Event.
2. Enter the event name, an optional host/organiser display name, date & time, and a base URL slug (used in invite links).
3. Save. Open the event — navigation is grouped into Setup (Start here, Guests, Invites & RSVP), Entry areas/rules, Add-ons (Seating, Orders, Deliveries, Gift list), and Team & settings. On a phone the sidebar becomes a dropdown.
4. Under Guest Communication → Features & Channels, toggle on the add-ons you need: Venue Access, Seating, Orders, Logistics, Registry (gift list), Speakers, Partners, Reminders, Experience, Planner, Festio Live, and FestioMe. Most require an Event Pass — once enabled it appears in the sidebar.
5. The event you pick is remembered across Results, Check-in, and Orders — you only choose it once. The current event shows as a chip in the top bar.
6. Set the event to Draft while preparing, Active on the day to enable check-in, and Ended afterwards.
7. You can create multiple events — each is independent with its own guest list and settings.

Tip: The base URL slug is used in all invite and RSVP links (e.g. festio.events/invite/your-slug). Keep it short and memorable.

### Add your guest list

Import from a spreadsheet, sync from Google Sheets, or add guests one at a time.

1. Go to Start here → Download template. It contains exactly the columns your event uses — with an Excel dropdown for ticket types — so nothing is missed.
2. Fill in the template and click Upload guest file. Your own spreadsheet works too: column names match in any case or spacing (First Name = first_name = FIRST NAME).
3. Email is optional — guests without an email can still receive SMS/WhatsApp invites and be checked in by QR.
4. For live sync: paste a Google Sheets or OneDrive share link. Import once, or set a sync interval while the event is Active.
5. Watch the sync status badge: green = ok, amber = imported with warnings (unknown ticket types, rows over plan limit, invalid phone numbers), red = sync failed (check the share link is still public).
6. Review the import preview and row warnings. Matching depends on the supplied identifiers; correct ambiguous or duplicate records before confirming a repeat import.
7. For Entry rules events: add a "tags" column (e.g. "VIP; Press") — unknown tags are created automatically and control which areas each guest may enter.
8. The free tier allows up to 25 guests total. An Event Pass raises this limit based on the tier you choose.
9. To add a single guest: Guests tab → Add guest, fill in the form.

Tip: Column matching is flexible — "First Name", "first_name", "firstname" all map to the same field. The only required column is a name (first + last, or full name).

Warning: For phone delivery use the real international number. Set the intended default country for local input; a US event may use +1. Never blindly change a genuine +234 number to +1. Review import warnings and duplicates before sending messages.

### Set up your RSVP & invite page

The invite page is what guests see when they open their link. Make it yours.

1. Go to Invites & RSVP → Invitation page & RSVP.
2. Choose Anyone with event link (one shared link, anyone can RSVP) or Only guests with personal invite link (unique private link per guest — only that guest can use it).
3. Optionally: set an RSVP deadline, enable approval required (you manually approve each RSVP — only applies with "Anyone with event link"; personal invite links skip approval since you already control who's invited), add custom questions (dietary, t-shirt size, table preference, etc.), upload a cover image, and write a welcome message.
4. Click "Preview invite page" to see exactly what guests will see before you send anything.
5. For Orders events: add choices for meals, drinks, gifts, or any other item guests should select on the invite page.
6. For Deliveries events: turn on address collection — guests enter their shipping address when they RSVP.
7. Set a maximum RSVP count to close registrations once the venue is full.

Tip: Personal invite links prevent forwarding and double-booking. Use them for formal events or when you need a precise headcount.

### Design Studio: brand your invite, pass & Guest Hub

Availability: Paid

Match your invite page, ticket, and Guest Hub to your event's look — colors, fonts, and layout, no design tool required.

1. Open Design Studio from the sidebar (requires an Event Pass to publish; you can still browse and edit for free).
2. Templates tab: browse ready-made template families (each covering your Event Page, Flyer, Pass, and Email together) and pick one as your starting point.
3. Flyer tab: edit wording (title, date, venue) plus colors and font pairing for a shareable flyer image.
4. Event Page tab: toggle hero sections, cover image fit and focus, and which event details show — with a live preview of your real invite page.
5. Festio Pass tab: edit the admission wording, footer note, and FestioHub intro shown on every guest's ticket.
6. Guest Hub tab: pick one of the ready-made visual themes — applies colors, font, and layout together across the RSVP page and Guest Hub in one click.
7. Email Preview tab: check how your saved wording and colors look across every email type (invitation, RSVP confirmation, pass, reminder, broadcast, check-in confirmation).
8. Publish tab: review the checklist, then Publish design to make your changes live for guests.

Warning: Publishing requires an Event Pass — you can design for free, but guests won't see your changes until you upgrade and publish. There's also no rollback: if a published version has a mistake, publish a corrected version rather than trying to revert.

### Invitation categories & auto-seating

Let one person register a whole party — spouse, kids, guests — with everyone auto-seated in the right section.

1. Guests tab → Invites & RSVP → turn on "Multi-invitee" so one submitter can register additional people alongside themselves.
2. In Category invitee limits & table-category mapping, click + Add category for each group you want (e.g. Family, VIP, Staff).
3. For each category, set a maximum number of invitees and choose which seating-table category the submitter and their invitees should land in (matched against the table categories you've already created in Seating).
4. On RSVP, the submitter is automatically seated in their bucket and each invitee in theirs — no manual seat assignment needed for that party.
5. The auto-generated "Invitation category" question this creates is managed only from this panel, not the general RSVP questions list.

Tip: Set up your seating table categories first — the category mapping dropdowns here are populated from table categories that already exist.

### Send invitations

Reach guests on the channel they actually check — WhatsApp, SMS, or email.

1. Shared link: copy the event link and share it yourself (WhatsApp group, email, social). Or use Manual invite — search a specific guest and send them a personal link.
2. Personal links: use Invites & RSVP to send to guests who have not been invited yet, remind no-replies, or resend links.
3. Pick your channels: Email (always free), SMS (uses message credits), WhatsApp (uses message credits).
4. Each guest receives their personal ticket QR automatically by email when they RSVP as Attending.
5. For guests without email: if you have their phone number, their QR ticket is delivered via SMS or WhatsApp instead.
6. Message credits are pre-purchased from the Event Pass area — top up as needed. Check your balance before a bulk send.
7. For reminders, use Broadcast Message to nudge guests before the event or during arrival.

Tip: Run a small test send to yourself first (add your own phone/email as a test guest) to confirm message formatting and delivery before sending to all guests.

Warning: WhatsApp and SMS sends consume message credits — SMS costs more per message than WhatsApp (roughly 2 credits per SMS vs 1.5 per WhatsApp message by default). A bulk send to 300 guests can use several hundred credits, not just 300. Check the estimated cost shown before sending, and check your balance first — the send will stop mid-way if you run out.

### Track RSVPs & approvals

1. The Guests tab shows every guest with their current status: Attending, Declined, Pending (submitted, awaiting your approval), or No reply.
2. Each row also shows whether the guest has been checked in on the day.
3. If "Approval required" is on: click a guest to approve or reject their RSVP. Use "Approve all" to confirm everyone at once.
4. Use search, selection, and the status columns to find specific groups quickly.
5. Use the guest tools to review or download event data when you need an offline list.
6. Click any guest to see their details: RSVP answers, contact info, ticket type, tags, seat assignment, order choices, and check-in history.
7. Update a guest's status, ticket type, or seat assignment manually if needed.

Tip: Use the filter + bulk-select to approve, email, or change ticket types for a whole group at once.

### Broadcast an update

Send an event update to a reviewed audience using the event’s enabled channels.

1. Open Guest Communication and the broadcast composer. Select the correct event before selecting recipients.
2. Choose an audience filter or explicit guests. Select recipients by ticket type selects a snapshot of the loaded guests, such as Teachers or Volunteers; review the selected names and count. An empty ticket-type selection must not be treated as All guests.
3. Write the message and select the enabled email, SMS or WhatsApp channels. Check contact details, applicable consent and the credit estimate before sending.
4. Review the message and recipients, then confirm the send. Queued means accepted for background processing, not delivered. Check delivery records for final channel status and failures.
5. Use Scheduler for a later update. Dynamic audiences are evaluated when sent; frozen audiences preserve the selected recipient set. Review event timezone, timing and status before scheduling.
6. Resolve the reason for failed delivery before retrying. Do not resend to everyone merely because some recipients failed.

Warning: Sent messages cannot be recalled. Do not promise delivery when a job is only queued. Provider/network availability and messaging consent still apply.

### Customize your message templates

Every automatic message — invitations, RSVP confirmations, reminders, and more — has editable wording per channel.

1. Communications → Messages tab → Templates.
2. Each channel falls back to the default wording unless you save your own override — cards show a Custom or Default badge.
3. Click Edit on a template to change its Email subject/body and SMS/WhatsApp/MMS body text. Use the listed placeholders (e.g. guest name, event name, Guest Hub link, ticket link) to personalize each send.
4. Use Preview to see how it renders, or Test send to email/text it to yourself before it goes live.
5. Reset returns a customized template to the default wording — only available once you've actually customized it.
6. Recent template changes shows an audit log of who edited what and when.

Warning: The WhatsApp body field you edit here is not what guests actually receive. Every real WhatsApp send goes through a fixed, Meta-approved template managed in Bird's dashboard — the platform shows an inline reminder of this wherever you edit WhatsApp wording. To change what WhatsApp messages actually say, submit a new template for Meta review (see the WhatsApp Templates section below the editor — a one-time $5 review fee applies) rather than editing the text field.

### Seating & orders

Availability: Paid

Assign tables, let guests pick meals, drinks, gifts, or other items, and give staff a live Orders view.

1. Guest Communication → Features & Channels → turn on Seating and/or Orders (requires an Event Pass).
2. Seating tab → Create tables: set a name (Table 1, Head Table, VIP Round…), capacity, and optionally a section label.
3. Use Auto-assign to fill tables automatically by RSVP order, or drag guests to specific seats manually.
4. Reserve seats: mark seats as unavailable (blocked for a VIP arrival, accessibility needs, etc.).
5. Partner pairing: guests can link their plus-one on their ticket page — auto-assign keeps them together.
6. Orders tab → Add categories (Meals, Drinks, Gifts, Merchandise) and items with optional descriptions.
7. Guests see the available items on their ticket page and pick before your deadline.
8. Orders view: a read-only view your staff or caterer can open on a tablet — shows each table's order totals and individual choices, updating live.
9. Use the seating plan and order totals as the working list for your caterer or fulfilment team.

Tip: Use the RSVP deadline as your cutoff when you do not want guests changing item choices at the last minute.

### Entry areas & ticket rules

Availability: Paid

Control which guests can enter which areas of your venue — enforced automatically at every scan.

1. Guest Communication → Features & Channels → turn on Venue Access (requires an Event Pass).
2. Venue Access → Zones: create the areas in your venue — Main Hall, VIP Lounge, Backstage, Green Room, etc. Set an optional capacity limit and direction mode (Entry only / Exit only / Both).
3. Ticket types: create tiers — GA (General Admission), VIP, Press, Staff, Speaker. For each type, choose which zones they may enter. Leave empty to allow all zones.
4. Assign ticket types: set a guest's type one by one from their profile, or include a ticket_type column in your imported spreadsheet.
5. Tags: create classifiers (VIP, 21+, Speaker, Media…) for finer control — a guest can have multiple tags. Set zone rules to require specific tags.
6. Gates: create a named gate for each scanner position (e.g. "Main Entrance", "VIP Gate", "Backstage Door"). Pin it to a zone + direction. Staff select their gate once — access rules are enforced automatically.
7. Analytics: live occupancy per zone, peak arrival times, room-to-room flow, and each guest's full journey through the venue.

Tip: Gates are the easiest setup for multi-zone events: staff just select "I'm at Main Entrance" and scan — the zone and direction are automatic for every scan after that.

### Section scanning (multi-entrance seating)

Availability: Paid

For events seated by table group with two or more entrances — each scanner routes walk-ins and manual check-ins into the section it's assigned to.

1. Guest Communication → Features & Channels → turn on Section scanning (only shown once you have table groups set up in Seating).
2. On the Team page, assign each staff member (or each device) the table-group section they're stationed at.
3. Walk-ins and manual check-ins scanned at that station seat into that section automatically, instead of a single shared default group.
4. A guest's own assigned group always wins if it doesn't match the scanning station — there's no override flow by design.

Warning: Section scanning and Venue Access (zone/gate-based entry rules) can't both be on for the same event — turn one off before enabling the other.

### Experience workflows: consent, souvenirs, rooms & sessions

Availability: Paid

Build a step-by-step operational journey for each guest — check-in, consent, seating, souvenirs, sessions — tracked from Setup to departure.

1. Guest Communication → Features & Channels → turn on Experience, then open Experience settings.
2. Workflow tab: start from a template (VIP Dinner Guest Journey, Conference Registration, Wedding Reception, Simple Check-in) or build your own from steps like check-in, consent, seating assignment, meal selection, souvenir, badge, room assignment, session attendance, or feedback.
3. Only one workflow can be live per event at a time. Publish makes it active; to change a published workflow you Clone it first, then publish the clone.
4. Consent tab: guests sign consent from their Festio Pass page — this only becomes available after they've checked in, so don't make an earlier step depend on consent being signed first.
5. Guests tab, Feedback tab, and Analytics tab track each guest's progress through the workflow and completion rates per step.
6. Inbound Automations and Messages let you react to step completion (e.g. a message once a guest is seated).

Warning: Step ordering matters: the default "welcome pack" preset requires consent before souvenir pickup, but consent can't be signed until after check-in — putting a consent-dependent step earlier than check-in will silently block guests from completing it.

### Deliveries: ship merch, aso-ebi & gifts

Availability: Paid

1. Guest Communication → Features & Channels → turn on Logistics.
2. Deliveries tab → New Shipment. Name it (e.g. "Aso-ebi fabric", "Welcome bag", "Gift delivery").
3. Add items to the shipment — each with a name, optional size/variant, and quantity.
4. Guest addresses: collected automatically if you turned on address collection in RSVP settings, or import them via the ship_address columns in your guest list.
5. Packing list: a shareable read-only page your fulfilment vendor opens — they see guest names, addresses, and items without needing a login.
6. Mark items as packed/shipped per guest — or bulk-mark a whole shipment.
7. Use multiple shipments for different waves (pre-event aso-ebi vs post-event gift delivery).

Tip: Add the shipping address fields to your RSVP custom questions so guests fill them in when they confirm — no separate data collection needed.

### Gift list

Availability: Paid

1. Guest Communication → Features & Channels → turn on Registry.
2. Gift list tab → Add items: paste a store link and the platform auto-fills the title, image, and price. Or add cash funds (e.g. "Honeymoon fund", "New home contribution").
3. Write a welcome message shown at the top of the gift list page.
4. Share the public gift list link directly — paste it in WhatsApp, add it to your invite page, or print it on physical invites.
5. Guests mark what they'll bring (or how much they're contributing) so nobody doubles up.
6. No money moves through Festio — guests purchase or give directly to you. The gift list is purely a wish-list coordination tool.
7. You can see who has claimed each item from the Gift list tab.

### Ticket sales

Sell paid tickets — general admission, VIP, donations, or external registrations — instead of (or alongside) free RSVP.

1. Open Ticket sales from the sidebar. 01 Availability: turn on "Sell tickets for this event".
2. 02 Payouts: connect Paystack or Stripe, choose whether the processor fee is added to the buyer's total or deducted from your proceeds, and optionally add event tax.
3. 03 Ticket types: + Add this ticket type — choose a real ticket (grants admission), a donation/sponsorship (payment only, no pass), or an external registration (price shown here, buyer registers/pays elsewhere). Set name, price, quantity, and which access level it grants.
4. 04 Catalog: review and Hide any ticket type you want to pull from sale.
5. Need to comp someone in? Issue complimentary pass(es) admits guests without payment.
6. 05 Publish & share: View events opens the public ticket marketplace; Copy link gives your event's own storefront page; Copy embed gives an iframe snippet for your own website.
7. 06 Live sales report: gross revenue, tickets sold, refunds, your proceeds, and a full order ledger with approve/refund actions and a downloadable CSV.
8. A purchased ticket issues the same QR pass as a free RSVP guest — check-in works identically either way. A full refund voids that pass and releases the inventory.

Warning: Ticket sales currently runs in test mode only — payments use Stripe/Paystack test keys, so no real money changes hands yet. Treat it as a preview of the checkout flow, not a live revenue channel, until this is confirmed generally available.

### FestioMe: guest community & groups

Availability: Paid

GuestHub holds event services; FestioMe opens conversations, people, groups and meetups.

1. Enable FestioMe in Features & Channels and configure event community access. Open the organizer FestioMe workspace to manage groups, channels and moderation.
2. Guests enter through their own GuestHub → FestioMe link so the correct event and pass are retained. A copied link from a different event or environment may not authenticate them.
3. In guest Chats, use the plus/start-conversation control or More → Browse groups → New group. Choose people from the event and create an invite-only group. Group creation does not automatically invite every attendee.
4. Open Meetups, choose the intended group and create a meetup with its title, date/time, location and optional capacity. Members can view meetups and respond. A meetup response does not record venue or session admission.
5. Organizer group controls manage join policy, membership, channels and reports. Announcement channels are organizer posts and read-only for ordinary guests. Guests can use message reactions and the emoji picker in permitted conversations.
6. If an adult cannot enter, review the guest record and open organizer FestioMe → Settings → Guest chat access. Select Only approved adults and approve only people whose adult status you have confirmed. Do not bypass junior restrictions or use a staff identity as the guest. Confirm the correct event and pass before retrying.

Warning: Community access, message permissions and guardian pickup authorization are separate. FestioMe needs connectivity; it is not an offline chat system.

### Guest Communication: replies & direct messages

1. Communications → Guest Communication tab shows every guest reply and direct message in one inbox, across email, SMS, and WhatsApp.
2. Reply to a guest directly from the thread — it goes out on whichever channel they messaged you on.
3. This is also where you moderate 1:1 guest↔host direct messages and FestioMe guest chat — FestioMe's own Moderation tab links back here for that.
4. Use this alongside Messages (template wording) and Scheduler (timed sends) — Guest Communication is specifically for two-way conversations, not outbound campaigns.

### Tasks: run your to-do list as a team

Assign and track the work behind your event — who's doing what, by when.

1. Team & Tasks page → Tasks tab → + Task: set a title, assignee, due date, and notes.
2. Switch between List and Board view depending on how your team likes to work.
3. Open a task to add subtasks, attach files, or post a comment in its activity thread.
4. Move a task through Open → In progress → Done as work happens.
5. My Tasks (from your own account) shows everything assigned to you across every event you have access to, separate from any one event's task list.

Tip: Planner's Timeline milestones can link to tasks automatically — a milestone's linked tasks show up in both places.

### Planner: budget, vendors & run sheet

Availability: Paid

Keep the planning work — budget, vendors, contracts, timeline — next to your guest list instead of scattered across spreadsheets.

1. Guest Communication → Features & Channels → turn on Planner, then Open your planner.
2. Budget tab: track allocated vs. actual spend by category.
3. Vendors and Procurement tabs: a workspace per vendor for quotes and orders.
4. Contracts tab: draft a contract with title and terms, Save draft, then Send — the vendor signs from their own portal link. Status moves through draft → sent → signed, showing who signed and when.
5. Timeline tab: add milestones and link tasks to each one (shares the same task list as Team & Tasks) — this is a milestone list, not a Gantt chart.
6. Runsheet and Documents tabs: your day-of schedule and shared files in one place.

Tip: Vendor e-signature happens entirely in the vendor's own portal view — you don't need to chase a separate signing tool.

### Festio Live: activities, Guided Show and display controls

Availability: Paid

Create live quizzes, voting, polls, surveys, ratings, moderated Q&A and word clouds where enabled.

1. Enable Festio Live for the event and confirm account entitlement. In Activity studio select New activity, enter Type, Title and Description, and add questions/options as appropriate.
2. For a Quiz mark the correct answer and configure question timing/scoring. Voting options are candidates or choices; voting has no objectively correct answer. Keep results hidden until the presenter reveals them.
3. Guests join from GuestHub or the supported join code/QR route. Only eligible/live activities appear; an open page is not proof the activity is accepting responses.
4. Choose an activity and Target display, then Send activity to screen. Use Show welcome / clear activity to remove it from that display.
5. For Guided Show configure automation and phase timings, then start the show. Rehearse answering, countdown, answer reveal and the next question. Auto-advance is conditional on automation being enabled; manual Next/Previous controls remain available.
6. An answer countdown needs an active timed question and server opening/deadline state. Simply selecting an activity or enabling Q&A does not create a quiz timer. Keep the control screen connected and verify the guest and display views.
7. Use Presenter & moderator links for the appropriate staff role. Protect these links. A guest join link is not a moderator link.
8. For Ask the Sheikh, follow the separate Q&A procedure. Rehearse two questions from one guest and moderation before making the activity live.

Tip: Turn on "Moderate text" when creating an open-text, word-cloud, or Q&A activity so you can approve responses before they appear on the public display.

Warning: Live responses, moderation, display updates and synchronized show controls require connectivity. Do not promise that Q&A automatically advances through fixed correct answers.

### Add your team

1. Team tab → "Add a teammate" → enter their email address and choose a role.
2. Admin role: can manage the event (edit settings, guests, seating, etc.). Full access except billing.
3. Staff role: can only check in guests and view Check-in/Results for their assigned events. Cannot edit anything.
4. Orders access: read-only access to the Orders view for their assigned events. No check-in access.
5. The teammate signs in with that exact email — their account links to your organisation automatically.
6. Assign the teammate to specific events from the Team tab — they only see events they've been assigned to.
7. Remove a teammate from the Team tab at any time. Their account continues to exist but loses access to your events.

Tip: Add all check-in staff before the event day. Have them test-login and open the Check-in page the day before so there are no surprises on the day.

### Check-in day

1. Confirm the correct event is Active, staff accounts have event access, and the enabled scanner modes match your operating plan.
2. Open Check-in → Convention check-in for general admission. Use Start camera, a pass URL/token, or Manual search when manual check-in is enabled. Zone access, Check-out and Daily attendance are separate actions.
3. Read the immediate result popup and Guest guidance panel. Admitted is confirmed; Already admitted is a duplicate outcome; a denial needs its stated reason resolved. Do not treat a cached/offline result as server confirmation.
4. Before a planned outage, open Offline check-in readiness → Prepare this scanner while online. Verify the saved event, pass count, readiness and expiry. Follow the Offline preparation and synchronization staff guide.
5. For configured juniors, rehearse the authorized guardian flow online. Test both allowed and denied movement, not only a successful admission.
6. Use a fictional guest for the rehearsal. Check daily attendance, session entry/exit, denied age eligibility and the admission popup on both a phone and desktop.
7. Before ending the event, reconnect each scanner and resolve pending or Needs review records. Review Results and the entry/exit report, then end the event.

Tip: Keep one active browser tab per scanner and test the actual venue connection and camera hardware.

Warning: Offline preparation supports eligible general admissions only within the saved manifest lifetime. It does not establish offline startup, cross-device duplicate prevention or junior pickup safety.

### Results

1. Open Results from the nav during or after your event.
2. Stat tiles: Expected, Checked in, Declined, Walk-ins, Checked out, and how many confirmed guests haven't arrived yet.
3. The ring chart shows the percentage of expected guests checked in so far — a single completion number, not an RSVP breakdown.
4. Attendance tab: a cumulative arrival chart comparing actual check-ins against an even expected pace throughout the day, plus an hour-by-hour breakdown — shows when your peak entry times were.
5. Venue Access events: a live occupancy bar per zone (from the Attendance/Operations tabs). Turns amber near capacity, red once full.
6. Invitations, Meals, Program, and Experience tabs cover RSVP status, order choices, session attendance, and guest-journey progress respectively.
7. Per-table order totals and packing/fulfilment lists live under Orders and Deliveries, not Results — Results is about attendance, not table-by-table fulfilment.
8. Results auto-refreshes automatically — no need to reload manually.
9. Staff and Orders access roles can view Results for their assigned events when permitted (read-only).

Tip: Put Results on a tablet at the organiser desk so you can monitor arrivals in real time without leaving your post.

### Event Pass & message credits

1. Free tier: email invites, up to 25 guests, Festio branding on invite pages, no paid features.
2. Event Pass: buy per event in Invites & RSVP → Event Pass. Unlocks SMS/WhatsApp invites, more guests, QR check-in, seating & orders, entry areas, deliveries, gift list, and removes Festio branding.
3. Event Passes are tiered by guest cap — choose the tier that fits your event size. You can upgrade to a higher tier if your guest list grows.
4. Message credits: buy in the Event Pass area. Credits are shared across all your events. By default, one SMS costs about 2 credits, one WhatsApp message about 1.5 credits — email doesn't use credits. Exact rates are shown when you preview a send.
5. Low on credits mid-event? Buy a top-up instantly from Event Setup — credits are available immediately.
6. Trial: new accounts can request a free trial from the Event Setup banner — send the request and we'll comp your first event.

Tip: Check your credit balance before any bulk send. The Event Pass area shows your current balance and usage history.

### Public API & developer access

Read or write your event's guest data from your own tools using the Public API.

1. Org Settings → API Keys panel → Create new key.
2. Name the key and choose a scope: Read-only, or Read-write (requires an active API subscription — the option is disabled without one).
3. Your new key is shown once in a banner — copy it immediately, it can't be viewed again. Revoke a key any time from the list.
4. API docs has the full reference; API Explorer is an in-app console for trying real calls against your own data before writing code.
5. The API covers guests, tables, table groups, and Experience — the same data you manage in the app.

Warning: Read-write access is gated behind an active API subscription — a read-only key works immediately, but write calls fail until you subscribe.

### Event Calendars: curated listing pages

A public page listing several of your events together — for a season, a venue, or a recurring series.

1. Org Settings → Calendars panel → New calendar: set a title, description, and visibility (Public or Private).
2. Manage on a calendar → Add event to curate which events appear, reorder them with the Up/Down buttons, and upload a logo.
3. Copy public link to share the page directly, or Copy embed code to add it as an iframe on your own website.
4. Each calendar tracks total views, and each listed event tracks its own click-through count.
5. For a Private calendar, build a Contact List (paste contacts or upload a CSV/Excel file) and tick it under Private-link audiences, then Send private links to email everyone on that list their own calendar link.

Warning: "Send private links" only works on a Private calendar — a Public calendar with an audience selected will show an error when you try to send, rather than disabling the button ahead of time.

### Export & post-event

1. Guests tab: review RSVP status, check-in time, seat, order choices, and any custom question answers.
2. Seating tab: use the seating chart and table assignment list for on-site reference.
3. Orders tab: review per-table item totals for your caterer or fulfilment team.
4. Deliveries tab: review guest names, addresses, and items for fulfilment.
5. Results: check-in timeline and area analytics are visible on-screen — take screenshots or use your browser print function.
6. After the event, set it to Ended so check-in and RSVP submissions close. The event stays in your event list with its full data for reporting — nothing is deleted or hidden.

### Conference Center: calls, tracks and operational records

1. Open Conference Center for the selected event. Use Calls & abstracts to enable the intended speaker, abstract, exhibitor or sponsor applications, set the deadline and review the public call link.
2. Review submissions and promote accepted people/organizations into the existing Speakers or Partners records. Acceptance alone does not schedule a session.
3. Define tracks and finish dated session scheduling in Experience. Coordinate delivery work in Planner and the speaker/partner workspaces.
4. Use organization templates to reuse the supported conference setup, then inspect the new event. Integration records describe connections; they are not proof that an external registration platform is synchronizing.

Warning: Confirm the actual import or integration path before promising automatic data transfer. External registration may remain with the organizer’s current platform.

### Event website: content, FAQs and publication

1. Open Design Studio → Event website. Select a design and edit the event’s identity, registration details, venue/travel facts, navigation and FAQs.
2. Import the published Experience programme where offered, or configure the public schedule. Review every day, room, speaker and link before publishing.
3. Use preview to inspect phone and desktop layouts. Save draft does not publish; choose Publish when the content is ready.
4. Use Release history to inspect supported prior website releases; unpublishing takes the public website offline until published again. This website workflow is separate from the invite/pass design publisher.
5. Keep event FAQ answers factual: registration owner, eligibility, venue, contact route and deadlines must come from the organizer. Never publish personal pass URLs, staff links or guessed speaker details.

### Giving Hub, Donation Tracker and finance reconciliation

1. Open Festio Live → Donations and configure the campaign, goal, enabled payment instructions and donor privacy. Review the public Giving Hub and projector display.
2. Distinguish a pledge, a payment awaiting verification and confirmed received funds. Total potential is not the same as confirmed money received.
3. Use the finance workspace Payments & pledges to review evidence and confirm or reject contributions with event-admin access. Confirmations are audited.
4. Verify public and projector totals after reconciliation. Do not confirm an amount merely because a guest submitted it.
5. Gift-list coordination, donations and ticket sales use different workflows. Check the configured channel/payment process before telling a guest that Festio itself processed a payment.

Warning: Account-specific refunds, payment disputes and billing decisions require authorized human review.

### Session materials and presenter resources

1. Open Festio Live → Materials. Add the supported file or link, title and session association. Review who can access the material before release.
2. Select the presentation display and test the actual resource there. Verify page movement and blackout controls where supported by the material type.
3. Release approved resources to guests only when intended; an uploaded private file should not be assumed visible in GuestHub.
4. Keep presenter/display access separate from guest resource links. Rehearse external links and supported formats on the venue equipment.

### Certificates: eligibility, issuance and verification

1. Open Festio Live → Certificates. Create or select a certificate template and configure the supported eligibility rules and design.
2. Use a fictional eligible guest for a test issuance. Confirm the rendered identity, event details and public verification link before batch issuance.
3. Review issued records and use supported revocation controls when a certificate should no longer be valid. Check the public verification page after a change.
4. Do not interpret a certificate as evidence of attendance beyond the actual eligibility rules and recorded data.

Warning: Public verification links expose the intended certificate details. Review those details and eligibility before issuing.

### Academy: assignments, practical evidence and versioned learning

1. Open Academy and select the correct organization. Lessons are filtered by the learner’s role; managers have additional setup and management procedures.
2. Complete each lesson’s steps, answer the quiz and submit practical evidence when requested. Passing a quiz is distinct from manager approval of practical work.
3. Authorized managers can assign learning, review evidence, manage due dates and inspect progress. Use reminders only for the intended recipients.
4. Curriculum version 3 contains the October 2026 operational updates. Earlier version-2 records remain historical; a version change does not mean those learners completed the new material.
5. Coordinate reassignment and release review with the training owner. Do not reset or delete historical progress simply to refresh documentation.

### Troubleshooting

Common issues and how to fix them.

1. Guests not receiving invites: check their email/phone in the Guests tab — look for the ⚠️ flag on rows with invalid phone numbers. For email, ask guests to check spam/junk. Resend from the guest row or Invites & RSVP.
2. Import shows warnings (amber badge): click the badge to see which rows failed — most common causes are missing country codes on phone numbers, unknown ticket type names, or rows exceeding your plan guest limit.
3. Google Sheets sync is red: the share link has expired or the sheet's sharing setting changed. Re-share the sheet as "Anyone with the link can view" and paste the new link.
4. QR not scanning: ensure the event is set to Active. Check the scanner device has camera permission in browser settings. Try good lighting — the QR needs to be fully visible in frame.
5. Already admitted: inspect the existing admission record. Do not bypass duplicate protection; an authorized lead must correct a mistaken record through the normal admission controls.
6. Area showing Denied: the guest's ticket type or tags don't permit entry to that area. Check the guest's ticket type in their profile and compare with the rules in Entry areas.
7. Credits ran out during a bulk send: buy a top-up from Event Setup and resume the send from Invites & RSVP using a no-reply reminder.
8. Can't see Seating / Venue Access tabs: these features must be turned on in Guest Communication → Features & Channels, and require an Event Pass.
9. Staff can't see the event in Check-in: they must be added in Team tab AND assigned to this specific event.
10. RSVP deadline passed but guests are still submitting: the deadline blocks new RSVPs from the public invite page. You can still add or approve guests manually from Event Setup.
11. Guests don't see "Join Festio Live" on their ticket page: confirm Festio Live is turned on (Guest Communication → Features & Channels) and that an activity is actually set to Live, not Draft. Share the festio.events/live/join code as a fallback.

### Multi-day timetable: rooms, speakers and age groups

Publish a usable event timetable from dated Experience sessions and timed programme segments.

1. Open Experience and the event’s active workflow. Configure each session’s date, start/end time, room, speaker and audience/age eligibility; enable the Live Program feature where required.
2. Publish the intended workflow and open a test guest’s GuestHub → Programme. The timetable shows all configured days with valid start/end times, not just the first three days.
3. Select each day and search by session, room, speaker or age group. Undated, disabled or invalid-duration sessions do not appear. Missing rooms display Room to be announced; missing speakers need organizer input.
4. Confirm event timezone and all days on a phone and desktop. A visible session is not proof that every guest meets its admission rules.
5. Create and title separate moderated Q&A activities for different speakers/sessions. Timetable speaker names do not automatically create or route Q&A queues.

Warning: Timetable viewing is online. Publication does not prove conflict-free staffing, live capacity or guest eligibility; rehearse those separately.

### Ask the Sheikh: multiple questions and speaker queues

Use one moderated Q&A activity per Sheikh or session so questions reach the intended queue.

1. In Activity studio create Type Q&A and a distinct title containing the speaker/session. Enable Moderate text before it is public.
2. Open Presenter & moderator links and distribute the appropriate staff link securely. Keep guest join links separate.
3. Set the activity Live. Guests can filter Questions & answers only and search by activity/session title before opening the intended Q&A.
4. After submitting, guests use Ask another question to submit again. Q&A is not a one-answer-only quiz.
5. Moderators approve eligible questions before public display, then use Feature, Answered or Dismiss as appropriate. Rehearse the display to confirm unapproved questions stay private.
6. Close or clear the activity when the session ends. Do not assume a countdown or automatic correct-answer reveal applies to free-text Q&A.

### Junior Platform: authorized guardians and handoffs

Configure who may accompany a junior through protected zone movements and check-out.

1. Open Venue Access → Junior operations. Enable guardian verification for configured juniors and set the guardian designation scope.
2. Choose the junior, authorized guardian and relationship; save the authorization. Review whether each entry is Admin-authorized, Confirmed or Pending guardian confirmation.
3. At the scanner, attempt the junior’s zone entry/exit or check-out. When Guardian required appears, scan the authorized guardian’s pass.
4. If manual verification is enabled, staff can check the person’s identity and select the displayed authorized guardian. This records staff verification; it must not be described as a QR verification.
5. Review the entry/exit report with the guardian, operator and outcome. Configure each junior’s authorization; the setting alone does not create an authorization for every child.

Warning: Guardian handoffs remain online. A name on a cached list, an age-group override or an unrelated adult pass cannot authorize a pickup.

## Staff / Check-in

Check guests in at the door. No app needed — runs in your phone browser.

### Get set up before the event

1. Your organiser adds you by email in the event's Team tab. Make sure they use your exact sign-in email.
2. Sign in at festio.events with that email. Your account links to their organisation automatically.
3. You'll see the events you've been assigned to in the Check-in screen.
4. Open Check-in on the device you'll use on the day and confirm you can see the event. Do this at least the day before.
5. Grant camera permission: the browser will ask the first time you start the camera. Allow it — if you accidentally denied, go to your browser Settings → Site permissions → Camera and re-enable it.
6. Check your internet connection. Opening Check-in once while online automatically caches the guest list on your device — if the connection drops later, scanning keeps working and syncs automatically once you're back online (you'll see a blue result instead of green while offline).

Tip: Do a test scan the day before. Your organiser can add themselves as a guest — scan their QR to confirm the green admitted screen appears.

### Check guests in

1. Open Check-in, select the assigned Active event and choose Convention check-in for general admission.
2. Tap Start camera and allow camera access, or paste the guest’s pass URL/QR token. Manual search is available when the event enables manual check-in.
3. Hold the QR fully in frame. Read the result popup and Guest guidance before allowing the guest through. Do not rely on color alone.
4. Already admitted means the guest already has an admission record; inspect the record rather than admitting them again. Send unresolved denials to the authorized event lead.
5. Use Zone access to enter/exit a configured zone; use Daily attendance for today’s attendance or a configured session; use Check-out for convention departure.
6. If offline, continue only when this device has a valid prepared manifest and explicitly reports Check-in queued offline. Follow the offline staff procedure before reconnecting or closing the scanner.

Tip: A printed QR can be scanned. Keep a separate staffed lookup path for guests without a pass.

Warning: Do not promise a fixed scan time. Camera permission, lighting, connection and event rules affect the result.

### Understanding scan results

1. ✅ Green — "Welcome, [Name]!" — admitted successfully. Guest may proceed.
2. ⚠️ Yellow — "Already admitted" — this QR was scanned before. Ask when and where — it's usually fine if they're moving between zones.
3. 🔴 Red — "Access denied" — the guest's ticket type or tags don't permit this area, or the area is at capacity. Politely direct them to the correct entrance.
4. 🔴 Red — "Event not active" — the organiser hasn't set the event to Active yet. Ask them to do so in Event Setup → Start here.
5. 🔴 Red — "Needs Event Pass" — the organiser's account is on the free tier. This shouldn't happen at a real event — contact your organiser.
6. ❓ "Guest not found" — the QR is from a different event or is corrupted. Direct the guest to the organiser desk.
7. 🔵 Blue — "Checked in on this device" — the internet dropped, so the scan was accepted from the guest list already cached on your phone and queued to sync. Keep scanning normally; it uploads automatically once you're back online.
8. For any denied result, do not override — direct the guest to the organiser's desk for resolution.

### Zone scanning & gates

1. Choose Zone access, then the intended zone and Check in to zone or the exit direction. If using a configured gate, confirm its zone and direction.
2. Allowed or Denied reflects the ticket, tag, admission, capacity and guardian rules applicable to that movement. Read the reason before continuing.
3. When separate convention admission is enabled, admit the guest to the event first. Do not assume a zone entry always performs general admission.
4. For configured junior handoffs, scan the authorized guardian’s pass or use permitted staff verification after checking their identity. Pending or unrelated guardian authorizations must not be accepted.
5. Record exits whenever occupancy and pickup tracking are required. Do not treat the general event Check-out control as a substitute for selecting the intended zone exit.
6. Use Venue Access → Junior operations → Entry and exit report to review allowed/denied movements and the verified guardian.

Tip: If you're covering multiple gates, stay on Gate mode and switch your gate selection each time you move — don't try to use Manual mode for a fast-moving door.

Warning: Plan zone and junior handoff operations online. Disconnected stations cannot share current occupancy or guardian authorization.

### Running an Experience workflow

If the organizer has set up an Experience workflow, check-in is just the first step — you may also mark consent, seating, souvenirs, or session attendance.

1. Each guest's Festio Pass page shows their current step in the workflow — what's done and what's next.
2. Consent (if required) can only be signed after the guest is checked in — if a guest asks to sign before arrival, let them know it opens right after their first scan.
3. Mark a step complete from the guest's pass page as they go through it — souvenir pickup, badge issued, seated, etc.
4. If a step won't complete, check whether it depends on an earlier step (like consent) that hasn't happened yet — direct the guest through steps in order.
5. A consent reminder does not override the current pass-form rule: consent opens after admission. Rehearse dependencies so a required pre-admission step cannot deadlock the journey.

### Tips for a smooth check-in

1. Charge devices, provide backup power and rehearse camera permissions and readable QR codes under venue lighting.
2. Assign staff to events, agree the admission/zone/daily/session mode for each station, and nominate a lead for denied entries.
3. Before an outage select Prepare this scanner, confirm its expiry and use one active browser tab per device.
4. Keep the prepared page open. Do not reload, sign out, clear browser data or change devices while local admissions are pending.
5. For a missing pass use Manual search when enabled; otherwise direct the guest to the organizer desk. Never create an extra guest merely to bypass a denial.
6. After reconnecting check pending counts and Needs review records. Server revalidation, not the initial blue offline popup, determines final acceptance.

### Offline preparation and synchronization

Use a prepared scanner for eligible general admissions during a short connectivity outage.

1. While online and signed into the assigned Active event, open Check-in → Offline check-in readiness → Prepare this scanner. Confirm readiness, event, saved-pass count and expiry.
2. The version-2 manifest expires 30 minutes after download. It must match the selected event. Required admission workflow steps, section admission or a live seating decision can block offline admission.
3. Keep this browser page open and use one active tab per scanner. QR and manual convention admission can use eligible saved guests; manual lookup requires the event’s manual-check-in permission.
4. Read Check-in queued offline as a local saved record, not server acceptance. Same-device repeats are detected; another disconnected device cannot see this admission yet.
5. Reconnect and let synchronization run, or choose Sync / retry saved check-ins. Acknowledged admissions are removed from the pending queue; server rejection remains as Needs review.
6. Open Review saved check-ins, resolve the stated reason with an authorized lead and retry. Keep the page and browser data until every record is reconciled.
7. If storage fails, the manifest expires or the scanner says reconnect, stop offline admission. Follow the organizer’s outage procedure rather than bypassing the error.

Warning: Offline cold start/reload, daily/session attendance, convention check-out and junior handoffs are not supported. Live consent, capacity and multiple disconnected devices need special planning; no venue-wide duplicate guarantee exists offline.

### Daily attendance and session entry/exit

General admission, daily presence and session attendance are separate records.

1. Enable Daily attendance in Venue Access → Junior operations if required. A guest must already be admitted before today’s attendance can be recorded.
2. In Check-in choose Daily attendance, select the daily or session action, and use the camera/pass field or Manual search with the corresponding mode.
3. Daily attendance records one mark for the guest on the event-local date. Repeating it must report the existing mark rather than creating another. It does not perform general admission.
4. For a session select the correct session and entry or exit action. Server checks still enforce admission, age eligibility, time window and capacity.
5. An authorized supervisor may use Override and record entry for an age-eligibility exception with a reason. This does not bypass admission, session timing or capacity and is not a guardian-pickup override.
6. Review attendance and entry/exit records after the rehearsal. These actions require a connection.

## Guest

You received an invite — here's everything you need from RSVP to arrival.

### Open your invite

1. Tap the link in your email, SMS, or WhatsApp message. It opens in your phone browser — no app download needed.
2. If the link asks you to "Open with…" — choose your browser (Chrome, Safari, etc.).
3. If the link has expired: RSVP deadlines are set by the host. Contact them directly to be added manually.
4. If you can't find your invite: check your spam/junk folder (email) or your WhatsApp message requests.

### RSVP

1. Fill in your name and any questions the host has set (dietary preference, item choice, t-shirt size, etc.).
2. Click Confirm to say yes, or "Can't make it" to decline.
3. On a personal (closed) invite link, you can return and change your answer until the RSVP deadline.
4. If the host requires approval, you'll see "RSVP submitted — awaiting confirmation" until they approve. You'll get a notification when you're confirmed.
5. If you're bringing a plus-one: look for the partner/plus-one option on your ticket page after confirming — link your partner's name so you're seated together.

Tip: RSVP as soon as possible — some events have capacity limits and close registrations once full.

### Your ticket & QR code

1. Once your RSVP is confirmed, you'll receive a confirmation email (and/or SMS/WhatsApp) with your personal QR code.
2. On the day: show this QR at the entrance — staff will scan it with their phone camera. Wait for the scanner’s result before entering.
3. You can also find your ticket by reopening the invite link — your QR is always there.
4. The QR is personal and unique to you. Don't share it with anyone else.
5. If the event uses zones (e.g. VIP areas): your ticket type controls which areas you can enter. If you're denied at a gate, speak to the organiser.
6. Printed QR works just as well as showing it on your phone screen.

Tip: Screenshot your QR code and save it to your phone's camera roll before the event, in case you lose internet access on the day.

### Buying a paid ticket

1. Some events are ticketed rather than free RSVP — you'll see prices and ticket types (General Admission, VIP, etc.) on the event page.
2. Pick a ticket type and quantity, then pay by card through the event's checkout.
3. After payment, you receive the same personal QR pass a free RSVP guest gets — show it at the door the same way.
4. A refund (if the organizer issues one) cancels your pass along with the payment.

### Your guest journey (consent, souvenirs, sessions)

1. Some events track a step-by-step journey on your Festio Pass page — check-in, consent, seating, souvenirs, or session attendance, depending on what the host set up.
2. Consent forms (if required) become available on your pass page after you've checked in, not before.
3. Your current step and what's next are shown right on your pass — staff can also see and update it as you go through each step.

### Order choices & seating

1. If the host set up orders, you'll see a "Pick your items" section on your ticket/RSVP page.
2. Pick your choice before the deadline shown — after the deadline, changes may not be accepted.
3. Your item choices are sent to the event team and linked to your table automatically — you don't need to tell anyone on the day.
4. Seating: the host assigns tables. Your table and seat number (if assigned) appear on your ticket page before the event.
5. If you're attending as a couple/group: link your plus-one on your ticket page so the host can seat you together.

### Providing your address (aso-ebi / gifts)

1. Some events collect shipping addresses for aso-ebi fabric, welcome bags, or post-event gift delivery.
2. If address collection is on, you'll see an address form on the RSVP or ticket page.
3. Enter your full delivery address including postcode/zip code and country.
4. You can update your address by returning to your invite link before the shipping cutoff date set by the host.
5. If you missed the address deadline: contact the host directly.

### Gift registry

1. If the host shares a registry link, open it to browse their gift wishlist and cash contribution funds.
2. Click "I'll bring this" on any item to claim it — others will see it's taken so nobody buys duplicates.
3. For cash funds: the host's payment details or instructions are shown — you transfer directly, not through Festio.
4. You can unclaim an item if your plans change — just return to the registry link and untick.
5. No account or login required to view or claim items.

### Join a live quiz, poll or survey

1. If the host is running Festio Live, a "Join Festio Live" button appears on your invite/ticket page whenever an activity is live — tap it to join instantly, no extra sign-in.
2. No personal invite link (e.g. you're at a talk or keynote)? Go to festio.events/live/join on your phone and enter the 6-character join code shown on screen, or scan the QR code if one is displayed.
3. Answer from your own phone — quizzes may have a timer and award points; polls, ratings, and surveys just record your response.
4. For quizzes: your score and rank appear on the leaderboard once the host reveals results.
5. For word clouds and open-text questions: your answer may need host approval before it appears on the shared screen — this is normal if nothing shows up immediately.
6. You can only submit once per question unless the host has turned on "Allow changes" for that activity.

Tip: If "Join Festio Live" isn't showing on your ticket page, the host hasn't started an activity yet — check back once the session begins, or ask the host for the join code.

### Guest FAQ

Quick answers to common questions.

1. I didn't get a confirmation email — check your spam folder first. If it's not there, return to your invite link and confirm your email address is correct. Contact the host to resend.
2. I can't find the invite link — check your email, SMS, and WhatsApp message requests. Ask the host to resend it.
3. The link says "RSVP closed" — the deadline or capacity limit has passed. Contact the host directly.
4. My QR won't scan — ask the staff member to direct you to the organiser desk. The organiser can confirm your invite or ticket code.
5. I want to bring an extra guest — contact the host. They control plus-one allowances.
6. I need to cancel — return to your invite link and change your RSVP to "Can't make it". Contact the host if you're past the deadline.
7. I have a dietary requirement — if there's no option on the RSVP form, add a note in the "special requests" field or contact the host directly.

### Find your timetable and ask a speaker

1. Open your personal GuestHub and choose Programme. Select the day and search by session, room, speaker or age group.
2. Check the event timezone and the latest room information before travelling to a session. A listed session may still have age, capacity or admission requirements.
3. For questions open Festio Live, select Questions & answers only, search the speaker/session title and open the matching Ask the Sheikh activity.
4. Submit your question; it may wait for moderator approval. Use Ask another question to send an additional question to the same activity.
5. Use Need help? or Communications in GuestHub to contact the event organizer. Your personal pass remains the route for admission, not a chat message.

### FestioMe chats, groups and meetups

1. Open FestioMe from your own GuestHub to retain the correct event and pass. Chats is the conversation workspace; Back to GuestHub returns to event services.
2. Choose an event chat or permitted direct message. Use the emoji picker or reactions; organizer announcement channels are read-only for ordinary guests.
3. Use the Chats plus button or More → Browse groups → New group to select event members and create an invite-only conversation.
4. Open Meetups and select the group to see or create gatherings. Check date/time, location and capacity before responding. A meetup RSVP is not a session or gate check-in.
5. If access is denied or your pass is not found, return through the correct GuestHub and ask the organizer to review your access. Junior restrictions and adult approvals still apply.

Warning: Do not share a personal GuestHub/pass link as a public community invitation. Chat and meetup updates require connectivity.

## Operator

Platform management — organisations, billing, pricing, and support tooling.

### Open the Console

1. Operators see a Console link in the main navigation when signed in.
2. Direct URL: /console.
3. The Console is only visible to accounts with the platform superadmin role.
4. If you need operator access added, contact another existing operator.

### Comp events & add credits

1. Console → Overview: lists every organisation with its events.
2. Click an event → Comp Event: select a tier to grant it free (Starter, Standard, Pro, Scale, etc.). The organiser immediately gets all features of that tier.
3. Click an organisation → Add Credits: enter a credit amount to top up their message credit balance at no charge.
4. Comps and credit grants are logged with the operator name and timestamp.
5. To remove a comp: click the event and select Remove Comp — the event reverts to its paid status.

### Trial requests

1. Console → Trial requests: lists customers who submitted a free trial request from Event Setup.
2. Each request shows: contact name, email, phone, event name, use case description, and submission date.
3. Approve: select a tier to comp their event onto (and optionally add message credits). Click Approve — the customer is emailed the decision automatically.
4. Decline: click Decline — the customer is emailed that their request wasn't approved.
5. If the requester has no event yet: approve with no event selected — the comp is held and applied to their next event automatically.
6. Approved trials do not auto-expire — remove the comp manually from the event if needed after the trial period.

### Manage accounts

1. Console → Accounts: every organisation with its members, roles, and event count.
2. Suspend an org: all members lose access to its events immediately. Reversible — reactivate any time. No data is lost.
3. Delete an org: permanently removes the org and all its events and data. Requires typing the org name to confirm. Irreversible.
4. Per member actions: change role (Owner / Admin / Staff), remove from org, suspend user (blocks all sign-in), or delete user (removes account + disables sign-in).
5. Guard rails: you cannot suspend or delete yourself, the last operator account, or the default org.
6. View a member's full sign-in history and last active date from their profile.

Warning: Org deletion is permanent and cannot be undone. Always confirm with the customer before deleting.

### Edit pricing & plans

1. Console → Pricing: view and edit all event pass tiers and message credit packs.
2. Edit a tier: change the display name, price (USD and/or NGN), guest cap, active/inactive status.
3. Add a new tier: useful for custom enterprise plans.
4. Message credit packs: edit the credits-per-pack, price, and active status.
5. Changes apply immediately to the public pricing page and checkout.
6. Deactivating a tier hides it from checkout but doesn't affect events already on that tier.
7. Global add-on promotion (in the same Pricing tab): opens every add-on free on all current and future paid events for a set period — "Open paid-event add-ons for 6 months" or "End promotion now". Free events still can't use add-ons, and any explicit per-org or per-event override still takes precedence.

### Grant or deny add-ons per organization

1. Console → Add-on Access: search for the organization or event you need.
2. Manage add-ons on an organization opens an override editor per add-on — Grant, Deny, or return it to normal billing rules.
3. Organization-level grants apply to all of that org's current and future events, not just one.
4. Use this for one-off exceptions (a customer needs Planner early, or should never get a specific add-on) rather than the blanket Console → Pricing promotion, which affects everyone.

### Platform-wide settings

1. Console → Support chat: toggle whether the in-app support chat widget is visible to organizers platform-wide.
2. Console → Usage: aggregated usage stats across all organizations.
3. Console → QA checklist: view results submitted from the staging QA checklist tools.
4. Console → Referrals and Affiliate stores: manage referral tracking and affiliate storefronts.
5. Console → Org Plans: view and adjust organization-level subscription plans (distinct from per-event Event Pass tiers).

### Manage operators

1. Console → Operators: lists all accounts with platform superadmin access.
2. Add an operator: enter their email address. They must already have a Festio account.
3. Revoke an operator: removes their superadmin access. You cannot revoke your own access.
4. Keep the operator list minimal — operator accounts have unrestricted access to all organisations and data.

Warning: Only grant operator access to trusted team members. Operators can view, modify, and delete any organisation's data.
