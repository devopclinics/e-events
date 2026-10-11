// Each format uses the same event data and existing registration callbacks.
// Artwork is optional; its absence never reveals unpublished website content.
export default function RsvpFormatHero({ format, title, dateLabel, timeLabel, venueLabel,
  host, about, config, cover, coverPresentation, registerLabel, deadline, onRegister, onMore, Icon }) {
  const intro = <div className="rf-intro">{config.hero?.showHost !== false && <span className="rw-eyebrow">{host || 'YOU’RE INVITED'}</span>}{config.hero?.showTitle !== false && <h1>{title}</h1>}{config.about?.show !== false && about && <p className="rw-lead">{about}</p>}</div>;
  const facts = <div className="rw-facts rf-facts"><div><Icon name="calendar"/><span><small>Event date</small>{dateLabel}{timeLabel && <small>{timeLabel}</small>}</span></div>{venueLabel && <div><Icon name="pin"/><span><small>Venue</small>{venueLabel}</span></div>}</div>;
  const actions = <div className="rf-actions"><div className="rw-hero-actions"><button className="rw-btn" onClick={onRegister}>{registerLabel}</button><button className="rw-text" onClick={onMore}>Explore the event ↓</button></div>{deadline && <p className="rw-compact-deadline">RSVP deadline: {deadline}</p>}</div>;
  const artwork = cover ? <img className="rf-artwork" src={cover} alt={coverPresentation.alt} style={coverPresentation.style}/> : <div className="rf-artwork rf-artwork-empty" aria-hidden="true"><span className="rf-artwork-shape"/><span className="rf-artwork-monogram">{title.split(/\s+/).slice(0, 2).map(w => w[0]).join('')}</span></div>;
  if (format === 'editorial') return <section className="rw-hero rf-hero rf-editorial"><div className="rf-copy">{intro}{facts}{actions}</div>{artwork}</section>;
  if (format === 'spotlight') return <section className="rw-hero rf-hero rf-spotlight">{artwork}<div className="rf-poster-panel">{intro}{facts}{actions}</div></section>;
  if (format === 'invitation') return <section className="rw-hero rf-hero rf-invitation"><div className="rf-invitation-frame"><span className="rf-seal" aria-hidden="true">{title.slice(0,1)}</span>{intro}{facts}{actions}{cover && artwork}</div></section>;
  if (format === 'briefing') return <section className="rw-hero rf-hero rf-briefing"><aside className="rf-brief-rail"><span className="rw-eyebrow">EVENT AT A GLANCE</span>{facts}{actions}</aside><div className="rf-brief-story">{intro}{cover && artwork}</div></section>;
  return <section className="rw-hero rf-hero rf-festival"><div className="rf-festival-title">{intro}{actions}</div><div className="rf-festival-image">{artwork}</div><div className="rf-festival-facts">{facts}</div></section>;
}
