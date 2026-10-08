export const SETUP_STAGES = [
 ['wizard','Create event'],['outcomes','Choose outcomes'],['guide','Foundation'],['audience','Audience & registration'],
 ['experience','Design & guest experience'],['operations','Operations & giving'],['live','Conference & Live'],['closeout','Results & closeout'],
]
const key=(eventId,userId)=>`festio:setup-resume:${userId || 'current'}:${eventId}`
export function readGuideResume(eventId,userId) {
 try {const value=JSON.parse(localStorage.getItem(key(eventId,userId)));return value && SETUP_STAGES.some(([id])=>id===value.view) ? value : null} catch{return null}
}
export function saveGuideResume(eventId,userId,view,task='') {
 if(!eventId || !SETUP_STAGES.some(([id])=>id===view))return
 try {localStorage.setItem(key(eventId,userId),JSON.stringify({view,task}))} catch{/* URL navigation still works without storage. */}
}
export function guideHref(eventId,userId) {
 const resume=readGuideResume(eventId,userId)
 const params=new URLSearchParams({view:resume?.view || 'guide'})
 if(resume?.task)params.set('task',resume.task)
 return `/setup-redesign?${params}`
}
