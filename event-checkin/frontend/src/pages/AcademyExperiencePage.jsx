import { useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import AcademyExperience from '../components/academy/AcademyExperience'
import { ACADEMY_MODES } from '../components/academy/academyExperience.mjs'
export default function AcademyExperiencePage() {
  const { token } = useParams(), [params, setParams] = useSearchParams(), root = useRef(null)
  const [error, setError] = useState('')
  const requested = params.get('mode'), mode = ACADEMY_MODES.some(([id]) => id === requested) ? requested : 'vision'
  async function fullscreen() { try { await root.current.requestFullscreen(); setError('') } catch { setError('Use your browser fullscreen controls to fill this screen.') } }
  return <main className="ma-experience-page" ref={root}><header className="ma-view-toolbar"><a href={`/give/${encodeURIComponent(token)}`}>Mumineen Academy · Giving page ↗</a><nav aria-label="Presentation mode">{ACADEMY_MODES.map(([id, label]) => <button key={id} type="button" aria-pressed={mode === id} onClick={() => setParams({ mode: id }, { replace: true })}>{label}</button>)}</nav><button type="button" onClick={fullscreen}>Fullscreen ↗</button></header><div className="ma-page-canvas"><AcademyExperience key={`${token}-${mode}`} token={token} mode={mode} controls/></div><p className="ma-mobile-note">A widescreen experience for TVs and projectors. Turn your phone sideways for a closer look. Totals reflect the actual campaign; campus imagery is illustrative.</p>{error && <p role="status" className="ma-mobile-note">{error}</p>}</main>
}
