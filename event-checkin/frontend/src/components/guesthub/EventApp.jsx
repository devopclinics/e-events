import GuestMeals from './GuestMeals';
import EventForms from './EventForms';
import InstallEventApp from './InstallEventApp';
import { Children, isValidElement, useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { icons } from './icons.mjs';
import { appHash, readAppRoute, appPhase, upcomingProgramme, requiredActions, partyMembers, guestServices, safeExternal, asTime } from './appModel.mjs';
import './EventApp.css';
const nav = [['home', 'home', 'Home'], ['programme', 'calendar', 'Programme'], ['pass', 'pass', 'My Pass'], ['inbox', 'mail', 'Inbox'], ['more', 'grid', 'More']];
const Icon = ({
  name
}) => <svg aria-hidden="true" viewBox="0 0 24 24" dangerouslySetInnerHTML={{
  __html: icons[name] || icons.grid
}} />;
// Select existing React form trees, not DOM copies: their original handlers,
// validation, conditional fields and error states remain owned by GuestHub.
function findPanel(tree, id) {
  const found = [];
  Children.forEach(tree, child => {
    if (!isValidElement(child)) return;
    if (child.props['data-app-panel'] === id || child.props.id === id) found.push(child);else found.push(...findPanel(child.props.children, id));
  });
  return found;
}
function contrasting(hex) {
  const c = /^#[0-9a-f]{6}$/i.test(hex || '') ? hex.slice(1).match(/../g).map(x => parseInt(x, 16) / 255) : [0, 0, 0];
  const l = c.map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((a, v, i) => a + v * [.2126, .7152, .0722][i], 0);
  return l > .18 ? '#142d25' : '#ffffff';
}
export default function EventApp({
  event,
  hub,
  journey,
  programmeControl,
  designTheme,
  guestContent,
  feedbackForms = [],
  moduleVisible = () => true,
  serviceTree,
  guardianControls,
  previewMock = false,
  previewQr,
  journeyError,
  onRetryJourney,
  failure,
  error,
  onRetry,
  onViewEvent,
  markStepDone,
  markingStepId
}) {
  const [route, setRoute] = useState(() => readAppRoute(window.location.hash));
  const [now, setNow] = useState(Date.now());
  const [party, setParty] = useState(null);
  const [partyError, setPartyError] = useState('');
  const [search, setSearch] = useState('');
  const [inboxFilter, setInboxFilter] = useState('updates');
  const [offline, setOffline] = useState(!navigator.onLine);
  const [serviceNotice, setServiceNotice] = useState('');
  const contentRef = useRef(null);
  const detailRef = useRef(null);
  const sessionTrigger = useRef(null);
  const members = partyMembers(hub, party);
  const guest = members.find(m => m.is_self) || hub?.guest || {};
  const ownToken = hub?.guest?.qr_token;
  const zone = event.timezone || 'UTC';
  function date(value, opts = {
    dateStyle: 'medium'
  }) {
    if (!Number.isFinite(asTime(value))) return 'Time to be announced';
    try {
      return new Intl.DateTimeFormat(undefined, {
        timeZone: zone,
        ...opts
      }).format(asTime(value));
    } catch {
      return new Intl.DateTimeFormat(undefined, {
        timeZone: 'UTC',
        ...opts
      }).format(asTime(value));
    }
  }
  const time = v => date(v, {
    hour: 'numeric',
    minute: '2-digit'
  });
  function navigate(screen, extra = {}, replace = false) {
    const next = {
      screen,
      ...extra
    };
    if (appHash(next) === window.location.hash) return;
    if (replace) { history.replaceState(history.state, '', appHash(next)); setRoute(next); return; }
    history.replaceState({ ...history.state, festioScrollY: window.scrollY }, '');
    history.pushState({
      festioFrom: route.screen,
      festioApp: true,
      modal: !!extra.session
    }, '', appHash(next));
    setRoute(next);
  }
  function closeSession() {
    if (history.state?.modal) history.back();else {
      const next = {
        ...route,
        session: ''
      };
      history.replaceState({
        festioApp: true
      }, '', appHash(next));
      setRoute(next);
    }
  }
  useEffect(() => {
    const update = () => setRoute(readAppRoute(window.location.hash));
    window.addEventListener('popstate', update);
    window.addEventListener('hashchange', update);
    if (!window.location.hash.startsWith('#/')) {
      const initial = new URLSearchParams(window.location.search).get('focus') === 'feedback' ? {
        screen: 'feedback'
      } : readAppRoute('');
      history.replaceState({
        festioApp: true
      }, '', appHash(initial));
      setRoute(initial);
    }
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener('hashchange', update);
    };
  }, []);
  useEffect(() => {
    if (!route.session) {
      contentRef.current?.focus({
        preventScroll: true
      });
      window.scrollTo({
        top: history.state?.festioScrollY || 0,
        behavior: 'instant'
      });
    }
  }, [route.screen]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    const change = () => setOffline(!navigator.onLine);
    window.addEventListener('online', change);
    window.addEventListener('offline', change);
    return () => {
      clearInterval(id);
      window.removeEventListener('online', change);
      window.removeEventListener('offline', change);
    };
  }, []);
  // Refresh with the existing hub refresh. No second polling loop.
  useEffect(() => {
    if (!ownToken || previewMock) return;
    let cancelled = false;
    api.appParty(ownToken).then(data => {
      if (!cancelled) {
        setParty(data);
        setPartyError('');
      }
    }).catch(() => {
      if (!cancelled) {
        setParty(null);
        setPartyError('Party pass and location details could not refresh. Please try again.');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [hub, ownToken, previewMock]);
  const [forms, setForms] = useState([]);
  const [formsError, setFormsError] = useState('');
  const [formsLoading, setFormsLoading] = useState(false);
  const formsRequest = useRef(0);
  async function refreshForms() {
    const request = ++formsRequest.current;
    if (!ownToken || !event.experience_enabled || previewMock) { setForms([]); setFormsLoading(false); return; }
    setFormsLoading(true);
    try { const data = await api.myEventForms(event.id, ownToken); if (request === formsRequest.current) { setForms(data.forms || []); setFormsError(''); } }
    catch { if (request === formsRequest.current) setFormsError('Forms could not refresh. Please try again.'); }
    finally { if (request === formsRequest.current) setFormsLoading(false); }
  }
  useEffect(() => { setForms([]); setFormsError(''); refreshForms(); return () => { ++formsRequest.current; }; }, [event.id, ownToken, event.experience_enabled, previewMock, route.screen === 'experience']);
  const selected = members.find(m => m.id === route.member && m.qr_token) || members.find(m => m.id === guest.id) || guest;
  const phase = appPhase(event, guest, now);
  const actions = [...forms.filter(f => f.required && f.status !== 'complete').map(f => ({id: f.revision_id + f.guest_id, title: `${f.guest_name}: ${f.title}`, screen: 'experience'})), ...requiredActions(journey, guest)];
  const programVisible = moduleVisible('live_program');
  const timeline = programVisible ? upcomingProgramme(journey?.program, now) : [];
  const next = timeline[0];
  const days = programVisible ? journey?.program?.days || [] : [];
  const selectedDay = days.find(d => d.date === route.day) || days.find(d => d.segments?.some(s => asTime(s.ends_at) > now)) || days[0];
  const allSessions = [...days.flatMap(d => d.segments || []), ...timeline];
  const selectedSession = allSessions.find(s => String(s.step_id) === route.session);
  useEffect(() => {
    const dialog = detailRef.current;
    if (!dialog) return;
    if (selectedSession) {
      sessionTrigger.current = document.activeElement;
      if (typeof dialog.showModal === 'function') {
        if (!dialog.open) dialog.showModal();
      } else dialog.setAttribute('open', '');
    } else if (dialog.open) {
      dialog.close?.();
      dialog.removeAttribute('open');
      sessionTrigger.current?.focus?.();
    }
  }, [selectedSession]);
  const colors = designTheme?.colors || {};
  const primary = /^#[0-9a-f]{6}$/i.test(colors.primary || '') ? colors.primary : '#124b3c';
  const theme = {
    '--green': primary,
    '--deep': primary,
    '--gold': /^#[0-9a-f]{6}$/i.test(colors.accent || '') ? colors.accent : '#d6b45e',
    '--on-primary': contrasting(primary)
  };
  const prominent = guestServices(event, hub, journey, moduleVisible).map(s => previewMock ? {
    ...s,
    href: ''
  } : s);
  const services = [['party', 'people', 'My party', 'Family & guardians'], moduleVisible('activity_progress') && (journey?.experience_enabled || journey?.consent?.required) && ['experience', 'shield', 'Forms & Consent', 'Your next steps'], ['venue', 'pin', 'Venue & hotel', 'Plan your visit'], event.speaker_enabled && event.speaker_token && ['speakers', 'mic', 'Speakers', 'Meet the programme team'], event.registry_enabled && event.registry_token && ['giving', 'heart', 'Give / Support', 'Event giving'], (guestContent?.materials?.length || guestContent?.certificates?.length) && ['resources', 'file', 'Resources', 'Materials & certificates'], feedbackForms.length > 0 && ['feedback', 'star', 'Feedback', 'Share your experience'], ['communications', 'help', 'Help & FAQ', 'Contact the organizer'], ['profile', 'people', 'My details', 'Your registration']].filter(Boolean);
  const quick = services.filter(s => ['party', 'venue', 'experience', 'feedback', 'communications', 'resources'].includes(s[0])).sort((a, b) => phase === 'after' ? ['feedback', 'resources', 'party', 'venue', 'experience', 'communications'].indexOf(a[0]) - ['feedback', 'resources', 'party', 'venue', 'experience', 'communications'].indexOf(b[0]) : 0).slice(0, 4);
  function openService(id) {
    setServiceNotice('');
    if (previewMock && ['speakers', 'giving'].includes(id)) {
      setServiceNotice('Design preview. No live service opened.');
      return;
    }
    if (id === 'speakers') {
      window.location.assign(`/speakers/${encodeURIComponent(event.speaker_token)}`);
      return;
    }
    if (id === 'giving') {
      window.location.assign(`/registry/${encodeURIComponent(event.registry_token)}`);
      return;
    }
    navigate(id);
  }
  function status(member) {
    return member.checked_out ? 'Checked out' : member.status || (member.admitted ? 'Checked in' : member.rsvp_status === 'confirmed' ? 'Registered · Not checked in' : member.rsvp_status || 'Status unavailable');
  }
  function panel(id) {
    if (previewMock) return <p className="card">Design preview. Forms and messages use your event’s services after publishing.</p>;
    const items = findPanel(serviceTree, id);
    return items.length ? <div className="app-service-panel">{items}</div> : <p className="card">Nothing has been published here yet.</p>;
  }
  function person(member) {
    return <div className="person" key={member.id}><span className="avatar">{(member.name || 'Guest').split(' ').map(n => n[0]).slice(0, 2).join('')}</span><div><b>{member.name}</b><small>{member.is_self ? 'You' : member.relationship || member.guest_type || 'Guest'}</small><span className="member-status">{status(member)}</span>{member.status_at && <small>Last recorded {date(member.status_at, {
            dateStyle: 'short',
            timeStyle: 'short'
          })}</small>}{!member.status_at && <small>Room / pickup status unavailable</small>}</div>{member.qr_token && <button className="text-button" onClick={() => navigate('pass', {
        member: member.id
      })}>View pass →</button>}</div>;
  }
  function sessionCard(s) {
    return <button className="card session-card" key={s.step_id || s.title} onClick={() => navigate(route.screen, {
      day: route.day,
      session: String(s.step_id)
    })}><div className="time">{time(s.starts_at)}{s.ends_at && <small>– {time(s.ends_at)}</small>}</div><div><h3>{s.title}</h3><p>{s.room || s.location || s.venue || 'Room to be announced'}</p>{s.speaker && <p>{s.speaker}</p>}{s.age_groups?.length > 0 && <span className="status">{s.age_groups.join(', ')}</span>}</div><Icon name="arrow" /></button>;
  }
  function navItems() {
    return nav.map(([id, ic, label]) => <button type="button" data-go={id} key={id} className={route.screen === id ? 'active' : ''} aria-current={route.screen === id ? 'page' : undefined} onClick={() => navigate(id)}><Icon name={ic} /><span>{label}</span></button>);
  }
  let body;
  if (!hub) {
    body = <section className="card" aria-live="polite"><h1>{failure ? 'Open your personal GuestHub' : 'Opening your GuestHub…'}</h1><p>{failure === 'pending' ? 'Your registration needs confirmation.' : failure === 'access' ? 'Open the personal link in your confirmation email, or contact the organizer.' : failure ? 'Your event details could not load. Your registration has not changed.' : 'Loading your pass and event services.'}</p>{failure && <button className="primary" onClick={onRetry}>Try again</button>}{onViewEvent && <button className="secondary" onClick={onViewEvent}>View event details</button>}</section>;
  } else if (route.screen === 'home') {
    const needs = phase === 'after' ? null : actions[0];
    const pending = event.rsvp_enabled !== false && guest.rsvp_status && guest.rsvp_status !== 'confirmed' && !guest.admitted;
    const title = pending ? 'Your registration needs confirmation' : needs ? `${actions.length} item${actions.length === 1 ? '' : 's'} need${actions.length === 1 ? 's' : ''} your attention` : phase === 'after' ? 'Thank you for attending' : phase === 'during' ? "You’re checked in" : guest.checked_out ? 'You’re checked out' : `You’re ready for ${event.name}`;
    const heroAction = () => navigate(pending ? 'communications' : needs ? needs.screen : phase === 'after' ? feedbackForms.length ? 'feedback' : 'more' : phase === 'during' && next ? 'programme' : 'pass');
    body = <><div className="greeting"><div><span className="eyebrow">YOUR PERSONAL GUESTHUB</span><h1>Welcome, {guest.name?.split(' ')[0] || 'Guest'}</h1><p>{date(event.event_date)} · {event.venue_name}</p></div><span className="status">{phase === 'after' ? 'Event ended' : status(guest)}</span></div>{guardianControls?.pending}<section className={`hero ${needs ? 'attention' : ''}`}><span className="eyebrow">{needs ? 'ACTION REQUIRED' : pending ? 'REGISTRATION' : phase === 'during' ? 'ADMISSION CONFIRMED' : 'YOUR EVENT'}</span><h2>{title}</h2><p>{pending ? 'Contact the organizer for your registration status.' : needs ? needs.title : phase === 'after' ? 'Find published feedback and resources in your event essentials.' : phase === 'during' && next ? `Next: ${next.title} · ${time(next.starts_at)}` : `${members.length} attendee${members.length === 1 ? '' : 's'} in your party. Open your available passes below.`}</p><div className="hero-foot"><button className="primary" onClick={heroAction}><Icon name={needs ? 'shield' : 'pass'} />{pending ? 'Contact organizer' : needs ? 'Review next steps' : phase === 'after' ? 'Continue' : phase === 'during' && next ? 'View programme' : 'Open My Pass'}</button></div></section>{!previewMock && <InstallEventApp />}{formsError && <p role="status" className="notice">{formsError} <button className="text-button" onClick={refreshForms}>Try again</button></p>}{next && phase !== 'after' && <section className="up-next"><div className="up-next-heading"><span className="eyebrow">{asTime(next.starts_at) <= now ? 'HAPPENING NOW' : 'UP NEXT'}</span><span className="starts">{asTime(next.starts_at) > now ? `Starts in ${Math.ceil((asTime(next.starts_at) - now) / 60000)} minutes` : 'In progress'}</span></div><h2>{next.title}</h2><div className="up-next-facts"><span><Icon name="clock" />{time(next.starts_at)}{next.ends_at ? `–${time(next.ends_at)}` : ''}</span><span><Icon name="pin" />{next.room || next.location || 'Room to be announced'}</span></div><button className="text-button" onClick={() => navigate('home', {
          session: String(next.step_id)
        })}>View details →</button></section>}<div className="section-heading"><h2>Quick access</h2><button className="text-button" onClick={() => navigate('more')}>All services →</button></div><div className="quick-grid">{quick.map(([id, ic, title], i) => <button className="quick" key={id} onClick={() => openService(id)}><span className={`icon-tile ${['', 'gold', 'lilac', 'blue'][i]}`}><Icon name={ic} /></span>{title}</button>)}</div><div className="section-heading"><h2>From the organizing team</h2><button className="text-button" onClick={() => navigate('inbox')}>See all →</button></div>{hub.announcements?.[0] ? <button className="card announcement" onClick={() => navigate('inbox')}><span className="icon-tile gold"><Icon name="bell" /></span><div><h3>{hub.announcements[0].title}</h3><p>{hub.announcements[0].body}</p></div></button> : <p className="card muted">Organizer announcements will appear here.</p>}</>;
  } else if (route.screen === 'meals') body = <><PageTitle title="What sounds good?" subtitle="Explore the menu and make each meal yours." /><GuestMeals key={selected.id} member={selected} members={members} enabled={!!prominent.find(s => s.id === 'meal')} previewMock={previewMock} onMember={member => navigate('meals', {member}, true)} onSaved={onRetryJourney} partyError={partyError} offline={offline} onHelp={() => navigate('communications')} /></>; else if (route.screen === 'programme') body = <><PageTitle title="Your programme" subtitle={`All times in ${zone}. Find a session, room, speaker or age group.`} />{programmeControl}{!journey && !journeyError ? <p className="card">Loading your programme…</p> : !programVisible ? <p className="card">The programme is not enabled for this event.</p> : <><label className="search"><Icon name="search" /><input type="search" aria-label="Search programme" value={search} onChange={e => setSearch(e.target.value)} placeholder="Find a session or room…" /></label><div className="days">{days.map(d => <button className={`day ${d.date === selectedDay?.date ? 'active' : ''}`} key={d.date} aria-pressed={d.date === selectedDay?.date} onClick={() => navigate('programme', {
          day: d.date
        })}>{d.label || d.date}</button>)}</div><div className="schedule-list">{(selectedDay?.segments || timeline).filter(s => [s.title, s.room, s.speaker, ...(s.age_groups || [])].join(' ').toLowerCase().includes(search.toLowerCase())).map(sessionCard)}</div>{!(selectedDay?.segments || timeline).filter(s => [s.title, s.room, s.speaker, ...(s.age_groups || [])].join(' ').toLowerCase().includes(search.toLowerCase())).length && <p className="empty">No sessions match this day and search. Choose All programmes to explore other groups.</p>}<p className="notice">The timetable does not grant admission to restricted sessions.</p></>}</>;else if (route.screen === 'pass') body = <><PageTitle title="My pass" subtitle="Show your personal pass at check-in." />{partyError && <p role="status" className="notice">{partyError}</p>}<label htmlFor="app-member">Choose an authorized pass</label><select id="app-member" className="member-select" value={selected.id || ''} onChange={e => navigate('pass', {
      member: e.target.value
    })}>{members.filter(m => m.qr_token).map(m => <option key={m.id} value={m.id}>{m.name}{m.is_self ? ' · You' : ''}</option>)}</select><div className="pass-card"><div className="pass-top"><span className="eyebrow">{event.organization_name || 'YOUR EVENT'}</span><h2>{event.name}</h2><small>{date(event.event_date)}</small></div><div className="pass-body"><h2>{selected.name || guest.name}</h2>{selected.qr_token ? <img className="app-pass-qr" src={previewMock ? previewQr : `/api/scan/${encodeURIComponent(selected.qr_token)}/qr.png`} alt={`QR pass for ${selected.name}`} /> : <p>Your pass becomes available after confirmation.</p>}<span className="status">{previewMock ? "PREVIEW ONLY" : status(selected)}</span><div className="pass-details"><div><small>PASS HOLDER</small>{selected.name}</div><div><small>ACCESS</small>{selected.is_junior ? 'Junior attendee' : 'Event attendee'}</div>{selected.table_name && <div><small>{event.seating_term || 'TABLE'}</small>{selected.table_name}</div>}{selected.seat_number && <div><small>{event.seat_term || 'SEAT'}</small>{selected.seat_number}</div>}</div>{selected.is_junior && <div className="notice"><strong>At pickup, show your own pass.</strong><p>The scanner requires the authorized guardian’s credential. This pass identifies {selected.name}.</p>{!guest.is_junior && selected.id !== guest.id && <button className="primary full" onClick={() => navigate('pass', {
            member: guest.id
          })}>Switch to my pass · {guest.name}</button>}</div>}{selected.status_at && <p>Last recorded {date(selected.status_at, {
            dateStyle: 'short',
            timeStyle: 'short'
          })}</p>}<p>Raise your screen brightness before presenting your pass.</p>{selected.qr_token && !previewMock && <a className="secondary full" href={`/scan/${encodeURIComponent(selected.qr_token)}`}>Open full pass & options →</a>}{selected.qr_token && <OfflinePass event={event} member={selected} viewerId={guest.id} previewMock={previewMock} />}</div></div></>;else if (route.screen === 'inbox') body = <><PageTitle title="Your inbox" subtitle="Event updates, things to do and organizer conversations." /><div className="inbox-filters">{['updates', 'actions', 'messages'].map(f => <button key={f} aria-pressed={inboxFilter === f} className={f === inboxFilter ? 'active' : ''} onClick={() => setInboxFilter(f)}>{f[0].toUpperCase() + f.slice(1)}</button>)}</div>{inboxFilter === 'updates' ? hub.announcements?.length ? hub.announcements.map(a => <article className="card app-update" key={a.id}><span className="message-type">Update</span><h3>{a.title}</h3><p>{a.body}</p><small>{date(a.created_at, {
          dateStyle: 'short',
          timeStyle: 'short'
        })}</small></article>) : <p className="empty">No organizer updates yet.</p> : inboxFilter === 'actions' ? actions.length ? actions.map(a => <button className="card announcement" key={a.id} onClick={() => navigate(a.screen)}><Icon name="shield" />{a.title} →</button>) : <p className="empty">Nothing needs your attention right now.</p> : panel('journey-help')}<button className="text-button" onClick={() => navigate('communications')}>Contact the organizer →</button></>;else if (route.screen === 'more') body = <><PageTitle title="Your event essentials" subtitle="Services for your visit, family and community." /><div className="more-grid">{services.map(([id, ic, title, sub]) => <button className="card service" key={id} onClick={() => openService(id)}><span className="icon-tile"><Icon name={ic} /></span><span><strong>{title}</strong><small>{sub}</small></span><Icon name="arrow" /></button>)}</div></>;else if (route.screen === 'party') body = <><PageTitle title="My party" subtitle="Last recorded status, not live location tracking." />{partyError && <p className="notice">{partyError}</p>}<div className="card">{members.map(person)}</div>{party?.as_of && <p className="small muted">Updated {date(party.as_of, {
        dateStyle: 'short',
        timeStyle: 'short'
      })}</p>}{guardianControls?.pending}{guardianControls?.manage}</>;else if (route.screen === 'experience' && !moduleVisible('activity_progress')) body = <p className="card">Forms and consent are not enabled here.</p>;else if (route.screen === 'experience') body = <><PageTitle title="Forms & Consent" subtitle="Forms for you and your family, with your confirmations kept together." /><EventForms key={event.id + ownToken} eventId={event.id} token={ownToken} items={forms} error={formsError} loading={formsLoading} refresh={refreshForms} />{guardianControls?.pending}{journey?.consent?.form && panel('journey-experience')}{(journey?.steps || []).filter(s => !['consent', 'meal_selection', 'session_attendance'].includes(s.type)).map(s => <article className="card app-update" key={s.id}><h3>{s.title}</h3><p>{s.guest_message || s.status}</p>{safeExternal(s.action_url) && <a className="secondary" href={safeExternal(s.action_url)} target="_blank" rel="noopener noreferrer">Open instructions ↗</a>}{s.self_service && s.actionable && !['completed', 'overridden', 'skipped'].includes(s.status) && <button className="primary" disabled={markingStepId === s.id} onClick={() => previewMock ? setServiceNotice("Design preview. No action recorded.") : markStepDone(s.id)}>I’ve completed this</button>}</article>)}</>;else if (route.screen === 'communications') body = <><PageTitle title="Contact the organizer" />{panel('journey-help')}</>;else if (route.screen === 'feedback') body = <><PageTitle title="Share your experience" />{panel('feedback')}</>;else if (route.screen === 'resources') body = <><PageTitle title="Resources & certificates" />{panel('journey-resources')}</>;else if (route.screen === 'venue') body = <><PageTitle title="Venue & travel" /><Venue event={event} designTheme={designTheme} /></>;else body = <><PageTitle title="Your registration" /><div className="card"><h2>{guest.name}</h2><p>{guest.rsvp_status || status(guest)}</p><button className="text-button" onClick={() => navigate('communications')}>Ask the organizer to update your details →</button></div></>;
  return <div className="fh-event-app" style={theme}><div className="app"><aside className="sidebar"><div className="wordmark">GuestHub<small>FESTIO EVENT COMPANION</small></div><nav className="side-nav" aria-label="GuestHub">{navItems()}</nav><div className="side-bottom"><b>{event.name}</b><p>Your event, together.</p><button onClick={() => navigate('communications')}>Need a hand? →</button></div></aside><div className="main-shell"><header className="topbar"><div className="event-mark">{event.logo_url ? <img src={event.logo_url} alt="" /> : (event.name || 'E').split(' ').map(n => n[0]).slice(0, 2).join('')}</div><div><div className="event-name">{event.name}</div><div className="event-sub">{date(event.event_date)} · {event.venue_name}</div></div><div className="top-actions"><button className="icon-button" onClick={() => navigate('inbox')} aria-label="Open inbox"><Icon name="bell" /></button></div></header>{prominent.length > 0 && <nav className="service-nav" aria-label="Event services">{prominent.map(s => s.href ? <a key={s.id} className="app-service-link" href={s.href} aria-current={s.id === 'meal' && route.screen === 'meals' ? 'page' : undefined} onClick={s.id === 'meal' ? e => { e.preventDefault(); navigate('meals', {member: selected.id}); } : undefined}><span className={`icon-tile ${s.id === 'chat' ? 'lilac' : s.id === 'meal' ? 'gold' : 'blue'}`}><Icon name={s.icon} /></span>{s.title}<Icon name="arrow" /></a> : <button key={s.id} onClick={() => setServiceNotice(previewMock ? `${s.title} preview. No live service opened.` : `${s.title} is enabled. Your guest access is not available yet; contact the organizer.`)}><Icon name={s.icon} />{s.title}</button>)}</nav>}<div className={`workspace ${route.screen === 'meals' ? 'workspace-meals' : route.screen === 'experience' ? 'workspace-forms' : ''}`}><main id="guest-hub" ref={contentRef} tabIndex={-1} className="content">{offline && <p role="status" className="notice">You’re offline. Displayed status may be out of date; actions need a connection.</p>}{journeyError && <div role="status" className="notice"><p>{journeyError}</p><button className="text-button" onClick={onRetryJourney}>Retry event services</button></div>}{(error || serviceNotice) && <p role="status" className="notice">{serviceNotice || error}</p>}{!nav.some(([id]) => id === route.screen) && <button className="text-button" onClick={() => route.screen === 'meals' ? (history.state?.festioFrom && history.state.festioFrom !== 'meals' ? history.back() : navigate('home')) : navigate('more')}>{route.screen === 'meals' ? '← Back to GuestHub' : '← Event essentials'}</button>}{body}</main><aside className="context"><div className="card"><div className="date-art"><span className="eyebrow">YOUR EVENT</span><strong>{date(event.event_date)}</strong>{event.event_end_date && <small>through {date(event.event_end_date)}</small>}</div><h3>Your convention</h3><p>{event.venue_name}</p><p className="small">Programme times: {zone}</p><button className="text-button" onClick={() => navigate('venue')}>Venue & travel details →</button></div>{hub && <div className="card"><h3>Your party · {members.length}</h3>{members.slice(0, 3).map(person)}<button className="text-button" onClick={() => navigate('party')}>View party & guardian details →</button></div>}<div className="card help-card"><h3>Need help?</h3><p>Your pass, programme and organizer updates stay together here.</p><button className="text-button" onClick={() => navigate('communications')}>Contact the organizer →</button></div></aside></div></div><nav className="bottom-nav" aria-label="GuestHub mobile">{navItems()}</nav></div><dialog ref={detailRef} onCancel={e => {
      e.preventDefault();
      closeSession();
    }} aria-labelledby="app-session-title"><div className="dialog-head"><h2 id="app-session-title">{selectedSession?.title}</h2><button className="icon-button" onClick={closeSession} aria-label="Close session">×</button></div>{selectedSession && <div className="dialog-body"><p>{date(selectedSession.starts_at, {
            dateStyle: 'medium',
            timeStyle: 'short'
          })} · {zone}</p><p>{selectedSession.room || selectedSession.location || 'Room to be announced'}</p>{selectedSession.speaker && <p>{selectedSession.speaker}</p>}<p>{selectedSession.description}</p><p>{selectedSession.age_groups?.join(', ')}</p><p className="notice">Entry follows your pass eligibility and the event’s rules.</p></div>}</dialog></div>;
}
function PageTitle({
  title,
  subtitle
}) {
  return <div className="page-head"><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>;
}
function Venue({
  event,
  designTheme
}) {
  const hotel = safeExternal(designTheme?.wording?.hotelBookingUrl);
  return <div className="card"><h2>{event.venue_name || 'Venue to be announced'}</h2><p>{event.venue_address}</p>{(event.venue_address || event.venue_name) && <a className="secondary" target="_blank" rel="noopener noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([event.venue_name, event.venue_address].filter(Boolean).join(', '))}`}>Open directions ↗</a>}{hotel && <a className="primary" href={hotel} target="_blank" rel="noopener noreferrer">{designTheme.wording.hotelBookingLabel || 'Book your hotel'} ↗</a>}</div>;
}
function OfflinePass() {
  return <div className="pass-offline"><strong>Offline copy not prepared</strong><p>Open your pass while connected. Offline saving is not enabled for this layout yet.</p></div>;
}
