# Mumineen Academy giving experience

The approved forest, ivory, and gold concept is implemented for event
`74f334fd-ebaa-43dd-a998-2bd00a4564ae` and its permanent public campaign token.
Other Giving Hubs retain their existing design.

- Giving Hub: existing `/give/:token` route, channels, forms, consent and statuses.
- Presentation: `/give/:token/experience?mode=vision|live|reveal`.
- Organizer: Festio Live > Donation tracker > Projector display > Presentation mode.
  Preview opens the matching public experience; Display on screen uses the existing
  named-display controls. Existing academy donation scenes receive the new design.
- The full-screen presentation reuses the same component as the actual projector.
- The scene reads the public campaign endpoint every five seconds; organizer-only
  contribution data never enters it. Names and amounts follow public privacy flags.
- Confirmed gifts alone determine progress and milestones. Pledges are separate.
  A new confirmed gift can trigger a brief highlight. Initial load does not fake a gift.
- Updates that fail are labeled stale. An unavailable/disabled campaign clears the scene.
- The campus artwork is an AI-generated illustrative architectural concept, visibly
  labeled as such. It is not an approved site plan or a completed 3D walkthrough.
- Recurring giving, invented gift allocations, demo donors, and simulated totals from
  the mockup are not included in the live payment flow.
- No campaign, ticket, payout, payment-channel, guest, or donor settings are changed.

Browser checks use localhost-only fixtures and intercept every API call. Existing
Giving Hub regression tests cover checkout, pledges, bank chooser, reporting, and
return links. Production verification is read-only; it does not submit money or messages.

The artwork brief and original concept evidence are recorded in
`artifacts/clients/mumineen-academy/mumineen-academy-2026/festio-live-concepts-2026-11-13/`.
