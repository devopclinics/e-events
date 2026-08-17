// Shared Speaker Showcase rendering — one card component, three call sites
// (SpeakersPublicPage.jsx, PublicTicketsPage.jsx's carousel, FestioHub's
// Speakers tab uses its own themed variant but the same api.getSpeakerPage
// call). Keeping this in one place is the point: three independent
// implementations of "what a speaker card looks like" is how they'd quietly
// drift apart.

const PLATFORM_ICON = { LinkedIn: '💼', 'Twitter/X': '𝕏', Instagram: '📷', Website: '🔗' }

export function SpeakerCard({ speaker, compact = false }) {
  const size = compact ? 56 : 80
  return (
    <div className={`bg-white border border-slate-200 rounded-xl text-center shadow-sm ${compact ? 'p-4' : 'p-5'}`}>
      {speaker.photo_url
        ? <img src={speaker.photo_url} alt="" className="rounded-full object-cover mx-auto mb-3" style={{ width: size, height: size }} />
        : <div className="rounded-full bg-slate-100 grid place-items-center text-2xl mx-auto mb-3" style={{ width: size, height: size }}>🎤</div>}
      <div className="font-semibold text-sm">{speaker.name}</div>
      {speaker.title && <div className="text-xs text-slate-500 mt-0.5">{speaker.title}</div>}
      {!compact && speaker.bio && <p className="text-xs text-slate-500 mt-2 leading-relaxed">{speaker.bio}</p>}
      {speaker.social_links?.length > 0 && (
        <div className="flex justify-center gap-2 mt-3">
          {speaker.social_links.map((l, i) => (
            <a key={i} href={l.url} target="_blank" rel="noreferrer"
              className="w-8 h-8 rounded-full bg-slate-100 grid place-items-center text-sm hover:bg-slate-200"
              title={l.platform}>
              {PLATFORM_ICON[l.platform] || '🔗'}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

export function SpeakerGrid({ speakers }) {
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
      {speakers.map((s) => <SpeakerCard key={s.id} speaker={s} />)}
    </div>
  )
}

// Horizontally-scrollable — the ticketing page's whole point is to show the
// full lineup in place, no click-through, no "view all" pagination gate.
export function SpeakerCarousel({ speakers }) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-2" style={{ scrollSnapType: 'x mandatory' }}>
      {speakers.map((s) => (
        <div key={s.id} style={{ flex: '0 0 160px', scrollSnapAlign: 'start' }}>
          <SpeakerCard speaker={s} compact />
        </div>
      ))}
    </div>
  )
}
