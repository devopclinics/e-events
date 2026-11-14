const ALIASES = {
 setup:'overview event dashboard configure', guide:'help getting started setup checklist', guests:'attendees participants registration names contacts', invite:'invitations rsvp register email whatsapp', communication:'inbox replies messages chat', messages:'broadcast email whatsapp sms templates notifications', features:'enable addons settings services messaging', access:'zones gates admission scan', checkin:'scanner qr arrival attendance check in', seating:'tables chairs floor plan', orders:'food kitchen catering meals menu', menu:'food kitchen catering meals', registry:'gift list presents', logistics:'delivery packages', speakers:'presenters facilitators', partners:'sponsors sponsorship', reminders:'notifications schedule', team:'staff permissions roles access', tasks:'mytasks assignments todo', design:'branding certificate invitation flyer', website:'site landing page public', guesthub:'guest portal', live:'engagement interactive polls quiz word cloud presentation', results:'report analytics statistics attendance export', media:'library files pdf documents uploads', org:'organization organisation billing subscription account', billing:'payments invoice subscription', ticketing:'tickets sales payments registration', planner:'agenda schedule programme timeline', conference:'sessions conference programme', experience:'journey workflow', festiome:'networking community',
}
const LIVE = [
 ['Certificates','Certificates','Design, eligibility, signatures and certificate issuance','diploma award signatory issue email'],
 ['Donations','Donation Tracker','Giving campaigns, pledges and fundraising displays','fundraising donate zakat sadaqah giving donations'],
 ['Experiences','Presenter & experiences','Presentation workflows and presenter sessions','presentation slides deck 3d zakat experiences'],
 ['Activities','Live activities','Polls, quizzes, Q&A and audience interactions','questions voting word cloud survey engagement'],
 ['Materials','Presenter materials','Upload presentation and speaker materials','slides files resources documents'],
 ['Question Bank','Question bank','Prepare reusable audience questions','quiz questions library'],
 ['Staff access','Presenter & moderator links','Share presenter and moderation access','staff speaker presenter link invite'],
 ['Responses','Live responses','Review audience answers and participation','votes answers poll responses'],
 ['Control Room','Live control room','Run the show and send activities to screens','start launch stage projector control'],
 ['Displays','Channels & devices','Manage screens and projector connections','qr participation link display screen projector'],
]
export function featureCatalog(topLinks, sidebarLinks, {hasEvent=false,canAccess=()=>true,setupHref='/setup-redesign?view=guide'}={}) {
 const entries=[...topLinks,...sidebarLinks].filter(x=>hasEvent||['events','meetings','org','console','media','help','academy'].includes(x.id)).map(x=>({...x,to:x.id==='guide'?setupHref:x.to,description:x.description||'Open '+x.label,keywords:ALIASES[x.id]||''}))
 if(hasEvent&&topLinks.some(x=>x.id==='live')) {
  for(const [tab,label,description,keywords] of LIVE) entries.push({id:'live-'+tab,label,to:'/live-redesign?tab='+encodeURIComponent(tab),description,keywords})
 }
 if(hasEvent&&topLinks.some(x=>x.id==='results')) {
  entries.push({id:'report',label:'Generate event report',description:'PAMCON design · Preview and save a report as PDF',to:'/event-results-redesign?view=closeout',keywords:'download export pdf report template summary'})
  for(const [view,label,keywords] of [['attendance','Attendance results','arrivals check in scans'],['communications','Communication results','email whatsapp sms delivery messages'],['programme','Programme results','sessions schedule speaker attendance'],['giving','Giving results','donations pledges fundraising'],['revenue','Ticket revenue results','sales payments money'],['feedback','Feedback results','satisfaction ratings survey']]) entries.push({id:'results-'+view,label,to:'/event-results-redesign?view='+view,description:'Review '+label.toLowerCase(),keywords})
  entries.push({id:'certificate-results',label:'Certificate results',description:'Review issued certificates, email requests and views',to:'/event-results-redesign?view=certificates',keywords:'certificate issuance report analytics'})
 }
 const seen=new Set()
 return entries.filter(x=>x.to&&canAccess(x.to)&&!seen.has(x.description.startsWith('Enable ')?x.id:x.to)&&seen.add(x.description.startsWith('Enable ')?x.id:x.to))
}
const normalize = s=>s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim()
export function searchFeatures(entries,query) {
 const words=normalize(query).split(' ').filter(Boolean)
 return entries.map((entry,index)=>{
  const label=normalize(entry.label),text=normalize([entry.label,entry.description,entry.keywords].join(' '))
  const matches=words.every(word=>text.includes(word))
  const score=words.reduce((n,w)=>n+(label===w?20:label.startsWith(w)?10:label.includes(w)?5:normalize(entry.description||'').includes(w)?3:1),0)
  return {entry,index,matches,score}
 }).filter(x=>x.matches).sort((a,b)=>b.score-a.score||a.index-b.index).map(x=>x.entry)
}
