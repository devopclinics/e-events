import { useState } from 'react'

const COLUMNS = [
  { key: 'open', label: 'To do' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'done', label: 'Done' },
]

function Card({ task, onOpenDetail, onDragStart }) {
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, task)}
      onClick={() => onOpenDetail(task)}
      className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg p-3 shadow-sm cursor-pointer hover:shadow-md transition-shadow"
    >
      <div className={`text-sm font-semibold ${task.status === 'done' ? 'line-through text-gray-400 dark:text-slate-500' : 'text-gray-900 dark:text-white'}`}>
        {task.title}
      </div>
      {task.event_name && <div className="text-xs text-gray-400 dark:text-slate-500 mt-1">{task.event_name}</div>}
      <div className="mt-2 flex flex-wrap gap-1.5 items-center">
        {task.assignee_name && (
          <span className="text-[11px] bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.5 rounded">
            {task.assignee_name}
          </span>
        )}
        {task.due_date && (
          <span className={`text-[11px] ${task.overdue ? 'text-red-600 font-semibold' : 'text-gray-500 dark:text-slate-400'}`}>
            {task.overdue ? '⚠ ' : ''}{new Date(task.due_date).toLocaleDateString()}
          </span>
        )}
      </div>
    </div>
  )
}

// Drag-and-drop Kanban board: dragging a card to a different column calls
// onStatusChange the same way the list view's status dropdown does — the
// board is just another view onto the same status field, not a separate model.
export default function TaskBoard({ tasks, onStatusChange, onOpenDetail }) {
  const [dragOverCol, setDragOverCol] = useState(null)

  function handleDragStart(e, task) {
    e.dataTransfer.setData('text/plain', task.id)
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleDrop(e, columnKey) {
    e.preventDefault()
    setDragOverCol(null)
    const taskId = e.dataTransfer.getData('text/plain')
    const task = tasks.find((t) => t.id === taskId)
    if (task && task.status !== columnKey) onStatusChange(task, columnKey)
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {COLUMNS.map((col) => {
        const items = tasks.filter((t) => t.status === col.key)
        return (
          <div key={col.key}
            onDragOver={(e) => { e.preventDefault(); setDragOverCol(col.key) }}
            onDragLeave={() => setDragOverCol((c) => (c === col.key ? null : c))}
            onDrop={(e) => handleDrop(e, col.key)}
            className={`rounded-xl p-3 space-y-2 min-h-[8rem] border-2 border-dashed transition-colors ${
              dragOverCol === col.key
                ? 'border-indigo-400 bg-indigo-50/50 dark:bg-indigo-900/10'
                : 'border-transparent bg-gray-50 dark:bg-slate-900/40'
            }`}
          >
            <div className="flex items-center justify-between px-1">
              <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-slate-400">{col.label}</h3>
              <span className="text-xs text-gray-400 dark:text-slate-500">{items.length}</span>
            </div>
            {items.map((t) => (
              <Card key={t.id} task={t} onOpenDetail={onOpenDetail} onDragStart={handleDragStart} />
            ))}
            {items.length === 0 && (
              <p className="text-xs text-gray-300 dark:text-slate-600 italic px-1">Drop a card here</p>
            )}
          </div>
        )
      })}
    </div>
  )
}
