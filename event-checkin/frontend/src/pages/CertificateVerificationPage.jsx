import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import './CertificateVerificationPage.css'

export default function CertificateVerificationPage() {
  const { token } = useParams(), [record,setRecord]=useState(null), [error,setError]=useState('')
  useEffect(()=>{ fetch(`/api/certificates/${encodeURIComponent(token)}`).then(async r=>{if(!r.ok)throw new Error((await r.json().catch(()=>({}))).detail||'Certificate not found');return r.json()}).then(setRecord).catch(e=>setError(e.message)) },[token])
  if(error) return <main className="cv-page"><section className="cv-error"><b>Certificate unavailable</b><p>{error}</p></section></main>
  if(!record) return <main className="cv-page"><p>Verifying certificate…</p></main>
  const snap=record.snapshot||{}, design=snap.design||{}
  return <main className="cv-page" style={{'--cv-primary':design.primary_color||'#075845','--cv-accent':design.accent_color||'#dba92e'}}>
    <header><a href="/">Festio</a><span className={record.valid?'valid':'revoked'}>{record.valid?'✓ Verified credential':'Credential revoked'}</span></header>
    <section className="cv-sheet"><span className="cv-kicker">{design.title||'Certificate of Participation'}</span><p>{design.subtitle||'This certificate is proudly presented to'}</p><h1>{snap.participant_name}</h1><h2>{snap.event_name}</h2><p>{design.body||'For successful participation in this event'}</p><div className="cv-meta"><span><b>{snap.sessions_attended||0}</b> sessions recorded</span><span><b>{new Date(record.issued_at).toLocaleDateString()}</b> issued</span></div><footer><span>{design.signature_name||'Event Organizer'}<small>Authorized signature</small></span><span>{record.certificate_number}<small>Certificate number</small></span></footer></section>
    <div className="cv-actions"><a href={record.document_url} target="_blank" rel="noreferrer">Download PDF</a><button onClick={()=>window.print()}>Print certificate</button></div>
    <p className="cv-foot">This credential was issued and verified by Festio.</p>
  </main>
}
