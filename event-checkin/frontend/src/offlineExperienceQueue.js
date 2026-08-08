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
  if (manifest?.expires_at && Date.parse(manifest.expires_at) < Date.now()) {
    return {result:{status:'invalid',message:'Offline safety data is more than 30 minutes old. Reconnect and refresh before admitting tickets.'},manifest}
  }
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
    const admittedAt = new Date().toISOString()
    const nextManifest = {
      ...manifest,
      guests: manifest.guests.map((item) => item.qr_token === token
        ? { ...item, admitted: true, admitted_at: admittedAt }
        : item),
    }
    saveOfflineManifest(eventId, nextManifest)
    enqueueOfflineAdmission({
      eventId,
      token,
      guestId: guest.id,
      guestName: `${guest.first_name} ${guest.last_name}`.trim(),
    })
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
