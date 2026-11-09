import {useEffect,useState} from 'react'
import {api} from '../api'
import './ScannerActionSettings.css'
export default function ScannerActionSettings({event,onSaved}) {
 const [form,setForm]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[saved,setSaved]=useState(false)
 const canManage=event?.my_can_manage_event&&(event.my_feature_permissions==null||event.my_feature_permissions.settings==='manage')
 useEffect(()=>{let active=true;setForm(null);if(canManage)api.scannerPresentation(event.id).then(data=>{if(active)setForm(data)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[event?.id,canManage])
 if(!canManage)return null
 const toggle=(scope,id,zone)=>setForm(v=>{const current=zone?(v.zone_step_ids[zone]||[]):v.admission_step_ids;const next=current.includes(id)?current.filter(s=>s!==id):[...current,id];return {...v,[scope]:zone?{...v.zone_step_ids,[zone]:next}:next}})
 const actions=(form?.steps||[]).filter(s=>s.type!=='session_attendance'&&!s.blocks_checkin)
 async function save(){setBusy(true);setError('');setSaved(false);try{const data=await api.saveScannerPresentation(event.id,form);setForm(data);await onSaved();setSaved(true)}catch(e){setError(e.message)}finally{setBusy(false)}}
 return <details className="scanner-action-settings"><summary>Configure scanner actions <span>Choose what staff see at each check-in point</span></summary><div className="sas-body">
 <p>1. Turn on focused scanning. 2. Match each zone to its session. 3. Select only the extra actions needed at that point, then save.</p>
 {error&&<p role="alert">{error}</p>}{!form?<p>Loading settings…</p>:<><label className="sas-focus"><input type="checkbox" checked={form.focused} onChange={e=>setForm({...form,focused:e.target.checked})}/><span><b>Focus on the selected check-in point</b><small>Hide unrelated sessions, networking and feedback actions. Required prerequisites that block admission remain visible.</small></span></label>
 <div className="sas-grid"><section><h3>General event check-in</h3><p>Records arrival. It does not check the guest into Conference or Dinner.</p><b>Additional actions</b>{actions.map(s=><label key={s.id}><input type="checkbox" checked={form.admission_step_ids.includes(s.id)} onChange={()=>toggle('admission_step_ids',s.id)}/>{s.title}</label>)}</section>
 {form.zones.map(zone=><section key={zone.id}><h3>{zone.name}</h3><label className="sas-session">Session recorded by entry<select value={form.attendance_step_ids[zone.id]||''} onChange={e=>setForm({...form,attendance_step_ids:{...form.attendance_step_ids,[zone.id]:e.target.value}})}><option value="">No linked programme session</option>{form.steps.filter(s=>s.type==='session_attendance').map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select></label><p>A successful entry records this session automatically. Access restrictions and table rules still apply.</p><b>Additional actions</b>{actions.map(s=><label key={s.id}><input type="checkbox" checked={(form.zone_step_ids[zone.id]||[]).includes(s.id)} onChange={()=>toggle('zone_step_ids',s.id,zone.id)}/>{s.title}</label>)}</section>)}</div>
 <p className="sas-note">Staff select a zone or gate before scanning. Changing the point clears the previous result. These settings do not change guest access, send messages or replay earlier scans.</p><button type="button" disabled={busy} onClick={save}>{busy?'Saving…':'Save scanner actions'}</button>{saved&&<span role="status">Saved. Staff should refresh an open scanner to load the new configuration.</span>}</>}
 </div></details>
}
