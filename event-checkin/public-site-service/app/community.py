from collections import OrderedDict
from html import escape
from urllib.parse import urlparse

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
        return escape(value, quote=True)
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
            f'<article class="session" data-day="{escape(day, quote=True)}" data-track="{escape(track, quote=True)}">{thumb}'
            f'<div class="session-body"><time>{escape(session.get("time", ""))}</time>{tag}<h3>{escape(session.get("title", ""))}</h3>'
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


def feature_markup(section, index):
    if not section.get("enabled", True):
        return ""
    image = safe_url(section.get("image_url"))
    media = f'<img src="{image}" alt="" loading="lazy">' if image else '<div class="feature-pattern">✦</div>'
    section_id = escape(section.get("id") or f"feature-{index}", quote=True)
    return f'''<section class="feature {"reverse" if index % 2 else ""}" id="{section_id}"><div class="feature-media">{media}</div><div class="feature-copy"><div class="eyebrow">{escape(section.get("kicker", "Featured programme"))}</div><h2>{escape(section.get("title", ""))}</h2><p>{escape(section.get("summary", ""))}</p><div class="facts">{facts_markup(section.get("facts"))}</div>{action(section.get("action"), "button")}</div></section>'''


def render(content, preview=False):
    e = escape
    name = e(content.get("event_name", "Event")); primary = e(content.get("primary_color", "#0d5c55")); accent = e(content.get("accent_color", "#a64f2b"))
    hero = safe_url(content.get("feature_image_url") or content.get("hero_image_url")); logo = safe_url(content.get("logo_url")); visible = set(content.get("visible_sections") or ["stats", "programme", "tracks", "connect"])
    tagline = e(content.get("brand_tagline") or "PEOPLE · PURPOSE · A STRONGER TOMORROW")
    brand = f'<img src="{logo}" alt="{name}">' if logo else f'<span class="mark">✤</span><div><b>{name}</b><small>{tagline}</small></div>'
    stats_html = "".join(f'<div class="stat"><strong>{e(x.get("value", ""))}</strong><div><b>{e(x.get("label", ""))}</b><small>{e(x.get("detail", ""))}</small></div></div>' for x in content.get("stats", [])[:6])
    hero_stats = f'<div class="hero-stats">{stats_html}</div>' if "stats" in visible and stats_html else ""
    colors = track_colors(content)
    tracks = "".join(track_markup(x, i, colors) for i, x in enumerate(content.get("tracks", [])[:12]))
    registration = f'<section class="registration" id="registration"><div><div class="eyebrow">Registration</div><h2>Register with confidence</h2><p>Everything guests need to know before completing registration.</p>{action(content.get("primary_action"))}</div><div class="facts">{facts_markup(content.get("registration_facts"))}</div></section>' if content.get("registration_facts") else ""
    programme = f'<section class="programme" id="programme"><div class="section-head"><div class="eyebrow">Programme</div><h2>{e(content.get("programme_title") or "Full programme")}</h2><p>{e(content.get("programme_summary") or "")}</p></div>{schedule_markup(content)}</section>' if "programme" in visible else ""
    audience = f'<section class="audiences" id="tracks"><div class="section-head"><div class="eyebrow">Programme tracks</div><h2>Choose your experience</h2><p>Select the programme that fits your interests and stage of life.</p></div><div class="tracks">{tracks}</div></section>' if "tracks" in visible and tracks else ""
    speakers = speakers_markup(content.get("speakers")); speakers_section = f'<section class="speakers" id="speakers"><div class="section-head"><div class="eyebrow">Presenters</div><h2>Featured speakers</h2></div><div class="speaker-grid">{speakers}</div></section>' if speakers else ""
    features = "".join(feature_markup(section, index) for index, section in enumerate(content.get("feature_sections") or []))
    venue_url = safe_url(content.get("venue_url")); venue_name = e(content.get("venue", "")); venue_address = e(content.get("venue_address", ""))
    venue_action = f'<a class="button" href="{venue_url}" target="_blank" rel="noopener">Open directions</a>' if venue_url else ""
    venue = f'<section class="venue" id="venue"><div><div class="eyebrow">Venue & travel</div><h2>{venue_name or "Plan your arrival"}</h2><p>{venue_address}</p>{venue_action}</div><div class="facts">{facts_markup(content.get("venue_facts"))}</div></section>' if venue_name or venue_address or content.get("venue_facts") else ""
    live = action({"label": "Open Festio Live ›", "url": content.get("festio_live_url")}, "connect-card") if content.get("festio_live_url") else ""
    me = action({"label": "Open FestioMe ›", "url": content.get("festiome_url")}, "connect-card") if content.get("festiome_url") else ""
    live_title = e(content.get("festio_live_title") or "Festio Live")
    live_description = e(content.get("festio_live_description") or "Participate in live Q&A, polls and activities.")
    me_title = e(content.get("festiome_title") or "FestioMe")
    me_description = e(content.get("festiome_description") or "Your personal event hub, pass and programme.")
    live_panel = f'<div><h3>{live_title}</h3><p>{live_description}</p>{live}</div>' if live else ""
    me_panel = f'<div><h3>{me_title}</h3><p>{me_description}</p>{me}</div>' if me else ""
    connect = f'<section class="connect" id="connect"><div><div class="eyebrow">Your Festio experience</div><h2>One event, connected</h2></div>{live_panel}{me_panel}</section>' if "connect" in visible and (live or me) else ""
    faqs = "".join(f'<details><summary>{e(item.get("question", ""))}</summary><p>{e(item.get("answer", ""))}</p></details>' for item in content.get("faqs") or [])
    faq_section = f'<section class="faq" id="faq"><div class="section-head"><div class="eyebrow">Helpful details</div><h2>Frequently asked questions</h2></div>{faqs}</section>' if faqs else ""
    contact = f'<section class="contact" id="contact"><div><div class="eyebrow">Still have a question?</div><h2>Contact the event team</h2></div><a class="button" href="mailto:{e(content.get("contact_email"), quote=True)}">Email us</a></section>' if content.get("contact_email") else ""
    preview_bar = '<div class="preview">Preview — visitors cannot see this draft</div>' if preview else ""
    end = (" – " + e(content.get("end_date", ""))) if content.get("end_date") else ""
    venue_meta = f'<a class="venue-link" href="{venue_url}" target="_blank" rel="noopener">● {venue_name}</a>' if venue_url else f'<span>● {venue_name}</span>'
    nav_links = navigation_markup(content); footer_links = navigation_markup(content, footer=True)
    overlay = f"linear-gradient(120deg,color-mix(in srgb,{primary} 88%,#04070c) 0%,color-mix(in srgb,{primary} 55%,#04070c) 55%,rgba(6,10,16,.55) 100%)"
    hero_style = f"background-image:{overlay},url({hero})" if hero else f"background:linear-gradient(120deg,{primary},color-mix(in srgb,{primary} 60%,#04070c))"
    heritage = f'<p class="heritage-line">{e(content.get("heritage_message", ""))}</p>' if content.get("heritage_message") else ""
    return f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{name}</title><meta name="description" content="{e(content.get("summary", ""), quote=True)[:180]}"><style>
:root{{--green:{primary};--rust:{accent};--cream:#faf7f0;--ink:#0d332e}}*{{box-sizing:border-box}}html{{scroll-behavior:smooth}}body{{margin:0;background:var(--cream);color:var(--ink);font:15px/1.5 Inter,Arial,sans-serif}}a{{color:inherit}}.preview{{background:#25143c;color:#fff;text-align:center;padding:9px;font-weight:800}}nav{{min-height:74px;display:flex;align-items:center;padding:12px 4.5vw;background:#fff;gap:26px;border-bottom:1px solid #eee8dc;position:sticky;top:0;z-index:10}}.brand{{display:flex;align-items:center;gap:10px;margin-right:auto}}.brand img{{height:48px;max-width:260px;object-fit:contain}}.mark{{font-size:38px;color:#9b733f}}.brand b{{font:700 20px Georgia}}.brand small{{display:block;font-size:7px;letter-spacing:.2em}}.nav-links,.footer-links{{display:flex;align-items:center;gap:18px;flex-wrap:wrap}}.nav-links a,footer a{{font-size:12px;text-decoration:none}}.nav-cta,.button{{background:var(--rust);color:#fff;padding:11px 20px;border-radius:24px;font-weight:800;text-decoration:none;display:inline-block;border:0;font-size:14px;cursor:pointer}}
.hero{{padding:6vw 4.5vw;background-size:cover;background-position:center;color:#fff}}.hero-inner{{display:grid;grid-template-columns:1.15fr 1fr;gap:5vw;align-items:center;max-width:1320px;margin:auto}}.eyebrow{{font-size:11px;letter-spacing:.2em;font-weight:900;text-transform:uppercase;color:var(--rust)}}.hero .eyebrow{{color:#f0c987}}h1{{font:700 clamp(2.6rem,4.6vw,4.6rem)/1.02 Georgia;letter-spacing:-.02em;margin:14px 0}}h2{{font:700 clamp(2rem,4vw,3.4rem)/1 Georgia;margin:10px 0 16px}}h3{{margin:.35rem 0}}.lead{{max-width:600px;font-size:17px;opacity:.92}}.heritage-line{{max-width:520px;font:italic 16px Georgia;opacity:.85;border-left:2px solid rgba(255,255,255,.5);padding-left:14px;margin:18px 0}}.meta,.actions{{display:flex;gap:20px;flex-wrap:wrap;font-weight:800;margin:22px 0}}.venue-link{{text-decoration:underline;color:inherit}}.button.outline{{background:transparent;color:#fff;border:1px solid rgba(255,255,255,.7)}}.hero-stats{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;background:rgba(255,255,255,.08);backdrop-filter:blur(6px);border-radius:16px;padding:20px}}.hero-stats .stat{{background:transparent;padding:0;gap:10px}}.hero-stats strong{{color:#f0c987}}.hero-stats small{{color:#d8e0ea}}
main>section{{padding:72px 4.5vw}}.section-head{{max-width:760px;margin-bottom:28px}}.section-head p{{color:#61706b}}.stats{{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}}.stat{{display:flex;gap:15px;padding:20px;background:#faf8f3;border-radius:10px}}.stat>strong{{font-size:25px;color:var(--rust)}}.stat b,.stat small,.track b,.track small{{display:block}}.stat small{{color:#6c7773}}.registration,.venue,.contact{{display:grid;grid-template-columns:1fr 1.3fr;gap:40px;align-items:center;background:#f0eadf}}.facts{{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}}.fact{{background:#fff;padding:15px;border-radius:10px}}.fact small,.fact b{{display:block}}.fact small{{color:#7b746d;text-transform:uppercase;font-size:9px;font-weight:900;letter-spacing:.1em}}.programme{{background:#fff}}
.filter-radio{{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}}.schedule-filters{{display:flex;flex-direction:column;gap:10px;margin-bottom:24px}}.day-tabs,.track-pills{{display:flex;gap:8px;flex-wrap:wrap}}.day-tab{{display:inline-block;border:1px solid #d9d1c5;background:#fff;color:var(--ink);padding:10px 16px;border-radius:10px;font-weight:800;font-size:13px;cursor:pointer}}.day-tab small{{display:block;font-weight:600;font-size:10px;opacity:.75}}.track-pill{{display:inline-block;border:1px solid #d9d1c5;background:#fff;color:var(--ink);padding:8px 14px;border-radius:999px;font-weight:700;font-size:12px;cursor:pointer}}
.sessions{{display:grid;gap:12px}}.session{{display:grid;grid-template-columns:120px 1fr;gap:20px;padding:18px;border:1px solid #e5ded3;border-radius:12px}}.session:has(.session-thumb){{grid-template-columns:96px 1fr}}.session-thumb{{width:96px;height:96px;object-fit:cover;border-radius:10px}}.session time{{font-weight:900;color:var(--rust);grid-column:1;display:block}}.session:not(:has(.session-thumb)) time{{grid-column:auto}}.session-body{{min-width:0}}.session-tag{{display:inline-block;background:var(--track-color,#6b746f);color:#fff;font-size:10px;font-weight:800;padding:3px 9px;border-radius:999px;margin:4px 0}}.session-meta{{display:flex;gap:14px;flex-wrap:wrap;margin-top:6px;color:#65706c;font-size:12.5px}}.session-meta span{{display:inline-flex;align-items:center;gap:5px}}.speaker-line{{display:block;color:#65706c;margin-top:4px}}.session h3{{font-size:19px;margin:2px 0}}.session-action{{font-weight:800;color:var(--rust);display:inline-block;margin-top:10px}}.show-more{{margin-top:16px;border:1px solid #d9d1c5;background:#fff;padding:10px 18px;border-radius:10px;font-weight:800;font-family:inherit;cursor:pointer}}
.tracks{{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}}.track{{padding:20px;border-radius:12px;background:color-mix(in srgb,var(--track-color) 12%,#fff)}}.track img,.track i{{width:48px;height:48px;object-fit:cover;border-radius:10px;display:grid;place-items:center;font-style:normal;font-size:22px;background:var(--track-color);color:#fff}}.track-jump{{display:inline-block;margin-top:10px;font-weight:800;font-size:12.5px;color:var(--track-color);text-decoration:none}}
.speakers{{background:#fff}}.speaker-grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:14px}}.speaker-card{{display:flex;gap:16px;padding:18px;border:1px solid #e5ded3;border-radius:12px}}.speaker-card img,.speaker-initial{{width:82px;height:96px;object-fit:cover;border-radius:9px;flex:0 0 auto}}.speaker-initial{{display:grid;place-items:center;background:var(--green);color:#fff;font:700 34px Georgia}}.speaker-card p,.speaker-card small{{color:#65706c}}.feature{{display:grid;grid-template-columns:1fr 1fr;gap:0;padding:0!important;background:#fff}}.feature.reverse .feature-media{{order:2}}.feature-media{{min-height:430px}}.feature-media img{{width:100%;height:100%;object-fit:cover}}.feature-copy{{padding:64px 6vw}}.feature-copy>p{{font-size:17px;color:#5f6d68}}.feature .facts{{margin:22px 0}}.venue{{background:#e9f0eb}}.connect{{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:18px;background:var(--green);color:#fff}}.connect .eyebrow{{color:#e7bc80}}.connect>div:not(:first-child){{padding:20px;border:1px solid #ffffff44;border-radius:14px}}.connect p{{color:#d4e0dc}}.connect-card{{display:inline-block;margin-top:8px;font-weight:900}}.faq{{background:#fff}}details{{max-width:900px;border-top:1px solid #ddd5c9;padding:18px 0}}summary{{cursor:pointer;font-weight:900;font-size:17px}}details p{{color:#5f6d68}}.contact{{background:#f0eadf}}footer{{display:flex;align-items:center;gap:35px;padding:25px 4.5vw;background:#fff}}footer .brand{{margin-right:auto}}
@media(max-width:900px){{.nav-links{{display:none}}.hero-inner,.registration,.venue,.feature,.contact{{grid-template-columns:1fr}}.feature.reverse .feature-media{{order:0}}.connect{{grid-template-columns:1fr}}}}
@media(max-width:560px){{nav{{padding:10px 18px}}nav>span{{display:none}}main>section{{padding:40px 20px}}.hero{{padding:12vw 20px}}h1{{font-size:2.6rem}}.facts{{grid-template-columns:1fr}}.session{{grid-template-columns:1fr;gap:4px}}footer{{display:block}}.footer-links{{margin-top:18px}}}}
</style></head><body>{preview_bar}<nav><div class="brand">{brand}</div><div class="nav-links">{nav_links}</div>{action(content.get("primary_action"), "nav-cta")}<span>Powered by <b>Festio</b></span></nav>
<header class="hero" style="{hero_style}"><div class="hero-inner"><div><div class="eyebrow">{e(content.get("eyebrow", "MULTI-DAY EVENT"))}</div><h1>{e(content.get("headline", name))}</h1><p class="lead">{e(content.get("summary", ""))}</p>{heritage}<div class="meta"><span>▣ {e(content.get("start_date", ""))}{end}</span>{venue_meta}</div><div class="actions">{action(content.get("primary_action"))}{action(content.get("secondary_action"), "button outline")}</div></div>{hero_stats}</div></header>
<main>{registration}{programme}{audience}{speakers_section}{features}{venue}{connect}{faq_section}{contact}</main><footer><div class="brand">{brand}</div><div class="footer-links">{footer_links}</div></footer></body></html>'''
