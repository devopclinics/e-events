import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useCurrentEvent } from '../hooks/useCurrentEvent'
import RedesignShell from './redesign/RedesignShell'
import './EventWebsitePage.css'

const icons = ['✦','▣','◉','★','♟','⚽','🎤','🎓','🤝','☾']
const emptySession = { title: '', time: '', venue: '', audience: '' }
const defaultNavigation = [
  { id: 'programme', label: 'Programme', destination_type: 'section', url: '#programme', enabled: true },
  { id: 'speakers', label: 'Speakers', destination_type: 'speakers', url: '', enabled: false },
  { id: 'venue', label: 'Venue', destination_type: 'venue', url: '', enabled: false },
  { id: 'junior', label: 'Junior Platform', destination_type: 'custom', url: '', enabled: false },
  { id: 'faqs', label: 'FAQs', destination_type: 'custom', url: '', enabled: false },
]
const blank = {
  schema_version: 1, event_name: '', eyebrow: 'Welcome', headline: '', summary: '', start_date: '', end_date: '', venue: '', venue_address: '', venue_url: '',
  hero_image_url: '', feature_image_url: '', logo_url: '', primary_color: '#0d5c55', accent_color: '#d88945',
  primary_action: { label: 'Register / RSVP →', url: '' }, secondary_action: null,
  sessions: [], stats: [{ value: '4 Days', label: 'Convention', detail: 'Multi-day programme' }, { value: '30+', label: 'Sessions', detail: 'Talks, panels and workshops' }, { value: '6', label: 'Programme Tracks', detail: 'Topics for every interest' }, { value: 'All ages', label: 'Family & Junior', detail: 'Something for all generations' }],
  tracks: [{ image_url: '', icon: '▣', title: 'Junior Platform', description: 'Learn, play, grow' }, { image_url: '', icon: '◉', title: 'Youth & Sports', description: 'Energy, skills, opportunity' }, { image_url: '', icon: '★', title: 'Gala Night', description: 'A night to celebrate' }, { image_url: '', icon: '♟', title: 'Community & Learning', description: 'Ideas, connections, impact' }],
  visible_sections: ['stats','programme','tracks','connect'], heritage_message: 'Our heritage. Our people. A brighter tomorrow.', highlights: [], festio_live_url: '', festiome_url: '', contact_email: '',
  brand_tagline: 'PEOPLE · PURPOSE · A STRONGER TOMORROW', footer_tagline: 'Same roots. Brighter tomorrows.', navigation: defaultNavigation,
}
const tabs = [['identity','Identity'],['navigation','Header & footer'],['style','Style & media'],['programme','Programme'],['connections','Connections'],['history','History']]

function mergeNavigation(items, sources) {
  return (items?.length ? items : defaultNavigation).map(item => {
    const url = sources[item.destination_type]
    return url !== undefined ? { ...item, url, enabled: item.enabled && Boolean(url) } : item
  })
}

function WebsitePreview({ site, device }) {
  const c = site.content || blank
  const links = (c.navigation || []).filter(item => item.enabled && item.url)
  const visible = new Set(c.visible_sections || [])
  return <div className={`ews-preview-card ${device === 'mobile' ? 'is-mobile' : ''}`} style={{'--site-primary':c.primary_color,'--site-accent':c.accent_color}}>
    <nav><div className="ews-preview-brand">{c.logo_url ? <img src={c.logo_url} alt=""/> : <><span>✤</span><div><strong>{c.event_name || 'Your event'}</strong><small>{c.brand_tagline}</small></div></>}</div><div className="ews-preview-links">{links.map(x=><a key={x.id} href={x.url} onClick={e=>e.preventDefault()}>{x.label}</a>)}</div>{c.primary_action?.url && <a className="ews-preview-cta" href={c.primary_action.url} onClick={e=>e.preventDefault()}>{c.primary_action.label}</a>}</nav>
    <header className="ews-preview-hero"><div><span className="ews-preview-eyebrow">{c.eyebrow}</span><h1>{c.headline || c.event_name || 'Your event website'}</h1><p>{c.summary || 'Add a short description that helps guests understand the event.'}</p><div className="ews-preview-meta"><b>{c.start_date}{c.end_date ? ` – ${c.end_date}` : ''}</b>{c.venue && <b>● {c.venue}</b>}</div><div className="ews-preview-actions">{c.primary_action?.url && <button>{c.primary_action.label}</button>}{c.secondary_action?.url && <button className="outline">{c.secondary_action.label}</button>}</div></div><div className="ews-preview-art">{c.feature_image_url ? <img src={c.feature_image_url} alt=""/> : <span>Add a feature image</span>}<em>{c.heritage_message}</em></div></header>
    {visible.has('stats') && <section className="ews-preview-stats">{(c.stats||[]).slice(0,4).map((x,i)=><div key={i}><strong>{x.value}</strong><span><b>{x.label}</b><small>{x.detail}</small></span></div>)}</section>}
    <div className="ews-preview-lower" id="programme">{visible.has('programme') && <section><h2>Programme preview</h2><p>A glimpse of what is coming up.</p><div className="ews-preview-sessions">{(c.sessions||[]).slice(0,3).map((x,i)=><article key={i}><small>{x.time}</small><b>{x.title || 'Session title'}</b><span>{x.audience}</span></article>)}</div></section>}{visible.has('tracks') && <section><h2>Built around every guest</h2><p>Dedicated experiences for all ages and interests.</p><div className="ews-preview-tracks">{(c.tracks||[]).slice(0,4).map((x,i)=><article key={i}>{x.image_url?<img src={x.image_url} alt=""/>:<i>{x.icon}</i>}<span><b>{x.title}</b><small>{x.description}</small></span></article>)}</div></section>}</div>
    {visible.has('connect') && (c.festio_live_url || c.festiome_url) && <section className="ews-preview-connect"><div><h2>Stay engaged, wherever you are</h2><p>Be part of the conversation throughout the event.</p></div>{c.festio_live_url&&<button>Join Festio Live ›</button>}{c.festiome_url&&<button>Open FestioMe ›</button>}<em>{c.footer_tagline}</em></section>}
    <footer><div className="ews-preview-brand"><strong>{c.event_name}</strong></div><div>{links.map(x=><a key={x.id} href={x.url} onClick={e=>e.preventDefault()}>{x.label}</a>)}</div></footer>
  </div>
}

export default function EventWebsitePage() {
  const [eventId] = useCurrentEvent()
  const [site, setSite] = useState({ slug: '', template_family: 'community', content: blank })
  const [activeTab, setActiveTab] = useState('identity')
  const [device, setDevice] = useState('desktop')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [releases, setReleases] = useState([])
  const [sources, setSources] = useState({ section:'#programme', speakers:'', venue:'', contact:'' })

  useEffect(() => {
    if (!eventId) return
    let cancelled = false
    ;(async () => {
      const [existing, events] = await Promise.allSettled([api.website(eventId), api.listEvents()])
      const ev = events.status === 'fulfilled' ? events.value.find(e => e.id === eventId) : null
      let liveUrl = existing.status === 'fulfilled' ? existing.value.content?.festio_live_url || '' : ''
      if (ev?.engagement_enabled) {
        try { liveUrl = (await api.livePublicJoinInfo(eventId)).url } catch { /* keep the saved destination */ }
      }
      if (cancelled) return
      const venue = ev?.venue_name || '', venueAddress = ev?.venue_address || ''
      const venueUrl = venueAddress || venue ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venueAddress || venue)}` : ''
      const speakerUrl = ev?.speaker_enabled && ev?.speaker_token ? `${window.location.origin}/speakers/${ev.speaker_token}` : ''
      const rsvpUrl = ev?.rsvp_enabled && ev?.rsvp_token ? `${window.location.origin}/rsvp/${ev.rsvp_token}` : ''
      const auto = { section:'#programme', speakers:speakerUrl, venue:venueUrl, contact:'' }
      const eventFields = ev ? { event_name:ev.name, start_date:ev.event_date?new Date(ev.event_date).toLocaleDateString():'', end_date:ev.event_end_date?new Date(ev.event_end_date).toLocaleDateString():'', venue, venue_address:venueAddress, venue_url:venueUrl, festio_live_url:liveUrl, festiome_url:ev.festiome_open_url||'' } : {}
      const base = existing.status === 'fulfilled' ? existing.value : { slug:ev?.name?.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,70)||'', template_family:'community', content:{...blank,headline:ev?.name||'',summary:ev?.description||''} }
      const contact = base.content?.contact_email || ''
      const resolved = {...auto,contact:contact?`mailto:${contact}`:''}
      setSources(resolved)
      setSite({...base,content:{...blank,...base.content,...eventFields,primary_action:base.content?.primary_action?.url?base.content.primary_action:{label:'Register / RSVP →',url:rsvpUrl},navigation:mergeNavigation(base.content?.navigation,resolved)}})
    })()
    api.websiteReleases(eventId).then(value=>{ if (!cancelled) setReleases(value) }).catch(()=>{})
    return () => { cancelled = true }
  }, [eventId])

  const content = site.content || blank
  const updateContent = patch => setSite(s=>({...s,content:{...s.content,...patch}}))
  const field = (key,label,type='text',readOnly=false) => <label>{label}<input type={type} value={content[key]||''} readOnly={readOnly} onChange={e=>updateContent({[key]:e.target.value})}/></label>
  const actionField = (key,label) => { const value=content[key]||{label:'',url:''}; return <div className="ews-action-editor"><h3>{label}</h3><label>Button label<input value={value.label||''} onChange={e=>updateContent({[key]:{...value,label:e.target.value}})}/></label><label>Destination<input type="url" value={value.url||''} onChange={e=>updateContent({[key]:{...value,url:e.target.value}})}/></label></div> }
  async function uploadImage(key,file,trackIndex=null){if(!file)return;setBusy(true);try{if(!site.slug)throw new Error('Save the website address before uploading images.');await save();const result=await api.uploadWebsiteAsset(eventId,file);if(trackIndex===null)updateContent({[key]:result.url});else setSite(s=>{const tracks=[...(s.content.tracks||[])];tracks[trackIndex]={...tracks[trackIndex],image_url:result.url};return{...s,content:{...s.content,tracks}}});setStatus(`Image uploaded (${result.width} × ${result.height}). Save the draft to keep it.`)}catch(e){setStatus(e.message)}finally{setBusy(false)}}
  const imageControl=(key,label)=><label className="ews-image-control">{label}<div>{content[key]?<img src={content[key]} alt=""/>:<span>No image selected</span>}</div><input type="url" value={content[key]||''} placeholder="Paste image URL" onChange={e=>updateContent({[key]:e.target.value})}/><input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>uploadImage(key,e.target.files?.[0])}/><small>JPG, PNG or WebP · maximum 5 MB</small></label>
  const automaticUrl = type => type === 'contact' ? (content.contact_email ? `mailto:${content.contact_email}` : '') : sources[type]
  const navUrl = item => automaticUrl(item.destination_type) !== undefined ? automaticUrl(item.destination_type) : item.url
  function updateNav(index,patch){const navigation=[...(content.navigation||[])];let item={...navigation[index],...patch};if(patch.destination_type){const url=automaticUrl(patch.destination_type);item.url=url!==undefined?url:'';item.enabled=Boolean(item.url)}navigation[index]=item;updateContent({navigation})}
  function moveNav(index,delta){const navigation=[...(content.navigation||[])],next=index+delta;if(next<0||next>=navigation.length)return;[navigation[index],navigation[next]]=[navigation[next],navigation[index]];updateContent({navigation})}
  async function save(){setBusy(true);try{const payload={...site,content:{...content,navigation:(content.navigation||[]).map(item=>({...item,url:navUrl(item),enabled:item.enabled&&Boolean(navUrl(item))}))}};const value=await api.saveWebsite(eventId,payload);setSite(value);setStatus('Draft saved');return value}catch(e){setStatus(e.message);throw e}finally{setBusy(false)}}
  async function preview(){try{await save();const value=await api.previewWebsite(eventId);window.open(value.preview_url,'_blank','noopener');setStatus('Preview opened')}catch{}}
  async function publish(){try{await save();const value=await api.publishWebsite(eventId);setStatus(`Published version ${value.version}`);setReleases(await api.websiteReleases(eventId))}catch{}}
  async function unpublish(){if(!window.confirm('Take the website offline? Visitors will see a not-found page until you publish again.'))return;setBusy(true);try{const value=await api.unpublishWebsite(eventId);setSite(value);setStatus('Website unpublished')}catch(e){setStatus(e.message)}finally{setBusy(false)}}

  const tabContent = useMemo(()=>({
    identity:<><h2>Event identity</h2><p className="ews-help">Core event facts remain synchronized with Event Setup.</p><label>Website address<div className="ews-slug"><span>/site/</span><input value={site.slug||''} onChange={e=>setSite(s=>({...s,slug:e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,'')}))}/></div></label><label>Template family<select value={site.template_family||'community'} onChange={e=>setSite(s=>({...s,template_family:e.target.value}))}><option value="community">Community — warm and welcoming</option><option value="conference">Conference — structured and editorial</option><option value="celebration">Celebration — expressive and ceremonial</option></select></label><div className="ews-source"><span>Synced from Event Details</span><a href="/admin-redesign">Edit source</a><b>{content.event_name||'Not set'}</b><small>{content.start_date||'Date not set'} · {content.venue||'Venue not set'}</small></div>{field('eyebrow','Short introduction')}{field('headline','Website headline')}<label>Summary<textarea rows="5" value={content.summary||''} onChange={e=>updateContent({summary:e.target.value})}/></label></>,
    navigation:<><div className="ews-section-head"><div><h2>Header and footer navigation</h2><p className="ews-help">Automatic destinations use existing event data. Incomplete destinations stay hidden.</p></div><button onClick={()=>updateContent({navigation:[...(content.navigation||[]),{id:`custom-${Date.now()}`,label:'New tab',destination_type:'custom',url:'',enabled:false}]})}>+ Add tab</button></div>{field('brand_tagline','Brand tagline')}{(content.navigation||[]).map((item,i)=>{const auto=sources[item.destination_type]!==undefined,ready=Boolean(navUrl(item));return <article className="ews-nav-item" key={item.id}><div className="ews-nav-head"><strong>{item.label||'New tab'}</strong><span className={auto?'auto':'custom'}>{auto?'Auto':'Custom'}</span><button disabled={!i} onClick={()=>moveNav(i,-1)}>↑</button><button disabled={i===(content.navigation||[]).length-1} onClick={()=>moveNav(i,1)}>↓</button></div><div className="ews-nav-grid"><input aria-label="Tab label" value={item.label} onChange={e=>updateNav(i,{label:e.target.value})}/><select aria-label="Destination type" value={item.destination_type} onChange={e=>updateNav(i,{destination_type:e.target.value})}><option value="section">Page section</option><option value="speakers">Speakers add-on</option><option value="venue">Venue map</option><option value="contact">Contact email</option><option value="custom">Custom URL</option></select></div><input aria-label="Destination" value={navUrl(item)} readOnly={auto} placeholder="https://… or #section" onChange={e=>updateNav(i,{url:e.target.value})}/><div className="ews-nav-foot"><label><input type="checkbox" checked={item.enabled&&ready} disabled={!ready} onChange={e=>updateNav(i,{enabled:e.target.checked})}/> Show in navigation</label><span className={ready?'ready':''}>{ready?'Ready':'Destination required'}</span><button onClick={()=>updateContent({navigation:content.navigation.filter((_,n)=>n!==i)})}>Remove</button></div></article>})}{field('footer_tagline','Footer tagline')}</>,
    style:<><h2>Style and media</h2>{imageControl('logo_url','Event logo')}{imageControl('feature_image_url','Hero / feature image')}<div className="ews-colors">{field('primary_color','Primary color','color')}{field('accent_color','Accent color','color')}</div>{field('heritage_message','Heritage message')}<h2>Page sections</h2><div className="ews-toggles">{[['stats','At a glance'],['programme','Programme'],['tracks','Audience tracks'],['connect','Festio connections']].map(([key,label])=><label key={key}><input type="checkbox" checked={(content.visible_sections||[]).includes(key)} onChange={e=>updateContent({visible_sections:e.target.checked?[...(content.visible_sections||[]),key]:(content.visible_sections||[]).filter(x=>x!==key)})}/>{label}</label>)}</div><div className="ews-section-head"><h2>Audience tracks</h2><button onClick={()=>updateContent({tracks:[...(content.tracks||[]),{image_url:'',icon:'✦',title:'',description:''}]})}>+ Add track</button></div>{(content.tracks||[]).map((item,i)=><article className="ews-track" key={i}><div>{item.image_url?<img src={item.image_url} alt=""/>:<i>{item.icon}</i>}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>uploadImage('tracks',e.target.files?.[0],i)}/></div><select value={item.icon||'✦'} disabled={!!item.image_url} onChange={e=>{const tracks=[...content.tracks];tracks[i]={...tracks[i],icon:e.target.value};updateContent({tracks})}}>{icons.map(x=><option key={x}>{x}</option>)}</select><input placeholder="Track title" value={item.title} onChange={e=>{const tracks=[...content.tracks];tracks[i]={...tracks[i],title:e.target.value};updateContent({tracks})}}/><input placeholder="Description" value={item.description} onChange={e=>{const tracks=[...content.tracks];tracks[i]={...tracks[i],description:e.target.value};updateContent({tracks})}}/><button onClick={()=>updateContent({tracks:content.tracks.filter((_,n)=>n!==i)})}>Remove</button></article>)}</>,
    programme:<><div className="ews-section-head"><div><h2>Programme</h2><p className="ews-help">Publish a concise preview of sessions running across the event.</p></div><button onClick={()=>updateContent({sessions:[...(content.sessions||[]),emptySession]})}>+ Add session</button></div>{(content.sessions||[]).map((item,i)=><article className="ews-session" key={i}>{['title','time','venue','audience'].map(k=><label key={k}>{k}<input value={item[k]||''} onChange={e=>{const sessions=[...content.sessions];sessions[i]={...sessions[i],[k]:e.target.value};updateContent({sessions})}}/></label>)}<button onClick={()=>updateContent({sessions:content.sessions.filter((_,n)=>n!==i)})}>Remove</button></article>)}<div className="ews-section-head"><h2>At-a-glance cards</h2><button onClick={()=>updateContent({stats:[...(content.stats||[]),{value:'',label:'',detail:''}]})}>+ Add card</button></div>{(content.stats||[]).map((item,i)=><article className="ews-stat" key={i}>{['value','label','detail'].map(k=><input key={k} placeholder={k} value={item[k]||''} onChange={e=>{const stats=[...content.stats];stats[i]={...stats[i],[k]:e.target.value};updateContent({stats})}}/>)}<button onClick={()=>updateContent({stats:content.stats.filter((_,n)=>n!==i)})}>Remove</button></article>)}</>,
    connections:<><h2>Connected guest experiences</h2><p className="ews-help">These destinations come from the event’s existing Festio services.</p><div className="ews-connection"><b>RSVP</b><span>{content.primary_action?.url?'Connected':'Not configured'}</span><small>{content.primary_action?.url||'Enable open RSVP in Event Setup.'}</small></div><div className="ews-connection"><b>Festio Live</b><span>{content.festio_live_url?'Connected':'Unavailable'}</span><small>{content.festio_live_url||'Enable Festio Live for this event.'}</small></div><div className="ews-connection"><b>FestioMe</b><span>{content.festiome_url?'Connected':'Unavailable'}</span><small>{content.festiome_url||'Sync this event with FestioMe first.'}</small></div>{actionField('primary_action','Primary action')}{actionField('secondary_action','Secondary action (optional)')}{field('contact_email','Contact email','email')}</>,
    history:<><h2>Release history</h2>{releases.length?releases.map(r=><div className="ews-release" key={r.id}><div><b>Version {r.version}</b><small>{new Date(r.created_at).toLocaleString()}</small></div><button onClick={async()=>{await api.rollbackWebsite(eventId,r.id);setStatus(`Restored version ${r.version}`)}}>Restore</button></div>):<p className="ews-help">Publish the first version to start release history.</p>}</>,
  }),[activeTab,content,releases,site.slug,site.template_family,sources])

  if(!eventId)return <RedesignShell topActive="design" eventScoped><main className="ews-empty"><h1>Event website</h1><p>Select an event first.</p></main></RedesignShell>
  return <RedesignShell topActive="design" eventScoped><main className="ews-studio"><header><div className="ews-breadcrumb">Design Studio <span>›</span> <b>Event website</b> <em>{site.published_release_id?'Published':'Draft'}</em></div><div className="ews-actions"><button onClick={save} disabled={busy}>Save draft</button><button onClick={preview} disabled={busy}>Preview</button>{site.published_release_id&&<button onClick={unpublish} disabled={busy}>Unpublish</button>}<button className="primary" onClick={publish} disabled={busy}>Publish</button></div></header>{status&&<div className="ews-status">{status}</div>}<nav className="ews-tabs">{tabs.map(([id,label])=><button className={activeTab===id?'active':''} key={id} onClick={()=>setActiveTab(id)}>{label}</button>)}</nav><div className="ews-workspace"><section className="ews-editor-panel">{tabContent[activeTab]}</section><section className="ews-preview-panel"><div className="ews-preview-toolbar"><b>Live preview</b><div><button className={device==='desktop'?'active':''} onClick={()=>setDevice('desktop')}>Desktop</button><button className={device==='mobile'?'active':''} onClick={()=>setDevice('mobile')}>Mobile</button></div></div><div className="ews-preview-scroll"><WebsitePreview site={site} device={device}/></div></section></div></main></RedesignShell>
}
