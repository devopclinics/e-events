"""Review candidates only. Importing this module never mutates stored templates."""
from copy import deepcopy


def retention_candidate():
    return {"category": "organizer_retention", "journey_context": True, "steps": [{"delay_hours": 0,
        "subject": "Review your event and plan your next draft", "body": "Review your event results and any outstanding delivery or payment exceptions. When you are ready to organize another event, create a new draft and check its dates, timezone and guest experience. A new event needs its own readiness checks.",
        "cta": "Create your next event draft", "cta_url": "https://festio.events/setup-redesign"}]}


def candidates():
    setup = "https://festio.events/setup-redesign"
    event = "https://festio.events/admin-redesign"
    def step(delay, subject, body, cta, url):
        return dict(delay_hours=delay, subject=subject, body=body, cta=cta, cta_url=url)
    result = deepcopy({
        "New registration welcome": dict(stage="registered", cadence_days=2, cta_url=setup, steps=[
            step(0, "Welcome to Festio", "Bring your event together in one place. Start with a name, date and event type, then choose the tools you need for invitations, registration and check-in. You can save your draft and return whenever you are ready.", "Create my event", setup),
            step(24, "Your next event starts with a simple first step", "From a private celebration to a conference, your event deserves a clear plan. Create your draft first; add the guest experience, team and services as your plans take shape.", "Start my event", setup),
            step(72, "Less chasing. More time for your event.", "Keep invitations, RSVPs and arrival check-in connected, so your team can work from the same guest information. Create an event to explore the tools that fit your plans. Paid features and message credits depend on your chosen plan.", "Explore my event setup", setup),
            step(168, "What is holding your event back?", "If you are unsure where to start, reply with the kind of event you are planning and the part you need help with. Our team can help you choose a practical next step. This is the last reminder in this welcome series; you can start whenever you are ready.", "Create my event", setup),
        ]),
        "Event created onboarding": dict(stage="event_created", cadence_days=3, cta_url=event, steps=[
            step(0, "Your event is taking shape", "Your draft gives you one place to bring the details together. Add your venue, check the date and timezone, and shape the invitation or registration page your guests will see.", "Continue my event", event),
            step(48, "Make it easy for guests to say yes", "A clear invitation and a simple registration flow help guests know what to do next. Preview your guest experience, check the important details, and try it yourself before sharing it with your audience.", "Preview my guest experience", event),
            step(120, "Give your team a clear plan for event day", "Connect your guest list, staff access and arrival process before the doors open. Your event guide helps you see what still needs attention. Reply if you would like help with a specific setup task.", "Open my event guide", event),
        ]),
    })
    for payload in result.values():
        payload["journey_context"] = True
    return result
