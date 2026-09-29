import { useEffect, useMemo, useState } from 'react'
import { api } from '../../api'
import './LiveContentWorkspace.css'

const DEFAULT_DESIGN = { title: 'Certificate of Participation', subtitle: 'This certificate is proudly presented to', body: 'For successful participation in this event', primary_color: '#075845', accent_color: '#dba92e', signature_name: 'Event Organizer', orientation: 'landscape' }

function Notice({ value }) { return value ? <div className={`lc-notice ${value.type || ''}`}>{value.text}</div> : null }
function Field({ label, children, help }) { return <label className="lc-field"><span>{label}</span>{children}{help && <small>{help}</small>}</label> }

export function PresenterMaterialsWorkspace({ eventId, sessions = [] }) {
  const [materials, setMaterials] = useState([]), [notice, setNotice] = useState(null), [busy, setBusy] = useState(false)
  const [mode, setMode] = useState('upload')
  const [form, setForm] = useState({ title: '', session_step_id: '', kind: 'slides', visibility: 'production', availability: 'after_approval', url: '' })
  const [file, setFile] = useState(null)
  const load = () => api.listPresenterMaterials(eventId).then(setMaterials).catch((e) => setNotice({ type: 'error', text: e.message }))
  useEffect(() => { load() }, [eventId])
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setNotice(null)
    try {
      if (mode === 'upload') {
        if (!file) throw new Error('Choose a presentation or resource file.')
        await api.uploadPresenterMaterial(eventId, file, form)
      } else await api.addPresenterMaterialLink(eventId, { ...form, session_step_id: form.session_step_id || null })
      setForm((v) => ({ ...v, title: '', url: '' })); setFile(null); await load()
      setNotice({ type: 'success', text: 'Material saved. Review it before approving it for the event.' })
    } catch (e2) { setNotice({ type: 'error', text: e2.message }) } finally { setBusy(false) }
  }
  const update = async (row, patch) => { setBusy(true); try { await api.updatePresenterMaterial(eventId, row.id, patch); await load() } catch (e) { setNotice({type:'error', text:e.message}) } finally { setBusy(false) } }
  return <section className="lc-workspace">
    <header className="lc-hero"><div><span>Presenter library</span><h2>Session materials</h2><p>Collect, review, present, and release every deck and handout from one event-scoped workspace.</p></div><div className="lc-stat"><strong>{materials.length}</strong><small>materials</small></div></header>
    <Notice value={notice}/>
    <div className="lc-grid">
      <form className="lc-card lc-form" onSubmit={submit}>
        <div className="lc-card-head"><div><b>Add material</b><small>Files stay private until you approve their visibility.</small></div><div className="lc-switch"><button type="button" className={mode==='upload'?'active':''} onClick={()=>setMode('upload')}>Upload</button><button type="button" className={mode==='link'?'active':''} onClick={()=>setMode('link')}>Link</button></div></div>
        <Field label="Session"><select value={form.session_step_id} onChange={e=>setForm({...form,session_step_id:e.target.value})}><option value="">Event-wide resource</option>{sessions.map(s=><option key={s.id || s.source_step_id} value={s.id || s.source_step_id}>{s.title}</option>)}</select></Field>
        <Field label="Display title"><input required value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="Leadership keynote deck"/></Field>
        {mode==='upload' ? <Field label="File" help="PDF, PowerPoint, Excel, images, or MP4 · maximum 100 MB"><input type="file" accept=".pdf,.ppt,.pptx,.xls,.xlsx,.jpg,.jpeg,.png,.webp,.mp4" onChange={e=>setFile(e.target.files?.[0]||null)}/></Field> : <Field label="Secure source link" help="Google Slides, Microsoft 365, video, sheet, or website link"><input required type="url" value={form.url} onChange={e=>setForm({...form,url:e.target.value})} placeholder="https://…"/></Field>}
        <div className="lc-two"><Field label="Material type"><select value={form.kind} onChange={e=>setForm({...form,kind:e.target.value})}>{['slides','pdf','handout','sheet','video','link'].map(v=><option key={v}>{v}</option>)}</select></Field><Field label="Audience"><select value={form.visibility} onChange={e=>setForm({...form,visibility:e.target.value})}><option value="presenter">Presenter only</option><option value="production">Production team</option><option value="attendees">GuestHub attendees</option></select></Field></div>
        <button className="rr-btn primary" disabled={busy}>{busy?'Saving…':'Add to presenter library'}</button>
      </form>
      <div className="lc-card"><div className="lc-card-head"><div><b>Review queue</b><small>Approved items are ready for presentation or configured attendee release.</small></div></div>
        {!materials.length && <div className="lc-empty"><b>No materials yet</b><span>Upload a deck or attach a cloud presentation to begin.</span></div>}
        <div className="lc-list">{materials.map(row=><article key={row.id} className="lc-row"><div className={`lc-file-icon ${row.kind}`}>{row.kind==='slides'?'▤':row.kind==='video'?'▶':'⌑'}</div><div className="lc-row-main"><strong>{row.title}</strong><small>{row.session_title||'Event-wide'} · {row.source_type} · {row.visibility}</small><span className={`lc-status ${row.status}`}>{row.status}</span></div><div className="lc-actions"><a href={row.source_url} target="_blank" rel="noreferrer">Preview</a>{row.status!=='approved'&&<button disabled={busy} onClick={()=>update(row,{status:'approved'})}>Approve</button>}<button disabled={busy} onClick={()=>update(row,{status:'archived'})}>Archive</button></div></article>)}</div>
      </div>
    </div>
  </section>
}

export function CertificatesWorkspace({ eventId }) {
  const [templates,setTemplates]=useState([]),[selected,setSelected]=useState(null),[candidates,setCandidates]=useState([]),[certificates,setCertificates]=useState([]),[chosen,setChosen]=useState(new Set()),[notice,setNotice]=useState(null),[busy,setBusy]=useState(false)
  const load = async () => { const ts=await api.listCertificateTemplates(eventId); setTemplates(ts); const template=selected ? ts.find(t=>t.id===selected.id)||ts[0] : ts[0]; setSelected(template||null); setCertificates(await api.listEventCertificates(eventId)); if(template) setCandidates(await api.listCertificateCandidates(eventId,template.id)) }
  useEffect(()=>{ load().catch(e=>setNotice({type:'error',text:e.message})) },[eventId])
  useEffect(()=>{ if(selected) api.listCertificateCandidates(eventId,selected.id).then(setCandidates).catch(e=>setNotice({type:'error',text:e.message})) },[selected?.id])
  const eligible=useMemo(()=>candidates.filter(c=>c.eligible&&!c.issued),[candidates])
  const design={...DEFAULT_DESIGN,...(selected?.design||{})}, eligibility={minimum_sessions:1,require_event_checkin:true,...(selected?.eligibility||{})}
  const save = async () => { setBusy(true); try { const row=await api.saveCertificateTemplate(eventId,selected.id,{name:selected.name,design,eligibility,active:selected.active}); setSelected(row); setNotice({type:'success',text:'Certificate design and eligibility rules saved.'}) } catch(e){setNotice({type:'error',text:e.message})} finally{setBusy(false)} }
  const editDesign=(key,value)=>setSelected({...selected,design:{...design,[key]:value}}), editEligibility=(key,value)=>setSelected({...selected,eligibility:{...eligibility,[key]:value}})
  const issue=async(send_email)=>{setBusy(true);try{const ids=chosen.size?[...chosen]:eligible.map(c=>c.guest_id);const result=await api.issueEventCertificates(eventId,{template_id:selected.id,guest_ids:ids,eligible_only:true,send_email});setChosen(new Set());await load();setNotice({type:'success',text:`Issued ${result.issued} certificate${result.issued===1?'':'s'}${send_email?' and queued email delivery':''}.`})}catch(e){setNotice({type:'error',text:e.message})}finally{setBusy(false)}}
  if(!selected) return <div className="fl-loading">Preparing certificate studio…</div>
  return <section className="lc-workspace"><header className="lc-hero certificate"><div><span>Credential studio</span><h2>Participant certificates</h2><p>Qualify attendees from real event records, issue verifiable credentials, and deliver digital copies.</p></div><div className="lc-stat"><strong>{certificates.filter(c=>c.status==='issued').length}</strong><small>issued</small></div></header><Notice value={notice}/>
    <div className="lc-grid certificate-grid"><div className="lc-card lc-form"><div className="lc-card-head"><div><b>Design and rules</b><small>Changes apply to future certificates; issued snapshots remain unchanged.</small></div></div>
      <Field label="Certificate name"><input value={selected.name} onChange={e=>setSelected({...selected,name:e.target.value})}/></Field><Field label="Heading"><input value={design.title} onChange={e=>editDesign('title',e.target.value)}/></Field><Field label="Recognition text"><input value={design.body} onChange={e=>editDesign('body',e.target.value)}/></Field><div className="lc-two"><Field label="Primary color"><input type="color" value={design.primary_color} onChange={e=>editDesign('primary_color',e.target.value)}/></Field><Field label="Accent color"><input type="color" value={design.accent_color} onChange={e=>editDesign('accent_color',e.target.value)}/></Field></div><Field label="Signature label"><input value={design.signature_name} onChange={e=>editDesign('signature_name',e.target.value)}/></Field>
      <div className="lc-rule"><label><input type="checkbox" checked={eligibility.require_event_checkin} onChange={e=>editEligibility('require_event_checkin',e.target.checked)}/> Require convention check-in</label><Field label="Minimum sessions attended"><input type="number" min="0" value={eligibility.minimum_sessions} onChange={e=>editEligibility('minimum_sessions',Number(e.target.value))}/></Field></div><button className="rr-btn primary" onClick={save} disabled={busy}>Save design and rules</button>
    </div><div className="lc-card lc-preview-wrap"><div className="lc-card-head"><div><b>Live certificate preview</b><small>Uses sample participant data.</small></div></div><div className="lc-certificate" style={{'--cert-primary':design.primary_color,'--cert-accent':design.accent_color}}><span>{design.title}</span><small>{design.subtitle}</small><h3>Amara Participant</h3><h2>Event certificate</h2><p>{design.body}</p><footer><b>{design.signature_name}</b><b>FESTIO-2026-PREVIEW</b></footer></div></div></div>
    <div className="lc-card lc-candidates"><div className="lc-card-head"><div><b>Eligibility and issuance</b><small>{eligible.length} attendee{eligible.length===1?' is':'s are'} ready under the current rules.</small></div><div className="lc-actions"><button onClick={()=>issue(false)} disabled={busy||!eligible.length}>Issue selected</button><button className="primary" onClick={()=>issue(true)} disabled={busy||!eligible.length}>Issue & email</button></div></div><div className="lc-table"><table><thead><tr><th></th><th>Participant</th><th>Check-in</th><th>Sessions</th><th>Certificate</th></tr></thead><tbody>{candidates.map(c=><tr key={c.guest_id}><td><input type="checkbox" disabled={!c.eligible||c.issued} checked={chosen.has(c.guest_id)} onChange={e=>setChosen(prev=>{const n=new Set(prev);e.target.checked?n.add(c.guest_id):n.delete(c.guest_id);return n})}/></td><td><strong>{c.name}</strong><small>{c.email||'No email'}</small></td><td>{c.admitted?'Confirmed':'Not recorded'}</td><td>{c.sessions_attended}</td><td><span className={`lc-status ${c.issued?'approved':c.eligible?'ready':'draft'}`}>{c.issued?'Issued':c.eligible?'Eligible':'Pending'}</span></td></tr>)}</tbody></table></div></div>
    {!!certificates.length&&<div className="lc-card"><div className="lc-card-head"><div><b>Issued credentials</b><small>Verification and downloadable PDF remain available unless revoked.</small></div></div><div className="lc-list">{certificates.map(c=><article className="lc-row" key={c.id}><div className="lc-file-icon pdf">✓</div><div className="lc-row-main"><strong>{c.guest_name}</strong><small>{c.certificate_number} · {new Date(c.issued_at).toLocaleDateString()}</small><span className={`lc-status ${c.status==='issued'?'approved':'draft'}`}>{c.status}</span></div><div className="lc-actions"><a href={c.document_url} target="_blank" rel="noreferrer">PDF</a><a href={c.verification_url} target="_blank" rel="noreferrer">Verify</a></div></article>)}</div></div>}
  </section>
}
