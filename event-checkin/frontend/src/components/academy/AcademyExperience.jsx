import { useEffect, useRef, useState } from 'react'
import { ACADEMY_ART, ACADEMY_GIVING_TOKEN, academyCampaign, givingMoney, givingProgress } from './academyExperience.mjs'
import './AcademyExperience.css'

export function AcademyMark({ logo }) {
  return <div className="ma-mark">{logo ? <img src={logo} alt="Mumineen Academy"/> : <span aria-hidden="true">M</span>}<div><b>Mumineen Academy</b><small>A future we build together</small></div></div>
}
export function AcademyVisionLink({ token }) {
  return <figure className="ma-vision-link"><img src={ACADEMY_ART} alt="Illustrative architectural concept of a welcoming school campus"/><a href={`/give/${encodeURIComponent(token)}/experience?mode=vision`}>Explore the vision <span aria-hidden="true">↗</span></a><figcaption>Illustrative architecture · Not approved building plans</figcaption></figure>
}

// Public projector surfaces use only the privacy-filtered public campaign API.
// Never seed them from the organizer's contribution ledger or demo fixtures.
export function useGivingCampaign(token) {
  const [state, setState] = useState({ campaign: null, error: '', updatedAt: null })
  useEffect(() => {
    let active = true, timer, controller
    setState({ campaign: null, error: '', updatedAt: null })
    async function load() {
      controller = new AbortController()
      try {
        const response = await fetch(`/api/give/${encodeURIComponent(token)}`, { signal: controller.signal, cache: 'no-store' })
        if (!response.ok) throw Object.assign(new Error('Giving campaign unavailable'), { status: response.status })
        const campaign = await response.json()
        if (active) setState({ campaign, error: '', updatedAt: Date.now() })
      } catch (error) {
        if (!active || error.name === 'AbortError') return
        setState(current => ({ campaign: [404, 410, 403].includes(error.status) ? null : current.campaign, error: [404, 410, 403].includes(error.status) ? 'Giving campaign unavailable.' : current.campaign ? 'Updates interrupted · showing last received totals' : 'Unable to load the giving campaign. Retrying…', updatedAt: current.updatedAt }))
      } finally { if (active) timer = setTimeout(load, 5000) }
    }
    load()
    return () => { active = false; clearTimeout(timer); controller?.abort() }
  }, [token])
  return state
}

const STORY = [
  { label: '01 / Imagine', title: <>A place to learn.<br/>A future to<br/><em>believe in.</em></>, description: 'Imagine what we can build when a community comes together for its children.' },
  { label: '02 / Belong', title: <>More than classrooms.<br/>A place to <em>belong.</em></>, description: 'A welcoming environment for curious minds, strong values, and lifelong friendships.' },
  { label: '03 / Build', title: <>Their next chapter.<br/>Our shared <em>legacy.</em></>, description: 'Generosity becomes a possibility our children can grow into.' },
]
function Vision({ campaign, token, controls }) {
  const [scene, setScene] = useState(0), [playing, setPlaying] = useState(!controls)
  useEffect(() => {
    if (!playing || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined
    const timer = setInterval(() => setScene(value => (value + 1) % STORY.length), 7000)
    return () => clearInterval(timer)
  }, [playing])
  return <div className={`ma-scene ma-vision ma-scene-${scene}`}><img className="ma-campus" src={ACADEMY_ART} alt="Illustrative school campus concept"/>
    <header><AcademyMark logo={campaign.logo_url}/><span className="ma-live-label">THE VISION · MUMINEEN ACADEMY</span></header>
    <main><div className="ma-kicker">Small beginnings. Limitless futures.</div><h1>{STORY[scene].title}</h1><p>{STORY[scene].description}</p>{controls && <div className="ma-vision-actions"><button type="button" onClick={() => setPlaying(value => !value)}>{playing ? 'Pause the vision' : 'Play the vision'} <span aria-hidden="true">{playing ? 'Ⅱ' : '▷'}</span></button><a href={`/give/${encodeURIComponent(token)}`}>Support their future ↗</a></div>}</main>
    <footer><div className="ma-scene-tabs">{STORY.map((item, index) => <button type="button" key={item.label} aria-pressed={scene === index} onClick={() => { setScene(index); setPlaying(false) }}>{item.label}<small>{['A brighter beginning', 'Room to grow', 'A future, together'][index]}</small></button>)}</div><small>Architectural concept only.<br/>Not approved construction plans.</small></footer>
  </div>
}
function GiftSpotlight({ latest, celebrating, currency }) {
  return <div className={`ma-spotlight ${celebrating ? 'ma-celebrate' : ''}`}><span className="ma-gift-star" aria-hidden="true">✧</span><div><small>{celebrating ? 'A MOMENT OF GENEROSITY' : 'A COMMUNITY OF GENEROSITY'}</small><strong>{latest ? latest.name || 'A generous supporter' : 'Every gift can make a difference.'}{latest?.amount_minor != null ? ` · ${givingMoney(latest.amount_minor, currency)}` : ''}</strong><p>{latest ? latest.kind === 'pledge' ? 'A pledge of support · awaiting payment' : 'Thank you for making room for a brighter future.' : 'Be part of the next chapter for our children.'}</p></div></div>
}
function LiveGiving({ campaign, token, mode }) {
  const { confirmed, goal, percent, remaining, milestone, milestoneRemaining } = givingProgress(campaign)
  const format = value => givingMoney(value, campaign.currency)
  const latest = campaign.recent_public?.[0]
  const last = useRef(null), timer = useRef(null)
  const [celebrating, setCelebrating] = useState(false)
  useEffect(() => {
    const next = { confirmed, latestId: latest?.id }
    if (last.current && confirmed > last.current.confirmed && latest?.kind !== 'pledge' && latest?.id && latest.id !== last.current.latestId) {
      setCelebrating(true); clearTimeout(timer.current); timer.current = setTimeout(() => setCelebrating(false), 7000)
    }
    last.current = next
  }, [confirmed, latest?.id, latest?.kind])
  useEffect(() => () => clearTimeout(timer.current), [])
  const reveal = mode === 'reveal'
  return <div className={`ma-scene ${reveal ? 'ma-reveal' : 'ma-live'} ${celebrating ? 'ma-gift-arrived' : ''}`}>{reveal && <img className="ma-campus" src={ACADEMY_ART} alt="Illustrative school campus concept"/>}
    <header><AcademyMark logo={campaign.logo_url}/><span className="ma-live-label">FESTIO LIVE · LIVE GIVING</span></header>
    {reveal ? <><div className="ma-reveal-title"><div className="ma-kicker">Generosity, made visible.</div><h1>A future,<br/>one step closer.</h1><p>Illustrative architecture · Not approved construction plans</p></div><div className="ma-reveal-bottom"><GiftSpotlight latest={latest} celebrating={celebrating} currency={campaign.currency}/><div className="ma-reveal-progress"><strong>{format(confirmed)}. Together.</strong>{goal > 0 && <><div className="ma-progress"><i style={{ width: `${percent}%` }}/></div><p>{percent.toFixed(1)}% of the {format(goal)} goal confirmed</p></>}<a href={`/give/${encodeURIComponent(token)}`}>Be part of the story ↗</a></div></div></> : <>
      <div className="ma-live-body"><main><div className="ma-kicker">Look what we are building together.</div><h1>One community.<br/>A remarkable impact.</h1><div className="ma-total-line"><strong className="ma-total" key={confirmed}>{format(confirmed)}</strong><span>confirmed gifts{goal > 0 && <><br/>towards a {format(goal)} goal</>}</span></div>{goal > 0 && <div className="ma-progress" role="progressbar" aria-label="Confirmed gifts toward goal" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${percent}%` }}/></div>}<div className="ma-live-stats"><article><strong>{campaign.donation_count || 0}</strong><small>confirmed gifts</small></article>{campaign.show_pledged_total && <article><strong>{format(campaign.pledged_minor || 0)}</strong><small>pledged · not yet received</small></article>}{goal > 0 && <article><strong>{format(remaining)}</strong><small>to the confirmed goal</small></article>}</div></main><aside className="ma-qr"><div className="ma-kicker">Be part of the story</div><img src={`/api/give/${encodeURIComponent(token)}/qr.png`} alt="Scan to give to Mumineen Academy"/><h2>A future starts<br/>with you.</h2><a href={`/give/${encodeURIComponent(token)}`}>Open the giving page ↗</a><small>Give or pledge through the available methods.</small></aside></div>
      <div className="ma-live-bottom"><GiftSpotlight latest={latest} celebrating={celebrating} currency={campaign.currency}/><div className="ma-milestone"><span>{goal > 0 ? `${Math.floor(percent)}%` : '✧'}</span><div><small>{goal && confirmed >= goal ? 'A SHARED ACHIEVEMENT' : 'THE NEXT MILESTONE'}</small><h2>{!goal ? 'Every gift matters.' : confirmed >= goal ? 'Our goal, reached together.' : `Let’s reach ${format(milestone)} together.`}</h2><p>{goal && confirmed < goal ? `${format(milestoneRemaining)} to the next confirmed-giving milestone.` : 'Thank you for supporting the next generation.'}</p></div></div></div>
    </>}
    <footer><small>Confirmed gifts lead. Pledges remain separate.</small><small>Made for meaningful moments. Powered by Festio.</small></footer>
  </div>
}
export default function AcademyExperience({ token = ACADEMY_GIVING_TOKEN, mode = 'live', controls = false }) {
  const { campaign, error } = useGivingCampaign(token)
  if (!campaign) return <div className="ma-waiting" role="status">{error || 'Opening the giving experience…'}</div>
  if (!academyCampaign(campaign, token)) return <div className="ma-waiting">This experience is available for Mumineen Academy.</div>
  return <div className="ma-experience">{mode === 'vision' ? <Vision campaign={campaign} token={token} controls={controls}/> : <LiveGiving campaign={campaign} token={token} mode={mode}/>}<div className="ma-connection" role="status" aria-live="polite">{error || ''}</div></div>
}
