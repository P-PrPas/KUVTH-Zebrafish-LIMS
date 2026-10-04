from __future__ import annotations

import hashlib
import hmac
import threading
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import text

from ..runtime.errors import APIError
from ..runtime.values import uuid7

IDLE_TTL = timedelta(days=30)
ABSOLUTE_TTL = timedelta(days=90)
OTP_TTL = timedelta(minutes=10)
OTP_COOLDOWN = timedelta(seconds=60)
OTP_WINDOW = timedelta(hours=1)
OTP_MAX_SENDS = 5
OTP_MAX_ATTEMPTS = 5
SYNC_STALE_AFTER = timedelta(minutes=10)


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=value.tzinfo or UTC).astimezone(UTC)


def _stored(value: datetime) -> datetime:
    return _utc(value).replace(tzinfo=None)


def _iso(value: datetime | str | None) -> str | None:
    if value is None:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00")) if isinstance(value, str) else value
    return _utc(parsed).isoformat().replace("+00:00", "Z")


def _user_payload(row: Any) -> dict[str, Any]:
    get = row.__getitem__ if hasattr(row, "__getitem__") else lambda key: getattr(row, key)
    return {
        "id": str(get("id")),
        "email": str(get("email")),
        "role": str(get("role")),
        "active": bool(get("active")),
        "verifiedAt": _iso(get("verified_at")),
        "invitedAt": _iso(get("invited_at")),
        "operatorId": str(get("operator_id")) if get("operator_id") else None,
    }


class AuthRepository:
    """Persistence seam for credentials, sessions, memberships, and device sync status."""

    def __init__(self, store: Any, secret: str) -> None:
        self.store = store
        self.secret = secret.encode()
        self.engine = getattr(store, "engine", None)
        self.lock: threading.RLock | None = getattr(store, "lock", None)
        if self.engine is None:
            store.auth_users = getattr(store, "auth_users", {})
            store.auth_challenges = getattr(store, "auth_challenges", {})
            store.auth_sessions = getattr(store, "auth_sessions", {})
            store.auth_sync = getattr(store, "auth_sync", {})
            store.auth_settings = getattr(store, "auth_settings", {})

    def code_hash(self, email: str, code: str) -> str:
        return hmac.new(self.secret, f"{email}\0{code}".encode(), hashlib.sha256).hexdigest()

    def token_hash(self, token: str) -> str:
        return hashlib.sha256(token.encode()).hexdigest()

    def ensure_bootstrap(self, email: str, now: datetime) -> None:
        email = email.strip().lower()
        if self.engine is None:
            with self.lock:
                existing = next((user for user in self.store.auth_users.values() if user["email"] == email), None)
                if existing is None:
                    user_id = uuid7()
                    self.store.auth_users[user_id] = {
                        "id": user_id,
                        "email": email,
                        "role": "admin",
                        "active": True,
                        "verified_at": None,
                        "invited_at": now,
                        "operator_id": None,
                        "created_at": now,
                        "updated_at": now,
                    }
            return
        with self.engine.begin() as connection:
            existing = connection.execute(
                text("SELECT id FROM auth_user WHERE email = :email"), {"email": email}
            ).first()
            if existing is None:
                connection.execute(
                    text(
                        "INSERT INTO auth_user (id, email, role, active, invited_at, created_at, updated_at) "
                        "VALUES (:id, :email, 'admin', :active, :now, :now, :now)"
                    ),
                    {"id": uuid7(), "email": email, "active": True, "now": _stored(now)},
                )

    def user_by_email(self, email: str) -> dict[str, Any] | None:
        if self.engine is None:
            with self.lock:
                user = next((u for u in self.store.auth_users.values() if u["email"] == email), None)
                return dict(user) if user else None
        with self.engine.connect() as connection:
            row = (
                connection.execute(text("SELECT * FROM auth_user WHERE email = :email"), {"email": email})
                .mappings()
                .first()
            )
        return _user_payload(row) if row else None

    def issue_code(self, email: str, digest: str, now: datetime) -> bool:
        """Atomically persist an OTP if the address is invited and within rate limits."""
        if self.engine is None:
            with self.lock:
                user = next((u for u in self.store.auth_users.values() if u["email"] == email), None)
                if not user or not user["active"]:
                    return False
                challenge = self.store.auth_challenges.get(email)
                if challenge:
                    last = challenge["last_sent_at"]
                    if _utc(now) - _utc(last) < OTP_COOLDOWN:
                        raise APIError(429, "otp_cooldown", "Wait before requesting another code")
                    window_start = challenge["window_started_at"]
                    if _utc(now) - _utc(window_start) >= OTP_WINDOW:
                        challenge.update(window_started_at=now, send_count=0)
                    if challenge["send_count"] >= OTP_MAX_SENDS:
                        raise APIError(429, "otp_rate_limited", "Too many codes requested for this email")
                    challenge.update(
                        code_hash=digest,
                        expires_at=_utc(now) + OTP_TTL,
                        attempts=0,
                        last_sent_at=now,
                        send_count=challenge["send_count"] + 1,
                    )
                else:
                    self.store.auth_challenges[email] = {
                        "code_hash": digest,
                        "expires_at": _utc(now) + OTP_TTL,
                        "attempts": 0,
                        "last_sent_at": now,
                        "window_started_at": now,
                        "send_count": 1,
                    }
                return True
        with self.engine.begin() as connection:
            user = connection.execute(
                text("SELECT id FROM auth_user WHERE email = :email AND active = :active FOR UPDATE"),
                {"email": email, "active": True},
            ).first()
            if not user:
                return False
            challenge = (
                connection.execute(
                    text("SELECT * FROM auth_login_challenge WHERE email = :email FOR UPDATE"), {"email": email}
                )
                .mappings()
                .first()
            )
            if challenge:
                last = _utc(challenge["last_sent_at"])
                if _utc(now) - last < OTP_COOLDOWN:
                    raise APIError(429, "otp_cooldown", "Wait before requesting another code")
                window_start = _utc(challenge["window_started_at"])
                sends = int(challenge["send_count"])
                if _utc(now) - window_start >= OTP_WINDOW:
                    window_start, sends = _stored(now), 0
                if sends >= OTP_MAX_SENDS:
                    raise APIError(429, "otp_rate_limited", "Too many codes requested for this email")
                connection.execute(
                    text(
                        "UPDATE auth_login_challenge SET code_hash = :hash, expires_at = :expires, attempts = 0, "
                        "last_sent_at = :now, window_started_at = :window, send_count = :sends WHERE email = :email"
                    ),
                    {
                        "hash": digest,
                        "expires": _stored(_utc(now) + OTP_TTL),
                        "now": _stored(now),
                        "window": window_start,
                        "sends": sends + 1,
                        "email": email,
                    },
                )
            else:
                connection.execute(
                    text(
                        "INSERT INTO auth_login_challenge "
                        "(email, code_hash, expires_at, attempts, last_sent_at, window_started_at, send_count) "
                        "VALUES (:email, :hash, :expires, 0, :now, :now, 1)"
                    ),
                    {"email": email, "hash": digest, "expires": _stored(_utc(now) + OTP_TTL), "now": _stored(now)},
                )
            return True

    def verify_and_create_session(
        self, email: str, digest: str, session_id: str, token_hash: str, device_id: str, now: datetime
    ) -> dict[str, Any] | None:
        if self.engine is None:
            with self.lock:
                challenge = self.store.auth_challenges.get(email)
                user = next((u for u in self.store.auth_users.values() if u["email"] == email), None)
                if not challenge or not user or not user["active"]:
                    return None
                if challenge["attempts"] >= OTP_MAX_ATTEMPTS or _utc(now) >= _utc(challenge["expires_at"]):
                    return None
                if not hmac.compare_digest(challenge["code_hash"], digest):
                    challenge["attempts"] += 1
                    return None
                challenge["code_hash"] = ""
                challenge["expires_at"] = _utc(now)
                challenge["attempts"] = 0
                user["verified_at"] = now
                user["updated_at"] = now
                self.store.auth_sessions[token_hash] = {
                    "id": session_id,
                    "user_id": user["id"],
                    "device_id": device_id,
                    "created_at": now,
                    "last_seen_at": now,
                    "revoked_at": None,
                    "absolute_expires_at": _utc(now) + ABSOLUTE_TTL,
                }
                return dict(user)
        with self.engine.begin() as connection:
            challenge = (
                connection.execute(
                    text("SELECT * FROM auth_login_challenge WHERE email = :email FOR UPDATE"), {"email": email}
                )
                .mappings()
                .first()
            )
            user = (
                connection.execute(
                    text("SELECT * FROM auth_user WHERE email = :email AND active = :active FOR UPDATE"),
                    {"email": email, "active": True},
                )
                .mappings()
                .first()
            )
            if not challenge or not user:
                return None
            if int(challenge["attempts"]) >= OTP_MAX_ATTEMPTS or _utc(now) >= _utc(challenge["expires_at"]):
                return None
            if not hmac.compare_digest(str(challenge["code_hash"]), digest):
                connection.execute(
                    text("UPDATE auth_login_challenge SET attempts = attempts + 1 WHERE email = :email"),
                    {"email": email},
                )
                return None
            now_db = _stored(now)
            connection.execute(
                text(
                    "UPDATE auth_login_challenge SET code_hash = '', expires_at = :now, attempts = 0 "
                    "WHERE email = :email"
                ),
                {"now": _stored(now), "email": email},
            )
            connection.execute(
                text("UPDATE auth_user SET verified_at = :now, updated_at = :now WHERE id = :id"),
                {"now": now_db, "id": user["id"]},
            )
            connection.execute(
                text(
                    "INSERT INTO auth_session "
                    "(id, token_hash, user_id, device_id, created_at, last_seen_at, absolute_expires_at) "
                    "VALUES (:id, :hash, :user, :device, :now, :now, :expires)"
                ),
                {
                    "id": session_id,
                    "hash": token_hash,
                    "user": user["id"],
                    "device": device_id,
                    "now": now_db,
                    "expires": _stored(_utc(now) + ABSOLUTE_TTL),
                },
            )
            result = dict(user)
            result["verified_at"] = now
            return _user_payload(result)

    def authenticate(self, token_hash: str, now: datetime) -> dict[str, Any] | None:
        if self.engine is None:
            with self.lock:
                session = self.store.auth_sessions.get(token_hash)
                if not session or session["revoked_at"] is not None:
                    return None
                user = self.store.auth_users.get(session["user_id"])
                if not user or not user["active"]:
                    return None
                if _utc(now) - _utc(session["last_seen_at"]) >= IDLE_TTL or _utc(now) >= _utc(
                    session["absolute_expires_at"]
                ):
                    return None
                session["last_seen_at"] = now
                result = dict(user)
                result["sessionId"] = session["id"]
                result["deviceId"] = session["device_id"]
                return result
        with self.engine.begin() as connection:
            row = (
                connection.execute(
                    text(
                        "SELECT u.*, s.id AS session_id, s.device_id, s.last_seen_at, s.absolute_expires_at "
                        "FROM auth_session s JOIN auth_user u ON u.id = s.user_id "
                        "WHERE s.token_hash = :hash AND s.revoked_at IS NULL AND u.active = :active FOR UPDATE"
                    ),
                    {"hash": token_hash, "active": True},
                )
                .mappings()
                .first()
            )
            if not row:
                return None
            if _utc(now) - _utc(row["last_seen_at"]) >= IDLE_TTL or _utc(now) >= _utc(row["absolute_expires_at"]):
                connection.execute(
                    text("UPDATE auth_session SET revoked_at = :now WHERE token_hash = :hash"),
                    {"now": _stored(now), "hash": token_hash},
                )
                return None
            connection.execute(
                text("UPDATE auth_session SET last_seen_at = :now WHERE token_hash = :hash"),
                {"now": _stored(now), "hash": token_hash},
            )
            result = _user_payload(row)
            result["sessionId"] = str(row["session_id"])
            result["deviceId"] = str(row["device_id"])
            return result

    def revoke_token(self, token_hash: str, now: datetime) -> None:
        if self.engine is None:
            with self.lock:
                session = self.store.auth_sessions.get(token_hash)
                if session:
                    session["revoked_at"] = now
            return
        with self.engine.begin() as connection:
            connection.execute(
                text("UPDATE auth_session SET revoked_at = :now WHERE token_hash = :hash AND revoked_at IS NULL"),
                {"now": _stored(now), "hash": token_hash},
            )

    def invite_user(self, email: str, actor: dict[str, Any], now: datetime) -> dict[str, Any]:
        email = email.strip().lower()
        if not email.endswith("@ku.th") or email.count("@") != 1 or any(c.isspace() for c in email):
            raise APIError(400, "invalid_email", "Only a valid @ku.th email can be invited")
        user_id = uuid7()
        if self.engine is None:
            with self.lock:
                if any(user["email"] == email for user in self.store.auth_users.values()):
                    raise APIError(409, "already_invited", "This email already has an account")
                user = {
                    "id": user_id,
                    "email": email,
                    "role": "member",
                    "active": True,
                    "verified_at": None,
                    "invited_at": now,
                    "operator_id": None,
                    "created_at": now,
                    "updated_at": now,
                }
                self.store.auth_users[user_id] = user
                self._memory_audit(
                    actor, "INSERT", user_id, None, {"email": email, "role": "member", "active": True}, now
                )
                return dict(user)
        with self.engine.begin() as connection:
            if connection.execute(text("SELECT id FROM auth_user WHERE email = :email"), {"email": email}).first():
                raise APIError(409, "already_invited", "This email already has an account")
            connection.execute(
                text(
                    "INSERT INTO auth_user (id, email, role, active, invited_at, invited_by_user_id, "
                    "created_at, updated_at) "
                    "VALUES (:id, :email, 'member', :active, :now, :actor, :now, :now)"
                ),
                {"id": user_id, "email": email, "active": True, "now": _stored(now), "actor": actor["id"]},
            )
            self._sql_audit(
                connection, actor, "INSERT", user_id, None, {"email": email, "role": "member", "active": True}, now
            )
            row = connection.execute(text("SELECT * FROM auth_user WHERE id = :id"), {"id": user_id}).mappings().one()
            return _user_payload(row)

    def list_users(self, now: datetime) -> list[dict[str, Any]]:
        if self.engine is None:
            with self.lock:
                users = [dict(user) for user in self.store.auth_users.values()]
                sync = list(self.store.auth_sync.values())
        else:
            with self.engine.connect() as connection:
                users = [
                    _user_payload(row)
                    for row in connection.execute(text("SELECT * FROM auth_user ORDER BY email")).mappings()
                ]
                sync = [dict(row) for row in connection.execute(text("SELECT * FROM auth_device_sync")).mappings()]
        grouped: dict[str, list[dict[str, Any]]] = {}
        for item in sync:
            user_id = str(item["user_id"] if "user_id" in item else item["userId"])
            at = item["last_reported_at"] if "last_reported_at" in item else item["lastReportedAt"]
            count = item["pending_count"] if "pending_count" in item else item["pendingCount"]
            device = item["device_id"] if "device_id" in item else item["deviceId"]
            grouped.setdefault(user_id, []).append(
                {
                    "deviceId": str(device),
                    "pendingCount": int(count),
                    "lastReportedAt": _iso(at),
                    "stale": _utc(now) - _utc(at) > SYNC_STALE_AFTER,
                }
            )
        result = []
        for user in users:
            result.append(
                {
                    "id": str(user["id"]),
                    "email": user["email"],
                    "role": user["role"],
                    "active": bool(user["active"]),
                    "verifiedAt": _iso(user.get("verified_at", user.get("verifiedAt"))),
                    "invitedAt": _iso(user.get("invited_at", user.get("invitedAt"))),
                    "operatorId": user.get("operator_id", user.get("operatorId")),
                    "syncDevices": grouped.get(str(user["id"]), []),
                }
            )
        return result

    def update_user(
        self, user_id: str, changes: dict[str, Any], actor: dict[str, Any], now: datetime
    ) -> dict[str, Any]:
        try:
            UUID(user_id)
        except ValueError as error:
            raise APIError(400, "invalid_user", "user id must be a UUID") from error
        if self.engine is None:
            with self.lock:
                user = self.store.auth_users.get(user_id)
                if not user:
                    raise APIError(404, "not_found", "User was not found")
                old = {"role": user["role"], "active": user["active"], "operatorId": user.get("operator_id")}
                active_admins = [
                    candidate
                    for candidate in self.store.auth_users.values()
                    if candidate["role"] == "admin" and candidate["active"] and candidate["verified_at"] is not None
                ]
                user_sync = [
                    sync
                    for (sync_user_id, _), sync in self.store.auth_sync.items()
                    if sync_user_id == user_id
                ]
                self._validate_update(user, changes, actor, now, active_admins, user_sync)
                if "role" in changes:
                    user["role"] = changes["role"]
                if "active" in changes:
                    user["active"] = changes["active"]
                if "operatorId" in changes:
                    operator_id = changes["operatorId"]
                    if operator_id:
                        operator = self.store.state.entities["operators"].get(operator_id)
                        if not operator or operator.get("active") is False:
                            raise APIError(400, "invalid_operator", "Choose an active existing operator")
                        for other in self.store.auth_users.values():
                            if other["id"] != user_id and other.get("operator_id") == operator_id:
                                raise APIError(
                                    409, "operator_already_linked", "This operator is already linked to another account"
                                )
                    user["operator_id"] = operator_id
                user["updated_at"] = now
                new = {"role": user["role"], "active": user["active"], "operatorId": user.get("operator_id")}
                if old != new:
                    self._memory_audit(actor, "UPDATE", user_id, old, new, now)
                if changes.get("active") is False:
                    for session in self.store.auth_sessions.values():
                        if session["user_id"] == user_id and session["revoked_at"] is None:
                            session["revoked_at"] = now
                return dict(user)
        with self.engine.begin() as connection:
            row = (
                connection.execute(text("SELECT * FROM auth_user WHERE id = :id FOR UPDATE"), {"id": user_id})
                .mappings()
                .first()
            )
            if not row:
                raise APIError(404, "not_found", "User was not found")
            sync_rows = list(
                connection.execute(
                    text("SELECT * FROM auth_device_sync WHERE user_id = :id FOR UPDATE"), {"id": user_id}
                ).mappings()
            )
            admin_rows = list(
                connection.execute(
                    text(
                        "SELECT id, role, active, verified_at FROM auth_user "
                        "WHERE role = 'admin' AND active = :active AND verified_at IS NOT NULL FOR UPDATE"
                    ),
                    {"active": True},
                ).mappings()
            )
            self._validate_update(dict(row), changes, actor, now, admin_rows, sync_rows)
            old = {
                "role": row["role"],
                "active": bool(row["active"]),
                "operatorId": str(row["operator_id"]) if row["operator_id"] else None,
            }
            values: dict[str, Any] = {"id": user_id, "now": _stored(now)}
            assignments = ["updated_at = :now"]
            if "role" in changes:
                assignments.append("role = :role")
                values["role"] = changes["role"]
            if "active" in changes:
                assignments.append("active = :active")
                values["active"] = changes["active"]
            if "operatorId" in changes:
                operator_id = changes["operatorId"]
                if operator_id:
                    try:
                        UUID(operator_id)
                    except ValueError as error:
                        raise APIError(400, "invalid_operator", "operator id must be a UUID") from error
                    operator = connection.execute(
                        text(
                            "SELECT id FROM operator WHERE id = :operator AND active = :active AND deleted_at IS NULL"
                        ),
                        {"operator": operator_id, "active": True},
                    ).first()
                    if not operator:
                        raise APIError(400, "invalid_operator", "Choose an active existing operator")
                    linked = connection.execute(
                        text("SELECT id FROM auth_user WHERE operator_id = :operator AND id <> :id"),
                        {"operator": operator_id, "id": user_id},
                    ).first()
                    if linked:
                        raise APIError(
                            409, "operator_already_linked", "This operator is already linked to another account"
                        )
                assignments.append("operator_id = :operator")
                values["operator"] = operator_id
            connection.execute(text(f"UPDATE auth_user SET {', '.join(assignments)} WHERE id = :id"), values)
            if changes.get("active") is False:
                connection.execute(
                    text("UPDATE auth_session SET revoked_at = :now WHERE user_id = :id AND revoked_at IS NULL"),
                    {"now": _stored(now), "id": user_id},
                )
            updated = (
                connection.execute(text("SELECT * FROM auth_user WHERE id = :id"), {"id": user_id}).mappings().one()
            )
            new = {
                "role": updated["role"],
                "active": bool(updated["active"]),
                "operatorId": str(updated["operator_id"]) if updated["operator_id"] else None,
            }
            if old != new:
                self._sql_audit(connection, actor, "UPDATE", user_id, old, new, now)
            return _user_payload(updated)

    def _validate_update(
        self,
        user: dict[str, Any],
        changes: dict[str, Any],
        actor: dict[str, Any],
        now: datetime,
        admins: list[Any],
        sync_rows: list[Any],
    ) -> None:
        unknown = set(changes) - {"role", "active", "operatorId", "acknowledgePendingDataRisk"}
        if unknown or not changes:
            raise APIError(400, "invalid_update", "Update fields are invalid")
        if "role" in changes and changes["role"] not in {"admin", "member"}:
            raise APIError(400, "invalid_role", "Role must be admin or member")
        if "active" in changes and not isinstance(changes["active"], bool):
            raise APIError(400, "invalid_status", "active must be a boolean")
        if "operatorId" in changes and changes["operatorId"] is not None and not isinstance(changes["operatorId"], str):
            raise APIError(400, "invalid_operator", "operatorId must be a UUID or null")
        current_role = user.get("role")
        current_active = bool(user.get("active"))
        future_role = changes.get("role", current_role)
        future_active = changes.get("active", current_active)
        if current_role == "admin" and current_active and (future_role != "admin" or not future_active):
            active_admins = [
                row
                for row in admins
                if bool(row["active"] if hasattr(row, "__getitem__") else row.get("active"))
                and (row["role"] if hasattr(row, "__getitem__") else row.get("role")) == "admin"
                and (row["verified_at"] if hasattr(row, "__getitem__") else row.get("verified_at")) is not None
            ]
            if len(active_admins) <= 1:
                raise APIError(409, "last_admin", "At least one active admin account must remain")
        if changes.get("active") is False:
            known = bool(sync_rows)
            stale = not known
            fresh_pending = False
            for item in sync_rows:
                count = item["pending_count"] if "pending_count" in item else item.get("pendingCount", 0)
                reported = item["last_reported_at"] if "last_reported_at" in item else item.get("lastReportedAt")
                item_stale = _utc(now) - _utc(reported) > SYNC_STALE_AFTER
                stale = stale or item_stale
                fresh_pending = fresh_pending or (not item_stale and int(count) > 0)
            acknowledged = changes.get("acknowledgePendingDataRisk") is True
            if fresh_pending:
                raise APIError(409, "pending_offline_work", "This account has pending offline work on a device")
            if stale and not acknowledged:
                raise APIError(
                    409, "sync_status_unavailable", "Confirm the offline data risk before disabling this account"
                )

    def report_sync(self, user_id: str, device_id: str, pending_count: int, now: datetime) -> None:
        if not device_id or len(device_id) > 64 or pending_count < 0:
            raise APIError(400, "invalid_sync_status", "Device sync status is invalid")
        if self.engine is None:
            with self.lock:
                user = self.store.auth_users.get(user_id)
                if not user or not user["active"]:
                    raise APIError(401, "authentication_required", "Sign in to continue")
                self.store.auth_sync[(user_id, device_id)] = {
                    "userId": user_id,
                    "deviceId": device_id,
                    "pendingCount": pending_count,
                    "lastReportedAt": now,
                }
            return
        with self.engine.begin() as connection:
            user = connection.execute(
                text("SELECT id FROM auth_user WHERE id = :user AND active = :active FOR UPDATE"),
                {"user": user_id, "active": True},
            ).first()
            if not user:
                raise APIError(401, "authentication_required", "Sign in to continue")
            current = connection.execute(
                text("SELECT user_id FROM auth_device_sync WHERE user_id = :user AND device_id = :device FOR UPDATE"),
                {"user": user_id, "device": device_id},
            ).first()
            if current:
                connection.execute(
                    text(
                        "UPDATE auth_device_sync SET pending_count = :count, last_reported_at = :now "
                        "WHERE user_id = :user AND device_id = :device"
                    ),
                    {"count": pending_count, "now": _stored(now), "user": user_id, "device": device_id},
                )
            else:
                connection.execute(
                    text(
                        "INSERT INTO auth_device_sync (user_id, device_id, pending_count, last_reported_at) "
                        "VALUES (:user, :device, :count, :now)"
                    ),
                    {"user": user_id, "device": device_id, "count": pending_count, "now": _stored(now)},
                )

    def list_sessions(self, user_id: str) -> list[dict[str, Any]]:
        if self.engine is None:
            with self.lock:
                return [
                    {
                        "id": session["id"],
                        "deviceId": session["device_id"],
                        "createdAt": _iso(session["created_at"]),
                        "lastSeenAt": _iso(session["last_seen_at"]),
                        "revokedAt": _iso(session["revoked_at"]),
                        "current": session["user_id"] == user_id and session.get("current", False),
                    }
                    for session in self.store.auth_sessions.values()
                    if session["user_id"] == user_id
                ]
        with self.engine.connect() as connection:
            rows = connection.execute(
                text(
                    "SELECT id, device_id, created_at, last_seen_at, revoked_at FROM auth_session WHERE user_id = :id "
                    "ORDER BY last_seen_at DESC"
                ),
                {"id": user_id},
            ).mappings()
            return [
                {
                    "id": str(row["id"]),
                    "deviceId": str(row["device_id"]),
                    "createdAt": _iso(row["created_at"]),
                    "lastSeenAt": _iso(row["last_seen_at"]),
                    "revokedAt": _iso(row["revoked_at"]),
                }
                for row in rows
            ]

    def sender_email(self, default: str) -> str:
        if self.engine is None:
            with self.lock:
                return self.store.auth_settings.get("sender_email", default)
        with self.engine.connect() as connection:
            value = connection.execute(
                text("SELECT setting_value FROM auth_setting WHERE setting_key = 'sender_email'")
            ).scalar_one_or_none()
        return str(value or default)

    def set_sender_email(self, email: str, actor: dict[str, Any], now: datetime) -> None:
        if self.engine is None:
            with self.lock:
                old = self.store.auth_settings.get("sender_email")
                self.store.auth_settings["sender_email"] = email
                self._memory_audit(
                    actor, "UPDATE", "sender_email", {"senderEmail": old}, {"senderEmail": email}, now, "auth_setting"
                )
            return
        with self.engine.begin() as connection:
            row = connection.execute(
                text("SELECT setting_value FROM auth_setting WHERE setting_key = 'sender_email' FOR UPDATE")
            ).first()
            old = row[0] if row else None
            if row:
                connection.execute(
                    text(
                        "UPDATE auth_setting SET setting_value = :value, updated_at = :now, "
                        "updated_by_user_id = :actor "
                        "WHERE setting_key = 'sender_email'"
                    ),
                    {"value": email, "now": _stored(now), "actor": actor["id"]},
                )
            else:
                connection.execute(
                    text(
                        "INSERT INTO auth_setting (setting_key, setting_value, updated_at, updated_by_user_id) "
                        "VALUES ('sender_email', :value, :now, :actor)"
                    ),
                    {"value": email, "now": _stored(now), "actor": actor["id"]},
                )
            self._sql_audit(
                connection,
                actor,
                "UPDATE",
                "sender_email",
                {"senderEmail": old},
                {"senderEmail": email},
                now,
                "auth_setting",
            )

    def record_invitation_sent(self, user_id: str, actor: dict[str, Any], now: datetime) -> None:
        payload = {"invitationSentAt": _iso(now)}
        if self.engine is None:
            with self.lock:
                self._memory_audit(actor, "UPDATE", user_id, None, payload, now)
            return
        with self.engine.begin() as connection:
            self._sql_audit(connection, actor, "UPDATE", user_id, None, payload, now)

    def revoke_session(self, user_id: str, session_id: str, actor: dict[str, Any], now: datetime) -> None:
        if self.engine is None:
            with self.lock:
                session = next(
                    (s for s in self.store.auth_sessions.values() if s["id"] == session_id and s["user_id"] == user_id),
                    None,
                )
                if not session:
                    raise APIError(404, "not_found", "Session was not found")
                old = {"userId": user_id, "deviceId": session["device_id"], "revokedAt": _iso(session["revoked_at"])}
                session["revoked_at"] = now
                self._memory_audit(
                    actor, "UPDATE", session_id, old, {**old, "revokedAt": _iso(now)}, now, "auth_session"
                )
                return
        with self.engine.begin() as connection:
            row = (
                connection.execute(
                    text(
                        "SELECT device_id, revoked_at FROM auth_session "
                        "WHERE id = :session AND user_id = :user FOR UPDATE"
                    ),
                    {"session": session_id, "user": user_id},
                )
                .mappings()
                .first()
            )
            if not row:
                raise APIError(404, "not_found", "Session was not found")
            old = {"userId": user_id, "deviceId": str(row["device_id"]), "revokedAt": _iso(row["revoked_at"])}
            changed = connection.execute(
                text(
                    "UPDATE auth_session SET revoked_at = :now WHERE id = :session AND user_id = :user "
                    "AND revoked_at IS NULL"
                ),
                {"now": _stored(now), "session": session_id, "user": user_id},
            ).rowcount
            if not changed:
                raise APIError(404, "not_found", "Active session was not found")
            self._sql_audit(
                connection, actor, "UPDATE", session_id, old, {**old, "revokedAt": _iso(now)}, now, "auth_session"
            )

    def _memory_audit(
        self,
        actor: dict[str, Any],
        action: str,
        user_id: str,
        old: Any,
        new: Any,
        now: datetime,
        table: str = "auth_user",
    ) -> None:
        self.store.state.audits.append(
            {
                "id": uuid7(),
                "tableName": table,
                "recordId": user_id,
                "action": action,
                "oldValues": old,
                "newValues": new,
                "operatorId": None,
                "deviceId": None,
                "actorUserId": actor["id"],
                "actorEmail": actor["email"],
                "occurredAt": _iso(now),
            }
        )

    def _sql_audit(
        self,
        connection: Any,
        actor: dict[str, Any],
        action: str,
        user_id: str,
        old: Any,
        new: Any,
        now: datetime,
        table: str = "auth_user",
    ) -> None:
        import json

        connection.execute(
            text(
                "INSERT INTO audit_log "
                "(id, table_name, record_id, action, old_values, new_values, actor_user_id, actor_email, occurred_at) "
                "VALUES (:id, :table, :record, :action, :old, :new, :actor, :email, :now)"
            ),
            {
                "id": uuid7(),
                "table": table,
                "record": user_id,
                "action": action,
                "old": json.dumps(old, ensure_ascii=False) if old is not None else None,
                "new": json.dumps(new, ensure_ascii=False) if new is not None else None,
                "actor": actor["id"],
                "email": actor["email"],
                "now": _stored(now),
            },
        )
