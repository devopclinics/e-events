# EventQR — Go‑to‑Market & Commercialization Plan

_Status: living document. Last updated 2026‑06‑06._

Decisions locked for v1:

- **Target:** broad / horizontal — tiers self‑select across weddings, pro planners, corporate.
- **Market:** US **and** Africa (dual billing + currency from day one).
- **Pricing model first:** **per‑event passes** (subscriptions come later).

---

## 1. The blocker: the app is single‑tenant today

There is no tenant boundary in the codebase:

- `User.role` is global. `"admin"` is a **platform‑wide superuser** — it sees every
  event (`events.py:list_events` returns all events for admins;
  `_get_accessible_event` lets admins bypass the per‑event check).
- `"official"` users are scoped to events via the `EventUser` junction.
- There is **no Organization/Account entity** — all events share one flat pool.

Consequence: one customer's admin could read another customer's guest list (names,
emails, phones). This is a **privacy/PII launch blocker**, not just UX. Multi‑tenancy
(Phase 1) must ship before any paying customer. See `PHASE1-MULTITENANCY-PLAN.md`.

## 2. Positioning

The differentiator is **day‑of operations**, not ticketing: QR check‑in, live
admission, seating / meal service / VVIP, **multichannel invites incl. WhatsApp**,
and self‑RSVP — in one tool.

| Segment | Incumbents | Gap to exploit |
|---|---|---|
| Public / ticketed | Eventbrite, Luma | Weak on private guest lists, seating, check‑in ops |
| Weddings / social | Zola, The Knot, Joy, RSVPify, Greenvelope | Website‑led; little day‑of check‑in/seating/catering |
| Corporate / conf | Cvent, Bizzabo, Whova | Heavy, expensive, enterprise‑only |
| SMB events | Guest Manager, Hobnob | Thinner ops + weak WhatsApp |

**The wedge:** mid‑market **private/cultural events** (weddings, galas, conferences)
needing **WhatsApp‑first invites + QR check‑in + seating/catering** together.
WhatsApp as a default channel is a real edge in markets US‑centric tools underserve
(the Bird/WhatsApp + 10DLC groundwork already points here).

## 3. Pricing & packaging

Load‑bearing truth: **SMS/WhatsApp are real COGS** — no "unlimited messaging."
Email is ~free. So: **per‑event pass for features/caps + prepaid message credits.**

- **Free** — create org, build guest list, design + preview the invite page,
  email‑only up to ~25 guests, EventQR branding. (Sells the product by doing.)
- **Event Pass (one‑time, per event)** — unlocks: send invites at scale,
  **SMS/WhatsApp channels**, the guest‑tier cap, **QR check‑in / day‑of ops**,
  remove branding. This bundle = "run this event for real."
- **Message credits** — each pass includes some; top‑up packs are extra one‑time
  purchases; email included. Credits also rate‑limit abuse.
- **Later:** Pro / Business **subscriptions** for recurring organizers (multiple
  events, seats, white‑label) — reuse the same entitlement + provider layer.

### Illustrative tiers (validate before launch)

| Guests | US (Stripe) | Africa (Paystack) | Included credits |
|---|---|---|---|
| ≤50 | $29 | ₦25k | small |
| ≤150 | $59 | ₦55k | medium |
| ≤300 | $99 | ₦95k | larger |
| 300+ | $149+ | custom | larger + |

## 4. Billing mechanics (dual region)

- **Payment‑provider abstraction** from day one: one interface, two implementations —
  **Stripe** (US/global, USD, cards) and **Paystack/Flutterwave** (Africa, NGN,
  cards/bank/USSD). Both call back into a single webhook handler that writes the
  **same** entitlement to the event/org; the rest of the app is provider‑agnostic.
- **Multi‑currency price book**: each tier defined in USD and NGN; selected by the
  org's region/currency at signup.
- **Per‑event passes + prepaid credits need NO subscription infra for v1** — only
  one‑time Checkout sessions + webhooks + an entitlement record.
- Compliance split is already half‑built: US SMS → 10DLC; Africa → WhatsApp‑first
  via Bird. Same credit model, different default channel per region.

## 5. Operating multi‑tenancy

Per‑org usage metering & limits; **audit log** (esp. operator impersonation —
consented + logged); automated **tenant‑isolation tests in CI**; per‑org sender
identity + opt‑out handling; GDPR data export/delete per org; per‑tenant error
attribution.

## 6. Build sequence

1. **Tenancy foundation** (Org + Membership + `org_id` scoping + signup + live‑data
   backfill + isolation tests). *Blocks everything.* → `PHASE1-MULTITENANCY-PLAN.md`
2. **Per‑event entitlements** (`paid_tier`, `guest_cap`, `channels_enabled`,
   `message_credits` on Event; gate free→paid behaviors).
3. **Pass billing** (provider abstraction; Checkout + webhook → entitlements;
   prepaid credit packs).
4. **Messaging metering** (decrement credits on send; block at zero; email exempt).
5. **GTM polish** (dual‑currency pricing page, onboarding, white‑label add‑on).
6. **Subscriptions** (Pro/Business) — reuse provider + entitlement layer.

## 7. Principles

- Don't gate the "wow" behind signup — let free users build and preview a full
  invite page + guest list; charge to send / check‑in.
- Tenancy is a prod‑data migration on a live DB — plan it; don't patch it.
