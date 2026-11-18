"""Sign-in policy: pure decisions for one-time codes, password lockout, and session lifetime.

No I/O and no clock: callers load the records, pass ``now``, and persist what comes back.
Challenge/user records use the ``auth_login_challenge`` / ``auth_user`` column names.
"""

from __future__ import annotations

import hmac
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from ..runtime.errors import APIError

IDLE_TTL = timedelta(hours=12)
SESSION_TOUCH_INTERVAL = timedelta(minutes=1)
ABSOLUTE_TTL = timedelta(days=90)
OTP_TTL = timedelta(minutes=10)
OTP_COOLDOWN = timedelta(seconds=60)
OTP_WINDOW = timedelta(hours=1)
OTP_MAX_SENDS = 5
OTP_MAX_ATTEMPTS = 5
OTP_DAILY_MAX_FAILURES = 15
OTP_DAILY_WINDOW = timedelta(days=1)
PASSWORD_MAX_ATTEMPTS = 5
PASSWORD_LOCK = timedelta(minutes=15)


def as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=value.tzinfo or UTC).astimezone(UTC)


def locked_until(challenge: Mapping[str, Any] | None, now: datetime) -> datetime | None:
    if not challenge:
        return None
    until = challenge.get("locked_until")
    if until is None and int(challenge["failed_count"]) >= OTP_DAILY_MAX_FAILURES:
        until = as_utc(challenge["failed_window_started_at"]) + OTP_DAILY_WINDOW
    return as_utc(until) if until and as_utc(until) > as_utc(now) else None


def code_still_usable(challenge: Mapping[str, Any], now: datetime) -> bool:
    return bool(
        challenge["code_hash"]
        and as_utc(now) < as_utc(challenge["expires_at"])
        and int(challenge["attempts"]) < OTP_MAX_ATTEMPTS
    )


def plan_code_issue(challenge: Mapping[str, Any] | None, digest: str, now: datetime) -> dict[str, Any] | None:
    """Return the challenge fields to persist for a new code, or None when no code may be sent."""
    now = as_utc(now)
    window_started_at, sends = now, 0
    if challenge:
        if locked_until(challenge, now):
            return None
        if now - as_utc(challenge["last_sent_at"]) < OTP_COOLDOWN:
            raise APIError(429, "otp_cooldown", "Wait before requesting another code")
        if code_still_usable(challenge, now):
            return None
        window_started_at, sends = as_utc(challenge["window_started_at"]), int(challenge["send_count"])
        if now - window_started_at >= OTP_WINDOW:
            window_started_at, sends = now, 0
        if sends >= OTP_MAX_SENDS:
            raise APIError(429, "otp_rate_limited", "Too many codes requested for this email")
    return {
        "code_hash": digest,
        "expires_at": now + OTP_TTL,
        "attempts": 0,
        "last_sent_at": now,
        "window_started_at": window_started_at,
        "send_count": sends + 1,
    }


def recent_failures(challenge: Mapping[str, Any], recorded: list[datetime], now: datetime) -> list[datetime]:
    # Older deployments recorded a count and window start, not individual timestamps.
    if not recorded and int(challenge["failed_count"]):
        recorded = [challenge["failed_window_started_at"]] * min(int(challenge["failed_count"]), OTP_DAILY_MAX_FAILURES)
    return [at for at in recorded if as_utc(at) > as_utc(now) - OTP_DAILY_WINDOW]


@dataclass(frozen=True)
class CodeCheck:
    status: str  # "rejected" (unusable/locked), "wrong", or "accepted"
    challenge: dict[str, Any] | None = None  # fields to persist
    failures: list[datetime] | None = None  # wrong code: every failure inside the daily window, newest last
    lock_reached: bool = False


def check_code(
    challenge: Mapping[str, Any],
    recorded: list[datetime],
    digest: str,
    now: datetime,
    *,
    has_password: bool,
) -> CodeCheck:
    if locked_until(challenge, now) or not code_still_usable(challenge, now):
        return CodeCheck("rejected")
    if not hmac.compare_digest(str(challenge["code_hash"]), digest):
        failures = [*recent_failures(challenge, recorded, now), now]
        reached = len(failures) == OTP_DAILY_MAX_FAILURES
        return CodeCheck(
            "wrong",
            {
                "attempts": int(challenge["attempts"]) + 1,
                "failed_count": len(failures),
                "failed_window_started_at": min(failures, key=as_utc),
                "locked_until": as_utc(now) + OTP_DAILY_WINDOW if reached else None,
            },
            failures,
            reached,
        )
    if not has_password:
        raise APIError(400, "password_required", "Set a password to complete email verification")
    return CodeCheck(
        "accepted",
        {
            "code_hash": "",
            "expires_at": now,
            "attempts": 0,
            "failed_count": 0,
            "locked_until": None,
            "failed_window_started_at": now,
        },
    )


def password_locked(user: Mapping[str, Any], now: datetime) -> bool:
    until = user.get("password_locked_until")
    return bool(until and as_utc(now) < as_utc(until))


def may_password_login(user: Mapping[str, Any] | None, now: datetime) -> bool:
    return bool(user and user["active"] and user["verified_at"] and not password_locked(user, now))


def password_lockout(user: Mapping[str, Any], accepted: bool, now: datetime) -> dict[str, Any] | None:
    """Return the attempt counter and lock to persist, or None while the account is locked."""
    if password_locked(user, now):
        return None
    attempts = 0
    if not accepted:
        # An expired lock restarts the count.
        attempts = (0 if user.get("password_locked_until") else int(user.get("password_attempts") or 0)) + 1
    return {
        "password_attempts": attempts,
        "password_locked_until": as_utc(now) + PASSWORD_LOCK if attempts >= PASSWORD_MAX_ATTEMPTS else None,
    }


def session_expired(last_seen_at: datetime, absolute_expires_at: datetime, now: datetime) -> bool:
    return as_utc(now) - as_utc(last_seen_at) >= IDLE_TTL or as_utc(now) >= as_utc(absolute_expires_at)


def session_needs_touch(last_seen_at: datetime, now: datetime) -> bool:
    return as_utc(now) - as_utc(last_seen_at) >= SESSION_TOUCH_INTERVAL
