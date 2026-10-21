# Automatic client onboarding

The production onboarding clock checks every minute. It is separate from legacy bulk marketing, social publishing, pilot accounts, retention and automated sales replies.

## Who is enrolled

Only organizer accounts registered after `MARKETING_ONBOARDING_LAUNCH_AT` can qualify. A verified mailbox, active organizer ownership, explicit email consent and a durable consent receipt must all be present. Existing opt-outs, pauses, deleted contacts and suppression always win. Historical leads are not backfilled.

Password signup sends a verification link. The checkbox is retained for seven days for that UID and mailbox in the original browser, then submitted on a verified sign-in; no browser value can attest to email verification. Google sign-in can provide verification immediately. Event creation before verification is captured again from current owned events at verified login so creation reminders cannot continue for an existing event.

## Journey and message standards

The versioned reviewed copy has four welcome messages at intended offsets 0, 24, 72 and 168 hours, then finishes. Successful delivery submission schedules subsequent intervals. There is at most one accepted marketing message per account/mailbox per 24 hours, so event-setup guidance may wait until that cap clears. First eligibility is subject to `MARKETING_INITIAL_DELAY_MINUTES` (production: one minute).

First event creation stops creation reminders. A separate three-step setup sequence uses intended offsets 0, 48 and 120 hours; available event evidence supplies a relevant next task. Closed/completed/cancelled event guidance remains suppressed by the existing ownership/event checks.

Each message uses a short, factual subject, concise benefit-led copy, one primary action, a preview line, plain-text and HTML versions, explicit opt-in explanation, one-click unsubscribe headers and a signed reply address. Calls to action carry UTM campaign/step labels. No guaranteed attendance, revenue, unlimited features or implied bookings are promised. Replies pause automation and create an owned handoff through the existing authenticated inbound path; this release does not turn on autonomous sales replies.

Conversion is measured from real lifecycle milestones; provider acceptance is not delivery, and delivery is not a conversion guarantee. Assess first-event conversion, delivered volume, clicks where available, opt-outs, complaints and human-help requests after launch. Automated tests and a provider simulator do not establish Gmail/Outlook inbox placement or prove that copy increases conversion.

## Release and operation

1. Deploy code with onboarding disabled. Enable the authenticated backend capture worker and bound reply routing. Drain and investigate the source backlog before sending. Delivery events without a Marketing lead receive a durable receipt-only acknowledgment, never a fabricated lead.
2. Run `python -m app.onboarding_templates` in the Marketing service. This explicit command installs versioned templates and returns IDs and fingerprints; it preserves legacy copy and lead state and refuses a silently changed reviewed version.
3. Configure `MARKETING_ONBOARDING_TEMPLATES` with those pins, `MARKETING_ONBOARDING_LAUNCH_AT`, `MARKETING_REPLY_DOMAIN`, `MARKETING_EMAIL_READINESS_URL` and `MARKETING_ONBOARDING_ACCOUNT_URL`. Existing event-context rendering also needs `MARKETING_ORGANIZER_CONTEXT_URL`.
4. Enable `MARKETING_ONBOARDING_ENABLED` and `MARKETING_ONBOARDING_SCHEDULER_ENABLED`. Keep the legacy scheduler and global outbound flag off. The new email-only path uses the existing global caps, atomic attempts, provider idempotency and signed readiness barrier.
5. Check Dashboard → Automatic client onboarding for Running/Paused/Blocked, last heartbeat, actual blockers and last-run results. Active template labels alone are not proof of sending. The existing Run automation action selects the guarded production mode when it is enabled.

No private keys belong in Git. Configure credentials through the existing deployment Secret. A launch policy is immutable once first used; changing reviewed templates requires an intentional new version/launch policy. A successful job does not automatically clear an uncertain provider outcome: reconcile it before retrying.
