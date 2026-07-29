import { Navigate } from 'react-router-dom'
import { useCurrentEvent } from '../hooks/useCurrentEvent'
import RedesignShell, { Icon } from './redesign/RedesignShell'
import './FloorPlanRedesignPage.css'

// The floor-plan editor already has a single production implementation with
// authenticated save, paid-feature enforcement, sharing, uploads and PDF export.
// Keep one editor/data contract during the migration; this redesign entry route
// hands off to that implementation for the selected event instead of maintaining
// a second mock canvas that can silently diverge.
export default function FloorPlanRedesignPage() {
  const [eventId] = useCurrentEvent()
  if (eventId) return <Navigate to={`/floorplan-redesign/${encodeURIComponent(eventId)}`} replace />
  return <RedesignShell topActive="setup" withEventSidebar eventActive="seating">
    <div className="fp-page">
      <div className="fp-header"><div><h2>Floor Plan Editor</h2><p className="fp-subtitle">Select an event before opening its floor plan.</p></div></div>
      <div className="rr-panel rd-panel-body"><Icon name="grid" size={24}/><p>No event is currently selected.</p><a className="rr-btn primary" href="/admin-redesign">Choose an event</a></div>
    </div>
  </RedesignShell>
}
