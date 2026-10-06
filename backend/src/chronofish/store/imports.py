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
    def __init__(self, store: Any) -> None:
        self.store = store
        self.engine = getattr(store, "engine", None)
        self.lock = getattr(store, "lock", None)
        if self.engine is None:
            store.import_jobs = getattr(store, "import_jobs", {})
            store.import_files = getattr(store, "import_files", {})
            store.import_records = getattr(store, "import_records", {})
            store.import_issues = getattr(store, "import_issues", {})

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
        else:
            with self.engine.begin() as connection:
                self._insert_many(connection, "import_job", [job])
                self._insert_many(connection, "import_source_file", file_rows)
                self._insert_many(connection, "import_record", record_rows)
                self._insert_many(connection, "import_issue", issue_rows)
        return {
            "job": _job_payload(job),
            "files": [self._file_payload(row) for row in file_rows],
            "recordCount": len(record_rows),
            "issueCount": len(issue_rows),
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
        return {
            "job": _job_payload(job),
            "files": [self._file_payload(row) for row in files],
            "recordCount": len(records) if isinstance(records, list) else int(records),
            "issueCount": len(issues) if isinstance(issues, list) else int(issues),
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
