from __future__ import annotations

import re
from typing import Any, Literal

from fastapi import APIRouter, BackgroundTasks, Request, Response
from pydantic import BaseModel, ConfigDict

from ...runtime.errors import APIError, error_response
from ...runtime.values import utc_now
from ...services.auth import SESSION_COOKIE, SESSION_COOKIE_MAX_AGE, AuthService


class UserUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["admin", "member"] | None = None
    active: bool | None = None
    operatorId: str | None = None
    acknowledgePendingDataRisk: bool | None = None


class MailSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    senderEmail: str


def _actor(request: Request) -> dict[str, Any]:
    user = getattr(request.state, "user", None)
    if not user:
        raise APIError(401, "authentication_required", "Sign in to continue")
    return user


def _email(value: str) -> str:
    value = value.strip().lower()
    if len(value) > 254 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
        raise APIError(400, "invalid_email", "Enter a valid sender email address")
    return value


def build_auth_router(auth: AuthService) -> APIRouter:
    router = APIRouter(prefix="/api/v1/auth", tags=["authentication"])

    @router.post("/request-code", status_code=202)
    def request_code(body: dict[str, Any], background_tasks: BackgroundTasks) -> dict[str, str]:
        email = auth.validate_code_request(body)
        background_tasks.add_task(auth.deliver_code, email)
        return {"status": "If this email is invited, check its inbox for a sign-in code."}

    @router.post("/verify-code")
    def verify_code(
        request: Request, response: Response, body: dict[str, Any], background_tasks: BackgroundTasks
    ) -> Any:
        try:
            user, token = auth.verify_code(body, request.headers.get("X-Device-Id", ""), background_tasks)
        except APIError as error:
            result = error_response(error)
            result.background = background_tasks
            return result
        response.set_cookie(
            SESSION_COOKIE,
            token,
            max_age=SESSION_COOKIE_MAX_AGE,
            httponly=True,
            secure=auth.config.session_cookie_secure,
            samesite="lax",
            path="/",
        )
        return {"user": user}

    @router.get("/me")
    def me(request: Request) -> dict[str, Any]:
        return {"user": _actor(request)}

    @router.post("/logout", status_code=204)
    def logout(request: Request, response: Response) -> Response:
        auth.logout(request.cookies.get(SESSION_COOKIE))
        response.delete_cookie(
            SESSION_COOKIE, path="/", secure=auth.config.session_cookie_secure, httponly=True, samesite="lax"
        )
        response.status_code = 204
        return response

    @router.post("/devices/sync-status", status_code=204)
    def sync_status(request: Request, body: dict[str, Any]) -> Response:
        user = _actor(request)
        if request.headers.get("X-Actor-User-Id") != user["id"]:
            raise APIError(401, "actor_mismatch", "Sign in again to report device status")
        pending_count = body.get("pendingCount")
        if isinstance(pending_count, bool) or not isinstance(pending_count, int):
            raise APIError(400, "invalid_sync_status", "pendingCount must be a non-negative integer")
        auth.repository.report_sync(user["id"], request.headers.get("X-Device-Id", ""), pending_count, utc_now())
        return Response(status_code=204)

    @router.get("/sessions")
    def sessions(request: Request) -> dict[str, Any]:
        user = _actor(request)
        return {"items": auth.repository.list_sessions(user["id"])}

    @router.delete("/sessions/{session_id}", status_code=204)
    def revoke_own_session(request: Request, session_id: str) -> Response:
        user = _actor(request)
        auth.repository.revoke_session(user["id"], session_id, user, utc_now())
        response = Response(status_code=204)
        if session_id == user.get("sessionId"):
            response.delete_cookie(
                SESSION_COOKIE, path="/", secure=auth.config.session_cookie_secure, httponly=True, samesite="lax"
            )
        return response

    @router.get("/admin/users")
    def list_users(request: Request) -> dict[str, Any]:
        _actor(request)
        return {"items": auth.repository.list_users(utc_now())}

    @router.post("/admin/users", status_code=201)
    def invite_user(request: Request, body: dict[str, Any]) -> dict[str, Any]:
        user, email_sent = auth.invite(body, _actor(request))
        return {"user": user, "emailSent": email_sent}

    @router.post("/admin/users/{user_id}/invite", status_code=202)
    def resend_invitation(request: Request, user_id: str) -> dict[str, str]:
        actor = _actor(request)
        user = next((item for item in auth.repository.list_users(utc_now()) if item["id"] == user_id), None)
        if not user or not user["active"]:
            raise APIError(404, "not_found", "Active invited user was not found")
        auth.resend_invitation(user)
        auth.repository.record_invitation_sent(user_id, actor, utc_now())
        return {"status": "Invitation email sent"}

    @router.patch("/admin/users/{user_id}")
    def update_user(request: Request, user_id: str, body: UserUpdate) -> dict[str, Any]:
        changes = body.model_dump(exclude_unset=True)
        if not changes:
            raise APIError(400, "invalid_update", "Provide at least one field to update")
        result = auth.repository.update_user(user_id, changes, _actor(request), utc_now())
        return {"user": auth.public_user(result)}

    @router.post("/admin/users/{user_id}/unlock", status_code=204)
    def unlock_user(request: Request, user_id: str) -> Response:
        auth.repository.unlock_user(user_id, _actor(request), utc_now())
        return Response(status_code=204)

    @router.get("/admin/users/{user_id}/sessions")
    def admin_list_sessions(request: Request, user_id: str) -> dict[str, Any]:
        _actor(request)
        return {"items": auth.repository.list_sessions(user_id)}

    @router.delete("/admin/users/{user_id}/sessions/{session_id}", status_code=204)
    def admin_revoke_session(request: Request, user_id: str, session_id: str) -> Response:
        actor = _actor(request)
        auth.repository.revoke_session(user_id, session_id, actor, utc_now())
        return Response(status_code=204)

    @router.get("/admin/mail-settings")
    def get_mail_settings(request: Request) -> dict[str, Any]:
        _actor(request)
        return {
            "senderEmail": auth.repository.sender_email(auth.config.mail_sender_email),
            "smtpConfigured": auth.mailer.configured,
        }

    @router.patch("/admin/mail-settings")
    def update_mail_settings(request: Request, body: MailSettings) -> dict[str, str]:
        sender = _email(body.senderEmail)
        auth.repository.set_sender_email(sender, _actor(request), utc_now())
        return {"senderEmail": sender}

    return router
