"""Create an editable reference-style workflow and print/image exports. No event data used."""
import sys,shutil
from pathlib import Path
from html import escape
from PIL import ImageFont
from playwright.sync_api import sync_playwright
CLIENT='--client' in sys.argv
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/('public/juniors/guide/client-r4' if CLIENT else 'public/juniors/guide/2026-11-25-r1');OUT.mkdir(parents=True,exist_ok=True)
W,H=2400,1700;INK='#281b13';BRONZE='#955126';GREEN='#386e47';LINE='#dcc9b5';PAPER='#fcf7ef';CREAM='#f7eddd';SOFT='#edf2e1';RED='#a42e2c'
SANS='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';SERIF='/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf'
def wrap(s,size,width,bold=False,serif=False):
 f=ImageFont.truetype(SERIF if serif else SANS.replace('.ttf','-Bold.ttf') if bold else SANS,size);result=[]
 for para in s.split('\n'):
  row=''
  for word in para.split():
   x=(row+' '+word).strip()
   if row and f.getlength(x)>width:result.append(row);row=word
   else:row=x
  result.append(row)
 return result

def text(x,y,s,size=25,width=1000,color=INK,bold=False,serif=False,leading=None):
 rows=wrap(s,size,width,bold,serif);line=leading or round(size*1.35)
 return f'<text x="{x}" y="{y}" font-family="'+('DejaVu Serif' if serif else 'DejaVu Sans')+f'" font-size="{size}" font-weight="{700 if bold or serif else 400}" fill="{color}">'+''.join(f'<tspan x="{x}" dy="{0 if i==0 else line}">{escape(v)}</tspan>' for i,v in enumerate(rows))+'</text>'
def rect(x,y,w,h,fill='white',stroke=LINE,r=24):return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{fill}" fill-opacity=".9" stroke="{stroke}" stroke-width="2"/>'
def arrow(path,color=BRONZE):return f'<path d="{path}" fill="none" stroke="{color}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round" marker-end="url(#{"green" if color==GREEN else "brown"})"/>'
ICONS={
 'search':'<circle cx="10" cy="10" r="7"/><path d="m15 15 7 7"/>',
 'people':'<circle cx="8" cy="7" r="3"/><circle cx="17" cy="5" r="3"/><path d="M2 21v-4a5 5 0 0 1 10 0v4M13 12a5 5 0 0 1 9 3v6"/>',
 'clipboard':'<rect x="4" y="4" width="16" height="19" rx="2"/><path d="M9 4V1h6v3M8 10l2 2 4-4M8 17h8"/>',
 'school':'<path d="M2 22V11l10-7 10 7v11ZM10 22v-7h4v7M12 4V1h8v4h-8"/><path d="M5 13v3M19 13v3"/>',
 'pin':'<path d="M12 23s9-10 9-15a9 9 0 0 0-18 0c0 5 9 15 9 15Z"/><circle cx="12" cy="8" r="3"/>',
 'pickup':'<circle cx="5" cy="6" r="3"/><circle cx="19" cy="6" r="3"/><path d="M0 22v-6a5 5 0 0 1 10 0v6M14 22v-6a5 5 0 0 1 10 0v6M9 5h6m-2-2 2 2-2 2M15 12H9m2-2-2 2 2 2"/>',
 'cross':'<path d="M8 2h8v6h6v8h-6v6H8v-6H2V8h6Z"/>',
 'flag':'<path d="M5 23V2h15l-3 5 3 5H5"/>',
 'outing':'<path d="m0 23 7-13 5 8 4-5 8 10ZM12 13V1h9l-3 4 3 4h-9"/>',
 'band':'<ellipse cx="12" cy="12" rx="11" ry="6" transform="rotate(-30 12 12)"/><path d="m5 14 6-3 2 3 6-3"/>',
 'mail':'<rect x="1" y="4" width="22" height="16" rx="2"/><path d="m1 5 11 8L23 5"/>',
 'shield':'<path d="m12 1 10 4v7c0 5-6 9-10 11C8 21 2 17 2 12V5Z"/><path d="m6 12 4 4 8-8"/>',
 'box':'<path d="m1 6 11-5 11 5v13l-11 5-11-5ZM1 6l11 6 11-6M12 12v12M6 4l12 6"/>',
 'chair':'<circle cx="10" cy="3" r="2"/><path d="m10 7 1 9h8l4 7M11 11h7M8 10a7 7 0 1 0 9 10"/>',
 'check':'<circle cx="12" cy="12" r="10"/><path d="m6 12 4 4 8-9"/>'}
def icon(name,x,y,size=58,color=INK):return f'<g transform="translate({x} {y}) scale({size/24})" stroke="{color}" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'+ICONS[name]+'</g>'
svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-label="Festio Juniors operating flow"><title>Festio Juniors: setup, daily handoffs, recorded returns, gala and volunteer handover</title><defs>'
for name,color in [('brown',BRONZE),('green',GREEN)]:svg+=f'<marker id="{name}" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto"><path d="m0 0 6 3-6 3" fill="{color}"/></marker>'
svg+='</defs>'+f'<rect width="{W}" height="{H}" fill="{PAPER}"/>'
svg+=text(55,75,'Festio × NCNMO' if CLIENT else 'Festio Juniors',53,1500,BRONZE,serif=True)
svg+=text(55,140,'Junior Platform 2026' if CLIENT else 'Every child. Every handoff.',57,1700,serif=True)
svg+=text(1780,76,'JP 2026' if CLIENT else 'STAFF WORKFLOW',32,570,BRONZE,True)+text(1780,124,'Every return accounted for.',25,570)
svg+=rect(50,175,2300,70,CREAM,LINE,18)
svg+=text(75,204,'ON DESKTOP',18,220,BRONZE,True)+text(305,205,'Overview  ·  Children  ·  My classroom  ·  Programme  ·  More',23,1900,INK,True)
svg+=text(75,231,'ON YOUR PHONE',18,230,BRONZE,True)+text(305,233,'Home  ·  Children  ·  Scan  ·  My shift  ·  More',21,1900)
svg+=rect(50,265,2300,105,'#fffdf9',LINE,20)+text(75,305,'BEFORE THE EVENT',21,290,BRONZE,True)+text(75,341,'Admin setup',28,290,INK,True)
prep=[('Groups & rooms','Programme → Programme setup'),('Review & publish','Resolve questions, approve source'),('Volunteers & shifts','Assign role, classroom and shift'),('Guardian updates','Enable sending in Settings')]
for i,(heading,body) in enumerate(prep):
 xx=410+i*483
 svg+=rect(xx,281,445,72,SOFT,'#b8cfb0',15)+text(xx+16,309,heading,24,412,GREEN,True)+text(xx+16,338,body,18,412)
 if i<3:svg+=arrow(f'M{xx+450} 319H{xx+477}',GREEN)
svg+=rect(50,389,2300,43,CREAM,LINE,14)+text(75,419,('DAY 0: Platform check-in only.  FROM DAY 1: A fresh daily JP drop-off, screening and wristband check.' if CLIENT else 'FIRST ARRIVAL: Event check-in. EACH JP DAY: A fresh drop-off, screening and wristband check from the configured start date.'),23,2250,BRONZE,True)
xs=[50,328,646,1464,1742,2060];widths=[260,300,800,260,300,290];y=450;h=390
for i,(x,w) in enumerate(zip(xs,widths),1):
 svg+=rect(x,y,w,h,'#fffdf9')+f'<circle cx="{x+35}" cy="{y+34}" r="24" fill="{BRONZE}"/>'+text(x+26,y+43,str(i),25,50,'white',True)
for i in [0,1,3,4]:svg+=arrow(f'M{xs[i]+widths[i]+2} {y+209}H{xs[i+1]-3}')
def stage(i,name,heading,body,status):
 global svg
 x=xs[i];w=widths[i]
 svg+=icon(name,x+w/2-23,y+20,46)+text(x+20,y+111,heading,31,w-40,serif=True)
 body_y=y+135+(len(wrap(heading,31,w-40,serif=True))-1)*39
 rows=wrap(body,21,w-40)
 assert body_y+(len(rows)-1)*28<y+302,(heading,body_y,len(rows))
 svg+=text(x+20,body_y,body,21,w-40,leading=28)+rect(x+14,y+311,w-28,62,SOFT,'#c4d5bc',14)+text(x+27,y+335,status,18,w-54,GREEN,True,leading=24)
stage(0,'search','Find child','Search or scan the shared Guest List. Help desk adds or corrects missing records.','One child record')
stage(1,'people','Daily drop-off','Select the adult present. Guardian details prefill; record another adult if needed. Verify the handoff.','Parent / chaperone / sibling 18+')
stage(3,'school','Classroom','Confirm the assigned room and physical arrival after screening and all required desk reviews.','Arrival recorded')
stage(4,'pin','Movement','Record Clinic, Other + reason, or Outing departure. Confirm each child’s actual return.','See return loops below')
stage(5,'pickup','Final pickup','Choose an authorized adult collector. Check identity in person, complete the handoff and record pickup.','Final release recorded')
x=xs[2]
svg+=icon('clipboard',x+80,y+19,48)+text(x+145,y+61,'Screening',35,600,serif=True)
svg+=text(x+24,y+108,'Review saved allergy and accommodation answers.',23,750)+text(x+24,y+140,'Confirm both today; ask for missing answers.',21,750)
svg+=rect(x+20,y+161,755,45,SOFT,'#b8cfb0',13)+icon('band',x+35,y+168,29,GREEN)+text(x+80,y+191,'Standard wristband for every child',23,665,GREEN,True)
svg+=rect(x+20,y+251,90,40,GREEN,GREEN,10)+text(x+31,y+278,'YES',21,78,'white',True)
for iy,name,label in [(220,'cross','Allergy desk'),(287,'chair','Accommodation desk')]:
 svg+=rect(x+140,y+iy,300,55,'#f4f8f0','#aac5aa',13)+icon(name,x+151,y+iy+14,28,GREEN)+text(x+191,y+iy+34,label,20,245,GREEN,True)
svg+=arrow(f'M{x+112} {y+271}H{x+125}V{y+247}H{x+136}',GREEN)+arrow(f'M{x+125} {y+271}V{y+314}H{x+136}',GREEN)
svg+=rect(x+485,y+230,285,97,SOFT,'#aac5aa',17)+text(x+504,y+265,'Desk cleared',23,245,GREEN,True)+text(x+504,y+297,'Extra band(s) checked',18,245,GREEN,True)
svg+=arrow(f'M{x+443} {y+247}H{x+465}V{y+279}H{x+481}',GREEN)+arrow(f'M{x+443} {y+314}H{x+465}V{y+279}',GREEN)
svg+=text(x+144,y+382,'Both needs → both desks.',18,380,GREEN,True)
svg+=rect(x+20,y+341,88,34,CREAM,LINE,10)+text(x+38,y+365,'NO',20,65,INK,True)
svg+=arrow(f'M{x+112} {y+358}H{xs[3]-5}',GREEN)
svg+=arrow(f'M{x+774} {y+279}H{xs[3]-5}',GREEN)
svg+=rect(50,857,2300,43,SOFT,'#b8cfb0',14)+text(75,887,'DAILY CHECK: Standard band for all. Allergy + accommodation needs = standard + allergy + accommodation bands (3 bands).',23,2250,GREEN,True)
svg+=text(55,946,'Every temporary departure has a recorded return',31,2250,serif=True)
for iy,lane,name,steps,stop in [
 (968,'CLINIC','cross',['Departure + adult','Away at clinic','Return to JP','Classroom / verified pickup'],'Still away until return'),
 (1068,'OTHER','flag',['Departure + adult + reason','Temporarily away','Return to JP','Classroom / verified pickup'],'Still away until return'),
 (1168,'OUTING','outing',['Roster + individual departure','Check every attendee','Individual return to JP','Classroom / verified pickup'],'Close only after all return')]:
 svg+=rect(50,iy,2300,83,'#f9f9ef','#cdd4b5',20)+icon(name,75,iy+23,37,GREEN)+text(130,iy+51,lane,25,255,GREEN,True)
 bx=[410,802,1195,1588]
 for j,(xx,label) in enumerate(zip(bx,steps)):
  svg+=rect(xx,iy+13,345,57,'#fffdf7','#adc09e',14)+text(xx+14,iy+37,label,20,317,GREEN,True,leading=25)
  if j<3:svg+=arrow(f'M{xx+350} {iy+42}H{bx[j+1]-7}',GREEN)
 svg+=rect(1978,iy+13,342,57,'#fff0e9','#eed0c4',14)+text(1994,iy+36,stop,19,310,RED,True,leading=24)
svg+=rect(50,1274,2300,100,CREAM,LINE,20)+icon('shield',76,1300,43,BRONZE)+text(140,1314,'GALA RE-ENTRY',24,260,BRONZE,True)+text(140,1349,'After daytime pickup',18,260)
for j,(xx,label) in enumerate(zip([410,893,1376,1859],['Fresh verified drop-off','Screening + bands again','Confirm classroom arrival','Verified final pickup'])):
 svg+=rect(xx,1294,445,60,'#fffdf7',LINE,14)+text(xx+16,1319,label,22,412,INK,True,leading=27)
 if j<3:svg+=arrow(f'M{xx+451} 1324H{xx+477}')
svg+=rect(50,1395,2300,129,'#fffdf9',LINE,22)+icon('mail',77,1434,48,BRONZE)
svg+=text(145,1435,'Guardian updates at recorded transitions',29,1080,serif=True)+text(145,1473,'When enabled: email + SMS to designated guardian contacts.',21,1070)+text(145,1503,'Review status in More → Notifications. Medical details stay private.',19,1070)
for xx,ww,label,fill in [(1270,245,'Queued',CREAM),(1560,285,'Accepted',SOFT),(1890,425,'Delivery receipt',SOFT)]:
 svg+=rect(xx,1415,ww,49,fill,LINE,15)+text(xx+16,1447,label,22,ww-32,GREEN if fill==SOFT else BRONZE,True)
svg+=arrow('M1522 1440H1552')+arrow('M1851 1440H1882')+text(1270,1500,'Failed or no receipt? Review before retrying.',21,1050,RED,True)
svg+=rect(50,1545,2300,99,SOFT,'#b8cfb0',20)+icon('people',75,1572,40,GREEN)+text(137,1580,'VOLUNTEER HANDOVER',23,370,GREEN,True)+text(137,1614,'More → Volunteers / My shift',18,370)
labels=['Count children together','Review outstanding returns','Incoming volunteer accepts','Outgoing volunteer finishes']
for i,label in enumerate(labels):
 xx=535+i*451
 svg+=text(xx,1584,label,22,410,GREEN,True)
 if i<3:svg+=arrow(f'M{xx+402} 1577H{xx+438}',GREEN)
svg+=text(535,1620,'Late relief? Alert the lead and stay with the children until responsibility is safely transferred.',19,1770)
svg+=text(275,1680,'Volunteers keep every handoff safe and smooth to prevent overcrowding.',26,2000,BRONZE,True)
svg+='</svg>'
file='festio-juniors-client-overview' if CLIENT else 'festio-juniors-workflow-overview';(OUT/(file+'.svg')).write_text(svg)
with sync_playwright() as pw:
 b=pw.chromium.launch();page=b.new_page(viewport={'width':W,'height':H},device_scale_factor=2);page.set_content('<style>html,body{margin:0}svg{display:block}</style>'+svg);page.screenshot(path=str(OUT/(file+'.png')))
 page.set_content('<title>Festio Juniors operating flow</title><style>@page{size:A3 landscape;margin:0}html,body{margin:0}svg{width:420mm;height:297mm;display:block}</style>'+svg);page.pdf(path=str(OUT/(file+'.pdf')),format='A3',landscape=True,margin={'top':'0','bottom':'0','left':'0','right':'0'},print_background=True,prefer_css_page_size=True);b.close()
print('Generated operating flow SVG, PNG and A3 PDF:',OUT)
