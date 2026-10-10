from __future__ import annotations

import logging
import secrets
from datetime import datetime
from typing import Any

from ..config import Config
from ..runtime.errors import APIError
from ..runtime.values import utc_now, uuid7
from ..store.auth import AuthRepository
from .mail import Mailer

SESSION_COOKIE = "chronofish_session"
SESSION_COOKIE_MAX_AGE = 90 * 24 * 60 * 60
LOGGER = logging.getLogger("chronofish.auth")


def _email(value: Any) -> str:
    if not isinstance(value, str):
        raise APIError(400, "invalid_email", "Enter a valid @ku.th email address")
    email = value.strip().lower()
    if (
        len(email) > 254
        or email.count("@") != 1
        or not email.endswith("@ku.th")
        or any(char.isspace() for char in email)
    ):
        raise APIError(400, "invalid_email", "Only a valid @ku.th email address is allowed")
    local = email.partition("@")[0]
    if not local or local.startswith(".") or local.endswith(".") or ".." in local:
        raise APIError(400, "invalid_email", "Enter a valid @ku.th email address")
    return email


class AuthService:
    def __init__(self, config: Config, store: Any, mailer: Mailer) -> None:
        self.config = config
        self.repository = AuthRepository(store, config.auth_secret)
        self.mailer = mailer
        if config.bootstrap_admin_email:
            self.repository.ensure_bootstrap(config.bootstrap_admin_email, utc_now())

    def validate_code_request(self, body: dict[str, Any]) -> str:
        email = _email(body.get("email"))
        if not self.mailer.configured:
            raise APIError(503, "email_unavailable", "Email delivery is not configured on this server")
        return email

    def deliver_code(self, email: str) -> None:
        try:
            self._deliver_code(email)
        except APIError as error:
            if error.status == 429:
                LOGGER.info("Sign-in code request throttled")
            else:
                LOGGER.exception("Sign-in code delivery failed")
        except Exception:
            LOGGER.exception("Sign-in code delivery failed")

    def _deliver_code(self, email: str) -> None:
        code = f"{secrets.randbelow(1_000_000):06d}"
        accepted = self.repository.issue_code(email, self.repository.code_hash(email, code), utc_now())
        if not accepted:
            return
        self._send(
            email,
            "Your KUVACB sign-in code",
            f"Your one-time sign-in code is {code}.\n\nIt expires in 10 minutes and can only be used once.",
        )

    def verify_code(self, body: dict[str, Any], device_id: str) -> tuple[dict[str, Any], str]:
        email = _email(body.get("email"))
        code = body.get("code")
        if not isinstance(code, str) or len(code) != 6 or not code.isdigit():
            raise APIError(400, "invalid_code", "Enter the six-digit code from your email")
        if not device_id or len(device_id) > 64 or any(char in device_id for char in "\r\n"):
            raise APIError(400, "invalid_device", "Device id is invalid")
        token = secrets.token_urlsafe(48)
        user, alert_admin = self.repository.verify_and_create_session(
            email=email,
            digest=self.repository.code_hash(email, code),
            session_id=uuid7(),
            token_hash=self.repository.token_hash(token),
            device_id=device_id,
            now=utc_now(),
        )
        if alert_admin and self.config.bootstrap_admin_email:
            try:
                self._send(
                    self.config.bootstrap_admin_email,
                    "KUVACB sign-in attempts blocked",
                    f"Sign-in verification for {email} reached 15 incorrect attempts in 24 hours. "
                    "Please contact the member and investigate before the limit resets.",
                )
            except APIError:
                LOGGER.exception("Sign-in attempt alert delivery failed")
        if not user:
            raise APIError(401, "code_invalid", "The code is invalid or expired. Request a new code and try again.")
        return self.public_user(user), token

    def authenticate(self, cookie: str | None, now: datetime | None = None) -> dict[str, Any] | None:
        if not cookie:
            return None
        user = self.repository.authenticate(self.repository.token_hash(cookie), now or utc_now())
        return self.public_user(user) if user else None

    def logout(self, cookie: str | None) -> None:
        if cookie:
            self.repository.revoke_token(self.repository.token_hash(cookie), utc_now())

    def invite(self, body: dict[str, Any], actor: dict[str, Any]) -> tuple[dict[str, Any], bool]:
        email = _email(body.get("email"))
        if not self.mailer.configured:
            raise APIError(503, "email_unavailable", "Configure SMTP before inviting members")
        user = self.repository.invite_user(email, actor, utc_now())
        try:
            self.resend_invitation(user)
        except APIError:
            LOGGER.exception("Invitation email delivery failed")
            return self.public_user(user), False
        return self.public_user(user), True

    def resend_invitation(self, user: dict[str, Any]) -> None:
        if not self.mailer.configured:
            raise APIError(503, "email_unavailable", "Configure SMTP before inviting members")
        self._send(
            user["email"],
            "You are invited to KUVACB AqLIMS",
            "You have been invited to join the Kasetsart University Animal Cell Bank research workspace.\n\n"
            f"Open {self.config.app_base_url} and sign in with this email address. "
            "A one-time code will be sent to you.",
        )

    def _send(self, recipient: str, subject: str, message: str) -> None:
        sender_email = self.repository.sender_email(self.config.mail_sender_email)
        if hasattr(self.mailer, "sender_email"):
            self.mailer.sender_email = sender_email
        try:
            self.mailer.send(recipient, subject, message)
        except Exception as error:
            raise APIError(
                503, "email_delivery_failed", "The email could not be sent. Check the mail server settings."
            ) from error

    @staticmethod
    def public_user(user: dict[str, Any] | None) -> dict[str, Any]:
        if user is None:
            return {}
        return {
            "id": str(user.get("id")),
            "email": user.get("email"),
            "role": user.get("role"),
            "operatorId": user.get("operator_id", user.get("operatorId")),
            "sessionId": user.get("sessionId"),
            "deviceId": user.get("device_id", user.get("deviceId")),
        }
