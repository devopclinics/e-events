import {useEffect,useState} from 'react'
import {api} from '../api'

export default function OrganizerHandoffs({me}) {
  const [rows,setRows]=useState([]),[resolved,setResolved]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[metrics,setMetrics]=useState(null),[safety,setSafety]=useState(null),[owners,setOwners]=useState({})
  const [attempts,setAttempts]=useState({}),[providerIds,setProviderIds]=useState({})
  async function load(){
    try{setError('');setRows(await api.marketingHandoffs(resolved));setMetrics(await api.marketingCommerceMetrics());if(me?.role==='superadmin')setSafety(await api.marketingJourneySafety())}catch(e){setError(e.message)}
  }
  useEffect(()=>{load()},[resolved])
  async function act(row,action,body){
    if(busy)return
    setBusy(true)
    try{
      if(action==='resume-conversation')await api.marketingResumeConversation(row.conversation_id)
      else await api.marketingHandoffAction(row.id,action,body)
      await load()
    }catch(e){setError(e.message)}finally{setBusy(false)}
  }
  async function inspect(row){try{setAttempts({...attempts,[row.id]:await api.marketingSalesAttempts(row.conversation_id)})}catch(e){setError(e.message)}}
  async function reconcile(row,attempt,body){if(busy)return;setBusy(true);try{await api.marketingReconcileReply(attempt.id,body);await inspect(row);await load()}catch(e){setError(e.message)}finally{setBusy(false)}}
  return <section className="space-y-4"><h2>Organizer handoffs</h2><p>Replies remain paused while a person reviews them. Resolving a case does not resume automation. Unknown provider outcomes need reconciliation before a separate resume action.</p>
    <label><input type="checkbox" checked={resolved} onChange={e=>setResolved(e.target.checked)}/> Include resolved cases</label> <button onClick={load} disabled={busy}>Refresh</button>
    {error&&<p role="alert">{error}</p>}
    {!rows.length&&<p>No cases in this view.</p>}
    {rows.map(row=><article className="rounded border p-4 space-y-2" key={row.id}><h3>{row.conversation_id?'Sales conversation':'Organizer reply'} · {row.status}</h3><p>Case {row.id} · Owner: {row.owner||'Unassigned'} · Notification: {row.notification} · Attempts: {row.attempts}</p>
      {me?.role==='superadmin'&&<div><label>Assign an active operator <input type="email" value={owners[row.id]||''} onChange={e=>setOwners({...owners,[row.id]:e.target.value})}/></label><button disabled={busy||!owners[row.id]} onClick={()=>act(row,'assign-owner',{owner:owners[row.id]})}>Assign owner</button></div>}
      {me?.role!=='viewer'&&<div className="flex gap-2"><button disabled={busy||!row.owner||row.status!=='open'} onClick={()=>act(row,'acknowledge')}>Acknowledge</button><button disabled={busy||!row.owner||row.status==='resolved'} onClick={()=>act(row,'resolve')}>Resolve case</button>{row.status==='resolved'&&<button disabled={busy||!row.owner} onClick={()=>act(row,row.conversation_id?'resume-conversation':'resume-lead')}>Explicitly resume future automation</button>}</div>}
      {me?.role!=='viewer'&&['sending','uncertain'].includes(row.notification)&&<div><p>Inspect the notification destination before recording its outcome.</p><button disabled={busy} onClick={()=>act(row,'reconcile-notification',{delivered:true})}>Confirm notification delivered</button> <button disabled={busy} onClick={()=>act(row,'reconcile-notification',{delivered:false})}>Confirm notification was not delivered</button></div>}
      {row.conversation_id&&<div><button onClick={()=>inspect(row)}>Review provider attempts</button>{(attempts[row.id]||[]).map(attempt=><div key={attempt.id}><p>{attempt.id} · {attempt.status} · {attempt.attempts} attempts</p>{me?.role!=='viewer'&&['sending','unknown'].includes(attempt.status)&&<><p>Check the authenticated provider record before reconciling. This action leaves automation paused.</p><label>Confirmed provider acceptance ID <input value={providerIds[attempt.id]||''} onChange={e=>setProviderIds({...providerIds,[attempt.id]:e.target.value})}/></label><button disabled={busy||!providerIds[attempt.id]} onClick={()=>reconcile(row,attempt,{provider_id:providerIds[attempt.id]})}>Record confirmed acceptance</button><button disabled={busy} onClick={()=>reconcile(row,attempt,{definitely_not_sent:true})}>Record definitely not sent</button></>}</div>)}</div>}
      <details><summary>Audit history</summary><ul>{row.history.map((item,index)=><li key={index}>{item.at} · {item.action} · {item.actor||item.result||item.channel||''}{item.superseded?' · superseded assignment':''}</li>)}</ul></details>
    </article>)}
    {metrics&&<details><summary>Distinct commerce funnel</summary><p>Acquired organizers: {metrics.organizer_acquired}. Free attendee orders: {metrics.free_orders}. Counts use positive payments; renewals and attendee sales are separate from organizer acquisition.</p><pre>{JSON.stringify(metrics,null,2)}</pre></details>}
    {safety&&<details><summary>Journey safety and gates</summary><pre>{JSON.stringify(safety,null,2)}</pre></details>}
  </section>
}
