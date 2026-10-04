from __future__ import annotations

from pathlib import Path

import pytest

from chronofish.config import Config
from chronofish.services.mail import SMTPMailer


@pytest.mark.parametrize("use_starttls", (False, True))
def test_smtp_starttls_is_optional_for_local_mail_catchers(monkeypatch, use_starttls):
    calls: list[str] = []

    class FakeSMTP:
        def __init__(self, *_args, **_kwargs):
            calls.append("connect")

        def starttls(self, **_kwargs):
            calls.append("starttls")

        def send_message(self, _message):
            calls.append("send")

        def quit(self):
            calls.append("quit")

    monkeypatch.setattr("chronofish.services.mail.smtplib.SMTP", FakeSMTP)
    config = Config(
        8080,
        "test",
        "memory",
        "",
        (),
        (),
        Path("."),
        10,
        5,
        mail_smtp_host="localhost",
        mail_sender_email="sender@ku.th",
        mail_use_starttls=use_starttls,
    )
    SMTPMailer(config).send("member@ku.th", "Sign in", "Your code")
    assert calls == (["connect", "starttls", "send", "quit"] if use_starttls else ["connect", "send", "quit"])
