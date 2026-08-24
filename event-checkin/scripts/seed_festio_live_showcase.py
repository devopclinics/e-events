#!/usr/bin/env python3
"""Create and retain a complete Festio Live staging showcase.

The fixture is deliberately idempotent and non-destructive: it reuses every
bank item, activity, question, display, participant, response and Q&A item it
can identify, and never deletes existing event data. It uses the same public
organizer and broadcast-guest APIs as the product UI.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

DEFAULT_EVENT = "f80846d3-8d38-4bc2-a234-d487e7dbcb84"
DEFAULT_ORG = "4582046e-ca8f-4168-bc01-670ea5a1d764"
PREFIX = "E2E · "
GUESTS = [
    "Amina Yusuf", "Daniel Brooks", "Sofia Martinez", "Noah Williams", "Maya Patel",
    "Ethan Johnson", "Zara Okafor", "Leo Chen", "Grace Kim", "Omar Hassan",
]

BANK_ITEMS = [
    ("single_choice", "Which experience should Festio improve next?", ["Networking", "Learning", "Entertainment", "Event logistics"], "Audience research", ["priority", "poll"]),
    ("rating_5", "How would you rate this session?", [], "Speaker evaluation", ["rating", "session"]),
    ("nps", "How likely are you to recommend this event?", [], "Event feedback", ["nps", "loyalty"]),
    ("word_cloud", "Describe the room in one word", [], "Audience pulse", ["word cloud", "live"]),
    ("long_text", "What should we do differently next time?", [], "Event feedback", ["feedback", "improvement"]),
    ("single_choice", "Which city hosted the first modern Olympic Games?", ["Athens", "Paris", "London", "Rome"], "Trivia", ["quiz", "knowledge"]),
    ("single_choice", "E2E · Which format should open the next event?", ["Live demo", "Audience poll", "Story", "Team challenge"], "CSV Imports", ["csv", "showcase"]),
]

ACTIVITIES = [
    {
        "type": "poll", "title": PREFIX + "Opening Pulse", "description": "A vivid opening poll that immediately puts every voice on the main stage.", "leave_live": True,
        "config": {"live_results_enabled": True, "display_scene": "results"},
        "questions": [
            ("single_choice", "What do you want most from today?", ["Fresh ideas", "New connections", "Practical tools", "A memorable experience"], {}),
            ("multiple_choice", "Which moments should we make more interactive?", ["Keynotes", "Breakouts", "Networking", "Closing session"], {}),
        ],
    },
    {
        "type": "quiz", "title": PREFIX + "Future of Events Quiz", "description": "A fast, competitive knowledge challenge with points, timing, and a leaderboard.", "leave_live": False,
        "config": {"leaderboard_enabled": True, "live_results_enabled": True, "display_scene": "leaderboard"},
        "questions": [
            ("single_choice", "Which city hosted the first modern Olympic Games?", [("Athens", True), ("Paris", False), ("London", False), ("Rome", False)], {"points": 100}),
            ("true_false", "Audience participation increases long-term event recall.", [("True", True), ("False", False)], {"points": 150}),
            ("single_choice", "What creates the strongest live engagement?", [("One-way presentations", False), ("Frequent meaningful interaction", True), ("Longer slide decks", False), ("More printed material", False)], {"points": 200}),
        ],
    },
    {
        "type": "rating", "title": PREFIX + "Experience Rating", "description": "Live satisfaction, confidence, and advocacy measurement.", "leave_live": False,
        "config": {"live_results_enabled": True, "display_scene": "rating"},
        "questions": [
            ("rating_5", "How would you rate the experience so far?", [], {}),
            ("rating_10", "How energized do you feel right now?", [], {}),
            ("nps", "How likely are you to recommend Festio Live?", [], {}),
        ],
    },
    {
        "type": "word_cloud", "title": PREFIX + "Living Word Cloud", "description": "Ten voices become one colorful visual story.", "leave_live": True,
        "config": {"live_results_enabled": True, "display_scene": "word_cloud"},
        "questions": [("word_cloud", "Describe this event in one word", [], {})],
    },
    {
        "type": "q_and_a", "title": PREFIX + "Ask the Stage", "description": "Moderated audience questions with featuring and democratic upvotes.", "leave_live": True,
        "config": {"moderation_enabled": True, "display_scene": "q_and_a"}, "questions": [],
    },
    {
        "type": "survey", "title": PREFIX + "Audience Choice Survey", "description": "A compact research survey for programming and personalization.", "leave_live": False,
        "config": {"live_results_enabled": True, "display_scene": "results"},
        "questions": [
            ("single_choice", "Which track would you attend next?", ["Leadership", "Technology", "Community", "Entrepreneurship"], {}),
            ("multiple_choice", "What content formats work best for you?", ["Live demos", "Panels", "Small groups", "Hands-on workshops"], {}),
            ("short_text", "What topic should we add?", [], {}),
        ],
    },
    {
        "type": "feedback", "title": PREFIX + "Closing Feedback", "description": "Qualitative feedback ready for AI themes, sentiment, and executive synthesis.", "leave_live": False,
        "config": {"live_results_enabled": True, "display_scene": "ai_insight"},
        "questions": [
            ("rating_5", "How valuable was today?", [], {}),
            ("long_text", "What was the most valuable moment?", [], {}),
            ("long_text", "What should we improve next time?", [], {}),
        ],
    },
    {
        "type": "voting", "title": PREFIX + "Audience Awards", "description": "A live audience ballot combining ranked choice, yes/no, and numeric input.", "leave_live": False,
        "config": {"live_results_enabled": True, "display_scene": "results"},
        "questions": [
            ("ranking", "Rank the event moments from most to least valuable", ["Keynote", "Breakouts", "Networking", "Live demos"], {}),
            ("yes_no", "Should the audience choose next year's opening topic?", ["Yes", "No"], {}),
            ("number", "How many live interactions should the next event include?", [], {}),
        ],
    },
]

QNA_TEXTS = [
    "How can we keep the audience involved after the event ends?",
    "Can speakers see audience sentiment while they are presenting?",
    "How does Festio protect anonymous participant privacy?",
    "Can multiple breakout rooms run different activities at once?",
    "Will the presentation scenes work on LED walls and projectors?",
    "Can we export responses for a post-event report?",
    "How do team battles and leaderboards calculate points?",
    "Can a moderator feature a question without organizer access?",
    "What happens when venue Wi-Fi briefly disconnects?",
    "Can we reuse these questions at the next event?",
]

TEXT_ANSWERS = [
    "leadership and practical demonstrations", "community building", "interactive workshops", "future technology",
    "speaker storytelling", "career development", "hands-on product demos", "networking with purpose",
    "creative problem solving", "inclusive event design",
]
LONG_POSITIVE = [
    "The live audience pulse made the keynote feel like a conversation rather than a presentation.",
    "Seeing our answers become a beautiful stage visual was the most memorable moment.",
    "The quiz created energy and friendly competition without distracting from the content.",
    "I valued the practical examples and the way the moderator surfaced audience questions.",
    "The word cloud captured the mood of the room in a simple and powerful way.",
    "Realtime results helped the speaker adapt and focus on what mattered to us.",
    "The transitions between question, voting, reveal, and leaderboard felt polished.",
    "I liked participating from my phone without installing another application.",
    "The event felt inclusive because quieter guests could contribute equally.",
    "The combination of analytics and human stories will help us plan the next event.",
]
LONG_IMPROVE = [
    "Add a little more time for discussion after each result reveal.", "Include more team challenges during the afternoon.",
    "Show the join QR code again after breaks.", "Offer a dark high-contrast guest theme.",
    "Add session reminders before each activity opens.", "Let guests bookmark questions they want to revisit.",
    "Include a short explanation after every quiz answer.", "Use more word clouds between longer presentations.",
    "Add a final personalized recap for each participant.", "Keep the same smooth pacing and add one more breakout poll.",
]
WORDS = ["inspiring", "connected", "bold", "energizing", "inclusive", "creative", "connected", "inspiring", "useful", "memorable"]


def b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def jwt(secret: str, event_id: str, org_id: str) -> str:
    now = int(time.time())
    header = b64(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = b64(json.dumps({
        "sub": "festio-live-showcase-seeder", "name": "Festio Live Showcase", "event_id": event_id,
        "org_id": org_id, "role": "admin", "capabilities": [], "identity_kind": "staff",
        "iss": "guesthub", "aud": "engagement", "iat": now, "exp": now + 3600,
    }, separators=(",", ":")).encode())
    signature = b64(hmac.new(secret.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest())
    return f"{header}.{payload}.{signature}"


def read_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists(): return values
    for raw in path.read_text().splitlines():
        if "=" in raw and not raw.lstrip().startswith("#"):
            key, value = raw.split("=", 1); values[key.strip()] = value.strip().strip("\"").strip("'")
    return values


class Api:
    def __init__(self, base: str, staff_token: str): self.base, self.staff_token = base.rstrip("/"), staff_token

    def call(self, method: str, path: str, body: Any = None, token: str | None = None, ok: tuple[int, ...] = (200, 201, 204)) -> Any:
        headers = {"Accept": "application/json", "User-Agent": "Festio-Live-Showcase/1.0"}
        active = self.staff_token if token is None else token
        if active: headers["Authorization"] = f"Bearer {active}"
        data = None
        if body is not None: headers["Content-Type"] = "application/json"; data = json.dumps(body).encode()
        request = urllib.request.Request(self.base + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=40) as response:
                raw = response.read(); payload = json.loads(raw) if raw else None
                if response.status not in ok: raise RuntimeError(f"{method} {path}: {response.status} {payload}")
                return payload
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")
            raise RuntimeError(f"{method} {path}: {error.code} {detail[:700]}") from error

    def staff(self, method: str, path: str, body: Any = None) -> Any: return self.call(method, "/api/engagement/v1" + path, body)
    def guest(self, token: str, method: str, path: str, body: Any = None) -> Any: return self.call(method, "/api/engagement/v1" + path, body, token=token)


def ensure_bank(api: Api) -> list[dict]:
    rows = api.staff("GET", "/question-bank")
    for qtype, prompt, options, category, tags in BANK_ITEMS:
        if not any(row["prompt"] == prompt for row in rows):
            rows.append(api.staff("POST", "/question-bank", {"question_type": qtype, "prompt": prompt, "category": category, "tags": tags, "options": [{"label": item, "is_correct": index == 0} for index, item in enumerate(options)]}))
    return [row for row in rows if any(row["prompt"] == item[1] for item in BANK_ITEMS)]


def ensure_activities(api: Api) -> list[dict]:
    summaries = api.staff("GET", "/activities")
    result = []
    for definition in ACTIVITIES:
        summary = next((row for row in summaries if row["title"] == definition["title"]), None)
        if summary is None:
            activity = api.staff("POST", "/activities", {key: definition[key] for key in ("type", "title", "description", "config")})
            summaries.append(activity)
        else:
            activity = api.staff("GET", f"/activities/{summary['id']}")
        existing = {question["prompt"] for question in activity["questions"]}
        if activity["status"] in ("draft", "scheduled"):
            for sequence, (qtype, prompt, options, config) in enumerate(definition["questions"]):
                if prompt in existing: continue
                option_payload = []
                for index, option in enumerate(options):
                    label, correct = option if isinstance(option, tuple) else (option, False)
                    option_payload.append({"label": label, "is_correct": correct})
                api.staff("POST", f"/activities/{activity['id']}/questions", {"question_type": qtype, "prompt": prompt, "sequence": sequence, "time_limit_seconds": 30 if definition["type"] == "quiz" else None, "config": config, "options": option_payload})
            activity = api.staff("GET", f"/activities/{activity['id']}")
        result.append(activity)
    return result


def guest_tokens(api: Api, event_id: str) -> list[str]:
    tokens = []
    for index, name in enumerate(GUESTS, 1):
        payload = api.call("POST", f"/api/events/{event_id}/live/anon-token", {"display_name": name, "anon_id": f"festio-showcase-guest-{index:02d}"}, token="")
        tokens.append(payload["token"])
    return tokens


def answer_for(question: dict, guest_index: int) -> tuple[list[str], Any]:
    options = question.get("options") or []
    qtype = question["question_type"]
    if qtype in ("single_choice", "true_false", "yes_no"):
        correct = next((option for option in options if option.get("is_correct")), None)
        chosen = correct if correct and guest_index < 8 else options[guest_index % len(options)]
        return [chosen["id"]], None
    if qtype == "multiple_choice":
        return [options[guest_index % len(options)]["id"], options[(guest_index + 1) % len(options)]["id"]], None
    if qtype == "ranking":
        ordered = options[guest_index % len(options):] + options[:guest_index % len(options)]
        return [option["id"] for option in ordered], None
    if qtype == "rating_5": return [], 5 if guest_index < 7 else 4
    if qtype == "rating_10": return [], 8 + (guest_index % 3)
    if qtype == "nps": return [], 8 + (guest_index % 3)
    if qtype == "word_cloud": return [], WORDS[guest_index]
    if qtype == "long_text":
        return [], LONG_IMPROVE[guest_index] if "improve" in question["prompt"].lower() else LONG_POSITIVE[guest_index]
    if qtype == "short_text": return [], TEXT_ANSWERS[guest_index]
    if qtype == "number": return [], guest_index + 1
    return [], TEXT_ANSWERS[guest_index]


def run_response_activity(api: Api, activity: dict, tokens: list[str], leave_live: bool) -> dict:
    if activity["status"] in ("completed", "archived"):
        return api.staff("GET", f"/activities/{activity['id']}/results")
    if activity["status"] in ("draft", "scheduled", "closed"):
        activity = api.staff("POST", f"/activities/{activity['id']}/status", {"status": "live"})
    for question in activity["questions"]:
        states = api.staff("GET", f"/activities/{activity['id']}")
        current = next(row for row in states["questions"] if row["id"] == question["id"])
        if current["live_state"] in ("pending", "closed", "results_visible", "answer_revealed"):
            if current["live_state"] == "pending": api.staff("POST", f"/activities/{activity['id']}/advance", {"question_id": question["id"]})
            elif current["live_state"] != "open": api.staff("POST", f"/questions/{question['id']}/live-state", {"state": "open"})
        for guest_index, token in enumerate(tokens):
            state = api.guest(token, "GET", f"/activities/{activity['id']}/participate")
            if question["id"] in state["already_responded_question_ids"]: continue
            selected, answer = answer_for(question, guest_index)
            api.guest(token, "POST", f"/activities/{activity['id']}/respond", {"question_id": question["id"], "idempotency_key": f"showcase-{question['id']}-{guest_index}", "selected_option_ids": selected, "answer_value": answer, "response_time_ms": 3800 + guest_index * 640})
        current = next(row for row in api.staff("GET", f"/activities/{activity['id']}")["questions"] if row["id"] == question["id"])
        if current["live_state"] == "open": api.staff("POST", f"/questions/{question['id']}/live-state", {"state": "closed"})
        current = next(row for row in api.staff("GET", f"/activities/{activity['id']}")["questions"] if row["id"] == question["id"])
        if current["live_state"] == "closed": api.staff("POST", f"/questions/{question['id']}/live-state", {"state": "results_visible"})
        current = next(row for row in api.staff("GET", f"/activities/{activity['id']}")["questions"] if row["id"] == question["id"])
        if any(option.get("is_correct") for option in question.get("options", [])) and current["live_state"] == "results_visible":
            api.staff("POST", f"/questions/{question['id']}/live-state", {"state": "answer_revealed"})
    activity = api.staff("GET", f"/activities/{activity['id']}")
    if not leave_live and activity["status"] == "live":
        api.staff("POST", f"/activities/{activity['id']}/status", {"status": "closed"})
        api.staff("POST", f"/activities/{activity['id']}/status", {"status": "completed"})
    return api.staff("GET", f"/activities/{activity['id']}/results")


def run_qna(api: Api, activity: dict, tokens: list[str]) -> list[dict]:
    if activity["status"] in ("draft", "scheduled", "closed"):
        activity = api.staff("POST", f"/activities/{activity['id']}/status", {"status": "live"})
    existing = api.staff("GET", f"/activities/{activity['id']}/qna")
    by_text = {item["text"]: item for item in existing}
    for index, token in enumerate(tokens):
        if QNA_TEXTS[index] not in by_text:
            by_text[QNA_TEXTS[index]] = api.guest(token, "POST", f"/activities/{activity['id']}/qna", {"text": QNA_TEXTS[index]})
    ordered = [by_text[text] for text in QNA_TEXTS]
    for index, item in enumerate(ordered):
        target = "featured" if index < 3 else "answered" if index < 6 else "pending"
        if item["status"] != target: item = api.staff("PATCH", f"/qna/{item['id']}", {"status": target}); ordered[index] = item
    for item in ordered[:6]:
        for token in tokens:
            api.guest(token, "POST", f"/qna/{item['id']}/upvote")
    return api.staff("GET", f"/activities/{activity['id']}/qna")


def ensure_displays(api: Api, activities: list[dict]) -> list[dict]:
    existing = api.staff("GET", "/displays")
    activity = {row["title"]: row for row in activities}
    definitions = [
        (PREFIX + "Main Stage", "results", "aurora", PREFIX + "Opening Pulse", "The room has spoken", "Every voice changes the stage."),
        (PREFIX + "Lobby Welcome", "join", "citrus", None, "Join the live experience", "Scan once. Take part all day."),
        (PREFIX + "Q&A Spotlight", "q_and_a", "ocean", PREFIX + "Ask the Stage", "Your questions, center stage", "Upvote what the room needs answered."),
        (PREFIX + "Insight Wall", "ai_insight", "festio", PREFIX + "Closing Feedback", "What the audience taught us", "Themes, sentiment, and next actions."),
        (PREFIX + "Word Cloud Wall", "word_cloud", "aurora", PREFIX + "Living Word Cloud", "One room. Ten voices.", "Watch the shared story take shape."),
    ]
    for name, scene, theme, activity_title, title, subtitle in definitions:
        if any(row["name"] == name for row in existing): continue
        assigned = activity.get(activity_title) if activity_title else None
        existing.append(api.staff("POST", "/displays", {"name": name, "assigned_activity_id": assigned["id"] if assigned else None, "scene": scene, "settings": {"theme": theme, "motion": True, "safe_area": True, "show_reactions": True, "title": title, "subtitle": subtitle, "event_name": "Festio Live Showcase", "venue": "Main stage · Chicago", "date_label": "Live on staging", "join_code": "FESTIO10", "sponsors": ["Festio", "Audience powered"]}}))
    return [row for row in existing if row["name"].startswith(PREFIX)]


def approve_showcase_text(api: Api, activities: list[dict]) -> int:
    approved = 0
    for activity in activities:
        if activity["type"] == "q_and_a":
            continue
        for item in api.staff("GET", f"/activities/{activity['id']}/moderation"):
            if item["status"] == "pending" and not item["flagged"]:
                api.staff("PATCH", f"/moderation/{item['id']}", {"status": "approved"})
                approved += 1
    return approved


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="https://staging.festio.events")
    parser.add_argument("--event-id", default=DEFAULT_EVENT)
    parser.add_argument("--org-id", default=DEFAULT_ORG)
    parser.add_argument("--env-file", default=".env")
    parser.add_argument("--report", default="support-service/docs/qa/festio-live-showcase.json")
    args = parser.parse_args()
    env = {**read_env(Path(args.env_file)), **os.environ}
    secret = env.get("ENGAGEMENT_INTERNAL_SERVICE_TOKEN") or env.get("PLANNER_INTERNAL_SERVICE_TOKEN")
    if not secret: raise SystemExit("ENGAGEMENT_INTERNAL_SERVICE_TOKEN or PLANNER_INTERNAL_SERVICE_TOKEN is required")
    api = Api(args.base, jwt(secret, args.event_id, args.org_id))
    settings = api.staff("PUT", "/settings", {"guest_hub_participation": True, "broadcast_join_enabled": True, "allow_answer_changes": False, "moderation_enabled": True, "profanity_filtering": True, "leaderboard_name_style": "first_last_initial", "response_retention_months": 12})
    bank = ensure_bank(api)
    activities = ensure_activities(api)
    tokens = guest_tokens(api, args.event_id)
    result_rows = []
    qna_rows = []
    for definition, activity in zip(ACTIVITIES, activities):
        if activity["type"] == "q_and_a": qna_rows = run_qna(api, activity, tokens)
        else: result_rows.append(run_response_activity(api, activity, tokens, definition["leave_live"]))
    approved_text = approve_showcase_text(api, activities)
    displays = ensure_displays(api, activities)
    summaries = api.staff("GET", "/activities")
    showcase = [row for row in summaries if row["title"].startswith(PREFIX)]
    report = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "base_url": args.base,
        "event_id": args.event_id, "persistent": True, "settings": settings,
        "guests": [{"name": name, "anon_id": f"festio-showcase-guest-{index:02d}"} for index, name in enumerate(GUESTS, 1)],
        "question_bank_items": len(bank), "activities": showcase, "displays": [{"id": row["id"], "name": row["name"], "scene": row["scene"]} for row in displays],
        "qna": [{"text": row["text"], "status": row["status"], "upvotes": row["upvote_count"]} for row in qna_rows],
        "moderation": {"approved_in_this_run": approved_text, "public_text_policy": "approved_only"},
        "totals": {"activities": len(showcase), "participants": sum(row["participant_count"] for row in showcase), "responses": sum(row["response_count"] for row in showcase), "displays": len(displays)},
    }
    path = Path(args.report); path.parent.mkdir(parents=True, exist_ok=True); path.write_text(json.dumps(report, indent=2))
    print(json.dumps(report["totals"]))


if __name__ == "__main__": main()
