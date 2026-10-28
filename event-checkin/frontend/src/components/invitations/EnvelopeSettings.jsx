import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api'
import { ENVELOPE_COLLECTION } from './envelopeCollection.mjs'
import './EnvelopeCollectionStudio.css'
import { GUEST_NAME_TOKENS } from './envelopePersonalization.mjs'
import InvitationOpening, { ENVELOPE_DEFAULTS, ENVELOPE_PALETTES, ENVELOPE_STYLES, envelopeContinueMode } from './InvitationOpening'

// Independent partial saves cannot publish or overwrite another editor's template draft.
export default function EnvelopeSettings({ eventId, event, mode = 'design', onSaved }) {
  const [config, setConfig] = useState(null)
  const [appearance, setAppearance] = useState(ENVELOPE_DEFAULTS)
  const [enabled, setEnabled] = useState(false)
  const [frequency, setFrequency] = useState('once')
  const [continueMode, setContinueMode] = useState('auto')
  const [useDefault, setUseDefault] = useState(true)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [preview, setPreview] = useState(false)
  const [replay, setReplay] = useState(0)
  const [retry, setRetry] = useState(0)
  const [openSignal, setOpenSignal] = useState(0)
  const [previewRecipient, setPreviewRecipient] = useState('personal')
  const [sampleFirstName, setSampleFirstName] = useState('Amina')
  const [sampleLastName, setSampleLastName] = useState('Idris')
  const focusedWording = useRef(null)
  const [tokenMessage, setTokenMessage] = useState('')
  const previewGuest = mode === 'design' && previewRecipient === 'personal' ? { first_name: sampleFirstName, last_name: sampleLastName } : null
  function insertGuestToken(token) {
    const target = focusedWording.current
    if (!target || target.element.disabled || !target.element.isConnected) { setTokenMessage('Click a wording field, then choose a guest-name placeholder.'); return }
    const { key, element, limit } = target
    const value = appearance.wording?.[key] || ''
    const start = element.selectionStart ?? value.length, end = element.selectionEnd ?? start
    const marker = `{{${token}}}`
    const next = value.slice(0, start) + marker + value.slice(end)
    if (next.length > limit) { setTokenMessage('This field is too long for that placeholder. Shorten the wording first.'); return }
    edit({ wording: { ...appearance.wording, [key]: next } }); setTokenMessage('')
    requestAnimationFrame(() => { element.focus(); element.setSelectionRange(start + marker.length, start + marker.length) })
  }
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(''); setStatus(''); setPreview(false); setConfig(null)
    if (!eventId) { setLoading(false); return undefined }
    const load = mode === 'design' ? api.getEventDesign : api.getInvitationOpening
    load(eventId).then(design => {
      if (cancelled) return
      const next = design.envelope_config || {}
      setContinueMode(envelopeContinueMode(next)); setConfig(next); setAppearance({ ...ENVELOPE_DEFAULTS, ...next.appearance }); setEnabled(next.enabled === true); setFrequency(next.frequency || 'once'); setUseDefault(next.use_default === true || !next.appearance); setPreview(mode === 'design')
    }).catch(e => { if (!cancelled) setError(e.message || 'Envelope settings could not be loaded.') }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [eventId, mode, retry])
  function edit(patch) { setAppearance(d => ({ ...d, ...patch })); setStatus('Unsaved changes'); setPreview(true); setOpenSignal(0) }
  async function save() {
    if (!eventId || busy) return
    setBusy(true); setError('')
    try {
      const patch = mode === 'design' ? { appearance: { ...appearance, initials: appearance.initials.trim() || ENVELOPE_DEFAULTS.initials }, use_default: false } : { enabled, frequency }
      const saved = mode === 'design' ? await api.saveEventDesign(eventId, { envelope_config: patch }) : await api.saveInvitationOpening(eventId, { enabled, frequency, use_default: useDefault, continue_mode: continueMode })
      if (!saved.envelope_config || (mode === 'design' && !saved.envelope_config.appearance)) throw new Error('Envelope settings were not saved. The design service may need an update.')
      setConfig(saved.envelope_config); if (mode === 'design') setAppearance({ ...ENVELOPE_DEFAULTS, ...saved.envelope_config.appearance }); onSaved?.(saved.envelope_config || {}); setStatus(mode === 'design' ? (saved.envelope_config.enabled && !saved.envelope_config.use_default ? 'Saved. Your custom envelope is applied to invitation links.' : 'Saved. Your custom design is selected. Enable envelope opening in Guests → Invite to show it.') : 'Saved. Opening settings are applied to invitation links.')
    } catch (e) { setError(e.message || 'Envelope settings could not be saved. Try again.') }
    finally { setBusy(false) }
  }
  if (!eventId) return <p>Select an event to configure its invitation opening.</p>
  if (loading) return <p role="status">Loading envelope settings…</p>
  if (!config) return <div role="alert"><p>{error || 'Envelope settings are unavailable.'}</p>{mode === 'design' && <p>Custom designs require Design Studio access. You can use the default envelope in Guests → Invite.</p>}<button type="button" className="rr-btn secondary" onClick={() => setRetry(n => n + 1)}>Retry</button></div>
  const unsaved = mode === 'design' ? JSON.stringify(appearance) !== JSON.stringify({ ...ENVELOPE_DEFAULTS, ...config.appearance }) || !config.appearance || config.use_default !== false : enabled !== (config.enabled === true) || frequency !== (config.frequency || 'once') || useDefault !== (config.use_default === true || !config.appearance) || continueMode !== envelopeContinueMode(config)
  const meta = ENVELOPE_COLLECTION[appearance.style]
  const canSave = !busy && !(appearance.show_initials !== false && !appearance.initials.trim()) && unsaved
  function chooseStyle(style) {
    edit({ style, ...(ENVELOPE_COLLECTION[style] ? { palette: 'signature', paper: '' } : appearance.palette === 'signature' ? { palette:'ivory',paper:'' } : {}) })
    setReplay(value => value + 1)
  }
  function resetPreview() { setOpenSignal(0); setPreview(true); setReplay(value=>value+1) }
  if (mode === 'design') return <section className="ec-studio" aria-label="Invitation envelope design">
    <header className="ec-introduction"><div><p className="ec-eyebrow">DESIGN STUDIO / INVITATION OPENING</p><h2>Before the event,<br/>there is <em>the invitation.</em></h2></div><div className="ec-save-area"><p>Choose a reveal. Make it yours.<br/>One connected opening for your existing invitation.</p><button type="button" className="rr-btn primary" disabled={!canSave} onClick={save}>{busy?'Saving…':'Save envelope design'}</button><span className="inv-envelope-status" role="status">{status || (unsaved?'Unsaved changes':'Saved settings')}</span></div></header>
    <nav className="ec-collection-nav" aria-label="Collection styles">{Object.entries(ENVELOPE_COLLECTION).map(([id,item])=><button type="button" key={id} aria-pressed={appearance.style===id} onClick={()=>chooseStyle(id)}><span>{item.number}</span>{item.name}</button>)}</nav>
    <div className="ec-originals"><span>Original envelopes</span>{Object.entries(ENVELOPE_STYLES).filter(([id])=>!ENVELOPE_COLLECTION[id]).map(([id,name])=><button type="button" key={id} aria-pressed={appearance.style===id} onClick={()=>chooseStyle(id)}>{name}</button>)}</div>
    <div className="ec-workbench">
      <div className="ec-preview-panel">
        {preview ? <InvitationOpening key={`${appearance.style}:${replay}`} embedded holdOpen openSignal={openSignal} appearance={appearance} event={event} guest={previewGuest} onDone={()=>setPreview(false)}/> : <div className="ec-preview-finished"><p>Preview complete.</p><button type="button" className="rr-btn secondary" onClick={resetPreview}>Preview opening ↻</button></div>}
        <div className="ec-preview-tools"><span>Interactive preview · guest actions are not submitted</span><div><button type="button" disabled={!preview || openSignal>0} onClick={()=>setOpenSignal(value=>value+1)}>Open invitation ↗</button><button type="button" onClick={resetPreview}>Reset ↻</button></div></div>
      </div>
      <aside className="ec-editorial">
        <p className="ec-eyebrow">{meta?`${meta.number} / ${meta.edition}`:'THE ORIGINAL COLLECTION'}</p><h3 className="ec-style-name">{ENVELOPE_STYLES[appearance.style]}.</h3>
        <p className="ec-description">{meta?.description||'Your original invitation envelope, with all of your existing colours, wording and initials.'}</p>
        {meta&&<dl className="ec-design-facts"><div><dt>THE REVEAL</dt><dd>{meta.reveal}</dd></div><div><dt>THE FEELING</dt><dd>{meta.feeling}</dd></div><div><dt>MADE FOR</dt><dd>{meta.audience}</dd></div></dl>}
        <div className="inv-envelope-settings ec-controls">
          <details open><summary>Appearance & initials</summary><div className="ec-control-body">      <div><h3>Envelope colour</h3><div className="inv-envelope-palettes">{Object.entries(ENVELOPE_PALETTES).filter(([id])=>id!=='signature'||meta).map(([id, [name, color]]) => <button type="button" key={id} aria-pressed={!appearance.paper && appearance.palette === id} onClick={() => edit({ palette: id, paper: '' })}><i style={{ background: id==='signature'?meta?.colours[0]:color }} />{name}</button>)}</div></div>
      <label>Custom colour<input aria-label="Custom envelope colour" type="color" value={appearance.paper || (appearance.palette==='signature'?meta?.colours[0]:ENVELOPE_PALETTES[appearance.palette]?.[1]) || '#eee2c4'} onChange={e => edit({ paper: e.target.value })} /></label>
      <label>Seal finish<select className="rr-select" value={appearance.seal} onChange={e => edit({ seal: e.target.value })}><option value="gold">Gold</option><option value="silver">Silver</option><option value="rose">Rose gold</option></select></label>
      <h3>Seal initials</h3>
      <label>Show initials<input type="checkbox" checked={appearance.show_initials !== false} onChange={e => edit({ show_initials: e.target.checked })} /></label>
      <label>Initials (up to 3)<input className="rd-field" disabled={appearance.show_initials === false} value={appearance.initials} maxLength={3} onChange={e => edit({ initials: e.target.value })} /></label>
</div></details>
          <details><summary>Wording & guest names</summary><div className="ec-control-body">
      <div className="inv-name-tools"><strong>Personalize with a guest name</strong><p>Click a wording field, then insert a placeholder. Personal invitation links use the invited guest’s name. Shared links use “Guest”; last name is blank.</p><div className="inv-envelope-style-list">{GUEST_NAME_TOKENS.map(token => <button type="button" key={token} onMouseDown={e => e.preventDefault()} onClick={() => insertGuestToken(token)}>{`{{${token}}}`}</button>)}</div>{tokenMessage && <p role="status">{tokenMessage}</p>}</div>
      <p>Leave a field empty to use its default. The card title uses your event name unless you enter another title.</p>
      {[
        ['intro_label', 'Top label', 'YOU ARE INVITED', 60, 'show_intro_label'],
        ['headline', 'Opening headline', 'Something beautiful\nbegins with you.', 120, 'show_headline'],
        ['inscription', 'Envelope inscription', 'WITH LOVE, FOR YOU', 80, 'show_inscription'],
        ['card_label', 'Card label', 'AN INVITATION TO', 60, 'show_card_label'],
        ['card_title', 'Card title', event?.name || 'Our special gathering', 140],
        ['card_message', 'Card message', 'WE LOOK FORWARD TO WELCOMING YOU', 100, 'show_card_message'],
        ['tap_prompt', 'Tap instruction', 'Tap to open your invitation', 80],
        ['skip_label', 'Skip button text', 'Go straight to the invitation ↗', 60],
        ['opening_message', 'Opening status text', 'Opening your invitation…', 80],
      ].map(([key, label, placeholder, limit, visibility]) => <div className="inv-wording-field" key={key}>
        {visibility && <label className="inv-wording-visibility">Show {label.toLowerCase()}<input type="checkbox" checked={appearance.wording?.[visibility] !== false} onChange={e => edit({ wording: { ...appearance.wording, [visibility]: e.target.checked } })} /></label>}
        <label className="inv-wording-input">{label}{key === 'headline' ? <textarea onFocus={e => { focusedWording.current = { key, element: e.target, limit } }} aria-label={label} className="rd-field" rows={3} value={appearance.wording?.[key] || ''} placeholder={placeholder} maxLength={limit} disabled={visibility && appearance.wording?.[visibility] === false} onChange={e => edit({ wording: { ...appearance.wording, [key]: e.target.value } })} /> : <input onFocus={e => { focusedWording.current = { key, element: e.target, limit } }} aria-label={label} className="rd-field" value={appearance.wording?.[key] || ''} placeholder={placeholder} maxLength={limit} disabled={visibility && appearance.wording?.[visibility] === false} onChange={e => edit({ wording: { ...appearance.wording, [key]: e.target.value } })} />}</label>
      </div>)}
      <button type="button" className="rr-btn secondary" onClick={() => edit({ wording: {} })}>Reset wording to defaults</button>
</div></details>
          <details open><summary>Preview recipient</summary><div className="ec-control-body"><div className="inv-name-preview"><label>Preview recipient<select aria-label="Preview recipient" className="rr-select" value={previewRecipient} onChange={e => { setPreviewRecipient(e.target.value); setPreview(true) }}><option value="personal">Personal invitation — sample guest</option><option value="shared">Shared link — generic greeting</option></select></label>{previewRecipient === 'personal' && <div className="inv-name-samples"><label>Sample first name<input className="rd-field" maxLength={100} value={sampleFirstName} onChange={e => setSampleFirstName(e.target.value)} /></label><label>Sample last name<input className="rd-field" maxLength={100} value={sampleLastName} onChange={e => setSampleLastName(e.target.value)} /></label></div>}<small>Preview names are examples only and are never saved to the invitation.</small></div></div></details>
        </div>
        <p className="ec-use-note">Saving selects this custom envelope for your invitation links. Turn the opening on or off in <Link to="/guests-redesign?tab=invite">Guests → Invite ↗</Link>. The built-in default stays available without Studio access.</p>
        <button type="button" className="rr-btn primary ec-save-bottom" disabled={!canSave} onClick={save}>{busy?'Saving…':'Save envelope design'}</button>
        {error&&<p role="alert" className="inv-envelope-error">{error}</p>}
      </aside>
    </div>
  </section>
  return <div className="inv-envelope-setting-panel"><div className="inv-envelope-options">
      <label><input type="radio" name="inv-envelope-mode" checked={!enabled} onChange={() => { setEnabled(false); setStatus('Unsaved changes') }} />Direct entry — show the invitation immediately</label>
      <label><input type="radio" name="inv-envelope-mode" checked={enabled} onChange={() => { setEnabled(true); setStatus('Unsaved changes') }} />Envelope opening — tap to reveal the invitation</label>
      {enabled && <label>Envelope design<select aria-label="Envelope design" className="rr-select" value={useDefault ? 'default' : 'custom'} onChange={e => { setUseDefault(e.target.value === 'default'); setStatus('Unsaved changes') }}><option value="default">Default — ivory envelope with gold seal</option>{config.appearance && <option value="custom">Saved custom design — {ENVELOPE_STYLES[config.appearance.style]}</option>}</select></label>}
      <p>The default envelope is ready to use. No Design Studio access is needed. <Link className="rr-btn secondary" to="/design-studio-redesign?tab=Envelope">Customize in Design Studio ↗</Link></p>
      <label>Show opening<select className="rr-select" disabled={!enabled} value={frequency} onChange={e => { setFrequency(e.target.value); setStatus('Unsaved changes') }}><option value="once">First visit on this device</option><option value="always">Every visit</option></select></label>
      <label>After opening<select aria-label="After opening" className="rr-select" disabled={!enabled} value={continueMode} onChange={e => { setContinueMode(e.target.value); setStatus('Unsaved changes') }}><option value="auto">Continue automatically after 3 seconds</option><option value="manual">Wait for guest to continue</option></select></label>
      <small>Guests can skip. The envelope opens on the invitation web page after following an email or WhatsApp link. Existing RSVP forms stay the same.</small>
      <div><button type="button" className="rr-btn primary" disabled={busy || !unsaved} onClick={save}>{busy ? 'Saving…' : 'Save opening options'}</button>{enabled && <button type="button" className="rr-btn secondary" onClick={() => setPreview(true)}>Preview opening</button>}</div>
      {preview && <InvitationOpening continueMode={continueMode} appearance={useDefault ? { ...ENVELOPE_DEFAULTS, initials: '✧' } : config.appearance} event={event} onDone={() => setPreview(false)} />}
    </div>
    <p className="inv-envelope-status" role="status">{status || (unsaved ? 'Unsaved changes' : 'Saved settings')}</p>
    {error && <p role="alert" className="inv-envelope-error">{error}</p>}
  </div>
}
