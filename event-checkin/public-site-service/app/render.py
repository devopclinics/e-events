from html import escape
from urllib.parse import urlparse


def _safe_url(value) -> str:
    if not value:
        return ""
    url = str(value)
    return escape(url) if urlparse(url).scheme in ("http", "https") else ""


def _action(link, cls="button") -> str:
    if not link:
        return ""
    return f'<a class="{cls}" href="{_safe_url(link.get("url"))}">{escape(link.get("label", "Open"))}</a>'


def render_site(content: dict, family: str, *, preview: bool = False) -> str:
    name = escape(content.get("event_name", "Event"))
    headline = escape(content.get("headline", name))
    summary = escape(content.get("summary", ""))
    eyebrow = escape(content.get("eyebrow", ""))
    date = " – ".join(filter(None, (content.get("start_date", ""), content.get("end_date", ""))))
    meta = " · ".join(escape(x) for x in (date, content.get("venue", "")) if x)
    primary = escape(content.get("primary_color", "#0d5c55"))
    accent = escape(content.get("accent_color", "#d88945"))
    hero = _safe_url(content.get("hero_image_url"))
    image_style = f"background-image:linear-gradient(90deg,rgba(0,0,0,.7),rgba(0,0,0,.15)),url('{hero}')" if hero else ""
    sessions = "".join(
        f'<article><time>{escape(s.get("time", ""))}</time><h3>{escape(s.get("title", ""))}</h3><p>{escape(" · ".join(filter(None, (s.get("venue", ""), s.get("audience", "")))))}</p></article>'
        for s in content.get("sessions", [])
    )
    highlights = "".join(f"<li>{escape(str(item))}</li>" for item in content.get("highlights", []))
    live = _action({"label": "Join Festio Live", "url": content.get("festio_live_url")}, "text-link") if content.get("festio_live_url") else ""
    me = _action({"label": "Open FestioMe", "url": content.get("festiome_url")}, "text-link") if content.get("festiome_url") else ""
    preview_bar = '<div class="preview">Preview — visitors cannot see this draft</div>' if preview else ""
    family_label = {"community": "Gather together", "conference": "Build your agenda", "celebration": "You are invited"}.get(family, "Discover the event")
    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{name}</title><meta name="description" content="{summary[:200]}">
<style>
:root{{--primary:{primary};--accent:{accent};--ink:#162522;--paper:#fbf8f2}}
*{{box-sizing:border-box}}body{{margin:0;color:var(--ink);background:var(--paper);font:16px/1.55 Inter,system-ui,sans-serif}}a{{color:inherit}}
.preview{{background:#25143c;color:white;text-align:center;padding:.6rem;font-weight:700}}nav{{display:flex;justify-content:space-between;align-items:center;padding:1.1rem max(5vw,24px);background:white}}nav b{{font-size:1.2rem}}nav span{{color:#60706c}}
.hero{{min-height:65vh;padding:9vw max(6vw,30px);display:grid;align-content:center;background-size:cover;background-position:center;position:relative}}
.hero-inner{{max-width:780px}}.eyebrow{{text-transform:uppercase;letter-spacing:.18em;font-weight:800;color:var(--accent)}}h1{{font:700 clamp(3rem,8vw,7rem)/.94 Georgia,serif;margin:.25em 0}}.lead{{font-size:clamp(1.05rem,2vw,1.35rem);max-width:680px}}.meta{{font-weight:700;margin:1.5rem 0}}
.actions{{display:flex;gap:.8rem;flex-wrap:wrap;margin-top:2rem}}.button{{background:var(--accent);color:#17110d;padding:.85rem 1.2rem;text-decoration:none;font-weight:800;border-radius:999px}}.button.secondary{{background:transparent;border:1px solid currentColor}}
main{{max-width:1180px;margin:auto;padding:5rem max(5vw,24px)}}section{{margin-bottom:5rem}}h2{{font:700 clamp(2rem,4vw,3.5rem)/1.05 Georgia,serif}}.schedule{{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1rem}}article{{background:white;border:1px solid #e8e1d5;padding:1.4rem;border-radius:18px}}article time{{color:var(--accent);font-weight:800}}article h3{{margin:.45rem 0}}ul{{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1rem;padding:0;list-style:none}}li{{padding:1.2rem;border-top:3px solid var(--accent);background:white}}.community .hero{{background-color:var(--primary);color:white;border-radius:0 0 48px 48px}}.conference .hero{{background-color:#f0eee9;border-left:16px solid var(--accent)}}.conference h1{{font-family:Inter,system-ui,sans-serif;letter-spacing:-.06em}}.celebration .hero{{text-align:center;background-color:#35102d;color:white}}.celebration .hero-inner{{margin:auto}}.celebration .actions{{justify-content:center}}.celebration article{{border-radius:0;border-color:var(--accent)}}
.connect{{display:flex;gap:1rem;flex-wrap:wrap;background:var(--primary);color:white;padding:2rem;border-radius:24px}}.text-link{{font-weight:800;padding:.7rem 1rem;border:1px solid currentColor;border-radius:10px;text-decoration:none}}footer{{padding:2rem 5vw;border-top:1px solid #ddd;display:flex;justify-content:space-between}}
@media(max-width:600px){{nav span{{display:none}}.hero{{min-height:70vh}}h1{{font-size:3rem}}}}
</style></head><body class="{escape(family)}">{preview_bar}
<nav><b>{name}</b><span>{escape(family_label)}</span></nav>
<header class="hero" style="{image_style}"><div class="hero-inner"><div class="eyebrow">{eyebrow}</div><h1>{headline}</h1><p class="lead">{summary}</p><div class="meta">{meta}</div><div class="actions">{_action(content.get("primary_action"))}{_action(content.get("secondary_action"), "button secondary")}</div></div></header>
<main><section><div class="eyebrow">Programme</div><h2>Plan your experience</h2><div class="schedule">{sessions or '<p>The programme will be announced soon.</p>'}</div></section>
<section><div class="eyebrow">What to expect</div><h2>More than a date on the calendar</h2><ul>{highlights}</ul></section>
<section class="connect"><div><strong>Stay connected during the event</strong><br>Participation and community use your existing Festio pass.</div>{live}{me}</section></main>
<footer><span>Powered by Festio</span><span>{escape(content.get("contact_email", ""))}</span></footer></body></html>'''

