# Festio organization Event Pass — staging rollout

Status: implemented behind `ORGANIZATION_ENTITLEMENTS_V2=false` (default). Production behavior is unchanged until explicitly enabled.

## Product rules

- A new organization receives one lifetime free event: maximum 25 guests, email only, and no add-ons.
- The free wallet is 10 credits (100 units). Email costs 1 unit per recipient, equal to 0.1 credit. Authentication, legal and essential account messages are outside this event-message wallet.
- A paid Event Pass belongs to the organization, lasts 12 months, and permits unlimited events while active.
- Every event created under a pass receives that tier's per-event guest limit: Starter 50, Standard 150, Pro 300, Scale 500, or an operator-specified custom limit.
- All paid events consume one organization credit wallet. Every outbound event message consumes the configured channel rate.
- Paid passes unlock all add-ons organization-wide for the first six months. Free organizations never receive add-ons. After the promotion, existing data remains readable; new add-on activity requires purchase or an operator grant.
- Expiry preserves events, guests, reports and remaining credits. It blocks new event creation and paid actions until renewal.
- Operators may activate/change a tier, extend pass or promotion dates, and add/remove credits. Every change requires a reason and writes an immutable audit row.

## What this change safely implements

The first staging slice adds organization pass fields, an integer-unit wallet, an audit table, centralized policy, concurrency-safe create/duplicate gates, compatibility snapshots on new events, and audited superadmin APIs.

The old event-scoped entitlement behavior remains active when the feature flag is false. This gives an instant rollback: set `ORGANIZATION_ENTITLEMENTS_V2=false` and restart the backend; no schema rollback is needed.

The organization wallet is connected to outbound delivery under the feature flag using database row locks, integer units, idempotent ledger keys, and provider-failure refunds. Existing event wallets remain authoritative while the flag is off.

## Staging procedure

1. Back up the staging database and record counts/balances for organizations, events, payments, and credit ledgers.
2. Deploy with `ORGANIZATION_ENTITLEMENTS_V2=false`. The additive migration creates columns/table without changing runtime decisions.
3. Reconcile staging organizations deliberately:
   - mark `free_event_used=true` where an organization already has an event;
   - derive active paid passes only from confirmed payments/operator grants, never merely from `events.is_paid`;
   - choose a start date and 12-month expiry;
   - convert credits to units using `1 credit = 10 units`, with a documented rule for multiple event balances;
   - do not overwrite existing event add-on data.
4. Run reconciliation in report-only mode, review totals, then apply once with an audit reason.
5. Enable `ORGANIZATION_ENTITLEMENTS_V2=true` in staging only.
6. Acceptance test free first/second event, all paid tiers, concurrent creation, expiry, renewal, six-month promo expiry, operator extensions, and negative-credit rejection.
7. Verify existing events remain readable and no outbound provider is contacted by automated tests.
8. Observe staging logs and audit records for at least one full test cycle. Roll back with the flag if any invariant fails.

## API controls

- `GET /admin/orgs/{org_id}/event-pass` returns the organization entitlement snapshot.
- `PATCH /admin/orgs/{org_id}/event-pass` accepts a required `reason` plus `tier`, `guest_cap`, `extend_pass_days`, `extend_addon_promo_days`, or `credit_delta_units`.
- Credit values use integer units. Ten units equal one credit; one email recipient costs one unit.

## Production activation checklist

- Run the reconciliation tool in dry-run mode and have finance/operations approve its totals.
- Apply reconciliation to staging, enable the flag there, and complete the acceptance matrix.
- Schedule `python -m app.send_pass_expiry_notices` daily.
- Configure staging outbound recipient allowlists so tests cannot contact customers.
- Observe staging, then use a reviewed change window to enable production. Rollback is the feature flag.

Support: events@festio.events  
Website: https://festio.events
