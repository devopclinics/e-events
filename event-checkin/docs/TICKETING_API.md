# Festio Ticketing API

The ticketing service is isolated at `/api/ticketing` and is deployed in staging and production, with environment-specific credentials and service/event switches. Currency amounts are integer minor units: cents for USD and kobo for NGN.

## Public buyer endpoints

- `GET /public/events` — discover current and upcoming ticketed events.
- `GET /public/events/{event_id}/tickets` — active inventory, tax treatment and purchase limits.
- `POST /public/events/{event_id}/orders` — create an inventory hold and provider checkout.
- `GET /public/orders/{order_id}?token=…` — private receipt, delivery and pass status.
- `POST /public/orders/{order_id}/cancellations?token=…` — request organizer review.
- `POST /public/orders/{order_id}/transfers?token=…` — initiate transfer of one pass.
- `GET /public/transfers/{token}` and `POST /public/transfers/{token}/accept` — accept a transfer and rotate the QR.
- `POST /public/events/{event_id}/waitlist` — join a ticket-type waitlist.
- `GET /public/waitlist/offers/{token}` — validate a timed inventory offer.

Public order creation is idempotent at the provider webhook boundary. Clients must follow the returned checkout URL and must never infer payment success from the browser redirect; the private order endpoint is authoritative.

## Organizer endpoints

Organizer calls require a short-lived, event-scoped bearer token issued by the core backend. Owner/admin authorization and matching organization/event scope are enforced server-side.

- Event configuration, payout connection, fee and tax policy
- Ticket products, promo codes and waitlist operations
- Sales, settlement reconciliation and balanced accounting journal
- Refunds by amount or selected `guest_ids`
- Cancellation decisions and fulfillment/delivery retries
- Complimentary issuance and ticket audit history
- Provider webhook operations, safe maintenance and emailed reports

## Payment webhooks

- `POST /webhooks/stripe`
- `POST /webhooks/paystack`

Signatures are mandatory. Provider event IDs are unique, duplicate delivery is safe, and processing outcomes are visible in the organizer operations log. Ticket issuance occurs only after amount and currency verification.

## Financial invariants

- Every successful payment and refund posts a balanced journal transaction.
- Journal rows are append-only at the database level.
- Tax, Festio revenue, organizer payable and provider clearing are separate accounts.
- A refund never exceeds the remaining refundable amount.
- Ticket-level refunds cannot refund the same pass twice.
- Inventory is released only when the refund provider confirms completion.

## Error conventions

Errors use FastAPI's JSON form: `{ "detail": "…" }`. Expected statuses include `400` invalid input, `401` missing/invalid identity, `403` wrong role or tenant scope, `404` unavailable resource, `409` inventory/state conflict, `429` checkout velocity limit and `502/503` provider dependency failure.

## Production enablement checklist

Paid production checkout is blocked until ticket currency, matching live credentials, organizer payout routing, dashboard webhook configuration and an enabled alert destination are confirmed in the go-live checklist. Confirmation does not prove settlement or complete legal/tax review and recovery drills. Free registration remains available without payment setup. Never place provider secret keys in browser code or documentation.

## Organizer reporting and setup endpoints

- `GET /events/{event_id}/go-live` — current prerequisites; does not expose credentials.
- `POST /events/{event_id}/setup-confirmation` — explicitly confirm saved currency, selected payout account, dashboard webhook or alert destination.
- `GET /events/{event_id}/sales?q=&status=&from_date=&to_date=&limit=50&offset=0` — filtered, paginated safe order projections plus filtered totals and seven UTC days of activity. No checkout access tokens or QR payloads.
- `GET /events/{event_id}/sales-export?kind=orders|attendees|refunds|provider` — bounded CSV export with the same filters; formula-like cells are escaped.
- `POST /events/{event_id}/orders/bulk-resend` — at most 20 explicit order IDs; returns queued and skipped outcomes. Individual resends have a five-minute cooldown.

Public order creation can return 429 for checkout velocity or pending-order limits, and 409 when paid sales are not ready. Promo limits include pending reservations. Queue timestamps do not prove email delivery: authenticated, correlated provider receipts establish Delivered; legacy uncorrelated mail stays unknown.
