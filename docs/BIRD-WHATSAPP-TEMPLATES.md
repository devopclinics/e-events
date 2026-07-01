# Bird WhatsApp Templates

Submit these WhatsApp templates in Bird and store the approved template names in
the matching environment variables. The backend sends variables **by name**, so
the template's variable names must match the `Variables` column exactly and in
the same order.

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
