import SupportChannelIcon from './SupportChannelIcon'
import WebsiteSupportChat from './WebsiteSupportChat'
import './WhatsAppContact.css'
export default function SupportChatPage(){
 const raw=new URLSearchParams(location.search).get('site')||'',slug=/^[a-zA-Z0-9_-]{1,100}$/.test(raw)?raw:''
 return <main className="fwc-root fwc-embedded"><header><span>FESTIO SUPPORT</span><h1>How can we help?</h1><p>Public event information. Private help from our team.</p></header><div className="fwc-content"><WebsiteSupportChat key={slug} page={slug?'event':'general'} siteSlug={slug}/><a className="fwc-channel-choice fwc-whatsapp-choice" aria-label="Continue in WhatsApp" href="https://wa.me/15553888825?text=Hi%20Festio" target="_blank" rel="noopener noreferrer"><span className="fwc-choice-symbol"><SupportChannelIcon channel="whatsapp"/></span><span className="fwc-choice-copy"><strong>Chat on WhatsApp</strong><small>Opens WhatsApp on your device</small></span><span className="fwc-choice-arrow" aria-hidden="true">↗</span></a></div></main>
}
