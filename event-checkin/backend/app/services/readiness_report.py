"""Event readiness audit — a super-admin tool that inspects an event's config,
guests, messaging, and Experience journey, computes readiness findings, and
renders a self-contained HTML report the operator can review or email to the
event owner. Pure read-only.
"""
from __future__ import annotations

import html
from datetime import datetime

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import (
    Event, Guest, MessageTemplate, ExperienceWorkflow, ExperienceStep,
    GuestExperienceProgress, MessageCreditLedger, RSVPQuestion, Membership, User,
)

_PAID = ("sms", "mms", "whatsapp")
_DOW = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]


def _fmt_date(dt) -> str:
    try:
        return dt.strftime("%a %b %-d, %Y · %-I:%M %p")
    except Exception:
        try:
            return dt.strftime("%a %b %d, %Y")
        except Exception:
            return ""


def _fmt_time(t: str) -> str:
    """'19:00' -> '7:00 PM'."""
    try:
        h, m = (int(x) for x in t.split(":")[:2])
        ap = "AM" if h < 12 else "PM"
        hh = h % 12 or 12
        return f"{hh}:{m:02d} {ap}"
    except Exception:
        return t or ""


def _day_where(date_str: str) -> str:
    try:
        d = datetime.strptime(date_str, "%Y-%m-%d")
        return f"{_DOW[d.weekday()]} {d.month}/{d.day}"
    except Exception:
        return date_str or ""


async def build_readiness(event: Event, db: AsyncSession) -> dict:
    """Gather data + compute findings. Generic across events."""
    guests = (await db.execute(select(Guest).where(Guest.event_id == event.id))).scalars().all()
    n = len(guests)
    with_phone = sum(1 for g in guests if g.phone)
    with_email = sum(1 for g in guests if g.email)
    qr_gen = sum(1 for g in guests if g.qr_generated_at)
    invited = sum(1 for g in guests if g.invite_sent_at)
    admitted = sum(1 for g in guests if g.admitted)
    looks_test = sum(1 for g in guests if (g.first_name or "").strip().lower().startswith("test"))

    templates = (await db.execute(
        select(MessageTemplate).where(MessageTemplate.event_id == event.id))).scalars().all()
    tpl_rows = []
    for m in sorted(templates, key=lambda x: x.template_key):
        chans = [c for c, v in (("Email", m.email_body), ("SMS", m.sms_body),
                                ("WhatsApp", m.whatsapp_body), ("MMS", m.mms_body)) if v]
        tpl_rows.append({"key": m.template_key, "subject": m.subject or "", "channels": chans})

    # Experience workflow + steps (with session/room schedule)
    wf = (await db.execute(
        select(ExperienceWorkflow).where(ExperienceWorkflow.event_id == event.id))).scalars().first()
    steps_out = []
    session_dates = set()
    step_count = 0
    if wf:
        steps = (await db.execute(
            select(ExperienceStep).where(ExperienceStep.workflow_id == wf.id, ExperienceStep.enabled == True)
            .order_by(ExperienceStep.sort_order))).scalars().all()
        step_count = len(steps)
        for s in steps:
            cfg = s.config or {}
            when = ""
            sess = cfg.get("session") if isinstance(cfg.get("session"), dict) else None
            room = ""
            if sess:
                date = sess.get("date", "")
                if date:
                    session_dates.add(date)
                bits = [_day_where(date)]
                if sess.get("start_time"):
                    tr = _fmt_time(sess["start_time"])
                    if sess.get("end_time"):
                        tr += "–" + _fmt_time(sess["end_time"])
                    bits.append(tr)
                if sess.get("room"):
                    bits.append(sess["room"])
                if sess.get("speaker") and sess["speaker"] != "Convention Host":
                    bits.append(sess["speaker"])
                when = " · ".join([b for b in bits if b])
                room = sess.get("room", "")
            ra = cfg.get("room_assignment") if isinstance(cfg.get("room_assignment"), dict) else None
            if ra and not when:
                when = ra.get("room", "") or "Staff-assigned"
                room = ra.get("room", "")
            steps_out.append({
                "order": s.sort_order, "key": s.key, "type": s.type.replace("_", " "),
                "title": s.title, "required": s.required, "when": when, "room": room,
            })

    # Credits / messaging ledger
    ledger = (await db.execute(
        select(MessageCreditLedger.channel, MessageCreditLedger.action, func.count())
        .where(MessageCreditLedger.event_id == event.id)
        .group_by(MessageCreditLedger.channel, MessageCreditLedger.action))).all()
    sent_any = any(a == "spend" for _, a, _ in ledger)

    questions = (await db.execute(
        select(func.count()).select_from(RSVPQuestion).where(RSVPQuestion.event_id == event.id))).scalar() or 0

    # Owner email (org owner) for send-to-owner
    owner_email = None
    owner_row = (await db.execute(
        select(User.email).join(Membership, Membership.user_id == User.id)
        .where(Membership.org_id == event.org_id, Membership.role == "owner")
        .order_by(User.email).limit(1))).first()
    if owner_row:
        owner_email = owner_row[0]

    paid_on = [c for c in _PAID if getattr(event, f"notify_{c}", False)]
    paid_active = bool(event.is_paid and event.paid_channels and paid_on)

    # ── Findings (generic) ──
    findings = []

    def add(sev, area, title, detail):
        findings.append({"sev": sev, "area": area, "title": title, "detail": detail})

    if n == 0:
        add("crit", "Guests", "No guests loaded",
            "There are no guests on this event yet. Import the attendee list before sending invites.")
    elif looks_test == n or (event.guest_cap and n <= max(2, event.guest_cap * 0.1)):
        add("crit", "Guests", "Real attendee list not loaded",
            f"Only {n} guest(s) are loaded"
            + (f" of a {event.guest_cap} cap" if event.guest_cap else "")
            + (" — and they look like test records" if looks_test else "")
            + ". Import the real list before go-live.")

    if n and paid_active and with_phone < n:
        add("warn", "Guests", "Low phone coverage",
            f"Only {with_phone} of {n} guest(s) have a phone number, but SMS/MMS/WhatsApp are enabled — "
            "guests without a phone can't be reached on those channels.")

    if looks_test and looks_test < n:
        add("warn", "Data hygiene", "Test records present",
            f"{looks_test} guest(s) look like test data. Remove them before go-live so counts and reports start clean.")
    elif looks_test == n and n:
        add("warn", "Data hygiene", "Remove test records before go-live",
            "The current guests appear to be test records — clear them once the real list is loaded.")

    if event.invite_mode == "closed" and not event.rsvp_enabled:
        add("warn", "RSVP", "RSVP form is off",
            "This event is invitation-only with the RSVP form disabled — every invited guest gets a pass directly, "
            "with no confirm/decline step and no attending headcount. Turn RSVP on if you want confirmations.")

    if paid_active and (event.message_credits or 0) < max(10, n * 2):
        add("warn", "Messaging", "Message credits may be low",
            f"{event.message_credits or 0} credits remain for {n or '—'} guest(s) across SMS/MMS/WhatsApp "
            "(MMS costs 3 each). Top up in Event Setup → Event Pass if you plan multiple sends.")

    if event.experience_enabled and (not wf or step_count == 0):
        add("warn", "Experience", "Experience on, but no journey built",
            "The Experience add-on is enabled but there's no active workflow with steps. Build the guest journey or turn it off.")

    if len(session_dates) > 1:
        ds = sorted(session_dates)
        add("info", "Schedule", "Multi-day event",
            f"Sessions span {len(session_dates)} days ({ds[0]} → {ds[-1]}). Make sure guest comms state the full date range — "
            "the event's single start time doesn't convey it.")

    if event.logistics_enabled:
        add("info", "Logistics", "Confirm fulfillment is set up",
            "Logistics is on — confirm packing/fulfillment is configured for any welcome-pack or gift pickups in the journey.")

    # Overall verdict
    order = {"crit": 0, "warn": 1, "info": 2, "good": 3}
    worst = min((f["sev"] for f in findings), default="good", key=lambda s: order[s])
    verdict = {"crit": ("NOT READY", "Blocking items must be resolved before go-live."),
               "warn": ("NEARLY READY", "The build is solid; a few items need confirmation or cleanup."),
               "info": ("READY", "Everything essential is in place — see notes below."),
               "good": ("READY", "Everything essential is in place.")}[worst]

    return {
        "event": event, "n": n, "with_phone": with_phone, "with_email": with_email,
        "qr_gen": qr_gen, "invited": invited, "admitted": admitted, "looks_test": looks_test,
        "questions": questions, "templates": tpl_rows, "workflow": wf, "steps": steps_out,
        "step_count": step_count, "session_dates": sorted(session_dates), "sent_any": sent_any,
        "paid_on": paid_on, "paid_active": paid_active, "owner_email": owner_email,
        "findings": findings, "verdict_label": verdict[0], "verdict_text": verdict[1], "worst": worst,
        "generated_at": datetime.utcnow(),
    }


# ── HTML rendering ──────────────────────────────────────────────────────────

_SEV_PILL = {"crit": ("crit", "Critical"), "warn": ("warn", "Confirm"),
             "info": ("info", "Note"), "good": ("good", "OK")}


def _e(s) -> str:
    return html.escape(str(s if s is not None else ""))


def render_readiness_html(d: dict) -> str:
    ev = d["event"]
    date_str = _fmt_date(getattr(ev, "event_date", None))
    verdict_cls = {"crit": "crit", "warn": "warn", "info": "good", "good": "good"}[d["worst"]]

    # Scorecard
    def area_status():
        cards = []
        # Messaging
        cards.append(("Messaging", "Channels configured",
                      "good" if d["paid_active"] or ev.notify_email else "warn",
                      "Ready" if (d["paid_active"] or ev.notify_email) else "Review",
                      f"{', '.join([c.upper() for c in d['paid_on']]) or 'Email'} enabled · {ev.message_credits or 0} credits"))
        # Experience
        if ev.experience_enabled:
            ok = d["workflow"] and d["step_count"] > 0
            cards.append(("Experience journey", f"{d['step_count']} steps" if ok else "Not built",
                          "good" if ok else "warn", "Ready" if ok else "Action needed",
                          (f"{len(d['session_dates'])}-day schedule" if len(d["session_dates"]) > 1 else "Configured") if ok else "Enable a workflow"))
        # Guests
        g_sev = "crit" if any(f["area"] == "Guests" and f["sev"] == "crit" for f in d["findings"]) else \
                ("warn" if any(f["area"] == "Guests" for f in d["findings"]) else "good")
        cards.append(("Guest list", f"{d['n']}" + (f" / {ev.guest_cap}" if ev.guest_cap else "") + " loaded",
                      g_sev, {"crit": "Action needed", "warn": "Review", "good": "Ready"}[g_sev],
                      f"{d['with_phone']} with phone · {d['with_email']} with email"))
        return cards

    score_html = ""
    for area, headline, sev, label, note in area_status():
        score_html += f"""
        <div class="score"><div class="area">{_e(area)}</div>
          <div class="headline">{_e(headline)}</div>
          <span class="pill {sev}">{_e(label)}</span>
          <div class="note">{_e(note)}</div></div>"""

    # Action checklist
    if d["findings"]:
        items = ""
        for f in d["findings"]:
            pill_cls, pill_txt = _SEV_PILL[f["sev"]]
            items += f"""
            <li class="{f['sev']}"><label><input type="checkbox" />
              <span class="t">{_e(f['title'])} <span class="pill {pill_cls}">{_e(pill_txt)}</span>
              <span class="area-tag">{_e(f['area'])}</span></span>
              <span class="d">{_e(f['detail'])}</span></label></li>"""
        actions_html = f'<ol class="actions">{items}</ol>'
    else:
        actions_html = '<p class="allgood">✓ No blocking issues found — this event looks ready.</p>'

    # Config chips
    def chip(label, on):
        return f'<span class="chip {"on" if on else "off"}">{_e(label)}</span>'
    addons = "".join(chip(l, getattr(ev, a, False)) for l, a in
                     [("Experience", "experience_enabled"), ("Seating", "seating_enabled"),
                      ("Logistics", "logistics_enabled"), ("Menu", "menu_enabled"),
                      ("Registry", "registry_enabled"), ("Venue Access", "venue_access_enabled"),
                      ("Check-out", "checkout_enabled")])
    channels = "".join(chip(l, getattr(ev, a, False)) for l, a in
                       [("Email", "notify_email"), ("SMS", "notify_sms"),
                        ("MMS", "notify_mms"), ("WhatsApp", "notify_whatsapp")])

    # Templates
    tpl_html = ""
    for t in d["templates"]:
        tpl_html += f'<tr><td class="code">{_e(t["key"])}</td><td>{_e(t["subject"][:60])}</td><td>{_e(" · ".join(t["channels"]))}</td></tr>'
    if not tpl_html:
        tpl_html = '<tr><td colspan="3" class="muted">No custom templates — event uses platform defaults.</td></tr>'

    # Experience steps
    steps_html = ""
    for i, s in enumerate(d["steps"], 1):
        steps_html += (f'<tr><td class="num">{i}</td><td>{_e(s["title"])}</td>'
                       f'<td class="ty">{_e(s["type"])}</td><td>{_e(s["when"])}</td>'
                       f'<td class="req">{"req" if s["required"] else "opt"}</td></tr>')
    exp_section = ""
    if ev.experience_enabled and d["steps"]:
        exp_section = f"""
      <section>
        <h2><span class="num">06</span> Experience journey</h2>
        <p class="sub"><strong>{_e(d['workflow'].name if d['workflow'] else 'Guest Journey')}</strong> —
          {d['step_count']} steps{', across ' + str(len(d['session_dates'])) + ' days' if len(d['session_dates'])>1 else ''}.
          Each step gates on prerequisites; sessions carry date, time, room, capacity and a check-in window.</p>
        <div class="card tbl-scroll"><table>
          <thead><tr><th>#</th><th>Step</th><th>Type</th><th>When / where</th><th>Req.</th></tr></thead>
          <tbody>{steps_html}</tbody></table></div>
      </section>"""

    gen = d["generated_at"].strftime("%b %d, %Y %H:%M UTC")
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>{_e(ev.name)} — Readiness Audit</title>
<style>
:root{{--ground:#f6f5f1;--surface:#fff;--surface-2:#fbfaf7;--border:#e4e1d8;--ink:#1b241f;--muted:#5c645e;--faint:#8a908a;--accent:#0f766e;--accent-soft:#dcf0ec;--good:#157347;--good-soft:#e0f0e4;--warn:#a95a08;--warn-soft:#f6ead2;--crit:#be123c;--crit-soft:#f8dde3;--shadow:0 1px 2px rgba(27,36,31,.05),0 8px 24px rgba(27,36,31,.05);--serif:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;--sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;--mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;}}
@media(prefers-color-scheme:dark){{:root{{--ground:#0d1412;--surface:#151f1c;--surface-2:#101917;--border:#26332e;--ink:#e9f1ed;--muted:#a3aca6;--faint:#727a75;--accent:#2dd4bf;--accent-soft:#113630;--good:#4ade80;--good-soft:#123023;--warn:#e8a54c;--warn-soft:#3a2c14;--crit:#fb7185;--crit-soft:#3a1720;--shadow:0 1px 2px rgba(0,0,0,.3),0 10px 30px rgba(0,0,0,.35);}}}}
*{{box-sizing:border-box;}}body{{margin:0;background:var(--ground);color:var(--ink);font-family:var(--sans);line-height:1.55;-webkit-font-smoothing:antialiased;}}
.wrap{{max-width:920px;margin:0 auto;padding:36px 22px 80px;}}
.eyebrow{{font-family:var(--mono);font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--accent);font-weight:600;}}
header.m{{border:1px solid var(--border);background:var(--surface);border-radius:16px;padding:28px 30px;box-shadow:var(--shadow);position:relative;overflow:hidden;}}
header.m::before{{content:"";position:absolute;inset:0 auto 0 0;width:5px;background:var(--accent);}}
h1{{font-family:var(--serif);font-weight:600;font-size:clamp(26px,4.4vw,38px);line-height:1.08;margin:9px 0 4px;text-wrap:balance;}}
.host{{color:var(--muted);font-size:15px;margin:0 0 18px;}}
.meta{{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:15px 20px;border-top:1px solid var(--border);padding-top:17px;}}
.meta .k{{font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);}}
.meta .v{{font-size:14px;font-weight:550;margin-top:3px;}}.meta .v small{{display:block;font-weight:400;color:var(--muted);font-size:12px;}}
.verdict{{margin-top:20px;display:flex;gap:13px;align-items:flex-start;border-radius:12px;padding:14px 17px;}}
.verdict.warn{{background:var(--warn-soft);border:1px solid color-mix(in srgb,var(--warn) 30%,transparent);}}
.verdict.crit{{background:var(--crit-soft);border:1px solid color-mix(in srgb,var(--crit) 30%,transparent);}}
.verdict.good{{background:var(--good-soft);border:1px solid color-mix(in srgb,var(--good) 30%,transparent);}}
.verdict p{{margin:0;font-size:14px;}}
.badge{{font-size:11px;font-weight:700;padding:4px 11px;border-radius:999px;white-space:nowrap;}}
.badge.warn{{color:var(--warn);background:var(--warn-soft);}}.badge.crit{{color:var(--crit);background:var(--crit-soft);}}.badge.good{{color:var(--good);background:var(--good-soft);}}
section{{margin-top:36px;}}h2{{font-family:var(--serif);font-weight:600;font-size:21px;margin:0 0 3px;display:flex;gap:11px;align-items:baseline;}}
h2 .num{{font-family:var(--mono);font-size:12px;color:var(--accent);font-weight:600;}}.sub{{color:var(--muted);font-size:13px;margin:0 0 16px;}}
.scorecard{{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:13px;}}
.score{{border:1px solid var(--border);background:var(--surface);border-radius:13px;padding:15px 15px;box-shadow:var(--shadow);}}
.score .area{{font-size:12px;color:var(--muted);font-weight:600;}}.score .headline{{font-family:var(--serif);font-size:16px;margin:7px 0;}}.score .note{{font-size:12px;color:var(--muted);margin-top:8px;}}
.pill{{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:650;padding:3px 10px;border-radius:999px;white-space:nowrap;}}
.pill::before{{content:"";width:7px;height:7px;border-radius:50%;background:currentColor;}}
.pill.good{{color:var(--good);background:var(--good-soft);}}.pill.warn{{color:var(--warn);background:var(--warn-soft);}}.pill.crit{{color:var(--crit);background:var(--crit-soft);}}.pill.info{{color:var(--accent);background:var(--accent-soft);}}
ol.actions{{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:11px;}}
ol.actions li{{background:var(--surface);border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow);}}
ol.actions li.crit{{border-left:4px solid var(--crit);}}ol.actions li.warn{{border-left:4px solid var(--warn);}}ol.actions li.info{{border-left:4px solid var(--accent);}}
ol.actions label{{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;padding:14px 16px;cursor:pointer;align-items:start;}}
ol.actions input{{margin-top:3px;width:16px;height:16px;accent-color:var(--accent);grid-row:span 2;}}
ol.actions .t{{font-weight:650;font-size:14px;display:flex;gap:9px;align-items:center;flex-wrap:wrap;}}
ol.actions .d{{font-size:13px;color:var(--muted);}}
.area-tag{{font-family:var(--mono);font-size:10px;color:var(--faint);letter-spacing:.05em;text-transform:uppercase;}}
.allgood{{background:var(--good-soft);border:1px solid color-mix(in srgb,var(--good) 30%,transparent);color:var(--good);border-radius:12px;padding:16px;font-weight:600;}}
.two{{display:grid;grid-template-columns:1fr 1fr;gap:20px;}}@media(max-width:700px){{.two{{grid-template-columns:1fr;}}}}
.card{{border:1px solid var(--border);background:var(--surface);border-radius:14px;box-shadow:var(--shadow);overflow:hidden;}}
.tbl-scroll{{overflow-x:auto;}}table{{border-collapse:collapse;width:100%;font-size:13px;}}
th,td{{text-align:left;padding:10px 15px;border-bottom:1px solid var(--border);vertical-align:top;}}
th{{font-family:var(--mono);font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:var(--faint);font-weight:600;background:var(--surface-2);}}
tbody tr:last-child td{{border-bottom:none;}}td.num{{text-align:right;font-variant-numeric:tabular-nums;}}
.code{{font-family:var(--mono);font-size:11.5px;color:var(--accent);}}.ty{{color:var(--muted);}}.req{{font-family:var(--mono);font-size:10px;color:var(--faint);}}.muted{{color:var(--muted);}}
.kv{{display:grid;grid-template-columns:auto 1fr;gap:7px 14px;font-size:13px;padding:14px 16px;}}.kv dt{{color:var(--muted);}}.kv dd{{margin:0;font-weight:550;text-align:right;}}
.chiprow{{display:flex;flex-wrap:wrap;gap:7px;}}.chip{{font-size:11.5px;padding:4px 10px;border-radius:8px;border:1px solid var(--border);background:var(--surface-2);font-weight:500;}}
.chip.on{{border-color:color-mix(in srgb,var(--good) 40%,var(--border));color:var(--good);background:var(--good-soft);}}.chip.off{{color:var(--faint);}}
footer{{margin-top:44px;padding-top:18px;border-top:1px solid var(--border);font-size:12px;color:var(--faint);display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;}}
</style></head><body><div class="wrap">
  <header class="m">
    <div class="eyebrow">Event Readiness Audit</div>
    <h1>{_e(ev.name)}</h1>
    <p class="host">{_e(ev.couples_name or 'Organizer')}{' · ' + _e(ev.venue_name) if ev.venue_name else ''}</p>
    <div class="meta">
      <div><div class="k">Date</div><div class="v">{_e(date_str) or '—'}</div></div>
      <div><div class="k">Venue</div><div class="v">{_e(ev.venue_name or '—')}<small>{_e(ev.venue_address or '')}</small></div></div>
      <div><div class="k">Plan</div><div class="v">{_e(ev.plan_tier if ev.is_paid else 'Free')}<small>{('cap ' + str(ev.guest_cap)) if ev.guest_cap else ''}</small></div></div>
      <div><div class="k">Invite mode</div><div class="v">{_e(ev.invite_mode)}</div></div>
      <div><div class="k">Credits</div><div class="v">{ev.message_credits or 0}</div></div>
      <div><div class="k">Status</div><div class="v">{_e(ev.status)}</div></div>
    </div>
    <div class="verdict {verdict_cls}"><span class="badge {verdict_cls}">{_e(d['verdict_label'])}</span>
      <p>{_e(d['verdict_text'])}</p></div>
  </header>

  <section><h2><span class="num">01</span> Readiness scorecard</h2>
    <p class="sub">Status of each area at a glance.</p>
    <div class="scorecard">{score_html}</div></section>

  <section><h2><span class="num">02</span> Action checklist</h2>
    <p class="sub">Tick items as you resolve them. Ordered by priority.</p>
    {actions_html}</section>

  <section><h2><span class="num">03</span> Configuration</h2>
    <div class="two">
      <div class="card"><dl class="kv">
        <dt>Host</dt><dd>{_e(ev.couples_name or '—')}</dd>
        <dt>Invite mode</dt><dd>{_e(ev.invite_mode)}</dd>
        <dt>RSVP form</dt><dd>{'On' if ev.rsvp_enabled else 'Off'}</dd>
        <dt>Capacity</dt><dd>{ev.guest_cap or '—'}</dd>
        <dt>Plan</dt><dd>{_e(ev.plan_tier if ev.is_paid else 'Free')}</dd>
        <dt>Credits</dt><dd>{ev.message_credits or 0}</dd>
      </dl></div>
      <div class="card" style="padding:15px 16px">
        <div class="eyebrow" style="color:var(--faint)">Add-ons</div>
        <div class="chiprow" style="margin:11px 0 15px">{addons}</div>
        <div class="eyebrow" style="color:var(--faint)">Channels</div>
        <div class="chiprow" style="margin-top:11px">{channels}</div>
      </div>
    </div></section>

  <section><h2><span class="num">04</span> Guests</h2>
    <div class="card tbl-scroll"><table>
      <thead><tr><th>Metric</th><th class="num">Value</th></tr></thead><tbody>
      <tr><td>Loaded</td><td class="num">{d['n']}{' / ' + str(ev.guest_cap) if ev.guest_cap else ''}</td></tr>
      <tr><td>With email</td><td class="num">{d['with_email']}</td></tr>
      <tr><td>With phone (SMS/MMS/WhatsApp)</td><td class="num">{d['with_phone']}</td></tr>
      <tr><td>Pass / QR generated</td><td class="num">{d['qr_gen']}</td></tr>
      <tr><td>Invites sent</td><td class="num">{d['invited']}</td></tr>
      <tr><td>Checked in</td><td class="num">{d['admitted']}</td></tr>
      <tr><td>Custom RSVP questions</td><td class="num">{d['questions']}</td></tr>
      </tbody></table></div></section>

  <section><h2><span class="num">05</span> Messaging &amp; templates</h2>
    <p class="sub">{len(d['templates'])} customized template(s) · {', '.join([c.upper() for c in d['paid_on']]) or 'Email only'} · {ev.message_credits or 0} credits.</p>
    <div class="card tbl-scroll"><table>
      <thead><tr><th>Template</th><th>Subject</th><th>Channels</th></tr></thead>
      <tbody>{tpl_html}</tbody></table></div></section>
  {exp_section}
  <footer><span>Generated {_e(gen)} · event {_e(str(ev.id)[:8])}…</span><span>Festio · Readiness Audit</span></footer>
</div></body></html>"""
