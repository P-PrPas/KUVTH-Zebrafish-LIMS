from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from typing import Any, Literal
from uuid import UUID

from fastapi import Request

from ..domain.state import JSON, State
from .audit import audit_entry
from .errors import APIError
from .values import normalize

WriteKind = Literal["operator", "operator_bootstrap", "account"]

# Every route that writes through a validated context declares its kind here. The OpenAPI contract is the source
# of truth: operator kinds declare X-Operator-Id; "operator_bootstrap" additionally skips the operator lookup
# because it creates operators. Keys are "METHOD /path" with path parameters written as {}.
WRITE_KINDS: dict[str, WriteKind] = {
    "POST /imports/{}/validate-template": "operator",
    "POST /imports/{}/confirm-template": "operator",
    "POST /sites": "operator",
    "PATCH /sites/{}": "operator",
    "POST /operators": "operator_bootstrap",
    "POST /donor-cell-lines": "operator",
    "POST /recipient-egg-lots": "operator",
    "POST /csof-lots": "operator",
    "POST /experiment-groups": "operator",
    "POST /treatment-groups": "operator",
    "POST /fish-boxes": "operator",
    "PATCH /operators/{}": "operator",
    "PATCH /donor-cell-lines/{}": "operator",
    "PATCH /recipient-egg-lots/{}": "operator",
    "PATCH /csof-lots/{}": "operator",
    "PATCH /experiment-groups/{}": "operator",
    "PATCH /treatment-groups/{}": "operator",
    "PATCH /fish-boxes/{}": "operator",
    "POST /timing-profiles": "operator",
    "POST /timing-profiles/csv": "operator",
    "POST /batches": "operator",
    "PATCH /batches/{}": "operator",
    "POST /batches/{}/duplicate": "operator",
    "POST /batches/{}/injection-lots": "operator",
    "PATCH /injection-lots/{}": "operator",
    "POST /injection-lots/{}/embryos": "operator",
    "PATCH /embryos/{}": "operator",
    "DELETE /embryos/{}": "operator",
    "PUT /batches/{}/control-arm-counts": "operator",
    "POST /observations/embryo": "operator",
    "PATCH /observations/embryo/{}": "operator",
    "DELETE /observations/embryo/{}": "operator",
    "POST /observations/fish": "operator",
    "PATCH /observations/fish/{}": "operator",
    "DELETE /observations/fish/{}": "operator",
    "POST /promotions": "operator",
    "POST /fish": "operator",
    "PATCH /fish/{}": "operator",
    "POST /fish/{}/specimens": "operator",
    "POST /corrections": "account",
    "POST /corrections/{}/withdraw": "account",
    "POST /corrections/{}/decide": "account",
}


@dataclass(frozen=True, slots=True)
class WriteContext:
    actor: dict[str, Any]
    operator_id: str
    device_id: str
    idempotency_key: str


def write_kind(request: Request) -> WriteKind:
    route_path = getattr(request.scope.get("route"), "path", request.url.path)
    key = f"{request.method} {re.sub(r'{[^/]+}', '{}', route_path.removeprefix('/api/v1'))}"
    try:
        return WRITE_KINDS[key]
    except KeyError as error:
        raise APIError(500, "write_kind_undeclared", f"No write kind is declared for {key}") from error


def validate_write_context(request: Request, state: State, body: Any, kind: WriteKind) -> WriteContext:
    operator_id = request.headers.get("X-Operator-Id", "").strip()
    device_id = request.headers.get("X-Device-Id", "").strip()
    key = request.headers.get("X-Idempotency-Key", "").strip()
    account_write = kind == "account"
    if not account_write:
        try:
            UUID(operator_id)
        except ValueError as error:
            raise APIError(400, "invalid_context", "X-Operator-Id ต้องเป็น UUID") from error
    user = getattr(request.state, "user", None)
    if not user:
        raise APIError(401, "authentication_required", "Sign in to continue")
    if user["role"] == "member" and not account_write:
        linked_operator = user.get("operatorId") or user.get("operator_id")
        if not linked_operator:
            raise APIError(403, "operator_link_required", "Ask an admin to link your account to an operator")
        if operator_id != str(linked_operator) or (
            isinstance(body, dict) and "operatorId" in body and body["operatorId"] != str(linked_operator)
        ):
            raise APIError(403, "operator_mismatch", "This account can only record work for its linked operator")
    if not device_id or len(device_id) > 64 or "\n" in device_id or "\r" in device_id:
        raise APIError(400, "invalid_context", "X-Device-Id ต้องมีความยาว 1-64 ตัวอักษร")
    operator = state.entities["operators"].get(operator_id)
    if kind == "operator" and (not operator or operator.get("active") is False):
        raise APIError(400, "invalid_context", "operator ไม่ถูกต้องหรือถูกปิดใช้งาน")
    try:
        UUID(key)
    except ValueError as error:
        raise APIError(400, "invalid_context", "ทุกการบันทึกต้องมี X-Idempotency-Key ที่เป็น UUID") from error
    return WriteContext(user, "" if account_write else operator_id, device_id, key)


def audit(
    state: State, ctx: WriteContext, action: str, table: str, record_id: str, old: JSON | None, new: JSON | None
) -> None:
    state.audits.append(
        audit_entry(ctx.actor, action, table, record_id, old, new, operator_id=ctx.operator_id, device_id=ctx.device_id)
    )


def request_fingerprint(request: Request, body: Any) -> tuple[str, str]:
    canonical = json.dumps(normalize(body), sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    request_hash = hashlib.sha256(
        f"{request.method}\0{request.url.path}?{request.url.query}\0{canonical}".encode()
    ).hexdigest()
    return f"{request.method}:{request.url.path}?{request.url.query}", request_hash


def encode_result(result: tuple[int, Any] | tuple[int, Any, str]) -> tuple[int, str, bytes]:
    status, payload, *content_type = result
    media_type = content_type[0] if content_type else "application/json"
    encoded = (
        payload
        if isinstance(payload, bytes)
        else json.dumps(payload, ensure_ascii=False, separators=(",", ":"), default=str).encode()
    )
    return status, media_type, encoded
