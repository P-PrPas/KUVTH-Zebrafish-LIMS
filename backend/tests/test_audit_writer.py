from __future__ import annotations

import json
import re
from datetime import UTC, datetime, timedelta, timezone

from chronofish.domain.state import State
from chronofish.runtime.audit import audit_entry, audit_row
from chronofish.runtime.mutations import WriteContext, audit

KEYS = {
    "id",
    "tableName",
    "recordId",
    "action",
    "oldValues",
    "newValues",
    "operatorId",
    "deviceId",
    "actorUserId",
    "actorEmail",
    "occurredAt",
}
TIMESTAMP = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$")


def test_every_caller_style_builds_the_canonical_entry():
    state = State()
    admin = {"id": "u1", "email": "a@ku.th"}
    audit(state, WriteContext(admin, "op1", "dev1", "k"), "UPDATE", "fish", "r1", {"a": 1}, {"a": 2})
    audit(state, WriteContext(admin, "", "dev1", "k"), "INSERT", "site", "r2", None, {"n": "ไทย"})
    when = datetime(2026, 1, 2, 3, 4, 5, 6)  # naive UTC, as the import repository supplies
    entries = [
        *state.audits,
        audit_entry(admin, "UPDATE", "auth_user", "r3", {"x": 1}, {"x": 2}, occurred_at=when),
        audit_entry(
            admin,
            "INSERT",
            "specimen",
            "r4",
            None,
            {"y": 1},
            occurred_at=when.replace(tzinfo=timezone(timedelta(hours=7))),
        ),
    ]
    assert all(set(entry) == KEYS and TIMESTAMP.match(entry["occurredAt"]) for entry in entries)
    assert [(e["operatorId"], e["deviceId"]) for e in entries] == [
        ("op1", "dev1"),
        (None, "dev1"),
        (None, None),
        (None, None),
    ]
    assert all((e["actorUserId"], e["actorEmail"]) == ("u1", "a@ku.th") for e in entries)
    assert entries[2]["occurredAt"] == "2026-01-02T03:04:05.000006Z"
    assert entries[3]["occurredAt"] == "2026-01-01T20:04:05.000006Z"
    row = audit_row(entries[1])
    assert row["old_values"] is None and json.loads(row["new_values"]) == {"n": "ไทย"} and "ไทย" in row["new_values"]
    assert row["occurred_at"].tzinfo is None
    assert audit_row(entries[2])["occurred_at"] == when
    assert datetime.now(UTC) - datetime.fromisoformat(entries[0]["occurredAt"].replace("Z", "+00:00")) < timedelta(
        seconds=30
    )
