import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import { useCurrentEvent } from '../hooks/useCurrentEvent'
import JuniorsThemeSwitch from './JuniorsThemeSwitch'
import { Icon } from '../pages/redesign/RedesignShell'

export default function JuniorsAppShell({children}) {
  const [eventId]=useCurrentEvent(),{user,logout}=useAuth(),navigate=useNavigate()
  const [online,setOnline]=useState(navigator.onLine)
  const [events,setEvents]=useState([]),[error,setError]=useState(''),[help,setHelp]=useState(false)
  const [prompt,setPrompt]=useState(window.__festioInstallPrompt||null)
  const [installed,setInstalled]=useState(window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true)
  useEffect(()=>{let alive=true;api.listEvents().then(rows=>{if(alive)setEvents(rows.filter(e=>e.junior_program_enabled))}).catch(()=>{if(alive)setError('Unable to load events. Reconnect and refresh.')});return()=>{alive=false}},[])
  useEffect(()=>{
    const connection=()=>setOnline(navigator.onLine);window.addEventListener('online',connection);window.addEventListener('offline',connection)
    const oldTitle=document.title;document.title='Festio Juniors'
    const manifest=document.querySelector('link[rel=manifest]');if(manifest&&!manifest.href.endsWith('/juniors/manifest.webmanifest')){manifest.href='/juniors/manifest.webmanifest';window.__festioInstallPrompt=null;setPrompt(null)}
    if('serviceWorker' in navigator&&window.isSecureContext)navigator.serviceWorker.register('/juniors/sw.js',{scope:'/juniors/'}).catch(()=>setError('Installation is unavailable in this browser. You can continue using the web app.'))
    const ready=e=>{e.preventDefault();setPrompt(e)},done=()=>{setInstalled(true);setPrompt(null);window.__festioInstallPrompt=null}
    window.addEventListener('beforeinstallprompt',ready);window.addEventListener('appinstalled',done)
    return()=>{window.removeEventListener('online',connection);window.removeEventListener('offline',connection);document.title=oldTitle;window.removeEventListener('beforeinstallprompt',ready);window.removeEventListener('appinstalled',done)}
  },[])
  async function install(){if(!prompt){setHelp(v=>!v);return}try{await prompt.prompt();await prompt.userChoice;setPrompt(null);window.__festioInstallPrompt=null}catch{setHelp(true)}}
  return <div className="admin-redesign rr juniors-app"><header className="juniors-app-bar"><a href="/juniors/" className="juniors-app-brand"><Icon name="shield" size={27}/><span>Festio <strong>Juniors</strong><small>Every child. Every handoff.</small></span></a><label>Event<select aria-label="Choose event" value={eventId||''} onChange={e=>navigate('/juniors/?event='+encodeURIComponent(e.target.value))}><option value="" disabled>Choose an event</option>{events.map(e=><option value={e.id} key={e.id}>{e.is_test?'Practice · ':''}{e.name}</option>)}</select></label><div className="juniors-app-tools"><JuniorsThemeSwitch/>{!installed&&<button onClick={install}><Icon name="download" size={16}/>Install app</button>}<span>{user?.name}</span><details className="juniors-account-menu"><summary>Account & app</summary><div><strong>{user?.name}</strong>{!installed&&<button onClick={install}>Install app</button>}<button onClick={logout}>Sign out</button></div></details></div></header>{help&&<section className="juniors-install-help" role="status"><strong>Install Festio Juniors</strong><p>iPhone / iPad: open in Safari, tap Share → Add to Home Screen. Android: open the browser menu → Install app or Add to Home Screen. Computer: use Chrome or Edge’s install icon, or Safari’s Add to Dock.</p><p>Installation depends on your browser. You can always use this link in a browser. An internet connection is needed to view current records and record handoffs.</p></section>}{!online&&<p role="alert" className="juniors-install-help">Connection lost. Reconnect before recording a handoff. Changes are not queued offline.</p>}{error&&<p role="alert" className="juniors-install-help">{error}</p>}<div className="rr-main">{children}</div><footer className="juniors-app-footer"><a href="/junior-platform">Open full Festio workspace</a><span>Staff access only · Online records</span></footer></div>
}
