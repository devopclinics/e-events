# Invitation envelope opening

The envelope is an optional web introduction to the existing invitation. It works independently of Event Page templates, invitation colour themes, uploaded flyers and guest layout modes. New and existing events use direct entry until explicitly enabled.

## Organizer workflow

1. Open Guests → Invite → Invitation opening. Select envelope opening, choose the ready-to-use default and first visit or every visit, then save. No Design Studio access or saved custom design is required.
2. Optionally open Design Studio → Envelope to customize the style, colours, finish and initials. After saving, select “Saved custom design” in Guests → Invite.
3. Use the existing invitation links and delivery controls. Email and WhatsApp deliver the link; the envelope opens on the web page.

Opening options use the same event administrator permissions as invitation settings, including unpaid events and appropriately assigned event managers. Appearance customization retains existing paid Design Studio permissions. The opening-options endpoint accepts only activation, frequency and default/custom selection; it cannot edit any appearance or template fields. No messages are sent by saving a design or opening option.

## Persistence and publication

A typed `envelope_config` is stored alongside, separately from, existing design configuration:

```json
{
  "appearance": {"style":"wax","palette":"ivory","paper":"","seal":"gold","initials":"MA"},
  "enabled": false,
  "frequency": "once",
  "use_default": false
}
```

Design Studio sends only `appearance`; Guests sends only `enabled`/`frequency`/`use_default` through the separate `/events/{event_id}/invitation-opening` endpoint. The design service merges these envelope fields and validates them. The default is available without a saved appearance. Selecting a custom opening requires a saved custom appearance; choosing default retains that customization for later use. Ordinary template saves omit this object and retain it.

Envelope saves take effect immediately on existing invitation links, independently of template publication. Public theme responses resolve the built-in ivory/gold/star appearance when `use_default` is selected, and expose the current envelope configuration alongside the existing published template. Saving the envelope never publishes another editor's template, wording or image drafts. Saving a new appearance while the envelope is enabled updates its live appearance.

The existing JSON design store supports this field; no relational database migration is required. Deploy the design service and core backend before the frontend. An older service drops the new envelope input, so do not release the frontend alone.

## Guest behaviour

Shared RSVP links, personal invitation tokens and event invitation routes share the same renderer before their existing forms/layouts. Open, skip or Escape reveal the original invitation without changing its URL or sending an RSVP. Reduced-motion users get a quick reveal. Returning guests with a remembered RSVP or an already-responded personal invitation bypass the envelope to reach their existing flow.

First-visit completion is recorded per event and appearance in browser storage after opening or skipping. A new appearance shows the opening again; different devices do not share state. Every-visit mode repeats on each page load. Storage failure, missing/disabled configuration, and a failed design-theme request use direct entry. A four-second design-theme wait bounds a stalled service; late responses are ignored for that visit. Preview bypasses the completion record and does not modify it (`envelope-preview=1`).

## Validation

- `design-service/test_envelope.py`: opt-in defaults, missing design guard, partial saves, published/draft isolation, persistence through template publication, invalid appearance and frequency.
- `backend/tests/test_invitation_opening.py`: unpaid admin access, tenant boundaries, and rejection of design fields through opening options.
- `frontend/tests/invitation-opening-admin.browser.py`: default preview/save/reload without Studio API access, saved custom selection and error handling.
- `frontend/e2e/invitation-envelope.spec.js`: real invitation components with mocked API responses; first visit, replay, five guest layout modes, direct-entry fallbacks, returning guests and three mobile styles.
- Local component validation exercised Design Studio appearance save, RSVP enable save, saved preview and error handling with mocked API methods.
- Frontend production bundle builds successfully. Staging, actual authenticated API integration, live delivery and production deployment remain release checks.

Logo upload, automatic theme matching, reusable multi-design libraries and opening analytics are outside this version.

## Custom wording and initials

Design Studio → Envelope has a Wording section for the top label, opening headline (line breaks supported), envelope inscription, card label/title/message, tap instruction, skip button text and opening status. Blank text uses the existing default; the card title falls back to the event name. Decorative labels/headline/message/inscription and the seal initials can be hidden. The seal remains a labelled, keyboard-accessible opening button when its initials are hidden. Initials support up to three characters; three-character monograms use smaller lettering.

These fields are part of the saved custom appearance. Select Saved custom design in Guests → Invite to use them. The built-in default remains available without Studio access and does not inherit private custom wording. Reset wording restores text/visibility defaults while retaining the seal initials. Text is length-limited and rendered as plain text. Newly added default fields are excluded from visit keys so deployment alone does not replay previously opened envelopes.

`design-service/test_envelope.py` covers wording persistence, validation and default/custom isolation; `frontend/tests/invitation-wording.browser.py` exercises actual controls, visibility, accessibility, reload, literal HTML text, mobile wrapping and visit-key compatibility.

## Guest-name placeholders

In any envelope wording field, use `{{first_name}}`, `{{full_name}}`, `{{last_name}}` or the full-name alias `{{guest_name}}`. For example: `Dear {{first_name}},` or `An invitation for {{full_name}}`. Click a wording field and then a placeholder button to insert at its cursor, or type the marker directly. The saved design contains the marker, never a preview recipient's resolved name.

Personal `/r/:token` links use the first/last names already returned by the existing personal invitation API. Shared RSVP/event links never resolve identity from URL prefill parameters, logged-in organizer details or prior browser registrations: first/full name fall back to `Guest`, last name is blank. Missing last-name spaces before punctuation are cleaned up. Empty functional prompts fall back to their normal labels. Copy without supported placeholders is unchanged.

Design Studio offers Personal invitation and Shared link preview modes, with editable sample names. Samples exist only in component state. Name substitutions are one-pass plain text, never HTML or expressions; expanded text is bounded. The seal initials remain organizer-controlled rather than automatically becoming the guest's initials.

First-visit completion for personal links is scoped using a SHA-256 digest of the invitation token, plus event and appearance. Raw tokens and guest names are not stored in these records. Different personal links on one browser no longer share the same completion record. If digest support is unavailable, personal completion is memory-only. An in-place route change clears old guest data, aborts old requests and waits for the new invitation before showing wording. Shared-link completion keys retain their prior format.

Verification: `frontend/tests/envelope-personalization.test.mjs` covers substitution/fallbacks, literal text, output bounds and scope hashing. `frontend/e2e/invitation-envelope-personalization.spec.js` covers two guests in one browser, delayed route loading, query-name rejection, shared/missing names, literal markup and mobile layout. The wording-control browser test also checks insertion, preview mode switching and that sample names are not saved.
