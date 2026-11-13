"""Original four certificate compositions, with escaped reusable content slots.

Version 2 is opt-in in the saved design so old issued snapshots keep their layout.
"""
import html
import re
from datetime import datetime
from pathlib import Path

LAYOUTS = {'royal', 'heritage', 'midnight', 'ivory'}


def original_certificate(cert, preview=False, asset=lambda value: value, qr=''):
    snap = cert.snapshot or {}
    design = snap.get('design') or {}
    layout = design.get('layout')
    if layout not in LAYOUTS or design.get('layout_version') != 2:
        return None
    esc = lambda value: html.escape(str(value or ''), quote=True)
    colour = lambda value, fallback: value if re.fullmatch(r'#[0-9a-fA-F]{6}', str(value or '')) else fallback
    name = str(snap.get('participant_name') or 'Participant Name')
    event_name = snap.get('event_name') or 'Event'
    date = ''
    try:
        date = datetime.fromisoformat(snap.get('event_date_local') or snap.get('event_date') or '').strftime('%d %B %Y')
    except (ValueError, TypeError):
        pass
    citation = esc(design.get('body') or 'In recognition of participation in this event')
    if date: citation += '<br>held on <b>' + esc(date) + '</b>'
    if snap.get('event_venue'): citation += ' at<br><b>' + esc(snap['event_venue']) + '</b>.'
    people = snap.get('signatories') or []
    def signatory(index):
        person = people[index] if index < len(people) else {}
        image = person.get('signature_png') or (design.get('signature_url') if index == 0 else '')
        image_html = '<img src="' + esc(asset(image)) + '" alt="Approved signature">' if image and not preview else ''
        return '<div class="sig"><div class="line">' + image_html + '</div><b>' + esc(person.get('name') or design.get('signature_name') or 'Authorised Signatory') + '</b><small>' + esc(person.get('title') or 'Name and title') + '</small></div>'
    heading = str(design.get('title') or 'Certificate of Participation')
    if heading == 'Certificate of Participation': heading = 'Certificate <em>of Participation</em>'
    else: heading = esc(heading)
    brand=str(design.get('event_brand') or event_name)
    highlight=str(design.get('event_brand_accent') or '')
    brand_html=esc(brand)
    if highlight and highlight in brand:
        left,right=brand.split(highlight,1);brand_html=esc(left)+'<span>'+esc(highlight)+'</span>'+esc(right)
    fields = dict(layout=layout, logo=esc(asset(design.get('logo_url') or '')), organisation=esc(design.get('organisation')),
        event_brand=brand_html, event_edition=esc(design.get('event_edition')),
        eyebrow=esc(design.get('eyebrow') or 'LEARNING · CONNECTION · PROFESSIONAL GROWTH'), heading=heading,
        subtitle=esc(design.get('subtitle') or 'This certificate is presented to'), participant=esc(name), citation=citation,
        theme_label='EVENT THEME' if design.get('theme') else '', theme=esc(design.get('theme')), theme_subtitle=esc(design.get('theme_subtitle')),
        signatory_1=signatory(0), signatory_2=signatory(1) if len(people) != 1 else '',
        seal=('<small>'+esc(design.get('seal_label') or 'EVENT')+'</small><b>'+esc(design.get('seal_edition') or '★')+'</b><span>'+esc(date[-4:])+'</span>') if preview else '<img src="data:image/png;base64,'+qr+'" alt="Scan to verify">',
        footer_brand=esc(design.get('footer_brand') or event_name), number='DESIGN PREVIEW · NOT ISSUED' if preview else esc(cert.certificate_number),
        primary=colour(design.get('primary_color'),'#3c074a'), accent=colour(design.get('accent_color'),'#e98000'), name_size=42 if len(name)<35 else 32 if len(name)<60 else 25)
    source = Path(__file__).with_name('certificate_templates').joinpath(layout+'.html').read_text()
    result = re.sub(r'@@([a-z_0-9]+)@@', lambda match: str(fields[match[1]]), source)
    if len(people) == 1:
        # Use the captured signatory list, never today's mutable approvals.
        result = result.replace('class="signatures"', 'class="signatures single-signatory"', 1)
        result = result.replace('</style>', '.signatures.single-signatory{grid-template-columns:minmax(0,360px) 100px;justify-content:center;gap:42px}</style>', 1)
    if not design.get('logo_url'):
        result = re.sub(r'<img class="logo"[^>]*>', '', result)
    return result
