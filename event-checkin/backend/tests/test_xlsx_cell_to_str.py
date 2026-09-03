"""The actual root cause of the MBF Summit phone corruption incident
(2026-08-29/30 through 2026-08-31): see test_normalize_phone.py for the
defense-in-depth side of this fix.

openpyxl/xlrd read a numeric-formatted spreadsheet cell as a Python int/float,
not a string. Excel/Sheets phone-number columns very commonly end up numeric
even when nobody intended that. A naive str() on an integer-valued float
appends ".0" (str(8503451754.0) == "8503451754.0"), and after the phone
normalizer strips non-digit characters, the "." disappears but its trailing 0
does not — silently turning a valid 10-digit number into a bad 11-digit one.
"""
from app.routers.guests import _cell_to_str, _normalize_phone


def test_integer_valued_float_cell_loses_no_digits():
    # This is the exact value pulled from the MBF Summit source sheet for the
    # guest whose phone went missing after a re-sync (2026-08-31).
    assert _cell_to_str(8503451754.0) == "8503451754"


def test_integer_valued_float_cell_normalizes_correctly():
    assert _normalize_phone(_cell_to_str(8503451754.0)) == "+18503451754"


def test_non_integer_float_is_left_alone():
    # Not a realistic phone value, but _cell_to_str must not mangle genuine
    # decimals (e.g. a currency or measurement column reusing this helper).
    assert _cell_to_str(3.14) == "3.14"


def test_int_cell_is_unaffected():
    assert _cell_to_str(8503451754) == "8503451754"


def test_string_cell_is_unaffected():
    assert _cell_to_str("(850) 345-1754") == "(850) 345-1754"


def test_none_cell_becomes_empty_string():
    assert _cell_to_str(None) == ""
