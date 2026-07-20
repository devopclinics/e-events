# FestioMe + Guest Communication unified plan

## Objective

Make FestioMe the guest's community overview while keeping Guest Communication as the organizer's existing control plane and source of truth. The integration must surface permitted content without merging channels, duplicating conversations, changing RSVP/check-in, or exposing private messages.

Mockup: `docs/mockups/festiome-guest-communication-unified-v4.png`

## Product boundary

### Guest Communication remains responsible for

- Feature switches and guest eligibility.
- Organizer announcements and their audience rules.
- Shared Guest Chat and guest posting permission.
- Private guest-to-host threads and organizer replies.
- Existing FestioHub presentation.

### FestioMe remains responsible for

- Community Home and navigation.
- Native FestioMe groups and channels.
- FestioMe direct messages, profiles, discovery, moderation and notifications.
- A personalized overview of other permitted communication sources.

FestioMe Home is an aggregation/read-model layer. It does not turn all communication into one channel.

## Source-to-surface contract

| Existing source | FestioMe surface | Action destination | Visibility |
|---|---|---|---|
| Event Updates (`event_announcements`) | Event announcement card/feed item | Announcement detail | Existing audience filter: attending, invited, declined, checked-in or not checked-in |
| Guest Chat (`group_chat`) | `# General` preview labeled `Guest Chat` | Existing Guest Chat conversation | Only when Guest Chat is enabled and the guest is eligible |
| Guest posting permission (`guest_chat_posting_enabled`) | Enables/disables composer in Guest Chat | Existing Guest Chat composer | Same audience rules as Guest Chat |
| Message Host (`direct`) | Locked private notification/preview | Existing private host thread | Current guest and authorized organizers only |
| FestioMe native groups/channels | Groups and native conversation previews | Selected FestioMe channel workspace | FestioMe membership and channel permissions |
| FestioMe native direct messages | Messages badge/inbox | FestioMe DM | Thread participants only |

### Naming correction

The current organizer card called **Guest Posts** maps to `guest_chat_posting_enabled`; it is not a separate post/feed store. Rename the card to **Guest posting** with the help text “Allow guests to post in Guest Chat.” A standalone Event Feed composer should not be presented as an existing capability until a separate public-post model is deliberately introduced.

## Toggle behavior

| Toggle state | FestioHub | FestioMe |
|---|---|---|
| FestioHub off | Existing hub is hidden | Does not disable native FestioMe; Guest Communication projections are hidden unless product policy explicitly requires the hub |
| Event Updates off | Updates hidden | Announcement cards and update feed hidden |
| Message Host off | Private host entry hidden | Host message card and entry point hidden; existing threads retained |
| Guest Chat off | Shared chat hidden | `# General` Guest Chat preview and route hidden |
| Guest posting off | Chat becomes read-only | Composer hidden/disabled; reading remains available |
| FestioMe off | No FestioMe entry | Existing FestioHub and Guest Communication continue unchanged |

Disabling a feature hides entry points; it must not delete historical messages or alter RSVP, ticket, QR or check-in eligibility.

## Experience design

### Organizer

Keep the current Guest Communication page and its workflows. Apply only these clarity changes:

1. Rename **Guest Posts** to **Guest posting**.
2. Add a small “Shown in FestioMe” status beside enabled features when FestioMe is active.
3. Preserve the current announcement composer, audiences and Guest Questions Inbox.
4. Add a permanent assurance: “Messaging never blocks RSVP, tickets or check-in.”

### Guest FestioMe Home

Use the approved conversation-first structure:

1. Explicit navigation: Home, Event feed/updates, Groups, Messages and Profile.
2. Composer only when there is a valid write destination and the guest has permission.
3. “Happening now” cards show a source badge such as `Guest Chat`, `Event Updates` or `FestioMe Group`.
4. Public/shared and private content are visually distinct.
5. Message Host uses a lock and “Only you can see this.”
6. Opening a card routes to its owning conversation; cards do not copy messages into another channel.
7. Mobile navigation may collapse into a bottom bar, but destinations and behavior remain identical.

## Technical design

### 1. Add a normalized Home read model

Add an authenticated endpoint for the current guest/user, for example:

`GET /api/events/{event_id}/festiome/home`

Return normalized modules rather than raw cross-domain tables:

```json
{
  "capabilities": {
    "announcements": true,
    "guest_chat": true,
    "guest_chat_posting": true,
    "message_host": true,
    "native_groups": true
  },
  "announcements": [],
  "guest_chat_preview": null,
  "host_thread_summary": null,
  "native_group_previews": [],
  "unread": { "host": 0, "guest_chat": 0, "festiome_dm": 0 }
}
```

The endpoint must derive the guest identity server-side and apply audience/member checks before returning any module.

### 2. Use adapters, not a merged message table

Create source adapters with one normalized preview contract:

- `AnnouncementHomeAdapter`
- `GuestChatHomeAdapter`
- `HostThreadHomeAdapter`
- `FestioMeGroupHomeAdapter`

Each preview includes `source_type`, `source_id`, `destination`, `visibility`, `occurred_at`, and an opaque cursor. The destination is validated server-side; the client must not construct arbitrary thread URLs.

### 3. Preserve canonical ownership

- Guest Communication records remain canonical for announcements, Guest Chat and Message Host.
- FestioMe service records remain canonical for native groups, channels and DMs.
- Reactions, replies, reads and moderation write back only to the owning service.
- Home preview reads must not mark a message read. Mark read only after opening the destination.

### 4. Handle the existing announcement outbox

The code already queues `announcement.publish` through `festiome_outbox`. Preserve reliability, but prevent duplicate Home items:

- Carry stable `source_ref` and original announcement ID.
- Treat the FestioMe copy as a projection of the original, not a second announcement.
- Deduplicate Home by `(source_type, source_ref)`.
- Editing/deleting an announcement needs explicit update/withdraw commands or the Home read model must always prefer the canonical Guest Communication record.

Do not add Guest Chat or Message Host payloads to this outbox merely to populate Home; use permission-checked reads from their canonical records.

### 5. Authorization rules

- Guest token must be bound to event and guest ID.
- Announcement audience filters are evaluated on every read.
- `attending_only_chat` is enforced server-side.
- Direct host thread queries require `thread.guest_id == current_guest.id`.
- Native FestioMe previews require group/channel membership.
- Organizer preview mode must be explicitly flagged and must never impersonate a guest silently.
- Search must query each permitted source independently and return source labels; it must not broaden access.

### 6. Failure isolation

- If FestioMe service is unavailable, Guest Communication, RSVP, Ticket and Check-in continue working.
- If Guest Communication preview loading fails, native FestioMe groups still render with a non-blocking module error.
- Use per-source timeouts and partial results.
- Cache only capability metadata and public/shared previews; never shared-cache private host content across guests.
- Record source-specific latency/error metrics.

## Delivery phases

### Phase 1 — Contract and organizer clarity

- Rename Guest Posts to Guest posting.
- Document source/visibility mapping in code.
- Add stable source identifiers to announcement projections.
- Add endpoint schemas and authorization tests.

### Phase 2 — Read-only FestioMe Home

- Implement normalized Home endpoint and source adapters.
- Render enabled announcements, Guest Chat preview, private host summary and native groups.
- Add source badges and distinct destinations.
- Do not expose new posting behavior yet.

### Phase 3 — Safe interaction

- Route cards into their owning existing views.
- Enable announcement reads, Guest Chat replies, Message Host replies and native group actions through their current APIs.
- Enable composer only after its destination is selected and permissions are known.

### Phase 4 — Responsive polish and observability

- Implement desktop rail and mobile bottom navigation.
- Add loading, empty, disabled, offline and partial-failure states.
- Add analytics for module impressions and destination opens without logging message bodies.
- Add source latency, authorization-denial and outbox-deduplication dashboards.

### Phase 5 — Staging rollout

- Protect the unified Home behind `festiome_unified_home`.
- Enable it for internal staging events first.
- Compare counts and permissions against Guest Communication for representative event types.
- Run staff/guest acceptance testing.
- Keep instant rollback to the current FestioMe page; do not touch production.

## Required tests

### Authorization and privacy

- A guest cannot read another guest's Message Host thread or unread count.
- Attending-only updates/chat do not appear for declined or pending guests.
- Non-members cannot preview native group messages.
- Home previews do not mark messages read.
- Search and deep links enforce the same authorization as Home.

### Toggle matrix

Test all five Guest Communication controls independently and in combinations, with FestioMe enabled and disabled. Confirm that disabling hides surfaces without deleting data.

### Regression

- RSVP submission and status updates are unchanged.
- FestioHub access and existing URLs are unchanged.
- Ticket/QR rendering and admission are unchanged.
- Scanner/check-in, station actions and offline behavior are unchanged.
- Organizer announcements and inbox replies still work from the existing page.
- Existing FestioMe groups, channels, DMs, moderation and notifications still work.

### Event coverage

Validate free/paid, RSVP-disabled, public/private, small/large, multi-day, seated, section-scanning, child/family and checked-in-only events. Empty and high-volume communication histories must remain usable.

## Acceptance criteria

1. Every Home card displays its source and has exactly one valid destination.
2. No private content is placed in a public/shared module.
3. No Guest Communication conversation is copied into a FestioMe native channel.
4. Feature switches change visibility immediately while retaining history.
5. Audience and membership checks are enforced by the server, not only the UI.
6. A failure in either communication subsystem does not block RSVP, tickets or check-in.
7. The organizer continues using the current Guest Communication flow.
8. Desktop and mobile present the same capabilities and privacy semantics.

## Explicitly out of scope

- Production deployment.
- Replacing the organizer Guest Communication page.
- Migrating existing threads into FestioMe channels.
- Combining Message Host with FestioMe DMs.
- Creating a new standalone Guest Posts model in this iteration.
- Changes to RSVP, ticket generation, QR admission or check-in logic.
