from __future__ import annotations

import io
import json
import os
import re
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook
from openpyxl.utils.cell import column_index_from_string
from sqlalchemy import MetaData, Table, text

from chronofish.app import create_app
from chronofish.config import Config
from chronofish.domain.state import DEMO_OPERATOR_ID
from chronofish.runtime.values import uuid7
from chronofish.services.mail import RecordingMailer
from chronofish.store import MemoryStore
from chronofish.store.sql import SQLStore

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def v5_master_data(client, book):
    from chronofish.services.import_v5 import EXPERIMENT, FISH

    suffix = uuid7()[-10:]
    site, operator, group = f"V5-{suffix}", f"V5 operator {suffix}", f"V5-{suffix}"
    for resource, body in [
        ("sites", {"code": site, "name": site, "timeZone": "Asia/Bangkok"}),
        ("operators", {"name": operator}),
        (
            "donor-cell-lines",
            {"strain": "AB", "preparation": "DISSOCIATED", "preservation": "FRESH", "batchCode": suffix},
        ),
        ("treatment-groups", {"code": group, "name": group, "armType": "SCNT"}),
    ]:
        response = client.post(f"/api/v1/{resource}", json=body, headers={"X-Idempotency-Key": uuid7()})
        assert response.status_code == 201, response.text
    if EXPERIMENT in book:
        for cell, value in {"H5": site, "B6": operator, "E6": group, "G13": suffix, "B13": "B" + suffix}.items():
            book[EXPERIMENT][cell] = value
        from chronofish.services.import_v5 import EMBRYOS

        book[EMBRYOS]["G8"] = operator
    else:
        for row in (9, 13):
            for col, value in {
                "A": f"F{row}-{suffix}",
                "M": site,
                "U": operator,
                "H": suffix,
                "W": "RT" + suffix,
                "X": "DC" + suffix,
            }.items():
                book[FISH][f"{col}{row}"] = value
        from chronofish.services.import_v5 import SPECIMENS

        book[SPECIMENS]["B8"] = "RT" + suffix
        book[SPECIMENS]["B9"] = "DC" + suffix
    return suffix


def v5_job(client, book, sheets):
    content = io.BytesIO()
    book.save(content)
    return create_job(client, content.getvalue(), sheets=sheets)


def test_v5_forms_inspect_download_validate_commit_and_atomic_failure(import_client):
    from test_import_v5 import experiment, registry

    from chronofish.services.import_v5 import EMBRYOS, EXPERIMENT, FISH, SPECIMENS, download_bytes

    client = import_client
    for kind in ("experiment", "registry"):
        response = client.get(f"/api/v1/imports/template?kind={kind}")
        assert response.status_code == 200
        assert response.content == download_bytes(kind)
    assert client.get("/api/v1/imports/template?kind=other").status_code == 400
    book = experiment()
    v5_master_data(client, book)
    inspected = client.post("/api/v1/imports/inspect", files={"files": ("v5.xlsx", download_bytes("experiment"), XLSX)})
    assert inspected.json()["files"][0]["templateSheets"] == [EXPERIMENT, EMBRYOS]
    created = v5_job(client, book, [EXPERIMENT, EMBRYOS])
    job_id = created["job"]["id"]
    before = client.get("/api/v1/batches").json()
    for cell, value in {"N8": 1, "N10": "NORMAL", "AH8": 1, "AH9": "12:00:00", "AH10": "NORMAL"}.items():
        book[EMBRYOS][cell] = value
    invalid_time = v5_job(client, book, [EXPERIMENT, EMBRYOS])
    response = client.post(f"/api/v1/imports/{invalid_time['job']['id']}/confirm-template", json={"revision": 1})
    assert response.status_code == 422 and "full date and time" in response.text, response.text
    assert client.get("/api/v1/batches").json() == before
    response = client.post(f"/api/v1/imports/{job_id}/validate-template", json={"revision": 1})
    assert response.status_code == 200, response.text
    assert client.get("/api/v1/batches").json() == before
    response = client.post(f"/api/v1/imports/{job_id}/confirm-template", json={"revision": 1})
    assert response.status_code == 200, response.text
    assert response.json()["recordCount"] == 2
    book = registry()
    book[FISH]["J9"] = "Abnormal"
    book[FISH]["Z10"] = "abnormal"
    v5_master_data(client, book)
    before = client.get("/api/v1/fish").json()
    book[SPECIMENS]["C9"] = "wrong type"
    failed = v5_job(client, book, [FISH, SPECIMENS])
    response = client.post(f"/api/v1/imports/{failed['job']['id']}/confirm-template", json={"revision": 1})
    assert response.status_code == 422, response.text
    assert client.get("/api/v1/fish").json() == before
    book[SPECIMENS]["C9"] = "left over cells"
    created = v5_job(client, book, [FISH, SPECIMENS])
    response = client.post(f"/api/v1/imports/{created['job']['id']}/confirm-template", json={"revision": 1})
    assert response.status_code == 200, response.text
    fish = next(
        f
        for f in client.app.state.store.snapshot().entities["fish"].values()
        if f["fishCode"] == book[FISH]["A9"].value
    )
    assert fish["isDisabled"] and fish["disabilityAtRegistration"]
    assert fish["condition"] == "ABNORMAL"
    if getattr(client.app.state.store, "engine", None) is not None:
        assert (
            scalar(client, "SELECT COUNT(*) FROM specimen_fish_link WHERE import_job_id = :job", created["job"]["id"])
            == 4
        )


@pytest.mark.parametrize("kind", ["experiment", "registry"])
def test_v5_commit_duplicate_and_revert_preserve_existing_data(import_client, kind):
    from test_import_v5 import experiment, registry

    from chronofish.services.import_v5 import EMBRYOS, EXPERIMENT, FISH, SPECIMENS

    client = import_client
    sql_required(client)
    book = experiment() if kind == "experiment" else registry()
    sheets = [EXPERIMENT, EMBRYOS] if kind == "experiment" else [FISH, SPECIMENS]
    v5_master_data(client, book)
    before = {path: client.get(f"/api/v1/{path}").json() for path in ("batches", "fish")}
    created = v5_job(client, book, sheets)
    job_id = created["job"]["id"]
    confirmed = client.post(f"/api/v1/imports/{job_id}/confirm-template", json={"revision": 1})
    assert confirmed.status_code == 200, confirmed.text
    duplicate = v5_job(client, book, sheets)
    rejected = client.post(f"/api/v1/imports/{duplicate['job']['id']}/confirm-template", json={"revision": 1})
    assert rejected.status_code in (409, 422), rejected.text
    current = client.get(f"/api/v1/imports/{job_id}").json()["job"]
    # A later edit must block the entire rollback, without partial deletion.
    table = "experiment_batch" if kind == "experiment" else "clone_fish"
    with client.app.state.store.engine.begin() as connection:
        audit = (
            connection.execute(
                text("SELECT new_values FROM audit_log WHERE table_name = 'import_job' AND record_id = :id"),
                {"id": job_id},
            )
            .scalars()
            .all()
        )
        manifests = [json.loads(value) if isinstance(value, str) else value for value in audit]
        ownership = next(value["rollbackManifest"] for value in manifests if value.get("rollbackManifest"))
        target = next(iter(ownership[table]))
        original_time = connection.execute(
            text(f"SELECT updated_at FROM {table} WHERE id = :id"), {"id": target}
        ).scalar_one()
        connection.execute(
            text(f"UPDATE {table} SET updated_at = :time WHERE id = :id"),
            {"id": target, "time": original_time + timedelta(seconds=1)},
        )
    blocked = client.post(
        f"/api/v1/imports/{job_id}/revert",
        json={"revision": current["revision"], "reason": "Must preserve later work"},
    )
    assert blocked.status_code == 409 and blocked.json()["error"]["code"] == "revert_dependency", blocked.text
    assert client.get(f"/api/v1/imports/{job_id}").json()["job"]["status"] == "committed"
    with client.app.state.store.engine.begin() as connection:
        connection.execute(
            text(f"UPDATE {table} SET updated_at = :time WHERE id = :id"), {"id": target, "time": original_time}
        )
    # A new dependent row is also protected, even if its parent is unchanged.
    dependent = "injection_lot" if kind == "experiment" else "specimen"
    parent_column = "batch_id" if kind == "experiment" else "clone_fish_id"
    with client.app.state.store.engine.begin() as connection:
        dependent_table = Table(dependent, MetaData(), autoload_with=connection)
        row = dict(
            connection.execute(
                text(f"SELECT * FROM {dependent} WHERE id = :id"),
                {"id": next(iter(ownership[dependent]))},
            )
            .mappings()
            .first()
        )
        row["id"] = uuid7()
        row[parent_column] = target
        row["lot_no" if kind == "experiment" else "specimen_code"] = "999" if kind == "experiment" else uuid7()
        row = {key: value for key, value in row.items() if dependent_table.c[key].computed is None}
        connection.execute(dependent_table.insert().values(**row))
    blocked = client.post(
        f"/api/v1/imports/{job_id}/revert",
        json={"revision": current["revision"], "reason": "Must preserve dependent work"},
    )
    assert blocked.status_code == 409 and blocked.json()["error"]["code"] == "revert_dependency", blocked.text
    with client.app.state.store.engine.begin() as connection:
        connection.execute(dependent_table.delete().where(dependent_table.c.id == row["id"]))
    reverted = client.post(
        f"/api/v1/imports/{job_id}/revert",
        json={"revision": current["revision"], "reason": "Acceptance: wrong source workbook"},
    )
    assert reverted.status_code == 200, reverted.text
    assert client.get(f"/api/v1/imports/{job_id}").json()["job"]["status"] == "reverted"
    for path, expected in before.items():
        assert client.get(f"/api/v1/{path}").json() == expected


def test_v5_aggregate_sql_transaction_and_unknown_treatment(import_client):
    from test_import_v5 import experiment

    from chronofish.services.import_v5 import EXPERIMENT

    client = import_client
    if getattr(client.app.state.store, "engine", None) is None:
        pytest.skip("historical aggregates require SQL")
    book = experiment()
    v5_master_data(client, book)
    s = book[EXPERIMENT]
    s["B13"] = "B" * 120 + uuid7()[-10:]
    s["E6"] = None
    s["H13"] = 120
    s["A68"], s["C68"], s["D68"], s["B68"] = 1, 120, 0, "Source label"
    before_batches = client.get("/api/v1/batches").json()
    before_kpi = client.get("/api/v1/analytics/kpi").json()
    before_r_export = client.get("/api/v1/exports/r-table").content
    created = v5_job(client, book, [EXPERIMENT])
    job_id = created["job"]["id"]
    for action in ("validate-template", "confirm-template"):
        response = client.post(f"/api/v1/imports/{job_id}/{action}", json={"revision": 1})
        assert response.status_code == 200, response.text
    assert client.get("/api/v1/batches").json() == before_batches
    assert client.get("/api/v1/analytics/kpi").json() == before_kpi
    assert client.get("/api/v1/exports/r-table").content == before_r_export
    assert scalar(client, "SELECT COUNT(*) FROM historical_lot WHERE import_job_id = :job", job_id) == 1
    imported = client.get(f"/api/v1/imports/{job_id}/records").json()["items"]
    assert all(row["status"] == "imported" for row in imported)
    assert scalar(client, "SELECT COUNT(*) FROM historical_stage_count WHERE import_job_id = :job", job_id) == 2
    assert (
        scalar(
            client,
            "SELECT n_alive FROM historical_stage_count WHERE import_job_id = :job AND stage_label = '1C'",
            job_id,
        )
        == 0
    )
    reverted = client.post(f"/api/v1/imports/{job_id}/revert", json={"revision": 2, "reason": "Wrong aggregate file"})
    assert reverted.status_code == 200, reverted.text
    for table in ("historical_stage_count", "historical_lot", "historical_experiment"):
        assert (
            scalar(client, f"SELECT COUNT(*) FROM {table} WHERE import_job_id = :job AND deleted_at IS NULL", job_id)
            == 0
        )
    assert client.get("/api/v1/batches").json() == before_batches


def test_schema_template_download_validate_and_atomic_commit(import_client):
    from test_import_template import records

    client = import_client
    suffix = uuid7()[-10:]
    master_values = [
        ("sites", {"code": f"T-{suffix}", "name": "Template site", "timeZone": "Asia/Bangkok"}),
        ("operators", {"name": f"Template operator {suffix}"}),
        (
            "donor-cell-lines",
            {"strain": "AB", "preparation": "DISSOCIATED", "preservation": "FRESH", "batchCode": suffix},
        ),
        ("treatment-groups", {"code": f"T-{suffix}", "name": "Template group", "armType": "SCNT"}),
    ]
    for resource, body in master_values:
        response = client.post(f"/api/v1/{resource}", json=body, headers={"X-Idempotency-Key": uuid7()})
        assert response.status_code == 201, response.text
    template = client.get("/api/v1/imports/template")
    assert template.status_code == 200
    assert "experiment-template-v5.xlsx" in template.headers["content-disposition"]
    from chronofish.domain.state import State
    from chronofish.services.import_template import template_bytes

    book = __import__("openpyxl").load_workbook(io.BytesIO(template_bytes(State.seeded())))
    from chronofish.services.import_template import SHEETS

    for record in records():
        name, values = record["sheet_name"], record["values"]
        for key, value in {
            "site": f"T-{suffix}",
            "operator": f"Template operator {suffix}",
            "observer": f"Template operator {suffix}",
            "donor_batch_code": suffix,
            "treatment_group": f"T-{suffix}",
            "batch_code": f"B-{suffix}",
            "fish_code": f"F-{suffix}",
            "specimen_code": f"CL-{suffix}",
        }.items():
            if key in values:
                values[key] = value
        if values.get("embryo_code"):
            values["embryo_code"] = f"B-{suffix}_1_1"
        book[name].append([values.get(column) for column in SHEETS[name]])
    output = io.BytesIO()
    book.save(output)
    # A failure in the final sheet must roll back batches, lots, embryos, fish and observations.
    before_fish = client.get("/api/v1/fish").json()
    before_batches = client.get("/api/v1/batches").json()
    type_column = SHEETS["specimen"].index("specimen_type") + 1
    book["specimen"].cell(2, type_column).value = "INVALID"
    invalid_output = io.BytesIO()
    book.save(invalid_output)
    invalid = create_job(client, invalid_output.getvalue(), sheets=list(SHEETS))
    failed = client.post(f"/api/v1/imports/{invalid['job']['id']}/confirm-template", json={"revision": 1})
    assert failed.status_code == 422, failed.text
    assert "specimen row 2" in failed.text
    assert client.get("/api/v1/fish").json() == before_fish
    assert client.get("/api/v1/batches").json() == before_batches
    job = create_job(client, output.getvalue(), sheets=list(SHEETS))
    job_id = job["job"]["id"]
    assert client.get(f"/api/v1/imports/{job_id}/mapping-requirements").json()["canConfirmTemplate"]
    before = client.get("/api/v1/fish").json()
    validation = client.post(f"/api/v1/imports/{job_id}/validate-template", json={"revision": 1})
    assert validation.status_code == 200, validation.text
    assert validation.json()["recordCount"] == 7
    assert client.get("/api/v1/fish").json() == before
    committed = client.post(f"/api/v1/imports/{job_id}/confirm-template", json={"revision": 1})
    assert committed.status_code == 200, committed.text
    assert committed.json()["status"] == "committed"
    assert client.post(f"/api/v1/imports/{job_id}/confirm-template", json={"revision": 1}).status_code == 409
    imported = client.get(f"/api/v1/imports/{job_id}/records").json()["items"]
    assert all(row["status"] == "imported" for row in imported)
    duplicate = create_job(client, output.getvalue(), sheets=list(SHEETS))
    response = client.post(f"/api/v1/imports/{duplicate['job']['id']}/confirm-template", json={"revision": 1})
    assert response.status_code == 422
    assert "already exists" in response.text


@pytest.fixture(params=["memory", "sql"])
def import_client(request):
    driver = "memory" if request.param == "memory" else os.getenv("CHRONOFISH_TEST_DATABASE_DRIVER")
    url = "" if driver == "memory" else os.getenv("CHRONOFISH_TEST_DATABASE_URL")
    if not driver or url is None:
        pytest.skip("integration database is not configured")
    config = Config(
        8080,
        "test",
        driver,
        url,
        (),
        (),
        Path(__file__).parents[1] / "db" / "migrations" / driver,
        1000,
        1000,
        bootstrap_admin_email=f"import-{uuid7()}@ku.th",
        session_cookie_secure=False,
    )
    store = MemoryStore() if driver == "memory" else SQLStore(config)
    mailer = RecordingMailer()
    with TestClient(create_app(config, store, mailer)) as client:
        assert client.post("/api/v1/auth/request-code", json={"email": config.bootstrap_admin_email}).status_code == 202
        code = re.search(r"\b\d{6}\b", mailer.messages[-1][2]).group()
        login = client.post(
            "/api/v1/auth/verify-code",
            headers={"X-Device-Id": "import-test"},
            json={"password": "correct horse battery staple", "email": config.bootstrap_admin_email, "code": code},
        )
        assert login.status_code == 200
        client.headers.update(
            {
                "X-Actor-User-Id": login.json()["user"]["id"],
                "X-Device-Id": "import-test",
                "X-Operator-Id": DEMO_OPERATOR_ID,
                "X-Idempotency-Key": uuid7(),
            }
        )
        yield client
    if driver != "memory":
        store.close()


def row(**cells):
    values = [None] * max(column_index_from_string(column) for column in cells)
    for column, value in cells.items():
        values[column_index_from_string(column) - 1] = value
    return values


def workbook(*, incomplete=False, invalid_stage=False):
    book = Workbook()
    sheet = book.active
    sheet.title = "V2Raw"
    sheet.append(row(B="DATE", AJ="Running number", AF="Activated time"))
    sheet.append(row(AJ="Observation time"))
    sheet.append(
        row(
            B=None if incomplete else "2026-04-29",
            C="KU eggs",
            W=uuid7(),
            AF="09:30",
            AJ=None if incomplete else 1,
            AL=2 if invalid_stage else 1,
            AM=0,
            D=3,
        )
    )
    sheet.append(row(AJ="Observation time", AL="10:30", AM="11:30"))
    sheet.append(row(AJ="Degenerated", AM=1))
    sheet.append(row(AJ="Observed Dead"))
    sheet.append(row(AJ="Nor/Ab"))
    content = io.BytesIO()
    book.save(content)
    return content.getvalue()


def create_job(client, content, sheets=None):
    response = client.post(
        "/api/v1/imports",
        files=[("files", ("source.xlsx", content, XLSX))],
        data={"selection": json.dumps({"sheets": sheets or ["V2Raw"]})},
    )
    assert response.status_code == 201, response.text
    return response.json()


def sql_required(client):
    if not getattr(client.app.state.store, "engine", None):
        pytest.skip("canonical confirm requires SQL")


def confirm_body(client, created, sheets=None):
    response = client.post(
        "/api/v1/sites",
        headers={"X-Idempotency-Key": uuid7()},
        json={"code": f"I-{uuid7()[-12:]}", "name": "Import test", "timeZone": "Asia/Bangkok"},
    )
    assert response.status_code == 201, response.text
    return {
        "revision": created["job"]["revision"],
        "siteMappings": {name: response.json()["id"] for name in sheets or ["V2Raw"]},
        "donorMappings": {},
        "embryoWarningBypassReason": "Reviewed source timing",
        "aggregateWarningBypassReason": "Reviewed counts",
        "zeroBypassReason": "Reviewed zeros",
    }


def scalar(client, query, job_id):
    with client.app.state.store.engine.connect() as connection:
        return connection.execute(text(query), {"job": job_id}).scalar_one()


def test_create_review_source_bytes_and_invalid_uploads(import_client):
    client = import_client
    content = workbook()
    inspected = client.post("/api/v1/imports/inspect", files={"files": ("source.xlsx", content, XLSX)})
    assert inspected.status_code == 200 and inspected.json()["files"][0]["sheets"] == ["V2Raw"]
    created = create_job(client, content)
    job_id = created["job"]["id"]
    assert client.get("/api/v1/imports").json()["items"]
    assert client.get(f"/api/v1/imports/{job_id}").json()["job"]["status"] == "draft"
    file_id = created["files"][0]["id"]
    downloaded = client.get(f"/api/v1/imports/{job_id}/files/{file_id}")
    assert downloaded.content == content
    assert downloaded.headers["cache-control"] == "no-store"
    records = client.get(f"/api/v1/imports/{job_id}/records").json()["items"]
    embryo = next(record for record in records if record["recordKind"] == "embryo_candidate")
    meaning = client.get(f"/api/v1/imports/{job_id}/records/{embryo['id']}/interpretation").json()["interpretation"]
    assert meaning["experimentDate"] == "2026-04-29"
    assert client.get(f"/api/v1/imports/{job_id}/issues").json()["items"] == []
    assert client.get(f"/api/v1/imports/{job_id}/mapping-requirements").json()["unresolvedIssueCount"] == 0
    for selection in ["not json", json.dumps({"sheets": ["missing"]}), json.dumps({"sheets": []})]:
        response = client.post(
            "/api/v1/imports", files={"files": ("source.xlsx", content, XLSX)}, data={"selection": selection}
        )
        assert 400 <= response.status_code < 500
    assert client.post("/api/v1/imports/inspect", files={"files": ("bad.xlsx", b"bad zip", XLSX)}).status_code == 422
    assert (
        client.post(
            "/api/v1/imports/inspect", files={"files": ("large.xlsx", b"0" * (25 * 1024 * 1024 + 1), XLSX)}
        ).status_code
        == 413
    )
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zipped:
        zipped.writestr("xl/workbook.xml", b"x" * (121 * 1024 * 1024))
    response = client.post("/api/v1/imports/inspect", files={"files": ("bomb.xlsx", archive.getvalue(), XLSX)})
    assert response.status_code == 422
    assert client.get(f"/api/v1/imports/{job_id}/records?limit=101").status_code == 400


def test_anonymous_and_member_cannot_import(import_client):
    client = import_client
    with TestClient(client.app) as anonymous:
        assert anonymous.get("/api/v1/imports").status_code == 401
    mailer = client.app.state.auth.mailer
    email = f"member-{uuid7()}@ku.th"
    assert client.post("/api/v1/auth/admin/users", json={"email": email}).status_code == 201
    with TestClient(client.app) as member:
        member.post("/api/v1/auth/request-code", json={"email": email})
        code = re.search(r"\b\d{6}\b", mailer.messages[-1][2]).group()
        login = member.post(
            "/api/v1/auth/verify-code",
            headers={"X-Device-Id": "member"},
            json={"password": "correct horse battery staple", "email": email, "code": code},
        ).status_code
        assert login == 200
        member.headers["X-Actor-User-Id"] = client.app.state.auth.repository.user_by_email(email)["id"]
        assert member.get("/api/v1/imports").status_code == 403
        assert (
            member.post("/api/v1/imports/inspect", files={"files": ("source.xlsx", workbook(), XLSX)}).status_code
            == 403
        )


def test_missing_identity_is_blocking_and_can_be_corrected(import_client):
    client = import_client
    created = create_job(client, workbook(incomplete=True))
    job_id = created["job"]["id"]
    issues = client.get(f"/api/v1/imports/{job_id}/issues").json()["items"]
    assert {issue["sourceColumn"] for issue in issues} == {"B", "AJ"}
    assert all(issue["severity"] == "blocking" and issue["recordId"] for issue in issues)
    assert client.get(f"/api/v1/imports/{job_id}/mapping-requirements").json()["unresolvedIssueCount"] == 2
    revision = 1
    for issue in issues:
        path = f"/api/v1/imports/{job_id}/issues/{issue['id']}"
        assert (
            client.post(
                f"{path}/decision", json={"revision": revision, "decision": "bypassed", "reason": "Ignore"}
            ).status_code
            == 400
        )
        value = "2026-04-29" if issue["sourceColumn"] == "B" else "1"
        if issue["sourceColumn"] == "B":
            assert (
                client.post(
                    f"{path}/correct-cell", json={"revision": revision, "value": "not a date", "reason": "Fix"}
                ).status_code
                == 409
            )
        fixed = client.post(
            f"{path}/correct-cell",
            json={"revision": revision, "value": value, "reason": "Verified against lab notebook"},
        )
        assert fixed.status_code == 200, fixed.text
        revision = fixed.json()["revision"]
    requirements = client.get(f"/api/v1/imports/{job_id}/mapping-requirements").json()
    assert requirements["unresolvedIssueCount"] == 0
    records = client.get(f"/api/v1/imports/{job_id}/records").json()["items"]
    embryo = next(record for record in records if record["recordKind"] == "embryo_candidate")
    assert "B" not in embryo["source"]["result"] and embryo["working"]["result"]["B"] == "2026-04-29"
    if getattr(client.app.state.store, "engine", None):
        created["job"]["revision"] = revision
        response = client.post(f"/api/v1/imports/{job_id}/confirm-all", json=confirm_body(client, created))
        assert response.status_code == 200, response.text


def test_confirm_revert_duplicate_revision_and_atomic_failure(import_client):
    client = import_client
    sql_required(client)
    content = workbook()
    created = create_job(client, content)
    job_id = created["job"]["id"]
    body = confirm_body(client, created)
    path = f"/api/v1/imports/{job_id}/confirm-all"
    assert client.post(path, json={**body, "revision": 2}).status_code == 409
    assert client.post(path, json={**body, "siteMappings": {}}).status_code == 409
    assert scalar(client, "SELECT COUNT(*) FROM historical_embryo WHERE import_job_id = :job", job_id) == 0
    assert client.get(f"/api/v1/imports/{job_id}").json()["job"]["revision"] == 1
    confirmed = client.post(path, json=body)
    assert confirmed.status_code == 200, confirmed.text
    assert (
        scalar(
            client, "SELECT COUNT(*) FROM historical_embryo WHERE import_job_id = :job AND deleted_at IS NULL", job_id
        )
        == 1
    )
    assert (
        scalar(
            client,
            "SELECT COUNT(*) FROM historical_observation o "
            "JOIN historical_embryo e ON e.id = o.historical_embryo_id WHERE e.import_job_id = :job",
            job_id,
        )
        == 2
    )
    assert (
        scalar(client, "SELECT COUNT(*) FROM audit_log WHERE record_id = :job AND table_name = 'import_job'", job_id)
        >= 1
    )
    duplicate = create_job(client, content)
    response = client.post(f"/api/v1/imports/{duplicate['job']['id']}/confirm-all", json=body)
    assert response.status_code == 409 and response.json()["error"]["code"] == "duplicate_embryo"
    assert (
        scalar(client, "SELECT COUNT(*) FROM historical_experiment WHERE import_job_id = :job", duplicate["job"]["id"])
        == 0
    )
    assert client.post(path, json={**body, "revision": 2}).status_code == 409
    revert_path = f"/api/v1/imports/{job_id}/revert"
    assert client.post(revert_path, json={"revision": 2, "reason": ""}).status_code == 400
    assert client.post(revert_path, json={"revision": 1, "reason": "Wrong source"}).status_code == 409
    reverted = client.post(revert_path, json={"revision": 2, "reason": "Wrong source"})
    assert reverted.status_code == 200, reverted.text
    for table in ("historical_embryo", "historical_lot", "historical_experiment"):
        assert (
            scalar(client, f"SELECT COUNT(*) FROM {table} WHERE import_job_id = :job AND deleted_at IS NULL", job_id)
            == 0
        )
    assert client.get(f"/api/v1/imports/{job_id}").json()["job"]["status"] == "reverted"
    assert client.post(revert_path, json={"revision": 3, "reason": "Again"}).status_code == 409


def test_parallel_confirmation_writes_once(import_client):
    client = import_client
    sql_required(client)
    created = create_job(client, workbook())
    job_id = created["job"]["id"]
    body = confirm_body(client, created)
    token = client.cookies.get("chronofish_session")

    def confirm(_):
        with TestClient(client.app) as browser:
            browser.cookies.set("chronofish_session", token)
            return browser.post(
                f"/api/v1/imports/{job_id}/confirm-all", json=body, headers=dict(client.headers)
            ).status_code

    with ThreadPoolExecutor(max_workers=6) as pool:
        statuses = list(pool.map(confirm, range(6)))
    assert sorted(statuses) == [200, 409, 409, 409, 409, 409]
    assert scalar(client, "SELECT COUNT(*) FROM historical_embryo WHERE import_job_id = :job", job_id) == 1


def test_customer_sheets_show_editable_issues_before_confirm(import_client):
    client = import_client
    filename = Path(__file__).parents[2] / "docs/examples/example_data/Experiment_Cloning_04_Raw data v2 (ongoing).xlsx"
    sheets = ["1)2026-04-24_June(Control)", "2) 2026-04-29_Jan(RK701)", "2)2026-04-29_June(RK-701)"]
    created = create_job(client, filename.read_bytes(), sheets)
    job_id = created["job"]["id"]
    issues = client.get(f"/api/v1/imports/{job_id}/issues?limit=100").json()["items"]
    missing = [issue for issue in issues if issue["code"] == "embryo_incomplete"]
    assert missing and all(issue["sheetName"] == sheets[1] and issue["sourceColumn"] == "AJ" for issue in missing)
    assert all(issue["recordId"] and issue["severity"] == "blocking" for issue in missing)
    requirements = client.get(f"/api/v1/imports/{job_id}/mapping-requirements").json()
    assert requirements["embryoWarningCount"] < 100
    assert requirements["unresolvedIssueCount"] >= len(missing)
    if getattr(client.app.state.store, "engine", None):
        response = client.post(f"/api/v1/imports/{job_id}/confirm-all", json=confirm_body(client, created, sheets))
        assert response.status_code == 409 and response.json()["error"]["code"] == "issues_open"
        assert scalar(client, "SELECT COUNT(*) FROM historical_embryo WHERE import_job_id = :job", job_id) == 0
        for sheet, count in [(sheets[0], 29), (sheets[2], 30)]:
            good = create_job(client, filename.read_bytes(), [sheet])
            response = client.post(
                f"/api/v1/imports/{good['job']['id']}/confirm-all", json=confirm_body(client, good, [sheet])
            )
            assert response.status_code == 200, response.text
            assert response.json()["components"]["embryos"]["historicalEmbryoCount"] == count
            assert (
                client.post(
                    f"/api/v1/imports/{good['job']['id']}/revert", json={"revision": 2, "reason": "Fixture cleanup"}
                ).status_code
                == 200
            )


@pytest.mark.parametrize("condition", ["Normal", "Abnormal", ""])
def test_fish_import_sets_registration_disability_after_migration(import_client, condition):
    client = import_client
    sql_required(client)
    book = Workbook()
    sheet = book.active
    sheet.title = "V2Fish"
    sheet.append(row(A="No", B="DOB", D="Donor", K="Condition"))
    number = int(uuid7().replace("-", "")[-12:], 16)
    sheet.append(row(A=number, B="2026-01-01", D="Import donor", K=condition))
    output = io.BytesIO()
    book.save(output)
    created = create_job(client, output.getvalue(), ["V2Fish"])
    body = confirm_body(client, created, ["V2Fish"])
    donor = client.post(
        "/api/v1/donor-cell-lines",
        headers={"X-Idempotency-Key": uuid7()},
        json={
            "strain": f"import-disability-{number}",
            "preparation": "DISSOCIATED",
            "preservation": "FRESH",
        },
    )
    assert donor.status_code == 201, donor.text
    body["donorMappings"] = {"Import donor": donor.json()["id"]}
    confirmed = client.post(f"/api/v1/imports/{created['job']['id']}/confirm-fish-specimens", json=body)
    assert confirmed.status_code == 200, confirmed.text
    with client.app.state.store.engine.connect() as connection:
        record = (
            connection.execute(
                text("SELECT id, is_disabled, disability_at_registration FROM clone_fish WHERE import_job_id = :job"),
                {"job": created["job"]["id"]},
            )
            .mappings()
            .one()
        )
    disabled = condition == "Abnormal"
    assert bool(record["disability_at_registration"]) is disabled
    assert bool(record["is_disabled"]) is disabled
    fish = client.get(f"/api/v1/fish/{record['id']}").json()
    assert fish["isDisabled"] is disabled
    assert fish["condition"] == ("ABNORMAL" if disabled else "NORMAL" if condition else "UNDETERMINED")
