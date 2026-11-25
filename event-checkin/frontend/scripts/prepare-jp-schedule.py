"""Convert the supplied workbook to an Experience DRAFT payload; never calls APIs."""
import json,sys,hashlib,re
from pathlib import Path
from datetime import datetime,time,timedelta
import openpyxl
source=Path(sys.argv[1]);target=Path(sys.argv[2]);w=openpyxl.load_workbook(source,data_only=True)
issues=[
'Confirm Group C outing participation: public hours include C but its group timetable remains onsite.',
'Confirm outing check-in, bus departure and actual hotel arrival: grid 9am–5pm; notes say departure 10am and return journey starts 4pm.',
'Confirm gala pickup window: group sheets show 10:30pm; public operating hours close at 11pm.',
'Confirm Friday lunch for Groups A/B around Jumuah.',
'Confirm the duration of single-cell activities: the draft currently uses the workbook’s 30-minute grid.',
'Confirm physical classrooms, activity locations, staffing targets and the unfilled activity periods.'
]
groups=[];steps=[]
for sheet in w:
 if not sheet.title.startswith('Group '):continue
 key=sheet.title[6];groups.append({'key':key,'label':sheet.title,'age_groups':[sheet.title,'Group '+key],'classrooms':[],'required_staff':None})
 for col in range(2,5):
  day=sheet.cell(2,col).value.date();session_key=day.isoformat()+':daytime'
  for row in range(4,38):
   value=sheet.cell(row,col).value;start=sheet.cell(row,1).value
   if not value or not isinstance(start,time):continue
   end=(datetime.combine(day,start)+timedelta(minutes=30)).time()
   for merged in sheet.merged_cells.ranges:
    if merged.min_col==col and merged.min_row==row:
     next_value=sheet.cell(merged.max_row+1,1).value
     if isinstance(next_value,time):end=next_value
   title=' '.join(str(value).split());slug=re.sub('[^a-z0-9]+','-',title.lower()).strip('-')
   gala=start>=time(19,30);meta={'kind':'activity','group':key,'date':day.isoformat(),'session_key':day.isoformat()+(':gala' if gala else ':daytime'),'source_cell':sheet.title+'!'+sheet.cell(row,col).coordinate}
   steps.append({'key':f'jp-{day}-{key}-{start:%H%M}-{slug}'[:120],'type':'custom','title':'Group '+key+' · '+title,'description':'Group '+key+' · JP programme','required':False,'blocks_checkin':False,'enabled':True,'is_segment':True,'conditions':{'age_groups_include':[sheet.title,'Group '+key]},'config':{'session':{'date':day.isoformat(),'start_time':start.strftime('%H:%M'),'end_time':end.strftime('%H:%M'),'room':''},'program':{'category':'JP programme','junior':meta}}})
for day,start,end in [('2026-12-25','08:30','19:30'),('2026-12-26','08:30','18:30'),('2026-12-27','09:00','19:30'),('2026-12-26','19:30','23:00')]:
 kind='gala' if start=='19:30' else 'daytime';steps.append({'key':f'jp-session-{day}-{kind}','type':'custom','title':'Gala childcare' if kind=='gala' else 'Daytime JP','required':False,'blocks_checkin':False,'enabled':True,'is_segment':False,'config':{'session':{'date':day,'start_time':start,'end_time':end},'program':{'junior':{'kind':'custody_session','date':day,'groups':[g['key'] for g in groups],'session_key':day+':'+kind,'review_notes':issues if len([s for s in steps if ((s.get('config',{}).get('program') or {}).get('junior') or {}).get('kind')=='custody_session'])==0 else []}}}})
for i,s in enumerate(steps):s['sort_order']=(i+1)*10
payload={'name':'NCNMO Junior Platform 2026 · JP programme','source_file':source.name,'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'groups':groups,'issues':issues,'steps':steps}
target.parent.mkdir(parents=True,exist_ok=True);target.write_text(json.dumps(payload,indent=2,ensure_ascii=False));print(json.dumps({'draft_steps':len(steps),'groups':len(groups),'review_questions':len(issues),'output':str(target)}))
