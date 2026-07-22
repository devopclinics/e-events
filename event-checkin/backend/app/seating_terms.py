"""Resolves the per-event display word for "Table" (e.g. "Cabin", "Room"),
set via Event.seating_term. Purely cosmetic — never touches SeatingTable/
TableGroup data, only what guests/staff/organizers read on screen or in a
message. Falls back to "Table" wherever unset.
"""


def seating_term(event, *, plural: bool = False, lower: bool = False) -> str:
    term = (getattr(event, "seating_term", None) or "Table").strip() or "Table"
    if plural:
        term = term if term.endswith("s") else f"{term}s"
    return term.lower() if lower else term
