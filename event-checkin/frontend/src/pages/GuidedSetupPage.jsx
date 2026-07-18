import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useCurrentEvent } from '../hooks/useCurrentEvent'
import {
  RSVP_QUESTION_PRESETS,
  EXPERIENCE_WORKFLOW_TEMPLATES,
  EXPERIENCE_PRESET_BY_KEY,
  experienceStepPayload,
} from './AdminPage'

const PLAN_LABELS = { tier50: 'Starter Event Pass', tier150: 'Standard Event Pass', tier300: 'Pro Event Pass', scale: 'Scale' }

const REGISTRY_PRESETS = [
  { label: 'Cash gift', kind: 'fund', title: 'Cash gift', description: 'Contribute any amount toward our celebration.' },
  { label: 'Honeymoon fund', kind: 'fund', title: 'Honeymoon fund', description: 'Help send us on our honeymoon.' },
  { label: 'Store registry link', kind: 'link', title: 'Our registry', description: 'Paste a link to your registry on Amazon, Target, etc.' },
]

const LOGISTICS_PRESETS = ['Aso-ebi', 'Welcome gift', 'VIP gift bag', 'Wedding favors', 'Graduation gift']

const STEP_ORDER = [
  'team', 'messaging', 'rsvp_questions', 'multi_invitee',
  'tables', 'menu', 'registry', 'logistics', 'festiome', 'experience_program', 'review',
]

function input(extra = '') {
  return `w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 focus:outline-none focus:ring-2 focus:ring-teal-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white ${extra}`
}

function StatusBadge({ status }) {
  if (status === 'completed') return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">Done</span>
  if (status === 'skipped') return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400">Skipped</span>
  return null
}

function UpgradeCard({ requiredPlan, onSkip }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
      <p className="font-bold">🔒 Requires {PLAN_LABELS[requiredPlan] || 'a paid plan'}</p>
      <p className="mt-1">You can still plan this out — activate the pass from your event dashboard whenever you're ready, then come back and finish this step.</p>
      <button type="button" onClick={onSkip} className="mt-3 text-xs font-bold text-amber-800 underline dark:text-amber-300">Skip for now</button>
    </div>
  )
}

function StepShell({ stepKey, title, subtitle, status, open, onToggle, recommended, children }) {
  return (
    <div className={`rounded-lg border bg-white shadow-sm dark:bg-slate-900 ${open ? 'border-teal-400 dark:border-teal-700' : 'border-slate-200 dark:border-slate-800'}`}>
      <button type="button" onClick={onToggle} className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-black text-slate-950 dark:text-white">{title}</h3>
            <StatusBadge status={status} />
            {recommended && !status && <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-bold text-teal-700 dark:bg-teal-950/40 dark:text-teal-300">Recommended</span>}
          </div>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
        </div>
        <span className="text-slate-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="border-t border-slate-100 px-5 py-4 dark:border-slate-800">{children}</div>}
    </div>
  )
}

function StepFooter({ onSkip, onSave, saving, saveLabel = 'Save & continue', canSave = true }) {
  return (
    <div className="mt-4 flex items-center gap-3">
      <button type="button" disabled={saving || !canSave} onClick={onSave} className="rounded-lg bg-teal-600 px-4 py-2 text-xs font-black text-white hover:bg-teal-700 disabled:opacity-50">
        {saving ? 'Saving…' : saveLabel}
      </button>
      <button type="button" onClick={onSkip} className="text-xs font-bold text-slate-500 hover:underline dark:text-slate-400">Skip for now</button>
    </div>
  )
}

export default function GuidedSetupPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [, setCurrentEvent] = useCurrentEvent()
  const eventId = params.get('event') || ''
  const initialSuggest = useMemo(() => (params.get('suggest') || '').split(',').filter(Boolean), [params])

  const [event, setEvent] = useState(null)
  const [rec, setRec] = useState(null)
  const [rsvpEnabled, setRsvpEnabled] = useState(false)
  const [progress, setProgress] = useState({})
  const [openStep, setOpenStep] = useState('team')
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')

  useEffect(() => {
    if (!eventId) return
    setCurrentEvent(eventId)
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId])

  async function load() {
    setLoading(true)
    try {
      const events = await api.listEvents()
      const ev = events.find((e) => e.id === eventId)
      if (!ev) throw new Error('Event not found')
      setEvent(ev)
      setRsvpEnabled(!!ev.rsvp_enabled)
      const [r, p] = await Promise.all([
        api.getSetupRecommendations(ev.event_type || ''),
        api.getSetupProgress(eventId),
      ])
      setRec(r)
      setProgress(p.steps || {})
    } catch (e) {
      setLoadErr(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function markStep(stepKey, status) {
    setProgress((p) => ({ ...p, [stepKey]: status }))
    try {
      await api.setSetupProgress(eventId, stepKey, status)
    } catch {
      // Non-fatal — the step's own action already succeeded (or was
      // explicitly skipped); progress tracking is a resumability nicety.
    }
    const idx = STEP_ORDER.indexOf(stepKey)
    const next = STEP_ORDER[idx + 1]
    if (next) setOpenStep(next)
  }

  if (!eventId) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-slate-500">Missing event. <button className="ml-2 underline" onClick={() => navigate('/setup')}>Start over</button></div>
  }
  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-slate-500">Loading guided setup…</div>
  }
  if (loadErr || !event) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-red-600">{loadErr || 'Event not found'}</div>
  }

  const stepProps = { event, rec, progress, markStep, openStep, setOpenStep, initialSuggest, rsvpEnabled, setRsvpEnabled }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10 dark:bg-slate-950">
      <div className="mx-auto max-w-3xl">
        <p className="text-sm font-black uppercase tracking-widest text-teal-700 dark:text-teal-300">Guided setup</p>
        <h1 className="mt-2 text-3xl font-black text-slate-950 dark:text-white">Let's set up {event.name}</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Every step here is optional and can be finished later from your event dashboard. Nothing here activates a paid
          module by itself — pick what you want and activate it from the dashboard whenever you're ready.
        </p>

        <div className="mt-6 space-y-3">
          <TeamStep {...stepProps} />
          <MessagingStep {...stepProps} />
          <RsvpQuestionsStep {...stepProps} />
          <MultiInviteeStep {...stepProps} />
          <TablesStep {...stepProps} />
          <MenuStep {...stepProps} />
          <RegistryStep {...stepProps} />
          <LogisticsStep {...stepProps} />
          <FestioMeStep {...stepProps} />
          <ExperienceProgramStep {...stepProps} />
          <ReviewStep {...stepProps} navigate={navigate} />
        </div>
      </div>
    </div>
  )
}

// ── 1. Team ───────────────────────────────────────────────────────────────
function TeamStep({ event, progress, markStep, openStep, setOpenStep }) {
  const [email, setEmail] = useState('')
  const [needsConfirm, setNeedsConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  async function invite(confirmed = false) {
    if (!email.trim()) return
    setBusy(true); setErr('')
    try {
      if (!confirmed) {
        const { exists } = await api.checkTeamEmail(email.trim())
        if (!exists) {
          setNeedsConfirm(true)
          setBusy(false)
          return
        }
      }
      await api.inviteOrgMember(event.id, { email: email.trim(), role: 'staff' })
      setMsg(`Invited ${email.trim()}.`)
      setEmail('')
      setNeedsConfirm(false)
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <StepShell stepKey="team" title="Invite your team" subtitle="Give staff access to help manage this event"
      status={progress.team} open={openStep === 'team'} onToggle={() => setOpenStep(openStep === 'team' ? '' : 'team')}>
      <div className="flex gap-2">
        <input className={input('flex-1')} type="email" placeholder="teammate@example.com" value={email} onChange={(e) => { setEmail(e.target.value); setNeedsConfirm(false) }} />
        <button type="button" disabled={busy || !email.trim()} onClick={() => invite(false)} className="rounded-lg bg-teal-600 px-4 py-2 text-xs font-black text-white hover:bg-teal-700 disabled:opacity-50">
          {busy ? '…' : 'Invite'}
        </button>
      </div>
      {needsConfirm && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          We don't see an account for this email yet — they'll need to sign up with this exact address before they can access the event.
          <div className="mt-2 flex gap-3">
            <button type="button" onClick={() => invite(true)} className="font-bold underline">Invite anyway</button>
            <button type="button" onClick={() => setNeedsConfirm(false)} className="text-slate-500">Cancel</button>
          </div>
        </div>
      )}
      {msg && <p className="mt-2 text-xs font-semibold text-emerald-600">{msg}</p>}
      {err && <p className="mt-2 text-xs font-semibold text-red-600">{err}</p>}
      <StepFooter onSkip={() => markStep('team', 'skipped')} onSave={() => markStep('team', 'completed')} saveLabel="Continue" />
    </StepShell>
  )
}

// ── 2. Messaging channels ────────────────────────────────────────────────
function MessagingStep({ event, progress, markStep, openStep, setOpenStep }) {
  const [sms, setSms] = useState(!!event.notify_sms)
  const [whatsapp, setWhatsapp] = useState(!!event.notify_whatsapp)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function save() {
    setBusy(true); setErr('')
    try {
      await api.toggleFeatures(event.id, { notify_sms: sms, notify_whatsapp: whatsapp })
      markStep('messaging', 'completed')
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <StepShell stepKey="messaging" title="Messaging channels" subtitle="Choose which channels you plan to notify guests on"
      status={progress.messaging} open={openStep === 'messaging'} onToggle={() => setOpenStep(openStep === 'messaging' ? '' : 'messaging')}>
      <div className="flex flex-wrap gap-3">
        <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold dark:border-slate-700 dark:text-slate-200">
          <input type="checkbox" checked disabled /> Email
        </label>
        <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold dark:border-slate-700 dark:text-slate-200">
          <input type="checkbox" checked={sms} onChange={(e) => setSms(e.target.checked)} /> SMS
        </label>
        <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold dark:border-slate-700 dark:text-slate-200">
          <input type="checkbox" checked={whatsapp} onChange={(e) => setWhatsapp(e.target.checked)} /> WhatsApp
        </label>
      </div>
      <p className="mt-2 text-[11px] text-slate-400">SMS/WhatsApp will actually send once you activate a paid plan — toggling them on here just sets your preference now.</p>
      {err && <p className="mt-2 text-xs font-semibold text-red-600">{err}</p>}
      <StepFooter onSkip={() => markStep('messaging', 'skipped')} onSave={save} saving={busy} />
    </StepShell>
  )
}

// ── 3. RSVP Questions ─────────────────────────────────────────────────────
function RsvpQuestionsStep({ event, rec, progress, markStep, openStep, setOpenStep, rsvpEnabled, setRsvpEnabled }) {
  const [selected, setSelected] = useState(() => new Set(rec?.rsvp_question_presets || []))
  const [customRows, setCustomRows] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  function toggle(label) {
    setSelected((s) => {
      const next = new Set(s)
      next.has(label) ? next.delete(label) : next.add(label)
      return next
    })
  }

  function addCustomRow() {
    setCustomRows((r) => [...r, { question: '', is_required: false }])
  }
  function updateCustomRow(i, key, value) {
    setCustomRows((r) => r.map((row, idx) => idx === i ? { ...row, [key]: value } : row))
  }
  function removeCustomRow(i) {
    setCustomRows((r) => r.filter((_, idx) => idx !== i))
  }

  async function save() {
    setBusy(true); setErr('')
    try {
      await api.updateInviteSettings(event.id, { rsvp_enabled: rsvpEnabled })
      if (rsvpEnabled) {
        let order = 0
        for (const preset of RSVP_QUESTION_PRESETS) {
          if (!selected.has(preset.label)) continue
          await api.createRSVPQuestion(event.id, {
            question: preset.question,
            question_type: preset.question_type,
            is_required: preset.is_required,
            sort_order: order++,
            options: preset.question_type === 'select' && preset.options
              ? JSON.stringify(preset.options.split(',').map((s) => s.trim()).filter(Boolean))
              : null,
          })
        }
        for (const row of customRows) {
          if (!row.question.trim()) continue
          await api.createRSVPQuestion(event.id, {
            question: row.question.trim(), question_type: 'text', is_required: row.is_required,
            sort_order: order++, options: null,
          })
        }
      }
      markStep('rsvp_questions', 'completed')
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <StepShell stepKey="rsvp_questions" title="RSVP" subtitle="Are guests RSVPing through Festio, or do you already have your guest list?"
      status={progress.rsvp_questions} open={openStep === 'rsvp_questions'} onToggle={() => setOpenStep(openStep === 'rsvp_questions' ? '' : 'rsvp_questions')}
      recommended={(rec?.rsvp_question_presets || []).length > 0}>
      <div className="grid gap-3 sm:grid-cols-2">
        <button type="button" onClick={() => setRsvpEnabled(false)}
          className={`rounded-xl border-2 p-4 text-left transition-colors ${!rsvpEnabled ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/20' : 'border-slate-200 dark:border-slate-700'}`}>
          <div className="flex items-center gap-2 text-sm font-bold dark:text-white">{!rsvpEnabled && <span className="text-teal-600">✓</span>} Skip RSVP</div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">You already have your guest list (e.g. from another platform) — send everyone their QR ticket straight away, no confirmation needed.</div>
        </button>
        <button type="button" onClick={() => setRsvpEnabled(true)}
          className={`rounded-xl border-2 p-4 text-left transition-colors ${rsvpEnabled ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/20' : 'border-slate-200 dark:border-slate-700'}`}>
          <div className="flex items-center gap-2 text-sm font-bold dark:text-white">{rsvpEnabled && <span className="text-teal-600">✓</span>} With RSVP</div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Ask guests to confirm through Festio first. Adds an RSVP form to the invite page, with whatever questions you add below.</div>
        </button>
      </div>

      {rsvpEnabled && (
        <>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {RSVP_QUESTION_PRESETS.map((p) => (
              <label key={p.label} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:text-slate-200">
                <input type="checkbox" checked={selected.has(p.label)} onChange={() => toggle(p.label)} />
                {p.label}
              </label>
            ))}
          </div>
          <div className="mt-3 space-y-2">
            {customRows.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <input className={input('flex-1')} placeholder="Your own question" value={row.question} onChange={(e) => updateCustomRow(i, 'question', e.target.value)} />
                <label className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-slate-500 dark:text-slate-400">
                  <input type="checkbox" checked={row.is_required} onChange={(e) => updateCustomRow(i, 'is_required', e.target.checked)} /> Required
                </label>
                <button type="button" onClick={() => removeCustomRow(i)} className="text-xs text-red-500">Remove</button>
              </div>
            ))}
            <button type="button" onClick={addCustomRow} className="text-xs font-bold text-teal-700 dark:text-teal-300">+ Add your own question</button>
          </div>
        </>
      )}
      {err && <p className="mt-2 text-xs font-semibold text-red-600">{err}</p>}
      <StepFooter onSkip={() => markStep('rsvp_questions', 'skipped')} onSave={save} saving={busy} saveLabel={rsvpEnabled ? 'Save & continue' : 'Continue'} />
    </StepShell>
  )
}

// ── 4. Multi-invitee ──────────────────────────────────────────────────────
function MultiInviteeStep({ event, rec, progress, markStep, openStep, setOpenStep, rsvpEnabled }) {
  const [rows, setRows] = useState([{ category_name: '', limit: 1, submitter_table_category: '', invitee_table_category: '' }])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  function updateRow(i, key, value) {
    setRows((r) => r.map((row, idx) => idx === i ? { ...row, [key]: value } : row))
  }
  function addRow() {
    setRows((r) => [...r, { category_name: '', limit: 1, submitter_table_category: '', invitee_table_category: '' }])
  }
  function removeRow(i) {
    setRows((r) => r.filter((_, idx) => idx !== i))
  }

  async function save() {
    setBusy(true); setErr('')
    try {
      const rules = rows.filter((r) => r.category_name.trim()).map((r) => ({
        category_name: r.category_name.trim(),
        limit: Number(r.limit) || 0,
        submitter_table_category: r.submitter_table_category.trim() || null,
        invitee_table_category: r.invitee_table_category.trim() || null,
      }))
      if (!rules.length) { setErr('Add at least one category.'); setBusy(false); return }
      await api.setMultiInviteeRules(event.id, rules)
      markStep('multi_invitee', 'completed')
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <StepShell stepKey="multi_invitee" title="Let submitters register a group" subtitle="Optional: one RSVP can bring additional guests, with per-category limits"
      status={progress.multi_invitee} open={openStep === 'multi_invitee'} onToggle={() => setOpenStep(openStep === 'multi_invitee' ? '' : 'multi_invitee')}
      recommended={rsvpEnabled && rec?.multi_invitee_common === 'suggest'}>
      {!rsvpEnabled ? (
        <>
          <p className="text-sm text-slate-500 dark:text-slate-400">This only applies when guests RSVP through Festio — you chose to skip RSVP in the previous step, so there's nothing to set up here.</p>
          <button type="button" onClick={() => markStep('multi_invitee', 'skipped')} className="mt-4 rounded-lg bg-teal-600 px-4 py-2 text-xs font-black text-white hover:bg-teal-700">Continue</button>
        </>
      ) : (
        <>
          <div className="space-y-2">
            {rows.map((row, i) => (
              <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr_auto] items-center">
                <input className={input()} placeholder="Category (e.g. Parent/guardian)" value={row.category_name} onChange={(e) => updateRow(i, 'category_name', e.target.value)} />
                <input className={input()} type="number" min="0" placeholder="Max invitees" value={row.limit} onChange={(e) => updateRow(i, 'limit', e.target.value)} />
                <input className={input()} placeholder="Submitter table cat. (optional)" value={row.submitter_table_category} onChange={(e) => updateRow(i, 'submitter_table_category', e.target.value)} />
                <input className={input()} placeholder="Invitee table cat. (optional)" value={row.invitee_table_category} onChange={(e) => updateRow(i, 'invitee_table_category', e.target.value)} />
                {rows.length > 1 && <button type="button" onClick={() => removeRow(i)} className="text-xs text-red-500">Remove</button>}
              </div>
            ))}
            <button type="button" onClick={addRow} className="text-xs font-bold text-teal-700 dark:text-teal-300">+ Add category</button>
          </div>
          {err && <p className="mt-2 text-xs font-semibold text-red-600">{err}</p>}
          <StepFooter onSkip={() => markStep('multi_invitee', 'skipped')} onSave={save} saving={busy} />
        </>
      )}
    </StepShell>
  )
}

// ── 5. Seating / Tables ───────────────────────────────────────────────────
function TablesStep({ event, progress, markStep, openStep, setOpenStep }) {
  const [rows, setRows] = useState([{ group_name: '', category: '', table_count: 10, table_capacity: 8 }])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [requiredPlan, setRequiredPlan] = useState('')

  function updateRow(i, key, value) {
    setRows((r) => r.map((row, idx) => idx === i ? { ...row, [key]: value } : row))
  }
  function addRow() {
    setRows((r) => [...r, { group_name: '', category: '', table_count: 10, table_capacity: 8 }])
  }

  async function save() {
    setBusy(true); setErr(''); setRequiredPlan('')
    try {
      const groups = rows.filter((r) => r.group_name.trim()).map((r) => ({
        group_name: r.group_name.trim(), category: r.category.trim() || null,
        table_count: Number(r.table_count) || 1, table_capacity: Number(r.table_capacity) || 1,
      }))
      if (!groups.length) { setErr('Add at least one table group.'); setBusy(false); return }
      await api.bulkCreateTables(event.id, groups)
      markStep('tables', 'completed')
    } catch (e) {
      if (e.status === 402) setRequiredPlan(e.requiredPlan || 'tier50')
      else setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <StepShell stepKey="tables" title="Seating / tables" subtitle="Bulk-create table groups instead of adding tables one at a time"
      status={progress.tables} open={openStep === 'tables'} onToggle={() => setOpenStep(openStep === 'tables' ? '' : 'tables')}>
      {requiredPlan && <UpgradeCard requiredPlan={requiredPlan} onSkip={() => markStep('tables', 'skipped')} />}
      {!requiredPlan && (
        <>
          <div className="space-y-2">
            {rows.map((row, i) => (
              <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1.5fr_1fr_1fr]">
                <input className={input()} placeholder="Group name (e.g. VIP)" value={row.group_name} onChange={(e) => updateRow(i, 'group_name', e.target.value)} />
                <input className={input()} placeholder="Category (optional)" value={row.category} onChange={(e) => updateRow(i, 'category', e.target.value)} />
                <input className={input()} type="number" min="1" placeholder="# tables" value={row.table_count} onChange={(e) => updateRow(i, 'table_count', e.target.value)} />
                <input className={input()} type="number" min="1" placeholder="Seats/table" value={row.table_capacity} onChange={(e) => updateRow(i, 'table_capacity', e.target.value)} />
              </div>
            ))}
            <button type="button" onClick={addRow} className="text-xs font-bold text-teal-700 dark:text-teal-300">+ Add another group</button>
          </div>
          {err && <p className="mt-2 text-xs font-semibold text-red-600">{err}</p>}
          <StepFooter onSkip={() => markStep('tables', 'skipped')} onSave={save} saving={busy} />
        </>
      )}
    </StepShell>
  )
}

// ── 6. Menu ────────────────────────────────────────────────────────────────
function MenuStep({ event, progress, markStep, openStep, setOpenStep }) {
  const [rows, setRows] = useState([{ name: '', items: '' }])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [requiredPlan, setRequiredPlan] = useState('')

  function updateRow(i, key, value) {
    setRows((r) => r.map((row, idx) => idx === i ? { ...row, [key]: value } : row))
  }
  function addRow() {
    setRows((r) => [...r, { name: '', items: '' }])
  }

  async function save() {
    setBusy(true); setErr(''); setRequiredPlan('')
    try {
      for (const row of rows) {
        if (!row.name.trim()) continue
        const cat = await api.createMenuCategory(event.id, { name: row.name.trim(), selection_type: 'single', display_only: false, sort_order: 0 })
        const items = row.items.split(',').map((s) => s.trim()).filter(Boolean)
        for (const itemName of items) {
          await api.addMenuItem(event.id, cat.id, { name: itemName })
        }
      }
      markStep('menu', 'completed')
    } catch (e) {
      if (e.status === 402) setRequiredPlan(e.requiredPlan || 'tier50')
      else setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <StepShell stepKey="menu" title="Menu" subtitle="Quick-add a category with a few items — refine later from the Orders tab"
      status={progress.menu} open={openStep === 'menu'} onToggle={() => setOpenStep(openStep === 'menu' ? '' : 'menu')}>
      {requiredPlan && <UpgradeCard requiredPlan={requiredPlan} onSkip={() => markStep('menu', 'skipped')} />}
      {!requiredPlan && (
        <>
          <div className="space-y-2">
            {rows.map((row, i) => (
              <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_2fr]">
                <input className={input()} placeholder="Category (e.g. Meals)" value={row.name} onChange={(e) => updateRow(i, 'name', e.target.value)} />
                <input className={input()} placeholder="Items, comma separated (e.g. Chicken, Fish, Vegetarian)" value={row.items} onChange={(e) => updateRow(i, 'items', e.target.value)} />
              </div>
            ))}
            <button type="button" onClick={addRow} className="text-xs font-bold text-teal-700 dark:text-teal-300">+ Add another category</button>
          </div>
          {err && <p className="mt-2 text-xs font-semibold text-red-600">{err}</p>}
          <StepFooter onSkip={() => markStep('menu', 'skipped')} onSave={save} saving={busy} />
        </>
      )}
    </StepShell>
  )
}

// ── 7. Gift Registry ──────────────────────────────────────────────────────
function RegistryStep({ event, rec, progress, markStep, openStep, setOpenStep }) {
  const [selected, setSelected] = useState(new Set())
  const [customRows, setCustomRows] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [requiredPlan, setRequiredPlan] = useState('')

  function toggle(label) {
    setSelected((s) => {
      const next = new Set(s)
      next.has(label) ? next.delete(label) : next.add(label)
      return next
    })
  }

  function addCustomRow() {
    setCustomRows((r) => [...r, { title: '', kind: 'item', description: '' }])
  }
  function updateCustomRow(i, key, value) {
    setCustomRows((r) => r.map((row, idx) => idx === i ? { ...row, [key]: value } : row))
  }
  function removeCustomRow(i) {
    setCustomRows((r) => r.filter((_, idx) => idx !== i))
  }

  async function save() {
    setBusy(true); setErr(''); setRequiredPlan('')
    try {
      for (const preset of REGISTRY_PRESETS) {
        if (!selected.has(preset.label)) continue
        await api.createRegistryItem(event.id, {
          kind: preset.kind, title: preset.title, description: preset.description,
          currency: 'USD', quantity_wanted: 1,
        })
      }
      for (const row of customRows) {
        if (!row.title.trim()) continue
        await api.createRegistryItem(event.id, {
          kind: row.kind, title: row.title.trim(), description: row.description.trim() || null,
          currency: 'USD', quantity_wanted: 1,
        })
      }
      markStep('registry', 'completed')
    } catch (e) {
      if (e.status === 402) setRequiredPlan(e.requiredPlan || 'tier50')
      else setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <StepShell stepKey="registry" title="Gift registry" subtitle="Add a few starter entries — guests can view and mark them (no payments through Festio)"
      status={progress.registry} open={openStep === 'registry'} onToggle={() => setOpenStep(openStep === 'registry' ? '' : 'registry')}
      recommended={rec?.registry_common === true}>
      {requiredPlan && <UpgradeCard requiredPlan={requiredPlan} onSkip={() => markStep('registry', 'skipped')} />}
      {!requiredPlan && (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            {REGISTRY_PRESETS.map((p) => (
              <label key={p.label} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:text-slate-200">
                <input type="checkbox" checked={selected.has(p.label)} onChange={() => toggle(p.label)} />
                {p.label}
              </label>
            ))}
          </div>
          <div className="mt-3 space-y-2">
            {customRows.map((row, i) => (
              <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_2fr_auto] items-center">
                <input className={input()} placeholder="Item name" value={row.title} onChange={(e) => updateCustomRow(i, 'title', e.target.value)} />
                <select className={input()} value={row.kind} onChange={(e) => updateCustomRow(i, 'kind', e.target.value)}>
                  <option value="item">Item</option>
                  <option value="fund">Cash fund</option>
                  <option value="link">Store link</option>
                </select>
                <input className={input()} placeholder="Description (optional)" value={row.description} onChange={(e) => updateCustomRow(i, 'description', e.target.value)} />
                <button type="button" onClick={() => removeCustomRow(i)} className="text-xs text-red-500">Remove</button>
              </div>
            ))}
            <button type="button" onClick={addCustomRow} className="text-xs font-bold text-teal-700 dark:text-teal-300">+ Add your own item</button>
          </div>
          {err && <p className="mt-2 text-xs font-semibold text-red-600">{err}</p>}
          <StepFooter onSkip={() => markStep('registry', 'skipped')} onSave={save} saving={busy} canSave={selected.size > 0 || customRows.some((r) => r.title.trim())} />
        </>
      )}
    </StepShell>
  )
}

// ── 8. Logistics / Shipping ───────────────────────────────────────────────
function LogisticsStep({ event, rec, progress, markStep, openStep, setOpenStep }) {
  const [name, setName] = useState(rec?.logistics_common?.suggested_name || '')
  const [phase, setPhase] = useState('pre')
  const [populate, setPopulate] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [requiredPlan, setRequiredPlan] = useState('')

  async function save() {
    if (!name.trim()) { setErr('Give the shipment a name.'); return }
    setBusy(true); setErr(''); setRequiredPlan('')
    try {
      const shipment = await api.createShipment(event.id, {
        name: name.trim(), phase, collect_size: false, auto_add: phase === 'pre', size_options: [], notes: null,
      })
      if (populate) await api.populateShipment(event.id, shipment.id)
      markStep('logistics', 'completed')
    } catch (e) {
      if (e.status === 402) setRequiredPlan(e.requiredPlan || 'tier50')
      else setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <StepShell stepKey="logistics" title="Logistics / shipping" subtitle="Create a shipment for gifts, favors, or merch and add confirmed guests"
      status={progress.logistics} open={openStep === 'logistics'} onToggle={() => setOpenStep(openStep === 'logistics' ? '' : 'logistics')}
      recommended={!!rec?.logistics_common}>
      {requiredPlan && <UpgradeCard requiredPlan={requiredPlan} onSkip={() => markStep('logistics', 'skipped')} />}
      {!requiredPlan && (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">Shipment name</label>
              <input className={input()} list="logistics-presets" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Aso-ebi" />
              <datalist id="logistics-presets">
                {LOGISTICS_PRESETS.map((p) => <option key={p} value={p} />)}
              </datalist>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-500 dark:text-slate-400">Phase</label>
              <select className={input()} value={phase} onChange={(e) => setPhase(e.target.value)}>
                <option value="pre">Pre-event</option>
                <option value="post">Post-event</option>
              </select>
            </div>
          </div>
          <label className="mt-3 inline-flex items-center gap-2 text-sm dark:text-slate-200">
            <input type="checkbox" checked={populate} onChange={(e) => setPopulate(e.target.checked)} />
            Add all confirmed guests automatically
          </label>
          {err && <p className="mt-2 text-xs font-semibold text-red-600">{err}</p>}
          <StepFooter onSkip={() => markStep('logistics', 'skipped')} onSave={save} saving={busy} />
        </>
      )}
    </StepShell>
  )
}

// ── 9. Community (FestioMe) ───────────────────────────────────────────────
function FestioMeStep({ event, rec, progress, markStep, openStep, setOpenStep }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [requiredPlan, setRequiredPlan] = useState('')
  const [enabled, setEnabled] = useState(!!event.festiome_addon_enabled)

  async function enable() {
    setBusy(true); setErr(''); setRequiredPlan('')
    try {
      await api.enableEventFestioMe(event.id)
      setEnabled(true)
      markStep('festiome', 'completed')
    } catch (e) {
      if (e.status === 402) setRequiredPlan(e.requiredPlan || 'tier50')
      else setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <StepShell stepKey="festiome" title="Community (FestioMe)" subtitle="A private group chat/space for your guests — a default group is created automatically"
      status={progress.festiome} open={openStep === 'festiome'} onToggle={() => setOpenStep(openStep === 'festiome' ? '' : 'festiome')}
      recommended={rec?.festiome_common === 'true'}>
      {requiredPlan && <UpgradeCard requiredPlan={requiredPlan} onSkip={() => markStep('festiome', 'skipped')} />}
      {!requiredPlan && (
        <>
          {enabled ? (
            <p className="text-sm text-emerald-700 dark:text-emerald-300">✓ FestioMe is enabled for this event, with a default group and General channel already set up.</p>
          ) : (
            <button type="button" disabled={busy} onClick={enable} className="rounded-lg bg-teal-600 px-4 py-2 text-xs font-black text-white hover:bg-teal-700 disabled:opacity-50">
              {busy ? 'Enabling…' : 'Enable FestioMe for this event'}
            </button>
          )}
          <p className="mt-2 text-[11px] text-slate-400">Want sub-groups, join policies, or private channels? Configure those from FestioMe once enabled.</p>
          {err && <p className="mt-2 text-xs font-semibold text-red-600">{err}</p>}
          <StepFooter onSkip={() => markStep('festiome', 'skipped')} onSave={() => markStep('festiome', 'completed')} saveLabel="Continue" canSave={enabled} />
        </>
      )}
    </StepShell>
  )
}

// ── 10. Experience & Program ──────────────────────────────────────────────
function ExperienceProgramStep({ event, rec, progress, markStep, openStep, setOpenStep }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [requiredPlan, setRequiredPlan] = useState('')
  const [workflowId, setWorkflowId] = useState(null)
  const [programRows, setProgramRows] = useState([{ day_offset_days: 0, time_of_day: '09:00', duration_minutes: 60, title: '' }])
  const [programBusy, setProgramBusy] = useState(false)
  const [programMsg, setProgramMsg] = useState('')

  async function pickTemplate(template) {
    setBusy(true); setErr(''); setRequiredPlan('')
    try {
      const steps = template.stepKeys.map((key, index) => experienceStepPayload(EXPERIENCE_PRESET_BY_KEY[key], (index + 1) * 10))
      const workflow = await api.createExperienceWorkflow(event.id, { name: template.name, steps })
      setWorkflowId(workflow.id)
    } catch (e) {
      if (e.status === 402) setRequiredPlan(e.requiredPlan || 'tier300')
      else setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  function updateProgramRow(i, key, value) {
    setProgramRows((r) => r.map((row, idx) => idx === i ? { ...row, [key]: value } : row))
  }
  function addProgramRow() {
    setProgramRows((r) => [...r, { day_offset_days: 0, time_of_day: '09:00', duration_minutes: 60, title: '' }])
  }

  async function saveProgram() {
    setProgramBusy(true); setProgramMsg('')
    try {
      const items = programRows.filter((r) => r.title.trim()).map((r) => ({
        day_offset_days: Number(r.day_offset_days) || 0,
        time_of_day: r.time_of_day,
        duration_minutes: Number(r.duration_minutes) || 30,
        title: r.title.trim(),
      }))
      if (!items.length) { setProgramMsg('Add at least one agenda item.'); setProgramBusy(false); return }
      await api.bulkImportProgram(event.id, workflowId, items)
      setProgramMsg('Program added.')
    } catch (e) {
      setProgramMsg(e.message)
    } finally {
      setProgramBusy(false)
    }
  }

  return (
    <StepShell stepKey="experience_program" title="Guest experience & program" subtitle="Requires the Pro Event Pass — pick a guest-journey template and, optionally, a timed agenda"
      status={progress.experience_program} open={openStep === 'experience_program'} onToggle={() => setOpenStep(openStep === 'experience_program' ? '' : 'experience_program')}>
      {requiredPlan && <UpgradeCard requiredPlan={requiredPlan} onSkip={() => markStep('experience_program', 'skipped')} />}
      {!requiredPlan && !workflowId && (
        <div className="grid gap-3 sm:grid-cols-2">
          {EXPERIENCE_WORKFLOW_TEMPLATES.map((t) => (
            <button key={t.id} type="button" disabled={busy} onClick={() => pickTemplate(t)}
              className={`rounded-lg border p-3 text-left text-sm ${t.id === rec?.experience_template_key ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/30' : 'border-slate-200 dark:border-slate-700'}`}>
              <div className="font-bold text-slate-900 dark:text-white">{t.label}{t.id === rec?.experience_template_key && <span className="ml-2 text-[10px] font-black text-teal-600">Recommended</span>}</div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t.description}</div>
            </button>
          ))}
        </div>
      )}
      {!requiredPlan && workflowId && (
        <>
          <p className="text-sm text-emerald-700 dark:text-emerald-300">✓ Journey created.</p>
          {rec?.program_common && (
            <div className="mt-4">
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400">Add a timed agenda (optional)</p>
              <div className="mt-2 space-y-2">
                {programRows.map((row, i) => (
                  <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_2fr]">
                    <input className={input()} type="number" min="0" placeholder="Day (0=first)" value={row.day_offset_days} onChange={(e) => updateProgramRow(i, 'day_offset_days', e.target.value)} />
                    <input className={input()} type="time" value={row.time_of_day} onChange={(e) => updateProgramRow(i, 'time_of_day', e.target.value)} />
                    <input className={input()} type="number" min="1" placeholder="Minutes" value={row.duration_minutes} onChange={(e) => updateProgramRow(i, 'duration_minutes', e.target.value)} />
                    <input className={input()} placeholder="Title (e.g. Keynote)" value={row.title} onChange={(e) => updateProgramRow(i, 'title', e.target.value)} />
                  </div>
                ))}
                <button type="button" onClick={addProgramRow} className="text-xs font-bold text-teal-700 dark:text-teal-300">+ Add agenda item</button>
              </div>
              {programMsg && <p className="mt-2 text-xs font-semibold text-slate-500">{programMsg}</p>}
              <button type="button" disabled={programBusy} onClick={saveProgram} className="mt-3 rounded-lg bg-teal-600 px-4 py-2 text-xs font-black text-white hover:bg-teal-700 disabled:opacity-50">
                {programBusy ? 'Saving…' : 'Add program'}
              </button>
            </div>
          )}
          <StepFooter onSkip={() => markStep('experience_program', 'skipped')} onSave={() => markStep('experience_program', 'completed')} saveLabel="Continue" />
        </>
      )}
      {err && <p className="mt-2 text-xs font-semibold text-red-600">{err}</p>}
      {!workflowId && !requiredPlan && (
        <div className="mt-3"><StepFooter onSkip={() => markStep('experience_program', 'skipped')} onSave={() => markStep('experience_program', 'skipped')} saveLabel="Skip" canSave={false} /></div>
      )}
    </StepShell>
  )
}

// ── 11. Review ─────────────────────────────────────────────────────────────
const STEP_LABELS = {
  team: 'Team', messaging: 'Messaging channels', rsvp_questions: 'RSVP questions', multi_invitee: 'Multi-invitee',
  tables: 'Seating / tables', menu: 'Menu', registry: 'Gift registry', logistics: 'Logistics / shipping',
  festiome: 'Community (FestioMe)', experience_program: 'Guest experience & program',
}

function ReviewStep({ progress, openStep, setOpenStep, navigate }) {
  return (
    <StepShell stepKey="review" title="Review & finish" subtitle="Everything here is saved — activate paid modules from your dashboard whenever you're ready"
      status={progress.review} open={openStep === 'review'} onToggle={() => setOpenStep(openStep === 'review' ? '' : 'review')}>
      <ul className="space-y-1 text-sm">
        {Object.entries(STEP_LABELS).map(([key, label]) => (
          <li key={key} className="flex items-center justify-between border-b border-slate-100 py-1 dark:border-slate-800">
            <span className="text-slate-700 dark:text-slate-200">{label}</span>
            <StatusBadge status={progress[key]} />
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => navigate('/admin')} className="mt-5 rounded-lg bg-teal-600 px-5 py-3 text-sm font-black text-white hover:bg-teal-700">
        Go to my event dashboard
      </button>
    </StepShell>
  )
}
