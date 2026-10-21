"""Email-safe adaptations of the Festio/PAMAN journey and audience infographics.

Live text and single-column tables keep the message useful with images disabled.
Only client onboarding sequences opt in; no external artwork or tracking pixels.
"""
from html import escape

PANELS = {
    ("registered", 0): ("One connected event journey", [
        ("01 · BEFORE", "Create the experience", "Event pages, invitations, registration and RSVPs.", "#e4f3ef", "#104c43"),
        ("02 · DURING", "Welcome and coordinate", "Guest passes, arrival check-in, seating and meal services.", "#fff0d1", "#664112"),
        ("03 · AFTER", "Learn and reconnect", "Attendance records, feedback and event reports.", "#eee8f8", "#493267"),
    ]),
    ("registered", 2): ("Choose the tools your event needs", [
        ("DESIGN & INVITE", "Your event, your identity", "Design Studio, event websites, invitations and RSVP pages.", "#e4f3ef", "#104c43"),
        ("REGISTER & WELCOME", "A clearer guest journey", "Registration, ticketing, guest passes and check-in.", "#e5edfc", "#243f72"),
        ("PLAN & COORDINATE", "Give everyone a place", "Guest lists, households, seating, planners and team tasks.", "#fff0d1", "#664112"),
        ("SERVE & SUPPORT", "Connect the service team", "Menu choices, orders, meal headcounts and assigned table managers.", "#fbe8e2", "#743c2e"),
        ("CONNECT & ENGAGE", "Keep guests involved", "GuestHub, Festio Live and FestioMe community tools.", "#eee8f8", "#493267"),
        ("REVIEW & IMPROVE", "Make your records useful", "Attendance, feedback and event results help inform the next event.", "#e8f0e0", "#3c5127"),
    ]),
    ("event_created", 0): ("Three steps to a guest-ready event", [
        ("01 · DETAILS", "Set the essentials", "Confirm the date, timezone and venue.", "#e4f3ef", "#104c43"),
        ("02 · EXPERIENCE", "Shape what guests see", "Add your branding and review the invitation or registration page.", "#fff0d1", "#664112"),
        ("03 · PREVIEW", "Try the guest journey", "Check the details and registration flow before sharing.", "#eee8f8", "#493267"),
    ]),
}


def render_infographic(payload, step_index):
    if payload.get("journey_context") is not True:
        return "", ""
    panel = PANELS.get((payload.get("stage"), step_index))
    if not panel:
        return "", ""
    heading, cards = panel
    rows = []
    text = [heading]
    for label, title, description, background, color in cards:
        text.append(f"{label}: {title}. {description}")
        rows.append(f'''<tr><td style="padding:0 0 10px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:18px;background:{background};color:{color};border-left:4px solid {color};border-radius:8px"><p style="margin:0 0 6px;font-size:12px;font-weight:bold;letter-spacing:1px">{escape(label)}</p><h3 style="margin:0 0 6px;font-size:18px;line-height:1.3">{escape(title)}</h3><p style="margin:0;font-size:15px;line-height:1.6">{escape(description)}</p></td></tr></table></td></tr>''')
    note = "Choose what fits your event. Availability depends on your plan, enabled add-ons and setup; messaging may require credits."
    text.append(note)
    html = f'''<h2 style="margin:28px 0 14px;font-size:21px;line-height:1.3">{escape(heading)}</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0">{"".join(rows)}</table><p style="font-size:13px;line-height:1.6;color:#526070">{escape(note)}</p>'''
    return html, "\n".join(text)
