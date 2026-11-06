import {useEffect,useState} from 'react'
import {api} from '../api'
export default function SupportStaffAccess({onClose}) {
 const [query,setQuery]=useState(''),[items,setItems]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 async function load(q=''){try{const r=await api.supportStaffAccess(q);setItems(r.items);setError('')}catch(e){setError(e.message)}}
 useEffect(()=>{load()},[])
 async function toggle(item){setBusy(true);try{await api.setSupportStaffAccess(item.id,!item.enabled);await load(query)}catch(e){setError(e.message)}finally{setBusy(false)}}
 return <section className="mwa-staff-access" role="dialog" aria-label="Festio support staff access"><header><h3>Support staff access</h3><button onClick={onClose}>Close</button></header><p>Only Festio management can grant this access. Agents can read and reply to all support conversations. This does not grant event administration, guest exports, automation settings or platform access.</p><form onSubmit={e=>{e.preventDefault();load(query)}}><label>Find an existing staff account by email<input value={query} onChange={e=>setQuery(e.target.value)} type="search"/></label><button>Search</button></form>{error&&<p role="alert">{error}</p>}{items.map(item=><article key={item.id}><div><strong>{item.name}</strong><p>{item.email}</p></div><button disabled={busy} onClick={()=>toggle(item)}>{item.enabled?'Revoke support access':'Grant support access'}</button></article>)}{!items.length&&<p>No support agents listed. Search for an existing account to grant access.</p>}</section>
}
