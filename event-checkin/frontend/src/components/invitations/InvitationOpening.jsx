import { useEffect, useRef, useState } from 'react'
import './InvitationOpening.css'
import './EnvelopeCollection.css'
import EnvelopeCollectionContent from './EnvelopeCollectionContent'
import { ENVELOPE_COLLECTION } from './envelopeCollection.mjs'
import { renderEnvelopeWording } from './envelopePersonalization.mjs'

export const ENVELOPE_DEFAULTS = { style: 'wax', palette: 'ivory', paper: '', seal: 'gold', initials: 'M', show_initials: true, wording: {} }
export const ENVELOPE_STYLES = { wax: 'Wax seal', classic: 'Classic fold', pocket: 'Modern pocket', ...Object.fromEntries(Object.entries(ENVELOPE_COLLECTION).map(([id,meta])=>[id,meta.name])) }
export const ENVELOPE_PALETTES = { signature: ['Signature', '#193e35', '#112d27', '#cdb67b'], ivory: ['Ivory', '#eee2c4', '#d8c69e', '#655438'], emerald: ['Emerald', '#27634e', '#184a39', '#f2e5c2'], burgundy: ['Burgundy', '#8c3c50', '#62263a', '#ffebdf'], navy: ['Navy', '#354b70', '#213451', '#f1e6ce'], blush: ['Blush', '#ecd0cb', '#c9a5a3', '#593d40'], charcoal: ['Charcoal', '#505456', '#303537', '#f0e3ca'] }
export function envelopeContinueMode(config) {
  return config?.continue_mode || (config?.use_default || !ENVELOPE_COLLECTION[config?.appearance?.style] ? 'auto' : 'manual')
}
export function envelopeVisitKey(eventId, config, visitorScope = '') {
  // New optional fields with their default values must not replay old openings.
  const { wording, show_initials, ...base } = config.appearance || {}
  const overrides = Object.fromEntries(Object.entries(wording || {}).filter(([, value]) => typeof value === 'string' ? value.trim() !== '' : value === false))
  const appearance = { ...base, ...(show_initials === false ? { show_initials: false } : {}), ...(Object.keys(overrides).length ? { wording: overrides } : {}) }
  return `festio:envelope:${eventId}:${visitorScope ? visitorScope + ':' : ''}${JSON.stringify(appearance)}`
}
export function shouldShowEnvelope(eventId, config, preview = false, visitorScope = '') {
  if (!eventId || config?.enabled !== true || !ENVELOPE_STYLES[config.appearance?.style]) return false
  if (preview || visitorScope === null) return true
  try {
    // Probe storage even in every-visit mode: unavailable storage fails open.
    const storage = window.localStorage
    const probe = 'festio:envelope:storage-probe'
    storage.setItem(probe, '1'); storage.removeItem(probe)
    return config.frequency === 'always' || storage.getItem(envelopeVisitKey(eventId, config, visitorScope)) !== 'opened'
  } catch { return false }
}
export function rememberEnvelope(eventId, config, visitorScope = '') {
  if (visitorScope === null) return
  try { window.localStorage.setItem(envelopeVisitKey(eventId, config, visitorScope), 'opened') } catch { /* direct entry remains available */ }
}

export default function InvitationOpening({ appearance, event, guest = null, onDone, embedded = false, holdOpen = false, openSignal = 0, continueMode = null }) {
  const d = { ...ENVELOPE_DEFAULTS, ...appearance }
  const w = d.wording || {}
  const collection = ENVELOPE_COLLECTION[d.style]
  const text = (key, fallback) => renderEnvelopeWording(typeof w[key] === 'string' && w[key].trim() ? w[key].trim() : fallback, guest) || fallback
  const palette = ENVELOPE_PALETTES[d.palette] || ENVELOPE_PALETTES.ivory
  const custom = /^#[0-9a-f]{6}$/i.test(d.paper) ? d.paper : ''
  const rgb = custom ? custom.slice(1).match(/../g).map(x => parseInt(x, 16)) : null
  const ink = rgb ? (rgb[0] * .299 + rgb[1] * .587 + rgb[2] * .114 > 150 ? '#29332f' : '#fff8e8') : palette[3]
  const seals = { gold: ['#c5a15d', '#322915'], silver: ['#d0d7d9', '#29363a'], rose: ['#c38d7f', '#351e1a'] }
  const sealFinish = seals[d.seal] || seals.gold
  const [opening, setOpening] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const signature = collection?.colours
  const scenePalettes = { emerald:['#e0e5d9','#3b5742'],navy:['#e1e5e8','#39495e'],ivory:['#e7e5db','#635b42'],burgundy:['#eee2e5','#623d4a'],blush:['#f0e4e2','#774f53'],charcoal:['#e4e5e1','#424b47'] }
  const sceneColours = scenePalettes[d.palette] || ['#e3e4da','#344f3b']
  const collectionColours = collection ? { '--paper':custom||(d.palette==='signature'?signature[0]:palette[1]),'--paper-deep':custom||(d.palette==='signature'?signature[1]:palette[2]),'--accent':d.seal==='gold'?(d.palette==='signature'?signature[2]:'#cdb67b'):sealFinish[0],'--scene-bg':d.palette==='signature'?signature[3]:sceneColours[0],'--scene-ink':d.palette==='signature'?signature[4]:sceneColours[1] } : {}
  const root = useRef(null)
  const timer = useRef(null)
  const advanceTimer = useRef(null)
  const finished = useRef(false)
  const complete = useRef(onDone)
  complete.current = onDone
  function finish() {
    if (finished.current) return
    finished.current = true
    clearTimeout(timer.current); clearTimeout(advanceTimer.current)
    complete.current()
  }
  useEffect(() => {
    if (embedded) return undefined
    const previous = document.activeElement
    root.current?.querySelector('button')?.focus()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const key = e => {
      if (e.key === 'Escape') { e.preventDefault(); finish() }
      if (e.key === 'Tab') {
        const buttons = [...root.current.querySelectorAll('button:not(:disabled)')]
        if (!buttons.length) return
        if (e.shiftKey && document.activeElement === buttons[0]) { e.preventDefault(); buttons.at(-1).focus() }
        else if (!e.shiftKey && document.activeElement === buttons.at(-1)) { e.preventDefault(); buttons[0].focus() }
      }
    }
    document.addEventListener('keydown', key)
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', key); previous?.focus?.() }
  }, [embedded])
  useEffect(() => () => { clearTimeout(timer.current); clearTimeout(advanceTimer.current) }, [])
  useEffect(() => { if (openSignal > 0) open() }, [openSignal])
  function open() {
    if (opening) return
    root.current?.querySelector('.inv-opening-skip')?.focus()
    setOpening(true)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const staysOpen = collection || holdOpen || continueMode === 'manual' || continueMode === 'auto'
    timer.current = setTimeout(() => { if (staysOpen) setRevealed(true); else finish() }, reduced ? 150 : collection ? 1500 : 1900)
    if (continueMode === 'auto' && !holdOpen && !embedded) advanceTimer.current = setTimeout(finish, 3000)
  }
  return <section ref={root} className={`inv-opening ${embedded ? 'inv-opening-embedded' : ''} ${opening ? 'is-opening' : ''} ${collection ? 'inv-collection-opening ic-scene' : ''} ${collection && opening ? 'ic-opened' : ''}`} data-concept={collection ? d.style : undefined} data-revealed={revealed} data-style={d.style} role={embedded ? 'region' : 'dialog'} aria-modal={embedded ? undefined : 'true'} aria-label="Your invitation" style={{ '--env-paper': custom || palette[1], '--env-dark': custom || palette[2], '--env-ink': ink, '--env-seal': sealFinish[0], '--env-seal-ink': sealFinish[1], '--env-monogram-size': Array.from(d.initials || '').length > 2 ? (collection ? '27px' : '17px') : (collection ? '37px' : '25px'), ...collectionColours }}>
    {collection ? <EnvelopeCollectionContent appearance={d} event={event} text={text} opening={opening} revealed={revealed} open={open} done={finish} embedded={embedded || holdOpen} /> : <>
    <p className="inv-opening-kicker" hidden={w.show_intro_label === false}>{text('intro_label', 'YOU ARE INVITED')}</p>
    <h1 className="inv-opening-heading" hidden={w.show_headline === false}>{w.headline?.trim() ? text('headline', 'Something beautiful\nbegins with you.') : <>Something beautiful<br />begins with <em>you.</em></>}</h1>
    <div className="inv-envelope-stage">
      <div className="inv-envelope-back" />
      <div className="inv-envelope-card"><span aria-hidden="true">✧</span><small hidden={w.show_card_label === false}>{text('card_label', 'AN INVITATION TO')}</small><strong>{text('card_title', event?.name || 'Our special gathering')}</strong><small hidden={w.show_card_message === false}>{text('card_message', 'WE LOOK FORWARD TO WELCOMING YOU')}</small></div>
      <div className="inv-envelope-front" /><div className="inv-envelope-flap" />
      <button type="button" className="inv-envelope-seal" onClick={open} disabled={opening} aria-label="Open your invitation">{d.show_initials === false ? null : d.initials}</button>
      <span className="inv-envelope-address" hidden={w.show_inscription === false}>{text('inscription', 'WITH LOVE, FOR YOU')}</span>
    </div>
    <p className="inv-opening-caption" aria-live="polite">{opening ? text('opening_message', 'Opening your invitation…') : text('tap_prompt', 'Tap to open your invitation')}</p>
    {revealed && (holdOpen || continueMode === 'manual' || continueMode === 'auto') && <button type="button" className="inv-preview-finish" onClick={finish}>{holdOpen ? 'Finish preview' : 'View full invitation ↗'}</button>}
    <button type="button" className="inv-opening-skip" onClick={finish}>{text('skip_label', 'Go straight to the invitation ↗')}</button>
    </>}
  </section>
}
