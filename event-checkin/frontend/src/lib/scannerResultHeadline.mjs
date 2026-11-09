// Keep admission decisions explicit without presenting pending or repeated scans as new entry.
export function scannerResultHeadline(result) {
  if (!result) return ''
  const status = result.status || ''
  const session = result.zone_name || (result.scope !== 'Event entry' ? result.scope : '')
  const suffix = session ? ` for ${session}` : ''
  if (result.denied || ['denied', 'invalid', 'not_active', 'not_assigned', 'no_seat_available', 'not_paid', 'checkin_disabled', 'group_pass_required'].includes(status)) return `Entry denied${suffix}`
  if (status === 'offline_queued') return 'Saved offline · awaiting sync'
  if (status === 'pending_required_step' || status === 'guardian_required') return 'Action required before check-in'
  if (status.includes('already')) return `Already ${result.direction === 'out' ? 'checked out' : 'checked in'}${suffix}`
  if (['ok', 'admitted', 'group_admitted', 'checked_in', 'checked_out'].includes(status)) {
    return result.direction === 'out' || status === 'checked_out' ? `Checked out${session ? ` of ${session}` : ''}` : `Checked in${suffix}`
  }
  return status.replaceAll('_', ' ') || 'Scan result'
}
