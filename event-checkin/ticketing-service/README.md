# Festio ticketing-service

Standalone admission service for staging and production.
It owns ticket products, inventory holds, orders, provider events, refunds and
the financial ledger. The core backend owns guests, access types, QR passes and
check-in; fulfillment crosses an authenticated, idempotent internal endpoint.

## Safety gates and go-live setup

- `SERVICE_ENABLED=false` disables public catalog and checkout APIs. Each event also has an `enabled` switch.
- Staging requires test credentials and a staging/local public URL. Production requires production credentials; deployment is managed through the event-checkin GitOps chart.
- Paid production checkouts require the event's go-live checklist: explicit ticket currency confirmation, matching payment credentials, a connected and explicitly confirmed organizer payout account, provider-dashboard webhook confirmation, and an enabled operations alert destination.
- Confirmations do not convert prices, create bank details, verify a settlement, or replace dashboard setup. Currency is confirmed before creating production products.
- Free orders retain their original test/provider provenance but display as Free. Complimentary admissions display separately. Neither can trigger a payment refund.
- Public checkout has shared database rate limits (120 attempts/IP/event/minute, 10/email/event/hour), a three-pending-order cap per email/event, and promo reservations across pending orders. These are configurable controls, not proof against every form of abuse.
- Trusted forwarded addresses are accepted only through configured proxy CIDRs. Restrict `TRUSTED_PROXY_CIDRS` to the deployment's actual proxy network.

## Provider configuration

Production settings are supplied by the deployment secret store; never copy credentials into source or reports. Stripe uses USD and Paystack uses NGN. Select and review the intended organizer account in Payments before confirming payout routing.

Webhook endpoints are `/api/ticketing/webhooks/stripe` and `/api/ticketing/webhooks/paystack` on the environment's public base URL. Paystack signs requests with the secret key; the presence of that key does not prove that the dashboard webhook URL was configured. See the [Paystack webhook documentation](https://paystack.com/docs/payments/webhooks/) and [split-payment documentation](https://paystack.com/docs/payments/split-payments/).

## Sales and delivery

The sales list has search, status/date filters, 50-row pages and bounded bulk resend. Orders, attendees, refunds and provider reconciliation can be exported as formula-safe CSV. Export values use minor currency units and do not expose buyer access tokens or QR credentials. Provider reports do not establish bank settlement.

Queued means queued for sending. Sent means provider acceptance. Delivered requires a correlated, authenticated email receipt for every expected recipient. Historical uncorrelated sends remain unknown. Resends have a five-minute cooldown.

## Operations

```bash
# Master off (then recreate ticketing-service and restart proxy)
TICKETING_ENABLED=false

# Health/status
curl https://staging.festio.events/api/ticketing/status

# Logs
docker compose -f docker-compose.prod.yaml logs -f ticketing-service
```

Paid webhooks validate signature, amount, currency and provider reference.
Provider event IDs are unique, so replay is safe. Fulfillment retries are safe;
the core backend keys created guests by paid order ID. A full refund releases
inventory and voids the corresponding Festio passes.

## Pausing sales and client identity

Pausing an event closes checkout while retaining organizer access to orders, refunds, reports, exports and Operations. Search and visible-tab report refresh continue while paused. Bulk resend and attendee/refund/tax columns in exports already exist; they do not depend on accepting new sales.

The service uses the nearest non-cluster hop in the forwarded chain. It uses `CF-Connecting-IP` only when that hop is in Cloudflare's published edge ranges and the immediate peer is a configured trusted proxy. Direct-origin client headers are not trusted as Cloudflare evidence. The published IPv4/IPv6 ranges were checked on 2026-10-25: [IPv4 ranges](https://www.cloudflare.com/ips-v4) and [IPv6 ranges](https://www.cloudflare.com/ips-v6). Keep the ranges current when the edge topology changes. The event-scoped, authenticated `GET /events/{event_id}/request-protection` endpoint reports the caller's selected address and limits; only platform superadmins receive underlying hop diagnostics. It does not create an order or increment a limiter.

Database counters remain authoritative across replicas. A bounded per-worker denial cache rejects repeat traffic after a shared limit is reached, without more counter writes until the window resets. It is not a distributed edge WAF or a replacement for inventory/checkout locks. Large-report totals still scan matching financial metadata and need a separate database-aggregation change; processor fee and bank settlement reports require actual connected-provider data.
