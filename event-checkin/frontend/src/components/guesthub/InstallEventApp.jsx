import { useEffect, useState } from 'react';
function stored(key) { try { return localStorage.getItem(key); } catch { return null; } }
export default function InstallEventApp() {
  const [prompt,setPrompt]=useState(window.__festioInstallPrompt || null);
  const [dismissed,setDismissed]=useState(!!stored('festio:app-install-dismissed'));
  const [installed,setInstalled]=useState(window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true);
  const [help,setHelp]=useState(false),[error,setError]=useState('');
  const ios=/iPad|iPhone|iPod/.test(navigator.userAgent) || navigator.platform==='MacIntel' && navigator.maxTouchPoints>1;
  useEffect(()=>{
    const ready=e=>{e.preventDefault();setPrompt(e)};
    const complete=()=>{setInstalled(true);setPrompt(null);window.__festioInstallPrompt=null};
    window.addEventListener('beforeinstallprompt',ready);window.addEventListener('appinstalled',complete);
    const media=window.matchMedia('(display-mode: standalone)');const change=e=>setInstalled(e.matches);media.addEventListener('change',change);
    return()=>{window.removeEventListener('beforeinstallprompt',ready);window.removeEventListener('appinstalled',complete);media.removeEventListener('change',change)};
  },[]);
  function dismiss(){setDismissed(true);try{localStorage.setItem('festio:app-install-dismissed','1')}catch{}}
  async function install(){setError('');if(!prompt){setHelp(true);return}try{await prompt.prompt();await prompt.userChoice;setPrompt(null);window.__festioInstallPrompt=null;dismiss()}catch{setError('Use your browser menu to add Festio to your Home Screen.');setPrompt(null)}}
  if(installed)return null;
  if(dismissed)return <button className="text-button" onClick={()=>{setDismissed(false);setHelp(true)}}>Add Festio to Home Screen</button>;
  return <aside className="card form-install" aria-label="Install event app"><h3>Keep your event in your pocket</h3><p>Quick access to your pass, programme, forms and updates.</p><div className="form-buttons"><button className="primary" onClick={install}>{prompt?'Install Festio':'Add to Home Screen'}</button><button className="secondary" onClick={dismiss}>Not now</button></div>{help&&<p>{ios?'In Safari, tap Share, then Add to Home Screen, and confirm Add.':'Open your browser menu and choose Install app or Add to Home Screen if available. You can also keep using Festio in your browser.'}</p>}{error&&<p role="alert">{error}</p>}</aside>;
}
