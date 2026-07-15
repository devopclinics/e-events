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


def test_signalhouse_extract_returns_none_when_missing_fields():
    status, message_id = _signalhouse_extract_status_and_message_id({})
    assert status is None
    assert message_id is None
