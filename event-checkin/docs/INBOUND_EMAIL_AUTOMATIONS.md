# Inbound Email Automations

Inbound Email Automations let an external provider's completion notification
complete a Festio Experience step. The first supported use case is external
consent confirmation; the engine is step- and provider-neutral.

## Organizer setup

1. Publish the event's Experience workflow and ensure the target step exists.
2. Open **Experience > Inbound Automations**.
3. Enter an automation name and select the target Experience step.
4. Enter the mailbox or domain that will forward the notification to Festio.
5. If the message is forwarded, optionally require the original provider email
   or domain as a second trust condition.
6. Configure the success phrase expected in the subject and, optionally, body.
7. Create the automation and copy its generated inbound address.
8. Configure the provider or organizer mailbox to forward matching completion
   messages to that address.

Use a narrow forwarding rule. Do not forward an organizer's whole mailbox.

Messages that pass sender and completion rules but cannot identify exactly one
guest appear under **Needs Review**. Staff can select the guest, mark the email
invalid, or ignore it. Manual matching uses the same Experience completion
service as automatic processing.

## Provider and infrastructure setup

Configure a Resend receiving domain (for example `inbound.festio.events`) and
its required MX record. Register this webhook for `email.received`:

```text
POST https://festio.events/api/webhooks/resend/inbound
```

Required backend configuration:

```text
RESEND_API_KEY=...
RESEND_INBOUND_WEBHOOK_SECRET=whsec_...
INBOUND_EMAIL_DOMAIN=inbound.festio.events
```

The inbound endpoint fails closed if neither the inbound-specific nor existing
Resend signing secret is configured. The API key is used by the background
worker to retrieve text, sanitized HTML, and headers from Resend.

`RUN_IN_APP_INBOUND_EMAIL_OUTBOX=false` disables the in-process worker when a
deployment runs it in another process. The database remains the durable queue.

## Processing guarantees

- The webhook verifies the raw body and Svix headers before persisting work.
- A webhook receipt table records replayed Svix deliveries.
- A unique Resend email ID prevents duplicate logical records.
- A normalized fingerprint detects the same retrieved message under another
  Resend delivery.
- Experience completion locks the guest progress row and is idempotent.
- Matching is restricted to the automation's event.
- Sender rules are required and fail closed.
- Only labelled guest identifiers are eligible for automatic matching.
- Attachments are never downloaded or parsed.
- Full email bodies are not retained; Festio stores extracted evidence and a
  short sanitized review excerpt.
- External consent confirmation does not create a synthetic Festio signature.

## Staging acceptance test

1. Create `Ada Test` with `ada-test@example.com`.
2. Set RSVP complete, Consent incomplete, and make Consent block check-in.
3. Create an active automation with trusted forwarding and provider senders.
4. Forward a realistic confirmation containing:

   ```text
   Guest Name: Ada Test
   Guest Email: ada-test@example.com
   ```

5. Confirm the structured log sequence reaches `inbound_email.completed`.
6. Confirm the inbound record, Experience timeline, guest progress, Guest Hub,
   and check-in eligibility all agree.
7. Confirm no `ConsentSignature` was manufactured for external evidence.

Production enablement should follow successful staging delivery, replay,
untrusted-sender, ambiguous-match, and concurrency tests.
