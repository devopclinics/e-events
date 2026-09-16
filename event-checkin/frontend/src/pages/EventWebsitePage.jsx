import { useEffect, useState } from 'react'
import { api } from '../api'
import { useCurrentEvent } from '../hooks/useCurrentEvent'

const emptySession = { title: '', time: '', venue: '', audience: '' }
const blank = { schema_version: 1, event_name: '', eyebrow: 'Welcome', headline: '', summary: '', start_date: '', end_date: '', venue: '', hero_image_url: '', logo_url: '', primary_color: '#0d5c55', accent_color: '#d88945', primary_action: { label: 'Register', url: 'https://festio.events' }, secondary_action: null, sessions: [], highlights: [], festio_live_url: '', festiome_url: '', contact_email: '' }

export default function EventWebsitePage() {
  const [eventId] = useCurrentEvent()
  const [site, setSite] = useState({ slug: '', template_family: 'community', content: blank })
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [releases, setReleases] = useState([])

  useEffect(() => {
    if (!eventId) return
    Promise.allSettled([api.website(eventId), api.listEvents()]).then(([existing, events]) => {
      if (existing.status === 'fulfilled') setSite(existing.value)
      else if (events.status === 'fulfilled') {
        const ev = events.value.find(e => e.id === eventId)
        if (ev) setSite(s => ({ ...s, slug: ev.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70), content: { ...s.content, event_name: ev.name, headline: ev.name, summary: ev.description || '', start_date: ev.event_date ? new Date(ev.event_date).toLocaleDateString() : '', end_date: ev.event_end_date ? new Date(ev.event_end_date).toLocaleDateString() : '', venue: ev.venue || '' } }))
      }
    })
    api.websiteReleases(eventId).then(setReleases).catch(() => {})
  }, [eventId])

  const content = site.content || blank
  const field = (key, label, type = 'text') => <label>{label}<input type={type} value={content[key] || ''} onChange={e => setSite(s => ({ ...s, content: { ...s.content, [key]: e.target.value } }))} /></label>
  async function save() { setBusy(true); try { const value = await api.saveWebsite(eventId, site); setSite(value); setStatus('Draft saved') } catch (e) { setStatus(e.message) } finally { setBusy(false) } }
  async function preview() { setBusy(true); try { await save(); const value = await api.previewWebsite(eventId); window.open(value.preview_url, '_blank', 'noopener'); setStatus('Preview opened') } catch (e) { setStatus(e.message) } finally { setBusy(false) } }
  async function publish() { setBusy(true); try { await save(); const value = await api.publishWebsite(eventId); setStatus(`Published version ${value.version}`); setReleases(await api.websiteReleases(eventId)) } catch (e) { setStatus(e.message) } finally { setBusy(false) } }
  if (!eventId) return <main className="web-editor"><h1>Event website</h1><p>Select an event first.</p></main>
  return <main className="web-editor">
    <header><div><span>PUBLIC EVENT WEBSITE</span><h1>Give this event its own front door.</h1><p>Build, preview and publish without changing registration, tickets, check-in, Festio Live or FestioMe.</p></div><div className="web-actions"><button onClick={save} disabled={busy}>Save draft</button><button onClick={preview} disabled={busy}>Preview</button><button className="primary" onClick={publish} disabled={busy}>Publish</button></div></header>
    {status && <div className="web-status">{status}</div>}
    <div className="web-grid"><section><h2>Identity</h2><label>Website address<div className="slug"><span>/site/</span><input value={site.slug || ''} onChange={e => setSite(s => ({ ...s, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}/></div></label><label>Template family<select value={site.template_family || 'community'} onChange={e => setSite(s => ({ ...s, template_family: e.target.value }))}><option value="community">Community — warm and welcoming</option><option value="conference">Conference — structured and editorial</option><option value="celebration">Celebration — expressive and ceremonial</option></select></label>{field('event_name','Event name')}{field('eyebrow','Short introduction')}{field('headline','Headline')}<label>Summary<textarea rows="4" value={content.summary || ''} onChange={e => setSite(s => ({ ...s, content: { ...s.content, summary: e.target.value } }))}/></label></section>
    <section><h2>Details and style</h2>{field('start_date','Start date')}{field('end_date','End date')}{field('venue','Venue')}{field('hero_image_url','Hero image URL','url')}<div className="web-colors">{field('primary_color','Primary color','color')}{field('accent_color','Accent color','color')}</div>{field('contact_email','Contact email','email')}<h2>Connected experiences</h2>{field('festio_live_url','Festio Live guest link','url')}{field('festiome_url','FestioMe guest link','url')}</section>
    <section className="wide"><div className="section-head"><div><h2>Programme</h2><p>Each event can have its own public highlights and sessions.</p></div><button onClick={() => setSite(s => ({ ...s, content: { ...s.content, sessions: [...(s.content.sessions || []), emptySession] } }))}>Add session</button></div><div className="sessions">{(content.sessions || []).map((item,i)=><article key={i}>{['title','time','venue','audience'].map(k=><label key={k}>{k}<input value={item[k] || ''} onChange={e=>setSite(s=>{const sessions=[...(s.content.sessions||[])];sessions[i]={...sessions[i],[k]:e.target.value};return {...s,content:{...s.content,sessions}}})}/></label>)}<button onClick={()=>setSite(s=>({...s,content:{...s.content,sessions:s.content.sessions.filter((_,n)=>n!==i)}}))}>Remove</button></article>)}</div></section>
    <aside><h2>Release history</h2>{releases.length ? releases.map(r=><div className="release" key={r.id}><span>Version {r.version}</span><small>{new Date(r.created_at).toLocaleString()}</small><button onClick={async()=>{await api.rollbackWebsite(eventId,r.id);setStatus(`Restored version ${r.version}`)}}>Restore</button></div>) : <p>Publish the first version to start release history.</p>}</aside></div>
    <style>{`.web-editor{max-width:1240px;margin:auto;padding:36px 24px 80px;color:#18312d}.web-editor>header{display:flex;justify-content:space-between;gap:30px;padding:35px;border-radius:24px;background:#0b5953;color:white}.web-editor header span{font-size:12px;font-weight:800;letter-spacing:.16em;color:#79e2ce}.web-editor h1{font:700 clamp(2rem,5vw,4rem)/1 Georgia;margin:.2em 0}.web-editor h2{font-size:20px;margin:0 0 18px}.web-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.web-editor button{border:1px solid #c8d6d2;background:white;padding:10px 14px;border-radius:9px;font-weight:750}.web-editor button.primary{background:#ef9a50;border-color:#ef9a50}.web-status{margin:16px 0;padding:12px 16px;background:#effaf6;border-radius:10px}.web-grid{display:grid;grid-template-columns:1fr 1fr 320px;gap:18px;margin-top:20px}.web-grid section,.web-grid aside{background:white;border:1px solid #dde7e3;border-radius:18px;padding:24px}.web-grid .wide{grid-column:1/3}.web-editor label{display:grid;gap:6px;margin:12px 0;font-size:12px;font-weight:800;text-transform:capitalize}.web-editor input,.web-editor select,.web-editor textarea{width:100%;border:1px solid #c8d6d2;border-radius:8px;padding:11px;background:#fbfdfc}.slug{display:flex;align-items:center;border:1px solid #c8d6d2;border-radius:8px;padding-left:10px}.slug input{border:0}.web-colors{display:grid;grid-template-columns:1fr 1fr;gap:10px}.section-head{display:flex;justify-content:space-between}.sessions{display:grid;gap:12px}.sessions article{display:grid;grid-template-columns:2fr 1fr 1fr 1fr auto;gap:10px;align-items:end;padding:12px;background:#f4f8f6;border-radius:12px}.release{display:grid;grid-template-columns:1fr auto;gap:5px;padding:12px 0;border-bottom:1px solid #e5ece9}.release small{grid-column:1}.release button{grid-column:2;grid-row:1/3}@media(max-width:900px){.web-grid{grid-template-columns:1fr}.web-grid .wide{grid-column:auto}.web-editor>header{display:block}.web-actions{margin-top:20px}.sessions article{grid-template-columns:1fr 1fr}}`}</style>
  </main>
}
