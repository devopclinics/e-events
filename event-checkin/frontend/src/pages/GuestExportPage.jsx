import {useState} from 'react'
import RedesignShell from './redesign/RedesignShell'
import {useCurrentEvent} from '../hooks/useCurrentEvent'
import {api} from '../api'
export default function GuestExportPage(){
 const [eventId]=useCurrentEvent(),[format,setFormat]=useState('xlsx'),[busy,setBusy]=useState(false),[notice,setNotice]=useState('')
 async function download(){setBusy(true);setNotice('');try{await api.downloadGuestList(eventId,format,'guests');setNotice('Your guest-list download is ready.')}catch(e){setNotice(e.message||'Export failed.')}finally{setBusy(false)}}
 return <RedesignShell topActive="setup" withEventSidebar eventActive="export"><section className="rr-panel" style={{padding:32,maxWidth:700}}><h1>Export guest data</h1><p>Download the guest list for the selected event. Export access does not permit editing guests or sending messages.</p><p>Guest data is private. Store and share the download only for authorized event work.</p><label>File format <select className="rr-select" value={format} onChange={e=>setFormat(e.target.value)}><option value="xlsx">Excel workbook</option><option value="csv">CSV spreadsheet</option></select></label><p><button className="rr-btn primary" disabled={busy||!eventId} onClick={download}>{busy?'Preparing download…':'Download guest list'}</button></p>{notice&&<p role="status">{notice}</p>}</section></RedesignShell>
}
