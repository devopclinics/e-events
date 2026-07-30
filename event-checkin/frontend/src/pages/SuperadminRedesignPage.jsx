import { Navigate, useSearchParams } from 'react-router-dom'
import RedesignShell from './redesign/RedesignShell'
import ConsolePage from './ConsolePage'
import './SuperadminRedesignPage.css'

export default function SuperadminRedesignPage() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'media' ? 'media' : 'console'

  // ConsolePage owns the real API contracts for every console section.
  if (tab === 'console') {
    return (
      <RedesignShell topActive="console" withEventSidebar={false}>
        <div className="rr-pagehead">
          <div>
            <div className="rr-title-row"><h1>Superadmin</h1><span className="rr-pill locked">Platform staff only</span></div>
            <div className="rr-meta">Live platform console</div>
          </div>
        </div>
        <div className="rr-tabs">
          <button className="active" onClick={() => setParams({ tab: 'console' })}>Console</button>
          <button onClick={() => setParams({ tab: 'media' })}>Media Library</button>
        </div>
        <ConsolePage />
      </RedesignShell>
    )
  }

  // The existing media library is the production-backed implementation.
  return <Navigate to="/media-library?ui=legacy" replace />
}
