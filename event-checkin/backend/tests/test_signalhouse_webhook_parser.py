from app.routers.messaging import _signalhouse_extract_status_and_message_id


def test_signalhouse_extract_flat_payload():
    status, message_id = _signalhouse_extract_status_and_message_id({
        "messageId": "abc123",
        "status": "delivered",
    })
    assert status == "delivered"
    assert message_id == "abc123"


def test_signalhouse_extract_nested_message_payload():
    status, message_id = _signalhouse_extract_status_and_message_id({
        "message": {
            "id": "nested-1",
            "status": "accepted",
        }
    })
    assert status == "accepted"
    assert message_id == "nested-1"


def test_signalhouse_extract_inserted_messages_status_history_payload():
    payload = {
        "insertedMessages": [{
            "status": "DELIVERED",
            "statusHistory": [{"status": "ENQUEUED", "_id": "old-id"}, {"status": "DELIVERED", "_id": "history-id"}],
        }]
    }
    status, message_id = _signalhouse_extract_status_and_message_id(payload)
    assert status == "DELIVERED"
    assert message_id == "history-id"


def test_signalhouse_extract_prefers_top_level_id_over_status_history_and_group_id():
    """first._id (the top-level message document's own Mongo _id) must win
    over both statusHistory[-1]._id (a transient subdocument id that changes
    on every status transition — a NEW entry with its own new _id is
    appended each time) and groupId (a 10DLC campaign/brand-level id,
    confirmed via two real Signal House sends to be IDENTICAL across
    unrelated messages on the same account — NOT per-message, so it must not
    be preferred over a genuinely unique id when one is available)."""
    payload = {
        "insertedMessages": [{
            "groupId": "G00003ZI",
            "_id": "6a643d2e45f0819f5e4f8b88",
            "status": "DELIVERED",
            "statusHistory": [{"status": "ENQUEUED", "_id": "old-id"}, {"status": "DELIVERED", "_id": "history-id"}],
        }]
    }
    status, message_id = _signalhouse_extract_status_and_message_id(payload)
    assert status == "DELIVERED"
    assert message_id == "6a643d2e45f0819f5e4f8b88"


def test_signalhouse_extract_falls_back_to_group_id_when_no_top_level_id():
    """Without a top-level _id at all, groupId is still a better-than-nothing
    fallback — just not the primary signal (see test above)."""
    payload = {
        "insertedMessages": [{
            "groupId": "G00003ZI",
            "status": "DELIVERED",
            "statusHistory": [{"status": "ENQUEUED", "_id": "old-id"}, {"status": "DELIVERED", "_id": "history-id"}],
        }]
    }
    status, message_id = _signalhouse_extract_status_and_message_id(payload)
    assert status == "DELIVERED"
    assert message_id == "G00003ZI"


def test_signalhouse_extract_returns_none_when_missing_fields():
    status, message_id = _signalhouse_extract_status_and_message_id({})
    assert status is None
    assert message_id is None


def test_signalhouse_live_final_receipt_uses_flat_document_id():
    status, message_id = _signalhouse_extract_status_and_message_id({
        "_id": "6b0727d10606a69b21dd06b4", "status": "DELIVERED",
        "groupId": "shared-campaign-id", "statusHistory": [{"_id": "transient-history-id", "status": "DELIVERED"}],
    })
    assert (status, message_id) == ("DELIVERED", "6b0727d10606a69b21dd06b4")


def test_signalhouse_nested_document_id_is_stable():
    assert _signalhouse_extract_status_and_message_id({"message": {"_id": "message-document", "status": "DELIVERED"}}) == ("DELIVERED", "message-document")
