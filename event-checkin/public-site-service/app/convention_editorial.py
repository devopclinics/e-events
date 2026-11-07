"""Opt-in convention editorial layout, driven by the saved website snapshot."""
from pathlib import Path
from html import escape
from urllib.parse import urlparse


def safe_url(value):
    """Validate raw URLs; attributes are escaped once by the renderer."""
    value = str(value or "").strip()
    parsed = urlparse(value)
    return value if parsed.scheme in ("http", "https") and parsed.netloc else ""


def render(c, preview=False):
    e=lambda v:escape(str(v or ''),quote=True)
    def link(item,cls='btn'):
        item=item or {};url=safe_url(item.get('url'))
        return f'<a class="{cls}" href="{e(url)}">{e(item.get("label"))}</a>' if url else ''
    primary=c.get('primary_action');secondary=c.get('secondary_action')
    logo=safe_url(c.get('logo_url'));photo=safe_url(c.get('hero_image_url'))
    artwork=safe_url(c.get('convention_artwork_url'))
    def visual(kind, label):
        if not artwork:return ''
        boxes={'skyline':'600 130 486 340','sightseeing':'31 484 328 226','seminar':'383 484 323 226','celebration':'733 484 323 226','gala':'534 1055 550 231'}
        return f'<svg class="concept-visual" viewBox="{boxes[kind]}" role="img" aria-label="{e(label)}" preserveAspectRatio="xMidYMid slice"><image href="{e(artwork)}" width="1086" height="1448"/></svg>'
    features={s.get('id'):s for s in c.get('feature_sections',[]) if s.get('enabled',True)}
    rows={}
    for s in c.get('sessions',[]):rows.setdefault(s.get('date') or s.get('day') or '',[]).append(s)
    programme=''
    for date,items in rows.items():
        from datetime import datetime
        try:label=datetime.fromisoformat(date).strftime('%A, November %d').replace(' 0',' ')
        except ValueError:label=date
        entries=''.join(f'<article><time>{e(s.get("time"))}</time><h3>{e(s.get("title"))}</h3><p>{e(s.get("description"))}</p></article>' for s in items)
        programme+=f'<div class="card schedule-day"><h3>{e(label)}</h3><div class="agenda">{entries}</div></div>'
    def feature(key,fallback):
        s=features.get(key,{})
        if key == 'travel':
            directions=safe_url(c.get('venue_url'))
            action=link({'label':'Get directions ↗','url':directions},'btn gold') if directions else ''
            return f'''<article class="card travel-card" id="travel"><div class="travel-art" aria-hidden="true"><span>DALLAS–IRVING<span>TEXAS, USA</span></span><svg viewBox="0 0 240 140" fill="none"><path d="M30 125h190M50 125V54h50v71M100 125V20h78v105M178 125V70h28v55"/><path d="M113 35h13m13 0h13m13 0h1M113 51h13m13 0h13m13 0h1M113 67h13m13 0h13m13 0h1M113 83h13m13 0h13m13 0h1M61 69h10m12 0h5M61 85h10m12 0h5M61 101h10m12 0h5M130 125v-23h20v23"/><path class="travel-pin" d="M51 23c0 12-17 29-17 29S17 35 17 23a17 17 0 0134 0Z"/><circle cx="34" cy="23" r="5"/></svg></div><div class="travel-copy"><span class="pill">TRAVEL &amp; HOTEL</span><h3>Your Dallas home base.</h3><p class="travel-intro">Stay close. Come together.</p><div class="travel-address"><span class="travel-location" aria-hidden="true">↗</span><div><strong>{e(c.get('venue'))}</strong><p>{e(c.get('venue_address'))}</p></div></div><div class="travel-actions">{action}<span>Save the location for your arrival.</span></div><div class="travel-booking"><span class="travel-status" aria-hidden="true"></span><div><strong>Planning your stay?</strong><p>Official group booking details will be shared here when confirmed.</p></div></div></div></article>'''
        image=safe_url(s.get('image_url'))
        media=f'<img class="feature-image" src="{e(image)}" alt="{e(s.get("title") or fallback)}" loading="lazy">' if image else ''
        return f'<article class="card" id="{key}">{media}<span class="pill">{e(s.get("kicker"))}</span><h3 style="margin-top:15px">{e(s.get("title") or fallback)}</h3><p>{e(s.get("summary"))}</p>{link(s.get("action"),"")}</article>'
    headline=e(c.get('headline')).replace('Our roots. Our people. Our future.','Our roots.<br>Our people.<br><em>Our future.</em>')
    css=Path(__file__).with_name('convention_editorial.css').read_text()
    return f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{e(c.get('event_name'))}</title><style>{css}</style></head><body><main class="sheet">
<header class="sitebar"><div class="brand">{f'<img src="{e(logo)}" alt="IEDPU USA">' if logo else ''}<div><b>IEDPU USA</b><small>DALLAS ’26</small></div></div><nav><a href="#programme">Programme</a><a href="#gala">Gala Night</a><a href="#travel">Travel</a>{link(features.get("donate",{}).get("action"),"donate-nav")}{link(primary)}</nav></header>
<section class="hero image-led"><div class="hero-copy"><div class="eyebrow">{e(c.get('eyebrow'))}</div><h1>{headline}</h1><p class="lead">{e(c.get('summary'))}</p><div class="actions">{link(primary,'btn gold')}<a class="btn" href="#programme">Explore the programme ↗</a></div><div class="facts"><div><strong>November 26–28</strong>Thursday to Saturday</div><div><strong>{e(c.get('venue'))}</strong>Irving, Texas</div><div><strong>One community</strong>Members, families & friends</div></div></div>{f'<div class="hero-skyline">{visual("skyline", "Dallas skyline · generated promotional imagery")}</div>' if artwork else ''}</section>
<section class="section"><div class="eyebrow">{e(c.get('intro_eyebrow'))}</div><h2>{e(c.get('intro_title'))}</h2><p class="muted">{e(c.get('intro_summary'))}</p><div class="grid"><article class="card picture-card">{visual('sightseeing','Sightseeing bus scene · generated promotional imagery')}<div class="picture-copy"><h3>Reconnect</h3><p>Sightseeing, fellowship and time with friends old and new.</p><a href="#programme">Friday’s programme ↗</a></div></article><article class="card picture-card">{visual('seminar','Convention seminar scene · generated promotional imagery')}<div class="picture-copy"><h3>Exchange ideas</h3><p>A convention seminar focused on our community and its future.</p><a href="#programme">Saturday’s seminar ↗</a></div></article><article class="card picture-card">{visual('celebration','Gala celebration scene · generated promotional imagery')}<div class="picture-copy"><h3>Celebrate together</h3><p>A Gala Night of culture, music, recognition and dinner.</p><a href="#gala">Discover Gala Night ↗</a></div></article></div></section>
<div class="imagery-caption">Promotional imagery adapted from the approved AI-generated design concept.</div>
<section class="section"><div class="grid two">{feature('bvn','Free BVN registration')}{feature('travel','Make yourself at home.')}</div></section><section class="gala-feature" id="gala"><div class="gala-copy"><div class="eyebrow">{e(features.get('gala',{}).get('kicker'))}</div><h2>{e(features.get('gala',{}).get('title'))}</h2><p class="muted">{e(features.get('gala',{}).get('summary'))}</p>{link(secondary,'btn gold')}</div><div class="gala-photo">{visual('gala','Gala family scene · generated promotional imagery')}</div></section>
<section class="section">{feature("donate","Our future. Made together.")}</section><section class="section" id="programme"><div class="eyebrow">YOUR CONVENTION, DAY BY DAY</div><h2>{e(c.get('programme_title'))}</h2><p class="muted">{e(c.get('programme_summary'))}</p>{programme}</section>
<footer class="footer"><span>{e(c.get('footer_tagline'))}</span><span>Powered by Festio · <a href="https://festio.events/create-invitation?share=invite">Create your free event</a></span></footer></main></body></html>'''
