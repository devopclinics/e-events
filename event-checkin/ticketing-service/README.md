# Festio ticketing-service

Standalone paid-admission service for the Compose **staging** environment.
It owns ticket products, inventory holds, orders, provider events, refunds and
the financial ledger. The core backend owns guests, access types, QR passes and
check-in; fulfillment crosses an authenticated, idempotent internal endpoint.

## Safety gates

- `ENVIRONMENT` must equal `staging` or the process refuses to start.
- `PUBLIC_BASE_URL` must be staging or localhost.
- Stripe and Paystack keys must be test keys; Stripe `sk_live_*` and Paystack
  `sk_live_*` cause startup failure.
- `SERVICE_ENABLED=false` is the master kill switch. It hides the staging nav,
  hides checkout on guest pages, and returns 404 from public catalog/order APIs.
- Each event has a second `enabled` switch, off by default.
- Kubernetes production has no Deployment, Service, route, secret or database
  for ticketing. `https://festio.events/api/ticketing/status` must remain 404.

## Provider configuration

- Stripe: set `TICKETING_STRIPE_TEST_SECRET_KEY` and
  `TICKETING_STRIPE_TEST_WEBHOOK_SECRET` in the root staging `.env`.
- Paystack: the current staging Compose injects the existing Paystack test key
  from `backend/.env`; no live key is accepted.
- Webhook URLs:
  - `https://staging.festio.events/api/ticketing/webhooks/stripe`
  - `https://staging.festio.events/api/ticketing/webhooks/paystack`

The organizer selects Stripe/USD or Paystack/NGN and can optionally supply a
Stripe connected-account ID or Paystack subaccount code for split settlement.

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
