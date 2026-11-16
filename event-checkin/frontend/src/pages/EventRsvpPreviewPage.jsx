import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'
import ProtectedRoute from '../components/ProtectedRoute'
import { toPublicTheme, writeDraftPreview } from '../components/design-studio/model.mjs'

// A bookmarkable entry to an authorized event's saved RSVP draft. Each visit
// creates a new short-lived, read-only snapshot; public registration stays off.
function SavedDraftPreview() {
  const { eventId } = useParams()
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    setError('')
    Promise.all([api.listEvents(), api.getEventDesign(eventId), api.designTemplates()])
      .then(([events, design, catalog]) => {
        if (cancelled) return
        const event = events.find(row => row.id === eventId)
        if (!event) throw new Error('This event is unavailable to your account.')
        if (event.status === 'active' && event.rsvp_enabled && event.rsvp_token && design.is_published) {
          window.location.replace(`/rsvp/${encodeURIComponent(event.rsvp_token)}`)
          return
        }
        const key = crypto.randomUUID()
        writeDraftPreview(key, eventId, toPublicTheme(design, catalog.templates || catalog || [], eventId), event)
        window.location.replace(`/invite/${encodeURIComponent(eventId)}?studio-preview=1&studio-key=${key}&studio-surface=rsvp`)
      })
      .catch(failure => { if (!cancelled) setError(failure.message || 'The RSVP preview could not be opened.') })
    return () => { cancelled = true }
  }, [eventId])

  return <main className="min-h-screen bg-slate-50 p-8 text-slate-900">
    <section className="mx-auto max-w-lg rounded-2xl border bg-white p-6">
      <h1 className="text-2xl font-bold">RSVP page preview</h1>
      {error ? <p role="alert" className="my-4">{error}</p> : <p role="status" className="my-4">Opening your saved RSVP design…</p>}
      <Link to="/events-redesign" className="font-semibold underline">Back to events</Link>
    </section>
  </main>
}


// Previously shared event links must take guests to registration once live.
// Unpublished drafts still pass through the existing organizer sign-in guard.
export default function EventRsvpPreviewPage() {
  const { eventId } = useParams()
  const [draft, setDraft] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    setDraft(false); setError('')
    fetch(`/api/invite/${encodeURIComponent(eventId)}`, {cache:'no-store',signal:controller.signal})
      .then(async response => {
        if (response.ok) {
          const event = await response.json()
          if (event.rsvp_enabled && event.rsvp_token) {
            window.location.replace(`/rsvp/${encodeURIComponent(event.rsvp_token)}`)
            return
          }
        } else if (![404,410].includes(response.status)) throw new Error('The RSVP page is temporarily unavailable. Please try again.')
        if (!controller.signal.aborted) setDraft(true)
      })
      .catch(failure => { if (!controller.signal.aborted) setError(failure.message) })
    return () => controller.abort()
  }, [eventId])
  if (draft) return <ProtectedRoute adminOnly><SavedDraftPreview /></ProtectedRoute>
  return <main className="min-h-screen bg-slate-50 p-8 text-slate-900"><p role={error?'alert':'status'}>{error || 'Opening the RSVP page…'}</p></main>
}
