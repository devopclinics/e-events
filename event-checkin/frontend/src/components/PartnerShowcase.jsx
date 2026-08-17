// Shared Partner Showcase rendering — see SpeakerShowcase.jsx for why this
// is factored out rather than reimplemented per call site.

export function PartnerCard({ partner, compact = false }) {
  const size = compact ? 40 : 48
  return (
    <a href={partner.website_url || undefined} target={partner.website_url ? '_blank' : undefined} rel="noreferrer"
      className={`bg-white border border-slate-200 rounded-xl flex items-center gap-3 shadow-sm hover:border-amber-300 ${compact ? 'p-3' : 'p-4'}`}>
      {partner.logo_url
        ? <img src={partner.logo_url} alt="" className="rounded-lg object-cover flex-none" style={{ width: size, height: size }} />
        : <div className="rounded-lg bg-slate-100 grid place-items-center flex-none" style={{ width: size, height: size }}>🤝</div>}
      <div className="min-w-0">
        <div className="font-semibold truncate text-sm">{partner.name}</div>
        {partner.category_name && <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-600 mt-0.5">{partner.category_name}</div>}
      </div>
    </a>
  )
}

export function PartnerGrid({ partners }) {
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
      {partners.map((p) => <PartnerCard key={p.id} partner={p} />)}
    </div>
  )
}

// Horizontally-scrollable — same "show the whole lineup in place" intent as
// SpeakerCarousel.
export function PartnerCarousel({ partners }) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-2" style={{ scrollSnapType: 'x mandatory' }}>
      {partners.map((p) => (
        <div key={p.id} style={{ flex: '0 0 220px', scrollSnapAlign: 'start' }}>
          <PartnerCard partner={p} compact />
        </div>
      ))}
    </div>
  )
}
