import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api'
import InvitationOpening, { ENVELOPE_DEFAULTS, ENVELOPE_PALETTES, ENVELOPE_STYLES } from './InvitationOpening'

// Independent partial saves cannot publish or overwrite another editor's template draft.
export default function EnvelopeSettings({ eventId, event, mode = 'design', onSaved }) {
  const [config, setConfig] = useState(null)
  const [appearance, setAppearance] = useState(ENVELOPE_DEFAULTS)
  const [enabled, setEnabled] = useState(false)
  const [frequency, setFrequency] = useState('once')
  const [useDefault, setUseDefault] = useState(true)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [preview, setPreview] = useState(false)
  const [replay, setReplay] = useState(0)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(''); setStatus(''); setPreview(false); setConfig(null)
    if (!eventId) { setLoading(false); return undefined }
    const load = mode === 'design' ? api.getEventDesign : api.getInvitationOpening
    load(eventId).then(design => {
      if (cancelled) return
      const next = design.envelope_config || {}
      setConfig(next); setAppearance({ ...ENVELOPE_DEFAULTS, ...next.appearance }); setEnabled(next.enabled === true); setFrequency(next.frequency || 'once'); setUseDefault(next.use_default === true || !next.appearance); setPreview(mode === 'design')
    }).catch(e => { if (!cancelled) setError(e.message || 'Envelope settings could not be loaded.') }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [eventId, mode, retry])
  function edit(patch) { setAppearance(d => ({ ...d, ...patch })); setStatus('Unsaved changes'); setPreview(true); setReplay(n => n + 1) }
  async function save() {
    if (!eventId || busy) return
    setBusy(true); setError('')
    try {
      const patch = mode === 'design' ? { appearance: { ...appearance, initials: appearance.initials.trim() || ENVELOPE_DEFAULTS.initials } } : { enabled, frequency }
      const saved = mode === 'design' ? await api.saveEventDesign(eventId, { envelope_config: patch }) : await api.saveInvitationOpening(eventId, { enabled, frequency, use_default: useDefault })
      if (!saved.envelope_config || (mode === 'design' && !saved.envelope_config.appearance)) throw new Error('Envelope settings were not saved. The design service may need an update.')
      setConfig(saved.envelope_config); if (mode === 'design') setAppearance({ ...ENVELOPE_DEFAULTS, ...saved.envelope_config.appearance }); onSaved?.(saved.envelope_config || {}); setStatus(mode === 'design' ? (saved.envelope_config.enabled && !saved.envelope_config.use_default ? 'Saved. Your custom envelope is applied to invitation links.' : 'Saved. Select Saved custom design in RSVP → Invite to use this envelope.') : 'Saved. Opening settings are applied to invitation links.')
    } catch (e) { setError(e.message || 'Envelope settings could not be saved. Try again.') }
    finally { setBusy(false) }
  }
  if (!eventId) return <p>Select an event to configure its invitation opening.</p>
  if (loading) return <p role="status">Loading envelope settings…</p>
  if (!config) return <div role="alert"><p>{error || 'Envelope settings are unavailable.'}</p>{mode === 'design' && <p>Custom designs require Design Studio access. You can use the default envelope in Guests → Invite.</p>}<button type="button" className="rr-btn secondary" onClick={() => setRetry(n => n + 1)}>Retry</button></div>
  const unsaved = mode === 'design' ? JSON.stringify(appearance) !== JSON.stringify({ ...ENVELOPE_DEFAULTS, ...config.appearance }) || !config.appearance : enabled !== (config.enabled === true) || frequency !== (config.frequency || 'once') || useDefault !== (config.use_default === true || !config.appearance)
  return <div className="inv-envelope-setting-panel">
    {mode === 'design' ? <div className="inv-envelope-editor"><div className="inv-envelope-settings">
      <div><h3>Envelope style</h3><p>Works in front of your existing invitation design.</p><div className="inv-envelope-style-list">{Object.entries(ENVELOPE_STYLES).map(([id, name]) => <button type="button" key={id} aria-pressed={appearance.style === id} onClick={() => edit({ style: id })}>{name}</button>)}</div></div>
      <div><h3>Envelope colour</h3><div className="inv-envelope-palettes">{Object.entries(ENVELOPE_PALETTES).map(([id, [name, color]]) => <button type="button" key={id} aria-pressed={!appearance.paper && appearance.palette === id} onClick={() => edit({ palette: id, paper: '' })}><i style={{ background: color }} />{name}</button>)}</div></div>
      <label>Custom colour<input aria-label="Custom envelope colour" type="color" value={appearance.paper || ENVELOPE_PALETTES[appearance.palette]?.[1] || '#eee2c4'} onChange={e => edit({ paper: e.target.value })} /></label>
      <label>Seal finish<select className="rr-select" value={appearance.seal} onChange={e => edit({ seal: e.target.value })}><option value="gold">Gold</option><option value="silver">Silver</option><option value="rose">Rose gold</option></select></label>
      <h3>Seal initials</h3>
      <label>Show initials<input type="checkbox" checked={appearance.show_initials !== false} onChange={e => edit({ show_initials: e.target.checked })} /></label>
      <label>Initials (up to 3)<input className="rd-field" disabled={appearance.show_initials === false} value={appearance.initials} maxLength={3} onChange={e => edit({ initials: e.target.value })} /></label>
      <h3>Wording</h3><p>Leave a field empty to use its default. The card title uses your event name unless you enter another title.</p>
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
        <label className="inv-wording-input">{label}{key === 'headline' ? <textarea aria-label={label} className="rd-field" rows={3} value={appearance.wording?.[key] || ''} placeholder={placeholder} maxLength={limit} disabled={visibility && appearance.wording?.[visibility] === false} onChange={e => edit({ wording: { ...appearance.wording, [key]: e.target.value } })} /> : <input aria-label={label} className="rd-field" value={appearance.wording?.[key] || ''} placeholder={placeholder} maxLength={limit} disabled={visibility && appearance.wording?.[visibility] === false} onChange={e => edit({ wording: { ...appearance.wording, [key]: e.target.value } })} />}</label>
      </div>)}
      <button type="button" className="rr-btn secondary" onClick={() => edit({ wording: {} })}>Reset wording to defaults</button>
      <p>Save your custom envelope here, then select Saved custom design in <Link to="/guests-redesign?tab=invite">RSVP → Invite ↗</Link>. The built-in default keeps its own wording.</p>
      <button type="button" className="rr-btn primary" disabled={busy || (appearance.show_initials !== false && !appearance.initials.trim()) || !unsaved} onClick={save}>{busy ? 'Saving…' : 'Save envelope design'}</button>
    </div><div>{preview ? <InvitationOpening key={replay} embedded appearance={appearance} event={event} onDone={() => setPreview(false)} /> : <div className="inv-envelope-preview-replay"><p>Preview the envelope and its opening.</p><button type="button" className="rr-btn secondary" onClick={() => { setReplay(n => n + 1); setPreview(true) }}>Preview opening ↻</button></div>}</div></div> : <div className="inv-envelope-options">
      <label><input type="radio" name="inv-envelope-mode" checked={!enabled} onChange={() => { setEnabled(false); setStatus('Unsaved changes') }} />Direct entry — show the invitation immediately</label>
      <label><input type="radio" name="inv-envelope-mode" checked={enabled} onChange={() => { setEnabled(true); setStatus('Unsaved changes') }} />Envelope opening — tap to reveal the invitation</label>
      {enabled && <label>Envelope design<select aria-label="Envelope design" className="rr-select" value={useDefault ? 'default' : 'custom'} onChange={e => { setUseDefault(e.target.value === 'default'); setStatus('Unsaved changes') }}><option value="default">Default — ivory envelope with gold seal</option>{config.appearance && <option value="custom">Saved custom design — {ENVELOPE_STYLES[config.appearance.style]}</option>}</select></label>}
      <p>The default envelope is ready to use. No Design Studio access is needed. <Link className="rr-btn secondary" to="/design-studio-redesign?tab=Envelope">Customize in Design Studio ↗</Link></p>
      <label>Show opening<select className="rr-select" disabled={!enabled} value={frequency} onChange={e => { setFrequency(e.target.value); setStatus('Unsaved changes') }}><option value="once">First visit on this device</option><option value="always">Every visit</option></select></label>
      <small>Guests can skip. The envelope opens on the invitation web page after following an email or WhatsApp link. Existing RSVP forms stay the same.</small>
      <div><button type="button" className="rr-btn primary" disabled={busy || !unsaved} onClick={save}>{busy ? 'Saving…' : 'Save opening options'}</button>{enabled && <button type="button" className="rr-btn secondary" onClick={() => setPreview(true)}>Preview opening</button>}</div>
      {preview && <InvitationOpening appearance={useDefault ? { ...ENVELOPE_DEFAULTS, initials: '✧' } : config.appearance} event={event} onDone={() => setPreview(false)} />}
    </div>}
    <p className="inv-envelope-status" role="status">{status || (unsaved ? 'Unsaved changes' : 'Saved settings')}</p>
    {error && <p role="alert" className="inv-envelope-error">{error}</p>}
  </div>
}
