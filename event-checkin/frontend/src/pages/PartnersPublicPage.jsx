import { useState, useEffect, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api'
import { PartnerGrid } from '../components/PartnerShowcase'

// Public, no-auth partner/sponsor showcase — read-only, no guest interaction.
export default function PartnersPublicPage() {
  const { token } = useParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState('')

  useEffect(() => {
    api.getPartnerPage(token).then(setData).catch((e) => setError(e.message || 'Partner page not found')).finally(() => setLoading(false))
  }, [token])

  const filtered = useMemo(() => {
    if (!data) return []
    return data.partners.filter((p) => {
      if (activeCategory && p.category_id !== activeCategory) return false
      if (!query.trim()) return true
      const value = `${p.name} ${p.category_name || ''}`.toLowerCase()
      return value.includes(query.trim().toLowerCase())
    })
  }, [data, query, activeCategory])

  if (loading) return <div className="min-h-screen grid place-items-center text-slate-400">Loading…</div>
  if (error) return (
    <div className="min-h-screen grid place-items-center px-4">
      <div className="text-center"><div className="text-4xl mb-3">🤝</div><p className="text-slate-600">{error}</p></div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50 to-white text-slate-900 py-10 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-8">
          <div className="text-4xl mb-2">🤝</div>
          <h1 className="text-3xl font-bold">Meet Our Partners</h1>
          <p className="text-slate-500 mt-2">{data.event_name}</p>
        </div>

        <div className="max-w-lg mx-auto mb-6">
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
            placeholder="Search partners or categories…" value={query} onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {data.categories.length > 0 && (
          <div className="flex flex-wrap justify-center gap-2 mb-8">
            <button
              className={`rounded-full px-3 py-1.5 text-xs font-semibold border ${!activeCategory ? 'bg-amber-500 text-white border-amber-500' : 'border-slate-300 text-slate-600'}`}
              onClick={() => setActiveCategory('')}>
              All Partners
            </button>
            {data.categories.map((c) => (
              <button key={c.id}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold border ${activeCategory === c.id ? 'bg-amber-500 text-white border-amber-500' : 'border-slate-300 text-slate-600'}`}
                onClick={() => setActiveCategory(c.id)}>
                {c.name}
              </button>
            ))}
          </div>
        )}

        {filtered.length === 0 ? (
          <p className="text-center text-slate-400">
            {data.partners.length === 0 ? 'Partners are being announced — check back soon.' : 'Try another search term or switch to a different category.'}
          </p>
        ) : (
          <PartnerGrid partners={filtered} />
        )}

        <p className="text-xs text-slate-400 text-center mt-10">Powered by Festio</p>
      </div>
    </div>
  )
}
