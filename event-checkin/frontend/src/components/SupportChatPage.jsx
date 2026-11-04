import WebsiteSupportChat from './WebsiteSupportChat'
import './WhatsAppContact.css'
export default function SupportChatPage(){
 const raw=new URLSearchParams(location.search).get('site')||'',slug=/^[a-zA-Z0-9_-]{1,100}$/.test(raw)?raw:''
 return <main className="fwc-root fwc-embedded"><header><span>FESTIO SUPPORT</span><h1>How can we help?</h1><p>Public event information. Private help from our team.</p></header><div className="fwc-content"><WebsiteSupportChat key={slug} page={slug?'event':'general'} siteSlug={slug}/><a className="fwc-continue" href="https://wa.me/15553888825?text=Hi%20Festio" target="_blank" rel="noopener noreferrer">Continue in WhatsApp ↗</a></div></main>
}
