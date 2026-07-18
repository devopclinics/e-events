// The backend stores naive UTC timestamps and serializes them WITHOUT a
// timezone suffix (e.g. "2026-07-05T22:30:00"). JavaScript parses suffix-less
// ISO strings as LOCAL time, which silently shifts every value by the viewer's
// UTC offset — and turns edit-form round-trips into a +offset drift per save.
// Always construct Dates from backend timestamps through parseUtc.

export function parseUtc(value) {
  if (!value) return null
  if (value instanceof Date) return value
  const s = String(value)
  const d = new Date(/Z$|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s}Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

// Format a backend UTC timestamp for an <input type="datetime-local"> in the
// viewer's local timezone. Pair with `new Date(inputValue).toISOString()` on
// save for a stable round trip.
export function utcToLocalInput(value) {
  const d = parseUtc(value)
  if (!d) return ''
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

// ── Event-timezone-aware variants ────────────────────────────────────────────
// event_date is meant to be a wall-clock time in the EVENT's own IANA
// timezone (e.g. "Africa/Lagos"), not whichever browser happens to be editing
// it. utcToLocalInput/`new Date(str).toISOString()` above both silently use
// the *viewer's* browser timezone instead — harmless when the editor and the
// event are in the same zone, silently wrong otherwise (an editor in the US
// setting up a 9am Lagos event would save it as 9am US-time = 2pm Lagos).
// Use these two for event_date specifically; pass the event's `timezone`.

// Wall-clock datetime-local string (e.g. "2026-07-30T09:00"), understood as
// being in `timeZone`, converted to the equivalent UTC ISO string for saving.
export function zonedWallTimeToUtcISOString(localDateTimeStr, timeZone) {
  if (!localDateTimeStr) return null
  if (!timeZone) return new Date(localDateTimeStr).toISOString()
  const [datePart, timePart] = localDateTimeStr.split('T')
  const [year, month, day] = datePart.split('-').map(Number)
  const [hour, minute] = (timePart || '00:00').split(':').map(Number)
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute)
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const parts = Object.fromEntries(fmt.formatToParts(new Date(utcGuess)).map((p) => [p.type, p.value]))
  const asIfLocal = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second)
  return new Date(utcGuess - (asIfLocal - utcGuess)).toISOString()
}

// Reverse: format a backend UTC timestamp as a datetime-local value in the
// event's own `timeZone`, for populating the edit form.
export function utcToZonedInput(value, timeZone) {
  const d = parseUtc(value)
  if (!d) return ''
  if (!timeZone) return utcToLocalInput(value)
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]))
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

// Format an event's date for display, collapsing to today's familiar
// single-date string unless `endIso` is set AND lands on a different
// calendar day (in `timeZone`) than `startIso` — in which case it renders a
// compact range. Safe to call for the ~100% of events with no end date.
export function fmtEventDateRange(startIso, endIso, timeZone, opts = {}) {
  const start = parseUtc(startIso)
  if (!start) return ''
  const dateOpts = { month: 'long', day: 'numeric', year: 'numeric', ...(timeZone && { timeZone }) }
  const single = () => start.toLocaleDateString(undefined, dateOpts)
  const end = parseUtc(endIso)
  if (!end) return single()
  const dayKey = (d) => new Intl.DateTimeFormat('en-CA', { ...(timeZone && { timeZone }) }).format(d)
  if (dayKey(start) === dayKey(end)) return single()
  const shortOpts = { month: 'short', day: 'numeric', ...(timeZone && { timeZone }) }
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear()
  const startLabel = start.toLocaleDateString(undefined, sameYear ? shortOpts : { ...shortOpts, year: 'numeric' })
  const endLabel = end.toLocaleDateString(undefined, opts.short ? shortOpts : dateOpts)
  return `${startLabel} – ${endLabel}`
}
