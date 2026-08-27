#!/usr/bin/env python3
"""Seed "Help Shape the Next MBF Summit" onto the REAL prod MBF Summit event.

Unlike seed_mbf_2026_feedback_survey.py (staging, goes live immediately), this
creates the activity in draft status with auto_start_enabled=true, linked to
the real "Breakfast and Networking" session on Sept 6 (the second/closing-day
one) -- it will go live automatically the moment that session's real start
time arrives, and stays open indefinitely afterward (auto_close_enabled is
left off) until an organizer manually closes it.

Does NOT touch any other prod activity -- there is no old MBF survey on prod
to archive (that only ever existed on the staging copy of this event).
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from seed_festio_live_showcase import Api, jwt  # noqa: E402
from seed_mbf_2026_feedback_survey import ATTENDEE_ONLY_INDICES, NEW_TITLE, QUESTIONS  # noqa: E402

EVENT_ID = "c56049e5-8451-4f8c-92ba-91f3cb306e72"
ORG_ID = "6efe748d-02a0-4bf4-a804-c56790634ce4"
# The real "Breakfast and Networking" ProgramSession on Sept 6 (the
# closing-day one, per explicit confirmation) -- auto-start joins on
# ProgramSession.source_step_id == EngagementActivity.session_id, not the
# session's own id.
BREAKFAST_SESSION_SOURCE_STEP_ID = "5beaaa0b-b5f8-4ffc-b725-71075a69473b"

# Must match the internal token engagement-service actually runs with in prod
# (kubectl -n festio exec deploy/engagement-service -- env | grep INTERNAL).
PROD_INTERNAL_TOKEN = "10e3aa9a2f1f59c49114b255228175fec53e020793cc60fa612f75da4c9f1927"


def main() -> None:
    api = Api("https://festio.events", jwt(PROD_INTERNAL_TOKEN, EVENT_ID, ORG_ID))

    existing = next((row for row in api.staff("GET", "/activities") if row["title"] == NEW_TITLE), None)
    if existing:
        print(f"'{NEW_TITLE}' already exists on prod (id={existing['id']}, status={existing['status']}) -- not recreating.")
        return

    activity = api.staff("POST", "/activities", {
        "type": "survey", "title": NEW_TITLE,
        "description": "Share your 2026 MBF Summit experience and help us plan what's next. This survey is anonymous and takes about 3-5 minutes.",
        "session_id": BREAKFAST_SESSION_SOURCE_STEP_ID,
        "config": {
            "anonymous": True, "leaderboard_enabled": False, "moderation_enabled": True,
            "allow_guest_participation": True,
            "auto_start_enabled": True,   # goes live automatically at Breakfast and Networking's start
            "auto_close_enabled": False,  # stays open until an organizer manually closes it
            "display_scene": "results",
        },
    })
    print(f"Created activity {activity['id']} on PROD (draft, linked to session {BREAKFAST_SESSION_SOURCE_STEP_ID}, auto-start enabled)")

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
    print(f"Created {len(created_questions)} questions")

    q1 = created_questions[0]
    yes_option_id = q1["options"][0]["id"]
    for index in ATTENDEE_ONLY_INDICES:
        target = created_questions[index]
        api.staff("POST", f"/activities/{activity['id']}/rules", {
            "source_question_id": q1["id"], "operator": "contains", "comparison_value": yes_option_id,
            "target_question_id": target["id"], "action": "show",
        })
    print(f"Created {len(ATTENDEE_ONLY_INDICES)} branching rules")

    # Deliberately left in "draft" status -- the worker's auto-start tick
    # (engagement-service/app/worker.py::_auto_start_tick) will flip it to
    # "live" itself once the linked session's real start time (2026-09-06
    # 14:00 UTC / 9:00 AM Central) arrives. Nothing further to do here.
    final = api.staff("GET", f"/activities/{activity['id']}")
    print(f"\n'{NEW_TITLE}' created on prod: {activity['id']}")
    print(f"Status: {final['status']} (will auto-start at the linked session's real start time)")
    print("auto_close_enabled: False -- stays open until an organizer manually closes it")


if __name__ == "__main__":
    main()
