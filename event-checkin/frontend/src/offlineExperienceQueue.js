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

export function experienceQueueCount(eventId) {
  return readQueue().filter((item) => !eventId || item.eventId === eventId).length
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

let experienceDrain = null
export function drainExperienceQueue(api, eventId) {
  if (experienceDrain) return experienceDrain
  experienceDrain = drainSteps(api, eventId).finally(() => { experienceDrain = null })
  return experienceDrain
}

async function drainSteps(api, eventId) {
  const queued = readQueue().filter((item) => !eventId || item.eventId === eventId)
  let sent = 0
  for (const item of queued) {
    try {
      const response = await api.updateGuestExperienceStep(item.eventId, item.guestId, item.stepId, item.payload)
      if (!response) break
      writeQueue(readQueue().filter((current) => JSON.stringify(current) !== JSON.stringify(item)))
      sent += 1
    } catch { break }
  }
  return { sent, remaining: experienceQueueCount(eventId) }
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
  // A refresh must not erase admissions that have not reached the server yet.
  const pending = new Set(readAdmissions().filter((item) => item.eventId === eventId && item.type === 'admission').map((item) => item.token))
  const merged = { ...manifest, guests: (manifest.guests || []).map((guest) => pending.has(guest.qr_token) ? { ...guest, admitted: true, offline_pending: true } : guest) }
  writeJson(`${MANIFEST_PREFIX}${eventId}`, merged)
  return merged
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

export function offlineAdmissionItems(eventId) {
  return readAdmissions().filter((item) => !eventId || item.eventId === eventId)
}

export function offlineAdmissionCount(eventId) {
  return offlineAdmissionItems(eventId).length
}

export function offlineManifestStatus(manifest, eventId, now = Date.now()) {
  if (!manifest || manifest.event_id !== eventId || manifest.version !== 2) return { ready: false, message: 'Prepare this scanner while online.' }
  const expires = Date.parse(manifest.expires_at)
  if (!Number.isFinite(expires) || expires <= now) return { ready: false, message: 'Offline guest list expired. Reconnect and prepare this scanner again.' }
  if (manifest.event_status !== 'active') return { ready: false, message: 'This event is not active.' }
  if (manifest.offline_admission_block_reason) return { ready: false, message: manifest.offline_admission_block_reason }
  return { ready: true, message: 'Ready for offline general admission', expiresAt: expires }
}

export function searchOfflineGuests(eventId, query) {
  const manifest = loadOfflineManifest(eventId)
  const status = offlineManifestStatus(manifest, eventId)
  if (!status.ready) throw new Error(status.message)
  if (!manifest.manual_checkin_enabled) throw new Error('Manual check-in is disabled for this event.')
  const needle = query.trim().toLowerCase()
  if (needle.length < 2) return []
  return (manifest.guests || []).filter((g) => `${g.first_name} ${g.last_name} ${g.phone || ''}`.toLowerCase().includes(needle)).slice(0, 30).map((g) => ({ ...g, full_name: `${g.first_name} ${g.last_name}`.trim(), phone_masked: g.phone ? `•••${g.phone.slice(-4)}` : '' }))
}

export function enqueueOfflineAdmission(action) {
  const key = `${action.eventId}:${action.token}`
  const existing = readAdmissions().find((item) => item.key === key)
  if (existing) return existing
  const current = readAdmissions()
  const item = {
    key,
    type: 'admission',
    eventId: action.eventId,
    token: action.token,
    guestId: action.guestId,
    guestName: action.guestName,
    createdAt: new Date().toISOString(),
    syncStatus: 'pending',
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

let admissionDrain = null

// Serialize drains in this tab, and across tabs where Web Locks is available.
// Remove only an acknowledged item from the latest queue, never a stale snapshot.
export function drainOfflineAdmissions(api, eventId, { retryRejected = false } = {}) {
  if (admissionDrain) return admissionDrain
  const run = () => drainAdmissions(api, eventId, retryRejected)
  admissionDrain = (globalThis.navigator?.locks
    ? navigator.locks.request('festio-offline-admissions', run)
    : run()).finally(() => { admissionDrain = null })
  return admissionDrain
}

async function drainAdmissions(api, eventId, retryRejected) {
  const queued = offlineAdmissionItems(eventId)
  let sent = 0
  for (const item of queued) {
    if (!readAdmissions().some((current) => current.key === item.key)) continue
    if (item.syncStatus === 'needs_review' && !retryRejected) continue
    try {
      let response
      if (item.type === 'gate') {
        response = await api.scanGate(item.eventId, item.gateId, item.token)
      } else if (item.type === 'zone') {
        response = await api.scanZone(item.token, { zone_id: item.zoneId, direction: item.direction })
      } else {
        response = await api.scan(item.token)
      }
      const access = ['gate', 'zone'].includes(item.type)
      const accepted = access ? (response?.allowed === true || response?.status === 'ok') && !response?.denied && response?.allowed !== false : ['admitted', 'already_admitted'].includes(response?.status)
      if (!accepted) {
        writeAdmissions(readAdmissions().map((current) => current.key === item.key ? { ...current, syncStatus: 'needs_review', lastError: response?.message || response?.deny_reason || 'The server did not confirm this check-in.', lastAttemptAt: new Date().toISOString() } : current))
        continue
      }
      writeAdmissions(readAdmissions().filter((current) => current.key !== item.key))
      sent += 1
    } catch (error) {
      const rejected = error.status >= 400 && error.status < 500 && error.status !== 429
      writeAdmissions(readAdmissions().map((current) => current.key === item.key ? { ...current, syncStatus: rejected ? 'needs_review' : 'pending', lastError: error.message || 'Connection interrupted. Saved on this scanner.', lastAttemptAt: new Date().toISOString() } : current))
      // Stop on an outage/auth failure; preserve every remaining item for retry.
      if (!rejected || [401, 403].includes(error.status)) break
    }
  }
  return { sent, remaining: offlineAdmissionCount(eventId) }
}

function tagNames(manifest, matchedTagIds) {
  const tags = new Map((manifest.guest_tags || []).map((tag) => [tag.id, tag.name]))
  return matchedTagIds.map((tagId) => tags.get(tagId)).filter(Boolean)
}

function accessDecision(manifest, guest, zone, mode) {
  if (mode === 'gate') {
    const ruleTagIds = new Set(
      (manifest.zone_tag_rules || [])
        .filter((rule) => rule.zone_id === zone.id)
        .map((rule) => rule.tag_id),
    )
    if (ruleTagIds.size) {
      const guestTagIds = new Set(
        (manifest.guest_tag_links || [])
          .filter((link) => link.guest_id === guest.id)
          .map((link) => link.tag_id),
      )
      const matched = [...ruleTagIds].filter((tagId) => guestTagIds.has(tagId))
      if (!matched.length) return { allowed: false, reason: "Guest's tags don't permit this zone", matchedTags: [] }
      return { allowed: true, matchedTags: tagNames(manifest, matched) }
    }
  }
  if (mode === 'zone' && guest.ticket_type_id) {
    const ticket = (manifest.ticket_types || []).find((item) => item.id === guest.ticket_type_id)
    const allowedZones = ticket?.allowed_zone_ids
    if (Array.isArray(allowedZones) && allowedZones.length && !allowedZones.includes(zone.id)) {
      return { allowed: false, reason: `${ticket?.name || 'This'} ticket is not valid for this zone`, matchedTags: [] }
    }
  }
  return { allowed: true, matchedTags: [] }
}

/**
 * Evaluate and queue a scanner action using the server-issued offline manifest.
 * Returns the same display shape used by the live scanner plus the updated
 * manifest, so callers can immediately reflect admission/occupancy locally.
 */
export function recordOfflineScan({
  eventId,
  token,
  manifest,
  mode = 'admission',
  gateId = null,
  zoneId = null,
  direction = null,
}) {
  // Always prefer persisted state: React may not have rendered the previous scan.
  manifest = loadOfflineManifest(eventId) || manifest
  const safety = offlineManifestStatus(manifest, eventId)
  if (!safety.ready) return { result: { status: 'invalid', message: safety.message }, manifest }
  if (!manifest?.guests?.length) {
    return {
      result: {
        status: 'invalid',
        message: 'No offline guest list is cached for this event. Go online once on this scanner to prepare offline check-in.',
      },
      manifest,
    }
  }
  const guest = manifest.guests.find((item) => item.qr_token === token)
  if (!guest) return { result: { status: 'invalid', message: 'Offline guest list does not contain this QR code.' }, manifest }
  if (guest.rsvp_status === 'declined') return {
    result: { status: 'invalid', message: 'This pass was cancelled or revoked. Do not admit.', guest }, manifest,
  }

  if (mode === 'admission') {
    const rejected = offlineAdmissionItems(eventId).find((item) => item.token === token && item.syncStatus === 'needs_review')
    if (rejected) return { result: { status: 'invalid', message: `Earlier offline check-in needs staff review: ${rejected.lastError || 'The server did not confirm admission.'}`, guest }, manifest }
    if (guest.admitted) {
      return {
        result: {
          status: 'already_admitted',
          message: `${guest.first_name} ${guest.last_name} was already admitted in the cached guest list.`,
          guest,
          table_name: guest.table_name,
          seat_number: guest.seat_number,
        },
        manifest,
      }
    }
    if (guest.offline_admission_block_reason) return { result: { status: 'invalid', message: guest.offline_admission_block_reason, guest }, manifest }
    const admittedAt = new Date().toISOString()
    const nextManifest = {
      ...manifest,
      guests: manifest.guests.map((item) => item.qr_token === token
        ? { ...item, admitted: true, admitted_at: admittedAt }
        : item),
    }
    enqueueOfflineAdmission({
      eventId,
      token,
      guestId: guest.id,
      guestName: `${guest.first_name} ${guest.last_name}`.trim(),
    })
    saveOfflineManifest(eventId, nextManifest)
    return {
      manifest: nextManifest,
      result: {
        status: 'offline_queued',
        message: `${guest.first_name} ${guest.last_name} is checked in on this device. This admission will sync when online.`,
        guest: { ...guest, admitted: true, admitted_at: admittedAt },
        table_name: guest.table_name,
        seat_number: guest.seat_number,
      },
    }
  }

  if (manifest.junior_guardian_handoff_enabled) return { result: { status: 'invalid', message: 'Guardian handoffs require an online connection for authorization checks.' }, manifest }
  if (manifest.separate_admission_access_enabled && !guest.admitted) return { result: { status: 'invalid', message: 'Complete convention admission before entering a zone.' }, manifest }

  const gate = mode === 'gate'
    ? (manifest.gates || []).find((item) => item.id === gateId && item.is_active !== false)
    : null
  const resolvedZoneId = gate?.zone_id || zoneId
  const zone = (manifest.zones || []).find((item) => item.id === resolvedZoneId && item.is_active !== false)
  if (!zone) {
    return { result: { status: 'invalid', message: 'Offline manifest does not contain this active zone or gate.' }, manifest }
  }
  let scanDirection = gate?.direction || direction || (zone.direction_mode === 'exit' ? 'out' : 'in')
  if (zone.direction_mode === 'entry') scanDirection = 'in'
  if (zone.direction_mode === 'exit') scanDirection = 'out'

  const decision = accessDecision(manifest, guest, zone, mode)
  const currentOccupancy = Math.max(Number(zone.occupancy || 0), 0)
  const capacityDenied = scanDirection === 'in' && zone.capacity && currentOccupancy >= zone.capacity
  if (!decision.allowed || capacityDenied) {
    const reason = decision.reason || 'Zone is at capacity in this device cache'
    return {
      manifest,
      result: {
        status: 'denied',
        denied: true,
        guest_name: `${guest.first_name} ${guest.last_name || ''}`.trim(),
        ticket_type: decision.matchedTags?.join(', ') || undefined,
        zone_name: zone.name,
        direction: scanDirection,
        occupancy: currentOccupancy,
        deny_reason: reason,
        message: `Denied offline — ${reason}`,
      },
    }
  }

  const nextOccupancy = scanDirection === 'out' ? Math.max(currentOccupancy - 1, 0) : currentOccupancy + 1
  const admittedAt = new Date().toISOString()
  const nextManifest = {
    ...manifest,
    zones: (manifest.zones || []).map((item) => item.id === zone.id ? { ...item, occupancy: nextOccupancy } : item),
    guests: (manifest.guests || []).map((item) => item.id === guest.id && scanDirection === 'in'
      ? { ...item, admitted: true, admitted_at: item.admitted_at || admittedAt }
      : item),
  }
  saveOfflineManifest(eventId, nextManifest)
  enqueueOfflineAccessScan({
    eventId,
    token,
    guestId: guest.id,
    guestName: `${guest.first_name} ${guest.last_name || ''}`.trim(),
    mode,
    gateId: gate?.id,
    zoneId: zone.id,
    direction: scanDirection,
  })
  return {
    manifest: nextManifest,
    result: {
      status: 'offline_queued',
      denied: false,
      guest_name: `${guest.first_name} ${guest.last_name || ''}`.trim(),
      ticket_type: decision.matchedTags?.join(', ') || undefined,
      zone_name: zone.name,
      direction: scanDirection,
      occupancy: nextOccupancy,
      message: `${guest.first_name} ${guest.last_name || ''} — ${scanDirection.toUpperCase()} ${zone.name}. Queued offline and will sync when online.`,
    },
  }
}
