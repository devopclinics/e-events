// IndexedDB contains operation IDs and cached authorised pages, never pass tokens.
const DB='festio-guest-services-v1',STORE='records'
let opened
function database(){
 if(!globalThis.indexedDB)return Promise.reject(new Error('This browser cannot save offline work'))
 return opened ||= new Promise((resolve,reject)=>{const request=indexedDB.open(DB,1);request.onupgradeneeded=()=>request.result.createObjectStore(STORE,{keyPath:'id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>{opened=null;reject(request.error)}})
}
export async function readRecord(id){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly'),request=tx.objectStore(STORE).get(id);request.onsuccess=()=>resolve(request.result?.value);request.onerror=()=>reject(request.error)})}
export async function editRecord(id,edit){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE);let value;const request=store.get(id);request.onsuccess=()=>{try{value=edit(request.result?.value);if(value===undefined)store.delete(id);else store.put({id,value})}catch(e){tx.abort();reject(e)}};tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error || new Error('Offline storage cancelled'))})}
export const queueId=(actor,event)=>`queue:${actor}:${event}`
export function queuedAction(action,guest,service,randomKey=()=>crypto.randomUUID(),now=()=>new Date()){
 if(!['seated','served','attendance'].includes(action)||!guest?.id||!guest?.table_id||!guest.admitted)throw new Error('Choose a checked-in guest at an assigned table')
 if(action!=='seated'&&(!guest.can_manage_meals||!service))throw new Error('Meal permission and service are required')
 return {client_key:randomKey(),action,guest_id:guest.id,table_id:guest.table_id,service_id:service?.id || null,captured_at:now().toISOString(),expected_seated_at:guest.seated_at || null,expected_record_updated_at:service?.record_updated_at || null,expected_selection_key:service?.selection_key || null}
}
export async function appendAction(id,action){return editRecord(id,old=>{const rows=old || [];if(rows.some(r=>r.state==='pending'&&r.action===action.action&&r.guest_id===action.guest_id&&r.service_id===action.service_id))return rows;if(rows.length>=100)throw new Error('Offline queue is full. Sync or review existing work first.');return [...rows,{...action,state:'pending'}]})}
export const discardAction=(id,key)=>editRecord(id,old=>(old || []).filter(row=>row.client_key!==key))
export function replayBody(row){const {state,issue,...body}=row;return body}
export async function syncQueue(id,send,online=()=>navigator.onLine!==false){
 const blocked=new Set()
 for(const original of await readRecord(id) || []){
  const row=(await readRecord(id)||[]).find(item=>item.client_key===original.client_key)
  if(!row)continue
  if(!online())break
  if(row.state==='review'||blocked.has(row.guest_id)){blocked.add(row.guest_id);continue}
  try{const result=await send(replayBody(row));if(!result?.ok)throw Object.assign(new Error('Sign in again before syncing'),{status:401});await editRecord(id,old=>(old || []).filter(item=>item.client_key!==row.client_key).map(item=>row.service_id&&item.state==='pending'&&item.guest_id===row.guest_id&&item.service_id===row.service_id&&item.expected_record_updated_at===row.expected_record_updated_at?{...item,expected_record_updated_at:result.record_updated_at}:item))}
  catch(error){
   if(!error.status||error.status>=500||[401,429].includes(error.status))break
   blocked.add(row.guest_id)
   await editRecord(id,old=>(old || []).map(item=>item.client_key===row.client_key?{...item,state:'review',issue:error.message}:item))
  }
 }
 return await readRecord(id) || []
}
export async function clearGuestServiceCaches(actor){
 try{const db=await database();await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE),cursor=store.openCursor();cursor.onsuccess=()=>{const row=cursor.result;if(row){if(row.key.startsWith(`page:${actor}:`))row.delete();row.continue()}};tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})}catch{/* No persistent cache is available. */}
}
export async function savePage(id,value){
 const db=await database()
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE),prefix=id.split(':').slice(0,3).join(':')+':',rows=[]
  store.put({id,value})
  const cursor=store.openCursor();cursor.onsuccess=()=>{const current=cursor.result;if(current){if(current.key.startsWith(prefix))rows.push({id:current.key,saved:current.value.value.saved_at});current.continue()}else{rows.sort((a,b)=>b.saved-a.saved);for(const [index,row] of rows.entries())if(index>=12||Date.now()-row.saved>12*60*60*1000)store.delete(row.id)}}
  tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)
 })
}
