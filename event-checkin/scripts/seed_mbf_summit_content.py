#!/usr/bin/env python3
"""Rebuild Festio Live for the real MBF Summit event (staging): archive every
existing "MBF Live ·" activity except the just-added feedback survey, then
create a fresh set of activities mapped to the actual program sessions.

Archiving, not deleting — every old activity keeps its history, it just stops
showing as active content. This only touches this one event on staging.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from seed_festio_live_showcase import jwt, Api, read_env  # noqa: E402

EVENT_ID = "1b86f7b8-6ec0-41fe-8cb7-7344993c7330"
ORG_ID = "31c03f5f-1b41-4d75-aff7-4272879b3b0d"
BASE = "http://localhost:4000"
KEEP_TITLE = "MBF Summit Feedback & Planning Survey"

ACTIVITIES = [
    (
        "MBF Live · Opening Reflection", "word_cloud",
        {"live_results_enabled": True, "display_scene": "word_cloud"},
        [
            ("word_cloud", "One word for how you'll turn belief into action this year", [], True, {}),
            ("rating_5", "How did today's khutbah resonate with you?", [], False, {}),
        ],
    ),
    (
        "MBF Live · Icebreaker Map", "poll",
        {"live_results_enabled": True, "display_scene": "results"},
        [
            ("quadrant", "Where do you fall this weekend?", [], True, {
                "x_label_low": "Chill & relax", "x_label_high": "Adventure & activities",
                "y_label_low": "First-timer", "y_label_high": "MBF veteran",
            }),
        ],
    ),
    (
        "MBF Live · Camp Fire Q&A", "q_and_a",
        {"moderation_enabled": True, "display_scene": "q_and_a"},
        [],
    ),
    (
        "MBF Live · 20 Years of Impact Quiz", "quiz",
        {"leaderboard_enabled": True, "live_results_enabled": True, "display_scene": "leaderboard"},
        [
            ("single_choice", "How many years has MBF been serving the community?",
             [("10", False), ("15", False), ("20", True), ("25", False)], True, {"points": 100}),
            ("ranking", "What should MBF prioritize in the next 20 years?",
             ["Youth programs", "Elder care", "Civic engagement", "Global outreach"], True, {}),
        ],
    ),
    (
        "MBF Live · Digital Age Check-in", "poll",
        {"live_results_enabled": True, "display_scene": "results"},
        [
            ("quadrant", "Where are you right now?", [], True, {
                "x_label_low": "Rarely online", "x_label_high": "Always online",
                "y_label_low": "Uneasy talking faith online", "y_label_high": "Comfortable talking faith online",
            }),
        ],
    ),
    (
        "MBF Live · Civic Engagement Q&A", "q_and_a",
        {"moderation_enabled": True, "display_scene": "q_and_a"},
        [],
    ),
    (
        "MBF Live · Camp Challenge Trivia", "quiz",
        {"leaderboard_enabled": True, "live_results_enabled": True, "display_scene": "team_battle"},
        [
            ("single_choice", "Which prayer is observed right after sunset?",
             [("Fajr", False), ("Maghrib", True), ("Isha", False), ("Zuhr", False)], True, {"points": 100}),
            ("true_false", "Qiyaam-ul-Layl is prayed during the night, after Isha.", [("True", True), ("False", False)], True, {"points": 100}),
        ],
    ),
    (
        "MBF Live · Passing the Torch", "poll",
        {"live_results_enabled": True, "display_scene": "results"},
        [
            ("quadrant", "How do you see yourself right now?", [], True, {
                "x_label_low": "Comfort leading: low", "x_label_high": "Comfort leading: high",
                "y_label_low": "Comfort being led: low", "y_label_high": "Comfort being led: high",
            }),
            ("ranking", "Rank these leadership qualities by what matters most to you",
             ["Patience", "Listening", "Courage", "Humility"], True, {}),
        ],
    ),
    (
        "MBF Live · Variety Night Memories", "voting",
        {"live_results_enabled": True, "display_scene": "word_cloud"},
        [
            ("word_cloud", "One MBF memory in a few words", [], True, {}),
            ("ranking", "Rank tonight's moments from most to least memorable",
             ["Reflections", "Performances", "Community stories", "Recognition"], True, {}),
        ],
    ),
    (
        "MBF Live · Wellness & Health Check-in", "rating",
        {"live_results_enabled": True, "display_scene": "rating"},
        [
            ("rating_5", "How would you rate your overall wellness this weekend?", [], True, {}),
            ("nps", "How likely are you to prioritize self-care after camp?", [], True, {}),
        ],
    ),
    (
        "MBF Live · AI & Tech Pulse", "poll",
        {"live_results_enabled": True, "display_scene": "results"},
        [
            ("single_choice", "Where can responsible AI help the community most?",
             ["Education", "Healthcare access", "Small business", "Da'wah & outreach"], True, {}),
            ("word_cloud", "AI makes you feel ___", [], True, {}),
        ],
    ),
    (
        "MBF Live · Closing Reflections", "feedback",
        {"live_results_enabled": True, "display_scene": "ai_insight"},
        [
            ("word_cloud", "One word of gratitude as camp ends", [], True, {}),
            ("nps", "How likely are you to attend the next MBF Summit?", [], True, {}),
        ],
    ),
]


def archive(api: Api, activity: dict) -> str | None:
    status = activity["status"]
    if status == "archived":
        return None
    if status == "live":
        api.staff("POST", f"/activities/{activity['id']}/status", {"status": "closed"})
        status = "closed"
    if status in ("draft", "scheduled", "closed", "completed", "paused"):
        if status == "paused":
            api.staff("POST", f"/activities/{activity['id']}/status", {"status": "closed"})
            status = "closed"
        api.staff("POST", f"/activities/{activity['id']}/status", {"status": "archived"})
        return status
    return None


def main() -> None:
    env = read_env(Path("/home/dev/events/platform-tutor/event-checkin/.env"))
    secret = env.get("ENGAGEMENT_INTERNAL_SERVICE_TOKEN") or env.get("PLANNER_INTERNAL_SERVICE_TOKEN")
    if not secret:
        raise SystemExit("ENGAGEMENT_INTERNAL_SERVICE_TOKEN or PLANNER_INTERNAL_SERVICE_TOKEN is required")
    api = Api(BASE, jwt(secret, EVENT_ID, ORG_ID))

    existing = api.staff("GET", "/activities")
    report = {"archived": [], "created": []}
    for row in existing:
        if row["title"] == KEEP_TITLE:
            continue
        from_status = archive(api, row)
        if from_status:
            report["archived"].append({"title": row["title"], "id": row["id"], "from_status": from_status})

    for title, atype, config, questions in ACTIVITIES:
        activity = api.staff("POST", "/activities", {"type": atype, "title": title, "description": None, "config": config})
        for sequence, (qtype, prompt, options, required, extra_config) in enumerate(questions):
            option_payload = []
            for option in options:
                label, correct = option if isinstance(option, tuple) else (option, False)
                option_payload.append({"label": label, "is_correct": correct})
            api.staff("POST", f"/activities/{activity['id']}/questions", {
                "question_type": qtype, "prompt": prompt, "sequence": sequence, "required": required,
                "config": extra_config, "options": option_payload,
            })
        activity = api.staff("GET", f"/activities/{activity['id']}")
        report["created"].append({"title": title, "id": activity["id"], "questions": len(activity["questions"])})

    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
