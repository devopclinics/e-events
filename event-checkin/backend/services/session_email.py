"""Email-safe session receipts, rendered separately from general admission."""
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
    primary = _color(theme.get('primary_color'), '#254e41')
    if _luminance(primary) > .18:
        primary = '#254e41'
    accent = _color(theme.get('accent_color'), '#f2ba60')
    button_ink = '#000000' if _luminance(accent) > .18 else '#ffffff'
    esc = lambda value: html.escape(str(value or ''), quote=True)
    first = esc(data.get('first_name'))
    name = esc(data.get('event_name'))
    table = esc(data.get('table_name'))
    seat = esc(data.get('seat_number'))
    seated = bool(table or seat)
    heading = 'Your seat.<br>Your evening.' if seated else 'You’re here.<br>Let’s begin.'
    description = ('Your place is ready. Show this confirmation to an usher to find your table.' if seated
                   else 'You are checked in for the conference.')
    description_block = (f'<p style="font:14px/1.8 Arial,sans-serif;color:#536155;margin:0;">{description}</p>' if seated else
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;border:1px solid #e4dacb;border-left:4px solid {accent};border-radius:10px;background:#fffdf8;"><tr><td style="padding:18px;"><strong style="display:block;font:700 18px/1.5 Arial,sans-serif;color:{primary};">{description}</strong><p style="font:14px/1.7 Arial,sans-serif;color:#3e5046;margin:8px 0 0;">Open seating for this session. No table assignment is required.</p></td></tr></table>')
    assignment = ''
    if seated:
        assignment = f'''<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;border:1px solid #e4dacb;border-top:4px solid {accent};border-radius:12px;background:#fffdf8;"><tr>
<td width="70%" valign="top" style="padding:22px 18px;border-right:1px solid #e4dacb;"><div style="font:700 10px Arial,sans-serif;letter-spacing:2px;color:#60665f;">YOUR TABLE</div><div style="font:700 24px/1.3 Georgia,serif;color:{primary};margin-top:10px;word-break:break-word;">{table or 'Ask an usher'}</div></td>
<td width="30%" valign="top" style="padding:22px 16px;"><div style="font:700 10px Arial,sans-serif;letter-spacing:2px;color:#60665f;">SEAT</div><div style="font:700 34px/1.2 Arial,sans-serif;color:{primary};margin-top:8px;">{seat or '—'}</div></td></tr></table>'''
    when = to_event_local(data.get('admitted_at'), data.get('event_timezone')) if data.get('admitted_at') else None
    time = esc(when.strftime('%I:%M %p').lstrip('0') + ' ' + when.strftime('%Z')) if when else ''
    date = esc(when.strftime('%a, %d %b %Y')) if when else ''
    recorded = f'<div style="margin-top:24px;padding-top:18px;border-top:1px solid #e4dacb;font:12px/1.8 Arial,sans-serif;color:#657165;">CHECK-IN RECORDED<br><strong style="font-size:15px;color:#253d32;">{time}</strong><br>{date}</div>' if when else ''
    link = data.get('hub_url') or ''
    parsed = urlparse(link)
    cta = f'<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:22px;"><tr><td bgcolor="{accent}" style="border-radius:8px;"><a href="{esc(link)}" style="display:inline-block;padding:14px 22px;font:700 14px Arial,sans-serif;color:{button_ink};text-decoration:none;">Open your event pass ↗</a></td></tr></table>' if parsed.scheme in ('http', 'https') and parsed.netloc else ''
    return f'''<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border:1px solid #e4dacb;border-radius:16px;overflow:hidden;background:#f8f3ea;">
<tr><td bgcolor="{primary}" style="padding:32px 26px;color:#ffffff;">
<div style="font:700 10px Arial,sans-serif;letter-spacing:2px;color:#ffffff;">CHECK-IN CONFIRMED</div>
<h1 style="font:400 38px/1.12 Georgia,serif;letter-spacing:-1px;margin:18px 0;color:#ffffff;">{heading}</h1>
<p style="font:600 14px/1.6 Arial,sans-serif;color:#ffffff;margin:0;">{name}</p></td></tr>
<tr><td style="padding:26px;"><h2 style="font:600 20px/1.4 Arial,sans-serif;color:#253d32;margin:0 0 8px;">Welcome, {first}.</h2>
{description_block}
{assignment}{recorded}{cta}
<p style="font:13px/1.8 Arial,sans-serif;color:#536155;margin:22px 0 0;">We’re glad you’re here. Enjoy every moment.</p>
</td></tr></table>'''
