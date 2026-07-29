import { useEffect, useState } from 'react'
import { api } from '../api'

const STATUS_CLS = {
  done: 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800',
  in_progress: 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800',
  open: 'bg-gray-50 dark:bg-slate-700 text-gray-600 dark:text-slate-300 border-gray-300 dark:border-slate-600',
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

// Slide-over with the task's full detail, its subtask checklist, and its
// activity/comment thread — shared by the per-event Tasks tab and the
// cross-event My Tasks page so clicking a task never just navigates away
// without a way to break it down or discuss it.
export default function TaskDetailPanel({ task, onClose, onStatusChange }) {
  const [activity, setActivity] = useState([])
  const [subtasks, setSubtasks] = useState([])
  const [attachments, setAttachments] = useState([])
  const [loading, setLoading] = useState(true)
  const [comment, setComment] = useState('')
  const [posting, setPosting] = useState(false)
  const [newSubtask, setNewSubtask] = useState('')
  const [addingSubtask, setAddingSubtask] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')

  async function reloadActivity() {
    try { setActivity(await api.listTaskActivity(task.event_id, task.id)) }
    catch (e) { setErr(e.message) }
  }
  async function reloadSubtasks() {
    try { setSubtasks(await api.listSubtasks(task.event_id, task.id)) }
    catch (e) { setErr(e.message) }
  }
  async function reloadAttachments() {
    try { setAttachments(await api.listTaskAttachments(task.event_id, task.id)) }
    catch (e) { setErr(e.message) }
  }
  useEffect(() => {
    setLoading(true)
    Promise.all([reloadActivity(), reloadSubtasks(), reloadAttachments()]).finally(() => setLoading(false))
  }, [task.id])

  async function postComment(e) {
    e.preventDefault()
    const body = comment.trim()
    if (!body) return
    setPosting(true); setErr('')
    try {
      await api.addTaskComment(task.event_id, task.id, body)
      setComment('')
      await reloadActivity()
    } catch (e) { setErr(e.message) }
    finally { setPosting(false) }
  }

  async function changeStatus(status) {
    if (status === task.status) return
    await onStatusChange(task, status)
    await reloadActivity()
  }

  async function addSubtask(e) {
    e.preventDefault()
    const title = newSubtask.trim()
    if (!title) return
    setAddingSubtask(true); setErr('')
    try {
      await api.createSubtask(task.event_id, task.id, title)
      setNewSubtask('')
      await Promise.all([reloadSubtasks(), reloadActivity()])
    } catch (e) { setErr(e.message) }
    finally { setAddingSubtask(false) }
  }

  async function changeSubtaskStatus(subtask, status) {
    if (status === subtask.status) return
    try {
      await api.updateSubtask(task.event_id, task.id, subtask.id, { status })
      await Promise.all([reloadSubtasks(), reloadActivity()])
    } catch (e) { setErr(e.message) }
  }

  async function removeSubtask(subtask) {
    try {
      await api.deleteSubtask(task.event_id, task.id, subtask.id)
      await Promise.all([reloadSubtasks(), reloadActivity()])
    } catch (e) { setErr(e.message) }
  }

  async function uploadAttachment(e) {
    const file = e.target.files?.[0]
    e.target.value = ''   // allow re-selecting the same file next time
    if (!file) return
    setUploading(true); setErr('')
    try {
      await api.uploadTaskAttachment(task.event_id, task.id, file)
      await Promise.all([reloadAttachments(), reloadActivity()])
    } catch (e) { setErr(e.message) }
    finally { setUploading(false) }
  }

  async function removeAttachment(attachment) {
    if (!confirm(`Remove "${attachment.filename}"?`)) return
    try {
      await api.deleteTaskAttachment(task.event_id, task.id, attachment.id)
      await Promise.all([reloadAttachments(), reloadActivity()])
    } catch (e) { setErr(e.message) }
  }

  const doneCount = subtasks.filter((s) => s.status === 'done').length

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white dark:bg-slate-800 h-full shadow-xl overflow-y-auto p-6 space-y-5">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white pr-4">{task.title}</h2>
          <button onClick={onClose} aria-label="Close"
            className="text-gray-400 hover:text-gray-700 dark:hover:text-white text-2xl leading-none shrink-0">×</button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select value={task.status} onChange={(e) => changeStatus(e.target.value)}
            className={`text-xs rounded-md px-2 py-1.5 border cursor-pointer ${STATUS_CLS[task.status] || STATUS_CLS.open}`}>
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="done">Done</option>
          </select>
          {task.event_name && <span className="text-xs text-gray-500 dark:text-slate-400">{task.event_name}</span>}
        </div>

        <div className="text-sm space-y-1.5">
          {task.assignee_name && (
            <div className="text-gray-600 dark:text-slate-300"><span className="font-semibold">Assignee:</span> {task.assignee_name}</div>
          )}
          {task.due_date && (
            <div className={task.overdue ? 'text-red-600 font-semibold' : 'text-gray-600 dark:text-slate-300'}>
              <span className="font-semibold">Due:</span> {new Date(task.due_date).toLocaleDateString()}{task.overdue ? ' — overdue' : ''}
            </div>
          )}
          {task.notes && <p className="text-gray-600 dark:text-slate-300 pt-1">{task.notes}</p>}
        </div>

        {err && <p className="text-sm text-red-500">{err}</p>}

        <div className="border-t border-gray-200 dark:border-slate-700 pt-4">
          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-400 dark:text-slate-500 mb-2">
            Subtasks{subtasks.length > 0 ? ` (${doneCount}/${subtasks.length})` : ''}
          </h3>
          {loading ? (
            <p className="text-sm text-gray-400 dark:text-slate-500">Loading…</p>
          ) : (
            <div className="space-y-1.5">
              {subtasks.map((s) => (
                <div key={s.id} className="flex items-center gap-2 group">
                  <select value={s.status} onChange={(e) => changeSubtaskStatus(s, e.target.value)}
                    aria-label={`Status for ${s.title}`}
                    className={`text-[11px] rounded-md px-1.5 py-1 border cursor-pointer shrink-0 ${STATUS_CLS[s.status] || STATUS_CLS.open}`}>
                    <option value="open">Open</option>
                    <option value="in_progress">In progress</option>
                    <option value="done">Done</option>
                  </select>
                  <span className={`flex-1 text-sm ${s.status === 'done' ? 'line-through text-gray-400 dark:text-slate-500' : 'text-gray-700 dark:text-slate-200'}`}>
                    {s.title}
                  </span>
                  <button onClick={() => removeSubtask(s)}
                    className="text-xs text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity">
                    Remove
                  </button>
                </div>
              ))}
              {subtasks.length === 0 && <p className="text-sm text-gray-400 dark:text-slate-500">No subtasks yet.</p>}
            </div>
          )}
          <form onSubmit={addSubtask} className="mt-2 flex gap-2">
            <input value={newSubtask} onChange={(e) => setNewSubtask(e.target.value)} placeholder="Add subtask…"
              className="flex-1 border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
            <button type="submit" disabled={addingSubtask || !newSubtask.trim()}
              className="text-sm text-indigo-600 hover:underline disabled:opacity-40 disabled:no-underline shrink-0">
              Add
            </button>
          </form>
        </div>

        <div className="border-t border-gray-200 dark:border-slate-700 pt-4">
          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-400 dark:text-slate-500 mb-2">
            Attachments{attachments.length > 0 ? ` (${attachments.length})` : ''}
          </h3>
          {loading ? (
            <p className="text-sm text-gray-400 dark:text-slate-500">Loading…</p>
          ) : (
            <div className="space-y-1.5">
              {attachments.map((a) => (
                <div key={a.id} className="flex items-center gap-2 group">
                  <a href={a.url} target="_blank" rel="noreferrer"
                    className="flex-1 min-w-0 text-sm text-indigo-600 dark:text-indigo-400 hover:underline truncate">
                    {a.filename}
                  </a>
                  <span className="text-xs text-gray-400 dark:text-slate-500 shrink-0">{formatBytes(a.size_bytes)}</span>
                  <button onClick={() => removeAttachment(a)}
                    className="text-xs text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    Remove
                  </button>
                </div>
              ))}
              {attachments.length === 0 && <p className="text-sm text-gray-400 dark:text-slate-500">No attachments yet.</p>}
            </div>
          )}
          <label className="mt-2 inline-block text-sm text-indigo-600 hover:underline cursor-pointer disabled:opacity-40">
            {uploading ? 'Uploading…' : '+ Add file'}
            <input type="file" onChange={uploadAttachment} disabled={uploading} className="hidden" />
          </label>
        </div>

        <div className="border-t border-gray-200 dark:border-slate-700 pt-4">
          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-400 dark:text-slate-500 mb-2">Activity</h3>
          {loading ? (
            <p className="text-sm text-gray-400 dark:text-slate-500">Loading…</p>
          ) : activity.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-slate-500">No activity yet.</p>
          ) : (
            <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
              {activity.map((a) => (
                <div key={a.id}>
                  {a.kind === 'comment' ? (
                    <div className="text-sm">
                      <span className="font-semibold text-gray-800 dark:text-slate-200">{a.user_name || 'Someone'}</span>
                      <span className="text-gray-400 dark:text-slate-500 text-xs ml-2">{new Date(a.created_at).toLocaleString()}</span>
                      <p className="text-gray-700 dark:text-slate-300 mt-0.5">{a.body}</p>
                    </div>
                  ) : (
                    <div className="text-xs text-gray-400 dark:text-slate-500 italic">
                      {a.user_name ? `${a.user_name} — ` : ''}{a.body}
                      <span className="ml-2">{new Date(a.created_at).toLocaleString()}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <form onSubmit={postComment} className="mt-3 flex gap-2">
            <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Write an update…"
              className="flex-1 border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-gray-900 dark:text-white" />
            <button type="submit" disabled={posting || !comment.trim()}
              className="bg-indigo-600 text-white px-3 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
              Post
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
