# FestioMe — In-App Group Chat Module (Plan)

> Replaces an earlier design that treated FestioMe as a separate microservice. The actual
> intent is a **GroupMe-style group-chat feature built directly into the Festio app**
> (`event-checkin`). This plan reflects that.

## 1. What FestioMe is

FestioMe is group messaging **inside** Festio — the GroupMe pattern: create a group, add
members, send text and photos, "like" (heart) messages, reply, @mention, mute or leave.
Groups can be **event-linked** (auto-created for an event, members are its guests) or
**independent** (any Festio user, no event required).

**Terminology.** *Event-linked groups* are connected to a Festio event and its guests.
*Independent groups* are created without an event but still hosted inside Festio. FestioMe
is a module of Festio — never a "standalone service" or separate product.

**Governing principle:** FestioMe is an in-app **module**, not a service. It ships in the
existing backend, database, real-time channel, storage, auth, and deploy pipeline. Its only
boundary is a clean code package with its own tables — enough to keep it a self-contained,
rewritable unit, not enough to pay for a second stack.

## 2. Goals and non-goals

**Goals**
- Let guests and organizers talk during an event — announcements, Q&A, coordination.
- Let any Festio user run an independent group.
- Real-time text + photo messaging with likes, replies, mentions, mute, and leave.
- Reuse Festio's SSE, auth, storage, and messaging/credits — no new infrastructure.
- Keep guest join frictionless: guests join via their existing pass link, no new signup.

**Non-goals (deliberately out of scope)**
- A separate service, database, Redis, domain, or deploy pipeline.
- Cross-service contracts: outbox/inbox, signed webhooks, dead-letter queues, circuit
  breakers, service credentials, versioned integration APIs. In-process this is a function
  call, not a distributed system.
- Threads, roles/permission matrices, moderation queues, org-wide search — GroupMe stays flat.
- Native mobile apps and inbound SMS-to-group bridging (revisit later, not MVP).

## 3. Feature set

| Area | In scope (MVP → v1) | Later / optional |
|---|---|---|
| Groups | Create, rename, avatar, event-linked or independent, mute, leave, archive | Group discovery |
| Members | Add by invite link, roles (owner/admin/member), nicknames, remove | Bulk import |
| Messages | Text + image/file, reply-to, edit, delete (tombstone) | Voice notes, GIF search |
| Reactions | "Like" (heart), like count + who liked | Full emoji reactions |
| Mentions | @member, @all (admin) | — |
| Direct messages | 1:1 DM between members | Group DMs |
| Read state | Per-member `last_read_at` + unread badge | Per-message receipts |
| Notifications | In-app (SSE) → email digest → web push | Mobile push, SMS bridge |
| Moderation | Report, mute, remove, block, leave + audit log | Word filters, auto-moderation |

## 4. Where it lives (module boundary)

**Backend** — a dedicated package: `backend/app/festiome/` (models, routers, services,
authorization). Routers mount under `/api/v1/festiome/*`. It **may** use shared infrastructure
(DB session, Redis/SSE, Firebase auth verification, MinIO, the messaging/credits services) but
**must not** import event business logic. Event↔chat interaction goes through one adapter:
`festiome/integration.py`.

**Tables** — all prefixed `festiome_` (or a dedicated `festiome` Postgres schema). Cross-links
to events/guests are **opaque string references** (`event_id`, `guest_id`), never foreign keys.

**Boundary guard** — a CI test that fails if `app/festiome/*` imports event modules (or the
reverse, outside the adapter). This keeps the seam honest under deadline pressure.

**Frontend** — a new "Community / Chat" section in the Festio app (and a chat panel inside the
event admin). Served on the same domain; `me.festio.events` may route to the same backend if a
distinct entry point is wanted — no separate deployment.

## 5. Data model (~6 tables)

- `festiome_group` — `id, event_id?（nullable → independent）, org_id?, name, avatar_url,
  created_by, is_archived, settings(json), created_at`
- `festiome_member` — `id, group_id, user_id?, guest_ref?, role(owner|admin|member),
  nickname, is_muted, last_read_at, joined_at, removed_at?`  (identity is a Festio user **or**
  an event guest via pass token)
- `festiome_message` — `id, group_id, sender_member_id, body, parent_id?（reply）, edited_at?,
  deleted_at?, created_at`  (indexed on `(group_id, created_at)` for cursor pagination)
- `festiome_attachment` — `id, message_id, kind(image|file), url, mime, size, meta(json)`
- `festiome_like` — `(message_id, member_id)` unique — the "heart"
- `festiome_invite` — `id, group_id, token, role, expires_at, max_uses, uses, created_by`

Read state is `festiome_member.last_read_at` (GroupMe-style) — an unread count is a single
`count(created_at > last_read_at)`, no per-message receipt fan-out.

## 6. Identity & authorization

- **App users** authenticate with the existing Firebase token.
- **Event guests** join via their existing pass link (`invite_token` / `qr_token`) — this mints
  or resolves a `festiome_member` bound to that guest, **no separate account required**.
- Group roles (owner/admin/member) are **independent** of event/org roles — being an org admin
  does not make you a group admin.
- Every query is **group-scoped and authorization-checked server-side**; membership is the gate.
- Service reuse: token verification is shared; the authorization *policy* is FestioMe's own.

## 7. Real-time

Reuse the existing Redis **SSE fan-out** (already multi-replica safe). Message send is:

```
1. Persist the message in a transaction.
2. Publish a fan-out event on the group's channel: message.created / message.liked /
   member.joined / message.deleted / typing.
3. Connected members' SSE streams receive it; offline members fall to notifications.
```

No new gateway, no outbox — a dropped fan-out just means the client re-fetches on reconnect
(cursor by `created_at`). Presence/typing are best-effort ephemeral events, not persisted.

## 8. Event integration (in-process adapter)

`festiome/integration.py` is the only bridge, called by event code:

- **Auto-create** a group when an event enables FestioMe (or on first confirmed guest).
- **Member sync**: confirmed guests become members; cancellations remove them. Called from the
  existing guest lifecycle — a direct function call, idempotent, no queue.
- **Join link / QR** added to invitations and the Festio Pass (reuse the pass token).
- **Organizer posts**: schedule/Experience updates post to the event group.
- **Urgent escalation**: an admin can mark a message "notify by SMS/WhatsApp" → routed through
  the **existing messaging + credit-ledger pipeline** (SignalHouse/Bird), credit-gated and
  consent-checked exactly like other sends. This is the one real tie-in worth building.

## 9. Notifications

Order of delivery, simplest-reliable first:
1. **In-app** — SSE + unread badges (free, already have the transport).
2. **Email digest** — batched "you missed N messages in X" via the existing email service + a
   worker role on the backend image (same pattern as the sync poller).
3. **Web push** — VAPID + service worker. Genuinely new; note iOS Safari is unreliable. Defer.
4. **SMS/WhatsApp** — only the admin "urgent escalation" path (§8), never per-message.

Per-member notification preferences (`all / mentions only / muted`) stored on `festiome_member`.

## 10. Moderation, safety, privacy

- Member controls: **report, mute, block, leave**; admin controls: **remove member, delete
  message, close group**.
- **Immutable audit log** for moderation + admin actions.
- **Rate limiting / anti-spam** on messages, invites, and uploads (extend the existing
  event_code-keyed limiter).
- **Media**: allowlist types, size cap, virus scan, short-lived signed URLs; thumbnail images.
- **Privacy**: retention window, export, and delete-my-data honoring the platform's roadmap
  (GDPR / Swiss nLPD). Don't expose the event guest list to ordinary members.
- **Localization**: RTL + Arabic first-class (message rendering, member names, timestamps).
- **Child safety**: a dedicated review before enabling FestioMe for school/youth events.

## 11. Reliability (in-process, right-sized)

- Message + fan-out in one transaction; on fan-out failure the message still persists and
  clients recover on reconnect.
- Degrade gracefully: if Redis/SSE is down, the chat falls back to short-interval polling of the
  message cursor. If the messaging provider is down, escalation queues/retries but chat is
  unaffected.
- No outbox/inbox, no dead-letter, no circuit breakers — there is no service boundary to protect.
- Covered by the existing backup/restore policy (shared database).

## 12. API surface (`/api/v1/festiome`)

```
POST   /groups                          GET /groups
GET    /groups/{id}                     PATCH /groups/{id}
POST   /groups/{id}/invites             POST /invites/{token}/join
GET    /groups/{id}/members             PATCH /groups/{id}/members/{mid}   DELETE …
GET    /groups/{id}/messages?cursor=    POST /groups/{id}/messages
PATCH  /messages/{id}                   DELETE /messages/{id}
POST   /messages/{id}/like              DELETE /messages/{id}/like
POST   /groups/{id}/read                POST /messages/{id}/report
POST   /dm/{user_id}                    (open/get a 1:1 DM group)
GET    /events/{event_id}/festiome/status   (admin: is a group linked, member count)
```

Uploads reuse the existing signed-upload flow to MinIO.

## 13. Observability

Reuse existing structured logs + metrics; add: messages/min, active groups, SSE fan-out lag,
upload errors, escalation send outcomes. No new stack.

## 14. Delivery phases

**Slice 1 — Event group chat (MVP).** Auto-create a group per event; members = confirmed
guests joining via pass link; text + photo messages; likes; reply; mute/leave; live over SSE;
organizer can remove members / delete messages; report. *Exit: guests can talk during an event.*

**Slice 2 — Independent groups.** Signup/existing users create groups, invite by link, roles,
member management. *Exit: FestioMe works without an event.*

**Slice 3 — Richer messaging.** Mentions, DMs, edit/delete polish, unread badges, in-app +
email-digest notifications, basic search (Postgres full-text on `body`).

**Slice 4 — Escalation + reach.** Admin urgent-escalation to SMS/WhatsApp via existing pipeline;
web push. *Optional later:* SMS-to-group bridge, polls, group calendar.

## 15. MVP acceptance criteria

- FestioMe ships in the existing backend/deploy — no new service or database.
- Lives in `app/festiome/` with `festiome_`-namespaced tables; the boundary-guard test passes.
- An event auto-links a group; confirmed guests join via their pass link with no new account.
- Members send text + photos, like, reply, mute, and leave; updates arrive live via SSE.
- Organizers can remove members and delete messages; actions are audit-logged.
- Group-scoped authorization negative tests pass (non-members can't read or post).
- Chat degrades to polling if SSE is unavailable; the event's other features are unaffected.
- Rate limits and media type/size limits are enforced.

## 16. Effort note

This is a feature, not a platform — sized for the existing team. Slice 1 is the bulk of the
value and the right first commit; sequence the rest, don't parallelize. The hard parts are
**moderation/abuse, notification reliability, and RTL** — not infrastructure, which you already
have.

## 17. Immediate next actions

1. Approve this in-app scope; the earlier separate-service plan has been removed.
2. Scaffold `backend/app/festiome/` — the 6 tables, authorization layer, router skeleton, and
   the boundary-guard test.
3. Build Slice 1 (event group chat) end-to-end over the existing SSE fan-out.
4. Add the event-integration adapter (auto-create group, guest join via pass link).
5. Wire the admin urgent-escalation path into the existing messaging/credit pipeline.
6. Pilot on one live event before expanding to independent groups and notifications.
