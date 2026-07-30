import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import RedesignShell, { Icon, ConfirmDialog } from './redesign/RedesignShell'
import { LoadingSkeleton, ErrorRetryState, EmptyState } from './redesign/RedesignPrimitives'
import { useCurrentEvent } from '../hooks/useCurrentEvent'
import { useEventDetails } from '../hooks/useEventDetails'
import { api } from '../api'
import './TeamRedesignPage.css'

// ── Team, Tasks, My Tasks — wired to real data/mutations ───────────────
// Assigning/removing team members and creating/updating/deleting tasks all
// hit the real API (frontend/src/api.js) and refetch from the server after
// a confirmed mutation rather than locally patching state, so this page
// never shows success before the server actually confirms it, and never
// silently clobbers a concurrent change. Per-member permission toggles
// (role/access-level/guest-access/permission chips/scanner sections),
// org-role changes, invite-teammate actions, subtasks, attachments, and task
// activity also use the existing server contracts.

const ROLE_LABEL = { staff: 'Staff', manager: 'Event owner/admin' }
const EVENT_ROLE_OPTIONS = ['staff', 'manager']
const ACCESS_LEVEL_OPTIONS = ['edit', 'view']
const GUEST_ACCESS_OPTIONS = ['none', 'view', 'manage']
const ORG_ROLE_OPTIONS = ['owner', 'admin', 'staff']

const PERMS = [
  { key: 'seats', label: 'Seats', icon: 'chair' },
  { key: 'menu', label: 'Menu', icon: 'card' },
  { key: 'dashboard', label: 'Dashboard', icon: 'barchart' },
]

const STATUS_LABEL = { open: 'Open', in_progress: 'In progress', done: 'Done' }
const BOARD_COLUMNS = ['open', 'in_progress', 'done']
const BOARD_TITLE = { open: 'Open', in_progress: 'In Progress', done: 'Done' }



function fmtDate(due) {
  if (!due) return null
  return new Date(due).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function initialsOf(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  const s = (parts[0]?.[0] || '') + (parts[1]?.[0] || '')
  return (s || name[0] || '?').toUpperCase()
}

// Stable-ish color variant for an event tag, since real tasks don't carry
// the mock's `evClass` field — just spread events across the 3 existing tag colors.
function evTagClass(eventId) {
  const classes = ['a', 'b', 'c']
  let hash = 0
  for (const ch of String(eventId || '')) hash = (hash * 31 + ch.charCodeAt(0)) % 997
  return classes[hash % classes.length]
}

function permOn(m, key) {
  if (key === 'seats') return !!m.can_reassign_seats
  if (key === 'menu') return !!m.can_manage_menu
  if (key === 'dashboard') return !!m.can_view_dashboard
  return false
}

function guestAccessOf(m) {
  if (m.can_manage_guests) return 'manage'
  if (m.can_view_guests) return 'view'
  return 'none'
}

function TaskDetailPanel({ task, onClose, notify }) {
  const [attachments, setAttachments] = useState([])
  const [subtasks, setSubtasks] = useState([])
  const [activity, setActivity] = useState([])
  const [subtaskTitle, setSubtaskTitle] = useState('')
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)

  async function loadDetails() {
    if (!task) return
    try {
      const [nextAttachments, nextSubtasks, nextActivity] = await Promise.all([
        api.listTaskAttachments(task.event_id, task.id),
        api.listSubtasks(task.event_id, task.id),
        api.listTaskActivity(task.event_id, task.id),
      ])
      setAttachments(nextAttachments); setSubtasks(nextSubtasks); setActivity(nextActivity)
    } catch (e) { notify(e.message || 'Task details could not be loaded', true) }
  }
  useEffect(() => { loadDetails() }, [task?.id, task?.event_id])
  if (!task) return null
  const due = fmtDate(task.due_date)
  return (
    <div className="tm-detail-backdrop" onClick={onClose}>
      <div className="rr-panel tm-detail" onClick={(e) => e.stopPropagation()}>
        <div className="rd-panel-head tm-detail-head">
          <div>
            <h3>{task.title}</h3>
            <p>
              Assigned to {task.assignee_name || 'Unassigned'}
              {due ? ` · Due ${due}` : ''}
            </p>
          </div>
          <button className="rr-link-btn" onClick={onClose}>Close ✕</button>
        </div>
        <div className="rd-panel-body">
          <div className="tm-detail-section">
            <div className="tm-detail-section-head"><Icon name="file" size={13} /> Attachments</div>
            {attachments.map((a) => (
              <div className="tm-attachment-row" key={a.id}>
                <span>{a.filename || a.name}</span><span className="rd-rowlink">{a.size_bytes ? `${Math.ceil(a.size_bytes / 1024)} KB` : ''}</span>
                <button className="rr-link-btn gr-danger-link" onClick={async () => {
                  try { await api.deleteTaskAttachment(task.event_id, task.id, a.id); await loadDetails(); notify('Attachment removed') }
                  catch (e) { notify(e.message || 'Attachment could not be removed', true) }
                }}>Remove</button>
              </div>
            ))}
            <input type="file" disabled={busy} onChange={async (e) => {
              const file = e.target.files?.[0]
              if (!file) return
              setBusy(true)
              try { await api.uploadTaskAttachment(task.event_id, task.id, file); await loadDetails(); notify(`${file.name} uploaded`) }
              catch (error) { notify(error.message || 'Attachment upload failed', true) }
              finally { setBusy(false); e.target.value = '' }
            }} />
          </div>

          <div className="tm-detail-section">
            <div className="tm-detail-section-head"><Icon name="check" size={13} /> Subtasks</div>
            {subtasks.map((s) => (
              <label className="tm-subtask-row" key={s.id}>
                <input type="checkbox" checked={s.status === 'done'} onChange={async (e) => {
                  try { await api.updateSubtask(task.event_id, task.id, s.id, { status: e.target.checked ? 'done' : 'open' }); await loadDetails() }
                  catch (error) { notify(error.message || 'Subtask could not be updated', true) }
                }} />
                <span className={s.status === 'done' ? 'tm-subtask-done' : ''}>{s.title}</span>
              </label>
            ))}
            {subtasks.length === 0 && <p className="rd-rowlink">No subtasks yet.</p>}
            <div className="rd-row2"><input className="rr-input" value={subtaskTitle} placeholder="New subtask" onChange={(e) => setSubtaskTitle(e.target.value)} /><button className="rr-btn secondary" disabled={!subtaskTitle.trim()} onClick={async () => {
              try { await api.createSubtask(task.event_id, task.id, subtaskTitle.trim()); setSubtaskTitle(''); await loadDetails(); notify('Subtask added') }
              catch (e) { notify(e.message || 'Subtask could not be added', true) }
            }}><Icon name="plus" size={11} /> Add</button></div>
          </div>

          <div className="tm-detail-section">
            <div className="tm-detail-section-head"><Icon name="clock" size={13} /> Activity</div>
            {activity.length === 0 && <p className="rd-rowlink">No activity yet.</p>}
            {activity.map((a) => (
              <div className="tm-activity-row" key={a.id}><strong>{a.user_name || 'Festio'}</strong> {a.body || a.kind} <span>{a.created_at ? new Date(a.created_at).toLocaleString() : ''}</span></div>
            ))}
            <div className="rd-row2" style={{ marginTop: 8 }}>
              <input className="rr-input" value={comment} placeholder="Add a comment…" style={{ marginBottom: 0 }} onChange={(e) => setComment(e.target.value)} />
              <button className="rr-btn secondary" disabled={!comment.trim()} onClick={async () => {
                try { await api.addTaskComment(task.event_id, task.id, comment.trim()); setComment(''); await loadDetails(); notify('Comment posted') }
                catch (e) { notify(e.message || 'Comment could not be posted', true) }
              }}>Post</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function TaskCard({ task, showEvent, onOpen }) {
  const due = fmtDate(task.due_date)
  return (
    <button type="button" className="tm-card" onClick={() => onOpen(task)}>
      {showEvent && task.event_name && <span className={`tm-ev-tag ${evTagClass(task.event_id)}`}>{task.event_name}</span>}
      <span className="tm-card-title">{task.title}</span>
      <span className="tm-card-meta">
        <span className="rd-who"><span className="dot">{initialsOf(task.assignee_name)}</span>{task.assignee_name || 'Unassigned'}</span>
        {due && <span className={task.overdue ? 'tm-overdue' : ''}>{due}</span>}
      </span>
    </button>
  )
}

function TaskBoard({ tasks, showEvent, onOpen }) {
  return (
    <div className="tm-board">
      {BOARD_COLUMNS.map((col) => {
        const inCol = tasks.filter((t) => t.status === col)
        return (
          <div className="tm-board-col" key={col}>
            <div className="tm-board-col-head"><span>{BOARD_TITLE[col]}</span><b>{inCol.length}</b></div>
            {inCol.map((t) => <TaskCard key={t.id} task={t} showEvent={showEvent} onOpen={onOpen} />)}
            {inCol.length === 0 && <span className="tm-board-empty">No tasks</span>}
          </div>
        )
      })}
    </div>
  )
}

function TaskTable({ tasks, showEvent, onOpen, onStatusChange, onEdit, onDelete, busyId }) {
  return (
    <table className="rr-table">
      <thead>
        <tr>
          <th>Task</th>
          {showEvent && <th>Event</th>}
          <th>Assignee</th>
          <th>Due</th>
          <th>Status</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {tasks.map((t) => {
          const due = fmtDate(t.due_date)
          return (
            <tr key={t.id}>
              <td>
                <button type="button" className="tm-tasklink" onClick={() => onOpen(t)}>{t.title}</button>
              </td>
              {showEvent && <td>{t.event_name && <span className={`tm-ev-tag ${evTagClass(t.event_id)}`}>{t.event_name}</span>}</td>}
              <td><span className="rd-who"><span className="dot">{initialsOf(t.assignee_name)}</span>{t.assignee_name || 'Unassigned'}</span></td>
              <td className={t.overdue ? 'tm-overdue' : ''}>{due || '—'}</td>
              <td>
                <select
                  className="rr-select gr-inline-select tm-status-select"
                  value={t.status}
                  disabled={busyId === t.id}
                  aria-label={`Status for ${t.title}`}
                  onChange={(e) => onStatusChange(t, e.target.value)}
                >
                  <option value="open">Open</option>
                  <option value="in_progress">In progress</option>
                  <option value="done">Done</option>
                </select>
              </td>
              <td className="gr-actions">
                {onEdit && <button className="rr-link-btn" onClick={() => onEdit(t)}>Edit</button>}
                {onDelete && <button className="rr-link-btn gr-danger-link" onClick={() => onDelete(t)}>Delete</button>}
              </td>
            </tr>
          )
        })}
        {tasks.length === 0 && (
          <tr><td colSpan={showEvent ? 6 : 5} style={{ textAlign: 'center', padding: '18px 8px', color: 'var(--faint)' }}>No tasks match this filter.</td></tr>
        )}
      </tbody>
    </table>
  )
}

function TeamTab({ eventId, notify, onRequestDelete }) {
  const [members, setMembers] = useState(null)
  const [membersError, setMembersError] = useState('')
  const [orgMembers, setOrgMembers] = useState(null)
  const [groups, setGroups] = useState([])
  const [assignUserId, setAssignUserId] = useState('')
  const [assigning, setAssigning] = useState(false)
  const [assignError, setAssignError] = useState('')
  const [orgRoles, setOrgRoles] = useState({})

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('staff')
  const [confirmInvite, setConfirmInvite] = useState(null)

  function loadMembers() {
    if (!eventId) return
    setMembersError('')
    return api.listMembers(eventId).then(setMembers).catch((e) => { setMembersError(e.message); setMembers([]) })
  }
  function loadOrgMembers() {
    if (!eventId) return
    api.listOrgMembers(eventId).then((oms) => {
      setOrgMembers(oms)
      setOrgRoles(Object.fromEntries(oms.map((m) => [m.user.id, m.role])))
    }).catch(() => setOrgMembers([]))
  }

  useEffect(() => {
    if (!eventId) { setMembers(null); setOrgMembers(null); return }
    setMembers(null)
    loadMembers()
    loadOrgMembers()
    api.listTableGroups(eventId).then(setGroups).catch(() => setGroups([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId])

  const assignedIds = new Set((members || []).map((m) => m.user.id))
  const unassigned = (orgMembers || []).map((om) => om.user).filter((u) => !assignedIds.has(u.id))

  async function assign() {
    if (!assignUserId) return
    setAssigning(true); setAssignError('')
    try {
      await api.assignMember(eventId, assignUserId)
      await loadMembers()
      setAssignUserId('')
      notify('Member assigned.')
    } catch (e) {
      setAssignError(e.message)
    } finally {
      setAssigning(false)
    }
  }

  function requestRemove(m) {
    onRequestDelete({
      title: 'Remove team member',
      message: `Remove ${m.user.name} from this event? They will lose access immediately.`,
      confirmLabel: 'Remove',
      run: async () => {
        await api.removeMember(eventId, m.user.id)
        await loadMembers()
        notify(`${m.user.name} removed from the team.`)
      },
    })
  }

  async function inviteAndAssign(email, role) {
    const orgMember = await api.inviteOrgMember(eventId, { email, role: role === 'manager' ? 'admin' : 'staff' })
    if (!assignedIds.has(orgMember.user.id)) await api.assignMember(eventId, orgMember.user.id)
    if (role === 'manager') await api.updateMemberPermissions(eventId, orgMember.user.id, { event_role: 'manager' })
    await Promise.all([loadMembers(), loadOrgMembers()])
  }

  async function sendInvite() {
    if (!inviteEmail.trim()) { notify('Enter an email to send an invite'); return }
    setConfirmInvite({ email: inviteEmail.trim(), role: inviteRole })
  }

  async function confirmInviteAnyway() {
    try {
      await inviteAndAssign(confirmInvite.email, confirmInvite.role)
      notify(`${confirmInvite.email} added as ${ROLE_LABEL[confirmInvite.role] || confirmInvite.role}`)
      setConfirmInvite(null)
      setInviteEmail('')
    } catch (e) { notify(e.message || 'Teammate could not be added', true) }
  }

  async function updatePermissions(member, patch, message) {
    try {
      // member.updated_at reflects the row this click was made from, so a
      // second admin's concurrent edit to the same member is rejected
      // instead of silently overwritten.
      await api.updateMemberPermissions(eventId, member.user.id, patch, member.updated_at)
      await loadMembers()
      notify(message)
    } catch (e) {
      if (e.status === 409) {
        await loadMembers()
        notify('Changed by another operator — refreshed with the latest permissions.', true)
      } else {
        notify(e.message || 'Permissions could not be updated', true)
      }
    }
  }

  async function updateSections(member, ids) {
    try {
      await api.setMemberSections(eventId, member.user.id, ids)
      await loadMembers()
      notify(`${member.user.name}'s scanner sections updated`)
    } catch (e) { notify(e.message || 'Scanner sections could not be updated', true) }
  }

  return (
    <div className="rr-grid2">
      <div className="rd-panel">
        <div className="rd-panel-head"><h3>Team members</h3><p>Roles and access control who can do what on this event</p></div>
        <div className="rd-panel-body">
          {!eventId ? (
            <EmptyState icon="calendar" title="No event selected" message="Choose an event from the top bar to manage its team." />
          ) : members === null ? (
            <LoadingSkeleton rows={4} variant="table" />
          ) : membersError ? (
            <ErrorRetryState message={membersError} onRetry={loadMembers} />
          ) : members.length === 0 ? (
            <EmptyState icon="team" title="No members yet" message="Assign a teammate from your organization to get started." />
          ) : (
            <table className="rr-table">
              <thead>
                <tr><th>Member</th><th>Role</th><th>Access level</th><th>Guest access</th><th>Permissions</th><th>Scanner sections</th><th /></tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const eventRole = m.event_role || 'staff'
                  const showExtras = eventRole !== 'staff'
                  const sections = m.section_group_ids || []
                  return (
                    <tr key={m.id}>
                      <td>
                        <div className="rd-who"><span className="dot">{initialsOf(m.user.name)}</span>
                          <div><div>{m.user.name}</div><small className="tm-email">{m.user.email}</small></div>
                        </div>
                      </td>
                      <td>
                        <select className="rr-select gr-inline-select" value={eventRole}
                          onChange={(e) => updatePermissions(m, { event_role: e.target.value }, `${m.user.name} role set to ${ROLE_LABEL[e.target.value]}`)}>
                          {EVENT_ROLE_OPTIONS.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                        </select>
                      </td>
                      <td>
                        {eventRole === 'manager' ? (
                          <select className="rr-select gr-inline-select" value={m.access_level || 'edit'}
                            onChange={(e) => updatePermissions(m, { access_level: e.target.value }, `${m.user.name} access updated`)}>
                            {ACCESS_LEVEL_OPTIONS.map((a) => <option key={a} value={a}>{a === 'edit' ? 'Edit' : 'View-only'}</option>)}
                          </select>
                        ) : <span className="rd-rowlink">—</span>}
                      </td>
                      <td>
                        <select className="rr-select gr-inline-select" value={guestAccessOf(m)}
                          onChange={(e) => updatePermissions(m, e.target.value === 'manage' ? { can_view_guests: true, can_manage_guests: true } : e.target.value === 'view' ? { can_view_guests: true, can_manage_guests: false } : { can_view_guests: false, can_manage_guests: false }, `${m.user.name} guest access updated`)}>
                          {GUEST_ACCESS_OPTIONS.map((g) => <option key={g} value={g}>{g === 'none' ? 'None' : g === 'view' ? 'View' : 'Manage'}</option>)}
                        </select>
                      </td>
                      <td>
                        {!showExtras ? <span className="rd-rowlink">—</span> : (
                          <div className="tm-perm-row">
                            {PERMS.map((p) => {
                              const on = permOn(m, p.key)
                              return (
                                <button
                                  type="button"
                                  key={p.key}
                                  className={`tm-perm-chip ${on ? 'on' : ''}`}
                                  title={`${p.label}: ${on ? 'enabled' : 'disabled'}`}
                                  onClick={() => updatePermissions(m, { [p.key === 'seats' ? 'can_reassign_seats' : p.key === 'menu' ? 'can_manage_menu' : 'can_view_dashboard']: !on }, `${p.label} ${on ? 'revoked' : 'granted'} for ${m.user.name}`)}
                                >
                                  <Icon name={p.icon} size={11} />{p.label}
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </td>
                      <td>
                        {groups.length === 0 ? <span className="rd-rowlink">—</span> : (
                          <div className="tm-perm-row">
                            <button type="button" className={`tm-perm-chip ${sections.length === 0 ? 'on' : ''}`}
                              onClick={() => updateSections(m, [])}>All</button>
                            {groups.map((g) => (
                              <button type="button" key={g.id} className={`tm-perm-chip ${sections.includes(g.id) ? 'on' : ''}`}
                                onClick={() => updateSections(m, sections.includes(g.id) ? sections.filter((id) => id !== g.id) : [...sections, g.id])}>{g.name}</button>
                            ))}
                          </div>
                        )}
                      </td>
                      <td>
                        <button type="button" className="rr-link-btn gr-danger-link" onClick={() => requestRemove(m)}>Remove</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="tm-side-col">
        <div className="rd-panel">
          <div className="rd-panel-head"><h3>Invite teammate</h3><p>Add another person to help run this event</p></div>
          <div className="rd-panel-body">
            {confirmInvite ? (
              <div className="tm-noaccount-confirm">
                <p><b>{confirmInvite.email}</b> doesn't have a Festio account yet. Send the invite anyway? They'll be prompted to create one.</p>
                <div className="rd-row2">
                  <button className="rr-btn secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setConfirmInvite(null)}>Cancel</button>
                  <button className="rr-btn primary" style={{ flex: 1, justifyContent: 'center' }} onClick={confirmInviteAnyway}>Invite anyway</button>
                </div>
              </div>
            ) : (
              <>
                <label className="rd-field-label">Email address</label>
                <input className="rd-field" type="email" placeholder="name@example.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
                <label className="rd-field-label">Role</label>
                <select className="rr-select" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                  <option value="staff">Staff</option>
                  <option value="admin">Admin</option>
                </select>
                <button className="rr-btn primary" style={{ width: '100%', justifyContent: 'center', marginTop: 4 }} onClick={sendInvite}>
                  <Icon name="send" size={14} /> Send invite
                </button>
              </>
            )}
            <p className="tm-invite-note"><Icon name="info" size={11} /> Use one account per staff member — sharing logins breaks activity history and audit logs.</p>
            <div className="tm-help-links">
              <a href="/help-redesign?role=organizer">How to create staff accounts →</a>
              <a href="/login" target="_blank" rel="noreferrer">Open staff sign-in →</a>
              <button className="rr-link-btn" onClick={async () => {
                const guideUrl = `${window.location.origin}/help-redesign?role=organizer`
                try {
                  await navigator.clipboard.writeText(guideUrl)
                  notify('Staff setup guide link copied')
                } catch {
                  notify(`Copy this staff guide link: ${guideUrl}`)
                }
              }}>Share staff setup guide →</button>
            </div>
          </div>
        </div>

        <div className="rd-panel">
          <div className="rd-panel-head"><h3>Assign existing org member</h3><p>Add someone from your organization without a new invite</p></div>
          <div className="rd-panel-body">
            {orgMembers === null ? (
              <LoadingSkeleton rows={2} />
            ) : unassigned.length === 0 ? (
              <p className="rd-rowlink">Every organization member is already on this event.</p>
            ) : (
              <>
                <select className="rr-select" value={assignUserId} onChange={(e) => { setAssignUserId(e.target.value); setAssignError('') }}>
                  <option value="">— choose a teammate —</option>
                  {unassigned.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.email}</option>)}
                </select>
                {assignError && <p className="rp-field-error">{assignError}</p>}
                <button className="rr-btn secondary" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
                  disabled={assigning || !assignUserId} onClick={assign}>
                  {assigning ? 'Assigning…' : 'Assign to event'}
                </button>
              </>
            )}
          </div>
        </div>

        <div className="rd-panel">
          <div className="rd-panel-head"><h3>Organization members &amp; roles</h3><p>Org-wide roles, independent of any one event</p></div>
          <div className="rd-panel-body">
            {orgMembers === null ? (
              <LoadingSkeleton rows={3} />
            ) : orgMembers.length === 0 ? (
              <p className="rd-rowlink">No organization members yet.</p>
            ) : orgMembers.map((m) => (
              <div className="tm-org-row" key={m.user.id}>
                <div className="rd-who"><span className="dot">{initialsOf(m.user.name)}</span><div><div>{m.user.name}</div><small className="tm-email">{m.user.email}</small></div></div>
                <select className="rr-select gr-inline-select" value={orgRoles[m.user.id] ?? m.role}
                  onChange={async (e) => {
                    const role = e.target.value
                    try {
                      await api.setOrgMemberRole(eventId, m.user.id, role)
                      setOrgRoles((p) => ({ ...p, [m.user.id]: role }))
                      await loadOrgMembers()
                      notify(`${m.user.name} org role set to ${role}`)
                    } catch (error) { notify(error.message || 'Organization role could not be updated', true) }
                  }}>
                  {ORG_ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function TasksTab({ eventId, notify, onRequestDelete }) {
  const [tasks, setTasks] = useState(null)
  const [tasksError, setTasksError] = useState('')
  const [taskMembers, setTaskMembers] = useState([])
  const [view, setView] = useState('list')
  const [showCompleted, setShowCompleted] = useState(true)
  const [taskForm, setTaskForm] = useState(null)
  const [savingTask, setSavingTask] = useState(false)
  const [taskFormError, setTaskFormError] = useState('')
  const [statusBusyId, setStatusBusyId] = useState(null)
  const [openTask, setOpenTask] = useState(null)

  function loadTasks() {
    if (!eventId) return
    setTasksError('')
    return Promise.all([api.listTasks(eventId), api.listMembers(eventId)])
      .then(([t, m]) => { setTasks(t); setTaskMembers(m) })
      .catch((e) => { setTasksError(e.message); setTasks([]) })
  }

  useEffect(() => {
    if (!eventId) { setTasks(null); return }
    setTasks(null)
    loadTasks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId])

  // Keep an open detail panel's task fresh whenever the list reloads.
  useEffect(() => {
    if (!openTask || !tasks) return
    const fresh = tasks.find((t) => t.id === openTask.id)
    if (fresh) setOpenTask(fresh)
  }, [tasks, openTask])

  async function saveTask(e) {
    e.preventDefault()
    if (!taskForm.title.trim()) { setTaskFormError('Title is required.'); return }
    setSavingTask(true); setTaskFormError('')
    try {
      const payload = {
        title: taskForm.title.trim(),
        notes: taskForm.notes?.trim() || null,
        assignee_user_id: taskForm.assignee_user_id || null,
        due_date: taskForm.due_date || null,
      }
      if (taskForm.id) await api.updateTask(eventId, taskForm.id, payload, taskForm.updated_at)
      else await api.createTask(eventId, payload)
      const wasEdit = !!taskForm.id
      setTaskForm(null)
      await loadTasks()
      notify(wasEdit ? 'Task updated.' : 'Task created.')
    } catch (e) {
      if (e.status === 409) {
        setTaskForm(null)
        await loadTasks()
        notify('Changed by another operator — refreshed with the latest version. Please redo your edit.', true)
      } else {
        setTaskFormError(e.message)
      }
    } finally {
      setSavingTask(false)
    }
  }

  async function changeStatus(task, status) {
    if (status === task.status) return
    setStatusBusyId(task.id)
    try {
      if (status === 'done') await api.completeTask(eventId, task.id)
      else if (status === 'in_progress') await api.startTask(eventId, task.id)
      else await api.reopenTask(eventId, task.id)
      await loadTasks()
    } catch (e) {
      notify(e.message, true)
    } finally {
      setStatusBusyId(null)
    }
  }

  function openEdit(t) {
    setTaskFormError('')
    setTaskForm({
      id: t.id,
      title: t.title,
      notes: t.notes || '',
      assignee_user_id: t.assignee_user_id || '',
      due_date: t.due_date ? t.due_date.slice(0, 10) : '',
      // Captured at edit-open time so the save can detect whether someone
      // else changed this task (e.g. reassigned it) in the meantime, rather
      // than silently overwriting their change.
      updated_at: t.updated_at,
    })
  }

  function requestDeleteTask(task) {
    onRequestDelete({
      title: 'Delete task',
      message: `Delete task "${task.title}"? All attachments and comments will be removed.`,
      confirmLabel: 'Delete',
      run: async () => {
        await api.deleteTask(eventId, task.id)
        await loadTasks()
        notify('Task deleted.')
      },
    })
  }

  const list = tasks || []
  const openCount = list.filter((t) => t.status !== 'done').length
  const overdueCount = list.filter((t) => t.overdue).length
  const hasCompleted = list.some((t) => t.status === 'done')
  const visibleTasks = showCompleted ? list : list.filter((t) => t.status !== 'done')

  return (
    <>
      <div className="tm-tasks-head">
        <div className="tm-count">
          <b>{openCount} open</b> · <span className={overdueCount > 0 ? 'danger' : ''}>{overdueCount} overdue</span>
        </div>
        <div className="tm-tasks-toolbar">
          {hasCompleted && (
            <label className="gr-required-check"><input type="checkbox" checked={showCompleted} onChange={(e) => setShowCompleted(e.target.checked)} /> Show completed</label>
          )}
          <div className="rd-seg">
            <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>List</button>
            <button className={view === 'board' ? 'on' : ''} onClick={() => setView('board')}>Board</button>
          </div>
          <button className="rr-btn primary" disabled={!eventId}
            onClick={() => setTaskForm((f) => (f ? null : { title: '', notes: '', assignee_user_id: '', due_date: '' }))}>
            <Icon name="plus" size={14} /> Task
          </button>
        </div>
      </div>

      {taskForm && (
        <form onSubmit={saveTask} className="rr-panel ci-form-inset">
          <div className="rd-row2">
            <input className="rd-field" placeholder="Task title" style={{ flex: 2 }}
              value={taskForm.title} onChange={(e) => setTaskForm((f) => ({ ...f, title: e.target.value }))} required />
            <select className="rr-select" style={{ flex: 1, marginBottom: 0 }}
              value={taskForm.assignee_user_id} onChange={(e) => setTaskForm((f) => ({ ...f, assignee_user_id: e.target.value }))}>
              <option value="">Unassigned</option>
              {taskMembers.map((m) => <option key={m.user.id} value={m.user.id}>{m.user.name}</option>)}
            </select>
          </div>
          <div className="rd-row2" style={{ marginTop: 9 }}>
            <input className="rd-field" type="date" style={{ flex: 1 }}
              value={taskForm.due_date} onChange={(e) => setTaskForm((f) => ({ ...f, due_date: e.target.value }))} />
            <input className="rd-field" placeholder="Notes (optional)" style={{ flex: 2 }}
              value={taskForm.notes} onChange={(e) => setTaskForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
          {taskFormError && <p className="rp-field-error">{taskFormError}</p>}
          <div className="rd-row2" style={{ marginTop: 4 }}>
            <button type="button" className="rr-btn secondary" style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => { setTaskForm(null); setTaskFormError('') }}>Cancel</button>
            <button type="submit" className="rr-btn primary" style={{ flex: 1, justifyContent: 'center' }} disabled={savingTask}>
              {savingTask ? 'Saving…' : taskForm.id ? 'Save changes' : 'Create task'}
            </button>
          </div>
        </form>
      )}

      <div className="rd-panel">
        <div className="rd-panel-body">
          {!eventId ? (
            <EmptyState icon="calendar" title="No event selected" message="Choose an event from the top bar to manage its tasks." />
          ) : tasks === null ? (
            <LoadingSkeleton rows={5} variant="table" />
          ) : tasksError ? (
            <ErrorRetryState message={tasksError} onRetry={loadTasks} />
          ) : tasks.length === 0 ? (
            <EmptyState icon="file" title="No tasks yet" message="Create a task to start tracking what needs to get done." />
          ) : view === 'list' ? (
            <TaskTable tasks={visibleTasks} showEvent={false} onOpen={setOpenTask} onStatusChange={changeStatus}
              onEdit={openEdit} onDelete={requestDeleteTask} busyId={statusBusyId} />
          ) : (
            <TaskBoard tasks={visibleTasks} showEvent={false} onOpen={setOpenTask} />
          )}
        </div>
      </div>

      <TaskDetailPanel task={openTask} onClose={() => setOpenTask(null)} notify={notify} />
    </>
  )
}

function MyTasksTab({ notify }) {
  const [filter, setFilter] = useState('mine')
  const [view, setView] = useState('list')
  const [openTask, setOpenTask] = useState(null)
  const [tasks, setTasks] = useState(null)
  const [tasksError, setTasksError] = useState('')
  const [statusBusyId, setStatusBusyId] = useState(null)

  function loadTasks() {
    setTasksError('')
    return api.listMyTasks(filter).then(setTasks).catch((e) => { setTasksError(e.message); setTasks([]) })
  }

  useEffect(() => {
    setTasks(null)
    loadTasks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter])

  useEffect(() => {
    if (!openTask || !tasks) return
    const fresh = tasks.find((t) => t.id === openTask.id)
    if (fresh) setOpenTask(fresh)
  }, [tasks, openTask])

  async function changeStatus(task, status) {
    if (status === task.status) return
    setStatusBusyId(task.id)
    try {
      if (status === 'done') await api.completeTask(task.event_id, task.id)
      else if (status === 'in_progress') await api.startTask(task.event_id, task.id)
      else await api.reopenTask(task.event_id, task.id)
      await loadTasks()
    } catch (e) {
      notify(e.message, true)
    } finally {
      setStatusBusyId(null)
    }
  }

  const list = tasks || []
  const filtered = list

  const groups = [
    { key: 'overdue', label: 'Overdue', items: filtered.filter((t) => t.overdue) },
    { key: 'duesoon', label: 'Due soon', items: filtered.filter((t) => !t.overdue && t.status !== 'done') },
    { key: 'done', label: 'Done', items: filtered.filter((t) => t.status === 'done') },
  ]

  return (
    <>
      <div className="tm-filter-row">
        <div className="rd-seg">
          <button className={filter === 'mine' ? 'on' : ''} onClick={() => setFilter('mine')}>Assigned to me</button>
          <button className={filter === 'others' ? 'on' : ''} onClick={() => setFilter('others')}>Assigned to others</button>
          <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>All</button>
        </div>
        <div className="rd-seg">
          <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>List</button>
          <button className={view === 'board' ? 'on' : ''} onClick={() => setView('board')}>Board</button>
        </div>
      </div>

      {tasks === null ? (
        <div className="rd-panel"><div className="rd-panel-body"><LoadingSkeleton rows={5} variant="table" /></div></div>
      ) : tasksError ? (
        <div className="rd-panel"><div className="rd-panel-body"><ErrorRetryState message={tasksError} onRetry={loadTasks} /></div></div>
      ) : filtered.length === 0 ? (
        <div className="rd-panel"><div className="rd-panel-body"><EmptyState icon="clock" title="No tasks here" message="Nothing assigned in this view." /></div></div>
      ) : view === 'board' ? (
        <div className="rd-panel">
          <div className="rd-panel-head"><h3>Across all your events</h3><p>Every task assigned across events you help run — each row tagged with its event</p></div>
          <div className="rd-panel-body">
            <TaskBoard tasks={filtered} showEvent onOpen={setOpenTask} />
          </div>
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.key} className="rd-panel tm-group-panel">
            <div className="rd-panel-head"><h3>{g.label}</h3><p>{g.items.length} task{g.items.length === 1 ? '' : 's'}</p></div>
            <div className="rd-panel-body">
              <TaskTable tasks={g.items} showEvent onOpen={setOpenTask} onStatusChange={changeStatus} busyId={statusBusyId} />
            </div>
          </div>
        ))
      )}

      <TaskDetailPanel task={openTask} onClose={() => setOpenTask(null)} notify={notify} />
    </>
  )
}

export default function TeamRedesignPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [toast, setToast] = useState('')
  const [toastError, setToastError] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [currentEventId] = useCurrentEvent()
  useEventDetails(currentEventId) // kept: no consumer in this file currently reads it, but fetching stays harmless and consistent with every other redesign page
  const rawTab = searchParams.get('tab')
  const tab = rawTab === 'tasks' ? 'tasks' : rawTab === 'mytasks' ? 'mytasks' : 'team'

  function notify(message, isError = false) {
    setToast(message)
    setToastError(isError)
    window.setTimeout(() => setToast(''), 2600)
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget || deleteBusy) return
    setDeleteBusy(true)
    try {
      await deleteTarget.run()
      setDeleteTarget(null)
    } catch (e) {
      notify(e.message || 'Something went wrong. Please try again.', true)
    } finally {
      setDeleteBusy(false)
    }
  }

  function goTab(next) {
    setSearchParams(next === 'team' ? { tab: 'team' } : { tab: next })
  }

  const shellProps = tab === 'mytasks'
    ? { topActive: 'mytasks', withEventSidebar: false, eventActive: null }
    : { topActive: 'setup', withEventSidebar: true, eventActive: tab }

  return (
    <RedesignShell {...shellProps}>
      <div className="rr-pagehead">
        <div>
          <div className="rr-title-row">
            <h1>{tab === 'mytasks' ? 'My Tasks' : 'Team & Tasks'}</h1>
          </div>
          <div className="rr-meta">
            <Icon name="team" size={13} /> {tab === 'mytasks' ? 'Across all your events' : (event?.name || (currentEventId ? 'Loading…' : 'No event selected'))}
          </div>
        </div>
      </div>

      <div className="rr-tabs">
        <button className={tab === 'team' ? 'active' : ''} onClick={() => goTab('team')}><Icon name="team" size={13} /> Team</button>
        <button className={tab === 'tasks' ? 'active' : ''} onClick={() => goTab('tasks')}><Icon name="file" size={13} /> Tasks</button>
        <button className={tab === 'mytasks' ? 'active' : ''} onClick={() => goTab('mytasks')}><Icon name="clock" size={13} /> My Tasks</button>
      </div>

      {tab === 'team' && <TeamTab eventId={currentEventId} notify={notify} onRequestDelete={setDeleteTarget} />}
      {tab === 'tasks' && <TasksTab eventId={currentEventId} notify={notify} onRequestDelete={setDeleteTarget} />}
      {tab === 'mytasks' && <MyTasksTab notify={notify} />}

      {toast && <div className="rd-toast" style={toastError ? { background: 'var(--danger)' } : undefined}><Icon name={toastError ? 'info' : 'check'} />{toast}</div>}
      {deleteTarget && (
        <ConfirmDialog
          title={deleteTarget.title}
          message={deleteTarget.message}
          confirmLabel={deleteBusy ? 'Working…' : deleteTarget.confirmLabel}
          onConfirm={handleDeleteConfirm}
          onCancel={() => { if (!deleteBusy) setDeleteTarget(null) }}
        />
      )}
    </RedesignShell>
  )
}
