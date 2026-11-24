"""Build public training assets from juniorGuide.json. Dev-only: python-docx + Playwright Chromium.
Run with PYTHONPATH=/tmp/festio-guide-deps python3 scripts/generate-junior-guide.py.
No event data, contacts, APIs or outbound messages are used.
"""
import json,html,math
from pathlib import Path
from PIL import ImageFont
from playwright.sync_api import sync_playwright
from docx import Document
from docx.shared import Inches,Pt,RGBColor
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
ROOT=Path(__file__).resolve().parents[1]
DATA=json.loads((ROOT/'src/content/juniorGuide.json').read_text())
OUT=ROOT/'public/juniors/guide'/DATA['version'];OUT.mkdir(parents=True,exist_ok=True)
INK='#123138';MUTED='#50686d';GREEN='#126e63';MINT='#e4f4ee';LINE='#cfdedb';AMBER='#fff1d6'
FONT=Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
BOLD=FONT.with_name('DejaVuSans-Bold.ttf')

def esc(v):return html.escape(str(v),quote=True)
def lines(text,size,width,bold=False):
    font=ImageFont.truetype(str(BOLD if bold else FONT),size)
    result=[]
    for para in str(text).split('\n'):
        row=''
        for word in para.split():
            candidate=(row+' '+word).strip()
            if row and font.getlength(candidate)>width:result.append(row);row=word
            else:row=candidate
        result.append(row)
    return result

def txt(x,y,text,size=28,width=1100,color=INK,bold=False,line=None):
    rows=lines(text,size,width,bold);leading=line or round(size*1.45)
    return '<text x="%s" y="%s" font-size="%s" font-weight="%s" fill="%s">%s</text>'%(x,y,size,700 if bold else 400,color,''.join('<tspan x="%s" dy="%s">%s</tspan>'%(x,0 if i==0 else leading,esc(row)) for i,row in enumerate(rows))),len(rows)*leading

def rect(x,y,w,h,fill='white',stroke=LINE,rx=22):return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}" stroke-width="2"/>'
def arrow(x,y1,y2):return f'<path d="M{x} {y1}V{y2}" stroke="{GREEN}" stroke-width="5" fill="none" marker-end="url(#arrow)"/>'

def start(title,subtitle):
    s=f'<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="1980" viewBox="0 0 1400 1980" role="img" aria-label="{esc(title)}"><title>{esc(title)}</title><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0 0L6 3L0 6" fill="{GREEN}"/></marker></defs><rect width="1400" height="1980" fill="#f5f9f7"/><g font-family="DejaVu Sans,Arial,sans-serif">'
    s+=rect(0,0,1400,225,INK,INK,0)
    s+=txt(70,58,'FESTIO JUNIORS  /  VOLUNTEER ORIENTATION',22,color='#95dfc7',bold=True)[0]
    title_size=49
    while ImageFont.truetype(str(BOLD),title_size).getlength(title)>1260:title_size-=1
    s+=txt(70,127,title,title_size,1260,'white',True)[0]
    s+=txt(70,181,subtitle,25,1260,'#d4e8e2')[0]
    return s

def footer(s):
    s+=txt(70,1940,'STAFF ONLY  ·  Event settings and permissions apply  ·  Updated '+DATA['version'],20,1260,MUTED)[0]
    return s+'</g></svg>'

def flow_card(s,y,number,title,body,height=None):
    title_rows=lines(title,31,1010,True);body_rows=lines(body,27,1010);h=height or max(140,44+len(title_rows)*42+len(body_rows)*38)
    s+=rect(190,y,1130,h)
    s+=f'<circle cx="111" cy="{y+43}" r="37" fill="{GREEN}"/>'
    s+=txt(88,y+53,str(number).zfill(2),25,90,'white',True)[0]
    s+=txt(220,y+45,title,31,1010,bold=True,line=42)[0]
    s+=txt(220,y+45+len(title_rows)*42,body,27,1010,MUTED,line=38)[0]
    return s,y+h

def daily():
    s=start('A safe day: arrival to pickup','Convention admission first. A fresh drop-off and confirmation each JP day.')
    items=[('Find or scan the child','Search the shared Guest List record. Scanning opens the record; it does not record a movement.'),('Complete convention check-in','Follow the configured JP start date. Convention arrival alone does not begin JP custody.'),('Record today’s drop-off','Choose the adult present; linked guardian details are prefilled. Verify in person; a sibling must be 18+. Resolve any prior-day custody first.'),('Confirm screening and wristbands','Saved answers prefill. Ask what is missing and confirm both answers with the adult today. Every child needs the standard band. Any Yes also requires the relevant support desk and extra band.'),('Confirm classroom arrival','Check the assigned room, required desk clearances and bands. Record arrival when the child physically reaches the room.'),('Verify the authorized collector','Choose an adult-verified, pickup-authorized collector. Check identity in person, complete the handoff, then confirm final release.')]
    y=265
    for i,(title,body) in enumerate(items,1):
        s,end=flow_card(s,y,i,title,body)
        if i<len(items):s+=arrow(111,y+82,end+22)
        y=end+28
    s+=rect(70,y+5,1260,115,MINT,GREEN)
    s+=txt(96,y+48,'STANDARD + ALLERGY + ACCOMMODATION = 3 BANDS WHEN BOTH APPLY',25,1200,GREEN,True)[0]
    s+=txt(96,y+88,'Saved information does not carry daily clearance or band confirmation forward.',24,1200,MUTED)[0]
    y+=145
    s+=rect(70,y,1260,145,AMBER,'#d5ad65')
    s+=txt(96,y+42,'NO AUTHORIZED COLLECTOR?',27,1200,INK,True)[0]
    s+=txt(96,y+83,'Admin / guardian-editor → Review collector authorization. This blocks final pickup, not drop-off or screening. The drop-off record does not grant pickup permission.',24,1200,MUTED,line=34)[0]
    assert y+145<1910,(y,'daily overflow')
    return footer(s)

def movements():
    s=start('Every movement needs a return','Three complete cycles. No return record means the child is still away.')
    lanes=[('CLINIC',[('Start at JP','The child is physically at JP reception, a desk or a classroom.'),('Record Clinic departure','Enter the accompanying adult and confirm departure. The account and time are recorded.'),('Still at clinic','The child remains away until an actual return is recorded.'),('Record Return to JP','Choose Return from clinic / other when the child is physically back.'),('Confirm classroom arrival','If resuming class, record arrival in the assigned room.')]),('OTHER',[('Start at JP','The child is physically at JP reception, a desk or a classroom.'),('Record Other departure','Enter the adult and a required internal reason. This is not final pickup.'),('Still temporarily away','Do not assume the child is back because time has passed.'),('Record Return to JP','Choose Return from clinic / other when the child is physically back.'),('Confirm classroom arrival','If resuming class, record arrival in the assigned room.')]),('OUTING',[('Prepare the roster','Verify permission. Departure requires the scheduled date and a child in class.'),('Confirm outing departure','Open the named outing, scan or find the child, then confirm that outing.'),('Awaiting return','Review the outing counts and every child in Awaiting return.'),('Confirm outing return','Scan or open the child and confirm return to that outing. The child is back at JP reception.'),('Confirm classroom arrival','If resuming class, record arrival in the assigned room.')])]
    body_size=24
    while True:
        title_size=25;title_line=32;body_line=round(body_size*1.4)
        heights=[max(180,max(47+len(lines(steps[i][0],title_size,346,True))*title_line+(len(lines(steps[i][1],body_size,346))-1)*body_line+25 for _,steps in lanes)) for i in range(5)]
        if 365+sum(heights)+4*28<=1550:break
        body_size-=1
        assert body_size>=20,'Movement infographic is too dense'
    row_y=[365]
    for height in heights[:-1]:row_y.append(row_y[-1]+height+28)
    for col,(name,steps) in enumerate(lanes):
        x=60+col*445;w=390
        s+=rect(x,265,w,64,GREEN,GREEN,16)+txt(x+24,309,name,30,w-48,'white',True)[0]
        for i,(title,body) in enumerate(steps):
            y=row_y[i];height=heights[i];s+=rect(x,y,w,height)
            s+=txt(x+22,y+37,title,title_size,w-44,bold=True,line=title_line)[0]
            title_h=len(lines(title,title_size,w-44,True))*title_line
            s+=txt(x+22,y+47+title_h,body,body_size,w-44,MUTED,line=body_line)[0]
            if i<4:s+=arrow(x+w/2,y+height+4,row_y[i+1]-7)
    s+=rect(60,1590,1280,133,MINT,GREEN)
    s+=txt(86,1633,'LEAVING FOR THE DAY INSTEAD?',27,1225,GREEN,True)[0]
    s+=txt(86,1676,'Record the return to JP first → verify an authorized adult → confirm final pickup.',27,1225,MUTED)[0]
    s+=rect(60,1750,1280,135,AMBER,'#d5ad65')
    s+=txt(86,1795,'STOP: do not close an outing with outstanding returns.',29,1225,INK,True)[0]
    s+=txt(86,1840,'Scanning identifies a child. Staff confirmation records the movement.',26,1225,MUTED)[0]
    return footer(s)

def volunteers():
    s=start('Every volunteer. Every safe handover.','Your recorded handoff keeps the whole programme moving calmly.')
    items=[('Sign in and choose the event','Use the same verified email assigned by the Admin. On mobile: Home, Children, Scan, My shift and More.'),('Use only your assigned tools','Admin has full Juniors access in scope. Volunteers receive selected permissions; own shifts and the guide remain available.'),('Check in at your station','Open My shift. Check in only when physically present. A reminder or scheduled shift is not attendance.'),('Count and review together','Count the children. Review Clinic, Other, Outing, support and unresolved movement records with the incoming volunteer.'),('Offer and accept the handover','The outgoing volunteer offers to the assigned incoming person. The incoming volunteer checks in and accepts the current physical count.'),('Finish the outgoing shift','After accepted handover and the physical transfer, the outgoing volunteer finishes the shift. If relief is late, alert the lead and remain with the children.')]
    y=265
    for i,(title,body) in enumerate(items,1):
        s,end=flow_card(s,y,i,title,body)
        if i<len(items):s+=arrow(111,y+82,end+22)
        y=end+28
    s+=rect(70,y,1260,190,MINT,GREEN)
    s+=txt(96,y+44,'MESSAGES HAVE THEIR OWN STATUS',28,1200,GREEN,True)[0]
    s+=txt(96,y+88,'Queued → Accepted → Delivered (only with a receipt)',28,1200,INK,True)[0]
    s+=txt(96,y+132,'Sending needs enabled switches, valid contacts, consent, provider readiness and credits. Practice events never send.',24,1200,MUTED,line=34)[0]
    assert y+190<1910,(y,'volunteer overflow')
    return footer(s)

POSTERS=[('daily-arrival-pickup','Daily arrival & verified pickup',daily()),('movement-return-cycles','Every movement needs a return',movements()),('volunteer-handover','Volunteer access & handover',volunteers())]
for slug,title,svg in POSTERS:(OUT/(slug+'.svg')).write_text(svg)

STYLE='''@page{size:A4;margin:16mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#123138;margin:0;font-size:10.5pt;line-height:1.45}h1{font-size:34pt;line-height:1.12;letter-spacing:-1pt}h2{font-size:19pt;margin:0 0 10pt}h3{font-size:15pt;margin:0 0 8pt}p{margin:6pt 0}.kicker{color:#126e63;font-size:9pt;font-weight:bold;letter-spacing:1.3pt}.page{break-after:page}.page:last-child{break-after:auto}.cover{padding-top:12mm}.hero{background:#123138;color:white;padding:24pt;border-radius:14pt}.hero p{color:#c4e8db}.hero h1{margin:14pt 0}.rule{border-left:4pt solid #126e63;background:#e4f4ee;padding:12pt;margin:16pt 0}.stop{border-left:4pt solid #c08b2d;background:#fff1d6;padding:10pt;margin:12pt 0;font-size:10pt}.section{margin-bottom:20pt;padding-bottom:14pt;border-bottom:1pt solid #cfdedb;break-inside:avoid}li{margin:6pt 0}table{border-collapse:collapse;width:100%;margin:12pt 0}td,th{padding:9pt;text-align:left;border:1pt solid #cfdedb;vertical-align:top}th{background:#e4f4ee}footer{margin-top:14pt;font-size:8pt;color:#50686d}.poster{width:100%;height:260mm;display:flex;align-items:center;justify-content:center}.poster svg{width:100%;height:100%}'''

def guide_html():
    s='<html><meta charset="utf-8"><title>'+esc(DATA['title'])+'</title><style>'+STYLE+'</style><body>'
    s+='<div class="page cover"><div class="hero"><div class="kicker">FESTIO · VOLUNTEER ORIENTATION</div><h1>Festio Juniors<br>Volunteer guide</h1><p>'+esc(DATA['tagline'])+'</p><p>Updated '+DATA['version']+'</p></div><div class="rule">'+esc(DATA['introduction'])+'</div><h2>Your first minute</h2><ol><li>Sign in at <b>festio.events/juniors/</b> and choose the correct event.</li><li>Open My shift; check in only when physically at your station.</li><li>Search or scan the child in front of you, verify the details, then confirm the next action.</li></ol><h2>Phone navigation</h2><table><tr><th>Home</th><td>Shift summary, scan, search and attention counts.</td></tr><tr><th>Children / Scan</th><td>Find or identify a child; confirm movements in their record.</td></tr><tr><th>My shift</th><td>Personal assignments, arrival, handover and departure.</td></tr><tr><th>More</th><td>Tools permitted by your event role, including the volunteer guide.</td></tr></table><div class="stop"><b>Move promptly, never skip the checks.</b><p>Keep the next desk clear, alert the lead when queues grow, and never leave children without a safe handover.</p></div><footer>Reusable staff guide. Event settings apply. Examples and diagrams contain no real child records.</footer></div>'
    s+='<div class="page"><p class="kicker">ACCESS & NON-NEGOTIABLE CHECKS</p><h2>Two roles; clear responsibilities</h2><table><tr><th>Admin</th><td>Full Festio Juniors access within the account\'s authorized scope. Can add staff, assign permissions and manage the event\'s Juniors settings.</td></tr><tr><th>Volunteer</th><td>Only selected operational permissions. Own shifts and the guide remain available. Existing view-only limits still apply.</td></tr></table><h3>Permissions an Admin can assign</h3><ul>'+''.join('<li>'+esc(v)+'</li>' for v in DATA['permissions'])+'</ul><div class="rule"><b>More → Volunteers → Volunteers tab</b><p>Select one or several people → Set role & permissions → choose the permissions → Save.</p></div><h3>Remember every day</h3><ul><li>Convention admission is not JP custody.</li><li>Every JP day starts with drop-off and today\'s screening/band confirmation.</li><li>Allergy and accommodation facts can prefill; daily clearance does not.</li><li>Every temporary departure needs its own return.</li><li>Collector authorization and physical identity verification are separate.</li></ul></div>'
    sections=DATA['sections']
    for start_idx in range(0,len(sections),2):
        s+='<div class="page">'
        for t in sections[start_idx:start_idx+2]:
            s+='<section class="section"><p class="kicker">'+esc(t['icon']+' · '+t['role'])+'</p><h2>'+esc(t['title'])+'</h2><p>'+esc(t['subtitle'])+'</p><ol>'+''.join('<li>'+esc(v)+'</li>' for v in t['steps'])+'</ol><div class="stop"><b>STOP & CHECK</b><p>'+esc(t['check'])+'</p></div></section>'
        s+='<footer>Festio Juniors · Updated '+DATA['version']+' · Staff-only orientation</footer></div>'
    s+='<div class="page"><p class="kicker">ORIENTATION PRACTICE</p><h2>Run the exceptions before event day</h2><p>Use the separate practice event with fictional contacts. Stay online. Practice never sends guardian or volunteer messages.</p><ul>'+''.join('<li>'+esc(v)+'</li>' for v in DATA['practice'])+'</ul><div class="rule"><b>Before the first real shift</b><p>Know your station, assigned classroom, lead contact, incoming relief, event timezone and where to refer a child for support or identity corrections.</p></div></div>'
    for slug,title,svg in POSTERS:s+='<div class="page poster">'+svg+'</div>'
    return s+'</body></html>'

with sync_playwright() as pw:
    browser=pw.chromium.launch();page=browser.new_page(viewport={'width':1400,'height':1980},device_scale_factor=2)
    for slug,title,svg in POSTERS:
        page.set_content('<html><meta charset="utf-8"><style>html,body{margin:0;padding:0}svg{display:block}</style>'+svg+'</html>');page.screenshot(path=str(OUT/(slug+'.png')))
        page.set_content('<style>@page{size:A4;margin:0}html,body{margin:0}svg{display:block;width:210mm;height:297mm}</style>'+svg);page.pdf(path=str(OUT/(slug+'.pdf')),format='A4',margin={'top':'0','bottom':'0','left':'0','right':'0'},print_background=True,prefer_css_page_size=True)
    page.set_content('<style>@page{size:A4;margin:0}html,body{margin:0}.poster{break-after:page}.poster:last-child{break-after:auto}svg{display:block;width:210mm;height:297mm}</style>'+''.join('<div class="poster">'+svg+'</div>' for _,_,svg in POSTERS));page.pdf(path=str(OUT/'festio-juniors-infographics.pdf'),format='A4',margin={'top':'0','bottom':'0','left':'0','right':'0'},print_background=True,prefer_css_page_size=True)
    (OUT/'festio-juniors-volunteer-guide.html').write_text(guide_html());page.set_content(guide_html());page.pdf(path=str(OUT/'festio-juniors-volunteer-guide.pdf'),format='A4',print_background=True,prefer_css_page_size=True)
    browser.close()

# Editable Word version, using the same section text and poster images.
doc=Document();sec=doc.sections[0];sec.page_width=Inches(8.27);sec.page_height=Inches(11.69);sec.top_margin=sec.bottom_margin=Inches(.65);sec.left_margin=sec.right_margin=Inches(.7)
normal=doc.styles['Normal'];normal.font.name='Arial';normal.font.size=Pt(10);normal.paragraph_format.space_after=Pt(6)
for name,size in [('Title',34),('Heading 1',20),('Heading 2',16)]:doc.styles[name].font.name='Arial';doc.styles[name].font.size=Pt(size);doc.styles[name].font.color.rgb=RGBColor.from_string('126E63')
sec.header.paragraphs[0].text='FESTIO JUNIORS  |  VOLUNTEER ORIENTATION';sec.header.paragraphs[0].style='Caption'
p=sec.footer.paragraphs[0];p.alignment=1;p.add_run('Festio Juniors · '+DATA['version']+' · Page ');field=OxmlElement('w:fldSimple');field.set(qn('w:instr'),'PAGE');p._p.append(field)
doc.add_heading('Festio Juniors\nVolunteer guide',0);doc.add_paragraph(DATA['tagline'],'Subtitle');doc.add_paragraph('Updated '+DATA['version']);doc.add_paragraph(DATA['introduction']);doc.add_heading('Your first minute',1)
for s in ['Sign in at https://festio.events/juniors/ with your assigned email and choose the event.','Open My shift and check in only when physically at your station.','Find or scan the child, verify the details and confirm the next action.']:doc.add_paragraph(s,'List Bullet')
doc.add_heading('Phone navigation',1)
t=doc.add_table(rows=1,cols=2);t.style='Table Grid';t.rows[0].cells[0].text='Tool';t.rows[0].cells[1].text='Use it for'
for cell in t.rows[0].cells:
    shade=OxmlElement('w:shd');shade.set(qn('w:fill'),'E4F4EE');cell._tc.get_or_add_tcPr().append(shade)
for label,body in [('Home','Shift summary, scan, search and attention counts.'),('Children / Scan','Find or identify a child; confirm in the record.'),('My shift','Assignments, arrival, handover and departure.'),('More','Tools allowed by your event permissions, including this guide.'),('Account & app','Install instructions and sign out; the theme button switches light/dark.')]:r=t.add_row().cells;r[0].text=label;r[1].text=body
doc.add_paragraph('Move promptly, never skip screening, wristbands, authorization or identity checks. Alert the lead about queues or missing relief; do not leave children unattended.')
doc.add_page_break();doc.add_heading('Two roles; clear responsibilities',1)
for label,body in [('Admin','Full Juniors access within authorized scope. Existing organization/event Admins inherit appropriate access.'),('Volunteer','Only selected permissions, plus own shifts and the guide. Existing view-only limits still apply.')]:p=doc.add_paragraph();p.add_run(label+': ').bold=True;p.add_run(body)
doc.add_heading('Permissions an Admin can assign',2)
for permission in DATA['permissions']:doc.add_paragraph(permission,'List Bullet')
doc.add_paragraph('More → Volunteers → Volunteers tab → select people → Set role & permissions → choose permissions → Save.')
doc.add_heading('Remember every day',2)
for text in ['Convention admission is not JP custody.','Every JP day starts with drop-off and today\'s screening and band confirmation.','Saved allergy/accommodation facts do not grant daily desk clearance.','Every Clinic, Other or Outing departure needs a return.','Pickup authorization and in-person identity verification are separate checks.']:doc.add_paragraph(text,'List Bullet')
for i,t in enumerate(DATA['sections']):
    if i%2==0:doc.add_page_break()
    doc.add_heading(t['icon']+' · '+t['title'],1);doc.add_paragraph(t['role']+' | '+t['subtitle'],'Subtitle')
    for n,step in enumerate(t['steps'],1):doc.add_paragraph(str(n)+'. '+step)
    p=doc.add_paragraph();p.add_run('STOP & CHECK: ').bold=True;p.add_run(t['check'])
doc.add_page_break();doc.add_heading('Orientation practice',1);doc.add_paragraph('Use a separate practice event and fictional contacts. Stay online; practice events never send guardian or volunteer messages.')
for text in DATA['practice']:doc.add_paragraph(text,'List Bullet')
for slug,title,_ in POSTERS:
    doc.add_page_break();doc.add_heading(title,1);p=doc.add_paragraph();p.alignment=1;p.add_run().add_picture(str(OUT/(slug+'.png')),width=Inches(6.1))
doc.core_properties.title=DATA['title'];doc.core_properties.subject='Staff-only event child check-in, movements and handover';doc.core_properties.author='Festio';doc.save(OUT/'festio-juniors-volunteer-guide.docx')
manifest={'version':DATA['version'],'sections':len(DATA['sections']),'files':sorted(p.name for p in OUT.iterdir() if p.is_file())};(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2));print(json.dumps(manifest))
