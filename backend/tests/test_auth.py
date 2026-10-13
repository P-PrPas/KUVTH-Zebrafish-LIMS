from __future__ import annotations

import logging
import re
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from chronofish.runtime.values import utc_now
from chronofish.services.auth import LOGIN_LOCK_ALERT_SUBJECT


def test_failed_delivery_can_retry_immediately(client, monkeypatch):
    auth = client.app.state.auth
    email = _invite(client, auth.mailer, "retry@ku.th")["email"]
    original = auth.mailer.send
    monkeypatch.setattr(auth.mailer, "send", lambda *args: (_ for _ in ()).throw(OSError("SMTP down")))
    auth.deliver_code(email)
    monkeypatch.setattr(auth.mailer, "send", original)
    sent = len(auth.mailer.messages)
    auth.deliver_code(email)
    assert len(auth.mailer.messages) == sent + 1


def test_success_resets_failed_attempts(client):
    auth = client.app.state.auth
    email = _invite(client, auth.mailer, "reset@ku.th")["email"]
    auth.deliver_code(email)
    challenge = auth.repository.store.auth_challenges[email]
    challenge["failed_count"] = 10
    _sign_in(TestClient(client.app), email, auth.mailer)
    assert challenge["failed_count"] == 0


def test_admin_can_see_and_unlock_an_account(client):
    auth = client.app.state.auth
    member = _invite(client, auth.mailer, "blocked@ku.th")
    auth.deliver_code(member["email"])
    challenge = auth.repository.store.auth_challenges[member["email"]]
    challenge["failed_count"] = 15
    users = client.get("/api/v1/auth/admin/users").json()["items"]
    assert next(u for u in users if u["id"] == member["id"])["loginLockedUntil"]
    response = client.post(f"/api/v1/auth/admin/users/{member['id']}/unlock", json={})
    assert response.status_code == 204
    assert challenge["failed_count"] == 0
    auth.deliver_code(member["email"])
    _sign_in(TestClient(client.app), member["email"], auth.mailer)


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
    unknown = client.post("/api/v1/auth/request-code", json={"email": "unknown@ku.th"})
    assert cooldown.status_code == unknown.status_code == 202
    assert cooldown.json() == unknown.json()


def test_otp_cooldown_is_logged_without_error_traceback(client, caplog):
    with caplog.at_level(logging.INFO, logger="chronofish.auth"):
        response = client.post("/api/v1/auth/request-code", json={"email": "peerapas.c@ku.th"})
    assert response.status_code == 202
    events = [record for record in caplog.records if record.name == "chronofish.auth"]
    assert len(events) == 1
    assert events[0].levelno == logging.INFO
    assert events[0].exc_info is None


def test_requesting_again_keeps_the_existing_usable_code(client):
    mailer = client.app.state.auth.mailer
    repository = client.app.state.auth.repository
    email = _invite(client, mailer, "repeat.member@ku.th")["email"]
    assert client.post("/api/v1/auth/request-code", json={"email": email}).status_code == 202
    challenge = repository.store.auth_challenges[email]
    first_code = _code(mailer)
    challenge["last_sent_at"] -= timedelta(seconds=61)
    sent_before = len(mailer.messages)

    response = client.post("/api/v1/auth/request-code", json={"email": email})

    assert response.status_code == 202
    assert len(mailer.messages) == sent_before
    assert challenge["send_count"] == 1
    assert (
        client.post(
            "/api/v1/auth/verify-code",
            headers={"X-Device-Id": "second-browser"},
            json={"email": email, "code": first_code},
        ).status_code
        == 200
    )


def test_daily_failed_code_limit_alerts_admin_once_and_survives_new_codes(client):
    mailer = client.app.state.auth.mailer
    email = _invite(client, mailer, "guarded.member@ku.th")["email"]
    assert client.post("/api/v1/auth/request-code", json={"email": email}).status_code == 202
    challenge = client.app.state.auth.repository.store.auth_challenges[email]
    for batch in range(3):
        if batch:
            challenge["last_sent_at"] -= timedelta(seconds=61)
            challenge["expires_at"] = utc_now() - timedelta(seconds=1)
            assert client.post("/api/v1/auth/request-code", json={"email": email}).status_code == 202
        correct_code = _code(mailer)
        wrong_code = "000000" if correct_code != "000000" else "999999"
        for _ in range(5):
            response = client.post(
                "/api/v1/auth/verify-code",
                headers={"X-Device-Id": "attacker"},
                json={"email": email, "code": wrong_code},
            )
            assert response.status_code == 401

    assert challenge["failed_count"] == 15
    assert len([message for message in mailer.messages if message[1] == LOGIN_LOCK_ALERT_SUBJECT]) == 1
    blocked = client.post(
        "/api/v1/auth/verify-code",
        headers={"X-Device-Id": "real-member"},
        json={"email": email, "code": correct_code},
    )
    assert blocked.status_code == 401
    assert len([message for message in mailer.messages if message[1] == LOGIN_LOCK_ALERT_SUBJECT]) == 1
    sent_before = len(mailer.messages)
    assert client.post("/api/v1/auth/request-code", json={"email": email}).status_code == 202
    assert len(mailer.messages) == sent_before

    challenge["failed_window_started_at"] -= timedelta(days=1, seconds=1)
    challenge["locked_until"] -= timedelta(days=1, seconds=1)
    challenge["last_sent_at"] -= timedelta(seconds=61)
    challenge["expires_at"] = utc_now() - timedelta(seconds=1)
    assert client.post("/api/v1/auth/request-code", json={"email": email}).status_code == 202
    recovered = client.post(
        "/api/v1/auth/verify-code",
        headers={"X-Device-Id": "real-member"},
        json={"email": email, "code": _code(mailer)},
    )
    assert recovered.status_code == 200


def test_verify_returns_the_new_session_and_device_ids(client):
    mailer = client.app.state.auth.mailer
    invited = _invite(client, mailer, "session.member@ku.th")
    signed_in = _sign_in(TestClient(client.app), invited["email"], mailer)

    assert signed_in["sessionId"]
    assert signed_in["deviceId"] == "member-browser"


def test_member_duplicate_uses_linked_operator_and_cannot_edit_foreign_batch(client, write_headers, master_data):
    mailer = client.app.state.auth.mailer
    invited = _invite(client, mailer, "duplicate.member@ku.th")
    linked_operator = client.post("/api/v1/operators", headers=write_headers, json={"name": "Linked member operator"})
    assert linked_operator.status_code == 201, linked_operator.text
    linked_id = linked_operator.json()["id"]
    assert client.patch(f"/api/v1/auth/admin/users/{invited['id']}", json={"operatorId": linked_id}).status_code == 200
    source = client.post(
        "/api/v1/batches",
        headers={**write_headers, "X-Idempotency-Key": "01900000-0000-7000-8000-000000000201"},
        json={
            "experimentDate": "2026-09-01",
            "siteId": master_data["site"]["id"],
            "operatorId": master_data["operator"]["id"],
            "protocolId": "01900000-0000-7000-8000-000000000001",
            "treatmentGroupId": master_data["treatment"]["id"],
            "recipientEggLotId": master_data["recipient_egg_lot"]["id"],
        },
    )
    assert source.status_code == 201, source.text
    source_id = source.json()["id"]
    member_client = TestClient(client.app)
    member = _sign_in(member_client, invited["email"], mailer)
    member_headers = {**write_headers, "X-Operator-Id": linked_id, "X-Actor-User-Id": member["id"]}

    foreign_edit = member_client.patch(
        f"/api/v1/batches/{source_id}",
        headers={**member_headers, "X-Idempotency-Key": "01900000-0000-7000-8000-000000000202"},
        json={"notes": "should not change"},
    )
    duplicated = member_client.post(
        f"/api/v1/batches/{source_id}/duplicate",
        headers={**member_headers, "X-Idempotency-Key": "01900000-0000-7000-8000-000000000203"},
        json={"experimentDate": "2026-09-02"},
    )

    assert foreign_edit.status_code == 403
    assert foreign_edit.json()["error"]["code"] == "operator_mismatch"
    assert duplicated.status_code == 201, duplicated.text
    assert duplicated.json()["operatorId"] == linked_id
    assert client.get(f"/api/v1/batches/{source_id}").json()["operatorId"] == master_data["operator"]["id"]
    own_edit = member_client.patch(
        f"/api/v1/batches/{duplicated.json()['id']}",
        headers={**member_headers, "X-Idempotency-Key": "01900000-0000-7000-8000-000000000204"},
        json={"notes": "my own experiment"},
    )
    assert own_edit.status_code == 200, own_edit.text
    audit = client.get(f"/api/v1/audit-log?recordId={duplicated.json()['id']}").json()["items"]
    assert any(item["operatorId"] == linked_id and item["actorUserId"] == member["id"] for item in audit)
    member_client.close()


def test_member_cannot_record_as_another_operator_or_without_a_link(client, write_headers):
    mailer = client.app.state.auth.mailer
    invited = _invite(client, mailer, "operator.member@ku.th")
    member_client = TestClient(client.app)
    member = _sign_in(member_client, invited["email"], mailer)
    operator_a = write_headers["X-Operator-Id"]
    operator_b = "00000000-0000-7000-8000-000000000002"
    headers = {**write_headers, "X-Actor-User-Id": member["id"]}

    unlinked = member_client.post("/api/v1/batches", headers=headers, json={"operatorId": operator_a})
    assert unlinked.status_code == 403
    assert unlinked.json()["error"]["code"] == "operator_link_required"

    assert client.patch(f"/api/v1/auth/admin/users/{member['id']}", json={"operatorId": operator_a}).status_code == 200
    forged_header = member_client.post(
        "/api/v1/batches", headers={**headers, "X-Operator-Id": operator_b}, json={"operatorId": operator_b}
    )
    forged_body = member_client.post("/api/v1/batches", headers=headers, json={"operatorId": operator_b})
    assert forged_header.status_code == forged_body.status_code == 403
    assert forged_header.json()["error"]["code"] == forged_body.json()["error"]["code"] == "operator_mismatch"
    member_client.close()


def test_invitation_delivery_failure_keeps_account_and_reports_resend(client):
    mailer = client.app.state.auth.mailer
    original_send = mailer.send

    def fail_send(*_args):
        raise RuntimeError("SMTP unavailable")

    mailer.send = fail_send
    invited = client.post("/api/v1/auth/admin/users", json={"email": "retry.member@ku.th"})
    assert invited.status_code == 201
    assert invited.json()["emailSent"] is False
    user_id = invited.json()["user"]["id"]
    assert any(item["id"] == user_id for item in client.get("/api/v1/auth/admin/users").json()["items"])
    mailer.send = original_send
    assert client.post(f"/api/v1/auth/admin/users/{user_id}/invite", json={}).status_code == 202


def test_never_verified_invitation_can_be_disabled_without_sync_acknowledgement(client):
    invited = _invite(client, client.app.state.auth.mailer, "cancel.member@ku.th")
    response = client.patch(f"/api/v1/auth/admin/users/{invited['id']}", json={"active": False})
    assert response.status_code == 200


def test_session_last_seen_is_touched_at_most_once_per_minute(client):
    repository = client.app.state.auth.repository
    token = client.cookies.get("chronofish_session")
    token_hash = repository.token_hash(token)
    session = repository.store.auth_sessions[token_hash]
    start = session["last_seen_at"]
    assert repository.authenticate(token_hash, start + timedelta(seconds=30))
    assert session["last_seen_at"] == start
    assert repository.authenticate(token_hash, start + timedelta(seconds=61))
    assert session["last_seen_at"] == start + timedelta(seconds=61)


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
    assert browser.post(path, headers=headers, json={"email": user["email"], "password": PASSWORD}).status_code == 401
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
    recovery = TestClient(client.app)
    challenge = client.app.state.store.auth_challenges[user["email"]]
    challenge["last_sent_at"] = utc_now() - timedelta(minutes=2)
    new_password = "a different secure password"
    body = {"email": user["email"], "password": new_password}
    assert recovery.post("/api/v1/auth/register", json=body).status_code == 202
    assert browser.get("/api/v1/auth/me").status_code == 200
    headers = {"X-Device-Id": "recovery-browser"}
    assert recovery.post("/api/v1/auth/login", headers=headers, json=body).status_code == 401
    result = recovery.post(
        "/api/v1/auth/verify-code", headers=headers, json={**body, "code": _code(client.app.state.auth.mailer)}
    )
    assert result.status_code == 200
    assert result.json()["user"]["role"] == "guest"
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


def test_existing_bootstrap_admin_cannot_set_password_or_bypass_otp(client):
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
    assert response.status_code == 400
    assert client.get("/api/v1/auth/me").status_code == 200
    assert browser.post("/api/v1/auth/login", headers={"X-Device-Id": "browser"}, json=body).status_code == 401
    verified = browser.post(
        "/api/v1/auth/verify-code",
        headers={"X-Device-Id": "browser"},
        json={"email": admin["email"], "code": _code(client.app.state.auth.mailer)},
    )
    assert verified.status_code == 200
    assert verified.json()["user"]["role"] == "admin"
    browser.close()


def test_unverified_guest_does_not_block_member_invitation(client):
    email = "reserved-by-stranger@ku.th"
    assert client.post("/api/v1/auth/register", json={"email": email, "password": PASSWORD}).status_code == 202
    invited = client.post("/api/v1/auth/admin/users", json={"email": email})
    assert invited.status_code == 201, invited.text
    assert invited.json()["user"]["role"] == "member"


def test_invalid_otp_does_not_hash_password(client, monkeypatch):
    import chronofish.store.auth as service

    calls = []
    monkeypatch.setattr(service, "hash_password", lambda value: calls.append(value) or "unused")
    body = {"email": "wrong-code@ku.th", "password": PASSWORD}
    assert client.post("/api/v1/auth/register", json=body).status_code == 202
    code = _code(client.app.state.auth.mailer)
    wrong = "000000" if code != "000000" else "999999"
    result = client.post("/api/v1/auth/verify-code", json={**body, "code": wrong}, headers={"X-Device-Id": "browser"})
    assert result.status_code == 401
    assert not calls


def test_register_responses_do_not_reveal_invitation_or_cooldown(client):
    browser = TestClient(client.app)
    results = [
        browser.post("/api/v1/auth/register", json={"email": email, "password": PASSWORD})
        for email in ["peerapas.c@ku.th", "new-registration@ku.th", "new-registration@ku.th", "peerapas.c@ku.th"]
    ]
    assert {result.status_code for result in results} == {202}
    assert len({result.text for result in results}) == 1
    browser.close()


def test_promoted_member_cannot_use_guest_password(client):
    browser, user = _register(client)
    assert client.patch(f"/api/v1/auth/admin/users/{user['id']}", json={"role": "member"}).status_code == 200
    assert browser.post("/api/v1/auth/logout").status_code == 204
    assert (
        browser.post(
            "/api/v1/auth/login",
            headers={"X-Device-Id": "browser"},
            json={"email": user["email"], "password": PASSWORD},
        ).status_code
        == 401
    )
    browser.close()


def test_locked_and_unknown_password_accounts_return_same_error(client):
    browser, user = _register(client)
    bodies = []
    for _ in range(7):
        for email in [user["email"], "nonexistent@ku.th"]:
            result = browser.post(
                "/api/v1/auth/login",
                headers={"X-Device-Id": "browser"},
                json={"email": email, "password": "wrong password"},
            )
            assert result.status_code == 401
            bodies.append(result.text)
    assert len(set(bodies)) == 1
    browser.close()


def test_password_login_capacity_does_not_block_health_or_email_code(client):
    from chronofish.services.auth import PASSWORD_LOGINS

    assert PASSWORD_LOGINS.acquire(blocking=False)
    assert PASSWORD_LOGINS.acquire(blocking=False)
    try:
        result = client.post(
            "/api/v1/auth/login", json={"email": "fake@ku.th", "password": PASSWORD}, headers={"X-Device-Id": "browser"}
        )
        assert result.status_code == 503
        assert client.get("/api/v1/health").status_code == 200
        assert client.post("/api/v1/auth/request-code", json={"email": "unknown@ku.th"}).status_code == 202
    finally:
        PASSWORD_LOGINS.release()
        PASSWORD_LOGINS.release()
