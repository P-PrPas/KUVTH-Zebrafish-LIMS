"""Interpret source cells without changing their immutable import draft values."""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from typing import Any

from openpyxl.utils import get_column_letter


def _text(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def _day(value: Any) -> date | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _condition(normal: Any, abnormal: Any) -> str:
    if _text(normal) in {"1", "1.0"} and _text(abnormal) in {"0", "0.0", ""}:
        return "NORMAL"
    if _text(abnormal) in {"1", "1.0"} and _text(normal) in {"0", "0.0", ""}:
        return "ABNORMAL"
    return "UNDETERMINED"


def _flags(cells: dict[str, Any], start: int, end: int, dob: date | None,
           disposition: str, exit_date: date | None) -> tuple[list[dict[str, Any]], list[str]]:
    entries: list[dict[str, Any]] = []
    warnings: list[str] = []
    for index in range(start, end + 1):
        column = get_column_letter(index)
        if column not in cells:
            continue
        raw = cells[column]
        value = _text(raw)
        if value not in {"0", "1", "0.0", "1.0"}:
            warnings.append(f"{column}: expected 1 or 0")
            continue
        day_number = index - start + 1
        observed = dob + timedelta(days=day_number) if dob else None
        if value in {"1", "1.0"}:
            outcome = "ALIVE"
        elif disposition in {"FROZEN", "DISCARDED"} and exit_date and observed and observed >= exit_date:
            outcome = "TRACKING_ENDED"
        elif disposition in {"FROZEN", "DISCARDED"} and not exit_date:
            outcome = "UNRESOLVED_ZERO"
        else:
            outcome = "NOT_SURVIVING"
        entries.append({
            "day": day_number, "sourceColumn": column,
            "observedOn": observed.isoformat() if observed else None,
            "sourceValue": raw, "outcome": outcome,
        })
    return entries, warnings


def _fish(cells: dict[str, Any]) -> dict[str, Any]:
    v1 = bool(re.match(r"^(?:CLA|CL|RT|DC)\d+", _text(cells.get("B")), re.IGNORECASE)) or (
        bool(_text(cells.get("K"))) and _text(cells.get("K")).casefold() not in {"normal", "abnormal"}
    )
    dob = _day(cells.get("F" if v1 else "B"))
    exit_date = _day(cells.get("OD" if v1 else "J"))
    source_status = _text(cells.get("L")) if v1 else ("Frozen" if exit_date else "")
    source_status_folded = source_status.casefold()
    if v1:
        disposition = (
            "FROZEN" if source_status_folded == "frozen" else
            "DISCARDED" if source_status_folded == "discarded" else "NONE"
        )
        life_state = "DEAD" if source_status_folded == "dead" else "UNKNOWN"
    else:
        disposition = "FROZEN" if exit_date else "UNKNOWN"
        life_state = "UNKNOWN"
    status = disposition if disposition in {"FROZEN", "DISCARDED"} and exit_date else "UNKNOWN"
    observations, warnings = _flags(cells, 19 if v1 else 14, 388 if v1 else 205,
                                    dob, disposition, exit_date)
    if dob is None:
        warnings.append("Date of birth is missing or invalid")
    if disposition in {"FROZEN", "DISCARDED"} and exit_date is None:
        warnings.append("Disposition date is unknown; zero flags cannot be classified as death")
    if v1 and source_status_folded not in {"alive", "dead", "frozen", "discarded"}:
        warnings.append("Source status needs admin review")
    fish_code = _text(cells.get("K")) if v1 else ""
    if not fish_code and dob:
        fish_code = f"V2-{dob.isoformat()}-{_text(cells.get('A'))}"
    return {
        "entity": "fish", "sourceVersion": "V1" if v1 else "V2",
        "legacyNumber": cells.get("A"), "fishCode": fish_code or None,
        "dob": dob.isoformat() if dob else None,
        "sourceStatus": source_status or None, "status": status,
        "lifeState": life_state, "disposition": disposition,
        "exitDate": exit_date.isoformat() if exit_date else None,
        "biologicalCondition": _condition(cells.get("N"), cells.get("O")) if v1 else
            ("ABNORMAL" if _text(cells.get("K")).casefold() == "abnormal" else
             "NORMAL" if _text(cells.get("K")).casefold() == "normal" else "UNDETERMINED"),
        "donorSource": cells.get("I" if v1 else "D"),
        "recipientSource": cells.get("G" if v1 else "C"),
        "sourceSpecimenCodes": [cells.get(column) for column in ("B", "C", "D", "E") if _text(cells.get(column))] if v1 else [],
        "observationCount": len(observations),
        "lastRecordedOn": observations[-1]["observedOn"] if observations else None,
        "observations": observations,
        "warnings": warnings,
    }


SPECIMEN_TYPES = {
    "whole embryo": "WHOLE_EMBRYO",
    "caudal fin clip": "CAUDAL_FIN_CLIP",
    "anal fin clip": "ANAL_FIN_CLIP",
    "left over cells": "LEFTOVER_CELLS",
    "whole adult": "WHOLE_ADULT",
}


def _specimen(cells: dict[str, Any]) -> dict[str, Any]:
    code = _text(cells.get("B"))
    kind_match = re.match(r"^(CLA|CL|RT|DC)", code, re.IGNORECASE)
    material = _text(cells.get("C"))
    material_type = SPECIMEN_TYPES.get(material.casefold(), "UNKNOWN")
    return {
        "entity": "specimen", "specimenCode": code,
        "specimenKind": kind_match.group(1).upper() if kind_match else None,
        "specimenType": material_type, "sourceMaterial": material or None,
        "warnings": [] if material_type != "UNKNOWN" else ["Specimen material needs admin mapping"],
    }


def interpret(record_kind: str, working: dict[str, Any]) -> dict[str, Any] | None:
    if record_kind == "fish":
        return _fish(working)
    if record_kind == "specimen":
        return _specimen(working)
    return None
