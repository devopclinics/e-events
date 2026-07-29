import { useEffect, useRef, useState } from 'react'
import RedesignShell, { Icon, Modal } from './redesign/RedesignShell'
import { useCurrentEvent } from '../hooks/useCurrentEvent'
import { api } from '../api'
import './DesignStudioRedesignPage.css'

const TABS = ['Templates', 'Flyer', 'Event Page', 'Festio Pass', 'Email Preview', 'Publish']

const TEMPLATE_CATEGORIES = ['All', 'Wedding', 'Community', 'Conference', 'Celebration']
const TEMPLATE_STYLES = ['All styles', 'Warm', 'Minimal', 'Dark', 'Playful']

const TEMPLATES = [
  { name: 'Botanical Gold', category: 'Wedding', style: 'Warm', tier: 'premium', tone: 'Warm, floral', selected: true, surfaces: ['Event Page', 'Flyer', 'Pass', 'Email'] },
  { name: 'Modern Mono', category: 'Conference', style: 'Minimal', tier: 'free', tone: 'Minimal, high-contrast', selected: false, surfaces: ['Event Page', 'Flyer', 'Email'] },
  { name: 'Midnight Celebration', category: 'Celebration', style: 'Dark', tier: 'premium', tone: 'Dark, elegant', selected: false, surfaces: ['Event Page', 'Flyer', 'Pass', 'Email'] },
  { name: 'Community Classic', category: 'Community', style: 'Warm', tier: 'free', tone: 'Friendly, accessible', selected: false, surfaces: ['Event Page', 'Flyer'] },
]

// Real design-service contract (confirmed against DesignStudioPage.jsx, the
// already-shipped legacy page these records are shared live with — getting
// these keys wrong would write malformed data into real event-design rows).
const WORDING_FIELDS = [
  ['inviteLabel', 'Invite label', "You're invited"],
  ['eventTitle', 'Event title', ''],
  ['eventSubtitle', 'Subtitle', ''],
  ['hostName', 'Host name', ''],
  ['hostWebsite', 'Host website', ''],
  ['date', 'Date', ''],
  ['time', 'Time', ''],
  ['venue', 'Venue', ''],
  ['address', 'Address', ''],
  ['rsvpBy', 'RSVP by', ''],
  ['rsvpNote', 'RSVP note', ''],
  ['phone', 'Phone', ''],
  ['email', 'Email', ''],
  ['dressCode', 'Dress code', ''],
  ['admissionNote', 'Admission note', 'Present this pass at the door for entry.'],
  ['parkingNote', 'Parking note', ''],
  ['customMessage', 'Custom message', ''],
  ['aboutWebsite', 'About / website', ''],
  ['footerMessage', 'Footer message', ''],
  ['footerNote', 'Footer note', ''],
]
const DEFAULT_WORDING = Object.fromEntries(WORDING_FIELDS.map(([key, , fallback]) => [key, fallback]))

const COLOR_FIELDS = [
  { key: 'primary', label: 'Primary' },
  { key: 'accent', label: 'Accent' },
  { key: 'background', label: 'Background' },
  { key: 'surface', label: 'Surface' },
  { key: 'text', label: 'Text' },
]
const DEFAULT_COLORS = { primary: '#0f766e', accent: '#b6672f', background: '#faf6ee', surface: '#ffffff', text: '#211a13' }

const FONT_OPTIONS = [
  { id: 'modern-sans', label: 'Modern Sans' },
  { id: 'classic-serif', label: 'Classic Serif' },
  { id: 'elegant-serif', label: 'Elegant Serif' },
  { id: 'display-rounded', label: 'Display Rounded' },
  { id: 'bold-sans', label: 'Bold Sans' },
]

const FLYER_TEXT_SCALES = [
  { value: 0.9, label: 'Small' },
  { value: 1, label: 'Medium' },
  { value: 1.15, label: 'Large' },
  { value: 1.3, label: 'X-Large' },
  { value: 1.45, label: 'XX-Large' },
]

const FLYER_SIZES = [
  { id: 'square', label: 'Square (social)' },
  { id: 'story', label: 'Story (9:16)' },
  { id: 'portrait', label: 'Portrait' },
  { id: 'a5', label: 'A5 (print)' },
  { id: 'a4', label: 'A4 (print)' },
]

const QR_POSITIONS = [
  { id: 'bottom-right', label: 'Bottom right' },
  { id: 'bottom-left', label: 'Bottom left' },
  { id: 'center-bottom', label: 'Bottom center' },
]

const DEFAULT_IMAGE_POSITION = { x: 50, y: 50, zoom: 115, rotate: 0, zoneScale: 100, boxX: 0, boxY: 0 }
const DEFAULT_FLYER_SETTINGS = { size: 'portrait', qr: true, rsvpLink: true, qrPosition: 'bottom-right' }
const DEFAULT_PASS_OPTIONS = { showTable: true, showSeat: true, showHubButton: true }

const CROP_SLIDERS = [
  { key: 'x', label: 'Horizontal position', min: 0, max: 100 },
  { key: 'y', label: 'Vertical position', min: 0, max: 100 },
  { key: 'zoom', label: 'Zoom', min: 100, max: 180 },
  { key: 'rotate', label: 'Rotate', min: -180, max: 180 },
]

// Matches the real `page_config` contract read by the guest-facing InvitePage
// (see legacy DesignStudioPage.jsx's DEFAULT_PUBLIC_PAGE / publicPageSettings()).
// There is no "seating preview" or "FestioHub live feed" section in that contract —
// those never had a real effect and are not offered here.
const DEFAULT_PAGE_SECTIONS = {
  hero: { showWelcomeLabel: true, showTitle: true, showHost: true },
  organizer: { show: true, label: 'Organized by' },
  details: { showVenue: true, showHotel: true, showHost: true, showAdmission: true },
  about: { show: true, ctaLabel: '', ctaUrl: '' },
}

const EMAIL_TYPES = ['Invitation', 'RSVP confirmation', 'Festio Pass email', 'Reminder', 'Broadcast', 'Check-in confirmation']

const PUBLISH_CHECKLIST = [
  { label: 'Template selected', done: true },
  { label: 'Cover image added', done: true },
  { label: 'Title, date & venue set', done: true },
  { label: 'Colors selected', done: true },
  { label: 'Flyer size confirmed', done: true },
  { label: 'Festio Pass preview reviewed', done: false },
  { label: 'Invite email preview reviewed', done: false },
]

function Swatch({ hex }) {
  return <span className="ds-swatch-dot" style={{ background: hex }} />
}

export default function DesignStudioRedesignPage() {
  const [eventId] = useCurrentEvent()
  const [tab, setTab] = useState('Templates')
  const [templates, setTemplates] = useState([])
  const [tplCategory, setTplCategory] = useState('All')
  const [tplStyle, setTplStyle] = useState('All styles')
  const [tplQuery, setTplQuery] = useState('')
  const [previewTpl, setPreviewTpl] = useState(null)
  const [toast, setToast] = useState('')
  const [passHasPass, setPassHasPass] = useState(true)
  const [emailType, setEmailType] = useState(EMAIL_TYPES[0])
  const [pageSections, setPageSections] = useState(DEFAULT_PAGE_SECTIONS)
  const [mobilePreview, setMobilePreview] = useState(false)
  const [publishState, setPublishState] = useState('idle') // idle | confirm | publishing | success | error
  const [publishError, setPublishError] = useState('')
  const [design, setDesign] = useState(null)
  const [outputs, setOutputs] = useState([])
  const [designBusy, setDesignBusy] = useState(false)

  // Flyer / Festio Pass — real design-service fields, hydrated from `design`
  // in loadDesignStudio() below and saved back via saveFlyerSettings()/renderFlyer().
  const [wording, setWording] = useState(DEFAULT_WORDING)
  const [colors, setColors] = useState(DEFAULT_COLORS)
  const [fontPairing, setFontPairing] = useState(FONT_OPTIONS[0].id)
  const [flyerTextScale, setFlyerTextScale] = useState(1)
  const [flyerSettings, setFlyerSettings] = useState(DEFAULT_FLYER_SETTINGS)
  const [imagePosition, setImagePosition] = useState(DEFAULT_IMAGE_POSITION)
  const [passOptions, setPassOptions] = useState(DEFAULT_PASS_OPTIONS)
  const [selectedFlyerTplId, setSelectedFlyerTplId] = useState('')
  const [coverBusy, setCoverBusy] = useState(false)
  const [renderBusy, setRenderBusy] = useState(false)
  const coverFileRef = useRef(null)

  async function loadDesignStudio() {
    if (!eventId) return
    setDesignBusy(true)
    try {
      const [catalog, saved, rendered] = await Promise.all([
        api.designTemplates(),
        api.getEventDesign(eventId),
        api.designOutputs(eventId).catch(() => []),
      ])
      const items = (catalog.templates || catalog || []).map((item) => ({
        ...item,
        name: item.name,
        category: item.category,
        style: item.style,
        tier: item.isFree ? 'free' : 'premium',
        tone: item.description || item.style || '',
        surfaces: item.surfaces || [],
        selected: item.id === saved.selected_template_id,
      }))
      setTemplates(items)
      setDesign(saved)
      setOutputs(rendered.outputs || rendered || [])
      setPreviewTpl(items.find((item) => item.selected) || items[0] || null)
      setPageSections({
        hero: { ...DEFAULT_PAGE_SECTIONS.hero, ...(saved.page_config?.hero || {}) },
        organizer: { ...DEFAULT_PAGE_SECTIONS.organizer, ...(saved.page_config?.organizer || {}) },
        details: { ...DEFAULT_PAGE_SECTIONS.details, ...(saved.page_config?.details || {}) },
        about: { ...DEFAULT_PAGE_SECTIONS.about, ...(saved.page_config?.about || {}) },
      })
      setWording({ ...DEFAULT_WORDING, ...(saved.wording_config || {}) })
      setColors({ ...DEFAULT_COLORS, ...(saved.theme_config?.colors || {}) })
      setFontPairing(saved.theme_config?.fontPairing || FONT_OPTIONS[0].id)
      setPassOptions({ ...DEFAULT_PASS_OPTIONS, ...(saved.theme_config?.passOptions || {}) })
      setFlyerTextScale(saved.asset_config?.flyer_text_scale ?? 1)
      setFlyerSettings({ ...DEFAULT_FLYER_SETTINGS, ...(saved.asset_config?.flyer_settings || {}) })
      setImagePosition({ ...DEFAULT_IMAGE_POSITION, ...(saved.asset_config?.image_position || {}) })
      setSelectedFlyerTplId(saved.selected_flyer_template_id || '')
    } catch (e) {
      notify(e.message || 'Design Studio could not be loaded')
    } finally {
      setDesignBusy(false)
    }
  }

  useEffect(() => { loadDesignStudio() }, [eventId])

  function notify(msg) {
    setToast(msg)
    window.setTimeout(() => setToast(''), 2600)
  }

  async function selectTemplate(template) {
    if (!eventId || designBusy) return
    setDesignBusy(true)
    try {
      const saved = await api.saveEventDesign(eventId, {
        selected_template_id: template.id,
        selected_flyer_template_id: design?.selected_flyer_template_id || null,
        theme_config: design?.theme_config || {},
        wording_config: design?.wording_config || {},
        asset_config: design?.asset_config || {},
        page_config: design?.page_config || {},
      })
      setDesign(saved)
      setTemplates((prev) => prev.map((item) => ({ ...item, selected: item.id === saved.selected_template_id })))
      setPreviewTpl(template)
      notify(`${template.name} saved as the active template`)
    } catch (e) {
      notify(e.message || 'Template selection could not be saved')
    } finally {
      setDesignBusy(false)
    }
  }

  async function savePageSettings() {
    if (!eventId || designBusy) return
    setDesignBusy(true)
    try {
      const saved = await api.saveEventDesign(eventId, {
        selected_template_id: design?.selected_template_id || activeTemplate?.id || null,
        selected_flyer_template_id: design?.selected_flyer_template_id || null,
        theme_config: design?.theme_config || {},
        wording_config: design?.wording_config || {},
        asset_config: design?.asset_config || {},
        page_config: pageSections,
      })
      setDesign(saved)
      notify('Page settings saved')
    } catch (e) {
      notify(e.message || 'Page settings could not be saved')
    } finally {
      setDesignBusy(false)
    }
  }

  async function saveFlyerAndPassSettings() {
    if (!eventId || designBusy) return
    setDesignBusy(true)
    try {
      const saved = await api.saveEventDesign(eventId, {
        selected_template_id: design?.selected_template_id || null,
        selected_flyer_template_id: selectedFlyerTplId || null,
        theme_config: { ...(design?.theme_config || {}), colors, fontPairing, passOptions },
        wording_config: wording,
        asset_config: { ...(design?.asset_config || {}), flyer_text_scale: flyerTextScale, flyer_settings: flyerSettings, image_position: imagePosition },
        page_config: design?.page_config || {},
      })
      setDesign(saved)
      notify('Design settings saved')
    } catch (e) {
      notify(e.message || 'Design settings could not be saved')
    } finally {
      setDesignBusy(false)
    }
  }

  async function selectFlyerTemplate(templateId) {
    setSelectedFlyerTplId(templateId)
    if (!eventId) return
    try {
      const saved = await api.saveEventDesign(eventId, {
        selected_template_id: design?.selected_template_id || null,
        selected_flyer_template_id: templateId,
        theme_config: design?.theme_config || {},
        wording_config: design?.wording_config || {},
        asset_config: design?.asset_config || {},
        page_config: design?.page_config || {},
      })
      setDesign(saved)
      notify('Flyer template saved')
    } catch (e) { notify(e.message || 'Flyer template could not be saved') }
  }

  async function uploadFlyerPhoto(file) {
    if (!file || !eventId) return
    setCoverBusy(true)
    try {
      const meta = await api.uploadDesignAsset(eventId, file)
      const saved = await api.saveEventDesign(eventId, {
        asset_config: { ...(design?.asset_config || {}), cover_image_url: meta.public_url },
      })
      setDesign(saved)
      notify('Photo uploaded')
    } catch (e) { notify(e.message || 'Photo could not be uploaded') }
    finally { setCoverBusy(false); if (coverFileRef.current) coverFileRef.current.value = '' }
  }

  // Mirrors DesignStudioPage.jsx's renderFlyer() exactly: save the current
  // wording/photo-position first, render server-side, and — only when the
  // organizer explicitly asks — promote the rendered output to the event's
  // real RSVP cover image (never automatic, so a hand-uploaded cover photo
  // is never silently replaced by a generated flyer).
  async function renderFlyer(fmt, useAsCover) {
    if (!eventId || renderBusy) return
    setRenderBusy(true)
    try {
      await api.saveEventDesign(eventId, {
        wording_config: wording,
        asset_config: { ...(design?.asset_config || {}), image_position: imagePosition, flyer_text_scale: flyerTextScale },
      })
      const result = await api.renderFlyer(eventId, {
        size: flyerSettings.size,
        format: fmt || (['a5', 'a4'].includes(flyerSettings.size) ? 'pdf' : 'png'),
        template_id: selectedFlyerTplId || undefined,
        colors,
        wording,
        cover_image_url: design?.asset_config?.cover_image_url || undefined,
        image_position: imagePosition,
        text_scale: flyerTextScale,
        qr_enabled: flyerSettings.qr,
        qr_position: flyerSettings.qrPosition,
        qr_data: flyerSettings.qr && flyerSettings.rsvpLink ? `https://festio.events/invite/${eventId}` : null,
      })
      if (useAsCover && result?.outputUrl) {
        const saved = await api.saveEventDesign(eventId, {
          asset_config: { ...(design?.asset_config || {}), image_position: imagePosition, cover_image_url: result.outputUrl, flyer_image_url: result.outputUrl },
        })
        setDesign(saved)
        await api.updateInviteSettings(eventId, { invite_cover_image: result.outputUrl })
      }
      api.designOutputs(eventId).then((r) => setOutputs(r.outputs || [])).catch(() => {})
      notify(useAsCover ? 'Flyer rendered, downloaded, and applied as the RSVP cover' : 'Flyer rendered and downloaded')
    } catch (e) {
      notify(e.message || 'Render failed')
    } finally {
      setRenderBusy(false)
    }
  }

  async function publishDesign() {
    if (!eventId || publishState === 'publishing') return
    setPublishState('publishing')
    setPublishError('')
    try {
      const result = await api.publishEventDesign(eventId)
      setDesign((current) => ({ ...current, ...result }))
      setPublishState('success')
      setOutputs(await api.designOutputs(eventId).catch(() => outputs))
    } catch (e) {
      setPublishError(e.message || 'Design could not be published')
      setPublishState('error')
    }
  }

  function setPageSection(section, key, value) {
    setPageSections((prev) => ({ ...prev, [section]: { ...prev[section], [key]: value } }))
  }

  const activeTemplate = templates.find((t) => t.selected)
  const filteredTemplates = templates.filter((t) =>
    (tplCategory === 'All' || t.category === tplCategory) &&
    (tplStyle === 'All styles' || t.style === tplStyle) &&
    (!tplQuery.trim() || t.name.toLowerCase().includes(tplQuery.trim().toLowerCase()))
  )

  const publishChecklist = [
    { label: 'Template selected', done: !!design?.selected_template_id },
    { label: 'Flyer template selected', done: !!design?.selected_flyer_template_id },
    { label: 'Colors customized', done: Object.keys(design?.theme_config || {}).length > 0 },
    { label: 'Event page customized', done: Object.keys(design?.page_config || {}).length > 0 },
  ]
  const publishDone = publishChecklist.filter((c) => c.done).length

  return (
    <RedesignShell topActive="design" withEventSidebar={false}>
      <div className="rr-pagehead">
        <div>
          <div className="rr-title-row"><h1>Design Studio</h1></div>
          <div className="rr-meta"><Icon name="calendar" size={13} /> Selected event <span className="rr-dot">·</span> Template: {activeTemplate?.name || 'None'}</div>
        </div>
      </div>

      <div className="rr-tabs">
        {TABS.map((t) => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>)}
      </div>

      {tab === 'Templates' && (
        <>
          <div className="ds-stat-row">
            <div><strong>{templates.length}</strong><span>Templates</span></div>
            <div><strong>5</strong><span>Collections</span></div>
            <div><strong>4</strong><span>Surfaces per template</span></div>
          </div>
          <div className="ds-filter-row">
            <div className="rd-search" style={{ flex: 1 }}>
              <Icon name="search" size={14} />
              <input placeholder="Search templates…" value={tplQuery} onChange={(e) => setTplQuery(e.target.value)} />
            </div>
            <select className="rr-select gr-inline-select" value={tplCategory} onChange={(e) => setTplCategory(e.target.value)}>
              {TEMPLATE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
            <select className="rr-select gr-inline-select" value={tplStyle} onChange={(e) => setTplStyle(e.target.value)}>
              {TEMPLATE_STYLES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>

          <div className="ds-templates-layout">
            <div className="rr-grid3">
              {filteredTemplates.map((t) => (
                <div className={`rr-panel ds-template-card ${t.selected ? 'selected' : ''}`} key={t.name} onClick={() => setPreviewTpl(t)}>
                  <div className="ds-template-swatch"><Icon name="palette" size={22} /></div>
                  <div className="ds-template-badges">
                    <span className={`ds-tier-badge ${t.tier}`}>{t.tier === 'premium' ? 'Premium' : 'Free'}</span>
                    {t.selected && <span className="rr-pill live"><i /> Active</span>}
                  </div>
                  <strong>{t.name}</strong>
                  <span>{t.tone}</span>
                  <div className="ds-surface-chips">{t.surfaces.map((s) => <span key={s} className="rd-chip">{s}</span>)}</div>
                  <div className="rd-row2">
                    <button className="rr-btn secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={(e) => { e.stopPropagation(); setPreviewTpl(t) }}>Preview</button>
                    {!t.selected && <button disabled={designBusy} className="rr-btn primary" style={{ flex: 1, justifyContent: 'center' }} onClick={(e) => { e.stopPropagation(); selectTemplate(t) }}>{designBusy ? 'Saving…' : 'Select'}</button>}
                  </div>
                </div>
              ))}
            </div>

            <div className="rd-panel ds-side-preview">
              <div className="rd-panel-head"><h3>{previewTpl?.name || 'Choose a template'}</h3><p>Layout by surface</p></div>
              <div className="rd-panel-body">
                {(previewTpl?.surfaces || []).map((s) => (
                  <div className="ds-layout-row" key={s}>
                    <Icon name={s === 'Flyer' ? 'image' : s === 'Pass' ? 'ticket' : s === 'Email' ? 'mail' : 'calendar'} size={13} />
                    <span>{s}</span><span className="rd-rowlink">layout ready</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {tab === 'Flyer' && (
        <div className="ds-flyer-layout">
          <div className="ds-flyer-col">
            <div className="rd-panel">
              <div className="rd-panel-head"><h3>Flyer template</h3></div>
              <div className="rd-panel-body ds-flyer-tpl-row">
                {templates.filter((t) => (t.surfaces || []).includes('Flyer')).map((t) => (
                  <button key={t.id} className={`ds-flyer-tpl-chip ${selectedFlyerTplId === t.id ? 'active' : ''}`} onClick={() => selectFlyerTemplate(t.id)}>{t.name}</button>
                ))}
                {!templates.some((t) => (t.surfaces || []).includes('Flyer')) && <p className="rd-rowlink">No flyer-capable templates in the catalog yet.</p>}
              </div>
            </div>

            <div className="rd-panel">
              <div className="rd-panel-head"><h3>Wording</h3></div>
              <div className="rd-panel-body">
                {WORDING_FIELDS.map(([key, label]) => (
                  <div key={key} style={{ marginBottom: 9 }}>
                    <label className="rd-field-label">{label}</label>
                    <input className="rd-field" style={{ marginBottom: 0 }} value={wording[key] || ''} onChange={(e) => setWording((w) => ({ ...w, [key]: e.target.value }))} />
                  </div>
                ))}
              </div>
            </div>

            <div className="rd-panel">
              <div className="rd-panel-head"><h3>Colors &amp; type</h3></div>
              <div className="rd-panel-body">
                <div className="ds-color-row">
                  {COLOR_FIELDS.map((c) => (
                    <label key={c.key} className="ds-color-swatch-label">
                      <input type="color" value={colors[c.key] || '#000000'} onChange={(e) => setColors((v) => ({ ...v, [c.key]: e.target.value }))} />
                      <span>{c.label}</span>
                    </label>
                  ))}
                </div>
                <label className="rd-field-label" style={{ marginTop: 10 }}>Font pairing</label>
                <select className="rr-select" value={fontPairing} onChange={(e) => setFontPairing(e.target.value)}>
                  {FONT_OPTIONS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                </select>
                <label className="rd-field-label" style={{ marginTop: 8 }}>Flyer text size</label>
                <select className="rr-select" value={flyerTextScale} onChange={(e) => setFlyerTextScale(Number(e.target.value))}>
                  {FLYER_TEXT_SCALES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
            </div>

            <div className="rd-panel">
              <div className="rd-panel-head"><h3>QR &amp; RSVP link</h3></div>
              <div className="rd-panel-body">
                <label className="rd-field-label">Flyer size</label>
                <select className="rr-select" value={flyerSettings.size} onChange={(e) => setFlyerSettings((v) => ({ ...v, size: e.target.value }))}>
                  {FLYER_SIZES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
                <div className="rd-toggle-row" style={{ marginTop: 8 }}><span style={{ fontSize: 12, fontWeight: 600 }}>Show QR code</span>
                  <label className="rd-switch"><input type="checkbox" checked={flyerSettings.qr} onChange={(e) => setFlyerSettings((v) => ({ ...v, qr: e.target.checked }))} /><span className="track" /><span className="knob" /></label>
                </div>
                <div className="rd-toggle-row"><span style={{ fontSize: 12, fontWeight: 600 }}>Show RSVP link text</span>
                  <label className="rd-switch"><input type="checkbox" checked={flyerSettings.rsvpLink} onChange={(e) => setFlyerSettings((v) => ({ ...v, rsvpLink: e.target.checked }))} /><span className="track" /><span className="knob" /></label>
                </div>
                <label className="rd-field-label" style={{ marginTop: 6 }}>QR placement</label>
                <select className="rr-select" value={flyerSettings.qrPosition} onChange={(e) => setFlyerSettings((v) => ({ ...v, qrPosition: e.target.value }))}>
                  {QR_POSITIONS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </div>
            </div>

            <div className="rd-panel">
              <div className="rd-panel-head"><h3>Photo</h3><p>Upload and position your cover photo</p></div>
              <div className="rd-panel-body">
                <input ref={coverFileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(e) => uploadFlyerPhoto(e.target.files?.[0])} />
                <button className="rr-btn secondary" disabled={coverBusy} onClick={() => coverFileRef.current?.click()}><Icon name="upload" size={13} /> {coverBusy ? 'Uploading…' : 'Upload photo'}</button>
                {CROP_SLIDERS.map((s) => (
                  <div key={s.key} style={{ marginTop: 10 }}>
                    <label className="rd-field-label">{s.label}</label>
                    <input type="range" min={s.min} max={s.max} value={imagePosition[s.key]} className="ds-slider" onChange={(e) => setImagePosition((v) => ({ ...v, [s.key]: Number(e.target.value) }))} />
                  </div>
                ))}
              </div>
            </div>

            <button className="rr-btn primary" disabled={designBusy} style={{ width: '100%', justifyContent: 'center' }} onClick={saveFlyerAndPassSettings}>{designBusy ? 'Saving…' : 'Save flyer settings'}</button>
          </div>

          <div className="ds-flyer-col">
            <div className="rd-panel">
              <div className="rd-panel-head"><h3>Preview</h3></div>
              <div className="rd-panel-body">
                <div className="ds-flyer-preview" style={design?.asset_config?.cover_image_url ? {
                  backgroundImage: `url(${design.asset_config.cover_image_url})`,
                  backgroundPosition: `${imagePosition.x}% ${imagePosition.y}%`,
                  backgroundSize: `${imagePosition.zoom}% auto`,
                  transform: `rotate(${imagePosition.rotate}deg)`,
                } : undefined}>
                  {!design?.asset_config?.cover_image_url && <><Icon name="image" size={26} /><span>Upload a photo to preview</span></>}
                </div>
                <div className="rd-row2" style={{ marginTop: 10 }}>
                  <button className="rr-btn secondary" disabled={renderBusy} style={{ flex: 1, justifyContent: 'center' }} onClick={() => renderFlyer('png', false)}>{renderBusy ? 'Rendering…' : 'Download PNG'}</button>
                  <button className="rr-btn secondary" disabled={renderBusy} style={{ flex: 1, justifyContent: 'center' }} onClick={() => renderFlyer('pdf', false)}>{renderBusy ? 'Rendering…' : 'Download PDF'}</button>
                </div>
                <button className="rr-btn primary" disabled={renderBusy} style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} onClick={() => renderFlyer(null, true)}>{renderBusy ? 'Rendering…' : 'Render & use as cover'}</button>
              </div>
            </div>

            <div className="rd-panel">
              <div className="rd-panel-head"><h3>Recent rendered files</h3></div>
              <div className="rd-panel-body">
                {outputs.map((f) => (
                  <div className="ds-recent-row" key={f.filename}>
                    <Icon name="file" size={13} /><span>{f.filename}</span><span className="rd-rowlink">{(f.format || '').toUpperCase()}</span>
                    <a className="rr-link-btn" href={f.url} target="_blank" rel="noreferrer">Download</a>
                  </div>
                ))}
                {!outputs.length && <p className="rd-rowlink">No files rendered yet.</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'Event Page' && (
        <div className="rd-wide-grid">
          <div className="rd-panel">
            <div className="rd-panel-head"><h3>Page sections</h3><p>What shows on the live guest-facing event page</p></div>
            <div className="rd-panel-body">
              <label className="rd-field-label">Hero</label>
              <div className="rd-toggle-row"><span style={{ fontSize: 12, fontWeight: 600 }}>Welcome label</span><label className="rd-switch"><input type="checkbox" checked={pageSections.hero.showWelcomeLabel} onChange={(e) => setPageSection('hero', 'showWelcomeLabel', e.target.checked)} /><span className="track" /><span className="knob" /></label></div>
              <div className="rd-toggle-row"><span style={{ fontSize: 12, fontWeight: 600 }}>Event title</span><label className="rd-switch"><input type="checkbox" checked={pageSections.hero.showTitle} onChange={(e) => setPageSection('hero', 'showTitle', e.target.checked)} /><span className="track" /><span className="knob" /></label></div>
              <div className="rd-toggle-row"><span style={{ fontSize: 12, fontWeight: 600 }}>Host name</span><label className="rd-switch"><input type="checkbox" checked={pageSections.hero.showHost} onChange={(e) => setPageSection('hero', 'showHost', e.target.checked)} /><span className="track" /><span className="knob" /></label></div>

              <label className="rd-field-label" style={{ marginTop: 12 }}>Organizer</label>
              <div className="rd-toggle-row"><span style={{ fontSize: 12, fontWeight: 600 }}>Show organizer line</span><label className="rd-switch"><input type="checkbox" checked={pageSections.organizer.show} onChange={(e) => setPageSection('organizer', 'show', e.target.checked)} /><span className="track" /><span className="knob" /></label></div>
              <input className="rd-field" placeholder="Label, e.g. Organized by" value={pageSections.organizer.label} onChange={(e) => setPageSection('organizer', 'label', e.target.value)} />

              <label className="rd-field-label" style={{ marginTop: 12 }}>Event details</label>
              <div className="rd-toggle-row"><span style={{ fontSize: 12, fontWeight: 600 }}>Venue</span><label className="rd-switch"><input type="checkbox" checked={pageSections.details.showVenue} onChange={(e) => setPageSection('details', 'showVenue', e.target.checked)} /><span className="track" /><span className="knob" /></label></div>
              <div className="rd-toggle-row"><span style={{ fontSize: 12, fontWeight: 600 }}>Hotel info</span><label className="rd-switch"><input type="checkbox" checked={pageSections.details.showHotel} onChange={(e) => setPageSection('details', 'showHotel', e.target.checked)} /><span className="track" /><span className="knob" /></label></div>
              <div className="rd-toggle-row"><span style={{ fontSize: 12, fontWeight: 600 }}>Host</span><label className="rd-switch"><input type="checkbox" checked={pageSections.details.showHost} onChange={(e) => setPageSection('details', 'showHost', e.target.checked)} /><span className="track" /><span className="knob" /></label></div>
              <div className="rd-toggle-row"><span style={{ fontSize: 12, fontWeight: 600 }}>Admission note</span><label className="rd-switch"><input type="checkbox" checked={pageSections.details.showAdmission} onChange={(e) => setPageSection('details', 'showAdmission', e.target.checked)} /><span className="track" /><span className="knob" /></label></div>

              <label className="rd-field-label" style={{ marginTop: 12 }}>About / custom CTA</label>
              <div className="rd-toggle-row"><span style={{ fontSize: 12, fontWeight: 600 }}>Show About section</span><label className="rd-switch"><input type="checkbox" checked={pageSections.about.show} onChange={(e) => setPageSection('about', 'show', e.target.checked)} /><span className="track" /><span className="knob" /></label></div>
              <input className="rd-field" placeholder="CTA label, e.g. Learn more" value={pageSections.about.ctaLabel} onChange={(e) => setPageSection('about', 'ctaLabel', e.target.value)} />
              <input className="rd-field" placeholder="CTA URL" value={pageSections.about.ctaUrl} onChange={(e) => setPageSection('about', 'ctaUrl', e.target.value)} />

              <div className="rd-hint" style={{ marginTop: 10 }}>Seating preview and FestioHub live feed are not part of the live guest page yet — no controls here affect them.</div>

              <div className="rd-row2" style={{ marginTop: 8 }}>
                <button className="rr-btn secondary" disabled title="Reset is not wired in the redesign yet" style={{ flex: 1, justifyContent: 'center' }}>Reset safe default</button>
                <button className="rr-btn primary" disabled={designBusy} style={{ flex: 1, justifyContent: 'center' }} onClick={savePageSettings}>{designBusy ? 'Saving…' : 'Save page settings'}</button>
              </div>
              <button className="rr-link-btn" disabled title="Draft preview remains on the legacy Design Studio during rollout" style={{ marginTop: 8 }}>Open true draft preview <Icon name="external" size={12} /></button>
            </div>
          </div>

          <div className="rd-panel">
            <div className="rd-panel-head ds-preview-head">
              <h3>Live preview</h3>
              <div className="rd-seg"><button className={!mobilePreview ? 'on' : ''} onClick={() => setMobilePreview(false)}>Desktop</button><button className={mobilePreview ? 'on' : ''} onClick={() => setMobilePreview(true)}>Mobile</button></div>
            </div>
            <div className="rd-panel-body">
              <div className={`ds-page-preview ${mobilePreview ? 'mobile' : ''}`}>
                <div className="ds-page-hero"><Icon name="calendar" size={20} /></div>
                <h3>Women's Convention 2026</h3>
                <p>Jul 11, 2026 · Masjid Mumineen</p>
                <button className="rr-btn primary" style={{ pointerEvents: 'none' }}>View live page</button>
                <div className="ds-feed-sample">
                  <div className="ds-feed-item"><Icon name="check" size={11} /> Event status set to Active</div>
                  <div className="ds-feed-item"><Icon name="upload" size={11} /> 612 guests imported</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'Festio Pass' && (
        <div className="rd-wide-grid">
          <div className="rd-panel">
            <div className="rd-panel-head"><h3>Pass wording</h3></div>
            <div className="rd-panel-body">
              <label className="rd-field-label">Admission wording</label>
              <textarea className="rr-textarea" rows={2} value={wording.admissionNote || ''} onChange={(e) => setWording((w) => ({ ...w, admissionNote: e.target.value }))} />
              <label className="rd-field-label" style={{ marginTop: 8 }}>Footer note</label>
              <input className="rd-field" value={wording.footerNote || ''} onChange={(e) => setWording((w) => ({ ...w, footerNote: e.target.value }))} />
              <label className="rd-field-label">FestioHub intro</label>
              <textarea className="rr-textarea" rows={2} defaultValue="Welcome! Tap below to see updates, your table, and more." disabled title="Not part of the saved design contract yet" />
              <div className="rd-hint">FestioHub intro text isn't part of the saved design record yet — the other fields on this tab are.</div>
              <div className="rd-toggle-row" style={{ marginTop: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>Show table/seat</span>
                <label className="rd-switch"><input type="checkbox" checked={passOptions.showTable && passOptions.showSeat} onChange={(e) => setPassOptions((v) => ({ ...v, showTable: e.target.checked, showSeat: e.target.checked }))} /><span className="track" /><span className="knob" /></label>
              </div>
              <div className="rd-toggle-row">
                <span style={{ fontSize: 12, fontWeight: 600 }}>Show FestioHub button</span>
                <label className="rd-switch"><input type="checkbox" checked={passOptions.showHubButton} onChange={(e) => setPassOptions((v) => ({ ...v, showHubButton: e.target.checked }))} /><span className="track" /><span className="knob" /></label>
              </div>
              <button className="rr-btn primary" disabled={designBusy} style={{ width: '100%', justifyContent: 'center', marginTop: 12 }} onClick={saveFlyerAndPassSettings}>{designBusy ? 'Saving…' : 'Save pass settings'}</button>
            </div>
          </div>
          <div className="rd-panel">
            <div className="rd-panel-head"><h3>Preview</h3><p>Illustrative — not a live-rendered pass</p></div>
            <div className="rd-panel-body">
              <div className="ds-pass-preview">
                <div className="ds-pass-top"><span>FESTIO PASS</span><Icon name="ticket" size={16} /></div>
                <strong>{wording.eventTitle || 'Your event'}</strong>
                <span>Sample Guest{(passOptions.showTable || passOptions.showSeat) && ' · Table 3, Seat 4'}</span>
                <div className="ds-pass-qr"><Icon name="grid" size={30} /></div>
                {wording.admissionNote && <p className="rd-rowlink" style={{ marginTop: 6 }}>{wording.admissionNote}</p>}
              </div>
              <button className="rr-btn secondary" disabled title="Pass regeneration remains on the legacy Design Studio during rollout" style={{ width: '100%', justifyContent: 'center', marginTop: 12 }}>Regenerate pass design</button>
            </div>
          </div>
        </div>
      )}

      {tab === 'Email Preview' && (
        <div className="rd-panel" style={{ maxWidth: 620 }}>
          <div className="rd-panel-head"><h3>Email preview</h3><p>Illustrative layout using your saved wording and colors — not a live-rendered template per type</p></div>
          <div className="rd-panel-body">
            <div className="rd-seg" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
              {EMAIL_TYPES.map((t) => <button key={t} className={emailType === t ? 'on' : ''} onClick={() => setEmailType(t)}>{t}</button>)}
            </div>
            <div className="ds-email-preview" style={{ background: colors.background, color: colors.text }}>
              <div className="ds-email-banner" style={{ background: colors.primary }}><Icon name="mail" size={20} /></div>
              <strong>{emailType === 'Invitation' ? `${wording.inviteLabel || "You're invited"}: ${wording.eventTitle || 'your event'}` : emailType === 'RSVP confirmation' ? "You're confirmed!" : emailType === 'Festio Pass email' ? 'Your Festio Pass is ready' : emailType === 'Reminder' ? `Don't forget — ${wording.eventTitle || 'your event'}` : emailType === 'Broadcast' ? 'An update from your organizer' : "You're checked in!"}</strong>
              <p>{[wording.date, wording.venue].filter(Boolean).join(' at ') || 'Date and venue not set yet'}</p>
              <button className="rr-btn primary" style={{ pointerEvents: 'none', background: colors.primary }}>{emailType === 'RSVP confirmation' || emailType === 'Check-in confirmation' ? 'View details' : 'RSVP now'}</button>
            </div>
          </div>
        </div>
      )}

      {tab === 'Publish' && (
        <div className="rd-wide-grid">
          <div className="rd-panel">
            <div className="rd-panel-head"><h3>Publish checklist</h3><p>{publishDone} of {publishChecklist.length} confirmed</p></div>
            <div className="rd-panel-body">
              <div className="ds-checklist">
                {publishChecklist.map((c) => (
                  <div className={`ds-check-row ${c.done ? 'done' : ''}`} key={c.label}>
                    <span className="ds-check-dot">{c.done && <Icon name="check" size={11} />}</span>
                    {c.label}
                  </div>
                ))}
              </div>
              <div className="ds-publish-status">
                <span className={`rd-status-chip ${design?.is_published ? 'ok' : 'warn'}`}>{design?.is_published ? 'Published' : 'Draft'}</span>
                {' '}{design?.updated_at ? `Saved ${new Date(design.updated_at).toLocaleString()}` : 'Not saved yet'}
                {design?.published_version ? ` · Published version ${design.published_version}` : ' · Never published'}
              </div>
              <button disabled={!eventId || designBusy || publishState === 'publishing'} className="rr-btn primary" style={{ width: '100%', justifyContent: 'center', marginTop: 14 }} onClick={() => setPublishState('confirm')}>
                {publishState === 'publishing' ? 'Publishing…' : design?.is_published ? 'Publish new version' : 'Publish design'}
              </button>
              {publishState === 'confirm' && (
                <Modal title="Publish this design?" onClose={() => setPublishState('idle')} width={400}>
                  <p style={{ marginBottom: 16 }}>This saves the current design as a new live version for guest-facing event pages and emails.</p>
                  <div className="rd-row2">
                    <button className="rr-btn secondary" onClick={() => setPublishState('idle')}>Cancel</button>
                    <button className="rr-btn primary" onClick={publishDesign}>Confirm publish</button>
                  </div>
                </Modal>
              )}
              {publishState === 'success' && (
                <div className="rd-banner-ok" style={{ marginTop: 10 }}>
                  <Icon name="check" /> Design published as version {design?.published_version}. <button className="rr-link-btn" style={{ marginLeft: 8 }} onClick={() => setPublishState('idle')}>Dismiss</button>
                </div>
              )}
              {publishState === 'error' && (
                <div className="rd-banner-err" style={{ marginTop: 10 }}>
                  <Icon name="warning" /> {publishError} <button className="rr-link-btn" style={{ marginLeft: 8 }} onClick={() => setPublishState('confirm')}>Retry</button>
                  <button className="rr-link-btn" style={{ marginLeft: 8 }} onClick={() => setPublishState('idle')}>Dismiss</button>
                </div>
              )}
              <p className="rd-hint" style={{ marginTop: 8 }}>Rollback is unavailable because the Design service has no rollback API. Publish a corrected version instead.</p>
              <p className="ds-gate-hint">Publishing requires an Event Pass. <a href="/billing-redesign">Upgrade to publish →</a></p>
            </div>
          </div>
          <div className="rd-panel">
            <div className="rd-panel-head"><h3>{activeTemplate?.name}</h3><p>{activeTemplate?.category} · {activeTemplate?.style}</p></div>
            <div className="rd-panel-body">
              <div className="ds-color-row" style={{ marginBottom: 12 }}>
                {COLOR_FIELDS.map((f) => <Swatch key={f.key} hex={colors[f.key]} />)}
              </div>
              <div className="ds-page-preview" style={{ marginBottom: 10 }}>
                <div className="ds-page-hero"><Icon name="calendar" size={18} /></div>
                <h3 style={{ fontSize: 13 }}>{wording.eventTitle || 'Your event'}</h3>
              </div>
              <div className="ds-pass-preview" style={{ padding: 12 }}>
                <div className="ds-pass-top"><span>FESTIO PASS</span></div>
                <strong style={{ fontSize: 12 }}>Preview</strong>
              </div>
              <div className="rd-hint" style={{ marginTop: 10 }}>{outputs.length} rendered output{outputs.length === 1 ? '' : 's'} available</div>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="rd-toast"><Icon name="check" />{toast}</div>}
    </RedesignShell>
  )
}
