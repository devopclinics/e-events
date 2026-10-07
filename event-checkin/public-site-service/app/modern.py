"""The approved modern website collection, rendered from the event snapshot.

Only the fixed programme enhancement script executes. Event values are escaped
as text/attributes; without JavaScript every session and its details remain usable.
"""
from pathlib import Path
from html import escape as e
import base64
import hashlib
import json
import re
from .templates import MODERN_TEMPLATES
from .community import safe_url, safe_destination, navigation_markup, facts_markup, event_datetime, date_label

ROOT = Path(__file__).parent
CSS = (ROOT / "modern.css").read_text()
JS = (ROOT / "modern.js").read_text()
ART = json.loads((ROOT / "modern_art.json").read_text())
SCRIPT_HASH = base64.b64encode(hashlib.sha256(JS.encode()).digest()).decode()


def security_policy():
    return ("default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https:; "
            f"script-src 'sha256-{SCRIPT_HASH}'; connect-src 'none'; frame-ancestors 'none'; "
            "base-uri 'none'; form-action 'none'")


def color(value, fallback):
    return value if re.fullmatch(r"#[0-9a-fA-F]{6}", str(value or "")) else fallback


def contrast(value):
    rgb = [int(value[i:i+2], 16) / 255 for i in (1, 3, 5)]
    rgb = [v / 12.92 if v <= .04045 else ((v+.055)/1.055)**2.4 for v in rgb]
    lum = sum(a*b for a,b in zip(rgb, [.2126,.7152,.0722]))
    return "#102c24" if lum > .4 else "#ffffff"


def link(item, cls="btn"):
    url = safe_url((item or {}).get("url"))
    return f'<a class="{cls}" href="{url}">{e((item or {}).get("label") or "Learn more")} <span aria-hidden="true">↗</span></a>' if url else ""


def section_heading(title, subtitle="", eyebrow=""):
    return f'<div class="section-head"><div>{f"<div class=eyebrow>{e(eyebrow)}</div>" if eyebrow else ""}<h2>{e(title)}</h2></div>{f"<p>{e(subtitle)}</p>" if subtitle else ""}</div>'


def artwork(family, content):
    # Replace event-specific prototype labels with real facts or neutral ornament.
    start = event_datetime(content.get("start_date"), content.get("timezone") or "UTC")
    end = event_datetime(content.get("end_date"), content.get("timezone") or "UTC")
    year = str(start.year) if start else ""
    art = ART[family]
    art = art.replace('FAITH &nbsp; / &nbsp; FAMILY &nbsp; / &nbsp; FUTURE', 'DISCOVER &nbsp; / &nbsp; CONNECT &nbsp; / &nbsp; BELONG')
    art = art.replace('PLATFORM<br><b>26</b>', f'EVENT<br><b>{year[-2:] if year else "✦"}</b>')
    art = art.replace('>Faith<', '>Discover<').replace('>Family<', '>Connect<').replace('>Learning<', '>Explore<')
    art = art.replace('PLATFORM<br>2026', f'EVENT<br>{year}')
    art = art.replace('THE CONVENTION EDITION', 'YOUR EVENT')
    art = art.replace('24<br><i>—</i>28', f'{start.day}<br><i>—</i>{end.day if end else start.day}' if start else 'JOIN<br>US')
    art = art.replace('DECEMBER<br>INDIANAPOLIS · 2026', e(start.strftime('%B %Y').upper()) if start else 'WELCOME')
    art = art.replace('24—28 DECEMBER / INDIANAPOLIS', e(content.get('venue') or 'COME TOGETHER'))
    art = art.replace('>NCNMO<', '>TOGETHER<').replace('20<br>26<span>', f'{year[:2]}<br>{year[2:]}<span>' if year else '↗<span>')
    art = art.replace('FAITH. FAMILY.<br>LEARNING. COMMUNITY.', 'DISCOVER.<br>CONNECT. BELONG.')
    art = art.replace('24—28 <small>December 2026</small>', f'{start.day} <small>{e(start.strftime("%B %Y"))}</small>' if start else 'Welcome <small>Your event starts here</small>')
    return art


def programme(content):
    sessions = content.get("sessions") or []
    days = list(dict.fromkeys(s.get('date') or s.get('day') or 'Programme' for s in sessions))
    tracks = list(dict.fromkeys(s.get('track') for s in sessions if s.get('track')))
    audiences = list(dict.fromkeys(s.get('audience') for s in sessions if s.get('audience')))
    day_names = {key: next((s.get('day') for s in sessions if (s.get('date') or s.get('day') or 'Programme') == key and s.get('day')), date_label(key, content.get('timezone') or 'UTC')) for key in days}
    options = lambda pairs: ''.join(f'<option value="{e(str(k))}">{e(str(v))}</option>' for k,v in pairs)
    filters = (f'<div class="filters" data-programme-controls hidden><label>Day<select id="programme-day">{options([(str(i),day_names[d]) for i,d in enumerate(days)])}<option value="all">All days</option></select></label>'
               f'<label>Activity / track<select id="programme-track"><option value="">All activities</option>{options((t,t) for t in tracks)}</select></label>'
               f'<label>Audience<select id="programme-audience"><option value="">All audiences</option>{options((a,a) for a in audiences)}</select></label>'
               '<label class="programme-search">Search programme<input id="programme-search" type="search" placeholder="Session, room, speaker…"></label></div>') if sessions else ''
    palette = ['#b17d42','#6979b9','#409380','#a06c9c','#467c9a']
    track_colors = {t['title']: color(t.get('color'),palette[i%len(palette)]) for i,t in enumerate(content.get('tracks') or [])}
    cards = []
    for i,s in enumerate(sessions):
        day = s.get('date') or s.get('day') or 'Programme'
        track = s.get('track') or ''
        picture = safe_url(s.get('image_url'))
        image = f'<img class="session-image" src="{picture}" alt="" loading="lazy">' if picture else ''
        meta = ' · '.join(str(s[k]) for k in ('audience','venue') if s.get(k))
        speaker = f'<p class="session-speaker">With {e(s["speaker"])}</p>' if s.get('speaker') else ''
        description = f'<p class="session-description">{e(s["description"])}</p>' if s.get('description') else ''
        cta = link({'label':s.get('action_label') or 'Open activity','url':s.get('action_url')},'text-btn')
        details = f'<details class="session-details"><summary>Explore session <span aria-hidden="true">↗</span></summary><div><p>{e(day_names[day])} · {e(s.get("time") or "Time to be confirmed")}</p>{description}{speaker}{cta}</div></details>' if description or speaker or cta else ''
        cards.append(f'<article class="session" data-session data-day="{days.index(day)}" data-track="{e(track)}" data-audience="{e(s.get("audience") or "")}" style="--session-color:{track_colors.get(track,palette[i%len(palette)])}">{image}<div class="session-top"><time>{e(s.get("time") or "Time to be confirmed")}</time><span>{e(track)}</span></div><small class="session-day">{e(day_names[day])}</small><h3>{e(s.get("title") or "Session")}</h3>{f"<p class=session-audience>{e(meta)}</p>" if meta else ""}{details}</article>')
    demo = any(str(s.get('description') or '').lstrip().lower().startswith('demo draft:') for s in sessions)
    notice = '<div class="draft-note"><strong>Demo programme</strong><span>Not an approved timetable. Open session details for source notes, assumptions and information awaiting organizer confirmation.</span></div>' if demo else ''
    summary = content.get('programme_summary') or ''
    return '<section class="programme" id="programme">'+section_heading(content.get('programme_title') or 'Explore the programme',summary,'Your programme')+notice+filters+f'<p class="timezone">Times: {e(content.get("timezone") or "UTC")}</p><div class="sessions">'+(''.join(cards) or '<p class="empty">The programme will appear here when the organizer publishes it.</p>')+'</div><p id="programme-empty" class="empty" hidden>No sessions match. Try another day, audience or search.</p><div class="schedule-foot"><span id="programme-count" role="status"></span><button class="btn secondary" id="programme-more" hidden>Show more sessions</button></div></section>'


def render_modern(content, family, *, preview=False):
    t = MODERN_TEMPLATES[family]
    use_style = content.get('use_template_style', True) and not content.get('use_event_branding')
    primary = t['color'] if use_style else color(content.get('primary_color'),t['color'])
    accent = t['accent'] if use_style else color(content.get('accent_color'),t['accent'])
    dark = family in ('orbit','horizon','assembly')
    surface = {'orbit':'#11192a','horizon':'#183b38','assembly':'#202820'}.get(family,'#ffffff')
    colors = f"--bg:{t['bg']};--ink:{t['ink']};--color:{primary};--accent:{accent};--muted:{t['muted']};--surface:{surface};--line:{'#ffffff25' if dark else '#233b3026'};--tint:{'#ffffff0d' if dark else '#253b3008'};--button-ink:{contrast(primary)};--primary:{primary}"
    visible = set(content.get('visible_sections') if content.get('visible_sections') is not None else ['stats','programme','tracks','connect'])
    name = e(content.get('event_name') or 'Event')
    logo = safe_url(content.get('logo_url'))
    brand = f'<img class="site-logo" src="{logo}" alt="{e(content.get("logo_alt") or "Event logo")}">' if logo else '<span class="brand-symbol" aria-hidden="true">✦</span>'
    nav = navigation_markup(content)
    header = f'<header class="nav"><a class="brand" href="#home">{brand}<span>{name}</span></a><nav class="nav-links" aria-label="Event">{nav}</nav><details class="mobile-menu"><summary>Menu</summary><nav aria-label="Event mobile">{nav}</nav></details></header>'
    start = date_label(content.get('start_date'), content.get('timezone') or 'UTC')
    end = date_label(content.get('end_date'), content.get('timezone') or 'UTC')
    dates = ' – '.join(dict.fromkeys(x for x in (start,end) if x))
    action_primary = link(content.get('primary_action'))
    secondary = link(content.get('secondary_action'),'btn secondary')
    if not secondary and 'programme' in visible: secondary = '<a class="btn secondary" href="#programme">Explore the programme</a>'
    hero_url = safe_url(content.get('feature_image_url') or content.get('hero_image_url'))
    media = f'<img class="uploaded-hero" src="{hero_url}" alt="{e(content.get("image_alt") or "")}">' if hero_url else f'<div aria-hidden="true">{artwork(family,content)}</div>'
    hero = f'<section class="hero" id="home"><div class="hero-copy"><div class="eyebrow">{e(content.get("eyebrow") or content.get("event_name") or "Welcome")}</div><h1>{e(content.get("headline") or content.get("event_name") or "Welcome")}</h1><p class="hero-summary">{e(content.get("summary") or "")}</p><div class="hero-actions">{action_primary}{secondary}</div><div class="hero-meta"><span>{e(dates)}</span><span>{e(content.get("venue") or "")}</span></div></div><div class="hero-visual">{media}</div></section>'
    stats = ''.join(f'<div><strong>{e(str(x.get("value") or ""))} {e(x.get("label") or "")}</strong><span>{e(x.get("detail") or "")}</span></div>' for x in content.get('stats') or []) if 'stats' in visible else ''
    glance = f'<div class="micro-facts">{stats}</div>' if stats else ''
    audience = ''
    if 'tracks' in visible and content.get('tracks'):
        cards=[]
        for track in content['tracks']:
            image=safe_url(track.get('image_url'));visual=f'<img src="{image}" alt="" loading="lazy">' if image else e(track.get('icon') or '✦')
            jump=f'<a class="text-btn" data-track-jump="{e(track.get("title") or "")}" href="#programme">View sessions →</a>' if 'programme' in visible else ''
            cards.append(f'<article class="audience-card"><span class="pictogram">{visual}</span><h3>{e(track.get("title") or "")}</h3><p>{e(track.get("description") or "")}</p>{jump}</article>')
        audience='<section class="audiences" id="tracks">'+section_heading('Choose your experience','','Find your connection')+'<div class="audience-grid">'+''.join(cards)+'</div></section>'
    schedule=programme(content) if 'programme' in visible else ''
    speakers=''
    if content.get('speakers') and content.get('speakers_confirmed',True):
        cards=[]
        for sp in content['speakers']:
            photo=safe_url(sp.get('photo_url'));mark=f'<img src="{photo}" alt="" loading="lazy">' if photo else f'<span class="speaker-initial">{e((sp.get("name") or "?")[:1])}</span>'
            cards.append(f'<article class="speaker-card">{mark}<h3>{e(sp.get("name") or "")}</h3><p>{e(" · ".join(x for x in (sp.get("title"),sp.get("organization")) if x))}</p><p>{e(sp.get("bio") or "")}</p><small>{e(", ".join(sp.get("session_titles") or []))}</small></article>')
        speakers='<section class="content-section" id="speakers">'+section_heading('Meet the speakers','','Programme voices')+'<div class="speaker-grid">'+''.join(cards)+'</div></section>'
    if content.get('speakers_confirmed') is False:
        speakers='<section class="content-section" id="speakers">'+section_heading('Speakers','The organizer will publish the confirmed speaker lineup here.')+'</section>'
    features=[]
    for f in content.get('feature_sections') or []:
        if not f.get('enabled',True):continue
        image=safe_url(f.get('image_url'));media=f'<img src="{image}" alt="" loading="lazy">' if image else '<div class="feature-art" aria-hidden="true">✦</div>'
        features.append(f'<section class="feature content-section" id="{e(f.get("id") or "")}"><div>{section_heading(f.get("title") or "", "", f.get("kicker") or "")}<p>{e(f.get("summary") or "")}</p><div class="facts">{facts_markup(f.get("facts"))}</div>{link(f.get("action"))}</div>{media}</section>')
    connections=[]
    for key,title,description,label in [('guesthub_url','Your GuestHub','Receive your personal link at your registration email.','Recover my GuestHub'),('festio_live_url',content.get('festio_live_title') or 'Festio Live',content.get('festio_live_description') or 'Participate in live Q&A, polls and activities.','Join Festio Live'),('festiome_url',content.get('festiome_title') or 'FestioMe',content.get('festiome_description') or 'Chat with the event community.','Open FestioMe')]:
        cta=link({'url':content.get(key),'label':label},'text-btn')
        if cta:connections.append(f'<article class="tool-card"><h3>{e(title)}</h3><p>{e(description)}</p>{cta}</article>')
    connect='<section class="community" id="connect">'+section_heading('The event, connected.','','Stay in the loop')+'<div class="tools">'+''.join(connections)+'</div></section>' if 'connect' in visible and connections else ''
    venue=''
    if content.get('venue') or content.get('venue_address') or content.get('venue_facts'):
        venue=f'<section class="venue" id="venue"><div><div class="eyebrow">Venue &amp; travel</div><h2>{e(content.get("venue") or "Plan your arrival")}</h2><p>{e(content.get("venue_address") or "")}</p>{link({"label":"Open directions", "url":content.get("venue_url")})}<div class="facts">{facts_markup(content.get("venue_facts"))}</div></div><div class="venue-art" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div></section>'
    faq='<section class="faq" id="faq"><div>'+section_heading('Helpful answers','','Before you arrive')+'</div><div>'+''.join(f'<details><summary>{e(f.get("question") or "")}</summary><p>{e(f.get("answer") or "")}</p></details>' for f in content.get('faqs') or [])+'</div></section>' if content.get('faqs') else ''
    registration=f'<section class="content-section" id="registration">{section_heading("Registration details")}<div class="facts">{facts_markup(content.get("registration_facts"))}</div>{action_primary}</section>' if content.get('registration_facts') else ''
    exhibitors=''
    if content.get('exhibitors'):
        cards=[]
        for ex in content['exhibitors']:
            img=safe_url(ex.get('logo_url'));mark=f'<img src="{img}" alt="" loading="lazy">' if img else ''
            cards.append(f'<article class="speaker-card">{mark}<h3>{e(ex.get("name") or "")}</h3><small>{e(ex.get("category") or "")}</small><p>{e(ex.get("description") or "")}</p></article>')
        exhibitors='<section class="content-section" id="exhibitors">'+section_heading('Meet the exhibitors')+'<div class="speaker-grid">'+''.join(cards)+'</div></section>'
    highlights='<section class="content-section"><ul class="highlights">'+''.join(f'<li>{e(x)}</li>' for x in content.get('highlights') or [])+'</ul></section>' if content.get('highlights') else ''
    heritage=f'<p class="heritage">{e(content["heritage_message"])}</p>' if content.get('heritage_message') else ''
    contact_url=safe_destination('mailto:'+str(content.get('contact_email') or ''))
    contact=f'<section class="closing" id="contact"><h2>Questions about your visit?</h2><a class="btn" href="{contact_url}">Contact the organizer ↗</a></section>' if contact_url else ''
    middle=schedule+audience if family in ('pathway','atlas') else audience+schedule
    footer=f'<footer><span>{e(content.get("footer_tagline") or content.get("brand_tagline") or content.get("event_name") or "")} · <a href="https://festio.events" target="_blank" rel="noopener">Powered by Festio</a></span><nav aria-label="Footer">{navigation_markup(content,footer=True)}</nav></footer>'
    notice='<div class="review">Preview — visitors cannot see this draft</div>' if preview else ''
    # The policy also protects srcdoc previews; it permits only our fixed script.
    policy=security_policy().replace("frame-ancestors 'none'; ", "")
    return f'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="{e(policy)}"><title>{name}</title><meta name="description" content="{e((content.get("summary") or "")[:200])}"><meta property="og:title" content="{e(content.get("headline") or content.get("event_name") or "")}"><style>{CSS}</style></head><body class="{family} collection-modern" data-template="{family}" style="{colors}">{notice}<div class="wrap">{header}<main>{hero}{glance}{heritage}{highlights}{middle}{speakers}{"".join(features)}{registration}{exhibitors}{connect}{venue}{faq}{contact}</main>{footer}</div><script data-festio-programme>{JS}</script></body></html>'
