#!/usr/bin/env python3
"""Submit Festio message templates to Bird.

The script is intentionally idempotent:
- existing active/pending templates are skipped
- missing templates are created as channelTemplate projects
- created templates are activated for platform review when --submit is used

Current practical support:
- WhatsApp text templates, including the Experience templates that were added
  after the first WhatsApp submission batch.
- RCS preflight. RCS template creation is blocked until a Google RCS channel is
  installed in the workspace and a template-capable access key is available.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen


BIRD_API_BASE = "https://api.bird.com"
DEFAULT_LOCALE = "en"
DEFAULT_FOOTER = "Festio · Event operations"


SAMPLE_VALUES = {
    "firstName": "Aisha",
    "guestName": "Aisha Bello",
    "eventName": "Women's Convention 2026",
    "eventDate": "July 17, 2026",
    "ticketUrl": "https://festio.events/scan/sample-pass-token",
    "rsvpLink": "https://festio.events/rsvp/sample-rsvp-token",
    "ticketLink": "https://festio.events/scan/sample-pass-token",
    "tableName": "Table 12",
    "seatNumber": "Seat 4",
    "registryLink": "https://festio.events/registry/sample-event",
    "experienceSteps": "Consent, souvenir pickup, room assignment",
    "downloadLink": "https://festio.events/scan/sample-pass-token#consent",
    "stepTitle": "Souvenir pickup",
    "stepMessage": "Your convention gift bag has been collected.",
    "roomName": "Red Oak Ballroom",
    "sessionTopic": "Opening Keynote",
    "sessionDate": "July 17, 2026",
    "sessionTime": "6:00 PM",
    "sessionRoom": "Main Hall",
    "message": "Doors open at 5:30 PM. Please bring your pass.",
}


@dataclass(frozen=True)
class TemplateDef:
    project_name: str
    platform_name: str
    body: str
    variables: tuple[str, ...]
    category: str = "UTILITY"
    group: str = "standard"


TEMPLATES: list[TemplateDef] = [
    TemplateDef(
        "Ticket/pass invitation",
        "festio_ticket_pass_invite",
        "Hi {{firstName}}, your ticket for {{eventName}} on {{eventDate}} is ready. "
        "Open your Festio Pass here: {{ticketUrl}} Show this pass at entry.",
        ("firstName", "eventName", "eventDate", "ticketUrl"),
    ),
    TemplateDef(
        "RSVP invitation",
        "festio_rsvp_invitation",
        "Hi {{guestName}}, please confirm your attendance for {{eventName}}. "
        "RSVP here: {{rsvpLink}} Thank you.",
        ("guestName", "eventName", "rsvpLink"),
    ),
    TemplateDef(
        "RSVP reminder",
        "festio_rsvp_reminder",
        "Hi {{firstName}}, a reminder to confirm your attendance for {{eventName}}. "
        "RSVP here: {{rsvpLink}} Thank you.",
        ("firstName", "eventName", "rsvpLink"),
    ),
    TemplateDef(
        "RSVP confirmation",
        "festio_rsvp_confirmation",
        "Hi {{firstName}}, your RSVP for {{eventName}} on {{eventDate}} is confirmed. "
        "We have saved your place.",
        ("firstName", "eventName", "eventDate"),
    ),
    TemplateDef(
        "RSVP decline",
        "festio_rsvp_decline",
        "Hi {{firstName}}, your RSVP response for {{eventName}} has been recorded as "
        "not attending. Thank you for the update.",
        ("firstName", "eventName"),
    ),
    TemplateDef(
        "Approval pending",
        "festio_approval_pending",
        "Hi {{firstName}}, we received your RSVP for {{eventName}}. "
        "It is pending approval and we will update you soon.",
        ("firstName", "eventName"),
    ),
    TemplateDef(
        "Approval accepted",
        "festio_approval_accepted",
        "Hi {{firstName}}, your RSVP for {{eventName}} is approved. "
        "Open your Festio Pass here: {{ticketUrl}} Show this pass at entry.",
        ("firstName", "eventName", "ticketUrl"),
    ),
    TemplateDef(
        "Approval rejected",
        "festio_approval_rejected",
        "Hi {{firstName}}, your RSVP request for {{eventName}} could not be approved. "
        "Thank you for your interest.",
        ("firstName", "eventName"),
    ),
    TemplateDef(
        "Check-in confirmation",
        "festio_admission_confirmation",
        "Hi {{firstName}}, you are checked in to {{eventName}}. "
        "Table: {{tableName}}. Seat: {{seatNumber}}. You are all set.",
        ("firstName", "eventName", "tableName", "seatNumber"),
    ),
    TemplateDef(
        "Logistics notification",
        "festio_logistics_notification",
        "Hi {{firstName}}, your item for {{eventName}} is on its way. "
        "Please check your delivery details if needed.",
        ("firstName", "eventName"),
    ),
    TemplateDef(
        "Gift registry message",
        "festio_gift_registry",
        "Gift registry information for {{eventName}} is available here: {{registryLink}} Thank you.",
        ("eventName", "registryLink"),
        category="MARKETING",
    ),
    TemplateDef(
        "Experience pass invite",
        "festio_experience_pass_invite",
        "Hi {{firstName}}, your {{eventName}} Experience Pass is ready. "
        "Use it for check-in, consent, activity steps, room assignments, and sessions: "
        "{{ticketUrl}} Keep it handy.",
        ("firstName", "eventName", "ticketUrl"),
        group="experience",
    ),
    TemplateDef(
        "Experience check-in confirmation",
        "festio_experience_admission_confirmation",
        "Welcome {{firstName}}, you are checked in for {{eventName}}. "
        "Your Experience steps are now active. Open your pass here: {{ticketUrl}} Keep it handy.",
        ("firstName", "eventName", "ticketUrl"),
        group="experience",
    ),
    TemplateDef(
        "Experience next steps",
        "festio_experience_next_steps",
        "Hi {{firstName}}, your next steps for {{eventName}} are: {{experienceSteps}} "
        "Open your pass here: {{ticketUrl}} Staff can help onsite.",
        ("firstName", "eventName", "experienceSteps", "ticketUrl"),
        group="experience",
    ),
    TemplateDef(
        "Experience consent copy",
        "festio_experience_consent_copy",
        "Hi {{firstName}}, your signed consent copy for {{eventName}} is ready. "
        "Download it here: {{downloadLink}} Keep this for your records.",
        ("firstName", "eventName", "downloadLink"),
        group="experience",
    ),
    TemplateDef(
        "Experience souvenir completion v2",
        "festio_experience_souvenir_completion_v2",
        "Hi {{firstName}}, your {{stepTitle}} step for {{eventName}} is complete. "
        "This records that staff finished the activity for your event visit. "
        "Thank you for attending.",
        ("firstName", "stepTitle", "eventName"),
        group="experience",
    ),
    TemplateDef(
        "Experience room assignment",
        "festio_experience_room_assignment",
        "Hi {{firstName}}, your room assignment for {{eventName}} is ready. "
        "Room: {{roomName}}. Table: {{tableName}}. Seat: {{seatNumber}}. "
        "Please show staff if needed.",
        ("firstName", "eventName", "roomName", "tableName", "seatNumber"),
        group="experience",
    ),
    TemplateDef(
        "Experience session attendance v2",
        "festio_experience_session_attendance_v2",
        "Hi {{firstName}}, your attendance for {{sessionTopic}} at {{eventName}} has been "
        "recorded. This confirms staff checked you in for that session. Thank you.",
        ("firstName", "sessionTopic", "eventName"),
        group="experience",
    ),
    # Generic announcement carrier for host broadcasts + FestioMe urgent
    # escalations (the only flows with freeform organizer text). Kept neutral /
    # transactional — no promo or opt-out language — to stay Utility-classified.
    TemplateDef(
        "Event announcement",
        "festio_event_announcement",
        # WhatsApp rejects a body that ends with a variable, so {{ticketLink}} sits
        # before the static closing line.
        "Hi {{firstName}}, an update about {{eventName}}: {{message}} "
        "Your pass: {{ticketLink}} — sent via Festio.",
        ("firstName", "eventName", "message", "ticketLink"),
        category="UTILITY",
    ),
]


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


def request_json(method: str, path: str, *, access_key: str, body: dict[str, Any] | None = None,
                 query: dict[str, str] | None = None) -> tuple[int, dict[str, Any]]:
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
            return response.status, json.loads(raw) if raw else {}
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(detail)
        except Exception:
            parsed = {"raw": detail}
        return exc.code, parsed
    except URLError as exc:
        raise SystemExit(f"Bird API request failed: {exc}") from exc


def list_all_projects(workspace_id: str, access_key: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    token = ""
    while True:
        query = {"limit": "100", "type": "channelTemplate"}
        if token:
            query["pageToken"] = token
        status, data = request_json("GET", f"/workspaces/{workspace_id}/projects", access_key=access_key, query=query)
        if status >= 400:
            raise SystemExit(f"Could not list Bird projects: HTTP {status} {json.dumps(data)}")
        out.extend(data.get("results") or [])
        token = data.get("nextPageToken") or ""
        if not token:
            return out


def list_channels(workspace_id: str, access_key: str) -> list[dict[str, Any]]:
    status, data = request_json("GET", f"/workspaces/{workspace_id}/channels", access_key=access_key, query={"limit": "100"})
    if status >= 400:
        raise SystemExit(f"Could not list Bird channels: HTTP {status} {json.dumps(data)}")
    return data.get("results") or []


def variable_defs(names: tuple[str, ...]) -> list[dict[str, Any]]:
    return [
        {
            "key": name,
            "type": "string",
            "format": "none",
            "examplesLocale": {
                DEFAULT_LOCALE: {"exampleValueStrings": [SAMPLE_VALUES.get(name, "Sample value")]}
            },
        }
        for name in names
    ]


def block(role: str, text: str) -> dict[str, Any]:
    return {
        "id": uuid.uuid4().hex[:22],
        "type": "text",
        "role": role,
        "text": {"text": text},
    }


def whatsapp_payload(template: TemplateDef, channel_group_id: str) -> dict[str, Any]:
    return {
        "description": f"Festio {template.group} WhatsApp template: {template.project_name}.",
        "defaultLocale": DEFAULT_LOCALE,
        "variables": variable_defs(template.variables),
        "deployments": [
            {
                "key": "whatsappTemplateName",
                "locale": None,
                "platform": "whatsapp",
                "channelIds": None,
                "value": template.platform_name,
            },
            {
                "key": "whatsappCategory",
                "locale": None,
                "platform": "whatsapp",
                "channelIds": None,
                "value": template.category,
            },
        ],
        "platformContent": [
            {
                "locale": DEFAULT_LOCALE,
                "type": "text",
                "platform": "whatsapp",
                "channelIds": None,
                "channelGroupIds": [channel_group_id],
                "blocks": [
                    block("body", template.body),
                    block("footer", DEFAULT_FOOTER),
                ],
            }
        ],
        "supportedPlatforms": ["whatsapp"],
        "shortLinks": {"enabled": True, "domain": "brd5.us"},
    }


def template_state(project: dict[str, Any]) -> str:
    if (project.get("activeCount") or 0) > 0:
        return "active"
    if (project.get("pendingCount") or 0) > 0:
        return "pending"
    return "draft"


def existing_lookup(projects: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    by_name: dict[str, dict[str, Any]] = {}
    for project in projects:
        name = project.get("name")
        if name:
            by_name[name.lower()] = project
    return by_name


def find_whatsapp_channel_group(projects: list[dict[str, Any]], explicit: str = "") -> str:
    if explicit:
        return explicit
    for project in projects:
        if "whatsapp" not in (project.get("supportedPlatforms") or []):
            continue
        for group_id in project.get("approvedTemplateChannelGroupIds") or []:
            if group_id:
                return group_id
    return ""


def create_project(workspace_id: str, access_key: str, template: TemplateDef, submit: bool) -> dict[str, Any]:
    body = {
        "name": template.project_name,
        "description": f"Festio {template.group} message template submitted by automation.",
        "type": "channelTemplate",
        "scope": 3,
    }
    if not submit:
        return {"id": "(dry-run project id)"}
    status, data = request_json("POST", f"/workspaces/{workspace_id}/projects", access_key=access_key, body=body)
    if status == 409:
        raise RuntimeError(f"duplicate project during create: {template.project_name}")
    if status >= 400:
        raise RuntimeError(f"create project failed HTTP {status}: {json.dumps(data)}")
    return data


def clear_unapproved_channel_templates(workspace_id: str, access_key: str, project_id: str) -> None:
    """Delete any draft OR pending channel-template so a fresh version can be
    created and activated. Used when re-submitting an unapproved project (a prior
    activation failed, or the template is being revised before approval). Active
    (approved) templates are never touched — the caller skips those projects."""
    status, data = request_json(
        "GET", f"/workspaces/{workspace_id}/projects/{project_id}/channel-templates", access_key=access_key)
    if status >= 400:
        return
    for tmpl in (data.get("results") or []):
        if str(tmpl.get("status", "")).lower() in {"draft", "pending"} and tmpl.get("id"):
            request_json(
                "DELETE",
                f"/workspaces/{workspace_id}/projects/{project_id}/channel-templates/{tmpl['id']}",
                access_key=access_key,
            )


def create_channel_template(workspace_id: str, access_key: str, project_id: str, payload: dict[str, Any],
                            submit: bool) -> dict[str, Any]:
    if not submit:
        return {"id": "(dry-run channel template id)", "status": "draft"}
    status, data = request_json(
        "POST",
        f"/workspaces/{workspace_id}/projects/{project_id}/channel-templates",
        access_key=access_key,
        body=payload,
    )
    if status >= 400:
        raise RuntimeError(f"create channel template failed HTTP {status}: {json.dumps(data)}")
    return data


def activate_channel_template(workspace_id: str, access_key: str, project_id: str, channel_template_id: str,
                              submit: bool) -> dict[str, Any]:
    if not submit:
        return {}
    status, data = request_json(
        "PUT",
        f"/workspaces/{workspace_id}/projects/{project_id}/channel-templates/{channel_template_id}/activate",
        access_key=access_key,
    )
    if status >= 400:
        raise RuntimeError(f"activate channel template failed HTTP {status}: {json.dumps(data)}")
    return data


def main() -> int:
    root = Path(__file__).resolve().parents[2]
    load_env(root / ".env")
    load_env(root / "backend" / ".env")

    parser = argparse.ArgumentParser(description="Submit Festio message templates to Bird.")
    parser.add_argument("--workspace-id", default=os.getenv("BIRD_WORKSPACE_ID") or os.getenv("bird_workspace_id", ""))
    parser.add_argument("--access-key", default=os.getenv("BIRD_ACCESS_KEY") or os.getenv("bird_access_key", ""))
    parser.add_argument("--platform", choices=["whatsapp", "rcs"], default="whatsapp")
    parser.add_argument("--groups", choices=["standard", "experience", "all"], default="all")
    parser.add_argument("--channel-group-id", default=os.getenv("BIRD_WHATSAPP_CHANNEL_GROUP_ID", ""))
    parser.add_argument("--submit", action="store_true", help="Actually call Bird. Omit for dry-run.")
    args = parser.parse_args()

    if not args.workspace_id:
        raise SystemExit("Missing Bird workspace id.")
    if not args.access_key:
        raise SystemExit("Missing Bird access key.")

    channels = list_channels(args.workspace_id, args.access_key)
    if args.platform == "rcs":
        rcs_channels = [c for c in channels if "rcs" in str(c.get("platformId", "")).lower()]
        if not rcs_channels:
            print("BLOCKED: no Google RCS channel is installed in this Bird workspace.")
            print("Installed channel platforms:", ", ".join(str(c.get("platformId")) for c in channels))
            return 2
        print("BLOCKED: RCS channel exists, but this script needs the exact Bird RCS platformContent shape before submit.")
        return 2

    projects = list_all_projects(args.workspace_id, args.access_key)
    by_name = existing_lookup(projects)
    channel_group_id = find_whatsapp_channel_group(projects, args.channel_group_id)
    if not channel_group_id:
        print("BLOCKED: no WhatsApp channel group id found. Provide --channel-group-id.")
        return 2

    selected = [
        t for t in TEMPLATES
        if args.groups == "all" or t.group == args.groups
    ]

    print(f"Bird workspace: {args.workspace_id}")
    print(f"Platform: {args.platform}")
    print(f"Mode: {'SUBMIT' if args.submit else 'DRY RUN'}")
    print(f"Templates selected: {len(selected)}")

    created = []
    skipped = []
    failed = []
    for template in selected:
        existing = by_name.get(template.project_name.lower())
        if existing and template_state(existing) == "active":
            skipped.append((template.project_name, "active"))
            print(f"SKIP {template.project_name}: active")
            continue
        try:
            print(f"CREATE {template.project_name} -> {template.platform_name}")
            # Reuse a leftover draft project (e.g. a prior activate failed) instead
            # of re-creating it, which would 409 as a duplicate.
            if existing and args.submit:
                project = existing
                clear_unapproved_channel_templates(args.workspace_id, args.access_key, project["id"])
            else:
                project = create_project(args.workspace_id, args.access_key, template, args.submit)
            channel_template = create_channel_template(
                args.workspace_id,
                args.access_key,
                project["id"],
                whatsapp_payload(template, channel_group_id),
                args.submit,
            )
            activate_channel_template(
                args.workspace_id,
                args.access_key,
                project["id"],
                channel_template["id"],
                args.submit,
            )
            created.append((template.project_name, project["id"], channel_template["id"]))
        except Exception as exc:
            failed.append((template.project_name, str(exc)))
            print(f"FAIL {template.project_name}: {exc}")

    print("")
    print(f"Created/activated: {len(created)}")
    print(f"Skipped existing active/pending: {len(skipped)}")
    print(f"Failed: {len(failed)}")
    if failed:
        print("Failures:")
        for name, reason in failed:
            print(f"- {name}: {reason}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
