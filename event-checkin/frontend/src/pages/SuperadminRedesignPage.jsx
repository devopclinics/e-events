import { useSearchParams } from 'react-router-dom'
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

  // Media library prototype is intentionally disabled — no privileged mutation contract yet.
  return (
    <RedesignShell topActive="media" withEventSidebar={false}>
      <div className="rr-pagehead"><div><div className="rr-title-row"><h1>Media Library</h1></div><div className="rr-meta">Not available in the redesign rollout</div></div></div>
      <div className="rr-panel rd-panel-body">
        <p>The media-library prototype is view-only and is not connected to platform APIs. Use the live Console for supported superadmin operations.</p>
        <button className="rr-btn primary" onClick={() => setParams({ tab: 'console' })}>Open live Console</button>
      </div>
    </RedesignShell>
  )
}
