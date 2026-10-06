# Event App — fifth GuestHub layout

Implemented 2026-10-06. This is an opt-in layout (`guest_hub_layout: app`), alongside Classic, Companion, Journey and Complete Flow. An unset setting still follows the existing Classic behavior. No event was changed or deployment performed by this implementation.

## Configure

In Guests → Invites & RSVP → GuestHub layout, select **Event App**, then **Save display settings**. Enable the services and publish the programme using their existing event settings. Enable the layout on a staging test event before selecting it for a production event.

## Guest experience

- Home, Programme, My Pass, Inbox and More share one responsive shell. Main screens and session details have hash routes with Back/Forward and reload support.
- Home priorities come from actual registration/admission, actionable requirements and the next scheduled session. After the configured closing date it directs guests to published feedback and resources. An explicitly ended/inaccessible event still follows the existing server access rules; the layout does not reopen expired links.
- Enabled Live Activities, FestioMe and Meals appear in a dedicated service row on every screen. They use existing guest routes and preserve identity. They are not buried under More. The service row scrolls away on phones.
- Programme dates use the event timezone, with day selection and search across title, room, speaker and age group. A programme entry never grants admission.
- My Pass includes an authorized party selector, assigned seating and a link to the existing full pass utilities. Junior passes explain that pickup requires the guardian's own credential and offer a switch back to that credential.
- Party status is the last recorded permitted scan, with a timestamp, not live location tracking. A denied scan cannot change this status. Collected requires a recorded guardian handoff. Missing status is described as unavailable.
- Inbox separates announcements, outstanding actions and organizer conversations. It does not invent unread counts.
- Existing consent, organizer message, feedback, resource and guardian controls remain the data owners. Consent shows the actual form/version and is not signable before admission.
- Branding reads Design Studio primary/accent colors and the event logo. The rail uses plain GuestHub text; it does not invent a Festio logo. System fonts are intentional. No prayer times or room have been invented.

## Data and access

`GET /api/invite/token/{invite_token}/app-party` returns only the current guest, their submitted invitees (unless the current guest is a configured junior), and juniors for whom they have a usable guardian authorization. Every query is event-scoped. Being in the same party alone does not expose another attendee's pass. Unconfirmed/unadmitted attendees on RSVP events do not receive a QR credential from this endpoint. The response is `no-store, private`.

The new endpoint runs with the existing 25-second hub refresh; it does not start another polling loop. Scan and guardian authorization rules are unchanged. `EventBrief` now includes the selected layout so the meal/pass surface can retain its Back to GuestHub link even when a pass template hides the ordinary hub button.

The existing nullable string database column accepts `app`; no model migration was added. Verify the deployed database schema and services during staging review.

## Deferred and validation limits

Offline pass persistence is **disabled**. Automatic approval review rejected storing QR credentials locally and adding an offline viewer because the prototype deferred that security-sensitive feature. The pass says “Offline copy not prepared”; no new offline credential store or viewer was added. Existing application caching behavior was not changed. Offline cold-start, wallet export and real-device connectivity are not claimed.

Safari, Edge and physical devices have not been tested. Production APIs, message delivery, real consent submissions and staging integration were not exercised. Dedicated Live/Me/Meals functionality remains its existing implementation; fixture tests verify the GuestHub links and controls, not an end-to-end multi-service production rehearsal.

## Verification

- 32 backend checks: new layout setting persistence/access, authorized party credentials, event isolation, latest allowed scan/handoff status, and existing experience/guardian tests.
- 8 frontend model checks: routing, phase, programme ordering, admission-gated consent, credential visibility, service visibility, safe external links and reentry status.
- 36 Chromium browser checks against the real production bundle with fully intercepted API fixtures: desktop/phone, Back/Forward, deep links/reload, service discovery, party pickup, original message/feedback/consent handlers, preview safety, lifecycle/error states and all four existing layouts.
- Phone Home at 390×844: no horizontal overflow, no visible text below 12px, no tap targets below 44×44; header 76px + bottom navigation 66px. Other primary phone screens also fit horizontally.
- Vite build and API-contract drift gate pass. The generated OpenAPI/types refresh also reconciles older backend additions already present before this feature; those generated-file changes do not introduce new runtime capabilities.

Browser check (build frontend first):

```sh
FESTIO_APP_BUILD=/path/to/frontend/dist FESTIO_APP_ARTIFACTS=/tmp/event-app-review python3 frontend/tests/guesthub-app.browser.py
```

Focused checks from `event-checkin`:

```sh
python3 -m pytest backend/tests/test_guesthub_event_app.py backend/tests/test_experience_guest_hub.py backend/tests/test_junior_guardian_handoff.py -q
node --test frontend/tests/guesthub-app.test.mjs
CONTRACT_EXPORT_MODE=local bash frontend/scripts/check-api-contract-drift.sh
```
