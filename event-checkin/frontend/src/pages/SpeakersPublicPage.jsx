import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api'

const PLATFORM_ICON = { LinkedIn: '💼', 'Twitter/X': '𝕏', Instagram: '📷', Website: '🔗' }

// Public, no-auth guest speaker showcase — read-only, no guest interaction.
export default function SpeakersPublicPage() {
  const { token } = useParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api.getSpeakerPage(token).then(setData).catch((e) => setError(e.message || 'Speaker page not found')).finally(() => setLoading(false))
  }, [token])

  if (loading) return <div className="min-h-screen grid place-items-center text-slate-400">Loading…</div>
  if (error) return (
    <div className="min-h-screen grid place-items-center px-4">
      <div className="text-center"><div className="text-4xl mb-3">🎤</div><p className="text-slate-600">{error}</p></div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50 to-white text-slate-900 py-10 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-10">
          <div className="text-4xl mb-2">🎤</div>
          <h1 className="text-3xl font-bold">Meet Our Guest Speakers</h1>
          <p className="text-slate-500 mt-2">{data.event_name}</p>
        </div>

        {data.speakers.length === 0 ? (
          <p className="text-center text-slate-400">Speakers are being announced — check back soon.</p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {data.speakers.map((s) => (
              <div key={s.id} className="bg-white border border-slate-200 rounded-xl p-5 text-center shadow-sm">
                {s.photo_url
                  ? <img src={s.photo_url} alt="" className="w-20 h-20 rounded-full object-cover mx-auto mb-3" />
                  : <div className="w-20 h-20 rounded-full bg-slate-100 grid place-items-center text-2xl mx-auto mb-3">🎤</div>}
                <div className="font-semibold">{s.name}</div>
                {s.title && <div className="text-xs text-slate-500 mt-0.5">{s.title}</div>}
                {s.bio && <p className="text-xs text-slate-500 mt-2 leading-relaxed">{s.bio}</p>}
                {s.social_links.length > 0 && (
                  <div className="flex justify-center gap-2 mt-3">
                    {s.social_links.map((l, i) => (
                      <a key={i} href={l.url} target="_blank" rel="noreferrer"
                        className="w-8 h-8 rounded-full bg-slate-100 grid place-items-center text-sm hover:bg-slate-200"
                        title={l.platform}>
                        {PLATFORM_ICON[l.platform] || '🔗'}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-slate-400 text-center mt-10">Powered by Festio</p>
      </div>
    </div>
  )
}
