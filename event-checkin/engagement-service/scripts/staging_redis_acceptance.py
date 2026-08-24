#!/usr/bin/env python3
"""Exercise durable Festio Live flows while the staging Redis is unavailable.

The generated activity is intentionally retained as QA evidence. Run this only
against staging, from an engagement-service container with its normal secrets.
"""
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

import jwt

BASE = os.getenv("ENGAGEMENT_QA_BASE", "http://localhost:8060/api/engagement/v1").rstrip("/")
EVENT_ID = os.getenv("ENGAGEMENT_QA_EVENT", "f80846d3-8d38-4bc2-a234-d487e7dbcb84")
ORG_ID = os.getenv("ENGAGEMENT_QA_ORG", "4582046e-ca8f-4168-bc01-670ea5a1d764")
SECRET = os.environ["INTERNAL_SERVICE_TOKEN"]


def token(subject, role, capabilities=()):
    now = int(time.time())
    return jwt.encode({
        "sub": subject, "name": subject, "event_id": EVENT_ID, "org_id": ORG_ID,
        "role": role, "capabilities": list(capabilities),
        "identity_kind": "guest" if role == "guest" else "staff",
        "iss": "guesthub", "aud": "engagement", "iat": now, "exp": now + 900,
    }, SECRET, algorithm="HS256")


OWNER = token("qa:redis-owner", "owner")
PRESENTER = token("qa:redis-presenter", "presenter", ("control",))
GUEST = token("qa:redis-guest", "guest")
TITLE_PREFIX = "QA · Redis resilience · 2.3.308 · "


def api(method, path, bearer=None, body=None, expected=(200,)):
    headers = {"Accept": "application/json"}
    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"
    payload = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        payload = json.dumps(body).encode()
    request = urllib.request.Request(BASE + path, method=method, headers=headers, data=payload)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read()
            parsed = json.loads(raw) if raw else None
            status = response.status
    except urllib.error.HTTPError as exc:
        status = exc.code
        raw = exc.read()
        parsed = json.loads(raw) if raw else None
    if status not in expected:
        raise AssertionError(f"{method} {path}: expected {expected}, got {status}: {parsed}")
    return parsed


# A previous interrupted run is retained, but it must not remain misleadingly
# live in the organizer UI.
for prior in api("GET", "/activities", OWNER):
    if not prior["title"].startswith(TITLE_PREFIX):
        continue
    if prior["status"] in ("live", "paused"):
        api("POST", f"/activities/{prior['id']}/status", OWNER, {"status": "closed"})
        prior["status"] = "closed"
    if prior["status"] == "closed":
        api("POST", f"/activities/{prior['id']}/status", OWNER, {"status": "completed"})

stamp = time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime())
activity = api("POST", "/activities", OWNER, {
    "type": "survey",
    "title": f"{TITLE_PREFIX}{stamp}",
    "description": "Retained evidence: durable participation while engagement Redis was stopped.",
    "config": {"live_results_enabled": True},
}, (201,))

questions = [
    api("POST", f"/activities/{activity['id']}/questions", OWNER, {
        "question_type": "single_choice", "prompt": "Redis outage poll",
        "sequence": 0, "options": [{"label": "Still participating"}, {"label": "Waiting"}],
    }, (201,)),
    api("POST", f"/activities/{activity['id']}/questions", OWNER, {
        "question_type": "rating_5", "prompt": "Rate the degraded experience", "sequence": 1,
    }, (201,)),
    api("POST", f"/activities/{activity['id']}/questions", OWNER, {
        "question_type": "short_text", "prompt": "One word for resilience", "sequence": 2,
    }, (201,)),
]

api("POST", f"/activities/{activity['id']}/status", OWNER, {"status": "live"})
answers = [
    {"selected_option_ids": [questions[0]["options"][0]["id"]]},
    {"answer_value": 5},
    {"answer_value": "resilient"},
]
for index, (question, answer) in enumerate(zip(questions, answers)):
    api("POST", f"/questions/{question['id']}/live-state", PRESENTER, {"state": "open"})
    api("POST", f"/activities/{activity['id']}/respond", GUEST, {
        "question_id": question["id"], "idempotency_key": f"redis-308-{index}", **answer,
    })
    api("POST", f"/questions/{question['id']}/live-state", PRESENTER, {"state": "closed"})
    api("POST", f"/questions/{question['id']}/live-state", PRESENTER, {"state": "results_visible"})

results = api("GET", f"/activities/{activity['id']}/results", OWNER)
details = api("GET", f"/activities/{activity['id']}/responses", OWNER)
presenter_activity = api("GET", f"/activities/{activity['id']}", PRESENTER)
displays = api("GET", "/control/displays", PRESENTER)
display_token = urllib.parse.quote(activity["config"]["display_token"], safe="")
public_display = api("GET", f"/activities/{activity['id']}/display?token={display_token}")

if results["response_count"] != 3 or len(details) != 3:
    raise AssertionError(f"durable response mismatch: aggregate={results['response_count']} details={len(details)}")
if presenter_activity["id"] != activity["id"] or public_display.get("activity_id") != activity["id"]:
    raise AssertionError("presenter or public display did not read the persisted activity")

api("POST", f"/activities/{activity['id']}/status", OWNER, {"status": "closed"})
api("POST", f"/activities/{activity['id']}/status", OWNER, {"status": "completed"})

print(json.dumps({
    "status": "pass", "activity_id": activity["id"], "retained": True,
    "participant_count": results["participant_count"], "response_count": results["response_count"],
    "poll": True, "rating": True, "text": True,
    "presenter_read": True, "public_display_read": True, "active_displays": len(displays),
}, sort_keys=True))
