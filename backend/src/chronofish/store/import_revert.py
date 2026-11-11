"""Conservative rollback of the canonical graph created by a template import."""

import hashlib
import json

from sqlalchemy import inspect, text

from ..runtime.errors import APIError
from .sql import RESOURCE_TABLE

HISTORICAL_TABLES = {"historical_experiment", "historical_lot", "historical_stage_count"}
TABLES = set(RESOURCE_TABLE.values()) | {"embryo_observation", "fish_observation"} | HISTORICAL_TABLES


def fingerprint(row):
    return hashlib.sha256(json.dumps(dict(row), sort_keys=True, default=str).encode()).hexdigest()


def manifest(connection, before, after, job_id):
    collections = [(table, before.entities[key], after.entities[key]) for key, table in RESOURCE_TABLE.items()]
    collections += [
        ("embryo_observation", before.observations, after.observations),
        ("fish_observation", before.fish_observations, after.fish_observations),
    ]
    result = {}
    for table, old, new in collections:
        # Never promise rollback for imports which modify pre-existing records.
        if any(new.get(key) != value for key, value in old.items()):
            return None
        for key in new.keys() - old.keys():
            row = connection.execute(text(f"SELECT * FROM {table} WHERE id = :id"), {"id": key}).mappings().one()
            result.setdefault(table, {})[key] = fingerprint(row)
    for table in HISTORICAL_TABLES:
        for row in connection.execute(
            text(f"SELECT * FROM {table} WHERE import_job_id = :job AND deleted_at IS NULL"), {"job": job_id}
        ).mappings():
            result.setdefault(table, {})[str(row["id"])] = fingerprint(row)
    return result


def revert(connection, records, job_id, now):
    if not records or not set(records) <= TABLES:
        raise APIError(409, "revert_unsupported", "This import has no verified rollback manifest")
    # Use the same serialization lock as ordinary mutations and import commit.
    connection.execute(text("UPDATE fish_running_sequence SET next_running_no = next_running_no"))
    for table, rows in records.items():
        for key, expected in rows.items():
            row = (
                connection.execute(text(f"SELECT * FROM {table} WHERE id = :id FOR UPDATE"), {"id": key})
                .mappings()
                .first()
            )
            if row is None or fingerprint(row) != expected:
                raise APIError(409, "revert_dependency", f"{table} {key} changed after import")
            if connection.execute(
                text("SELECT id FROM correction_request WHERE target_id = :id AND status = 'pending' LIMIT 1"),
                {"id": key},
            ).first():
                raise APIError(409, "revert_dependency", f"{table} {key} has a pending correction")

    # Check all database foreign keys, including links and new observations. A
    # new consumer outside this graph must never become an orphaned live record.
    schema = inspect(connection)
    quote = connection.dialect.identifier_preparer.quote
    for table in schema.get_table_names():
        columns = {column["name"] for column in schema.get_columns(table)}
        for fk in schema.get_foreign_keys(table):
            parent = fk["referred_table"]
            if parent not in records or fk["referred_columns"] != ["id"]:
                continue
            column = quote(fk["constrained_columns"][0])
            active = " AND deleted_at IS NULL" if "deleted_at" in columns else ""
            for key in records[parent]:
                dependents = connection.execute(
                    text(f"SELECT * FROM {quote(table)} WHERE {column} = :id{active}"), {"id": key}
                ).mappings()
                for row in dependents:
                    if str(row.get("id")) in records.get(table, {}):
                        continue
                    if table == "specimen_fish_link" and str(row.get("import_job_id")) == job_id:
                        continue
                    raise APIError(409, "revert_dependency", f"{parent} {key} is used by {table}")
    connection.execute(text("DELETE FROM specimen_fish_link WHERE import_job_id = :job"), {"job": job_id})
    for table, rows in records.items():
        for key in rows:
            connection.execute(text(f"UPDATE {table} SET deleted_at = :now WHERE id = :id"), {"now": now, "id": key})
