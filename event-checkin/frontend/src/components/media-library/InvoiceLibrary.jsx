import {useEffect,useRef,useState} from 'react'
import {Link} from 'react-router-dom'
import {api} from '../../api'
import OrganizationInvoiceEditor from './OrganizationInvoiceEditor'
import './MediaLibrary.css'
import './InvoiceLibrary.css'

export default function InvoiceLibrary({embedded=false}){
 const [orgs,setOrgs]=useState(null),[orgId,setOrgId]=useState(''),[rows,setRows]=useState(null),[query,setQuery]=useState(()=>embedded?'':new URLSearchParams(location.search).get('invoice')||'')
 const [error,setError]=useState(''),[busy,setBusy]=useState(''),[status,setStatus]=useState(''),[editor,setEditor]=useState(null)
 const currentOrg=useRef(orgId);currentOrg.current=orgId
 const org=orgs?.find(o=>o.id===orgId)
 useEffect(()=>{let active=true;api.invoiceOrganizations().then(data=>{if(!active)return;setOrgs(data.organizations);const remembered=new URLSearchParams(location.search).get('org')||localStorage.getItem('festio.invoiceOrgId');setOrgId(data.organizations.some(o=>o.id===remembered)?remembered:data.default_org_id||'')}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[])
 async function load(){if(!orgId)return;const selected=orgId;setError('');try{const data=await api.listOrgInvoices(selected);if(currentOrg.current===selected)setRows(data)}catch(e){if(currentOrg.current===selected)setError(e.message)}}
 useEffect(()=>{setRows(null);setStatus('');load();const refresh=()=>{if(!document.hidden)load()};window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);return()=>{window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh)}},[orgId])
 function choose(id){setRows(null);setOrgId(id);setQuery('');localStorage.setItem('festio.invoiceOrgId',id)}
 async function open(row){setBusy(row.id);try{setEditor({invoice:await api.getOrgInvoice(orgId,row.id)})}catch(e){setError(e.message)}finally{setBusy('')}}
 async function download(row){setBusy(row.id);setError('');try{const latest=await api.getOrgInvoice(orgId,row.id);const blob=await api.downloadOrgInvoice(orgId,row.id);const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=latest.filename||latest.reference+'.pdf';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);setStatus(latest.reference+': PDF downloaded.');load()}catch(e){setError(e.message)}finally{setBusy('')}}
 async function remove(row){if(!window.confirm('Delete draft '+row.reference+'?'))return;setBusy(row.id);try{await api.deleteOrgInvoice(orgId,row.id,row.version);load()}catch(e){setError(e.message)}finally{setBusy('')}}
 const filtered=(rows||[]).filter(r=>`${r.payload.client} ${r.payload.title} ${r.payload.guests||''} ${r.reference} ${r.status}`.toLowerCase().includes(query.toLowerCase()))
 const date=v=>v?new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeZone:'UTC'}).format(new Date(v.slice(0,10)+'T12:00:00Z')):'Tentative — to be confirmed'
 return <section className="invoice-library" aria-label="Invoice library">
  <div className="invoice-library-head"><div><p className="ml-eyebrow">ORGANIZATION / CLIENT INVOICES</p><h2>Invoices</h2><p>Create, issue and download invoices for your organization.</p></div><div className="org-invoice-actions">{org&&<><button className="ml-button primary" onClick={()=>{setQuery('');setEditor({invoice:null})}}>Create invoice</button><button className="ml-button" onClick={load}>Refresh invoices</button></>}<Link className="ml-button" to={embedded?'/invoices'+(orgId?'?org='+encodeURIComponent(orgId):''):'/billing-redesign?tab=org'}>{embedded?'Open invoice workspace ↗':'Org Settings'}</Link></div></div>
  {orgs&&orgs.length>0&&<label className="org-invoice-org">Organization<select aria-label="Invoice organization" value={orgId} onChange={e=>choose(e.target.value)}>{orgs.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>}
  {!orgs&&!error&&<p role="status">Loading organization access…</p>}{orgs?.length===0&&<p>Organization owners and admins can create and manage invoices. You do not currently have access to an invoice workspace.</p>}
  {org&&<label className="ml-search"><span className="sr-only">Search invoices</span><input type="search" placeholder="Search client, invoice reference or event…" value={query} onChange={e=>setQuery(e.target.value)}/></label>}
  {status&&<p role="status" className="ml-notice">{status}</p>}{error&&<p role="alert" className="ml-notice">{error} {org&&<button className="ml-button" onClick={load}>Retry</button>}</p>}
  {org&&!rows&&!error&&<p role="status">Loading invoices…</p>}{rows&&filtered.length===0&&<p>{query?'No invoices match your search.':'No invoices yet. Create your first invoice for '+org?.name+'.'}</p>}
  <div className="invoice-library-grid">{filtered.map(row=><article className="invoice-library-card" key={row.id}>
   <div className="invoice-library-card-top"><span className="ml-eyebrow">{row.payload.client||'Client to be added'}</span><span className="invoice-library-status">{row.status.charAt(0).toUpperCase()+row.status.slice(1)}</span></div><h3>{row.payload.title||'Untitled invoice'}</h3><p className="invoice-library-reference">{row.reference}</p><p>{org?.name}{row.payload.guests?' · '+row.payload.guests+' guests':''}</p>
   <dl>{row.payload.date&&<div><dt>Event date</dt><dd>{date(row.payload.date)}</dd></div>}<div><dt>{row.issued_at?'Issued':'Invoice date'}</dt><dd>{date(row.payload.issuedDate||row.created_at)}</dd></div>{row.payload.dueDate&&<div><dt>Balance due</dt><dd>{date(row.payload.dueDate)}</dd></div>}</dl>
   <strong className="invoice-library-total">{new Intl.NumberFormat('en-NG',{style:'currency',currency:row.payload.currency||'NGN',maximumFractionDigits:2}).format((row.payload.total_minor||0)/100)}</strong>
   <div className="org-invoice-actions"><button className="ml-button" disabled={!!busy} onClick={()=>open(row)}>{row.locked?'View invoice':'Edit invoice'}</button>{row.has_pdf&&<button className="ml-button primary" disabled={!!busy} onClick={()=>download(row)}>{busy===row.id?'Preparing PDF…':'Download invoice PDF'}</button>}{!row.locked&&<button className="ml-button" disabled={!!busy} onClick={()=>remove(row)}>Delete draft</button>}</div>
  </article>)}</div>
  {editor&&org&&<OrganizationInvoiceEditor key={editor.invoice?.id||'new'} org={org} invoice={editor.invoice} onClose={()=>setEditor(null)} onSaved={load}/>}
 </section>
}
