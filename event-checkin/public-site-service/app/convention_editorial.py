"""Opt-in convention editorial layout, driven by the saved website snapshot."""
from pathlib import Path
from html import escape
from .community import safe_url


def render(c, preview=False):
    e=lambda v:escape(str(v or ''),quote=True)
    def link(item,cls='btn'):
        item=item or {};url=safe_url(item.get('url'))
        return f'<a class="{cls}" href="{e(url)}">{e(item.get("label"))}</a>' if url else ''
    primary=c.get('primary_action');secondary=c.get('secondary_action')
    logo=safe_url(c.get('logo_url'));photo=safe_url(c.get('hero_image_url'))
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
        return f'<article class="card" id="{key}"><span class="pill">{e(s.get("kicker"))}</span><h3 style="margin-top:15px">{e(s.get("title") or fallback)}</h3><p>{e(s.get("summary"))}</p>{link(s.get("action"),"")}</article>'
    headline=e(c.get('headline')).replace('Our roots. Our people. Our future.','Our roots.<br>Our people.<br><em>Our future.</em>')
    css=Path(__file__).with_name('convention_editorial.css').read_text()
    return f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{e(c.get('event_name'))}</title><style>{css}</style></head><body><main class="sheet">
<header class="sitebar"><div class="brand">{f'<img src="{e(logo)}" alt="IEDPU USA">' if logo else ''}<div><b>IEDPU USA</b><small>DALLAS ’26</small></div></div><nav><a href="#programme">Programme</a><a href="#gala">Gala Night</a><a href="#travel">Travel</a>{link(primary)}</nav></header>
<section class="hero"><div class="eyebrow">{e(c.get('eyebrow'))}</div><h1>{headline}</h1><p class="lead">{e(c.get('summary'))}</p><div class="actions">{link(primary,'btn gold')}<a class="btn" href="#programme">Explore the programme ↗</a></div><div class="facts"><div><strong>November 26–28</strong>Thursday to Saturday</div><div><strong>{e(c.get('venue'))}</strong>Irving, Texas</div><div><strong>One community</strong>Members, families & friends</div></div></section>
<section class="section"><div class="eyebrow">{e(c.get('intro_eyebrow'))}</div><h2>{e(c.get('intro_title'))}</h2><p class="muted">{e(c.get('intro_summary'))}</p><div class="grid"><article class="card"><div class="num">01</div><h3>Reconnect</h3><p>Sightseeing, fellowship and time with friends old and new.</p><a href="#programme">Friday’s programme ↗</a></article><article class="card"><div class="num">02</div><h3>Exchange ideas</h3><p>A convention seminar focused on our community and its future.</p><a href="#programme">Saturday’s seminar ↗</a></article><article class="card"><div class="num">03</div><h3>Celebrate together</h3><p>A Gala Night of culture, music, recognition and dinner.</p><a href="#gala">Discover Gala Night ↗</a></article></div></section>
<section class="heritage">{f'<img src="{e(photo)}" alt="{e(c.get("image_alt"))}">' if photo else ''}<div><div class="eyebrow">ROOTED IN HERITAGE</div><h2>Carrying Ilorin<br>with us.</h2><p class="muted">Our heritage connects generations. Our community brings that connection to life.</p><small class="muted">Heritage image from IEDPU’s website; convention photography selection pending.</small></div></section>
<section class="section"><div class="grid two">{feature('bvn','Free BVN registration')}{feature('travel','Make yourself at home.')}</div></section><section class="section" id="gala"><div class="eyebrow">{e(features.get('gala',{}).get('kicker'))}</div><h2>{e(features.get('gala',{}).get('title'))}</h2><p class="muted">{e(features.get('gala',{}).get('summary'))}</p>{link(secondary,'btn ghost')}</section>
<section class="section" id="programme"><div class="eyebrow">YOUR CONVENTION, DAY BY DAY</div><h2>{e(c.get('programme_title'))}</h2><p class="muted">{e(c.get('programme_summary'))}</p>{programme}</section>
<footer class="footer"><span>{e(c.get('footer_tagline'))}</span><span>Powered by Festio · <a href="https://festio.events/create-invitation?share=invite">Create your free event</a></span></footer></main></body></html>'''
