"""Explicit practice events keep training records and sending separate."""
def is_practice(event):
    return bool(event and event.is_test and isinstance(event.setup_preferences,dict) and event.setup_preferences.get('junior_practice_source'))
