# Knowledge sources and capability review — October 6, 2026

Canonical content: `frontend/src/guideContent.mjs`. Reviewed against source baseline `91324ec`; this documentation change is not itself proof of deployment or full product acceptance.

| Area | Status | Primary source |
|---|---|---|
| Help Centre | Updated | `frontend/src/guideContent.mjs` |
| Printable guide | Generator corrected | `frontend/scripts/gen-guide-html.mjs` |
| AI support knowledge | Regenerated | `support-service/app/knowledge_base.md` |
| Support policy/playbooks | Updated | `support-service/app/support_policy.md` |
| Academy | Version 3 prepared | `backend/app/training_catalog.py` |
| Setup Guide | Updated copy | `frontend/src/pages/guidedSetupPhaseFourModel.mjs` |
| Knowledge Transfer | Updated current-reference section | `frontend/public/knowledge-transfer/index.html` |
| Media Library | Updated/regenerated | `frontend/src/pages/MediaPage.jsx` |
| Images/infographics | Current supplement plus labels | `frontend/public/media/festio-operating-flow-2026-10.svg` |
| Independent product manuals | Updated | `support-service/docs/FESTIO_COMPLETE_FEATURE_GUIDE.md` |
| Technical/operations/QA docs | Updated entry points and test procedures | `docs/API_CONTRACTS.md` |
| Public and event FAQs | Global FAQs and author guidance updated | `frontend/src/pages/LandingPage.jsx` |
| NCNMO and presentation pack | Dated current supplements | `frontend/public/media/ncnmo-platform-2026-full-deck.pdf` |
| Internal/historical documents | Historical status made explicit | `team-docs/index.html` |

## Capability boundaries

- **General admission:** Implemented; permission/event dependent. QR/manual result handling; never promise fixed scan latency. Evidence: `frontend/src/pages/ScannerRedesignPage.jsx; backend/app/routers/scanner.py`.
- **Offline admission:** Conditional implementation. 30-minute manifest, eligible local admissions and explicit server revalidation; no offline cold start. Evidence: `frontend/src/offlineExperienceQueue.js; frontend/src/components/OfflineScannerPanel.jsx`.
- **Junior handoffs:** Online; configured juniors only. Authorization must exist and be usable. Staff selection records identity verification, not a QR scan. Evidence: `backend/app/routers/access.py; frontend/src/pages/CheckinRedesignPage.jsx`.
- **Daily/session attendance:** Online; separate from admission. Daily event-local date; session age/time/capacity checks; scoped supervisor age override. Evidence: `frontend/src/pages/ScannerRedesignPage.jsx`.
- **Programme/timetable:** Implemented for configured valid sessions. All days; room/speaker/age search. Missing metadata must be supplied by organizer. Evidence: `backend/app/services/program.py; frontend/src/pages/InvitePage.jsx`.
- **Speaker Q&A:** Implemented; configure queues. Multiple questions; distinct moderated speaker activities. No automatic queue from a timetable name. Evidence: `frontend/src/pages/LiveGuestPage.jsx; frontend/src/pages/FestioLiveRedesignPage.jsx`.
- **Guided Show/countdown:** Conditional on timing/automation. Answer/reveal/next/previous and phase timing; not offline show synchronization. Evidence: `frontend/src/pages/FestioLiveRedesignPage.jsx; frontend/src/pages/LiveGuestPage.jsx`.
- **FestioMe:** Implemented; access dependent. GuestHub entry, groups/meetups/read-only announcements; adult approval under organizer Settings. Evidence: `frontend/src/pages/FestioMePage.jsx; frontend/src/pages/FestioMeGuestAccessSettings.jsx`.
- **Broadcasting:** Implemented; provider/channel dependent. Reviewed ticket-type snapshot; queued does not establish delivery. No messages sent in this refresh. Evidence: `frontend/src/pages/CommunicationsRedesignPage.jsx`.
- **Conference operations:** Implemented workspaces; external integrations conditional. Calls, tracks and promoted records do not prove a live external registration sync. Evidence: `frontend/src/pages/ConferenceCenterPage.jsx`.
- **Website/FAQs:** Implemented; owner-authored facts. Draft/preview/publish/history are distinct from invite/pass design publication. Evidence: `frontend/src/pages/EventWebsitePage.jsx`.
- **Giving/finance:** Implemented; verification required. Pledged, pending and confirmed are distinct; never describe total potential as received money. Evidence: `frontend/src/pages/FinanceReconciliationPage.jsx`.
- **Materials/certificates:** Implemented; permissions/eligibility dependent. Private vs released material, test issuance and public verification need rehearsal. Evidence: `frontend/src/components/live/LiveContentWorkspace.jsx`.
- **Passive RFID / all-workflows offline:** Not established by current implementation. Do not market as delivered or assume parity with every competitor. Evidence: `No delivered implementation evidenced in this review`.

## Review limits

- This is a source/document comparison with focused regression tests, not a fresh end-to-end acceptance test of every product module.
- Customer-owned event FAQ facts, prices, schedules, speaker identities and consent text require owner confirmation. No live event data was changed.
- External document portals not present in this workspace remain unverified.
- Historical plans, comparison claims and screenshots are retained as historical context, not marked newly verified.
- Academy version 3 needs intentional assignment/release review; old completion records are not deleted.
- Deploy documentation-bearing frontend/backend/support-service/support-worker together after staging review.
