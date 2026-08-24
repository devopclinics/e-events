#!/usr/bin/env python3
"""Direct-API role and tenant-isolation acceptance for the retained staging event.

Run inside engagement-service so INTERNAL_SERVICE_TOKEN is inherited. Tokens
are generated in memory and never logged.
"""
import json
import os
import time
import urllib.error
import urllib.request

import jwt

BASE = os.getenv("ENGAGEMENT_QA_BASE", "http://localhost:8060/api/engagement/v1").rstrip("/")
EVENT_ID = os.getenv("ENGAGEMENT_QA_EVENT", "f80846d3-8d38-4bc2-a234-d487e7dbcb84")
ORG_ID = os.getenv("ENGAGEMENT_QA_ORG", "4582046e-ca8f-4168-bc01-670ea5a1d764")
OTHER_ORG_ID = os.getenv("ENGAGEMENT_QA_OTHER_ORG", "qa-org")
SECRET = os.environ["INTERNAL_SERVICE_TOKEN"]


def token(role, capabilities=(), org_id=ORG_ID):
    now = int(time.time())
    return jwt.encode({
        "sub": f"qa:{role}", "event_id": EVENT_ID, "org_id": org_id,
        "role": role, "capabilities": list(capabilities), "identity_kind": "staff",
        "iss": "guesthub", "aud": "engagement", "iat": now, "exp": now + 600,
    }, SECRET, algorithm="HS256")


def request(method, path, bearer=None, body=None):
    headers = {"Accept": "application/json"}
    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"
    payload = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        payload = json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, method=method, headers=headers, data=payload)
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            raw = response.read()
            is_json = "application/json" in (response.headers.get("Content-Type") or "")
            return response.status, (json.loads(raw) if raw and is_json else raw.decode(errors="replace") if raw else None)
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        try:
            parsed = json.loads(raw) if raw else None
        except json.JSONDecodeError:
            parsed = raw.decode(errors="replace")[:120]
        return exc.code, parsed


def expect(label, actual, allowed):
    if actual not in allowed:
        raise AssertionError(f"{label}: expected {sorted(allowed)}, got {actual}")
    evidence[label] = actual


evidence = {}
owner = token("owner")
admin = token("admin")
manager = token("admin")  # core maps an event manager to event-scoped admin
presenter = token("presenter", ("control",))
moderator = token("moderator", ("moderate",))
analyst = token("analyst")
viewer = token("viewer")
other_org = token("owner", org_id=OTHER_ORG_ID)

status, activities = request("GET", "/activities", owner)
expect("owner_list", status, {200})
canonical = [item for item in activities if item["title"].startswith("E2E ·")]
if len(canonical) != 8 or any(item["title"].startswith("<script") for item in activities):
    raise AssertionError("owner activity list leaked another organization")
target = next(item for item in activities if item["title"] == "E2E · Closing Feedback")
status, activity = request("GET", f"/activities/{target['id']}", owner)
expect("owner_open", status, {200})
question_id = activity["questions"][0]["id"]

for label, bearer in (("owner", owner), ("admin", admin), ("event_manager", manager)):
    expect(f"{label}_settings", request("GET", "/settings", bearer)[0], {200})

expect("presenter_control", request("GET", "/control/displays", presenter)[0], {200})
expect("presenter_delete_denied", request("DELETE", f"/questions/{question_id}", presenter)[0], {403})
expect("presenter_create_denied", request("POST", "/activities", presenter, {"type": "poll", "title": "denied"})[0], {403})

expect("moderator_queue", request("GET", f"/activities/{target['id']}/moderation", moderator)[0], {200})
expect("moderator_control_denied", request("GET", "/control/displays", moderator)[0], {403})
expect("moderator_create_denied", request("POST", "/activities", moderator, {"type": "poll", "title": "denied"})[0], {403})

expect("analyst_export", request("GET", "/analytics/export.csv", analyst)[0], {200})
expect("analyst_control_denied", request("GET", "/control/displays", analyst)[0], {403})
expect("analyst_question_mutation_denied", request("PATCH", f"/questions/{question_id}", analyst, {"prompt": "denied"})[0], {403})

expect("viewer_read", request("GET", "/activities", viewer)[0], {200})
expect("viewer_control_denied", request("GET", "/control/displays", viewer)[0], {403})
expect("viewer_moderation_denied", request("GET", f"/activities/{target['id']}/moderation", viewer)[0], {403})

status, deletion = request("DELETE", f"/questions/{question_id}", owner)
expect("answered_delete_conflict", status, {409})
if deletion.get("code") != "QUESTION_HAS_RESPONSES":
    raise AssertionError("answered delete did not return the stable error code")

status, other_activities = request("GET", "/activities", other_org)
expect("other_org_list", status, {200})
if not other_activities:
    raise AssertionError("retained cross-org canary data is missing")
expect("owner_cannot_open_other_org", request("GET", f"/activities/{other_activities[0]['id']}", owner)[0], {404})
expect("other_org_cannot_open_owner", request("GET", f"/activities/{target['id']}", other_org)[0], {404})

status, displays = request("GET", "/displays", owner)
expect("owner_displays", status, {200})
if displays:
    display = displays[0]
    expect("display_token_cannot_mutate_admin", request("PATCH", f"/displays/{display['id']}", display["access_token"], {"scene": "welcome"})[0], {401})

print(json.dumps({"status": "pass", "evidence": evidence}, sort_keys=True))
