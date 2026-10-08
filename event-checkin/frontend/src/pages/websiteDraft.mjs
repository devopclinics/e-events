export const requiredRows={sessions:['Programme',['title']],speakers:['Speakers',['name']],stats:['At-a-glance cards',['value','label']],registration_facts:['Registration facts',['value']],venue_facts:['Venue facts',['value']],faqs:['FAQs',['question','answer']],tracks:['Audience tracks',['title']],exhibitors:['Exhibitors',['name']]}
export function draftIssues(content){return Object.entries(requiredRows).flatMap(([key,[label,fields]])=>(content[key]||[]).flatMap((row,i)=>fields.filter(f=>!String(row[f]||'').trim()).map(field=>({key,index:i,field,message:`${label} ${i+1}: enter ${field.replaceAll('_',' ')}.`}))))}
const sourceFields={sessions:['day','date','time','title','description','venue','audience','track','speaker'],speakers:['name','title','organization','bio','photo_url','session_titles']}
const equal=(a,b)=>JSON.stringify(a??'')===JSON.stringify(b??'')
export function sourceRefresh(existing,incoming,kind){
 const fields=sourceFields[kind],changes=[]
 existing.forEach((row,index)=>{
  if(!row.source_id)return
  const source=incoming.find(r=>r.source_id===row.source_id)
  if(!source){changes.push({index,field:'source_missing',before:!!row.source_missing,after:true,conflict:true,label:`${row.title||row.name}: no longer in source`});return}
  for(const field of fields)if(!equal(row[field],source[field]))changes.push({index,field,before:row[field],after:source[field]??'',conflict:!Object.hasOwn(row.source_baseline||{},field)||!equal(row[field],row.source_baseline[field]),label:`${row.title||row.name}: ${field}`})
 })
 incoming.forEach(source=>{if(!existing.some(r=>r.source_id===source.source_id))changes.push({field:'new',after:source,conflict:false,label:`Add ${source.title||source.name}`})})
 return changes
}
export function applyRefresh(existing,incoming,kind,changes,selected){
 const rows=existing.map(r=>({...r}))
 changes.forEach((c,i)=>{if(!selected.includes(i))return;if(c.field==='new')rows.push({...c.after,source_baseline:{...c.after}});else rows[c.index][c.field]=c.after})
 return rows.map(row=>{const source=incoming.find(r=>r.source_id===row.source_id);return source?{...row,source_missing:false,source_baseline:Object.fromEntries(sourceFields[kind].map(f=>[f,source[f]??'']))}:row})
}
export function friendlyWebsiteError(error){const msg=error?.message||'The request failed. Please try again.';return msg.replace(/content\.([a-z_]+)\.(\d+)\.([a-z_]+)/g,(_,key,i,f)=>`${requiredRows[key]?.[0]||key.replaceAll('_',' ')} ${Number(i)+1} — ${f.replaceAll('_',' ')}`).replaceAll('String should have at least 1 character','Please complete this field')}
