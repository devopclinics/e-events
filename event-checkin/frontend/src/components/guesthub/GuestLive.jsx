import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { icons } from './icons.mjs';
import './GuestLive.css';

// The standalone and embedded experiences use exactly the same response forms,
// moderation, scoring, result visibility and activity SSE subscriptions.
const ActivityView = lazy(() => import('../../pages/LiveGuestPage').then(m => ({default:m.ActivityView})));
const Icon = ({name}) => <svg viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{__html:icons[name] || icons.live}}/>;
const types = {quiz:['Quiz','star'],q_and_a:['Q&A','mic'],poll:['Poll','people'],voting:['Audience vote','star'],survey:['Survey','file'],feedback:['Feedback','star'],word_cloud:['Word cloud','chat'],rating:['Rating','star']};
const statusLabel = a => a.status === 'live' ? 'Live now' : a.status === 'scheduled' ? 'Opens later' : a.status === 'paused' ? 'Paused' : a.joinable ? 'Review results' : 'Closed';

export default function GuestLive({eventId,passToken,guestName,route,offline,onNavigate,onProgramme}) {
  const [session,setSession] = useState(null);
  const [rows,setRows] = useState(null);
  const [error,setError] = useState('');
  const [upcomingError,setUpcomingError] = useState('');
  const [retry,setRetry] = useState(0);
  const [search,setSearch] = useState('');
  const [questionsOnly,setQuestionsOnly] = useState(false);
  const [run,setRun] = useState(null);
  const navigateRef = useRef(onNavigate);
  navigateRef.current = onNavigate;

  useEffect(() => {
    if (offline) return;
    let cancelled=false, renewal;
    async function connect() {
      try {
        const result=await api.liveGuestSession(eventId,passToken);
        if(cancelled)return;
        setSession(result);setError('');
        renewal=setTimeout(connect,Math.max(30000,((result.expires_in || 900)-60)*1000));
      } catch(e) { if(!cancelled)setError(e.message || 'Your Live Activities could not connect. Please try again.'); }
    }
    connect();
    return()=>{cancelled=true;clearTimeout(renewal)};
  },[eventId,passToken,retry,offline]);

  useEffect(() => {
    if(!session?.token || offline)return;
    let cancelled=false, inFlight=false;
    async function load() {
      if(inFlight)return;
      inFlight=true;
      try {
        const [live,programme]=await Promise.allSettled([api.liveGuestActivities(session.token),api.liveGuestProgrammeActivities(session.token)]);
        if(cancelled)return;
        if(live.status==='rejected')throw live.reason;
        // Programme metadata includes scheduled activities but grants no response access.
        const merged=new Map((programme.status==='fulfilled'?programme.value:[]).map(a=>[a.id,{...a,joinable:false}]));
        live.value.forEach(a=>merged.set(a.id,{...a,joinable:true}));
        setRows([...merged.values()]);setError('');
        setUpcomingError(programme.status==='rejected'?'Upcoming activities could not refresh. Open activities are still available.':'');
      } catch(e) {if(!cancelled)setError(e.message || 'Activities could not refresh. Please try again.');}
      finally {inFlight=false;}
    }
    load();
    const refresh=()=>{if(document.visibilityState==='visible')load()};
    // Participation has its own SSE subscription; discovery polling runs only in the lobby.
    const timer=!route.activity ? setInterval(refresh,15000) : null;
    document.addEventListener('visibilitychange',refresh);
    return()=>{cancelled=true;clearInterval(timer);document.removeEventListener('visibilitychange',refresh)};
  },[session?.token,offline,retry,route.activity]);

  useEffect(() => {
    if(!session?.token || offline || route.activity && route.follow!=='1')return;
    let cancelled=false,inFlight=false,stream=null,streamKey='',interval;
    async function load() {
      if(inFlight)return;
      inFlight=true;
      try {
        const result=await api.liveGuestCurrentWorkflowRun(session.token);
        if(cancelled)return;
        const next=result.run || null;
        setRun(next);
        const key=next?.id && next?.public_token ? `${next.id}:${next.public_token}` : '';
        if(key!==streamKey){
          stream?.close();stream=null;streamKey=key;
          if(key){
            stream=new EventSource(`/api/engagement/v1/runs/${encodeURIComponent(next.id)}/stream?token=${encodeURIComponent(next.public_token)}`);
            ['workflow.start','workflow.next','workflow.previous','workflow.jump','workflow.pause','workflow.resume','workflow.complete','workflow.reveal_results','workflow.reopen_voting'].forEach(name=>stream.addEventListener(name,load));
          }
        }
        if(route.follow==='1' && next?.active_activity_id && next.active_activity_id!==route.activity)
          navigateRef.current({activity:next.active_activity_id,follow:'1'},true);
      } catch { /* Workflows are optional; activity participation remains available. */ }
      finally {inFlight=false;}
    }
    load();
    interval=setInterval(()=>{if(document.visibilityState==='visible')load()},15000);
    return()=>{cancelled=true;clearInterval(interval);stream?.close()};
  },[session?.token,offline,route.activity,route.follow]);

  const retryLoad=useCallback(()=>setRetry(n=>n+1),[]);
  const activity=rows?.find(a=>a.id===route.activity && (!route.session || a.session_id===route.session));
  const open=a=>onNavigate({activity:a.id,...(a.session_id?{session:a.session_id}:{})});
  const matches=(rows || []).filter(a=>(!questionsOnly || a.type==='q_and_a') && `${a.title} ${a.session_title || ''}`.toLowerCase().includes(search.trim().toLowerCase()));
  const featured=matches.find(a=>a.joinable && a.status==='live' && a.type!=='q_and_a');
  const qa=matches.find(a=>a.joinable && a.status==='live' && a.type==='q_and_a');
  const remaining=matches.filter(a=>a!==featured && a!==qa);
  function card(a,kind='row') {
    const [label,ic]=types[a.type] || ['Activity','live'];
    return <article className={`gl-${kind}`} key={a.id}>
      <span className="gl-art"><Icon name={ic}/></span><span className="gl-status">{label} · {statusLabel(a)}</span>
      <h2>{a.title}</h2>{a.session_title && <p className="gl-session">{a.session_title}</p>}
      {kind!=='row' && <p>{a.description || (a.type==='q_and_a'?'Ask your questions in this session’s conversation.':'Take part with the community, right here in GuestHub.')}</p>}
      <button className={kind==='feature'?'primary':'text-button'} disabled={!a.joinable || offline || !!error} onClick={()=>open(a)}>{a.joinable ? a.type==='q_and_a'?'Open session Q&A →':a.status==='live'?a.type==='quiz'?'Join the quiz →':'Open activity →':statusLabel(a)+' →' : statusLabel(a)}</button>
    </article>;
  }
  return <section className="guest-live" aria-label="Festio Live">
    {route.activity ? <div className="gl-crumb"><button className="text-button" onClick={()=>onNavigate({})}>← Live Activities</button><span>Inside GuestHub</span></div> : null}
    <header className="gl-heading"><div><span className="eyebrow">{route.activity?'FESTIO LIVE':'YOUR VOICE. YOUR COMMUNITY.'}</span><h1>{route.activity ? activity?.title || 'Live activity' : 'Be part of the moment.'}</h1><p>{route.activity ? activity?.session_title || 'Your event activity' : 'Ask a question, share your perspective, join the fun.'}</p></div>{!route.activity && <span className="gl-status">● Festio Live</span>}</header>
    {error && <div className="notice" role="alert">{error} <button className="text-button" onClick={retryLoad} disabled={offline}>Try again</button></div>}
    {offline && <p className="notice">Reconnect to send a response. Unsent responses are not queued.</p>}
    {!session || rows===null ? !error && <p role="status" className="card">{offline?'Connect to load Live Activities.':'Connecting to your event activities…'}</p> : route.activity ? <>
      {activity?.session_id && <button className="text-button gl-programme-link" onClick={()=>onProgramme(activity.session_id)}>View programme session →</button>}
      {route.follow==='1' && <p className="gl-follow" role="status">Following the guided show{run?.current_step?.title ? ` · ${run.current_step.title}` : ''}. The host controls the next activity.</p>}
      {activity?.joinable ? <div className="gl-activity-layout"><Suspense fallback={<p role="status">Loading activity…</p>}><ActivityView key={activity.id} embedded offline={offline} guestToken={session.token} activityId={activity.id} onBack={()=>onNavigate({})}/></Suspense><aside className="gl-info"><Icon name="people"/><h3>Your participation</h3><p>{guestName || 'Your personal guest access'}</p><p>{activity.type==='q_and_a'?'You can ask more than one question. This session has its own question queue.':'The host controls question timing and when results are shared.'}</p><button className="text-button" onClick={()=>onProgramme(activity.session_id)}>Back to programme →</button></aside></div> : <div className="card" role="status"><h2>{activity?statusLabel(activity):'Activity unavailable'}</h2><p>{activity?'The organizer has not opened this activity for responses.':'This activity is not available to your guest access right now.'}</p><button className="text-button" disabled={offline} onClick={retryLoad}>Refresh activities</button></div>}
    </> : <>
      {run && <section className="gl-show"><span className="eyebrow">GUIDED SHOW · {run.status}</span><h2>{run.current_step?.title || 'The next moment will begin shortly'}</h2><p>{run.status==='paused'?'The presenter has paused the show.':'Follow the presenter as new activities open.'}</p><button className="primary" disabled={offline || !!error || !run.active_activity_id} onClick={()=>onNavigate({activity:run.active_activity_id,follow:'1'})}>{run.active_activity_id?'Join guided show →':'Waiting for the next activity'}</button></section>}
      {rows.length>0 && <div className="gl-filters"><label>Find a speaker, session or activity<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search activities…"/></label><label className="gl-filter-toggle"><input type="checkbox" checked={questionsOnly} onChange={e=>setQuestionsOnly(e.target.checked)}/>Questions &amp; answers only</label></div>}
      {upcomingError && <p role="status" className="notice">{upcomingError} <button className="text-button" onClick={retryLoad}>Retry</button></p>}
      {(featured || qa) && <div className={`gl-lead ${!featured || !qa?'gl-single':''}`}>{featured&&card(featured,'feature')}{qa&&card(qa,'qa')}</div>}
      {!!remaining.length && <><h2 className="gl-section-title">More ways to take part</h2><div className="gl-grid">{remaining.map(a=>card(a))}</div></>}
      {!matches.length && <div className="empty"><h2>{rows.length?'No matching activities':'Nothing is live right now'}</h2><p>{rows.length?'Try a different name or show all activity types.':'Your organizer’s published activities will appear here when available.'}</p>{rows.length>0 && <button className="text-button" onClick={()=>{setSearch('');setQuestionsOnly(false)}}>Clear filters</button>}</div>}
      <p className="gl-identity">Participating as <b>{guestName || 'your guest identity'}</b> · Your own guest access</p>
    </>}
  </section>;
}
