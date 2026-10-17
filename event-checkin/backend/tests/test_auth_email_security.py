"""Firebase email claims are not account-linking or operator authority by default.

These exercise real authentication/database paths with stubbed Firebase and an
in-memory SQLite database. Network attempts are explicitly forbidden.
"""
import json
import socket
from unittest.mock import AsyncMock, Mock
from urllib.parse import quote

import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import func, select, update
from sqlalchemy.sql.dml import Update
from starlette.requests import Request

from app import auth
from app.main import app
from app.models import MarketingOutbox, Membership, Organization, User
from app.routers import auth as auth_router
from app.services import marketing_client
from conftest import _Session


MISSING = object()
UNVERIFIED = [False, MISSING, None, "true", "false", 1, 0, [], {}]
UNVERIFIED_IDS = ["false", "missing", "null", "string-true", "string-false", "one", "zero", "list", "dict"]
CREDENTIALS = HTTPAuthorizationCredentials(scheme="Bearer", credentials="offline-id-token")


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail("Authentication security tests must never use the network")

    monkeypatch.setattr(socket.socket, "connect", forbidden)
    monkeypatch.setattr(socket.socket, "connect_ex", forbidden)
    monkeypatch.setattr(socket, "getaddrinfo", forbidden)


def _token(monkeypatch, *, uid="claiming-uid", email="alice@a.com", verified=MISSING):
    decoded = {"uid": uid, "email": email, "name": "Claimed name"}
    if verified is not MISSING:
        decoded["email_verified"] = verified
    monkeypatch.setattr(auth, "_ensure_firebase", lambda: None)
    monkeypatch.setattr(auth.firebase_auth, "verify_id_token", lambda token: decoded)
    return decoded


async def _login(db):
    return await auth.get_current_user(Request({"type": "http", "headers": []}), CREDENTIALS, db)


async def _counts(db):
    return tuple([await db.scalar(select(func.count(model.id))) for model in (
        User, Organization, Membership, MarketingOutbox,
    )])


@pytest.mark.parametrize("verified", UNVERIFIED, ids=UNVERIFIED_IDS)
async def test_unverified_email_cannot_link_existing_account(ctx, monkeypatch, verified):
    _token(monkeypatch, verified=verified)
    monkeypatch.setattr(auth.settings, "superadmin_emails", "alice@a.com")
    async with _Session() as db:
        before = await _counts(db)
        with pytest.raises(HTTPException) as caught:
            await _login(db)
        assert caught.value.status_code == 403
        assert "verif" in caught.value.detail.lower()
        user = await db.get(User, ctx.ids["user_a"].id)
        assert user.firebase_uid is None and user.name == "Alice"
        assert user.is_platform_superadmin is False
        assert await _counts(db) == before


@pytest.mark.parametrize("verified", [True, False, MISSING], ids=["verified", "false", "missing"])
async def test_email_collision_never_replaces_another_firebase_uid(ctx, monkeypatch, verified):
    _token(monkeypatch, verified=verified)
    monkeypatch.setattr(auth.settings, "superadmin_emails", "alice@a.com")
    async with _Session() as db:
        user = await db.get(User, ctx.ids["user_a"].id)
        user.firebase_uid = "original-owner-uid"
        user.is_platform_superadmin = True
        await db.commit()
        before = await _counts(db)
        with pytest.raises(HTTPException) as caught:
            await _login(db)
        assert caught.value.status_code in {403, 409}
        assert "original-owner-uid" not in caught.value.detail
        await db.refresh(user)
        assert user.firebase_uid == "original-owner-uid"
        assert user.name == "Alice" and user.is_platform_superadmin is True
        assert await _counts(db) == before


async def test_verified_email_links_legacy_account_without_duplicate_provisioning(ctx, monkeypatch):
    _token(monkeypatch, email="ALICE@A.COM", verified=True)
    capture = AsyncMock()
    monkeypatch.setattr(auth, "_capture_registration", capture)
    monkeypatch.setattr(auth.settings, "superadmin_emails", "")
    async with _Session() as db:
        before = await _counts(db)
        user = await _login(db)
        assert user.id == ctx.ids["user_a"].id
        assert user.firebase_uid == "claiming-uid" and not user.is_platform_superadmin
        assert await _counts(db) == before
    capture.assert_awaited_once()
    assert capture.await_args.kwargs["email_verified"] is True


@pytest.mark.parametrize("verified", UNVERIFIED, ids=UNVERIFIED_IDS)
async def test_uid_matched_login_preserved_without_unverified_allowlist_promotion(ctx, monkeypatch, verified):
    _token(monkeypatch, verified=verified)
    monkeypatch.setattr(auth.settings, "superadmin_emails", "alice@a.com")
    capture = AsyncMock()
    monkeypatch.setattr(auth, "_capture_registration", capture)
    async with _Session() as db:
        existing = await db.get(User, ctx.ids["user_a"].id)
        existing.firebase_uid = "claiming-uid"
        await db.commit()
        before = await _counts(db)
        user = await _login(db)
        assert user.id == existing.id and user.firebase_uid == "claiming-uid"
        assert user.is_platform_superadmin is False
        assert await _counts(db) == before
    assert capture.await_args.kwargs["email_verified"] is False


@pytest.mark.parametrize("verified", UNVERIFIED, ids=UNVERIFIED_IDS)
async def test_new_unverified_account_cannot_gain_allowlisted_operator_role(ctx, monkeypatch, verified):
    _token(monkeypatch, email="new@example.com", verified=verified)
    monkeypatch.setattr(auth.settings, "superadmin_emails", "new@example.com")
    capture = AsyncMock()
    monkeypatch.setattr(auth, "_capture_registration", capture)
    async with _Session() as db:
        before = await _counts(db)
        first = await _login(db)
        assert first.email == "new@example.com" and not first.is_platform_superadmin
        assert (await _counts(db))[:3] == tuple(count + 1 for count in before[:3])
        after = await _counts(db)
        assert (await _login(db)).id == first.id
        assert await _counts(db) == after
    assert all(call.kwargs["email_verified"] is False for call in capture.await_args_list)


@pytest.mark.parametrize("existing_uid", [None, "claiming-uid"], ids=["legacy-link", "uid-login"])
async def test_verified_allowlist_promotes_existing_account(ctx, monkeypatch, existing_uid):
    _token(monkeypatch, verified=True)
    monkeypatch.setattr(auth.settings, "superadmin_emails", " unrelated@example.com, ALICE@A.COM ")
    monkeypatch.setattr(auth, "_capture_registration", AsyncMock())
    async with _Session() as db:
        user = await db.get(User, ctx.ids["user_a"].id)
        user.firebase_uid = existing_uid
        await db.commit()
        result = await _login(db)
        assert result.id == user.id and result.is_platform_superadmin is True


async def test_verified_allowlist_promotes_new_account(ctx, monkeypatch):
    _token(monkeypatch, email="new@example.com", verified=True)
    monkeypatch.setattr(auth.settings, "superadmin_emails", "new@example.com")
    monkeypatch.setattr(auth, "_capture_registration", AsyncMock())
    async with _Session() as db:
        assert (await _login(db)).is_platform_superadmin is True


async def test_uid_login_does_not_revoke_manually_assigned_roles(ctx, monkeypatch):
    _token(monkeypatch, verified=False)
    monkeypatch.setattr(auth.settings, "superadmin_emails", "")
    monkeypatch.setattr(auth, "_capture_registration", AsyncMock())
    async with _Session() as db:
        user = await db.get(User, ctx.ids["user_a"].id)
        user.firebase_uid = "claiming-uid"
        user.is_platform_superadmin = True
        user.role = "admin"
        await db.commit()
        result = await _login(db)
        assert result.id == user.id and result.is_platform_superadmin is True
        assert result.role == "admin"
        assert await db.scalar(select(Membership.role).where(Membership.user_id == result.id)) == "owner"


async def test_changed_token_email_does_not_verify_stale_local_email(ctx, monkeypatch):
    _token(monkeypatch, email="changed@example.com", verified=True)
    monkeypatch.setattr(auth.settings, "superadmin_emails", "changed@example.com")
    capture = AsyncMock()
    monkeypatch.setattr(auth, "_capture_registration", capture)
    async with _Session() as db:
        existing = await db.get(User, ctx.ids["user_a"].id)
        existing.firebase_uid = "claiming-uid"
        await db.commit()
        user = await _login(db)
        assert user.id == existing.id and user.email == "alice@a.com"
        assert user.is_platform_superadmin is False
    assert capture.await_args.kwargs["email_verified"] is False


async def test_optional_auth_hides_rejected_collision_without_linking(ctx, monkeypatch):
    _token(monkeypatch, verified=False)
    async with _Session() as db:
        result = await auth.get_current_user_optional(
            Request({"type": "http", "headers": []}), CREDENTIALS, db,
        )
        assert result is None
        assert (await db.get(User, ctx.ids["user_a"].id)).firebase_uid is None


@pytest.mark.parametrize("winner_uid", ["competing-uid", "claiming-uid"], ids=["different-uid", "same-uid"])
async def test_competing_first_link_cannot_be_overwritten(ctx, monkeypatch, winner_uid):
    _token(monkeypatch, verified=True)
    monkeypatch.setattr(auth.settings, "superadmin_emails", "")
    monkeypatch.setattr(auth, "_capture_registration", AsyncMock())
    async with _Session() as db:
        original_execute = db.execute
        raced = False

        async def race_before_compare_and_set(statement, *args, **kwargs):
            nonlocal raced
            if isinstance(statement, Update) and not raced:
                raced = True
                async with _Session() as winner:
                    await winner.execute(update(User).where(User.id == ctx.ids["user_a"].id).values(
                        firebase_uid=winner_uid,
                    ))
                    await winner.commit()
            return await original_execute(statement, *args, **kwargs)

        monkeypatch.setattr(db, "execute", race_before_compare_and_set)
        if winner_uid == "claiming-uid":
            assert (await _login(db)).id == ctx.ids["user_a"].id
        else:
            with pytest.raises(HTTPException) as caught:
                await _login(db)
            assert caught.value.status_code == 409
        assert raced
        assert (await db.get(User, ctx.ids["user_a"].id)).firebase_uid == winner_uid


async def test_simultaneous_provisioning_fails_closed_and_retry_uses_existing_uid(ctx, monkeypatch):
    _token(monkeypatch, email="new@example.com", verified=True)
    monkeypatch.setattr(auth.settings, "superadmin_emails", "")
    monkeypatch.setattr(auth, "_capture_registration", AsyncMock())
    async with _Session() as db:
        before = await _counts(db)
        original_flush = db.flush
        raced = False

        async def race_before_insert(*args, **kwargs):
            nonlocal raced
            if not raced and any(isinstance(row, User) for row in db.new):
                raced = True
                async with _Session() as winner:
                    winner.add(User(name="First request", email="new@example.com", firebase_uid="claiming-uid"))
                    await winner.commit()
            return await original_flush(*args, **kwargs)

        monkeypatch.setattr(db, "flush", race_before_insert)
        with pytest.raises(HTTPException) as caught:
            await _login(db)
        assert caught.value.status_code == 409 and "sign in again" in caught.value.detail
        assert raced
        result = await _login(db)
        assert result.firebase_uid == "claiming-uid" and result.name == "First request"
        after = await _counts(db)
        assert after[0] == before[0] + 1
        assert after[1:] == before[1:], "Losing request must not create orphan organizations or memberships"


@pytest.mark.parametrize("method,path", [
    ("POST", "/api/auth/marketing-token"),
    ("GET", "/api/auth/marketing-preferences"),
    ("PUT", "/api/auth/marketing-preferences"),
])
@pytest.mark.parametrize("verified", [False, MISSING, "true", 1, True], ids=["false", "missing", "string", "one", "verified"])
async def test_marketing_routes_require_current_email_proof(ctx, monkeypatch, method, path, verified):
    _token(monkeypatch, verified=verified)
    monkeypatch.setattr(auth.settings, "superadmin_emails", "")
    monkeypatch.setattr(auth.settings, "planner_internal_token", "offline-marketing-identity-test-key")
    preferences = AsyncMock(return_value={"consent_email": False})
    monkeypatch.setattr(marketing_client, "marketing_preferences", preferences)
    mint_token = Mock(wraps=auth_router.jwt.encode)
    monkeypatch.setattr(auth_router.jwt, "encode", mint_token)
    async with _Session() as db:
        user = await db.get(User, ctx.ids["user_a"].id)
        user.firebase_uid = "claiming-uid"
        await db.commit()
    app.dependency_overrides.pop(auth.get_current_user)
    response = await ctx.client.request(method, path, json={"consent_email": False} if method == "PUT" else None,
                                        headers={"Authorization": "Bearer offline-id-token"})
    if verified is True:
        assert response.status_code == 200, response.text
        if path.endswith("marketing-token"):
            import jwt
            claims = jwt.decode(response.json()["token"], auth.settings.planner_internal_token,
                                algorithms=["HS256"], audience="marketing")
            assert claims["sub"] == "claiming-uid" and claims["email"] == "alice@a.com"
            assert claims["email_verified"] is True
            mint_token.assert_called_once()
        else:
            preferences.assert_awaited_once()
            assert preferences.await_args.args[0] == "alice@a.com"
    else:
        assert response.status_code == 403, response.text
        assert "Verify your current email" in response.json()["detail"]
        preferences.assert_not_awaited()
        mint_token.assert_not_called()
        assert "token" not in response.json()
    # These email-authority restrictions must not lock out ordinary UID login.
    assert (await ctx.client.get("/api/auth/me", headers={"Authorization": "Bearer offline-id-token"})).status_code == 200


async def test_guard_fails_closed_without_request_proof_even_for_manual_operator(ctx, monkeypatch):
    ctx.login(ctx.ids["superadmin"])
    preferences = AsyncMock()
    monkeypatch.setattr(marketing_client, "marketing_preferences", preferences)
    for method, path in (("POST", "/api/auth/marketing-token"), ("GET", "/api/auth/marketing-preferences"),
                         ("PUT", "/api/auth/marketing-preferences")):
        response = await ctx.client.request(method, path, json={"consent_email": True} if method == "PUT" else None)
        assert response.status_code == 403
    preferences.assert_not_awaited()


async def test_verified_provenance_resets_for_each_token_and_binds_current_user_email(ctx, monkeypatch):
    decoded = _token(monkeypatch, verified=True)
    monkeypatch.setattr(auth.settings, "superadmin_emails", "")
    monkeypatch.setattr(auth, "_capture_registration", AsyncMock())
    request = Request({"type": "http", "headers": []})
    async with _Session() as db:
        user = await db.get(User, ctx.ids["user_a"].id)
        user.firebase_uid = "claiming-uid"
        await db.commit()
        assert await auth.get_current_user(request, CREDENTIALS, db) is user
        assert await auth.require_verified_current_email(request, user) is user
        for changes in ({"email_verified": False}, {"email_verified": True, "email": "changed@example.com"}):
            decoded.update(changes)
            assert await auth.get_current_user(request, CREDENTIALS, db) is user
            assert request.state.verified_email_identity is None
            with pytest.raises(HTTPException) as caught:
                await auth.require_verified_current_email(request, user)
            assert caught.value.status_code == 403


async def test_versioned_capture_does_not_upgrade_old_unproved_rows_or_replay_their_consent(ctx, monkeypatch):
    decoded = _token(monkeypatch, email="new@example.com", verified=False)
    monkeypatch.setattr(auth.settings, "superadmin_emails", "")
    async with _Session() as db:
        user = await _login(db)
        old_registered_id = marketing_client.lifecycle_event_id("registered", user.id)
        old_consent_id = marketing_client.lifecycle_event_id("signup_consent", user.id)
        for event, event_id in (("registered", old_registered_id), ("signup_consent", old_consent_id)):
            await marketing_client.enqueue_marketing_payload(db, {
                "email": user.email, "festio_user_id": user.firebase_uid,
                "lifecycle_event": event, "stage": "registered", "consent_email": True,
            }, event_id=event_id)
        await db.commit()
        old_snapshots = {row.id: dict(row.payload) for row in (await db.execute(select(MarketingOutbox))).scalars()}
        # A later verified plain login captures verified registration only.
        decoded["email_verified"] = True
        await _login(db)
        rows = (await db.execute(select(MarketingOutbox))).scalars().all()
        fresh = [row for row in rows if row.id not in old_snapshots]
        assert len(fresh) == 1
        assert fresh[0].payload["lifecycle_event"] == "registered"
        assert fresh[0].payload["email_verified"] is True
        assert not any(key.startswith("consent_") for key in fresh[0].payload)
        assert {row.id: row.payload for row in rows if row.id in old_snapshots} == old_snapshots
        # Only fresh explicit checkbox evidence may create verified consent.
        request = Request({"type": "http", "headers": [(b"x-festio-attribution", quote(json.dumps({
            "consent_email": False, "email_verified": True,
        })).encode())]})
        await auth.get_current_user(request, CREDENTIALS, db)
        verified_consent_id = marketing_client.lifecycle_event_id("signup_consent", user.id, "verified-email-v2")
        consent = await db.get(MarketingOutbox, verified_consent_id)
        assert consent.payload["email_verified"] is True
        assert consent.payload["consent_email"] is False
        assert (await db.get(MarketingOutbox, old_consent_id)).payload == old_snapshots[old_consent_id]


@pytest.mark.parametrize("verified", [True, *UNVERIFIED], ids=["verified", *UNVERIFIED_IDS])
@pytest.mark.parametrize("existing_uid", [None, "claiming-uid", "other-uid"], ids=["legacy", "matched-uid", "different-uid"])
async def test_sse_email_fallback_has_same_verification_boundary(ctx, monkeypatch, verified, existing_uid):
    _token(monkeypatch, verified=verified)
    async with _Session() as db:
        user = await db.get(User, ctx.ids["user_a"].id)
        user.firebase_uid = existing_uid
        await db.commit()
        before = await _counts(db)
        if existing_uid == "claiming-uid" or (existing_uid is None and verified is True):
            assert (await auth.verify_token_user("offline-id-token", db)).id == user.id
        else:
            with pytest.raises(HTTPException) as caught:
                await auth.verify_token_user("offline-id-token", db)
            assert caught.value.status_code in {403, 409}
        await db.refresh(user)
        assert user.firebase_uid == existing_uid
        assert user.is_platform_superadmin is False
        assert await _counts(db) == before


async def test_verified_sse_does_not_provision_unknown_user(ctx, monkeypatch):
    _token(monkeypatch, email="new@example.com", verified=True)
    async with _Session() as db:
        before = await _counts(db)
        with pytest.raises(HTTPException) as caught:
            await auth.verify_token_user("offline-id-token", db)
        assert caught.value.status_code == 403
        assert await _counts(db) == before


async def test_attribution_cannot_spoof_verified_email_proof(ctx, monkeypatch):
    _token(monkeypatch, email="new@example.com", verified=False)
    monkeypatch.setattr(auth.settings, "superadmin_emails", "")
    request = Request({"type": "http", "headers": [(b"x-festio-attribution", quote(json.dumps({
        "email_verified": True, "identity_verified": True, "consent_email": True,
    })).encode())]})
    async with _Session() as db:
        await auth.get_current_user(request, CREDENTIALS, db)
        rows = (await db.execute(select(MarketingOutbox))).scalars().all()
        assert len(rows) == 2
        assert {row.payload["lifecycle_event"] for row in rows} == {"registered", "signup_consent"}
        assert all(row.payload["email_verified"] is False for row in rows)
        assert all("identity_verified" not in row.payload for row in rows)
        assert request.state.verified_email_identity is None


async def test_verified_changed_email_cannot_mint_marketing_token_or_change_preferences(ctx, monkeypatch):
    _token(monkeypatch, email="changed@example.com", verified=True)
    monkeypatch.setattr(auth.settings, "superadmin_emails", "")
    preferences = AsyncMock()
    monkeypatch.setattr(marketing_client, "marketing_preferences", preferences)
    async with _Session() as db:
        user = await db.get(User, ctx.ids["user_a"].id)
        user.firebase_uid = "claiming-uid"
        await db.commit()
    app.dependency_overrides.pop(auth.get_current_user)
    for method, path in (("POST", "/api/auth/marketing-token"), ("GET", "/api/auth/marketing-preferences"),
                         ("PUT", "/api/auth/marketing-preferences")):
        response = await ctx.client.request(method, path, json={"consent_email": True} if method == "PUT" else None,
                                            headers={"Authorization": "Bearer offline-id-token"})
        assert response.status_code == 403
    preferences.assert_not_awaited()


async def test_case_variant_legacy_email_collision_does_not_create_duplicate(ctx, monkeypatch):
    decoded = _token(monkeypatch, verified=False)
    monkeypatch.setattr(auth.settings, "superadmin_emails", "")
    monkeypatch.setattr(auth, "_capture_registration", AsyncMock())
    async with _Session() as db:
        user = await db.get(User, ctx.ids["user_a"].id)
        user.email = "Alice@A.com"
        await db.commit()
        before = await _counts(db)
        with pytest.raises(HTTPException) as caught:
            await _login(db)
        assert caught.value.status_code == 403
        decoded["email_verified"] = True
        assert (await _login(db)).id == user.id
        assert await _counts(db) == before


async def test_ambiguous_case_variant_existing_emails_fail_closed(ctx, monkeypatch):
    _token(monkeypatch, verified=True)
    async with _Session() as db:
        db.add(User(name="Legacy duplicate", email="Alice@A.com"))
        await db.commit()
        before = await _counts(db)
        for login in (_login, lambda session: auth.verify_token_user("offline-id-token", session)):
            with pytest.raises(HTTPException) as caught:
                await login(db)
            assert caught.value.status_code == 409
        assert await _counts(db) == before
