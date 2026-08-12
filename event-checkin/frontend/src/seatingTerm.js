// Resolves the per-event display word for "Table" (e.g. "Cabin", "Room"),
// set via event.seating_term. Purely cosmetic — never touches seating/table
// group data, only what's shown on screen. Falls back to "Table" when unset.
export function seatingTerm(event, { plural = false, lower = false } = {}) {
  let term = (event?.seating_term || '').trim() || 'Table'
  if (plural) term = term.endsWith('s') ? term : `${term}s`
  return lower ? term.toLowerCase() : term
}

// Same idea, for the individual seat within a table (e.g. "Bunk", "Chair").
export function seatTerm(event, { plural = false, lower = false } = {}) {
  let term = (event?.seat_term || '').trim() || 'Seat'
  if (plural) term = term.endsWith('s') ? term : `${term}s`
  return lower ? term.toLowerCase() : term
}
