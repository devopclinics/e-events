import RedesignShell, { Icon } from './redesign/RedesignShell'
import './LayoutOptionsPage.css'

const tables = [
  ['VIP 1', 9, 10, 'VIP'], ['VIP 2', 10, 10, 'VIP'], ['Family 12', 6, 10, 'Family'],
  ['Family 13', 0, 10, 'Family'], ['Staff 1', 4, 8, 'Staff'], ['Overflow 1', 0, 10, 'Overflow'],
]
const people = ['Mubah Creativity', 'Al-Azeemah Schools', 'Onamurami', 'Muhammed Oladipupo', 'Ola Ola']

function MiniTable({ name, used, capacity, group }) {
  return <div className="lo-table-card"><div><strong>{name}</strong><span>{group}</span></div><b>{used}/{capacity}</b><i><em style={{ width: `${used / capacity * 100}%` }}/></i></div>
}

function SeatingOptions() {
  return <section><div className="lo-section-head"><span>01</span><div><h2>Seating arrangements</h2><p>Three ways to replace the long spreadsheet while keeping fast event-day operations.</p></div></div>
    <div className="lo-options">
      <article className="lo-option"><header><b>A · Table command cards</b><span>Recommended</span></header><p>Best for setup and everyday table management.</p><div className="lo-toolbar"><button>All groups</button><button>Search tables…</button><strong>+ Table</strong></div><div className="lo-card-grid">{tables.map((t) => <MiniTable key={t[0]} name={t[0]} used={t[1]} capacity={t[2]} group={t[3]}/>)}</div><footer>Drag cards to change table order · click a card to edit inline</footer></article>
      <article className="lo-option"><header><b>B · Visual floor planner</b><span>Room-first</span></header><p>Best when table location matters as much as assignment.</p><div className="lo-three"><aside><strong>Groups</strong>{['VIP', 'Family', 'Staff', 'Overflow'].map((x) => <button key={x}>{x}<small>12</small></button>)}</aside><main className="lo-room">{tables.slice(0,5).map((t) => <div key={t[0]} className="lo-round"><b>{t[0]}</b><small>{t[1]}/{t[2]}</small></div>)}</main><aside><strong>Unassigned</strong>{['Aminah O.', 'Maryam F.', 'Ibrahim A.'].map((x) => <button key={x}>{x}<small>+</small></button>)}</aside></div><footer>Drag guests or tables · capacity warnings stay visible</footer></article>
      <article className="lo-option"><header><b>C · Operations split view</b><span>Event day</span></header><p>Best for assigning arrivals quickly without losing context.</p><div className="lo-split"><aside>{tables.slice(0,4).map((t, i) => <button className={i === 0 ? 'on' : ''} key={t[0]}><strong>{t[0]}</strong><small>{t[1]}/{t[2]}</small></button>)}</aside><main><h4>VIP 1 · seats</h4><div className="lo-seats">{Array.from({length:10}, (_, i) => <span className={i < 9 ? 'filled' : ''} key={i}>{i + 1}</span>)}</div></main><aside><strong>Guest queue</strong>{['Alhaja Bushrah', 'Dr Madinah', 'Mrs Rose'].map((x) => <button key={x}>{x}<small>Assign</small></button>)}</aside></div><footer>Selected table, seat map, and unassigned queue in one screen</footer></article>
    </div>
  </section>
}

function TeamOptions() {
  return <section><div className="lo-section-head"><span>02</span><div><h2>Team-management arrangements</h2><p>Three modern directions that separate people, permissions, and operations.</p></div></div>
    <div className="lo-options">
      <article className="lo-option"><header><b>A · Team directory</b><span>Recommended</span></header><p>Clean member cards with role presets and focused actions.</p><div className="lo-toolbar"><button>Search team…</button><button>All roles</button><strong>+ Invite teammate</strong></div><div className="lo-people">{people.slice(0,4).map((x,i) => <div key={x}><span>{x.slice(0,2).toUpperCase()}</span><strong>{x}<small>{i ? 'Event staff' : 'Administrator'}</small></strong><em>{i ? 'Staff' : 'Admin'}</em><button>•••</button></div>)}</div><footer>Open a member to edit permissions in a side drawer</footer></article>
      <article className="lo-option"><header><b>B · Operations roster</b><span>Event readiness</span></header><p>Organizes staff around assignments, sections, and readiness.</p><div className="lo-stats"><b>5<small>Team</small></b><b>4<small>Ready</small></b><b>3<small>Sections covered</small></b></div><div className="lo-roster">{people.slice(0,4).map((x,i) => <div key={x}><span>{x.slice(0,2).toUpperCase()}</span><strong>{x}<small>{['Check-in lead','VIP seating','Family seating','Floor support'][i]}</small></strong><em className={i===3?'warn':''}>{i===3?'Needs access':'Ready'}</em></div>)}</div><footer>Highlights coverage gaps before the event begins</footer></article>
      <article className="lo-option"><header><b>C · Role & access studio</b><span>Permission clarity</span></header><p>Preset-first permissions without the spreadsheet appearance.</p><div className="lo-role-layout"><aside>{['Event Admin','Check-in Lead','Seating Host','Kitchen Staff'].map((x,i)=><button className={i===2?'on':''} key={x}>{x}<small>{i+1} member</small></button>)}</aside><main><h4>Seating Host</h4><p>Can help guests find and change seats.</p>{['View guests','Manage seating','Scan guests','View dashboard'].map((x,i)=><label key={x}><input type="checkbox" checked={i<2} readOnly/>{x}</label>)}<button className="lo-save">Save role</button></main></div><footer>Assign a preset to members; customize only when needed</footer></article>
    </div>
  </section>
}

export default function LayoutOptionsPage() {
  return <RedesignShell topActive="setup" withEventSidebar={false} eventScoped>
    <div className="lo-hero"><div><span className="rr-pill live"><i/> Design review</span><h1>Seating &amp; team layout options</h1><p>Theme-matched concepts for the next implementation pass. These are visual comparisons only; no event data is changed here.</p></div><a className="rr-btn secondary" href="/addons-redesign?tab=seating"><Icon name="arrow" size={14}/> Back to event setup</a></div>
    <SeatingOptions/>
    <TeamOptions/>
  </RedesignShell>
}
