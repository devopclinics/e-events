import {useEffect,useMemo,useRef,useState} from 'react'
import {api} from '../../api'
import {invoiceFromProposal,invoiceErrors,invoiceTotals,buildInvoice} from '../proposals/organizationInvoiceDocument.mjs'
import {createProposalPdf} from '../proposals/proposalPdf'
import '../proposals/ProposalGenerator.css'

function saveBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000)}
async function issuedPdf(payload,record){
 const frame=document.createElement('iframe');frame.style.cssText='position:fixed;left:-10000px;top:0;width:800px;height:1130px;border:0';frame.setAttribute('sandbox','allow-same-origin')
 const ready=new Promise((resolve,reject)=>{frame.onload=resolve;frame.onerror=reject})
 frame.srcdoc=buildInvoice(payload,{...record,status:'issued'},location.origin);document.body.appendChild(frame)
 try{await ready;return await createProposalPdf(frame,{pageCount:1,title:'Invoice '+record.reference})}finally{frame.remove()}
}
export default function OrganizationInvoiceEditor({org,invoice,onClose,onSaved}){
 const dialog=useRef(null),preview=useRef(null)
 const [record,setRecord]=useState(invoice),[draft,setDraft]=useState(()=>invoice?.payload||{...invoiceFromProposal(),title:'Services',issuerName:org.name,currency:['NGN','USD','GBP','EUR'].includes(org.currency)?org.currency:'NGN'})
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[dirty,setDirty]=useState(!invoice),[reviewed,setReviewed]=useState(false),[layout,setLayout]=useState('Checking preview…')
 const locked=record?.locked,errors=invoiceErrors(draft),total=invoiceTotals(draft)
 const html=useMemo(()=>buildInvoice(draft,record||{},location.origin),[draft,record])
 useEffect(()=>{dialog.current.showModal()},[])
 useEffect(()=>{setReviewed(false);setLayout('Checking preview…')},[html])
 useEffect(()=>{if(!dirty)return;const warn=e=>{e.preventDefault();e.returnValue=''};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[dirty])
 function close(){if(!dirty||window.confirm('Discard unsaved invoice changes?'))onClose()}
 function change(key,value){setDraft(d=>({...d,[key]:value}));setDirty(true);setNotice('')}
 function fee(index,key,value){change('fees',draft.fees.map((row,i)=>i===index?{...row,[key]:value}:row))}
 async function persist(){const saved=await api.saveOrgInvoice(org.id,record?.id,draft,record?.version||1);setRecord(saved);setDraft(saved.payload);setDirty(false);onSaved();return saved}
 async function save(){setBusy(true);try{await persist();setNotice('Draft saved to '+org.name+'.')}catch(e){setNotice(e.message)}finally{setBusy(false)}}
 async function issue(){
  if(!reviewed||errors.length||layout)return
  setBusy(true);setNotice('Preparing the final PDF…')
  try{const saved=dirty||!record?await persist():record;const blob=await issuedPdf(saved.payload,saved);const issued=await api.issueOrgInvoice(org.id,saved.id,saved.version,blob);setRecord(issued);setDraft(issued.payload);setDirty(false);setNotice('Invoice issued. Its details and PDF are locked.');onSaved()}
  catch(e){setNotice(e.message)}finally{setBusy(false)}
 }
 async function download(){setBusy(true);try{saveBlob(await api.downloadOrgInvoice(org.id,record.id),record.filename||record.reference+'.pdf');setNotice('Issued PDF downloaded.')}catch(e){setNotice(e.message)}finally{setBusy(false)}}
 async function check(){const doc=preview.current?.contentDocument;if(!doc)return;await doc.fonts?.ready;const page=doc.querySelector('.sheet'),footer=doc.querySelector('footer');setLayout(page.scrollHeight>page.clientHeight+1||footer.previousElementSibling.getBoundingClientRect().bottom+8>footer.getBoundingClientRect().top?'Content exceeds one page. Shorten service descriptions or notes.':'')}
 const money=cents=>new Intl.NumberFormat('en-NG',{style:'currency',currency:draft.currency}).format(cents/100)
 return <dialog ref={dialog} className="pg-dialog org-invoice-dialog" aria-label={locked?'View invoice':'Create or edit invoice'} onCancel={e=>{e.preventDefault();close()}}>
  <header className="pg-head"><div><span className="ml-eyebrow">{org.name}</span><h2>{locked?'Invoice':record?'Edit invoice':'Create invoice'}</h2><p>{record?.reference||'Reference assigned when you save'} · {record?.status||'New draft'}{dirty?' · Unsaved changes':''}</p></div><button className="ml-button" disabled={busy} onClick={close}>Close</button></header>
  {notice&&<p role="status" className="ml-notice">{notice}</p>}
  {locked?<section className="org-invoice-issued"><h3>{draft.client} · {draft.title}</h3><strong>{money(draft.total_minor||0)}</strong><p>This invoice belongs to {org.name}. Its saved details and PDF cannot be edited.</p><ul>{draft.fees?.map((r,i)=><li key={i}>{r.label}{r.description?' — '+r.description:''}</li>)}</ul>{record.has_pdf&&<button className="ml-button primary" disabled={busy} onClick={download}>Download invoice PDF</button>}</section>:
  <div className="pg-body"><form className="pg-form" onSubmit={e=>e.preventDefault()}><fieldset className="pg-fields" disabled={busy}>
   <h3>Client & invoice</h3>{[['client','Bill to'],['title','Invoice title'],['issuerName','Your business name'],['issuerContact','Business contact details'],['issuedDate','Invoice date'],['dueDate','Balance due date (optional)'],['date','Event date (optional)']].map(([key,label])=><label key={key}>{label}<input type={['issuedDate','dueDate','date'].includes(key)?'date':'text'} maxLength={key==='issuerContact'?200:120} value={draft[key]||''} onChange={e=>change(key,e.target.value)}/></label>)}
   <label>Currency<select value={draft.currency} onChange={e=>change('currency',e.target.value)}>{['NGN','USD','GBP','EUR'].map(c=><option key={c}>{c}</option>)}</select></label>
   <h3>Services</h3>{draft.fees.map((row,i)=><div className="pg-fee" key={row.id||i}><label>Service {i+1}<input maxLength={140} value={row.label} onChange={e=>fee(i,'label',e.target.value)}/></label><label>Description {i+1}<input maxLength={200} value={row.description||''} onChange={e=>fee(i,'description',e.target.value)}/></label><label>Amount {i+1}<input type="number" min="0" step="0.01" value={row.amount} onChange={e=>fee(i,'amount',Number(e.target.value))}/></label><label className="pg-check"><input type="checkbox" checked={row.complimentary} onChange={e=>fee(i,'complimentary',e.target.checked)}/>Included at no extra charge</label>{draft.fees.length>1&&<button type="button" className="ml-button" onClick={()=>change('fees',draft.fees.filter((_,j)=>j!==i))}>Remove service {i+1}</button>}</div>)}
   <button type="button" className="ml-button" disabled={draft.fees.length>=8} onClick={()=>change('fees',[...draft.fees,{id:crypto.randomUUID(),label:'Additional service',amount:0,complimentary:false}])}>Add service</button>
   <label>Discount<input type="number" min="0" step="0.01" value={draft.discount} onChange={e=>change('discount',Number(e.target.value))}/></label><label>Deposit percentage<input type="number" min="0" max="100" value={draft.deposit} onChange={e=>change('deposit',Number(e.target.value))}/></label>
   <h3>Payment details</h3>{[['bank','Bank'],['accountName','Account name'],['accountNumber','Account number']].map(([key,label])=><label key={key}>{label}<input maxLength={key==='accountNumber'?60:120} value={draft[key]} onChange={e=>change(key,e.target.value)}/></label>)}
   <label>Scope & notes<textarea aria-label="Scope & notes" rows={4} maxLength={850} value={draft.exclusions} onChange={e=>change('exclusions',e.target.value)}/></label>
   <div className="pg-row"><label>Brand colour<input type="color" value={draft.brand} onChange={e=>change('brand',e.target.value)}/></label><label>Accent colour<input type="color" value={draft.accent} onChange={e=>change('accent',e.target.value)}/></label></div>
   <button type="button" className="ml-button" onClick={save}>Save draft</button>
  </fieldset><div className="pg-summary"><span>Total</span><strong>{money(total.total)}</strong><small>{money(total.deposit)} deposit · {money(total.balance)} balance</small></div>
  {reviewed&&errors.length>0&&<ul role="alert">{errors.map((error,i)=><li key={i}>{error}</li>)}</ul>}{layout&&<p role="alert">{layout}</p>}
  <label className="pg-check"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>I reviewed the complete invoice, charges and payment details.</label>
  <button type="button" className="ml-button primary" disabled={busy||!reviewed||errors.length>0||!!layout} onClick={issue}>{busy?'Working…':'Issue & lock invoice'}</button><p className="pg-help">Issuing saves a final PDF. It does not send an email or collect payment.</p>
  </form><div className="pg-preview"><p className="ml-eyebrow">INVOICE PREVIEW</p><div className="invoice-preview-scroll"><iframe ref={preview} title="Invoice preview" srcDoc={html} sandbox="allow-same-origin" onLoad={check}/></div></div></div>}
 </dialog>
}
