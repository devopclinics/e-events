"""Pure, deterministic quiz scoring strategies used by the response API."""
from collections.abc import Collection


def score_choice_response(
    selected_ids: Collection[str],
    correct_ids: Collection[str],
    *,
    points: int = 100,
    strategy: str = "fixed",
    response_time_ms: int | None = None,
    time_limit_seconds: int | None = None,
) -> tuple[int, bool]:
    selected = set(selected_ids)
    correct = set(correct_ids)
    exact = bool(correct) and selected == correct
    points = max(0, int(points))

    if strategy == "partial":
        if not correct:
            return 0, False
        earned = len(selected & correct)
        penalty = len(selected - correct)
        fraction = max(0.0, (earned - penalty) / len(correct))
        return round(points * fraction), exact

    if not exact:
        return 0, False
    if strategy == "time_weighted" and time_limit_seconds and response_time_ms is not None:
        elapsed = max(0.0, response_time_ms / 1000)
        fraction_remaining = max(0.0, 1 - elapsed / time_limit_seconds)
        return round(points * (0.5 + 0.5 * fraction_remaining)), True
    return points, True
