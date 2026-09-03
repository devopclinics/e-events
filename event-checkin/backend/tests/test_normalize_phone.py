"""Guards the phone normalizer against silently accepting a corrupted
11-digit number as if it were a valid foreign number.

Regression coverage for the MBF Summit incident (2026-08-29/30 through
2026-08-31). Root cause (see test_xlsx_cell_to_str.py for the actual source):
Festio's Excel/Sheets XLSX-fallback import path stringifies numeric cells
naively, and Python's str() appends ".0" to an integer-valued float
(e.g. 8503451754.0 -> "8503451754.0") — the phone normalizer then strips the
"." but not the trailing 0 it leaves behind, turning a valid 10-digit number
into an 11-digit one indistinguishable in shape from genuine bad input (e.g.
"8327941707" -> "83279417070"). Originally misdiagnosed as bad source-sheet
data; it was Festio's own cell-to-text conversion. This test file covers the
normalizer's defense-in-depth side: even given an already-corrupted 11-digit
input (from this bug, a typo, or anything else), _normalize_phone must reject
it rather than fabricate a "+"-prefixed guess — which sometimes coincidentally
matched a real country calling code and was silently accepted by the SMS/
WhatsApp provider, so the bad data never surfaced until guests reported not
receiving anything.
"""
from app.routers.guests import _normalize_phone


def test_clean_10_digit_us_number():
    assert _normalize_phone("8327941707") == "+18327941707"


def test_formatted_us_number():
    assert _normalize_phone("(832) 794-1707") == "+18327941707"


def test_11_digit_with_country_code():
    assert _normalize_phone("18327941707") == "+18327941707"


def test_already_e164():
    assert _normalize_phone("+18327941707") == "+18327941707"


def test_real_international_number_typed_with_plus_is_unaffected():
    assert _normalize_phone("+447911123456") == "+447911123456"


def test_corrupted_shape_10_digit_plus_stray_trailing_digit_is_rejected():
    # A real, valid 10-digit number with one extra digit appended — this is
    # the exact shape seen in the MBF Summit import. Must be rejected, not
    # silently turned into a fake international number.
    assert _normalize_phone("83279417070") is None
    assert _normalize_phone("90836148230") is None
    assert _normalize_phone("28180467670") is None


def test_other_ambiguous_lengths_without_plus_are_rejected():
    assert _normalize_phone("123456789") is None  # 9 digits
    assert _normalize_phone("123456789012") is None  # 12 digits, no '+'


def test_empty_and_none_input():
    assert _normalize_phone("") is None
    assert _normalize_phone(None) is None
