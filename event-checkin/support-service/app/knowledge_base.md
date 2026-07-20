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

Only collecting RSVPs — no tickets, seating, or check-in? This is the shortest path, and it runs on the free plan. You only ever touch two tabs.

1. Create your event: Event Setup → New Event → enter a name and date. Leave every paid add-on (Seating, Orders, Entry rules, Deliveries, Gift list) OFF — for RSVP-only you don't need any of them, and they stay hidden from your sidebar.
2. Turn on your RSVP page: Invites & RSVP → Invitation page & RSVP. Pick "Anyone with event link" for the simplest setup (one link anyone can use), or "Only guests with a personal invite link" if you need a precise, no-forwarding headcount.
3. Make it yours: add a welcome message, cover image, an optional RSVP deadline, a maximum RSVP count, and any custom questions (dietary, plus-one, t-shirt size…). Click "Preview invite page" to see exactly what guests will see.
4. Get guests in — two ways: (a) simplest — just copy the public event link and share it yourself on WhatsApp, email, or socials; or (b) add a guest list (Guests → Add guest, or upload a spreadsheet) and send personal links from Invites & RSVP.
5. Watch responses roll in: the Guests tab shows each guest as Attending, Declined, Pending, or No reply — updating live. That is your headcount, no extra steps.
6. Optional — approvals: if you turned on "Approval required," confirm or reject each RSVP from the Guests tab (or use "Approve all").
7. That's it. No check-in, scanning, or seating to set up — ignore every other tab. The same event can grow later (add tickets, seating, or check-in) without starting over.

Tip: RSVP-only fits the free plan: email invites + up to 25 guests, no Event Pass needed. Upgrade only if you want SMS/WhatsApp invites, a bigger guest list, or to add check-in/seating to the very same event later.

### Create your event

Each event is a self-contained workspace with its own guests, invites, settings, and day-of tools.

1. In Event Setup, click New Event.
2. Enter the event name, event type, optional host/organiser name, date and time, timezone, venue, location, expected guest count, and currency. Enable the multi-day option and add an end date when needed.
3. Save. Open the event — navigation is grouped into Setup (Start here, Guests, Invites & RSVP), Entry areas/rules, Add-ons (Seating, Orders, Deliveries, Gift list), and Team & settings. On a phone the sidebar becomes a dropdown.
4. Under Team &amp; settings → Features, toggle on the features you need: Seating, Orders, Entry rules, Deliveries, and Gift list. Each requires an Event Pass — once enabled it appears in the sidebar.
5. The event you pick is remembered across Results, Check-in, and Orders — you only choose it once. The current event shows as a chip in the top bar.
6. Set the event to Draft while preparing, Active on the day to enable check-in, and Ended afterwards.
7. You can create multiple events — each is independent with its own guest list and settings.

Tip: Confirm the timezone before inviting guests. Festio displays invite, ticket, and check-in times in the event timezone, which may differ from the timezone on your device.

### Add your guest list

Import from a spreadsheet, sync from Google Sheets, or add guests one at a time.

1. Go to Start here → Download template. It contains exactly the columns your event uses — with an Excel dropdown for ticket types — so nothing is missed.
2. Fill in the template and click Upload guest file. Your own spreadsheet works too: column names match in any case or spacing (First Name = first_name = FIRST NAME).
3. Email is optional — guests without an email can still receive SMS/WhatsApp invites and be checked in by QR.
4. For live sync: paste a Google Sheets or OneDrive share link. Import once, or set a sync interval while the event is Active.
5. Watch the sync status badge: green = ok, amber = imported with warnings (unknown ticket types, rows over plan limit, invalid phone numbers), red = sync failed (check the share link is still public).
6. Re-importing never creates duplicates — it fills in missing phone numbers, ticket types, addresses, and tags for existing guests.
7. For Entry rules events: add a "tags" column (e.g. "VIP; Press") — unknown tags are created automatically and control which areas each guest may enter.
8. The free tier allows up to 25 guests total. An Event Pass raises this limit based on the tier you choose.
9. To add a single guest: Guests tab → Add guest, fill in the form.

Tip: Column matching is flexible — "First Name", "first_name", "firstname" all map to the same field. The only required column is a name (first + last, or full name).

Warning: Phone numbers must include the country code (e.g. +2348012345678 for Nigeria, +14155551234 for US) for SMS/WhatsApp delivery to work.

### Set up your RSVP & invite page

The invite page is what guests see when they open their link. Make it yours.

1. Go to Invites & RSVP → Invitation page & RSVP.
2. Choose Anyone with event link (one shared link, anyone can RSVP) or Only guests with personal invite link (unique private link per guest — only that guest can use it).
3. RSVP form fields: for Email and Phone, choose Don't ask / Optional / Required for the submitter, and Optional / Required for any additional guests they register. Name is always required.
4. Optionally: set an RSVP deadline, enable approval required (you manually approve each RSVP), add custom questions (dietary, t-shirt size, table preference, etc.), upload a cover image, and write a welcome message.
5. Click "Preview invite page" to see exactly what guests will see before you send anything.
6. For Orders events: add choices for meals, drinks, gifts, or any other item guests should select on the invite page.
7. For Deliveries events: turn on address collection — guests enter their shipping address when they RSVP.
8. Set a maximum RSVP count to close registrations once the venue is full.

Tip: Personal invite links prevent forwarding and double-booking. Use them for formal events or when you need a precise headcount.

### Invitation categories & automatic seating

For schools, conventions, and large family events: let one person register a whole party, gate how many guests each category may bring, and seat everyone at the right tables automatically.

1. Invites & RSVP → tick "Let one submitter register multiple invitees". Each registered person becomes a separate guest with their own QR pass.
2. Set the Default max invitees, then define your categories in Category invitee limits — e.g. {"Graduating Family": 6, "Friends of Graduand": 3, "Individual invited guest": 0}. Use 0 for submitter-only categories.
3. Saving the categories automatically creates a required "Invitation category" question on the public RSVP page — the submitter picks their category first, and the form enforces that category's guest allowance.
4. Give your tables a Category label in the Seating tab (e.g. "Family", "Friends", "Staff"). Several tables can share one label — together they form a bucket that fills table by table.
5. Back in Invites & RSVP, the Category → tables section lists each invitation category with two dropdowns: the Submitter table bucket and the Invited-guests table bucket. Leave one blank to skip it.
6. From then on, every RSVP is seated on submission: the submitter is pinned to a table in their category's submitter bucket, and each guest they registered is pinned to the invited-guests bucket.
7. At check-in, each guest gets the next free seat at their pinned table — full tables overflow to the next table in the same bucket.
8. Guests who registered before you configured the mapping aren't re-seated automatically — assign them a table group or table from the Guests tab.

Tip: Name your categories exactly as guests should read them ("Hafla & Graduands — up to 10 additional guests" reads better than "CAT-A"). The RSVP dropdown shows each category with its guest allowance.

### Send invitations

Reach guests on the channel they actually check — WhatsApp, SMS, or email.

1. Shared link: copy the event link and share it yourself (WhatsApp group, email, social). Or use Manual invite — search a specific guest and send them a personal link.
2. Personal links: use Invites & RSVP to send to guests who have not been invited yet, remind no-replies, or resend links.
3. Pick your channels: Email (first 25 per event free, then ½ credit each), SMS (1 credit), WhatsApp (1 credit), MMS (3 credits).
4. Each guest receives their personal Festio Pass automatically by email when they RSVP as Attending.
5. For guests without email: if you have their phone number, their QR pass is delivered via SMS or WhatsApp instead.
6. Message credits are pre-purchased from the Event Pass area — top up as needed. Check your balance before a bulk send.
7. For reminders, use Broadcast Message to nudge guests before the event or during arrival.

Tip: Run a small test send to yourself first (add your own phone/email as a test guest) to confirm message formatting and delivery before sending to all guests.

Warning: WhatsApp and SMS sends consume message credits. Check the estimated cost and available balance before confirming. If the balance is insufficient, do not assume every recipient was contacted: read the result, review the credit ledger and delivery report, top up if needed, then retry only recipients that were not sent.

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

Push a message to any subset of guests at any time — before, during, or after the event.

1. Invites & RSVP → Broadcast Message.
2. Write your message (plain text — keep it short for SMS/WhatsApp).
3. Choose your target: All guests, RSVP Attending, RSVP Declined, No reply, Checked-in, or Not checked-in.
4. Pick your channel(s): email, SMS, WhatsApp — or all three.
5. Preview the estimated credit cost before sending.
6. Hit Send. Delivery happens in the background — you can leave the page.
7. Useful examples: venue change, schedule update, parking instructions, "doors open in 30 minutes", post-event thank-you.

Warning: Broadcast sends are immediate and cannot be recalled once sent. Double-check your message and target group before confirming.

### Seating & orders

Assign tables, let guests pick meals, drinks, gifts, or other items, and give staff a live Orders view.

1. Team &amp; settings → Features → turn on Seating and/or Orders (requires an Event Pass).
2. Seating tab → Create tables: set a name (Table 1, Head Table, VIP Round…), capacity, a display order, and optionally a Category label (the label groups tables into buckets used by Invitation categories & automatic seating).
3. Floor layout: open Floor layout to drag tables onto a canvas of your venue — add the stage, entrances, dance floor, and bar, and share a read-only link with your planner or venue.
4. Use Auto-assign to fill tables automatically by RSVP order, or drag guests to specific seats manually.
5. Reserve a seat for a guest: click an empty seat on the chart and pick the guest — they're placed in exactly that seat (handy for a head table or a specific arrangement).
6. Partner pairing: guests can link their plus-one on their ticket page — auto-assign keeps them together.
7. Table groups: group tables into a section (e.g. "Family side", "Friends side", "Men", "Women"). A guest assigned to a group can only be seated at that group's tables — auto-assign, manual seating, and check-in all honour it.
8. No double-booking: each seat holds exactly one guest and a table can't be filled past its capacity — the seating chart and a guest's profile both block it. If a guest's table or group is already full at check-in, they show as Denied so you can re-seat them rather than being seated twice.
9. Orders tab → Add categories (Meals, Drinks, Gifts, Merchandise) and items with optional descriptions.
10. Guests see the available items on their ticket page and pick before your deadline.
11. Orders view: a read-only view your staff or caterer can open on a tablet — shows each table's order totals and individual choices, updating live.
12. Use the seating plan and order totals as the working list for your caterer or fulfilment team.

Tip: Use the RSVP deadline as your cutoff when you do not want guests changing item choices at the last minute.

### Entry areas & ticket rules

Control which guests can enter which areas of your venue — enforced automatically at every scan.

1. Team &amp; settings → Features → turn on Entry rules (requires an Event Pass).
2. Entry areas tab → Areas: create the areas in your venue — Main Hall, VIP Lounge, Backstage, Green Room, etc. Set an optional capacity limit and direction mode (Entry only / Exit only / Both).
3. Ticket types: create tiers — GA (General Admission), VIP, Press, Staff, Speaker. For each type, choose which zones they may enter. Leave empty to allow all zones.
4. Ticket capacity (optional): give a ticket type a limit (e.g. 50 VIP) and you won't be able to assign more than that many guests to it — handy for capped tiers.
5. Assign ticket types: set a guest's type one by one from their profile, or include a ticket_type column in your imported spreadsheet.
6. Tags: create classifiers (VIP, 21+, Speaker, Media…) for finer control — a guest can have multiple tags. Set zone rules to require specific tags.
7. Gates: create a named gate for each scanner position (e.g. "Main Entrance", "VIP Gate", "Backstage Door"). Pin it to a zone + direction. Staff select their gate once — access rules are enforced automatically.
8. Analytics: live occupancy per zone, peak arrival times, room-to-room flow, and each guest's full journey through the venue.

Tip: Gates are the easiest setup for multi-zone events: staff just select "I'm at Main Entrance" and scan — the zone and direction are automatic for every scan after that. Note: Entry rules can't be combined with Section scanning on the same event — use Entry rules for access control + occupancy, Section scanning to seat walk-ins by entrance.

### Section scanning (multi-entrance seating)

For events where each entrance serves a part of the room — e.g. men's / women's sides, or marquee A / marquee B — route walk-ins and ungrouped check-ins to the right section automatically, per staff member.

1. Set up your sections as table groups first (Seating tab) — a section is simply a table group.
2. Guests tab → Walk-in guests → turn on Section scanning. It needs at least one table group, and can't be used together with Entry rules.
3. Team &amp; settings → Event team: assign each staff member their section. A staffer pinned to one section is routed there automatically; give them two or more and they pick their section on the scanner.
4. At the door: walk-ins and ungrouped manual check-ins handled by that staffer are seated in their section. Admins/owners aren't pinned — they pick a section on the scanner.
5. A guest who already belongs to a different group keeps their own group — a section never overrides a guest's explicit assignment.

Tip: While Section scanning is on, each staffer's assigned section replaces the single "auto-assign walk-ins to table group" setting.

### Experience workflows: consent, souvenirs, rooms & sessions

Use Experience when an event has an operational journey after admission: consent, badge pickup, souvenir handoff, room/table assignment, session attendance, certificates, or checkout.

1. Team &amp; settings → Features → turn on Experience. This adds the Experience workspace for the selected event.
2. Create or clone a workflow in Team &amp; settings → Experience. Keep it Draft while editing; only one workflow should be Published at a time.
3. Add steps in the order staff should follow: Main check-in, Consent, Badge pickup, Souvenir, Room assignment, Session attendance, and any custom steps.
4. Use Step dependencies to gate the journey. Example: Consent depends on Main check-in; Souvenir depends on Consent; Room assignment depends on Souvenir; Session attendance depends on its room assignment.
5. For consent, load the active consent form in the Experience consent area. Guests sign from their Festio Pass after check-in, and each signature is tied to the form version they signed.
6. For multi-room or multi-day seating, create tables and table groups in Seating first. Then set a Room assignment step to "Separate seat for this step", give it a unique assignment scope, room/hall name, and matching table group.
7. Scoped room assignments do not replace the guest's main seat. They let the same guest have a Red Oak Ballroom seat, a luncheon seat, and a breakout room seat in one event.
8. For sessions, add Session attendance steps with topic, date, start time, end time, room, speaker, capacity, and check-in window. Staff cannot check guests into the session until the configured window opens.
9. Publish the workflow when ready, then run a test guest through check-in, consent, souvenir, room assignment, and one session gate before sending to all attendees.

Tip: Main seating and Experience room assignment are connected but serve different purposes: main seating is the guest's default event seat; scoped Experience seating is for a specific room, session, meal, or day.

Warning: Use HTTPS for real phone camera scanning. Browser camera access is unreliable or blocked on normal HTTP from phones.

### Deliveries: ship merch, aso-ebi & gifts

1. Team &amp; settings → Features → turn on Deliveries.
2. Deliveries tab → New Shipment. Name it (e.g. "Aso-ebi fabric", "Welcome bag", "Gift delivery").
3. Add items to the shipment — each with a name, optional size/variant, and quantity.
4. Guest addresses: collected automatically if you turned on address collection in RSVP settings, or import them via the ship_address columns in your guest list.
5. Packing list: a shareable read-only page your fulfilment vendor opens — they see guest names, addresses, and items without needing a login.
6. Mark items as packed/shipped per guest — or bulk-mark a whole shipment.
7. Use multiple shipments for different waves (pre-event aso-ebi vs post-event gift delivery).

Tip: Add the shipping address fields to your RSVP custom questions so guests fill them in when they confirm — no separate data collection needed.

### Gift list

1. Team &amp; settings → Features → turn on Gift list.
2. Gift list tab → Add items: paste a store link and the platform auto-fills the title, image, and price. Or add cash funds (e.g. "Honeymoon fund", "New home contribution").
3. Write a welcome message shown at the top of the gift list page.
4. Share the public gift list link directly — paste it in WhatsApp, add it to your invite page, or print it on physical invites.
5. Guests mark what they'll bring (or how much they're contributing) so nobody doubles up.
6. No money moves through Festio — guests purchase or give directly to you. The gift list is purely a wish-list coordination tool.
7. You can see who has claimed each item from the Gift list tab.

### Guest Hub & FestioMe community

Every guest gets a personal hub, and your event can host its own private community for announcements, groups, and chat.

1. Guest Hub: every guest's pass includes a personal FestioHub link — their QR code, seating details, order choices, event updates, and a message thread to your team, on any device. It's sent automatically with their ticket; nothing to configure.
2. Guest Communication tab: control which channels guests can use to reach you (email, chat, announcements), and see every guest thread in one inbox.
3. FestioMe: open the FestioMe area from the top navigation to create your event's community — post announcements, share photos, and create groups (e.g. "Parents", "Volunteers").
4. Groups can be open to all guests, join-on-request, or private (selected members only). Members can chat in group channels or one-to-one.
5. Guests reach the community from their FestioHub — the link is on their pass, scoped to your event.
6. Push notifications: guests who allow notifications on their hub get announcement pushes even when the page is closed.

Tip: Post day-of logistics (parking, doors-open time, dress code) as announcements — every guest sees them on their hub without you spending SMS credits.

### Guest communication controls

Event Updates, Guest Chat, Message Host, and FestioMe groups are separate surfaces. Enable only the conversations your event needs.

1. Open Guest Communication for the selected event. Review Event Updates, Guest Chat, Guest posting, Message Host, and any attending-only option one at a time.
2. Use Event Updates for host-to-guest announcements. Choose the intended audience before publishing, such as attending, declined, checked-in, or not checked-in.
3. Use Guest Chat for a shared event conversation. Turn Guest posting off when guests should be able to read existing messages but not add new ones.
4. Use Message Host for private guest questions. Replies belong to that guest's private thread and must never be copied into Guest Chat or a public FestioMe group.
5. Use FestioMe groups for native community conversations. Group membership and privacy are managed separately from Guest Chat eligibility.
6. After changing a toggle, open one eligible and one ineligible test guest link in separate browser sessions. Confirm that only the intended module or composer changed.
7. Moderate shared Guest Chat from the organizer view. Hiding a message removes it from guest views without turning a private host message into shared content.
8. Turning communication modules off must not disable RSVP, QR tickets, or Check-in. Test those core paths after making a major communication change.

Tip: Before launch, use clearly different test text in Event Updates, Guest Chat, Message Host, and FestioMe. This makes accidental cross-posting or private-content leakage easy to spot.

Warning: Treat Message Host and direct messages as private. Never paste private message text into an announcement or shared group while troubleshooting.

### Add your team

1. Team tab → "Add a teammate" → enter their email address and choose a role.
2. Roles: Owner and Admin can manage the event (settings, guests, seating, etc.); Staff can only check guests in on events they're assigned to.
3. Per-staffer permissions (for assigned Staff): toggle Seats (let them reassign seats), Orders (open the live Orders view), and Dashboard (view Results) for each person — all off by default.
4. For Section scanning events: assign each staffer their section (table group) from the same Team panel, so walk-ins they handle route to the right part of the room.
5. The teammate signs in with that exact email — their account links to your organisation automatically.
6. Assign the teammate to specific events from the Team tab — they only see events they've been assigned to.
7. Sign in as each staff member in a separate browser session and verify their displayed identity, assigned event, and permitted navigation. Staff should not see owner/admin setup controls unless their organisation role was intentionally changed.
8. After changing permissions or removing an assignment, have the staff member refresh and retry an action. Revoked access should stop promptly while historical scan attribution remains intact.
9. Remove a teammate from the Team tab at any time. Their account continues to exist but loses access to your events.

Tip: Add all check-in staff before the event day. Have them test-login and open the Check-in page the day before so there are no surprises on the day.

### Check-in day

1. The day before: set the event to Active in Start here. This enables Check-in to process guests.
2. Ensure all scanning staff are added to the Team tab and assigned to this event.
3. Share the Check-in page with staff. No app install — it runs in any mobile browser.
4. Staff open Check-in → choose their gate (or set area + direction manually) → tap Start camera.
5. Each guest shows their QR code (from email, SMS, WhatsApp, or their ticket page). Staff point the camera — admission is instant.
6. Green = admitted. Yellow = already admitted (duplicate scan — same guest, same seat, never seated twice). Red = denied (wrong zone, at capacity, table/section full, or needs an Event Pass).
7. For walk-in guests not on the list: Guests tab → Add guest → assign them a ticket type → their QR appears immediately for scanning.
8. Results updates in real time — open it on a separate screen to monitor check-ins live.
9. After the event: set to Ended to disable further check-ins. Review the full check-in record from the Guests tab.

Tip: Test scanning works on at least one device before guests arrive. Scan your own guest entry to confirm the green admitted screen appears.

Warning: Check-in requires the event to be set to Active. If guests are getting "Event not active" errors, check the event status in Start here.

### Results

1. Open Results from the nav during or after your event.
2. Top row: total RSVP'd, total checked in, currently in venue (if using Entry areas).
3. RSVP breakdown doughnut: Attending vs Declined vs No reply.
4. Check-in timeline: arrivals per hour throughout the event — shows when your peak entry times were.
5. Area occupancy (Entry areas): live count and capacity bar per area. Turns red when near capacity.
6. Orders summary: totals by selected item across all tables.
7. Per-table report: each table's check-in count, order choices, and which guests are seated there.
8. Results auto-refreshes every few seconds — no need to reload manually.
9. Staff and Orders access roles can view Results for their assigned events when permitted (read-only).

Tip: Put Results on a tablet at the organiser desk so you can monitor arrivals in real time without leaving your post.

### Event Pass & message credits

1. Free tier: email invites, up to 25 guests, Festio branding on invite pages, no paid features.
2. Event Pass: buy per event in Invites & RSVP → Event Pass. Unlocks SMS/WhatsApp invites, more guests, QR check-in, seating & orders, entry areas, deliveries, gift list, and removes Festio branding.
3. Event Passes are tiered by guest cap — choose the tier that fits your event size. You can upgrade to a higher tier if your guest list grows.
4. Message credits: buy in the Event Pass area. 1 credit = 1 SMS or 1 WhatsApp message; MMS costs 3; after your first 25 emails per event, 2 emails cost 1 credit.
5. Low on credits mid-event? Buy a top-up instantly from Event Setup — credits are available immediately.
6. Trial: new accounts can request a free trial from the Event Setup banner — send the request and we'll comp your first event.

Tip: Check your credit balance before any bulk send. The Event Pass area shows your current balance and usage history.

### Export & post-event

1. Guests tab: review RSVP status, check-in time, seat, order choices, and any custom question answers.
2. Seating tab: use the seating chart and table assignment list for on-site reference.
3. Orders tab: review per-table item totals for your caterer or fulfilment team.
4. Deliveries tab: review guest names, addresses, and items for fulfilment.
5. Results: check-in timeline and area analytics are visible on-screen — take screenshots or use your browser print function.
6. After the event, set it to Ended and archive it. Archived events remain accessible for reporting but don't appear in your active list.

### Troubleshooting

Common issues and how to fix them.

1. Guests not receiving invites: check their email/phone in the Guests tab — look for the ⚠️ flag on rows with invalid phone numbers. For email, ask guests to check spam/junk. Resend from the guest row or Invites & RSVP.
2. Import shows warnings (amber badge): click the badge to see which rows failed — most common causes are missing country codes on phone numbers, unknown ticket type names, or rows exceeding your plan guest limit.
3. Google Sheets sync is red: the share link has expired or the sheet's sharing setting changed. Re-share the sheet as "Anyone with the link can view" and paste the new link.
4. QR not scanning: ensure the event is set to Active. Check the scanner device has camera permission in browser settings. Try good lighting — the QR needs to be fully visible in frame.
5. Guest getting "Already admitted": the QR was used at a previous gate. Check their check-in log (Guest profile) to see where they were scanned. This is normal — just admit them manually if it was an error.
6. Area showing Denied: the guest's ticket type or tags don't permit entry to that area. Check the guest's ticket type in their profile and compare with the rules in Entry areas.
7. Check-in shows "No seat available" or "table group full": the guest's table or table group is at capacity. Free a seat, raise the table capacity, or move them to another group in Seating — then scan again.
8. Can't enable Section scanning (or Entry rules): the two can't run on the same event. Turn the other one off first. Section scanning also needs at least one table group to exist.
9. "Sold out" when assigning a ticket type: that ticket type has hit its capacity limit. Raise the limit on the ticket type, or pick a different one.
10. Credits ran out during a bulk send: buy a top-up from Event Setup and resume the send from Invites & RSVP using a no-reply reminder.
11. Can't see Seating / Entry areas tabs: these features must be turned on in Team &amp; settings → Features, and require an Event Pass.
12. Staff can't see the event in Check-in: they must be added in Team tab AND assigned to this specific event.
13. RSVP deadline passed but guests are still submitting: the deadline blocks new RSVPs from the public invite page. You can still add or approve guests manually from Event Setup.

## Staff / Check-in

Check guests in at the door. No app needed — runs in your phone browser.

### Get set up before the event

1. Your organiser adds you by email in the event's Team tab. Make sure they use your exact sign-in email.
2. Sign in at festio.events with that email. Your account links to their organisation automatically.
3. You'll see the events you've been assigned to in the Check-in screen.
4. Open Check-in on the device you'll use on the day and confirm you can see the event. Do this at least the day before.
5. Grant camera permission: the browser will ask the first time you start the camera. Allow it — if you accidentally denied, go to your browser Settings → Site permissions → Camera and re-enable it.
6. Check your internet connection and the scanner's Online/Offline status. If connectivity drops, do not keep scanning unless the screen explicitly says the scan was queued for offline sync.
7. After reconnecting, wait for the scanner to report Online, retry one test guest, and confirm Results contains only one admission. Escalate any queued or uncertain scan before continuing the line.

Tip: Do a test scan the day before. Your organiser can add themselves as a guest — scan their QR to confirm the green admitted screen appears.

### Check guests in

1. Open Check-in on your phone or tablet. No app download needed.
2. Select your event from the list.
3. If the event uses Gates, select your gate (e.g. "Main Entrance"). This sets your zone and direction automatically.
4. If using manual area entry: pick the area you're standing at and direction (Entry / Exit).
5. If the event uses Section scanning: your section is usually set for you. If you cover more than one, pick your section once — walk-ins and manual check-ins you handle are seated there.
6. Tap Start camera. Point the camera at the guest's QR code — it reads instantly without pressing any button.
7. Hold the phone steady and ensure good lighting. The QR code must be fully within the camera frame.
8. After each scan the screen resets automatically, ready for the next guest within a second.
9. If a guest's phone screen is dim: ask them to increase brightness. A printed QR works just as well.

Tip: If a QR is not working, ask the organiser to look up the guest in Guests and confirm their invitation or ticket code.

### Understanding scan results

1. ✅ Green — "Welcome, [Name]!" — admitted successfully. Guest may proceed.
2. ⚠️ Yellow — "Already admitted" — this QR was scanned before. Ask when and where — it's usually fine if they're moving between zones.
3. 🔴 Red — "Access denied" — the guest's ticket type or tags don't permit this area, or the area is at capacity. Politely direct them to the correct entrance.
4. 🔴 Red — "No seat available / table full" — the guest's assigned table or section is full. Don't re-scan; send them to the organiser's desk to be re-seated (the system won't double-book a seat).
5. 🔴 Red — "Event not active" — the organiser hasn't set the event to Active yet. Ask them to do so in Event Setup → Start here.
6. 🔴 Red — "Needs Event Pass" — the organiser's account is on the free tier. This shouldn't happen at a real event — contact your organiser.
7. ❓ "Guest not found" — the QR is from a different event or is corrupted. Direct the guest to the organiser desk.
8. For any denied result, do not override — direct the guest to the organiser's desk for resolution.

### Experience next steps

1. If the organiser enabled Experience, the scan result shows the guest's next operational steps after admission.
2. Only steps that are available should be acted on. Blocked steps are waiting for an earlier required step such as consent, souvenir pickup, or room assignment.
3. Consent: ask the guest to open their Festio Pass or FestioHub and sign the consent form. The consent step completes when the signed form is recorded.
4. Souvenir, badge, or welcome pack: hand the item to the guest, then tap Complete on the scanner if the step is available.
5. Room assignment: tap Assign Room. Festio assigns the next available table and seat inside the room/table group configured by the organiser.
6. Session attendance: tap Check in only when the guest is entering the correct session. If the session is not open yet, the scanner shows "Not open" and the button is disabled.
7. A session can have a time gate, such as opening 30 or 60 minutes before start. Do not manually complete it early unless the organiser changes the schedule.
8. After completing a step, the scanner refreshes the next steps so you can continue the guest journey without leaving Check-in.

Tip: For large events, assign one staff member per station: entrance check-in, consent help desk, souvenir table, room assignment desk, and session doors.

### Zone scanning & gates

1. If the event has Entry areas enabled, Check-in shows an Area/Gate picker before you start.
2. Gate mode (recommended): select your named gate once (e.g. "VIP Lounge Door"). The zone and direction are pre-configured — every scan automatically enforces the rules for that gate.
3. Manual mode: pick a zone (e.g. Main Hall) and direction (Entry or Exit) yourself. Change it if you move to a different gate.
4. The scan result shows "Allowed" (green) or "Denied" (red) plus the live occupancy count for that zone.
5. Denied reasons shown on screen: "Wrong zone for ticket type", "Tag not permitted here", "Zone at capacity".
6. A guest's first allowed Entry scan anywhere in the venue also counts as their event check-in — no separate check-in scan needed.
7. Exit scans are optional — they help track who is still inside the venue.
8. Live occupancy is shown below the scan result — you can see if a zone is filling up.

Tip: If you're covering multiple gates, stay on Gate mode and switch your gate selection each time you move — don't try to use Manual mode for a fast-moving door.

### Tips for a smooth check-in

1. Keep your phone charged — bring a power bank for all-day events.
2. Use a phone holder or lanyard so your hands are free to manage the queue.
3. Brief other staff before opening: agree on what to do if a QR is denied or a guest can't find their ticket.
4. For large events with queues: open multiple check-in stations and assign a separate area/gate to each — parallel scanning dramatically reduces wait times.
5. If the camera freezes: close and reopen the Check-in tab. You don't lose any data.
6. Guests who can't find their QR: ask them to check their confirmation email/SMS/WhatsApp. If still missing, direct them to the organiser desk for lookup in Guests.
7. Manual lookup: ask the organiser to use Guests or the ticket code lookup to confirm the guest before entry.
8. Noisy lighting (direct sunlight, flashing lights): tilt the guest's screen slightly towards you or ask them to cup their hand over it to reduce glare.
9. If two stations may scan the same guest, let the first confirmed admission win. The second device should show Already admitted; never use a manual override merely because the devices raced.

## Guest

You received an invite — here's everything you need from RSVP to arrival.

### Open your invite

1. Tap the link in your email, SMS, or WhatsApp message. It opens in your phone browser — no app download needed.
2. If the link asks you to "Open with…" — choose your browser (Chrome, Safari, etc.).
3. If the link has expired: RSVP deadlines are set by the host. Contact them directly to be added manually.
4. If you can't find your invite: check your spam/junk folder (email) or your WhatsApp message requests.

### RSVP

1. Fill in your name and any questions the host has set (dietary preference, item choice, t-shirt size, etc.). Fields marked * are required; the rest are optional.
2. If the form asks for an Invitation category (schools, ceremonies, conventions): pick the category that describes you first — it sets how many additional guests you may register and where your party will be seated.
3. Registering your party: use "Add additional guest" to enter each person you're bringing (name, and contact details if asked). Every person you register gets their own QR pass — so register everyone in one submission.
4. Click Confirm to say yes, or "Can't make it" to decline.
5. On a personal (closed) invite link, you can return and change your answer until the RSVP deadline.
6. If the host requires approval, you'll see "RSVP submitted — awaiting confirmation" until they approve. You'll get a notification when you're confirmed.
7. If you're bringing a plus-one: look for the partner/plus-one option on your ticket page after confirming — link your partner's name so you're seated together.

Tip: RSVP as soon as possible — some events have capacity limits and close registrations once full.

### Your ticket & QR code

1. Once your RSVP is confirmed, you'll receive a confirmation email (and/or SMS/WhatsApp) with your personal QR code.
2. On the day: show this QR at the entrance — staff will scan it with their phone camera. It's instant.
3. You can also find your ticket by reopening the invite link — your QR is always there.
4. The QR is personal and unique to you. Don't share it with anyone else.
5. If the event uses zones (e.g. VIP areas): your ticket type controls which areas you can enter. If you're denied at a gate, speak to the organiser.
6. Printed QR works just as well as showing it on your phone screen.

Tip: Screenshot your QR code and save it to your phone's camera roll before the event, in case you lose internet access on the day.

### Order choices & seating

1. If the host set up orders, you'll see a "Pick your items" section on your ticket/RSVP page.
2. Pick your choice before the deadline shown — after the deadline, changes may not be accepted.
3. Your item choices are sent to the event team and linked to your table automatically — you don't need to tell anyone on the day.
4. Seating: the host assigns tables. Your table and seat number (if assigned) appear on your ticket page before the event.
5. If you're attending as a couple/group: link your plus-one on your ticket page so the host can seat you together.

### FestioHub & event activity

1. Your confirmation includes a personal FestioHub link — your event pass, QR code, seating details, host updates, and a direct message line to the event team, on any device.
2. FestioMe community: if the host opened a community, your hub links to it — announcements, photos, and groups you can join or request to join. Allow notifications to get updates even when the page is closed.
3. For Experience events, your ticket page includes a FestioHub or Track my activity button.
4. Open FestioHub to see your event pass, updates from the organiser, and your activity progress.
5. After check-in, FestioHub can show next steps such as signing consent, collecting a badge or souvenir, receiving a room/table assignment, and attending sessions.
6. If consent is required, open the consent section, review the form, type your name and signature, then submit it. You can download or request a copy after signing.
7. Room and table assignments may appear at different times. A convention can assign one seat for the main hall, another for lunch, and another for a breakout room.
8. Session attendance is checked by staff at the session door. Some sessions only open for check-in shortly before the session starts.
9. If a step looks incomplete but staff already helped you, ask the event desk to refresh or update your activity record.

Tip: Keep your ticket link handy. It is your fastest path back to your QR code, consent form, FestioHub, and activity progress.

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

### Guest FAQ

Quick answers to common questions.

1. I didn't get a confirmation email — check your spam folder first. If it's not there, return to your invite link and confirm your email address is correct. Contact the host to resend.
2. I can't find the invite link — check your email, SMS, and WhatsApp message requests. Ask the host to resend it.
3. The link says "RSVP closed" — the deadline or capacity limit has passed. Contact the host directly.
4. My QR won't scan — ask the staff member to direct you to the organiser desk. The organiser can confirm your invite or ticket code.
5. I want to bring an extra guest — contact the host. They control plus-one allowances.
6. I need to cancel — return to your invite link and change your RSVP to "Can't make it". Contact the host if you're past the deadline.
7. I have a dietary requirement — if there's no option on the RSVP form, add a note in the "special requests" field or contact the host directly.
8. Where do I sign consent? — open your ticket link after check-in and tap FestioHub or the consent section. If you cannot find it, ask the event desk to resend your link.
9. Why can't staff check me into a session yet? — the organiser may have set a session check-in window. Staff can check you in when that window opens.
10. Why do I have more than one table or seat? — some conventions assign seats separately for different rooms, meals, or sessions. Follow the room/table shown for the activity you are attending.

## Operator

Platform management — organisations, billing, pricing, and support tooling.

### Open the Console

1. Operators see a Console link in the main navigation when signed in.
2. Direct URL: /console.
3. The Console is only visible to accounts with the platform superadmin role.
4. If you need operator access added, contact another existing operator.

### Comp events & add credits

1. Console → Overview: lists every organisation with its events.
2. Click an event → Comp Event: select a tier to grant it free (the tiers configured in Pricing). The organiser immediately gets all features of that tier.
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

### Manage operators

1. Console → Operators: lists all accounts with platform superadmin access.
2. Add an operator: enter their email address. They must already have a Festio account.
3. Revoke an operator: removes their superadmin access. You cannot revoke your own access.
4. Keep the operator list minimal — operator accounts have unrestricted access to all organisations and data.

Warning: Only grant operator access to trusted team members. Operators can view, modify, and delete any organisation's data.
