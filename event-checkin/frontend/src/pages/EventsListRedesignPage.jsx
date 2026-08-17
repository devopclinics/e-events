import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import RedesignShell, { Icon, ConfirmDialog } from './redesign/RedesignShell'
import { EmptyState, ErrorRetryState, LoadingSkeleton } from './redesign/RedesignPrimitives'
import { useCurrentEvent } from '../hooks/useCurrentEvent'
import { api } from '../api'
import './EventsListRedesignPage.css'

const TABS = ['All', 'Draft', 'Active', 'Ended', 'Archived']

function statusOf(tab) {
  return tab === 'All' ? null : tab.toLowerCase()
}

// Reuses the existing rd-status-chip modifier classes (ok/warn/bl-chip-neutral)
// rather than inventing new unstyled ones — same chip component other pages use.
const STATUS_BADGE = { draft: 'warn', active: 'ok', ended: 'bl-chip-neutral', archived: 'bl-chip-neutral' }

export default function EventsListRedesignPage() {
  const navigate = useNavigate()
  const [, setCurrentEventId] = useCurrentEvent()
  const [tab, setTab] = useState('All')
  const [counts, setCounts] = useState({})
  const [events, setEvents] = useState(null)
  const [error, setError] = useState('')
  const [openMenuId, setOpenMenuId] = useState('')
  const [archiveTarget, setArchiveTarget] = useState(null)
  const [busy, setBusy] = useState(false)

  async function loadCounts() {
    try {
      const all = await api.listEvents()
      const next = { All: all.length }
      for (const t of TABS) if (t !== 'All') next[t] = all.filter((e) => e.status === statusOf(t)).length
      setCounts(next)
    } catch { /* counts are a nice-to-have; the list itself has its own error state */ }
  }

  async function load() {
    setError('')
    try { setEvents(await api.listEvents(statusOf(tab))) }
    catch (e) { setError(e.message || 'Events could not be loaded') }
  }

  useEffect(() => { loadCounts() }, [])
  useEffect(() => { setEvents(null); load() }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  function openEvent(event) {
    setCurrentEventId(event.id)
    navigate('/admin-redesign')
  }

  async function archiveEvent(event) {
    setBusy(true)
    try {
      await api.changeStatus(event.id, 'archived', event.updated_at)
      setArchiveTarget(null)
      await Promise.all([load(), loadCounts()])
    } catch (e) {
      setError(e.message || 'Event could not be archived')
    } finally {
      setBusy(false)
    }
  }

  async function unarchiveEvent(event) {
    setBusy(true)
    try {
      await api.changeStatus(event.id, 'draft', event.updated_at)
      await Promise.all([load(), loadCounts()])
    } catch (e) {
      setError(e.message || 'Event could not be unarchived')
    } finally {
      setBusy(false)
    }
  }

  return (
    <RedesignShell topActive="events">
      <div className="rr-pagehead">
        <div><div className="rr-title-row"><h1>Events</h1></div></div>
        <button className="rr-btn primary" onClick={() => navigate('/setup-redesign')}>
          <Icon name="plus" size={14} /> New event
        </button>
      </div>

      <div className="rr-tabs">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t}{counts[t] != null && <span className="ev-tab-count">{counts[t]}</span>}
          </button>
        ))}
      </div>

      {events === null ? (
        <div className="rr-panel"><div className="rd-panel-body"><LoadingSkeleton rows={5} variant="table" /></div></div>
      ) : error ? (
        <div className="rr-panel"><div className="rd-panel-body"><ErrorRetryState message={error} onRetry={load} /></div></div>
      ) : events.length === 0 ? (
        <div className="rr-panel"><div className="rd-panel-body">
          {tab === 'Archived'
            ? <EmptyState icon="calendar" title="No archived events" message="Events you archive will show up here. You can unarchive any of them at any time." />
            : <EmptyState icon="calendar" title="No events" message={tab === 'All' ? 'Create your first event to get started.' : `No ${tab.toLowerCase()} events.`} />}
        </div></div>
      ) : (
        <div className="rr-panel">
          {events.map((event) => (
            <div className="ev-row" key={event.id}>
              <div className="ev-row-icon"><Icon name="calendar" size={16} /></div>
              <div className="ev-row-main">
                <strong>{event.name}</strong>
                <span>{event.event_date ? new Date(event.event_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}{event.venue_name ? ` · ${event.venue_name}` : ''}</span>
              </div>
              <span className={`rd-status-chip ${STATUS_BADGE[event.status] || ''}`}>{event.status}</span>
              <div className="ev-row-menu-wrap">
                <button className="rr-btn secondary ev-row-menu-btn" onClick={() => setOpenMenuId(openMenuId === event.id ? '' : event.id)}>
                  Manage <Icon name="chevrondown" size={11} />
                </button>
                {openMenuId === event.id && (
                  <div className="ev-row-menu">
                    <button onClick={() => { setOpenMenuId(''); openEvent(event) }}>Open</button>
                    {event.status === 'archived'
                      ? <button onClick={() => { setOpenMenuId(''); unarchiveEvent(event) }}>Unarchive</button>
                      : <button className="ev-danger" onClick={() => { setOpenMenuId(''); setArchiveTarget(event) }}>Archive</button>}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {archiveTarget && (
        <ConfirmDialog
          title={`Archive "${archiveTarget.name}"?`}
          message="It'll be hidden from Active/Draft/Ended views. Guest-facing pages (ticketing, FestioHub, RSVP) are unaffected — this only declutters your own event list. You can unarchive it any time."
          danger={false}
          confirmLabel={busy ? 'Archiving…' : 'Archive event'}
          onCancel={() => setArchiveTarget(null)}
          onConfirm={() => archiveEvent(archiveTarget)}
        />
      )}
    </RedesignShell>
  )
}
