"""Bird channelTemplate API calls for self-serve WhatsApp template submission
and review-status polling. Async httpx port of the create/activate/list calls
in scripts/bird_submit_message_templates.py -- that script stays the
developer/batch tool (its dependency footprint is stdlib-only and it isn't
shipped in the backend image, see backend/Dockerfile); this module is the
version actually shipped and called from a live request
(app/routers/wa_template_submissions.py, services/wa_template_poller.py).
"""
import logging
import uuid as _uuid

import httpx

from app.config import settings

logger = logging.getLogger("bird_templates")

_BASE = "https://api.bird.com"
_LOCALE = "en"
_FOOTER = "Festio · Event operations"


def enabled() -> bool:
    return bool(settings.bird_access_key and settings.bird_workspace_id)


def _headers() -> dict:
    return {
        "Authorization": f"AccessKey {settings.bird_access_key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }


async def _request(method: str, path: str, *, json_body: dict | None = None, params: dict | None = None) -> tuple[int, dict]:
    url = f"{_BASE}{path}"
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.request(method, url, headers=_headers(), json=json_body, params=params)
    try:
        data = r.json() if r.content else {}
    except ValueError:
        data = {"raw": r.text}
    return r.status_code, data


async def list_projects() -> list[dict]:
    out: list[dict] = []
    token = ""
    while True:
        params = {"limit": "100", "type": "channelTemplate"}
        if token:
            params["pageToken"] = token
        status, data = await _request("GET", f"/workspaces/{settings.bird_workspace_id}/projects", params=params)
        if status >= 400:
            raise RuntimeError(f"Bird list projects failed HTTP {status}: {data}")
        out.extend(data.get("results") or [])
        token = data.get("nextPageToken") or ""
        if not token:
            return out


async def _channel_group_id() -> str:
    if settings.bird_whatsapp_channel_group_id:
        return settings.bird_whatsapp_channel_group_id
    for project in await list_projects():
        if "whatsapp" not in (project.get("supportedPlatforms") or []):
            continue
        for group_id in project.get("approvedTemplateChannelGroupIds") or []:
            if group_id:
                return group_id
    raise RuntimeError("No WhatsApp channel group found in the Bird workspace — set BIRD_WHATSAPP_CHANNEL_GROUP_ID")


def _variable_defs(variables: list[str], sample_values: dict) -> list[dict]:
    return [
        {
            "key": name,
            "type": "string",
            "format": "none",
            "examplesLocale": {_LOCALE: {"exampleValueStrings": [sample_values.get(name) or "Sample value"]}},
        }
        for name in variables
    ]


def _block(role: str, text: str) -> dict:
    return {"id": _uuid.uuid4().hex[:22], "type": "text", "role": role, "text": {"text": text}}


async def submit_template(*, platform_name: str, body: str, category: str, variables: list[str], sample_values: dict) -> tuple[str, str]:
    """Create + activate a new Bird channelTemplate project. Returns
    (project_id, channel_template_id). Raises RuntimeError on any Bird API
    failure -- caller (wa_template_submissions.py) is responsible for leaving
    the submission row in a state the client can see and retry from."""
    channel_group_id = await _channel_group_id()

    status, project = await _request(
        "POST", f"/workspaces/{settings.bird_workspace_id}/projects",
        json_body={
            "name": platform_name,
            "description": "Festio client-submitted WhatsApp template.",
            "type": "channelTemplate",
            "scope": 3,
        },
    )
    if status >= 400:
        raise RuntimeError(f"Bird project creation failed HTTP {status}: {project}")
    project_id = project["id"]

    payload = {
        "description": f"Festio client-submitted WhatsApp template: {platform_name}.",
        "defaultLocale": _LOCALE,
        "variables": _variable_defs(variables, sample_values),
        "deployments": [
            {"key": "whatsappTemplateName", "locale": None, "platform": "whatsapp", "channelIds": None, "value": platform_name},
            {"key": "whatsappCategory", "locale": None, "platform": "whatsapp", "channelIds": None, "value": category},
        ],
        "platformContent": [{
            "locale": _LOCALE, "type": "text", "platform": "whatsapp", "channelIds": None,
            "channelGroupIds": [channel_group_id],
            "blocks": [_block("body", body), _block("footer", _FOOTER)],
        }],
        "supportedPlatforms": ["whatsapp"],
        "shortLinks": {"enabled": True, "domain": "brd5.us"},
    }
    status, channel_template = await _request(
        "POST", f"/workspaces/{settings.bird_workspace_id}/projects/{project_id}/channel-templates",
        json_body=payload,
    )
    if status >= 400:
        raise RuntimeError(f"Bird channel-template creation failed HTTP {status}: {channel_template}")
    channel_template_id = channel_template["id"]

    status, activate_result = await _request(
        "PUT",
        f"/workspaces/{settings.bird_workspace_id}/projects/{project_id}/channel-templates/{channel_template_id}/activate",
    )
    if status >= 400:
        raise RuntimeError(f"Bird activation failed HTTP {status}: {activate_result}")

    return project_id, channel_template_id


async def check_status(project_id: str) -> tuple[str, str | None]:
    """Poll one submission's review status. Returns (status, reject_reason)
    where status is one of 'pending_review' | 'approved' | 'rejected'.

    Bird's exact rejection-reason field isn't documented anywhere in this
    codebase (scripts/bird_submit_message_templates.py never needed to read
    one, since it only ever creates/activates, never polls a result) -- this
    defensively checks a few plausible field names and falls back to a
    generic message so the poller doesn't crash if none match. Worth
    revisiting once a real rejection is observed in production."""
    status, project = await _request("GET", f"/workspaces/{settings.bird_workspace_id}/projects/{project_id}")
    if status >= 400:
        raise RuntimeError(f"Bird project lookup failed HTTP {status}: {project}")
    if (project.get("activeCount") or 0) > 0:
        return "approved", None

    status, tmpl_list = await _request(
        "GET", f"/workspaces/{settings.bird_workspace_id}/projects/{project_id}/channel-templates")
    if status >= 400:
        return "pending_review", None
    for tmpl in (tmpl_list.get("results") or []):
        if str(tmpl.get("status", "")).lower() == "rejected":
            reason = (
                tmpl.get("rejectionReason") or tmpl.get("reviewComment")
                or tmpl.get("statusReason") or (tmpl.get("review") or {}).get("reason")
                or "Meta rejected this template. Revise the wording and resubmit."
            )
            return "rejected", str(reason)
    return "pending_review", None
