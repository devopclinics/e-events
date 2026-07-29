import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api'

const STATUS_LABEL = {
  confirmed: 'You’re going',
  declined: 'You declined',
  waitlisted: 'Waitlisted',
  invited: 'Invited',
}

// Public, no-auth curated event listing (Gatsby-parity "Event Calendars"
// feature). One route handles both public (share_token) and private
// (per-contact CalendarAccess token) links — the backend resolves either.
// Clicking an event goes to that event's own real RSVP page; this page only
// curates which events are shown and to whom.
export default function CalendarPage() {
  const { token } = useParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api.resolveCalendar(token)
      .then(setData)
      .catch((e) => setError(e.message || 'Calendar not found'))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) return <div className="min-h-screen grid place-items-center text-slate-400">Loading…</div>
  if (error) return (
    <div className="min-h-screen grid place-items-center px-4">
      <div className="text-center"><div className="text-4xl mb-3">📅</div><p className="text-slate-600">{error}</p></div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900">
      <div className="max-w-2xl mx-auto px-4 py-10">
        <div className="text-center mb-8">
          {data.logo_url && (
            <img src={data.logo_url} alt="" style={{ width: data.logo_width || 160 }} className="mx-auto mb-4" />
          )}
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{data.title}</h1>
          {data.description && <p className="text-sm text-gray-500 dark:text-slate-400 mt-2">{data.description}</p>}
          {data.contact && (
            <p className="text-xs text-gray-400 dark:text-slate-500 mt-3">
              Hi {data.contact.first_name} — events you register for below use {data.contact.email}.
            </p>
          )}
        </div>

        {data.events.length === 0 ? (
          <p className="text-center text-sm text-gray-400 dark:text-slate-500">No upcoming events right now — check back soon.</p>
        ) : (
          <div className="space-y-4">
            {data.events.map((ev) => (
              <a key={ev.id} href={ev.register_url}
                className="block bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow hover:shadow-md transition-shadow overflow-hidden">
                {ev.invite_cover_image && (
                  <img src={ev.invite_cover_image} alt="" className="w-full h-40 object-cover" />
                )}
                <div className="p-4 space-y-1">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <h2 className="font-semibold text-gray-900 dark:text-white">{ev.name}</h2>
                    {ev.rsvp_status && (
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300">
                        {STATUS_LABEL[ev.rsvp_status] || ev.rsvp_status}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500 dark:text-slate-400">
                    {new Date(ev.event_date).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                  </p>
                  {ev.invite_message && <p className="text-sm text-gray-600 dark:text-slate-300 line-clamp-2">{ev.invite_message}</p>}
                  <p className="text-sm text-indigo-600 dark:text-indigo-400 font-semibold pt-1">
                    {ev.rsvp_status ? 'View / edit your RSVP →' : 'Register →'}
                  </p>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
