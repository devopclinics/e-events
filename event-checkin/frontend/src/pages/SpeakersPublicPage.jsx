import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api'
import { SpeakerGrid } from '../components/SpeakerShowcase'

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
          <SpeakerGrid speakers={data.speakers} />
        )}

        <p className="text-xs text-slate-400 text-center mt-10">Powered by Festio</p>
      </div>
    </div>
  )
}
