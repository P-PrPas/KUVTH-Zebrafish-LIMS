from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from fastapi import Request
from test_experiments import create_batch, headers
from test_fish import setup_eligible_embryo

from chronofish.api.routes.corrections import _validate_and_apply
from chronofish.domain.state import State
from chronofish.runtime.errors import APIError
from chronofish.runtime.values import uuid7


def test_approved_corrections_cannot_assign_outside_the_plate():
    state = State()
    batch_id, lot_id, embryo_id = uuid7(), uuid7(), uuid7()
    state.entities["batches"][batch_id] = {"id": batch_id, "wellPlateSize": 6}
    state.entities["injection-lots"][lot_id] = {"id": lot_id, "batchId": batch_id}
    state.entities["embryos"][embryo_id] = {"id": embryo_id, "injectionLotId": lot_id, "wellPosition": "A1"}
    request = Request({"type": "http", "method": "POST", "path": "/", "headers": []})
    with pytest.raises(APIError, match="outside the selected Well Plate"):
        _validate_and_apply(state, request, "embryo", embryo_id, "wellPosition", "H12", "Recheck")


@pytest.mark.parametrize(
    "size,last_well,excluded",
    [(6, "B3", "A4"), (12, "C4", "A5"), (24, "D6", "A7"), (48, "F8", "A9"), (96, "H12", "I1")],
)
def test_plate_capacity_and_well_assignment_are_enforced(client, write_headers, size, last_well, excluded):
    batch, donor = create_batch(client, write_headers)
    response = client.patch(
        f"/api/v1/batches/{batch['id']}",
        headers=headers(write_headers, 800),
        json={"wellPlateSize": size, "correctionReason": "Select lab plate"},
    )
    assert response.status_code == 200, response.text
    path = f"/api/v1/batches/{batch['id']}/injection-lots"
    body = {"donorCellLineId": donor["id"], "activatedAt": "2026-08-20T00:00:00Z", "nActivated": 1}
    invalid = client.post(path, headers=headers(write_headers, 801), json={**body, "wellPositions": [excluded]})
    assert invalid.status_code == 422
    overflow = client.post(path, headers=headers(write_headers, 802), json={**body, "nActivated": size + 1})
    assert overflow.status_code == 422
    valid = client.post(path, headers=headers(write_headers, 803), json={**body, "wellPositions": [last_well]})
    assert valid.status_code == 201, valid.text
    embryo = valid.json()["embryos"][0]
    assert embryo["embryoCode"].endswith("_2026-08-20")
    invalid_assignment = client.patch(
        f"/api/v1/embryos/{embryo['id']}",
        headers=headers(write_headers, 804),
        json={"wellPosition": excluded, "correctionReason": "Test boundary"},
    )
    assert invalid_assignment.status_code == 422


def test_sick_requires_its_own_note_and_disability_survives_a_healthy_observation(client, write_headers):
    batch, donor = create_batch(client, write_headers)
    today = datetime.now(ZoneInfo("Asia/Bangkok")).date()
    fish = client.post(
        "/api/v1/fish",
        headers=headers(write_headers, 810),
        json={
            "fishCode": "sick-note-check",
            "dob": (today - timedelta(days=2)).isoformat(),
            "donorCellLineId": donor["id"],
            "recipientEggLotId": batch["recipientEggLotId"],
            "overrideReason": "Historical DOB",
        },
    ).json()
    body = {
        "clientUuid": "01900000-0000-7000-8000-000000000811",
        "cloneFishId": fish["id"],
        "observedOn": (today - timedelta(days=1)).isoformat(),
        "outcome": "ALIVE",
        "condition": "ABNORMAL",
        "healthStatus": "SICK",
        "notes": "General notes do not replace the sick note",
        "overrideReason": "Yesterday's check",
    }
    for note in (None, "", "   "):
        response = client.post(
            "/api/v1/observations/fish",
            headers=headers(write_headers, 811 + len(str(note))),
            json={"observations": [{**body, "sickNote": note}]},
        )
        assert response.json()["results"][0]["status"] == "rejected"
    saved = client.post(
        "/api/v1/observations/fish",
        headers=headers(write_headers, 820),
        json={"observations": [{**body, "sickNote": "Not eating"}]},
    )
    assert saved.json()["results"][0]["status"] == "created", saved.text
    healthy = {
        **body,
        "clientUuid": "01900000-0000-7000-8000-000000000821",
        "observedOn": today.isoformat(),
        "healthStatus": "HEALTHY",
        "condition": "NORMAL",
    }
    saved = client.post(
        "/api/v1/observations/fish", headers=headers(write_headers, 821), json={"observations": [healthy]}
    )
    assert saved.json()["results"][0]["status"] == "created"
    current = client.get(f"/api/v1/fish/{fish['id']}").json()
    assert current["isDisabled"] is True
    assert current["healthStatus"] == "HEALTHY"
    assert current["condition"] == "ABNORMAL"


def test_embryo_disability_is_inherited_on_promotion(client, write_headers):
    embryo = setup_eligible_embryo(client, write_headers)
    observation = next(
        o for o in client.app.state.store.snapshot().observations.values() if o["embryoId"] == embryo["id"]
    )
    corrected = client.patch(
        f"/api/v1/observations/embryo/{observation['id']}",
        headers=headers(write_headers, 830),
        json={"condition": "ABNORMAL", "correctionReason": "Permanent deformity confirmed"},
    )
    assert corrected.status_code == 200, corrected.text
    later = client.post(
        "/api/v1/observations/embryo",
        headers=headers(write_headers, 832),
        json={
            "observations": [
                {
                    "clientUuid": uuid7(),
                    "embryoId": embryo["id"],
                    "stageCode": "stage_27_6D",
                    "observedAt": datetime.now(ZoneInfo("UTC")).isoformat(),
                    "outcome": "ALIVE",
                    "condition": "NORMAL",
                }
            ]
        },
    )
    assert later.json()["results"][0]["status"] == "created", later.text
    saved_id = later.json()["results"][0]["id"]
    assert client.app.state.store.snapshot().observations[saved_id]["condition"] == "NORMAL"
    checkpoint = client.get(f"/api/v1/injection-lots/{embryo['injectionLotId']}/checkpoints/stage_27_6D").json()
    assert checkpoint["embryos"][0]["defaultCondition"] == "ABNORMAL"
    assert checkpoint["embryos"][0]["isDisabled"] is True
    response = client.post(
        "/api/v1/promotions",
        headers=headers(write_headers, 831),
        json={"promotions": [{"clientUuid": "01900000-0000-7000-8000-000000000831", "embryoId": embryo["id"]}]},
    )
    assert response.status_code == 201
    assert response.json()["items"][0]["fish"]["isDisabled"] is True
    assert response.json()["items"][0]["fish"]["condition"] == "ABNORMAL"


@pytest.mark.parametrize("action", ["correct", "delete"])
def test_fixing_source_embryo_abnormal_clears_promoted_fish(client, write_headers, action):
    embryo = setup_eligible_embryo(client, write_headers, condition="ABNORMAL")
    source = next(o for o in client.app.state.store.snapshot().observations.values() if o["embryoId"] == embryo["id"])
    promoted = client.post(
        "/api/v1/promotions",
        headers=headers(write_headers, 850),
        json={"promotions": [{"clientUuid": uuid7(), "embryoId": embryo["id"]}]},
    )
    assert promoted.status_code == 201, promoted.text
    fish_id = promoted.json()["items"][0]["fish"]["id"]
    assert client.get(f"/api/v1/fish/{fish_id}").json()["isDisabled"] is True
    path = f"/api/v1/observations/embryo/{source['id']}"
    if action == "correct":
        response = client.patch(
            path, headers=headers(write_headers, 851), json={"condition": "NORMAL", "correctionReason": "Entry error"}
        )
        assert response.status_code == 200, response.text
        assert response.json()["condition"] == "NORMAL"
    else:
        response = client.delete(path, headers=headers(write_headers, 851), params={"reason": "Entry error"})
        assert response.status_code == 204, response.text
    state = client.app.state.store.snapshot()
    assert state.entities["embryos"][embryo["id"]]["isDisabled"] is False
    fish = client.get(f"/api/v1/fish/{fish_id}").json()
    assert fish["isDisabled"] is False
    assert fish["condition"] == "NORMAL"
    assert not fish.get("firstAbnormalOn")
    from io import BytesIO
    from zipfile import ZipFile

    from test_contract_exports_audit import worksheet_rows

    exported = client.post(
        "/api/v1/exports/excel", headers={**write_headers, "X-Idempotency-Key": uuid7()}, json={"filters": {}}
    )
    assert exported.status_code == 200, exported.text
    with ZipFile(BytesIO(exported.content)) as archive:
        rows = worksheet_rows(archive.read("xl/worksheets/sheet7.xml"))
    columns = {name: index for index, name in enumerate(rows[0])}
    row = next(row for row in rows[1:] if row[columns["fish_code"]] == fish["fishCode"])
    assert row[columns["condition"]] == "NORMAL"
    assert row[columns["is_disabled"]] in {"0", "False"}


@pytest.mark.parametrize("action", ["correct", "delete"])
def test_fixing_source_fish_abnormal_clears_current_disability(client, write_headers, action):
    batch, donor = create_batch(client, write_headers)
    today = datetime.now(ZoneInfo("Asia/Bangkok")).date().isoformat()
    created = client.post(
        "/api/v1/fish",
        headers=headers(write_headers, 860),
        json={
            "fishCode": "fix-source-fish",
            "dob": today,
            "donorCellLineId": donor["id"],
            "recipientEggLotId": batch["recipientEggLotId"],
        },
    )
    assert created.status_code == 201, created.text
    fish_id = created.json()["id"]
    saved = client.post(
        "/api/v1/observations/fish",
        headers=headers(write_headers, 861),
        json={
            "observations": [
                {
                    "clientUuid": uuid7(),
                    "cloneFishId": fish_id,
                    "observedOn": today,
                    "outcome": "ALIVE",
                    "condition": "ABNORMAL",
                    "healthStatus": "HEALTHY",
                }
            ]
        },
    )
    source_id = saved.json()["results"][0]["id"]
    path = f"/api/v1/observations/fish/{source_id}"
    if action == "correct":
        response = client.patch(
            path, headers=headers(write_headers, 862), json={"condition": "NORMAL", "correctionReason": "Entry error"}
        )
        assert response.status_code == 200, response.text
        assert response.json()["condition"] == "NORMAL"
    else:
        response = client.delete(path, headers=headers(write_headers, 862), params={"reason": "Entry error"})
        assert response.status_code == 204, response.text
    fish = client.get(f"/api/v1/fish/{fish_id}").json()
    assert fish["isDisabled"] is False
    assert fish["condition"] == "NORMAL"
    assert not fish.get("firstAbnormalOn")
    from io import BytesIO
    from zipfile import ZipFile

    from test_contract_exports_audit import worksheet_rows

    exported = client.post(
        "/api/v1/exports/excel", headers={**write_headers, "X-Idempotency-Key": uuid7()}, json={"filters": {}}
    )
    assert exported.status_code == 200, exported.text
    with ZipFile(BytesIO(exported.content)) as archive:
        rows = worksheet_rows(archive.read("xl/worksheets/sheet7.xml"))
    columns = {name: index for index, name in enumerate(rows[0])}
    row = next(row for row in rows[1:] if row[columns["fish_code"]] == fish["fishCode"])
    assert row[columns["condition"]] == "NORMAL"
    assert row[columns["is_disabled"]] in {"0", "False"}


@pytest.mark.parametrize("later_condition", ["NORMAL", "ABNORMAL"])
def test_only_remaining_recorded_evidence_determines_disability(client, write_headers, later_condition):
    embryo = setup_eligible_embryo(client, write_headers, condition="ABNORMAL")
    source = next(o for o in client.app.state.store.snapshot().observations.values() if o["embryoId"] == embryo["id"])
    later = client.post(
        "/api/v1/observations/embryo",
        headers=headers(write_headers, 870),
        json={
            "observations": [
                {
                    "clientUuid": uuid7(),
                    "embryoId": embryo["id"],
                    "stageCode": "stage_27_6D",
                    "observedAt": datetime.now(ZoneInfo("UTC")).isoformat(),
                    "outcome": "ALIVE",
                    "condition": later_condition,
                }
            ]
        },
    )
    assert later.json()["results"][0]["status"] == "created", later.text
    assert client.app.state.store.snapshot().entities["embryos"][embryo["id"]]["isDisabled"] is True
    fixed = client.patch(
        f"/api/v1/observations/embryo/{source['id']}",
        headers=headers(write_headers, 871),
        json={
            "condition": "NORMAL",
            "correctionReason": "Incorrect original entry",
        },
    )
    assert fixed.status_code == 200, fixed.text
    assert fixed.json()["condition"] == "NORMAL"
    assert client.app.state.store.snapshot().entities["embryos"][embryo["id"]]["isDisabled"] == (
        later_condition == "ABNORMAL"
    )


@pytest.mark.parametrize("registration", [{"condition": "ABNORMAL"}, {"healthStatus": "DISABLED"}])
def test_disability_recorded_at_registration_is_independent_evidence(client, write_headers, registration):
    batch, donor = create_batch(client, write_headers)
    today = datetime.now(ZoneInfo("Asia/Bangkok")).date().isoformat()
    created = client.post(
        "/api/v1/fish",
        headers=headers(write_headers, 880),
        json={
            "fishCode": "registration-disability",
            "dob": today,
            "donorCellLineId": donor["id"],
            "recipientEggLotId": batch["recipientEggLotId"],
            **registration,
        },
    )
    assert created.status_code == 201, created.text
    fish_id = created.json()["id"]
    saved = client.post(
        "/api/v1/observations/fish",
        headers=headers(write_headers, 881),
        json={
            "observations": [
                {
                    "clientUuid": uuid7(),
                    "cloneFishId": fish_id,
                    "observedOn": today,
                    "outcome": "ALIVE",
                    "condition": "NORMAL",
                    "healthStatus": "HEALTHY",
                }
            ]
        },
    )
    assert saved.json()["results"][0]["status"] == "created", saved.text
    assert client.get(f"/api/v1/fish/{fish_id}").json()["isDisabled"] is True


def test_promotion_preserves_an_undetermined_recorded_condition(client, write_headers):
    embryo = setup_eligible_embryo(client, write_headers, condition="UNDETERMINED")
    response = client.post(
        "/api/v1/promotions",
        headers=headers(write_headers, 890),
        json={"promotions": [{"clientUuid": uuid7(), "embryoId": embryo["id"]}]},
    )
    assert response.status_code == 201, response.text
    fish = response.json()["items"][0]["fish"]
    assert fish["condition"] == "UNDETERMINED"
    assert fish["isDisabled"] is False
