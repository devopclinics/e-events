"""Compact, email-client-safe session check-in receipts."""
import html
import re
from urllib.parse import urlparse
from app.timeutil import to_event_local


def _color(value, fallback):
    return value if isinstance(value, str) and re.fullmatch(r'#[0-9a-fA-F]{6}', value) else fallback


def _luminance(color):
    rgb = [int(color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    rgb = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb]
    return sum(v * weight for v, weight in zip(rgb, (.2126, .7152, .0722)))


def render_session_receipt(data, theme=None):
    theme = theme or {}
    primary = _color(theme.get('background_color') or theme.get('primary_color'), '#490c58')
    if _luminance(primary) > .18:
        primary = '#490c58'
    accent = _color(theme.get('accent_color'), '#eea008')
    esc = lambda value: html.escape(str(value or ''), quote=True)
    first = esc(data.get('first_name'))
    name = esc(data.get('event_name'))
    branding = data.get('email_branding') or {}
    title = esc(branding.get('title') or data.get('brand_event_name') or data.get('event_name'))
    subtitle = esc(branding.get('subtitle'))
    tagline = esc(branding.get('tagline'))
    label = str(data.get('session_name') or '').strip()
    table = esc(data.get('table_name'))
    seat = esc(data.get('seat_number'))
    seated = bool(table or seat)
    # Session identity must not depend on whether a seat has been allocated.
    label = label or ('Dinner' if seated else 'Conference')
    confirmation = ('You are checked in for the conference.' if label.lower() == 'conference'
                    else f'You are checked in for {esc(label)}.')
    welcome = (f'Welcome, {first}. Your evening begins here. Show your table and seat details to an usher, who can help you find your place.' if seated else
               f'Welcome, {first}. We’re glad you’re here. Keep your event pass handy as you enjoy {title}.')
    assignment = ''
    if seated:
        assignment = f'''<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e6d8e9;border-top:4px solid {accent};border-radius:9px;background:#fbf7ef;margin:0 0 22px;"><tr>
<td width="70%" valign="top" style="padding:18px 16px;border-right:1px solid #e6d8e9;"><div style="font:700 10px Arial,sans-serif;letter-spacing:1.5px;color:#78627c;">YOUR TABLE</div><div style="font:900 23px/1.35 Arial,sans-serif;color:{primary};margin-top:10px;word-break:break-word;">{table or 'Ask an usher'}</div></td>
<td width="30%" valign="top" style="padding:18px 16px;"><div style="font:700 10px Arial,sans-serif;letter-spacing:1.5px;color:#78627c;">SEAT</div><div style="font:900 32px/1.2 Arial,sans-serif;color:{primary};margin-top:8px;">{seat or '—'}</div></td></tr></table>'''
    when = to_event_local(data.get('admitted_at'), data.get('event_timezone')) if data.get('admitted_at') else None
    time = esc(when.strftime('%I:%M %p').lstrip('0') + ' ' + when.strftime('%Z')) if when else ''
    date = esc(when.strftime('%a, %d %b %Y')) if when else ''
    recorded = f'<div style="padding:16px;background:#f6f0f8;border-radius:9px;font:13px/1.7 Arial,sans-serif;margin-bottom:24px;"><strong style="display:block;color:{primary};">Check-in recorded</strong><span style="color:#6d5772;">{time} · {date}</span></div>' if when else ''
    link = data.get('hub_url') or ''
    parsed = urlparse(link)
    cta = f'<table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="{primary}" style="border-radius:8px;"><a href="{esc(link)}" style="display:inline-block;padding:16px 22px;font:700 14px Arial,sans-serif;color:#ffffff;text-decoration:none;">Open your event pass</a></td></tr></table>' if parsed.scheme in ('http', 'https') and parsed.netloc else ''
    theme_text = f'<p style="font:14px/1.6 Arial,sans-serif;margin:16px 0 0;color:{primary};"><strong>{subtitle}</strong>{"<br>" + tagline if tagline else ""}</p>' if subtitle or tagline else ''
    return f'''<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border:1px solid #e8dce9;border-radius:16px;overflow:hidden;background:#ffffff;">
<tr><td style="padding:27px 26px 24px;background:#fbf7ef;border-top:5px solid {accent};">
<div style="font:900 31px/1.2 Arial,sans-serif;letter-spacing:-1px;color:{primary};">{title}</div>
<div style="font:700 10px Arial,sans-serif;letter-spacing:3px;color:{primary};margin-top:7px;">{esc(label).upper()}</div>{theme_text}</td></tr>
<tr><td class="session-content" style="padding:30px 26px;border-top:1px solid #ebdfec;">
<p style="font:700 11px Arial,sans-serif;letter-spacing:1.8px;color:#36645b;margin:0 0 14px;">CHECK-IN CONFIRMED</p>
<div style="padding:18px;border:1px solid #e6d8e9;border-left:4px solid {accent};border-radius:9px;background:#f8f2fa;margin:0 0 20px;"><strong style="font:900 25px/1.35 Arial,sans-serif;color:{primary};">{confirmation}</strong></div>
<p style="font:15px/1.75 Arial,sans-serif;color:#5f4b65;margin:0 0 22px;">{welcome}</p>
{assignment}{recorded}{cta}</td></tr>
<tr><td style="background:#fbf7ef;border-top:1px solid #ebdfec;padding:18px 26px;font:11px/1.8 Arial,sans-serif;color:#78627c;">Sent for {name}<br>Powered by <a href="https://festio.events" style="color:{primary};">Festio</a>
<div style="border-top:1px solid #e8dce9;margin-top:16px;padding-top:16px;"><span style="display:block;font-size:12px;margin-bottom:7px;">Planning an event of your own?</span><a href="https://festio.events/create-invitation?share=invite" style="font-size:13px;font-weight:bold;color:{primary};text-decoration:underline;">Create your free event ↗</a></div></td></tr></table>'''


def wrap_session_receipt(inner):
    """Avoid the general email shell's extra headline, logo and flyer."""
    return ('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
            '<style>@media(max-width:620px){.session-content{padding:26px 20px!important;}}</style></head>'
            '<body style="margin:0;background:#f3eef5;font-family:Arial,Helvetica,sans-serif;">'
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f3eef5"><tr><td align="center" style="padding:24px 12px;">'
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:576px;"><tr><td>'
            + inner + '</td></tr></table></td></tr></table></body></html>')
