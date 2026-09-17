from .community import (
    action,
    facts_markup,
    feature_markup,
    navigation_markup,
    render as render_community,
    safe_url,
    safe_destination,
    schedule_markup,
    speakers_markup,
    track_colors,
    track_markup,
)
from html import escape
from .templates import canonical_template


def render_site(content: dict, family: str, *, preview: bool = False) -> str:
    legacy_family = family
    family = canonical_template(family)
    if legacy_family == "community":
        return render_community(content, preview=preview)

    e = escape
    name = e(content.get("event_name", "Event"))
    headline = e(content.get("headline", name))
    summary = e(content.get("summary", ""))
    eyebrow = e(content.get("eyebrow", ""))
    date = " – ".join(filter(None, (content.get("start_date", ""), content.get("end_date", ""))))
    meta = " · ".join(e(x) for x in (date, content.get("venue", "")) if x)
    primary = e(content.get("primary_color", "#0d5c55"))
    accent = e(content.get("accent_color", "#d88945"))
    hero = safe_url(content.get("hero_image_url") or content.get("feature_image_url"))
    image_style = f"background-image:linear-gradient(90deg,rgba(0,0,0,.7),rgba(0,0,0,.15)),url('{hero}')" if hero else ""
    visible = set(content.get("visible_sections") or ["stats", "programme", "tracks", "connect"])

    stats = "".join(f'<div class="stat"><strong>{e(x.get("value",""))}</strong><b>{e(x.get("label",""))}</b></div>' for x in content.get("stats", [])[:6])
    glance = f'<section class="glance"><div class="stats">{stats}</div></section>' if "stats" in visible and stats else ""

    registration_facts = facts_markup(content.get("registration_facts"))
    registration = f'<section id="registration"><div class="eyebrow">Registration</div><h2>Register with confidence</h2>{action(content.get("primary_action"))}<div class="facts">{registration_facts}</div></section>' if content.get("registration_facts") else ""

    programme = ""
    if "programme" in visible:
        programme = f'<section id="programme"><div class="eyebrow">Programme</div><h2>{e(content.get("programme_title") or "Full programme")}</h2><p>{e(content.get("programme_summary") or "")}</p>{schedule_markup(content)}</section>'

    colors = track_colors(content)
    tracks = "".join(track_markup(x, i, colors) for i, x in enumerate(content.get("tracks", [])[:12]))
    audience = f'<section id="tracks"><div class="eyebrow">Programme tracks</div><h2>Choose your experience</h2><ul class="tracks">{tracks}</ul></section>' if "tracks" in visible and tracks else ""

    speakers = speakers_markup(content.get("speakers"))
    speakers_section = f'<section id="speakers"><div class="eyebrow">Presenters</div><h2>Featured speakers</h2><div class="speaker-grid">{speakers}</div></section>' if speakers else ""

    features = "".join(feature_markup(section, index) for index, section in enumerate(content.get("feature_sections") or []))

    venue_url = safe_url(content.get("venue_url"))
    venue_name = e(content.get("venue", ""))
    venue_address = e(content.get("venue_address", ""))
    venue_action = f'<a class="button secondary" href="{venue_url}" target="_blank" rel="noopener">Open directions</a>' if venue_url else ""
    venue_facts = facts_markup(content.get("venue_facts"))
    venue_heading = f'<a class="venue-heading-link" href="{venue_url}" target="_blank" rel="noopener"><h2>{venue_name or "Plan your arrival"}</h2><p>{venue_address}</p></a>' if venue_url else f'<h2>{venue_name or "Plan your arrival"}</h2><p>{venue_address}</p>'
    venue = f'<section id="venue"><div class="eyebrow">Venue &amp; travel</div>{venue_heading}{venue_action}<div class="facts">{venue_facts}</div></section>' if venue_name or venue_address or content.get("venue_facts") else ""

    live = action({"label": "Join Festio Live", "url": content.get("festio_live_url")}, "text-link") if content.get("festio_live_url") else ""
    me = action({"label": "Open GuestHub", "url": content.get("festiome_url")}, "text-link") if content.get("festiome_url") else ""
    live_title = e(content.get("festio_live_title") or "Festio Live")
    live_description = e(content.get("festio_live_description") or "Participate in live Q&A, polls and activities.")
    me_title = e(content.get("festiome_title") or "GuestHub")
    me_description = e(content.get("festiome_description") or "Your personal event hub, pass and programme.")
    live_panel = f'<div><strong>{live_title}</strong><p>{live_description}</p>{live}</div>' if live else ""
    me_panel = f'<div><strong>{me_title}</strong><p>{me_description}</p>{me}</div>' if me else ""
    connect = f'<section id="connect" class="connect">{live_panel}{me_panel}</section>' if "connect" in visible and (live or me) else ""

    faqs = "".join(f'<details><summary>{e(item.get("question", ""))}</summary><p>{e(item.get("answer", ""))}</p></details>' for item in content.get("faqs") or [])
    faq_section = f'<section id="faq"><div class="eyebrow">Helpful details</div><h2>Frequently asked questions</h2>{faqs}</section>' if faqs else ""

    contact_url = safe_destination("mailto:" + str(content.get("contact_email") or ""))
    contact = f'<section id="contact"><div class="eyebrow">Still have a question?</div><h2>Contact the event team</h2><a class="button" href="{contact_url}">Email us</a></section>' if contact_url else ""

    preview_bar = '<div class="preview">Preview — visitors cannot see this draft</div>' if preview else ""
    nav_links = navigation_markup(content)
    footer_links = navigation_markup(content, footer=True)
    family_label = {"conference-programme": "Build your agenda", "programme-showcase": "Explore every track", "immersive": "You are invited", "elegant-countdown": "The countdown is on"}.get(family, "Discover the event")

    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{name}</title><meta name="description" content="{summary[:200]}"><meta property="og:title" content="{headline}"><meta property="og:description" content="{summary[:200]}">{f'<meta property="og:image" content="{hero}">' if hero else ''}
<style>
:root{{--primary:{primary};--accent:{accent};--ink:#162522;--paper:#fbf8f2;--site-max-width:1280px;--content-max-width:1180px;--section-spacing:5rem;--card-radius:18px;--border:#e8e1d5;--shadow:0 18px 50px #182b2620}}
*{{box-sizing:border-box}}html{{scroll-behavior:smooth}}body{{margin:0;color:var(--ink);background:var(--paper);font:16px/1.55 Inter,system-ui,sans-serif}}a{{color:inherit}}
.preview{{background:#25143c;color:white;text-align:center;padding:.6rem;font-weight:700}}nav{{display:flex;align-items:center;gap:1.2rem;flex-wrap:wrap;padding:1.1rem max(5vw,24px);background:white;position:sticky;top:0;z-index:10}}nav b{{font-size:1.2rem;margin-right:auto}}nav span{{color:#60706c}}.site-links,.footer-links{{display:flex;gap:1rem;flex-wrap:wrap;align-items:center}}.site-links a,.footer-links a{{text-decoration:none;font-weight:700;font-size:.86rem}}
.hero{{min-height:65vh;padding:9vw max(6vw,30px);display:grid;align-content:center;background-size:cover;background-position:center;position:relative}}
.hero-inner{{max-width:780px}}.eyebrow{{text-transform:uppercase;letter-spacing:.18em;font-weight:800;color:var(--accent);font-size:.8rem}}h1{{font:700 clamp(3rem,8vw,7rem)/.94 Georgia,serif;margin:.25em 0}}h2{{font:700 clamp(1.8rem,3.4vw,2.8rem)/1.05 Georgia,serif;margin:.2em 0 .5em}}.lead{{font-size:clamp(1.05rem,2vw,1.35rem);max-width:680px}}.meta{{font-weight:700;margin:1.5rem 0}}
.actions{{display:flex;gap:.8rem;flex-wrap:wrap;margin-top:2rem}}.button{{background:var(--accent);color:#17110d;padding:.85rem 1.2rem;text-decoration:none;font-weight:800;border-radius:999px;display:inline-block;border:0}}.button.secondary,.button.outline{{background:transparent;border:1px solid currentColor;color:inherit}}
main{{max-width:var(--content-max-width);margin:auto;padding:var(--section-spacing) max(5vw,24px)}}main>section{{margin-bottom:var(--section-spacing)}}article{{background:white;border:1px solid var(--border);padding:1.4rem;border-radius:var(--card-radius)}}article h3{{margin:.45rem 0}}ul.tracks{{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1rem;padding:0;list-style:none}}ul.tracks .track{{background:color-mix(in srgb,var(--track-color) 12%,#fff)}}.track img,.track i{{width:44px;height:44px;object-fit:cover;border-radius:10px;display:grid;place-items:center;font-style:normal;font-size:20px;background:var(--track-color);color:#fff}}.track-jump{{display:inline-block;margin-top:.6rem;font-weight:800;font-size:.85rem;color:var(--track-color);text-decoration:none}}
.filter-radio{{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}}.schedule-filters{{display:flex;flex-direction:column;gap:.6rem;margin-bottom:1.4rem}}.day-tabs,.track-pills{{display:flex;gap:.5rem;flex-wrap:wrap}}.day-tab,.track-pill{{display:inline-block;border:1px solid #d9d1c5;background:#fff;color:var(--ink);padding:.6rem 1rem;border-radius:999px;font-weight:700;font-size:.85rem;cursor:pointer}}.day-tab small{{display:block;font-weight:600;font-size:.65rem;opacity:.75}}
.sessions{{display:grid;gap:.7rem}}.session{{display:grid;grid-template-columns:96px 1fr;gap:1.1rem}}.session:not(:has(.session-thumb)){{grid-template-columns:1fr}}.session-thumb{{width:96px;height:96px;object-fit:cover;border-radius:12px}}.session time{{color:var(--accent);font-weight:800}}.session-tag{{display:inline-block;background:var(--track-color,#6b746f);color:#fff;font-size:.7rem;font-weight:800;padding:.2rem .6rem;border-radius:999px;margin:.3rem 0}}.session-meta{{display:flex;gap:.9rem;flex-wrap:wrap;margin-top:.4rem;color:#65706c;font-size:.85rem}}.session-meta span{{display:inline-flex;align-items:center;gap:.3rem}}.speaker-line{{display:block;color:#65706c;margin-top:.3rem}}.session-action{{font-weight:800;color:var(--accent);display:inline-block;margin-top:.5rem}}
.speaker-grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1rem}}.speaker-card{{display:flex;gap:1rem;padding:1.2rem;border:1px solid #e5ded3;border-radius:14px;background:#fff}}.speaker-card img,.speaker-initial{{width:60px;height:70px;object-fit:cover;border-radius:8px;flex:0 0 auto}}.speaker-initial{{display:grid;place-items:center;background:var(--primary);color:#fff;font:700 1.6rem Georgia}}
.facts{{display:grid;grid-template-columns:repeat(2,1fr);gap:.7rem;margin-top:1rem}}.fact{{background:#fff;padding:1rem;border-radius:10px;border:1px solid #ece5d8}}.fact small{{display:block;text-transform:uppercase;font-size:.65rem;color:#7b746d;font-weight:900}}.fact b{{display:block}}
.feature{{display:grid;grid-template-columns:1fr 1fr;gap:2rem;align-items:center;background:#fff;border-radius:18px;padding:2rem!important;border:1px solid #ece5d8}}.feature.reverse{{direction:rtl}}.feature.reverse>*{{direction:ltr}}.feature-media img,.feature-pattern{{width:100%;border-radius:14px;min-height:220px;object-fit:cover;display:grid;place-items:center;background:var(--primary);color:#fff;font-size:3rem}}
.connect{{display:flex;gap:1rem;flex-wrap:wrap;background:var(--primary);color:white;padding:2rem;border-radius:24px}}.connect>div{{flex:1;min-width:220px}}.text-link{{font-weight:800;padding:.7rem 1rem;border:1px solid currentColor;border-radius:10px;text-decoration:none;display:inline-block;margin-top:.5rem}}
details{{border-top:1px solid #ddd5c9;padding:1.1rem 0}}summary{{cursor:pointer;font-weight:900;font-size:1.05rem}}details p{{color:#5f6d68}}
.venue-heading-link{{color:inherit;text-decoration:underline}}.venue-heading-link p{{text-decoration:none}}
footer{{padding:2rem 5vw;border-top:1px solid #ddd;display:flex;justify-content:space-between;flex-wrap:wrap;gap:1rem}}
.modern-professional .hero{{background-color:#092d50;color:white;border-radius:0 0 42px 42px}}
.clean-elegant{{--paper:#f8f5ee;--ink:#132921}}.clean-elegant .hero{{min-height:72vh;background-size:50% 78%;background-repeat:no-repeat;background-position:88% center}}.clean-elegant .hero-inner{{max-width:52%}}
.storytelling .hero,.immersive .hero{{min-height:82vh;color:white;background-position:center}}.storytelling .hero:after,.immersive .hero:after{{content:'';position:absolute;inset:0;background:linear-gradient(90deg,#071813dd 0%,#07181377 52%,transparent)}}.storytelling .hero-inner,.immersive .hero-inner{{position:relative;z-index:1}}.storytelling main>section{{border-left:4px solid var(--accent);padding-left:2rem}}
.bold-dynamic{{--paper:#071b3f;--ink:#f5f8ff}}.bold-dynamic nav,.bold-dynamic article,.bold-dynamic .fact,.bold-dynamic .day-tab,.bold-dynamic .track-pill{{background:#102752;color:#fff;border-color:#ffffff22}}.bold-dynamic .hero{{color:white;background-color:#071b3f;clip-path:polygon(0 0,100% 0,100% 88%,74% 100%,0 93%)}}.bold-dynamic h1{{font-family:Inter,sans-serif;text-transform:uppercase}}.bold-dynamic main{{color:#fff}}
.card-friendly{{--paper:#edf7f7;--card-radius:24px}}.card-friendly .hero{{min-height:56vh;margin:2rem auto;max-width:var(--site-max-width);border-radius:28px;background-color:#fff;box-shadow:var(--shadow)}}.card-friendly main>section{{background:#fff;padding:2.2rem;border-radius:24px;box-shadow:0 8px 25px #174b4210}}
.conference-programme .hero{{min-height:38vh;background-color:#f0eee9;border-left:16px solid var(--accent)}}.conference-programme h1,.programme-showcase h1{{font-family:Inter,system-ui,sans-serif;letter-spacing:-.06em}}.conference-programme #programme{{margin-top:-2rem;background:white;padding:2rem;border-radius:18px;box-shadow:var(--shadow)}}
.split-visual .hero{{min-height:68vh;background-size:52% 100%;background-repeat:no-repeat;background-position:right center}}.split-visual .hero-inner{{max-width:48%;position:relative;z-index:1}}.split-visual .hero:before{{content:'';position:absolute;inset:0 48% 0 0;background:linear-gradient(120deg,var(--paper) 80%,transparent 80%)}}
.immersive .hero{{min-height:88vh;text-align:center}}.immersive .hero-inner{{margin:auto}}.immersive .actions{{justify-content:center}}.immersive article{{border-radius:4px;border-color:var(--accent)}}
.programme-showcase #tracks{{margin-top:-2rem}}.programme-showcase ul.tracks{{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}}.programme-showcase .track{{min-height:210px;color:#fff;background:var(--track-color);display:flex;flex-direction:column;justify-content:end}}.programme-showcase .track-jump{{color:#fff}}
.elegant-countdown{{--paper:#071d31;--ink:#fff}}.elegant-countdown nav,.elegant-countdown footer{{background:#061725;color:#fff;border-color:#ffffff22}}.elegant-countdown .hero{{min-height:78vh;color:white;background-color:#071d31}}.elegant-countdown article,.elegant-countdown .fact{{background:#10283c;color:#fff;border-color:#ffffff22}}.elegant-countdown main{{color:#fff}}
@media(max-width:900px){{.clean-elegant .hero,.split-visual .hero{{background-size:100% 48%;background-position:center bottom;padding-bottom:52vh}}.clean-elegant .hero-inner,.split-visual .hero-inner{{max-width:100%}}}}
@media(max-width:900px){{.feature{{grid-template-columns:1fr}}.feature.reverse{{direction:ltr}}}}
@media(max-width:600px){{nav span,.site-links{{display:none}}.hero{{min-height:70vh}}h1{{font-size:3rem}}}}
</style></head><body class="{escape(family)}">{preview_bar}
<nav><b>{name}</b><div class="site-links">{nav_links}</div><span>{escape(family_label)}</span></nav>
<header class="hero" style="{image_style}"><div class="hero-inner"><div class="eyebrow">{eyebrow}</div><h1>{headline}</h1><p class="lead">{summary}</p><div class="meta">{meta}</div><div class="actions">{action(content.get("primary_action"))}{action(content.get("secondary_action"), "button outline")}</div></div></header>
<main>{glance}{registration}{programme}{audience}{speakers_section}{features}{venue}{connect}{faq_section}{contact}</main>
<footer><span>Powered by Festio</span><div class="footer-links">{footer_links}</div></footer></body></html>'''
