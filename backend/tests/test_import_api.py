from __future__ import annotations

import io
import json
import os
import re
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook
from openpyxl.utils.cell import column_index_from_string
from sqlalchemy import text

from chronofish.app import create_app
from chronofish.config import Config
from chronofish.domain.state import DEMO_OPERATOR_ID
from chronofish.runtime.values import uuid7
from chronofish.services.mail import RecordingMailer
from chronofish.store import MemoryStore
from chronofish.store.sql import SQLStore

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


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
            json={"email": config.bootstrap_admin_email, "code": code},
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
            "/api/v1/auth/verify-code", headers={"X-Device-Id": "member"}, json={"email": email, "code": code}
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
