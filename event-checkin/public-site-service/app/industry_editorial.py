"""Opt-in editorial website, built from the approved PAMCON concept."""
from pathlib import Path
from html import escape
from .community import safe_url,date_label

def render(content, *, preview=False):
    html=Path(__file__).with_name('industry_editorial.html').read_text()
    name=escape(content.get('event_name') or 'Event')
    html=html.replace('<title>PAMCON 2026 — Modern website concept</title>', '<title>'+name+'</title>')
    html=html.replace('<div class="review">DESIGN REVIEW • Proposed PAMCON website • This mockup has not been published</div>', '<div class="review">Draft preview · Guest actions are disabled</div>' if preview else '')
    # Template artwork and editorial copy are the approved design. Dates and
    # guest destinations always come from the event website's saved content.
    date=date_label(content.get('start_date'),content.get('timezone') or 'UTC')
    html=html.replace('10 November 2026',escape(date or 'Date to be announced'))
    html=html.replace('10 NOVEMBER 2026',escape((date or 'Date to be announced').upper()))
    from datetime import datetime
    from zoneinfo import ZoneInfo
    try:
        d=datetime.fromisoformat(str(content.get('start_date')).replace('Z','+00:00'))
        if d.tzinfo:d=d.astimezone(ZoneInfo(content.get('timezone') or 'UTC'))
        html=html.replace('10<br>NOV<span>2026</span>',f'{d.day:02}<br>{d.strftime("%b").upper()}<span>{d.year}</span>')
    except (TypeError,ValueError):
        html=html.replace('10<br>NOV<span>2026</span>','DATE<span>TO FOLLOW</span>')
    html=html.replace('PAMCON 2026',name)
    if content.get('venue') and content['venue'].strip().lower() not in ['venue to be confirmed','to be confirmed','tba','tbd']:
        venue=escape(content['venue']);html=html.replace('VENUE TO BE CONFIRMED',venue.upper())
        html=html.replace('Venue to be confirmed. No directions are published until the location is available.',venue)
        url=safe_url(content.get('venue_url'))
        if url:html=html.replace('<span class="eyebrow">LOCATION</span>', '<span class="eyebrow">LOCATION</span><p><a href="'+url+'" rel="noopener noreferrer" target="_blank">Open directions ↗</a></p>')
    if not preview:
        register=safe_url((content.get('primary_action') or {}).get('url'))
        hub=safe_url(content.get('guesthub_url')) or register
        import re
        def action(m):
            label=m.group(2);target=hub if 'GuestHub' in label else register
            return '<a class="'+m.group(1)+'" href="'+target+'">'+label+'</a>' if target else '<span class="'+m.group(1)+'">Registration details coming soon</span>'
        html=re.sub(r'<button class="([^"]*)" onclick="showAction\(\)">([^<]*)</button>',action,html)
        html=re.sub(r'<dialog id="action">[\s\S]*?</dialog>','',html)
    approved=[s for s in content.get('speakers',[]) if s.get('name') and 'to be confirmed' not in s['name'].lower() and 'demo' not in s['name'].lower()]
    if approved:
        import re
        cards=''.join('<article><h3>'+escape(s['name'])+'</h3><p>'+escape(s.get('title') or '')+'</p><p>'+escape(s.get('bio') or '')+'</p></article>' for s in approved)
        section='<section class="section" id="speakers"><span class="eyebrow">VOICES FROM THE INDUSTRY</span><h2>People worth listening to.</h2><div class="industry">'+cards+'</div></section>'
        directory=safe_url(content.get('speakers_directory_url'))
        from urllib.parse import urlparse
        if directory:
            parsed=urlparse(content['speakers_directory_url']);path=parsed.path
            if path.startswith('/speakers/') or path.startswith('/events/'):
                section=section.replace('</section>','<details><summary>View all speakers</summary><iframe title="Full event speaker lineup" src="'+escape(path)+'?embedded=1" loading="lazy" style="width:100%;height:700px;border:0"></iframe></details></section>')
        html=re.sub(r'<section class="section voices">[\s\S]*?</section>',lambda _:section,html,count=1)
    return html
