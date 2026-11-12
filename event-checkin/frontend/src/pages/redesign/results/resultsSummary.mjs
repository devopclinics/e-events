export function utcDate(value) {
  if (value instanceof Date) return value
  if (!value) return null
  const raw = String(value)
  const date = new Date(/^\d{4}-\d\d-\d\dT/.test(raw) && !/(Z|[+-]\d\d:?\d\d)$/i.test(raw) ? `${raw}Z` : raw)
  return Number.isNaN(date.getTime()) ? null : date
}
export function eventTime(value, timezone = 'UTC', seconds = false) {
  const date = utcDate(value)
  if (!date) return '—'
  return date.toLocaleTimeString([], { timeZone: timezone || 'UTC', hour: 'numeric', minute: '2-digit', ...(seconds && { second: '2-digit' }) })
}
export function occupancyPresentation(attendance = {}, summary, timezone) {
  if (attendance.occupancy_mode === 'future') return { value: null, label: 'Not started', detail: 'This period has not started', usable: false }
  if ((attendance.exit_tracking_recorded ?? summary?.exit_tracking_recorded) === false) return { value: null, label: 'Occupancy unverified', detail: 'No exit scans recorded; arrivals are not current occupancy', usable: false }
  if (attendance.occupancy_mode === 'historical') return { value: attendance.on_site, label: 'Recorded inside at close', detail: `As of ${eventTime(attendance.occupancy_as_of, timezone)} · ${timezone || 'UTC'}`, usable: attendance.on_site != null }
  return { value: attendance.on_site, label: 'Recorded on site', detail: 'Based on accepted entry and exit records', usable: attendance.on_site != null }
}
export function summaryMetrics(summary) {
  const r = summary?.rsvp || {}
  return [
    ['Guest records', r.guests, 'Event total; not venue capacity'],
    ['RSVP confirmed', r.confirmed, r.guests ? `${Math.round(r.confirmed / r.guests * 100)}% of guest records` : 'Entire event'],
    ['Unique arrivals', r.checked_in, 'Deduplicated across entrances'],
    ['Confirmed arrivals', r.confirmed_arrived, r.confirmed ? `${Math.round(r.confirmed_arrived / r.confirmed * 100)}% of confirmed guests` : 'No confirmed cohort'],
    ['Confirmed, not arrived', r.confirmed_not_arrived, 'Confirmed guests without an accepted arrival'],
    ['Other arrivals', r.other_arrivals, 'Arrived; not currently RSVP-confirmed'],
  ]
}
