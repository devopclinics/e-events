"""Published, versioned Festio staff curriculum. Content changes ship as a new version."""

COURSE_KEY = "festio-platform-foundations"
COURSE_VERSION = 1

_modules = [
    ("foundations", "1. Platform foundations", [
        ("platform-overview", "Platform overview", "Festio_Complete_Platform.png"),
        ("audience", "Who Festio serves", "festio-target-audiences.png"),
        ("outcomes", "Value and outcomes", "festio-value-outcomes.png"),
        ("use-cases", "Use-case examples", "festio-use-case-examples.png"),
    ]),
    ("operations", "2. Operations flow", [
        ("event-operations", "Event operations flow", "festio-event-operations-flow.png"),
        ("guest-journey", "Guest journey flow", "festio-guest-journey-flow.png"),
        ("event-day", "Event-day operations map", "festio-event-day-operations-map.png"),
        ("roles", "Roles and responsibilities", "festio-roles-responsibilities-map.png"),
    ]),
    ("capabilities", "3. Product capabilities", [
        ("ecosystem", "Product ecosystem", "festio-product-ecosystem-map.png"),
        ("capability-landscape", "Complete capability landscape", "festio-complete-capability-landscape.png"),
        ("packages", "Packages and upgrade journey", "festio-packages-upgrade-journey.png"),
        ("security", "Security and trust", "festio-security-trust.png"),
        ("app-explainer", "How the Festio app works", "festio-app-explainer.png"),
    ]),
]

_setup = [
    ("event-setup", "Event Setup"), ("planner", "Planner"), ("ticketing", "Ticketing"),
    ("festiopass", "FestioPass"), ("guest-management", "Guest Management"),
    ("guest-communication", "Guest Communication"), ("festiohub", "FestioHub"),
    ("public-pages", "Public Pages"), ("design-studio", "Design Studio"),
    ("seating-floor-plan", "Seating & Floor Plan"), ("gifts", "Gifts"),
    ("registry", "Registry"), ("checkin-scanner", "Check-in & Scanner"),
    ("guest-experience", "Guest Experience"), ("task-management", "Task Management"),
    ("team-management", "Team Management"), ("live-command-center", "Live Command Center"),
    ("kitchen-logistics", "Kitchen & Logistics"), ("reporting-results", "Reporting & Results"),
    ("platform-api", "Platform & API"),
]
_modules.append(("setup", "4. Capability setup guides", [
    (key, title, f"steps/{i:02d}-festio-{key}-guide.png") for i, (key, title) in enumerate(_setup, 1)
]))


def published_course():
    modules, order = [], 0
    for module_key, module_title, raw_lessons in _modules:
        lessons = []
        for key, title, image in raw_lessons:
            order += 1
            is_setup = module_key == "setup"
            lessons.append({
                "key": key, "title": title, "order": order,
                "duration_minutes": 8 if is_setup else 6,
                "image_url": f"/knowledge-transfer/assets/{image}",
                "objective": f"Explain the purpose of {title} and confidently perform its core Festio workflow.",
                "why_it_matters": f"{title} is part of a consistent, accountable event operation. Correct setup prevents guest-facing surprises and gives the team reliable information.",
                "prerequisites": ["Sign in to your Festio staff account", "Use a safe training or staging event for practice"],
                "steps": [
                    f"Review the {title} visual guide and identify the intended outcome.",
                    f"Open the relevant {title} area in Festio and confirm the correct organization and event.",
                    "Complete the workflow using test data, save it, and verify the saved result.",
                    "Check the staff or guest-facing view as applicable, then record any issue before production use.",
                ],
                "common_mistakes": ["Working in the wrong event", "Assuming an unsaved preview is published", "Skipping the final guest/staff-view verification"],
                "practical": f"In a training event, demonstrate the {title} workflow and submit a short note or link as evidence for your manager.",
                "quiz": [
                    {"question": f"Before considering {title} complete, what should you do?", "options": ["Verify the saved result in its intended view", "Close the browser immediately", "Assume the preview is live", "Repeat the action in production"], "correct": 0},
                    {"question": "Where should a new workflow be practiced first?", "options": ["A safe training or staging event", "A guest's live invitation", "Any customer's production event", "A public social post"], "correct": 0},
                ],
            })
        modules.append({"key": module_key, "title": module_title, "lessons": lessons})
    return {
        "key": COURSE_KEY, "version": COURSE_VERSION, "status": "published",
        "title": "Festio Platform & Operations Academy",
        "description": "Role-ready training for operating Festio safely from event setup through reporting.",
        "passing_score": 80, "requires_practical_approval": True, "modules": modules, "lesson_count": order,
        "estimated_minutes": sum(x["duration_minutes"] for m in modules for x in m["lessons"]),
    }


def lessons():
    return [lesson for module in published_course()["modules"] for lesson in module["lessons"]]
