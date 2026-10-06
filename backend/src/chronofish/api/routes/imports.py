from __future__ import annotations

import csv
import io
import itertools
import json
import re
import zipfile
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Body, File, Form, Request, Response, UploadFile

from ...runtime.errors import APIError
from ...services.import_sources import (
    MAX_FILE_BYTES,
    MAX_FILES,
    MAX_RECORDS_PER_JOB,
    SourceFormatError,
    csv_delimiter,
    decode_csv,
    parse_csv,
    parse_xlsx,
    xlsx_sheet_names,
)
from ...store.imports import ImportRepository

MAX_UPLOAD_BYTES = 50 * 1024 * 1024


def _actor(request: Request) -> dict[str, Any]:
    user = getattr(request.state, "user", None)
    if not user or user.get("role") != "admin":
        raise APIError(403, "admin_required", "Admin access is required")
    return user


async def _read_uploads(files: list[UploadFile]) -> list[dict[str, Any]]:
    if not files or len(files) > MAX_FILES:
        raise APIError(400, "invalid_files", f"Upload 1 to {MAX_FILES} files")
    uploads: list[dict[str, Any]] = []
    total = 0
    for file in files:
        name = re.split(r"[/\\]", file.filename or "")[-1]
        if not name or len(name) > 255 or any(ord(char) < 32 for char in name):
            raise APIError(400, "invalid_file_name", "A file name is invalid")
        content = await file.read(MAX_FILE_BYTES + 1)
        total += len(content)
        if not content or len(content) > MAX_FILE_BYTES or total > MAX_UPLOAD_BYTES:
            raise APIError(413, "import_too_large", "Import files exceed the size limit")
        uploads.append({"name": name, "content": content})
    extensions = {"xlsx" if item["name"].lower().endswith(".xlsx") else "csv" if item["name"].lower().endswith(".csv") else "other" for item in uploads}
    if extensions == {"xlsx"} and len(uploads) == 1:
        uploads[0]["media_type"] = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    elif extensions == {"csv"}:
        for item in uploads:
            item["media_type"] = "text/csv"
    else:
        raise APIError(400, "invalid_files", "Upload one XLSX or a set of CSV files")
    return uploads


def _selection(raw: str) -> dict[str, Any]:
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as error:
        raise APIError(400, "invalid_selection", "Selection must be JSON") from error
    if not isinstance(value, dict):
        raise APIError(400, "invalid_selection", "Selection must be an object")
    return value


def _parsed_uploads(
    uploads: list[dict[str, Any]], selection: dict[str, Any]
) -> tuple[str, list[tuple[int, Any]]]:
    parsed: list[tuple[int, Any]] = []
    try:
        if uploads[0]["media_type"] != "text/csv":
            sheets = selection.get("sheets")
            if not isinstance(sheets, list) or not all(isinstance(name, str) and name for name in sheets):
                raise APIError(400, "invalid_selection", "Select workbook sheets")
            parsed = [(0, sheet) for sheet in parse_xlsx(uploads[0]["content"], sheets)]
            input_kind = "xlsx"
        else:
            choices = selection.get("files")
            if not isinstance(choices, list) or len(choices) != len(uploads):
                raise APIError(400, "invalid_selection", "Provide one selection per CSV file")
            input_kind = "csv_set"
            for index, (upload, choice) in enumerate(zip(uploads, choices, strict=True)):
                if not isinstance(choice, dict):
                    raise APIError(400, "invalid_selection", "Each CSV selection must be an object")
                include = choice.get("include", True)
                if not isinstance(include, bool):
                    raise APIError(400, "invalid_selection", "CSV include must be true or false")
                if not include:
                    if not isinstance(choice.get("ignoreReason"), str) or not choice["ignoreReason"].strip():
                        raise APIError(400, "invalid_selection", "Ignored CSV files need a reason")
                    continue
                sheet_name = choice.get("sheetName")
                if not isinstance(sheet_name, str) or not sheet_name.strip() or len(sheet_name) > 150:
                    raise APIError(400, "invalid_selection", "Each CSV needs a sheet name")
                encoding = choice.get("encoding")
                if encoding is not None and not isinstance(encoding, str):
                    raise APIError(400, "invalid_selection", "CSV encoding must be a string")
                delimiter = choice.get("delimiter")
                if delimiter is not None and not isinstance(delimiter, str):
                    raise APIError(400, "invalid_selection", "CSV delimiter must be a string")
                sheet, used_encoding, used_delimiter = parse_csv(
                    upload["content"], sheet_name.strip(), encoding, delimiter
                )
                upload["sheet_name"] = sheet_name.strip()
                upload["encoding"] = used_encoding
                choice["delimiter"] = used_delimiter
                parsed.append((index, sheet))
        if not parsed:
            raise APIError(400, "invalid_selection", "Select at least one sheet or CSV")
        if sum(len(sheet.records) for _, sheet in parsed) > MAX_RECORDS_PER_JOB:
            raise APIError(413, "import_too_large", "Too many source records")
        return input_kind, parsed
    except SourceFormatError as error:
        raise APIError(422, "invalid_source", str(error)) from error
    except (OSError, ValueError, KeyError, csv.Error, zipfile.BadZipFile) as error:
        raise APIError(422, "invalid_source", "The selected source could not be read") from error


def build_import_router(store: Any) -> APIRouter:
    router = APIRouter(prefix="/api/v1/imports", tags=["imports"])
    repository = ImportRepository(store)

    @router.post("/inspect")
    async def inspect(request: Request, files: list[UploadFile] = File(...)) -> dict[str, Any]:
        _actor(request)
        uploads = await _read_uploads(files)
        if uploads[0]["media_type"] != "text/csv":
            try:
                sheets = xlsx_sheet_names(uploads[0]["content"])
            except (SourceFormatError, OSError, ValueError) as error:
                raise APIError(422, "invalid_source", "This workbook could not be read") from error
            return {"inputKind": "xlsx", "files": [{"name": uploads[0]["name"], "sheets": sheets}]}
        result = []
        for upload in uploads:
            try:
                decoded, encoding = decode_csv(upload["content"])
                delimiter = csv_delimiter(decoded)
                rows = list(itertools.islice(csv.reader(io.StringIO(decoded, newline=""), delimiter=delimiter), 5))
            except (SourceFormatError, csv.Error) as error:
                raise APIError(422, "invalid_source", f"Cannot read {upload['name']}") from error
            result.append({"name": upload["name"], "encoding": encoding, "delimiter": delimiter, "preview": rows})
        return {"inputKind": "csv_set", "files": result}

    @router.post("", status_code=201)
    async def create(
        request: Request, files: list[UploadFile] = File(...), selection: str = Form(...)
    ) -> dict[str, Any]:
        actor = _actor(request)
        uploads = await _read_uploads(files)
        selected = _selection(selection)
        input_kind, parsed = _parsed_uploads(uploads, selected)
        return repository.create(str(actor["id"]), input_kind, selected, uploads, parsed)

    @router.get("")
    def list_jobs(request: Request) -> dict[str, Any]:
        _actor(request)
        return {"items": repository.list_jobs()}

    @router.get("/{job_id}")
    def get_job(request: Request, job_id: str) -> dict[str, Any]:
        _actor(request)
        return repository.get_job(job_id)

    @router.get("/{job_id}/records")
    def list_records(request: Request, job_id: str, offset: int = 0, limit: int = 50) -> dict[str, Any]:
        _actor(request)
        if offset < 0 or not 1 <= limit <= 100:
            raise APIError(400, "invalid_page", "Use offset >= 0 and limit 1 through 100")
        return {"items": repository.list_records(job_id, offset, limit)}

    @router.get("/{job_id}/mapping-requirements")
    def mapping_requirements(request: Request, job_id: str) -> dict[str, Any]:
        _actor(request)
        return repository.mapping_requirements(job_id)

    @router.post("/{job_id}/confirm-fish-specimens")
    def confirm_fish_specimens(request: Request, job_id: str,
                               body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        actor = _actor(request)
        revision = body.get("revision")
        sites = body.get("siteMappings")
        donors = body.get("donorMappings")
        if not isinstance(revision, int) or isinstance(revision, bool):
            raise APIError(400, "invalid_revision", "Provide the import revision")
        if not isinstance(sites, dict) or not isinstance(donors, dict) or not all(
            isinstance(key, str) and isinstance(value, str) for mapping in (sites, donors)
            for key, value in mapping.items()
        ):
            raise APIError(400, "invalid_mapping", "Provide site and donor ID mappings")
        zero_reason = body.get("zeroBypassReason", "")
        if not isinstance(zero_reason, str):
            raise APIError(400, "invalid_reason", "Bypass reason must be text")
        return repository.confirm_fish_specimens(job_id, revision, actor, sites, donors, zero_reason)

    @router.get("/{job_id}/fish-status")
    def fish_statuses(request: Request, job_id: str) -> dict[str, Any]:
        _actor(request)
        return {"items": repository.fish_statuses(job_id)}

    @router.post("/{job_id}/fish-status/{fish_id}")
    def review_fish_status(request: Request, job_id: str, fish_id: str,
                           body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        actor = _actor(request)
        return repository.review_fish_status(job_id, fish_id, actor, body)

    @router.post("/{job_id}/revert")
    def revert(request: Request, job_id: str,
               body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        actor = _actor(request)
        revision = body.get("revision")
        reason = body.get("reason")
        if not isinstance(revision, int) or isinstance(revision, bool):
            raise APIError(400, "invalid_revision", "Provide the import revision")
        if not isinstance(reason, str):
            raise APIError(400, "invalid_reason", "Explain why the import is being reverted")
        return repository.revert_fish_specimens(job_id, revision, actor, reason)

    @router.get("/{job_id}/issues")
    def list_issues(request: Request, job_id: str, offset: int = 0, limit: int = 50) -> dict[str, Any]:
        _actor(request)
        if offset < 0 or not 1 <= limit <= 100:
            raise APIError(400, "invalid_page", "Use offset >= 0 and limit 1 through 100")
        return {"items": repository.list_issues(job_id, offset, limit)}

    @router.patch("/{job_id}/records/{record_id}")
    def revise_record(request: Request, job_id: str, record_id: str,
                      body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        actor = _actor(request)
        if not isinstance(body.get("revision"), int) or isinstance(body["revision"], bool):
            raise APIError(400, "invalid_revision", "Provide the import revision")
        if not isinstance(body.get("working"), dict) or not isinstance(body.get("reason"), str):
            raise APIError(400, "invalid_edit", "Provide working values and an edit reason")
        return repository.revise_record(job_id, record_id, body["working"], body["reason"],
                                        body["revision"], actor)

    @router.get("/{job_id}/records/{record_id}/interpretation")
    def interpret_record(request: Request, job_id: str, record_id: str) -> dict[str, Any]:
        _actor(request)
        return repository.interpretation(job_id, record_id)

    @router.post("/{job_id}/issues/{issue_id}/decision")
    def decide_issue(request: Request, job_id: str, issue_id: str,
                     body: dict[str, Any] = Body(...)) -> dict[str, Any]:
        actor = _actor(request)
        if not isinstance(body.get("revision"), int) or isinstance(body["revision"], bool):
            raise APIError(400, "invalid_revision", "Provide the import revision")
        if not isinstance(body.get("decision"), str) or not isinstance(body.get("reason"), str):
            raise APIError(400, "invalid_decision", "Provide a decision and reason")
        value = body.get("resolutionValue")
        if value is not None and (not isinstance(value, str) or len(value) > 20000):
            raise APIError(400, "invalid_resolution", "Resolution value must be text")
        return repository.decide_issue(job_id, issue_id, body["decision"], body["reason"],
                                       value, body["revision"], actor)

    @router.get("/{job_id}/files/{file_id}")
    def download_file(request: Request, job_id: str, file_id: str) -> Response:
        _actor(request)
        name, media_type, content = repository.source_file(job_id, file_id)
        response = Response(content, media_type=media_type)
        response.headers["Content-Disposition"] = f"attachment; filename*=UTF-8''{quote(name, safe='')}"
        response.headers["Cache-Control"] = "no-store"
        return response

    return router
