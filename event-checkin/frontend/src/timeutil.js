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
