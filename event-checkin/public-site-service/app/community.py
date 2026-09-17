from collections import OrderedDict
from html import escape
from urllib.parse import urlparse


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


def track_markup(track):
    image_url = safe_url(track.get("image_url"))
    visual = f'<img src="{image_url}" alt="" loading="lazy">' if image_url else f'<i>{escape(track.get("icon", "✦"))}</i>'
    return f'<article class="track">{visual}<div><b>{escape(track.get("title", ""))}</b><small>{escape(track.get("description", ""))}</small></div></article>'


def schedule_markup(content):
    sessions = content.get("sessions") or []
    if not sessions:
        return '<p class="empty-copy">The full programme will be published here.</p>'
    groups = OrderedDict()
    for session in sessions:
        day = session.get("day") or session.get("date") or "Programme"
        groups.setdefault(day, []).append(session)
    day_links = "".join(f'<a href="#day-{index + 1}">{escape(day)}</a>' for index, day in enumerate(groups))
    day_groups = []
    for index, (day, rows) in enumerate(groups.items()):
        cards = []
        for row in rows:
            meta = " · ".join(filter(None, (row.get("venue", ""), row.get("audience", ""))))
            speaker = f'<span class="speaker-line">With {escape(row.get("speaker"))}</span>' if row.get("speaker") else ""
            description = f'<p>{escape(row.get("description"))}</p>' if row.get("description") else ""
            cta = action({"label": row.get("action_label") or "Add to my schedule", "url": row.get("action_url")}, "session-action") if row.get("action_url") else ""
            cards.append(f'<article class="session"><time>{escape(row.get("time", ""))}</time><div><small>{escape(row.get("track") or row.get("audience", ""))}</small><h3>{escape(row.get("title", ""))}</h3>{description}<span>{escape(meta)}</span>{speaker}{cta}</div></article>')
        day_groups.append(f'<section class="schedule-day" id="day-{index + 1}"><h3>{escape(day)}<small>{escape(rows[0].get("date", ""))}</small></h3><div class="sessions">{"".join(cards)}</div></section>')
    return f'<nav class="day-links" aria-label="Programme days">{day_links}</nav>{"".join(day_groups)}'


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
    image = f'<img src="{hero}" alt="" loading="eager">' if hero else '<div class="placeholder">Add a feature image</div>'
    stats = "".join(f'<div class="stat"><strong>{e(x.get("value", ""))}</strong><div><b>{e(x.get("label", ""))}</b><small>{e(x.get("detail", ""))}</small></div></div>' for x in content.get("stats", [])[:6])
    tracks = "".join(track_markup(x) for x in content.get("tracks", [])[:12])
    glance = f'<section class="glance"><div class="section-head"><div class="eyebrow">At a glance</div><h2>Know before you arrive</h2></div><div class="stats">{stats}</div></section>' if "stats" in visible and stats else ""
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
    return f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{name}</title><meta name="description" content="{e(content.get("summary", ""), quote=True)[:180]}"><style>
:root{{--green:{primary};--rust:{accent};--cream:#faf7f0;--ink:#0d332e}}*{{box-sizing:border-box}}html{{scroll-behavior:smooth}}body{{margin:0;background:var(--cream);color:var(--ink);font:15px/1.5 Inter,Arial,sans-serif}}a{{color:inherit}}.preview{{background:#25143c;color:#fff;text-align:center;padding:9px;font-weight:800}}nav{{min-height:74px;display:flex;align-items:center;padding:12px 4.5vw;background:#fff;gap:26px;border-bottom:1px solid #eee8dc;position:sticky;top:0;z-index:10}}.brand{{display:flex;align-items:center;gap:10px;margin-right:auto}}.brand img{{height:48px;max-width:260px;object-fit:contain}}.mark{{font-size:38px;color:#9b733f}}.brand b{{font:700 20px Georgia}}.brand small{{display:block;font-size:7px;letter-spacing:.2em}}.nav-links,.footer-links{{display:flex;align-items:center;gap:18px;flex-wrap:wrap}}.nav-links a,footer a{{font-size:12px;text-decoration:none}}.nav-cta,.button{{background:var(--rust);color:#fff;padding:11px 20px;border-radius:24px;font-weight:800;text-decoration:none;display:inline-block}}.hero{{display:grid;grid-template-columns:52% 48%;min-height:560px;background:#fff}}.hero-copy{{padding:5vw 4.5vw 4vw}}.eyebrow{{font-size:11px;letter-spacing:.2em;font-weight:900;text-transform:uppercase;color:var(--rust)}}h1{{font:700 clamp(3rem,5vw,5.4rem)/.9 Georgia;letter-spacing:-.045em;margin:18px 0}}h2{{font:700 clamp(2rem,4vw,3.4rem)/1 Georgia;margin:10px 0 16px}}h3{{margin:.35rem 0}}.lead{{max-width:600px;font-size:17px;color:#4c5b57}}.meta,.actions{{display:flex;gap:20px;flex-wrap:wrap;font-weight:800;margin:22px 0}}.venue-link{{text-decoration:underline}}.button.outline{{background:#fff;color:var(--ink);border:1px solid var(--ink)}}.hero-art{{position:relative;overflow:hidden;background:var(--green)}}.hero-art>img{{width:100%;height:100%;object-fit:cover}}.heritage{{position:absolute;left:24px;top:70px;width:190px;padding:20px;background:#faf7f0e8;font:italic 22px/1.15 Georgia}}.placeholder,.feature-pattern{{height:100%;display:grid;place-items:center;color:#fff;font-size:4rem;background:var(--green)}}main>section{{padding:72px 4.5vw}}.section-head{{max-width:760px;margin-bottom:28px}}.section-head p{{color:#61706b}}.glance{{background:#fff}}.stats{{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}}.stat{{display:flex;gap:15px;padding:20px;background:#faf8f3;border-radius:10px}}.stat>strong{{font-size:25px;color:var(--rust)}}.stat b,.stat small,.track b,.track small{{display:block}}.stat small{{color:#6c7773}}.registration,.venue,.contact{{display:grid;grid-template-columns:1fr 1.3fr;gap:40px;align-items:center;background:#f0eadf}}.facts{{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}}.fact{{background:#fff;padding:15px;border-radius:10px}}.fact small,.fact b{{display:block}}.fact small{{color:#7b746d;text-transform:uppercase;font-size:9px;font-weight:900;letter-spacing:.1em}}.programme{{background:#fff}}.day-links{{position:static;display:flex;gap:8px;flex-wrap:wrap;padding:0;margin:0 0 28px;background:transparent;border:0}}.day-links a{{border:1px solid #d9d1c5;background:#fff;padding:10px 14px;border-radius:24px;font-weight:800;text-decoration:none}}.schedule-day{{scroll-margin-top:90px;margin:34px 0}}.schedule-day>h3{{font:700 26px Georgia;border-bottom:2px solid var(--rust);padding-bottom:10px}}.schedule-day>h3 small{{display:block;font:600 11px Inter;margin-top:5px;color:#6b746f}}.sessions{{display:grid;gap:10px}}.session{{display:grid;grid-template-columns:120px 1fr;gap:22px;padding:22px;border:1px solid #e5ded3;border-radius:12px}}.session time{{font-weight:900;color:var(--rust)}}.session small,.session span,.speaker-line{{display:block;color:#65706c}}.session h3{{font-size:20px}}.session-action{{font-weight:800;color:var(--rust);display:inline-block;margin-top:10px}}.tracks{{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}}.track{{display:flex;gap:14px;padding:18px;background:#edf3e9;border-radius:10px}}.track img,.track i{{width:54px;height:54px;object-fit:cover;border-radius:10px;display:grid;place-items:center;font-style:normal;font-size:25px}}.speakers{{background:#fff}}.speaker-grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:14px}}.speaker-card{{display:flex;gap:16px;padding:18px;border:1px solid #e5ded3;border-radius:12px}}.speaker-card img,.speaker-initial{{width:82px;height:96px;object-fit:cover;border-radius:9px;flex:0 0 auto}}.speaker-initial{{display:grid;place-items:center;background:var(--green);color:#fff;font:700 34px Georgia}}.speaker-card p,.speaker-card small{{color:#65706c}}.feature{{display:grid;grid-template-columns:1fr 1fr;gap:0;padding:0!important;background:#fff}}.feature.reverse .feature-media{{order:2}}.feature-media{{min-height:430px}}.feature-media img{{width:100%;height:100%;object-fit:cover}}.feature-copy{{padding:64px 6vw}}.feature-copy>p{{font-size:17px;color:#5f6d68}}.feature .facts{{margin:22px 0}}.venue{{background:#e9f0eb}}.connect{{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:18px;background:var(--green);color:#fff}}.connect .eyebrow{{color:#e7bc80}}.connect>div:not(:first-child){{padding:20px;border:1px solid #ffffff44;border-radius:14px}}.connect p{{color:#d4e0dc}}.connect-card{{display:inline-block;margin-top:8px;font-weight:900}}.faq{{background:#fff}}details{{max-width:900px;border-top:1px solid #ddd5c9;padding:18px 0}}summary{{cursor:pointer;font-weight:900;font-size:17px}}details p{{color:#5f6d68}}.contact{{background:#f0eadf}}footer{{display:flex;align-items:center;gap:35px;padding:25px 4.5vw;background:#fff}}footer .brand{{margin-right:auto}}@media(max-width:900px){{.nav-links{{display:none}}.hero,.registration,.venue,.feature,.contact{{grid-template-columns:1fr}}.hero-art{{height:380px}}.feature.reverse .feature-media{{order:0}}.connect{{grid-template-columns:1fr}}}}@media(max-width:560px){{nav{{padding:10px 18px}}nav>span{{display:none}}.hero-copy,main>section,.feature-copy{{padding:40px 20px}}h1{{font-size:3.2rem}}.facts{{grid-template-columns:1fr}}.session{{grid-template-columns:1fr;gap:4px}}.day-links{{display:flex}}footer{{display:block}}.footer-links{{margin-top:18px}}}}
</style></head><body>{preview_bar}<nav><div class="brand">{brand}</div><div class="nav-links">{nav_links}</div>{action(content.get("primary_action"), "nav-cta")}<span>Powered by <b>Festio</b></span></nav><header class="hero"><div class="hero-copy"><div class="eyebrow">{e(content.get("eyebrow", "MULTI-DAY EVENT"))}</div><h1>{e(content.get("headline", name))}</h1><p class="lead">{e(content.get("summary", ""))}</p><div class="meta"><span>▣ {e(content.get("start_date", ""))}{end}</span>{venue_meta}</div><div class="actions">{action(content.get("primary_action"))}{action(content.get("secondary_action"), "button outline")}</div></div><div class="hero-art">{image}<div class="heritage">{e(content.get("heritage_message", ""))}</div></div></header><main>{glance}{registration}{programme}{audience}{speakers_section}{features}{venue}{connect}{faq_section}{contact}</main><footer><div class="brand">{brand}</div><div class="footer-links">{footer_links}</div></footer></body></html>'''
