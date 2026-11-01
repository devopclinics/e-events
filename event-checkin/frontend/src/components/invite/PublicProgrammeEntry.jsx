import { useEffect, useState } from 'react'

// A shared RSVP URL has no guest credential. Only the already-published
// website is public; the personal timetable and pass still require recovery.
export default function PublicProgrammeEntry({ event }) {
  const [loading, setLoading] = useState(true)
  const [retry, setRetry] = useState(0)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setFailed(false)
    fetch(`/site/event/${encodeURIComponent(event.id)}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        if (response.status === 404) return null
        if (!response.ok) throw new Error('Website unavailable')
        return response.json()
      })
      .then(data => {
        if (controller.signal.aborted) return
        if (/^\/site\/[A-Za-z0-9_-]+$/.test(data?.url || '')) {
          window.location.replace(`${data.url}#programme`)
        } else setLoading(false)
      })
      .catch(() => { if (!controller.signal.aborted) { setLoading(false); setFailed(true) } })
    return () => controller.abort()
  }, [event.id, retry])
  const recovery = `${window.location.pathname}?recover=1&destination=programme`
  return <main className="min-h-screen bg-stone-50 px-5 py-14 text-slate-900">
    <section className="mx-auto max-w-lg rounded-3xl border border-stone-200 bg-white p-8 shadow-sm">
      <p className="text-sm font-semibold text-slate-600">{event.name}</p>
      <h1 className="mt-3 text-3xl font-bold">Your event programme</h1>
      <p className="mt-4" role="status">{loading ? 'Opening the published programme…' : failed ? 'The published programme could not load. Try again or open your personal GuestHub.' : 'A public programme has not been published yet. Registered guests can open their personal GuestHub.'}</p>
      {failed && <button className="mt-5 rounded-xl border px-4 py-3 font-semibold" onClick={() => setRetry(value => value + 1)}>Try again</button>}
      <a className="mt-6 block rounded-xl bg-slate-900 px-5 py-3 text-center font-semibold text-white" href={recovery}>Already registered? Open my GuestHub</a>
      <a className="mt-4 block text-center text-sm underline" href={window.location.pathname}>Event details & registration</a>
    </section>
  </main>
}
