# Festio release-certification runbook

This internal runbook complements the customer Help guide. The Help guide explains supported workflows; this document explains how authorized testers certify them safely. The canonical case list is `/media/festio-qa-checklist.html`.

## Test rules

1. Use staging, a disposable named event, and synthetic guests. Never use production data.
2. Use separate Owner/Admin, Staff A, Staff B, Staff C, confirmed guest, pending guest, and declined guest identities. Record exact roles and assignments.
3. Use only approved provider recipients, payment methods, failure switches, and high-volume fixtures.
4. Record event ID, guest ID, role, device/browser, event timezone, wall-clock time, URL, and screenshot or trace for every issue.
5. A UI restriction is not sufficient for authorization tests. Verify the corresponding API read or write is rejected server-side.
6. Mark a case Blocked when its prerequisite is unavailable. Never convert an unexecuted case into Pass.
7. Use N/A only for a documented unavailable/coming-soon feature, with the product reference in the note.
8. Export the checklist text report and JSON backup after each test session.

## Required test matrix

- Desktop: current Chrome, Firefox, Safari, and Edge.
- Mobile: current iOS Safari and Android Chrome on real devices for camera, push, installation, orientation, and large text.
- Accessibility: keyboard-only plus VoiceOver or NVDA; test 200% zoom, reduced motion, light/dark themes, and 320 px width.
- Identity: two organizations, two simultaneous staff devices, and isolated guest sessions.
- Providers: delivered, bounced, suppressed, and timeout recipients; approved SMS/WhatsApp numbers; web-push capable devices.
- Reliability: network throttling, offline-before-scan, interruption-during-confirmation, service outage switches, and seeded large datasets.

## Preparation

1. Create Event A and Event B in different authorized organizations. Give them visibly different names and content.
2. Keep one unpaid event for gating/limit cases and one credited Event Pass event for operational cases.
3. Create confirmed, declined, pending, checked-in, not-checked-in, seated, unseated, restricted-ticket, and disposable cascade guests.
4. Create Staff A and Staff B with separate logins and assignments. Create Staff C in the organization but leave the event unassigned.
5. Configure two table groups, two ticket types, two entry areas, two gates, menu items, a workflow, guest communication modules, a private group, registry entries, and a shipment.
6. Record the initial message-credit balance and provider delivery state before sending anything.

## Execution order

Run cases in checklist order where practical, but preserve these dependencies:

1. Event setup, feature gating, team safety, and invitation configuration.
2. Guest creation/import, RSVP states, ticket types, seating, menu, registry, and logistics.
3. Experience and communication configuration before guest-facing FestioHub/FestioMe cases.
4. Staff permissions and section/gate assignments before scanner attribution and concurrency cases.
5. Normal provider delivery before timeout, retry, bounce, suppression, and insufficient-credit cases.
6. Security isolation before destructive lifecycle cleanup.
7. Accessibility, browser, responsive, and performance passes against the stable configured event.
8. End/archive/reset/delete cases last, using disposable data only.

## Reliability and concurrency

1. Capture the initial server state and both device clocks.
2. For concurrent admission, release both scans together. Exactly one first admission may be created; the second must return Already admitted.
3. For network interruption, record whether the client claims queued, failed, or unknown. Reconnect, wait for convergence, and query the final server state before retrying.
4. Double-submit RSVP, publish, checkout-return, and completion controls only on disposable data. Verify one logical record and one ledger debit.
5. Use only approved outage switches. Never stop shared staging services or flood shared endpoints.

## Security and privacy

1. Test only identifiers belonging to the two authorized QA organizations.
2. Attempt cross-event and cross-organization reads and writes through the normal client/API boundary. Expect denial without target names, counts, or existence leaks.
3. Verify private host messages and DMs in Home, feeds, groups, search, notifications, exports, URLs, and browser storage using unique canary text.
4. Test HTML/script-like text as inert content. Do not use payloads that attack infrastructure or other users.
5. Verify attachment type/size checks and non-member download denial.
6. Exercise documented rate limits at the minimum useful request rate and stop when throttling is confirmed.

## Accessibility and performance

1. Complete sign-in, event creation, RSVP, navigation, and manual check-in without a pointer.
2. Verify visible focus, dialog focus containment/restoration, announced errors/status changes, non-color status cues, and readable contrast.
3. Test 320×568, 375 px, tablet, desktop, portrait/landscape, 200% zoom, and mobile large text.
4. Measure cold load with cache disabled and an approved throttled profile. Record route, device profile, transferred bytes, and time to usable controls.
5. Use approved large fixtures; never create thousands of records manually in shared staging.

## Issue and completion criteria

An issue report must include expected result, actual result, exact reproduction steps, affected role/event/guest, timestamp/timezone, device/browser, URL or endpoint, and evidence. Before release sign-off, every applicable P0 must Pass or have an explicitly accepted issue; all other cases must be Pass, accepted Issue, justified Blocked, or documented N/A. Attach both exported checklist files to the release review.
