from app.routers.invite import _public_organizer_phones


def test_only_explicit_valid_public_numbers_are_exposed():
    assert _public_organizer_phones({"public_organizer_phones": ["+2348132326304", "+2348132326304", "javascript:alert(1)", "08132326304", None], "billing_phone": "+15551234567"}) == ["+2348132326304"]
    for value in [None, [], {"public_organizer_phones": "private"}, {"owner_phone": "+15551234567"}]:
        assert _public_organizer_phones(value) == []
    assert len(_public_organizer_phones({"public_organizer_phones": [f"+1555123456{n}" for n in range(8)]})) == 5
