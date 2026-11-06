from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from chronofish.runtime.errors import APIError
from chronofish.runtime.values import utc_now


def test_password_setup_does_not_create_accounts(client):
    browser = TestClient(client.app)
    for path in ("register", "password/request-code"):
        response = browser.post(
            f"/api/v1/auth/{path}", json={"email": "unknown@example.org", "password": "test-password"}
        )
        assert response.status_code == 202
    assert client.app.state.auth.repository.user_by_email("unknown@example.org") is None
    browser.close()


def test_admin_can_invite_external_domain(client):
    response = client.post("/api/v1/auth/admin/users", json={"email": "Researcher@Example.org"})
    assert response.status_code == 201
    assert response.json()["user"]["email"] == "researcher@example.org"


def test_idle_session_expires_at_twelve_hours_and_passive_sync_cannot_extend_it(client):
    repository = client.app.state.auth.repository
    token_hash = repository.token_hash(client.cookies.get("chronofish_session"))
    session = repository.store.auth_sessions[token_hash]
    start = utc_now()
    session["last_seen_at"] = start
    assert repository.authenticate(token_hash, start + timedelta(hours=11, minutes=59), touch=False)
    assert session["last_seen_at"] == start
    assert repository.authenticate(token_hash, start + timedelta(hours=12), touch=False) is None


def test_recent_activity_extends_idle_session(client):
    repository = client.app.state.auth.repository
    token_hash = repository.token_hash(client.cookies.get("chronofish_session"))
    start = utc_now()
    repository.store.auth_sessions[token_hash]["last_seen_at"] = start
    assert repository.authenticate(token_hash, start + timedelta(hours=11))
    assert repository.authenticate(token_hash, start + timedelta(hours=22), touch=False)
    assert repository.authenticate(token_hash, start + timedelta(hours=23), touch=False) is None


def test_admin_can_test_mail_and_delivery_error_is_actionable(client, monkeypatch):
    response = client.post("/api/v1/auth/admin/mail-settings/test", json={})
    assert response.status_code == 200
    assert client.app.state.auth.mailer.messages[-1][0] == "peerapas.c@ku.th"
    import smtplib

    def fail(*args):
        raise smtplib.SMTPAuthenticationError(535, b"credentials rejected")

    monkeypatch.setattr(client.app.state.auth.mailer, "send", fail)
    response = client.post("/api/v1/auth/admin/mail-settings/test", json={})
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "email_authentication_failed"
    assert "credentials rejected" not in response.text


def test_mail_test_explains_an_untrusted_smtp_certificate(client, monkeypatch):
    import ssl

    def fail(*args):
        raise ssl.SSLCertVerificationError(1, "self-signed certificate in certificate chain")

    monkeypatch.setattr(client.app.state.auth.mailer, "send", fail)
    response = client.post("/api/v1/auth/admin/mail-settings/test", json={})
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "email_tls_verification_failed"
    assert "CA" in response.json()["error"]["message"]


@pytest.mark.parametrize("email", ["a..b@example.org", "a" * 250 + "@example.org"])
def test_repository_invitation_uses_the_same_email_validation(client, email):
    repository = client.app.state.auth.repository
    with pytest.raises(APIError) as error:
        repository.invite_user(email, {"id": "unused"}, utc_now())
    assert error.value.code == "invalid_email"
