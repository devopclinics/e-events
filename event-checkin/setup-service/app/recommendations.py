# Static event-type -> guided-setup defaults mapping. Centrally editable here
# (one service, one file) instead of duplicated across frontend pages. Purely
# advisory: every value here only pre-fills/pre-highlights UI in the guided
# setup flow — it never activates a paid feature or writes to the event.
#
# `event_type` values must match the fixed list in
# frontend/src/pages/SetupWizardPage.jsx's event-type <select>.

# suggested_features map to real Event.*_enabled column names.
DEFAULT = {
    "suggested_features": [],
    "multi_day_common": "hide",          # "default_on" | "offer" | "hide"
    "rsvp_question_presets": ["Dietary restriction"],
    "multi_invitee_common": "hide",       # "suggest" | "offer" | "hide"
    "host_field_label": "Host / organizer name",
    "experience_template_key": "simple_checkin",
    "program_common": False,
    "registry_common": "hide",            # "true" | "offer" | "hide" (kept as bool below)
    "logistics_common": None,             # None | {"suggested_name": str}
    "festiome_common": "hide",            # "true" | "offer" | "hide"
}

RECOMMENDATIONS: dict[str, dict] = {
    "Wedding": {
        "suggested_features": ["seating_enabled", "menu_enabled"],
        "multi_day_common": "hide",
        "rsvp_question_presets": ["Dietary restriction", "Meal choice", "Plus-one"],
        "multi_invitee_common": "offer",
        "host_field_label": "Couple's names",
        "experience_template_key": "wedding_reception",
        "program_common": False,
        "registry_common": True,
        "logistics_common": {"suggested_name": "Aso-ebi"},
        "festiome_common": "offer",
    },
    "Nikkah / Aqd": {
        "suggested_features": ["seating_enabled", "menu_enabled"],
        "multi_day_common": "hide",
        "rsvp_question_presets": ["Dietary restriction", "Meal choice"],
        "multi_invitee_common": "offer",
        "host_field_label": "Couple's names",
        "experience_template_key": "wedding_reception",
        "program_common": False,
        "registry_common": True,
        "logistics_common": {"suggested_name": "Aso-ebi"},
        "festiome_common": "offer",
    },
    "Graduation ceremony": {
        "suggested_features": ["seating_enabled", "venue_access_enabled"],
        "multi_day_common": "hide",
        "rsvp_question_presets": ["Accessibility needs", "Plus-one"],
        "multi_invitee_common": "suggest",
        "host_field_label": "Institution / program name",
        "experience_template_key": "simple_checkin",
        "program_common": False,
        "registry_common": False,
        "logistics_common": {"suggested_name": "Graduation gift"},
        "festiome_common": "offer",
    },
    "Birthday party": {
        "suggested_features": ["menu_enabled"],
        "multi_day_common": "hide",
        "rsvp_question_presets": ["Dietary restriction", "Meal choice"],
        "multi_invitee_common": "hide",
        "host_field_label": "Celebrant's name",
        "experience_template_key": "simple_checkin",
        "program_common": False,
        "registry_common": True,
        "logistics_common": None,
        "festiome_common": "hide",
    },
    "Gala / banquet": {
        "suggested_features": ["seating_enabled", "menu_enabled", "registry_enabled"],
        "multi_day_common": "hide",
        "rsvp_question_presets": ["Meal choice", "Dietary restriction"],
        "multi_invitee_common": "hide",
        "host_field_label": "Host / organization name",
        "experience_template_key": "vip_dinner",
        "program_common": True,
        "registry_common": True,
        "logistics_common": {"suggested_name": "VIP gift bag"},
        "festiome_common": "offer",
    },
    "Conference / seminar": {
        "suggested_features": ["venue_access_enabled", "menu_enabled"],
        "multi_day_common": "default_on",
        "rsvp_question_presets": ["Company name", "Dietary restriction", "T-shirt size"],
        "multi_invitee_common": "suggest",
        "host_field_label": "Organizer / company name",
        "experience_template_key": "conference_registration",
        "program_common": True,
        "registry_common": False,
        "logistics_common": {"suggested_name": "Welcome gift"},
        "festiome_common": "true",
    },
    "Community / religious event": {
        "suggested_features": ["menu_enabled"],
        "multi_day_common": "offer",
        "rsvp_question_presets": ["Dietary restriction", "Accessibility needs"],
        "multi_invitee_common": "offer",
        "host_field_label": "Community / organization name",
        "experience_template_key": "simple_checkin",
        "program_common": True,
        "registry_common": False,
        "logistics_common": None,
        "festiome_common": "offer",
    },
    "Corporate event": {
        "suggested_features": ["venue_access_enabled", "menu_enabled"],
        "multi_day_common": "offer",
        "rsvp_question_presets": ["Company name", "Dietary restriction", "T-shirt size"],
        "multi_invitee_common": "offer",
        "host_field_label": "Company name",
        "experience_template_key": "conference_registration",
        "program_common": True,
        "registry_common": False,
        "logistics_common": {"suggested_name": "Welcome gift"},
        "festiome_common": "offer",
    },
    "Concert / show": {
        "suggested_features": ["venue_access_enabled"],
        "multi_day_common": "hide",
        "rsvp_question_presets": ["Accessibility needs"],
        "multi_invitee_common": "hide",
        "host_field_label": "Promoter / artist name",
        "experience_template_key": "simple_checkin",
        "program_common": False,
        "registry_common": False,
        "logistics_common": None,
        "festiome_common": "hide",
    },
    "Private party": {
        "suggested_features": ["menu_enabled"],
        "multi_day_common": "hide",
        "rsvp_question_presets": ["Dietary restriction", "Plus-one"],
        "multi_invitee_common": "hide",
        "host_field_label": "Host's name",
        "experience_template_key": "simple_checkin",
        "program_common": False,
        "registry_common": True,
        "logistics_common": None,
        "festiome_common": "hide",
    },
    "Other": {
        "suggested_features": [],
        "multi_day_common": "hide",
        "rsvp_question_presets": ["Dietary restriction"],
        "multi_invitee_common": "hide",
        "host_field_label": "Host / organizer name",
        "experience_template_key": "simple_checkin",
        "program_common": False,
        "registry_common": False,
        "logistics_common": None,
        "festiome_common": "hide",
    },
}


def get_recommendations(event_type: str | None) -> dict:
    rec = RECOMMENDATIONS.get(event_type or "", DEFAULT)
    return {"event_type": event_type or "", **rec}
