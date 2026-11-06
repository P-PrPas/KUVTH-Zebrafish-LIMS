"""Read the customer v5 forms without executing spreadsheet formulas.

Keep each source block intact in the draft; expand it only inside confirmation's
private state so a late validation failure cannot publish a partial import.
"""

from __future__ import annotations

import io
import re
from datetime import date, datetime, time
from functools import lru_cache
from pathlib import Path
from typing import Any

from openpyxl import load_workbook
from openpyxl.formula.translate import Translator
from openpyxl.utils import get_column_letter

from ..runtime.errors import APIError

EXPERIMENT = "ข้อมูลการทดลอง"
EMBRYOS = "ผลเอ็มบริโอ"
FISH = "ทะเบียนปลา"
SPECIMENS = "ทะเบียนตัวอย่าง"
V5_SHEETS = {EXPERIMENT, EMBRYOS, FISH, SPECIMENS}
TEMPLATE_DIR = Path(__file__).with_name("templates")


def download_bytes(kind: str) -> bytes:
    if kind not in {"experiment", "registry"}:
        raise APIError(400, "invalid_template_kind", "Choose experiment or registry")
    return (TEMPLATE_DIR / f"{kind}-template-v5.xlsx").read_bytes()


@lru_cache(maxsize=2)
def _contract(kind: str) -> dict:
    book = load_workbook(io.BytesIO(download_bytes(kind)), read_only=False)
    try:
        return {
            s.title: {c.coordinate: c.value for row in s for c in row if c.value is not None}
            for s in book
            if s.title in V5_SHEETS
        }
    finally:
        book.close()


def parse_v5(name: str, matrix: list, formulas: dict[str, str], context: list | None = None) -> Any:
    from .import_sources import ParsedSheet, SourceFormatError, SourceIssue, SourceRecord, _json_value

    result = ParsedSheet(name, "schema_template")
    expected = _contract("experiment" if name in {EXPERIMENT, EMBRYOS} else "registry")[name]

    def cell(rows: list, row: int, col: int) -> Any:
        return rows[row - 1][col - 1] if row <= len(rows) and col <= len(rows[row - 1]) else None

    def issue(message: str, row: int = 1, column: str | None = None) -> None:
        result.issues.append(SourceIssue("blocking", "v5_format", message, name, row, column))

    header_rows = [12, 67] if name == EXPERIMENT else [8] if name == FISH else [7]
    # Locate the aggregate header after inserted lot rows, as allowed by the guide.
    if name == EXPERIMENT:
        aggregate_headers = [i for i in range(13, len(matrix) + 1) if cell(matrix, i, 2) == "source_label"]
        if len(aggregate_headers) != 1:
            issue("Missing or duplicate aggregate header")
        aggregate_header = aggregate_headers[0] if aggregate_headers else 67
        header_rows = [12, aggregate_header]
    for index, row in enumerate(header_rows):
        original = [12, 67][index] if name == EXPERIMENT else row
        width = (
            13
            if original == 12 and name == EXPERIMENT
            else 43
            if name == EXPERIMENT
            else 395
            if name == FISH
            else 38
            if name == EMBRYOS
            else 3
        )
        for col in range(1, width + 1):
            if cell(matrix, row, col) != expected.get(f"{get_column_letter(col)}{original}"):
                issue("Keep the v5 machine headers unchanged", row, get_column_letter(col))
                break
    data_start, data_width = (
        (8, 38) if name == EMBRYOS else (9, 395) if name == FISH else (8, 3) if name == SPECIMENS else (13, 43)
    )
    for number, row in enumerate(matrix[data_start - 1 :], data_start):
        if any(value not in (None, "") for value in row[data_width:]):
            issue("Values outside the v5 columns are not supported", number)

    for coordinate, formula in formulas.items():
        match = re.fullmatch(r"([A-Z]+)(\d+)", coordinate)
        column, row = match[1], int(match[2])
        origin = None
        if name == EXPERIMENT and column == "J" and 13 <= row < aggregate_header - 2:
            origin = "J13"
        elif name == EMBRYOS and column == "D" and row >= 8:
            origin = f"D{8 + (row - 8) % 4}"
        elif name == FISH and column == "B" and row >= 9:
            origin = f"B{9 + (row - 9) % 4}"
        if origin is None or formula != Translator(expected[origin], origin=origin).translate_formula(coordinate):
            issue("Only the original v5 reference-code formulas are allowed; paste other cells as values", row, column)

    def row_values(rows: list, number: int) -> dict:
        return (
            {get_column_letter(i): _json_value(v) for i, v in enumerate(rows[number - 1], 1) if v not in (None, "")}
            if number <= len(rows)
            else {}
        )

    def append(kind: str, number: int, payload: dict) -> None:
        if len(str(payload)) > 900_000:
            raise SourceFormatError("A v5 block exceeds the import record limit")
        result.records.append(SourceRecord(name, f"A{number}", number, f"schema:v5_{kind}", payload, payload.copy()))

    def metadata(rows: list) -> dict:
        return {
            key: _json_value(cell(rows, r, c))
            for key, r, c in [
                ("experiment_no", 5, 2),
                ("experiment_date", 5, 5),
                ("site", 5, 8),
                ("operator", 6, 2),
                ("treatment_group", 6, 5),
                ("source_version", 6, 8),
            ]
        }

    if name == EXPERIMENT:
        meta = metadata(matrix)
        for number in range(13, aggregate_header - 2):
            values = row_values(matrix, number)
            values.pop("J", None)  # Recompute reference codes; never trust cached formulas.
            if values:
                append("lot", number, {"metadata": meta, "cells": values})
        for number in range(aggregate_header + 1, len(matrix) + 1):
            values = row_values(matrix, number)
            if values:
                append("aggregate", number, {"metadata": meta, "cells": values})
    elif name in {EMBRYOS, FISH}:
        start, reference, marker = (8, "D", "F") if name == EMBRYOS else (9, "B", "T")
        markers = (
            ["OUTCOME", "TIME", "CONDITION", "OBSERVER"]
            if name == EMBRYOS
            else ["OUTCOME", "CONDITION", "DATE", "OBSERVER"]
        )
        for number in range(start, len(matrix) + 1, 4):
            block = [row_values(matrix, n) for n in range(number, number + 4)]
            for values in block:
                values.pop(reference, None)
                values.pop(marker, None)
            if not any(block):
                continue
            for offset, label in enumerate(markers):
                if cell(matrix, number + offset, 6 if name == EMBRYOS else 20) != label:
                    issue(f"Expected four consecutive rows: {', '.join(markers)}", number + offset)
            payload = {"rows": block}
            if name == EMBRYOS:
                if context is None:
                    issue("The experiment metadata sheet is required", number)
                else:
                    payload["metadata"] = metadata(context)
                    # Only the matching lot is needed, keeping source blocks bounded.
                    payload["lot"] = next(
                        (
                            row_values(context, i)
                            for i in range(13, len(context) + 1)
                            if cell(context, i, 1) == block[0].get("A")
                        ),
                        {},
                    )
            append("embryo" if name == EMBRYOS else "fish", number, payload)
    else:
        for number in range(8, len(matrix) + 1):
            values = row_values(matrix, number)
            if values:
                append("specimen", number, {"cells": values})
    result.row_count = len(result.records)
    return result


def expand_v5(records: list[dict]) -> tuple[list[dict], dict]:
    """Convert source blocks to the existing canonical import contract."""
    from .import_template import SHEETS

    canonical: list[dict] = []
    extra: dict = {"fish": {}, "lots": {}, "embryos": {}, "specimens": [], "aggregates": [], "links": {}}
    location = ""

    def fail(message: str) -> None:
        raise APIError(422, "invalid_template", f"{location}: {message}")

    def text(value: Any) -> str:
        return str(value).strip() if value is not None else ""

    def code(value: Any) -> str:
        value = text(value)
        if not value or len(value) > 150 or "CLIENT_" in value.upper() or "EXAMPLE" in value.upper():
            fail("A real reference code of at most 150 characters is required")
        return value

    def day(value: Any) -> str:
        try:
            raw = text(value)
            parsed = datetime.fromisoformat(raw) if "T" in raw else None
            if parsed and parsed.time() != time():
                raise ValueError
            return (parsed.date() if parsed else date.fromisoformat(raw)).isoformat()
        except ValueError:
            fail("Expected an Excel date or YYYY-MM-DD")

    def positive(value: Any) -> str:
        raw = text(value)
        if not raw.isdigit() or int(raw) < 1:
            fail("Expected a positive integer")
        return str(int(raw))

    def batch_code(meta: dict, cells: dict) -> str:
        if cells.get("B"):
            return code(cells["B"])
        if not meta.get("treatment_group") or not meta.get("operator"):
            fail("An explicit batch_code is required when operator or treatment group is unknown")
        return code(
            "_".join(
                [
                    positive(meta.get("experiment_no")),
                    text(meta.get("operator")),
                    text(meta.get("treatment_group")),
                    positive(cells.get("A")),
                    date.fromisoformat(day(meta.get("experiment_date"))).strftime("%y%m%d"),
                ]
            )
        )

    def add(record: dict, name: str, values: dict, suffix: str = "") -> None:
        from .import_sources import MAX_RECORDS_PER_JOB

        if len(canonical) >= MAX_RECORDS_PER_JOB:
            fail("The expanded v5 form contains too many records")
        canonical.append(
            {
                **record,
                "id": record["id"] + suffix,
                "v5_source": True,
                "record_kind": "schema:" + name,
                "values": {k: v for k, v in values.items() if k in SHEETS[name] and v not in (None, "")},
            }
        )

    def outcome(value: Any) -> str:
        raw = text(value).upper()
        if raw not in {"0", "1", "ALIVE", "DEAD"}:
            fail("Outcome must be 1/ALIVE or 0/DEAD")
        return "ALIVE" if raw in {"1", "ALIVE"} else "DEAD"

    for record in records:
        location = f"{record['sheet_name']} row {record['row_no']}"
        kind = record["record_kind"].removeprefix("schema:v5_")
        payload = record["values"]
        if not isinstance(payload, dict):
            fail("The v5 working copy must be an object")
        for field in (
            {"metadata", "cells"}
            if kind in {"lot", "aggregate"}
            else {"metadata", "lot"}
            if kind == "embryo"
            else {"cells"}
            if kind == "specimen"
            else set()
        ):
            if not isinstance(payload.get(field), dict):
                fail(f"{field}: expected an object")
        if kind in {"fish", "embryo"} and (
            not isinstance(payload.get("rows"), list)
            or len(payload["rows"]) != 4
            or not all(isinstance(row, dict) for row in payload["rows"])
        ):
            fail("Expected four v5 source rows")
        if kind == "lot":
            meta, cells = payload["metadata"], payload["cells"]
            positive(cells.get("A"))
            positive(meta.get("experiment_no"))
            batch = batch_code(meta, cells)
            values = {**meta, "batch_code": batch}
            values.update(
                {
                    key: cells.get(col)
                    for key, col in zip(
                        [
                            "lot_no",
                            "activated_at",
                            "donor_strain",
                            "donor_preparation",
                            "donor_derivation",
                            "donor_batch_code",
                            "n_activated",
                        ],
                        ["A", "C", "D", "E", "F", "G", "H"],
                        strict=True,
                    )
                }
            )
            # Unknown historical treatment is allowed by the v5 guide.
            values["treatment_group"] = text(meta.get("treatment_group"))
            add(record, "experiment_batch", values)
            canonical[-1]["v5_day_no"] = int(meta["experiment_no"])
            extra["lots"][record["id"]] = payload
        elif kind == "embryo":
            rows, meta, lot = payload["rows"], payload["metadata"], payload["lot"]
            first = rows[0]
            if not lot:
                fail("lot_no must match a lot in the experiment sheet")
            batch = batch_code(meta, lot)
            if not first.get("C") and (not meta.get("operator") or not meta.get("treatment_group")):
                fail("An explicit embryo_code is required when operator or treatment group is unknown")
            embryo = code(
                first.get("C")
                or "_".join(
                    [
                        positive(meta.get("experiment_no")),
                        text(meta.get("operator")),
                        text(meta.get("treatment_group")),
                        positive(first.get("A")),
                        positive(first.get("B")),
                        date.fromisoformat(day(meta.get("experiment_date"))).strftime("%y%m%d"),
                    ]
                )
            )
            add(
                record,
                "embryo",
                {
                    "batch_code": batch,
                    "lot_no": first.get("A"),
                    "seq_in_lot": first.get("B"),
                    "embryo_code": embryo,
                    **{
                        k: first.get(c)
                        for k, c in [
                            ("well_position", "E"),
                            ("exit_stage", "I"),
                            ("exit_reason", "J"),
                            ("exit_at", "K"),
                        ]
                    },
                },
            )
            extra["embryos"][record["id"]] = first.get("L")
            headers = _contract("experiment")[EMBRYOS]
            for col in range(13, 39):
                letter = get_column_letter(col)
                values = [r.get(letter) for r in rows]
                if all(v in (None, "") for v in values):
                    continue
                stage = headers[f"{letter}7"]
                stamp = text(values[1])
                try:
                    clock = time.fromisoformat(stamp)
                except ValueError:
                    clock = None
                if clock:
                    if not first.get("H"):
                        fail(f"{letter}: a time-only observation requires observation_date")
                    stamp = f"{day(first['H'])}T{clock.isoformat()}"
                add(
                    record,
                    "embryo_observation",
                    {
                        "embryo_code": embryo,
                        "stage": stage,
                        "observed_at": stamp,
                        "outcome": outcome(values[0]),
                        "biological_condition": values[2],
                        "observer": values[3] or first.get("G"),
                    },
                    f":{letter}",
                )
        elif kind == "fish":
            rows = payload["rows"]
            first = rows[0]
            fish = code(first.get("A") or first.get("C"))
            raw_status = text(first.get("I"))
            if raw_status not in {"ALIVE", "DEAD"}:
                fail("status must be ALIVE or DEAD")
            action, reason = text(first.get("R")), text(first.get("Q"))
            if reason not in {"", "INTACT", "DEGENERATED", "LOST"} or action not in {"", "FROZEN", "DISCARDED"}:
                fail("Invalid exit condition or action")
            if action and (reason != "INTACT" if action == "FROZEN" else reason not in {"DEGENERATED", "LOST"}):
                fail("FROZEN requires INTACT; DISCARDED requires DEGENERATED or LOST")
            if raw_status == "ALIVE" and (reason or action):
                fail("An alive fish cannot have exit condition or action")
            status = action or raw_status
            values = {
                key: first.get(get_column_letter(i))
                for i, key in enumerate(
                    [
                        "fish_code",
                        "fish_code_to_use",
                        "embryo_code",
                        "dob",
                        "donor_strain",
                        "donor_preparation",
                        "donor_derivation",
                        "donor_batch_code",
                        "status",
                        "biological_condition",
                        "first_abnormal_on",
                        "sex",
                        "site",
                        "fish_box",
                        "fin_clipped",
                        "exit_date",
                        "exit_reason",
                        "action",
                        "remarks",
                    ],
                    1,
                )
            }
            if text(values.get("sex")) not in {"M", "F", "ND"} or text(values.get("fin_clipped")) not in {"Y", "N", ""}:
                fail("sex must be M/F/ND; fin_clipped must be Y/N")
            values.update(
                fish_code=fish,
                status=status,
                exit_reason=status if status != "ALIVE" else None,
                sex="UNKNOWN" if values.get("sex") == "ND" else values.get("sex"),
                fin_clipped="true" if values.get("fin_clipped") == "Y" else "false",
            )
            health = text(values.get("biological_condition"))
            if not health:
                fail("biological_condition: recorded health is required")
            values["biological_condition"] = (
                health if health in {"NORMAL", "ABNORMAL", "UNDETERMINED"} else "UNDETERMINED"
            )
            add(record, "clone_fish", values)
            extra["fish"][record["id"]] = {
                "lifeState": raw_status,
                "disposition": action or ("LOST" if reason == "LOST" else "NONE"),
                "healthSource": health,
                "exitCondition": reason,
            }
            for column, prefix in [("V", "CL"), ("W", "RT"), ("X", "DC"), ("Y", "CLA")]:
                if first.get(column):
                    specimen = code(first[column])
                    actual_prefix = "CLA" if specimen.upper().startswith("CLA") else specimen[:2].upper()
                    if actual_prefix != prefix:
                        fail(f"{column}: specimen code must use {prefix} prefix")
                    extra["links"].setdefault(specimen, []).append(fish)
            for col in range(26, 396):
                letter = get_column_letter(col)
                values = [r.get(letter) for r in rows]
                if all(v in (None, "") for v in values):
                    continue
                observed = day(values[2])
                condition = text(values[1])
                if not condition:
                    fail(f"{letter}: recorded observation health is required")
                add(
                    record,
                    "fish_observation",
                    {
                        "fish_code": fish,
                        "observed_on": observed,
                        "outcome": outcome(values[0]),
                        "biological_condition": condition
                        if condition in {"NORMAL", "ABNORMAL", "UNDETERMINED"}
                        else "UNDETERMINED",
                        "observer": values[3] or first.get("U"),
                    },
                    f":{letter}",
                )
                canonical[-1]["v5_condition"] = condition
        elif kind == "specimen":
            cells = payload["cells"]
            extra["specimens"].append((record, code(cells.get("B")), text(cells.get("C"))))
        elif kind == "aggregate":
            extra["aggregates"].append(record)
        else:
            fail("Do not mix v5 forms with other import formats")
    return canonical, extra


def apply_v5(state: Any, records: list[dict], request: Any, job_id: str) -> tuple[dict, dict]:
    from ..runtime.mutations import audit
    from ..runtime.values import iso_now, uuid7
    from .fish import fish_is_disabled, record_disability
    from .import_template_apply import apply_template

    canonical, extra = expand_v5(records)
    targets = apply_template(state, canonical, request, job_id)
    original_ids = {r["id"] for r in records}
    result = {key: value for key, value in targets.items() if key in original_ids}
    now = iso_now()

    def fail(record: dict, message: str) -> None:
        raise APIError(422, "invalid_template", f"{record['sheet_name']} row {record['row_no']}: {message}")

    def health(raw: str) -> dict:
        # Preserve free text verbatim while recognizing only explicit health labels.
        mapping = {
            "NORMAL": "HEALTHY",
            "ปกติ": "HEALTHY",
            "HEALTHY": "HEALTHY",
            "WEAK": "WEAK",
            "อ่อนแอ": "WEAK",
            "ว่ายน้ำอ่อนแรง": "WEAK",
            "SICK": "SICK",
            "ป่วย": "SICK",
            "DISABLED": "DISABLED",
            "พิการ": "DISABLED",
            "AGED": "AGED",
            "แก่": "AGED",
        }
        status = mapping.get(raw, "UNDETERMINED")
        return {"healthStatus": status, "sickNote": raw or None, "isDisabled": status == "DISABLED"}

    for key, values in extra["fish"].items():
        item = state.entities["fish"][targets[key][1]]
        old = item.copy()
        raw = values.pop("healthSource")
        exit_condition = values.pop("exitCondition")
        item.update(values, **health(raw))
        item["disabilityAtRegistration"] = item["isDisabled"] or item["condition"] == "ABNORMAL"
        if exit_condition:
            item["remarks"] = "\n".join(filter(None, [item.get("remarks"), f"v5 exit condition: {exit_condition}"]))
        audit(state, request, "UPDATE", "clone_fish", item["id"], old, item)
    for record in canonical:
        if "v5_condition" in record:
            item = state.fish_observations[targets[record["id"]][1]]
            old = item.copy()
            item.update(health(record["v5_condition"]))
            record_disability(item)
            audit(state, request, "UPDATE", "fish_observation", item["id"], old, item)
    from ..domain.rules import stage_number

    for record in records:
        if record["record_kind"] != "schema:v5_embryo":
            continue
        embryo = state.entities["embryos"][targets[record["id"]][1]]
        observations = sorted(
            (o for o in state.observations.values() if o["embryoId"] == embryo["id"] and not o.get("deletedAt")),
            key=lambda o: stage_number(o["stageCode"]),
        )
        previous = None
        for observation in observations:
            if previous and (observation["observedAt"] < previous["observedAt"] or previous["outcome"] == "DEAD"):
                fail(record, "Embryo stages must follow time order and stop after recorded death")
            if embryo.get("exitAt") and observation["observedAt"] > embryo["exitAt"]:
                fail(record, "Embryo observation occurs after exit_at")
            record_disability(observation)
            previous = observation
        embryo["isDisabled"] = any(o["isDisabled"] for o in observations)
        abnormal = next((o for o in observations if o["isDisabled"]), None)
        if abnormal:
            embryo.update(firstAbnormalObservationId=abnormal["id"], firstAbnormalStageCode=abnormal["stageCode"])

    for key in extra["fish"]:
        item = state.entities["fish"][targets[key][1]]
        item["isDisabled"] = fish_is_disabled(state, item)
        if item["isDisabled"]:
            item["condition"] = "ABNORMAL"
        observations = sorted(
            (o for o in state.fish_observations.values() if o["cloneFishId"] == item["id"] and not o.get("deletedAt")),
            key=lambda o: o["observedOn"],
        )
        previous = None
        for observation in observations:
            if item.get("exitDate") and observation["observedOn"] > item["exitDate"]:
                raise APIError(422, "invalid_template", f"{item['fishCode']}: observation occurs after exit_date")
            if previous and previous["outcome"] == "DEAD":
                raise APIError(422, "invalid_template", f"{item['fishCode']}: observations must stop after death")
            if item["lifeState"] == "ALIVE" and observation["outcome"] == "DEAD":
                raise APIError(
                    422, "invalid_template", f"{item['fishCode']}: ALIVE status conflicts with recorded death"
                )
            previous = observation
        abnormal_days = [o["observedOn"] for o in observations if o.get("isDisabled")]
        if item.get("firstAbnormalOn"):
            abnormal_days.append(item["firstAbnormalOn"])
        if abnormal_days:
            first_day = min(abnormal_days)
            item.update(
                firstAbnormalOn=first_day,
                firstAbnormalAgeDays=(date.fromisoformat(first_day) - date.fromisoformat(item["dob"])).days,
            )
    for key, payload in extra["lots"].items():
        item = state.entities["injection-lots"][targets[key][1]]
        old = item.copy()
        item["notes"] = payload["cells"].get("I")
        audit(state, request, "UPDATE", "injection_lot", item["id"], old, item)
    for notes in extra["embryos"].values():
        # Embryos have no notes column; the immutable import record retains it.
        if notes and not isinstance(notes, str):
            raise APIError(422, "invalid_template", "Embryo remarks must be text")

    types = {
        "Whole embryo": "WHOLE_EMBRYO",
        "Whole Adult Fish": "WHOLE_ADULT",
        "Caudal fin clip": "CAUDAL_FIN_CLIP",
        "Anal fin clip": "ANAL_FIN_CLIP",
        "Donor cells": "LEFTOVER_CELLS",
        "left over cells": "LEFTOVER_CELLS",
    }
    for record, code, raw_type in extra["specimens"]:
        if raw_type not in types:
            fail(record, "Choose a v5 Specimen type")
        kind = "CLA" if code.upper().startswith("CLA") else code[:2].upper()
        if kind not in {"CL", "CLA", "RT", "DC"} or len(code) <= len(kind):
            fail(record, "Specimen codes must start with CL/CLA/RT/DC followed by an identifier")
        if any(s["specimenCode"].casefold() == code.casefold() for s in state.entities["specimens"].values()):
            fail(record, f"Specimen {code} already exists")
        item = {
            "id": uuid7(),
            "specimenCode": code,
            "specimenKind": kind,
            "specimenType": types[raw_type],
            "cloneFishId": None,
            "linkedFishIds": [],
            "preservationState": "UNKNOWN",
            "notes": raw_type,
            "active": True,
            "createdAt": now,
            "updatedAt": now,
        }
        state.entities["specimens"][item["id"]] = item
        result[record["id"]] = ("specimen", item["id"])
    extra["specimen_links"] = []
    for code, fish_codes in extra["links"].items():
        matches = [
            s
            for s in state.entities["specimens"].values()
            if s["specimenCode"].casefold() == code.casefold() and not s.get("deletedAt")
        ]
        if len(matches) != 1:
            raise APIError(422, "invalid_template", f"Specimen {code} must exist in the specimen registry")
        specimen = matches[0]
        old = specimen.copy()
        links = list(specimen.get("linkedFishIds", []))
        if specimen.get("cloneFishId") and specimen["cloneFishId"] not in links:
            links.append(specimen["cloneFishId"])
        for fish_code in fish_codes:
            fish = next(f for f in state.entities["fish"].values() if f["fishCode"].casefold() == fish_code.casefold())
            if fish["id"] not in links:
                links.append(fish["id"])
                extra["specimen_links"].append((specimen["id"], fish["id"]))
        if specimen["specimenKind"] in {"CL", "CLA"} and len(links) > 1:
            raise APIError(422, "invalid_template", f"{code}: CL/CLA cannot be shared by multiple fish")
        specimen.update(linkedFishIds=links, cloneFishId=links[0] if len(links) == 1 else None)
        if not any(target == ("specimen", specimen["id"]) for target in result.values()):
            audit(state, request, "UPDATE", "specimen", specimen["id"], old, specimen)
    for record, _code, _raw_type in extra["specimens"]:
        item = state.entities["specimens"][result[record["id"]][1]]
        audit(state, request, "INSERT", "specimen", item["id"], None, item)

    # Validate counts before the repository writes them in the same SQL transaction.
    lot_records = [r for r in canonical if r["record_kind"] == "schema:experiment_batch"]
    detailed_lots = {
        (r["values"]["batch_code"].casefold(), str(r["values"]["lot_no"]))
        for r in canonical
        if r["record_kind"] == "schema:embryo"
    }
    seen = set()
    for record in extra["aggregates"]:
        cells = record["values"]["cells"]
        lots = [r for r in lot_records if str(r["values"]["lot_no"]) == str(cells.get("A"))]
        if len(lots) != 1:
            fail(record, "Aggregate lot must match exactly one activation lot in this import")
        lot = state.entities["injection-lots"][targets[lots[0]["id"]][1]]
        if cells.get("C") not in (None, "") and str(cells["C"]) != str(lot["nActivated"]):
            fail(record, "Aggregate n_activated must match the activation lot")
        identity = (lots[0]["values"]["batch_code"].casefold(), str(lot["lotNo"]))
        if identity in seen or identity in detailed_lots:
            fail(record, "Do not duplicate aggregate lots or mix aggregate and individual results for one lot")
        seen.add(identity)
        counts = []
        for index in range(3, 43):
            column = get_column_letter(index)
            raw = cells.get(column)
            if raw in (None, ""):
                continue
            if isinstance(raw, bool) or not re.fullmatch(r"\d+", str(raw)) or int(raw) > lot["nActivated"]:
                fail(record, f"{column}: count must be an integer between zero and n_activated")
            stage = "Activated" if index == 3 else _contract("experiment")[EXPERIMENT][f"{column}67"]
            counts.append({"column": column, "stage": stage, "count": int(raw)})
        if not counts:
            fail(record, "An aggregate row must contain at least one count")
        record["v5_lot_id"] = lot["id"]
        record["v5_counts"] = counts
        result[record["id"]] = ("historical_stage_count", "")
    return result, extra
