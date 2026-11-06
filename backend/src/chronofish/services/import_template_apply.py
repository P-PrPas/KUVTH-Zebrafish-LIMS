"""Build the complete canonical graph on a private State before committing anything."""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from ..runtime.errors import APIError
from ..runtime.mutations import audit
from ..runtime.values import iso_now, uuid7
from .import_template import ENUMS, REQUIRED, SHEETS


def apply_template(state: Any, records: list[dict], request: Any, job_id: str) -> dict[str, tuple[str, str]]:
    from ..api.routes.experiments import _create_batch

    targets: dict[str, tuple[str, str]] = {}
    now = iso_now()
    location = ""

    def fail(message: str) -> None:
        raise APIError(422, "invalid_template", f"{location}: {message}")

    def text(value: Any) -> str:
        return str(value).strip() if value is not None else ""

    def enum(row: dict, key: str, allowed: list | set | None = None, default: str = "") -> str:
        value = text(row.get(key)) or default
        if value not in (allowed if allowed is not None else ENUMS[key]):
            fail(f"{key}: invalid value {value!r}")
        return value

    def integer(row: dict, key: str, minimum: int = 0, maximum: int = 2147483647) -> int:
        value = row.get(key)
        try:
            number = int(str(value))
        except (ValueError, TypeError):
            fail(f"{key}: expected integer")
        if isinstance(value, bool) or not minimum <= number <= maximum:
            fail(f"{key}: expected {minimum}..{maximum}")
        return number

    def day(value: Any, key: str, optional: bool = False) -> str | None:
        if optional and value in (None, ""):
            return None
        try:
            # XLSX date cells arrive as midnight ISO timestamps; reject non-midnight times.
            raw = text(value)
            parsed = datetime.fromisoformat(raw) if "T" in raw else None
            if parsed and parsed.time() != datetime.min.time():
                raise ValueError
            result = (parsed.date() if parsed else date.fromisoformat(raw)).isoformat()
        except (ValueError, TypeError):
            fail(f"{key}: expected YYYY-MM-DD")
        if result > datetime.now(ZoneInfo("Asia/Bangkok")).date().isoformat():
            fail(f"{key}: future dates are not allowed")
        return result

    def instant(value: Any, zone: str, key: str) -> str:
        try:
            raw = text(value)
            if "T" not in raw and " " not in raw:
                raise ValueError
            parsed = datetime.fromisoformat(raw)
            if parsed.tzinfo is None:
                tz = ZoneInfo(zone)
                first, second = parsed.replace(tzinfo=tz, fold=0), parsed.replace(tzinfo=tz, fold=1)
                if first.utcoffset() != second.utcoffset():
                    raise ValueError
                parsed = first
                if parsed.astimezone(UTC).astimezone(tz).replace(tzinfo=None) != first.replace(tzinfo=None):
                    raise ValueError
            if parsed.astimezone(UTC) > datetime.now(UTC):
                raise ValueError
            return parsed.astimezone(UTC).isoformat().replace("+00:00", "Z")
        except (ValueError, TypeError, ZoneInfoNotFoundError):
            fail(f"{key}: expected unambiguous date and time in site timezone")

    def active(resource: str) -> list[dict]:
        return [
            item
            for item in state.entities[resource].values()
            if item.get("active") is not False and not item.get("deletedAt")
        ]

    def lookup(resource: str, key: str, value: Any) -> dict:
        matches = [item for item in active(resource) if text(item.get(key)).casefold() == text(value).casefold()]
        if not text(value) or len(matches) != 1:
            fail(f"{key}: {value!r} must match exactly one active {resource} entry")
        return matches[0]

    def donor(row: dict) -> dict:
        strain = text(row.get("donor_strain"))
        preparation = enum(row, "donor_preparation")
        preservation = enum(row, "donor_derivation")
        matches = [
            d
            for d in active("donor-cell-lines")
            if text(d.get("strain")).casefold() == strain.casefold()
            and d.get("preparation") == preparation
            and d.get("preservation") == preservation
            and text(d.get("batchCode")).casefold() == text(row.get("donor_batch_code")).casefold()
        ]
        if len(matches) != 1:
            fail("donor fields must match exactly one Reference donor, including donor_batch_code")
        return matches[0]

    def stage(value: Any, batch: dict | None = None) -> dict:
        profiles = (
            [p for p in active("timing-profiles") if p["id"] == batch.get("timingProfileId")]
            if batch
            else [p for p in active("timing-profiles") if p.get("isCurrent")]
        )
        entries = [
            e
            for p in profiles
            for e in p.get("entries", [])
            if text(value).casefold() in {text(e.get("shortLabel")).casefold(), text(e.get("stageCode")).casefold()}
        ]
        if len(entries) != 1:
            fail(f"stage: {value!r} must match a Reference stage")
        return entries[0]

    def insert(resource: str, table: str, item: dict, record: dict) -> dict:
        item = {"id": uuid7(), "active": True, "createdAt": now, "updatedAt": now, **item}
        state.entities[resource][item["id"]] = item
        audit(state, request, "INSERT", table, item["id"], None, item)
        targets[record["id"]] = (table, item["id"])
        return item

    def unique(resource: str, key: str, value: str) -> None:
        # Codes remain reserved after soft deletion by database unique constraints.
        if any(text(item.get(key)).casefold() == value.casefold() for item in state.entities[resource].values()):
            fail(f"{key}: {value!r} already exists")

    groups = {name: [] for name in SHEETS}
    for record in records:
        name = record["record_kind"].removeprefix("schema:")
        location = f"{record['sheet_name']} row {record['row_no']}"
        if name not in groups:
            fail("Do not mix schema templates with legacy sheets")
        row = record["values"]
        if set(row) - set(SHEETS[name]):
            fail("Unknown column(s): " + ", ".join(sorted(set(row) - set(SHEETS[name]))))
        for field in REQUIRED[name]:
            if field == "treatment_group" and record.get("v5_source"):
                continue
            if not text(row.get(field)):
                fail(f"{field}: required")
        for key, value in row.items():
            limit = 20000 if key == "remarks" else 150 if key in {"fish_code", "embryo_code", "batch_code"} else 100
            if len(text(value)) > limit:
                fail(f"{key}: maximum {limit} characters")
        groups[name].append((record, row))

    batch_inputs = {}
    for record, row in groups["experiment_batch"]:
        location = f"experiment_batch row {record['row_no']}"
        code = text(row["batch_code"])
        site = lookup("sites", "code", row["site"])
        if not site.get("timeZone"):
            fail("site requires a timezone")
        protocol = active("protocols")
        if len(protocol) != 1:
            fail("Exactly one active protocol is required")
        body = {
            "batchCode": code,
            "experimentDate": day(row["experiment_date"], "experiment_date"),
            "siteId": site["id"],
            "operatorId": lookup("operators", "name", row["operator"])["id"],
            "treatmentGroupId": lookup("treatment-groups", "code", row["treatment_group"])["id"]
            if row.get("treatment_group")
            else None,
            "protocolId": protocol[0]["id"],
        }
        if code.casefold() in batch_inputs:
            old_body, batch = batch_inputs[code.casefold()]
            if body != old_body:
                fail("Repeated batch_code has conflicting experiment metadata")
        else:
            unique("batches", "batchCode", code)
            if record.get("v5_source"):
                profiles = [p for p in active("timing-profiles") if p.get("isCurrent")]
                if len(profiles) != 1:
                    fail("Exactly one current timing profile is required")
                batch = insert(
                    "batches",
                    "experiment_batch",
                    {
                        **body,
                        "timingProfileId": profiles[0]["id"],
                        "dayNo": record.get("v5_day_no", 1),
                        "wellPlateSize": 96,
                    },
                    record,
                )
            else:
                batch = _create_batch(state, request, body)
            batch_inputs[code.casefold()] = (body, batch)
        lot_no = text(row["lot_no"])
        if len(lot_no) > 20 or any(
            candidate["batchId"] == batch["id"] and text(candidate["lotNo"]).casefold() == lot_no.casefold()
            for candidate in active("injection-lots")
        ):
            fail("lot_no: duplicate within batch or longer than 20 characters")
        activated = instant(row["activated_at"], site["timeZone"], "activated_at")
        if (
            datetime.fromisoformat(activated).astimezone(ZoneInfo(site["timeZone"])).date().isoformat()
            != body["experimentDate"]
        ):
            fail("activated_at must be on experiment_date in site timezone")
        insert(
            "injection-lots",
            "injection_lot",
            {
                "batchId": batch["id"],
                "lotNo": lot_no,
                "donorCellLineId": donor(row)["id"],
                "activatedAt": activated,
                "nActivated": integer(
                    row,
                    "n_activated",
                    0 if record.get("v5_source") else 1,
                    2147483647 if record.get("v5_source") else 96,
                ),
            },
            record,
        )

    for record, row in groups["embryo"]:
        location = f"embryo row {record['row_no']}"
        batch = lookup("batches", "batchCode", row["batch_code"])
        lots = [
            candidate
            for candidate in active("injection-lots")
            if candidate["batchId"] == batch["id"]
            and text(candidate["lotNo"]).casefold() == text(row["lot_no"]).casefold()
        ]
        if len(lots) != 1:
            fail("batch_code + lot_no must identify one activation lot")
        lot = lots[0]
        sequence = integer(row, "seq_in_lot", 1, lot["nActivated"])
        if any(e["injectionLotId"] == lot["id"] and e["seqInLot"] == sequence for e in active("embryos")):
            fail("seq_in_lot already exists in this lot")
        code = text(row.get("embryo_code")) or f"{batch['batchCode']}_{lot['lotNo']}_{sequence}"
        if len(code) > 150:
            fail("embryo_code: maximum 150 characters")
        unique("embryos", "embryoCode", code)
        well = text(row.get("well_position")) or None
        if well:
            import re

            if not re.fullmatch(r"[A-H](?:[1-9]|1[0-2])", well) or any(
                e["injectionLotId"] == lot["id"] and e.get("wellPosition") == well for e in active("embryos")
            ):
                fail("well_position must be unique within lot and within A1..H12")
        exit_reason = text(row.get("exit_reason")) or None
        exit_at = None
        if exit_reason or row.get("exit_at"):
            exit_reason = enum(row, "exit_reason", {"DEAD", "DEGENERATED", "PROMOTED", "LOST"})
            site = state.entities["sites"][batch["siteId"]]
            exit_at = instant(row.get("exit_at"), site["timeZone"], "exit_at")
            if exit_at < lot["activatedAt"]:
                fail("exit_at precedes activation")
        exit_stage = stage(row["exit_stage"], batch) if row.get("exit_stage") else None
        if exit_stage and not exit_reason:
            fail("exit_stage requires exit_reason and exit_at")
        insert(
            "embryos",
            "embryo",
            {
                "injectionLotId": lot["id"],
                "seqInLot": sequence,
                "embryoCode": code,
                "wellPosition": well,
                "exitAt": exit_at,
                "exitReason": exit_reason,
                "exitStageCode": exit_stage.get("stageCode") if exit_stage else None,
            },
            record,
        )

    for record, row in groups["clone_fish"]:
        location = f"clone_fish row {record['row_no']}"
        code = text(row["fish_code"])
        unique("fish", "fishCode", code)
        embryo = lookup("embryos", "embryoCode", row["embryo_code"]) if row.get("embryo_code") else None
        lot = state.entities["injection-lots"][embryo["injectionLotId"]] if embryo else None
        batch = state.entities["batches"][lot["batchId"]] if lot else None
        if embryo and any(f.get("embryoId") == embryo["id"] for f in state.entities["fish"].values()):
            fail("embryo_code is already linked to a fish")
        if embryo and embryo.get("exitReason") in {"DEAD", "DEGENERATED", "LOST"}:
            fail("Cannot link a fish to a dead, degenerated or lost embryo")
        site = (
            lookup("sites", "code", row["site"])
            if row.get("site")
            else (state.entities["sites"][batch["siteId"]] if batch else None)
        )
        dob = day(row.get("dob"), "dob", optional=bool(embryo))
        if batch and site["id"] != batch["siteId"]:
            fail("site disagrees with embryo experiment site")
        if lot:
            expected = (
                datetime.fromisoformat(lot["activatedAt"]).astimezone(ZoneInfo(site["timeZone"])).date().isoformat()
            )
            if dob and dob != expected:
                fail("dob disagrees with embryo activation date")
            dob = expected
        donor_id = donor(row)["id"] if row.get("donor_strain") or not lot else lot["donorCellLineId"]
        if lot and donor_id != lot["donorCellLineId"]:
            fail("donor disagrees with embryo activation lot")
        status = enum(row, "status")
        exit_date = day(row.get("exit_date"), "exit_date", optional=True)
        exit_reason = text(row.get("exit_reason")) or None
        if status in {"DEAD", "FROZEN", "DISCARDED"}:
            if not exit_date or exit_reason != status or exit_date < dob:
                fail("terminal status requires exit_date >= dob and exit_reason matching status")
        elif exit_date or exit_reason:
            fail("exit fields require DEAD/FROZEN/DISCARDED status")
        condition = enum(row, "biological_condition")
        abnormal = day(row.get("first_abnormal_on"), "first_abnormal_on", optional=True)
        if abnormal and (condition != "ABNORMAL" or abnormal < dob):
            fail("first_abnormal_on requires ABNORMAL and date >= dob")
        box = lookup("fish-boxes", "boxCode", row["fish_box"]) if row.get("fish_box") else None
        if box and (not site or box.get("siteId") != site["id"]):
            fail("fish_box belongs to another site")
        clipped = (
            enum(row, "fin_clipped", default="false").lower()
            if not isinstance(row.get("fin_clipped"), bool)
            else str(row["fin_clipped"]).lower()
        )
        state.next_fish_no = max(
            state.next_fish_no, max((f.get("runningNo", 0) for f in state.entities["fish"].values()), default=0) + 1
        )
        insert(
            "fish",
            "clone_fish",
            {
                "fishCode": code,
                "embryoId": embryo["id"] if embryo else None,
                "dob": dob,
                "donorCellLineId": donor_id,
                "siteId": site["id"] if site else None,
                "fishBoxId": box["id"] if box else None,
                "runningNo": state.next_fish_no,
                "status": status,
                "condition": condition,
                "sex": enum(row, "sex"),
                "finClipped": clipped == "true",
                "lifeState": "ALIVE" if status == "ALIVE" else "DEAD" if status == "DEAD" else "UNKNOWN",
                "disposition": status if status in {"FROZEN", "DISCARDED"} else "NONE",
                "firstAbnormalOn": abnormal,
                "firstAbnormalAgeDays": (date.fromisoformat(abnormal) - date.fromisoformat(dob)).days
                if abnormal
                else None,
                "exitDate": exit_date,
                "exitReason": exit_reason,
                "remarks": row.get("remarks"),
                "importJobId": job_id,
            },
            record,
        )
        state.next_fish_no += 1

    embryo_stages = {(o["embryoId"], o["stageCode"]) for o in state.observations.values() if not o.get("deletedAt")}
    fish_days = {
        (o["cloneFishId"], o["observedOn"]) for o in state.fish_observations.values() if not o.get("deletedAt")
    }
    for name in ("embryo_observation", "fish_observation", "control_arm_count", "specimen"):
        for record, row in groups[name]:
            location = f"{name} row {record['row_no']}"
            if name == "control_arm_count":
                batch = lookup("batches", "batchCode", row["batch_code"])
                entry = stage(row["stage"], batch)
                arm = enum(row, "arm_type")
                if any(
                    c["batchId"] == batch["id"] and c["armType"] == arm and c["stageCode"] == entry["stageCode"]
                    for c in active("control-arm-counts")
                ):
                    fail("Duplicate batch/arm/stage count")
                insert(
                    "control-arm-counts",
                    name,
                    {
                        "batchId": batch["id"],
                        "armType": arm,
                        "stageCode": entry["stageCode"],
                        "nNormal": integer(row, "n_normal"),
                        "nAbnormal": integer(row, "n_abnormal"),
                    },
                    record,
                )
                continue
            if name == "embryo_observation":
                embryo = lookup("embryos", "embryoCode", row["embryo_code"])
                lot = state.entities["injection-lots"][embryo["injectionLotId"]]
                batch = state.entities["batches"][lot["batchId"]]
                entry = stage(row["stage"], batch)
                if int(entry["stageOrder"]) > 26:
                    fail("Embryo observation stage must be within stages 1..26")
                observed = instant(
                    row["observed_at"], state.entities["sites"][batch["siteId"]]["timeZone"], "observed_at"
                )
                actual = round(
                    (datetime.fromisoformat(observed) - datetime.fromisoformat(lot["activatedAt"])).total_seconds()
                    / 3600,
                    4,
                )
                if actual < 0:
                    fail("observed_at precedes activation")
                if (embryo["id"], entry["stageCode"]) in embryo_stages:
                    fail("Duplicate embryo/stage observation")
                embryo_stages.add((embryo["id"], entry["stageCode"]))
                collection = state.observations
                item = {
                    "embryoId": embryo["id"],
                    "stageCode": entry["stageCode"],
                    "observedAt": observed,
                    "outcome": enum(row, "outcome", {"ALIVE", "DEAD", "DEGENERATED", "NOT_OBSERVED"}),
                    "hpaActual": actual,
                    "hpaExpectedSnapshot": float(entry["expectedHpa"]),
                    "deviationH": round(actual - float(entry["expectedHpa"]), 4),
                }
            else:
                fish = lookup("fish", "fishCode", row["fish_code"])
                if name == "specimen":
                    code = text(row["specimen_code"])
                    if len(code) > 50:
                        fail("specimen_code: maximum 50 characters")
                    unique("specimens", "specimenCode", code)
                    collected = day(row.get("collected_on"), "collected_on", optional=True)
                    frozen = day(row.get("frozen_on"), "frozen_on", optional=True)
                    storage = enum(row, "storage") if row.get("storage") is not None else None
                    if (
                        collected
                        and collected < fish["dob"]
                        or frozen
                        and frozen < fish["dob"]
                        or frozen
                        and collected
                        and frozen < collected
                    ):
                        fail("Specimen dates are out of order")
                    if storage and not frozen:
                        fail("storage requires frozen_on")
                    insert(
                        "specimens",
                        name,
                        {
                            "cloneFishId": fish["id"],
                            "specimenCode": code,
                            "specimenKind": enum(row, "specimen_kind"),
                            "specimenType": enum(row, "specimen_type"),
                            "preservationState": "CRYOPRESERVED" if frozen else "UNKNOWN",
                            "collectedOn": collected,
                            "frozenOn": frozen,
                            "storage": storage,
                        },
                        record,
                    )
                    continue
                observed = day(row["observed_on"], "observed_on")
                age = (date.fromisoformat(observed) - date.fromisoformat(fish["dob"])).days
                if age < 0:
                    fail("observed_on precedes dob")
                if (fish["id"], observed) in fish_days:
                    fail("Duplicate fish/day observation")
                fish_days.add((fish["id"], observed))
                collection = state.fish_observations
                item = {
                    "cloneFishId": fish["id"],
                    "observedOn": observed,
                    "ageDays": age,
                    "outcome": enum(row, "outcome", {"ALIVE", "DEAD", "FROZEN", "DISCARDED", "NOT_OBSERVED"}),
                }
            item.update(
                id=uuid7(),
                clientUuid=uuid7(),
                condition=enum(row, "biological_condition"),
                operatorId=lookup("operators", "name", row["observer"])["id"],
                deviceId=request.headers.get("X-Device-Id"),
                isBackdated=True,
                createdAt=now,
                updatedAt=now,
            )
            collection[item["id"]] = item
            audit(state, request, "INSERT", name, item["id"], None, item)
            targets[record["id"]] = (name, item["id"])
    return targets
