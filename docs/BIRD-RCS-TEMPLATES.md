# Bird RCS Templates

Submit these Google RCS message templates in Bird for Festio. This mirrors the
WhatsApp template set, but uses RCS-friendly text and optional RCS suggestions
such as "Open pass" or "RSVP".

Use **RCS Basic text** for the first production submission unless Bird asks for
rich card assets. Basic text supports variables and keeps approval/testing
simple. For flows with links, add the listed **optional suggestion** as an
`Open URL` suggestion after the basic message body is approved.

## Bird / RCS rules to follow

1. **RCS requires an approved/launched Google RCS Agent.** Guests must be opted
   in and on a carrier/country where the agent is launched before they can
   receive RCS.
2. **Use variables exactly as listed.** Bird variables allow alphanumeric
   characters, periods, underscores, and hyphens. For consistency with the
   existing WhatsApp work, this document uses camelCase variables.
3. **Submit utility-style copy first.** Most Festio messages are transactional:
   ticket delivery, RSVP status, check-in, consent copy, Experience progress,
   room assignment, session attendance, and gift/souvenir completion.
4. **Keep a static ending after the last variable.** This is required for
   WhatsApp and is a good cross-channel habit. Every template below ends with
   static text after the final variable.
5. **Do not include STOP/unsubscribe copy in these utility templates.** Use
   Bird/Festio consent and channel preference handling instead.
6. **Use SMS fallback for unsupported recipients.** RCS availability depends on
   device, carrier, country, and agent launch status.

## Standard event templates

| Flow | Bird template name | Suggested env var | RCS type | Body | Variables | Optional suggestion |
| --- | --- | --- | --- | --- | --- | --- |
| Ticket/pass invitation | `festio_ticket_pass_invite` | `BIRD_RCS_INVITE_TEMPLATE` | Basic text | `Hi {{firstName}}, your ticket for {{eventName}} on {{eventDate}} is ready. Open your Festio Pass here: {{ticketUrl}} Show this pass at entry.` | `firstName`, `eventName`, `eventDate`, `ticketUrl` | Open URL: `Open pass` -> `{{ticketUrl}}` |
| RSVP invitation | `festio_rsvp_invitation` | `BIRD_RCS_RSVP_INVITATION_TEMPLATE` | Basic text | `Hi {{guestName}}, please confirm your attendance for {{eventName}}. RSVP here: {{rsvpLink}} Thank you.` | `guestName`, `eventName`, `rsvpLink` | Open URL: `RSVP` -> `{{rsvpLink}}` |
| RSVP reminder | `festio_rsvp_reminder` | `BIRD_RCS_RSVP_REMINDER_TEMPLATE` | Basic text | `Hi {{firstName}}, a reminder to confirm your attendance for {{eventName}}. RSVP here: {{rsvpLink}} Thank you.` | `firstName`, `eventName`, `rsvpLink` | Open URL: `RSVP` -> `{{rsvpLink}}` |
| RSVP confirmation | `festio_rsvp_confirmation` | `BIRD_RCS_RSVP_CONFIRMATION_TEMPLATE` | Basic text | `Hi {{firstName}}, your RSVP for {{eventName}} on {{eventDate}} is confirmed. We have saved your place.` | `firstName`, `eventName`, `eventDate` | None |
| RSVP decline | `festio_rsvp_decline` | `BIRD_RCS_RSVP_DECLINE_TEMPLATE` | Basic text | `Hi {{firstName}}, your RSVP response for {{eventName}} has been recorded as not attending. Thank you for the update.` | `firstName`, `eventName` | None |
| Approval pending | `festio_approval_pending` | `BIRD_RCS_APPROVAL_PENDING_TEMPLATE` | Basic text | `Hi {{firstName}}, we received your RSVP for {{eventName}}. It is pending approval and we will update you soon.` | `firstName`, `eventName` | None |
| Approval accepted | `festio_approval_accepted` | `BIRD_RCS_APPROVAL_ACCEPTED_TEMPLATE` | Basic text | `Hi {{firstName}}, your RSVP for {{eventName}} is approved. Open your Festio Pass here: {{ticketUrl}} Show this pass at entry.` | `firstName`, `eventName`, `ticketUrl` | Open URL: `Open pass` -> `{{ticketUrl}}` |
| Approval rejected | `festio_approval_rejected` | `BIRD_RCS_APPROVAL_REJECTED_TEMPLATE` | Basic text | `Hi {{firstName}}, your RSVP request for {{eventName}} could not be approved. Thank you for your interest.` | `firstName`, `eventName` | None |
| Check-in confirmation | `festio_admission_confirmation` | `BIRD_RCS_ADMISSION_TEMPLATE` | Basic text | `Hi {{firstName}}, you are checked in to {{eventName}}. Table: {{tableName}}. Seat: {{seatNumber}}. You are all set.` | `firstName`, `eventName`, `tableName`, `seatNumber` | None |
| Logistics / shipping notification | `festio_logistics_notification` | `BIRD_RCS_LOGISTICS_TEMPLATE` | Basic text | `Hi {{firstName}}, your item for {{eventName}} is on its way. Please check your delivery details if needed.` | `firstName`, `eventName` | None |
| Gift registry message | `festio_gift_registry` | `BIRD_RCS_REGISTRY_TEMPLATE` | Basic text | `Gift registry information for {{eventName}} is available here: {{registryLink}} Thank you.` | `eventName`, `registryLink` | Open URL: `Open registry` -> `{{registryLink}}` |

## Experience templates

| Flow | Bird template name | Suggested env var | RCS type | Body | Variables | Optional suggestion |
| --- | --- | --- | --- | --- | --- | --- |
| Experience pass / invite | `festio_experience_pass_invite` | `BIRD_RCS_EXPERIENCE_INVITE_TEMPLATE` | Basic text | `Hi {{firstName}}, your {{eventName}} Experience Pass is ready. Use it for check-in, consent, activity steps, room assignments, and sessions: {{ticketUrl}} Keep it handy.` | `firstName`, `eventName`, `ticketUrl` | Open URL: `Open pass` -> `{{ticketUrl}}` |
| Experience check-in confirmation | `festio_experience_admission_confirmation` | `BIRD_RCS_EXPERIENCE_ADMISSION_TEMPLATE` | Basic text | `Welcome {{firstName}}, you are checked in for {{eventName}}. Your Experience steps are now active. Open your pass here: {{ticketUrl}} Keep it handy.` | `firstName`, `eventName`, `ticketUrl` | Open URL: `Open pass` -> `{{ticketUrl}}` |
| Experience next steps | `festio_experience_next_steps` | `BIRD_RCS_EXPERIENCE_NEXT_STEPS_TEMPLATE` | Basic text | `Hi {{firstName}}, your next steps for {{eventName}} are: {{experienceSteps}} Open your pass here: {{ticketUrl}} Staff can help onsite.` | `firstName`, `eventName`, `experienceSteps`, `ticketUrl` | Open URL: `Open pass` -> `{{ticketUrl}}` |
| Experience consent copy | `festio_experience_consent_copy` | `BIRD_RCS_EXPERIENCE_CONSENT_COPY_TEMPLATE` | Basic text | `Hi {{firstName}}, your signed consent copy for {{eventName}} is ready. Download it here: {{downloadLink}} Keep this for your records.` | `firstName`, `eventName`, `downloadLink` | Open URL: `Download copy` -> `{{downloadLink}}` |
| Experience souvenir completion | `festio_experience_souvenir_completion` | `BIRD_RCS_EXPERIENCE_SOUVENIR_TEMPLATE` | Basic text | `Hi {{firstName}}, {{stepTitle}} is complete for {{eventName}}. {{stepMessage}} Thank you for attending.` | `firstName`, `stepTitle`, `eventName`, `stepMessage` | None |
| Experience room assignment | `festio_experience_room_assignment` | `BIRD_RCS_EXPERIENCE_ROOM_TEMPLATE` | Basic text | `Hi {{firstName}}, your room assignment for {{eventName}} is ready. Room: {{roomName}}. Table: {{tableName}}. Seat: {{seatNumber}}. Please show staff if needed.` | `firstName`, `eventName`, `roomName`, `tableName`, `seatNumber` | None |
| Experience session attendance | `festio_experience_session_attendance` | `BIRD_RCS_EXPERIENCE_SESSION_TEMPLATE` | Basic text | `Hi {{firstName}}, your attendance has been recorded for {{sessionTopic}} at {{eventName}}. {{sessionDate}} {{sessionTime}}, {{sessionRoom}}. Thank you.` | `firstName`, `sessionTopic`, `eventName`, `sessionDate`, `sessionTime`, `sessionRoom` | None |

## Broadcast / event update

`broadcast` should stay a runtime/free-text message, not a pre-approved RCS
template, unless Bird requires pre-created RCS content for every outbound send.
If Bird requires a template, submit this conservative fallback:

| Flow | Bird template name | Suggested env var | RCS type | Body | Variables | Optional suggestion |
| --- | --- | --- | --- | --- | --- | --- |
| Event update / broadcast | `festio_event_update` | `BIRD_RCS_BROADCAST_TEMPLATE` | Basic text | `Hi {{firstName}}, update for {{eventName}}: {{message}} Thank you.` | `firstName`, `eventName`, `message` | None |

## Suggested sample values for Bird approval

Use these sample values when Bird asks for examples in the Variables tab:

| Variable | Sample value |
| --- | --- |
| `firstName` | `Aisha` |
| `guestName` | `Aisha Bello` |
| `eventName` | `Women's Convention 2026` |
| `eventDate` | `July 17, 2026` |
| `ticketUrl` | `https://festio.events/scan/sample-pass-token` |
| `rsvpLink` | `https://festio.events/rsvp/sample-rsvp-token` |
| `tableName` | `Table 12` |
| `seatNumber` | `Seat 4` |
| `registryLink` | `https://festio.events/registry/sample-event` |
| `experienceSteps` | `Consent, souvenir pickup, room assignment` |
| `downloadLink` | `https://festio.events/scan/sample-pass-token#consent` |
| `stepTitle` | `Souvenir pickup` |
| `stepMessage` | `Your convention gift bag has been collected.` |
| `roomName` | `Red Oak Ballroom` |
| `sessionTopic` | `Opening Keynote` |
| `sessionDate` | `July 17, 2026` |
| `sessionTime` | `6:00 PM` |
| `sessionRoom` | `Main Hall` |
| `message` | `Doors open at 5:30 PM. Please bring your pass.` |

## Implementation notes

- The current production app already has SMS, WhatsApp, email, and Experience
  message-template keys. RCS is not wired as a send channel yet.
- When we implement RCS sending, map existing Festio context fields to the
  camelCase variables in this document:
  - `guest_first_name` -> `firstName`
  - `guest_full_name` -> `guestName`
  - `event_name` -> `eventName`
  - `event_date` -> `eventDate`
  - `ticket_link` -> `ticketUrl`
  - `rsvp_link` -> `rsvpLink`
  - `experience_steps_text` -> `experienceSteps`
  - `download_link` -> `downloadLink`
  - `experience_step_title` -> `stepTitle`
  - `experience_step_message` -> `stepMessage`
  - `room_name` -> `roomName`
  - `table_name` -> `tableName`
  - `seat_number` -> `seatNumber`
  - `session_topic` -> `sessionTopic`
  - `session_date` -> `sessionDate`
  - `session_time` -> `sessionTime`
  - `session_room` -> `sessionRoom`
- If Bird requires exact backend template keys instead of env vars, use the
  `Bird template name` column as the approved template identifier.

## References

- Bird RCS supports basic text, rich cards, rich messages, carousel templates,
  variables, and suggestions.
- Bird variables are configured under Content > Message templates > Settings >
  Variables and support alphanumeric characters, periods, underscores, and
  hyphens.
- Bird programmable RCS sends either a `body` or a `template`, and template
  sends should set only the template field.
