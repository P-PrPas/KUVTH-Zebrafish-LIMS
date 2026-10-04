from __future__ import annotations

import smtplib
import ssl
from email.message import EmailMessage
from typing import Protocol

from ..config import Config


class Mailer(Protocol):
    @property
    def configured(self) -> bool: ...

    def send(self, recipient: str, subject: str, text_body: str) -> None: ...


class SMTPMailer:
    def __init__(self, config: Config, sender_email: str | None = None) -> None:
        self.config = config
        self.sender_email = sender_email or config.mail_sender_email

    @property
    def configured(self) -> bool:
        return bool(self.config.mail_smtp_host and self.sender_email)

    def send(self, recipient: str, subject: str, text_body: str) -> None:
        if not self.configured:
            raise RuntimeError("Email delivery is not configured")
        message = EmailMessage()
        message["From"] = self.sender_email
        message["To"] = recipient
        message["Subject"] = subject
        message.set_content(text_body)
        context = ssl.create_default_context()
        if self.config.mail_use_ssl:
            connection = smtplib.SMTP_SSL(
                self.config.mail_smtp_host, self.config.mail_smtp_port, context=context, timeout=15
            )
        else:
            connection = smtplib.SMTP(self.config.mail_smtp_host, self.config.mail_smtp_port, timeout=15)
            connection.starttls(context=context)
        try:
            if self.config.mail_smtp_username:
                connection.login(self.config.mail_smtp_username, self.config.mail_smtp_password)
            connection.send_message(message)
        finally:
            connection.quit()


class RecordingMailer:
    """In-memory delivery adapter for API tests; never used by the runtime."""

    def __init__(self, sender_email: str = "peerapas.c@ku.th") -> None:
        self.sender_email = sender_email
        self.messages: list[tuple[str, str, str]] = []

    @property
    def configured(self) -> bool:
        return True

    def send(self, recipient: str, subject: str, text_body: str) -> None:
        self.messages.append((recipient, subject, text_body))
