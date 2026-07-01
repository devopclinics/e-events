import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useCurrentEvent } from '../hooks/useCurrentEvent'

// Fully self-contained admin surface for Festio Design Studio. Reads the shared
// current-event selection, talks to the design-service via the auth'd proxy, and
// degrades gracefully — if the service is down, actions surface a friendly note
// and nothing else in the app is affected.

const TABS = ['Templates', 'Flyer', 'Event Page', 'Festio Pass', 'Email', 'Publish']
const FLYER_SIZES = [
  ['square', 'Square 1080×1080'], ['story', 'Story 1080×1920'], ['portrait', 'Portrait 1080×1350'],
  ['a5', 'A5 (PDF)'], ['a4', 'A4 (PDF)'],
]
const WORDING_FIELDS = [
  ['eventTitle', 'Event title'], ['hostName', 'Host name'], ['date', 'Date'], ['time', 'Time'],
  ['venue', 'Venue'], ['address', 'Address'], ['dressCode', 'Dress code'],
  ['rsvpNote', 'RSVP note'], ['customMessage', 'Custom message'],
]
const COLOR_FIELDS = [['primary', 'Primary'], ['accent', 'Accent'], ['background', 'Background'], ['text', 'Text']]

const input = 'w-full border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white'

export default function DesignStudioPage() {
  const [eventId, setEventId] = useCurrentEvent()
  const [events, setEvents] = useState([])
  const [tab, setTab] = useState('Templates')
  const [templates, setTemplates] = useState([])
  const [design, setDesign] = useState(null)
  const [filters, setFilters] = useState({ category: '', style: '', free: '' })
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState(null) // {text, err}

  const note = (text, err = false) => { setFlash({ text, err }); setTimeout(() => setFlash(null), 4000) }

  useEffect(() => { api.listEvents().then(setEvents).catch(() => {}) }, [])

  useEffect(() => {
    const qs = new URLSearchParams()
    if (filters.category) qs.set('category', filters.category)
    if (filters.style) qs.set('style', filters.style)
    if (filters.free !== '') qs.set('free', filters.free)
    api.designTemplates(qs.toString() ? `?${qs}` : '')
      .then((r) => setTemplates(r.templates || []))
      .catch(() => setTemplates([]))
  }, [filters])

  useEffect(() => {
    if (!eventId) { setDesign(null); return }
    api.getEventDesign(eventId).then(setDesign).catch(() => setDesign(null))
  }, [eventId])

  const categories = useMemo(() => [...new Set(templates.map((t) => t.category))].sort(), [templates])
  const styles = useMemo(() => [...new Set(templates.map((t) => t.style))].sort(), [templates])
  const selectedTpl = useMemo(
    () => templates.find((t) => t.id === (design?.selected_template_id)) || null,
    [templates, design],
  )
  const colors = { ...(selectedTpl?.defaultColors || {}), ...(design?.theme_config?.colors || {}) }
  const wording = design?.wording_config || {}

  async function patch(partial) {
    if (!eventId) return note('Pick an event first.', true)
    setBusy(true)
    try {
      const merged = {
        selected_template_id: design?.selected_template_id,
        selected_flyer_template_id: design?.selected_flyer_template_id,
        theme_config: design?.theme_config || {},
        wording_config: design?.wording_config || {},
        ...partial,
      }
      setDesign(await api.saveEventDesign(eventId, merged))
    } catch (e) { note(e.message || 'Save failed', true) }
    finally { setBusy(false) }
  }

  const setColor = (k, v) => patch({ theme_config: { ...(design?.theme_config || {}), colors: { ...colors, [k]: v } } })
  const setWord = (k, v) => setDesign((d) => ({ ...d, wording_config: { ...(d?.wording_config || {}), [k]: v } }))

  async function chooseTemplate(t) {
    await patch({ selected_template_id: t.id, selected_flyer_template_id: t.id })
    note(`Selected “${t.name}”.`)
  }

  async function upload(e) {
    const file = e.target.files?.[0]; if (!file || !eventId) return
    setBusy(true)
    try {
      const meta = await api.uploadDesignAsset(eventId, file)
      await patch({ asset_config: { ...(design?.asset_config || {}), cover_image_url: meta.public_url } })
      note('Image uploaded and set as cover.')
    } catch (err) { note(err.message || 'Upload failed', true) }
    finally { setBusy(false); e.target.value = '' }
  }

  const [flyer, setFlyer] = useState({ size: 'portrait', qr: true })
  async function renderFlyer(fmt) {
    if (!eventId) return note('Pick an event first.', true)
    setBusy(true)
    try {
      await api.saveEventDesign(eventId, { wording_config: wording })
      await api.renderFlyer(eventId, {
        size: flyer.size,
        format: fmt || (['a5', 'a4'].includes(flyer.size) ? 'pdf' : 'png'),
        qr_enabled: flyer.qr,
        qr_data: flyer.qr ? `https://festio.events/invite/${eventId}` : null,
      })
      note('Flyer downloaded.')
    } catch (err) { note(err.message || 'Render failed', true) }
    finally { setBusy(false) }
  }

  async function publish() {
    setBusy(true)
    try { setDesign(await api.publishEventDesign(eventId)); note('Design published to your event.') }
    catch (e) { note(e.message || 'Publish failed', true) }
    finally { setBusy(false) }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">🎨 Design Studio</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">Beautiful pages and flyers — pick a style, customize, preview, publish.</p>
        </div>
        <select value={eventId || ''} onChange={(e) => setEventId(e.target.value)} className={`${input} max-w-xs`}>
          <option value="">— Select an event —</option>
          {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </div>

      {flash && (
        <div className={`mb-3 rounded-lg px-3 py-2 text-sm ${flash.err ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'}`}>{flash.text}</div>
      )}

      <div className="flex flex-wrap gap-1.5 border-b border-slate-200 dark:border-slate-700 mb-5">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-semibold rounded-t-lg ${tab === t ? 'bg-teal-600 text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
            {t}
          </button>
        ))}
      </div>

      {!eventId && <p className="text-sm text-slate-500 dark:text-slate-400">Select an event above to start designing.</p>}

      {eventId && tab === 'Templates' && (
        <div>
          <div className="flex flex-wrap gap-2 mb-4">
            <select value={filters.category} onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))} className={`${input} max-w-[12rem]`}>
              <option value="">All categories</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={filters.style} onChange={(e) => setFilters((f) => ({ ...f, style: e.target.value }))} className={`${input} max-w-[12rem]`}>
              <option value="">All styles</option>{styles.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={filters.free} onChange={(e) => setFilters((f) => ({ ...f, free: e.target.value }))} className={`${input} max-w-[10rem]`}>
              <option value="">Free & premium</option><option value="true">Free</option><option value="false">Premium</option>
            </select>
            <span className="text-xs text-slate-400 self-center ml-auto">{templates.length} templates</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {templates.map((t) => {
              const on = t.id === design?.selected_template_id
              const c = t.defaultColors || {}
              return (
                <button key={t.id} onClick={() => chooseTemplate(t)}
                  className={`text-left rounded-xl border p-0 overflow-hidden transition ${on ? 'border-teal-500 ring-2 ring-teal-500/40' : 'border-slate-200 dark:border-slate-700 hover:border-teal-400'}`}>
                  <div className="h-24 flex items-end p-3" style={{ background: `linear-gradient(150deg, ${c.background}, ${c.surface || c.background})` }}>
                    <span className="text-xs font-black" style={{ color: c.primary }}>{t.category}</span>
                  </div>
                  <div className="p-3">
                    <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">{t.name}</div>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[11px] text-slate-500">{t.style}</span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${t.isFree ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{t.isFree ? 'Free' : 'Premium'}</span>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {eventId && tab === 'Flyer' && (
        <div className="grid lg:grid-cols-2 gap-6">
          <div className="space-y-4">
            {!selectedTpl && <p className="text-sm text-amber-600">Pick a template in the Templates tab first.</p>}
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Upload flyer / photo (JPG, PNG, WEBP · max 10MB)</label>
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={upload} className="text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {WORDING_FIELDS.map(([k, label]) => (
                <div key={k}>
                  <label className="block text-[11px] font-medium text-slate-500 mb-0.5">{label}</label>
                  <input className={input} value={wording[k] || ''} onChange={(e) => setWord(k, e.target.value)} />
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-3 items-center">
              {COLOR_FIELDS.map(([k, label]) => (
                <label key={k} className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                  {label} <input type="color" value={colors[k] || '#000000'} onChange={(e) => setColor(k, e.target.value)} className="h-7 w-9 rounded border border-slate-300" />
                </label>
              ))}
            </div>
            <div className="flex flex-wrap gap-3 items-center">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={flyer.qr} onChange={(e) => setFlyer((f) => ({ ...f, qr: e.target.checked }))} /> Include RSVP QR</label>
              <select value={flyer.size} onChange={(e) => setFlyer((f) => ({ ...f, size: e.target.value }))} className={`${input} max-w-[14rem]`}>
                {FLYER_SIZES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <button disabled={busy} onClick={() => renderFlyer()} className="bg-teal-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-teal-700 disabled:opacity-50">Download {['a5', 'a4'].includes(flyer.size) ? 'PDF' : 'PNG'}</button>
              <button disabled={busy} onClick={() => patch({ wording_config: wording })} className="border border-slate-300 dark:border-slate-600 px-4 py-2 rounded-lg text-sm dark:text-slate-200">Save</button>
            </div>
          </div>
          {/* Live CSS preview (portrait card) */}
          <div>
            <div className="rounded-2xl overflow-hidden shadow-xl mx-auto" style={{ width: 300, height: 400, background: `linear-gradient(160deg, ${colors.background || '#0B1220'}, ${colors.surface || '#111827'})`, color: colors.text || '#fff' }}>
              {design?.asset_config?.cover_image_url && <div style={{ height: '42%', backgroundImage: `url(${design.asset_config.cover_image_url})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />}
              <div className="p-5 flex flex-col h-full">
                <div className="text-[10px] font-black uppercase tracking-widest" style={{ color: colors.accent }}>You're invited</div>
                <div className="text-2xl font-black leading-tight mt-1" style={{ color: colors.primary }}>{wording.eventTitle || 'Your Event'}</div>
                <div className="text-sm mt-1 opacity-90">{wording.hostName}</div>
                <div className="mt-auto text-xs space-y-1 opacity-90">
                  {[wording.date, wording.time].filter(Boolean).join(' · ') && <div>{[wording.date, wording.time].filter(Boolean).join(' · ')}</div>}
                  {wording.venue && <div>{wording.venue}</div>}
                  {wording.address && <div className="opacity-75">{wording.address}</div>}
                </div>
              </div>
            </div>
            <p className="text-center text-xs text-slate-400 mt-2">Live preview · downloaded flyer is full-resolution</p>
          </div>
        </div>
      )}

      {eventId && ['Event Page', 'Festio Pass', 'Email'].includes(tab) && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-6">
          <h3 className="font-semibold text-slate-900 dark:text-white mb-2">{tab} theme</h3>
          <div className="flex gap-2 mb-3">
            {COLOR_FIELDS.map(([k]) => <span key={k} className="h-8 w-8 rounded-lg border border-slate-200" style={{ background: colors[k] }} title={k} />)}
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {selectedTpl ? `“${selectedTpl.name}” theme applies to your ${tab.toLowerCase()} when you Publish.` : 'Pick a template to theme this surface.'} Full interactive preview lands in the next update — the colors, fonts, and cover you set here already flow through on publish.
          </p>
        </div>
      )}

      {eventId && tab === 'Publish' && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-6 space-y-3 max-w-lg">
          <div className="text-sm"><span className="text-slate-500">Template:</span> <strong className="text-slate-900 dark:text-white">{selectedTpl?.name || 'None selected'}</strong></div>
          <div className="text-sm"><span className="text-slate-500">Status:</span> {design?.is_published ? <span className="text-emerald-600 font-semibold">Published v{design.published_version}</span> : <span className="text-amber-600">Draft</span>}</div>
          <p className="text-xs text-slate-500 dark:text-slate-400">Publishing applies this design to your public RSVP page, Festio Pass, Guest Hub, and email styling.</p>
          <button disabled={busy || !selectedTpl} onClick={publish} className="bg-teal-600 text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-teal-700 disabled:opacity-50">Publish design</button>
        </div>
      )}
    </div>
  )
}
