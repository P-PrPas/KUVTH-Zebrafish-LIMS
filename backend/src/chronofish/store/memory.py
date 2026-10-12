from __future__ import annotations

import copy
import threading
from dataclasses import dataclass
from typing import Any

from fastapi import Request
from fastapi.responses import Response

from ..domain.state import State
from ..runtime.errors import APIError
from ..runtime.mutations import encode_result, request_fingerprint, validate_write_context
from ..runtime.values import parse_datetime
from .base import Mutation


@dataclass(slots=True)
class StoredResponse:
    request_hash: str
    status: int
    content_type: str
    body: bytes


class MemoryStore:
    """Development/test adapter. Production uses SQLStore."""

    def __init__(self) -> None:
        self.state = State.seeded()
        self.idempotency: dict[str, StoredResponse] = {}
        self.lock = threading.RLock()

    def snapshot(self) -> State:
        with self.lock:
            return copy.deepcopy(self.state)

    def execute_mutation(self, request: Request, body: Any, operation: Mutation) -> Response:
        with self.lock:
            _operator, _device, key = validate_write_context(request, self.state, body)
            scope, request_hash = request_fingerprint(request, body)
            scope = f"{scope}:{key}"
            previous = self.idempotency.get(scope)
            if previous:
                if previous.request_hash != request_hash:
                    raise APIError(409, "idempotency_conflict", "X-Idempotency-Key ถูกใช้กับ request อื่นแล้ว")
                return Response(previous.body, previous.status, media_type=previous.content_type)
            working = copy.deepcopy(self.state)
            status, media_type, encoded = encode_result(operation(working))
            # Commit account linkage with the request and audits, after every validation succeeds.
            accounts = copy.deepcopy(getattr(self, "auth_users", {})) if working.operator_changes else {}
            for user_id, change in working.operator_changes.items():
                user = accounts.get(user_id)
                if (
                    not user
                    or not user["active"]
                    or user["role"] != "member"
                    or user.get("operator_id") != change["expectedOperatorId"]
                    or user["updated_at"] != parse_datetime(change["expectedUpdatedAt"])
                ):
                    raise APIError(409, "source_changed", "The account changed. Review a new request")
                operator = working.entities["operators"].get(change["operatorId"])
                if not operator or operator.get("active") is False or operator.get("deletedAt"):
                    raise APIError(422, "invalid_operator", "Choose an active existing operator")
                if any(
                    other["id"] != user_id and other.get("operator_id") == change["operatorId"]
                    for other in accounts.values()
                ):
                    raise APIError(409, "operator_already_linked", "This operator is already linked to another account")
                user.update(operator_id=change["operatorId"], updated_at=parse_datetime(change["updatedAt"]))
            if working.operator_changes:
                self.auth_users = accounts
                working.operator_changes.clear()
            self.idempotency[scope] = StoredResponse(request_hash, status, media_type, encoded)
            self.state = working
            return Response(encoded, status, media_type=media_type)
