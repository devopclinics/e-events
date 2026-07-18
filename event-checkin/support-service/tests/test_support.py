import importlib
import sys
import types
import json
from pathlib import Path

import pytest


sys.path.insert(0, str(Path(__file__).parents[1]))
try:
    from google import genai  # noqa: F401
except ImportError:
    import google

    genai_stub = types.ModuleType("google.genai")
    genai_stub.Client = lambda **kwargs: None
    google.genai = genai_stub
    sys.modules["google.genai"] = genai_stub
main = importlib.import_module("app.main")


@pytest.mark.parametrize(
    ("message", "route"),
    [
        ("", "unsupported"),
        ("Thanks!", "acknowledgement"),
        ("hello", "greeting"),
        ("I need a real person", "human"),
        ("What is the support phone number?", "human"),
        ("Do you have a customer support email?", "human"),
        ("Please refund my credit card", "sensitive"),
        ("My account was hacked", "sensitive"),
        ("Please remove all of my personal information", "sensitive"),
        ("I think someone accessed my account", "sensitive"),
        ("How do I import guests?", "faq"),
        ("What are all the features of Festio?", "feature_overview"),
        ("How can I get pricing?", "pricing_info"),
        ("How do operators edit pricing and plans?", "pricing_info"),
        ("What plan am I on?", "sensitive"),
    ],
)
def test_deterministic_route(message, route):
    assert main._deterministic_route(message) == route


@pytest.mark.asyncio
async def test_completed_job_is_not_posted_twice(monkeypatch):
    class Redis:
        async def exists(self, key):
            return True

        async def incr(self, key):
            self.incremented = key

    redis = Redis()
    monkeypatch.setattr(main, "redis_client", redis)

    async def fail_if_called(*args, **kwargs):
        raise AssertionError("duplicate job attempted a second post")

    monkeypatch.setattr(main, "_draft_and_post", fail_if_called)
    await main._process_job({"message_id": "42", "conversation_id": 7})
    assert redis.incremented == "support:metrics:duplicate_jobs"


@pytest.mark.asyncio
async def test_job_failure_reaches_retry_loop(monkeypatch):
    class Redis:
        async def exists(self, key):
            return False

    monkeypatch.setattr(main, "redis_client", Redis())
    async def acquired(*args):
        return True

    async def released(*args):
        return None

    monkeypatch.setattr(main, "_acquire_concurrency", acquired)
    monkeypatch.setattr(main, "_release_concurrency", released)

    async def unavailable(*args, **kwargs):
        raise TimeoutError("provider unavailable")

    monkeypatch.setattr(main, "_draft_and_post", unavailable)
    with pytest.raises(TimeoutError):
        await main._process_job({"message_id": "43", "conversation_id": 8})


@pytest.mark.asyncio
async def test_atomic_enqueue_adds_recovery_metadata(monkeypatch):
    captured = {}

    class Redis:
        async def eval(self, script, count, *args):
            captured["payload"] = __import__("json").loads(args[-1])
            return 1

    monkeypatch.setattr(main, "redis_client", Redis())
    assert await main._enqueue_once("99", {"conversation_id": 2})
    assert captured["payload"]["attempt"] == 0
    assert captured["payload"]["job_id"]
    assert captured["payload"]["queued_at"]


def test_cache_version_tracks_knowledge_base():
    assert len(main.KNOWLEDGE_BASE_VERSION) == 12
    int(main.KNOWLEDGE_BASE_VERSION, 16)


def test_release_evaluation_has_no_sensitive_false_negatives():
    dataset = Path(__file__).parents[1] / "evaluation" / "questions.jsonl"
    rows = [json.loads(line) for line in dataset.read_text().splitlines()]
    assert len(rows) >= 25
    sensitive = [row for row in rows if row["route"] == "sensitive"]
    assert sensitive
    assert [row for row in sensitive if main._deterministic_route(row["question"]) != "sensitive"] == []
    accuracy = sum(main._deterministic_route(row["question"]) == row["route"] for row in rows) / len(rows)
    assert accuracy >= 0.95


def test_local_json_parser_accepts_fences_but_rejects_non_json():
    assert main._parse_json_object('```json\n{"intent":"faq"}\n```') == {"intent": "faq"}
    with pytest.raises(ValueError):
        main._parse_json_object("faq with no structured result")


def test_local_section_hint_selects_matching_documentation():
    _, titles = main._knowledge_for_route("where do I upload", {"knowledge_section": "Add your guest list"})
    assert titles[0] == "Add your guest list"


@pytest.mark.parametrize(
    ("route", "shadow", "policy"),
    [
        ({"intent": "faq", "confidence": 0.95, "needs_human": False}, True, "observe"),
        ({"intent": "faq", "confidence": 0.95, "needs_human": False}, False, "draft"),
        ({"intent": "faq", "confidence": 0.70, "needs_human": False}, False, "review"),
        ({"intent": "unknown", "confidence": 0.20, "needs_human": False}, False, "escalate"),
        ({"intent": "security", "confidence": 0.99, "needs_human": False}, False, "escalate"),
        ({"intent": "faq", "confidence": 0.99, "needs_human": True}, False, "escalate"),
    ],
)
def test_confidence_policy(route, shadow, policy):
    assert main._confidence_policy(route, shadow) == policy


def test_broad_getting_started_question_retrieves_onboarding_sections():
    knowledge, titles = main._relevant_knowledge("How do I use Festio?")

    assert titles == ["Get started", "Create your event", "Add your guest list"]
    assert "Experience workflows" not in titles
    assert "Click New Event" in knowledge


def test_all_features_question_retrieves_complete_feature_map():
    knowledge, titles = main._relevant_knowledge("What are all Festio features?")

    assert set(titles) == {
        "Complete Festio feature map", "Organizer features", "Staff and check-in features",
        "Guest features", "Operator features", "Get started",
    }
    assert "Organizer features" in knowledge
    assert "Staff and check-in features" in knowledge
    assert "Guest features" in knowledge
    assert "Operator features" in knowledge

    _, conversational_titles = main._relevant_knowledge(
        "What are all the features of Festio? Organize them by role."
    )
    assert set(conversational_titles) == set(titles)


@pytest.mark.parametrize(
    ("answer", "complete"),
    [
        ("This is a complete support answer with enough useful detail to help the organizer finish the task.", True),
        ("To create the event, follow these steps:\n\n1. **Open Event Setup", False),
        ('"This answer starts with a quote but never closes it and therefore must not be published.', False),
        ("Too short.", False),
    ],
)
def test_answer_completeness_guard(answer, complete):
    assert main._answer_looks_complete(answer) is complete


def test_model_input_redaction_removes_common_secrets_and_pii():
    source = "Email me at person@example.com or +1 (415) 555-1212; api_key=top-secret"
    redacted = main._redact_for_model(source)

    assert "person@example.com" not in redacted
    assert "555-1212" not in redacted
    assert "top-secret" not in redacted
    assert "[email]" in redacted and "[phone]" in redacted and "[redacted]" in redacted


@pytest.mark.asyncio
async def test_duplicate_question_claim_is_scoped_and_normalized(monkeypatch):
    calls = []

    class Redis:
        async def set(self, key, value, **kwargs):
            calls.append((key, kwargs))
            return len(calls) == 1

    monkeypatch.setattr(main, "redis_client", Redis())
    assert await main._claim_question("org-1", "How do I import guests?")
    assert not await main._claim_question("org-1", "HOW DO I IMPORT GUESTS!!!")
    assert calls[0][0] == calls[1][0]
    assert calls[0][1] == {"ex": 600, "nx": True}


@pytest.mark.asyncio
async def test_compact_transcript_keeps_recent_turns_when_local_unavailable(monkeypatch):
    async def unavailable(transcript):
        return None

    monkeypatch.setattr(main, "_local_summarize", unavailable)
    transcript = "\n".join(f"Organizer: turn {index}" for index in range(12))
    compact = await main._compact_transcript(transcript)
    assert "turn 0" not in compact
    assert "turn 11" in compact
    assert len(compact.splitlines()) == 8
