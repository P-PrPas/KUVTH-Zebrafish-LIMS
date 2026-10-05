from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from test_experiments import create_batch

from chronofish.api.routes import corrections
from chronofish.runtime.values import uuid7


def account_headers(user_id: str) -> dict[str, str]:
    return {"X-Actor-User-Id": user_id, "X-Device-Id": "correction-test", "X-Idempotency-Key": uuid7()}


@pytest.fixture
def correction_context(client, write_headers):
    batch, _donor = create_batch(client, write_headers)
    mailer = client.app.state.auth.mailer
    invited = client.post("/api/v1/auth/admin/users", json={"email": "correction.member@ku.th"})
    assert invited.status_code == 201, invited.text
    member = TestClient(client.app)
    try:
        assert member.post("/api/v1/auth/request-code", json={"email": "correction.member@ku.th"}).status_code == 202
        code = re.search(r"\b\d{6}\b", mailer.messages[-1][2])
        assert code
        signed_in = member.post(
            "/api/v1/auth/verify-code",
            headers={"X-Device-Id": "correction-test"},
            json={"email": "correction.member@ku.th", "code": code.group()},
        )
        assert signed_in.status_code == 200, signed_in.text
        admin_id = client.get("/api/v1/auth/me").json()["user"]["id"]
        yield client, member, admin_id, signed_in.json()["user"]["id"], batch
    finally:
        member.close()


def submit(member: TestClient, member_id: str, batch_id: str, field: str = "notes", value: object = "corrected"):
    return member.post(
        "/api/v1/corrections",
        headers=account_headers(member_id),
        json={
            "targetTable": "experiment_batch",
            "targetId": batch_id,
            "fieldName": field,
            "proposedValue": value,
            "reason": "paper record differs",
        },
    )


def test_member_submits_without_operator_and_admin_applies_with_audit(correction_context):
    admin, member, admin_id, member_id, batch = correction_context
    created = submit(member, member_id, batch["id"])
    assert created.status_code == 201, created.text
    request_id = created.json()["id"]
    assert submit(member, member_id, batch["id"]).status_code == 409
    assert member.get(
        "/api/v1/corrections/markers", params={"targetTable": "experiment_batch", "targetId": batch["id"]}
    ).json()["ownFields"] == ["notes"]
    assert (
        member.post(
            f"/api/v1/corrections/{request_id}/decide",
            headers=account_headers(member_id),
            json={"decision": "approve"},
        ).status_code
        == 403
    )
    decided = admin.post(
        f"/api/v1/corrections/{request_id}/decide",
        headers=account_headers(admin_id),
        json={"decision": "approve"},
    )
    assert decided.status_code == 200, decided.text
    assert decided.json()["status"] == "approved"
    assert decided.json()["appliedAuditId"]
    assert admin.get(f"/api/v1/batches/{batch['id']}").json()["notes"] == "corrected"
    audit = admin.get("/api/v1/audit-log", params={"auditId": decided.json()["appliedAuditId"]}).json()["items"]
    assert audit[0]["newValues"]["correctionReason"] == "paper record differs"
    assert (
        admin.post(
            f"/api/v1/corrections/{request_id}/decide",
            headers=account_headers(admin_id),
            json={"decision": "approve"},
        ).status_code
        == 409
    )


def test_stale_request_shows_audit_and_cannot_be_approved(correction_context, write_headers):
    admin, member, admin_id, member_id, batch = correction_context
    request_id = submit(member, member_id, batch["id"]).json()["id"]
    changed = admin.patch(
        f"/api/v1/batches/{batch['id']}",
        headers={**write_headers, "X-Idempotency-Key": uuid7()},
        json={"notes": "admin changed", "correctionReason": "paper check"},
    )
    assert changed.status_code == 200, changed.text
    detail = admin.get(f"/api/v1/corrections/{request_id}").json()
    assert detail["conflict"] is True
    assert detail["relatedAuditIds"]
    blocked = admin.post(
        f"/api/v1/corrections/{request_id}/decide",
        headers=account_headers(admin_id),
        json={"decision": "approve"},
    )
    assert blocked.status_code == 409
    assert blocked.json()["error"]["code"] == "source_changed"


def test_reject_requires_reason_and_member_can_withdraw(correction_context):
    admin, member, admin_id, member_id, batch = correction_context
    first = submit(member, member_id, batch["id"]).json()["id"]
    missing_reason = admin.post(
        f"/api/v1/corrections/{first}/decide",
        headers=account_headers(admin_id),
        json={"decision": "reject"},
    )
    assert missing_reason.status_code == 422
    rejected = admin.post(
        f"/api/v1/corrections/{first}/decide",
        headers=account_headers(admin_id),
        json={"decision": "reject", "reason": "value not supported"},
    )
    assert rejected.status_code == 200
    assert rejected.json()["status"] == "rejected"
    second = submit(member, member_id, batch["id"]).json()["id"]
    withdrawn = member.post(f"/api/v1/corrections/{second}/withdraw", headers=account_headers(member_id), json={})
    assert withdrawn.status_code == 200
    assert withdrawn.json()["status"] == "withdrawn"


def test_list_skips_expensive_validation_until_detail(correction_context, monkeypatch):
    admin, member, _admin_id, member_id, batch = correction_context
    request_id = submit(member, member_id, batch["id"]).json()["id"]
    original = corrections._validate_and_apply
    calls = []

    def observed_validation(*args):
        calls.append(args)
        return original(*args)

    monkeypatch.setattr(corrections, "_validate_and_apply", observed_validation)
    listed = admin.get("/api/v1/corrections")
    assert listed.status_code == 200
    assert listed.json()["items"][0]["targetLabel"] == batch["batchCode"]
    assert calls == []
    assert admin.get(f"/api/v1/corrections/{request_id}").status_code == 200
    assert len(calls) == 1


def test_member_can_edit_own_recent_batch_but_old_work_requires_request(correction_context, store):
    admin, member, _admin_id, member_id, source = correction_context
    linked = admin.patch(f"/api/v1/auth/admin/users/{member_id}", json={"operatorId": source["operatorId"]})
    assert linked.status_code == 200, linked.text
    member_headers = {**account_headers(member_id), "X-Operator-Id": source["operatorId"]}
    duplicated = member.post(
        f"/api/v1/batches/{source['id']}/duplicate",
        headers=member_headers,
        json={"experimentDate": source["experimentDate"]},
    )
    assert duplicated.status_code == 201, duplicated.text
    own_id = duplicated.json()["id"]
    assert member.get(f"/api/v1/batches/{own_id}").json()["canEditDirectly"] is True
    recent = member.patch(
        f"/api/v1/batches/{own_id}",
        headers={**member_headers, "X-Idempotency-Key": uuid7()},
        json={"notes": "fixed on same shift"},
    )
    assert recent.status_code == 200, recent.text
    assert member.get(f"/api/v1/batches/{source['id']}").json()["canEditDirectly"] is False
    with store.lock:
        store.state.entities["batches"][own_id]["createdAt"] = (datetime.now(UTC) - timedelta(days=2)).isoformat()
    expired = member.patch(
        f"/api/v1/batches/{own_id}",
        headers={**member_headers, "X-Idempotency-Key": uuid7()},
        json={"notes": "too late"},
    )
    assert expired.status_code == 403
    assert expired.json()["error"]["code"] == "correction_request_required"


def test_member_can_record_unknown_fish_sex_and_move_box_without_correction(correction_context, write_headers):
    admin, member, _admin_id, member_id, batch = correction_context
    linked = admin.patch(f"/api/v1/auth/admin/users/{member_id}", json={"operatorId": batch["operatorId"]})
    assert linked.status_code == 200, linked.text
    donor = admin.get("/api/v1/donor-cell-lines").json()["items"][0]
    box = admin.post(
        "/api/v1/fish-boxes",
        headers={**write_headers, "X-Idempotency-Key": uuid7()},
        json={"boxCode": "CARE-1", "siteId": batch["siteId"]},
    )
    fish = admin.post(
        "/api/v1/fish",
        headers={**write_headers, "X-Idempotency-Key": uuid7()},
        json={
            "fishCode": "CARE-FISH",
            "dob": datetime.now().date().isoformat(),
            "donorCellLineId": donor["id"],
            "recipientEggLotId": batch["recipientEggLotId"],
        },
    )
    assert fish.status_code == 201, fish.text
    member_headers = {**account_headers(member_id), "X-Operator-Id": batch["operatorId"]}
    recorded = member.patch(
        f"/api/v1/fish/{fish.json()['id']}",
        headers=member_headers,
        json={"sex": "F", "fishBoxId": box.json()["id"]},
    )
    assert recorded.status_code == 200, recorded.text
    changed_sex = member.patch(
        f"/api/v1/fish/{fish.json()['id']}",
        headers={**member_headers, "X-Idempotency-Key": uuid7()},
        json={"sex": "M"},
    )
    assert changed_sex.status_code == 403
    moved = member.patch(
        f"/api/v1/fish/{fish.json()['id']}",
        headers={**member_headers, "X-Idempotency-Key": uuid7()},
        json={"fishBoxId": None},
    )
    assert moved.status_code == 200, moved.text
