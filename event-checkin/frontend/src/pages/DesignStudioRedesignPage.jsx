import { useEffect, useRef, useState } from 'react'
import RedesignShell, { Icon, Modal } from './redesign/RedesignShell'
import { useCurrentEvent } from '../hooks/useCurrentEvent'
import { useEventDetails } from '../hooks/useEventDetails'
import { api } from '../api'
import './DesignStudioRedesignPage.css'

const TABS = ['Templates', 'Flyer', 'Event Page', 'Festio Pass', 'FestioHub', 'Email Preview', 'Publish']

// FestioHub layout styles — arrangements of the real Hub modules (guest_pass,
// next_action, activity_progress, live_program, festiome, messages read by
// InvitePage.jsx's GuestHub component via designTheme.hub_layout). The choice
// is saved for real via theme_config.hubStyle; live per-style guest-facing
// rendering in GuestHub itself is a separate follow-up — see rd-hint copy
// on this tab.
const HUB_STYLES = [
  { id: 'wallet-pass', name: 'Wallet Pass', tagline: 'Pass-first, native-app feel', bestFor: 'Best when guests need their QR fast, at the door.' },
  { id: 'card-dashboard', name: 'Card Dashboard', tagline: 'Everything visible at once', bestFor: 'No tabs to learn — every module as its own card.' },
  { id: 'story-feed', name: 'Story Feed', tagline: 'Community-first', bestFor: 'Best for events leaning on FestioMe engagement.' },
  { id: 'timeline', name: 'Timeline', tagline: 'Guided, chronological', bestFor: 'Reassuring for first-time or formal-event guests.' },
  { id: 'minimal-list', name: 'Minimal List', tagline: 'Utility-first, fastest to scan', bestFor: 'For guests who just want in and out.' },
]

const TEMPLATE_CATEGORIES = ['All', 'Wedding', 'Community', 'Conference', 'Celebration']
const TEMPLATE_STYLES = ['All styles', 'Warm', 'Minimal', 'Dark', 'Playful']

// Maps a surface label (from the API or mock data, case-insensitive) to the
// Design Studio tab that previews it. Clicking a chip on a template card
// selects that template and jumps straight to its surface preview.
const SURFACE_TAB = {
  'rsvp page': 'Event Page',
  'event page': 'Event Page',
  'rsvp_page': 'Event Page',
  'event_page': 'Event Page',
  'flyer': 'Flyer',
  'festiohub': 'FestioHub',
  'festio hub': 'FestioHub',
  'festio_hub': 'FestioHub',
  'festio pass': 'Festio Pass',
  'festio_pass': 'Festio Pass',
  'pass': 'Festio Pass',
  'email': 'Email Preview',
}

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

// A representative-looking 7x7 QR pattern for the illustrative pass preview —
// each real guest's actual pass carries their own unique token, this is only
// here so the preview reads as "a QR code" at a glance.
const QR_ON_INDEXES = new Set([0, 1, 2, 3, 6, 7, 9, 11, 13, 14, 16, 18, 20, 21, 24, 27, 28, 30, 32, 34, 36, 39, 41, 42, 43, 45, 48])
const QR_SAMPLE_PATTERN = Array.from({ length: 49 }, (_, i) => QR_ON_INDEXES.has(i))

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

function humanizeKey(value) {
  if (!value) return '—'
  return String(value).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export default function DesignStudioRedesignPage() {
  const [eventId] = useCurrentEvent()
  const { event } = useEventDetails(eventId)
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
  const [hubStyle, setHubStyle] = useState(HUB_STYLES[0].id)
  const [hubStyleBusy, setHubStyleBusy] = useState(false)
  const coverFileRef = useRef(null)

  // Live flyer preview: a real server render (same engine the download
  // buttons use), debounced on every edit, with preview:true so the
  // design-service skips persisting a file — a live preview shouldn't
  // clutter "Recent rendered files" with a new row per keystroke.
  const [flyerPreviewUrl, setFlyerPreviewUrl] = useState('')
  const [flyerPreviewLoading, setFlyerPreviewLoading] = useState(false)
  const [flyerPreviewError, setFlyerPreviewError] = useState('')
  const flyerPreviewTimerRef = useRef(null)
  const flyerPreviewObjectUrlRef = useRef('')

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
      setHubStyle(saved.theme_config?.hubStyle || HUB_STYLES[0].id)
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

  // a5/a4 are print-only sizes (design-service serves them as PDF, never
  // PNG) — there's no honest way to show those inline, so the live preview
  // only covers the three PNG-native sizes and says so for the other two.
  const flyerPreviewSupported = ['square', 'story', 'portrait'].includes(flyerSettings.size)

  useEffect(() => {
    if (tab !== 'Flyer' || !eventId || !flyerPreviewSupported) return undefined
    clearTimeout(flyerPreviewTimerRef.current)
    flyerPreviewTimerRef.current = setTimeout(async () => {
      setFlyerPreviewLoading(true)
      setFlyerPreviewError('')
      try {
        const { blob } = await api.renderFlyer(eventId, {
          size: flyerSettings.size,
          format: 'png',
          template_id: selectedFlyerTplId || undefined,
          colors,
          wording,
          cover_image_url: design?.asset_config?.cover_image_url || undefined,
          image_position: imagePosition,
          text_scale: flyerTextScale,
          qr_enabled: flyerSettings.qr,
          qr_position: flyerSettings.qrPosition,
          qr_data: flyerSettings.qr && flyerSettings.rsvpLink ? `https://festio.events/invite/${eventId}` : null,
          preview: true,
        }, { download: false })
        if (flyerPreviewObjectUrlRef.current) URL.revokeObjectURL(flyerPreviewObjectUrlRef.current)
        const url = URL.createObjectURL(blob)
        flyerPreviewObjectUrlRef.current = url
        setFlyerPreviewUrl(url)
      } catch (e) {
        setFlyerPreviewError(e.message || 'Live preview is temporarily unavailable — the download buttons still render the real file.')
      } finally {
        setFlyerPreviewLoading(false)
      }
    }, 900)
    return () => clearTimeout(flyerPreviewTimerRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, eventId, flyerPreviewSupported, flyerSettings.size, flyerSettings.qr, flyerSettings.qrPosition, flyerSettings.rsvpLink,
      selectedFlyerTplId, colors, wording, imagePosition, flyerTextScale, design?.asset_config?.cover_image_url])

  useEffect(() => () => { if (flyerPreviewObjectUrlRef.current) URL.revokeObjectURL(flyerPreviewObjectUrlRef.current) }, [])

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

  async function savePageSettings(nextSections = pageSections) {
    if (!eventId || designBusy) return
    setDesignBusy(true)
    try {
      const saved = await api.saveEventDesign(eventId, {
        selected_template_id: design?.selected_template_id || activeTemplate?.id || null,
        selected_flyer_template_id: design?.selected_flyer_template_id || null,
        theme_config: design?.theme_config || {},
        wording_config: design?.wording_config || {},
        asset_config: design?.asset_config || {},
        page_config: nextSections,
      })
      setDesign(saved)
      notify('Page settings saved')
    } catch (e) {
      notify(e.message || 'Page settings could not be saved')
    } finally {
      setDesignBusy(false)
    }
  }

  async function resetPageSettings() {
    const next = {
      hero: { ...DEFAULT_PAGE_SECTIONS.hero },
      organizer: { ...DEFAULT_PAGE_SECTIONS.organizer },
      details: { ...DEFAULT_PAGE_SECTIONS.details },
      about: { ...DEFAULT_PAGE_SECTIONS.about },
    }
    setPageSections(next)
    await savePageSettings(next)
  }

  const activeTemplate = templates.find((t) => t.selected)

  function buildDraftTheme() {
    // template_id/layout/button_style only matter to the Event Page/Flyer/Pass
    // surfaces — FestioHub's preview needs none of them, so this stays valid
    // (falls back like design-service's own default_template() would) even
    // before an organizer has picked a template.
    return {
      event_id: eventId,
      template_id: activeTemplate?.id || null,
      is_default: !activeTemplate,
      colors,
      font_pairing: fontPairing,
      button_style: design?.theme_config?.buttonStyle || activeTemplate?.buttonStyle || 'square',
      layout: activeTemplate?.layout || {},
      cover_image_url: design?.asset_config?.cover_image_url || '',
      flyer_image_url: design?.asset_config?.flyer_image_url || '',
      wording,
      pass_options: passOptions,
      page_config: pageSections,
      hub_style: hubStyle,
    }
  }

  function syncDraftPreviewStorage() {
    if (!eventId) return false
    try {
      sessionStorage.setItem(`festio:design-preview:${eventId}`, JSON.stringify({ event_id: eventId, theme: buildDraftTheme(), saved_at: Date.now() }))
      return true
    } catch {
      return false
    }
  }

  function openDraftPreview(anchor = '') {
    if (!eventId) {
      notify('Select a supported design first')
      return
    }
    if (syncDraftPreviewStorage()) {
      window.open(`/invite/${eventId}?studio-preview=1${anchor}`, '_blank', 'noopener')
    } else {
      notify('Could not open the draft preview. Allow pop-ups and try again.')
    }
  }

  // Inline "Live preview" iframe (Event Page tab): reuses the same
  // sessionStorage handoff as openDraftPreview() above, but keeps it synced
  // as you edit instead of requiring a manual "open in new tab" click each
  // time. First sync per event/template is immediate so the iframe never
  // flashes the published page before the draft; edits after that are
  // debounced so typing doesn't reload the iframe on every keystroke.
  const [eventPagePreviewNonce, setEventPagePreviewNonce] = useState(0)
  const eventPageSyncedRef = useRef(false)
  const eventPagePreviewTimerRef = useRef(null)

  useEffect(() => { eventPageSyncedRef.current = false }, [eventId])

  useEffect(() => {
    if (tab !== 'Event Page' && tab !== 'FestioHub') return undefined
    if (!eventId || (tab === 'Event Page' && !activeTemplate)) return undefined
    const delay = eventPageSyncedRef.current ? 700 : 0
    clearTimeout(eventPagePreviewTimerRef.current)
    eventPagePreviewTimerRef.current = setTimeout(() => {
      if (syncDraftPreviewStorage()) {
        eventPageSyncedRef.current = true
        setEventPagePreviewNonce((n) => n + 1)
      }
    }, delay)
    return () => clearTimeout(eventPagePreviewTimerRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, eventId, activeTemplate?.id, colors, fontPairing, wording, passOptions, pageSections, hubStyle,
      design?.asset_config?.cover_image_url, design?.asset_config?.flyer_image_url])

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

  async function selectHubStyle(styleId) {
    setHubStyle(styleId)
    if (!eventId) return
    setHubStyleBusy(true)
    try {
      const saved = await api.saveEventDesign(eventId, {
        selected_template_id: design?.selected_template_id || null,
        selected_flyer_template_id: design?.selected_flyer_template_id || null,
        theme_config: { ...(design?.theme_config || {}), hubStyle: styleId },
        wording_config: design?.wording_config || {},
        asset_config: design?.asset_config || {},
        page_config: design?.page_config || {},
      })
      setDesign(saved)
      notify(`${HUB_STYLES.find((s) => s.id === styleId)?.name || 'FestioHub style'} saved`)
    } catch (e) { notify(e.message || 'FestioHub style could not be saved') }
    finally { setHubStyleBusy(false) }
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
    <RedesignShell topActive="design" withEventSidebar={false} eventScoped>
      <div className="rr-pagehead">
        <div>
          <div className="rr-title-row"><h1>Design Studio</h1></div>
          <div className="rr-meta"><Icon name="calendar" size={13} /> {event?.name || (eventId ? 'Loading…' : 'No event selected')} <span className="rr-dot">·</span> Template: {activeTemplate?.name || 'None'}</div>
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
            <div className="rd-search" style={{ flex: 1, minWidth: 180 }}>
              <Icon name="search" size={14} />
              <input placeholder="Search templates…" value={tplQuery} onChange={(e) => setTplQuery(e.target.value)} />
            </div>
            <select className="rr-select" style={{ flex: '0 0 auto' }} value={tplCategory} onChange={(e) => setTplCategory(e.target.value)}>
              {TEMPLATE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
            <select className="rr-select" style={{ flex: '0 0 auto' }} value={tplStyle} onChange={(e) => setTplStyle(e.target.value)}>
              {TEMPLATE_STYLES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>

          <div className="ds-templates-layout">
            <div className="ds-tpl-grid">
              {filteredTemplates.map((t) => (
                <div className={`rr-panel ds-template-card ${t.selected ? 'selected' : ''}`} key={t.name} onClick={() => setPreviewTpl(t)}>
                  {t.thumbnailUrl ? (
                    <div className="ds-template-swatch ds-template-swatch-image" style={{ backgroundImage: `url(${t.thumbnailUrl})` }} />
                  ) : (
                    <div
                      className="ds-template-swatch"
                      style={t.defaultColors ? { background: `linear-gradient(145deg, ${t.defaultColors.background}, ${t.defaultColors.surface})`, color: t.defaultColors.accent || t.defaultColors.primary } : undefined}
                    >
                      <Icon name="palette" size={22} />
                    </div>
                  )}
                  <div className="ds-template-badges">
                    <span className={`ds-tier-badge ${t.tier}`}>{t.tier === 'premium' ? 'Premium' : 'Free'}</span>
                    {t.selected && <span className="rr-pill live"><i /> Active</span>}
                  </div>
                  <strong>{t.name}</strong>
                  <span>{t.tone}</span>
                  <div className="ds-surface-chips">
                    {t.surfaces.map((s) => {
                      const targetTab = SURFACE_TAB[s.toLowerCase()]
                      return (
                        <button
                          key={s}
                          className="rd-chip ds-surface-chip"
                          title={`Preview ${s}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            setPreviewTpl(t)
                            if (targetTab) setTab(targetTab)
                          }}
                        >{s}</button>
                      )
                    })}
                  </div>
                  <div className="rd-row2">
                    <button className="rr-btn secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={(e) => { e.stopPropagation(); setPreviewTpl(t) }}>Preview</button>
                    {!t.selected && <button disabled={designBusy} className="rr-btn primary" style={{ flex: 1, justifyContent: 'center' }} onClick={(e) => { e.stopPropagation(); selectTemplate(t) }}>{designBusy ? 'Saving…' : 'Select'}</button>}
                  </div>
                </div>
              ))}
            </div>

            <div className="rd-panel ds-side-preview">
              <div className="rd-panel-head"><h3>Preview</h3><p>{previewTpl?.name || 'Choose a template'}</p></div>
              {previewTpl ? (
                <div className="rd-panel-body">
                  <div
                    className="ds-template-hero"
                    style={{ background: `linear-gradient(145deg, ${previewTpl.defaultColors?.background || '#e2e8f0'}, ${previewTpl.defaultColors?.surface || '#f8fafc'})` }}
                  >
                    {previewTpl.thumbnailUrl && <img src={previewTpl.thumbnailUrl} alt="" className="ds-template-hero-image" loading="lazy" />}
                    <div className="ds-template-hero-caption">
                      <strong style={{ color: previewTpl.thumbnailUrl ? '#fff' : (previewTpl.defaultColors?.primary || '#0f172a') }}>{previewTpl.name}</strong>
                      <span style={{ color: previewTpl.thumbnailUrl ? '#fff' : (previewTpl.defaultColors?.accent || '#14b8a6') }}>{previewTpl.style}</span>
                    </div>
                  </div>
                  {previewTpl.defaultColors && (
                    <div className="ds-color-row" style={{ marginTop: 10 }}>
                      {['primary', 'accent', 'background', 'surface', 'text'].map((k) => <Swatch key={k} hex={previewTpl.defaultColors[k]} />)}
                    </div>
                  )}
                  <div className="ds-layout-grid">
                    <div><strong>Event page</strong><span>{humanizeKey(previewTpl.layout?.eventPage)}</span></div>
                    <div><strong>Flyer</strong><span>{humanizeKey(previewTpl.layout?.flyer)}</span></div>
                    <div><strong>Festio Pass</strong><span>{humanizeKey(previewTpl.layout?.pass)}</span></div>
                    <div><strong>Email</strong><span>{humanizeKey(previewTpl.layout?.email)}</span></div>
                  </div>
                  {!previewTpl.selected && (
                    <button disabled={designBusy} className="rr-btn primary" style={{ width: '100%', justifyContent: 'center', marginTop: 12 }} onClick={() => selectTemplate(previewTpl)}>
                      {designBusy ? 'Saving…' : 'Use this family'}
                    </button>
                  )}
                </div>
              ) : (
                <div className="rd-panel-body"><p className="rd-rowlink">Preview a card to see its surfaces, colors, and layout rules.</p></div>
              )}
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
              <div className="rd-panel-head"><h3>Preview</h3><p>{flyerPreviewSupported ? 'Live — the exact file the download buttons produce' : 'Print sizes render as PDF only — download to check'}</p></div>
              <div className="rd-panel-body">
                <div className="ds-flyer-preview">
                  {!flyerPreviewSupported ? (
                    <><Icon name="file" size={26} /><span>No inline preview for {FLYER_SIZES.find((s) => s.id === flyerSettings.size)?.label || flyerSettings.size} — it's a print PDF.</span></>
                  ) : flyerPreviewUrl ? (
                    <img src={flyerPreviewUrl} alt="Live flyer preview" className={`ds-flyer-preview-img${flyerPreviewLoading ? ' loading' : ''}`} />
                  ) : flyerPreviewLoading ? (
                    <span>Rendering preview…</span>
                  ) : flyerPreviewError ? (
                    <span className="ds-flyer-preview-error">{flyerPreviewError}</span>
                  ) : (
                    <><Icon name="image" size={26} /><span>Preview renders after your first edit</span></>
                  )}
                  {flyerPreviewUrl && flyerPreviewLoading && <div className="ds-flyer-preview-spinner">Updating…</div>}
                </div>
                {flyerPreviewUrl && flyerPreviewError && <p className="rd-hint" style={{ marginTop: 6 }}>{flyerPreviewError}</p>}
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
                <button className="rr-btn secondary" disabled={designBusy} style={{ flex: 1, justifyContent: 'center' }} onClick={resetPageSettings}>Reset safe default</button>
                <button className="rr-btn primary" disabled={designBusy} style={{ flex: 1, justifyContent: 'center' }} onClick={() => savePageSettings()}>{designBusy ? 'Saving…' : 'Save page settings'}</button>
              </div>
              <button className="rr-link-btn" onClick={openDraftPreview} style={{ marginTop: 8 }}>Open in a full tab <Icon name="external" size={12} /></button>
            </div>
          </div>

          <div className="rd-panel">
            <div className="rd-panel-head ds-preview-head">
              <div><h3>Live preview</h3><p>The real event page, rendered with your unsaved edits</p></div>
              <div className="rd-seg"><button className={!mobilePreview ? 'on' : ''} onClick={() => setMobilePreview(false)}>Desktop</button><button className={mobilePreview ? 'on' : ''} onClick={() => setMobilePreview(true)}>Mobile</button></div>
            </div>
            <div className="rd-panel-body">
              {!eventId || !activeTemplate ? (
                <div className="ds-page-preview"><Icon name="calendar" size={20} /><span>Select a template to preview the live page.</span></div>
              ) : (
                <div className={`ds-page-preview-frame-wrap ${mobilePreview ? 'mobile' : ''}`}>
                  <iframe
                    key={eventId}
                    src={eventPagePreviewNonce > 0 ? `/invite/${eventId}?studio-preview=1&_p=${eventPagePreviewNonce}` : undefined}
                    title="Live event page preview"
                    className="ds-page-preview-frame"
                  />
                </div>
              )}
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
              <textarea className="rr-textarea" rows={2} value={wording.customMessage || ''} placeholder="Welcome! Tap below to see updates, your table, and more." onChange={(e) => setWording((value) => ({ ...value, customMessage: e.target.value }))} />
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
            <div className="rd-panel-head"><h3>Preview</h3><p>Sample guest — your real colors, wording, and photo</p></div>
            <div className="rd-panel-body">
              <div className="ds-pass-card">
                <div className="ds-pass-card-cover" style={{ backgroundImage: design?.asset_config?.cover_image_url ? `url(${design.asset_config.cover_image_url})` : `linear-gradient(135deg, ${colors.background}, ${colors.accent})` }} />
                <div className="ds-pass-card-body">
                  <div className="ds-pass-card-kicker">Festio Pass</div>
                  <strong>{wording.eventTitle || 'Your event'}</strong>
                  <span>{[wording.date, wording.time].filter(Boolean).join(' · ') || 'Date and time not set yet'}</span>
                  {(passOptions.showTable || passOptions.showSeat) && (
                    <div className="ds-pass-card-pill">{[passOptions.showTable && 'Table VIP-2', passOptions.showSeat && 'Seat 4'].filter(Boolean).join(' · ')}</div>
                  )}
                  <div className="ds-pass-qr-block">
                    <div className="ds-pass-qr-grid">
                      {QR_SAMPLE_PATTERN.map((on, i) => <span key={i} className={on ? 'on' : ''} />)}
                    </div>
                  </div>
                  {wording.admissionNote && <p className="ds-pass-card-note">{wording.admissionNote}</p>}
                  {passOptions.showHubButton && <span className="ds-pass-card-cta" style={{ background: colors.accent }}>Open FestioHub</span>}
                  {wording.footerNote && <p className="ds-pass-card-footer">{wording.footerNote}</p>}
                </div>
              </div>
              <div className="rd-hint" style={{ marginTop: 12 }}>QR pattern shown is illustrative — each guest's real pass carries their own unique, unforgeable token. Everything else here is your actual saved wording, colors, and photo.</div>
            </div>
          </div>
        </div>
      )}

      {tab === 'FestioHub' && (
        <div className="rd-wide-grid">
          <div className="rd-panel">
            <div className="rd-panel-head"><h3>Hub layout style</h3><p>How guests see their pass, program, and community — after they RSVP</p></div>
            <div className="rd-panel-body">
              <div className="ds-hub-grid">
                {HUB_STYLES.map((s) => (
                  <div key={s.id} className={`ds-hub-card ${hubStyle === s.id ? 'selected' : ''}`}>
                    <div className={`ds-hub-swatch ds-hub-swatch-${s.id}`}>
                      {s.id === 'wallet-pass' && (<><span className="hs-pass"/><span className="hs-tabs"><i/><i/><i/><i/></span></>)}
                      {s.id === 'card-dashboard' && (<><span className="hs-row"/><span className="hs-row"/><span className="hs-row"/></>)}
                      {s.id === 'story-feed' && (<><span className="hs-circles"><i/><i/><i/></span><span className="hs-row wide"/></>)}
                      {s.id === 'timeline' && (<><span className="hs-tl"><i/><i/><i/></span></>)}
                      {s.id === 'minimal-list' && (<><span className="hs-line"/><span className="hs-line"/><span className="hs-line"/><span className="hs-line"/></>)}
                    </div>
                    <strong>{s.name}</strong>
                    <span>{s.tagline}</span>
                    <p className="rd-rowlink" style={{ margin: '6px 0 12px' }}>{s.bestFor}</p>
                    <button className={`rr-btn ${hubStyle === s.id ? 'secondary' : 'primary'}`} style={{ width: '100%', justifyContent: 'center' }}
                      disabled={hubStyleBusy} onClick={() => selectHubStyle(s.id)}>
                      {hubStyle === s.id ? 'Selected' : hubStyleBusy ? 'Saving…' : 'Use this style'}
                    </button>
                  </div>
                ))}
              </div>
              <div className="rd-hint" style={{ marginTop: 14 }}>
                Your pick is saved to this event's design record and is what guests actually see in FestioHub after they RSVP — reordered tabs, tab-bar chrome, or section rhythm depending on the style, built from the same real pass/program/community/messages modules.
              </div>
            </div>
          </div>
          <div className="rd-panel">
            <div className="rd-panel-head ds-preview-head">
              <div><h3>Live preview</h3><p>The real FestioHub, with sample guest data and the selected style</p></div>
              <div className="rd-seg"><button className={!mobilePreview ? 'on' : ''} onClick={() => setMobilePreview(false)}>Desktop</button><button className={mobilePreview ? 'on' : ''} onClick={() => setMobilePreview(true)}>Mobile</button></div>
            </div>
            <div className="rd-panel-body">
              {!eventId ? (
                <div className="ds-page-preview"><Icon name="calendar" size={20} /><span>Select an event to preview FestioHub.</span></div>
              ) : (
                <div className={`ds-page-preview-frame-wrap ${mobilePreview ? 'mobile' : ''}`}>
                  <iframe
                    key={eventId}
                    src={eventPagePreviewNonce > 0 ? `/invite/${eventId}?studio-preview=1&_p=${eventPagePreviewNonce}#guest-hub` : undefined}
                    title="Live FestioHub preview"
                    className="ds-page-preview-frame"
                  />
                </div>
              )}
              <button className="rr-link-btn" onClick={() => openDraftPreview('#guest-hub')} style={{ marginTop: 8 }}>Open in a full tab <Icon name="external" size={12} /></button>
            </div>
          </div>
        </div>
      )}

      {tab === 'Email Preview' && (
        <div className="rd-panel" style={{ maxWidth: 680 }}>
          <div className="rd-panel-head"><h3>Email preview</h3><p>Your real saved wording, colors, and photo — layout is representative, actual delivery uses your provider's rendering</p></div>
          <div className="rd-panel-body">
            <div className="rd-seg" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
              {EMAIL_TYPES.map((t) => <button key={t} className={emailType === t ? 'on' : ''} onClick={() => setEmailType(t)}>{t}</button>)}
            </div>
            <div className="ds-email-card">
              <div className="ds-email-card-banner" style={{ background: colors.primary, color: '#fff' }}>
                <div className="ds-email-card-brand"><strong>Festio</strong><span>Digital Invitation</span></div>
                <h3>{emailType === 'Invitation' ? `${wording.inviteLabel || "You're invited"}: ${wording.eventTitle || 'your event'}` : emailType === 'RSVP confirmation' ? "You're confirmed!" : emailType === 'Festio Pass email' ? 'Your Festio Pass is ready' : emailType === 'Reminder' ? `Don't forget — ${wording.eventTitle || 'your event'}` : emailType === 'Broadcast' ? 'An update from your organizer' : "You're checked in!"}</h3>
              </div>
              {design?.asset_config?.cover_image_url && <img src={design.asset_config.cover_image_url} alt="" className="ds-email-card-cover" />}
              <div className="ds-email-card-body">
                <p className="ds-email-card-greeting">Hi there,</p>
                {wording.customMessage && <p className="ds-email-card-message">{wording.customMessage}</p>}
                <div className="ds-email-card-details">
                  {wording.date && <div><strong>Date:</strong> {wording.date}</div>}
                  {wording.time && <div><strong>Time:</strong> {wording.time}</div>}
                  {wording.venue && <div><strong>Venue:</strong> {wording.venue}</div>}
                  {!wording.date && !wording.time && !wording.venue && <div className="rd-rowlink">Date, time, and venue not set yet</div>}
                </div>
                {/* Illustrative CTA, not a real button — a <span> styled to match so it never looks clickable when it isn't. */}
                <span className="ds-email-cta" style={{ background: colors.primary }}>{emailType === 'RSVP confirmation' || emailType === 'Check-in confirmation' ? 'View details' : emailType === 'Festio Pass email' ? 'View my Festio Pass' : 'RSVP now'}</span>
                <p className="ds-email-card-footer">This link is unique to each guest. Please don't share it.</p>
              </div>
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
