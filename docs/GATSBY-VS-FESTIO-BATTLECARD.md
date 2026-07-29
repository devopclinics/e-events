# Gatsby vs Festio Battlecard

## Purpose
Use this card during discovery, demo, and proposal stages when prospects compare Festio with Gatsby. Rewritten 2026-07-24 against Gatsby's actual site content (gatsby.events, /pricing/, /platform/) and Festio's real codebase — replaces an earlier generic draft that wasn't grounded in either. Open gaps identified here are tracked in `GATSBY-GAP-BACKLOG-JIRA.csv`.

## One-line Positioning
Gatsby is a premium, invite-only relationship-events tool for VC/PE and executive-relations teams, sold on trust (SOC 2, CRM sync, real-inbox sending) at custom-quote pricing. Festio covers that same curated-event motion plus day-to-day operational depth (paid ticketing, multi-channel messaging, community, venue analytics) at published, self-serve pricing.

## Who Gatsby Actually Is (verified facts)
- Tagline: *"Curate the room, not the crowd."* Core pitch: invitations sent from a team's real Gmail/Outlook inboxes, RSVP pages that look like the org, everything flows back to the CRM.
- Named ICP: VC and PE firms, R1 universities, membership networks, enterprise marketing teams — specifically executive dinners, LP meetings, "Fortune 500 CEOs, institutional LPs, and heads of state."
- Stats they publish: 6,580+ events in 2025, 3.1M+ emails sent. One testimonial: *"If I could design my dream event platform, it would be Gatsby"* — Head of Marketing, Define Ventures.
- Named integrations: Affinity, Salesforce, Altvia, Attio, Zoom, Webhooks & Zapier, Gatsby API, Gatsby MCP (limited release).
- Security: SOC 2 Type II certified; Google Workspace SSO.
- Pricing: no public tiers or numbers. "Pricing scales with team size and event volume," "no per-guest fees," "most teams pay annually" — everything gates to "Talk to us" / "Book a demo." Base plan reportedly includes guest profiles, real-inbox invites, calendar invites, branded RSVP, seating/check-in/badges, SOC 2, Google SSO. API access, CRM/premium integrations, guest mobile app, and custom domain are add-ons with no listed price.
- Feature set as named on their platform page: Guest Lists, Contact Lists, Families, Tasks, Calendars, Contact Profiles, Registration Links, Landing Pages, Forms & Surveys, Capacity & Waitlists, Ticketing, Email Campaigns (Sender Settings, Confirmation Emails, Reminders), Check-In, Badge Printing, Seating Charts (drag-and-drop), Guest App (with push notifications), Apple Wallet Pass (limited release), Overview reporting.

## Ideal Customer Profile Fit

### Gatsby appears strongest when
- Buyer is a VC/PE, university advancement, or executive-relations team running high-touch invite-only events.
- SOC 2 / formal security certification is a hard procurement gate.
- Deep Salesforce or Affinity sync is a must-have on day one.
- Team wants a fully custom, sales-led quote and isn't price-sensitive.

### Festio appears strongest when
- Team needs curated events *and* broader day-to-day operations (paid ticketing, meals, seating, venue access, community) in one place.
- Buyer wants to see real pricing before a sales call (`/pricing` is public — Gatsby has no equivalent).
- Team needs messaging beyond email — SMS and WhatsApp matter, not just inbox delivery.
- The event has revenue attached (ticket sales) — Gatsby has no checkout/payments at all.
- Team wants an ongoing guest community (FestioMe), not just a one-off guest list.

## Head-to-Head: What Buyers Care About
| Decision Area | Gatsby (verified) | Festio (verified) | Proof To Show |
|---|---|---|---|
| Event philosophy | "Curate the room, not the crowd" | Same curation controls (categories, invitation-only RSVP) plus paid ticketing, meals, seating, and venue analytics in the same product | Invite categories, RSVP funnel, check-in, Results dashboard |
| Invitations | Sent from staff's real Gmail/Outlook inbox, per-sender reply/bounce tracking | Sent from one system sender; no per-staff inbox sending yet (tracked gap) | Show current sender config; be upfront this is a roadmap item, not shipped |
| Guest profiles | Persistent contact profiles + "Families" household grouping | Persistent guest records; no household/family grouping yet (tracked gap) — grouping today is seating-based (Table Groups) | Guest history, Table Groups |
| Registration & forms | Registration links, adaptive forms, capacity + waitlist w/ promotion | Branded RSVP pages, per-field required/optional forms, invitation categories + auto-seating; capacity caps exist, automated waitlist promotion does not yet (tracked gap) | Live RSVP form, category/auto-seating demo |
| Calendar invites | Calendar-invite integration | `.ics` generation exists in code today, but only wired into the demo flow, not real guest invite/RSVP emails yet (tracked gap, 3 points, cheap to close) | N/A until closed — don't claim this live yet |
| Day-of check-in | QR/tap/search, real-time walk-in add | QR/tap/search, walk-ins, multi-zone entry via Venue Access Intelligence (zones, occupancy/flow/peak analytics) — Gatsby has no equivalent to zone-level analytics | Live check-in, Results dashboard, Venue Access analytics |
| Badges & passes | On-arrival badge printing; Apple Wallet pass (limited release) | Digital ticket/FestioHub pass only — no physical badge printing, no Wallet pass yet (both tracked gaps) | Be upfront; don't claim printing or Wallet support |
| Seating | Drag-and-drop chart, dietary/context visible | Drag-and-drop floor plan, Table Groups with priority-seating rules and per-category table mapping | Floor plan demo |
| Messaging | Email only (campaigns, confirmations, reminders) | Email + SMS + WhatsApp, per-event template overrides, quiet hours/rate limits | Guest Communication demo across channels |
| Guest app | Native "Guest App" with push notifications; Apple Wallet limited release | FestioHub (web, no install) with live program/activity/food menu; native app + push exists in staging, not yet turned on for guests | FestioHub live view |
| Community | None found | FestioMe: sub-groups, join policies, private channels, DMs, staff push into group | FestioMe demo |
| Payments/ticketing | "Ticketing" listed as a feature name; no payment processor or checkout flow found on their site | Real paid ticket checkout via Stripe and Paystack | Live checkout flow |
| CRM sync | Salesforce, Affinity, Altvia, Attio — real two-way sync | None yet (tracked gap, backlogged as two separate epics) | Be upfront; frame as roadmap, don't demo something that doesn't exist |
| API / automation | Public API, Gatsby MCP, Zapier/webhooks | Internal API only; no external API-key auth, no outbound webhooks yet (tracked gaps) | Be upfront |
| Security trust | SOC 2 Type II certified, Google Workspace SSO | No SSO yet, no formal cert yet (both tracked gaps — SOC 2 readiness assessment is first backlog item) | Be upfront; lead with current controls instead |
| Pricing model | Fully custom, sales-gated, no public numbers | Public pricing page (`/pricing`), no demo required to see cost | Show `/pricing` live in the call |
| Task management | "Tasks" listed as a base feature | None yet (tracked gap) | Be upfront |

## Where We Win
- Any deal where ticket revenue, meals/logistics, venue-zone analytics, or an ongoing guest community (FestioMe) matter — Gatsby has none of these.
- Buyers who want to see real pricing before booking a sales call.
- Teams that need SMS/WhatsApp, not just email.
- Multi-day, multi-track programs needing per-session attendance, not one blended number.

## Where We Are Vulnerable (real, not hedged)
- **SOC 2 Type II** — Gatsby has it; we don't. This is the single most likely deal-blocker for VC/PE and university buyers. First item in the gap backlog for a reason.
- **CRM-native sync** (Salesforce/Affinity) — if a buyer's workflow lives in one of these and turnkey day-1 sync is non-negotiable, we lose today.
- **SSO** — any buyer with an IT security policy requiring SSO for all vendor logins will flag this immediately.
- **Real-inbox sending** — relationship teams who care that the invite literally comes from a named partner's Gmail, not a system sender, will notice.
- **Badge printing / Apple Wallet** — lower-stakes, but Gatsby has both; we have neither yet.
- Do not claim any of the above are "in progress" unless actually staffed — see `GATSBY-GAP-BACKLOG-JIRA.csv` for what's actually ticketed.

## Discovery Questions That Create Separation
- Is a SOC 2 Type II certificate a hard requirement to sign, or a nice-to-have?
- Does your workflow require Salesforce or Affinity sync from day one, or can that phase in?
- Do any of your events sell tickets, track meals to a gala, or need venue zone/occupancy data? (Gatsby has none of this.)
- Do you need an ongoing guest community between events, or is each event a one-off list?
- How important is seeing real pricing before a sales conversation?
- Do your invites need to visibly come from a named staff member's own inbox, or is a branded system sender acceptable?

## Objection Handling

### Objection: "Gatsby has SOC 2 and you don't."
Response: Acknowledge directly — this is real and currently a gap, not something to spin. Share the certification timeline once the readiness assessment (first item in the gap backlog) produces one. Do not imply a cert is closer than it is.

### Objection: "We need Salesforce/Affinity sync from day one."
Response: Acknowledge it's not built yet. If the deal is winnable on a phased basis, propose manual export/import as a bridge while sync is built (backlogged, dependent on the public API work landing first).

### Objection: "Gatsby feels more premium / relationship-native."
Response: Fair on invite/curation feel — that's their core strength. Redirect to what happens after the invite: ticketing, meals, seating, check-in, venue analytics, and an ongoing guest community, none of which Gatsby has at all.

### Objection: "We don't want pricing surprises."
Response: Point to the live `/pricing` page — no demo gate required, unlike Gatsby's fully custom-quote model.

## Competitive Traps To Avoid
- Don't claim SOC 2, SSO, CRM sync, real-inbox sending, badge printing, or Apple Wallet support — none exist yet. All are honestly listed in `GATSBY-GAP-BACKLOG-JIRA.csv`, not shipped.
- Don't claim the .ics calendar invite is live on real guest emails — it currently only fires in the demo flow.
- Don't disparage Gatsby's curation strength — it's real and well-executed; compete on what happens after the invite instead.
- Don't position Festio as ticketing-only — anchor on curated relationship events plus full operational depth.

## Demo Flow To Beat Gatsby Narrative
1. Curated invite: categories, branded RSVP, per-field forms.
2. Day-of execution: check-in, walk-ins, multi-zone entry, live Results dashboard.
3. What Gatsby doesn't have: paid ticket checkout, meal/order tracking to gala night, priority seating via Table Groups, FestioMe community.
4. Close on pricing: show `/pricing` live, no quote gate.

## Pricing and Packaging Guidance
- Lead with the public `/pricing` page — it's a real, verifiable differentiator against Gatsby's fully-gated model.
- Where a prospect specifically needs SOC 2/SSO/CRM sync now, be honest about timeline rather than over-promising a close date.

## 30-Second Sales Talk Track
Gatsby is great at getting the right people into the room. Festio does that too, and then runs the entire event on top of it: tickets, meals, seating, check-in, venue analytics, and a guest community that lasts past the event — all visible on a pricing page you can check right now, no sales call required.

## Red-Flag Deal Signals
- Buyer requires SOC 2 Type II or SSO to sign, with no phased-rollout tolerance.
- Buyer's workflow is fully dependent on turnkey Salesforce/Affinity sync from day one.
- Buyer's only stated need is "invitations that look like they came from our own inbox" with no interest in operational features.

## Attach This To Every Competitive Deal
- This battlecard.
- `GATSBY-GAP-BACKLOG-JIRA.csv` (so nobody promises a gap item as shipped).
- Live pricing page walkthrough.
- Feature proof checklist from the head-to-head table above.
