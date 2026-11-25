import {useMemo,useState} from 'react'
import {JUNIOR_HELP_TOPICS,JUNIOR_GUIDE_BASE} from '../juniorHelpContent.mjs'
import {topicSearchText} from '../helpTopicText.mjs'
import JuniorWorkflowOverview from './JuniorWorkflowOverview'
import './JuniorHelp.css'
export default function JuniorHelp({onNavigate}){
 const [query,setQuery]=useState('')
 const topics=useMemo(()=>JUNIOR_HELP_TOPICS.filter(t=>topicSearchText(t).includes(query.trim().toLowerCase())),[query])
 return <section className="jp-help" aria-label="Festio Juniors help"><header><span className="jp-eyebrow">Help for your next safe step</span><h2>Help & flow</h2><p>Find the right action, understand what is required and know when to ask your lead.</p></header><JuniorWorkflowOverview/><div className="jp-help-guide-links"><button onClick={()=>onNavigate('guide')}>Open full volunteer guide</button><a href={JUNIOR_GUIDE_BASE+'/festio-juniors-volunteer-guide.docx'} download>Download Word guide</a><a href={JUNIOR_GUIDE_BASE+'/festio-juniors-volunteer-guide.pdf'} target="_blank" rel="noreferrer">Open PDF guide</a></div><label className="jp-help-search">Search Juniors help<input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Drop-off, allergy, collector, outing…"/></label><p role="status">{topics.length} help {topics.length===1?'article':'articles'}</p><div className="jp-help-topics">{topics.map(t=><details key={t.id}><summary>{t.title}</summary><p>{t.intro}</p><p><strong>Go to:</strong> {t.path}</p><ol>{t.steps.map((s,i)=><li key={i}>{s}</li>)}</ol>{t.check&&<p className="jp-notice"><strong>Check:</strong> {t.check}</p>}{t.troubleshoot&&<p>{t.troubleshoot}</p>}{t.warn&&<p className="jp-warning">{t.warn}</p>}</details>)}{!topics.length&&<p>No matching help. Try “screening”, “collector”, “outing” or “handover”.</p>}</div></section>
}
