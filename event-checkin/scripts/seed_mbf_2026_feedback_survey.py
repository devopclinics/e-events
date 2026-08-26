#!/usr/bin/env python3
"""Build the real "Help Shape the Next MBF Summit" Event Feedback survey.

Replaces the old "MBF Summit Feedback & Planning Survey" activity (id
8954d432-65a0-4892-943e-db0cd2f9843e on the MBF Summit staging event) — that
activity is archived rather than edited in place, since a wholesale
question-set redesign (15 new questions, new types, new branching) is a
version change, not an edit, and its one existing response was a real
gibberish/test submission ("eeee", "eee") that never should be edited over.

Idempotent: safe to re-run — skips creating the new activity if one with the
same title already exists and just reports it.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from seed_festio_live_showcase import Api, jwt, read_env  # noqa: E402

EVENT_ID = "1b86f7b8-6ec0-41fe-8cb7-7344993c7330"
ORG_ID = "31c03f5f-1b41-4d75-aff7-4272879b3b0d"
OLD_ACTIVITY_ID = "8954d432-65a0-4892-943e-db0cd2f9843e"
NEW_TITLE = "Help Shape the Next MBF Summit"

EXPERIENCE_AREAS = [
    "Islamic/spiritual programming", "Speakers and workshops", "Youth programming",
    "Camp activities and sports", "Networking and brotherhood", "Food",
    "Accommodation/cabins", "Organization and logistics",
]

# (question_type, prompt, required, options|None, config)
# `config.section` groups the cohesive form into visual sections (see
# LiveGuestPage.jsx's SurveyForm). `config.branch_group` is documentation only
# -- the real gating is the ActivityRule rows created below.
QUESTIONS: list[dict[str, Any]] = [
    {"question_type": "single_choice", "prompt": "Did you attend the 2026 MBF Summit at Carolina Creek?",
     "required": True, "options": ["Yes, I attended", "No, I couldn't attend", "No, I'm new to MBF"],
     "config": {}},

    {"question_type": "rating_5", "prompt": "Overall, how would you rate the 2026 MBF Summit?",
     "required": True, "options": None, "config": {"section": "2026 Summit Experience", "scale_low": "Poor", "scale_high": "Excellent"}},
] + [
    {"question_type": "rating_5", "prompt": f"How would you rate: {area}?",
     "required": True, "options": None, "config": {"section": "2026 Summit Experience", "scale_low": "Poor", "scale_high": "Excellent"}}
    for area in EXPERIENCE_AREAS
] + [
    {"question_type": "multiple_choice", "prompt": "Which parts of the 2026 Summit did you find most valuable?",
     "required": False, "config": {"section": "2026 Summit Experience"},
     "options": [
         "Islamic/spiritual sessions and reminders", "Formal opening and community reflection",
         "Community & Civic Engagement workshop", "Elders session", "Fathers / Emotional Intelligence session",
         "Youth sessions", "Health & Wellness workshop", "AI & Tech Show", "Campfire discussions",
         "Variety Night / Community Reflection", "Sports, kayaking, canoeing & group activities",
         "Networking and brotherhood", "Other",
     ]},
    {"question_type": "long_text", "prompt": "What is the ONE thing we should improve for the next MBF Summit?",
     "required": False, "options": None, "config": {"section": "2026 Summit Experience"}},

    {"question_type": "single_choice", "prompt": "When would you most prefer the next MBF Summit?",
     "required": True, "config": {"section": "Planning the Next Summit"},
     "options": ["June", "July", "Early August", "Labor Day weekend / early September", "No preference", "Other"]},
    {"question_type": "single_choice", "prompt": "What type of experience would you prefer for the next MBF Summit?",
     "required": True, "config": {"section": "Planning the Next Summit"},
     "options": ["Retreat/camp experience like this year", "Resort/retreat center with more comfortable lodging",
                 "Hotel/conference venue", "Masjid-based Summit", "No preference", "Other"]},
    {"question_type": "single_choice", "prompt": "How far would you be willing to travel from Houston for the Summit?",
     "required": True, "config": {"section": "Planning the Next Summit"},
     "options": ["Houston area only", "Up to 1 hour", "Up to 2 hours", "Up to 3 hours", "Distance is not important if the venue is good"]},
    {"question_type": "single_choice",
     "prompt": "For a full weekend Summit including accommodation, meals, and activities, what price per person would feel reasonable?",
     "required": True, "config": {"section": "Planning the Next Summit"},
     "options": ["Under $100", "$100–$149", "$150–$199", "$200–$249", "$250+", "Cost would depend on what is included"]},
    {"question_type": "number", "prompt": "How many people from your household would likely attend the next MBF Summit, including yourself?",
     "required": True, "options": None, "config": {"section": "Planning the Next Summit", "min": 1, "max": 20}},
    {"question_type": "number", "prompt": "How many of those attendees would likely be youth ages 13–18?",
     "required": False, "options": None, "config": {"section": "Planning the Next Summit", "min": 0, "max": 20}},
    {"question_type": "multiple_choice", "prompt": "What would you like MORE of at the next MBF Summit?",
     "required": True, "config": {"section": "Planning the Next Summit"},
     "options": ["Islamic knowledge / spiritual growth", "Fatherhood and family", "Marriage / relationships",
                 "Youth development", "Career and professional development", "Financial literacy / wealth building",
                 "Health and wellness", "Technology / AI", "Civic/community engagement", "Leadership",
                 "Men's mental/emotional wellness", "Entrepreneurship", "Sports / outdoor activities",
                 "Brotherhood / networking", "Other"]},

    {"question_type": "long_text", "prompt": "Is there a speaker or specific topic you would recommend for the next Summit?",
     "required": False, "options": None, "config": {"section": "Anything Else?"}},
    {"question_type": "long_text", "prompt": "Are there any months, weekends, school periods, or holidays that would make it difficult for you to attend?",
     "required": False, "options": None, "config": {"section": "Anything Else?"}},
    {"question_type": "long_text", "prompt": "Anything else you would like the MBF Summit planning committee to know?",
     "required": False, "options": None, "config": {"section": "Anything Else?"}},
]

# Indices (into QUESTIONS) of the attendee-only block: Q2 (overall rating),
# the 8 experience-area ratings, Q4 (most valuable), Q5 (improvement).
ATTENDEE_ONLY_INDICES = list(range(1, 1 + 1 + len(EXPERIENCE_AREAS) + 2))


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    env = read_env(root / ".env")
    secret = env.get("ENGAGEMENT_INTERNAL_SERVICE_TOKEN") or env.get("PLANNER_INTERNAL_SERVICE_TOKEN")
    if not secret:
        raise SystemExit("Missing ENGAGEMENT_INTERNAL_SERVICE_TOKEN/PLANNER_INTERNAL_SERVICE_TOKEN in .env")
    api = Api("http://localhost:4000", jwt(secret, EVENT_ID, ORG_ID))

    # 1. Archive the old test-data survey rather than editing it in place.
    old = api.staff("GET", f"/activities/{OLD_ACTIVITY_ID}")
    if old["status"] not in ("archived",):
        print(f"Archiving old activity {OLD_ACTIVITY_ID} ({old['status']}) -- preserves its one existing (test) response.")
        if old["status"] == "live":
            api.staff("POST", f"/activities/{OLD_ACTIVITY_ID}/status", {"status": "closed"})
        api.staff("POST", f"/activities/{OLD_ACTIVITY_ID}/status", {"status": "archived"})
    else:
        print(f"Old activity {OLD_ACTIVITY_ID} already archived.")

    # 2. Idempotency: skip creating a duplicate if this exact title exists already.
    existing = next((row for row in api.staff("GET", "/activities") if row["title"] == NEW_TITLE), None)
    if existing:
        print(f"'{NEW_TITLE}' already exists (id={existing['id']}, status={existing['status']}) -- not recreating.")
        return

    activity = api.staff("POST", "/activities", {
        "type": "survey", "title": NEW_TITLE,
        "description": "Share your 2026 MBF Summit experience and help us plan what's next. This survey is anonymous and takes about 3-5 minutes.",
        "config": {
            "anonymous": True, "leaderboard_enabled": False, "moderation_enabled": True,
            "allow_guest_participation": True, "auto_start_enabled": False, "auto_close_enabled": False,
            "display_scene": "results",
        },
    })
    print(f"Created activity {activity['id']}")

    created_questions = []
    for sequence, definition in enumerate(QUESTIONS):
        options = definition.get("options")
        option_payload = [{"label": label} for label in options] if options else []
        question = api.staff("POST", f"/activities/{activity['id']}/questions", {
            "question_type": definition["question_type"], "prompt": definition["prompt"],
            "sequence": sequence, "required": definition["required"],
            "config": definition["config"], "options": option_payload,
        })
        created_questions.append(question)
        print(f"  Q{sequence + 1:02d} [{definition['question_type']:>10}] {definition['prompt'][:60]}")

    # 3. Branching: Q1's "Yes, I attended" gates every attendee-only question.
    q1 = created_questions[0]
    yes_option_id = q1["options"][0]["id"]
    for index in ATTENDEE_ONLY_INDICES:
        target = created_questions[index]
        api.staff("POST", f"/activities/{activity['id']}/rules", {
            "source_question_id": q1["id"], "operator": "contains", "comparison_value": yes_option_id,
            "target_question_id": target["id"], "action": "show",
        })
    print(f"Created {len(ATTENDEE_ONLY_INDICES)} branching rules (Q1='Yes, I attended' -> show attendee-only questions)")

    # 4. Go live.
    api.staff("POST", f"/activities/{activity['id']}/status", {"status": "live"})
    print(f"\n'{NEW_TITLE}' is live: {activity['id']}")
    print(f"Total questions: {len(created_questions)} ({len(ATTENDEE_ONLY_INDICES)} attendee-only, {len(created_questions) - 1 - len(ATTENDEE_ONLY_INDICES)} for everyone, plus the attendance gate)")


if __name__ == "__main__":
    main()
