from html import escape
from urllib.parse import urlparse


def safe_url(value):
    value = str(value or '')
    return escape(value) if urlparse(value).scheme in ('http', 'https') else ''


def action(link, cls='button'):
    url = safe_url((link or {}).get("url"))
    return f'<a class="{cls}" href="{url}">{escape((link or {}).get("label", "Open"))}</a>' if link and url else ''


def safe_destination(value):
    value = str(value or '').strip()
    if value.startswith('#') and len(value) > 1:
        return escape(value)
    parsed = urlparse(value)
    if parsed.scheme in ('http', 'https') and parsed.netloc:
        return escape(value)
    if parsed.scheme == 'mailto' and '@' in parsed.path:
        return escape(value)
    return ''


def navigation_markup(content, *, footer=False):
    items = content.get('navigation') or []
    if not items:
        items = [
            {'label': 'Programme', 'url': '#programme', 'enabled': 'programme' in set(content.get('visible_sections') or [])},
            {'label': 'Venue', 'url': content.get('venue_url'), 'enabled': bool(content.get('venue_url'))},
            {'label': 'Contact', 'url': f"mailto:{content.get('contact_email')}" if content.get('contact_email') else '', 'enabled': bool(content.get('contact_email'))},
        ]
    links = []
    for item in items:
        url = safe_destination(item.get('url'))
        if not item.get('enabled', True) or not url:
            continue
        external = url.startswith('http')
        attrs = ' target="_blank" rel="noopener"' if external else ''
        links.append(f'<a href="{url}"{attrs}>{escape(item.get("label", "Open"))}</a>')
    if footer and content.get('contact_email') and not any(item.get('destination_type') == 'contact' for item in items):
        links.append(f'<a href="mailto:{escape(content.get("contact_email"))}">Contact</a>')
    return ''.join(links)


def track_markup(track):
    title = escape(track.get("title", ""))
    image_url = safe_url(track.get("image_url"))
    visual = f'<img src="{image_url}" alt="" loading="lazy">' if image_url else f'<i>{escape(track.get("icon", chr(10022)))}</i>'
    return f'<article class="track">{visual}<div><b>{title}</b><small>{escape(track.get("description", ""))}</small></div></article>'


def render(content, preview=False):
    e=escape; name=e(content.get('event_name','Event')); primary=e(content.get('primary_color','#0d5c55')); accent=e(content.get('accent_color','#a64f2b'))
    hero=safe_url(content.get('feature_image_url') or content.get('hero_image_url')); logo=safe_url(content.get('logo_url')); visible=set(content.get('visible_sections') or ['stats','programme','tracks','connect'])
    tagline=e(content.get('brand_tagline') or 'PEOPLE · PURPOSE · A STRONGER TOMORROW'); brand=f'<img src="{logo}" alt="{name}">' if logo else f'<span class="mark">✤</span><div><b>{name}</b><small>{tagline}</small></div>'
    stats=''.join(f'<div class="stat"><strong>{e(x.get("value",""))}</strong><div><b>{e(x.get("label",""))}</b><small>{e(x.get("detail",""))}</small></div></div>' for x in content.get('stats',[])[:4])
    sessions=''.join(f'<article class="session"><small>{e(x.get("time",""))}</small><b>{e(x.get("title",""))}</b><p>{e(x.get("venue",""))}</p><span>{e(x.get("track") or x.get("audience",""))}</span></article>' for x in content.get('sessions',[])[:3])
    tracks=''.join(track_markup(x) for x in content.get('tracks',[])[:4])
    image=f'<img src="{hero}" alt="" loading="eager">' if hero else '<div class="placeholder">Add a feature image</div>'
    live=action({'label':'▢  Join Festio Live  ›','url':content.get('festio_live_url')},'connect-card') if content.get('festio_live_url') else ''
    me=action({'label':'♟  Open FestioMe  ›','url':content.get('festiome_url')},'connect-card') if content.get('festiome_url') else ''
    glance=f'<section class="glance"><h2>Your event at a glance</h2><div class="stats">{stats}</div></section>' if 'stats' in visible and stats else ''
    programme=f'<section class="programme"><h2>Programme preview</h2><p>A glimpse of what is coming up. Multiple sessions can run in parallel.</p><div class="sessions">{sessions}</div></section>' if 'programme' in visible else ''
    footer_tagline=e(content.get('footer_tagline') or 'Same roots. Brighter tomorrows.')
    audience=f'<section class="audiences"><h2>Built around every guest</h2><p>Dedicated experiences for all ages and interests.</p><div class="tracks">{tracks}</div></section>' if 'tracks' in visible and tracks else ''
    connect=f'<section class="connect"><div><h2>Stay engaged, wherever you are</h2><p>Be part of the conversation throughout the event.</p></div>{live}{me}<em>{footer_tagline}</em></section>' if 'connect' in visible else ''
    preview_bar='<div class="preview">Preview — visitors cannot see this draft</div>' if preview else ''
    url=safe_url((content.get('primary_action') or {}).get('url'))
    end=(' – '+e(content.get('end_date',''))) if content.get('end_date') else ''
    venue_url=safe_url(content.get('venue_url'))
    venue_text=e(content.get('venue',''))
    venue_meta=f'<a class="venue-link" href="{venue_url}" target="_blank" rel="noopener">&#9679; {venue_text}</a>' if venue_url else f'<span>&#9679; {venue_text}</span>'
    nav_links=navigation_markup(content)
    footer_links=navigation_markup(content, footer=True)
    return f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{name}</title><meta name="description" content="{e(content.get('summary',''))[:180]}"><style>
:root{{--green:{primary};--rust:{accent};--cream:#faf7f0;--ink:#0d332e}}*{{box-sizing:border-box}}body{{margin:0;background:var(--cream);color:var(--ink);font:15px/1.45 Inter,Arial,sans-serif}}.preview{{background:#25143c;color:#fff;text-align:center;padding:9px;font-weight:800}}nav{{height:74px;display:flex;align-items:center;padding:0 4.5vw;background:#fff;gap:28px;border-bottom:1px solid #eee8dc}}.brand{{display:flex;align-items:center;gap:10px;margin-right:auto}}.brand img{{height:48px;max-width:290px;object-fit:contain}}.mark{{font-size:38px;color:#9b733f}}.brand b{{font:700 20px Georgia}}.brand small{{display:block;font-size:7px;letter-spacing:.2em}}.nav-links,.footer-links{{display:flex;align-items:center;gap:24px}}.nav-links a,footer a{{font-size:12px;text-decoration:none;color:var(--ink)}}.nav-cta{{background:var(--rust);color:#fff;padding:11px 22px;border-radius:24px;font-weight:800}}.hero{{display:grid;grid-template-columns:52% 48%;height:560px;background:#fff}}.hero-copy{{padding:4vw 4.5vw 3vw}}.eyebrow{{font-size:11px;letter-spacing:.24em;font-weight:900}}h1{{font:700 clamp(3rem,5vw,5.4rem)/.9 Georgia;letter-spacing:-.045em;margin:18px 0}}.lead{{max-width:560px;font-size:17px;color:#4c5b57}}.meta{{display:flex;gap:30px;font-weight:800;margin:22px 0}}.venue-link{{color:inherit;text-decoration:underline;text-underline-offset:3px}}.actions{{display:flex;gap:14px}}.button{{background:var(--rust);color:#fff;padding:13px 25px;border-radius:8px;text-decoration:none;font-weight:800}}.button.outline{{background:#fff;color:var(--ink);border:1px solid var(--ink)}}.hero-art{{position:relative;overflow:hidden;background:var(--green)}}.hero-art img{{width:100%;height:100%;object-fit:cover}}.hero-art:after{{content:'FAITH  ·  FAMILY  ·  KNOWLEDGE  ·  COMMUNITY';position:absolute;right:0;top:0;width:30%;height:100%;display:grid;place-items:center;padding:30px;background:var(--green);color:#fff;writing-mode:vertical-rl;letter-spacing:.24em;font-size:10px}}.heritage{{position:absolute;left:20px;top:70px;z-index:2;width:170px;padding:20px;background:#faf7f0dd;font:italic 22px/1.15 Georgia}}.placeholder{{height:100%;display:grid;place-items:center;color:#fff}}main>section{{padding:24px 4.5vw}}h2{{font:700 21px Georgia;margin:0 0 6px}}.glance{{background:#fff}}.stats{{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}}.stat{{display:flex;align-items:center;gap:15px;padding:20px;background:#faf8f3;border-radius:7px}}.stat>strong{{font-size:25px;color:var(--rust)}}.stat b,.stat small,.track b,.track small{{display:block}}.stat small{{color:#6c7773}}.lower{{display:grid;grid-template-columns:58% 42%;background:#fff;border-top:1px solid #e9e3d7}}.programme{{border-right:1px solid #e2dccf;padding:24px 4.5vw}}.audiences{{padding:24px}}.programme p,.audiences>p{{margin:0 0 14px;color:#69736f}}.sessions{{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}}.session{{padding:18px;background:#f4f5ec;border-radius:7px;min-height:145px}}.session:nth-child(2){{background:#f8f1df}}.session:nth-child(3){{background:#f5e5e3}}.session small,.session b,.session p{{display:block;margin:0 0 7px}}.session span{{display:inline-block;background:#fff9;padding:4px 8px;border-radius:12px;font-size:10px}}.tracks{{display:grid;grid-template-columns:1fr 1fr;gap:10px}}.track{{display:flex;gap:12px;padding:16px;background:#edf3e9;border-radius:7px}}.track:nth-child(2),.track:nth-child(3){{background:#f6edda}}.track i{{font-style:normal;font-size:25px}}.track>img{{width:48px;height:48px;object-fit:cover;border-radius:10px;flex:0 0 auto}}.connect{{display:grid!important;grid-template-columns:1.2fr 1fr 1fr .8fr;align-items:center;gap:20px;background:var(--green);color:#fff;padding-top:30px!important;padding-bottom:30px!important}}.connect p{{margin:0;color:#d7e3df}}.connect-card{{color:#fff;border:1px solid #ffffff66;border-radius:12px;padding:18px;text-decoration:none;font-weight:800;background:#ffffff0b}}.connect em{{font:italic 20px Georgia;color:#e2c58f}}footer{{display:flex;align-items:center;gap:35px;padding:20px 4.5vw;background:#fff}}footer .brand{{margin-right:auto}}footer a{{font-size:12px}}@media(max-width:850px){{.nav-links{{display:none}}.hero{{grid-template-columns:1fr;height:auto}}.hero-art{{height:340px}}.stats{{grid-template-columns:1fr 1fr}}.lower{{grid-template-columns:1fr}}.programme{{border:0}}.connect{{grid-template-columns:1fr!important}}}}@media(max-width:560px){{nav{{padding:0 18px}}.brand small{{display:none}}.hero-copy,main>section{{padding:28px 20px}}h1{{font-size:3.2rem}}.meta{{display:grid;gap:7px}}.stats,.sessions,.tracks{{grid-template-columns:1fr}}.hero-art:after{{display:none}}}}</style></head><body>{preview_bar}<nav><div class="brand">{brand}</div><div class="nav-links">{nav_links}</div>{action(content.get('primary_action'),'nav-cta')}<span>Powered by <b>Festio</b></span></nav><header class="hero"><div class="hero-copy"><div class="eyebrow">{e(content.get('eyebrow','MULTI-DAY COMMUNITY CONVENTION'))}</div><h1>{e(content.get('headline',name))}</h1><p class="lead">{e(content.get('summary',''))}</p><div class="meta"><span>▣ {e(content.get('start_date',''))}{end}</span>{venue_meta}</div><div class="actions">{action(content.get('primary_action'))}{action(content.get('secondary_action'),'button outline')}</div></div><div class="hero-art">{image}<div class="heritage">{e(content.get('heritage_message','Our heritage. Our people. A brighter tomorrow.'))}</div></div></header><main>{glance}<div class="lower" id="programme">{programme}{audience}</div>{connect}</main><footer><div class="brand">{brand}</div><div class="footer-links">{footer_links}</div></footer></body></html>'''
