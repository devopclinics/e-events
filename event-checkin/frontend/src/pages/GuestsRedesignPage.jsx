import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import RedesignShell, { Icon, Modal, ConfirmDialog, ChannelPreviewFrame } from './redesign/RedesignShell'
import { LoadingSkeleton, EmptyState, ErrorRetryState } from './redesign/RedesignPrimitives'
import { useCurrentEvent } from '../hooks/useCurrentEvent'
import { useEventDetails } from '../hooks/useEventDetails'
import { useGuests } from '../hooks/useGuests'
import { api } from '../api'
import './GuestsRedesignPage.css'

const STAT_TILES = [
  { key: 'total', label: 'Total Guests', icon: 'users', tone: 'teal' },
  { key: 'qr', label: 'QR Generated', icon: 'ticket', tone: 'teal' },
  { key: 'invited', label: 'Invites Sent', icon: 'send', tone: 'amber' },
  { key: 'admitted', label: 'Admitted', icon: 'check', tone: 'success' },
]

const FILTER_CHIPS = [
  { key: 'delivered', label: 'Delivered' },
  { key: 'failed', label: 'Failed' },
  { key: 'notsent', label: 'Not sent' },
  { key: 'admitted', label: 'Admitted' },
  { key: 'notadmitted', label: 'Not admitted' },
  { key: 'noqr', label: 'No QR' },
]

// Real guests/households/RSVP questions are fetched in the page component
// and threaded down as props — see GuestsRedesignPage() below.

const CHANNEL_ICON = { email: 'mail', sms: 'message', whatsapp: 'whatsapp', mms: 'image' }

// Adapts a real GuestOut (backend/app/schemas.py) into the display shape
// this mockup's table/cards already expect, so the JSX below stays stable.
function adaptGuest(g) {
  const name = [g.first_name, g.last_name].filter(Boolean).join(' ') || g.email || g.phone || 'Unnamed guest'
  const initials = (g.first_name?.[0] || '') + (g.last_name?.[0] || '') || name.slice(0, 2).toUpperCase()
  function channelState(sentAt, status) {
    if (status === 'failed') return 'fail'
    if (sentAt) return 'ok'
    return 'dash'
  }
  return {
    id: g.id,
    raw: g,
    name,
    initials,
    email: g.email || '—',
    phone: g.phone || '',
    group: g.table_group_name || 'Unassigned',
    household: g.household_name || 'Unassigned',
    role: g.rsvp_guest_type || 'Main invited',
    vip: !!g.is_vip,
    submitter: g.rsvp_submitter_name || null,
    qr: !!g.qr_generated_at,
    invited: g.invite_sent_at ? new Date(g.invite_sent_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—',
    channels: {
      email: channelState(g.invite_sent_at, g.invite_status),
      sms: channelState(g.invite_sent_at, g.invite_status),
      whatsapp: 'dash',
      mms: 'dash',
    },
    rsvp: g.rsvp_status ? g.rsvp_status.charAt(0).toUpperCase() + g.rsvp_status.slice(1) : 'Pending',
    admitted: !!g.admitted,
    pendingApproval: g.rsvp_status === 'pending',
  }
}

// HouseholdOut only carries default_table_group_id/default_table_id (not
// resolved names) — showing "Set"/"—" here rather than fetching table
// groups/tables just to resolve a label for this one column.
function adaptHousehold(h) {
  return {
    id: h.id, raw: h, name: h.name, members: h.member_count,
    defaultGroup: h.default_table_group_id ? 'Set' : '—',
    defaultTable: h.default_table_id ? 'Set' : '—',
  }
}

const QUESTION_TYPE_LABEL = { boolean: 'Yes / No', select: 'Multiple choice', text: 'Short answer' }
function adaptQuestion(q) {
  return { id: q.id, raw: q, q: q.question, type: QUESTION_TYPE_LABEL[q.question_type] || 'Short answer', required: q.is_required }
}

// ── Invite send audience breakdown ───────────────────────────────────────────
const SEND_AUDIENCE = [
  { label: 'Email', count: 480, credits: 0, icon: 'mail' },
  { label: 'SMS', count: 220, credits: 220, icon: 'message' },
  { label: 'WhatsApp', count: 180, credits: 180, icon: 'whatsapp' },
  { label: 'No contact info', count: 131, credits: 0, icon: 'warning' },
]

function deliveryStatus(g) {
  const vals = Object.values(g.channels)
  if (vals.some((v) => v === 'ok')) return 'ok'
  if (vals.some((v) => v === 'fail')) return 'fail'
  return 'notsent'
}

function matchesFilter(g, active) {
  const delivery = deliveryStatus(g)
  if (active.size === 0) return true
  return (
    (active.has('delivered') && delivery === 'ok') ||
    (active.has('failed') && delivery === 'fail') ||
    (active.has('notsent') && delivery === 'notsent') ||
    (active.has('admitted') && g.admitted) ||
    (active.has('notadmitted') && !g.admitted) ||
    (active.has('noqr') && !g.qr)
  )
}

function StatTile({ s }) {
  return (
    <div className="rr-panel gr-stat">
      <div className={`gr-stat-icon ${s.tone}`}><Icon name={s.icon} size={15} /></div>
      <div className="gr-stat-value">{s.value}</div>
      <div className="gr-stat-label">{s.label}</div>
      <div className="gr-stat-caption">{s.caption}</div>
    </div>
  )
}

function RowMenu({ g, notify, onView, onEdit, onRemove }) {
  const [open, setOpen] = useState(false)
  const actions = [
    ['View', () => onView(g)],
    ['Edit', () => onEdit(g)],
    ['Remove', () => onRemove(g)],
  ]
  return (
    <div className="gr-rowmenu">
      <button className="gr-rowmenu-btn" onClick={() => setOpen((v) => !v)} aria-label={`Actions for ${g.name}`}><Icon name="more" size={14} /></button>
      {open && (
        <div className="gr-rowmenu-list">
          {actions.map(([label, fn]) => (
            <button key={label} className={label === 'Remove' ? 'gr-danger-link' : ''} onClick={() => { fn(); setOpen(false) }}>{label}</button>
          ))}
        </div>
      )}
    </div>
  )
}

function ExportMenu({ notify, filteredCount, totalCount, eventId, filteredIds }) {
  const [open, setOpen] = useState(false)
  const [format, setFormat] = useState('xlsx')
  const [sections, setSections] = useState(() => new Set(['guests']))
  const [onlyFiltered, setOnlyFiltered] = useState(false)

  function toggleSection(key) {
    setSections((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function runExport() {
    api.downloadGuestList(eventId, format, [...sections].join(','), onlyFiltered ? filteredIds : null)
      .then(() => notify(`Exported ${onlyFiltered ? filteredCount : totalCount} guests as ${format.toUpperCase()}`))
      .catch((err) => notify(err.message || 'Export failed'))
    setOpen(false)
  }

  return (
    <div className="gr-exportwrap">
      <button className="rr-btn secondary" style={{ height: 30, fontSize: 10.5, padding: '0 10px' }} onClick={() => setOpen((v) => !v)}>
        <Icon name="upload" size={12} /> Export
      </button>
      {open && (
        <div className="gr-exportpanel">
          <div className="rd-seg" style={{ marginBottom: 10 }}>
            <button className={format === 'xlsx' ? 'on' : ''} onClick={() => setFormat('xlsx')}>XLSX</button>
            <button className={format === 'csv' ? 'on' : ''} onClick={() => setFormat('csv')}>CSV</button>
          </div>
          {[['guests', 'Guests + RSVP + seating'], ['messaging', 'Messaging delivery'], ['experience', 'Experience']].map(([key, label]) => (
            <label key={key} className="gr-export-row">
              <input type="checkbox" checked={sections.has(key)} onChange={() => toggleSection(key)} /> {label}
            </label>
          ))}
          <label className="gr-export-row">
            <input type="checkbox" checked={onlyFiltered} onChange={(e) => setOnlyFiltered(e.target.checked)} /> Only filtered guests ({filteredCount})
          </label>
          <button className="rr-btn primary" style={{ width: '100%', justifyContent: 'center', marginTop: 10 }} onClick={runExport}>Export</button>
        </div>
      )}
    </div>
  )
}

function GuestsTab({ notify, onView, onEdit, onRemove, onApproveRsvp, onRejectRsvp, onApproveAll, onSendSelected, eventId, guests, guestsLoading, guestsError, onRetryGuests, households, householdsLoading, tableGroups, onAddHousehold, onEditHousehold, onDeleteHousehold, onBulkAssignHousehold, onBulkAssignTableGroup, rsvpQuestions, stats }) {
  const [query, setQuery] = useState('')
  const [activeChips, setActiveChips] = useState(() => new Set())
  const [selected, setSelected] = useState(() => new Set())
  const [role, setRole] = useState('All roles')
  const [household, setHousehold] = useState('All households')
  const [tableGroup, setTableGroup] = useState('All table groups')
  const [submitter, setSubmitter] = useState('All submitters')
  const [householdsOpen, setHouseholdsOpen] = useState(false)
  const [page, setPage] = useState(1)
  const pageCount = Math.max(1, Math.ceil(guests.length / 25))

  function toggleChip(key) {
    setActiveChips((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleSelected(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll(list) {
    setSelected((prev) => {
      if (prev.size === list.length) return new Set()
      return new Set(list.map((g) => g.id))
    })
  }

  const filtered = useMemo(() => {
    return guests.filter((g) => matchesFilter(g, activeChips))
      .filter((g) => g.name.toLowerCase().includes(query.trim().toLowerCase()))
      .filter((g) => role === 'All roles' || g.role === role)
      .filter((g) => household === 'All households' || g.household === household)
      .filter((g) => tableGroup === 'All table groups' || g.group === tableGroup)
      .filter((g) => submitter === 'All submitters' || (submitter === 'Self-submitted' ? !g.submitter : `Guest of ${g.submitter}` === submitter))
  }, [guests, query, activeChips, role, household, tableGroup, submitter])

  const pendingApprovalGuests = guests.filter((g) => g.pendingApproval)
  const fullPageSelected = selected.size > 0 && selected.size === filtered.length
  const roleOptions = ['All roles', ...new Set(guests.map((g) => g.role).filter(Boolean))]
  const householdOptions = ['All households', ...new Set(guests.map((g) => g.household).filter(Boolean))]
  const tableGroupOptions = ['All table groups', ...new Set(guests.map((g) => g.group).filter(Boolean))]
  const submitterOptions = ['All submitters', 'Self-submitted', ...new Set(guests.filter((g) => g.submitter).map((g) => `Guest of ${g.submitter}`))]

  return (
    <>
      <div className="rr-grid4">
        {stats.map((s) => <StatTile key={s.key} s={s} />)}
      </div>

      {pendingApprovalGuests.length > 0 && (
        <div className="gr-approval-section">
          <div className="gr-approval-section-head">
            <div>
              <strong><Icon name="clock" size={13} /> {pendingApprovalGuests.length} RSVP{pendingApprovalGuests.length > 1 ? 's' : ''} awaiting your approval</strong>
              <span>Review each submission before confirming</span>
            </div>
            <button className="rr-btn primary" style={{ fontSize: '0.8rem' }} onClick={() => onApproveAll && onApproveAll(pendingApprovalGuests.length)}>
              Approve all {pendingApprovalGuests.length}
            </button>
          </div>
          <div className="gr-approval-queue">
            {pendingApprovalGuests.map((g) => (
              <div className="gr-approval-queue-row" key={g.id}>
                <span className="gr-approval-initials">{g.initials}</span>
                <div className="gr-approval-info">
                  <strong>{g.name}</strong>
                  {g.submitter && <small>submitted by {g.submitter}</small>}
                  <small className="rd-rowlink">{g.email || '—'} · {g.group}</small>
                </div>
                <div className="gr-approval-answers">
                  {rsvpQuestions.slice(0, 2).map((rq) => (
                    <span key={rq.q} className="gr-approval-answer-pill" title={rq.q}>—</span>
                  ))}
                </div>
                <div className="gr-approval-btns">
                  <button className="rr-btn primary" style={{ fontSize: '0.78rem', padding: '4px 12px' }} onClick={() => onApproveRsvp && onApproveRsvp(g)}>Approve</button>
                  <button className="rr-btn secondary" style={{ fontSize: '0.78rem', padding: '4px 12px' }} onClick={() => onRejectRsvp && onRejectRsvp(g)}>Decline</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rd-attn-toolbar gr-toolbar">
        <div className="rd-search">
          <Icon name="search" size={14} />
          <input placeholder="Search guests by name…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      <div className="gr-select-row">
        <select className="rr-select gr-inline-select" value={role} onChange={(e) => setRole(e.target.value)}>
          {roleOptions.map((o) => <option key={o}>{o}</option>)}
        </select>
        <select className="rr-select gr-inline-select" value={household} onChange={(e) => setHousehold(e.target.value)}>
          {householdOptions.map((o) => <option key={o}>{o}</option>)}
        </select>
        <select className="rr-select gr-inline-select" value={tableGroup} onChange={(e) => setTableGroup(e.target.value)}>
          {tableGroupOptions.map((o) => <option key={o}>{o}</option>)}
        </select>
        <select className="rr-select gr-inline-select" value={submitter} onChange={(e) => setSubmitter(e.target.value)}>
          {submitterOptions.map((o) => <option key={o}>{o}</option>)}
        </select>
      </div>

      <div className="gr-chip-row">
        {FILTER_CHIPS.map((c) => (
          <button
            key={c.key}
            className={`gr-filter-chip ${activeChips.has(c.key) ? 'active' : ''}`}
            onClick={() => toggleChip(c.key)}
          >
            {c.label}
          </button>
        ))}
      </div>

      {selected.size > 0 && (
        <div className="gr-bulkbar">
          <span><b>{selected.size}</b> selected</span>
          <div className="gr-bulkbar-actions">
            <button className="rr-btn secondary" onClick={() => onSendSelected?.([...selected])}>
              <Icon name="send" size={13} /> Send invite
            </button>
            <select className="rr-select gr-inline-select" aria-label="Assign table group" defaultValue="" onChange={async (e) => {
              if (!e.target.value) return
              await onBulkAssignTableGroup([...selected], e.target.value === 'none' ? null : e.target.value)
              setSelected(new Set())
              e.target.value = ''
            }}>
              <option value="">Assign table group…</option>
              <option value="none">Clear table group</option>
              {tableGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
            <select className="rr-select gr-inline-select" aria-label="Assign household" defaultValue="" onChange={async (e) => {
              if (!e.target.value) return
              await onBulkAssignHousehold([...selected], e.target.value === 'none' ? null : e.target.value)
              setSelected(new Set())
              e.target.value = ''
            }}><option value="">Assign household…</option><option value="none">Clear household</option>{households.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select>
            <button className="rr-link-btn" onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        </div>
      )}

      <div className="rr-panel gr-table-panel">
        <div className="rd-panel-body">
          <table className="rr-table gr-guest-table">
            <thead>
              <tr>
                <th style={{ width: 26 }}>
                  <input type="checkbox" checked={fullPageSelected} onChange={() => toggleSelectAll(filtered)} />
                </th>
                <th>Name</th>
                <th>Email / Phone</th>
                <th>Seating group</th>
                <th>QR</th>
                <th>Invited</th>
                <th>Delivery</th>
                <th>RSVP</th>
                <th>Admitted</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((g) => (
                <tr key={g.id}>
                  <td><input type="checkbox" checked={selected.has(g.id)} onChange={() => toggleSelected(g.id)} /></td>
                  <td>
                    <div className="rd-who">
                      <span className="dot">{g.initials}</span>
                      <div>
                        <div className="gr-name-row">
                          {g.name}
                          {g.vip && <span className="gr-vip-badge">VIP</span>}
                          {g.household !== 'Unassigned' && <span className="gr-household-badge">{g.household}</span>}
                        </div>
                        <small className="rd-rowlink">{g.submitter ? `${g.role} · Guest of ${g.submitter}` : g.role}</small>
                      </div>
                    </div>
                  </td>
                  <td className="rd-rowlink">{g.email}<br />{g.phone || '—'}</td>
                  <td className="rd-rowlink">{g.group}</td>
                  <td>{g.qr ? <span className="rd-status-chip ok"><Icon name="check" size={11} /> Ready</span> : <span className="rd-status-chip warn">No QR</span>}</td>
                  <td className="rd-rowlink">{g.invited}</td>
                  <td>
                    <div className="gr-channel-row">
                      {['email', 'sms', 'whatsapp', 'mms'].map((ch) => (
                        <span key={ch} className={`gr-channel-dot ${g.channels[ch]}`} title={`${ch}: ${g.channels[ch] === 'ok' ? 'delivered' : g.channels[ch] === 'fail' ? 'failed' : 'not sent'}`}>
                          <Icon name={CHANNEL_ICON[ch]} size={11} />
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="rd-rowlink">
                    {g.rsvp}
                    {g.pendingApproval && (
                      <div className="gr-approve-row">
                        <button className="rr-link-btn" onClick={() => onApproveRsvp(g)}>Approve</button>
                        <button className="rr-link-btn gr-danger-link" onClick={() => onRejectRsvp(g)}>Reject</button>
                      </div>
                    )}
                  </td>
                  <td>
                    {g.admitted
                      ? <span className="rd-status-chip ok"><Icon name="check" size={11} /> Admitted</span>
                      : <span className="rd-status-chip warn">Not yet</span>}
                  </td>
                  <td className="rd-rowlink"><RowMenu g={g} notify={notify} onView={onView} onEdit={onEdit} onRemove={onRemove} /></td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={10} className="rd-rowlink" style={{ textAlign: 'center', padding: '18px 8px' }}>No matches.</td></tr>
              )}
            </tbody>
          </table>
          <div className="rd-attn-footer gr-footer">
            <span>
              Showing {filtered.length} of {guests.length} guests
              {fullPageSelected && (
                <button className="rr-link-btn" style={{ marginLeft: 8 }} onClick={() => setSelected(new Set(guests.map((guest) => guest.id)))}>Select all {guests.length} guests</button>
              )}
            </span>
            <div className="gr-footer-actions">
              <ExportMenu notify={notify} filteredCount={filtered.length} totalCount={guests.length} eventId={eventId} filteredIds={filtered.map((g) => g.id)} />
            </div>
          </div>
        </div>
      </div>

      <div className="rr-panel gr-households">
        <div className="rd-panel-head gr-households-head">
          <div><h3>Households</h3><p>{households.length} households · group guests who arrive/leave together</p></div>
          <div className="gr-actions">
            <button className="rr-link-btn" onClick={() => setHouseholdsOpen((v) => !v)}>{householdsOpen ? 'Hide' : 'Show'}</button>
            <button className="rr-btn secondary" onClick={() => onAddHousehold()}><Icon name="plus" size={13} /> Household</button>
          </div>
        </div>
        {householdsOpen && (
          <div className="rd-panel-body">
            {householdsLoading ? <LoadingSkeleton rows={2} variant="list" /> : households.length === 0 ? (
              <p className="rd-rowlink">No households yet.</p>
            ) : (
            <table className="rr-table">
              <thead><tr><th>Name</th><th>Members</th><th>Default table group</th><th>Default table</th><th /></tr></thead>
              <tbody>
                {households.map((h) => (
                  <tr key={h.id}>
                    <td>{h.name}</td>
                    <td>{h.members}</td>
                    <td>{h.defaultGroup}</td>
                    <td>{h.defaultTable}</td>
                    <td className="gr-actions">
                      <button className="rr-link-btn" onClick={() => onEditHousehold(h)}>Edit</button>
                      <button className="rr-link-btn gr-danger-link" onClick={() => onDeleteHousehold(h)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            )}
          </div>
        )}
      </div>
    </>
  )
}

const QUESTION_TYPES = ['Yes / No', 'Short answer', 'Multiple choice']
const PRESET_QUESTIONS = ['— Choose a preset —', 'Dietary restrictions', 'Plus-one?', 'Song request', 'Transportation needed?']
const INVITE_THEMES = [
  { id: 'default', label: 'Teal (Default)' },
  { id: 'gold', label: 'Gold' },
  { id: 'rose', label: 'Rose' },
  { id: 'midnight', label: 'Midnight' },
  { id: 'forest', label: 'Forest' },
]
const CATEGORY_LIMITS = [
  { category: 'Family', max: 4, submitterTable: 'Same as submitter', invitedTable: 'Family — Bride' },
  { category: 'Friends', max: 2, submitterTable: 'Same as submitter', invitedTable: 'Friends — Bride' },
  { category: 'Colleagues', max: 1, submitterTable: 'Same as submitter', invitedTable: 'Colleagues' },
]

function QuestionForm({ notify, onDone, onSave }) {
  const [type, setType] = useState(QUESTION_TYPES[0])
  const [preset, setPreset] = useState(PRESET_QUESTIONS[0])
  const [text, setText] = useState('')
  const [options, setOptions] = useState('')
  const [required, setRequired] = useState(false)

  return (
    <div className="gr-question-form">
      <label className="rd-field-label">Start from a preset (optional)</label>
      <select className="rr-select" value={preset} onChange={(e) => { setPreset(e.target.value); if (e.target.value !== PRESET_QUESTIONS[0]) setText(e.target.value) }}>
        {PRESET_QUESTIONS.map((p) => <option key={p}>{p}</option>)}
      </select>
      <label className="rd-field-label">Question</label>
      <input className="rd-field" placeholder="e.g. Will you need parking?" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="rd-row2">
        <div style={{ flex: 1 }}>
          <label className="rd-field-label">Answer type</label>
          <select className="rr-select" value={type} onChange={(e) => setType(e.target.value)}>
            {QUESTION_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <label className="gr-required-check">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Required
        </label>
      </div>
      {type === 'Multiple choice' && (
        <>
          <label className="rd-field-label">Options (one per line)</label>
          <textarea className="rr-textarea" rows={3} placeholder={'Beef\nChicken\nVegetarian'} value={options} onChange={(e) => setOptions(e.target.value)} />
        </>
      )}
      <div className="rd-row2" style={{ marginTop: 8 }}>
        <button className="rr-btn secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={onDone}>Cancel</button>
        <button className="rr-btn primary" style={{ flex: 1, justifyContent: 'center' }} onClick={async () => {
          const question = (text || (preset !== PRESET_QUESTIONS[0] ? preset : '')).trim()
          if (!question) return
          try {
            await onSave({
              question,
              question_type: type === 'Yes / No' ? 'boolean' : type === 'Multiple choice' ? 'select' : 'text',
              options: type === 'Multiple choice' ? options : null,
              is_required: required,
              sort_order: 0,
            })
            notify(`Question added: "${question}"`)
            onDone()
          } catch (e) {
            notify(e.message || 'Question could not be saved', true)
          }
        }}>Save question</button>
      </div>
    </div>
  )
}

function ManualInvitePanel({ notify }) {
  const [rows, setRows] = useState([{ name: '', contact: '', email: true, sms: false, whatsapp: false }])

  function updateRow(i, patch) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }

  function addRow() {
    setRows((prev) => [...prev, { name: '', contact: '', email: true, sms: false, whatsapp: false }])
  }

  function send() {
    const named = rows.filter((r) => r.name.trim())
    notify(named.length ? 'Outbound invitation sends remain on the legacy interface during Stage B' : 'Add at least one name before sending', !!named.length)
  }

  return (
    <div className="rr-panel gr-manual-invite">
      <div className="rd-panel-head"><h3>Send invitations by hand</h3><p>Invite people who aren't in your guest list yet</p></div>
      <div className="rd-panel-body">
        {rows.map((r, i) => (
          <div className="gr-manual-row" key={i}>
            <input className="rd-field" placeholder="Name" value={r.name} onChange={(e) => updateRow(i, { name: e.target.value })} style={{ marginBottom: 0 }} />
            <input className="rd-field" placeholder="Email or phone" value={r.contact} onChange={(e) => updateRow(i, { contact: e.target.value })} style={{ marginBottom: 0 }} />
            <div className="gr-manual-channels">
              {['email', 'sms', 'whatsapp'].map((ch) => (
                <label key={ch}><input type="checkbox" checked={r[ch]} onChange={(e) => updateRow(i, { [ch]: e.target.checked })} /> {ch}</label>
              ))}
            </div>
          </div>
        ))}
        <button className="rr-link-btn" onClick={addRow}><Icon name="plus" size={12} /> Add another</button>
        <button className="rr-btn primary" style={{ width: '100%', justifyContent: 'center', marginTop: 12 }} onClick={send}>Send invitations</button>
      </div>
    </div>
  )
}

function InviteTab({ notify, onSendInvites, onSendGuests, onPreviewInvite, eventId, event, guests, rsvpQuestions, onQuestionsChanged, onEventChanged }) {
  const navigate = useNavigate()
  const [rsvpEnabled, setRsvpEnabled] = useState(true)
  const [mode, setMode] = useState('open')
  const [approval, setApproval] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const [theme, setTheme] = useState(INVITE_THEMES[0].id)
  const [sameEmail, setSameEmail] = useState(false)
  const [multiInvitee, setMultiInvitee] = useState(true)
  const [maxInvitees, setMaxInvitees] = useState(4)
  const [submitterEmail, setSubmitterEmail] = useState('required')
  const [submitterPhone, setSubmitterPhone] = useState('optional')
  const [additionalEmail, setAdditionalEmail] = useState('optional')
  const [additionalPhone, setAdditionalPhone] = useState('dontask')
  const [addingQuestion, setAddingQuestion] = useState(false)
  const [deadline, setDeadline] = useState('')
  const [capacity, setCapacity] = useState('')
  const [inviteMessage, setInviteMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [coverBusy, setCoverBusy] = useState(false)
  const coverFileRef = useRef(null)
  const publicLink = event?.rsvp_token ? `${window.location.origin}/rsvp/${event.rsvp_token}` : 'Generate an RSVP link to begin'

  async function uploadCover(file) {
    if (!file || !eventId) return
    setCoverBusy(true)
    try {
      await api.uploadCoverImage(eventId, file)
      await onEventChanged()
      notify('Cover image uploaded')
    } catch (e) { notify(e.message || 'Cover image could not be uploaded', true) }
    finally { setCoverBusy(false); if (coverFileRef.current) coverFileRef.current.value = '' }
  }

  async function removeCover() {
    if (!eventId) return
    setCoverBusy(true)
    try {
      await api.deleteCoverImage(eventId)
      await onEventChanged()
      notify('Cover image removed')
    } catch (e) { notify(e.message || 'Cover image could not be removed', true) }
    finally { setCoverBusy(false) }
  }

  const rsvpCounts = useMemo(() => {
    const total = guests?.length || 0
    const confirmed = guests?.filter((g) => g.rsvp === 'Confirmed').length || 0
    const declined = guests?.filter((g) => g.rsvp === 'Declined').length || 0
    const pendingApproval = guests?.filter((g) => g.rsvp === 'Pending').length || 0
    const awaitingReply = guests?.filter((g) => g.rsvp === 'Invited').length || 0
    const notInvited = guests?.filter((g) => g.invited === '—').length || 0
    return { total, confirmed, declined, pendingApproval, awaitingReply, notInvited }
  }, [guests])
  const reminderGuestIds = useMemo(
    () => guests.filter((g) => g.raw.invite_sent_at && !['confirmed', 'declined'].includes(String(g.raw.rsvp_status || '').toLowerCase())).map((g) => g.id),
    [guests],
  )
  const invitedGuestIds = useMemo(
    () => guests.filter((g) => g.raw.invite_sent_at).map((g) => g.id),
    [guests],
  )

  useEffect(() => {
    if (!event) return
    setRsvpEnabled(!!event.rsvp_enabled)
    setMode(event.invite_mode || 'open')
    setApproval(!!event.rsvp_require_approval)
    setTheme(event.invite_theme || INVITE_THEMES[0].id)
    setSameEmail(!!event.rsvp_allow_duplicate_emails)
    setMultiInvitee(!!event.rsvp_multi_invitee_enabled)
    setMaxInvitees(event.rsvp_multi_invitee_limit ?? 4)
    setSubmitterEmail(!event.rsvp_collect_email ? 'dontask' : event.rsvp_email_required ? 'required' : 'optional')
    setSubmitterPhone(!event.rsvp_collect_phone ? 'dontask' : event.rsvp_phone_required ? 'required' : 'optional')
    setAdditionalEmail(event.rsvp_invitee_email_required ? 'required' : 'optional')
    setAdditionalPhone(!event.rsvp_collect_phone ? 'dontask' : event.rsvp_invitee_phone_required ? 'required' : 'optional')
    setDeadline(event.rsvp_deadline ? String(event.rsvp_deadline).slice(0, 10) : '')
    setCapacity(event.rsvp_capacity ?? '')
    setInviteMessage(event.invite_message || '')
  }, [event])

  function copyLink() {
    if (!event?.rsvp_token) return
    navigator.clipboard?.writeText(publicLink)
    setLinkCopied(true)
    notify('RSVP link copied to clipboard')
    window.setTimeout(() => setLinkCopied(false), 1800)
  }

  async function saveSettings() {
    if (!eventId || saving) return
    setSaving(true)
    try {
      await api.updateInviteSettings(eventId, {
        rsvp_enabled: rsvpEnabled,
        invite_mode: mode,
        invite_theme: theme,
        rsvp_require_approval: approval,
        rsvp_allow_duplicate_emails: sameEmail,
        rsvp_multi_invitee_enabled: multiInvitee,
        rsvp_multi_invitee_limit: Math.max(1, Number(maxInvitees) || 1),
        rsvp_collect_email: submitterEmail !== 'dontask',
        rsvp_email_required: submitterEmail === 'required',
        rsvp_invitee_email_required: additionalEmail === 'required',
        rsvp_collect_phone: submitterPhone !== 'dontask' || additionalPhone !== 'dontask',
        rsvp_phone_required: submitterPhone === 'required',
        rsvp_invitee_phone_required: additionalPhone === 'required',
        rsvp_deadline: deadline ? `${deadline}T23:59:59` : null,
        rsvp_capacity: capacity === '' ? null : Number(capacity),
        invite_message: inviteMessage || null,
      })
      await onEventChanged()
      notify('RSVP settings saved')
    } catch (e) {
      notify(e.message || 'RSVP settings could not be saved', true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="gr-quick-row">
        <button className="rr-panel gr-quick-card" onClick={() => onSendInvites ? onSendInvites(rsvpCounts.notInvited) : notify('Invitation sending is available on the legacy interface during rollout')}>
          <span className="gr-quick-icon amber"><Icon name="send" size={16} /></span>
          <span className="gr-quick-text">
            <strong>Send first invitations</strong>
            <small>{rsvpCounts.notInvited} guest{rsvpCounts.notInvited === 1 ? '' : 's'} haven't received one yet</small>
          </span>
          <span className="gr-quick-count">{rsvpCounts.notInvited}</span>
        </button>
        <button className="rr-panel gr-quick-card" disabled={!reminderGuestIds.length} onClick={() => onSendGuests(reminderGuestIds)}>
          <span className="gr-quick-icon teal"><Icon name="bell" size={16} /></span>
          <span className="gr-quick-text">
            <strong>Remind guests with no reply</strong>
            <small>{reminderGuestIds.length} guest{reminderGuestIds.length === 1 ? '' : 's'} haven't responded</small>
          </span>
          <span className="gr-quick-count">{reminderGuestIds.length}</span>
        </button>
        <button className="rr-panel gr-quick-card" disabled={!invitedGuestIds.length} onClick={() => onSendGuests(invitedGuestIds)}>
          <span className="gr-quick-icon teal"><Icon name="upload" size={16} /></span>
          <span className="gr-quick-text">
            <strong>Resend to all</strong>
            <small>Re-send the invite to everyone</small>
          </span>
          <span className="gr-quick-count">{invitedGuestIds.length}</span>
        </button>
      </div>

      <div className="rr-panel gr-rsvp-mode">
        <div className="rd-panel-body gr-rsvp-mode-body">
          <label className={`gr-mode-card ${rsvpEnabled ? 'active' : ''}`}>
            <input type="radio" checked={rsvpEnabled} onChange={() => { setRsvpEnabled(true); notify('Switched to "With RSVP" — guests confirm or decline') }} />
            <strong>With RSVP</strong><span>Guests confirm or decline through a form</span>
          </label>
          <label className={`gr-mode-card ${!rsvpEnabled ? 'active' : ''}`}>
            <input type="radio" checked={!rsvpEnabled} onChange={() => { setRsvpEnabled(false); notify('Switched to "Skip RSVP" — all guests are treated as attending') }} />
            <strong>Skip RSVP</strong><span>Everyone is treated as attending — no form at all</span>
          </label>
        </div>
      </div>

      {rsvpEnabled && (
      <div className="rd-wide-grid">
        <div className="rr-panel">
          <div className="rd-panel-head">
            <h3>Public RSVP link</h3>
            <p>Share this link anywhere — social bio, email signature, printed invite</p>
          </div>
          <div className="rd-panel-body">
            <label className="rd-field-label">Public link</label>
            <div className="gr-link-row">
              <input className="rd-field" style={{ marginBottom: 0 }} value={publicLink} readOnly />
              <button className="rr-btn secondary" onClick={copyLink}>
                <Icon name={linkCopied ? 'check' : 'external'} size={13} /> {linkCopied ? 'Copied' : 'Copy'}
              </button>
              <button className="rr-btn secondary" onClick={async () => {
                try {
                  await api.generateRSVPLink(eventId, !!event?.rsvp_token)
                  await onEventChanged()
                  notify(event?.rsvp_token ? 'RSVP link regenerated' : 'RSVP link generated')
                } catch (e) { notify(e.message || 'RSVP link could not be generated', true) }
              }}>{event?.rsvp_token ? 'Regenerate' : 'Generate'}</button>
            </div>
            {publicLink
              ? <a className="rd-hint gr-preview-link" href={publicLink} target="_blank" rel="noreferrer">Preview invite page ↗</a>
              : <span className="rd-hint">Generate the public RSVP link to preview the invite page.</span>}

            <label className="rd-field-label" style={{ marginTop: 14 }}>Invite page theme</label>
            <select className="rr-select" value={theme} onChange={(e) => { setTheme(e.target.value); notify(`Invite theme set to ${INVITE_THEMES.find((t) => t.id === e.target.value)?.label} — click Save RSVP settings to apply`) }}>
              {INVITE_THEMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            <button className="rr-btn secondary" style={{ marginTop: 8 }} onClick={() => onPreviewInvite ? onPreviewInvite() : notify('Invite email preview opened')}>
              <Icon name="eye" size={13} /> Preview invitation email
            </button>

            <label className="rd-field-label" style={{ marginTop: 4 }}>Cover image</label>
            <div className="gr-cover-row">
              <div className="gr-cover-preview">{event?.invite_cover_image ? <img src={event.invite_cover_image} alt="Cover" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} /> : <Icon name="image" size={18} />}</div>
              <input ref={coverFileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(e) => uploadCover(e.target.files?.[0])} />
              <button className="rr-btn secondary" disabled={coverBusy} onClick={() => coverFileRef.current?.click()}>{coverBusy ? 'Working…' : 'Upload'}</button>
              {event?.invite_cover_image && <button className="rr-link-btn gr-danger-link" disabled={coverBusy} onClick={removeCover}>Remove</button>}
            </div>

            <div className="rd-toggle-row" style={{ marginTop: 16 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>
                {mode === 'open' ? 'Open — anyone with the link can RSVP' : 'Closed — only guests with a personal link can RSVP'}
              </span>
              <label className="rd-switch">
                <input type="checkbox" checked={mode === 'closed'} onChange={(e) => { const m = e.target.checked ? 'closed' : 'open'; setMode(m); notify(`Who-can-RSVP set to ${m === 'closed' ? 'Closed' : 'Open'}`) }} />
                <span className="track" /><span className="knob" />
              </label>
            </div>
            {mode === 'closed' && <div className="rd-hint">Guests will only be able to RSVP from the personal link in their invite — the public link above won't accept new responses.</div>}

            <div className="rd-toggle-row" style={{ marginTop: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>Review RSVPs before confirming (approval required)</span>
              <label className="rd-switch">
                <input type="checkbox" checked={approval} onChange={(e) => { setApproval(e.target.checked); notify(`Approval required ${e.target.checked ? 'enabled' : 'disabled'}`) }} />
                <span className="track" /><span className="knob" />
              </label>
            </div>

            <div className="rd-row2" style={{ marginTop: 12 }}>
              <div style={{ flex: 1 }}>
                <label className="rd-field-label">RSVP deadline</label>
                <input className="rd-field" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label className="rd-field-label">Capacity limit</label>
                <input className="rd-field" type="number" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
              </div>
            </div>
            <div className="rd-hint">Leave capacity blank for unlimited RSVPs.</div>

            <label className="rd-field-label" style={{ marginTop: 14 }}>Message for guests</label>
            <textarea className="rr-textarea" rows={3} value={inviteMessage} placeholder="A short note shown on the RSVP page…" onChange={(e) => setInviteMessage(e.target.value)} />

            <label className="gr-required-check" style={{ marginTop: 10 }}>
              <input type="checkbox" checked={sameEmail} onChange={(e) => { setSameEmail(e.target.checked); notify(`Allow same email on multiple guests: ${e.target.checked ? 'on' : 'off'}`) }} />
              Allow the same email address on multiple RSVP guests
            </label>
            <button className="rr-btn primary" disabled={saving} style={{ marginTop: 14 }} onClick={saveSettings}>{saving ? 'Saving…' : 'Save RSVP settings'}</button>
          </div>
        </div>

        <div className="rr-panel">
          <div className="rd-panel-head">
            <h3>RSVP status</h3>
            <p>Live breakdown of responses so far</p>
          </div>
          <div className="rd-panel-body">
            <div className="gr-legend">
              <div className="gr-legend-row"><i className="gr-dot ok" /> Confirmed <b>{rsvpCounts.confirmed}</b></div>
              <div className="gr-legend-row"><i className="gr-dot fail" /> Declined <b>{rsvpCounts.declined}</b></div>
              <div className="gr-legend-row"><i className="gr-dot warn" /> Awaiting reply <b>{rsvpCounts.awaitingReply}</b></div>
              <div className="gr-legend-row"><i className="gr-dot warn" /> Pending approval <b>{rsvpCounts.pendingApproval}</b></div>
            </div>
            <div className="rd-mini-bar" style={{ height: 8, marginTop: 4 }}>
              <i style={{ width: `${rsvpCounts.total ? Math.round((rsvpCounts.confirmed / rsvpCounts.total) * 100) : 0}%` }} />
            </div>
            <button className="rr-link-btn" style={{ marginTop: 12 }} onClick={() => navigate('/event-results-redesign?tab=invitations')}>
              View full RSVP report <Icon name="arrow" size={13} />
            </button>

            <div className="rr-section-title" style={{ margin: '18px 0 8px' }}>
              <div><h2 style={{ fontSize: 12 }}>RSVP form fields</h2></div>
            </div>
            <table className="rr-table gr-field-table">
              <thead><tr><th /><th>Submitter</th><th>Additional guests</th></tr></thead>
              <tbody>
                <tr>
                  <td>Email</td>
                  <td>
                    <select className="rr-select gr-inline-select" value={submitterEmail} onChange={(e) => setSubmitterEmail(e.target.value)}>
                      <option value="dontask">Don't ask</option><option value="optional">Optional</option><option value="required">Required</option>
                    </select>
                  </td>
                  <td>
                    <select className="rr-select gr-inline-select" value={additionalEmail} onChange={(e) => setAdditionalEmail(e.target.value)}>
                      <option value="optional">Optional</option><option value="required">Required</option>
                    </select>
                  </td>
                </tr>
                <tr>
                  <td>Phone</td>
                  <td>
                    <select className="rr-select gr-inline-select" value={submitterPhone} onChange={(e) => setSubmitterPhone(e.target.value)}>
                      <option value="dontask">Don't ask</option><option value="optional">Optional</option><option value="required">Required</option>
                    </select>
                  </td>
                  <td>
                    <select className="rr-select gr-inline-select" value={additionalPhone} onChange={(e) => setAdditionalPhone(e.target.value)}>
                      <option value="dontask">Don't ask</option><option value="optional">Optional</option><option value="required">Required</option>
                    </select>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
      )}

      {rsvpEnabled && (
      <div className="rr-panel gr-multi-invitee">
        <div className="rd-panel-head"><h3>Multi-invitee settings</h3><p>Let one submitter RSVP for guests they're bringing</p></div>
        <div className="rd-panel-body">
          <div className="rd-toggle-row">
            <span style={{ fontSize: 12, fontWeight: 600 }}>Allow additional guests per RSVP</span>
            <label className="rd-switch">
              <input type="checkbox" checked={multiInvitee} onChange={(e) => { setMultiInvitee(e.target.checked); notify(`Multi-invitee ${e.target.checked ? 'enabled' : 'disabled'}`) }} />
              <span className="track" /><span className="knob" />
            </label>
          </div>
          {multiInvitee && (
            <>
              <label className="rd-field-label" style={{ marginTop: 10 }}>Default max invitees per RSVP</label>
              <input className="rd-field" type="number" value={maxInvitees} onChange={(e) => setMaxInvitees(e.target.value)} style={{ maxWidth: 140 }} />
              <label className="rd-field-label" style={{ marginTop: 10 }}>Category invitee limits &amp; table mapping</label>
              <table className="rr-table">
                <thead><tr><th>Category</th><th>Max invitees</th><th>Submitter table</th><th>Invited-guests table</th></tr></thead>
                <tbody>
                  {CATEGORY_LIMITS.map((c) => (
                    <tr key={c.category}>
                      <td>{c.category}</td>
                      <td>{c.max}</td>
                      <td className="rd-rowlink">{c.submitterTable}</td>
                      <td className="rd-rowlink">{c.invitedTable}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
      )}

      <ManualInvitePanel notify={notify} />

      <div className="rr-section-title">
        <div><h2>Custom RSVP questions</h2><p>Ask guests anything extra when they confirm</p></div>
        <button onClick={() => setAddingQuestion((v) => !v)}><Icon name="plus" size={14} /> Add question</button>
      </div>

      <div className="rr-panel" style={{ maxWidth: 620 }}>
        <div className="rd-panel-body" style={{ paddingTop: 16 }}>
          {addingQuestion && <QuestionForm notify={notify} onDone={() => setAddingQuestion(false)} onSave={(data) => api.createRSVPQuestion(eventId, data).then(onQuestionsChanged)} />}
          {rsvpQuestions.map((rq, i) => (
            <div className="gr-question-row" key={rq.id || rq.q}>
              <div className="gr-question-text">
                <strong>{i + 1}. {rq.q}</strong>
                <span>{rq.type}{rq.required ? ' · Required' : ''}</span>
              </div>
              <div className="gr-question-actions">
                <button className="rr-link-btn gr-danger-link" onClick={async () => {
                  try {
                    await api.deleteRSVPQuestion(eventId, rq.id)
                    await onQuestionsChanged()
                    notify(`Question deleted: "${rq.q}"`)
                  } catch (e) { notify(e.message || 'Question could not be deleted', true) }
                }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

export default function GuestsRedesignPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [toast, setToast] = useState(null)
  const [eventId] = useCurrentEvent()
  const { event, refresh: loadEvent, error: eventError } = useEventDetails(eventId)
  const { guests: rawGuests, loading: guestsLoading, error: guestsError, refresh: loadGuests } = useGuests(eventId)
  const guests = useMemo(() => rawGuests.map(adaptGuest), [rawGuests])
  const [households, setHouseholds] = useState([])
  const [tableGroups, setTableGroups] = useState([])
  const [tables, setTables] = useState([])
  const [rsvpQuestions, setRsvpQuestions] = useState([])
  const [householdsLoading, setHouseholdsLoading] = useState(true)
  const [householdTarget, setHouseholdTarget] = useState(null)
  const [householdDeleteTarget, setHouseholdDeleteTarget] = useState(null)
  const [householdForm, setHouseholdForm] = useState({ name: '', description: '' })
  const [editForm, setEditForm] = useState({ first_name: '', last_name: '', email: '', phone: '', is_vip: false, table_id: '', seat_number: '', messaging_consent: false })
  const [mutationBusy, setMutationBusy] = useState(false)
  const tab = searchParams.get('tab') === 'invite' ? 'invite' : 'guests'
  const [addOpen, setAddOpen] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [viewTarget, setViewTarget] = useState(null)
  const [removeTarget, setRemoveTarget] = useState(null)
  const [addForm, setAddForm] = useState({ first: '', last: '', email: '', phone: '', vip: false, sendInvite: false })
  const [importOpen, setImportOpen] = useState(false)
  const [importStep, setImportStep] = useState('upload') // upload | mapping | validating | result
  const [importProgress, setImportProgress] = useState(0)
  const [importResult, setImportResult] = useState(null)
  const [importFile, setImportFile] = useState(null)
  const importTimerRef = useRef(null)

  // RSVP approval
  const [approveTarget, setApproveTarget] = useState(null)
  const [rejectTarget, setRejectTarget] = useState(null)
  const [approveAllCount, setApproveAllCount] = useState(null)

  // Invite send flow
  const [sendCount, setSendCount] = useState(null) // null = closed, number = open audience step
  const [sendGuestIds, setSendGuestIds] = useState([])
  const [sendResult, setSendResult] = useState(null)
  const [sendStep, setSendStep] = useState('audience') // audience | sending | done | partial
  const [invitePreviewOpen, setInvitePreviewOpen] = useState(false)
  const [invitePreviewCh, setInvitePreviewCh] = useState('email')
  const sendTimerRef = useRef(null)

  function notify(message, error = false) {
    setToast({ message, error })
    window.setTimeout(() => setToast(null), 2600)
  }

  async function loadHouseholds() {
    if (!eventId) { setHouseholds([]); setHouseholdsLoading(false); return }
    setHouseholdsLoading(true)
    try {
      setHouseholds((await api.listHouseholds(eventId)).map(adaptHousehold))
    } catch (e) {
      notify(e.message || 'Households could not be loaded', true)
    } finally {
      setHouseholdsLoading(false)
    }
  }

  async function loadQuestions() {
    if (!eventId) { setRsvpQuestions([]); return }
    setRsvpQuestions((await api.listRSVPQuestions(eventId)).map(adaptQuestion))
  }

  async function loadTableGroups() {
    if (!eventId) { setTableGroups([]); setTables([]); return }
    try {
      const [nextGroups, nextTables] = await Promise.all([api.listTableGroups(eventId), api.listTables(eventId)])
      setTableGroups(nextGroups)
      setTables(nextTables)
    } catch (e) {
      notify(e.message || 'Table groups could not be loaded', true)
    }
  }

  useEffect(() => {
    loadHouseholds()
    loadTableGroups()
    loadQuestions().catch((e) => notify(e.message || 'RSVP questions could not be loaded', true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId])

  useEffect(() => {
    if (eventError) notify(eventError, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventError])

  useEffect(() => {
    if (!editTarget) return
    setEditForm({
      first_name: editTarget.raw.first_name || '',
      last_name: editTarget.raw.last_name || '',
      email: editTarget.raw.email || '',
      phone: editTarget.raw.phone || '',
      is_vip: !!editTarget.raw.is_vip,
      table_id: editTarget.raw.table_id || '',
      seat_number: editTarget.raw.seat_number || '',
      messaging_consent: !!editTarget.raw.sms_consent && !!editTarget.raw.whatsapp_consent,
    })
  }, [editTarget])

  const stats = useMemo(() => {
    const total = guests.length
    const qr = guests.filter((g) => g.qr).length
    const invited = guests.filter((g) => g.invited !== '—').length
    const admitted = guests.filter((g) => g.admitted).length
    return [
      { ...STAT_TILES[0], value: total, caption: 'Imported + self-registered' },
      { ...STAT_TILES[1], value: qr, caption: `${Math.max(0, total - qr)} waiting on QR` },
      { ...STAT_TILES[2], value: invited, caption: `${Math.max(0, total - invited)} not sent yet` },
      { ...STAT_TILES[3], value: admitted, caption: total ? `${Math.round((admitted / total) * 100)}% of total guests` : 'No guests yet' },
    ]
  }, [guests])

  function goTab(next) {
    setSearchParams(next === 'invite' ? { tab: 'invite' } : { tab: 'guests' })
  }

  async function startImport() {
    if (!importFile) { notify('Choose a CSV or XLSX file first', true); return }
    setImportStep('validating')
    setImportProgress(30)
    try {
      const result = await api.uploadGuests(eventId, importFile)
      setImportProgress(100)
      setImportResult({
        imported: result.added || result.imported || 0,
        warnings: result.warnings?.length || 0,
        errors: result.errors?.length || result.skipped || 0,
        details: { warnings: result.warnings || [], errors: result.errors || [], skipped: result.skipped || 0 },
      })
      setImportStep('result')
      await loadGuests()
    } catch (e) {
      setImportStep('upload')
      notify(e.message || 'Guest import failed', true)
    }
  }

  function downloadImportLog() {
    if (!importResult) return
    const blob = new Blob([JSON.stringify(importResult.details, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `guest-import-${eventId}-results.json`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  async function startSend(count) {
    setSendStep('sending')
    try {
      const result = await api.sendInvitesBatch(eventId, sendGuestIds, sendGuestIds.length > 0)
      setSendCount(result.queued)
      setSendResult(result)
      setSendStep('done')
      await loadGuests()
    } catch (e) {
      setSendStep('audience')
      notify(e.message || 'Invitations were not sent', true)
    }
  }

  return (
    <RedesignShell topActive="setup" withEventSidebar eventActive={tab === 'invite' ? 'invite' : 'guests'}>
      <div className="rr-pagehead">
        <div>
          <div className="rr-title-row">
            <h1>Guest Engagement</h1>
          </div>
          <div className="rr-meta"><Icon name="users" size={13} /> {guests.length} guests <span className="rr-dot">·</span> <Icon name="send" size={13} /> {guests.filter((g) => g.invited !== '—').length} invited</div>
        </div>
        <div className="rr-head-actions">
          <button className="rr-btn secondary" onClick={() => { setImportStep('upload'); setImportResult(null); setImportProgress(0); setImportOpen(true) }}><Icon name="upload" size={15} /> Import guests</button>
          <button className="rr-btn primary" onClick={() => setAddOpen(true)}><Icon name="plus" size={14} /> Add guest</button>
        </div>
      </div>

      <div className="rr-tabs">
        <button className={tab === 'guests' ? 'active' : ''} onClick={() => goTab('guests')}>Guests</button>
        <button className={tab === 'invite' ? 'active' : ''} onClick={() => goTab('invite')}>Invites &amp; RSVP</button>
      </div>

      {tab === 'guests'
        ? <GuestsTab notify={notify} onView={setViewTarget} onEdit={setEditTarget} onRemove={setRemoveTarget} onApproveRsvp={setApproveTarget} onRejectRsvp={setRejectTarget} onApproveAll={(n) => setApproveAllCount(n)} onSendSelected={(ids) => { setSendGuestIds(ids); setSendResult(null); setSendCount(ids.length); setSendStep('audience') }} eventId={eventId} guests={guests} guestsLoading={guestsLoading} guestsError={guestsError} onRetryGuests={loadGuests} households={households} householdsLoading={householdsLoading} tableGroups={tableGroups} onAddHousehold={() => { setHouseholdTarget('new'); setHouseholdForm({ name: '', description: '' }) }} onEditHousehold={(h) => { setHouseholdTarget(h); setHouseholdForm({ name: h.raw.name, description: h.raw.description || '' }) }} onDeleteHousehold={setHouseholdDeleteTarget} onBulkAssignHousehold={async (guestIds, householdId) => {
          try { await api.bulkAssignHousehold(eventId, guestIds, householdId); await Promise.all([loadGuests(), loadHouseholds()]); notify('Household assignment updated') }
          catch (e) { notify(e.message || 'Household assignment could not be updated', true) }
        }} onBulkAssignTableGroup={async (guestIds, tableGroupId) => {
          try { await api.bulkAssignTableGroup(eventId, guestIds, tableGroupId); await loadGuests(); notify('Table-group assignment updated') }
          catch (e) { notify(e.message || 'Table-group assignment could not be updated', true) }
        }} rsvpQuestions={rsvpQuestions} stats={stats} />
        : <InviteTab notify={notify} eventId={eventId} event={event} guests={guests} rsvpQuestions={rsvpQuestions} onQuestionsChanged={loadQuestions} onEventChanged={loadEvent} onSendInvites={(count) => { setSendGuestIds([]); setSendResult(null); setSendCount(count); setSendStep('audience') }} onSendGuests={(ids) => { setSendGuestIds(ids); setSendResult(null); setSendCount(ids.length); setSendStep('audience') }} onPreviewInvite={() => { setInvitePreviewCh('email'); setInvitePreviewOpen(true) }} />}

      {toast && <div className="rd-toast" style={toast.error ? { background: 'var(--danger)' } : undefined}><Icon name={toast.error ? 'info' : 'check'} />{toast.message}</div>}

      {addOpen && (
        <Modal title="Add guest" onClose={() => setAddOpen(false)} width={480}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div><label className="rd-field-label">First name *</label><input className="rd-field" value={addForm.first} onChange={(e) => setAddForm({ ...addForm, first: e.target.value })} /></div>
              <div><label className="rd-field-label">Last name *</label><input className="rd-field" value={addForm.last} onChange={(e) => setAddForm({ ...addForm, last: e.target.value })} /></div>
            </div>
            <div><label className="rd-field-label">Email</label><input className="rd-field" type="email" value={addForm.email} onChange={(e) => setAddForm({ ...addForm, email: e.target.value })} /></div>
            <div><label className="rd-field-label">Phone (E.164)</label><input className="rd-field" placeholder="+234..." value={addForm.phone} onChange={(e) => setAddForm({ ...addForm, phone: e.target.value })} /></div>
            <label className="gr-required-check"><input type="checkbox" checked={addForm.vip} onChange={(e) => setAddForm({ ...addForm, vip: e.target.checked })} /> Mark as VIP</label>
            <label className="gr-required-check"><input type="checkbox" checked={addForm.sendInvite} onChange={(e) => setAddForm({ ...addForm, sendInvite: e.target.checked })} /> Send invite immediately</label>
            <div className="rd-row2" style={{ marginTop: 4 }}>
              <button className="rr-btn secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setAddOpen(false)}>Cancel</button>
              <button className="rr-btn primary" style={{ flex: 1, justifyContent: 'center' }} disabled={!addForm.first || mutationBusy} onClick={async () => {
                setMutationBusy(true)
                try {
                  const created = await api.addGuest(eventId, {
                    first_name: addForm.first.trim(),
                    last_name: addForm.last.trim(),
                    email: addForm.email.trim() || null,
                    phone: addForm.phone.trim() || null,
                    is_vip: addForm.vip,
                  })
                  const shouldSendInvite = addForm.sendInvite
                  setAddOpen(false)
                  setAddForm({ first: '', last: '', email: '', phone: '', vip: false, sendInvite: false })
                  await loadGuests()
                  if (shouldSendInvite) {
                    try {
                      await api.sendInvitesBatch(eventId, [created.id], true)
                      await loadGuests()
                      notify(`${created.first_name} ${created.last_name || ''} added and invite queued`)
                    } catch (sendError) {
                      notify(`${created.first_name} was added, but the invite was not queued: ${sendError.message}`, true)
                    }
                  } else {
                    notify(`${created.first_name} ${created.last_name || ''} added`)
                  }
                } catch (e) { notify(e.message || 'Guest could not be added', true) } finally { setMutationBusy(false) }
              }}>{mutationBusy ? 'Adding…' : 'Add guest'}</button>
            </div>
          </div>
        </Modal>
      )}

      {editTarget && (
        <Modal title={`Edit: ${editTarget.name}`} onClose={() => setEditTarget(null)} width={520}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div><label className="rd-field-label">First name</label><input className="rd-field" value={editForm.first_name} onChange={(e) => setEditForm((v) => ({ ...v, first_name: e.target.value }))} /></div>
              <div><label className="rd-field-label">Last name</label><input className="rd-field" value={editForm.last_name} onChange={(e) => setEditForm((v) => ({ ...v, last_name: e.target.value }))} /></div>
            </div>
            <div><label className="rd-field-label">Email</label><input className="rd-field" value={editForm.email} onChange={(e) => setEditForm((v) => ({ ...v, email: e.target.value }))} /></div>
            <div><label className="rd-field-label">Phone (E.164)</label><input className="rd-field" value={editForm.phone} onChange={(e) => setEditForm((v) => ({ ...v, phone: e.target.value }))} /></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div><label className="rd-field-label">Table</label><select className="rd-field" value={editForm.table_id} onChange={(e) => setEditForm((v) => ({ ...v, table_id: e.target.value, seat_number: e.target.value ? v.seat_number : '' }))}><option value="">Unassigned</option>{tables.map((table) => <option key={table.id} value={table.id}>{table.name}</option>)}</select></div>
              <div><label className="rd-field-label">Seat</label><input className="rd-field" disabled={!editForm.table_id} value={editForm.seat_number} onChange={(e) => setEditForm((v) => ({ ...v, seat_number: e.target.value }))} placeholder="e.g. 4" /></div>
            </div>
            <label className="gr-required-check"><input type="checkbox" checked={editForm.is_vip} onChange={(e) => setEditForm((v) => ({ ...v, is_vip: e.target.checked }))} /> VIP</label>
            <label className="gr-required-check"><input type="checkbox" checked={editForm.messaging_consent} onChange={(e) => setEditForm((v) => ({ ...v, messaging_consent: e.target.checked }))} /> SMS/WhatsApp opt-in confirmed</label>
            {rsvpQuestions.length > 0 && (
              <div className="gr-rsvp-answers">
                <strong className="rd-field-label">RSVP answers (read-only)</strong>
                {rsvpQuestions.map((rq) => (
                  <div key={rq.q} className="gr-rsvp-answer-row"><span className="gr-rsvp-q">{rq.q}</span><span className="gr-rsvp-a">Pending</span></div>
                ))}
              </div>
            )}
            <div className="rd-row2" style={{ marginTop: 4 }}>
              <button className="rr-btn secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setEditTarget(null)}>Cancel</button>
              <button className="rr-btn primary" style={{ flex: 1, justifyContent: 'center' }} disabled={!editForm.first_name || mutationBusy} onClick={async () => {
                setMutationBusy(true)
                try {
                  // editTarget.raw.updated_at was captured when this modal
                  // opened, so a stale edit (e.g. the guest checked in or a
                  // teammate edited them while this modal sat open) is
                  // rejected by the server instead of silently overwritten.
                  await api.updateGuest(eventId, editTarget.id, {
                    first_name: editForm.first_name.trim(),
                    last_name: editForm.last_name.trim(),
                    email: editForm.email.trim() || null,
                    phone: editForm.phone.trim() || null,
                    is_vip: editForm.is_vip,
                    table_id: editForm.table_id,
                    seat_number: editForm.seat_number.trim(),
                    sms_consent: editForm.messaging_consent,
                    whatsapp_consent: editForm.messaging_consent,
                  }, editTarget.raw.updated_at)
                  const name = `${editForm.first_name} ${editForm.last_name}`.trim()
                  setEditTarget(null)
                  await loadGuests()
                  notify(`${name} updated`)
                } catch (e) {
                  if (e.status === 409) {
                    setEditTarget(null)
                    await loadGuests()
                    notify('Changed by another operator — refreshed with the latest version. Please redo your edit.', true)
                  } else {
                    notify(e.message || 'Guest could not be updated', true)
                  }
                } finally { setMutationBusy(false) }
              }}>{mutationBusy ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </Modal>
      )}

      {viewTarget && (
        <Modal title={`Guest: ${viewTarget.name}`} onClose={() => setViewTarget(null)} width={440}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {[['Email', viewTarget.email], ['Phone', viewTarget.phone || '—'], ['RSVP', viewTarget.rsvp], ['Checked in', viewTarget.admitted ? 'Yes' : 'No'], ['Table group', viewTarget.group], ['Household', viewTarget.household], ['VIP', viewTarget.vip ? 'Yes' : 'No'], ['Role', viewTarget.role]].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', gap: 10, fontSize: '0.88rem', padding: '6px 0', borderBottom: '1px solid var(--rr-border)' }}>
                <span style={{ width: 130, color: 'var(--rr-sub)', flexShrink: 0 }}>{k}</span>
                <span style={{ color: 'var(--rr-text)', fontWeight: 500 }}>{v}</span>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {removeTarget && (
        <ConfirmDialog
          title="Remove guest"
          message={`Remove ${removeTarget.name} from this event? Their check-in history and messages will also be removed.`}
          confirmLabel="Remove"
          onConfirm={async () => {
            setMutationBusy(true)
            try {
              await api.deleteGuest(eventId, removeTarget.id)
              const name = removeTarget.name
              setRemoveTarget(null)
              await loadGuests()
              notify(`${name} removed`)
            } catch (e) { notify(e.message || 'Guest could not be removed', true) } finally { setMutationBusy(false) }
          }}
          onCancel={() => setRemoveTarget(null)}
        />
      )}

      {householdTarget && (
        <Modal title={householdTarget === 'new' ? 'Create household' : `Edit household: ${householdTarget.name}`} onClose={() => setHouseholdTarget(null)} width={460}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div><label className="rd-field-label">Household name *</label><input className="rd-field" value={householdForm.name} onChange={(e) => setHouseholdForm((v) => ({ ...v, name: e.target.value }))} /></div>
            <div><label className="rd-field-label">Description</label><textarea className="rr-textarea" value={householdForm.description} onChange={(e) => setHouseholdForm((v) => ({ ...v, description: e.target.value }))} /></div>
            <div className="rd-row2">
              <button className="rr-btn secondary" onClick={() => setHouseholdTarget(null)}>Cancel</button>
              <button className="rr-btn primary" disabled={!householdForm.name.trim() || mutationBusy} onClick={async () => {
                setMutationBusy(true)
                try {
                  const payload = { name: householdForm.name.trim(), description: householdForm.description.trim() || null }
                  if (householdTarget === 'new') await api.createHousehold(eventId, payload)
                  else await api.updateHousehold(eventId, householdTarget.id, payload)
                  setHouseholdTarget(null)
                  await loadHouseholds()
                  notify(`Household ${householdTarget === 'new' ? 'created' : 'updated'}`)
                } catch (e) { notify(e.message || 'Household could not be saved', true) } finally { setMutationBusy(false) }
              }}>{mutationBusy ? 'Saving…' : 'Save household'}</button>
            </div>
          </div>
        </Modal>
      )}

      {householdDeleteTarget && (
        <ConfirmDialog
          title="Delete household"
          message={`Delete “${householdDeleteTarget.name}”? Guests remain on the event but will no longer belong to this household.`}
          confirmLabel={mutationBusy ? 'Deleting…' : 'Delete'}
          onCancel={() => { if (!mutationBusy) setHouseholdDeleteTarget(null) }}
          onConfirm={async () => {
            setMutationBusy(true)
            try {
              await api.deleteHousehold(eventId, householdDeleteTarget.id)
              setHouseholdDeleteTarget(null)
              await Promise.all([loadHouseholds(), loadGuests()])
              notify('Household deleted')
            } catch (e) { notify(e.message || 'Household could not be deleted', true) } finally { setMutationBusy(false) }
          }}
        />
      )}

      {/* ── RSVP approval dialogs ───────────────────────────────────────── */}
      {approveTarget && (
        <ConfirmDialog
          title="Approve RSVP"
          message={`Confirm ${approveTarget.name}'s RSVP? Protected environments reject outbound delivery unless the recipient is server-allowlisted.`}
          confirmLabel={mutationBusy ? 'Approving…' : 'Approve'}
          onConfirm={async () => {
            setMutationBusy(true)
            try {
              await api.approveRsvp(eventId, approveTarget.id)
              const name = approveTarget.name
              setApproveTarget(null)
              await loadGuests()
              notify(`${name}'s RSVP approved`)
            } catch (e) { notify(e.message || 'RSVP could not be approved', true) } finally { setMutationBusy(false) }
          }}
          onCancel={() => setApproveTarget(null)}
        />
      )}
      {rejectTarget && (
        <ConfirmDialog
          title="Decline RSVP"
          message={`Decline ${rejectTarget.name}'s RSVP? Protected environments reject outbound delivery unless the recipient is server-allowlisted.`}
          confirmLabel={mutationBusy ? 'Declining…' : 'Decline'}
          danger
          onConfirm={async () => {
            setMutationBusy(true)
            try {
              await api.rejectRsvp(eventId, rejectTarget.id)
              const name = rejectTarget.name
              setRejectTarget(null)
              await loadGuests()
              notify(`${name}'s RSVP declined`)
            } catch (e) { notify(e.message || 'RSVP could not be declined', true) } finally { setMutationBusy(false) }
          }}
          onCancel={() => setRejectTarget(null)}
        />
      )}
      {approveAllCount !== null && (
        <ConfirmDialog
          title={`Approve all ${approveAllCount} RSVPs`}
          message={`Approve ${approveAllCount} pending RSVPs now? Protected environments reject recipients outside the server allowlist.`}
          confirmLabel={mutationBusy ? 'Approving…' : `Approve all ${approveAllCount}`}
          onConfirm={async () => {
            const pending = guests.filter((guest) => guest.pendingApproval)
            if (!pending.length) { setApproveAllCount(null); return }
            setMutationBusy(true)
            try {
              const results = await Promise.allSettled(pending.map((guest) => api.approveRsvp(eventId, guest.id)))
              const approved = results.filter((result) => result.status === 'fulfilled').length
              const failed = results.length - approved
              setApproveAllCount(null)
              await loadGuests()
              notify(failed ? `${approved} approved; ${failed} failed provider safety or validation` : `${approved} RSVPs approved`, failed > 0)
            } finally { setMutationBusy(false) }
          }}
          onCancel={() => setApproveAllCount(null)}
        />
      )}

      {/* ── Invite send flow ────────────────────────────────────────────── */}
      {sendCount !== null && (
        <Modal
          title={sendStep === 'audience' ? 'Review audience before sending' : sendStep === 'sending' ? 'Sending invitations…' : 'Send complete'}
          onClose={() => { window.clearInterval(sendTimerRef.current); setSendCount(null); setSendGuestIds([]); setSendResult(null); setSendStep('audience') }}
          width={480}
        >
          {sendStep === 'audience' && (
            <div>
              <p style={{ fontSize: '0.85rem', marginBottom: 14 }}>About to send invitations to <strong>{sendCount} guests</strong> across the following channels:</p>
              <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 6, padding: '8px 12px', fontSize: '0.82rem', marginBottom: 14 }}>
                <Icon name="warning" size={12} /> The server will apply the event's configured channel policy, consent rules, recipient safety, and available credits.
              </div>
              <div className="rd-row2">
                <button className="rr-btn secondary" onClick={() => setSendCount(null)}>Cancel</button>
                <button className="rr-btn primary" onClick={() => startSend(sendCount)}>Send to {sendCount} guests</button>
              </div>
            </div>
          )}
          {sendStep === 'sending' && (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div className="gr-send-progress-label">Sending to {sendCount} guests…</div>
              <div className="gr-send-bar-wrap"><div className="gr-send-bar" /></div>
              <div style={{ fontSize: '0.8rem', color: 'var(--rr-sub)', marginTop: 10 }}>
                Email · SMS · WhatsApp — this usually takes under a minute
              </div>
            </div>
          )}
          {sendStep === 'done' && (
            <div>
              <div className="gr-send-result-head">
                <span style={{ fontSize: '2rem' }}>✓</span>
                <h3>Invitations sent!</h3>
              </div>
              <div className="rr-panel" style={{ padding: 14, marginBottom: 14 }}>
                <strong>{Number(sendResult?.queued) || 0}</strong> invitation request{Number(sendResult?.queued) === 1 ? '' : 's'} confirmed by the server.
                <div style={{ fontSize: '0.78rem', color: 'var(--rr-sub)', marginTop: 6 }}>
                  Provider delivery status is available in Communications; it is not inferred here.
                </div>
              </div>
              <button className="rr-btn primary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => { setSendCount(null); setSendGuestIds([]); setSendResult(null); setSendStep('audience') }}>Done</button>
            </div>
          )}
        </Modal>
      )}

      {/* ── Invite channel preview ──────────────────────────────────────── */}
      {invitePreviewOpen && (
        <Modal title="Preview invitation" onClose={() => setInvitePreviewOpen(false)} width={500}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {['email', 'sms', 'whatsapp'].map((ch) => (
              <button key={ch} className={`rr-btn${invitePreviewCh === ch ? ' primary' : ' secondary'}`} style={{ fontSize: '0.78rem', padding: '4px 10px' }} onClick={() => setInvitePreviewCh(ch)}>{ch.toUpperCase()}</button>
            ))}
          </div>
          <ChannelPreviewFrame channel={invitePreviewCh} body={`Hi {{first_name}},\n\nYou're invited to ${event?.name || 'this event'}!\n\nDate: ${event?.event_date ? new Date(event.event_date).toLocaleString() : 'To be announced'}\nVenue: ${event?.venue_name || 'To be announced'}\n\nRSVP here: ${event ? api.inviteUrl(event) : 'Invite link will appear here'}\n\n${event?.invite_message || 'We hope to see you there!'}`} />
        </Modal>
      )}

      {/* ── Import wizard ───────────────────────────────────────────────── */}
      {importOpen && (
        <Modal
          title={importStep === 'upload' ? 'Import guests' : importStep === 'mapping' ? 'Map columns' : importStep === 'validating' ? 'Validating…' : 'Import complete'}
          onClose={() => setImportOpen(false)}
          width={560}
        >
          {importStep === 'upload' && (
            <div>
              <div className="gr-import-drop">
                <Icon name="upload" size={24} />
                <strong>Drop your file here or click to browse</strong>
                <span>Supports XLSX, CSV, Google Sheets export</span>
                <input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => setImportFile(e.target.files?.[0] || null)} />
                {importFile && <span>{importFile.name}</span>}
                <button className="rr-btn secondary" disabled={!importFile} onClick={() => setImportStep('mapping')}>Continue to import</button>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button className="rr-btn secondary" onClick={() => api.downloadGuestTemplate(eventId, 'xlsx').catch((e) => notify(e.message || 'Template download failed', true))}>Download template</button>
              </div>
            </div>
          )}
          {importStep === 'mapping' && (
            <div>
              <p style={{ fontSize: '0.85rem', marginBottom: 12 }}>Festio will validate the selected file and import recognized guest, contact, access, household, and seating columns. Unknown columns are ignored and real server results are shown after import.</p>
              <div className="rr-panel" style={{ padding: 12 }}><strong>{importFile?.name}</strong></div>
              <div className="rd-row2" style={{ marginTop: 14 }}>
                <button className="rr-btn secondary" onClick={() => setImportStep('upload')}>Back</button>
                <button className="rr-btn primary" onClick={startImport}>Validate &amp; import</button>
              </div>
            </div>
          )}
          {importStep === 'validating' && (
            <div>
              <p style={{ fontSize: '0.85rem', marginBottom: 12 }}>Validating and importing the selected file…</p>
              <div className="gr-send-bar-wrap"><div className="gr-send-bar" style={{ width: `${importProgress}%` }} /></div>
            </div>
          )}
          {importStep === 'result' && importResult && (
            <div>
              <div className="gr-send-result-head">
                <span style={{ fontSize: '2rem' }}>✓</span>
                <h3>Import complete</h3>
              </div>
              <table className="rr-table" style={{ marginBottom: 16 }}>
                <tbody>
                  <tr><td>Imported</td><td><strong>{importResult.imported}</strong></td></tr>
                  <tr><td>Warnings (imported)</td><td><strong className="rd-rowlink">{importResult.warnings}</strong></td></tr>
                  <tr><td>Errors (skipped)</td><td><strong style={{ color: '#c0392b' }}>{importResult.errors}</strong></td></tr>
                </tbody>
              </table>
              <div className="rd-row2">
                <button className="rr-btn secondary" onClick={downloadImportLog}>Download result log</button>
                <button className="rr-btn primary" onClick={() => { setImportOpen(false); notify(`${importResult.imported} guests imported`) }}>Done</button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </RedesignShell>
  )
}
