const KEY = 'eq.experienceScannerQueue:v1'
const ADMISSION_KEY = 'eq.offlineAdmissions:v1'
const MANIFEST_PREFIX = 'eq.offlineManifest:v1:'

function readQueue() {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeQueue(items) {
  localStorage.setItem(KEY, JSON.stringify(items))
  window.dispatchEvent(new CustomEvent('experience-queue-change'))
}

export function experienceQueueCount() {
  return readQueue().length
}

export function enqueueExperienceStep(action) {
  const key = `${action.eventId}:${action.guestId}:${action.stepId}`
  const current = readQueue().filter((item) => item.key !== key)
  const item = {
    key,
    eventId: action.eventId,
    guestId: action.guestId,
    stepId: action.stepId,
    payload: action.payload,
    createdAt: new Date().toISOString(),
  }
  writeQueue([...current, item])
  return item
}

export async function drainExperienceQueue(api) {
  const queued = readQueue()
  if (!queued.length) return { sent: 0, remaining: 0 }
  const remaining = []
  let sent = 0
  for (const item of queued) {
    try {
      await api.updateGuestExperienceStep(item.eventId, item.guestId, item.stepId, item.payload)
      sent += 1
    } catch (error) {
      remaining.push(item)
    }
  }
  writeQueue(remaining)
  return { sent, remaining: remaining.length }
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
  window.dispatchEvent(new CustomEvent('offline-admission-change'))
}

export function saveOfflineManifest(eventId, manifest) {
  writeJson(`${MANIFEST_PREFIX}${eventId}`, manifest)
}

export function loadOfflineManifest(eventId) {
  return readJson(`${MANIFEST_PREFIX}${eventId}`, null)
}

function readAdmissions() {
  const parsed = readJson(ADMISSION_KEY, [])
  return Array.isArray(parsed) ? parsed : []
}

function writeAdmissions(items) {
  writeJson(ADMISSION_KEY, items)
}

export function offlineAdmissionCount() {
  return readAdmissions().length
}

export function enqueueOfflineAdmission(action) {
  const key = `${action.eventId}:${action.token}`
  const current = readAdmissions().filter((item) => item.key !== key)
  const item = {
    key,
    type: 'admission',
    eventId: action.eventId,
    token: action.token,
    guestId: action.guestId,
    guestName: action.guestName,
    createdAt: new Date().toISOString(),
  }
  writeAdmissions([...current, item])
  return item
}

export function enqueueOfflineAccessScan(action) {
  const item = {
    key: `${action.eventId}:${action.token}:${action.mode}:${action.gateId || action.zoneId}:${action.direction || ''}:${Date.now()}`,
    type: action.mode,
    eventId: action.eventId,
    token: action.token,
    guestId: action.guestId,
    guestName: action.guestName,
    gateId: action.gateId,
    zoneId: action.zoneId,
    direction: action.direction,
    createdAt: new Date().toISOString(),
  }
  writeAdmissions([...readAdmissions(), item])
  return item
}

export async function drainOfflineAdmissions(api) {
  const queued = readAdmissions()
  if (!queued.length) return { sent: 0, remaining: 0 }
  const remaining = []
  let sent = 0
  for (const item of queued) {
    try {
      if (item.type === 'gate') {
        await api.scanGate(item.eventId, item.gateId, item.token)
      } else if (item.type === 'zone') {
        await api.scanZone(item.token, { zone_id: item.zoneId, direction: item.direction })
      } else {
        await api.scan(item.token)
      }
      sent += 1
    } catch {
      remaining.push(item)
    }
  }
  writeAdmissions(remaining)
  return { sent, remaining: remaining.length }
}
