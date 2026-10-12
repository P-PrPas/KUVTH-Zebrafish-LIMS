from __future__ import annotations

import re
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from chronofish.runtime.values import utc_now


def _code(mailer) -> str:
    match = re.search(r"\b\d{6}\b", mailer.messages[-1][2])
    assert match
    return match.group()


def _invite(client: TestClient, mailer, email: str = "member.one@ku.th") -> dict:
    response = client.post("/api/v1/auth/admin/users", json={"email": email})
    assert response.status_code == 201, response.text
    assert mailer.messages[-1][0] == email
    return response.json()["user"]


def _sign_in(client: TestClient, email: str, mailer) -> dict:
    requested = client.post("/api/v1/auth/request-code", json={"email": email})
    assert requested.status_code == 202, requested.text
    verified = client.post(
        "/api/v1/auth/verify-code",
        headers={"X-Device-Id": "member-browser"},
        json={"email": email, "code": _code(mailer)},
    )
    assert verified.status_code == 200, verified.text
    return verified.json()["user"]


def test_health_is_public_but_research_api_requires_a_session(client):
    client.cookies.clear()

    assert client.get("/api/v1/health").status_code == 200
    assert client.post("/api/v1/auth/logout").status_code == 204
    response = client.get("/api/v1/sites")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "authentication_required"


def test_research_mutations_require_the_signed_in_account_actor(client):
    response = client.post("/api/v1/batches", json={})

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "actor_mismatch"


def test_otp_is_single_use_and_keeps_the_email_cooldown(client):
    mailer = client.app.state.auth.mailer
    first_code = _code(mailer)

    reused = client.post(
        "/api/v1/auth/verify-code",
        headers={"X-Device-Id": "other-browser"},
        json={"email": "peerapas.c@ku.th", "code": first_code},
    )
    cooldown = client.post("/api/v1/auth/request-code", json={"email": "peerapas.c@ku.th"})

    assert reused.status_code == 401
    assert cooldown.status_code == 429


def test_invited_member_gets_member_role_and_cannot_use_admin_routes(client):
    mailer = client.app.state.auth.mailer
    invited = _invite(client, mailer)
    member_client = TestClient(client.app)
    member = _sign_in(member_client, invited["email"], mailer)

    assert invited["role"] == "member"
    assert member["role"] == "member"
    assert member_client.get("/api/v1/analytics/dashboard").status_code == 200
    assert member_client.get("/api/v1/auth/admin/users").status_code == 403

    promoted = client.patch(f"/api/v1/auth/admin/users/{invited['id']}", json={"role": "admin"})

    assert promoted.status_code == 200, promoted.text
    assert member_client.get("/api/v1/auth/me").json()["user"]["role"] == "admin"
    member_client.close()


def test_admin_audit_records_account_actor_separately_from_operator(client):
    mailer = client.app.state.auth.mailer
    admin = client.get("/api/v1/auth/me").json()["user"]
    invited = _invite(client, mailer, "lab.member@ku.th")
    operator_id = "00000000-0000-7000-8000-000000000001"
    linked = client.patch(
        f"/api/v1/auth/admin/users/{invited['id']}",
        json={"operatorId": operator_id},
    )
    history = client.get("/api/v1/audit-log?table=auth_user").json()["items"]

    assert linked.status_code == 200, linked.text
    invite_audit = next(item for item in history if item["recordId"] == invited["id"] and item["action"] == "INSERT")
    link_audit = next(item for item in history if item["recordId"] == invited["id"] and item["action"] == "UPDATE")
    assert invite_audit["actorUserId"] == admin["id"]
    assert invite_audit["actorEmail"] == "peerapas.c@ku.th"
    assert link_audit["newValues"]["operatorId"] == operator_id


def test_sender_setting_and_resent_invitation_are_audited(client):
    admin = client.get("/api/v1/auth/me").json()["user"]
    mailer = client.app.state.auth.mailer
    member = _invite(client, mailer, "resend.member@ku.th")

    saved = client.patch("/api/v1/auth/admin/mail-settings", json={"senderEmail": "lab@ku.th"})
    resent = client.post(f"/api/v1/auth/admin/users/{member['id']}/invite", json={})
    settings_audit = client.get("/api/v1/audit-log?table=auth_setting").json()["items"]
    member_audit = client.get(f"/api/v1/audit-log?table=auth_user&recordId={member['id']}").json()["items"]

    assert saved.status_code == 200
    assert resent.status_code == 202
    assert mailer.sender_email == "lab@ku.th"
    sender_change = next(item for item in settings_audit if item["recordId"] == "sender_email")
    invitation_send = next(item for item in member_audit if item["newValues"].get("invitationSentAt"))
    assert sender_change["actorUserId"] == admin["id"]
    assert sender_change["actorEmail"] == admin["email"]
    assert invitation_send["actorUserId"] == admin["id"]


def test_pending_offline_work_blocks_deactivation_and_stale_status_requires_acknowledgement(client):
    mailer = client.app.state.auth.mailer
    invited = _invite(client, mailer, "pending.member@ku.th")
    member_client = TestClient(client.app)
    _sign_in(member_client, invited["email"], mailer)
    repository = client.app.state.auth.repository
    repository.report_sync(invited["id"], "member-device", 2, utc_now())
    path = f"/api/v1/auth/admin/users/{invited['id']}"

    blocked = client.patch(path, json={"active": False, "acknowledgePendingDataRisk": True})
    assert blocked.status_code == 409
    assert blocked.json()["error"]["code"] == "pending_offline_work"

    unrelated = _invite(client, mailer, "unrelated.member@ku.th")
    unrelated_disabled = client.patch(
        f"/api/v1/auth/admin/users/{unrelated['id']}",
        json={"active": False, "acknowledgePendingDataRisk": True},
    )
    assert unrelated_disabled.status_code == 200

    repository.report_sync(invited["id"], "second-device", 0, utc_now())
    mixed_status_blocked = client.patch(path, json={"active": False, "acknowledgePendingDataRisk": True})
    assert mixed_status_blocked.status_code == 409
    assert mixed_status_blocked.json()["error"]["code"] == "pending_offline_work"

    repository.store.auth_sync[(invited["id"], "member-device")]["lastReportedAt"] = utc_now() - timedelta(minutes=11)
    needs_acknowledgement = client.patch(path, json={"active": False})
    disabled = client.patch(path, json={"active": False, "acknowledgePendingDataRisk": True})

    assert needs_acknowledgement.status_code == 409
    assert disabled.status_code == 200
    assert member_client.get("/api/v1/auth/me").status_code == 401
    member_client.close()


def test_last_active_admin_cannot_be_disabled(client):
    admin_id = client.get("/api/v1/auth/me").json()["user"]["id"]

    response = client.patch(
        f"/api/v1/auth/admin/users/{admin_id}",
        json={"active": False, "acknowledgePendingDataRisk": True},
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "last_admin"


PASSWORD = "correct horse battery staple"


def _register(client, email="new.guest@ku.th", password=PASSWORD):
    browser = TestClient(client.app)
    result = browser.post("/api/v1/auth/register", json={"email": email, "password": password, "role": "admin"})
    assert result.status_code == 202, result.text
    verified = browser.post(
        "/api/v1/auth/verify-code",
        headers={"X-Device-Id": "guest-browser"},
        json={"email": email, "code": _code(client.app.state.auth.mailer), "password": password},
    )
    assert verified.status_code == 200, verified.text
    return browser, verified.json()["user"]


def test_guest_registration_password_and_admin_grant(client):
    guest, user = _register(client)
    assert user["role"] == "guest"
    assert "password" not in str(user)
    assert guest.get("/api/v1/auth/me").json()["user"]["role"] == "guest"
    totals = guest.get("/api/v1/analytics/guest-dashboard?operatorId=secret").json()
    assert set(totals) == {"nBatches", "nActivated", "nPromoted", "nFish", "nAlive", "nDead"}
    assert totals == guest.get("/api/v1/analytics/guest-dashboard").json()
    for path in ["batches", "fish", "operators", "audit-log", "analytics/dashboard", "auth/admin/users", "export"]:
        assert guest.get(f"/api/v1/{path}").status_code == 403, path
    assert guest.post("/api/v1/batches", json={}, headers={"X-Actor-User-Id": user["id"]}).status_code == 403
    assert guest.patch(f"/api/v1/auth/admin/users/{user['id']}", json={"role": "member"}).status_code == 403
    stored = client.app.state.auth.repository.user_by_email(user["email"])
    assert stored["password_hash"] != PASSWORD
    assert stored["password_hash"].startswith("pbkdf2_sha256$600000$")
    assert "password_hash" not in client.get("/api/v1/auth/admin/users").text
    guest.post("/api/v1/auth/logout")
    login = guest.post(
        "/api/v1/auth/login",
        headers={"X-Device-Id": "guest-browser"},
        json={"email": user["email"].upper(), "password": PASSWORD},
    )
    assert login.status_code == 200
    assert "HttpOnly" in login.headers["set-cookie"] and "SameSite=lax" in login.headers["set-cookie"]
    granted = client.patch(f"/api/v1/auth/admin/users/{user['id']}", json={"role": "member"})
    assert granted.status_code == 200
    assert guest.get("/api/v1/batches").status_code == 200
    assert guest.get("/api/v1/auth/admin/users").status_code == 403
    assert client.patch(f"/api/v1/auth/admin/users/{user['id']}", json={"role": "guest"}).status_code == 200
    assert guest.get("/api/v1/batches").status_code == 403
    guest.close()


@pytest.mark.parametrize("email", ["user@gmail.com", "user@evilku.th", "user@ku.th.evil", "@ku.th", "a..b@ku.th"])
def test_registration_rejects_non_ku_and_invalid_emails(client, email):
    response = client.post("/api/v1/auth/register", json={"email": email, "password": PASSWORD})
    assert response.status_code == 400


@pytest.mark.parametrize("password", [None, "short", "a" * 7, "a" * 129, 123])
def test_registration_rejects_invalid_password(client, password):
    assert client.post("/api/v1/auth/register", json={"email": "valid@ku.th", "password": password}).status_code == 400
    assert client.app.state.auth.repository.user_by_email("valid@ku.th") is None


def test_eight_character_password_can_register_and_login(client):
    browser, user = _register(client, password="abcd1234")
    assert browser.post("/api/v1/auth/logout").status_code == 204
    login = browser.post(
        "/api/v1/auth/login",
        headers={"X-Device-Id": "eight-character-browser"},
        json={"email": user["email"], "password": "abcd1234"},
    )
    assert login.status_code == 200
    browser.close()


def test_password_is_set_only_after_email_verification_and_code_cannot_be_reused(client):
    browser = TestClient(client.app)
    body = {"email": "unverified@ku.th", "password": PASSWORD}
    assert browser.post("/api/v1/auth/register", json=body).status_code == 202
    code = _code(client.app.state.auth.mailer)
    headers = {"X-Device-Id": "browser"}
    assert browser.post("/api/v1/auth/login", json=body, headers=headers).status_code == 401
    assert (
        browser.post(
            "/api/v1/auth/verify-code", json={"email": body["email"], "code": code}, headers=headers
        ).status_code
        == 400
    )
    assert (
        browser.post("/api/v1/auth/verify-code", json={**body, "code": "not-code"}, headers=headers).status_code == 400
    )
    assert browser.post("/api/v1/auth/verify-code", json={**body, "code": code}, headers=headers).status_code == 200
    assert browser.post("/api/v1/auth/verify-code", json={**body, "code": code}, headers=headers).status_code == 401
    browser.close()


def test_password_attempt_limit_expires_and_disabled_accounts_cannot_login(client):
    browser, user = _register(client)
    path = "/api/v1/auth/login"
    headers = {"X-Device-Id": "browser"}
    for _ in range(5):
        assert (
            browser.post(
                path, headers=headers, json={"email": user["email"], "password": "wrong password!"}
            ).status_code
            == 401
        )
    assert browser.post(path, headers=headers, json={"email": user["email"], "password": PASSWORD}).status_code == 429
    stored = client.app.state.store.auth_users[user["id"]]
    stored["password_locked_until"] = utc_now() - timedelta(seconds=1)
    assert browser.post(path, headers=headers, json={"email": user["email"], "password": PASSWORD}).status_code == 200
    assert (
        client.patch(
            f"/api/v1/auth/admin/users/{user['id']}", json={"active": False, "acknowledgePendingDataRisk": True}
        ).status_code
        == 200
    )
    assert browser.get("/api/v1/auth/me").status_code == 401
    assert browser.post(path, headers=headers, json={"email": user["email"], "password": PASSWORD}).status_code == 401
    browser.close()


def test_password_reset_keeps_role_and_requires_otp_before_revoking_sessions(client):
    browser, user = _register(client)
    assert client.patch(f"/api/v1/auth/admin/users/{user['id']}", json={"role": "member"}).status_code == 200
    recovery = TestClient(client.app)
    challenge = client.app.state.store.auth_challenges[user["email"]]
    challenge["last_sent_at"] = utc_now() - timedelta(minutes=2)
    new_password = "a different secure password"
    body = {"email": user["email"], "password": new_password}
    assert recovery.post("/api/v1/auth/register", json=body).status_code == 202
    assert browser.get("/api/v1/batches").status_code == 200
    headers = {"X-Device-Id": "recovery-browser"}
    assert recovery.post("/api/v1/auth/login", headers=headers, json=body).status_code == 401
    result = recovery.post(
        "/api/v1/auth/verify-code", headers=headers, json={**body, "code": _code(client.app.state.auth.mailer)}
    )
    assert result.status_code == 200
    assert result.json()["user"]["role"] == "member"
    assert browser.get("/api/v1/auth/me").status_code == 401
    assert (
        recovery.post(
            "/api/v1/auth/login", headers=headers, json={"email": user["email"], "password": PASSWORD}
        ).status_code
        == 401
    )
    assert recovery.post("/api/v1/auth/login", headers=headers, json=body).status_code == 200
    recovery.close()
    browser.close()


def test_existing_bootstrap_admin_sets_first_password_without_changing_identity(client):
    admin = client.get("/api/v1/auth/me").json()["user"]
    challenge = client.app.state.store.auth_challenges[admin["email"]]
    challenge["last_sent_at"] = utc_now() - timedelta(minutes=2)
    browser = TestClient(client.app)
    body = {"email": admin["email"], "password": PASSWORD}
    assert browser.post("/api/v1/auth/register", json=body).status_code == 202
    response = browser.post(
        "/api/v1/auth/verify-code",
        headers={"X-Device-Id": "admin-password-browser"},
        json={**body, "code": _code(client.app.state.auth.mailer)},
    )
    assert response.status_code == 200
    assert response.json()["user"]["id"] == admin["id"]
    assert response.json()["user"]["role"] == "admin"
    assert client.get("/api/v1/auth/me").status_code == 401
    assert browser.get("/api/v1/auth/admin/users").status_code == 200
    browser.close()
