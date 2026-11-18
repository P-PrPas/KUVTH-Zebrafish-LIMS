"""Single audit-entry builder and persistence for every writer of ``audit_log``."""

from __future__ import annotations

import copy
import json
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import text

from .values import iso_now, uuid7

JSON = Any


def audit_entry(
    actor: dict[str, Any],
    action: str,
    table: str,
    record_id: str,
    old: JSON,
    new: JSON,
    *,
    operator_id: str | None = None,
    device_id: str | None = None,
    occurred_at: datetime | None = None,
) -> dict[str, Any]:
    """Canonical entry; ``occurred_at`` is UTC (naive treated as UTC), default now."""
    when = (
        iso_now()
        if occurred_at is None
        else occurred_at.replace(tzinfo=occurred_at.tzinfo or UTC).astimezone(UTC).isoformat().replace("+00:00", "Z")
    )
    return {
        "id": uuid7(),
        "tableName": table,
        "recordId": record_id,
        "action": action,
        "oldValues": copy.deepcopy(old),
        "newValues": copy.deepcopy(new),
        "operatorId": operator_id or None,
        "deviceId": device_id,
        "actorUserId": actor.get("id"),
        "actorEmail": actor.get("email"),
        "occurredAt": when,
    }


def _json(value: JSON) -> str | None:
    return None if value is None else json.dumps(value, ensure_ascii=False, default=str)


def audit_row(entry: dict[str, Any]) -> dict[str, Any]:
    """Column values for ``audit_log``: JSON text and naive-UTC timestamp."""
    when = datetime.fromisoformat(entry["occurredAt"].replace("Z", "+00:00"))
    return {
        "id": entry["id"],
        "table_name": entry["tableName"],
        "record_id": entry["recordId"],
        "action": entry["action"],
        "old_values": _json(entry.get("oldValues")),
        "new_values": _json(entry.get("newValues")),
        "operator_id": entry.get("operatorId"),
        "device_id": entry.get("deviceId"),
        "actor_user_id": entry.get("actorUserId"),
        "actor_email": entry.get("actorEmail"),
        "occurred_at": when.replace(tzinfo=when.tzinfo or UTC).astimezone(UTC).replace(tzinfo=None),
    }


def insert_audit(connection: Any, entry: dict[str, Any]) -> None:
    values = audit_row(entry)
    columns = list(values)
    marks = ", ".join(f":{column}" for column in columns)
    connection.execute(text(f"INSERT INTO audit_log ({', '.join(columns)}) VALUES ({marks})"), values)
