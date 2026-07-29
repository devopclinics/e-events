import { useEffect, useState } from 'react'
import RedesignShell, { Icon, Modal } from './redesign/RedesignShell'
import { useCurrentEvent } from '../hooks/useCurrentEvent'
import { api } from '../api'
import './DesignStudioRedesignPage.css'

const TABS = ['Templates', 'Event Page', 'Publish']

const TEMPLATE_CATEGORIES = ['All', 'Wedding', 'Community', 'Conference', 'Celebration']
const TEMPLATE_STYLES = ['All styles', 'Warm', 'Minimal', 'Dark', 'Playful']

const TEMPLATES = [
  { name: 'Botanical Gold', category: 'Wedding', style: 'Warm', tier: 'premium', tone: 'Warm, floral', selected: true, surfaces: ['Event Page', 'Flyer', 'Pass', 'Email'] },
  { name: 'Modern Mono', category: 'Conference', style: 'Minimal', tier: 'free', tone: 'Minimal, high-contrast', selected: false, surfaces: ['Event Page', 'Flyer', 'Email'] },
  { name: 'Midnight Celebration', category: 'Celebration', style: 'Dark', tier: 'premium', tone: 'Dark, elegant', selected: false, surfaces: ['Event Page', 'Flyer', 'Pass', 'Email'] },
  { name: 'Community Classic', category: 'Community', style: 'Warm', tier: 'free', tone: 'Friendly, accessible', selected: false, surfaces: ['Event Page', 'Flyer'] },
]

const FLYER_TEMPLATES = ['Classic Poster', 'Photo Banner', 'Minimal Card', 'Bold Type']

const WORDING_FIELDS = [
  { key: 'headline', label: 'Headline', value: "Women's Convention 2026" },
  { key: 'subheadline', label: 'Subheadline', value: 'A day of connection, learning, and community' },
  { key: 'dateLine', label: 'Date line', value: 'Saturday, July 11, 2026' },
  { key: 'venueLine', label: 'Venue line', value: 'Masjid Mumineen · Doors at 9:00 AM' },
  { key: 'ctaLabel', label: 'RSVP button label', value: 'Reserve your seat' },
  { key: 'footerNote', label: 'Footer note', value: 'Free admission · Limited seating' },
]

const FLYER_COLORS = [
  { key: 'primary', label: 'Primary', value: '#b6672f' },
  { key: 'secondary', label: 'Secondary', value: '#2c2318' },
  { key: 'accent', label: 'Accent', value: '#4a8a63' },
  { key: 'background', label: 'Background', value: '#faf6ee' },
  { key: 'text', label: 'Text', value: '#211a13' },
]

const FONT_PAIRINGS = ['Playfair + Inter', 'Space Grotesk + Inter', 'Fraunces + Karla', 'Poppins + Poppins']

const CROP_SLIDERS = [
  { key: 'x', label: 'Horizontal position', value: 50 },
  { key: 'y', label: 'Vertical position', value: 40 },
  { key: 'zoom', label: 'Zoom', value: 110 },
  { key: 'rotate', label: 'Rotate', value: 0 },
]

const RECENT_FILES = [
  { name: 'flyer-v3.png', size: '1.2 MB', when: '2 hours ago' },
  { name: 'flyer-v2.pdf', size: '840 KB', when: 'Yesterday' },
]

const PAGE_MODULES = [
  { key: 'hero', label: 'Hero banner', visible: true, requires: null },
  { key: 'organizer', label: 'Organizer info', visible: true, requires: null },
  { key: 'details', label: 'Event details', visible: true, requires: null },
  { key: 'about', label: 'About / custom CTA', visible: true, requires: null },
  { key: 'seating', label: 'Seating preview', visible: false, requires: 'Seating add-on' },
  { key: 'feed', label: 'FestioHub live feed', visible: true, requires: 'FestioHub enabled' },
]

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
  const [modules, setModules] = useState(PAGE_MODULES)
  const [mobilePreview, setMobilePreview] = useState(false)
  const [publishState, setPublishState] = useState('idle') // idle | confirm | publishing | success | error
  const [publishError, setPublishError] = useState('')
  const [design, setDesign] = useState(null)
  const [outputs, setOutputs] = useState([])
  const [designBusy, setDesignBusy] = useState(false)

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
      if (saved.page_config?.modules) {
        setModules((current) => current.map((module) => ({
          ...module,
          visible: saved.page_config.modules[module.key] ?? module.visible,
        })))
      }
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
        page_config: {
          ...(design?.page_config || {}),
          modules: Object.fromEntries(modules.map((module) => [module.key, module.visible])),
        },
      })
      setDesign(saved)
      notify('Page settings saved')
    } catch (e) {
      notify(e.message || 'Page settings could not be saved')
    } finally {
      setDesignBusy(false)
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

  function toggleModule(key) {
    setModules((prev) => prev.map((m) => (m.key === key ? { ...m, visible: !m.visible } : m)))
  }

  function moveModule(key, dir) {
    setModules((prev) => {
      const idx = prev.findIndex((m) => m.key === key)
      const next = [...prev]
      const swapWith = idx + dir
      if (swapWith < 0 || swapWith >= next.length) return prev
      ;[next[idx], next[swapWith]] = [next[swapWith], next[idx]]
      return next
    })
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
                {FLYER_TEMPLATES.map((f) => (
                  <button key={f} className="ds-flyer-tpl-chip" onClick={() => notify(`${f} flyer layout selected`)}>{f}</button>
                ))}
              </div>
            </div>

            <div className="rd-panel">
              <div className="rd-panel-head"><h3>Wording</h3></div>
              <div className="rd-panel-body">
                {WORDING_FIELDS.map((f) => (
                  <div key={f.key} style={{ marginBottom: 9 }}>
                    <label className="rd-field-label">{f.label}</label>
                    <input className="rd-field" style={{ marginBottom: 0 }} defaultValue={f.value} onChange={() => notify(`${f.label} updated`)} />
                  </div>
                ))}
              </div>
            </div>

            <div className="rd-panel">
              <div className="rd-panel-head"><h3>Colors &amp; type</h3></div>
              <div className="rd-panel-body">
                <div className="ds-color-row">
                  {FLYER_COLORS.map((c) => (
                    <label key={c.key} className="ds-color-swatch-label">
                      <input type="color" defaultValue={c.value} onChange={() => notify(`${c.label} color updated`)} />
                      <span>{c.label}</span>
                    </label>
                  ))}
                </div>
                <label className="rd-field-label" style={{ marginTop: 10 }}>Font pairing</label>
                <select className="rr-select" onChange={(e) => notify(`Font pairing set to ${e.target.value}`)}>
                  {FONT_PAIRINGS.map((f) => <option key={f}>{f}</option>)}
                </select>
                <label className="rd-field-label" style={{ marginTop: 8 }}>Flyer text size</label>
                <select className="rr-select"><option>Small</option><option>Medium</option><option>Large</option></select>
              </div>
            </div>

            <div className="rd-panel">
              <div className="rd-panel-head"><h3>QR &amp; RSVP link</h3></div>
              <div className="rd-panel-body">
                <div className="rd-toggle-row"><span style={{ fontSize: 12, fontWeight: 600 }}>Show QR code</span>
                  <label className="rd-switch"><input type="checkbox" defaultChecked /><span className="track" /><span className="knob" /></label>
                </div>
                <div className="rd-toggle-row"><span style={{ fontSize: 12, fontWeight: 600 }}>Show RSVP link text</span>
                  <label className="rd-switch"><input type="checkbox" defaultChecked /><span className="track" /><span className="knob" /></label>
                </div>
                <label className="rd-field-label" style={{ marginTop: 6 }}>QR placement</label>
                <select className="rr-select"><option>Bottom right</option><option>Bottom center</option><option>Top right</option></select>
              </div>
            </div>

            <div className="rd-panel">
              <div className="rd-panel-head"><h3>Photo</h3><p>Upload and position your cover photo</p></div>
              <div className="rd-panel-body">
                <button className="rr-btn secondary" onClick={() => notify('Photo uploaded')}><Icon name="upload" size={13} /> Upload photo</button>
                {CROP_SLIDERS.map((s) => (
                  <div key={s.key} style={{ marginTop: 10 }}>
                    <label className="rd-field-label">{s.label}</label>
                    <input type="range" min="0" max="150" defaultValue={s.value} className="ds-slider" onChange={() => notify(`${s.label} adjusted`)} />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="ds-flyer-col">
            <div className="rd-panel">
              <div className="rd-panel-head"><h3>Preview</h3></div>
              <div className="rd-panel-body">
                <div className="ds-flyer-preview">
                  <Icon name="image" size={26} />
                  <span>Flyer preview</span>
                </div>
                <div className="rd-row2" style={{ marginTop: 10 }}>
                  <button className="rr-btn secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => notify('Downloaded flyer as PNG')}>Download PNG</button>
                  <button className="rr-btn secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => notify('Downloaded flyer as PDF')}>Download PDF</button>
                </div>
                <button className="rr-btn primary" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} onClick={() => notify('Flyer set as event cover image')}>Download &amp; use as cover</button>
              </div>
            </div>

            <div className="rd-panel">
              <div className="rd-panel-head"><h3>Recent rendered files</h3></div>
              <div className="rd-panel-body">
                {RECENT_FILES.map((f) => (
                  <div className="ds-recent-row" key={f.name}>
                    <Icon name="file" size={13} /><span>{f.name}</span><span className="rd-rowlink">{f.size} · {f.when}</span>
                    <button className="rr-link-btn" onClick={() => notify(`Downloaded ${f.name}`)}>Download</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'Event Page' && (
        <div className="rd-wide-grid">
          <div className="rd-panel">
            <div className="rd-panel-head"><h3>Page sections</h3><p>Reorder, toggle, and gate modules by add-on</p></div>
            <div className="rd-panel-body">
              {modules.map((m, i) => (
                <div className="ds-module-row" key={m.key}>
                  <span className="ds-module-drag"><Icon name="more" size={13} /></span>
                  <div className="ds-module-updown">
                    <button onClick={() => moveModule(m.key, -1)} disabled={i === 0}>▲</button>
                    <button onClick={() => moveModule(m.key, 1)} disabled={i === modules.length - 1}>▼</button>
                  </div>
                  <span className="ds-module-label">{m.label}{m.requires && <small> — requires {m.requires}</small>}</span>
                  <label className="rd-switch"><input type="checkbox" checked={m.visible} onChange={() => toggleModule(m.key)} disabled={!!m.requires && m.key === 'seating'} /><span className="track" /><span className="knob" /></label>
                </div>
              ))}
              <label className="rd-field-label" style={{ marginTop: 12 }}>About / custom CTA</label>
              <input className="rd-field" placeholder="CTA label, e.g. Learn more" defaultValue="Learn more about our mission" />
              <input className="rd-field" placeholder="CTA URL" defaultValue="https://ourorg.example.com" />
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
              <textarea className="rr-textarea" rows={2} defaultValue="Present this pass at the door for entry." />
              <label className="rd-field-label" style={{ marginTop: 8 }}>Footer note</label>
              <input className="rd-field" defaultValue="Questions? Reply to this email." />
              <label className="rd-field-label">FestioHub intro</label>
              <textarea className="rr-textarea" rows={2} defaultValue="Welcome! Tap below to see updates, your table, and more." />
              <div className="rd-toggle-row" style={{ marginTop: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>Show table/seat</span>
                <label className="rd-switch"><input type="checkbox" defaultChecked /><span className="track" /><span className="knob" /></label>
              </div>
              <div className="rd-toggle-row">
                <span style={{ fontSize: 12, fontWeight: 600 }}>Show FestioHub button</span>
                <label className="rd-switch"><input type="checkbox" checked={passHasPass} onChange={(e) => setPassHasPass(e.target.checked)} /><span className="track" /><span className="knob" /></label>
              </div>
            </div>
          </div>
          <div className="rd-panel">
            <div className="rd-panel-head"><h3>Preview</h3></div>
            <div className="rd-panel-body">
              <div className="ds-pass-preview">
                <div className="ds-pass-top"><span>FESTIO PASS</span><Icon name="ticket" size={16} /></div>
                <strong>Women's Convention 2026</strong>
                <span>Aaliyah Guest0002{passHasPass && ' · Table 3, Seat 4'}</span>
                <div className="ds-pass-qr"><Icon name="grid" size={30} /></div>
              </div>
              <button className="rr-btn secondary" disabled title="Pass regeneration remains on the legacy Design Studio during rollout" style={{ width: '100%', justifyContent: 'center', marginTop: 12 }}>Regenerate pass design</button>
            </div>
          </div>
        </div>
      )}

      {tab === 'Email Preview' && (
        <div className="rd-panel" style={{ maxWidth: 620 }}>
          <div className="rd-panel-head"><h3>Email preview</h3><p>Rendered with your selected template</p></div>
          <div className="rd-panel-body">
            <div className="rd-seg" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
              {EMAIL_TYPES.map((t) => <button key={t} className={emailType === t ? 'on' : ''} onClick={() => setEmailType(t)}>{t}</button>)}
            </div>
            <div className="ds-email-preview">
              <div className="ds-email-banner"><Icon name="mail" size={20} /></div>
              <strong>{emailType === 'Invitation' ? "You're invited: Women's Convention 2026" : emailType === 'RSVP confirmation' ? "You're confirmed!" : emailType === 'Festio Pass email' ? 'Your Festio Pass is ready' : emailType === 'Reminder' ? "Don't forget — Women's Convention 2026" : emailType === 'Broadcast' ? 'An update from your organizer' : 'You\'re checked in!'}</strong>
              <p>Join us Jul 11, 2026 at Masjid Mumineen.</p>
              <button className="rr-btn primary" style={{ pointerEvents: 'none' }}>{emailType === 'RSVP confirmation' || emailType === 'Check-in confirmation' ? 'View details' : 'RSVP now'}</button>
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
                {FLYER_COLORS.map((c) => <Swatch key={c.key} hex={c.value} />)}
              </div>
              <div className="ds-page-preview" style={{ marginBottom: 10 }}>
                <div className="ds-page-hero"><Icon name="calendar" size={18} /></div>
                <h3 style={{ fontSize: 13 }}>Women's Convention 2026</h3>
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
