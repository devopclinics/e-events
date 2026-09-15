#!/usr/bin/env python3
"""Idempotently complete the existing NCNMO staging event for a client demo.

The script refuses non-staging events, preserves existing records, disables
outbound messaging, and identifies every fixture with NCNMO-DEMO-2026.
"""
from __future__ import annotations

import argparse
import asyncio
import json
from datetime import datetime
from pathlib import Path

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import (
    Event, ExperienceStep, ExperienceWorkflow, Guest, GuestMenuChoice,
    GuestTag, GuestTagLink, Household, MenuCategory, MenuItem, TicketType, Zone,
)

MARKER = "NCNMO-DEMO-2026"
EXPECTED_EVENT_ID = "cefc5699-da7e-4610-9598-74a9423f0ea0"

PEOPLE = [
    ("01", "Zainab", "Yusuf", 2, "A", "Yusuf Family"),
    ("02", "Maryam", "Bello", 4, "B", "Bello Family"),
    ("03", "Musa", "Yusuf", 6, "C", "Yusuf Family"),
    ("04", "Khadijah", "Bello", 8, "D", "Bello Family"),
    ("05", "Abdullah", "Yusuf", 9, "E", "Yusuf Family"),
    ("06", "Hafsa", "Bello", 12, "1", "Bello Family"),
    ("07", "Umar", "Yusuf", 16, "2", "Yusuf Family"),
    ("08", "Yusuf", "Bello", 22, "3", "Bello Family"),
    ("09", "Amina", "Yusuf", 36, "4", "Yusuf Family"),
    ("10", "Ibrahim", "Bello", 48, "5", "Bello Family"),
]

GROUPS = {
    "A": ("Group A · Age 2", "Junior A", "#8b5cf6"),
    "B": ("Group B · Ages 3–4", "Junior B", "#ec4899"),
    "C": ("Group C · Ages 5–6", "Junior C", "#f97316"),
    "D": ("Group D · Ages 7–8", "Junior D", "#eab308"),
    "E": ("Group E · Age 9", "Junior E", "#22c55e"),
    "1": ("Group 1 · Ages 10–13", "Youth 1", "#14b8a6"),
    "2": ("Group 2 · Ages 14–17", "Youth 2", "#06b6d4"),
    "3": ("Group 3 · Ages 18–24", "Young Adults", "#3b82f6"),
    "4": ("Group 4 · Ages 25–39", "Adults", "#6366f1"),
    "5": ("Group 5 · Ages 40+", "Community Elders", "#7c3aed"),
}

MEALS = {
    "2026-12-24 Dinner": ["Jollof rice with chicken", "Vegetable rice with beans", "Child portion"],
    "2026-12-25 Lunch": ["Jollof rice with chicken", "Vegetable rice with beans", "Child portion"],
    "2026-12-25 Dinner": ["Chicken stew with rice", "Vegetable stew with rice", "Child portion"],
    "2026-12-26 Lunch": ["Jollof rice with chicken", "Vegetable rice with beans", "Child portion"],
    "2026-12-27 Gala Dinner": ["Chicken entrée", "Vegetarian entrée", "Child portion"],
    "2026-12-28 Lunch": ["Rice bowl with chicken", "Vegetable rice bowl", "Child portion"],
}


async def one(db, model, **where):
    query = select(model)
    for field, value in where.items():
        query = query.where(getattr(model, field) == value)
    return await db.scalar(query.limit(1))


async def apply(event_id: str, manifest_path: Path) -> None:
    if event_id != EXPECTED_EVENT_ID:
        raise SystemExit(f"Refusing unexpected event id {event_id}")
    async with AsyncSessionLocal() as db:
        event = await db.get(Event, event_id)
        if not event:
            raise SystemExit("NCNMO event not found")
        if "staging.festio.events" not in (event.checkin_base_url or ""):
            raise SystemExit("Refusing to run outside staging")
        if event.name != "NCNMO 2026":
            raise SystemExit(f"Refusing event named {event.name!r}")

        event.event_date = datetime(2026, 12, 24, 14, 0)  # 09:00 Indianapolis (UTC storage)
        event.event_end_date = datetime(2026, 12, 28, 23, 0)
        event.timezone = "America/Indiana/Indianapolis"
        event.event_type = "Conference"
        event.description = (
            "NCNMO Platform 2026 · December 24–28 · Indianapolis. "
            "Demo schedule entries are clearly labelled illustrative."
        )
        event.hotel_name = "The Westin Indianapolis"
        event.hotel_address = "241 W Washington St, Indianapolis, IN 46204"
        event.notify_email = False
        event.notify_sms = False
        event.notify_whatsapp = False
        event.notify_mms = False
        event.post_event_thankyou_enabled = False
        event.notify_rsvp_responses = False
        event.addon_overrides = {
            "addon_menu": True,
            "addon_venue_access": True,
            "addon_experience": True,
            "addon_engagement": True,
            "addon_festiome": True,
        }
        event.menu_enabled = True
        event.venue_access_enabled = True
        event.experience_enabled = True
        event.live_program_enabled = True
        event.live_program_enabled_at = datetime.utcnow()
        event.engagement_enabled = True
        # Keep FestioMe off until adult-only membership isolation is deployed.
        event.festiome_addon_enabled = False

        households = {}
        for name in ("Yusuf Family", "Bello Family"):
            row = await one(db, Household, event_id=event.id, name=f"{MARKER} · {name}")
            if not row:
                row = Household(event_id=event.id, name=f"{MARKER} · {name}", description="Fictional demonstration household")
                db.add(row)
                await db.flush()
            households[name] = row

        zones, ticket_types, tags = {}, {}, {}
        for order, (code, (label, room, color)) in enumerate(GROUPS.items(), 1):
            zone = await one(db, Zone, event_id=event.id, name=f"{MARKER} · {room}")
            if not zone:
                zone = Zone(event_id=event.id, name=f"{MARKER} · {room}", description=f"Illustrative room for {label}", capacity=50, direction_mode="both", sort_order=order)
                db.add(zone)
                await db.flush()
            zones[code] = zone
            ticket = await one(db, TicketType, event_id=event.id, name=f"{MARKER} · {label}")
            if not ticket:
                ticket = TicketType(event_id=event.id, name=f"{MARKER} · {label}", color=color, description="Demo age group", allowed_zone_ids=json.dumps([zone.id]), sort_order=order)
                db.add(ticket)
                await db.flush()
            ticket_types[code] = ticket
            tag = await one(db, GuestTag, event_id=event.id, name=f"{MARKER}-GROUP-{code}")
            if not tag:
                tag = GuestTag(event_id=event.id, name=f"{MARKER}-GROUP-{code}", color=color)
                db.add(tag)
                await db.flush()
            tags[code] = tag

        guests = {}
        for demo_id, first, last, age, code, household in PEOPLE:
            email = f"ncnmo.demo.{demo_id}@example.com"
            guest = await one(db, Guest, event_id=event.id, email=email)
            if not guest:
                guest = Guest(
                    event_id=event.id, first_name=first, last_name=last, email=email,
                    phone=None, rsvp_status="confirmed", qr_generated_at=datetime.utcnow(),
                    household_id=households[household].id, ticket_type_id=ticket_types[code].id,
                    rsvp_guest_type=f"{GROUPS[code][0]} · age {age}",
                    rsvp_relationship="Fictional demo attendee",
                    rsvp_notes=f"{MARKER} · Synthetic record · no outbound contact",
                    sms_consent=False, whatsapp_consent=False,
                )
                db.add(guest)
                await db.flush()
            else:
                guest.household_id = households[household].id
                guest.ticket_type_id = ticket_types[code].id
                guest.rsvp_status = "confirmed"
                guest.sms_consent = False
                guest.whatsapp_consent = False
            guests[demo_id] = guest
            if not await db.scalar(select(GuestTagLink).where(GuestTagLink.guest_id == guest.id, GuestTagLink.tag_id == tags[code].id)):
                db.add(GuestTagLink(guest_id=guest.id, tag_id=tags[code].id))

        event.festiome_access_policy = {
            "mode": "approved_adults",
            "adult_guest_ids": [guests[demo_id].id for demo_id in ("08", "09", "10")],
        }
        event.festiome_addon_enabled = True

        menu_rows = {}
        for order, (meal_name, item_names) in enumerate(MEALS.items(), 1):
            name = f"{MARKER} · {meal_name}"
            category = await one(db, MenuCategory, event_id=event.id, name=name)
            if not category:
                category = MenuCategory(event_id=event.id, name=name, day_label=meal_name.split(" ", 1)[0], sort_order=order, is_required=False)
                db.add(category)
                await db.flush()
            items = []
            for item_order, item_name in enumerate(item_names, 1):
                item = await one(db, MenuItem, category_id=category.id, name=item_name)
                if not item:
                    item = MenuItem(event_id=event.id, category_id=category.id, name=item_name, description="Illustrative option")
                    db.add(item)
                    await db.flush()
                items.append(item)
            menu_rows[meal_name] = (category, items)

        for demo_id, guest in guests.items():
            is_child = int(demo_id) <= 7
            for category, items in menu_rows.values():
                selected = items[2] if is_child else items[(int(demo_id) + category.sort_order) % 2]
                choice = await db.scalar(select(GuestMenuChoice).where(GuestMenuChoice.guest_id == guest.id, GuestMenuChoice.category_id == category.id))
                if not choice:
                    db.add(GuestMenuChoice(guest_id=guest.id, category_id=category.id, menu_item_id=selected.id))
                else:
                    choice.menu_item_id = selected.id

        workflow = await one(db, ExperienceWorkflow, event_id=event.id, name=f"{MARKER} · Platform 2026 Journey")
        if not workflow:
            latest = await db.scalar(select(ExperienceWorkflow.version).where(ExperienceWorkflow.event_id == event.id).order_by(ExperienceWorkflow.version.desc()).limit(1))
            workflow = ExperienceWorkflow(event_id=event.id, name=f"{MARKER} · Platform 2026 Journey", status="published", version=(latest or 0) + 1, is_default=True)
            db.add(workflow)
            await db.flush()

        step_defs = [
            ("welcome", "custom", "Welcome to Platform 2026", "2026-12-24", "09:00", "09:30", "Registration"),
            ("badge-pickup", "badge", "Print and issue QR ID badge", "2026-12-24", "09:00", "18:00", "Registration and Badge Desk"),
            ("parenting", "session_attendance", "Parenting Workshop · published program", "2026-12-24", "09:00", "18:00", "Illustrative Workshop Room"),
            ("opening", "session_attendance", "Opening Gathering · illustrative", "2026-12-24", "18:30", "20:00", "Illustrative Main Hall"),
        ]
        for day in (25, 26):
            for code, (label, room, _color) in GROUPS.items():
                step_defs.append((f"d{day}-g{code}", "session_attendance", f"{label} Learning Session · illustrative", f"2026-12-{day}", "10:00", "11:30", f"Illustrative {room}"))
        step_defs.extend([
            ("adult-networking", "session_attendance", "Adult Networking · illustrative", "2026-12-27", "10:00", "11:30", "Illustrative Networking Room"),
            ("youth-activities", "session_attendance", "Youth Activities · illustrative", "2026-12-27", "10:00", "11:30", "Illustrative Youth Room"),
            ("gala", "session_attendance", "Family Gala · illustrative", "2026-12-27", "18:00", "21:00", "Illustrative Ballroom"),
            ("closing", "session_attendance", "Closing Reflections · illustrative", "2026-12-28", "14:00", "15:00", "Illustrative Main Hall"),
            ("feedback", "feedback", "Platform 2026 Feedback", "2026-12-28", "15:00", "17:00", "Guest Hub"),
        ])
        for order, (key, kind, title, date, start, end, room) in enumerate(step_defs, 1):
            full_key = f"ncnmo-demo-{key}"
            step = await one(db, ExperienceStep, workflow_id=workflow.id, key=full_key)
            config = {"session": {"date": date, "start_time": start, "end_time": end, "room": room, "capacity": 50}}
            conditions = None
            if "-g" in key:
                code = key.rsplit("-g", 1)[1]
                conditions = {"guest_tags_include": [tags[code].name]}
            if not step:
                db.add(ExperienceStep(workflow_id=workflow.id, key=full_key, type=kind, title=title, description="NCNMO demonstration content", sort_order=order * 10, required=False, enabled=True, conditions=conditions, config=config))
            else:
                step.title, step.type, step.sort_order = title, kind, order * 10
                step.conditions, step.config, step.enabled = conditions, config, True

        await db.commit()
        manifest = {
            "marker": MARKER,
            "event": {"id": event.id, "name": event.name, "environment": "staging", "guest_hub": f"https://staging.festio.events/admin?event={event.id}"},
            "preserved_preexisting_guest_count": 6,
            "demo_guests": [{"demo_id": f"DEMO-{p[0]}", "name": f"{p[1]} {p[2]}", "guest_id": guests[p[0]].id, "group": p[4]} for p in PEOPLE],
            "zones": {code: zone.id for code, zone in zones.items()},
            "workflow_id": workflow.id,
            "festiome_policy_configured": True,
            "festiome_approved_demo_ids": ["DEMO-08", "DEMO-09", "DEMO-10"],
        }
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
        print(json.dumps({"ok": True, "event_id": event.id, "demo_guests": len(guests), "zones": len(zones), "meals": len(menu_rows), "workflow_steps": len(step_defs), "manifest": str(manifest_path)}))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--event-id", required=True)
    parser.add_argument("--manifest", type=Path, default=Path("/tmp/ncnmo-staging-demo-manifest.json"))
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if not args.apply:
        raise SystemExit("Dry by default. Re-run with --apply after reviewing the script.")
    asyncio.run(apply(args.event_id, args.manifest))


if __name__ == "__main__":
    main()
