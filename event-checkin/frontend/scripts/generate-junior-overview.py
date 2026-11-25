"""Create an editable reference-style workflow and print/image exports. No event data used."""
from pathlib import Path
from html import escape
from PIL import ImageFont
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'public/juniors/guide/2026-11-24-v2';OUT.mkdir(parents=True,exist_ok=True)
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
svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-label="Festio Juniors complete workflow"><title>Festio Juniors complete workflow: daily arrival, screening, every return and verified pickup</title><defs>'
for name,color in [('brown',BRONZE),('green',GREEN)]:svg+=f'<marker id="{name}" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto"><path d="m0 0 6 3-6 3" fill="{color}"/></marker>'
svg+='</defs>'+f'<rect width="{W}" height="{H}" fill="{PAPER}"/>'
svg+=text(55,110,'Festio',77,330,BRONZE,serif=True)+f'<path d="M350 40V165" stroke="{BRONZE}" stroke-width="2"/>'
svg+=text(395,106,'Festio Juniors',77,1250,serif=True)+text(400,161,'Every child accounted for. Every handoff recorded.',30,1300)
svg+=rect(1740,34,610,60,BRONZE,BRONZE,14)+text(1765,74,'LIVE WORKFLOW · STAFF TRAINING',24,570,'white',True)
svg+=text(1750,135,'Reusable junior programmes.',24,580)+text(1750,170,'Use the event’s schedule and permissions.',22,580)
svg+=rect(50,198,2300,55,CREAM,LINE,16)+text(75,234,'FIRST ARRIVAL: convention check-in before JP custody. EACH JP DAY: a fresh drop-off from the configured JP start date.',24,2250,BRONZE,True)
y=285;h=500;xs=[50,328,646,1464,1742,2060];widths=[260,300,800,260,300,290]
for i,(x,w) in enumerate(zip(xs,widths),1):
 svg+=rect(x,y,w,h,'#fffdf9')+f'<circle cx="{x+37}" cy="{y+39}" r="27" fill="{BRONZE}"/>'+text(x+28,y+49,str(i),27,50,'white',True)
for i in [0,1,3,4]:svg+=arrow(f'M{xs[i]+widths[i]+2} {y+250}H{xs[i+1]-3}')
def stage(i,name,title,body,status):
 global svg
 x=xs[i];w=widths[i];svg+=icon(name,x+w/2-30,y+35,61)+text(x+23,y+153,title,34,w-46,serif=True)
 title_lines=len(wrap(title,34,w-46,serif=True));body_y=y+174+title_lines*43;body_size=23
 while True:
  body_line=round(body_size*1.35)
  if body_y+(len(wrap(body,body_size,w-46))-1)*body_line+body_size*.3<y+394:break
  body_size-=1
  assert body_size>=17,f'Stage body too dense: {title}'
 svg+=text(x+23,body_y,body,body_size,w-46,leading=body_line)
 svg+=rect(x+16,y+410,w-32,69,SOFT,'#d6dfc9',16)+text(x+30,y+439,status,20,w-60,GREEN,True,leading=26)
stage(0,'search','Find child','Search name or badge. Scan to open the record. Add or correct missing records at the help desk.','Search before adding')
stage(1,'people','Record drop-off','Guardian details prefill. Verify the adult. If different, record name, relationship and optional phone.','Parent / chaperone / sibling 18+')
stage(3,'school','Classroom','Confirm the assigned room and actual arrival. Finish all required desk reviews and bands first.','In classroom')
stage(4,'pin','Movement','Choose Clinic, Other + reason, or Outing. Record the accompanying adult where required.','Every departure needs a return')
stage(5,'pickup','Final release','Choose an authorized adult. Check identity in person, complete the handoff, then confirm pickup.','Released: pickup recorded')
x=xs[2];svg+=icon('clipboard',x+95,y+34,62)+text(x+182,y+72,'Screening',40,575,serif=True)
svg+=text(x+25,y+128,'Allergy? Accommodation? Saved answers prefill.',24,750)+text(x+25,y+163,'Ask what is missing; confirm both with the adult today.',23,750)
svg+=rect(x+20,y+239,112,47,GREEN,GREEN,12)+text(x+34,y+271,'Any YES',21,100,'white',True)
for iy,name,label in [(228,'cross','Allergy desk'),(323,'chair','Accommodation desk')]:
 svg+=rect(x+169,y+iy,267,72,'#f4f8f0','#aac5aa',17)+icon(name,x+183,y+iy+18,35,GREEN)+text(x+230,y+iy+(29 if len(wrap(label,20,195,True))>1 else 43),label,20,195,GREEN,True,leading=25)
svg+=arrow(f'M{x+134} {y+262}H{x+154}V{y+264}H{x+165}',GREEN)+arrow(f'M{x+145} {y+264}V{y+359}H{x+165}',GREEN)
svg+=rect(x+490,y+247,280,138,SOFT,'#aac5aa',20)+icon('band',x+605,y+259,42,GREEN)+text(x+512,y+328,'Desk reviewed',23,240,GREEN,True)+text(x+512,y+356,'Extra band(s) checked',18,240,GREEN,True)
svg+=arrow(f'M{x+440} {y+264}H{x+468}V{y+318}H{x+486}',GREEN)+arrow(f'M{x+440} {y+359}H{x+468}V{y+318}',GREEN)
svg+=text(x+172,y+417,'Both Yes → both desks; not either/or.',21,560,GREEN,True)
svg+=rect(x+20,y+433,90,37,'#f9e6c9','#f9e6c9',10)+text(x+39,y+460,'NO',21,75,INK,True)
svg+=arrow(f'M{x+112} {y+450}H{x+783}',GREEN)+arrow(f'M{x+774} {y+317}H{x+788}V{y+450}H{xs[3]-4}',GREEN)
svg+=rect(x+25,y+477,747,0,SOFT,SOFT,0) if False else ''
# A shared rule below the row prevents the No branch from implying no wristband.
svg+=rect(50,800,2300,49,SOFT,'#b8cfb0',16)+icon('band',75,808,31,GREEN)+text(123,833,'STANDARD BAND FOR EVERY SCREENED CHILD · BOTH NEEDS = STANDARD + ALLERGY + ACCOMMODATION (3 BANDS) · CONFIRM DAILY',23,2190,GREEN,True)
svg+=text(55,894,'Every temporary movement has its own complete return cycle',32,2250,serif=True)
for iy,lane,name,note,steps,stop in [
 (921,'CLINIC','cross','Temporary clinic visit',['Record departure + adult','Away at clinic','Record return to JP','Classroom arrival / verified pickup'],'No return = still away'),
 (1044,'OTHER','flag','Specify the reason',['Record departure + adult + reason','Temporarily away','Record return to JP','Classroom arrival / verified pickup'],'No return = still away'),
 (1167,'OUTING','outing','Permission-verified roster',['Confirm outing departure','Review attendee counts','Confirm outing return','Classroom arrival / verified pickup'],'Outstanding returns block closure')]:
 svg+=rect(50,iy,2300,105,'#f9f9ef','#cdd4b5',25)+icon(name,78,iy+27,45,GREEN)+text(140,iy+42,lane,28,235,GREEN,True)+text(140,iy+78,note,18,250)
 bx=[410,802,1195,1588];bw=345
 for j,(xx,label) in enumerate(zip(bx,steps)):
  svg+=rect(xx,iy+19,bw,68,'#fffdf7','#adc09e',17)+text(xx+17,iy+44,label,21,bw-34,GREEN,True,leading=27)
  if j<3:svg+=arrow(f'M{xx+bw+5} {iy+54}H{bx[j+1]-7}',GREEN)
 svg+=rect(1978,iy+20,342,66,'#fff0e9','#eed0c4',17)+text(1997,iy+44,stop,20,302,RED,True,leading=26)
svg+=text(60,1314,'Returning for the rest of the day? Confirm classroom arrival. Leaving for the day? Record return first, then verified pickup.',24,2290,GREEN,True)
svg+=rect(50,1342,2300,154,'#fffdf9',LINE,25)+icon('mail',82,1382,55,BRONZE)
svg+=text(160,1385,'Guardian updates at recorded transitions',32,1040,serif=True)+text(160,1424,'Email + SMS notices are recorded. Actual sending needs enabled switches,',22,1050)+text(160,1456,'contacts, consent, provider readiness and credits. Practice events never send.',22,1050)
svg+=f'<path d="M1230 1363V1477" stroke="{LINE}" stroke-width="2"/>'
for xx,ww,label,fill in [(1260,235,'Queued',CREAM),(1545,275,'Accepted',SOFT),(1870,420,'Delivered — receipt only',SOFT)]:
 svg+=rect(xx,1365,ww,52,fill,LINE,16)+text(xx+18,1400,label,23,ww-32,GREEN if fill==SOFT else BRONZE,True)
svg+=arrow('M1503 1392H1535')+arrow('M1828 1392H1860')+text(1270,1462,'Failed / setup required / uncertain → review before retrying',21,1020,RED,True)
for xx,name,title,body in [(50,'clipboard','Help desk','Correct child records and collector authorization.'),(828,'shield','Admin / assigned lead','Permissions, exceptions and unresolved records.'),(1606,'box','Inventory','Issue, return, damage or loss; record responsibility.')]:
 svg+=rect(xx,1520,744,91,'#fffdf9',LINE,22)+icon(name,xx+25,1541,45,BRONZE)+text(xx+90,1557,title,27,620,serif=True)+text(xx+90,1590,body,20,620)
svg+=rect(50,1631,2300,52,BRONZE,BRONZE,17)+text(185,1668,'EVENT OPT-IN  •  REUSABLE FOR FUTURE JUNIOR PROGRAMMES  •  EXISTING EVENT FLOWS PRESERVED',26,2050,'white',True)
svg+='</svg>'
file='festio-juniors-workflow-overview';(OUT/(file+'.svg')).write_text(svg)
with sync_playwright() as pw:
 b=pw.chromium.launch();p=b.new_page(viewport={'width':W,'height':H},device_scale_factor=2);p.set_content('<style>html,body{margin:0}svg{display:block}</style>'+svg);p.screenshot(path=str(OUT/(file+'.png')))
 p.set_content('<title>Festio Juniors complete workflow</title><style>@page{size:A3 landscape;margin:0}html,body{margin:0}svg{width:420mm;height:297mm;display:block}</style>'+svg);p.pdf(path=str(OUT/(file+'.pdf')),format='A3',landscape=True,margin={'top':'0','bottom':'0','left':'0','right':'0'},print_background=True,prefer_css_page_size=True);b.close()
print('Generated editable SVG, high-resolution PNG and A3 landscape PDF:',OUT)
