import asyncio
import importlib
import sys
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit, parse_qs

import httpx
import jwt
import pytest
from fastapi.testclient import TestClient

from app import social_providers as providers


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    for key, value in {
        "MARKETING_DATABASE_URL": f"sqlite:///{tmp_path}/social.db",
        "MARKETING_INTERNAL_TOKEN": "social-test-secret-at-least-32-bytes",
        "MARKETING_SOCIAL_ASSET_DIR": str(tmp_path / "assets"),
        "MARKETING_SOCIAL_PUBLISHING_ENABLED": "false",
        "MARKETING_SOCIAL_SCHEDULER_ENABLED": "false",
        "MARKETING_OUTBOUND_ENABLED": "false",
    }.items():
        monkeypatch.setenv(key, value)
    sys.modules.pop("app.main", None)
    m = importlib.import_module("app.main")

    def auth(email="admin@example.com", admin=True):
        return {
            "Authorization": "Bearer "
            + jwt.encode(
                {
                    "sub": email,
                    "email": email,
                    "email_verified": True,
                    "is_platform_superadmin": admin,
                    "iss": "guesthub",
                    "aud": "marketing",
                    "iat": datetime.now(timezone.utc),
                    "exp": datetime.now(timezone.utc) + timedelta(minutes=10),
                },
                m.TOKEN_SECRET,
                algorithm="HS256",
            )
        }

    return m, TestClient(m.app), auth


def asset(client, headers, video=False):
    response = client.post(
        "/api/marketing/social/assets",
        headers=headers,
        files={
            "file": (
                "demo.mp4" if video else "demo.jpg",
                b"\x00\x00\x00\x18ftypisom" + bytes(100)
                if video
                else b"\xff\xd8\xff" + bytes(100),
                "video/mp4" if video else "image/jpeg",
            )
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def create(client, headers, variants=None):
    result = client.post(
        "/api/marketing/social/posts",
        headers=headers,
        json={
            "title": "Festio launch",
            "variants": variants
            or [
                {
                    "platform": "facebook",
                    "format": "text",
                    "caption": "Create your next event.",
                }
            ],
        },
    )
    assert result.status_code == 201, result.text
    return result.json()


def queue(client, headers, post):
    root = "/api/marketing/social/posts/" + post["id"]
    for action in ("submit", "approve"):
        response = client.post(root + "/" + action, headers=headers)
        assert response.status_code == 200, response.text
    response = client.post(
        root + "/schedule",
        headers=headers,
        json={"scheduled_at": datetime.now(timezone.utc).isoformat()},
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_approval_permissions_and_immutable_schedule(workspace):
    m, client, auth = workspace
    headers = auth()
    post = create(client, headers)
    root = "/api/marketing/social/posts/" + post["id"]
    assert (
        client.post(
            root + "/schedule",
            headers=headers,
            json={"scheduled_at": datetime.now(timezone.utc).isoformat()},
        ).status_code
        == 409
    )
    assert client.post(root + "/approve", headers=headers).status_code == 409
    client.post(
        "/api/marketing/access",
        headers=headers,
        json={"email": "writer@example.com", "role": "marketer"},
    )
    assert (
        client.post(
            root + "/approve", headers=auth("writer@example.com", False)
        ).status_code
        == 403
    )
    assert client.get("/api/marketing/social/posts").status_code == 401
    post = queue(client, headers, post)
    assert post["approved_by"] == "admin@example.com"
    assert (
        client.put(
            root,
            headers=headers,
            json={"title": "tampered", "variants": post["variants"]},
        ).status_code
        == 409
    )
    assert (
        client.post(
            root + "/schedule",
            headers=headers,
            json={"scheduled_at": datetime.now(timezone.utc).isoformat()},
        ).status_code
        == 409
    )
    assert (
        len(
            client.get("/api/marketing/social/posts", headers=headers).json()[0][
                "deliveries"
            ]
        )
        == 1
    )
    assert client.post(root + "/cancel", headers=headers).status_code == 200
    assert client.post(root + "/draft", headers=headers).json()["approved_by"] is None


def test_asset_signatures_upload_limits_and_formats(workspace, monkeypatch):
    m, client, auth = workspace
    a = asset(client, auth())
    public = urlsplit(a["url"])
    assert client.get(public.path + "?" + public.query).status_code == 200
    assert client.get(public.path + "?signature=wrong").status_code == 404
    assert (
        client.post(
            "/api/marketing/social/assets",
            headers=auth(),
            files={"file": ("x.svg", b"<svg/>", "image/svg+xml")},
        ).status_code
        == 422
    )
    monkeypatch.setenv("MARKETING_SOCIAL_MAX_ASSET_MB", "1")
    assert (
        client.post(
            "/api/marketing/social/assets",
            headers=auth(),
            files={
                "file": (
                    "large.jpg",
                    b"\xff\xd8\xff" + bytes(1024 * 1024),
                    "image/jpeg",
                )
            },
        ).status_code
        == 413
    )
    bad = {
        "title": "Bad",
        "variants": [{"platform": "instagram", "format": "text", "caption": "Oops"}],
    }
    assert (
        client.post("/api/marketing/social/posts", headers=auth(), json=bad).status_code
        == 422
    )
    bad["variants"] = [
        {
            "platform": "youtube",
            "format": "video",
            "caption": "Oops",
            "asset_id": a["id"],
            "title": "Demo",
        }
    ]
    assert (
        client.post("/api/marketing/social/posts", headers=auth(), json=bad).status_code
        == 422
    )


def test_kill_switch_and_success_do_not_enable_email(workspace, monkeypatch):
    m, client, auth = workspace
    queue(client, auth(), create(client, auth()))
    calls = []

    async def fake(*args):
        calls.append(args[1])
        args[-1]({"phase": "accepted", "provider_id": "page_post"})
        return "page_post", "https://www.facebook.com/page_post"

    monkeypatch.setattr(providers, "publish", fake)
    assert asyncio.run(m.run_social_publishing_due()) == 0
    assert not calls
    monkeypatch.setenv("MARKETING_SOCIAL_PUBLISHING_ENABLED", "true")
    assert asyncio.run(m.run_social_publishing_due()) == 1
    assert asyncio.run(m.run_social_publishing_due()) == 0
    assert calls == ["facebook"]
    result = client.get("/api/marketing/social/posts", headers=auth()).json()[0]
    assert result["status"] == "complete"
    assert result["deliveries"][0]["provider_id"] == "page_post"
    assert m.outbound_enabled() is False


def test_concurrent_workers_claim_each_delivery_once(workspace, monkeypatch):
    m, client, auth = workspace
    queue(client, auth(), create(client, auth()))
    calls = []

    async def fake(*args):
        calls.append(1)
        await asyncio.sleep(0.03)
        return "123", "https://www.facebook.com/123"

    monkeypatch.setattr(providers, "publish", fake)
    monkeypatch.setenv("MARKETING_SOCIAL_PUBLISHING_ENABLED", "true")

    async def run():
        return await asyncio.gather(
            m.run_social_publishing_due(), m.run_social_publishing_due()
        )

    assert sum(asyncio.run(run())) == 1
    assert calls == [1]


def test_uncertain_write_is_not_retried_and_can_be_reconciled(workspace, monkeypatch):
    m, client, auth = workspace
    queue(client, auth(), create(client, auth()))

    async def timeout(*args):
        args[-1]({"phase": "publishing"})
        raise httpx.ReadTimeout("private-provider-url-and-secret")

    monkeypatch.setattr(providers, "publish", timeout)
    monkeypatch.setenv("MARKETING_SOCIAL_PUBLISHING_ENABLED", "true")
    asyncio.run(m.run_social_publishing_due())
    result = client.get("/api/marketing/social/posts", headers=auth()).json()[0]
    delivery = result["deliveries"][0]
    assert delivery["status"] == "needs_review"
    assert "secret" not in delivery["error"]
    assert asyncio.run(m.run_social_publishing_due()) == 0
    root = "/api/marketing/social/deliveries/" + delivery["id"]
    assert client.post(root + "/retry", headers=auth()).status_code == 409
    assert (
        client.post(
            root + "/reconcile",
            headers=auth(),
            json={"url": "https://evil.com/123", "provider_id": "123"},
        ).status_code
        == 422
    )
    assert (
        client.post(
            root + "/reconcile",
            headers=auth(),
            json={"url": "https://www.facebook.com/123", "provider_id": "123"},
        ).status_code
        == 200
    )
    assert (
        client.get("/api/marketing/social/posts", headers=auth()).json()[0]["status"]
        == "complete"
    )


def test_processing_reuses_container_and_only_retries_safe_operations(
    workspace, monkeypatch
):
    m, client, auth = workspace
    a = asset(client, auth(), video=True)
    queue(
        client,
        auth(),
        create(
            client,
            auth(),
            [
                {
                    "platform": "instagram",
                    "format": "video",
                    "caption": "Demo",
                    "asset_id": a["id"],
                }
            ],
        ),
    )

    async def processing(*args):
        args[-1]({"phase": "processing", "container_id": "123"})
        raise providers.DeliveryError("Media processing", retryable=True)

    monkeypatch.setattr(providers, "publish", processing)
    monkeypatch.setenv("MARKETING_SOCIAL_PUBLISHING_ENABLED", "true")
    asyncio.run(m.run_social_publishing_due())
    d = client.get("/api/marketing/social/posts", headers=auth()).json()[0][
        "deliveries"
    ][0]
    assert d["status"] == "retry"
    assert d["attempts"] == 1
    assert asyncio.run(m.run_social_publishing_due()) == 0


def test_tiktok_is_manual_and_cannot_be_auto_delivered(workspace, monkeypatch):
    m, client, auth = workspace
    a = asset(client, auth(), video=True)
    post = queue(
        client,
        auth(),
        create(
            client,
            auth(),
            [
                {
                    "platform": "tiktok",
                    "format": "video",
                    "caption": "Demo",
                    "asset_id": a["id"],
                }
            ],
        ),
    )
    monkeypatch.setenv("MARKETING_SOCIAL_PUBLISHING_ENABLED", "true")
    assert asyncio.run(m.run_social_publishing_due()) == 0
    delivery = post["deliveries"][0]
    assert delivery["status"] == "manual"
    root = "/api/marketing/social/deliveries/" + delivery["id"] + "/manual"
    assert (
        client.post(
            root, headers=auth(), json={"url": "https://tiktok.com.evil.com/post"}
        ).status_code
        == 422
    )
    assert (
        client.post(
            root,
            headers=auth(),
            json={"url": "https://www.tiktok.com/@festioevents/video/123"},
        ).status_code
        == 200
    )
    assert (
        client.post(
            root,
            headers=auth(),
            json={"url": "https://www.tiktok.com/@festioevents/video/123"},
        ).status_code
        == 409
    )


def test_youtube_secret_masking_and_oauth_expiry(workspace):
    m, client, auth = workspace
    saved = client.put(
        "/api/marketing/social-connections/youtube",
        headers=auth(),
        json={
            "client_id": "client",
            "client_secret": "oauth-secret",
            "channel_id": "UC123",
        },
    )
    assert saved.status_code == 200
    assert "oauth-secret" not in saved.text
    result = client.post("/api/marketing/social/oauth/youtube/start", headers=auth())
    assert result.status_code == 200
    query = parse_qs(urlsplit(result.json()["url"]).query)
    state = query["state"][0]
    assert query["redirect_uri"] == [
        "https://festio.events/api/marketing/social/oauth/youtube/callback"
    ]
    assert "oauth-secret" not in result.text
    assert (
        client.get(
            "/api/marketing/social/oauth/youtube/callback?state=wrong&code=x"
        ).status_code
        == 400
    )
    assert (
        client.get(
            "/api/marketing/social/oauth/youtube/callback",
            params={"state": state, "error": "access_denied"},
        ).status_code
        == 400
    )
    assert (
        client.get(
            "/api/marketing/social/oauth/youtube/callback",
            params={"state": state, "code": "x"},
        ).status_code
        == 400
    )


def test_scope_restricted_staff_cannot_access_social_workspace(workspace):
    m, client, auth = workspace
    client.post(
        "/api/marketing/access",
        headers=auth(),
        json={"email": "limited@example.com", "role": "marketer", "owner_scoped": True},
    )
    assert (
        client.get(
            "/api/marketing/social/posts", headers=auth("limited@example.com", False)
        ).status_code
        == 403
    )


def test_schedule_requires_timezone_and_approval_resets_on_edit(workspace):
    m, client, auth = workspace
    p = create(client, auth())
    root = "/api/marketing/social/posts/" + p["id"]
    client.post(root + "/submit", headers=auth())
    client.post(root + "/approve", headers=auth())
    assert (
        client.post(
            root + "/schedule",
            headers=auth(),
            json={"scheduled_at": "2026-11-17T10:00:00"},
        ).status_code
        == 422
    )
    assert client.post(root + "/draft", headers=auth()).json()["approved_at"] is None
    assert (
        client.post(
            root + "/schedule",
            headers=auth(),
            json={"scheduled_at": datetime.now(timezone.utc).isoformat()},
        ).status_code
        == 409
    )


def test_facebook_adapter_sends_media_and_confirms_id():
    calls, checkpoints = [], []

    async def handler(request):
        calls.append((request.method, request.url.path))
        return httpx.Response(
            200,
            json={"id": "123", "post_id": "123_456"}
            if request.method == "POST"
            else {"id": "123_456", "permalink_url": "https://www.facebook.com/123_456"},
        )

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await providers.publish(
                client,
                "facebook",
                {"format": "image", "caption": "Festio"},
                {"access_token": "secret", "page_id": "123"},
                {"url": "https://festio.events/image.jpg"},
                {},
                checkpoints.append,
            )

    assert asyncio.run(run()) == ("123_456", "https://www.facebook.com/123_456")
    assert calls == [("POST", "/v23.0/123/photos"), ("GET", "/v23.0/123_456")]
    assert checkpoints[-1]["provider_id"] == "123_456"


def test_instagram_adapter_waits_then_publishes_existing_container():
    calls, checkpoints = [], []

    async def handler(request):
        calls.append((request.method, request.url.path))
        if request.url.path.endswith("/media_publish"):
            return httpx.Response(200, json={"id": "456"})
        if request.url.path.endswith("/123"):
            return httpx.Response(200, json={"status_code": "FINISHED"})
        return httpx.Response(
            200, json={"id": "456", "permalink": "https://www.instagram.com/p/abc/"}
        )

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await providers.publish(
                client,
                "instagram",
                {"format": "video", "caption": "Festio"},
                {"access_token": "secret", "user_id": "999"},
                {},
                {"phase": "processing", "container_id": "123"},
                checkpoints.append,
            )

    assert asyncio.run(run())[0] == "456"
    assert calls == [
        ("GET", "/v23.0/123"),
        ("POST", "/v23.0/999/media_publish"),
        ("GET", "/v23.0/456"),
    ]


def test_youtube_adapter_confirms_processing_and_does_not_reupload(tmp_path):
    source = tmp_path / "demo.mp4"
    source.write_bytes(b"fake-video")
    calls, checkpoints = [], []

    async def handler(request):
        calls.append((request.method, request.url.path))
        path = request.url.path
        if path == "/token":
            return httpx.Response(200, json={"access_token": "fresh-token"})
        if path.endswith("/channels"):
            return httpx.Response(200, json={"items": [{"id": "UC123"}]})
        if path.endswith("/videos") and request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "items": [
                        {
                            "status": {
                                "uploadStatus": "processed",
                                "privacyStatus": "public",
                            }
                        }
                    ]
                },
            )
        pytest.fail("A confirmed upload must never be uploaded again")

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await providers.publish(
                client,
                "youtube",
                {
                    "title": "Demo",
                    "caption": "Festio",
                    "visibility": "public",
                    "made_for_kids": False,
                    "synthetic_media": False,
                },
                {
                    "client_id": "id",
                    "client_secret": "secret",
                    "refresh_token": "refresh",
                    "channel_id": "UC123",
                },
                {"path": str(source), "size": 10, "mime": "video/mp4"},
                {"provider_id": "vid123", "phase": "accepted"},
                checkpoints.append,
            )

    assert asyncio.run(run()) == ("vid123", "https://www.youtube.com/watch?v=vid123")
    assert not checkpoints


def test_rejected_write_can_retry_but_server_error_is_uncertain():
    with pytest.raises(providers.DeliveryError) as error:
        providers.checked(httpx.Response(429, json={}), mutating=True)
    assert error.value.rejected and error.value.retryable and not error.value.uncertain
    with pytest.raises(providers.DeliveryError) as error:
        providers.checked(httpx.Response(503, json={}), mutating=True)
    assert error.value.uncertain and not error.value.rejected


def test_stale_claim_requires_review_and_cancelled_posts_never_deliver(
    workspace, monkeypatch
):
    m, client, auth = workspace
    post = queue(client, auth(), create(client, auth()))
    with m.SessionLocal() as db:
        d = db.get(m.SocialDelivery, post["deliveries"][0]["id"])
        d.status, d.claimed_at, d.attempts = (
            "sending",
            m.now() - timedelta(minutes=30),
            1,
        )
        db.commit()
    monkeypatch.setenv("MARKETING_SOCIAL_PUBLISHING_ENABLED", "true")
    assert asyncio.run(m.run_social_publishing_due()) == 0
    assert (
        client.get("/api/marketing/social/posts", headers=auth()).json()[0][
            "deliveries"
        ][0]["status"]
        == "needs_review"
    )
    root = "/api/marketing/social/posts/" + post["id"]
    assert client.post(root + "/cancel", headers=auth()).status_code == 200
    assert client.post(root + "/draft", headers=auth()).status_code == 409
    assert asyncio.run(m.run_social_publishing_due()) == 0


def test_youtube_upload_bytes_and_visibility_are_explicit(tmp_path):
    source = tmp_path / "clip.mp4"
    source.write_bytes(b"video-bytes")
    checkpoints = []

    async def handler(request):
        path = request.url.path
        if path == "/token":
            return httpx.Response(200, json={"access_token": "fresh"})
        if path.endswith("/channels"):
            return httpx.Response(200, json={"items": [{"id": "UC123"}]})
        if request.method == "POST":
            import json

            body = json.loads(request.content)
            assert body["status"]["privacyStatus"] == "unlisted"
            assert body["status"]["containsSyntheticMedia"] is True
            return httpx.Response(
                200,
                headers={"Location": "https://www.googleapis.com/upload/bytes"},
                json={},
            )
        if request.method == "PUT":
            assert await request.aread() == b"video-bytes"
            return httpx.Response(201, json={"id": "video123"})
        return httpx.Response(
            200,
            json={
                "items": [
                    {
                        "status": {
                            "uploadStatus": "processed",
                            "privacyStatus": "unlisted",
                        }
                    }
                ]
            },
        )

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await providers.publish(
                client,
                "youtube",
                {
                    "title": "Demo",
                    "caption": "Description",
                    "visibility": "unlisted",
                    "made_for_kids": False,
                    "synthetic_media": True,
                },
                {
                    "client_id": "id",
                    "client_secret": "secret",
                    "refresh_token": "refresh",
                    "channel_id": "UC123",
                },
                {"path": str(source), "size": 11, "mime": "video/mp4"},
                {},
                checkpoints.append,
            )

    assert asyncio.run(run())[0] == "video123"
    assert checkpoints[-1] == {"phase": "accepted", "provider_id": "video123"}


def test_youtube_oauth_success_is_one_use_and_secrets_stay_masked(
    workspace, monkeypatch
):
    m, client, auth = workspace
    client.put(
        "/api/marketing/social-connections/youtube",
        headers=auth(),
        json={"client_id": "client", "client_secret": "client-secret"},
    )
    url = client.post(
        "/api/marketing/social/oauth/youtube/start", headers=auth()
    ).json()["url"]
    state = parse_qs(urlsplit(url).query)["state"][0]
    original = httpx.AsyncClient

    async def handler(request):
        if request.url.path == "/token":
            return httpx.Response(
                200,
                json={
                    "access_token": "secret-access",
                    "refresh_token": "secret-refresh",
                },
            )
        return httpx.Response(
            200, json={"items": [{"id": "UC123", "snippet": {"title": "Festio"}}]}
        )

    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs),
    )
    result = client.get(
        "/api/marketing/social/oauth/youtube/callback",
        params={"state": state, "code": "secret-code"},
    )
    assert result.status_code == 200
    assert "secret" not in result.text
    assert (
        client.get(
            "/api/marketing/social/oauth/youtube/callback",
            params={"state": state, "code": "secret-code"},
        ).status_code
        == 400
    )
    connections = client.get("/api/marketing/social-connections", headers=auth())
    assert "secret-refresh" not in connections.text
    yt = next(c for c in connections.json() if c["platform"] == "youtube")
    assert yt["configured_fields"]["refresh_token"] is True
    assert yt["identifiers"]["channel_id"] == "UC123"
    tested = client.post(
        "/api/marketing/social-connections/youtube/test", headers=auth()
    )
    assert tested.json()["account"] == "Festio"


def test_meta_connection_test_requires_publish_permissions(workspace, monkeypatch):
    m, client, auth = workspace
    client.put(
        "/api/marketing/social-connections/facebook",
        headers=auth(),
        json={
            "app_id": "app",
            "app_secret": "secret",
            "access_token": "token",
            "page_id": "123",
        },
    )
    original = httpx.AsyncClient

    async def handler(request):
        return httpx.Response(
            200, json={"data": {"is_valid": True, "scopes": ["public_profile"]}}
        )

    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs),
    )
    assert (
        client.post(
            "/api/marketing/social-connections/facebook/test", headers=auth()
        ).status_code
        == 422
    )


def test_low_disk_upload_preserves_database_space(workspace, monkeypatch):
    m, client, auth = workspace
    from app import social_publishing
    from collections import namedtuple

    usage = namedtuple("usage", "total used free")
    monkeypatch.setattr(
        social_publishing.shutil, "disk_usage", lambda path: usage(500, 499, 1)
    )
    result = client.post(
        "/api/marketing/social/assets",
        headers=auth(),
        files={"file": ("demo.jpg", b"\xff\xd8\xff" + bytes(100), "image/jpeg")},
    )
    assert result.status_code == 507
    assert client.get("/api/marketing/social/assets", headers=auth()).json() == []


def test_facebook_video_adapter_waits_for_processing():
    checkpoints = []

    async def handler(request):
        if request.method == "POST":
            assert request.url.host == "graph-video.facebook.com"
            return httpx.Response(200, json={"id": "video123"})
        return httpx.Response(
            200, json={"id": "video123", "status": {"video_status": "processing"}}
        )

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await providers.publish(
                client,
                "facebook",
                {"format": "video", "caption": "Festio", "title": "Demo"},
                {"access_token": "secret", "page_id": "123"},
                {"url": "https://festio.events/video.mp4"},
                {},
                checkpoints.append,
            )

    with pytest.raises(providers.DeliveryError) as error:
        asyncio.run(run())
    assert error.value.retryable
    assert checkpoints[-1] == {"phase": "accepted", "provider_id": "video123"}
