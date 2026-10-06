"""Durable import drafts, isolated from the live entity snapshot."""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import text

from ..runtime.errors import APIError
from ..runtime.values import uuid7
from ..services.import_sources import ParsedSheet, SourceIssue, record_json
from ..services.import_interpret import interpret
from ..services.import_deferred import deferred_cells


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _iso(value: datetime | None) -> str | None:
    return value.replace(tzinfo=UTC).isoformat().replace("+00:00", "Z") if value else None


def _job_payload(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "inputKind": row["input_kind"],
        "status": row["status"],
        "createdByUserId": str(row["created_by_user_id"]),
        "createdAt": _iso(row["created_at"]),
        "updatedAt": _iso(row["updated_at"]),
        "confirmedAt": _iso(row.get("confirmed_at")),
        "revertedAt": _iso(row.get("reverted_at")),
        "revision": int(row["revision"]),
        "parserVersion": row["parser_version"],
        "selection": json.loads(row["selection_json"]),
    }


class ImportRepository:
    BACKFILL_FIELDS = {"clone_fish": {"remarks"}, "specimen": {"notes"}}

    def __init__(self, store: Any) -> None:
        self.store = store
        self.engine = getattr(store, "engine", None)
        self.lock = getattr(store, "lock", None)
        if self.engine is None:
            store.import_jobs = getattr(store, "import_jobs", {})
            store.import_files = getattr(store, "import_files", {})
            store.import_records = getattr(store, "import_records", {})
            store.import_issues = getattr(store, "import_issues", {})
            store.import_unmapped_fields = getattr(store, "import_unmapped_fields", {})

    def create(
        self, actor_id: str, input_kind: str, selection: dict[str, Any],
        files: list[dict[str, Any]], parsed: list[tuple[int, ParsedSheet]]
    ) -> dict[str, Any]:
        now = _now()
        job_id = uuid7()
        job = {
            "id": job_id,
            "input_kind": input_kind,
            "status": "draft",
            "created_by_user_id": actor_id,
            "confirmed_by_user_id": None,
            "reverted_by_user_id": None,
            "created_at": now,
            "updated_at": now,
            "confirmed_at": None,
            "reverted_at": None,
            "revision": 1,
            "parser_version": "1",
            "selection_json": json.dumps(selection, ensure_ascii=False, separators=(",", ":")),
            "note": None,
        }
        file_rows: list[dict[str, Any]] = []
        for item in files:
            content = item["content"]
            file_rows.append(
                {
                    "id": uuid7(),
                    "job_id": job_id,
                    "file_name": item["name"],
                    "sheet_name": item.get("sheet_name"),
                    "encoding": item.get("encoding"),
                    "media_type": item["media_type"],
                    "sha256": hashlib.sha256(content).hexdigest(),
                    "size_bytes": len(content),
                    "content": content,
                    "created_at": now,
                }
            )
        record_rows: list[dict[str, Any]] = []
        issue_rows: list[dict[str, Any]] = []
        deferred_rows: list[dict[str, Any]] = []
        for file_index, sheet in parsed:
            file_id = file_rows[file_index]["id"]
            records_for_sheet: dict[str, str] = {}
            records_by_row: dict[int, str] = {}
            for record in sheet.records:
                source_json, working_json = record_json(record)
                record_id = uuid7()
                record_rows.append(
                    {
                        "id": record_id,
                        "job_id": job_id,
                        "source_file_id": file_id,
                        "sheet_name": sheet.name,
                        "source_locator": record.source_locator,
                        "row_no": record.row_no,
                        "record_kind": record.record_kind,
                        "natural_key": record.natural_key,
                        "source_json": source_json,
                        "working_json": working_json,
                        "target_table": None,
                        "target_id": None,
                        "status": "pending",
                        "created_at": now,
                        "updated_at": now,
                    }
                )
                records_for_sheet[record.source_locator] = record_id
                records_by_row[record.row_no] = record_id
                for source_column, source_value in deferred_cells(record.record_kind, record.source):
                    deferred_rows.append({
                        "id": uuid7(), "job_id": job_id, "record_id": record_id,
                        "source_column": source_column,
                        "source_value": json.dumps(source_value, ensure_ascii=False),
                        "status": "pending", "created_at": now,
                    })
            for issue in sheet.issues:
                issue_rows.append(
                    self._issue_row(
                        job_id, file_id,
                        records_for_sheet.get(issue.source_locator or "") or records_by_row.get(issue.row_no or -1),
                        issue, now,
                    )
                )
        if self.engine is None:
            with self.lock:
                self.store.import_jobs[job_id] = job
                for row in file_rows:
                    self.store.import_files[row["id"]] = row
                for row in record_rows:
                    self.store.import_records[row["id"]] = row
                for row in issue_rows:
                    self.store.import_issues[row["id"]] = row
                for row in deferred_rows:
                    self.store.import_unmapped_fields[row["id"]] = row
        else:
            with self.engine.begin() as connection:
                self._insert_many(connection, "import_job", [job])
                self._insert_many(connection, "import_source_file", file_rows)
                self._insert_many(connection, "import_record", record_rows)
                self._insert_many(connection, "import_issue", issue_rows)
                self._insert_many(connection, "import_unmapped_field", deferred_rows)
        return {
            "job": _job_payload(job),
            "files": [self._file_payload(row) for row in file_rows],
            "recordCount": len(record_rows),
            "issueCount": len(issue_rows),
            "deferredFieldCount": len(deferred_rows),
            "sheets": [
                {"name": sheet.name, "kind": sheet.kind, "recordCount": sheet.row_count, "issueCount": len(sheet.issues)}
                for _, sheet in parsed
            ],
        }

    @staticmethod
    def _insert_many(connection: Any, table: str, rows: list[dict[str, Any]]) -> None:
        if not rows:
            return
        columns = tuple(rows[0])
        statement = text(
            f"INSERT INTO {table} ({', '.join(columns)}) "
            f"VALUES ({', '.join(':' + column for column in columns)})"
        )
        connection.execute(statement, rows)

    @staticmethod
    def _issue_row(
        job_id: str, file_id: str, record_id: str | None, issue: SourceIssue, now: datetime
    ) -> dict[str, Any]:
        return {
            "id": uuid7(),
            "job_id": job_id,
            "record_id": record_id,
            "source_file_id": file_id,
            "sheet_name": issue.sheet_name,
            "source_locator": issue.source_locator,
            "row_no": issue.row_no,
            "severity": issue.severity,
            "code": issue.code,
            "source_column": issue.source_column,
            "message": issue.message,
            "source_value": issue.source_value,
            "status": "open",
            "resolution_value": None,
            "resolution_reason": None,
            "resolved_by_user_id": None,
            "created_at": now,
            "updated_at": now,
        }

    @staticmethod
    def _file_payload(row: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": str(row["id"]),
            "fileName": row["file_name"],
            "sheetName": row["sheet_name"],
            "encoding": row["encoding"],
            "mediaType": row["media_type"],
            "sha256": row["sha256"],
            "sizeBytes": int(row["size_bytes"]),
        }

    def list_jobs(self, limit: int = 50) -> list[dict[str, Any]]:
        if self.engine is None:
            with self.lock:
                rows = sorted(self.store.import_jobs.values(), key=lambda row: row["created_at"], reverse=True)[:limit]
                return [_job_payload(row) for row in rows]
        with self.engine.connect() as connection:
            rows = connection.execute(
                text("SELECT * FROM import_job ORDER BY created_at DESC, id DESC LIMIT :limit"), {"limit": limit}
            ).mappings().all()
        return [_job_payload(dict(row)) for row in rows]

    def _job(self, job_id: str) -> dict[str, Any]:
        if self.engine is None:
            with self.lock:
                row = self.store.import_jobs.get(job_id)
                if row is None:
                    raise APIError(404, "not_found", "Import job was not found")
                return dict(row)
        with self.engine.connect() as connection:
            row = connection.execute(text("SELECT * FROM import_job WHERE id = :id"), {"id": job_id}).mappings().first()
        if row is None:
            raise APIError(404, "not_found", "Import job was not found")
        return dict(row)

    def get_job(self, job_id: str) -> dict[str, Any]:
        job = self._job(job_id)
        if self.engine is None:
            with self.lock:
                files = [row for row in self.store.import_files.values() if row["job_id"] == job_id]
                records = [row for row in self.store.import_records.values() if row["job_id"] == job_id]
                issues = [row for row in self.store.import_issues.values() if row["job_id"] == job_id]
                deferred_count = sum(1 for row in self.store.import_unmapped_fields.values()
                                     if row["job_id"] == job_id)
        else:
            with self.engine.connect() as connection:
                files = [dict(row) for row in connection.execute(
                    text("SELECT id, job_id, file_name, sheet_name, encoding, media_type, sha256, size_bytes "
                         "FROM import_source_file WHERE job_id = :id ORDER BY created_at, id"), {"id": job_id}
                ).mappings()]
                records = connection.execute(
                    text("SELECT COUNT(*) FROM import_record WHERE job_id = :id"), {"id": job_id}
                ).scalar_one()
                issues = connection.execute(
                    text("SELECT COUNT(*) FROM import_issue WHERE job_id = :id"), {"id": job_id}
                ).scalar_one()
                deferred_count = int(connection.execute(text(
                    "SELECT COUNT(*) FROM import_unmapped_field WHERE job_id = :id"
                ), {"id": job_id}).scalar_one())
        return {
            "job": _job_payload(job),
            "files": [self._file_payload(row) for row in files],
            "recordCount": len(records) if isinstance(records, list) else int(records),
            "issueCount": len(issues) if isinstance(issues, list) else int(issues),
            "deferredFieldCount": deferred_count,
        }

    def list_records(self, job_id: str, offset: int, limit: int) -> list[dict[str, Any]]:
        self._job(job_id)
        if self.engine is None:
            with self.lock:
                rows = [row for row in self.store.import_records.values() if row["job_id"] == job_id]
                rows.sort(key=lambda row: (row["sheet_name"], row["row_no"], row["source_locator"]))
                rows = rows[offset : offset + limit]
        else:
            with self.engine.connect() as connection:
                rows = [dict(row) for row in connection.execute(
                    text("SELECT * FROM import_record WHERE job_id = :id "
                         "ORDER BY sheet_name, row_no, source_locator LIMIT :limit OFFSET :offset"),
                    {"id": job_id, "limit": limit, "offset": offset},
                ).mappings()]
        return [
            {
                "id": str(row["id"]),
                "sheetName": row["sheet_name"],
                "sourceLocator": row["source_locator"],
                "rowNo": int(row["row_no"]),
                "recordKind": row["record_kind"],
                "naturalKey": row["natural_key"],
                "source": json.loads(row["source_json"]),
                "working": json.loads(row["working_json"]),
                "status": row["status"],
                "targetTable": row["target_table"],
                "targetId": str(row["target_id"]) if row["target_id"] else None,
            }
            for row in rows
        ]

    def list_issues(self, job_id: str, offset: int, limit: int) -> list[dict[str, Any]]:
        self._job(job_id)
        if self.engine is None:
            with self.lock:
                rows = [row for row in self.store.import_issues.values() if row["job_id"] == job_id]
                rows.sort(key=lambda row: (row["created_at"], row["id"]))
                rows = rows[offset : offset + limit]
        else:
            with self.engine.connect() as connection:
                rows = [dict(row) for row in connection.execute(
                    text("SELECT * FROM import_issue WHERE job_id = :id "
                         "ORDER BY created_at, id LIMIT :limit OFFSET :offset"),
                    {"id": job_id, "limit": limit, "offset": offset},
                ).mappings()]
        return [
            {
                "id": str(row["id"]),
                "recordId": str(row["record_id"]) if row["record_id"] else None,
                "sourceFileId": str(row["source_file_id"]),
                "sheetName": row["sheet_name"],
                "sourceLocator": row["source_locator"],
                "rowNo": row["row_no"],
                "severity": row["severity"],
                "code": row["code"],
                "sourceColumn": row["source_column"],
                "message": row["message"],
                "sourceValue": row["source_value"],
                "status": row["status"],
                "resolutionValue": row["resolution_value"],
                "resolutionReason": row["resolution_reason"],
                "resolvedByUserId": str(row["resolved_by_user_id"]) if row["resolved_by_user_id"] else None,
            }
            for row in rows
        ]

    def list_deferred_fields(self, offset: int, limit: int) -> dict[str, Any]:
        if self.engine is None:
            with self.lock:
                items = list(self.store.import_unmapped_fields.values())
                items.sort(key=lambda row: (row["created_at"], row["id"]))
                total = len(items)
                rows = items[offset:offset + limit]
            return {"total": total, "items": [
                {"id": row["id"], "jobId": row["job_id"], "recordId": row["record_id"],
                 "sourceColumn": row["source_column"], "sourceValue": json.loads(row["source_value"]),
                 "status": row["status"], "targetTable": None, "targetId": None,
                 "targetFields": [], "rowVersion": None} for row in rows]}
        with self.engine.connect() as connection:
            total = int(connection.execute(text("SELECT COUNT(*) FROM import_unmapped_field")).scalar_one())
            rows = [dict(row) for row in connection.execute(text(
                "SELECT f.*, r.sheet_name, r.source_locator, r.target_table AS record_target_table, "
                "r.target_id AS record_target_id, j.status AS job_status "
                "FROM import_unmapped_field f JOIN import_record r ON r.id = f.record_id "
                "JOIN import_job j ON j.id = f.job_id "
                "ORDER BY f.created_at, f.id LIMIT :limit OFFSET :offset"
            ), {"limit": limit, "offset": offset}).mappings()]
            result = []
            for row in rows:
                table = row["record_target_table"]
                target_id = row["record_target_id"]
                version = None
                if table in self.BACKFILL_FIELDS and target_id and row["job_status"] == "committed":
                    version = connection.execute(text(
                        f"SELECT row_version FROM {table} WHERE id = :id AND deleted_at IS NULL"
                    ), {"id": target_id}).scalar_one_or_none()
                result.append({
                    "id": str(row["id"]), "jobId": str(row["job_id"]),
                    "recordId": str(row["record_id"]), "sheetName": row["sheet_name"],
                    "sourceLocator": row["source_locator"], "sourceColumn": row["source_column"],
                    "sourceValue": json.loads(row["source_value"]), "status": row["status"],
                    "targetTable": table, "targetId": str(target_id) if target_id else None,
                    "targetField": row["target_field"],
                    "targetFields": sorted(self.BACKFILL_FIELDS.get(table, set())) if version else [],
                    "rowVersion": int(version) if version else None,
                })
            return {"total": total, "items": result}

    def apply_deferred_field(self, field_id: str, actor: dict[str, Any],
                             body: dict[str, Any]) -> dict[str, Any]:
        if self.engine is None:
            raise APIError(503, "database_required", "Backfill requires the configured database")
        field = body.get("targetField")
        value = body.get("value")
        reason = body.get("reason")
        version = body.get("rowVersion")
        if not isinstance(value, str) or not value.strip() or len(value) > 2000:
            raise APIError(400, "invalid_value", "Enter a value of at most 2000 characters")
        if not isinstance(reason, str) or not reason.strip() or len(reason) > 2000:
            raise APIError(400, "invalid_reason", "Explain this field mapping")
        if not isinstance(version, int) or isinstance(version, bool):
            raise APIError(400, "invalid_version", "Provide the current target row version")
        now = _now()
        with self.engine.begin() as connection:
            row = connection.execute(text(
                "SELECT f.*, r.target_table AS record_target_table, r.target_id AS record_target_id, "
                "j.status AS job_status FROM import_unmapped_field f "
                "JOIN import_record r ON r.id = f.record_id "
                "JOIN import_job j ON j.id = f.job_id WHERE f.id = :id FOR UPDATE"
            ), {"id": field_id}).mappings().first()
            if row is None:
                raise APIError(404, "not_found", "Deferred field was not found")
            table = row["record_target_table"]
            target_id = row["record_target_id"]
            if row["status"] != "pending" or row["job_status"] != "committed" or not target_id:
                raise APIError(409, "not_ready", "Only an unapplied field from a committed import can be backfilled")
            if field not in self.BACKFILL_FIELDS.get(table, set()):
                raise APIError(400, "unsupported_field", "This target field is not supported for backfill")
            target = connection.execute(text(
                f"SELECT {field}, row_version FROM {table} WHERE id = :id AND deleted_at IS NULL FOR UPDATE"
            ), {"id": target_id}).mappings().first()
            if target is None or int(target["row_version"]) != version:
                raise APIError(409, "target_changed", "Target changed; reload the deferred-field list")
            if target[field] not in {None, ""}:
                raise APIError(409, "target_has_value", "Target field already has a value")
            connection.execute(text(
                f"UPDATE {table} SET {field} = :value, updated_at = :now, "
                "row_version = row_version + 1 WHERE id = :id"
            ), {"value": value.strip(), "now": now, "id": target_id})
            connection.execute(text(
                "UPDATE import_unmapped_field SET status = 'applied', target_table = :table, "
                "target_id = :target, target_field = :field, applied_by_user_id = :actor, "
                "applied_at = :now WHERE id = :id"
            ), {"table": table, "target": target_id, "field": field,
                "actor": actor["id"], "now": now, "id": field_id})
            self._audit(connection, actor, table, str(target_id),
                        {field: target[field]}, {field: value.strip(), "reason": reason.strip(),
                                                "sourceFieldId": field_id}, now)
            return {"id": field_id, "status": "applied", "targetTable": table,
                    "targetId": str(target_id), "targetField": field, "rowVersion": version + 1}

    def source_file(self, job_id: str, file_id: str) -> tuple[str, str, bytes]:
        self._job(job_id)
        if self.engine is None:
            with self.lock:
                row = self.store.import_files.get(file_id)
                if row is None or row["job_id"] != job_id:
                    raise APIError(404, "not_found", "Source file was not found")
        else:
            with self.engine.connect() as connection:
                row = connection.execute(
                    text("SELECT file_name, media_type, content FROM import_source_file "
                         "WHERE id = :file_id AND job_id = :job_id"),
                    {"file_id": file_id, "job_id": job_id},
                ).mappings().first()
                if row is None:
                    raise APIError(404, "not_found", "Source file was not found")
        return str(row["file_name"]), str(row["media_type"]), bytes(row["content"])

    def interpretation(self, job_id: str, record_id: str) -> dict[str, Any]:
        self._job(job_id)
        if self.engine is None:
            with self.lock:
                row = self.store.import_records.get(record_id)
                if row is None or row["job_id"] != job_id:
                    raise APIError(404, "not_found", "Import record was not found")
        else:
            with self.engine.connect() as connection:
                row = connection.execute(text(
                    "SELECT record_kind, working_json FROM import_record WHERE id = :id AND job_id = :job"
                ), {"id": record_id, "job": job_id}).mappings().first()
                if row is None:
                    raise APIError(404, "not_found", "Import record was not found")
        meaning = interpret(row["record_kind"], json.loads(row["working_json"]))
        if meaning is None:
            raise APIError(422, "not_interpreted", "This source layout has no interpretation yet")
        return {"recordId": record_id, "interpretation": meaning}

    def mapping_requirements(self, job_id: str) -> dict[str, Any]:
        self._job(job_id)
        if self.engine is None:
            with self.lock:
                rows = [row for row in self.store.import_records.values() if row["job_id"] == job_id]
                unresolved_count = sum(1 for issue in self.store.import_issues.values()
                                       if issue["job_id"] == job_id and issue["status"] == "open"
                                       and issue["severity"] in {"blocking", "overridable"})
        else:
            with self.engine.connect() as connection:
                rows = [dict(row) for row in connection.execute(text(
                    "SELECT record_kind, sheet_name, source_locator, working_json FROM import_record WHERE job_id = :id"
                ), {"id": job_id}).mappings()]
                unresolved_count = int(connection.execute(text(
                    "SELECT COUNT(*) FROM import_issue WHERE job_id = :id AND status = 'open' "
                    "AND severity IN ('blocking', 'overridable')"
                ), {"id": job_id}).scalar_one())
        donor_sources: set[str] = set()
        sites: set[str] = set()
        kinds: set[str] = set()
        ambiguous_zero: list[str] = []
        aggregate_warnings: list[str] = []
        for row in rows:
            kinds.add(row["record_kind"])
            if row["record_kind"] in {"legacy_lot", "scnt_aggregate", "control_aggregate"}:
                meaning = interpret(row["record_kind"], json.loads(row["working_json"])) or {}
                aggregate_warnings.extend(
                    f"{row['sheet_name']} {row.get('source_locator', '')}: {warning}"
                    for warning in meaning.get("warnings", [])
                )
            if row["record_kind"] != "fish":
                continue
            meaning = interpret("fish", json.loads(row["working_json"])) or {}
            donor_sources.add(str(meaning.get("donorSource") or "").strip())
            sites.add(row["sheet_name"])
            if any(entry["outcome"] == "UNRESOLVED_ZERO" for entry in meaning["observations"]):
                ambiguous_zero.append(f"{row['sheet_name']} {row.get('source_locator', '')}".strip())
        return {"donorSources": sorted(donor_sources), "sheetNames": sorted(sites),
                "recordKinds": sorted(kinds), "ambiguousZeroRecords": ambiguous_zero,
                "unresolvedIssueCount": unresolved_count,
                "aggregateWarningCount": len(aggregate_warnings),
                "aggregateWarningPreview": aggregate_warnings[:30],
                "canConfirmFishSpecimens": bool(rows) and kinds <= {"fish", "specimen"},
                "canConfirmAggregate": bool(rows) and kinds <= {
                    "legacy_lot", "scnt_aggregate", "control_aggregate"}}

    def confirm_aggregate(self, job_id: str, revision: int, actor: dict[str, Any],
                          warning_reason: str) -> dict[str, Any]:
        """Keep historical counts outside operational timing metrics, in one transaction."""
        if self.engine is None:
            raise APIError(503, "database_required", "Canonical import requires the configured database")
        now = _now()
        with self.engine.begin() as connection:
            job = connection.execute(text("SELECT * FROM import_job WHERE id = :id FOR UPDATE"),
                                     {"id": job_id}).mappings().first()
            if job is None:
                raise APIError(404, "not_found", "Import job was not found")
            self._check_draft(job, revision)
            records = [dict(row) for row in connection.execute(text(
                "SELECT * FROM import_record WHERE job_id = :id ORDER BY sheet_name, row_no, id"
            ), {"id": job_id}).mappings()]
            if not records or any(row["record_kind"] not in {
                "legacy_lot", "scnt_aggregate", "control_aggregate"} for row in records):
                raise APIError(409, "not_ready", "Confirm a job containing only historical count sheets")
            unresolved = connection.execute(text(
                "SELECT COUNT(*) FROM import_issue WHERE job_id = :id AND status = 'open' "
                "AND severity IN ('blocking', 'overridable')"
            ), {"id": job_id}).scalar_one()
            if unresolved:
                raise APIError(409, "issues_open", "Resolve blocking and overridable issues first")
            rows: list[dict[str, Any]] = []
            first_ids: dict[str, str] = {}
            warnings: list[str] = []
            for record in records:
                meaning = interpret(record["record_kind"], json.loads(record["working_json"]))
                if meaning is None or not meaning["counts"]:
                    raise APIError(409, "counts_missing", f"{record['sheet_name']} {record['source_locator']}: no usable counts")
                warnings.extend(f"{record['sheet_name']} {record['source_locator']}: {warning}"
                                for warning in meaning["warnings"])
                for count in meaning["counts"]:
                    count_id = uuid7()
                    first_ids.setdefault(record["id"], count_id)
                    rows.append({
                        "id": count_id, "import_job_id": job_id, "import_record_id": record["id"],
                        "stage_label": count["stageLabel"], "observed_on": count["observedOn"],
                        "n_total": count.get("nTotal"), "n_alive": count.get("nAlive"),
                        "n_normal": count.get("nNormal"), "n_abnormal": count.get("nAbnormal"),
                        "numerator": count.get("numerator"), "denominator": count.get("denominator"),
                        "raw_value": json.dumps({"column": count["sourceColumn"],
                                                 "row": count.get("sourceRow", record["row_no"]),
                                                 "value": count["sourceValue"]}, ensure_ascii=False),
                        "created_at": now,
                    })
            if warnings and (not warning_reason.strip() or len(warning_reason) > 2000):
                raise APIError(409, "aggregate_warning", "Some counts or dates could not be interpreted; provide a bypass reason")
            self._insert_many(connection, "historical_stage_count", rows)
            for record in records:
                self._mark_imported(connection, record["id"], "historical_stage_count",
                                    first_ids[record["id"]], now)
            connection.execute(text(
                "UPDATE import_job SET status = 'committed', confirmed_by_user_id = :actor, "
                "confirmed_at = :now, updated_at = :now, revision = revision + 1 WHERE id = :id"
            ), {"actor": actor["id"], "now": now, "id": job_id})
            self._audit(connection, actor, "import_job", job_id, {"status": "draft"},
                        {"status": "committed", "historicalCountRows": len(rows),
                         "warningCount": len(warnings), "warningBypassReason": warning_reason.strip() or None}, now)
            return {"jobId": job_id, "status": "committed", "revision": revision + 1,
                    "historicalCountRows": len(rows), "warningCount": len(warnings)}

    def confirm_fish_specimens(self, job_id: str, revision: int, actor: dict[str, Any],
                               site_mappings: dict[str, str], donor_mappings: dict[str, str],
                               zero_bypass_reason: str) -> dict[str, Any]:
        """Atomically import selected fish/specimen sheets after explicit master mapping."""
        if self.engine is None:
            raise APIError(503, "database_required", "Canonical import requires the configured database")
        now = _now()
        with self.engine.begin() as connection:
            job = connection.execute(text("SELECT * FROM import_job WHERE id = :id FOR UPDATE"),
                                     {"id": job_id}).mappings().first()
            if job is None:
                raise APIError(404, "not_found", "Import job was not found")
            self._check_draft(job, revision)
            records = [dict(row) for row in connection.execute(text(
                "SELECT * FROM import_record WHERE job_id = :id ORDER BY sheet_name, row_no, id"
            ), {"id": job_id}).mappings()]
            if not records or any(row["record_kind"] not in {"fish", "specimen"} for row in records):
                raise APIError(409, "not_ready", "Confirm a job containing only fish and specimen sheets")
            unresolved = connection.execute(text(
                "SELECT COUNT(*) FROM import_issue WHERE job_id = :id AND status = 'open' "
                "AND severity IN ('blocking', 'overridable')"
            ), {"id": job_id}).scalar_one()
            if unresolved:
                raise APIError(409, "issues_open", "Resolve blocking and overridable issues first")
            sites = {str(row["id"]): row for row in connection.execute(text(
                "SELECT id, time_zone FROM site WHERE active = TRUE AND deleted_at IS NULL"
            )).mappings()}
            donors = {str(row["id"]) for row in connection.execute(text(
                "SELECT id FROM donor_cell_line WHERE active = TRUE AND deleted_at IS NULL"
            )).mappings()}
            fish_plan: list[tuple[dict[str, Any], dict[str, Any], str, str]] = []
            specimen_plan: list[tuple[dict[str, Any], dict[str, Any]]] = []
            fish_codes: set[str] = set()
            specimen_codes: set[str] = set()
            for record in records:
                meaning = interpret(record["record_kind"], json.loads(record["working_json"]))
                if meaning is None:
                    raise APIError(409, "not_ready", "A selected source record cannot be interpreted")
                if record["record_kind"] == "fish":
                    code = str(meaning.get("fishCode") or "").strip()
                    donor_source = str(meaning.get("donorSource") or "").strip()
                    donor_id = donor_mappings.get(donor_source)
                    site_id = site_mappings.get(record["sheet_name"])
                    if not code or len(code) > 150 or not meaning.get("dob"):
                        raise APIError(409, "fish_incomplete", f"{record['sheet_name']} {record['source_locator']}: fish code or DOB is missing")
                    if donor_id not in donors or site_id not in sites or not sites[site_id]["time_zone"]:
                        raise APIError(409, "master_mapping_missing", f"{record['sheet_name']} {record['source_locator']}: choose an active donor and site with time zone")
                    norm = code.casefold()
                    if norm in fish_codes:
                        raise APIError(409, "duplicate_fish", f"Fish code {code} appears twice in this import")
                    fish_codes.add(norm)
                    if any(entry["outcome"] == "UNRESOLVED_ZERO" for entry in meaning["observations"]):
                        if not zero_bypass_reason.strip() or len(zero_bypass_reason) > 2000:
                            raise APIError(409, "ambiguous_survival", f"{record['sheet_name']} {record['source_locator']}: give a bypass reason for zeros after an undated disposition")
                    if meaning["warnings"] and any("expected 1 or 0" in warning for warning in meaning["warnings"]):
                        raise APIError(409, "invalid_survival", f"{record['sheet_name']} {record['source_locator']}: fix invalid day flags")
                    fish_plan.append((record, meaning, site_id, donor_id))
                else:
                    code = str(meaning.get("specimenCode") or "").strip()
                    if not code or len(code) > 50 or not meaning.get("specimenKind"):
                        raise APIError(409, "specimen_incomplete", f"{record['sheet_name']} {record['source_locator']}: specimen code is invalid")
                    norm = code.casefold()
                    if norm in specimen_codes:
                        raise APIError(409, "duplicate_specimen", f"Specimen code {code} appears twice in this import")
                    specimen_codes.add(norm)
                    specimen_plan.append((record, meaning))
            for code in fish_codes:
                found = connection.execute(text(
                    "SELECT id FROM clone_fish WHERE fish_code_norm = :code AND deleted_at IS NULL"
                ), {"code": code}).first()
                if found:
                    raise APIError(409, "duplicate_fish", f"Fish code {code} already exists")
            all_specimens = [dict(row) for row in connection.execute(text(
                "SELECT id, specimen_code, deleted_at FROM specimen"
            )).mappings()]
            existing_specimens = {str(row["specimen_code"]).strip().casefold(): str(row["id"])
                                  for row in all_specimens if row["deleted_at"] is None}
            all_specimen_codes = set(existing_specimens)
            for code in specimen_codes:
                if code in all_specimen_codes:
                    raise APIError(409, "duplicate_specimen", f"Specimen code {code} already exists")
            available_specimens = set(existing_specimens) | specimen_codes
            for record, meaning, _, _ in fish_plan:
                missing_codes = [str(code) for code in meaning["sourceSpecimenCodes"]
                                 if str(code).strip().casefold() not in available_specimens]
                if missing_codes:
                    raise APIError(409, "specimen_missing",
                                   f"{record['sheet_name']} {record['source_locator']}: import specimen {', '.join(missing_codes)} first")
            sequence_id = "00000000-0000-7000-8000-000000000006"
            next_no = connection.execute(text(
                "SELECT next_running_no FROM fish_running_sequence WHERE id = :id FOR UPDATE"
            ), {"id": sequence_id}).scalar_one()
            inserted_specimens: dict[str, str] = dict(existing_specimens)
            for record, meaning in specimen_plan:
                specimen_id = uuid7()
                code = meaning["specimenCode"]
                connection.execute(text(
                    "INSERT INTO specimen (id, clone_fish_id, specimen_code, specimen_kind, specimen_type, "
                    "created_at, updated_at) VALUES (:id, NULL, :code, :kind, :type, :now, :now)"
                ), {"id": specimen_id, "code": code, "kind": meaning["specimenKind"],
                    "type": meaning["specimenType"], "now": now})
                inserted_specimens[code.casefold()] = specimen_id
                self._mark_imported(connection, record["id"], "specimen", specimen_id, now)
                self._audit_insert(connection, actor, "specimen", specimen_id, meaning, now)
            fish_count = 0
            observation_count = 0
            historical_rows: list[dict[str, Any]] = []
            links: set[tuple[str, str]] = set()
            for record, meaning, site_id, donor_id in fish_plan:
                fish_id = uuid7()
                exit_date = meaning["exitDate"] if meaning["status"] in {"DEAD", "FROZEN", "DISCARDED"} else None
                exit_reason = meaning["status"] if exit_date else None
                connection.execute(text(
                    "INSERT INTO clone_fish (id, fish_code, running_no, dob, donor_cell_line_id, site_id, import_job_id, "
                    "status, life_state, disposition, biological_condition, sex, fin_clipped, "
                    "exit_date, exit_reason, created_at, updated_at) VALUES "
                    "(:id, :code, :running, :dob, :donor, :site, :job, :status, :life, :disposition, "
                    ":condition, 'UNKNOWN', FALSE, :exit_date, :exit_reason, :now, :now)"
                ), {"id": fish_id, "code": meaning["fishCode"], "running": next_no,
                    "dob": meaning["dob"], "donor": donor_id, "site": site_id, "job": job_id,
                    "status": meaning["status"], "life": meaning["lifeState"],
                    "disposition": meaning["disposition"], "condition": meaning["biologicalCondition"],
                    "exit_date": exit_date, "exit_reason": exit_reason, "now": now})
                next_no += 1
                fish_count += 1
                self._mark_imported(connection, record["id"], "clone_fish", fish_id, now)
                self._audit_insert(connection, actor, "clone_fish", fish_id,
                                   {"fishCode": meaning["fishCode"], "sourceRecordId": record["id"]}, now)
                for code in meaning["sourceSpecimenCodes"]:
                    specimen_id = inserted_specimens.get(str(code).strip().casefold())
                    if specimen_id:
                        links.add((specimen_id, fish_id))
                for entry in meaning["observations"]:
                    if not entry["observedOn"]:
                        continue
                    observation_id = uuid7()
                    historical_rows.append({
                        "id": observation_id, "import_job_id": job_id, "import_record_id": record["id"],
                        "clone_fish_id": fish_id, "observed_on": entry["observedOn"],
                        "time_precision": "date", "stage_label": f"d{entry['day']}",
                        "outcome": entry["outcome"], "biological_condition": "UNDETERMINED",
                        "raw_value": json.dumps({"column": entry["sourceColumn"], "value": entry["sourceValue"]}, ensure_ascii=False),
                        "created_at": now,
                    })
                    observation_count += 1
            self._insert_many(connection, "historical_observation", historical_rows)
            for specimen_id, fish_id in sorted(links):
                connection.execute(text(
                    "INSERT INTO specimen_fish_link (specimen_id, clone_fish_id, linked_at, import_job_id) "
                    "VALUES (:specimen, :fish, :now, :job)"
                ), {"specimen": specimen_id, "fish": fish_id, "now": now, "job": job_id})
            connection.execute(text(
                "UPDATE fish_running_sequence SET next_running_no = :next WHERE id = :id"
            ), {"next": next_no, "id": sequence_id})
            connection.execute(text(
                "UPDATE import_job SET status = 'committed', confirmed_by_user_id = :actor, "
                "confirmed_at = :now, updated_at = :now, revision = revision + 1 WHERE id = :id"
            ), {"actor": actor["id"], "now": now, "id": job_id})
            self._audit(connection, actor, "import_job", job_id, {"status": "draft"},
                        {"status": "committed", "fishCount": fish_count,
                         "specimenCount": len(specimen_plan),
                         "historicalObservationCount": observation_count,
                         "zeroBypassReason": zero_bypass_reason.strip() or None}, now)
            return {"jobId": job_id, "status": "committed", "revision": revision + 1,
                    "fishCount": fish_count, "specimenCount": len(specimen_plan),
                    "historicalObservationCount": observation_count}

    @staticmethod
    def _mark_imported(connection: Any, record_id: str, table: str, target_id: str, now: datetime) -> None:
        connection.execute(text(
            "UPDATE import_record SET target_table = :table, target_id = :target, status = 'imported', "
            "updated_at = :now WHERE id = :id"
        ), {"table": table, "target": target_id, "now": now, "id": record_id})

    @staticmethod
    def _audit_insert(connection: Any, actor: dict[str, Any], table: str,
                      record_id: str, value: dict[str, Any], now: datetime) -> None:
        connection.execute(text(
            "INSERT INTO audit_log (id, table_name, record_id, action, new_values, "
            "actor_user_id, actor_email, occurred_at) VALUES "
            "(:id, :table, :record, 'INSERT', :new, :actor, :email, :now)"
        ), {"id": uuid7(), "table": table, "record": record_id,
            "new": json.dumps(value, ensure_ascii=False),
            "actor": actor["id"], "email": actor["email"], "now": now})

    def fish_statuses(self, job_id: str) -> list[dict[str, Any]]:
        self._job(job_id)
        if self.engine is None:
            return []
        with self.engine.connect() as connection:
            rows = connection.execute(text(
                "SELECT id, fish_code, status, life_state, disposition, exit_date, row_version "
                "FROM clone_fish WHERE import_job_id = :job AND deleted_at IS NULL ORDER BY running_no"
            ), {"job": job_id}).mappings()
            return [{"id": str(row["id"]), "fishCode": row["fish_code"], "status": row["status"],
                     "lifeState": row["life_state"], "disposition": row["disposition"],
                     "exitDate": row["exit_date"].isoformat() if row["exit_date"] else None,
                     "rowVersion": int(row["row_version"])} for row in rows]

    def review_fish_status(self, job_id: str, fish_id: str, actor: dict[str, Any],
                           body: dict[str, Any]) -> dict[str, Any]:
        if self.engine is None:
            raise APIError(503, "database_required", "Fish status review requires the configured database")
        status = body.get("status")
        life_state = body.get("lifeState")
        disposition = body.get("disposition")
        exit_date = body.get("exitDate")
        reason = body.get("reason")
        version = body.get("rowVersion")
        if not isinstance(reason, str) or not reason.strip() or len(reason) > 2000:
            raise APIError(400, "invalid_reason", "Explain the fish status decision")
        if not isinstance(version, int) or isinstance(version, bool):
            raise APIError(400, "invalid_version", "Provide the fish row version")
        if status not in {"ALIVE", "DEAD", "FROZEN", "DISCARDED", "UNKNOWN"}:
            raise APIError(400, "invalid_status", "Choose a supported fish status")
        if life_state not in {"ALIVE", "DEAD", "UNKNOWN"} or disposition not in {
            "NONE", "FROZEN", "DISCARDED", "LOST", "UNKNOWN"
        }:
            raise APIError(400, "invalid_status", "Choose a life state and disposition")
        if exit_date is not None:
            try:
                from datetime import date
                exit_date = date.fromisoformat(exit_date).isoformat()
            except (TypeError, ValueError) as error:
                raise APIError(400, "invalid_date", "Exit date must be YYYY-MM-DD") from error
        if status == "ALIVE" and (life_state != "ALIVE" or disposition != "NONE" or exit_date):
            raise APIError(400, "invalid_status", "An alive fish cannot have an exit date or disposition")
        if status == "DEAD" and (life_state != "DEAD" or disposition != "NONE" or not exit_date):
            raise APIError(400, "invalid_status", "A dead fish needs a known death date")
        if status in {"FROZEN", "DISCARDED"} and (disposition != status or not exit_date):
            raise APIError(400, "invalid_status", "A frozen or discarded fish needs a matching disposition and date")
        if status == "UNKNOWN" and exit_date:
            raise APIError(400, "invalid_status", "Unknown current status cannot have a confirmed exit date")
        now = _now()
        with self.engine.begin() as connection:
            row = connection.execute(text(
                "SELECT id, status, life_state, disposition, exit_date, row_version "
                "FROM clone_fish WHERE id = :fish AND import_job_id = :job AND deleted_at IS NULL FOR UPDATE"
            ), {"fish": fish_id, "job": job_id}).mappings().first()
            if row is None:
                raise APIError(404, "not_found", "Imported fish was not found")
            if int(row["row_version"]) != version:
                raise APIError(409, "fish_changed", "Fish changed; reload before reviewing status")
            before = {"status": row["status"], "lifeState": row["life_state"],
                      "disposition": row["disposition"],
                      "exitDate": row["exit_date"].isoformat() if row["exit_date"] else None}
            after = {"status": status, "lifeState": life_state, "disposition": disposition,
                     "exitDate": exit_date, "reason": reason.strip()}
            connection.execute(text(
                "UPDATE clone_fish SET status = :status, life_state = :life, disposition = :disposition, "
                "exit_date = :exit_date, exit_reason = :exit_reason, updated_at = :now, "
                "row_version = row_version + 1 WHERE id = :fish"
            ), {"status": status, "life": life_state, "disposition": disposition,
                "exit_date": exit_date, "exit_reason": status if status in {"DEAD", "FROZEN", "DISCARDED"} else None,
                "now": now, "fish": fish_id})
            self._audit(connection, actor, "clone_fish", fish_id, before, after, now)
            return {"id": fish_id, **after, "rowVersion": version + 1}

    def revert_fish_specimens(self, job_id: str, revision: int, actor: dict[str, Any],
                              reason: str) -> dict[str, Any]:
        if self.engine is None:
            raise APIError(503, "database_required", "Import revert requires the configured database")
        if not reason.strip() or len(reason) > 2000:
            raise APIError(400, "invalid_reason", "Explain why the import is being reverted")
        now = _now()
        with self.engine.begin() as connection:
            job = connection.execute(text("SELECT * FROM import_job WHERE id = :id FOR UPDATE"),
                                     {"id": job_id}).mappings().first()
            if job is None:
                raise APIError(404, "not_found", "Import job was not found")
            if job["status"] != "committed" or int(job["revision"]) != revision:
                raise APIError(409, "import_changed", "Only an unchanged committed job can be reverted")
            targets = [dict(row) for row in connection.execute(text(
                "SELECT target_table, target_id FROM import_record WHERE job_id = :job AND status = 'imported'"
            ), {"job": job_id}).mappings()]
            if targets and all(row["target_table"] == "historical_stage_count" for row in targets):
                count = connection.execute(text(
                    "SELECT COUNT(*) FROM historical_stage_count WHERE import_job_id = :job AND deleted_at IS NULL"
                ), {"job": job_id}).scalar_one()
                connection.execute(text(
                    "UPDATE historical_stage_count SET deleted_at = :now "
                    "WHERE import_job_id = :job AND deleted_at IS NULL"
                ), {"job": job_id, "now": now})
                connection.execute(text(
                    "UPDATE import_job SET status = 'reverted', reverted_by_user_id = :actor, "
                    "reverted_at = :now, updated_at = :now, revision = revision + 1 WHERE id = :job"
                ), {"actor": actor["id"], "now": now, "job": job_id})
                self._audit(connection, actor, "import_job", job_id, {"status": "committed"},
                            {"status": "reverted", "reason": reason.strip(),
                             "historicalCountRows": count}, now)
                return {"jobId": job_id, "status": "reverted", "revision": revision + 1,
                        "historicalCountRows": count}
            fish_ids = [str(row["target_id"]) for row in targets if row["target_table"] == "clone_fish"]
            specimen_ids = [str(row["target_id"]) for row in targets if row["target_table"] == "specimen"]
            if len(fish_ids) + len(specimen_ids) != len(targets):
                raise APIError(409, "revert_unsupported", "This import contains other canonical record types")
            fish_id_set = set(fish_ids)
            for fish_id in fish_ids:
                version = connection.execute(text(
                    "SELECT row_version FROM clone_fish WHERE id = :id AND deleted_at IS NULL FOR UPDATE"
                ), {"id": fish_id}).scalar_one_or_none()
                if version is None or int(version) != 1:
                    raise APIError(409, "revert_dependency", f"Fish {fish_id} changed after import")
                if connection.execute(text(
                    "SELECT id FROM fish_observation WHERE clone_fish_id = :id AND deleted_at IS NULL LIMIT 1"
                ), {"id": fish_id}).first():
                    raise APIError(409, "revert_dependency", f"Fish {fish_id} has newer observations")
                if connection.execute(text(
                    "SELECT id FROM historical_observation WHERE clone_fish_id = :id "
                    "AND import_job_id <> :job AND deleted_at IS NULL LIMIT 1"
                ), {"id": fish_id, "job": job_id}).first():
                    raise APIError(409, "revert_dependency", f"Fish {fish_id} is used by another import")
                if connection.execute(text(
                    "SELECT specimen_id FROM specimen_fish_link WHERE clone_fish_id = :id "
                    "AND (import_job_id IS NULL OR import_job_id <> :job) LIMIT 1"
                ), {"id": fish_id, "job": job_id}).first():
                    raise APIError(409, "revert_dependency", f"Fish {fish_id} has a newer specimen link")
                if connection.execute(text(
                    "SELECT id FROM audit_log WHERE table_name = 'clone_fish' AND record_id = :id "
                    "AND action IN ('UPDATE', 'DELETE') AND occurred_at > :confirmed LIMIT 1"
                ), {"id": fish_id, "confirmed": job["confirmed_at"]}).first():
                    raise APIError(409, "revert_dependency", f"Fish {fish_id} changed after import")
            for specimen_id in specimen_ids:
                version = connection.execute(text(
                    "SELECT row_version FROM specimen WHERE id = :id AND deleted_at IS NULL FOR UPDATE"
                ), {"id": specimen_id}).scalar_one_or_none()
                if version is None or int(version) != 1:
                    raise APIError(409, "revert_dependency", f"Specimen {specimen_id} changed after import")
                external = connection.execute(text(
                    "SELECT clone_fish_id FROM specimen_fish_link WHERE specimen_id = :id"
                ), {"id": specimen_id}).mappings().all()
                if any(str(row["clone_fish_id"]) not in fish_id_set for row in external):
                    raise APIError(409, "revert_dependency", f"Specimen {specimen_id} is linked to another fish")
                if connection.execute(text(
                    "SELECT id FROM audit_log WHERE table_name = 'specimen' AND record_id = :id "
                    "AND action IN ('UPDATE', 'DELETE') AND occurred_at > :confirmed LIMIT 1"
                ), {"id": specimen_id, "confirmed": job["confirmed_at"]}).first():
                    raise APIError(409, "revert_dependency", f"Specimen {specimen_id} changed after import")
            for fish_id in fish_ids:
                connection.execute(text("DELETE FROM specimen_fish_link WHERE clone_fish_id = :id"), {"id": fish_id})
            connection.execute(text(
                "UPDATE historical_observation SET deleted_at = :now WHERE import_job_id = :job AND deleted_at IS NULL"
            ), {"now": now, "job": job_id})
            connection.execute(text(
                "UPDATE clone_fish SET deleted_at = :now, updated_at = :now, row_version = row_version + 1 "
                "WHERE import_job_id = :job AND deleted_at IS NULL"
            ), {"now": now, "job": job_id})
            for specimen_id in specimen_ids:
                connection.execute(text(
                    "UPDATE specimen SET deleted_at = :now, updated_at = :now WHERE id = :id"
                ), {"now": now, "id": specimen_id})
            connection.execute(text(
                "UPDATE import_job SET status = 'reverted', reverted_by_user_id = :actor, "
                "reverted_at = :now, updated_at = :now, revision = revision + 1 WHERE id = :job"
            ), {"actor": actor["id"], "now": now, "job": job_id})
            self._audit(connection, actor, "import_job", job_id, {"status": "committed"},
                        {"status": "reverted", "reason": reason.strip(),
                         "fishCount": len(fish_ids), "specimenCount": len(specimen_ids)}, now)
            return {"jobId": job_id, "status": "reverted", "revision": revision + 1,
                    "fishCount": len(fish_ids), "specimenCount": len(specimen_ids)}

    @staticmethod
    def _audit(connection: Any, actor: dict[str, Any], table: str, record_id: str,
               before: dict[str, Any], after: dict[str, Any], now: datetime) -> None:
        connection.execute(text(
            "INSERT INTO audit_log (id, table_name, record_id, action, old_values, new_values, "
            "actor_user_id, actor_email, occurred_at) VALUES "
            "(:id, :table, :record, 'UPDATE', :old, :new, :actor, :email, :now)"
        ), {
            "id": uuid7(), "table": table, "record": record_id,
            "old": json.dumps(before, ensure_ascii=False),
            "new": json.dumps(after, ensure_ascii=False),
            "actor": actor["id"], "email": actor["email"], "now": now,
        })

    def revise_record(self, job_id: str, record_id: str, working: dict[str, Any],
                      reason: str, revision: int, actor: dict[str, Any]) -> dict[str, Any]:
        if not reason.strip() or len(reason) > 2000:
            raise APIError(400, "invalid_reason", "Explain why the source value is being changed")
        try:
            encoded = json.dumps(working, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        except (TypeError, ValueError) as error:
            raise APIError(400, "invalid_edit", "Working values must be valid JSON") from error
        if len(encoded) > 1_000_000:
            raise APIError(413, "record_too_large", "Edited record is too large")
        now = _now()
        if self.engine is None:
            with self.lock:
                job = self.store.import_jobs.get(job_id)
                row = self.store.import_records.get(record_id)
                if job is None or row is None or row["job_id"] != job_id:
                    raise APIError(404, "not_found", "Import record was not found")
                self._check_draft(job, revision)
                before = {"working": json.loads(row["working_json"])}
                after = {"working": working, "reason": reason.strip()}
                row["working_json"] = encoded
                row["updated_at"] = now
                job["revision"] += 1
                job["updated_at"] = now
                self._memory_audit(actor, "import_record", record_id, before, after, now)
                return {"revision": job["revision"], "working": working}
        with self.engine.begin() as connection:
            job = connection.execute(text("SELECT * FROM import_job WHERE id = :id FOR UPDATE"), {"id": job_id}).mappings().first()
            row = connection.execute(text("SELECT * FROM import_record WHERE id = :id AND job_id = :job"),
                                     {"id": record_id, "job": job_id}).mappings().first()
            if job is None or row is None:
                raise APIError(404, "not_found", "Import record was not found")
            self._check_draft(job, revision)
            self._audit(connection, actor, "import_record", record_id,
                        {"working": json.loads(row["working_json"])},
                        {"working": working, "reason": reason.strip()}, now)
            connection.execute(text("UPDATE import_record SET working_json = :working, updated_at = :now WHERE id = :id"),
                               {"working": encoded, "now": now, "id": record_id})
            connection.execute(text("UPDATE import_job SET revision = revision + 1, updated_at = :now WHERE id = :id"),
                               {"now": now, "id": job_id})
            return {"revision": int(job["revision"]) + 1, "working": working}

    @staticmethod
    def _check_draft(job: Any, revision: int) -> None:
        if job["status"] != "draft":
            raise APIError(409, "import_not_draft", "This import can no longer be edited")
        if int(job["revision"]) != revision:
            raise APIError(409, "import_changed", "The import changed; reload before editing")

    def decide_issue(self, job_id: str, issue_id: str, decision: str, reason: str,
                     resolution_value: str | None, revision: int, actor: dict[str, Any]) -> dict[str, Any]:
        if decision not in {"corrected", "bypassed", "dismissed"}:
            raise APIError(400, "invalid_decision", "Choose corrected, bypassed, or dismissed")
        if not reason.strip() or len(reason) > 2000:
            raise APIError(400, "invalid_reason", "Explain the issue decision")
        now = _now()

        def validate(issue: Any) -> None:
            if issue["status"] != "open":
                raise APIError(409, "issue_decided", "This issue has already been decided")
            if decision == "bypassed" and issue["severity"] != "overridable":
                raise APIError(400, "cannot_bypass", "Only overridable issues may be bypassed")
            if issue["severity"] == "blocking" and decision == "dismissed":
                raise APIError(400, "cannot_dismiss", "Blocking issues require a correction")

        if self.engine is None:
            with self.lock:
                job = self.store.import_jobs.get(job_id)
                issue = self.store.import_issues.get(issue_id)
                if job is None or issue is None or issue["job_id"] != job_id:
                    raise APIError(404, "not_found", "Import issue was not found")
                self._check_draft(job, revision)
                validate(issue)
                before = {"status": issue["status"]}
                issue.update(status=decision, resolution_value=resolution_value,
                             resolution_reason=reason.strip(), resolved_by_user_id=actor["id"], updated_at=now)
                job["revision"] += 1
                job["updated_at"] = now
                self._memory_audit(actor, "import_issue", issue_id, before,
                                   {"status": decision, "reason": reason.strip(), "resolutionValue": resolution_value}, now)
                return {"revision": job["revision"], "status": decision}
        with self.engine.begin() as connection:
            job = connection.execute(text("SELECT * FROM import_job WHERE id = :id FOR UPDATE"), {"id": job_id}).mappings().first()
            issue = connection.execute(text("SELECT * FROM import_issue WHERE id = :id AND job_id = :job"),
                                       {"id": issue_id, "job": job_id}).mappings().first()
            if job is None or issue is None:
                raise APIError(404, "not_found", "Import issue was not found")
            self._check_draft(job, revision)
            validate(issue)
            self._audit(connection, actor, "import_issue", issue_id, {"status": issue["status"]},
                        {"status": decision, "reason": reason.strip(), "resolutionValue": resolution_value}, now)
            connection.execute(text(
                "UPDATE import_issue SET status = :status, resolution_value = :value, resolution_reason = :reason, "
                "resolved_by_user_id = :actor, updated_at = :now WHERE id = :id"
            ), {"status": decision, "value": resolution_value, "reason": reason.strip(),
                "actor": actor["id"], "now": now, "id": issue_id})
            connection.execute(text("UPDATE import_job SET revision = revision + 1, updated_at = :now WHERE id = :id"),
                               {"now": now, "id": job_id})
            return {"revision": int(job["revision"]) + 1, "status": decision}

    def _memory_audit(self, actor: dict[str, Any], table: str, record_id: str,
                      before: dict[str, Any], after: dict[str, Any], now: datetime) -> None:
        self.store.state.audits.append({
            "id": uuid7(), "tableName": table, "recordId": record_id, "action": "UPDATE",
            "oldValues": before, "newValues": after, "operatorId": None, "deviceId": None,
            "actorUserId": actor["id"], "actorEmail": actor["email"], "occurredAt": _iso(now),
        })
