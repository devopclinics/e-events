"""Public event support uses only the currently published site snapshot."""
from html import escape
from urllib.parse import quote,urlsplit
from datetime import datetime

def profile(ident,c):
    when=c.get('start_date') or ''
    try:when=datetime.fromisoformat(when).strftime('%A, %d %B %Y at %I:%M %p')+' ('+str(c.get('timezone') or 'UTC')+')'
    except (ValueError,TypeError):pass
    registration=''
    action=c.get('primary_action') or {}
    url=str(action.get('url') or '')
    # A published registration action may be external. Personal-pass routes are never knowledge.
    parsed=urlsplit(url)
    if parsed.scheme=='https' and not any(parsed.path.startswith(p) for p in ['/r/','/scan/','/meeting-response/']):registration=str(action.get('label') or 'Registration')+': '+url
    sessions=c.get('sessions') or []
    programme='\n'.join(' · '.join(str(x) for x in [s.get('time'),s.get('display_title') or s.get('title')] if x) for s in sessions[:12] if s.get('title') or s.get('display_title'))
    return dict(id='site-'+ident,name=str(c.get('event_name') or 'This event'),aliases=[],approved=True,answers=dict(time=str(when),venue='\n'.join(filter(None,[c.get('venue'),c.get('venue_address')])),registration=registration,programme=programme,dress=''))

def embed(html,slug):
    # Native details works with the existing strict CSP: no new script or network privilege.
    widget="""<style>.festio-support-entry{position:fixed;right:20px;bottom:20px;z-index:9999;font:14px Arial,sans-serif}.festio-support-entry>summary{list-style:none;cursor:pointer;background:#194c3a;color:#fffdf2;border:2px solid #fffdf2;border-radius:28px;padding:15px 20px;box-shadow:0 5px 24px #173e3333;font-weight:bold}.festio-support-entry>summary::-webkit-details-marker{display:none}.festio-support-entry[open]>summary::after{content:' ×';margin-left:10px}.festio-support-entry iframe{display:block;width:min(380px,calc(100vw - 24px));height:min(620px,calc(100dvh - 100px));position:absolute;right:0;bottom:64px;border:1px solid #d8e0d2;border-radius:18px;background:#fcfaf4;box-shadow:0 15px 60px #142c3440}.festio-support-entry:not([open]) iframe{display:none}@media(max-width:480px){.festio-support-entry{right:12px;bottom:12px}}</style><details class="festio-support-entry"><summary aria-label="Chat with Festio about this event">Chat with Festio</summary><iframe title="Festio event support chat" loading="lazy" referrerpolicy="no-referrer" src="/support-chat?site=SLUG"></iframe></details>""".replace('SLUG',escape(quote(slug,safe=''),quote=True))
    return html.replace('</body>',widget+'</body>')
