from collections import OrderedDict
from html import escape
from urllib.parse import quote, urlparse

TRACK_PALETTE = ["#2f5aa8", "#3d8b4c", "#7c4fb0", "#c98a1f", "#c23b4f", "#1f8a7a"]


def safe_url(value):
    value = str(value or "").strip()
    parsed = urlparse(value)
    return escape(value, quote=True) if parsed.scheme in ("http", "https") and parsed.netloc else ""


def safe_destination(value):
    value = str(value or "").strip()
    if value.startswith("#") and len(value) > 1:
        return escape(value, quote=True)
    parsed = urlparse(value)
    if parsed.scheme in ("http", "https") and parsed.netloc:
        return escape(value, quote=True)
    if parsed.scheme == "mailto" and "@" in parsed.path:
        # Avoid Cloudflare Scrape Shield replacing mail links with a JS-only
        # email-protection route. Browsers decode the percent-encoded address.
        return escape(f"mailto:{quote(parsed.path, safe='.+-_')}", quote=True)
    return ""


def action(link, cls="button"):
    url = safe_url((link or {}).get("url"))
    return f'<a class="{cls}" href="{url}">{escape((link or {}).get("label", "Open"))}</a>' if link and url else ""


def navigation_markup(content, *, footer=False):
    items = content.get("navigation") or []
    if not items:
        items = [
            {"label": "Programme", "url": "#programme", "enabled": "programme" in set(content.get("visible_sections") or [])},
            {"label": "Venue", "url": content.get("venue_url"), "enabled": bool(content.get("venue_url"))},
            {"label": "Contact", "url": f'mailto:{content.get("contact_email")}' if content.get("contact_email") else "", "enabled": bool(content.get("contact_email"))},
        ]
    links, destinations = [], set()
    for item in items:
        url = safe_destination(item.get("url"))
        if not item.get("enabled", True) or not url or url in destinations:
            continue
        destinations.add(url)
        attrs = ' target="_blank" rel="noopener"' if url.startswith("http") else ""
        links.append(f'<a href="{url}"{attrs}>{escape(item.get("label", "Open"))}</a>')
    contact = f'mailto:{content.get("contact_email")}' if content.get("contact_email") else ""
    if footer and contact and safe_destination(contact) not in destinations:
        links.append(f'<a href="{escape(contact, quote=True)}">Contact</a>')
    return "".join(links)


def facts_markup(facts):
    return "".join(
        f'<div class="fact"><small>{escape(item.get("label", ""))}</small><b>{escape(item.get("value", ""))}</b></div>'
        for item in facts or [] if item.get("value")
    )


def track_colors(content):
    """title -> hex, using each Track's own color or a stable palette fallback."""
    colors = {}
    for index, track in enumerate(content.get("tracks") or []):
        title = track.get("title", "")
        if title:
            colors[title] = track.get("color") or TRACK_PALETTE[index % len(TRACK_PALETTE)]
    return colors


def track_markup(track, index, colors):
    image_url = safe_url(track.get("image_url"))
    color = colors.get(track.get("title", ""), TRACK_PALETTE[index % len(TRACK_PALETTE)])
    visual = f'<img src="{image_url}" alt="" loading="lazy">' if image_url else f'<i>{escape(track.get("icon", "✦"))}</i>'
    title = escape(track.get("title", ""))
    return (
        f'<article class="track" style="--track-color:{color}">{visual}'
        f'<div><b>{title}</b><small>{escape(track.get("description", ""))}</small>'
        f'<a class="track-jump" href="#programme">View sessions →</a></div></article>'
    )


PIN_ICON = '<svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M10 18s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10Z"/><circle cx="10" cy="8" r="2.2"/></svg>'
PEOPLE_ICON = '<svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="7" cy="6.5" r="2.5"/><path d="M2 17c0-2.8 2.2-5 5-5s5 2.2 5 5"/><circle cx="14.5" cy="7" r="2"/><path d="M12.5 17c.2-2.3 1.9-4 4-4 1.8 0 3.3 1.2 3.8 2.9"/></svg>'


def _filter_slug(value, prefix):
    import re
    return f'{prefix}-{re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-") or "x"}'


def _programme_date_label(start, end):
    """Compact a same-month programme range without treating departure as
    another convention day (for example, December 24–27, 2026)."""
    from datetime import datetime
    start, end = str(start or "").strip(), str(end or "").strip()
    if not start:
        return end
    if not end:
        return start
    start_date = None
    for start_format in ("%B %d, %Y", "%b %d, %Y"):
        try:
            start_date = datetime.strptime(start, start_format)
            break
        except ValueError:
            continue
    if not start_date:
        return start
    end_date = None
    for end_format in ("%B %d, %Y", "%B %d", "%b %d, %Y", "%b %d", "%Y-%m-%d"):
        try:
            end_date = datetime.strptime(end, end_format)
            if end_date.year == 1900:
                end_date = end_date.replace(year=start_date.year)
            break
        except ValueError:
            continue
    if not end_date:
        # end couldn't be resolved against any known format (e.g. a raw ISO
        # session date, or malformed data) — show the clean start date
        # rather than leak unformatted data next to it.
        return start
    if start_date.date() == end_date.date():
        return f"{start_date.strftime('%B')} {start_date.day}, {start_date.year}"
    if start_date.year == end_date.year and start_date.month == end_date.month:
        return f"{start_date.strftime('%B')} {start_date.day}–{end_date.day}, {start_date.year}"
    if start_date.year == end_date.year:
        return f"{start_date.strftime('%B')} {start_date.day} – {end_date.strftime('%B')} {end_date.day}, {end_date.year}"
    return f"{start_date.strftime('%B')} {start_date.day}, {start_date.year} – {end_date.strftime('%B')} {end_date.day}, {end_date.year}"


def countdown_markup(content):
    """'N days to go' / 'Tomorrow!' badge, matching the same wording and
    threshold the RSVP page already uses (event.invite_countdown_enabled,
    InvitePage.jsx) — nothing shown once the event has started, same as
    there. The public site re-renders per request (60s edge cache), so this
    is computed fresh here rather than needing any client-side JS, which the
    strict CSP on this page wouldn't allow anyway."""
    from datetime import datetime
    start = str(content.get("start_date") or "").strip()
    if not start:
        return ""
    start_date = None
    for start_format in ("%B %d, %Y", "%b %d, %Y"):
        try:
            start_date = datetime.strptime(start, start_format)
            break
        except ValueError:
            continue
    if not start_date:
        return ""
    days_left = (start_date.date() - datetime.now().date()).days
    if days_left <= 0:
        return ""
    label = "Tomorrow!" if days_left == 1 else f"{days_left} days to go"
    return f'<span class="countdown-chip">{escape(label)}</span>'


def schedule_markup(content):
    """Day/track filtering with no JavaScript: public pages ship a strict
    CSP with no script-src, by design (Plan §14 — no custom JS on untrusted
    public content). Filtering uses plain radio inputs + the ~ sibling
    combinator instead — every browser, no CSP exception needed."""
    sessions = content.get("sessions") or []
    if not sessions:
        return '<p class="empty-copy">The full programme will be published here.</p>'
    colors = track_colors(content)
    groups = OrderedDict()
    for session in sessions:
        day = session.get("day") or session.get("date") or "Programme"
        groups.setdefault(day, []).append(session)
    days = list(groups)
    tracks_in_use = list(dict.fromkeys(s.get("track") for s in sessions if s.get("track")))

    radios = []
    day_tabs = []
    for i, day in enumerate(days):
        day_id = _filter_slug(day, "day")
        radios.append(f'<input type="radio" name="day-filter" id="{day_id}" class="filter-radio"{" checked" if i == 0 else ""}>')
        first_date = groups[day][0].get("date", "")
        date_html = f"<small>{escape(first_date)}</small>" if first_date else ""
        day_tabs.append(f'<label for="{day_id}" class="day-tab">{escape(day)}{date_html}</label>')

    track_ids = {track: _filter_slug(track, "track") for track in tracks_in_use}
    radios.append('<input type="radio" name="track-filter" id="track-all" class="filter-radio" checked>')
    track_pills = ['<label for="track-all" class="track-pill">All tracks</label>']
    for track in tracks_in_use:
        radios.append(f'<input type="radio" name="track-filter" id="{track_ids[track]}" class="filter-radio">')
        track_pills.append(f'<label for="{track_ids[track]}" class="track-pill" style="--track-color:{colors.get(track, "#6b746f")}">{escape(track)}</label>')

    hide_rules, active_rules = [], []
    for day in days:
        day_id = _filter_slug(day, "day")
        hide_rules.append(f'#{day_id}:checked ~ .sessions .session:not([data-day="{escape(day, quote=True)}"])')
        active_rules.append(f'#{day_id}:checked ~ .schedule-filters label[for="{day_id}"]{{background:var(--green);border-color:var(--green);color:#fff}}')
    for track in tracks_in_use:
        track_id = track_ids[track]
        hide_rules.append(f'#{track_id}:checked ~ .sessions .session:not([data-track="{escape(track, quote=True)}"])')
        active_rules.append(f'#{track_id}:checked ~ .schedule-filters label[for="{track_id}"]{{background:var(--track-color,var(--rust));border-color:var(--track-color,var(--rust));color:#fff}}')
    if tracks_in_use:
        active_rules.append('#track-all:checked ~ .schedule-filters label[for="track-all"]{background:var(--rust);border-color:var(--rust);color:#fff}')
    filter_style = f'<style>{",".join(hide_rules)}{{display:none}}{"".join(active_rules)}</style>' if hide_rules else ""

    cards = []
    for session in sessions:
        day = session.get("day") or session.get("date") or "Programme"
        track = session.get("track", "")
        color = colors.get(track, "#6b746f")
        image = safe_url(session.get("image_url"))
        thumb = f'<img class="session-thumb" src="{image}" alt="" loading="lazy">' if image else ""
        meta_bits = []
        if session.get("venue"):
            meta_bits.append(f'<span>{PIN_ICON} {escape(session.get("venue"))}</span>')
        if session.get("audience"):
            meta_bits.append(f'<span>{PEOPLE_ICON} {escape(session.get("audience"))}</span>')
        speaker = f'<span class="speaker-line">With {escape(session.get("speaker"))}</span>' if session.get("speaker") else ""
        description = f'<p>{escape(session.get("description"))}</p>' if session.get("description") else ""
        cta = action({"label": session.get("action_label") or "View details", "url": session.get("action_url")}, "session-action") if session.get("action_url") else ""
        tag = f'<span class="session-tag" style="--track-color:{color}">{escape(track)}</span>' if track else ""
        cards.append(
            f'<article class="session" data-day="{escape(day, quote=True)}" data-track="{escape(track, quote=True)}">'
            f'<div class="session-time"><time>{escape(session.get("time", ""))}</time></div>{thumb}'
            f'<div class="session-body">{tag}<h3>{escape(session.get("title", ""))}</h3>'
            f'{description}<div class="session-meta">{"".join(meta_bits)}</div>{speaker}{cta}</div></article>'
        )

    filters = ""
    if len(days) > 1 or tracks_in_use:
        day_tabs_html = f'<div class="day-tabs">{"".join(day_tabs)}</div>' if len(days) > 1 else ""
        track_pills_html = f'<div class="track-pills">{"".join(track_pills)}</div>' if tracks_in_use else ""
        filters = f'<div class="schedule-filters">{day_tabs_html}{track_pills_html}</div>'
    return f'{"".join(radios)}{filter_style}{filters}<div class="sessions">{"".join(cards)}</div>'


def speakers_markup(speakers):
    cards = []
    for speaker in speakers or []:
        photo = safe_url(speaker.get("photo_url"))
        visual = f'<img src="{photo}" alt="" loading="lazy">' if photo else f'<div class="speaker-initial">{escape((speaker.get("name") or "?")[:1])}</div>'
        role = " · ".join(filter(None, (speaker.get("title", ""), speaker.get("organization", ""))))
        sessions = ", ".join(speaker.get("session_titles") or [])
        cards.append(f'<article class="speaker-card">{visual}<div><h3>{escape(speaker.get("name", ""))}</h3><b>{escape(role)}</b><p>{escape(speaker.get("bio", ""))}</p>{f"<small>Sessions: {escape(sessions)}</small>" if sessions else ""}</div></article>')
    return "".join(cards)


def speakers_pending_markup(content):
    """A lineup-not-confirmed placeholder that shows session-role categories
    instead of repeating a fake name across identical cards."""
    roles = list(dict.fromkeys(t.get("title") for t in content.get("tracks") or [] if t.get("title")))[:4]
    if not roles:
        roles = ["Keynote", "Panel Discussion", "Masterclass", "Technology Session"]
    tiles = "".join(f'<div class="speaker-pending-tile"><i>✦</i><b>{escape(role)}</b></div>' for role in roles)
    return (
        '<div class="speakers-pending">'
        '<p class="speakers-pending-lede">Speaker lineup to be announced.</p>'
        f'<div class="speaker-pending-grid">{tiles}</div>'
        '</div>'
    )


def exhibitors_markup(exhibitors):
    cards = []
    for item in exhibitors or []:
        logo = safe_url(item.get("logo_url"))
        mark = f'<img src="{logo}" alt="" loading="lazy">' if logo else f'<div class="exhibitor-mark">{escape((item.get("name") or "?")[:2].upper())}</div>'
        category = f'<small>{escape(item.get("category", ""))}</small>' if item.get("category") else ""
        description = f'<p>{escape(item.get("description", ""))}</p>' if item.get("description") else ""
        cards.append(f'<article class="exhibitor-card">{mark}<b>{escape(item.get("name", ""))}</b>{category}{description}</article>')
    return "".join(cards)


def feature_markup(section, index):
    if not section.get("enabled", True):
        return ""
    image = safe_url(section.get("image_url"))
    facts = section.get("facts") or []
    if image:
        media = f'<img src="{image}" alt="" loading="lazy">'
    elif facts:
        # No photo supplied — fill the visual half with the section's own
        # facts as icon tiles instead of one lone decorative glyph sitting
        # in an otherwise empty panel.
        tiles = "".join(
            f'<div class="feature-tile"><i>✦</i>'
            f'<b>{escape(fact.get("value", ""))}</b><small>{escape(fact.get("label", ""))}</small></div>'
            for fact in facts[:6]
        )
        media = f'<div class="feature-tiles">{tiles}</div>'
    else:
        media = '<div class="feature-pattern">✦</div>'
    section_id = escape(section.get("id") or f"feature-{index}", quote=True)
    facts_html = "" if (facts and not image) else facts_markup(facts)
    return f'''<section class="feature {"reverse" if index % 2 else ""}" id="{section_id}"><div class="feature-media">{media}</div><div class="feature-copy"><div class="eyebrow">{escape(section.get("kicker", "Featured programme"))}</div><h2>{escape(section.get("title", ""))}</h2><p>{escape(section.get("summary", ""))}</p><div class="facts">{facts_html}</div>{action(section.get("action"), "button")}</div></section>'''


def render(content, preview=False):
    e = escape
    name = e(content.get("event_name", "Event")); primary = e(content.get("primary_color", "#0d5c55")); accent = e(content.get("accent_color", "#a64f2b"))
    hero = safe_url(content.get("feature_image_url") or content.get("hero_image_url")); logo = safe_url(content.get("logo_url")); visible = set(content.get("visible_sections") or ["stats", "programme", "tracks", "connect"])
    tagline = e(content.get("brand_tagline") or "Event information")
    brand = f'<img src="{logo}" alt="{name}">' if logo else f'<span class="mark">✤</span><div><b>{name}</b><small>{tagline}</small></div>'
    stats_html = "".join(f'<div class="stat"><strong>{e(x.get("value", ""))}</strong><div><b>{e(x.get("label", ""))}</b><small>{e(x.get("detail", ""))}</small></div></div>' for x in content.get("stats", [])[:6])
    hero_stats = f'<div class="hero-stats">{stats_html}</div>' if "stats" in visible and stats_html else ""
    colors = track_colors(content)
    tracks = "".join(track_markup(x, i, colors) for i, x in enumerate(content.get("tracks", [])[:12]))
    registration = f'<section class="registration" id="registration"><div><div class="eyebrow">Registration</div><h2>Register with confidence</h2><p>Everything guests need to know before completing registration.</p>{action(content.get("primary_action"))}</div><div class="facts">{facts_markup(content.get("registration_facts"))}</div></section>' if content.get("registration_facts") else ""
    programme = f'<section class="programme" id="programme"><div class="section-head"><div class="eyebrow">Everything happening during {name}</div><h2>{e(content.get("programme_title") or "Programme")}</h2><p>{e(content.get("programme_summary") or "")}</p></div>{schedule_markup(content)}</section>' if "programme" in visible else ""
    audience = f'<section class="audiences" id="tracks"><div class="section-head"><div class="eyebrow">Programme tracks</div><h2>Choose your experience</h2><p>Choose the programme track most relevant to your work and interests.</p></div><div class="tracks">{tracks}</div></section>' if "tracks" in visible and tracks else ""
    if content.get("speakers_confirmed", True):
        speakers_body = f'<div class="speaker-grid">{speakers_markup(content.get("speakers"))}</div>' if speakers_markup(content.get("speakers")) else ""
    else:
        speakers_body = speakers_pending_markup(content)
    speakers_section = f'<section class="speakers" id="speakers"><div class="section-head"><div class="eyebrow">Presenters</div><h2>Featured speakers</h2></div>{speakers_body}</section>' if speakers_body else ""
    features = "".join(feature_markup(section, index) for index, section in enumerate(content.get("feature_sections") or []))
    exhibitors_body = exhibitors_markup(content.get("exhibitors"))
    exhibitors_section = f'<section class="exhibitors" id="exhibitors"><div class="section-head"><div class="eyebrow">Event industry</div><h2>Meet the event industry</h2><p>Sample categories shown for preview — real exhibitors are confirmed separately.</p></div><div class="exhibitor-grid">{exhibitors_body}</div></section>' if "exhibitors" in visible and exhibitors_body else ""
    venue_url = safe_url(content.get("venue_url")); venue_name = e(content.get("venue", "")); venue_address = e(content.get("venue_address", ""))
    venue_action = f'<a class="button" href="{venue_url}" target="_blank" rel="noopener">Open directions</a>' if venue_url else ""
    venue_heading = f'<a class="venue-heading-link" href="{venue_url}" target="_blank" rel="noopener"><h2>{venue_name or "Plan your arrival"}</h2><p>{venue_address}</p></a>' if venue_url else f'<h2>{venue_name or "Plan your arrival"}</h2><p>{venue_address}</p>'
    venue = f'<section class="venue" id="venue"><div><div class="eyebrow">Venue & travel</div>{venue_heading}{venue_action}</div><div class="facts">{facts_markup(content.get("venue_facts"))}</div></section>' if venue_name or venue_address or content.get("venue_facts") else ""
    live = action({"label": "Open Festio Live ›", "url": content.get("festio_live_url")}, "connect-card") if content.get("festio_live_url") else ""
    me = action({"label": "Open GuestHub ›", "url": content.get("festiome_url")}, "connect-card") if content.get("festiome_url") else ""
    live_title = e(content.get("festio_live_title") or "Festio Live")
    live_description = e(content.get("festio_live_description") or "Participate in live Q&A, polls and activities.")
    me_title = e(content.get("festiome_title") or "GuestHub")
    me_description = e(content.get("festiome_description") or "Your personal event hub, pass and programme.")
    live_panel = f'<div><h3>{live_title}</h3><p>{live_description}</p>{live}</div>' if live else ""
    me_panel = f'<div><h3>{me_title}</h3><p>{me_description}</p>{me}</div>' if me else ""
    connect = f'<section class="connect" id="connect"><div><div class="eyebrow">Your Festio experience</div><h2>One event, connected</h2></div>{live_panel}{me_panel}</section>' if "connect" in visible and (live or me) else ""
    faqs = "".join(f'<details><summary>{e(item.get("question", ""))}</summary><p>{e(item.get("answer", ""))}</p></details>' for item in content.get("faqs") or [])
    faq_section = f'<section class="faq" id="faq"><div class="section-head"><div class="eyebrow">Helpful details</div><h2>Frequently asked questions</h2></div>{faqs}</section>' if faqs else ""
    contact_url = safe_destination("mailto:" + str(content.get("contact_email") or ""))
    contact = f'<section class="contact" id="contact"><div><div class="eyebrow">Still have a question?</div><h2>Contact the event team</h2></div><a class="button" href="{contact_url}">Email us</a></section>' if contact_url else ""
    preview_bar = '<div class="preview">Preview — visitors cannot see this draft</div>' if preview else ""
    departure_sessions = [item for item in content.get("sessions", []) if (item.get("day") or "").strip().lower() == "departure"]
    programme_dates = [item.get("date") for item in content.get("sessions", []) if item.get("date") and (item.get("day") or "").strip().lower() != "departure"]
    programme_end = programme_dates[-1] if programme_dates else content.get("end_date", "")
    departure_date = departure_sessions[0].get("date", "") if departure_sessions else ""
    date_meta = e(_programme_date_label(content.get("start_date", ""), programme_end))
    if departure_date:
        departure_label = departure_date if any(char.isdigit() for char in departure_date[-4:]) and "," in departure_date else f"{departure_date}, {str(content.get('start_date', ''))[-4:]}"
        date_meta += f' <small>Departure · {e(departure_label)}</small>'
    venue_meta = f'<a class="venue-link" href="{venue_url}" target="_blank" rel="noopener">● {venue_name}</a>' if venue_url else f'<span>● {venue_name}</span>'
    nav_links = navigation_markup(content); footer_links = navigation_markup(content, footer=True)
    overlay = f"linear-gradient(120deg,color-mix(in srgb,{primary} 88%,#04070c) 0%,color-mix(in srgb,{primary} 55%,#04070c) 55%,rgba(6,10,16,.55) 100%)"
    hero_style = f"background-image:{overlay},url({hero})" if hero else f"background:linear-gradient(120deg,{primary},color-mix(in srgb,{primary} 60%,#04070c))"
    heritage = f'<section class="heritage"><div class="eyebrow">The convention</div><h2>{e(content.get("heritage_message", ""))}</h2></section>' if content.get("heritage_message") else ""
    return f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{name}</title><meta name="description" content="{e(content.get("summary", ""), quote=True)[:180]}"><style>
 :root{{--green:{primary};--rust:{accent};--cream:#f8f4ec;--paper:#fffdf9;--ink:#153b35;--muted:#62716c;--line:#e3dbce;--container:1240px;--radius:18px;--shadow:0 18px 50px rgba(43,52,42,.08)}}*{{box-sizing:border-box}}html{{scroll-behavior:smooth}}body{{margin:0;background:var(--cream);color:var(--ink);font:15px/1.55 Inter,Arial,sans-serif}}a{{color:inherit}}.site-container{{width:min(var(--container),calc(100% - 48px));margin-inline:auto}}.preview{{background:#25143c;color:#fff;text-align:center;padding:9px;font-weight:800}}nav{{min-height:74px;background:#fff;border-bottom:1px solid var(--line);position:sticky;top:0;z-index:10}}.nav-inner{{min-height:74px;display:flex;align-items:center;gap:26px}}.brand{{display:flex;align-items:center;gap:10px;margin-right:auto}}.brand img{{height:48px;max-width:260px;object-fit:contain}}.mark{{font-size:38px;color:#9b733f}}.brand b{{font:700 20px Georgia}}.brand small{{display:block;font-size:7px;letter-spacing:.2em}}.nav-links,.footer-links{{display:flex;align-items:center;gap:18px;flex-wrap:wrap}}.nav-links a,footer a{{font-size:12px;text-decoration:none}}.nav-cta,.button{{background:var(--rust);color:#fff;padding:11px 20px;border-radius:999px;font-weight:800;text-decoration:none;display:inline-block;border:0;font-size:14px;cursor:pointer}}.hero{{min-height:590px;padding:88px 0;background-size:cover;background-position:center;color:#fff;display:flex;align-items:center}}.hero-inner{{max-width:690px}}.eyebrow{{font-size:11px;letter-spacing:.2em;font-weight:900;text-transform:uppercase;color:var(--rust)}}.hero .eyebrow{{color:#f0c987}}h1{{font:700 clamp(3rem,5.4vw,5.3rem)/.98 Georgia;letter-spacing:-.035em;margin:14px 0}}h2{{font:700 clamp(2rem,3.6vw,3.7rem)/1.04 Georgia;margin:10px 0 16px}}h3{{margin:.35rem 0}}.lead{{max-width:650px;font-size:18px;opacity:.94}}.meta,.actions{{display:flex;gap:20px;flex-wrap:wrap;font-weight:800;margin:22px 0}}.meta small{{display:block;font-size:11px;font-weight:700;opacity:.85}}.countdown-chip{{display:inline-flex;align-items:center;font-size:12px;font-weight:800;padding:5px 12px;border-radius:999px;background:var(--rust);color:#fff}}.venue-link,.venue-heading-link{{text-decoration:underline;color:inherit}}.venue-heading-link p{{text-decoration:none}}.button.outline{{background:transparent;color:#fff;border:1px solid rgba(255,255,255,.7)}}.hero-stats{{display:grid;grid-template-columns:repeat(4,1fr);background:var(--paper);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);margin-top:-42px;position:relative;z-index:2}}.hero-stats .stat{{padding:24px;border-right:1px solid var(--line)}}.hero-stats .stat:last-child{{border-right:0}}.stat strong{{font:700 27px Georgia;color:var(--rust)}}.stat b,.stat small,.track b,.track small{{display:block}}.stat small{{color:var(--muted);font-size:12px}}main{{padding:34px 0 90px}}main>section{{width:min(var(--container),calc(100% - 48px));margin:28px auto;padding:72px;border-radius:var(--radius);background:var(--paper);border:1px solid var(--line)}}.section-head{{max-width:760px;margin-bottom:32px}}.section-head p{{color:var(--muted);font-size:17px}}.heritage{{text-align:center;background:transparent;border:0;padding:68px 24px 52px}}.heritage h2{{max-width:780px;margin:10px auto;font-style:italic}}.registration,.venue,.contact{{display:grid;grid-template-columns:1fr 1.3fr;gap:48px;align-items:center;background:#f0eadf}}.facts{{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}}.fact{{background:#fff;padding:16px;border-radius:12px;border:1px solid var(--line)}}.fact small,.fact b{{display:block}}.fact small{{color:#7b746d;text-transform:uppercase;font-size:9px;font-weight:900;letter-spacing:.1em}}.programme{{background:#fff}}.filter-radio{{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}}.schedule-filters{{display:flex;flex-direction:column;gap:12px;margin-bottom:32px}}.day-tabs,.track-pills{{display:flex;gap:8px;flex-wrap:wrap}}.day-tab{{display:inline-block;border:1px solid var(--line);background:#fff;color:var(--ink);padding:11px 18px;border-radius:12px;font-weight:800;font-size:13px;cursor:pointer}}.day-tab small{{display:block;font-weight:600;font-size:10px;opacity:.75}}.track-pill{{display:inline-block;border:1px solid var(--line);background:#fff;color:var(--ink);padding:8px 14px;border-radius:999px;font-weight:700;font-size:12px;cursor:pointer}}.sessions{{display:grid}}.session{{position:relative;display:grid;grid-template-columns:112px 1fr;gap:28px;padding:22px 0;border-bottom:1px solid var(--line);border-radius:0}}.session:last-child{{border-bottom:0}}.session-time{{position:relative;text-align:right;padding-right:25px;font-weight:900;color:var(--rust)}}.session-time:after{{content:'';position:absolute;right:-7px;top:7px;width:11px;height:11px;border-radius:50%;background:var(--rust);border:3px solid #fff;box-shadow:0 0 0 1px var(--rust)}}.session-time:before{{content:'';position:absolute;right:-2px;top:18px;bottom:-30px;width:1px;background:var(--line)}}.session:last-child .session-time:before{{display:none}}.session:has(.session-thumb){{grid-template-columns:112px 96px 1fr}}.session-thumb{{width:96px;height:96px;object-fit:cover;border-radius:12px}}.session-body{{min-width:0}}.session-tag{{display:inline-block;background:color-mix(in srgb,var(--track-color,#6b746f) 12%,#fff);color:var(--track-color,#6b746f);font-size:10px;font-weight:900;padding:4px 10px;border-radius:999px;margin-bottom:5px}}.session-meta{{display:flex;gap:16px;flex-wrap:wrap;margin-top:7px;color:var(--muted);font-size:13px}}.session-meta span{{display:inline-flex;align-items:center;gap:5px}}.speaker-line{{display:block;color:var(--muted);margin-top:5px}}.session h3{{font-size:21px;margin:2px 0}}.session-action{{font-weight:800;color:var(--rust);display:inline-block;margin-top:10px}}.tracks{{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}}.track{{padding:22px;border-radius:14px;background:color-mix(in srgb,var(--track-color) 10%,#fff);border:1px solid color-mix(in srgb,var(--track-color) 22%,#fff)}}.track img,.track i{{width:48px;height:48px;object-fit:cover;border-radius:10px;display:grid;place-items:center;font-style:normal;font-size:22px;background:var(--track-color);color:#fff}}.track-jump{{display:inline-block;margin-top:10px;font-weight:800;font-size:12.5px;color:var(--track-color);text-decoration:none}}.speaker-grid{{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}}.speaker-card{{display:flex;gap:16px;padding:20px;border:1px solid var(--line);border-radius:14px;background:#fff}}.speaker-card img,.speaker-initial{{width:82px;height:96px;object-fit:cover;border-radius:9px;flex:0 0 auto}}.speaker-initial{{display:grid;place-items:center;background:var(--green);color:#fff;font:700 34px Georgia}}.speaker-card p,.speaker-card small{{color:var(--muted)}}.speakers-pending-lede{{font-size:17px;color:var(--muted);max-width:520px}}.speaker-pending-grid{{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:22px}}.speaker-pending-tile{{padding:26px 18px;border-radius:14px;border:1px dashed var(--line);background:#fbf8f1;text-align:center}}.speaker-pending-tile i{{display:block;font-style:normal;font-size:22px;color:var(--rust);margin-bottom:10px}}.speaker-pending-tile b{{font-size:13.5px}}.exhibitor-grid{{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}}.exhibitor-card{{padding:22px;border-radius:14px;border:1px solid var(--line);background:#fff;display:flex;flex-direction:column;gap:8px}}.exhibitor-mark{{width:42px;height:42px;border-radius:10px;background:var(--cream);display:grid;place-items:center;font-weight:800;font-size:14px;color:var(--green)}}.exhibitor-card img{{width:42px;height:42px;object-fit:contain;border-radius:10px}}.exhibitor-card b{{font-size:14.5px}}.exhibitor-card small{{color:var(--muted);text-transform:none;font-size:12px;font-weight:700}}.exhibitor-card p{{font-size:13px;color:var(--muted);margin:0}}.feature{{display:grid;grid-template-columns:1fr 1fr;padding:0!important;overflow:hidden}}.feature.reverse .feature-media{{order:2}}.feature-media{{min-height:430px}}.feature-media img{{width:100%;height:100%;object-fit:cover}}.feature-tiles{{width:100%;height:100%;display:grid;grid-template-columns:repeat(2,1fr);gap:1px;background:var(--line)}}.feature-tile{{background:var(--paper);padding:22px;display:flex;flex-direction:column;justify-content:center;gap:8px}}.feature-tile i{{font-style:normal;font-size:18px;color:var(--rust)}}.feature-tile b{{font-size:15px}}.feature-tile small{{color:var(--muted);font-size:12px}}.feature-copy{{padding:64px}}.feature-copy>p{{font-size:17px;color:var(--muted)}}.feature .facts{{margin:22px 0}}.venue{{background:#e9f0eb}}.connect{{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:18px;background:var(--green);color:#fff}}.connect .eyebrow{{color:#e7bc80}}.connect>div:not(:first-child){{padding:24px;border:1px solid #ffffff44;border-radius:14px}}.connect p{{color:#d4e0dc}}.connect-card{{display:inline-block;margin-top:8px;font-weight:900}}details{{max-width:900px;border-top:1px solid var(--line);padding:18px 0}}summary{{cursor:pointer;font-weight:900;font-size:17px}}details p{{color:var(--muted)}}.contact{{background:#f0eadf}}footer{{background:#fff;border-top:1px solid var(--line)}}.footer-inner{{display:flex;align-items:center;gap:35px;padding-block:28px}}footer .brand{{margin-right:auto}}@media(max-width:900px){{.nav-links{{display:none}}.hero{{min-height:auto}}.registration,.venue,.feature,.contact{{grid-template-columns:1fr}}.feature.reverse .feature-media{{order:0}}.connect{{grid-template-columns:1fr}}.tracks,.speaker-grid,.exhibitor-grid,.speaker-pending-grid{{grid-template-columns:1fr 1fr}}main>section{{padding:48px}}.hero-stats{{grid-template-columns:1fr 1fr}}.hero-stats .stat:nth-child(2){{border-right:0}}.hero-stats .stat:nth-child(-n+2){{border-bottom:1px solid var(--line)}}}}@media(max-width:560px){{.site-container,main>section{{width:min(100% - 28px,var(--container))}}.nav-inner{{min-height:64px}}nav>span{{display:none}}main{{padding-top:18px}}main>section{{padding:34px 22px;margin:16px auto}}.hero{{padding:64px 0 78px}}h1{{font-size:2.9rem}}.facts,.tracks,.speaker-grid,.exhibitor-grid,.speaker-pending-grid,.feature-tiles{{grid-template-columns:1fr}}.session,.session:has(.session-thumb){{grid-template-columns:72px 1fr;gap:16px}}.session-thumb{{display:none}}.session-time{{padding-right:14px;font-size:12px}}.footer-inner{{display:block}}.footer-links{{margin-top:18px}}.hero-stats .stat{{padding:18px}}}}</style></head><body>{preview_bar}<nav><div class="site-container nav-inner"><div class="brand">{brand}</div><div class="nav-links">{nav_links}</div>{action(content.get("primary_action"), "nav-cta")}<a href="https://festio.events" target="_blank" rel="noopener" style="text-decoration:none;color:inherit">Powered by <b>Festio</b></a></div></nav>
<header class="hero" style="{hero_style}"><div class="site-container hero-inner"><div><div class="eyebrow">{e(content.get("eyebrow", "MULTI-DAY EVENT"))}</div><h1>{e(content.get("headline", name))}</h1><p class="lead">{e(content.get("summary", ""))}</p><div class="meta"><span>▣ {date_meta}</span>{venue_meta}{countdown_markup(content)}</div><div class="actions">{action(content.get("primary_action"))}<a class="button outline" href="#programme">Explore Programme</a></div></div></div></header>
<div class="site-container">{hero_stats}</div><main>{heritage}{programme}{audience}{speakers_section}{exhibitors_section}{features}{venue}{connect}{faq_section}{registration}{contact}</main><footer><div class="site-container footer-inner"><div class="brand">{brand}</div><div class="footer-links">{footer_links}</div></div></footer></body></html>'''
