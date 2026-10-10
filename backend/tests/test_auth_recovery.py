from __future__ import annotations

import os
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi import BackgroundTasks
from fastapi.testclient import TestClient
from sqlalchemy import text

from chronofish.app import create_app
from chronofish.config import Config
from chronofish.runtime.errors import APIError
from chronofish.runtime.values import uuid7
from chronofish.services.auth import LOGIN_LOCK_ALERT_SUBJECT
from chronofish.services.mail import RecordingMailer
from chronofish.store import MemoryStore
from chronofish.store.auth import AuthRepository
from chronofish.store.migrations import _execute_script
from chronofish.store.sql import SQLStore


@pytest.fixture(params=["memory", "sql"])
def recovery_repository(request):
    if request.param == "memory":
        store = MemoryStore()
    else:
        driver = os.getenv("CHRONOFISH_TEST_DATABASE_DRIVER")
        url = os.getenv("CHRONOFISH_TEST_DATABASE_URL")
        if not driver or not url:
            pytest.skip("integration database is not configured")
        config = Config(
            8080, "test", driver, url, (), (), Path(__file__).parents[1] / "db" / "migrations" / driver, 3, 1
        )
        store = SQLStore(config)
    repository = AuthRepository(store, "test-secret")
    yield repository
    if request.param == "sql":
        store.close()


def verify(repository, email, code, now):
    return repository.verify_and_create_session(
        email, repository.code_hash(email, code), uuid7(), repository.token_hash(uuid7()), "test-device", now
    )


def test_rolling_window_and_concurrent_cap(recovery_repository):
    repository = recovery_repository
    now = datetime(2026, 10, 1, tzinfo=UTC)
    email = f"rolling-{uuid7()}@ku.th"
    repository.ensure_bootstrap(email, now)
    # One early failure expires; ten failures just before the old fixed boundary remain.
    for minute, attempts in [(0, 1), (1420, 5), (1431, 5), (1442, 4)]:
        at = now + timedelta(minutes=minute)
        assert repository.issue_code(email, repository.code_hash(email, "123456"), at)
        for index in range(attempts):
            result = verify(repository, email, "999999", at + timedelta(seconds=index + 1))
            assert result.user is None and not result.lock_reached
    at += timedelta(seconds=10)
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: verify(repository, email, "999999", at), range(8)))
    assert sum(result.lock_reached for result in results) == 1
    user = repository.user_by_email(email)
    listed = next(u for u in repository.list_users(at) if u["email"] == email)
    assert listed["loginLockedUntil"] == (at + timedelta(days=1)).isoformat().replace("+00:00", "Z")
    assert not repository.issue_code(email, repository.code_hash(email, "123456"), at + timedelta(hours=23))
    assert repository.issue_code(email, repository.code_hash(email, "123456"), at + timedelta(days=1))
    assert verify(repository, email, "123456", at + timedelta(days=1, seconds=1)).user
    assert (
        next(u for u in repository.list_users(at + timedelta(days=1)) if u["email"] == email)["loginLockedUntil"]
        is None
    )
    # Authenticated success resets the rolling history, not only the lock deadline.
    at += timedelta(days=1, minutes=11)
    assert repository.issue_code(email, repository.code_hash(email, "123456"), at)
    assert not verify(repository, email, "999999", at + timedelta(seconds=1)).lock_reached
    repository.unlock_user(user["id"], user, at + timedelta(seconds=2))
    assert verify(repository, email, "123456", at + timedelta(seconds=3)).user is None
    assert repository.issue_code(email, repository.code_hash(email, "123456"), at + timedelta(seconds=3))
    assert verify(repository, email, "123456", at + timedelta(seconds=4)).user


def test_delivery_failure_expires_only_matching_code(recovery_repository):
    repository = recovery_repository
    now = datetime(2026, 10, 1, tzinfo=UTC)
    email = f"delivery-{uuid7()}@ku.th"
    repository.ensure_bootstrap(email, now)
    first = repository.code_hash(email, "123456")
    second = repository.code_hash(email, "654321")
    assert repository.issue_code(email, first, now)
    repository.expire_failed_delivery(email, first, now)
    assert repository.issue_code(email, second, now)
    repository.expire_failed_delivery(email, first, now)
    assert verify(repository, email, "654321", now).user
    with pytest.raises(APIError, match="User was not found"):
        repository.unlock_user(uuid7(), {"id": uuid7(), "email": email}, now)


def test_recovery_migration_down_up_retains_accounts(recovery_repository):
    repository = recovery_repository
    if repository.engine is None:
        pytest.skip("SQL migration only")
    email = f"migration-{uuid7()}@ku.th"
    now = datetime(2026, 10, 1, tzinfo=UTC)
    repository.ensure_bootstrap(email, now)
    assert repository.issue_code(email, repository.code_hash(email, "123456"), now)
    verify(repository, email, "999999", now + timedelta(seconds=1))
    driver = os.environ["CHRONOFISH_TEST_DATABASE_DRIVER"]
    directory = Path(__file__).parents[1] / "db" / "migrations" / driver
    with repository.engine.begin() as connection:
        for direction in ("down", "up"):
            _execute_script(
                connection, (directory / f"000024_auth_lock_recovery.{direction}.sql").read_text(encoding="utf-8")
            )
        assert (
            connection.execute(text("SELECT email FROM auth_user WHERE email = :email"), {"email": email}).scalar_one()
            == email
        )
    assert verify(repository, email, "123456", now + timedelta(seconds=2)).user


def test_http_smtp_retry_and_sole_admin_recovery(recovery_repository, monkeypatch):
    store = recovery_repository.store
    email = f"http-{uuid7()}@ku.th"
    config = Config(
        8080,
        "test",
        "memory",
        "",
        (),
        (),
        Path("."),
        1000,
        1000,
        bootstrap_admin_email=email,
        session_cookie_secure=False,
    )
    mailer = RecordingMailer()
    current = [datetime(2026, 10, 1, tzinfo=UTC)]
    monkeypatch.setattr("chronofish.services.auth.utc_now", lambda: current[0])
    monkeypatch.setattr("chronofish.api.routes.auth.utc_now", lambda: current[0])
    with TestClient(create_app(config, store, mailer)) as browser:
        send = mailer.send

        def smtp_failure(*args):
            raise OSError("SMTP unavailable")

        monkeypatch.setattr(mailer, "send", smtp_failure)
        assert browser.post("/api/v1/auth/request-code", json={"email": email}).status_code == 202
        monkeypatch.setattr(mailer, "send", send)
        assert browser.post("/api/v1/auth/request-code", json={"email": email}).status_code == 202
        code = re.search(r"\b\d{6}\b", mailer.messages[-1][2]).group()
        signed_in = browser.post(
            "/api/v1/auth/verify-code", headers={"X-Device-Id": "owner"}, json={"email": email, "code": code}
        )
        assert signed_in.status_code == 200
        user_id = signed_in.json()["user"]["id"]
        for _ in range(3):
            current[0] += timedelta(minutes=11)
            assert browser.post("/api/v1/auth/request-code", json={"email": email}).status_code == 202
            code = re.search(r"\b\d{6}\b", mailer.messages[-1][2]).group()
            wrong = "999999" if code != "999999" else "000000"
            for _ in range(5):
                response = browser.post(
                    "/api/v1/auth/verify-code",
                    headers={"X-Device-Id": "attacker"},
                    json={"email": email, "code": wrong},
                )
                assert response.status_code == 401
        users = browser.get("/api/v1/auth/admin/users").json()["items"]
        assert next(u for u in users if u["id"] == user_id)["loginLockedUntil"]
        assert browser.post(f"/api/v1/auth/admin/users/{user_id}/unlock", json={}).status_code == 204
        assert browser.post("/api/v1/auth/request-code", json={"email": email}).status_code == 202
        code = re.search(r"\b\d{6}\b", mailer.messages[-1][2]).group()
        assert (
            browser.post(
                "/api/v1/auth/verify-code", headers={"X-Device-Id": "owner"}, json={"email": email, "code": code}
            ).status_code
            == 200
        )


def test_alert_is_deferred_and_sent_to_every_active_admin(client, caplog):
    auth = client.app.state.auth
    repository = auth.repository
    email = "peerapas.c@ku.th"
    challenge = repository.store.auth_challenges[email]
    now = datetime.now(UTC)
    repository.ensure_bootstrap("backup@ku.th", now)
    repository.ensure_bootstrap("inactive@ku.th", now)
    inactive = next(u for u in repository.store.auth_users.values() if u["email"] == "inactive@ku.th")
    inactive["active"] = False
    challenge.update(
        code_hash=repository.code_hash(email, "123456"),
        expires_at=now + timedelta(minutes=10),
        attempts=0,
        failures=[now] * 14,
        failed_count=14,
    )
    tasks = BackgroundTasks()
    sent = len(auth.mailer.messages)
    with pytest.raises(APIError):
        auth.verify_code({"email": email, "code": "999999"}, "device", tasks)
    assert len(auth.mailer.messages) == sent
    assert len(tasks.tasks) == 1
    task = tasks.tasks[0]
    task.func(*task.args, **task.kwargs)
    alerts = [message for message in auth.mailer.messages if message[1] == LOGIN_LOCK_ALERT_SUBJECT]
    assert {message[0] for message in alerts} == {email, "backup@ku.th"}
    assert "locked" in caplog.text
    # No bootstrap configuration is needed for alerting; no admins still produces a log.
    for user in repository.store.auth_users.values():
        user["active"] = False
    auth.alert_login_lock(email)
    assert "No active administrator" in caplog.text


def test_alert_failure_does_not_prevent_other_recipients(client, monkeypatch, caplog):
    auth = client.app.state.auth
    auth.repository.ensure_bootstrap("backup@ku.th", datetime.now(UTC))
    send = auth.mailer.send

    def partial_failure(email, subject, message):
        if email == "peerapas.c@ku.th":
            raise OSError("SMTP failure")
        send(email, subject, message)

    monkeypatch.setattr(auth.mailer, "send", partial_failure)
    auth.alert_login_lock("member@ku.th")
    assert auth.mailer.messages[-1][0] == "backup@ku.th"
    assert "alert delivery failed" in caplog.text


def test_unlock_requires_admin_and_is_audited(client):
    auth = client.app.state.auth
    actor = client.get("/api/v1/auth/me").json()["user"]
    response = client.post(f"/api/v1/auth/admin/users/{actor['id']}/unlock", json={})
    assert response.status_code == 204
    assert any(a.get("newValues", {}).get("loginUnlockedAt") for a in auth.repository.store.state.audits)
    user = next(u for u in auth.repository.store.auth_users.values() if u["id"] == actor["id"])
    user["role"] = "member"
    assert client.post(f"/api/v1/auth/admin/users/{actor['id']}/unlock", json={}).status_code == 403
    client.cookies.clear()
    assert client.post(f"/api/v1/auth/admin/users/{actor['id']}/unlock", json={}).status_code == 401
