"""Read-only event readiness audit used by the platform operator console."""
from __future__ import annotations

import html
from datetime import datetime

from sqlalchemy import func, select

from app.models import Event, ExperienceStep, ExperienceWorkflow, Guest, Membership, MessageTemplate, RSVPQuestion, User


def _e(value) -> str:
    return html.escape(str(value if value is not None else ""))


def _when(config: dict | None) -> str:
    cfg = config or {}
    session = cfg.get("session") if isinstance(cfg.get("session"), dict) else {}
    parts = [session.get("date"), session.get("start_time"), session.get("end_time"), session.get("room"), session.get("speaker")]
    return " · ".join(str(x) for x in parts if x)


async def build_readiness(event: Event, db) -> dict:
    guests = (await db.execute(select(Guest).where(Guest.event_id == event.id))).scalars().all()
    templates = (await db.execute(select(MessageTemplate).where(MessageTemplate.event_id == event.id))).scalars().all()
    workflow = (await db.execute(select(ExperienceWorkflow).where(
        ExperienceWorkflow.event_id == event.id, ExperienceWorkflow.status == "published"
    ).order_by(ExperienceWorkflow.version.desc()))).scalars().first()
    if not workflow:
        workflow = (await db.execute(select(ExperienceWorkflow).where(
            ExperienceWorkflow.event_id == event.id
        ).order_by(ExperienceWorkflow.version.desc()))).scalars().first()
    steps = []
    if workflow:
        steps = (await db.execute(select(ExperienceStep).where(
            ExperienceStep.workflow_id == workflow.id, ExperienceStep.enabled.is_(True)
        ).order_by(ExperienceStep.sort_order))).scalars().all()
    owner = (await db.execute(select(User.email).join(Membership, Membership.user_id == User.id).where(
        Membership.org_id == event.org_id, Membership.role == "owner"
    ).order_by(User.email).limit(1))).scalar_one_or_none()
    questions = await db.scalar(select(func.count()).select_from(RSVPQuestion).where(RSVPQuestion.event_id == event.id)) or 0
    phones = sum(bool(g.phone) for g in guests)
    tests = sum((g.first_name or "").strip().lower().startswith("test") for g in guests)
    findings = []
    def add(level, area, title, detail): findings.append(dict(level=level, area=area, title=title, detail=detail))
    if not guests:
        add("critical", "Guests", "No guests loaded", "Import the attendee list before sending invitations.")
    elif len(guests) <= max(2, int((event.guest_cap or 20) * .1)):
        add("critical", "Guests", "Real guest list may not be loaded", f"Only {len(guests)} guest(s) are loaded against a cap of {event.guest_cap or '—'}.")
    if tests:
        add("warning", "Data hygiene", "Test records are present", f"Remove {tests} apparent test guest(s) before go-live.")
    paid_channels = [c for c in ("sms", "mms", "whatsapp") if getattr(event, f"notify_{c}", False)]
    if paid_channels and phones < len(guests):
        add("warning", "Messaging", "Some guests have no phone", f"{phones} of {len(guests)} guests can receive {', '.join(c.upper() for c in paid_channels)}.")
    if event.invite_mode == "closed" and not event.rsvp_enabled:
        add("warning", "RSVP", "RSVP is disabled", "Closed invitations issue passes without collecting confirm/decline responses.")
    if event.message_credits < max(10, len(guests) * 2) and paid_channels:
        add("warning", "Messaging", "Message credits may be low", f"{event.message_credits} credits remain; MMS costs three credits per recipient.")
    if event.experience_enabled and not steps:
        add("warning", "Experience", "No active journey steps", "Experience is enabled, but no enabled workflow steps were found.")
    if event.logistics_enabled:
        add("note", "Logistics", "Confirm fulfillment", "Confirm packing, inventory, and handoff ownership before the event.")
    worst = "critical" if any(x["level"] == "critical" for x in findings) else "warning" if any(x["level"] == "warning" for x in findings) else "ready"
    return dict(event=event, guests=guests, templates=templates, workflow=workflow, steps=steps,
                owner_email=owner, questions=questions, phones=phones, findings=findings,
                paid_channels=paid_channels, worst=worst, generated_at=datetime.utcnow())


def render_readiness_html(d: dict) -> str:
    ev, guests = d["event"], d["guests"]
    verdict = {"critical": "NOT READY", "warning": "NEARLY READY", "ready": "READY"}[d["worst"]]
    findings = "".join(f'<li class="{x["level"]}"><label><input type="checkbox"> <b>{_e(x["title"])}</b> <small>{_e(x["area"])}</small><span>{_e(x["detail"])}</span></label></li>' for x in d["findings"])
    if not findings: findings = '<li class="ready"><b>✓ No blocking readiness issues found.</b></li>'
    steps = "".join(f"<tr><td>{i}</td><td>{_e(s.title)}</td><td>{_e(s.type.replace('_',' '))}</td><td>{_e(_when(s.config))}</td><td>{'Required' if s.required else 'Optional'}</td></tr>" for i, s in enumerate(d["steps"], 1))
    templates = "".join(f"<tr><td>{_e(t.template_key)}</td><td>{_e(t.subject or 'Platform default')}</td><td>{_e(', '.join(c for c, v in [('Email',t.email_body),('SMS',t.sms_body),('MMS',t.mms_body),('WhatsApp',t.whatsapp_body)] if v) or 'Defaults')}</td></tr>" for t in d["templates"])
    channels = ", ".join(c.upper() for c in d["paid_channels"]) or "Email only"
    return f'''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>{_e(ev.name)} readiness report</title><style>
body{{margin:0;background:#f4f7f6;color:#17231f;font:14px/1.5 system-ui,sans-serif}}main{{max-width:960px;margin:auto;padding:32px 18px 70px}}header,section{{background:white;border:1px solid #dbe5e1;border-radius:14px;padding:24px;margin-bottom:20px}}h1{{margin:5px 0}}h2{{font-size:18px}}.eyebrow,small{{color:#64746e;text-transform:uppercase;letter-spacing:.08em;font-size:11px}}.verdict{{display:inline-block;padding:6px 12px;border-radius:20px;background:#d9f0e8;color:#08745d;font-weight:800}}.critical{{border-left:4px solid #dc264f}}.warning{{border-left:4px solid #d88712}}ul{{list-style:none;padding:0}}li{{padding:12px;margin:8px 0;background:#f8faf9;border-radius:8px}}li span{{display:block;color:#56645f;margin-left:25px}}table{{width:100%;border-collapse:collapse;font-size:12px}}th,td{{padding:9px;border-bottom:1px solid #e7eeeb;text-align:left}}.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}}.metric{{background:#f5f8f7;padding:12px;border-radius:9px}}@media print{{body{{background:white}}main{{padding:0}}header,section{{break-inside:avoid}}}}
</style></head><body><main><header><div class="eyebrow">Festio · Event readiness audit</div><h1>{_e(ev.name)}</h1><p>{_e(ev.couples_name)} · {_e(ev.event_date.strftime('%b %d, %Y %I:%M %p'))}</p><span class="verdict">{verdict}</span></header>
<section><h2>Readiness scorecard</h2><div class="grid"><div class="metric"><small>Guests</small><b><br>{len(guests)} / {ev.guest_cap or '—'}</b></div><div class="metric"><small>Phone coverage</small><b><br>{d['phones']} / {len(guests)}</b></div><div class="metric"><small>Channels</small><b><br>{_e(channels)}</b></div><div class="metric"><small>Credits</small><b><br>{ev.message_credits}</b></div><div class="metric"><small>Journey</small><b><br>{len(d['steps'])} steps</b></div></div></section>
<section><h2>Action checklist</h2><ul>{findings}</ul></section>
<section><h2>Configuration</h2><div class="grid"><div class="metric">Plan<br><b>{_e(ev.plan_tier if ev.is_paid else 'free')}</b></div><div class="metric">Invite mode<br><b>{_e(ev.invite_mode)}</b></div><div class="metric">RSVP<br><b>{'On' if ev.rsvp_enabled else 'Off'}</b></div><div class="metric">Seating<br><b>{'On' if ev.seating_enabled else 'Off'}</b></div><div class="metric">Logistics<br><b>{'On' if ev.logistics_enabled else 'Off'}</b></div></div></section>
<section><h2>Messaging templates</h2><table><thead><tr><th>Template</th><th>Subject</th><th>Customized channels</th></tr></thead><tbody>{templates or '<tr><td colspan="3">Platform defaults are in use.</td></tr>'}</tbody></table></section>
<section><h2>Experience journey — full schedule</h2><table><thead><tr><th>#</th><th>Step</th><th>Type</th><th>Date, time, room, speaker</th><th>Rule</th></tr></thead><tbody>{steps or '<tr><td colspan="5">No enabled steps.</td></tr>'}</tbody></table></section>
<p><small>Generated {d['generated_at'].strftime('%b %d, %Y %H:%M UTC')} · Super-admin readiness report</small></p></main></body></html>'''
