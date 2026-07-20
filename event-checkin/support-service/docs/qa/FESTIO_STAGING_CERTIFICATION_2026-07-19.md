# Festio staging certification — 2026-07-19

- Checklist cases assessed: **141**
- Pass: **82**
- Issue: **1**
- Blocked/manual: **58**
- Live fixture: `CODEX QA RELEASE 20260719092538` (`4416b81d-89e8-4ff7-8f82-9822a05e9f8a`)
- Live API checks: **21 pass, 1 issue**
- Backend isolated suite: **267 passed, 10 failed, 1 xfailed**
- FestioMe isolated suite: **15 passed**
- Support isolated suite: **37 passed**

## Confirmed product issue

1. Ordinary QR Check-in does not create a `scan_events` record, so the authenticated staff identity is not retained in `scanned_by` for normal admissions. Zone and checkout scans do create these records.

## Automated-suite failures requiring triage

- `test_legacy_both_modes_on_still_scans`
- `test_section_scanning_routes_and_respects_own_group`
- `test_seating_coexists_with_each_exclusive_mode`
- `test_mms_toggle_superadmin_only`
- `test_walk_in_register`
- `test_rsvp_blocks_duplicate_by_phone_no_email`
- `test_rsvp_saves_explicit_sms_consent`
- `test_toggle_requires_a_table_group`
- `test_section_mode_and_venue_access_are_mutually_exclusive`
- `test_admin_toggle_generates_code`

Several failures expect pre-entitlement behavior (400/200) but now receive the correct entitlement gate (402), so the failing tests and/or their paid fixtures need alignment. The two phone-only RSVP failures now hit the current “Email is required” policy and need a product-policy decision before changing code.

## Manual execution still required

58 cases require physical browsers/devices, visual inspection, real provider or staging-payment confirmation, accessibility tools, controlled failure simulation, or repaired paid test fixtures. They are recorded as Blocked in the importable backup rather than being represented as passes.

## Import results

Import `codex-checklist-backup.json` with the checklist’s **Import backup** button to view every outcome and continue the manual cases.

## Full case results

| Test | Case | Status | Note |
|---|---|---|---|
| SETUP-001 | Create a new event | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| SETUP-002 | Multi-day event | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| SETUP-003 | Timezone correctness | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| SETUP-004 | Guided setup wizard | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| SETUP-005 | Team invite safety check | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| SETUP-006 | Feature gating on an unpaid event | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| RSVP-001 | Submit an RSVP (attending) | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| RSVP-002 | Submit an RSVP (declining) | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| RSVP-003 | Bring-a-group RSVP | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| RSVP-004 | Duplicate RSVP attempt | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| RSVP-005 | RSVP deadline enforcement | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| RSVP-006 | Invitation category → table mapping | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| SEATING-001 | Bulk table creation | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| SEATING-002 | Table group enforcement | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| SEATING-003 | Auto seat assignment | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| MENU-001 | Menu setup | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| MENU-002 | Guest meal selection | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| EXPERIENCE-001 | Create workflow from a template | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| EXPERIENCE-002 | Re-publish without crashing | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| EXPERIENCE-003 | Consent step | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| EXPERIENCE-004 | Souvenir eligibility | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| EXPERIENCE-005 | Next step consistency | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| EXPERIENCE-006 | Live Program timing | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| HUB-001 | Pass tab | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| HUB-002 | Activity tab | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| HUB-003 | Program tab visibility | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| HUB-004 | Messages tab | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| HUB-005 | Install & notification prompts | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| HUB-006 | Tab bar reachability | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| CHECKIN-001 | QR scan admission | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| CHECKIN-002 | Re-scan an admitted guest | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| CHECKIN-003 | Age group on the scan result | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| CHECKIN-004 | Station action card | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| CHECKIN-005 | Souvenir eligibility (staff side) | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| CHECKIN-006 | Station-based routing | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| CHECKIN-007 | Manual check-in | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| CHECKIN-008 | Walk-in registration | BLOCKED | The isolated walk-in test currently stops at an entitlement 402 because its fixture is unpaid; rerun with a paid fixture before certifying the workflow. |
| CHECKIN-009 | Invalid or denied scan | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| VENUE-001 | Zone entry/exit scan | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| VENUE-002 | Multi-zone access | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| VENUE-003 | Section-based device routing | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| FESTIOME-001 | Enable FestioMe for an event | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| FESTIOME-002 | Guest opens FestioMe | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| FESTIOME-003 | Staff announcement | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| FESTIOME-004 | Private channel | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| FESTIOME-005 | Native group message | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| REGISTRY-001 | Registry setup | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| REGISTRY-002 | Guest marks a gift | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| REGISTRY-003 | Logistics shipment | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| DESIGN-001 | Custom branding | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| DESIGN-002 | FestioHub layout editor | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| DESIGN-003 | Locked / gated modules | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| MESSAGING-001 | Email campaign | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| MESSAGING-002 | SMS / WhatsApp send | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| MESSAGING-003 | Message templates | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| TEAM-001 | Role permissions | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| TEAM-002 | Dashboard accuracy | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| TEAM-003 | Support chat | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| GUEST-DATA-001 | Create and edit a guest | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| GUEST-DATA-002 | CSV/XLSX import with valid rows | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| GUEST-DATA-003 | Import validation and partial failure | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| GUEST-DATA-004 | Google Sheets source sync | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| GUEST-DATA-005 | Duplicate guest handling | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| GUEST-DATA-006 | Pending approval workflow | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| GUEST-DATA-007 | Guest filtering and export | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| TICKETS-BILLING-001 | Ticket type setup and capacity | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| TICKETS-BILLING-002 | Ticket rules at admission | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| TICKETS-BILLING-003 | Free plan limits | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| TICKETS-BILLING-004 | Event Pass checkout | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| TICKETS-BILLING-005 | Upgrade to a larger Event Pass | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| TICKETS-BILLING-006 | Checkout cancellation and retry | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| TICKETS-BILLING-007 | Message credit purchase and ledger | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| TICKETS-BILLING-008 | Insufficient credits | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| TICKETS-BILLING-009 | Public pricing consistency | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| GUEST-COMMUNICATION-001 | Event Update audience enforcement | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| GUEST-COMMUNICATION-002 | Guest Chat enabled and disabled | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| GUEST-COMMUNICATION-003 | Guest posting paused | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| GUEST-COMMUNICATION-004 | Attending-only Guest Chat | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| GUEST-COMMUNICATION-005 | Private Message Host isolation | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| GUEST-COMMUNICATION-006 | Organizer chat moderation | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| GUEST-COMMUNICATION-007 | Communication toggles do not affect RSVP/check-in | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| GUEST-COMMUNICATION-008 | Communication partial outage | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| FESTIOME-UNIFIED-001 | Unified Home source mapping | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| FESTIOME-UNIFIED-002 | Home previews do not mark read | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| FESTIOME-UNIFIED-003 | Distinct navigation destinations | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| FESTIOME-UNIFIED-004 | Guest Communication toggle projection | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| FESTIOME-UNIFIED-005 | Native group ownership preserved | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| FESTIOME-UNIFIED-006 | Private content never enters public Home | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| FESTIOME-UNIFIED-007 | FestioMe responsive navigation | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| FESTIOME-UNIFIED-008 | Old guest session recovery | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| STAFF-IDENTITY-001 | Create separate staff accounts | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| STAFF-IDENTITY-002 | Unassigned staff isolation | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| STAFF-IDENTITY-003 | Per-staff permissions | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| STAFF-IDENTITY-004 | Section assignment per staff | BLOCKED | Separate staff assignment was verified live, but section-routing certification is blocked by an isolated fixture receiving entitlement 402. |
| STAFF-IDENTITY-005 | Scan attribution | ISSUE | Normal QR admission sets admitted state but writes no scan_events row; scanned_by is therefore unavailable for ordinary Check-in. |
| STAFF-IDENTITY-006 | Role change and access revocation | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| RELIABILITY-001 | Scanner loses network before scan | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| RELIABILITY-002 | Network drops during confirmation | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| RELIABILITY-003 | Two devices scan the same guest concurrently | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| RELIABILITY-004 | Double-submit protections | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| RELIABILITY-005 | Refresh and back-button safety | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| RELIABILITY-006 | FestioMe service outage isolation | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| RELIABILITY-007 | Messaging provider timeout retry | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| NOTIFICATIONS-001 | Web Push opt-in and opt-out | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| NOTIFICATIONS-002 | Push private targeting | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| NOTIFICATIONS-003 | Email delivery lifecycle | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| NOTIFICATIONS-004 | Notification preferences | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| NOTIFICATIONS-005 | Notification deep links | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| SECURITY-001 | Cross-event guest token isolation | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| SECURITY-002 | Cross-organization admin isolation | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| SECURITY-003 | Private channel membership enforcement | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| SECURITY-004 | Expired and revoked links | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| SECURITY-005 | Input and stored-content safety | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| SECURITY-006 | Attachment authorization | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| SECURITY-007 | Sensitive browser storage | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| SECURITY-008 | Rate limiting and abuse feedback | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| ACCESSIBILITY-001 | Keyboard-only critical flows | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| ACCESSIBILITY-002 | Screen-reader names and status | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| ACCESSIBILITY-003 | Color contrast and non-color cues | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| ACCESSIBILITY-004 | Zoom and text scaling | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| ACCESSIBILITY-005 | Small phone layout | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| ACCESSIBILITY-006 | Reduced motion | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| ACCESSIBILITY-007 | Touch target and orientation | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| COMPAT-PERFORMANCE-001 | Supported browser matrix | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| COMPAT-PERFORMANCE-002 | Mobile browser matrix | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| COMPAT-PERFORMANCE-003 | Cold-load performance | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| COMPAT-PERFORMANCE-004 | Large guest list | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| COMPAT-PERFORMANCE-005 | Large communication history | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| COMPAT-PERFORMANCE-006 | Realtime update convergence | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| LIFECYCLE-001 | Draft, Active and Ended behavior | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| LIFECYCLE-002 | Archive and reopen event | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| LIFECYCLE-003 | Scoped reset tools | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| LIFECYCLE-004 | Guest deletion cascade | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| LIFECYCLE-005 | Feature disable and re-enable retention | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| LIFECYCLE-006 | Destructive confirmation safety | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| OTHER-SURFACES-001 | Media Library upload and reuse | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| OTHER-SURFACES-002 | Guest feedback form | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| OTHER-SURFACES-003 | Session-specific feedback | PASS | Verified by live staging run or isolated automated service/backend coverage. |
| OTHER-SURFACES-004 | Partner pairing | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| OTHER-SURFACES-005 | Reports and printable/exported output | BLOCKED | Requires a human browser/device, real provider/payment delivery, controlled network simulation, or visual/accessibility inspection; not falsely marked as passed. |
| OTHER-SURFACES-006 | Support knowledge response quality | PASS | Verified by live staging run or isolated automated service/backend coverage. |
