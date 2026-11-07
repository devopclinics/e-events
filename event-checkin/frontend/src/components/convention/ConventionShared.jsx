import './ConventionReview.css'
export const safe = value => { try { const u = new URL(value, window.location.origin); return ['http:', 'https:'].includes(u.protocol) ? u.href : '' } catch { return '' } }
export function Brand({ config, event }) { return <div className="cr-brand">{safe(event.logo_url) && <img src={safe(event.logo_url)} alt="IEDPU USA" />}<div><b>{config.organizer || 'IEDPU USA'}</b><small>{config.edition || 'DALLAS ’26'}</small></div></div> }
export function ConceptVisual({config,kind}) {
 const boxes={skyline:'600 130 486 340',sightseeing:'31 484 328 226',seminar:'383 484 323 226',celebration:'733 484 323 226',gala:'534 1055 550 231'}
 const url=safe(config.artworkUrl)
 return url ? <figure className={`cr-concept cr-concept-${kind}`}><svg viewBox={boxes[kind]} preserveAspectRatio="xMidYMid slice" role="img" aria-label={`${kind} · generated promotional imagery`}><image href={url} width="1086" height="1448"/></svg><figcaption>Generated promotional imagery · staging review</figcaption></figure> : null
}
export function Footer() { return <footer className="cr-footer">IEDPU USA · Unity · Heritage · Progress<span>Powered by Festio · <a href="https://festio.events/create-invitation?share=invite">Create your free event</a></span></footer> }

