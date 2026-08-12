import { Link } from 'react-router-dom'
import RedesignShell from './redesign/RedesignShell'
import ConsolePage from './ConsolePage'
import './SuperadminRedesignPage.css'

// ConsolePage owns the real API contracts for every console section.
// Media Library used to live behind a ?tab=media punt to legacy — it now has
// its own real redesign page (MediaRedesignPage) linked directly below.
export default function SuperadminRedesignPage() {
  return (
    <RedesignShell topActive="console" withEventSidebar={false}>
      <div className="rr-pagehead">
        <div>
          <div className="rr-title-row"><h1>Superadmin</h1><span className="rr-pill locked">Platform staff only</span></div>
          <div className="rr-meta">Live platform console</div>
        </div>
      </div>
      <div className="rr-tabs">
        <button className="active">Console</button>
        <Link to="/media-redesign">Media Library</Link>
      </div>
      <ConsolePage />
    </RedesignShell>
  )
}
