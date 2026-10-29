"""New organizer accounts use Stripe-managed risk and direct charges."""
import hashlib

import httpx

from .config import settings
from .provider_errors import stripe_onboarding_error

ACCOUNTS_VERSION = "2026-09-30.endive"


def managed_account(row):
    return bool(row and row.provider == "stripe" and (row.details or {}).get("charge_type") == "direct")


def v2_headers():
    return {"Stripe-Version": ACCOUNTS_VERSION}


async def create_managed_account(org_id, business_name, email, country):
    digest = hashlib.sha256(f"{email.lower()}|{country}".encode()).hexdigest()[:24]
    data = {"display_name": business_name, "contact_email": email,
            "identity": {"country": country}, "dashboard": "full",
            "defaults": {"responsibilities": {"fees_collector": "stripe", "losses_collector": "stripe"}},
            "configuration": {"merchant": {"capabilities": {"card_payments": {"requested": True}}}},
            "metadata": {"festio_org_id": org_id}, "include": ["defaults", "configuration.merchant"]}
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post("https://api.stripe.com/v2/core/accounts", json=data,
            auth=(settings.stripe_secret_key, ""),
            headers={**v2_headers(), "Idempotency-Key": f"festio-managed-{org_id}-{digest}"})
    if response.status_code >= 400:
        raise stripe_onboarding_error(response, "create the Stripe-managed payout account",
                                      (email, business_name, settings.stripe_secret_key))
    return response.json()


async def managed_account_link(account_id):
    data = {"account": account_id, "use_case": {"type": "account_onboarding", "account_onboarding": {
        "configurations": ["merchant"],
        "refresh_url": f"{settings.public_base_url}/ticketing-redesign?stripe=refresh",
        "return_url": f"{settings.public_base_url}/ticketing-redesign?stripe=complete"}}}
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post("https://api.stripe.com/v2/core/account_links", json=data,
            auth=(settings.stripe_secret_key, ""), headers=v2_headers())
    if response.status_code >= 400:
        raise stripe_onboarding_error(response, "start payout onboarding", (account_id, settings.stripe_secret_key))
    return response.json()["url"]


async def refresh_managed_account(row):
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.get(f"https://api.stripe.com/v2/core/accounts/{row.provider_account_id}",
            params=[("include[0]", "configuration.merchant"), ("include[1]", "defaults")],
            auth=(settings.stripe_secret_key, ""), headers=v2_headers())
    if response.status_code >= 400:
        row.charges_enabled = row.payouts_enabled = False
        row.status = "verification_unavailable"
        return
    data = response.json()
    responsibilities = (data.get("defaults") or {}).get("responsibilities") or {}
    capabilities = ((data.get("configuration") or {}).get("merchant") or {}).get("capabilities") or {}
    stripe_risk = responsibilities.get("losses_collector") == "stripe"
    row.charges_enabled = bool(stripe_risk and (capabilities.get("card_payments") or {}).get("status") == "active")
    balance = capabilities.get("stripe_balance") or {}
    row.payouts_enabled = bool(stripe_risk and (balance.get("payouts") or {}).get("status") == "active")
    row.status = "verified" if row.charges_enabled and row.payouts_enabled else "onboarding"
