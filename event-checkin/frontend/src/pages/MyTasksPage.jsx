import { useEffect, useState } from 'react'
import { api } from '../api'
import TaskDetailPanel from '../components/TaskDetailPanel'
import TaskBoard from '../components/TaskBoard'

const TABS = [
  { key: 'mine', label: 'Assigned to me' },
  { key: 'others', label: 'Assigned to others' },
  { key: 'all', label: 'All' },
]

const STATUS_CLS = {
  done: 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800',
  in_progress: 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800',
  open: 'bg-gray-50 dark:bg-slate-700 text-gray-600 dark:text-slate-300 border-gray-300 dark:border-slate-600',
}

function TaskRow({ task, onStatusChange, onOpenDetail, busy }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-slate-700 rounded-lg">
      <select
        value={task.status}
        disabled={busy}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onStatusChange(task, e.target.value)}
        aria-label={`Status for ${task.title}`}
        className={`mt-0.5 text-[11px] rounded-md px-1.5 py-1 border cursor-pointer ${STATUS_CLS[task.status] || STATUS_CLS.open}`}
      >
        <option value="open">Open</option>
        <option value="in_progress">In progress</option>
        <option value="done">Done</option>
      </select>
      <div className="flex-1 min-w-0 flex items-start gap-3 cursor-pointer" onClick={() => onOpenDetail(task)}>
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-semibold hover:underline ${task.status === 'done' ? 'line-through text-gray-400 dark:text-slate-500' : 'text-gray-900 dark:text-white'}`}>
            {task.title}
          </div>
          <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
            {task.event_name}{task.assignee_name ? ` · ${task.assignee_name}` : ''}
          </div>
        </div>
        {task.due_date && (
          <span className={`text-xs shrink-0 ${task.overdue ? 'text-red-600 font-semibold' : 'text-gray-500 dark:text-slate-400'}`}>
            {task.overdue ? '⚠ Overdue ' : 'Due '}{new Date(task.due_date).toLocaleDateString()}
          </span>
        )}
      </div>
    </div>
  )
}

export default function MyTasksPage() {
  const [assignment, setAssignment] = useState('mine')
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [err, setErr] = useState('')
  const [view, setView] = useState('list')   // 'list' | 'board'
  const [selectedTask, setSelectedTask] = useState(null)

  function reload() {
    setErr('')
    return api.listMyTasks(assignment).then(setTasks).catch((e) => setErr(e.message))
  }

  useEffect(() => {
    setLoading(true)
    reload().finally(() => setLoading(false))
  }, [assignment])

  // Keep an open detail panel's task fresh after a status change/comment.
  useEffect(() => {
    if (!selectedTask) return
    const fresh = tasks.find((t) => t.id === selectedTask.id)
    if (fresh) setSelectedTask(fresh)
  }, [tasks])

  async function handleStatusChange(task, status) {
    if (status === task.status) return
    setBusyId(task.id)
    try {
      if (status === 'done') await api.completeTask(task.event_id, task.id)
      else if (status === 'in_progress') await api.startTask(task.event_id, task.id)
      else await api.reopenTask(task.event_id, task.id)
      await reload()
    } catch (e) { setErr(e.message) }
    finally { setBusyId(null) }
  }

  const overdue = tasks.filter((t) => t.overdue)
  const dueSoon = tasks.filter((t) => !t.overdue && t.status !== 'done' && t.due_date)
  const noDueDate = tasks.filter((t) => !t.overdue && t.status !== 'done' && !t.due_date)
  const done = tasks.filter((t) => t.status === 'done')

  const groups = [
    { label: 'Overdue', items: overdue },
    { label: 'Due soon', items: dueSoon },
    { label: 'No due date', items: noDueDate },
    { label: 'Done', items: done },
  ].filter((g) => g.items.length > 0)

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">My Tasks</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
            Every task across every event you can access — change status here, or click a task for details and updates.
          </p>
        </div>
        <div className="flex rounded-lg border border-gray-300 dark:border-slate-600 overflow-hidden text-xs font-semibold shrink-0">
          <button onClick={() => setView('list')}
            className={`px-2.5 py-1.5 ${view === 'list' ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-700 text-gray-600 dark:text-slate-300'}`}>
            List
          </button>
          <button onClick={() => setView('board')}
            className={`px-2.5 py-1.5 ${view === 'board' ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-700 text-gray-600 dark:text-slate-300'}`}>
            Board
          </button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-gray-200 dark:border-slate-700">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setAssignment(t.key)}
            className={`px-3 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              assignment === t.key
                ? 'border-indigo-600 text-indigo-700 dark:text-indigo-300'
                : 'border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-200'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {err && <p className="text-sm text-red-500">{err}</p>}

      {loading ? (
        <p className="text-sm text-gray-400 dark:text-slate-500">Loading…</p>
      ) : tasks.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-slate-500">No tasks here.</p>
      ) : view === 'board' ? (
        <TaskBoard tasks={tasks} onStatusChange={handleStatusChange} onOpenDetail={setSelectedTask} />
      ) : (
        <div className="bg-white dark:bg-slate-800 dark:border dark:border-slate-700/60 rounded-xl shadow divide-y divide-gray-100 dark:divide-slate-700">
          {groups.map((g) => (
            <div key={g.label} className="p-2">
              <div className="px-2 py-1 text-xs font-bold uppercase tracking-wide text-gray-400 dark:text-slate-500">
                {g.label}
              </div>
              <div className="divide-y divide-gray-50 dark:divide-slate-700/60">
                {g.items.map((t) => (
                  <TaskRow key={t.id} task={t} onStatusChange={handleStatusChange} onOpenDetail={setSelectedTask} busy={busyId === t.id} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedTask && (
        <TaskDetailPanel task={selectedTask} onClose={() => setSelectedTask(null)} onStatusChange={handleStatusChange} />
      )}
    </div>
  )
}
