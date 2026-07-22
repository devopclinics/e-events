import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../api'

const GRID = 10
const GROUP_COLORS = ['#0ea5e9', '#f59e0b', '#10b981', '#a855f7', '#ef4444', '#14b8a6', '#eab308', '#ec4899']
const DECOR = [
  { type: 'stage', label: 'Stage', w: 260, h: 70, color: '#cbd5e1' },
  { type: 'dancefloor', label: 'Dance floor', w: 200, h: 160, color: '#fde68a' },
  { type: 'entrance', label: 'Entrance', w: 120, h: 44, color: '#bbf7d0' },
  { type: 'exit', label: 'Exit', w: 120, h: 44, color: '#fecaca' },
  { type: 'bar', label: 'Bar', w: 180, h: 50, color: '#e9d5ff' },
  { type: 'label', label: 'Text', w: 120, h: 40, color: '#f1f5f9' },
]

const snap = (n) => Math.round(n / GRID) * GRID
const tableSize = (cap) => Math.max(52, 44 + (cap || 0) * 4)

function paidFeatureMessage(e) {
  return e?.status === 402
    ? `${e.message || 'Floor plan sharing requires an Event Pass.'} Open Event Setup to activate the recommended pass.`
    : e.message
}

export default function FloorPlanPage() {
  const { eventId, token } = useParams()
  const tokenMode = !!token

  const [plan, setPlan] = useState(null)
  const [tables, setTables] = useState([])
  const [elements, setElements] = useState([])
  const [sel, setSel] = useState(null)      // {kind:'table'|'element', id}
  const [editable, setEditable] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const svgRef = useRef(null)
  const drag = useRef(null)

  const load = useCallback(async () => {
    try {
      const data = tokenMode ? await api.getSharedFloor(token) : await api.getFloorPlan(eventId)
      setPlan(data)
      setTables(data.tables || [])
      setElements(data.elements || [])
      setEditable(!!data.editable)
      setError('')
    } catch (e) { setError(e.message) }
  }, [tokenMode, token, eventId])

  useEffect(() => { load() }, [load])

  const groupColor = useMemo(() => {
    const map = {}
    let i = 0
    for (const t of tables) if (t.table_group_id && !(t.table_group_id in map)) map[t.table_group_id] = GROUP_COLORS[i++ % GROUP_COLORS.length]
    return map
  }, [tables])

  function toSvg(e) {
    const r = svgRef.current.getBoundingClientRect()
    return { x: (e.clientX - r.left) * (plan.width / r.width), y: (e.clientY - r.top) * (plan.height / r.height) }
  }

  function onItemDown(e, kind, id) {
    if (!editable) return
    e.stopPropagation()
    setSel({ kind, id })
    const list = kind === 'table' ? tables : elements
    const it = list.find((x) => x.id === id)
    const p = toSvg(e)
    drag.current = { kind, id, dx: p.x - (it.pos_x || 0), dy: p.y - (it.pos_y || 0) }
    e.target.setPointerCapture?.(e.pointerId)
  }

  function onMove(e) {
    // Capture the drag target now: onUp/onPointerLeave can null drag.current
    // before React runs the state updater below, and reading a nulled ref inside
    // the map callback would crash (Cannot read properties of null 'id').
    const d = drag.current
    if (!d) return
    const p = toSvg(e)
    const nx = snap(p.x - d.dx), ny = snap(p.y - d.dy)
    const setter = d.kind === 'table' ? setTables : setElements
    setter((arr) => arr.map((x) => (x && x.id === d.id ? { ...x, pos_x: Math.max(0, nx), pos_y: Math.max(0, ny) } : x)))
    setDirty(true)
  }
  const onUp = () => { drag.current = null }

  function patchSel(patch) {
    const s = sel
    if (!s) return
    const setter = s.kind === 'table' ? setTables : setElements
    setter((arr) => arr.map((x) => (x && x.id === s.id ? { ...x, ...patch } : x)))
    setDirty(true)
  }

  function addDecor(d) {
    const id = `new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    setElements((a) => [...a, { id, type: d.type, label: d.label, pos_x: 80, pos_y: 80, width: d.w, height: d.h, rotation: 0, color: d.color }])
    setSel({ kind: 'element', id }); setDirty(true)
  }
  function deleteSel() {
    if (!sel || sel.kind !== 'element') return
    setElements((a) => a.filter((x) => x.id !== sel.id)); setSel(null); setDirty(true)
  }

  async function save() {
    setSaving(true); setStatus(''); setError('')
    const payload = {
      width: plan.width, height: plan.height, bg_image_url: plan.bg_image_url, bg_opacity: plan.bg_opacity,
      tables: tables.map((t) => ({ id: t.id, pos_x: t.pos_x, pos_y: t.pos_y, shape: t.shape, rotation: t.rotation })),
      elements: elements.map((e) => ({ id: e.id?.startsWith('new-') ? undefined : e.id, type: e.type, label: e.label, pos_x: e.pos_x, pos_y: e.pos_y, width: e.width, height: e.height, rotation: e.rotation, color: e.color })),
    }
    try {
      const data = tokenMode ? await api.saveSharedFloor(token, payload) : await api.saveFloorPlan(eventId, payload)
      setPlan(data); setTables(data.tables || []); setElements(data.elements || [])
      setDirty(false); setStatus('Saved'); setTimeout(() => setStatus(''), 1500)
    } catch (e) { setError(paidFeatureMessage(e)) } finally { setSaving(false) }
  }

  async function share() {
    try {
      const d = await api.shareFloorPlan(eventId)
      setPlan((p) => ({ ...p, share_token: d.share_token, edit_token: d.edit_token }))
    } catch (e) { setError(paidFeatureMessage(e)) }
  }
  async function uploadBg(file) {
    if (!file) return
    try { const { url } = await api.uploadFloorBg(eventId, file); setPlan((p) => ({ ...p, bg_image_url: url })); setDirty(true) }
    catch (e) { setError(paidFeatureMessage(e)) }
  }

  if (error && !plan) return <div className="flex min-h-screen items-center justify-center bg-slate-100 text-slate-600">{error}</div>
  if (!plan) return <div className="flex min-h-screen items-center justify-center bg-slate-100 text-slate-500 animate-pulse">Loading floor plan…</div>

  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const selItem = sel && (sel.kind === 'table' ? tables : elements).find((x) => x.id === sel.id)

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <h1 className="text-lg font-extrabold">{plan.event_name} · Floor plan</h1>
        {!editable && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">View only</span>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {!tokenMode && (
            <button onClick={() => api.floorPlanPdf(eventId, plan.event_name)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-bold hover:bg-slate-50">Download PDF</button>
          )}
          {!tokenMode && editable && <button onClick={share} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-bold hover:bg-slate-50">Share link</button>}
          {editable && (
            <button onClick={save} disabled={saving || !dirty} className="rounded-lg bg-teal-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-teal-500 disabled:opacity-50">
              {saving ? 'Saving…' : dirty ? 'Save' : status || 'Saved'}
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className="flex flex-wrap items-center gap-3 bg-amber-50 px-4 py-2 text-sm text-amber-700">
          <span>{error}</span>
          {!tokenMode && <a href="/admin?tab=billing" className="rounded-lg bg-teal-600 px-3 py-1 text-xs font-black text-white hover:bg-teal-700">Open Event Pass</a>}
        </div>
      )}
      {!tokenMode && editable && (plan.share_token || plan.edit_token) && (
        <div className="flex flex-wrap gap-4 border-b border-slate-200 bg-white px-4 py-2 text-xs">
          <ShareRow label="Client view link" url={`${origin}/floor/${plan.share_token}`} />
          <ShareRow label="Client edit link" url={`${origin}/floor/${plan.edit_token}`} />
        </div>
      )}

      <div className="flex flex-col gap-4 p-4 lg:flex-row">
        {/* Canvas */}
        <div className="min-w-0 flex-1 overflow-auto rounded-xl border border-slate-200 bg-white p-3">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${plan.width} ${plan.height}`}
            className="mx-auto block w-full max-w-full touch-none"
            style={{ aspectRatio: `${plan.width} / ${plan.height}`, background: '#f8fafc' }}
            onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}
            onPointerDown={() => setSel(null)}
          >
            {plan.bg_image_url && <image href={plan.bg_image_url} x="0" y="0" width={plan.width} height={plan.height} opacity={(plan.bg_opacity ?? 40) / 100} preserveAspectRatio="xMidYMid slice" />}
            {editable && <GridLines w={plan.width} h={plan.height} />}
            {elements.map((el) => {
              const cx = (el.pos_x || 0) + el.width / 2, cy = (el.pos_y || 0) + el.height / 2
              const active = sel?.kind === 'element' && sel.id === el.id
              return (
                <g key={el.id} transform={`rotate(${el.rotation || 0} ${cx} ${cy})`} onPointerDown={(e) => onItemDown(e, 'element', el.id)} style={{ cursor: editable ? 'move' : 'default' }}>
                  <rect x={el.pos_x} y={el.pos_y} width={el.width} height={el.height} rx="6" fill={el.color || '#e2e8f0'} stroke={active ? '#0f766e' : '#94a3b8'} strokeWidth={active ? 2.5 : 1} />
                  <text x={cx} y={cy + 4} textAnchor="middle" fontSize="13" fill="#334155" style={{ pointerEvents: 'none' }}>{el.label || el.type}</text>
                </g>
              )
            })}
            {tables.map((t) => {
              const size = tableSize(t.capacity)
              const x = t.pos_x ?? 40, y = t.pos_y ?? 40
              const cx = x + size / 2, cy = y + size / 2
              const fill = t.table_group_id ? groupColor[t.table_group_id] : '#0ea5e9'
              const active = sel?.kind === 'table' && sel.id === t.id
              return (
                <g key={t.id} transform={`rotate(${t.rotation || 0} ${cx} ${cy})`} onPointerDown={(e) => onItemDown(e, 'table', t.id)} style={{ cursor: editable ? 'move' : 'default' }}>
                  {t.shape === 'rect'
                    ? <rect x={x} y={y} width={size} height={size * 0.7} rx="8" fill={fill} fillOpacity="0.18" stroke={fill} strokeWidth={active ? 3 : 2} />
                    : <circle cx={cx} cy={cy} r={size / 2} fill={fill} fillOpacity="0.18" stroke={fill} strokeWidth={active ? 3 : 2} />}
                  <text x={cx} y={(t.shape === 'rect' ? y + size * 0.35 : cy) - 2} textAnchor="middle" fontSize="13" fontWeight="700" fill="#0f172a" style={{ pointerEvents: 'none' }}>{t.name}</text>
                  <text x={cx} y={(t.shape === 'rect' ? y + size * 0.35 : cy) + 15} textAnchor="middle" fontSize="11" fill="#475569" style={{ pointerEvents: 'none' }}>{t.seated}/{t.capacity} seats</text>
                </g>
              )
            })}
          </svg>
        </div>

        {/* Side panel */}
        {editable && (
          <aside className="w-full shrink-0 space-y-4 lg:w-72">
            <Panel title="Add decor">
              <div className="grid grid-cols-2 gap-2">
                {DECOR.map((d) => <button key={d.type} onClick={() => addDecor(d)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-bold hover:bg-slate-50">{d.label}</button>)}
              </div>
            </Panel>

            {!tokenMode && (
              <Panel title="Background image">
                <label className="block cursor-pointer rounded-lg border border-dashed border-slate-300 px-3 py-2 text-center text-xs font-bold text-slate-600 hover:bg-slate-50">
                  {plan.bg_image_url ? 'Replace image' : 'Upload venue image'}
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => uploadBg(e.target.files?.[0])} />
                </label>
                {plan.bg_image_url && (
                  <div className="mt-2">
                    <label className="text-xs text-slate-500">Opacity {plan.bg_opacity}%</label>
                    <input type="range" min="0" max="100" value={plan.bg_opacity ?? 40} onChange={(e) => { setPlan((p) => ({ ...p, bg_opacity: +e.target.value })); setDirty(true) }} className="w-full" />
                    <button onClick={() => { setPlan((p) => ({ ...p, bg_image_url: null })); setDirty(true) }} className="text-xs font-bold text-red-500">Remove image</button>
                  </div>
                )}
              </Panel>
            )}

            {selItem && sel.kind === 'table' && (
              <Panel title={`${plan.seating_term || 'Table'} · ${selItem.name}`}>
                <Row label="Shape">
                  {['round', 'rect'].map((sh) => <button key={sh} onClick={() => patchSel({ shape: sh })} className={`rounded-lg px-3 py-1 text-xs font-bold ${selItem.shape === sh ? 'bg-teal-600 text-white' : 'border border-slate-300'}`}>{sh}</button>)}
                </Row>
                <Row label="Rotate"><button onClick={() => patchSel({ rotation: ((selItem.rotation || 0) + 45) % 360 })} className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-bold">↻ 45°</button></Row>
                <p className="text-xs text-slate-500">{selItem.seated}/{selItem.capacity} seated{selItem.table_group_name ? ` · ${selItem.table_group_name}` : ''}</p>
              </Panel>
            )}

            {selItem && sel.kind === 'element' && (
              <Panel title="Decor">
                <input value={selItem.label || ''} onChange={(e) => patchSel({ label: e.target.value })} placeholder="Label" className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm" />
                <Row label="Rotate"><button onClick={() => patchSel({ rotation: ((selItem.rotation || 0) + 45) % 360 })} className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-bold">↻ 45°</button></Row>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs text-slate-500">W<input type="number" value={selItem.width} onChange={(e) => patchSel({ width: Math.max(20, +e.target.value) })} className="w-full rounded border border-slate-300 px-1 text-sm" /></label>
                  <label className="text-xs text-slate-500">H<input type="number" value={selItem.height} onChange={(e) => patchSel({ height: Math.max(20, +e.target.value) })} className="w-full rounded border border-slate-300 px-1 text-sm" /></label>
                </div>
                <button onClick={deleteSel} className="mt-1 text-xs font-bold text-red-500">Delete</button>
              </Panel>
            )}
          </aside>
        )}
      </div>
    </div>
  )
}

function GridLines({ w, h }) {
  const lines = []
  for (let x = 0; x <= w; x += 40) lines.push(<line key={`v${x}`} x1={x} y1={0} x2={x} y2={h} stroke="#e2e8f0" strokeWidth="1" />)
  for (let y = 0; y <= h; y += 40) lines.push(<line key={`h${y}`} x1={0} y1={y} x2={w} y2={y} stroke="#e2e8f0" strokeWidth="1" />)
  return <g style={{ pointerEvents: 'none' }}>{lines}</g>
}
function Panel({ title, children }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="mb-2 text-xs font-extrabold uppercase tracking-wide text-slate-500">{title}</div><div className="space-y-2">{children}</div></div>
}
function Row({ label, children }) {
  return <div className="flex items-center justify-between gap-2"><span className="text-xs text-slate-500">{label}</span><div className="flex gap-1">{children}</div></div>
}
function ShareRow({ label, url }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-2">
      <span className="font-bold text-slate-500">{label}:</span>
      <code className="max-w-[220px] truncate rounded bg-slate-100 px-1.5 py-0.5">{url}</code>
      <button onClick={() => { navigator.clipboard?.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500) }} className="font-bold text-teal-600">{copied ? 'Copied' : 'Copy'}</button>
    </div>
  )
}
