export default function SupportChannelIcon({channel='web'}) {
 return <svg className="fwc-channel-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{channel==='whatsapp'?<><path d="M20.5 11.5a8.5 8.5 0 0 1-12.8 7.3L3 20l1.2-4.7A8.5 8.5 0 1 1 20.5 11.5Z"/><path d="M8 7.5c.2 4 2.5 6.4 6.7 7.5l1.3-2-2.6-1.2-1 1c-1.5-.6-2.4-1.5-3-3l.9-1L9 7.5Z"/></>:<><path d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-6 4V6a2 2 0 0 1 2-2Z"/><path d="M7 9h10M7 13h6"/></>}</svg>
}
