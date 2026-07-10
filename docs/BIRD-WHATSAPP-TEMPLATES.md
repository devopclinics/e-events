# Bird WhatsApp Templates

Submit these WhatsApp templates in Bird and store the approved template names in
the matching environment variables. The backend sends variables **by name**, so
the template's variable names must match the `Variables` column exactly and in
the same order.

For the matching Google RCS submission set, see
[`BIRD-RCS-TEMPLATES.md`](./BIRD-RCS-TEMPLATES.md).

## Meta rules these templates must follow

Learned the hard way (see `memory` / session history):

1. **A body may not end with a variable.** Meta rejects it with
   *"body should not end with a variable"*. Every template below ends with
   static text after the last `{{...}}`.
2. **Keep it Utility, not Marketing.** Meta assigns the *effective* category from
   the **content**, not the label you pick. Anything promotional gets treated as
   Marketing and is silently dropped at delivery with error `131049`
   ("healthy ecosystem engagement" — a per-recipient marketing cap). To stay
   Utility: **no** "Reply STOP to unsubscribe" footer, **no** invite/promo
   phrasing ("You're invited", "See you there!", "Don't miss…"), **no**
   interactive list/buttons. Word every message as a transactional confirmation
   of something the guest already did.
3. **Send every variable the template declares — and no extras.** The backend
   passes a fixed parameter set per flow (below); a mismatch 422s. Every variable
   in the `Variables` column appears in its body.

| Flow | Env var | Body | Variables |
| --- | --- | --- | --- |
| Ticket/pass invitation | `BIRD_WHATSAPP_INVITE_TEMPLATE` | `Hi {{firstName}}, your ticket for {{eventName}} on {{eventDate}} is ready. Your Festio Pass: {{ticketUrl}} Show this pass at entry.` | `firstName`, `eventName`, `eventDate`, `ticketUrl` |
| RSVP invitation | `BIRD_WHATSAPP_RSVP_INVITATION_TEMPLATE` | `Hi {{guestName}}, please confirm your attendance for {{eventName}}. RSVP here: {{rsvpLink}} Thank you.` | `guestName`, `eventName`, `rsvpLink` |
| RSVP reminder | `BIRD_WHATSAPP_RSVP_REMINDER_TEMPLATE` | `Hi {{firstName}}, a reminder to confirm your attendance for {{eventName}}. RSVP here: {{rsvpLink}} Thank you.` | `firstName`, `eventName`, `rsvpLink` |
| RSVP confirmation | `BIRD_WHATSAPP_RSVP_CONFIRMATION_TEMPLATE` | `Hi {{firstName}}, your RSVP for {{eventName}} on {{eventDate}} is confirmed. We have saved your place.` | `firstName`, `eventName`, `eventDate` |
| RSVP decline | `BIRD_WHATSAPP_RSVP_DECLINE_TEMPLATE` | `Hi {{firstName}}, your RSVP response for {{eventName}} has been recorded as not attending. Thank you for the update.` | `firstName`, `eventName` |
| Approval pending | `BIRD_WHATSAPP_APPROVAL_PENDING_TEMPLATE` | `Hi {{firstName}}, we received your RSVP for {{eventName}}. It is pending approval and we will update you soon.` | `firstName`, `eventName` |
| Approval accepted | `BIRD_WHATSAPP_APPROVAL_ACCEPTED_TEMPLATE` | `Hi {{firstName}}, your RSVP for {{eventName}} is approved. Your Festio Pass: {{ticketLink}} Show this pass at entry.` | `firstName`, `eventName`, `ticketLink` |
| Approval rejected | `BIRD_WHATSAPP_APPROVAL_REJECTED_TEMPLATE` | `Hi {{firstName}}, your RSVP request for {{eventName}} could not be approved. Thank you for your interest.` | `firstName`, `eventName` |
| Check-in confirmation | `BIRD_WHATSAPP_ADMISSION_TEMPLATE` | `Hi {{firstName}}, you're checked in to {{eventName}}. Table: {{tableName}}, Seat: {{seatNumber}}. You're all set.` | `firstName`, `eventName`, `tableName`, `seatNumber` |
| Logistics / shipping notification | `BIRD_WHATSAPP_LOGISTICS_TEMPLATE` | `Hi {{firstName}}, your item for {{eventName}} is on its way. Please check your delivery details if needed.` | `firstName`, `eventName` |
| Gift registry message | `BIRD_WHATSAPP_REGISTRY_TEMPLATE` | `Gift registry information for {{eventName}} is available here: {{registryLink}} Thank you.` | `eventName`, `registryLink` |

## Experience templates

These templates were submitted programmatically as WhatsApp `UTILITY` templates.
Use the `v2` names for souvenir and session; the first versions were rejected by
Meta because the variable-to-fixed-word ratio was too high.

| Flow | Env var | Bird template name | Body | Variables |
| --- | --- | --- | --- | --- |
| Experience pass / invite | `BIRD_WHATSAPP_EXPERIENCE_INVITE_TEMPLATE` | `festio_experience_pass_invite` | `Hi {{firstName}}, your {{eventName}} Experience Pass is ready. Use it for check-in, consent, activity steps, room assignments, and sessions: {{ticketUrl}} Keep it handy.` | `firstName`, `eventName`, `ticketUrl` |
| Experience check-in confirmation | `BIRD_WHATSAPP_EXPERIENCE_ADMISSION_TEMPLATE` | `festio_experience_admission_confirmation` | `Welcome {{firstName}}, you are checked in for {{eventName}}. Your Experience steps are now active. Open your pass here: {{ticketUrl}} Keep it handy.` | `firstName`, `eventName`, `ticketUrl` |
| Experience next steps | `BIRD_WHATSAPP_EXPERIENCE_NEXT_STEPS_TEMPLATE` | `festio_experience_next_steps` | `Hi {{firstName}}, your next steps for {{eventName}} are: {{experienceSteps}} Open your pass here: {{ticketUrl}} Staff can help onsite.` | `firstName`, `eventName`, `experienceSteps`, `ticketUrl` |
| Experience consent copy | `BIRD_WHATSAPP_EXPERIENCE_CONSENT_COPY_TEMPLATE` | `festio_experience_consent_copy` | `Hi {{firstName}}, your signed consent copy for {{eventName}} is ready. Download it here: {{downloadLink}} Keep this for your records.` | `firstName`, `eventName`, `downloadLink` |
| Experience souvenir completion | `BIRD_WHATSAPP_EXPERIENCE_SOUVENIR_TEMPLATE` | `festio_experience_souvenir_completion_v2` | `Hi {{firstName}}, your {{stepTitle}} step for {{eventName}} is complete. This records that staff finished the activity for your event visit. Thank you for attending.` | `firstName`, `stepTitle`, `eventName` |
| Experience room assignment | `BIRD_WHATSAPP_EXPERIENCE_ROOM_TEMPLATE` | `festio_experience_room_assignment` | `Hi {{firstName}}, your room assignment for {{eventName}} is ready. Room: {{roomName}}. Table: {{tableName}}. Seat: {{seatNumber}}. Please show staff if needed.` | `firstName`, `eventName`, `roomName`, `tableName`, `seatNumber` |
| Experience session attendance | `BIRD_WHATSAPP_EXPERIENCE_SESSION_TEMPLATE` | `festio_experience_session_attendance_v2` | `Hi {{firstName}}, your attendance for {{sessionTopic}} at {{eventName}} has been recorded. This confirms staff checked you in for that session. Thank you.` | `firstName`, `sessionTopic`, `eventName` |

`broadcast` remains a free-text session message because hosts type the message
at send time. It should only be used when the guest already has an open WhatsApp
conversation window (24h).

## Notes

- A footer is **optional** in WhatsApp templates. If you add one, keep it neutral
  (e.g. `Festio · Event ticket`) — never an unsubscribe line (rule 2).
- Links are wrapped by Bird's click-tracking shortener (`brd5.us`) at send time,
  so `{{ticketUrl}}` reaches the guest as a short link that redirects to
  `https://festio.events/scan/<qr_token>`.
- `firstName`/`eventName`/etc. reach the guest already substituted; only the
  literal `{{...}}` placeholders belong in the submitted template.
