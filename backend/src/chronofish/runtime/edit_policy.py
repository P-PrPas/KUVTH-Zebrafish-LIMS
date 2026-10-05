from __future__ import annotations

from datetime import timedelta
from typing import Any

from fastapi import Request

from ..domain.state import State
from ..store import Store
from .values import parse_datetime, utc_now

DIRECT_EDIT_WINDOW = timedelta(hours=24)


def recent_creator(state: State, store: Store, request: Request, table: str, item: dict[str, Any]) -> bool:
    created_at = item.get("createdAt")
    if not isinstance(created_at, str):
        return False
    try:
        age = utc_now() - parse_datetime(created_at)
    except (TypeError, ValueError):
        return False
    if not timedelta(0) <= age <= DIRECT_EDIT_WINDOW:
        return False
    query = getattr(store, "creator_for_record", None)
    creator = (
        query(table, str(item["id"]))
        if query
        else next(
            (
                entry.get("actorUserId")
                for entry in state.audits
                if entry.get("tableName") == table
                and entry.get("recordId") == item["id"]
                and entry.get("action") == "INSERT"
            ),
            None,
        )
    )
    return bool(creator and creator == request.state.user["id"])
