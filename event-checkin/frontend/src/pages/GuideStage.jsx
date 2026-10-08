import {useEffect,useRef,useState} from 'react'
import {api} from '../api'
import {useAuth} from '../context/AuthContext'
import {Modal} from './redesign/RedesignShell'
import {GUIDE_STAGES,selectedRecipes,requiredServices,taskRevision,effectiveProgress} from './guideStageConfig.mjs'
import {selectedOutcomeIds} from './guidedSetupPhaseOneModel.mjs'
import {saveGuideResume} from './guideNavigation.mjs'
import {CHECKLISTS} from './guideChecklists.mjs'
import {MealTimingControl} from './SetupFeatureControls'
import './GuidedSetupPhaseTwo.css'
import './GuideStage.css'
const status=r=>r.unknown?'Cannot verify':r.notApplicable?'Not applicable':r.blocked?'Blocked':r.complete?'Checks complete':'Ready for next check'
export default function GuideStage({phase,eventId,onBack,notify}) {
 const {user}=useAuth(), config=GUIDE_STAGES[phase]
 const [data,setData]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[editor,setEditor]=useState(null),[saving,setSaving]=useState(false)
 const generation=useRef(0)
 async function load(){
  const request=++generation.current
  if(!eventId){setLoading(false);return}
  setLoading(true);setError('')
  try{
   const [events,progress]=await Promise.all([api.listEvents(),api.getSetupProgress(eventId)])
   const event=events.find(e=>e.id===eventId)
   if(!event)throw new Error('This event is not available to your account.')
   const selected=selectedOutcomeIds(progress.steps), recipes=selectedRecipes(phase,selected), services=requiredServices(phase,recipes,selected)
   const calls=await Promise.allSettled(services.map(([, ,method])=>Promise.resolve().then(()=>api[method](eventId))))
   if(request!==generation.current)return
   const values={checkedAt:new Date().toISOString(),event,events,progress:progress.steps||{},evidence:progress.evidence||[],legacyChecks:progress.legacy_checks||[],selectedOutcomes:selected,dataFailures:[]}
   calls.forEach((result,i)=>{const [key,label]=services[i];if(result.status==='fulfilled')values[key]=result.value;else values.dataFailures.push({key,label,message:result.reason?.message||'Service check failed'})})
   values.progressForChecks=effectiveProgress(phase,values)
   setData(values)
  }catch(e){if(request===generation.current)setError(e.message)}finally{if(request===generation.current)setLoading(false)}
 }
 useEffect(()=>{setData(null);setEditor(null);load();return()=>{generation.current++}},[eventId,phase]) // eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>{if(!loading && data){const task=new URLSearchParams(window.location.search).get('task');if(task)document.getElementById(`guide-task-${task}`)?.scrollIntoView({block:'start'})}},[loading,data])
 function workspace(recipe){saveGuideResume(eventId,user?.id,config.view,recipe.id)}
 function openEvidence(recipe){setEditor({recipe,checks:(CHECKLISTS[phase===5&&recipe.id==='materials'?'live_materials':recipe.id]||[]).map(label=>({label,passed:false})),reference:'',notes:'',result:'partial',revision:taskRevision(phase,recipe.id,data)})}
 async function saveEvidence(e){
  e.preventDefault();if(saving)return;setSaving(true);const request=generation.current
  try{
   await api.recordSetupEvidence({event_id:eventId,step_key:`phase${phase}_${config.testKeys[editor.recipe.id]}`,result:editor.result,checks:editor.checks,reference:editor.reference,notes:editor.notes,config_revision:editor.revision})
   if(request!==generation.current)return
   setEditor(null);notify('Scoped test record saved. No production action was performed.');await load()
  }catch(e){if(request===generation.current)notify(e.message,true)}finally{setSaving(false)}
 }
 if(!eventId)return <p>Select an event to open its guide.</p>
 if(loading)return <p role="status">Checking {config.label.toLowerCase()}…</p>
 if(error)return <div role="alert"><p>{error}</p><button className="rr-btn secondary" onClick={load}>Retry guide checks</button></div>
 if(!data)return null
 const readiness=config.model({...data,progress:data.progressForChecks})
 const next=readiness.next
 return <section className="gst-guide">
  <header className="gsp-guide-head"><div><span className="gsp-eyebrow">Stage {phase+2} of 8 · {config.label}</span><h2>{data.event.name}</h2><p>{readiness.complete} of {readiness.total} applicable tasks checked · {readiness.blocked} blocked · {readiness.unknown} cannot verify</p><small>{phase===6?'Post-event checks do not count toward launch readiness.':'These checks describe this stage, not whole-event launch approval.'}</small></div><div className="gst-head-actions"><button className="rr-btn secondary" onClick={onBack}>Previous stage</button><button className="rr-btn secondary" onClick={load}>Refresh status</button></div></header>
  <p className="guide-launch-state"><strong>Event lifecycle: {data.event.status || 'Unknown'}.</strong> {data.event.status==='active'?'Activation is separate from service readiness; check each task before using it.':'Complete draft configuration and scoped tests here. Activate the event in Event Setup before guest launch.'} <a href="/admin-redesign">Review event status →</a></p>
  {phase===4 && <MealTimingControl event={data.event} onRefresh={load}/>}
  {!!readiness.dataFailures.length&&<div className="gst-warning" role="alert"><div><strong>Some checks could not be verified</strong><ul>{readiness.dataFailures.map(f=><li key={f.key}>{f.label}: {f.message||'Service unavailable'}. Retry to verify affected tasks.</li>)}</ul><button className="rr-btn secondary" onClick={load}>Retry service checks</button></div></div>}
  {next?<section className={`gsp-next${next.blocked?' blocked':''}`}><div><span className="gsp-eyebrow">Next recommended action</span><h3>{next.title}</h3><p>{next.description}</p></div>{next.unknown?<button className="rr-btn primary" onClick={load}>Retry service checks</button>:<a className="rr-btn primary" href={next.route} onClick={()=>workspace(next)}>{next.action} →</a>}</section>:<p role="status">{readiness.total?'All applicable checks in this stage are complete. Review production actions in their workspaces.':'No tasks apply to the outcomes selected for this stage.'}</p>}
  <div className="gst-recipe-list">{readiness.recipes.map(recipe=>{
   const testKey=config.testKeys[recipe.id], stepKey=`phase${phase}_${testKey}`
   const records=testKey?data.evidence.filter(e=>e.step_key===stepKey):[]
   const latest=records[0], stale=latest && latest.config_revision!==taskRevision(phase,recipe.id,data)
   const legacy=testKey && data.progress[stepKey]==='completed'&&!latest
   return <article id={`guide-task-${recipe.id}`} className={`gst-recipe ${recipe.complete?'complete':recipe.blocked?'blocked':'ready'}`} key={recipe.id}>
    <div className="gst-recipe-copy"><div className="gst-recipe-title"><h3>{recipe.title}</h3><b>{status(recipe)}</b></div><p>{recipe.description}</p>
    <div className="gst-evidence"><strong>Current service checks</strong><small>Checked {new Date(data.checkedAt).toLocaleTimeString()}</small><span>{recipe.unknown?recipe.unavailable.map(f=>`${f.label} unavailable`).join(' · '):recipe.evidence.replaceAll('verified','recorded')}</span></div>
    {recipe.blocked&&<p><strong>Next prerequisite:</strong> {recipe.resolution}</p>}
    {legacy&&<p className="gst-warning">Legacy manual confirmation exists. Record a scoped checklist before calling this test complete.</p>}
    {latest&&<p role="status">Organizer-recorded check: {latest.result}{stale?' · Configuration changed; recheck needed':''} · {latest.recorded_at ? new Date(/(Z|[+-]\d\d:\d\d)$/.test(latest.recorded_at)?latest.recorded_at:`${latest.recorded_at}Z`).toLocaleString() : ''}</p>}
    {records.length>0&&<details><summary>Test history ({records.length})</summary>{records.map(e=><div className="guide-history" key={e.id}><strong>{e.result} · {e.source==='organizer_recorded'?'Organizer recorded':'Recorded check'}</strong><p>Reference: {e.reference}</p><ul>{e.checks.map((c,i)=><li key={i}>{c.passed?'✓':'Pending'} {c.label}</li>)}</ul><p>{e.notes}</p><small>Recorded by {e.recorded_by} · {e.recorded_at}</small></div>)}</details>}
    <div className="gst-recipe-actions"><a className="rr-btn secondary" href={recipe.route} onClick={()=>workspace(recipe)}>{recipe.action} →</a>{testKey&&!recipe.notApplicable&&<button className="rr-btn primary" disabled={recipe.unknown} onClick={()=>openEvidence(recipe)}>Record test or review</button>}</div>
    <small>Configure and preview in the workspace. {testKey?'Record only the test performed. ':''}Publishing, sending, charging and batch issuance remain separate actions.</small>
   </div></article>
  })}</div>
  {editor&&<Modal title={`Record check: ${editor.recipe.title}`} onClose={()=>!saving&&setEditor(null)}><form className="guide-evidence-form" onSubmit={saveEvidence}><p>This records your observation. It does not perform the test or launch anything.</p>{editor.checks.map((check,i)=><label key={check.label}><input type="checkbox" checked={check.passed} onChange={e=>setEditor({...editor,checks:editor.checks.map((c,j)=>j===i?{...c,passed:e.target.checked}:c)})}/>{check.label}</label>)}<label>Test record or reference<input required minLength={3} maxLength={500} value={editor.reference} onChange={e=>setEditor({...editor,reference:e.target.value})} placeholder="Order/guest/certificate ID, or a precise review reference"/></label><small>Use record IDs; do not paste private GuestHub links or access tokens.</small><label>Scope and remaining work<textarea maxLength={2000} value={editor.notes} onChange={e=>setEditor({...editor,notes:e.target.value})}/></label><label>Result<select aria-label="Result" value={editor.result} onChange={e=>setEditor({...editor,result:e.target.value})}><option value="partial">Partial — more checks needed</option><option value="failed">Failed — needs correction</option><option value="passed" disabled={editor.recipe.blocked||!editor.checks.every(c=>c.passed)}>Passed — these checks only</option></select></label><button className="rr-btn primary" disabled={saving||!editor.reference.trim()||(editor.result==='passed'&&(editor.recipe.blocked||!editor.checks.every(c=>c.passed)))}>{saving?'Saving…':'Save test record'}</button></form></Modal>}
 </section>
}
