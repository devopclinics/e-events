// Shared source for in-app Help, public guide and support knowledge.
// Updated from the 48 reviewed service recipes; preserve topic IDs for links.
export const GUIDE_REVISED_AT = '2026-10-08'

export const CONTENT = {
  "organizer": {
    "label": "Organizer",
    "icon": "🗂️",
    "blurb": "Create an event, invite guests, and run check-in on the day.",
    "topics": [
      {
        "id": "org-start",
        "icon": "🚀",
        "title": "Get started",
        "intro": "Build a usable event first, then add the services your guests need. Prepare, create and save, then test the guest or staff result.",
        "steps": [
          "Open Festio and sign in to your organizer account. New organizers use the registration flow and complete any verification instructions shown there.",
          "Use the event selector in the header before editing. Check its name every time you move between events. Organization settings and the credit wallet can affect more than one event.",
          "Open Setup Guide. Follow Create event → Choose outcomes → Foundation → Audience & registration → Design & guest experience → Operations & giving → Conference & Live → Results & closeout.",
          "For a simple event, finish the foundation, RSVP, a named guest, a usable pass and check-in first. Add seating, meals, sessions or engagement only when needed.",
          "For each service, follow A: prepare access and inputs; B: create and save the record; C: preview and test the guest or staff result.",
          "Keep a test log: service, record name, guest used, date, expected result, actual result and screenshot. A preview alone does not prove a delivered message or successful scan.",
          "Use “Record test or review” in the Setup Guide after the actual check. Record Partial if some conditions remain untested. Event Active is a separate lifecycle state, not proof that every service is ready."
        ],
        "path": "Event Setup → Setup Guide",
        "before": "Have the event name, dates, timezone, venue, audience size, registration method and one controlled test contact ready.",
        "check": "You can name the event, reach each enabled workspace and explain what its guest-facing test will prove.",
        "troubleshoot": "If a service is marked Enable, start in Features & messaging and Billing. If the guide opens a different stage, choose the numbered stage directly."
      },
      {
        "id": "org-create",
        "icon": "📅",
        "title": "Create your event",
        "img": "/media/help2-event-setup.png",
        "intro": "Create the event record that supplies names, dates, location and currency to other services.",
        "steps": [
          "Click New event. If a remembered guide stage opens, choose “1 Create event” to reach the creation form.",
          "Enter Event name. Choose Type; for a conference choose “Conference / seminar”. Review “Apply Conference / seminar suggestions” before using the suggested services.",
          "Enter Organizer / company name and Estimated guest count. Read the current pass limit beside the count before continuing.",
          "Enter Date and time in the event’s local timezone. Confirm Timezone rather than assuming the detected choice is right for the venue.",
          "For several days, select “Multi-day event” and enter the end date/time. Use a concrete start and end for each day’s sessions later.",
          "Enter Venue and Venue address. These are also used in public directions; preview the resulting map link.",
          "Choose Invitation / RSVP, Paid tickets, Tickets + invitations or Internal / private list. Select the event Currency explicitly.",
          "Review communication channels and the feature checkboxes. A checkbox selection is a setup request; confirm entitlement and activation later in Billing and Features & messaging.",
          "Leave “Advanced: custom app address” collapsed for normal hosted setup. Click “Create event & continue setup →” after the required fields are complete.",
          "Confirm the saved event in the header. Open Manage event for later edits and use Preview event to inspect public facts. Recheck dates and currency on the website, GuestHub, Results and ticketing before sharing."
        ],
        "path": "Event Setup → New event → Create event",
        "before": "Know your current guest cap and whether attendance uses invitations, tickets, both or a private list.",
        "check": "The new event appears in the event selector with the intended dates, venue and selected services.",
        "troubleshoot": "Compare the event timezone, start/end dates and currency across the website, GuestHub, Results and ticket storefront before sharing. Ticket settlement currency is configured separately; existing prices and orders retain their original currency."
      },
      {
        "id": "org-setup-guide",
        "icon": "📖",
        "title": "Follow the Setup Guide and record proof",
        "intro": "Use the guide as a checklist of service readiness and controlled tests.",
        "path": "Setup Guide → numbered stages",
        "before": "Select the correct existing event; do not create another event just to revisit setup.",
        "steps": [
          "Choose the relevant numbered stage. Read “Stage X of 8” and the applicable-task summary.",
          "Read “Next recommended action”. Check the card’s Current service checks, timestamp and any prerequisites before entering the workspace.",
          "Click the task’s workspace link and complete its configuration. Publishing, sending, charging and batch issuance are separate actions.",
          "When a workspace provides a Return to stage link, use it to keep your place. Otherwise reopen the guide and choose the stage.",
          "Click Refresh status after a saved change. Distinguish Checks complete from Ready for next check and Blocked.",
          "Run the actual controlled test named in the task: for RSVP, submit one response, confirm stored roles/answers, then open the pass and check delivery.",
          "Click Record test or review. Tick only the checks you performed. Enter a Test record / reference and describe Scope & remaining work.",
          "Choose Partial, Failed or Passed honestly. Passed is unavailable until the required checklist is complete. Save the record and verify the card’s updated status.",
          "Proceed with Next stage after resolving necessary tasks. Review Operations, Conference/Live and Closeout for the services you enabled."
        ],
        "check": "The task records a specific test and its limits, rather than a broad one-click approval.",
        "troubleshoot": "A legacy manual verification is not a current scoped test. Re-record the specific checks. Refresh status rather than treating an Active event as fully tested."
      },
      {
        "id": "org-enable",
        "icon": "📖",
        "title": "Enable a service or add-on",
        "intro": "Make a service available for this event and open the workspace that owns its content.",
        "path": "Features & messaging + Billing",
        "before": "Check the selected event, Event Pass and whether the service is included or requires a purchase.",
        "steps": [
          "Open Billing and review the current Event Pass, guest cap and Event add-ons. Included access and a feature being switched on are separate conditions.",
          "If a paid module is required, review its current price and hosted checkout before purchasing an Event Pass or add-on.",
          "For an included add-on, use Included · open setup in Billing to open its workspace. Entitlement does not switch the service on automatically: review Features & messaging and its settings before testing.",
          "Open its settings/workspace. The sidebar may show an Enable link while a service is off; use that link to reach activation.",
          "Create at least one useful record: for example, a table for Seating, a category/item for Orders, a shipment for Logistics or an activity for Festio Live.",
          "Check guest presentation rules. Some pages are public; some appear in GuestHub after registration, approval, check-in or attendance.",
          "Preview with an appropriate test guest and verify the new content appears. An enabled switch with an empty workspace is not a finished service.",
          "Return to the corresponding Setup Guide stage and record the controlled test."
        ],
        "check": "The service is entitled, enabled, configured and reachable by its intended audience.",
        "troubleshoot": "If setup is unavailable, confirm the selected event, entitlement and permissions. Review Billing and Features & messaging, then open the corresponding workspace."
      },
      {
        "id": "org-guests",
        "icon": "👥",
        "title": "Add your guest list",
        "img": "/media/help2-guests.png",
        "intro": "Create a named attendee with appropriate contact, access and role information.",
        "steps": [
          "Open Guests and click Add guest. Enter first name, last name, email and Phone (E.164) where applicable. E.164 uses +country code followed by the number.",
          "Choose Check-in access type. This controls admission entitlement; it is separate from the attendee’s relationship or party role.",
          "Tick VIP only when appropriate. Leave Send invite immediately off while testing the stored data first.",
          "Click Add and confirm the person appears once. Check the Ready QR status and their RSVP/admission state.",
          "Use the row’s “Actions for [name]” menu → Edit to inspect stored details. Set “Relationship / role” when a correction is needed.",
          "For a minor, select “This attendee is a junior / minor”. Confirm the underlying information first; a family relationship label alone should not be your only check.",
          "Review table, seat, VIP and contact opt-in fields before Save. The edit form also shows RSVP answers read-only.",
          "For households, use the Households section and guest-selection “Assign household” control. Household membership and guardian signing/pickup permission are separate settings.",
          "For a junior, check Experience → Consent → Choose adult. A correctly marked junior should not be offered as an adult signer. Configure guardian permissions separately with an authorized organizer.",
          "Open the guest’s GuestHub and My Party to confirm the saved category and personal pass relationship."
        ],
        "path": "Guests → Add guest / row actions → Edit",
        "before": "Prepare contact data you have permission to use, the access type and whether the attendee is a junior.",
        "check": "The saved category is displayed correctly and juniors are excluded from the adult guardian selector.",
        "troubleshoot": "After a party registration, inspect each stored relationship and junior flag. Correct a misclassified junior before assigning guardians or requesting signatures."
      },
      {
        "id": "org-import",
        "icon": "📖",
        "title": "Import a guest spreadsheet safely",
        "intro": "Preview and map a file before writing guest records.",
        "path": "Guests → Import guests",
        "before": "Use the downloadable template where possible. Prepare one person per row; keep phones as text with country codes.",
        "steps": [
          "Click Import guests, then Download template if you need the expected columns.",
          "Choose File and select a CSV/XLSX or Google Sheets export. Start with a small controlled file to learn the mapping.",
          "Click Preview columns. No guests have been saved at this point.",
          "For each file header, review “Map [column]”. Choose the intended field or Ignore column. First/last name, email, phone, RSVP type/relationship, junior flag, ticket type, tags, table group and shipping fields are exposed.",
          "Read the sample-row table. Confirm values are in the right fields, not merely that a header was recognized.",
          "Read the row count and Ignored columns summary. Validate mapping after any corrections.",
          "Review Validation counts for new and skipped / existing records. Inspect the sample rows and duplicate matches before importing.",
          "Use Back to correct the file or mapping. Click Import validated rows only when the preview is correct; this is the write step.",
          "After import, review warnings/errors, find the added guests and use Check duplicates. Open one guest record to inspect role, contact and access.",
          "For a link import or Live spreadsheet sync, use Event Setup’s matching source option. Verify its permissions, preview and sync state; never assume a pasted link is a permanent connection."
        ],
        "check": "The mapping is editable, sample rows are visible and validation completes before Import validated rows.",
        "troubleshoot": "A skipped existing row is not a failed new import. Review mapping and duplicate rules before retrying; avoid importing the same file repeatedly."
      },
      {
        "id": "org-rsvp",
        "icon": "✉️",
        "title": "Set up your RSVP & invite page",
        "img": "/media/help2-invites-rsvp.png",
        "intro": "Collect confirmations, contact information and useful answers before issuing guest passes.",
        "steps": [
          "Open Invites & RSVP and choose With RSVP. Read the public link controls; Copy shares the live form, while Preview is for inspection.",
          "Confirm Open for registrations, approval policy and whether the time is announced. Enter the RSVP deadline and capacity if needed.",
          "Write a clear welcome/message: who may register, what is included, how to add family, and what happens next.",
          "Choose whether the same email may make multiple RSVPs. For a household event, avoid treating a shared email as proof that attendees are duplicates.",
          "Set primary email/phone requirements and additional-attendee fields. Use optional contact rules deliberately for juniors.",
          "Create custom questions with Add question. Use a field type suited to the answer; mark only essential questions required. Example: dietary restrictions as a short answer.",
          "Click Save invitation settings. Review display toggles such as countdown, capacity, sharing, calendar and confetti separately; save display settings.",
          "Choose the RSVP landing and GuestHub layout that suit the event. Inspect the form on a guest-sized view and the chosen GuestHub presentation.",
          "Submit one controlled RSVP, inspect its stored answers/role, and open the generated GuestHub/pass. Test approval separately if it is enabled.",
          "Only then send the form link broadly. Record the scoped test in the Setup Guide."
        ],
        "path": "Invites & RSVP → With RSVP",
        "before": "Decide who may register, whether approval is needed, the deadline/capacity and the questions you truly need.",
        "check": "The public form accepts intended data, stores the answers and routes the test guest to the right next step.",
        "troubleshoot": "Previewing styling does not test registration. A browser already recognized as a guest may go directly to GuestHub; repeat the new-registration test in a separate clean guest session."
      },
      {
        "id": "org-categories",
        "icon": "🗂️",
        "title": "Invitation categories & auto-seating",
        "intro": "Let a registrant add the right people while preserving each attendee’s identity and eligibility.",
        "steps": [
          "Enable multi-invitee registration and set the maximum additional guests. The test event used a limit of four.",
          "Review Guest types and create categories such as Child and Spouse. Inspect the resulting guest dropdown after any change; do not assume adding categories preserves every default.",
          "For Child, enable Skip contact only when the responsible adult can be reached and this is appropriate for the event.",
          "Add relevant Age groups and Category rules/table mapping through their controls. Keep a relationship label separate from an admission access type.",
          "Save multi-invitee settings, then preview a party registration with one adult and one child.",
          "At review, confirm all attendee names, categories and question answers before submitting. Correct omissions before treating the form as ready.",
          "Inspect the stored guest records afterward. Use Edit to confirm Relationship / role and the junior flag.",
          "Create/assign a household if the party should arrive or leave together. Configure authorized guardian signing/pickup permissions independently.",
          "Open My Party and each authorized personal pass. A child needs their own attendee record and QR; sharing an adult’s code is not the party workflow.",
          "Review FestioMe’s Who can join policy before allowing junior community participation."
        ],
        "path": "Invites & RSVP → multi-invitee settings",
        "before": "List allowed categories, extra-guest limit, junior contact rules and any age-group or table mapping.",
        "check": "Each person has the right role, junior status and own pass; guardian choices exclude juniors.",
        "troubleshoot": "Inspect every person’s saved role and junior status after registration. If a junior appears in Choose adult, correct the guest record before assigning a guardian."
      },
      {
        "id": "org-ticketing",
        "icon": "🎫",
        "title": "Ticket sales",
        "img": "/media/help2-ticketing.png",
        "intro": "Prepare a storefront, ticket inventory and delivery without confusing admission with a payment-only item.",
        "steps": [
          "Choose the event under Managing event. Read the payment mode after configuration loads. Test mode means no live charges; Live credentials configured describes the configured provider, not a completed payment or verified payout.",
          "For paid products, connect the organizer’s approved payout account with Paystack or Stripe and follow provider verification. Do not enter financial credentials as part of a training exercise.",
          "Review Festio service share and “How should the fee be handled?”. Confirm tax settings when applicable, then save the relevant choice.",
          "In Add tickets, choose Type: Ticket grants admission; Donation / sponsorship is payment-only and grants no pass; External registration sends buyers elsewhere.",
          "Enter Ticket name, Price, Quantity available, Admission access and Description. Compare the currency beside Price with the event currency. Existing ticket catalogs retain their settlement currency; a mismatch must be understood before adding inventory. Before any products exist, use Ticket settlement currency and Save currency and provider to choose USD/Stripe or NGN/Paystack.",
          "Review the catalog’s quantity/sold counts. Hide removes a type from sale; leave test inventory clearly identified.",
          "For a complimentary pass, choose Ticket type, quantity, recipient first/last name, delivery email and reason, then Issue complimentary pass. For multiple passes, provide individual attendees as requested.",
          "Customize Delivery message studio separately from RSVP templates. Enable intended channels; set Subject line, Introduction and Text displayed under every QR code. The secure QR block is inserted automatically.",
          "Use Copy link / Copy embed in Publish & share. Open the hosted page and check availability, questions, review and zero-price/paid behavior.",
          "Inspect Complete order ledger and Download CSV report. Reconcile complimentary versus paid orders, fulfilled passes and delivery states before using the figures for finance."
        ],
        "path": "Ticket sales → 01 Availability through 06 Live sales report",
        "before": "Confirm event and ticket settlement currencies, payment mode, provider credentials, fee policy and paid-product payout readiness. Free-only tickets do not require a paid payout account.",
        "check": "The storefront displays the intended catalog and a valid pass is issued to the named complimentary attendee.",
        "troubleshoot": "A currency warning identifies an existing catalog using a different settlement currency. Existing prices cannot safely be relabeled or converted. Before products exist, save the correct currency/provider in Ticket settlement currency. After products exist, contact support to plan a new event catalog or a reviewed migration; existing prices and orders retain their original currency. If the provider is not configured, resolve credentials before paid checkout. Confirm final order, fulfillment and provider settlement separately."
      },
      {
        "id": "org-promo",
        "icon": "📖",
        "title": "Add promo codes and checkout questions",
        "intro": "Collect extra order information and create a bounded discount.",
        "path": "Ticket sales → Customer, payment & automation tasks",
        "before": "Decide the code, percent/fixed amount, usage limit and exact checkout questions.",
        "steps": [
          "Find Create promo code in Customer, payment & automation tasks.",
          "Enter the CODE, choose Percent or Fixed amount, and enter its value and allowed usage count.",
          "For Percent, enter a whole percentage from 1 to 100, such as 10. Review the discounted total before saving.",
          "Click Create code only after checking its intended financial effect. Validate its effect on the storefront’s review total before using it publicly.",
          "Under Checkout form builder, click Add field. Enter Field label, choose Short text, Long text, Dropdown, Checkbox or Date, and select Required only if necessary.",
          "Use Step name to group fields into a named page. Fields with the same step share a page; blank step stays on the first page.",
          "For choices, supply the offered options when the selected field type requests them. Preview Next/Back navigation with a guest.",
          "Click Publish form and confirm the field appears during checkout. Verify that the submitted answer is visible in the order’s relevant record.",
          "Keep free-checkout testing separate from paid payment tests; do not charge simply to check a question or discount label."
        ],
        "check": "The code applies the intended discount and published checkout questions appear in the correct step.",
        "troubleshoot": "Check the discount’s final total and currency in checkout before payment. Percent discounts use whole percentages from 1 to 100."
      },
      {
        "id": "org-send",
        "icon": "📤",
        "title": "Send invitations",
        "img": "/media/help2-invites-rsvp.png",
        "intro": "Send a deliberate, costed invitation batch through the configured channels.",
        "steps": [
          "Open Guests. Filter or search for the intended audience and inspect RSVP/Invited/Delivery states.",
          "Select individual named checkboxes. Check the selected count before Send invite; a filtered page is not automatically the intended full audience.",
          "Click Send invite to open “Review audience before sending”. This is the review step, not Send now.",
          "Read eligible counts for email, SMS, WhatsApp and MMS. Check unreachable/blocked recipients and Estimated credits versus the available organization balance.",
          "Compare the review with your intended channel policy. All checked can send on several channels; First available chooses according to configured routing.",
          "For the first test, use one controlled recipient. Read provider readiness and consent exclusions; a phone number alone is not permission to message.",
          "Use Schedule instead for a timed invitation, or Cancel to correct contacts, audience or routing. Use Send now only when the preflight is right.",
          "After sending, inspect the recipient’s channel delivery state and credit ledger. Ask the controlled recipient to confirm the actual email/SMS/WhatsApp and open the pass.",
          "Record exact recipients, channel and received message in the Setup Guide; an accepted send is not proof of inbox delivery."
        ],
        "path": "Guests → select guests → Send invite",
        "before": "Guest contacts, permissions, a saved invitation template, channel readiness and sufficient credits.",
        "check": "Preflight shows the audience, channels, exclusions, cost and wallet balance; a controlled test receipt confirms the intended message and link.",
        "troubleshoot": "Use the current preflight rate and wallet estimate for the chosen channels. Resolve any disagreement between Billing and preflight before a large send."
      },
      {
        "id": "org-broadcast",
        "icon": "📣",
        "title": "Broadcast an update",
        "img": "/media/help2-invites-rsvp.png",
        "intro": "Send an event-wide update or control reusable message wording.",
        "steps": [
          "Open Broadcasts & templates. Choose the message type: General, Thank you, Feedback or an Experience-stage message.",
          "Choose Test one guest for the first check. Select the test guest or direct contact; confirm the intended recipient.",
          "Write the body in plain language with one clear action and an event-specific destination. Review audience filters and ticket-type selection when using audience mode.",
          "Choose enabled channels only. Check Email/SMS/WhatsApp against Features & messaging; an unchecked or unavailable provider must not be assumed ready.",
          "Review who is reachable, routing and credit use before sending. Inspect the sent message on the receiving device.",
          "For a reusable message, find the appropriate template and choose Edit. Preserve required merge fields and the personal pass/link.",
          "Use Preview to check the wording. Use Test send to a controlled guest to check actual merge values and delivery.",
          "Save the edited template and reopen it to verify persistence. Reset returns to defaults; review carefully before using it.",
          "WhatsApp approval is a separate provider/paid workflow where offered. Do not assume saving template wording makes it approved or funded."
        ],
        "path": "Broadcasts & templates",
        "before": "Decide purpose, audience, available channel, test recipient and whether this is a one-time message or a template.",
        "check": "The message has the right audience, correct links and event-specific merge values in an actual test receipt.",
        "troubleshoot": "Ticket delivery templates live in Ticket sales → Delivery message studio, separately from RSVP/broadcast templates."
      },
      {
        "id": "org-schedule",
        "icon": "📖",
        "title": "Schedule a message or reminder",
        "intro": "Prepare communications for an exact time or a time relative to the event.",
        "path": "Scheduled messages → New scheduled message; Reminders",
        "before": "Have the audience definition, event timezone, channel and planned send time ready.",
        "steps": [
          "Open Scheduled messages and click New scheduled message.",
          "Choose Purpose: invitation, RSVP, consent, event/session, feedback, thank you or scheduled announcement. Enter a clear Internal name.",
          "Choose Audience and Recipient mode. Dynamic resolves eligible recipients when the job runs; Frozen preserves the selected recipient set.",
          "Choose Timing: a Specific date or Relative to event. Confirm the visible event timezone and enter a local time.",
          "Choose the supported channels and message/template content requested by the form. Confirm credits and provider readiness.",
          "Use Save as draft to prepare without scheduling. Review the saved draft, then use Schedule communication only when it should run.",
          "For the separate legacy Reminders workspace, choose New reminder, event offset, local time, channel and RSVP audience, then save.",
          "Reopen the reminder and compare its saved time with the list and the event timezone before relying on delivery.",
          "Before launch, check recipient mode, deadline, timezone and whether a reminder should exclude people who have already responded.",
          "After its scheduled time, review job/delivery status and receipt with a controlled guest. A scheduled row is not proof of a successful send."
        ],
        "check": "A saved draft/scheduled job shows the intended purpose, audience and event-local time.",
        "troubleshoot": "Scheduled messages and Reminders overlap. Prefer the current scheduler for clearly scoped jobs, and inspect existing reminder times before using them."
      },
      {
        "id": "org-guest-communication",
        "icon": "💌",
        "title": "Guest Communication: replies & direct messages",
        "steps": [
          "Open Guest inbox. Under New announcement, enter a Title and Message.",
          "Choose Audience: All guests, Confirmed guests, Declined only, Checked in or Not checked in.",
          "Write one specific update, avoiding unnecessary private information in a shared feed. Example: the room for a workshop.",
          "Click Send announcement and confirm it appears under Past announcements. Review its reported reach and intended audience.",
          "Open a test guest’s Inbox → Updates. Use Refresh updates if needed; the refreshed guest UI also explains automatic online updates.",
          "For a private conversation, select the guest thread in the organizer inbox. Read its history before composing a reply.",
          "Reply to the individual using the thread’s supported controls, then verify the guest sees the reply in Messages.",
          "Use Chat moderation for visible guest chat, and FestioMe Moderation for community reports; they are different scopes.",
          "Use the organizer Refresh control when investigating freshness. Record whether the result appeared automatically or only after manual refresh."
        ],
        "intro": "Keep organizer announcements and guest conversations accessible inside the event.",
        "path": "Guest inbox → Announcements / Guest inbox & chat moderation",
        "before": "FestioHub, Event updates and Message host settings must match your communication plan.",
        "check": "The saved announcement appears in the guest Updates view and a private reply reaches only the intended conversation.",
        "troubleshoot": "GuestHub reach does not prove external email delivery. Open a guest view to confirm the announcement content and refresh behavior."
      },
      {
        "id": "org-design-studio",
        "icon": "🎨",
        "title": "Design Studio: brand your invite, pass & Guest Hub",
        "badge": "Paid",
        "img": "/media/help2-design-studio.png",
        "intro": "Give connected guest surfaces a consistent visual identity.",
        "steps": [
          "Open Design Studio for the selected event. Start with 1 Theme and choose a palette/type pairing such as Modern, Formal or Celebration.",
          "If you want to preserve existing settings, review “Keep my colours and typography” before applying a theme.",
          "Use 2 Layout to choose the presentation. Compare it with the needs of the event rather than selecting on appearance alone.",
          "Open 3 Customize. Upload cover and logo as JPG/PNG/WebP up to 5 MB; a transparent PNG is suitable for a logo.",
          "Set primary, accent, background, surface and text colours and Typography. Check contrast and readable text over your cover.",
          "Enter Event display title and Welcome message. Review RSVP presentation checkboxes for hero title, host, About, venue and admission note.",
          "Use preview surfaces RSVP, GuestHub, My Pass, Flyer and Email. Switch Desktop and Phone and inspect each one.",
          "Specialist tools expose Flyer, Festio Pass, Certificates, Event Page and FestioHub functions. Use these for their specific settings rather than assuming the shared preview changes all message wording.",
          "Open 4 Review & publish. Compare draft/published version and review every affected surface. “All changes saved” describes a saved draft.",
          "Click Publish new version only after review, then inspect an actual guest link. Email preview is illustrative; delivered wording belongs to message templates."
        ],
        "path": "Design Studio → Theme → Layout → Customize → Review & publish",
        "before": "Prepare licensed cover/logo images and event wording; check design entitlement.",
        "check": "The published design appears on the real RSVP, GuestHub and pass without changing guest permissions.",
        "troubleshoot": "Website publication is separate. A published Design Studio version does not automatically publish an edited Event website draft."
      },
      {
        "id": "org-website",
        "icon": "📖",
        "title": "Create and publish the event website",
        "intro": "Build a public event landing page with accurate facts, programme highlights and guest destinations.",
        "path": "Design Studio → Event website ↗",
        "before": "Save the canonical event facts, sessions, speakers and registration link first.",
        "steps": [
          "Click Event website ↗. Review the Live/version badge and the notice explaining which version visitors see.",
          "In Identity, set Website address, Short introduction, Website headline and Summary. Confirm the event facts and date consistency check.",
          "Use Design, Header & footer and Style & media to set visual presentation, navigation, cover/logo and footer copy as exposed by the selected design.",
          "In Programme, import the canonical sessions. Use Refresh programme from source to review changes rather than assuming an automatic live update.",
          "Review source differences for date/time, description, room and speakers. Select only intended changes; preserve deliberate website edits. Apply selected changes to draft.",
          "In Speakers, import/review the event’s speaker records and confirm biographies and images are fit for public display.",
          "In Content sections, enter the event story, registration facts, venue/travel details, feature sections and FAQs. Fully complete a question and answer before saving.",
          "In Connections, verify RSVP, Festio Live, FestioMe and My GuestHub destinations. Check primary/secondary action labels and contact email.",
          "Click Save draft. Open saved preview and inspect Desktop, Tablet and Mobile. Expand a session and confirm start/end, room, speaker and timezone.",
          "Click Publish website. Open View live website in a guest context and test every navigation/action link. Review History for previous versions; Unpublish removes the live site. Check that Speakers opens inside the website, including when the published page uses the speaker directory without imported cards."
        ],
        "check": "The public site shows the intended published version, useful session facts and guest-facing links.",
        "troubleshoot": "Programme/speaker imports are editable snapshots. Reopen source review after source changes and republish. Full programme access is explicitly registration-gated; the website contains selected highlights."
      },
      {
        "id": "org-seating",
        "icon": "🍽️",
        "title": "Seating: tables and guest assignments",
        "badge": "Paid",
        "imgs": [
          "/media/help2-menu-fields.png",
          "/media/help2-orders.png"
        ],
        "intro": "Give guests useful table and seat assignments and keep parties together.",
        "steps": [
          "Enable Seating, then open its workspace. Create relevant Table groups/sections before bulk assignment.",
          "Click Table. Enter Table name, Category, Capacity and Table order; click Create.",
          "Repeat for each physical table. Use recognizable names that match signage; a group is a section, not a table.",
          "Check total table capacity against confirmed attendance and desired spare seats.",
          "Assign a guest manually through their Edit form’s Table and Seat fields, or use selected-guest “Assign table group” for section placement.",
          "Use Auto assign after reviewing group rules and party pairing. Inspect household/couple placement and guests left unassigned.",
          "Treat Reassign all as a broad change: review its scope and preserve deliberate seat placements before using it.",
          "Open the seating chart/table assignment view. Check for oversubscribed tables, duplicate seats and gaps.",
          "Open the guest’s pass/GuestHub to verify the assignment is understandable. Staff signage and printed reference should use the same table labels."
        ],
        "path": "Seating → Table / Table groups / Auto assign",
        "before": "Know room capacity, table sizes, table groups and whether you need automatic party pairing.",
        "check": "Tables have sufficient capacity and the intended guests see the correct assignments.",
        "troubleshoot": "Section scanning depends on groups and cannot run alongside Venue Access. Decide the scanning model before assigning staff entrances."
      },
      {
        "id": "org-floorplan",
        "icon": "📖",
        "title": "Arrange a floor layout",
        "intro": "Show where tables and room elements are physically located.",
        "path": "Seating → Floor layout",
        "before": "Create tables first and have a simple venue plan to copy.",
        "steps": [
          "Open Floor layout from Seating. Use the available layout controls for the event’s room.",
          "Place the created tables in positions that match the actual venue. Keep table labels legible and distinct.",
          "Add supported room elements through the visible controls; do not treat a drawing as a capacity or access rule.",
          "Arrange entrances, circulation space and stage/room landmarks so staff can orient guests.",
          "Save the layout through the editor’s save control. Reopen it and confirm placements persisted.",
          "Use the exposed chart/share controls only for the intended audience. Inspect any shared read-only view before distributing it.",
          "Compare the layout with the table assignment list and guest table names. Keep a simple on-site reference available for staff."
        ],
        "check": "The saved layout and table assignment list describe the same room.",
        "troubleshoot": "Save the layout, reopen it and compare its tables and capacity with the seating assignment list before using it on event day."
      },
      {
        "id": "org-meals",
        "icon": "📖",
        "title": "Create meal categories and choices",
        "intro": "Collect meal preferences and feed a clear fulfillment process.",
        "path": "Meals & orders → Configure menu and choices",
        "before": "Decide categories, available dishes, selection rules and when guests may choose.",
        "steps": [
          "Enable Orders and open Meals & orders. Use Configure menu and choices to reach menu settings.",
          "Create a Category. Enter Category name, guest visibility and selection mode: Single, Multiple or Combination.",
          "Save the category, then add its items with the item control. Enter the dish/item name and the offered fields; provide a clear description or dietary note when available.",
          "Repeat for each selectable dish. Hide categories that are for staff only; inspect what the guest will actually see.",
          "In Kitchen Display, review “When can guests choose meals?”. Choose After event check-in or Before arrival, after registration confirmation.",
          "Preview with a confirmed guest. Make one controlled choice and verify it is recorded for that attendee.",
          "Before service, compare selections with attendee counts. People awaiting a choice are different from actual kitchen orders.",
          "Open Order queue, Prep tally and By table during service. Filter a table or Pending/Served/All as appropriate.",
          "Mark served only after fulfillment and check-in as required. Served selections remain locked; verify the guest cannot accidentally order again.",
          "Use the per-table/item totals for the caterer, while Results provides the broader event snapshot."
        ],
        "check": "Kitchen Pending counts guests with unserved meal selections, not every registered guest. Verify pending filters, category service states and the preparation tally agree; guests without meal choices should not inflate pending orders.",
        "troubleshoot": "If Pending and the queue disagree, confirm the selected meal category, actual saved choices and served status. Guests without choices should not count as actionable pending orders."
      },
      {
        "id": "org-logistics",
        "icon": "📦",
        "title": "Deliveries: ship merch, aso-ebi & gifts",
        "badge": "Paid",
        "img": "/media/help2-deliveries.png",
        "steps": [
          "Enable Logistics and open Deliveries. Click New shipment.",
          "Enter Name and choose Phase (pre-event or post-event). Add vendor and vendor contact details if relevant.",
          "Choose Collect size at RSVP only if variants are needed; enter the offered comma-separated sizes/variants.",
          "Read “Automatically add future confirmations”. It applies to guests confirming after this setup; it is not an existing-audience backfill.",
          "Enter Notes and Save shipment. Open the saved shipment’s management view.",
          "Use Add all confirmed when existing confirmed attendees should be included. Inspect recipients before proceeding.",
          "Add shipment items with name, quantity and size/variant where offered. Check every recipient’s address and missing-data warnings.",
          "Open the packing-list/share view. Confirm it contains only the shipment data intended for that vendor; obtain approval before exposing real guest addresses.",
          "Update packed/shipped status as work happens and reconcile totals against recipients/items.",
          "Use separate shipments for different phases so pre-event merchandise and post-event gifts do not share an ambiguous status."
        ],
        "intro": "Track merchandise/gift fulfillment per guest with a vendor-friendly packing list.",
        "path": "Deliveries → New shipment",
        "before": "Prepare shipment items, variants, vendor details and eligible guest addresses.",
        "check": "The shipment has the intended recipients, items and fulfillment status; future-only inclusion is clearly labeled.",
        "troubleshoot": "If recipients are zero, inspect whether confirmations already existed. Use Add all confirmed and resolve missing addresses before sharing with a vendor."
      },
      {
        "id": "org-registry",
        "icon": "🎁",
        "title": "Gift list",
        "badge": "Paid",
        "img": "/media/help2-gift-list.png",
        "steps": [
          "Enable Registry and open Gift list. Enter and save the guest-facing introduction.",
          "Use Add item for a physical wish, Add link for an external item, or inspect Add cash fund for the currently offered funding workflow.",
          "For an item, choose Type, enter Title and Description, Purchase URL, Quantity, Estimated price and Image where offered.",
          "Use Fetch details for an external purchase URL, then review the returned text/image/price rather than accepting it blindly.",
          "Save the item and repeat for the list. Check quantity and whether a guest can understand what they are claiming.",
          "Open Preview Registry. Test a synthetic claim and verify its status in the organizer list before sharing.",
          "Share the public registry link through the event website/invitation or the exposed Send guests controls after reviewing recipients.",
          "Keep gift coordination separate from a payment. Registry copy says no payments move through the platform; a separate Giving/Donation Tracker can have payment-method configuration.",
          "Review claims and avoid interpreting an estimated price or pledged gift as money received."
        ],
        "intro": "Coordinate claimed gifts and external purchase links.",
        "path": "Gift list → Add item / Add cash fund / Add link",
        "before": "Prepare item descriptions, quantities and links; decide whether you need a registry or a giving campaign.",
        "check": "Guests see the saved introduction/items and the organizer can distinguish unclaimed versus claimed wishes.",
        "troubleshoot": "Cash-fund controls can lead to Donation Tracker. Read the destination and ledger semantics before promising payment processing."
      },
      {
        "id": "org-access",
        "icon": "🎫",
        "title": "Entry areas & ticket rules",
        "badge": "Paid",
        "img": "/media/help2-entry-areas.png",
        "intro": "Control entry by venue area, access type, tags and scan direction.",
        "steps": [
          "Enable Venue Access and open its workspace. Click Add zone.",
          "Enter Name, Capacity, Description and Direction (In & out, In only or Out only). Create the zone.",
          "Create the required Ticket types/access types and choose which zones each permits. Review unrestricted/empty-rule behavior before use.",
          "Assign access types to guests in their Edit form or through a mapped import. “VIP” or a party relationship is not automatically the admission rule.",
          "Under Rules, use Add tag for finer classifications. Build the zone/tag requirements explicitly; the UI says empty tag rules admit everyone.",
          "Create a Gate with name, zone and direction so a scanning station has one recognizable assignment.",
          "Open Assign and review who has each access type. Verify a guest who should be allowed and one who should be denied.",
          "Test entry and exit at the configured zone. Check occupancy and the guest’s recorded journey in Analytics.",
          "For juniors, inspect Junior operations and guardian pickup/check-out rules separately. Only an authorized organizer should assign real guardian rights.",
          "Give staff a gate-based instruction and test it on the actual scanning device before opening the doors."
        ],
        "path": "Venue Access → zones / Ticket types / Rules",
        "before": "Map real entrances and room capacities. Choose Venue Access or section scanning, not both.",
        "check": "The intended pass is admitted only in permitted zones/directions and occupancy changes correctly.",
        "troubleshoot": "If Venue Access is on but no zone/access type exists, the scanner cannot complete its job. Set these prerequisites first; do not work around a denial by widening access indiscriminately."
      },
      {
        "id": "org-checkin",
        "icon": "🎟️",
        "title": "Check-in day",
        "img": "/media/help2-checkin.png",
        "steps": [
          "In Event Setup, confirm the event is Active. Review Check-in setup and the pass/scanning entitlement.",
          "Open Check-in. Choose Convention check-in or Checkout and select the relevant zone/gate and direction.",
          "For a controlled desktop test, use Manual search or enter a pass token and Record scan where exposed. Use only the intended test guest.",
          "On the actual door device, select the correct gate/zone, allow the camera when authorized and use Start camera.",
          "Scan the guest’s own QR fully within frame. Read the result and the displayed reason; distinguish successful entry, duplicate scan and denied access.",
          "Check the guest profile/Results and zone occupancy after the scan. A checkout should update the corresponding departure/on-site count.",
          "For offline preparation, use Prepare this scanner. Check manifest count and expiry; the captured UI specified a 30-minute manifest.",
          "Offline QR/manual processing has limits: guardian checkout and some daily rules require a connection; duplicate protection may be device-local. Reconnect and confirm synchronization.",
          "For Self check-in, open its Event Setup section, review the switch and Copy/Download QR. Guests scan the event QR to find their own record; this is different from scanning a personal pass.",
          "After the event, review records and use the approved event lifecycle action to End it. Do not archive/delete while unresolved records are still needed."
        ],
        "intro": "Admit guests with their own QR and retain an understandable arrival record.",
        "path": "Check-in / Event Setup → Self check-in",
        "before": "Event Active, scanning entitlement, staff assignment, access rules and a test pass.",
        "check": "One controlled scan updates the right guest and zone; staff know how to recognize duplicate/denied results.",
        "troubleshoot": "Test camera permissions and offline behavior on the actual staff devices before event day. Check that a denied or duplicate scan has not changed admission status."
      },
      {
        "id": "org-experience",
        "icon": "🧭",
        "title": "Experience workflows: consent, souvenirs, rooms & sessions",
        "badge": "Paid",
        "img": "/media/help2-org-experience.png",
        "intro": "Define the operational steps an attendee moves through.",
        "steps": [
          "Enable Experience and open the workspace. In Setup, choose a suitable template: VIP dinner, Conference, Wedding reception or Simple check-in.",
          "A template creates a new draft. Select that workflow and give it a recognizable name/version.",
          "Open Workflow and inspect each step: check-in, badge, consent, table, meal, souvenir, session, feedback or departure as offered.",
          "Configure per-step conditions such as ticket types and required dependencies. These conditions belong to the step, not a single workflow audience.",
          "Place steps in the real event sequence. Do not let a consent-dependent handoff precede the time when that consent can be completed.",
          "For sessions, enter guest-facing title/description, start/end, room, speaker and attendance rules; see the sessions chapter.",
          "Preview progress with a test guest and confirm which actions are available to the guest versus staff.",
          "Publish the reviewed draft. Only one workflow should be live for the event. Published steps are read-only; Clone to prepare changes.",
          "When publishing a replacement, review the current live/draft versions and synchronized sessions before completing the switch.",
          "Use Guests, Feedback, Analytics and Export progress to inspect completion and remaining steps. Configure Messages/Inbound Automations only for the triggers your team actually needs."
        ],
        "path": "Experience → Setup → template / Workflow",
        "before": "List the required journey and its order; decide which steps are automatic, staff-confirmed or guest-completed.",
        "check": "The live journey’s steps are ordered, targeted and reachable by the intended guest/staff roles.",
        "troubleshoot": "Publish and synchronize the reviewed workflow before linking sessions to activities, materials or certificates. Operational selectors use published sessions; draft copies prepare future versions."
      },
      {
        "id": "org-sessions",
        "icon": "📖",
        "title": "Create multi-day sessions and sync programme",
        "intro": "Give attendees a reliable timetable with useful session facts.",
        "path": "Experience → Workflow session step; Planner → Runsheet",
        "before": "Event timezone/dates, session duration, room, speaker and attendance/access requirements.",
        "steps": [
          "Use Experience’s draft workflow and add/configure the Session attendance/programme step available in Workflow.",
          "Enter the session title and a guest-facing description. Workflow instructions such as “Track attendance” should not become a public session summary.",
          "Set the concrete date/start/end or duration requested by the session editor. Confirm the event timezone and any segment start/offset fields.",
          "Enter Room/location and associate the intended speaker when offered. Add attendance/access conditions deliberately.",
          "For each day, create distinct sessions with the correct calendar date. Do not use a day-two time with a day-one date.",
          "Publish the reviewed workflow and enable Live Program mode. Use Sync program now, then inspect the synchronized session count.",
          "Open the GuestHub Programme. Check the date tabs, start/end time range, room, speaker and eligibility for each published session.",
          "Use Planner Runsheet for production cues, owners, breaks and dependencies; it is a separate operational view.",
          "For the website, refresh programme from source, review selected differences, apply to draft and republish. Website highlights do not replace the full GuestHub programme.",
          "Attach Live activities, materials and certificate rules to a published session. Operational selectors use published sessions; a draft copy is preparation for a future version. Publish and synchronize the reviewed workflow before choosing its session."
        ],
        "check": "GuestHub and the published website show useful current session facts; the production runsheet uses the same local dates.",
        "troubleshoot": "Resolve schedule/offset errors using the visible editor fields. Compare each day’s local dates, start/end times, room and speaker across GuestHub, website and runsheet."
      },
      {
        "id": "org-forms",
        "icon": "📖",
        "title": "Create forms and consent versions",
        "intro": "Collect independent event, meal or activity forms with explicit timing and signer rules.",
        "path": "Experience → Consent → Forms & consent",
        "before": "Prepare reviewed wording, audience, required questions and who is authorized to sign.",
        "steps": [
          "Open Consent and click New blank form or choose a draft template such as Food and dietary information or Junior Platform participation consent.",
          "Enter Form title and wording. Choose the offered type: typed-signature consent or information acknowledgement.",
          "Set Available timing: before arrival or after check-in as needed. Review which audience can access it: everyone, adults or juniors.",
          "Set Who signs. A guardian-only form is different from a self-signing adult form; verify authorization separately.",
          "Add the relevant age groups, tags, ticket types and required zone/session gating where exposed.",
          "Add questions using Text, Textarea, Select or Checkbox. Supply options for choice fields and select Required only where essential.",
          "Click Save draft version. Reopen the draft, preview the actual guest wording and verify the target guest can reach it.",
          "Publish the version when approved. Guests see only a published version; keep previous completion records intact.",
          "Use Parent / legal guardian signing permissions to associate an eligible adult when authorized. A correctly marked junior is excluded from Choose adult.",
          "Review Completion records and export CSV/PDF through the offered controls. Compare attendee, form version, signer and source. Do not sign a real waiver as a test."
        ],
        "check": "The correct published form reaches the intended person at the intended time and completed records identify the version/source.",
        "troubleshoot": "Use the form’s actual Available timing and Who signs settings. Before-arrival and after-check-in forms have different access requirements."
      },
      {
        "id": "org-feedback",
        "icon": "📖",
        "title": "Collect event feedback",
        "intro": "Choose the feedback collection that matches an event journey or a live audience activity.",
        "path": "Experience → Feedback; Festio Live → Feedback activity",
        "before": "Define a small useful question set and the moment guests should receive it.",
        "steps": [
          "For journey feedback, open Experience → Feedback. Inspect the configured questions and the required fields.",
          "Use Edit step for question/rule changes in a draft workflow, or Clone a live workflow before editing.",
          "Use Preview guest to inspect the complete form. Test required ratings, recommendation/NPS and optional open text.",
          "Prepare feedback draft before sending. Select the intended audience and delivery timing, then review Send feedback.",
          "Complete one controlled guest response and inspect its stored record under Feedback.",
          "Use filters, Export results and Remind nonresponders where offered. Keep response rate and question score denominators distinct.",
          "For live feedback, create a Feedback activity in Festio Live and add suitable questions; follow the Live preparation/run chapters.",
          "Check the actual completion wording in a guest view. It should refer to your event or the organizing team.",
          "Close the test activity after inspection and retain the response records for reporting."
        ],
        "check": "A test response is retained and the completion copy matches the event or is safely neutral.",
        "troubleshoot": "Check the question label, target audience and completion wording in a controlled guest response before opening feedback to all attendees."
      },
      {
        "id": "org-speakers",
        "icon": "📖",
        "title": "Create a speaker showcase",
        "intro": "Publish useful speaker profiles and connect them to programme highlights.",
        "path": "Speakers → Add speaker",
        "before": "Have permission to publish a biography, headshot and professional links.",
        "steps": [
          "Enable Speakers and open the showcase workspace. Click Add speaker.",
          "Enter the speaker’s name, presentation/title and biography through the form. Add the offered photograph and professional/social links.",
          "Use accurate public copy rather than staff-only release or logistics notes.",
          "Save and reopen the profile. Repeat for each speaker; use Edit for later corrections.",
          "Choose whether the speaker page is visible before RSVP. Review this setting against the event’s public-registration plan.",
          "Use Preview page to inspect the public showcase and each profile/link.",
          "Associate the canonical speaker with the intended session through Experience/conference tools where offered.",
          "Import/refresh speakers in Event website and publish the website version separately. GuestHub’s Speakers button opens its internal screen. Website Speakers navigation stays in the Meet the speakers section; View all speakers expands the lineup inside the website. Use the GuestHub return control to get back to your event services."
        ],
        "check": "The public profile and linked programme use the right name/photo/biography and publication audience.",
        "troubleshoot": "Changing the speaker source does not prove the website’s imported snapshot changed. Review the website speaker import and publish again."
      },
      {
        "id": "org-partners",
        "icon": "📖",
        "title": "Create partner and sponsor listings",
        "intro": "Show sponsors and partners in clearly named tiers or categories.",
        "path": "Partners → categories → Add partner",
        "before": "Prepare approved partner names, description, logo and website URL.",
        "steps": [
          "Enable Partners and open the workspace. Create categories that reflect your event, such as Community Partner or Supporting Sponsor.",
          "Click Add partner. Enter Name and choose Category.",
          "Enter Description with the partner’s role in the event; avoid claiming a sponsorship commitment before it exists.",
          "Upload a logo or use the offered Logo URL field. Check the image and website destination.",
          "Save the partner and confirm it appears in the intended category. Repeat as needed.",
          "Open Preview page and inspect grouping, logo readability, description and outbound link.",
          "For conference applications, review and connect accepted sponsor/exhibitor submissions to the canonical partner record as exposed by Conference Center.",
          "If using the public event website, inspect its partner/content presentation and publish the relevant website changes separately."
        ],
        "check": "The partner is visible in the right group and its link/logo are correct.",
        "troubleshoot": "Partner listings describe public presentation. They do not replace procurement approval, contracts or payment records."
      },
      {
        "id": "org-conference",
        "icon": "📖",
        "title": "Open calls, review proposals and create tracks",
        "intro": "Connect submissions, canonical speakers/partners and conference operations.",
        "path": "Conference Center",
        "before": "Know which application types are allowed and who reviews them.",
        "steps": [
          "Open Conference Center → Calls & abstracts. Select Open and the allowed types: speaker, abstract, exhibitor or sponsor.",
          "Enter Welcome message and Submission deadline; inspect the stable public call link and copy it only when ready.",
          "Open a controlled public submission and verify the application fields and stored proposal before opening the call broadly.",
          "In Submissions, click Review details. Read the complete applicant, organization, proposal summary and contact details; add Review notes and Save review.",
          "Use Accept & connect only after review. It links the accepted person/organization to Speakers or Partners as appropriate. Decline is a separate decision.",
          "Open Tracks → + Add track. Enter Name, Description, Audience and Color, then Save. Reopen the saved track to confirm its details.",
          "Use Speaker operations for + meeting / + release and the Exhibitors & sponsors workspace for the available operational records. Their in-page creation dialogs now open.",
          "Use Photo gallery/Media library and Integrations only for the exposed asset/provider connections; confirm visibility before publishing or syncing.",
          "In Shared templates, choose Save current setup and give the organization template a name. It is reusable setup, not proof every event’s content is already ready.",
          "Finish canonical scheduling in Experience and production planning in Planner. Preview guest programme and public speaker/partner pages."
        ],
        "check": "Proposal review opens details, track creation saves, and operational/template controls expose usable dialogs.",
        "troubleshoot": "Reopen saved tracks and reviewed proposals to confirm the details. Preview meeting, release and template changes before saving operational records."
      },
      {
        "id": "org-live",
        "icon": "🎤",
        "title": "Festio Live: create an activity",
        "badge": "Paid",
        "intro": "Collect audience answers from phones and prepare content for a room display.",
        "steps": [
          "Open Festio Live and choose + New activity.",
          "Choose Quiz, Poll, Survey, Rating, Feedback, Q&A, Word Cloud or Live Voting.",
          "Enter a clear title and short description telling guests what to do.",
          "Select the Experience/program session, or keep the activity event-wide.",
          "Choose anonymity, answer changes, guest results and text moderation deliberately.",
          "Create the activity, then open its question editor.",
          "Add the question text and choose the appropriate answer format. Add choice options where needed.",
          "For a quiz, configure the correct answer and scoring controls exposed by that question. For feedback, avoid quiz scoring.",
          "Save and preview. Use a synthetic guest before inviting the audience.",
          "Return to Control room to run the activity; creation alone does not open participation."
        ],
        "path": "Festio Live > + New activity",
        "before": "Have an event and decide whether participation is event-wide or attached to a session.",
        "check": "The activity appears in Activities and its question is readable in the guest view.",
        "troubleshoot": "If guests cannot answer, inspect both activity participation and individual question status."
      },
      {
        "id": "org-live-types",
        "icon": "📖",
        "title": "Choose the right activity and question",
        "intro": "Match the answer format to the decision you need.",
        "path": "Festio Live > Activities > question editor",
        "before": "Write the question before selecting a format.",
        "steps": [
          "Quiz: use a factual question, choice options and an explicitly configured correct answer; review leaderboard settings.",
          "Poll: ask one preference question; single choice gives one vote, multiple choice permits several selections.",
          "Survey: create a short sequence; use rating, text and choice formats only where each adds useful information.",
          "Rating: state the subject and explain the ends of the scale. Five-point, ten-point and NPS formats are exposed.",
          "Feedback: ask one actionable improvement question and decide whether text needs moderation.",
          "Q&A: explain who will answer and how questions are moderated or spotlighted.",
          "Word Cloud: request short words or phrases; set anonymity and moderation appropriate to the audience.",
          "Live Voting: explain the choices and voting window before opening participation.",
          "Advanced formats exposed include number, ranking, quadrant and image click. Preview each on a guest phone before use.",
          "Review Responses after a test. A saved activity, a submitted answer and a displayed result are separate outcomes."
        ],
        "check": "You can explain the question and how its answers will be used in one sentence.",
        "troubleshoot": "Use the current editor controls; do not assume every format offers the same scoring or display options."
      },
      {
        "id": "org-live-run",
        "icon": "📖",
        "title": "Run the show and projector",
        "intro": "Open participation, close it deliberately and show the correct content on each display.",
        "path": "Festio Live > Control room / Channels & devices",
        "before": "Prepare at least one activity and question. Have the display operator open the actual display link.",
        "steps": [
          "Open Channels & devices and give each display a recognisable name, such as Main stage.",
          "Choose its whole-event or session scope and activity. Copy its display link to the authorised screen operator.",
          "Preview the screen. A zero connected-screens count means the projector has not joined.",
          "In Control room select the activity and intended target display.",
          "Start the guided show and show the introduction or join QR.",
          "Open participation. If the question itself is closed, reopen the intended question using its controls.",
          "Confirm a test guest sees the intended prompt before announcing voting.",
          "Lock responses when the time is over, then reveal the result using the available controls.",
          "Use Current result, All results or the appropriate scene; display choices do not create or delete responses.",
          "Finish by returning to the join/welcome screen and closing participation."
        ],
        "check": "The guest can answer only during the intended window, and the display shows the selected activity.",
        "troubleshoot": "Check three separate states: activity participation, question status and display scene."
      },
      {
        "id": "org-resources",
        "icon": "📖",
        "title": "Add presenter and guest resources",
        "intro": "Share slides, handouts, videos or useful links with the appropriate audience.",
        "path": "Festio Live > Presenter materials",
        "before": "Have the source file or URL and the rights to share it.",
        "steps": [
          "Open Presenter materials and choose Upload or Link.",
          "Choose the event-wide scope or the intended session.",
          "Enter a display title guests can understand.",
          "For Upload select an accepted file; the inspected screen states a 100 MB maximum. For Link paste the destination.",
          "Choose the material type: slides, PDF, handout, sheet, video or link.",
          "Choose the audience: Presenter only, Production team or GuestHub attendees.",
          "Set guest release timing: as soon as approved or after the session is attended.",
          "Add the material to the presenter library.",
          "Review and approve it before relying on guest availability.",
          "Open Preview and then check an eligible GuestHub account."
        ],
        "check": "The approved resource is available to the intended audience at the chosen time.",
        "troubleshoot": "Attendance-gated files require the matching published session attendance record. If a session is absent, publish and synchronize its workflow; never substitute a similarly named draft session."
      },
      {
        "id": "org-certificates",
        "icon": "📖",
        "title": "Create and issue certificates",
        "intro": "Issue credentials using actual check-in and session records.",
        "path": "Festio Live > Certificates",
        "before": "Decide the qualification rules and use accurate attendance data.",
        "steps": [
          "Open Certificates and select + New template.",
          "Enter the certificate name, heading and recognition text.",
          "Choose primary/accent colours and signature label; add logo, background or signature artwork if needed.",
          "Review the live sample preview. The sample name is not an issued certificate.",
          "Choose whether convention check-in is required.",
          "Set minimum sessions and/or required named sessions. Leave required sessions unselected when using only the count.",
          "Choose automatic issuance only after the rules are correct.",
          "Save design and rules. Review Eligibility and issuance.",
          "Select eligible attendees and use Issue selected; use Issue & email only when recipients and delivery are intended.",
          "Check the issued credential PDF and Verify link. Future template edits do not alter issued snapshots."
        ],
        "check": "Eligible participants show an issued credential with a downloadable PDF and verification link.",
        "troubleshoot": "A disabled guest selection means ineligible or already issued. Required-session rules use published sessions. Review the actual check-in/session evidence and refresh eligibility after saving rules; do not weaken rules merely to force issuance."
      },
      {
        "id": "org-giving",
        "icon": "📖",
        "title": "Create a giving campaign",
        "intro": "Collect and track campaign pledges using enabled methods.",
        "path": "Festio Live > Donation Tracker",
        "before": "Agree a campaign purpose, currency and permitted receiving methods.",
        "steps": [
          "Open Donation Tracker.",
          "Enter campaign title, description, target and currency.",
          "Set privacy and pledge options to match how donor names should appear.",
          "Enable only the receiving methods the organiser can actually support.",
          "Save the campaign and open its guest-facing giving link.",
          "Read the campaign text as a guest and inspect the available methods.",
          "For a synthetic test, use a pledge rather than initiating a real payment.",
          "Review pending and confirmed records separately.",
          "Record offline receipts only when money was actually received and the record is authorised.",
          "Use the donation display scene if the campaign will appear on a screen."
        ],
        "check": "Guests see the saved campaign wording and only supported methods; totals distinguish commitments from confirmed receipts.",
        "troubleshoot": "A pledge is a promise, not proof that funds reached an account. Payment and provider activation require the organiser’s input."
      },
      {
        "id": "org-community",
        "icon": "💬",
        "title": "FestioMe: guest community & groups",
        "badge": "Paid",
        "img": "/media/help2-org-community.png",
        "intro": "Keep attendees connected before and after the event.",
        "steps": [
          "Open FestioMe for the selected event.",
          "Create a group and give it a clear name.",
          "Choose Open, approval-based or invitation-based membership as appropriate.",
          "Use the event-support-group setting when this is the event’s support space.",
          "Create a channel within the community.",
          "Enter the channel name and choose Discussion, Announcement, Staff or Private as offered.",
          "For a private channel, choose only the intended members.",
          "Save and inspect the community from an authorised guest account.",
          "Check People, connection and direct-message exposure, particularly for juniors.",
          "Review moderation reports and membership requests regularly."
        ],
        "path": "FestioMe > Groups / Channels",
        "before": "Decide membership policy, age suitability and who will moderate.",
        "check": "An eligible guest can find the group and intended channel, while restricted spaces remain restricted.",
        "troubleshoot": "Attendance, child/guardian relationships and community membership are separate controls. Do not assume junior safety follows automatically from registration."
      },
      {
        "id": "org-meetup",
        "icon": "📖",
        "title": "Publish a community meetup",
        "intro": "Arrange a follow-up gathering for community members.",
        "path": "FestioMe > Meetings",
        "before": "Have a confirmed venue or joining destination and capacity.",
        "steps": [
          "Open the community Meetings area.",
          "Choose the create-meetup control.",
          "Enter the title and a plain-language description.",
          "Enter location or joining information.",
          "Set the start and end times and check their timezone.",
          "Set capacity to the actual number available.",
          "Review the details before choosing Publish.",
          "Open the member-facing view and confirm the date, place and joining action."
        ],
        "check": "Members can understand when and where the meetup happens and how to join.",
        "troubleshoot": "Publishing makes the gathering visible to its configured community audience. Use real details only when the organiser intends that publication."
      },
      {
        "id": "org-budget",
        "icon": "📖",
        "title": "Set a budget and cost categories",
        "intro": "Plan spending and track commitments consistently.",
        "path": "Planner > Budget",
        "before": "Agree an event budget and currency.",
        "steps": [
          "Open Planner and select Budget.",
          "Enter the total budget, currency and explanatory notes.",
          "Save the budget.",
          "Add cost categories matching the event, such as Venue, Catering and Production.",
          "Allocate category amounts using the available fields.",
          "Add vendor amounts and deposits in the vendor records when appropriate.",
          "Review the budget overview after saving.",
          "Compare planned, committed and paid figures before making financial decisions."
        ],
        "check": "Saved totals and categories appear in the budget view and use the intended currency.",
        "troubleshoot": "Planner amounts are budget records. Check the event currency and Ticketing settlement currency separately before comparing amounts."
      },
      {
        "id": "org-vendors",
        "icon": "📖",
        "title": "Add vendors and compare quotes",
        "intro": "Keep suppliers, scope and competing proposals in one place.",
        "path": "Planner > Vendors / Procurement",
        "before": "Have business contact details and a clear comparison scope.",
        "steps": [
          "Open Vendors and choose the create-vendor control.",
          "Enter vendor name, category, contact details and website where relevant.",
          "Choose a status such as prospect, shortlisted, contracted, paid or cancelled.",
          "Enter agreed amount, deposit and due/expiry dates only when known; save.",
          "Open Procurement and create a quote for the vendor.",
          "Give comparable quotes the same comparison group.",
          "Enter title, currency and line items with quantity, unit and price.",
          "Add scope, notes and expiry date. Keep it Draft until ready for the indicated review stage.",
          "Save the quote and compare like-for-like scope, not just the headline total.",
          "Use approval controls only with the organiser’s authorised decision."
        ],
        "check": "The vendor and quote appear in their lists with matching currency and comparable scope.",
        "troubleshoot": "A saved or submitted quote is not a supplier payment or signed contract."
      },
      {
        "id": "org-contracts",
        "icon": "📖",
        "title": "Prepare contracts and store documents",
        "intro": "Keep draft terms and supporting files attached to the right supplier.",
        "path": "Planner > Contracts / Documents",
        "before": "Have approved source terms and document ownership.",
        "steps": [
          "Open Contracts and create a new draft.",
          "Select the vendor, enter the title and draft terms.",
          "Save the draft and inspect it before sharing.",
          "Keep draft creation separate from sending, signing or accepting binding terms.",
          "Open Documents when adding supporting paperwork.",
          "Choose the file, name, document type and related vendor.",
          "Enter an expiry date when relevant.",
          "Upload and confirm the document appears with the intended supplier.",
          "Review expired or outdated documents before the event."
        ],
        "check": "The draft and uploaded documents are discoverable under the correct supplier.",
        "troubleshoot": "Final contract acceptance and real supplier communications require the responsible organiser’s approval."
      },
      {
        "id": "org-runsheet",
        "icon": "📖",
        "title": "Create milestones and the runsheet",
        "intro": "Turn preparation work and event-day cues into an ordered plan.",
        "path": "Planner > Timeline / Runsheet",
        "before": "Have event dates, timezone, responsible people and locations.",
        "steps": [
          "Open Timeline and create a milestone.",
          "Enter title, description, due date and status; save.",
          "Open Runsheet and create an item.",
          "Enter start/end time and verify the timezone shown.",
          "Give the item a title and type, then choose owner and location.",
          "Set any Starts after dependency only when it reflects the actual sequence.",
          "Enter cue notes and status, then save.",
          "Review the entire sequence for overlaps, gaps and local dates.",
          "Share the relevant plan with the team using available sharing controls.",
          "Update status during rehearsals and the event."
        ],
        "check": "Items appear in chronological order with a clear owner, location and local time.",
        "troubleshoot": "Compare the event timezone and start/end dates across Results, Ticketing and published programme surfaces before sharing the production schedule."
      },
      {
        "id": "org-team",
        "icon": "🧑‍🤝‍🧑",
        "title": "Add your team",
        "img": "/media/help2-team.png",
        "steps": [
          "Open Team and choose Add teammate.",
          "Enter the intended email and review the role options.",
          "Choose the narrowest role that supports the work.",
          "Review event, guest and scanner access separately where those controls are exposed.",
          "Send the invitation only after the organiser approves that access.",
          "Open Tasks and create a task with an actionable title.",
          "Choose assignee, due date and notes, then save.",
          "Use List, Board or My Tasks to track work.",
          "Update status through Open, In progress and Done as work progresses.",
          "Review outstanding tasks and access before the event."
        ],
        "intro": "Delegate preparation and event operations with appropriate access.",
        "path": "Team / Tasks",
        "before": "The organiser must authorise the recipient and role.",
        "check": "The task appears under the intended assignee; the teammate has only the intended access.",
        "troubleshoot": "A visible team member card does not prove every permission. Check the actual role/access controls and test with that account."
      },
      {
        "id": "org-upgrade",
        "icon": "💳",
        "title": "Event Pass & message credits",
        "img": "/media/help2-event-pass.png",
        "steps": [
          "Open Billing for the selected event.",
          "Read the active Event Pass, guest cap and wallet balance.",
          "Select USD/Stripe or NGN/Paystack deliberately and review the matching catalog.",
          "Compare available credit packs with the invitation preflight estimate.",
          "Open the credit-pack details to review the amount and price.",
          "Request the required amount or approved code from the organiser before a purchase.",
          "Use Buy credits only when the purchase is approved; the organiser completes payment details and any consequential payment step.",
          "After success, verify the wallet and Credit ledger.",
          "For included add-ons, open the corresponding workspace from the sidebar; the inspected Included · open setup buttons were disabled.",
          "Keep message credits, an Event Pass and an individual module entitlement distinct."
        ],
        "intro": "Understand entitlement and message funding before using paid services.",
        "path": "Billing > Top up message credits",
        "before": "Know the intended event, currency, credit requirement and approved spending amount.",
        "check": "After a completed top-up, the ledger, wallet balance and transaction status agree.",
        "troubleshoot": "Compare Billing, message preflight and Results for the same event and wallet. If the totals disagree, resolve the discrepancy with support before spending."
      },
      {
        "id": "org-guest-test",
        "icon": "📖",
        "title": "Walk through the guest experience",
        "intro": "Check the journey the guest actually receives.",
        "path": "Public event website / RSVP / GuestHub",
        "before": "Use synthetic contacts and an authorised test pass.",
        "steps": [
          "Open the published event website and read identity, date, venue, programme, speakers and FAQ.",
          "Follow the real registration or ticket CTA for the event’s configured route.",
          "Review RSVP categories, party members and confirmation before submission.",
          "Open the resulting pass and confirm the right person and access type.",
          "Visit GuestHub Home, Programme, My Pass, Inbox and More.",
          "Verify meals, table, resources, workflow and consent appear only when configured and eligible.",
          "Read a test announcement and use Refresh updates if needed.",
          "Test a Live activity during its participation window.",
          "Check the community destination and any privacy-sensitive People or messaging controls.",
          "Repeat with another eligible attendee and with a genuinely narrow/mobile browser before release."
        ],
        "check": "A guest can prepare, arrive, participate and find follow-up information without organiser assistance.",
        "troubleshoot": "A logged-in/recognised browser may bypass fresh signup or RSVP. Use a fresh session when validating those entry flows."
      },
      {
        "id": "org-dashboard",
        "icon": "📊",
        "title": "Results",
        "img": "/media/help2-results.png",
        "steps": [
          "Open Results and read the selected event, reporting scope and event timezone. Compare the start/end calendar dates with Event Setup and the public ticket page.",
          "Compare invited, registered, checked-in and attendance counts as distinct measures.",
          "Review message, consent, session and service sections that are available.",
          "Check warnings against the source workspace before acting.",
          "Open the export/report controls.",
          "Choose the available report or dataset appropriate to the task.",
          "Review the downloaded file’s event, date, columns and totals before sharing.",
          "Use Festio Live Responses for activity-specific answers and Q&A counts.",
          "Store reports with the event’s approved records and explain any unresolved inconsistencies."
        ],
        "intro": "Close out the event with understandable counts and usable records.",
        "path": "Results > report / exports",
        "before": "Have the correct event selected and know which metrics you need.",
        "check": "The export matches the intended event and the source records.",
        "troubleshoot": "Do not treat a contradictory summary as authoritative. Compare the source record, event timezone, wallet configuration and deployed service versions; retain the discrepancy with the exported record until resolved."
      },
      {
        "id": "org-calendars",
        "icon": "📆",
        "title": "Event Calendars: curated listing pages",
        "img": "/media/help2-org-calendars.png",
        "intro": "Organise reusable audiences and curated event listings.",
        "steps": [
          "Open Org Settings and go to Collections.",
          "Enter a New list name and choose Add. Open View to manage its contacts using the controls provided.",
          "Choose New calendar. Enter the required Title and optional Description.",
          "Choose Public or Private deliberately; review Hide past events.",
          "Save calendar and open Manage.",
          "Use Add event to include eligible events.",
          "Upload a calendar logo if needed. Arrange curated events with Up and Down.",
          "For private links, choose the authorised contact-list audience.",
          "Send private links only when the recipients and purpose are approved.",
          "Inspect the resulting listing before distributing it widely."
        ],
        "path": "Org Settings > Collections",
        "before": "Choose intended visibility; a calendar can be public or private.",
        "check": "The calendar lists the intended events in order and has the intended visibility.",
        "troubleshoot": "Contact lists reuse audience data across events. Avoid exposing an existing list in a public calendar."
      },
      {
        "id": "org-api",
        "icon": "🔌",
        "title": "Public API & developer access",
        "img": "/media/help2-org-api.png",
        "intro": "Connect organisation data with approved external systems.",
        "steps": [
          "Open Org Settings and review the Integration plan.",
          "Read API docs and Open API Explorer before creating credentials.",
          "Confirm the intended integration needs and permissions with the technical owner.",
          "Use Create new key with an account that has integration permissions. Choose only the scope your integration needs.",
          "Store any created key securely; do not include it in guides or screenshots.",
          "Review Add webhook for the approved receiving endpoint and required notifications.",
          "Confirm endpoint ownership and data handling before saving an outbound integration.",
          "Test with synthetic records using the documented API.",
          "Review subscription requirements before read-write access or hosted checkout.",
          "Rotate or revoke credentials through the product when access ends."
        ],
        "path": "Org Settings > API / Webhooks",
        "before": "This is an advanced setup requiring an authorised technical owner and destination.",
        "check": "An approved integration can read or receive only the intended records.",
        "troubleshoot": "Use the endpoint paths and authentication documented in the current API Explorer. Test requests with synthetic records before connecting production data."
      },
      {
        "id": "org-rsvp-only",
        "icon": "✉️",
        "title": "Just need RSVPs? Start here",
        "intro": "Not every event needs seating, orders, or entry rules — sometimes you just want a clean guest list and RSVP count.",
        "steps": [
          "In New event, choose Invitation / RSVP and leave optional paid services off.",
          "Complete event dates, timezone and venue, then create the event.",
          "Open Invites & RSVP and choose Anyone with event link or personal invite links. Set the required fields and approval rules.",
          "Save, preview and submit one controlled RSVP in a fresh browser session. Confirm the guest record, personal link and pass before sharing.",
          "Enable additional services later through Features & messaging and review entitlements in Billing."
        ],
        "tip": "A preview checks presentation; a saved guest registration checks the RSVP flow."
      },
      {
        "id": "org-track",
        "icon": "✅",
        "title": "Track RSVPs & approvals",
        "img": "/media/help2-guests.png",
        "steps": [
          "The Guests tab shows every guest with their current status: Attending, Declined, Pending (submitted, awaiting your approval), or No reply.",
          "Each row also shows whether the guest has been checked in on the day.",
          "If \"Approval required\" is on: click a guest to approve or reject their RSVP. Use \"Approve all\" to confirm everyone at once.",
          "Use search, selection, and the status columns to find specific groups quickly.",
          "Use the guest tools to review or download event data when you need an offline list.",
          "Click any guest to see their details: RSVP answers, contact info, ticket type, tags, seat assignment, order choices, and check-in history.",
          "Update a guest's status, ticket type, or seat assignment manually if needed."
        ],
        "tip": "Use the filter + bulk-select to approve, email, or change ticket types for a whole group at once."
      },
      {
        "id": "org-templates",
        "icon": "✏️",
        "title": "Customize your message templates",
        "img": "/media/help2-templates.png",
        "intro": "Every automatic message — invitations, RSVP confirmations, reminders, and more — has editable wording per channel.",
        "steps": [
          "Open Guest Communication → Templates for the selected event.",
          "Choose the message type and channel. Edit the subject and body using the offered merge fields.",
          "Preview the event name, dates, guest link and any channel-specific wording.",
          "Save, send to one controlled test contact and inspect the actual receipt.",
          "Ticket fulfillment uses Ticket sales → Delivery message studio; edit those templates separately."
        ]
      },
      {
        "id": "org-sections",
        "icon": "🔲",
        "title": "Section scanning (multi-entrance seating)",
        "badge": "Paid",
        "intro": "For events seated by table group with two or more entrances — each scanner routes walk-ins and manual check-ins into the section it's assigned to.",
        "steps": [
          "Guest Communication → Features & messaging → turn on Section scanning (only shown once you have table groups set up in Seating).",
          "On the Team page, assign each staff member (or each device) the table-group section they're stationed at.",
          "Walk-ins and manual check-ins scanned at that station seat into that section automatically, instead of a single shared default group.",
          "A guest's own assigned group always wins if it doesn't match the scanning station — there's no override flow by design."
        ],
        "warn": "Section scanning and Venue Access (zone/gate-based entry rules) can't both be on for the same event — turn one off before enabling the other."
      },
      {
        "id": "org-tasks",
        "icon": "✅",
        "title": "Tasks: run your to-do list as a team",
        "img": "/media/help2-org-tasks.png",
        "intro": "Assign and track the work behind your event — who's doing what, by when.",
        "steps": [
          "Team & Tasks page → Tasks tab → + Task: set a title, assignee, due date, and notes.",
          "Switch between List and Board view depending on how your team likes to work.",
          "Open a task to add subtasks, attach files, or post a comment in its activity thread.",
          "Move a task through Open → In progress → Done as work happens.",
          "My Tasks (from your own account) shows everything assigned to you across every event you have access to, separate from any one event's task list."
        ],
        "tip": "Planner's Timeline milestones can link to tasks automatically — a milestone's linked tasks show up in both places."
      },
      {
        "id": "org-planner",
        "icon": "📘",
        "title": "Planner: budget, vendors & run sheet",
        "badge": "Paid",
        "img": "/media/help2-planner.png",
        "intro": "Keep the planning work — budget, vendors, contracts, timeline — next to your guest list instead of scattered across spreadsheets.",
        "steps": [
          "Guest Communication → Features & messaging → turn on Planner, then Open your planner.",
          "Budget tab: track allocated vs. actual spend by category.",
          "Vendors and Procurement tabs: a workspace per vendor for quotes and orders.",
          "Contracts tab: draft a contract with title and terms, Save draft, then Send — the vendor signs from their own portal link. Status moves through draft → sent → signed, showing who signed and when.",
          "Timeline tab: add milestones and link tasks to each one (shares the same task list as Team & Tasks) — this is a milestone list, not a Gantt chart.",
          "Runsheet and Documents tabs: your day-of schedule and shared files in one place."
        ],
        "tip": "Vendor e-signature happens entirely in the vendor's own portal view — you don't need to chase a separate signing tool."
      },
      {
        "id": "org-export",
        "icon": "⬇️",
        "title": "Export & post-event",
        "steps": [
          "Guests tab: review RSVP status, check-in time, seat, order choices, and any custom question answers.",
          "Seating tab: use the seating chart and table assignment list for on-site reference.",
          "Orders tab: review per-table item totals for your caterer or fulfilment team.",
          "Deliveries tab: review guest names, addresses, and items for fulfilment.",
          "Open Results → Closeout & exports to select the available report and download it. Check event scope and filters; use browser print for a visual copy of charts.",
          "After the event, set it to Ended so check-in and RSVP submissions close. The event stays in your event list with its full data for reporting — nothing is deleted or hidden."
        ]
      },
      {
        "id": "org-troubleshoot",
        "icon": "🔧",
        "title": "Troubleshooting",
        "intro": "Common issues and how to fix them.",
        "steps": [
          "Guests not receiving invites: check their email/phone in the Guests tab — look for the ⚠️ flag on rows with invalid phone numbers. For email, ask guests to check spam/junk. Resend from the guest row or Invites & RSVP.",
          "Import shows warnings (amber badge): click the badge to see which rows failed — most common causes are missing country codes on phone numbers, unknown ticket type names, or rows exceeding your plan guest limit.",
          "Google Sheets sync is red: the share link has expired or the sheet's sharing setting changed. Re-share the sheet as \"Anyone with the link can view\" and paste the new link.",
          "QR not scanning: ensure the event is set to Active. Check the scanner device has camera permission in browser settings. Try good lighting — the QR needs to be fully visible in frame.",
          "Guest getting \"Already admitted\": the QR was used at a previous gate. Check their check-in log (Guest profile) to see where they were scanned. This is normal — just admit them manually if it was an error.",
          "Area showing Denied: the guest's ticket type or tags don't permit entry to that area. Check the guest's ticket type in their profile and compare with the rules in Entry areas.",
          "Credits ran out during a bulk send: buy a top-up from Event Setup and resume the send from Invites & RSVP using a no-reply reminder.",
          "Can't see Seating / Venue Access tabs: these features must be turned on in Guest Communication → Features &amp; messaging, and require an Event Pass.",
          "Staff can't see the event in Check-in: they must be added in Team tab AND assigned to this specific event.",
          "RSVP deadline passed but guests are still submitting: the deadline blocks new RSVPs from the public invite page. You can still add or approve guests manually from Event Setup.",
          "Guests don't see \"Join Festio Live\" on their ticket page: confirm Festio Live is turned on (Guest Communication → Features &amp; messaging) and that an activity is actually set to Live, not Draft. Share the festio.events/live/join code as a fallback."
        ]
      }
    ]
  },
  "staff": {
    "label": "Staff / Check-in",
    "icon": "📷",
    "blurb": "Check guests in at the door. No app needed — runs in your phone browser.",
    "topics": [
      {
        "id": "staff-join",
        "icon": "🔑",
        "title": "Get set up before the event",
        "steps": [
          "Your organiser adds you by email in the event's Team tab. Make sure they use your exact sign-in email.",
          "Sign in at festio.events with that email. Your account links to their organisation automatically.",
          "You'll see the events you've been assigned to in the Check-in screen.",
          "Open Check-in on the device you'll use on the day and confirm you can see the event. Do this at least the day before.",
          "Grant camera permission: the browser will ask the first time you start the camera. Allow it — if you accidentally denied, go to your browser Settings → Site permissions → Camera and re-enable it.",
          "Check your internet connection. Opening Check-in once while online automatically caches the guest list on your device — if the connection drops later, scanning keeps working and syncs automatically once you're back online (you'll see a blue result instead of green while offline)."
        ],
        "tip": "Do a test scan the day before. Your organiser can add themselves as a guest — scan their QR to confirm the green admitted screen appears."
      },
      {
        "id": "staff-scan",
        "icon": "📷",
        "title": "Check guests in",
        "img": "/media/help2-checkin.png",
        "steps": [
          "Open Check-in on your phone or tablet. No app download needed.",
          "Select your event from the list.",
          "If the event uses Gates, select your gate (e.g. \"Main Entrance\"). This sets your zone and direction automatically.",
          "If using manual area entry: pick the area you're standing at and direction (Entry / Exit).",
          "Tap Start camera. Point the camera at the guest's QR code — it reads instantly without pressing any button.",
          "Hold the phone steady and ensure good lighting. The QR code must be fully within the camera frame.",
          "After each scan the screen resets automatically, ready for the next guest within a second.",
          "If a guest's phone screen is dim: ask them to increase brightness. A printed QR works just as well."
        ],
        "tip": "If a QR is not working, ask the organiser to look up the guest in Guests and confirm their invitation or ticket code."
      },
      {
        "id": "staff-results",
        "icon": "ℹ️",
        "title": "Understanding scan results",
        "steps": [
          "✅ Green — \"Welcome, [Name]!\" — admitted successfully. Guest may proceed.",
          "⚠️ Yellow — \"Already admitted\" — this QR was scanned before. Ask when and where — it's usually fine if they're moving between zones.",
          "🔴 Red — \"Access denied\" — the guest's ticket type or tags don't permit this area, or the area is at capacity. Politely direct them to the correct entrance.",
          "🔴 Red — \"Event not active\" — the organiser hasn't set the event to Active yet. Ask them to do so in Event Setup → Start here.",
          "🔴 Red — \"Needs Event Pass\" — the organiser's account is on the free tier. This shouldn't happen at a real event — contact your organiser.",
          "❓ \"Guest not found\" — the QR is from a different event or is corrupted. Direct the guest to the organiser desk.",
          "🔵 Blue — \"Checked in on this device\" — the internet dropped, so the scan was accepted from the guest list already cached on your phone and queued to sync. Keep scanning normally; it uploads automatically once you're back online.",
          "For any denied result, do not override — direct the guest to the organiser's desk for resolution."
        ]
      },
      {
        "id": "staff-zones",
        "icon": "🚪",
        "title": "Zone scanning & gates",
        "img": "/media/help2-checkin.png",
        "steps": [
          "If the event has Entry areas enabled, Check-in shows an Area/Gate picker before you start.",
          "Gate mode (recommended): select your named gate once (e.g. \"VIP Lounge Door\"). The zone and direction are pre-configured — every scan automatically enforces the rules for that gate.",
          "Manual mode: pick a zone (e.g. Main Hall) and direction (Entry or Exit) yourself. Change it if you move to a different gate.",
          "The scan result shows \"Allowed\" (green) or \"Denied\" (red) plus the live occupancy count for that zone.",
          "Denied reasons shown on screen: \"Wrong zone for ticket type\", \"Tag not permitted here\", \"Zone at capacity\".",
          "A guest's first allowed Entry scan anywhere in the venue also counts as their event check-in — no separate check-in scan needed.",
          "Exit scans are optional — they help track who is still inside the venue.",
          "Live occupancy is shown below the scan result — you can see if a zone is filling up."
        ],
        "tip": "If you're covering multiple gates, stay on Gate mode and switch your gate selection each time you move — don't try to use Manual mode for a fast-moving door."
      },
      {
        "id": "staff-experience",
        "icon": "🧭",
        "title": "Running an Experience workflow",
        "intro": "If the organizer has set up an Experience workflow, check-in is just the first step — you may also mark consent, seating, souvenirs, or session attendance.",
        "steps": [
          "Each guest's Festio Pass page shows their current step in the workflow — what's done and what's next.",
          "Mark a step complete from the guest's pass page as they go through it — souvenir pickup, badge issued, seated, etc.",
          "Open the guest journey or assigned workflow and review its required steps.",
          "Consent/forms may be available before arrival or after check-in according to their published timing. Complete only the forms your role is authorized to sign.",
          "For juniors, an authorized parent or legal guardian completes guardian-only forms. Confirm the saved signer and form version.",
          "Session access follows the published session and your pass eligibility; a programme entry alone does not grant admission."
        ]
      },
      {
        "id": "staff-tips",
        "icon": "💡",
        "title": "Tips for a smooth check-in",
        "steps": [
          "Keep your phone charged — bring a power bank for all-day events.",
          "Use a phone holder or lanyard so your hands are free to manage the queue.",
          "Brief other staff before opening: agree on what to do if a QR is denied or a guest can't find their ticket.",
          "For large events with queues: open multiple check-in stations and assign a separate area/gate to each — parallel scanning dramatically reduces wait times.",
          "If the camera freezes: close and reopen the Check-in tab. You don't lose any data.",
          "Guests who can't find their QR: ask them to check their confirmation email/SMS/WhatsApp. If still missing, direct them to the organiser desk for lookup in Guests.",
          "Manual lookup: ask the organiser to use Guests or the ticket code lookup to confirm the guest before entry.",
          "Noisy lighting (direct sunlight, flashing lights): tilt the guest's screen slightly towards you or ask them to cup their hand over it to reduce glare."
        ]
      }
    ]
  },
  "guest": {
    "label": "Guest",
    "icon": "🎉",
    "blurb": "You received an invite — here's everything you need from RSVP to arrival.",
    "topics": [
      {
        "id": "guest-open",
        "icon": "🔗",
        "title": "Open your invite",
        "img": "/media/help2-guest-invite.png",
        "steps": [
          "Tap the link in your email, SMS, or WhatsApp message. It opens in your phone browser — no app download needed.",
          "If the link asks you to \"Open with…\" — choose your browser (Chrome, Safari, etc.).",
          "If the link has expired: RSVP deadlines are set by the host. Contact them directly to be added manually.",
          "If you can't find your invite: check your spam/junk folder (email) or your WhatsApp message requests."
        ]
      },
      {
        "id": "guest-rsvp",
        "icon": "📝",
        "title": "RSVP",
        "steps": [
          "Fill in your name and any questions the host has set (dietary preference, item choice, t-shirt size, etc.).",
          "Click Confirm to say yes, or \"Can't make it\" to decline.",
          "On a personal (closed) invite link, you can return and change your answer until the RSVP deadline.",
          "If the host requires approval, you'll see \"RSVP submitted — awaiting confirmation\" until they approve. You'll get a notification when you're confirmed.",
          "If you're bringing a plus-one: look for the partner/plus-one option on your ticket page after confirming — link your partner's name so you're seated together."
        ],
        "tip": "RSVP as soon as possible — some events have capacity limits and close registrations once full."
      },
      {
        "id": "guest-ticket",
        "icon": "🎟️",
        "title": "Your ticket & QR code",
        "steps": [
          "Once your RSVP is confirmed, you'll receive a confirmation email (and/or SMS/WhatsApp) with your personal QR code.",
          "On the day: show this QR at the entrance — staff will scan it with their phone camera. It's instant.",
          "You can also find your ticket by reopening the invite link — your QR is always there.",
          "The QR is personal and unique to you. Don't share it with anyone else.",
          "If the event uses zones (e.g. VIP areas): your ticket type controls which areas you can enter. If you're denied at a gate, speak to the organiser.",
          "Printed QR works just as well as showing it on your phone screen."
        ],
        "tip": "Screenshot your QR code and save it to your phone's camera roll before the event, in case you lose internet access on the day."
      },
      {
        "id": "guest-tickets",
        "icon": "💳",
        "title": "Buying a paid ticket",
        "steps": [
          "Some events are ticketed rather than free RSVP — you'll see prices and ticket types (General Admission, VIP, etc.) on the event page.",
          "Pick a ticket type and quantity, then pay by card through the event's checkout.",
          "After payment, you receive the same personal QR pass a free RSVP guest gets — show it at the door the same way.",
          "A refund (if the organizer issues one) cancels your pass along with the payment."
        ]
      },
      {
        "id": "guest-experience",
        "icon": "🧭",
        "title": "Your guest journey (consent, souvenirs, sessions)",
        "steps": [
          "Your current step and what's next are shown right on your pass — staff can also see and update it as you go through each step.",
          "Open the guest journey or assigned workflow and review its required steps.",
          "Consent/forms may be available before arrival or after check-in according to their published timing. Complete only the forms your role is authorized to sign.",
          "For juniors, an authorized parent or legal guardian completes guardian-only forms. Confirm the saved signer and form version.",
          "Session access follows the published session and your pass eligibility; a programme entry alone does not grant admission."
        ]
      },
      {
        "id": "guest-meal",
        "icon": "🍽️",
        "title": "Order choices & seating",
        "steps": [
          "If the host set up orders, you'll see a \"Pick your items\" section on your ticket/RSVP page.",
          "Pick your choice before the deadline shown — after the deadline, changes may not be accepted.",
          "Your item choices are sent to the event team and linked to your table automatically — you don't need to tell anyone on the day.",
          "Seating: the host assigns tables. Your table and seat number (if assigned) appear on your ticket page before the event.",
          "If you're attending as a couple/group: link your plus-one on your ticket page so the host can seat you together."
        ]
      },
      {
        "id": "guest-address",
        "icon": "📦",
        "title": "Providing your address (aso-ebi / gifts)",
        "steps": [
          "Some events collect shipping addresses for aso-ebi fabric, welcome bags, or post-event gift delivery.",
          "If address collection is on, you'll see an address form on the RSVP or ticket page.",
          "Enter your full delivery address including postcode/zip code and country.",
          "You can update your address by returning to your invite link before the shipping cutoff date set by the host.",
          "If you missed the address deadline: contact the host directly."
        ]
      },
      {
        "id": "guest-registry",
        "icon": "🎁",
        "title": "Gift registry",
        "steps": [
          "If the host shares a registry link, open it to browse their gift wishlist and cash contribution funds.",
          "Click \"I'll bring this\" on any item to claim it — others will see it's taken so nobody buys duplicates.",
          "For cash funds: the host's payment details or instructions are shown — you transfer directly, not through Festio.",
          "You can unclaim an item if your plans change — just return to the registry link and untick.",
          "No account or login required to view or claim items."
        ]
      },
      {
        "id": "guest-live",
        "icon": "🎤",
        "title": "Join a live quiz, poll or survey",
        "steps": [
          "If the host is running Festio Live, a \"Join Festio Live\" button appears on your invite/ticket page whenever an activity is live — tap it to join instantly, no extra sign-in.",
          "No personal invite link (e.g. you're at a talk or keynote)? Go to festio.events/live/join on your phone and enter the 6-character join code shown on screen, or scan the QR code if one is displayed.",
          "Answer from your own phone — quizzes may have a timer and award points; polls, ratings, and surveys just record your response.",
          "For quizzes: your score and rank appear on the leaderboard once the host reveals results.",
          "For word clouds and open-text questions: your answer may need host approval before it appears on the shared screen — this is normal if nothing shows up immediately.",
          "You can only submit once per question unless the host has turned on \"Allow changes\" for that activity."
        ],
        "tip": "If \"Join Festio Live\" isn't showing on your ticket page, the host hasn't started an activity yet — check back once the session begins, or ask the host for the join code."
      },
      {
        "id": "guest-faq",
        "icon": "❓",
        "title": "Guest FAQ",
        "intro": "Quick answers to common questions.",
        "steps": [
          "I didn't get a confirmation email — check your spam folder first. If it's not there, return to your invite link and confirm your email address is correct. Contact the host to resend.",
          "I can't find the invite link — check your email, SMS, and WhatsApp message requests. Ask the host to resend it.",
          "The link says \"RSVP closed\" — the deadline or capacity limit has passed. Contact the host directly.",
          "My QR won't scan — ask the staff member to direct you to the organiser desk. The organiser can confirm your invite or ticket code.",
          "I want to bring an extra guest — contact the host. They control plus-one allowances.",
          "I need to cancel — return to your invite link and change your RSVP to \"Can't make it\". Contact the host if you're past the deadline.",
          "I have a dietary requirement — if there's no option on the RSVP form, add a note in the \"special requests\" field or contact the host directly."
        ]
      },
      {
        "id": "guest-hub",
        "icon": "🏠",
        "title": "Use GuestHub: programme, speakers and event services",
        "intro": "Keep your event information and personal pass together.",
        "steps": [
          "Open the personal GuestHub link in your confirmation message. If you cannot find it, use My GuestHub recovery with your registration email.",
          "Open My Pass and check the attendee name before showing the QR code. Open My Party to review only the people linked to your registration.",
          "Open Programme to view the published day, local time, room, speaker and session access.",
          "Open Services → Speakers when enabled. Profiles open inside GuestHub; use the return control to get back to event services.",
          "For enabled forms, meal choices, resources or Live activities, follow the available controls. Some services require approval, check-in or session attendance.",
          "Open Inbox or Communications for organizer updates and help. If information fails to load, retry without submitting a duplicate registration."
        ],
        "check": "You can return to your event services and pass without losing your GuestHub session."
      }
    ]
  },
  "operator": {
    "label": "Operator",
    "icon": "🛠️",
    "blurb": "Platform management — organisations, billing, pricing, and support tooling.",
    "topics": [
      {
        "id": "op-open",
        "icon": "🛠️",
        "title": "Open the Console",
        "steps": [
          "Operators see a Console link in the main navigation when signed in.",
          "Direct URL: /console.",
          "The Console is only visible to accounts with the platform superadmin role.",
          "If you need operator access added, contact another existing operator."
        ]
      },
      {
        "id": "op-grant",
        "icon": "🎁",
        "title": "Comp events & add credits",
        "steps": [
          "Console → Overview: lists every organisation with its events.",
          "Click an event → Comp Event: select a tier to grant it free (Starter, Standard, Pro, Scale, etc.). The organiser immediately gets all features of that tier.",
          "Click an organisation → Add Credits: enter a credit amount to top up their message credit balance at no charge.",
          "Comps and credit grants are logged with the operator name and timestamp.",
          "To remove a comp: click the event and select Remove Comp — the event reverts to its paid status."
        ]
      },
      {
        "id": "op-trials",
        "icon": "🎟️",
        "title": "Trial requests",
        "steps": [
          "Console → Trial requests: lists customers who submitted a free trial request from Event Setup.",
          "Each request shows: contact name, email, phone, event name, use case description, and submission date.",
          "Approve: select a tier to comp their event onto (and optionally add message credits). Click Approve — the customer is emailed the decision automatically.",
          "Decline: click Decline — the customer is emailed that their request wasn't approved.",
          "If the requester has no event yet: approve with no event selected — the comp is held and applied to their next event automatically.",
          "Approved trials do not auto-expire — remove the comp manually from the event if needed after the trial period."
        ]
      },
      {
        "id": "op-accounts",
        "icon": "🧑‍💼",
        "title": "Manage accounts",
        "steps": [
          "Console → Accounts: every organisation with its members, roles, and event count.",
          "Suspend an org: all members lose access to its events immediately. Reversible — reactivate any time. No data is lost.",
          "Delete an org: permanently removes the org and all its events and data. Requires typing the org name to confirm. Irreversible.",
          "Per member actions: change role (Owner / Admin / Staff), remove from org, suspend user (blocks all sign-in), or delete user (removes account + disables sign-in).",
          "Guard rails: you cannot suspend or delete yourself, the last operator account, or the default org.",
          "View a member's full sign-in history and last active date from their profile."
        ],
        "warn": "Org deletion is permanent and cannot be undone. Always confirm with the customer before deleting."
      },
      {
        "id": "op-pricing",
        "icon": "💲",
        "title": "Edit pricing & plans",
        "steps": [
          "Console → Pricing: view and edit all event pass tiers and message credit packs.",
          "Edit a tier: change the display name, price (USD and/or NGN), guest cap, active/inactive status.",
          "Add a new tier: useful for custom enterprise plans.",
          "Message credit packs: edit the credits-per-pack, price, and active status.",
          "Changes apply immediately to the public pricing page and checkout.",
          "Deactivating a tier hides it from checkout but doesn't affect events already on that tier.",
          "Global add-on promotion (in the same Pricing tab): opens every add-on free on all current and future paid events for a set period — \"Open paid-event add-ons for 6 months\" or \"End promotion now\". Free events still can't use add-ons, and any explicit per-org or per-event override still takes precedence."
        ]
      },
      {
        "id": "op-addons",
        "icon": "🧩",
        "title": "Grant or deny add-ons per organization",
        "steps": [
          "Console → Add-on Access: search for the organization or event you need.",
          "Manage add-ons on an organization opens an override editor per add-on — Grant, Deny, or return it to normal billing rules.",
          "Organization-level grants apply to all of that org's current and future events, not just one.",
          "Use this for one-off exceptions (a customer needs Planner early, or should never get a specific add-on) rather than the blanket Console → Pricing promotion, which affects everyone."
        ]
      },
      {
        "id": "op-platform",
        "icon": "⚙️",
        "title": "Platform-wide settings",
        "steps": [
          "Console → Support chat: toggle whether the in-app support chat widget is visible to organizers platform-wide.",
          "Console → Usage: aggregated usage stats across all organizations.",
          "Console → QA checklist: view results submitted from the staging QA checklist tools.",
          "Console → Referrals and Affiliate stores: manage referral tracking and affiliate storefronts.",
          "Console → Org Plans: view and adjust organization-level subscription plans (distinct from per-event Event Pass tiers)."
        ]
      },
      {
        "id": "op-operators",
        "icon": "👤",
        "title": "Manage operators",
        "steps": [
          "Console → Operators: lists all accounts with platform superadmin access.",
          "Add an operator: enter their email address. They must already have a Festio account.",
          "Revoke an operator: removes their superadmin access. You cannot revoke your own access.",
          "Keep the operator list minimal — operator accounts have unrestricted access to all organisations and data."
        ],
        "warn": "Only grant operator access to trusted team members. Operators can view, modify, and delete any organisation's data."
      }
    ]
  }
}
