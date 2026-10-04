from __future__ import annotations

import re
from datetime import timedelta

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
    unknown = client.post("/api/v1/auth/request-code", json={"email": "unknown@ku.th"})
    assert cooldown.status_code == unknown.status_code == 202
    assert cooldown.json() == unknown.json()


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
