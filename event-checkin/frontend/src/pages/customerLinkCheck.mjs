const prefix='festio.destinationCheck:'
export function saveDestinationCheck(storage,actor,event,fingerprint,url,now=Date.now()){try{storage.setItem(prefix+actor+':'+event,JSON.stringify({fingerprint,url,checkedAt:now}))}catch{}}
export function readDestinationCheck(storage,actor,event,fingerprint,now=Date.now()){try{const v=JSON.parse(storage.getItem(prefix+actor+':'+event)||'null');return v?.fingerprint===fingerprint&&typeof v.url==='string'&&v.checkedAt<=now&&now-v.checkedAt<86400000?v:null}catch{return null}}

export function destinationCheckStorage(){try{return window.sessionStorage}catch{return null}}

export function clearDestinationCheck(storage,actor,event){try{storage.removeItem(prefix+actor+':'+event)}catch{}}
