import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'
import { toPublicTheme, writeDraftPreview } from '../components/design-studio/model.mjs'

// A bookmarkable entry to an authorized event's saved RSVP draft. Each visit
// creates a new short-lived, read-only snapshot; public registration stays off.
export default function EventRsvpPreviewPage() {
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
