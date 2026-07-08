#!/usr/bin/env python3
"""Create the Festio Bird 10DLC brand and campaign.

Dry-run is the default. Pass --submit to call Bird's API.

Examples:
  python3 scripts/bird_10dlc_campaign.py --list-brands
  python3 scripts/bird_10dlc_campaign.py --create-brand
  python3 scripts/bird_10dlc_campaign.py --create-brand --submit
  python3 scripts/bird_10dlc_campaign.py --brand-id <brand_id>
  python3 scripts/bird_10dlc_campaign.py --brand-id <brand_id> --submit
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


BIRD_API_BASE = "https://api.bird.com"


DEFAULT_BRAND = {
    "entityType": "PRIVATE_PROFIT",
    "displayName": "Festio",
    "companyName": "FOHMA Solutions LLC",
    "ein": "332603330",
    "einIssuingCountry": "US",
    "phone": "+18327941707",
    "street": "6550 Fairway Glen Lane",
    "city": "Katy",
    "state": "TX",
    "postalCode": "77493",
    "country": "US",
    "email": "muritala@festio.events",
    "website": "https://festio.events",
    "vertical": "ENTERTAINMENT",
    "stockExchange": "NONE",
    "altBusinessIdType": "NONE",
    "businessContactEmail": "muritala@festio.events",
}


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def campaign_payload(
    *,
    name: str = "Festio - Event Ticket & Check-in Notifications",
    usecase: str = "LOW_VOLUME",
    sub_usecases: list[str] | None = None,
    attachment_urls: list[str] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "name": name,
        "usecase": usecase,
        "description": (
            "Festio is an event invitation, RSVP, QR ticket, and check-in platform "
            "operated by FOHMA Solutions LLC. Event organizers add or invite their "
            "own guests. Guests provide a phone number when RSVPing or when added "
            "by the organizer, and can consent to SMS for that specific event. "
            "Festio sends low-volume transactional event messages only: a personal "
            "RSVP or ticket link, a QR ticket/pass link, check-in confirmation, "
            "and optional seat updates. Messages are not promotional or marketing."
        ),
        "embeddedLink": True,
        "embeddedPhone": False,
        "numberPool": False,
        "ageGated": False,
        "directLending": False,
        "subscriberOptin": True,
        "subscriberOptout": True,
        "subscriberHelp": True,
        "samples": [
            (
                "Festio: Hi Amara! You're invited to Johnson Wedding on Aug 12, 2026. "
                "Your ticket: https://festio.events/scan/abc123 Reply HELP for help, STOP to opt out. Message and data rates may apply."
            ),
            (
                "Festio: Welcome Amara! You're checked in to Johnson Wedding. "
                "Table: VIP-2 seat 4. Reply HELP for help, STOP to opt out. Message and data rates may apply."
            ),
            "Festio: Your seat for Johnson Wedding changed to Table 2, Seat 6. Reply HELP for help, STOP to opt out. Message and data rates may apply.",
        ],
        "messageFlow": (
            "Mobile opt-in path: the guest opens their Festio RSVP link on a phone, for example "
            "https://festio.events/rsvp/{event-token}, enters or confirms their mobile number, "
            "checks the SMS/text notifications consent checkbox, and taps the RSVP/submit button. "
            "A ticket/pass path such as https://festio.events/scan/{guest-token} also lets a guest "
            "view or update event messaging preferences. The page identifies Festio by FOHMA "
            "Solutions LLC and the public evidence page at https://festio.events/sms-policy shows "
            "the exact opt-in statement: I agree to receive SMS/text messages from Festio for this "
            "event, including invitation or ticket links, QR passes, RSVP updates, check-in "
            "confirmations, seating updates, session reminders, and other event-service "
            "notifications. Message frequency varies by event. Message and data rates may apply. "
            "Reply HELP for help. Reply STOP to opt out at any time. Consent is not required to "
            "buy goods or services. Privacy Policy: https://festio.events/privacy. Guests can also "
            "opt out by replying STOP or contacting events@festio.events."
        ),
        "helpMessage": (
            "Festio: For help, email events@festio.events. Reply START to opt in, "
            "STOP to opt out. Message and data rates may apply."
        ),
        "helpKeywords": "HELP",
        "optoutKeywords": "STOP",
        "optinKeywords": "START,SUBSCRIBE,YES",
        "optinMessage": (
            "Festio: You've opted in to event SMS updates for tickets and check-in. "
            "Frequency varies by event. Reply HELP for help, STOP to opt out. "
            "Message and data rates may apply."
        ),
        "optoutMessage": (
            "Festio: You have opted out of event SMS updates. You will not receive more texts. "
            "Reply START to opt back in."
        ),
        "termsAndConditions": True,
    }
    if sub_usecases:
        payload["subUsecases"] = sub_usecases
    if attachment_urls:
        payload["attachmentUrls"] = attachment_urls
    return payload


def brand_payload(args: argparse.Namespace | None = None) -> dict[str, Any]:
    payload = dict(DEFAULT_BRAND)
    if args is None:
        return payload
    overrides = {
        "entityType": args.brand_entity_type,
        "displayName": args.brand_display_name,
        "companyName": args.brand_company_name,
        "ein": args.brand_ein,
        "phone": args.brand_phone,
        "street": args.brand_street,
        "city": args.brand_city,
        "state": args.brand_state,
        "postalCode": args.brand_postal_code,
        "country": args.brand_country,
        "email": args.brand_email,
        "website": args.brand_website,
        "vertical": args.brand_vertical,
        "businessContactEmail": args.brand_business_contact_email,
    }
    for key, value in overrides.items():
        if value:
            payload[key] = value
    return payload


def validate_brand_payload(payload: dict[str, Any]) -> None:
    required = (
        "entityType", "displayName", "companyName", "ein", "einIssuingCountry",
        "phone", "street", "city", "state", "postalCode", "country", "email",
        "website", "vertical",
    )
    missing = [field for field in required if not str(payload.get(field, "")).strip()]
    if missing:
        raise ValueError(f"Missing required brand fields: {', '.join(missing)}")
    if payload["entityType"] != "PRIVATE_PROFIT":
        raise ValueError("Festio/FOHMA should be registered as PRIVATE_PROFIT, not NON_PROFIT")
    if payload["companyName"] != "FOHMA Solutions LLC":
        raise ValueError("companyName must match the LLC legal name")
    if payload["website"] != "https://festio.events":
        raise ValueError("website must match the Festio campaign domain")
    if not str(payload["phone"]).startswith("+"):
        raise ValueError("phone must be E.164, e.g. +18327941707")


def validate_campaign_payload(payload: dict[str, Any]) -> None:
    limits = {
        "description": 4096,
        "messageFlow": 2048,
        "helpMessage": 255,
    }
    for field, limit in limits.items():
        value = payload.get(field, "")
        if len(value) > limit:
            raise ValueError(f"{field} is {len(value)} chars; Bird max is {limit}")
    samples = payload.get("samples", [])
    if not 1 <= len(samples) <= 5:
        raise ValueError("Bird requires 1-5 sample messages")
    for i, sample in enumerate(samples, 1):
        if "Festio:" not in sample or "STOP" not in sample:
            raise ValueError(f"sample {i} must identify Festio and include STOP language")


def request_json(method: str, path: str, *, access_key: str, body: dict[str, Any] | None = None,
                 query: dict[str, str] | None = None) -> dict[str, Any]:
    url = f"{BIRD_API_BASE}{path}"
    if query:
        url = f"{url}?{urlencode(query)}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"AccessKey {access_key}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
    )
    try:
        with urlopen(request, timeout=30) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"Bird API HTTP {exc.code}: {detail}") from exc
    except URLError as exc:
        raise SystemExit(f"Bird API request failed: {exc}") from exc


def parse_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def main() -> int:
    default_env = Path(__file__).resolve().parents[1] / ".env"
    load_env(default_env)

    parser = argparse.ArgumentParser(description="Create the Festio Bird 10DLC brand and campaign.")
    parser.add_argument("--workspace-id", default=os.getenv("BIRD_WORKSPACE_ID", ""))
    parser.add_argument("--access-key", default=os.getenv("BIRD_ACCESS_KEY", ""))
    parser.add_argument("--brand-id", default=os.getenv("BIRD_TCR_BRAND_ID", ""))
    parser.add_argument("--campaign-id", default=os.getenv("BIRD_TCR_CAMPAIGN_ID", ""))
    parser.add_argument("--create-brand", action="store_true", help="Create a new Festio/FOHMA 10DLC brand.")
    parser.add_argument("--brand-entity-type", default=os.getenv("BIRD_TCR_BRAND_ENTITY_TYPE", DEFAULT_BRAND["entityType"]))
    parser.add_argument("--brand-display-name", default=os.getenv("BIRD_TCR_BRAND_DISPLAY_NAME", DEFAULT_BRAND["displayName"]))
    parser.add_argument("--brand-company-name", default=os.getenv("BIRD_TCR_BRAND_COMPANY_NAME", DEFAULT_BRAND["companyName"]))
    parser.add_argument("--brand-ein", default=os.getenv("BIRD_TCR_BRAND_EIN", DEFAULT_BRAND["ein"]))
    parser.add_argument("--brand-phone", default=os.getenv("BIRD_TCR_BRAND_PHONE", DEFAULT_BRAND["phone"]))
    parser.add_argument("--brand-street", default=os.getenv("BIRD_TCR_BRAND_STREET", DEFAULT_BRAND["street"]))
    parser.add_argument("--brand-city", default=os.getenv("BIRD_TCR_BRAND_CITY", DEFAULT_BRAND["city"]))
    parser.add_argument("--brand-state", default=os.getenv("BIRD_TCR_BRAND_STATE", DEFAULT_BRAND["state"]))
    parser.add_argument("--brand-postal-code", default=os.getenv("BIRD_TCR_BRAND_POSTAL_CODE", DEFAULT_BRAND["postalCode"]))
    parser.add_argument("--brand-country", default=os.getenv("BIRD_TCR_BRAND_COUNTRY", DEFAULT_BRAND["country"]))
    parser.add_argument("--brand-email", default=os.getenv("BIRD_TCR_BRAND_EMAIL", DEFAULT_BRAND["email"]))
    parser.add_argument("--brand-website", default=os.getenv("BIRD_TCR_BRAND_WEBSITE", DEFAULT_BRAND["website"]))
    parser.add_argument("--brand-vertical", default=os.getenv("BIRD_TCR_BRAND_VERTICAL", DEFAULT_BRAND["vertical"]))
    parser.add_argument(
        "--brand-business-contact-email",
        default=os.getenv("BIRD_TCR_BRAND_BUSINESS_CONTACT_EMAIL", DEFAULT_BRAND["businessContactEmail"]),
    )
    parser.add_argument("--name", default="Festio - Event Ticket & Check-in Notifications")
    parser.add_argument("--usecase", default=os.getenv("BIRD_TCR_USECASE", "LOW_VOLUME"))
    parser.add_argument(
        "--sub-usecases",
        default=os.getenv("BIRD_TCR_SUB_USECASES", "ACCOUNT_NOTIFICATION,CUSTOMER_CARE"),
        help="Comma-separated TCR sub-usecases for LOW_VOLUME/MIXED campaigns.",
    )
    parser.add_argument(
        "--attachment-url",
        action="append",
        default=[],
        help="Public HTTPS URL for opt-in evidence. May be provided up to 5 times.",
    )
    parser.add_argument("--list-brands", action="store_true")
    parser.add_argument("--list-campaigns", action="store_true")
    parser.add_argument("--submit", action="store_true", help="Actually POST/PATCH to Bird. Default is dry-run.")
    args = parser.parse_args()

    if not args.workspace_id:
        raise SystemExit("Missing BIRD_WORKSPACE_ID or --workspace-id")
    if not args.access_key:
        raise SystemExit("Missing BIRD_ACCESS_KEY or --access-key")

    if args.list_brands:
        data = request_json(
            "GET",
            f"/workspaces/{args.workspace_id}/tcr-brands",
            access_key=args.access_key,
            query={"limit": "99"},
        )
        print(json.dumps(data, indent=2))
        return 0

    if args.list_campaigns:
        if not args.brand_id:
            raise SystemExit("Missing --brand-id for --list-campaigns")
        data = request_json(
            "GET",
            f"/workspaces/{args.workspace_id}/tcr-brands/{args.brand_id}/campaigns",
            access_key=args.access_key,
            query={"limit": "99"},
        )
        print(json.dumps(data, indent=2))
        return 0

    if args.create_brand:
        payload = brand_payload(args)
        validate_brand_payload(payload)
        path = f"/workspaces/{args.workspace_id}/tcr-brands"

        if not args.submit:
            print(f"DRY RUN: would POST {BIRD_API_BASE}{path}")
            print(json.dumps(payload, indent=2))
            print("\nPass --submit to create this brand in Bird.")
            return 0

        data = request_json("POST", path, access_key=args.access_key, body=payload)
        print(json.dumps(data, indent=2))
        return 0

    if not args.brand_id:
        raise SystemExit("Missing BIRD_TCR_BRAND_ID or --brand-id. Run --list-brands first.")

    payload = campaign_payload(
        name=args.name,
        usecase=args.usecase,
        sub_usecases=parse_csv(args.sub_usecases),
        attachment_urls=args.attachment_url,
    )
    validate_campaign_payload(payload)

    if args.campaign_id:
        method = "PATCH"
        path = f"/workspaces/{args.workspace_id}/tcr-brands/{args.brand_id}/campaigns/{args.campaign_id}"
    else:
        method = "POST"
        path = f"/workspaces/{args.workspace_id}/tcr-brands/{args.brand_id}/campaigns"

    if not args.submit:
        print(f"DRY RUN: would {method} {BIRD_API_BASE}{path}")
        print(json.dumps(payload, indent=2))
        print("\nPass --submit to send this to Bird.")
        return 0

    data = request_json(method, path, access_key=args.access_key, body=payload)
    print(json.dumps(data, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
