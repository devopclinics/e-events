import { useEffect, useState } from 'react'
import RedesignShell, { Icon, Modal, ConfirmDialog } from './redesign/RedesignShell'
import { useCurrentEvent } from '../hooks/useCurrentEvent'
import { useEventDetails } from '../hooks/useEventDetails'
import { api } from '../api'
import './PlannerRedesignPage.css'

const TABS = ['Portfolio', 'Dashboard', 'Budget', 'Vendors', 'Procurement', 'Timeline', 'Runsheet', 'Documents']

const VENDOR_STATUSES = ['prospect', 'shortlisted', 'contracted', 'paid', 'cancelled']
const BUDGET_ITEM_STATUSES = ['pending', 'paid', 'cancelled']
const MILESTONE_STATUSES = ['not_started', 'in_progress', 'done']
const TASK_STATUSES = ['todo', 'in_progress', 'done']
const TASK_PRIORITIES = ['low', 'normal', 'high']
const RUNSHEET_TYPES = ['setup', 'program', 'break', 'ceremony', 'other']
const RUNSHEET_STATUSES = ['upcoming', 'in_progress', 'done']
const DOCUMENT_TYPES = ['contract', 'quote', 'invoice', 'proposal', 'other']
const DOCUMENT_STATUSES = ['draft', 'sent', 'signed', 'expired']
const TASK_CYCLE = { todo: 'in_progress', in_progress: 'done', done: 'todo' }

// Every status/priority value across budget items, vendors, milestones,
// tasks, runsheet items and documents maps onto one of five shared tones
// (reusing the same success/warning/danger palette as `.rd-status-chip`)
// rather than inventing a bespoke color per value.
const TONE = {
  pending: 'warn', paid: 'ok', cancelled: 'fail',
  prospect: 'neutral', shortlisted: 'info', contracted: 'warn',
  not_started: 'neutral', in_progress: 'info', done: 'ok', todo: 'neutral',
  low: 'neutral', normal: 'info', high: 'fail',
  upcoming: 'neutral',
  draft: 'neutral', sent: 'info', signed: 'ok', expired: 'fail',
}

function Badge({ value }) {
  if (!value) return null
  return <span className={`pl-badge pl-badge-${TONE[value] || 'neutral'}`}>{String(value).replace(/_/g, ' ')}</span>
}

function money(value, currency = 'USD') {
  const n = Number(value || 0)
  try { return n.toLocaleString(undefined, { style: 'currency', currency }) }
  catch { return `$${n.toFixed(2)}` }
}

function fmtDate(value) {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString()
}

function daysUntil(value) {
  if (!value) return Infinity
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return Infinity
  return Math.ceil((d.getTime() - Date.now()) / 86400000)
}

function zonedLocalToIso(value, timeZone) {
  if (!value) return null
  const guess = new Date(`${value}:00Z`)
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(guess).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  const represented = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute)
  return new Date(guess.getTime() - (represented - guess.getTime())).toISOString()
}

function isoToZonedLocal(value, timeZone) {
  if (!value) return ''
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value)).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

export default function PlannerRedesignPage() {
  const [eventId, setEventId] = useCurrentEvent()
  const { event, loading: eventLoading } = useEventDetails(eventId)
  const [tab, setTab] = useState('Portfolio')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [confirmAction, setConfirmAction] = useState(null)
  const [modal, setModal] = useState(null) // { type, draft }

  const [dashboard, setDashboard] = useState(null)
  const [plannerAccess, setPlannerAccess] = useState(null)
  const [portfolioEvents, setPortfolioEvents] = useState([])
  const [budget, setBudget] = useState(null)
  const [budgetForm, setBudgetForm] = useState({ total_budget: '', currency: 'USD', notes: '' })
  const [vendors, setVendors] = useState([])
  const [vendorsLoaded, setVendorsLoaded] = useState(false)
  const [vendorDetail, setVendorDetail] = useState(null)
  const [procurement, setProcurement] = useState({ quotes: [], change_orders: [] })
  const [allocationDrafts, setAllocationDrafts] = useState({})
  const [paymentDraft, setPaymentDraft] = useState({ label: '', amount: '', due_at: '', method: '' })
  const [milestones, setMilestones] = useState([])
  const [coreTasks, setCoreTasks] = useState([])
  const [taskAssignees, setTaskAssignees] = useState([])
  const [openMilestones, setOpenMilestones] = useState(() => new Set())
  const [runsheet, setRunsheet] = useState([])
  const [documents, setDocuments] = useState([])
  const [uploadForm, setUploadForm] = useState({ file: null, name: '', type: 'contract', vendor_id: '', expires_at: '' })
  const [quoteDraft, setQuoteDraft] = useState({ vendor: '', price: '' })
  const tabCapability = { Budget: 'budget', Vendors: 'vendors', Procurement: 'vendors', Timeline: 'tasks', Runsheet: 'runsheet', Documents: 'documents' }[tab]
  const canManageTab = !tabCapability || plannerAccess?.role === 'admin' || (plannerAccess?.capabilities || []).includes(tabCapability)

  function notify(msg) {
    setToast(msg)
    window.setTimeout(() => setToast(''), 2600)
  }

  function fail(e, fallback) {
    setError(e?.message || fallback)
  }

  function askDelete(title, message, action, result) {
    setConfirmAction({ title, message, label: 'Delete', action, result })
  }

  async function loadVendors() {
    if (!eventId) return
    try { setVendors(await api.plannerListVendors(eventId)); setVendorsLoaded(true) }
    catch (e) { fail(e, 'Vendors could not be loaded') }
  }

  async function loadDashboard() {
    if (!eventId) return
    setLoading(true)
    try {
      const [summary, tasks] = await Promise.all([api.plannerDashboard(eventId), api.listTasks(eventId)])
      const now = Date.now()
      const weekOut = now + (7 * 86400000)
      const canonical = tasks.filter((task) => task.planner_milestone_id && task.status !== 'done' && task.due_date)
      const merged = {
        ...summary,
        overdue_tasks: [...(summary.overdue_tasks || []), ...canonical.filter((task) => new Date(task.due_date).getTime() < now)],
        tasks_due_this_week: [...(summary.tasks_due_this_week || []), ...canonical.filter((task) => {
          const due = new Date(task.due_date).getTime()
          return due >= now && due <= weekOut
        })],
      }
      setDashboard(merged)
      setPlannerAccess({ role: summary.role, capabilities: summary.capabilities || [] })
      setError('')
    }
    catch (e) { fail(e, 'Dashboard could not be loaded') }
    finally { setLoading(false) }
  }

  async function loadPortfolio() {
    setLoading(true)
    try {
      const events = (await api.listEvents()).filter((candidate) => candidate.planner_enabled)
      const summaries = await Promise.all(events.map(async (candidate) => {
        try {
          const [summary, tasks] = await Promise.all([
            api.plannerDashboard(candidate.id), api.listTasks(candidate.id),
          ])
          const now = Date.now()
          const canonicalOverdue = tasks.filter((task) => task.planner_milestone_id && task.status !== 'done' && task.due_date && new Date(task.due_date).getTime() < now)
          const overdue = (summary.overdue_tasks || []).length + canonicalOverdue.length
          const milestoneCompletion = summary.milestones_total ? summary.milestones_done / summary.milestones_total : 0
          const deductions = {
            budget: summary.budget_total <= 0 ? 10 : summary.budget_remaining < 0 ? 20 : 0,
            overdue: Math.min(25, overdue * 5),
            documents: (summary.documents_expiring_soon || []).length ? 10 : 0,
            vendors: (summary.vendor_counts.prospect || 0) + (summary.vendor_counts.shortlisted || 0) > 0 ? 5 : 0,
            milestones: Math.round((1 - milestoneCompletion) * 25),
            runsheet: summary.next_runsheet_item ? 0 : 10,
          }
          return { ...candidate, summary, overdue, readiness: Math.max(0, 100 - Object.values(deductions).reduce((sum, value) => sum + value, 0)), deductions }
        } catch (loadError) {
          return { ...candidate, readiness: null, loadError: loadError.message }
        }
      }))
      summaries.sort((left, right) => (left.readiness ?? 101) - (right.readiness ?? 101) || new Date(left.event_date) - new Date(right.event_date))
      setPortfolioEvents(summaries)
      setError('')
    } catch (e) { fail(e, 'Planner portfolio could not be loaded') }
    finally { setLoading(false) }
  }

  async function loadBudget() {
    if (!eventId) return
    setLoading(true)
    try { setBudget(await api.plannerGetBudget(eventId)); setError('') }
    catch (e) { fail(e, 'Budget could not be loaded') }
    finally { setLoading(false) }
  }

  async function loadVendorsList() {
    if (!eventId) return
    setLoading(true)
    try { setVendors(await api.plannerListVendors(eventId)); setVendorsLoaded(true); setError('') }
    catch (e) { fail(e, 'Vendors could not be loaded') }
    finally { setLoading(false) }
  }

  async function loadProcurement() {
    if (!eventId) return
    setLoading(true)
    try {
      const [board, vendorRows] = await Promise.all([api.plannerProcurement(eventId), api.plannerListVendors(eventId)])
      setProcurement(board); setPlannerAccess({ role: board.role, capabilities: board.capabilities || [] }); setVendors(vendorRows); setVendorsLoaded(true); setError('')
    } catch (e) { fail(e, 'Procurement board could not be loaded') }
    finally { setLoading(false) }
  }

  async function loadMilestones() {
    if (!eventId) return
    setLoading(true)
    try {
      const [nextMilestones, nextTasks, nextAssignees] = await Promise.all([
        api.plannerListMilestones(eventId), api.listTasks(eventId), api.listTaskAssignees(eventId),
      ])
      setMilestones(nextMilestones)
      setCoreTasks(nextTasks.filter((task) => task.planner_milestone_id))
      setTaskAssignees(nextAssignees)
      setError('')
    }
    catch (e) { fail(e, 'Timeline could not be loaded') }
    finally { setLoading(false) }
  }

  async function loadRunsheet() {
    if (!eventId) return
    setLoading(true)
    try { setRunsheet(await api.plannerListRunsheet(eventId)); setError('') }
    catch (e) { fail(e, 'Runsheet could not be loaded') }
    finally { setLoading(false) }
  }

  async function loadDocuments() {
    if (!eventId) return
    setLoading(true)
    try { setDocuments(await api.plannerListDocuments(eventId)); setError('') }
    catch (e) { fail(e, 'Documents could not be loaded') }
    finally { setLoading(false) }
  }

  useEffect(() => {
    if (tab === 'Portfolio') { loadPortfolio(); return }
    if (!eventId) return
    setError('')
    if (tab === 'Dashboard') loadDashboard()
    else if (tab === 'Budget') { loadBudget(); if (!vendorsLoaded) loadVendors() }
    else if (tab === 'Vendors') loadVendorsList()
    else if (tab === 'Procurement') loadProcurement()
    else if (tab === 'Timeline') loadMilestones()
    else if (tab === 'Runsheet') loadRunsheet()
    else if (tab === 'Documents') { loadDocuments(); if (!vendorsLoaded) loadVendors() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, eventId])

  useEffect(() => {
    if (!eventId) { setPlannerAccess(null); return }
    let active = true
    api.plannerDashboard(eventId).then((summary) => {
      if (active) setPlannerAccess({ role: summary.role, capabilities: summary.capabilities || [] })
    }).catch(() => { if (active) setPlannerAccess(null) })
    return () => { active = false }
  }, [eventId])

  useEffect(() => {
    if (budget) setBudgetForm({ total_budget: budget.total_budget ?? '', currency: budget.currency || 'USD', notes: budget.notes || '' })
  }, [budget])

  function openModal(type, draft = {}) { setModal({ type, draft }) }
  function closeModal() { setModal(null) }
  function setDraft(patch) { setModal((m) => m && ({ ...m, draft: { ...m.draft, ...patch } })) }

  async function saveBudgetTotal() {
    try {
      const saved = await api.plannerSaveBudget(eventId, {
        total_budget: Number(budgetForm.total_budget) || 0,
        currency: budgetForm.currency || 'USD',
        notes: budgetForm.notes,
      })
      setBudget(saved)
      notify('Budget saved')
    } catch (e) { notify(e.message || 'Budget could not be saved') }
  }

  async function submitCategory() {
    const { id, name, allocated, color, sort_order } = modal.draft
    const body = { name, allocated: Number(allocated) || 0, color: color || '#b6672f', sort_order: Number(sort_order) || 0 }
    try {
      if (id) await api.plannerUpdateCategory(eventId, id, body)
      else await api.plannerAddCategory(eventId, body)
      await loadBudget()
      closeModal()
      notify(id ? 'Category updated' : 'Category added')
    } catch (e) { notify(e.message || 'Category could not be saved') }
  }

  function confirmDeleteCategory(cat) {
    askDelete('Delete category?', `Delete "${cat.name}" and its budget items?`, async () => { await api.plannerDeleteCategory(eventId, cat.id); await loadBudget() }, 'Category deleted')
  }

  async function submitItem() {
    const { id, category_id, name, estimated, actual, status, notes, vendor_id, vendor_quotes } = modal.draft
    const body = { name, estimated: Number(estimated) || 0, actual: actual === '' || actual == null ? null : Number(actual), status: status || 'pending', notes, vendor_id: vendor_id || null, vendor_quotes: vendor_quotes && Object.keys(vendor_quotes).length ? vendor_quotes : null }
    try {
      if (id) await api.plannerUpdateBudgetItem(eventId, id, body)
      else await api.plannerAddBudgetItem(eventId, category_id, body)
      await loadBudget()
      closeModal()
      notify(id ? 'Item updated' : 'Item added')
    } catch (e) { notify(e.message || 'Item could not be saved') }
  }

  function confirmDeleteItem(item) {
    askDelete('Delete item?', `Delete "${item.name}"?`, async () => { await api.plannerDeleteBudgetItem(eventId, item.id); await loadBudget() }, 'Item deleted')
  }

  async function submitVendor() {
    const { id, name, category, status, contact_name, contact_email, contact_phone, website, contract_url, contract_expires_at, agreed_amount, deposit_amount, deposit_due_at, rating, notes } = modal.draft
    const body = {
      name, category, status: status || 'prospect', contact_name, contact_email, contact_phone, website, contract_url,
      contract_expires_at: contract_expires_at || null,
      agreed_amount: agreed_amount === '' || agreed_amount == null ? null : Number(agreed_amount),
      deposit_amount: deposit_amount === '' || deposit_amount == null ? null : Number(deposit_amount),
      deposit_due_at: deposit_due_at || null,
      rating: rating === '' || rating == null ? null : Number(rating),
      notes,
    }
    try {
      if (id) await api.plannerUpdateVendor(eventId, id, body)
      else await api.plannerCreateVendor(eventId, body)
      await loadVendorsList()
      closeModal()
      notify(id ? 'Vendor updated' : 'Vendor added')
    } catch (e) { notify(e.message || 'Vendor could not be saved') }
  }

  function confirmDeleteVendor(vendor) {
    askDelete('Delete vendor?', `Delete "${vendor.name}"? This cannot be undone.`, async () => {
      await api.plannerDeleteVendor(eventId, vendor.id)
      setVendorDetail(null)
      await loadVendorsList()
    }, 'Vendor deleted')
  }

  async function openVendorDetail(vendorId) {
    try { setVendorDetail(await api.plannerGetVendor(eventId, vendorId)) }
    catch (e) { notify(e.message || 'Vendor could not be loaded') }
  }

  async function addPayment() {
    try {
      await api.plannerAddVendorPayment(eventId, vendorDetail.id, { ...paymentDraft, amount: Number(paymentDraft.amount) || 0 })
      setVendorDetail(await api.plannerGetVendor(eventId, vendorDetail.id))
      setPaymentDraft({ label: '', amount: '', due_at: '', method: '' })
      notify('Payment added')
    } catch (e) { notify(e.message || 'Payment could not be added') }
  }

  async function markPaymentPaid(payment) {
    try {
      await api.plannerUpdateVendorPayment(eventId, vendorDetail.id, payment.id, { paid_at: payment.paid_at ? null : new Date().toISOString() })
      setVendorDetail(await api.plannerGetVendor(eventId, vendorDetail.id))
      notify(payment.paid_at ? 'Payment marked unpaid' : 'Payment marked paid')
    } catch (e) { notify(e.message || 'Payment could not be updated') }
  }

  async function submitMilestone() {
    const { id, title, description, due_at, status, sort_order } = modal.draft
    const body = { title, description, due_at: due_at || null, status: status || 'not_started', sort_order: Number(sort_order) || 0 }
    try {
      if (id) await api.plannerUpdateMilestone(eventId, id, body)
      else await api.plannerCreateMilestone(eventId, body)
      await loadMilestones()
      closeModal()
      notify(id ? 'Milestone updated' : 'Milestone added')
    } catch (e) { notify(e.message || 'Milestone could not be saved') }
  }

  function confirmDeleteMilestone(ms) {
    const linkedCoreTasks = coreTasks.filter((task) => task.planner_milestone_id === ms.id)
    askDelete('Delete milestone?', `Delete "${ms.title}" and its tasks?`, async () => {
      await Promise.all(linkedCoreTasks.map((task) => api.deleteTask(eventId, task.id)))
      await api.plannerDeleteMilestone(eventId, ms.id)
      await loadMilestones()
    }, 'Milestone deleted')
  }

  async function submitTask() {
    const { id, source, milestone_id, title, assignee_user_id, due_at, priority, status, notes, vendor_id, updated_at } = modal.draft
    const body = {
      title, notes, assignee_user_id: assignee_user_id || null,
      due_date: due_at ? `${due_at.slice(0, 10)}T23:59:00` : null,
      planner_milestone_id: milestone_id,
      planner_vendor_id: vendor_id || null,
      priority: priority || 'normal',
    }
    try {
      if (id && source === 'legacy') {
        await api.plannerUpdateTask(eventId, id, {
          milestone_id, title, assigned_to: taskAssignees.find((person) => person.id === assignee_user_id)?.name || null,
          due_at: due_at || null, priority: priority || 'normal', status: status || 'todo', notes,
          vendor_id: vendor_id || null,
        })
      } else if (id) {
        const saved = await api.updateTask(eventId, id, body, updated_at)
        if (saved.status !== status) {
          if (status === 'done') await api.completeTask(eventId, id)
          else if (status === 'in_progress') await api.startTask(eventId, id)
          else await api.reopenTask(eventId, id)
        }
      } else {
        const saved = await api.createTask(eventId, body)
        if (status === 'done') await api.completeTask(eventId, saved.id)
        else if (status === 'in_progress') await api.startTask(eventId, saved.id)
      }
      await loadMilestones()
      closeModal()
      notify(id ? 'Task updated' : 'Task added')
    } catch (e) { notify(e.message || 'Task could not be saved') }
  }

  function confirmDeleteTask(task) {
    askDelete('Delete task?', `Delete "${task.title}"?`, async () => {
      if (task.source === 'legacy') await api.plannerDeleteTask(eventId, task.id)
      else await api.deleteTask(eventId, task.id)
      await loadMilestones()
    }, 'Task deleted')
  }

  async function cycleTask(task) {
    try {
      if (task.source === 'legacy') await api.plannerUpdateTask(eventId, task.id, { status: TASK_CYCLE[task.status] || 'todo' })
      else if (task.status === 'open') await api.startTask(eventId, task.id)
      else if (task.status === 'in_progress') await api.completeTask(eventId, task.id)
      else await api.reopenTask(eventId, task.id)
      await loadMilestones()
    }
    catch (e) { notify(e.message || 'Task could not be updated') }
  }

  async function submitRunsheet() {
    const { id, start_at, end_at, title, type, owner, location, dependency_id, cue, notes, status, version } = modal.draft
    const timezone = event?.timezone || 'UTC'
    const body = {
      start_time: start_at?.slice(11, 16), end_time: end_at?.slice(11, 16),
      start_at: zonedLocalToIso(start_at, timezone), end_at: zonedLocalToIso(end_at, timezone), timezone,
      title, type: type || 'other', owner, location: location || null,
      dependency_id: dependency_id || null, cue, notes, status: status || 'upcoming', version,
    }
    try {
      if (id) await api.plannerUpdateRunsheetItem(eventId, id, body)
      else await api.plannerCreateRunsheetItem(eventId, { ...body, sort_order: runsheet.length })
      await loadRunsheet()
      closeModal()
      notify(id ? 'Runsheet item updated' : 'Runsheet item added')
    } catch (e) { notify(e.message || 'Runsheet item could not be saved') }
  }

  function confirmDeleteRunsheet(item) {
    askDelete('Delete runsheet item?', `Delete "${item.title}"?`, async () => { await api.plannerDeleteRunsheetItem(eventId, item.id); await loadRunsheet() }, 'Runsheet item deleted')
  }

  async function moveRunsheet(idx, dir) {
    const next = [...runsheet]
    const swapIdx = idx + dir
    if (swapIdx < 0 || swapIdx >= next.length) return
    ;[next[idx], next[swapIdx]] = [next[swapIdx], next[idx]]
    setRunsheet(next)
    try { await api.plannerReorderRunsheet(eventId, next.map((item, i) => ({ id: item.id, sort_order: i }))); await loadRunsheet() }
    catch (e) { notify(e.message || 'Reorder failed'); await loadRunsheet() }
  }

  async function uploadDocument() {
    if (!uploadForm.file) { notify('Choose a file to upload'); return }
    const fd = new FormData()
    fd.append('file', uploadForm.file)
    fd.append('name', uploadForm.name || uploadForm.file.name)
    fd.append('type', uploadForm.type)
    if (uploadForm.vendor_id) fd.append('vendor_id', uploadForm.vendor_id)
    if (uploadForm.expires_at) fd.append('expires_at', uploadForm.expires_at)
    try {
      await api.plannerUploadDocument(eventId, fd)
      setUploadForm({ file: null, name: '', type: 'contract', vendor_id: '', expires_at: '' })
      await loadDocuments()
      notify('Document uploaded')
    } catch (e) { notify(e.message || 'Document could not be uploaded') }
  }

  async function submitDocumentEdit() {
    const { id, name, type, status, expires_at } = modal.draft
    try {
      await api.plannerUpdateDocument(eventId, id, { name, type, status, expires_at: expires_at || null })
      await loadDocuments()
      closeModal()
      notify('Document updated')
    } catch (e) { notify(e.message || 'Document could not be updated') }
  }

  async function submitQuote() {
    const { vendor_id, title, amount, currency, comparison_group, line_items, scope, valid_until, status } = modal.draft
    try {
      await api.plannerCreateQuote(eventId, vendor_id, {
        title, amount: Number(amount) || 0, currency: (currency || 'USD').toUpperCase(),
        comparison_group: comparison_group || vendors.find((vendor) => vendor.id === vendor_id)?.category || 'General',
        line_items: (line_items || []).filter((line) => line.item?.trim()).map((line) => ({ ...line, quantity: Number(line.quantity) || 1, unit_price: Number(line.unit_price) || 0 })), scope,
        valid_until: valid_until || null, status: status || 'draft',
      })
      await loadProcurement(); closeModal(); notify('Quote added')
    } catch (e) { notify(e.message || 'Quote could not be saved') }
  }

  async function submitChangeOrder() {
    const { vendor_id, quote_id, title, description, amount_delta } = modal.draft
    try {
      await api.plannerCreateChangeOrder(eventId, vendor_id, {
        quote_id: quote_id || null, title, description, amount_delta: Number(amount_delta) || 0,
      })
      await loadProcurement(); closeModal(); notify('Change order proposed')
    } catch (e) { notify(e.message || 'Change order could not be saved') }
  }

  async function decideQuote(quote, decision) {
    try { await api.plannerDecideQuote(eventId, quote.id, decision); await loadProcurement(); notify(`Quote ${decision}`) }
    catch (e) { notify(e.message || 'Quote decision failed') }
  }

  async function selectQuoteItem(groupName, itemKey, itemMeta, quote, line, quantity) {
    try {
      await api.plannerSelectQuoteItem(eventId, {
        comparison_group: groupName, item_key: itemKey, item_name: itemMeta.item,
        unit: itemMeta.unit === '—' ? '' : itemMeta.unit, quote_id: quote.id,
        vendor_id: quote.vendor_id, unit_price: Number(line.unit_price), quantity: Number(quantity) || 1,
      })
      await loadProcurement()
      notify(`Allocated ${quantity || 1} to ${vendorNameForNotice(quote.vendor_id)}`)
    } catch (e) { notify(e.message || 'Item could not be selected') }
  }

  async function clearQuoteItemSelection(selectionId) {
    try { await api.plannerClearQuoteItemSelection(eventId, selectionId); await loadProcurement(); notify('Allocation removed') }
    catch (e) { notify(e.message || 'Allocation could not be removed') }
  }

  async function setItemRequirement(groupName, itemKey, quantity) {
    if (!(Number(quantity) > 0)) return
    try { await api.plannerSetProcurementRequirement(eventId, { comparison_group: groupName, item_key: itemKey, required_quantity: Number(quantity) }); await loadProcurement() }
    catch (e) { notify(e.message || 'Required quantity could not be saved') }
  }

  function vendorNameForNotice(vendorId) {
    return vendors.find((vendor) => vendor.id === vendorId)?.name || 'vendor'
  }

  async function decideChangeOrder(change, decision) {
    try { await api.plannerDecideChangeOrder(eventId, change.id, decision); await loadProcurement(); notify(`Change order ${decision}`) }
    catch (e) { notify(e.message || 'Change-order decision failed') }
  }

  async function createVendorPortalLink(vendorId) {
    try {
      const result = await api.plannerCreateVendorPortalLink(eventId, vendorId)
      const url = `${window.location.origin}${result.url_path}`
      await navigator.clipboard.writeText(url)
      notify('Secure vendor link copied')
    } catch (e) { notify(e.message || 'Vendor link could not be created') }
  }

  function confirmDeleteDocument(doc) {
    askDelete('Delete document?', `Delete "${doc.name}"?`, async () => { await api.plannerDeleteDocument(eventId, doc.id); await loadDocuments() }, 'Document deleted')
  }

  function submitModal() {
    if (!modal) return
    if (modal.type === 'category') return submitCategory()
    if (modal.type === 'item') return submitItem()
    if (modal.type === 'vendor') return submitVendor()
    if (modal.type === 'quote') return submitQuote()
    if (modal.type === 'change-order') return submitChangeOrder()
    if (modal.type === 'milestone') return submitMilestone()
    if (modal.type === 'task') return submitTask()
    if (modal.type === 'runsheet') return submitRunsheet()
    if (modal.type === 'document') return submitDocumentEdit()
    return undefined
  }

  function toggleMilestoneOpen(id) {
    setOpenMilestones((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  function renderPortfolio() {
    const scored = portfolioEvents.filter((item) => item.readiness !== null)
    const average = scored.length ? Math.round(scored.reduce((sum, item) => sum + item.readiness, 0) / scored.length) : 0
    const atRisk = scored.filter((item) => item.readiness < 70).length
    return (
      <>
        <div className="pl-portfolio-summary">
          <div className="rr-panel pl-card"><div className="rd-panel-body"><span className="rd-rowlink">Planner events</span><div className="pl-figure">{portfolioEvents.length}</div></div></div>
          <div className="rr-panel pl-card"><div className="rd-panel-body"><span className="rd-rowlink">Average readiness</span><div className="pl-figure">{average}%</div></div></div>
          <div className="rr-panel pl-card"><div className="rd-panel-body"><span className="rd-rowlink">At risk</span><div className="pl-figure">{atRisk}</div></div></div>
          <div className="rr-panel pl-card"><div className="rd-panel-body"><span className="rd-rowlink">Overdue work</span><div className="pl-figure">{scored.reduce((sum, item) => sum + item.overdue, 0)}</div></div></div>
        </div>
        <div className="pl-portfolio-grid">
          {portfolioEvents.map((item) => {
            const risks = item.deductions ? Object.entries(item.deductions).filter(([, points]) => points > 0) : []
            return (
              <article key={item.id} className="rr-panel pl-portfolio-event">
                <div className="pl-portfolio-head">
                  <div><h3>{item.name}</h3><span className="rd-rowlink">{fmtDate(item.event_date)} · {item.timezone || 'UTC'}</span></div>
                  {item.readiness === null ? <Badge value="unavailable" /> : <div className={`pl-readiness ${item.readiness < 70 ? 'risk' : item.readiness < 85 ? 'watch' : 'ready'}`}>{item.readiness}%<small>ready</small></div>}
                </div>
                {item.loadError ? <div className="pl-error">{item.loadError}</div> : (
                  <>
                    <div className="pl-portfolio-metrics">
                      <span><strong>{item.overdue}</strong> overdue</span>
                      <span><strong>{(item.summary.documents_expiring_soon || []).length}</strong> expiring docs</span>
                      <span><strong>{money(item.summary.budget_remaining, item.summary.currency)}</strong> remaining</span>
                    </div>
                    <div className="pl-risk-list">
                      {risks.map(([risk, points]) => <span key={risk}>{risk.replace(/_/g, ' ')} −{points}</span>)}
                      {!risks.length && <span className="pl-all-clear">No readiness warnings</span>}
                    </div>
                  </>
                )}
                <button className="rr-btn primary" onClick={() => { setEventId(item.id); setTab('Dashboard') }}>Open event planner</button>
              </article>
            )
          })}
        </div>
        {!portfolioEvents.length && !loading && <div className="rr-panel pl-empty"><p>No Planner-enabled events are available to this account.</p></div>}
      </>
    )
  }

  function renderDashboard() {
    if (!dashboard) return null
    const pct = dashboard.budget_total ? Math.min(100, (dashboard.budget_actual / dashboard.budget_total) * 100) : 0
    const msPct = dashboard.milestones_total ? Math.round((dashboard.milestones_done / dashboard.milestones_total) * 100) : 0
    const vendorCounts = Object.entries(dashboard.vendor_counts || {})
    return (
      <div className="pl-dash-grid">
        <div className="rr-panel pl-card">
          <div className="rd-panel-head"><h3>Budget</h3></div>
          <div className="rd-panel-body">
            <div className="pl-figure">{money(dashboard.budget_remaining, dashboard.currency)}</div>
            <span className="rd-rowlink">Remaining of {money(dashboard.budget_total, dashboard.currency)}</span>
            <div className="rd-mini-bar" style={{ marginTop: 8 }}><i style={{ width: `${pct}%` }} /></div>
            <div className="pl-budget-subrow">
              <span>Estimated {money(dashboard.budget_estimated, dashboard.currency)}</span>
              <span>Actual {money(dashboard.budget_actual, dashboard.currency)}</span>
            </div>
          </div>
        </div>

        <div className="rr-panel pl-card">
          <div className="rd-panel-head"><h3>Vendors</h3></div>
          <div className="rd-panel-body">
            <div className="pl-badge-row">
              {vendorCounts.map(([status, count]) => (
                <span key={status} className={`pl-badge pl-badge-${TONE[status] || 'neutral'}`}>{status.replace(/_/g, ' ')}: {count}</span>
              ))}
              {vendorCounts.length === 0 && <p className="rd-rowlink">No vendors yet.</p>}
            </div>
          </div>
        </div>

        <div className="rr-panel pl-card">
          <div className="rd-panel-head"><h3>Milestones</h3></div>
          <div className="rd-panel-body">
            <div className="pl-figure">{dashboard.milestones_done || 0}/{dashboard.milestones_total || 0} done</div>
            <div className="rd-mini-bar" style={{ marginTop: 8 }}><i style={{ width: `${msPct}%` }} /></div>
          </div>
        </div>

        <div className="rr-panel pl-card">
          <div className="rd-panel-head"><h3>Next runsheet item</h3></div>
          <div className="rd-panel-body">
            {dashboard.next_runsheet_item ? (
              <div className="pl-runsheet-mini">
                <strong>{dashboard.next_runsheet_item.title}</strong>
                <span className="rd-rowlink">{dashboard.next_runsheet_item.start_time?.slice(0, 5)} – {dashboard.next_runsheet_item.end_time?.slice(0, 5)}</span>
              </div>
            ) : <p className="rd-rowlink">Nothing scheduled.</p>}
          </div>
        </div>

        <div className="rr-panel pl-card pl-card-wide">
          <div className="rd-panel-head"><h3>Tasks due this week</h3></div>
          <div className="rd-panel-body">
            {(dashboard.tasks_due_this_week || []).map((task) => (
              <div key={task.id} className="pl-list-row"><span>{task.title}</span><span className="rd-rowlink">{fmtDate(task.due_at)}</span></div>
            ))}
            {!(dashboard.tasks_due_this_week || []).length && <p className="rd-rowlink">Nothing due this week.</p>}
          </div>
        </div>

        <div className="rr-panel pl-card pl-card-wide pl-card-warn">
          <div className="rd-panel-head"><h3>Overdue tasks</h3></div>
          <div className="rd-panel-body">
            {(dashboard.overdue_tasks || []).map((task) => (
              <div key={task.id} className="pl-list-row pl-list-row-warn"><span>{task.title}</span><span>{fmtDate(task.due_at)}</span></div>
            ))}
            {!(dashboard.overdue_tasks || []).length && <p className="rd-rowlink">Nothing overdue.</p>}
          </div>
        </div>

        <div className="rr-panel pl-card pl-card-wide">
          <div className="rd-panel-head"><h3>Documents expiring soon</h3></div>
          <div className="rd-panel-body">
            {(dashboard.documents_expiring_soon || []).map((doc) => (
              <div key={doc.id} className="pl-list-row"><span>{doc.name}</span><span className="rd-rowlink">{fmtDate(doc.expires_at)}</span></div>
            ))}
            {!(dashboard.documents_expiring_soon || []).length && <p className="rd-rowlink">Nothing expiring soon.</p>}
          </div>
        </div>
      </div>
    )
  }

  function renderBudget() {
    if (!budget) return null
    return (
      <>
        <div className="rr-panel" style={{ marginBottom: 16 }}>
          <div className="rd-panel-head"><h3>Total budget</h3></div>
          <div className="rd-panel-body">
            <div className="rd-row2">
              <div style={{ flex: 1 }}>
                <label className="rd-field-label">Total budget</label>
                <input className="rd-field" type="number" value={budgetForm.total_budget} onChange={(e) => setBudgetForm((f) => ({ ...f, total_budget: e.target.value }))} />
              </div>
              <div style={{ flex: 1 }}>
                <label className="rd-field-label">Currency</label>
                <input className="rd-field" value={budgetForm.currency} onChange={(e) => setBudgetForm((f) => ({ ...f, currency: e.target.value }))} />
              </div>
            </div>
            <label className="rd-field-label">Notes</label>
            <textarea className="rd-field rr-textarea" rows={2} value={budgetForm.notes} onChange={(e) => setBudgetForm((f) => ({ ...f, notes: e.target.value }))} />
            <button className="rr-btn primary" onClick={saveBudgetTotal}>Save</button>
            <div className="pl-budget-totals">
              <span>Allocated {money(budget.total_allocated, budget.currency)}</span>
              <span>Estimated {money(budget.total_estimated, budget.currency)}</span>
              <span>Actual {money(budget.total_actual, budget.currency)}</span>
              <span>Remaining {money(budget.total_remaining, budget.currency)}</span>
            </div>
          </div>
        </div>

        <div className="rr-section-title">
          <h2>Categories</h2>
          <button onClick={() => openModal('category', { name: '', allocated: '', color: '#b6672f', sort_order: (budget.categories || []).length })}><Icon name="plus" size={13} /> Add category</button>
        </div>

        {(budget.categories || []).map((cat) => {
          const estTotal = (cat.items || []).reduce((s, i) => s + Number(i.estimated || 0), 0)
          const actTotal = (cat.items || []).reduce((s, i) => s + Number(i.actual || 0), 0)
          return (
            <div key={cat.id} className="rr-panel pl-cat-card">
              <div className="pl-cat-head">
                <span className="pl-swatch" style={{ background: cat.color || '#ccc' }} />
                <strong>{cat.name}</strong>
                <span className="rd-rowlink">Allocated {money(cat.allocated, budget.currency)} · Estimated {money(estTotal, budget.currency)} · Actual {money(actTotal, budget.currency)}</span>
                <div className="gr-actions">
                  <button className="rr-link-btn" onClick={() => { setQuoteDraft({ vendor: '', price: '' }); openModal('item', { category_id: cat.id, name: '', estimated: '', actual: '', status: 'pending', notes: '', vendor_id: '', vendor_quotes: {} }) }}><Icon name="plus" size={12} /> Add item</button>
                  <button className="rr-link-btn" onClick={() => openModal('category', { id: cat.id, name: cat.name, allocated: cat.allocated, color: cat.color || '#b6672f', sort_order: cat.sort_order })}>Edit</button>
                  <button className="rr-link-btn gr-danger-link" onClick={() => confirmDeleteCategory(cat)}>Delete</button>
                </div>
              </div>
              {(cat.items || []).length > 0 && (
                <table className="rr-table">
                  <thead><tr><th>Name</th><th>Estimated</th><th>Actual</th><th>Status</th><th>Notes</th><th /></tr></thead>
                  <tbody>
                    {cat.items.map((item) => (
                      <tr key={item.id}>
                        <td>{item.name}</td>
                        <td>{money(item.estimated, budget.currency)}</td>
                        <td>{item.actual != null ? money(item.actual, budget.currency) : '—'}</td>
                        <td><Badge value={item.status} /></td>
                        <td className="rd-rowlink pl-notes-cell">
                          {item.notes ? <span className="pl-notes-clamp" title={item.notes}>{item.notes}</span> : '—'}
                        </td>
                        <td className="gr-actions">
                          <button className="rr-link-btn" onClick={() => { setQuoteDraft({ vendor: '', price: '' }); openModal('item', { id: item.id, category_id: cat.id, name: item.name, estimated: item.estimated, actual: item.actual ?? '', status: item.status, notes: item.notes || '', vendor_id: item.vendor_id || '', vendor_quotes: { ...(item.vendor_quotes || {}) } }) }}>Edit</button>
                          <button className="rr-link-btn gr-danger-link" onClick={() => confirmDeleteItem(item)}>Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {!(cat.items || []).length && <div className="rd-panel-body"><p className="rd-rowlink">No items in this category yet.</p></div>}
              {(() => {
                const withQuotes = (cat.items || []).filter((i) => i.vendor_quotes && Object.keys(i.vendor_quotes).length)
                if (!withQuotes.length) return null
                const vendorTotals = {}
                withQuotes.forEach((i) => {
                  Object.entries(i.vendor_quotes).forEach(([v, p]) => {
                    if (p == null) return
                    vendorTotals[v] = (vendorTotals[v] || 0) + Number(p)
                  })
                })
                const vendors = Object.keys(vendorTotals).sort((a, b) => vendorTotals[a] - vendorTotals[b])
                return (
                  <div className="pl-compare-wrap">
                    <div className="pl-compare-head">
                      <strong>Vendor price comparison</strong>
                      <span className="rd-rowlink">Lowest quote per item is highlighted · vendors ordered cheapest overall first</span>
                    </div>
                    <div className="pl-compare-scroll">
                      <table className="rr-table pl-compare-table">
                        <thead>
                          <tr>
                            <th>Item</th>
                            {vendors.map((v) => <th key={v}>{v}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {withQuotes.map((item) => {
                            const quotes = item.vendor_quotes || {}
                            const priced = vendors.map((v) => quotes[v]).filter((p) => p != null).map(Number)
                            const min = priced.length ? Math.min(...priced) : null
                            return (
                              <tr key={item.id}>
                                <td>{item.name}</td>
                                {vendors.map((v) => {
                                  const price = quotes[v]
                                  const isMin = price != null && min != null && Number(price) === min
                                  return (
                                    <td key={v} className={isMin ? 'pl-compare-best' : ''}>
                                      {price != null ? money(price, budget.currency) : '—'}
                                    </td>
                                  )
                                })}
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })()}
            </div>
          )
        })}
        {!(budget.categories || []).length && <div className="rr-panel"><div className="rd-panel-body"><p className="rd-rowlink">No categories yet — add one to start tracking spend.</p></div></div>}
      </>
    )
  }

  function renderVendors() {
    return (
      <>
        <div className="rr-section-title">
          <h2>Vendors</h2>
          <button onClick={() => openModal('vendor', { name: '', category: '', status: 'prospect', contact_name: '', contact_email: '', contact_phone: '', website: '', contract_url: '', contract_expires_at: '', agreed_amount: '', deposit_amount: '', deposit_due_at: '', rating: '', notes: '' })}><Icon name="plus" size={13} /> Add vendor</button>
        </div>
        <div className="pl-vendor-grid">
          {vendors.map((v) => (
            <button key={v.id} className="rr-panel pl-vendor-card" onClick={() => openVendorDetail(v.id)}>
              <div className="pl-vendor-card-head"><strong>{v.name}</strong><Badge value={v.status} /></div>
              <span className="rd-rowlink">{v.category || 'Uncategorized'}{v.rating ? ` · ${'★'.repeat(v.rating)}` : ''}</span>
              <span className="rd-rowlink">{v.contact_name || v.contact_email || 'No contact on file'}</span>
            </button>
          ))}
        </div>
        {!vendors.length && <div className="rr-panel"><div className="rd-panel-body"><p className="rd-rowlink">No vendors yet.</p></div></div>}
      </>
    )
  }

  function renderProcurement() {
    const vendorName = (id) => vendors.find((vendor) => vendor.id === id)?.name || 'Unknown vendor'
    const quoteGroups = Object.entries((procurement.quotes || []).reduce((groups, quote) => {
      const key = (quote.comparison_group || vendorName(quote.vendor_id) || 'General').trim()
      ;(groups[key] ||= []).push(quote)
      return groups
    }, {}))
    return (
      <>
        <div className="rr-section-title">
          <div><h2>Quote comparison</h2><span className="rd-rowlink">Compare commercial offers and keep approvals auditable.</span></div>
          <div className="gr-actions">
            <button onClick={() => openModal('quote', { vendor_id: vendors[0]?.id || '', title: '', amount: '', currency: budget?.currency || 'USD', comparison_group: vendors[0]?.category || 'General', line_items: [{ item: '', unit: '', quantity: 1, unit_price: '', notes: '' }], scope: '', valid_until: '', status: 'submitted' })}><Icon name="plus" size={13}/> Add quote</button>
            <button onClick={() => openModal('change-order', { vendor_id: vendors[0]?.id || '', quote_id: '', title: '', description: '', amount_delta: '' })}><Icon name="plus" size={13}/> Change order</button>
          </div>
        </div>
        {quoteGroups.map(([groupName, groupQuotes]) => {
          const categoryVendors = vendors.filter((vendor) => (vendor.category || '').trim().toLowerCase() === groupName.toLowerCase())
          const groupVendorIds = [...new Set([...categoryVendors.map((vendor) => vendor.id), ...groupQuotes.map((quote) => quote.vendor_id)])]
          const latestByVendor = Object.fromEntries(groupVendorIds.map((vendorId) => [vendorId, groupQuotes.find((quote) => quote.vendor_id === vendorId)]))
          const itemKeys = []
          const itemMeta = {}
          groupQuotes.forEach((quote) => {
            const lines = quote.line_items?.length ? quote.line_items : [{ item: 'Total quote', unit: 'Package', quantity: 1, unit_price: quote.amount, notes: quote.scope }]
            lines.forEach((line) => {
              const key = `${line.item.trim().toLowerCase()}::${(line.unit || '').trim().toLowerCase()}`
              if (!itemMeta[key]) { itemKeys.push(key); itemMeta[key] = { item: line.item, unit: line.unit || '—' } }
            })
          })
          const stats = Object.fromEntries(groupVendorIds.map((vendorId) => [vendorId, { total: 0, priced: 0, wins: 0 }]))
          itemKeys.forEach((key) => {
            const prices = groupVendorIds.map((vendorId) => {
              const quote = latestByVendor[vendorId]
              const line = quote?.line_items?.find((entry) => `${entry.item.trim().toLowerCase()}::${(entry.unit || '').trim().toLowerCase()}` === key)
              const value = line ? Number(line.unit_price) : itemMeta[key].item === 'Total quote' && quote ? Number(quote.amount) : null
              if (value !== null) { stats[vendorId].total += value; stats[vendorId].priced += 1 }
              return [vendorId, value]
            }).filter(([, value]) => value !== null)
            const lowest = prices.length ? Math.min(...prices.map(([, value]) => value)) : null
            prices.forEach(([vendorId, value]) => { if (value === lowest) stats[vendorId].wins += 1 })
          })
          const groupSelections = (procurement.selections || []).filter((selection) => selection.comparison_group === groupName)
          const selectedTotal = groupSelections.reduce((sum, selection) => sum + (Number(selection.unit_price) * Number(selection.quantity || 1)), 0)
          return (
            <section key={groupName} className="rr-panel pl-quote-group">
              <div className="pl-quote-group-head"><div><span className="pl-eyebrow">Comparison group</span><h3>{groupName}</h3><span className="rd-rowlink">{groupVendorIds.length} vendors · {itemKeys.length} comparable items</span></div><div className="pl-blended-total"><small>Blended selection</small><strong>{money(selectedTotal, groupQuotes[0]?.currency || 'USD')}</strong><span>{groupSelections.length}/{itemKeys.length} items selected</span></div></div>
              <div className="pl-comparison-scroll"><table className="rr-table pl-matrix-table">
                <thead><tr><th className="pl-matrix-item">Item</th><th>Unit</th>{groupVendorIds.map((id) => <th key={id}>{vendorName(id)}<small>{latestByVendor[id]?.title || 'Awaiting quote'}</small></th>)}<th>Notes</th></tr></thead>
                <tbody>
                  {itemKeys.map((key) => {
                    const values = groupVendorIds.map((id) => {
                      const quote = latestByVendor[id]
                      const line = quote?.line_items?.find((entry) => `${entry.item.trim().toLowerCase()}::${(entry.unit || '').trim().toLowerCase()}` === key)
                      return line ? Number(line.unit_price) : itemMeta[key].item === 'Total quote' && quote ? Number(quote.amount) : null
                    }).filter((value) => value !== null)
                    const sorted = [...new Set(values)].sort((a, b) => a - b)
                    const lowest = sorted[0] ?? null
                    const highest = sorted[sorted.length - 1] ?? null
                    const middle = sorted[Math.floor((sorted.length - 1) / 2)] ?? null
                    const rowSelections = groupSelections.filter((selection) => selection.item_key === key)
                    const requirement = (procurement.requirements || []).find((entry) => entry.comparison_group === groupName && entry.item_key === key)
                    const requiredQuantity = Number(requirement?.required_quantity || 1)
                    const allocatedQuantity = rowSelections.reduce((sum, entry) => sum + Number(entry.quantity || 0), 0)
                    const allocationState = allocatedQuantity === requiredQuantity ? 'complete' : allocatedQuantity > requiredQuantity ? 'over' : 'under'
                    const notes = groupQuotes.flatMap((quote) => quote.line_items || []).find((line) => `${line.item.trim().toLowerCase()}::${(line.unit || '').trim().toLowerCase()}` === key)?.notes
                    return <tr key={key}><td className="pl-matrix-item"><strong>{itemMeta[key].item}</strong><label className="pl-required-qty">Required <input type="number" min="0.001" step="any" defaultValue={requiredQuantity} onBlur={(e) => setItemRequirement(groupName, key, e.target.value)}/></label><span className={`pl-allocation-state ${allocationState}`}>{allocatedQuantity}/{requiredQuantity} allocated</span></td><td>{itemMeta[key].unit}</td>{groupVendorIds.map((id) => {
                      const quote = latestByVendor[id]
                      const line = quote?.line_items?.find((entry) => `${entry.item.trim().toLowerCase()}::${(entry.unit || '').trim().toLowerCase()}` === key)
                      const value = line ? Number(line.unit_price) : itemMeta[key].item === 'Total quote' && quote ? Number(quote.amount) : null
                      const rank = value === null ? '' : sorted.length === 1 ? 'Only price' : value === lowest ? 'Lowest' : value === highest ? 'Highest' : value === middle ? 'Mid' : ''
                      const selected = rowSelections.find((entry) => entry.quote_id === quote?.id)
                      const draftKey = `${groupName}::${key}::${quote?.id}`
                      const allocationQty = allocationDrafts[draftKey] ?? selected?.quantity ?? 1
                      return <td key={id} className={`${value !== null && value === lowest ? 'pl-matrix-best' : ''} ${value !== null && value === highest ? 'pl-matrix-high' : ''} ${selected ? 'pl-matrix-selected' : ''}`}>{value === null ? '—' : <div className="pl-price-choice"><strong>{money(value, quote?.currency || 'USD')}</strong>{rank && <small>{rank}</small>}<div className="pl-allocation-controls"><input aria-label={`Quantity for ${vendorName(id)}`} type="number" min="0.001" step="any" value={allocationQty} onChange={(e) => setAllocationDrafts((current) => ({ ...current, [draftKey]: e.target.value }))}/><button onClick={() => line && selectQuoteItem(groupName, key, itemMeta[key], quote, line, allocationQty)}>{selected ? 'Update' : 'Allocate'}</button>{selected && <button className="remove" onClick={() => clearQuoteItemSelection(selected.id)}>×</button>}</div>{selected && <span>✓ {selected.quantity} allocated</span>}</div>}</td>
                    })}<td>{notes || '—'}</td></tr>
                  })}
                  <tr className="pl-matrix-summary"><td className="pl-matrix-item"><strong>Vendor summary</strong></td><td>Average / total</td>{groupVendorIds.map((id) => { const quote = latestByVendor[id]; const stat = stats[id]; const awards = groupSelections.filter((selection) => selection.vendor_id === id); const awardTotal = awards.reduce((sum, selection) => sum + Number(selection.unit_price) * Number(selection.quantity || 1), 0); return <td key={id}><strong>{stat.priced ? money(stat.total / stat.priced, quote?.currency || 'USD') : '—'}</strong><small>{money(quote?.amount || 0, quote?.currency || 'USD')} total · {stat.wins} lowest · {stat.priced}/{itemKeys.length} priced</small>{awards.length > 0 && <span className="pl-award-total">Selected: {awards.length} · {money(awardTotal, quote?.currency || 'USD')}</span>}</td> })}<td /></tr>
                </tbody>
              </table></div>
              <div className="pl-quote-decisions">{groupVendorIds.map((id) => { const quote = latestByVendor[id]; return <div key={id}><strong>{vendorName(id)}</strong>{quote ? <><Badge value={quote.status}/><span>{money(quote.amount, quote.currency)}</span>{quote.status === 'submitted' && procurement.role === 'admin' && <div className="gr-actions"><button className="rr-link-btn" onClick={() => decideQuote(quote, 'approved')}>Approve</button><button className="rr-link-btn gr-danger-link" onClick={() => decideQuote(quote, 'rejected')}>Reject</button></div>}</> : <span className="rd-rowlink">Awaiting quote</span>}</div> })}</div>
            </section>
          )
        })}
        {!quoteGroups.length && <div className="rr-panel"><div className="rd-panel-body"><p className="rd-rowlink">No quotes yet. Add competing quotes under the same comparison group, such as Catering or Photography.</p></div></div>}

        <div className="rr-section-title"><h2>Change orders</h2></div>
        <div className="pl-change-grid">
          {(procurement.change_orders || []).map((change) => (
            <article key={change.id} className="rr-panel pl-change-card">
              <div className="pl-vendor-card-head"><strong>{change.title}</strong><Badge value={change.status}/></div>
              <span className="rd-rowlink">{vendorName(change.vendor_id)} · {change.amount_delta >= 0 ? '+' : ''}{money(change.amount_delta, (procurement.quotes || []).find((quote) => quote.id === change.quote_id)?.currency || 'USD')}</span>
              <p>{change.description || 'No description supplied.'}</p>
              {change.status === 'proposed' && procurement.role === 'admin' && <div className="gr-actions"><button className="rr-btn primary" onClick={() => decideChangeOrder(change, 'approved')}>Approve</button><button className="rr-btn" onClick={() => decideChangeOrder(change, 'rejected')}>Reject</button></div>}
            </article>
          ))}
          {!(procurement.change_orders || []).length && <p className="rd-rowlink">No change orders.</p>}
        </div>

        <div className="rr-section-title"><div><h2>Vendor portal</h2><span className="rd-rowlink">Links expire after 30 days and expose only that vendor’s procurement records.</span></div></div>
        <div className="pl-vendor-grid">
          {vendors.map((vendor) => <div key={vendor.id} className="rr-panel pl-vendor-card"><strong>{vendor.name}</strong><span className="rd-rowlink">{vendor.contact_email || 'No email on file'}</span><button className="rr-btn" onClick={() => createVendorPortalLink(vendor.id)}>Copy secure portal link</button></div>)}
        </div>
      </>
    )
  }

  function renderTimeline() {
    return (
      <>
        <div className="rr-section-title">
          <h2>Milestones</h2>
          <button onClick={() => openModal('milestone', { title: '', description: '', due_at: '', status: 'not_started', sort_order: milestones.length })}><Icon name="plus" size={13} /> Add milestone</button>
        </div>
        {milestones.map((ms) => {
          const open = openMilestones.has(ms.id)
          const timelineTasks = [
            ...(ms.tasks || []).map((task) => ({ ...task, source: 'legacy' })),
            ...coreTasks.filter((task) => task.planner_milestone_id === ms.id).map((task) => ({
              ...task, source: 'core', due_at: task.due_date, assigned_to: task.assignee_name,
              vendor_id: task.planner_vendor_id,
            })),
          ]
          const completionPct = timelineTasks.length
            ? Math.round((timelineTasks.filter((task) => task.status === 'done').length / timelineTasks.length) * 100)
            : 0
          return (
            <div key={ms.id} className="rr-panel pl-ms-card">
              <div className="pl-ms-head" onClick={() => toggleMilestoneOpen(ms.id)}>
                <Icon name="chevrondown" size={14} className={open ? 'pl-chev pl-chev-open' : 'pl-chev'} />
                <strong>{ms.title}</strong>
                <Badge value={ms.status} />
                <span className="rd-rowlink">{fmtDate(ms.due_at)}</span>
                <div className="rd-mini-bar pl-ms-bar"><i style={{ width: `${completionPct}%` }} /></div>
                <div className="gr-actions" onClick={(e) => e.stopPropagation()}>
                  <button className="rr-link-btn" onClick={() => openModal('task', { source: 'core', milestone_id: ms.id, title: '', assignee_user_id: '', due_at: '', priority: 'normal', status: 'open', notes: '', vendor_id: '' })}><Icon name="plus" size={12} /> Add task</button>
                  <button className="rr-link-btn" onClick={() => openModal('milestone', { id: ms.id, title: ms.title, description: ms.description || '', due_at: ms.due_at || '', status: ms.status, sort_order: ms.sort_order })}>Edit</button>
                  <button className="rr-link-btn gr-danger-link" onClick={() => confirmDeleteMilestone(ms)}>Delete</button>
                </div>
              </div>
              {open && (
                <div className="rd-panel-body">
                  {timelineTasks.map((task) => (
                    <div key={task.id} className="pl-task-row">
                      <button className={`pl-badge pl-badge-${TONE[task.status] || 'neutral'}`} onClick={() => cycleTask(task)}>{task.status.replace(/_/g, ' ')}</button>
                      <span className="pl-task-title">{task.title}</span>
                      <Badge value={task.priority} />
                      <span className="rd-rowlink">{task.assigned_to || 'Unassigned'}</span>
                      <span className="rd-rowlink">{fmtDate(task.due_at)}</span>
                      <button className="rr-link-btn" onClick={() => openModal('task', { id: task.id, source: task.source, milestone_id: ms.id, title: task.title, assignee_user_id: task.assignee_user_id || taskAssignees.find((person) => person.name === task.assigned_to)?.id || '', due_at: task.due_at || '', priority: task.priority, status: task.status, notes: task.notes || '', vendor_id: task.vendor_id || '', updated_at: task.updated_at })}>Edit</button>
                      <button className="rr-link-btn gr-danger-link" onClick={() => confirmDeleteTask(task)}>Delete</button>
                    </div>
                  ))}
                  {!timelineTasks.length && <p className="rd-rowlink">No tasks yet.</p>}
                </div>
              )}
            </div>
          )
        })}
        {!milestones.length && <div className="rr-panel"><div className="rd-panel-body"><p className="rd-rowlink">No milestones yet.</p></div></div>}
      </>
    )
  }

  function renderRunsheet() {
    return (
      <>
        <div className="rr-section-title">
          <h2>Multi-day runsheet <small className="rd-rowlink">{event?.timezone || 'UTC'}</small></h2>
          <button onClick={() => openModal('runsheet', { start_at: `${event?.event_date?.slice(0, 10) || new Date().toISOString().slice(0, 10)}T09:00`, end_at: `${event?.event_date?.slice(0, 10) || new Date().toISOString().slice(0, 10)}T10:00`, title: '', type: 'program', owner: '', location: '', dependency_id: '', cue: '', notes: '', status: 'upcoming' })}><Icon name="plus" size={13} /> Add item</button>
        </div>
        <table className="rr-table">
          <thead><tr><th>Date &amp; time</th><th>Title</th><th>Type</th><th>Owner / location</th><th>Status</th><th /></tr></thead>
          <tbody>
            {runsheet.map((item, idx) => (
              <tr key={item.id}>
                <td>{item.start_at ? `${fmtDate(item.start_at)} ${isoToZonedLocal(item.start_at, item.timezone).slice(11)} – ${isoToZonedLocal(item.end_at, item.timezone).slice(11)}` : `${item.start_time?.slice(0, 5)} – ${item.end_time?.slice(0, 5)}`}</td>
                <td>{item.title}{item.conflict_ids?.length ? <div className="pl-conflict">Schedule conflict</div> : null}</td>
                <td><Badge value={item.type} /></td>
                <td>{item.owner || '—'}{item.location ? <div className="rd-rowlink">{item.location}</div> : null}</td>
                <td><Badge value={item.status} /></td>
                <td className="gr-actions">
                  <button className="rr-link-btn" disabled={idx === 0} onClick={() => moveRunsheet(idx, -1)}>↑</button>
                  <button className="rr-link-btn" disabled={idx === runsheet.length - 1} onClick={() => moveRunsheet(idx, 1)}>↓</button>
                  <button className="rr-link-btn" onClick={() => openModal('runsheet', { id: item.id, start_at: item.start_at ? isoToZonedLocal(item.start_at, item.timezone) : `${event?.event_date?.slice(0, 10)}T${item.start_time?.slice(0, 5)}`, end_at: item.end_at ? isoToZonedLocal(item.end_at, item.timezone) : `${event?.event_date?.slice(0, 10)}T${item.end_time?.slice(0, 5)}`, title: item.title, type: item.type, owner: item.owner || '', location: item.location || '', dependency_id: item.dependency_id || '', cue: item.cue || '', notes: item.notes || '', status: item.status, version: item.version })}>Edit</button>
                  <button className="rr-link-btn gr-danger-link" onClick={() => confirmDeleteRunsheet(item)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!runsheet.length && <p className="rd-rowlink">No runsheet items yet.</p>}
      </>
    )
  }

  function renderDocuments() {
    return (
      <>
        <div className="rr-panel" style={{ marginBottom: 16 }}>
          <div className="rd-panel-head"><h3>Upload document</h3></div>
          <div className="rd-panel-body">
            <input type="file" onChange={(e) => setUploadForm((f) => ({ ...f, file: e.target.files?.[0] || null }))} />
            <div className="rd-row2" style={{ marginTop: 8 }}>
              <input className="rd-field" placeholder="Name" value={uploadForm.name} onChange={(e) => setUploadForm((f) => ({ ...f, name: e.target.value }))} />
              <select className="rd-field" value={uploadForm.type} onChange={(e) => setUploadForm((f) => ({ ...f, type: e.target.value }))}>
                {DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="rd-row2">
              <select className="rd-field" value={uploadForm.vendor_id} onChange={(e) => setUploadForm((f) => ({ ...f, vendor_id: e.target.value }))}>
                <option value="">No vendor</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
              <input className="rd-field" type="date" value={uploadForm.expires_at} onChange={(e) => setUploadForm((f) => ({ ...f, expires_at: e.target.value }))} />
            </div>
            <button className="rr-btn primary" disabled={!uploadForm.file} onClick={uploadDocument}>Upload</button>
          </div>
        </div>

        <table className="rr-table">
          <thead><tr><th>Name</th><th>Type</th><th>Status</th><th>Expires</th><th /></tr></thead>
          <tbody>
            {documents.map((doc) => {
              const expSoon = doc.expires_at && daysUntil(doc.expires_at) <= 30
              return (
                <tr key={doc.id}>
                  <td>{doc.file_url ? <button className="rr-link-btn pl-document-download" onClick={() => api.plannerDownloadDocument(eventId, doc.file_url, doc.name).catch((e) => notify(e.message || 'Document download failed'))}>{doc.name}</button> : doc.name}</td>
                  <td><Badge value={doc.type} /></td>
                  <td><Badge value={doc.status} /></td>
                  <td className={expSoon ? 'pl-expiring' : ''}>{fmtDate(doc.expires_at) || '—'}</td>
                  <td className="gr-actions">
                    <button className="rr-link-btn" onClick={() => openModal('document', { id: doc.id, name: doc.name, type: doc.type, status: doc.status, expires_at: doc.expires_at ? doc.expires_at.slice(0, 10) : '' })}>Edit</button>
                    <button className="rr-link-btn gr-danger-link" onClick={() => confirmDeleteDocument(doc)}>Delete</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!documents.length && <p className="rd-rowlink">No documents yet.</p>}
      </>
    )
  }

  function renderModal() {
    const { type, draft } = modal
    if (type === 'category') {
      return (
        <Modal title={draft.id ? 'Edit category' : 'Add category'} onClose={closeModal}>
          <label className="rd-field-label">Name</label>
          <input className="rd-field" value={draft.name} onChange={(e) => setDraft({ name: e.target.value })} />
          <div className="rd-row2">
            <div style={{ flex: 1 }}>
              <label className="rd-field-label">Allocated</label>
              <input className="rd-field" type="number" value={draft.allocated} onChange={(e) => setDraft({ allocated: e.target.value })} />
            </div>
            <div>
              <label className="rd-field-label">Color</label>
              <input className="rd-field" type="color" value={draft.color} onChange={(e) => setDraft({ color: e.target.value })} style={{ padding: 2, height: 34 }} />
            </div>
          </div>
          <button className="rr-btn primary" style={{ width: '100%', justifyContent: 'center' }} disabled={!draft.name?.trim()} onClick={submitModal}>Save</button>
        </Modal>
      )
    }
    if (type === 'item') {
      return (
        <Modal title={draft.id ? 'Edit item' : 'Add item'} onClose={closeModal}>
          <label className="rd-field-label">Name</label>
          <input className="rd-field" value={draft.name} onChange={(e) => setDraft({ name: e.target.value })} />
          <div className="rd-row2">
            <div style={{ flex: 1 }}><label className="rd-field-label">Estimated</label><input className="rd-field" type="number" value={draft.estimated} onChange={(e) => setDraft({ estimated: e.target.value })} /></div>
            <div style={{ flex: 1 }}><label className="rd-field-label">Actual</label><input className="rd-field" type="number" value={draft.actual} onChange={(e) => setDraft({ actual: e.target.value })} /></div>
          </div>
          <label className="rd-field-label">Status</label>
          <select className="rd-field" value={draft.status} onChange={(e) => setDraft({ status: e.target.value })}>
            {BUDGET_ITEM_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <label className="rd-field-label">Vendor</label>
          <select className="rd-field" value={draft.vendor_id} onChange={(e) => setDraft({ vendor_id: e.target.value })}>
            <option value="">No vendor</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <label className="rd-field-label">Vendor quotes <small style={{ fontWeight: 400 }}>(optional — powers the price comparison table)</small></label>
          {Object.entries(draft.vendor_quotes || {}).map(([vendorName, price]) => (
            <div className="rd-row2" key={vendorName} style={{ alignItems: 'center' }}>
              <span className="rd-field" style={{ flex: 1, background: 'transparent' }}>{vendorName}</span>
              <input
                className="rd-field" type="number" style={{ maxWidth: 120 }} value={price}
                onChange={(e) => setDraft({ vendor_quotes: { ...(draft.vendor_quotes || {}), [vendorName]: e.target.value } })}
              />
              <button type="button" className="rr-link-btn gr-danger-link" onClick={() => {
                const next = { ...(draft.vendor_quotes || {}) }; delete next[vendorName]; setDraft({ vendor_quotes: next })
              }}>Remove</button>
            </div>
          ))}
          <div className="rd-row2">
            <input className="rd-field" style={{ flex: 1 }} placeholder="Vendor name" value={quoteDraft.vendor} onChange={(e) => setQuoteDraft((q) => ({ ...q, vendor: e.target.value }))} />
            <input className="rd-field" type="number" style={{ maxWidth: 120 }} placeholder="Price" value={quoteDraft.price} onChange={(e) => setQuoteDraft((q) => ({ ...q, price: e.target.value }))} />
            <button
              type="button" className="rr-link-btn"
              disabled={!quoteDraft.vendor.trim() || quoteDraft.price === ''}
              onClick={() => {
                setDraft({ vendor_quotes: { ...(draft.vendor_quotes || {}), [quoteDraft.vendor.trim()]: Number(quoteDraft.price) } })
                setQuoteDraft({ vendor: '', price: '' })
              }}
            >Add quote</button>
          </div>
          <label className="rd-field-label">Notes</label>
          <textarea className="rd-field rr-textarea" rows={2} value={draft.notes} onChange={(e) => setDraft({ notes: e.target.value })} />
          <button className="rr-btn primary" style={{ width: '100%', justifyContent: 'center' }} disabled={!draft.name?.trim()} onClick={submitModal}>Save</button>
        </Modal>
      )
    }
    if (type === 'vendor') {
      return (
        <Modal title={draft.id ? 'Edit vendor' : 'Add vendor'} width={560} onClose={closeModal}>
          <div className="rd-row2">
            <div style={{ flex: 1 }}><label className="rd-field-label">Name</label><input className="rd-field" value={draft.name} onChange={(e) => setDraft({ name: e.target.value })} /></div>
            <div style={{ flex: 1 }}><label className="rd-field-label">Category</label><input className="rd-field" value={draft.category} onChange={(e) => setDraft({ category: e.target.value })} /></div>
          </div>
          <label className="rd-field-label">Status</label>
          <select className="rd-field" value={draft.status} onChange={(e) => setDraft({ status: e.target.value })}>
            {VENDOR_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <div className="rd-row2">
            <div style={{ flex: 1 }}><label className="rd-field-label">Contact name</label><input className="rd-field" value={draft.contact_name} onChange={(e) => setDraft({ contact_name: e.target.value })} /></div>
            <div style={{ flex: 1 }}><label className="rd-field-label">Contact email</label><input className="rd-field" value={draft.contact_email} onChange={(e) => setDraft({ contact_email: e.target.value })} /></div>
          </div>
          <div className="rd-row2">
            <div style={{ flex: 1 }}><label className="rd-field-label">Contact phone</label><input className="rd-field" value={draft.contact_phone} onChange={(e) => setDraft({ contact_phone: e.target.value })} /></div>
            <div style={{ flex: 1 }}><label className="rd-field-label">Website</label><input className="rd-field" value={draft.website} onChange={(e) => setDraft({ website: e.target.value })} /></div>
          </div>
          <div className="rd-row2">
            <div style={{ flex: 1 }}><label className="rd-field-label">Agreed amount</label><input className="rd-field" type="number" value={draft.agreed_amount} onChange={(e) => setDraft({ agreed_amount: e.target.value })} /></div>
            <div style={{ flex: 1 }}><label className="rd-field-label">Deposit amount</label><input className="rd-field" type="number" value={draft.deposit_amount} onChange={(e) => setDraft({ deposit_amount: e.target.value })} /></div>
          </div>
          <div className="rd-row2">
            <div style={{ flex: 1 }}><label className="rd-field-label">Contract expires</label><input className="rd-field" type="date" value={draft.contract_expires_at ? draft.contract_expires_at.slice(0, 10) : ''} onChange={(e) => setDraft({ contract_expires_at: e.target.value })} /></div>
            <div style={{ flex: 1 }}><label className="rd-field-label">Deposit due</label><input className="rd-field" type="date" value={draft.deposit_due_at ? draft.deposit_due_at.slice(0, 10) : ''} onChange={(e) => setDraft({ deposit_due_at: e.target.value })} /></div>
          </div>
          <div className="rd-row2">
            <div style={{ flex: 1 }}><label className="rd-field-label">Contract URL</label><input className="rd-field" placeholder="https://…" value={draft.contract_url || ''} onChange={(e) => setDraft({ contract_url: e.target.value })} /></div>
            <div style={{ flex: 1 }}>
              <label className="rd-field-label">Rating</label>
              <select className="rd-field" value={draft.rating ?? ''} onChange={(e) => setDraft({ rating: e.target.value })}>
                <option value="">Not rated</option>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{'★'.repeat(n)}</option>)}
              </select>
            </div>
          </div>
          <label className="rd-field-label">Notes</label>
          <textarea className="rd-field rr-textarea" rows={2} value={draft.notes} onChange={(e) => setDraft({ notes: e.target.value })} />
          <button className="rr-btn primary" style={{ width: '100%', justifyContent: 'center' }} disabled={!draft.name?.trim()} onClick={submitModal}>Save</button>
        </Modal>
      )
    }
    if (type === 'milestone') {
      return (
        <Modal title={draft.id ? 'Edit milestone' : 'Add milestone'} onClose={closeModal}>
          <label className="rd-field-label">Title</label>
          <input className="rd-field" value={draft.title} onChange={(e) => setDraft({ title: e.target.value })} />
          <label className="rd-field-label">Description</label>
          <textarea className="rd-field rr-textarea" rows={2} value={draft.description} onChange={(e) => setDraft({ description: e.target.value })} />
          <div className="rd-row2">
            <div style={{ flex: 1 }}><label className="rd-field-label">Due</label><input className="rd-field" type="date" value={draft.due_at ? draft.due_at.slice(0, 10) : ''} onChange={(e) => setDraft({ due_at: e.target.value })} /></div>
            <div style={{ flex: 1 }}>
              <label className="rd-field-label">Status</label>
              <select className="rd-field" value={draft.status} onChange={(e) => setDraft({ status: e.target.value })}>
                {MILESTONE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <button className="rr-btn primary" style={{ width: '100%', justifyContent: 'center' }} disabled={!draft.title?.trim()} onClick={submitModal}>Save</button>
        </Modal>
      )
    }
    if (type === 'quote') {
      const quoteTotal = (draft.line_items || []).reduce((sum, line) => sum + ((Number(line.quantity) || 0) * (Number(line.unit_price) || 0)), 0)
      return (
        <Modal title="Add comparable vendor quote" onClose={closeModal} width={900}>
          <div className="rd-row2"><div style={{ flex: 1 }}><label className="rd-field-label">Vendor</label><select className="rd-field" value={draft.vendor_id} onChange={(e) => { const selected = vendors.find((vendor) => vendor.id === e.target.value); setDraft({ vendor_id: e.target.value, comparison_group: selected?.category || draft.comparison_group }) }}>{vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select></div><div style={{ flex: 1 }}><label className="rd-field-label">Comparison group</label><input className="rd-field" placeholder="e.g. Catering" value={draft.comparison_group || ''} onChange={(e) => setDraft({ comparison_group: e.target.value })}/></div></div>
          <div className="rd-row2"><div style={{ flex: 2 }}><label className="rd-field-label">Quote title</label><input className="rd-field" placeholder="e.g. NCNMO catering menu" value={draft.title} onChange={(e) => setDraft({ title: e.target.value })}/></div><div style={{ flex: 1 }}><label className="rd-field-label">Currency</label><input className="rd-field" maxLength={3} value={draft.currency} onChange={(e) => setDraft({ currency: e.target.value.toUpperCase() })}/></div></div>
          <div className="pl-quote-lines-head"><strong>Comparable items</strong><span>Total: {money(quoteTotal, draft.currency || 'USD')}</span></div>
          <div className="pl-quote-lines">{(draft.line_items || []).map((line, index) => {
            const updateLine = (patch) => setDraft({ line_items: draft.line_items.map((entry, lineIndex) => lineIndex === index ? { ...entry, ...patch } : entry) })
            return <div className="pl-quote-line" key={index}><input className="rd-field" placeholder="Item, e.g. Jollof Rice" value={line.item} onChange={(e) => updateLine({ item: e.target.value })}/><input className="rd-field" placeholder="Unit, e.g. 1 tray" value={line.unit} onChange={(e) => updateLine({ unit: e.target.value })}/><input className="rd-field" type="number" min="0.01" step="any" placeholder="Qty" value={line.quantity} onChange={(e) => updateLine({ quantity: e.target.value })}/><input className="rd-field" type="number" min="0" step="any" placeholder="Unit price" value={line.unit_price} onChange={(e) => updateLine({ unit_price: e.target.value })}/><input className="rd-field" placeholder="Notes" value={line.notes || ''} onChange={(e) => updateLine({ notes: e.target.value })}/><button className="rr-link-btn gr-danger-link" disabled={draft.line_items.length === 1} onClick={() => setDraft({ line_items: draft.line_items.filter((_, lineIndex) => lineIndex !== index) })}>Remove</button></div>
          })}</div>
          <button className="rr-btn" onClick={() => setDraft({ line_items: [...(draft.line_items || []), { item: '', unit: '', quantity: 1, unit_price: '', notes: '' }] })}><Icon name="plus" size={12}/> Add item</button>
          <label className="rd-field-label">Scope and inclusions</label><textarea className="rd-field rr-textarea" rows={4} value={draft.scope} onChange={(e) => setDraft({ scope: e.target.value })}/>
          <div className="rd-row2"><div style={{ flex: 1 }}><label className="rd-field-label">Valid until</label><input className="rd-field" type="date" value={draft.valid_until} onChange={(e) => setDraft({ valid_until: e.target.value })}/></div><div style={{ flex: 1 }}><label className="rd-field-label">State</label><select className="rd-field" value={draft.status} onChange={(e) => setDraft({ status: e.target.value })}><option value="draft">Draft</option><option value="submitted">Submitted for approval</option></select></div></div>
          <button className="rr-btn primary" style={{ width: '100%', justifyContent: 'center' }} disabled={!draft.vendor_id || !draft.title?.trim() || !draft.comparison_group?.trim() || !(draft.line_items || []).some((line) => line.item?.trim())} onClick={submitModal}>Save quote</button>
        </Modal>
      )
    }
    if (type === 'change-order') {
      const vendorQuotes = (procurement.quotes || []).filter((quote) => quote.vendor_id === draft.vendor_id && quote.status === 'approved')
      return (
        <Modal title="Propose change order" onClose={closeModal}>
          <label className="rd-field-label">Vendor</label><select className="rd-field" value={draft.vendor_id} onChange={(e) => setDraft({ vendor_id: e.target.value, quote_id: '' })}>{vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select>
          <label className="rd-field-label">Related approved quote</label><select className="rd-field" value={draft.quote_id} onChange={(e) => setDraft({ quote_id: e.target.value })}><option value="">No related quote</option>{vendorQuotes.map((quote) => <option key={quote.id} value={quote.id}>{quote.title}</option>)}</select>
          <label className="rd-field-label">Title</label><input className="rd-field" value={draft.title} onChange={(e) => setDraft({ title: e.target.value })}/>
          <label className="rd-field-label">Contract adjustment</label><input className="rd-field" type="number" value={draft.amount_delta} onChange={(e) => setDraft({ amount_delta: e.target.value })}/>
          <label className="rd-field-label">Reason and scope change</label><textarea className="rd-field rr-textarea" rows={4} value={draft.description} onChange={(e) => setDraft({ description: e.target.value })}/>
          <button className="rr-btn primary" style={{ width: '100%', justifyContent: 'center' }} disabled={!draft.vendor_id || !draft.title?.trim()} onClick={submitModal}>Submit change order</button>
        </Modal>
      )
    }
    if (type === 'task') {
      return (
        <Modal title={draft.id ? 'Edit task' : 'Add task'} onClose={closeModal}>
          <label className="rd-field-label">Milestone</label>
          <select className="rd-field" value={draft.milestone_id} onChange={(e) => setDraft({ milestone_id: e.target.value })}>
            {milestones.map((ms) => <option key={ms.id} value={ms.id}>{ms.title}</option>)}
          </select>
          <label className="rd-field-label">Title</label>
          <input className="rd-field" value={draft.title} onChange={(e) => setDraft({ title: e.target.value })} />
          <div className="rd-row2">
            <div style={{ flex: 1 }}>
              <label className="rd-field-label">Assigned to</label>
              <select className="rd-field" value={draft.assignee_user_id || ''} onChange={(e) => setDraft({ assignee_user_id: e.target.value })}>
                <option value="">Unassigned</option>
                {taskAssignees.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.email}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}><label className="rd-field-label">Due</label><input className="rd-field" type="date" value={draft.due_at ? draft.due_at.slice(0, 10) : ''} onChange={(e) => setDraft({ due_at: e.target.value })} /></div>
          </div>
          <div className="rd-row2">
            <div style={{ flex: 1 }}>
              <label className="rd-field-label">Priority</label>
              <select className="rd-field" value={draft.priority} onChange={(e) => setDraft({ priority: e.target.value })}>
                {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label className="rd-field-label">Status</label>
              <select className="rd-field" value={draft.status} onChange={(e) => setDraft({ status: e.target.value })}>
                {(draft.source === 'legacy' ? TASK_STATUSES : ['open', 'in_progress', 'done']).map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
          </div>
          <label className="rd-field-label">Vendor</label>
          <select className="rd-field" value={draft.vendor_id} onChange={(e) => setDraft({ vendor_id: e.target.value })}>
            <option value="">No vendor</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <label className="rd-field-label">Notes</label>
          <textarea className="rd-field rr-textarea" rows={2} value={draft.notes} onChange={(e) => setDraft({ notes: e.target.value })} />
          <button className="rr-btn primary" style={{ width: '100%', justifyContent: 'center' }} disabled={!draft.title?.trim() || !draft.milestone_id} onClick={submitModal}>Save</button>
        </Modal>
      )
    }
    if (type === 'runsheet') {
      return (
        <Modal title={draft.id ? 'Edit runsheet item' : 'Add runsheet item'} onClose={closeModal}>
          <div className="rd-row2">
            <div style={{ flex: 1 }}><label className="rd-field-label">Start · {event?.timezone || 'UTC'}</label><input className="rd-field" type="datetime-local" value={draft.start_at || ''} onChange={(e) => setDraft({ start_at: e.target.value })} /></div>
            <div style={{ flex: 1 }}><label className="rd-field-label">End · {event?.timezone || 'UTC'}</label><input className="rd-field" type="datetime-local" value={draft.end_at || ''} onChange={(e) => setDraft({ end_at: e.target.value })} /></div>
          </div>
          <label className="rd-field-label">Title</label>
          <input className="rd-field" value={draft.title} onChange={(e) => setDraft({ title: e.target.value })} />
          <div className="rd-row2">
            <div style={{ flex: 1 }}>
              <label className="rd-field-label">Type</label>
              <select className="rd-field" value={draft.type} onChange={(e) => setDraft({ type: e.target.value })}>
                {RUNSHEET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}><label className="rd-field-label">Owner</label><input className="rd-field" value={draft.owner} onChange={(e) => setDraft({ owner: e.target.value })} /></div>
          </div>
          <div className="rd-row2">
            <div style={{ flex: 1 }}><label className="rd-field-label">Location / room</label><input className="rd-field" value={draft.location || ''} onChange={(e) => setDraft({ location: e.target.value })} /></div>
            <div style={{ flex: 1 }}>
              <label className="rd-field-label">Starts after</label>
              <select className="rd-field" value={draft.dependency_id || ''} onChange={(e) => setDraft({ dependency_id: e.target.value })}>
                <option value="">No dependency</option>
                {runsheet.filter((item) => item.id !== draft.id).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
              </select>
            </div>
          </div>
          <label className="rd-field-label">Status</label>
          <select className="rd-field" value={draft.status} onChange={(e) => setDraft({ status: e.target.value })}>
            {RUNSHEET_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <label className="rd-field-label">Cue</label>
          <input className="rd-field" value={draft.cue} onChange={(e) => setDraft({ cue: e.target.value })} />
          <label className="rd-field-label">Notes</label>
          <textarea className="rd-field rr-textarea" rows={2} value={draft.notes} onChange={(e) => setDraft({ notes: e.target.value })} />
          <button className="rr-btn primary" style={{ width: '100%', justifyContent: 'center' }} disabled={!draft.title?.trim() || !draft.start_at || !draft.end_at || draft.end_at <= draft.start_at} onClick={submitModal}>Save</button>
        </Modal>
      )
    }
    if (type === 'document') {
      return (
        <Modal title="Edit document" onClose={closeModal}>
          <label className="rd-field-label">Name</label>
          <input className="rd-field" value={draft.name} onChange={(e) => setDraft({ name: e.target.value })} />
          <label className="rd-field-label">Type</label>
          <select className="rd-field" value={draft.type} onChange={(e) => setDraft({ type: e.target.value })}>
            {DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <label className="rd-field-label">Status</label>
          <select className="rd-field" value={draft.status} onChange={(e) => setDraft({ status: e.target.value })}>
            {DOCUMENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <label className="rd-field-label">Expires</label>
          <input className="rd-field" type="date" value={draft.expires_at} onChange={(e) => setDraft({ expires_at: e.target.value })} />
          <button className="rr-btn primary" style={{ width: '100%', justifyContent: 'center' }} onClick={submitModal}>Save</button>
        </Modal>
      )
    }
    return null
  }

  if (eventId && tab !== 'Portfolio' && !eventLoading && !event?.planner_enabled) {
    return (
      <RedesignShell topActive="planner" withEventSidebar eventActive="planner">
        <div className="rr-pagehead">
          <div><div className="rr-title-row"><h1>Planner</h1></div></div>
        </div>
        <div className="rr-panel rr-locked">
          <div className="rd-panel-body">
            <span className="rr-locked-badge"><Icon name="lock" size={11} /> Not enabled</span>
            <h3 style={{ marginTop: 8 }}>Planner isn't turned on for this event</h3>
            <p className="rd-hint">Budget, vendors, timeline, runsheet and documents live here once the Planner add-on is enabled.</p>
            <a className="rr-btn primary rr-locked-cta" href="/communications-redesign?tab=settings">Enable Planner</a>
          </div>
        </div>
      </RedesignShell>
    )
  }

  return (
    <RedesignShell topActive="planner" withEventSidebar eventActive="planner">
      <div className="rr-pagehead">
        <div>
          <div className="rr-title-row"><h1>Planner</h1></div>
          <div className="rr-meta">Budget, vendors, timeline, runsheet & documents</div>
        </div>
      </div>

      {error && <div className="pl-error"><Icon name="info" size={14} /> {error}</div>}

      <div className="pl-tabs">
        {TABS.map((t) => <button key={t} className={`pl-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t}</button>)}
      </div>

      {loading && <p className="rd-hint">Loading…</p>}
      {!eventId && tab !== 'Portfolio' && <div className="rr-panel pl-empty"><p>Select an event to manage this planner area.</p></div>}
      {eventId && !canManageTab && <div className="rr-panel pl-readonly-note"><Icon name="lock" size={14}/><span><strong>View-only access</strong>You can review this planner area, but only an administrator can grant editing permission.</span></div>}
      <div className={canManageTab ? '' : 'pl-readonly'}>
        {tab === 'Portfolio' && renderPortfolio()}
        {tab === 'Dashboard' && renderDashboard()}
        {tab === 'Budget' && renderBudget()}
        {tab === 'Vendors' && renderVendors()}
        {tab === 'Procurement' && renderProcurement()}
        {tab === 'Timeline' && renderTimeline()}
        {tab === 'Runsheet' && renderRunsheet()}
        {tab === 'Documents' && renderDocuments()}
      </div>

      {vendorDetail && (
        <Modal title={vendorDetail.name} onClose={() => setVendorDetail(null)} width={620}>
          <div className="pl-vendor-detail">
            <div className="gr-actions" style={{ marginBottom: 10 }}>
              <Badge value={vendorDetail.status} />
              <button className="rr-link-btn" onClick={() => {
                const v = vendorDetail
                setVendorDetail(null)
                openModal('vendor', {
                  id: v.id, name: v.name, category: v.category || '', status: v.status,
                  contact_name: v.contact_name || '', contact_email: v.contact_email || '', contact_phone: v.contact_phone || '',
                  website: v.website || '', contract_url: v.contract_url || '',
                  contract_expires_at: v.contract_expires_at || '', deposit_due_at: v.deposit_due_at || '',
                  agreed_amount: v.agreed_amount ?? '', deposit_amount: v.deposit_amount ?? '', rating: v.rating ?? '', notes: v.notes || '',
                })
              }}>Edit</button>
              <button className="rr-link-btn gr-danger-link" onClick={() => confirmDeleteVendor(vendorDetail)}>Delete</button>
            </div>
            <div className="pl-vendor-detail-grid">
              <div><span className="rd-field-label">Category</span>{vendorDetail.category || '—'}</div>
              <div><span className="rd-field-label">Contact</span>{vendorDetail.contact_name || '—'}</div>
              <div><span className="rd-field-label">Email</span>{vendorDetail.contact_email || '—'}</div>
              <div><span className="rd-field-label">Phone</span>{vendorDetail.contact_phone || '—'}</div>
              <div><span className="rd-field-label">Agreed</span>{vendorDetail.agreed_amount != null ? money(vendorDetail.agreed_amount) : '—'}</div>
              <div><span className="rd-field-label">Deposit</span>{vendorDetail.deposit_amount != null ? money(vendorDetail.deposit_amount) : '—'}</div>
              <div><span className="rd-field-label">Rating</span>{vendorDetail.rating ? '★'.repeat(vendorDetail.rating) : '—'}</div>
              <div><span className="rd-field-label">Contract</span>{vendorDetail.contract_url ? <a className="rr-link-btn" href={vendorDetail.contract_url} target="_blank" rel="noreferrer">Open contract</a> : '—'}</div>
            </div>

            <h4>Payments</h4>
            {(vendorDetail.payments || []).map((p) => (
              <div key={p.id} className="pl-payment-row">
                <span>{p.label}</span><span>{money(p.amount)}</span><span className="rd-rowlink">{fmtDate(p.due_at)}</span>
                <span className={p.paid_at ? 'pl-badge pl-badge-ok' : 'pl-badge pl-badge-neutral'}>{p.paid_at ? 'paid' : 'unpaid'}</span>
                <button className="rr-link-btn" onClick={() => markPaymentPaid(p)}>{p.paid_at ? 'Mark unpaid' : 'Mark paid'}</button>
              </div>
            ))}
            {!(vendorDetail.payments || []).length && <p className="rd-rowlink">No payments recorded.</p>}

            <div className="ci-form-inset" style={{ marginTop: 12 }}>
              <div className="rd-row2">
                <input className="rd-field" placeholder="Label" value={paymentDraft.label} onChange={(e) => setPaymentDraft((f) => ({ ...f, label: e.target.value }))} />
                <input className="rd-field" type="number" placeholder="Amount" value={paymentDraft.amount} onChange={(e) => setPaymentDraft((f) => ({ ...f, amount: e.target.value }))} />
              </div>
              <div className="rd-row2">
                <input className="rd-field" type="date" value={paymentDraft.due_at} onChange={(e) => setPaymentDraft((f) => ({ ...f, due_at: e.target.value }))} />
                <input className="rd-field" placeholder="Method" value={paymentDraft.method} onChange={(e) => setPaymentDraft((f) => ({ ...f, method: e.target.value }))} />
              </div>
              <button className="rr-btn primary" disabled={!paymentDraft.label.trim() || !paymentDraft.amount} onClick={addPayment}>Add payment</button>
            </div>
          </div>
        </Modal>
      )}

      {modal && renderModal()}

      {toast && <div className="rd-toast"><Icon name="check" />{toast}</div>}
      {confirmAction && (
        <ConfirmDialog
          title={confirmAction.title}
          message={confirmAction.message}
          confirmLabel={confirmAction.label}
          danger
          onConfirm={async () => {
            try { await confirmAction.action?.(); if (confirmAction.result) notify(confirmAction.result) }
            catch (e) { setError(e.message || 'Action could not be completed') }
            finally { setConfirmAction(null) }
          }}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </RedesignShell>
  )
}
