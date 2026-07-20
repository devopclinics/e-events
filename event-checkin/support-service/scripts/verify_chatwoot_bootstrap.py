"""Verify the one-time Chatwoot bootstrap (see README.md) actually took and
hasn't drifted: required env vars are set, the account/inbox IDs resolve
against Chatwoot's own API, and our webhook is registered on that inbox with
message_created subscribed. Catches config drift at deploy time instead of
a silent crash loop or silently-missing replies.

Usage: python scripts/verify_chatwoot_bootstrap.py
Exit code 0 = all checks passed, 1 = at least one failed.
"""
import asyncio
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).parents[1]))
from app import main as app_main

REQUIRED_VARS = [
    "chatwoot_base_url",
    "chatwoot_account_id",
    "chatwoot_inbox_id",
    "chatwoot_api_access_token",
    "chatwoot_hmac_secret",
    "chatwoot_webhook_token",
]


async def run() -> int:
    settings = app_main.settings
    failures: list[str] = []
    warnings: list[str] = []

    missing = [v.upper() for v in REQUIRED_VARS if not getattr(settings, v, "")]
    if missing:
        failures.append(f"Missing env vars: {', '.join(missing)}")
        # No point calling the API without a token/account/inbox to check.
        _report(failures)
        return 1

    base = settings.chatwoot_base_url.rstrip("/")
    account_id = settings.chatwoot_account_id
    inbox_id = settings.chatwoot_inbox_id
    headers = app_main._chatwoot_headers()

    async with httpx.AsyncClient(timeout=15) as client:
        try:
            resp = await client.get(f"{base}/api/v1/accounts/{account_id}/inboxes/{inbox_id}", headers=headers)
        except httpx.HTTPError as e:
            failures.append(f"Could not reach Chatwoot at {base}: {e}")
            _report(failures)
            return 1

        if resp.status_code == 401:
            failures.append("CHATWOOT_API_ACCESS_TOKEN was rejected (401) — token is wrong, expired, or revoked.")
        elif resp.status_code == 404:
            failures.append(f"CHATWOOT_ACCOUNT_ID={account_id} / CHATWOOT_INBOX_ID={inbox_id} don't resolve to a real inbox (404).")
        elif resp.status_code != 200:
            failures.append(f"Unexpected {resp.status_code} checking the inbox: {resp.text[:300]}")
        else:
            inbox = resp.json()
            if not inbox.get("website_token") and inbox.get("channel_type", "").endswith("WebWidget"):
                failures.append("Inbox has no website_token — is this actually the Website inbox from step 2?")

        try:
            hooks_resp = await client.get(f"{base}/api/v1/accounts/{account_id}/webhooks", headers=headers)
            if hooks_resp.status_code in (401, 403):
                # Listing webhooks is an account-admin operation — Agent Bot tokens
                # (the type step 3 usually produces) can't reach it even when the
                # webhook is configured correctly. Not proof of misconfiguration;
                # confirm manually in Settings > Integrations > Webhooks instead.
                warnings.append(
                    f"Can't verify the webhook is registered — CHATWOOT_API_ACCESS_TOKEN got "
                    f"{hooks_resp.status_code} listing webhooks, which needs an Administrator-role "
                    "token, not an Agent Bot token. Confirm manually in Settings > Integrations > Webhooks."
                )
            else:
                hooks_resp.raise_for_status()
                hooks = hooks_resp.json().get("payload", hooks_resp.json())
                matching = [
                    h for h in hooks
                    if f"token={settings.chatwoot_webhook_token}" in (h.get("url") or "")
                    and "message_created" in (h.get("subscriptions") or [])
                ]
                if not matching:
                    failures.append(
                        "No webhook found subscribed to message_created with our CHATWOOT_WEBHOOK_TOKEN — "
                        "check Settings > Integrations > Webhooks (step 4 in README.md)."
                    )
        except httpx.HTTPError as e:
            warnings.append(f"Could not list webhooks: {e}")

    _report(failures, warnings)
    return 1 if failures else 0


def _report(failures: list[str], warnings: list[str]) -> None:
    if not failures and not warnings:
        print("Chatwoot bootstrap OK: env vars set, inbox resolves, webhook registered.")
        return
    if failures:
        print(f"Chatwoot bootstrap INCOMPLETE — {len(failures)} issue(s):")
        for f in failures:
            print(f"  - {f}")
    if warnings:
        print(f"{len(warnings)} check(s) inconclusive (not failures):")
        for w in warnings:
            print(f"  - {w}")


if __name__ == "__main__":
    sys.exit(asyncio.run(run()))
