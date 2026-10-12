from __future__ import annotations

import copy
import logging
import math
import re
from datetime import date, datetime
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, BackgroundTasks, Request

from ...domain.rules import (
    age_days_on,
    condition_valid,
    fish_health_status_valid,
    fish_outcome_valid,
    is_backdated,
    round4,
    stage_label,
    stage_number,
)
from ...domain.state import State
from ...runtime.errors import APIError
from ...runtime.mutations import audit
from ...runtime.values import iso_now, normalize, parse_datetime, utc_now, uuid7
from ...services.fish import apply_fish_update, find_fish_for_embryo, recompute_fish
from ...store import Store
from .experiments import _lot_inputs, _validate_batch
from .observations import _interval_metrics, _recompute_embryo, _recompute_intervals, _validate_observation

LOGGER = logging.getLogger("chronofish.corrections")
BANGKOK = ZoneInfo("Asia/Bangkok")
FIELDS = {
    "experiment_batch": {
        "experimentDate",
        "dayNo",
        "siteId",
        "operatorId",
        "experimentGroupId",
        "treatmentGroupId",
        "recipientEggLotId",
        "csofLotId",
        "clutchCode",
        "replicateNo",
        "incubationTempC",
        "notes",
    },
    "injection_lot": {
        "donorCellLineId",
        "enuPowerPct",
        "enuPulseUs",
        "enuLed",
        "enuStartAt",
        "enuFinishAt",
        "nEggs",
        "nManipulated",
        "notes",
    },
    "embryo": {"wellPosition"},
    "embryo_observation": {"observedAt", "outcome", "condition", "notes"},
    "clone_fish": {"fishCode", "fishBoxId", "sex", "finClipped", "remarks"},
    "fish_observation": {"observedOn", "outcome", "condition", "healthStatus", "notes"},
}
REFERENCE_FIELDS = {
    "siteId": "sites",
    "operatorId": "operators",
    "experimentGroupId": "experiment-groups",
    "treatmentGroupId": "treatment-groups",
    "recipientEggLotId": "recipient-egg-lots",
    "csofLotId": "csof-lots",
    "donorCellLineId": "donor-cell-lines",
    "fishBoxId": "fish-boxes",
}


def _value_label(state: State, field: str, value: Any) -> str | None:
    resource = REFERENCE_FIELDS.get(field)
    if not resource or value is None:
        return None
    item = state.entities[resource].get(str(value))
    if not item:
        return None
    return str(
        item.get("name")
        or item.get("code")
        or item.get("label")
        or item.get("boxCode")
        or item.get("lotCode")
        or item.get("strain")
        or value
    )


def _target(state: State, table: str, target_id: str) -> dict[str, Any]:
    try:
        UUID(target_id)
    except ValueError as error:
        raise APIError(400, "invalid_target", "Record id must be a UUID") from error
    collection = {
        "experiment_batch": state.entities["batches"],
        "injection_lot": state.entities["injection-lots"],
        "embryo": state.entities["embryos"],
        "embryo_observation": state.observations,
        "clone_fish": state.entities["fish"],
        "fish_observation": state.fish_observations,
    }.get(table)
    if collection is None:
        raise APIError(422, "invalid_target", "This record type cannot be corrected")
    item = collection.get(target_id)
    if not item or item.get("deletedAt") is not None or item.get("active") is False:
        raise APIError(404, "not_found", "Record not found")
    return item


def _operator_id(state: State, table: str, item: dict[str, Any]) -> str | None:
    if table in {"experiment_batch", "embryo_observation", "fish_observation"}:
        return str(item.get("operatorId") or "") or None
    if table == "injection_lot":
        batch = state.entities["batches"].get(str(item.get("batchId")), {})
        return str(batch.get("operatorId") or "") or None
    if table == "embryo":
        lot = state.entities["injection-lots"].get(str(item.get("injectionLotId")), {})
        batch = state.entities["batches"].get(str(lot.get("batchId")), {})
        return str(batch.get("operatorId") or "") or None
    if table == "clone_fish":
        embryo = state.entities["embryos"].get(str(item.get("embryoId")), {})
        return _operator_id(state, "embryo", embryo)
    return None


def _target_label(state: State, table: str, item: dict[str, Any]) -> str:
    if table == "experiment_batch":
        return str(item.get("batchCode") or item.get("id"))
    if table == "injection_lot":
        batch = state.entities["batches"].get(str(item.get("batchId")), {})
        return f"{batch.get('batchCode', '')} / lot {item.get('lotNo', '')}".strip(" /")
    if table == "embryo":
        return str(item.get("embryoCode") or item.get("id"))
    if table == "embryo_observation":
        embryo = state.entities["embryos"].get(str(item.get("embryoId")), {})
        return f"{embryo.get('embryoCode', '')} / {stage_label(stage_number(str(item.get('stageCode', ''))))}".strip(
            " /"
        )
    if table == "clone_fish":
        return str(item.get("fishCode") or item.get("id"))
    fish = state.entities["fish"].get(str(item.get("cloneFishId")), {})
    return f"{fish.get('fishCode', '')} / {item.get('observedOn', '')}".strip(" /")


def _validate_and_apply(
    state: State, request: Request, table: str, target_id: str, field: str, value: Any, reason: str
) -> None:
    item = _target(state, table, target_id)
    old = copy.deepcopy(item)
    candidate = {**item, field: value, "updatedAt": iso_now()}
    if table == "experiment_batch":
        _validate_batch(state, candidate, target_id)
        experiment_date = date.fromisoformat(str(candidate["experimentDate"]))
        for lot in state.entities["injection-lots"].values():
            if (
                lot.get("batchId") == target_id
                and lot.get("activatedAt")
                and experiment_date > parse_datetime(str(lot["activatedAt"])).astimezone(BANGKOK).date()
            ):
                raise APIError(422, "related_data_conflict", "Experiment date is after an injection lot activation")
        state.entities["batches"][target_id] = candidate
    elif table == "injection_lot":
        # Corrections cannot change the number of embryos or their activation origin.
        _lot_inputs(state, copy.deepcopy(candidate))
        counts = [candidate.get("nActivated"), candidate.get("nManipulated"), candidate.get("nEggs")]
        if all(isinstance(count, int) for count in counts) and not counts[0] <= counts[1] <= counts[2]:
            raise APIError(422, "related_data_conflict", "Egg counts must satisfy activated ≤ manipulated ≤ total")
        state.entities["injection-lots"][target_id] = candidate
    elif table == "embryo":
        well = candidate.get("wellPosition")
        if well is not None and (not isinstance(well, str) or re.fullmatch(r"[A-H](?:1[0-2]|[1-9])", well) is None):
            raise APIError(422, "validation_error", "wellPosition must be A1 through H12")
        if well and any(
            other.get("id") != target_id
            and other.get("injectionLotId") == item.get("injectionLotId")
            and other.get("wellPosition") == well
            and other.get("deletedAt") is None
            for other in state.entities["embryos"].values()
        ):
            raise APIError(409, "related_data_conflict", "Well position is already occupied")
        state.entities["embryos"][target_id] = candidate
    elif table == "embryo_observation":
        candidate["overrideReason"] = reason
        if message := _validate_observation(state, candidate, target_id):
            raise APIError(422, "related_data_conflict", message)
        if candidate["outcome"] in {"DEAD", "DEGENERATED"} and any(
            other.get("id") != target_id
            and other.get("embryoId") == candidate["embryoId"]
            and other.get("deletedAt") is None
            and str(other.get("observedAt")) > str(candidate["observedAt"])
            for other in state.observations.values()
        ):
            raise APIError(422, "related_data_conflict", "A later embryo observation already exists")
        lot = state.entities["injection-lots"][str(candidate["injectionLotId"])]
        observed = parse_datetime(str(candidate["observedAt"]))
        actual = round4((observed - parse_datetime(str(lot["activatedAt"]))).total_seconds() / 3600)
        expected = float(candidate["hpaExpectedSnapshot"])
        candidate.update(
            hpaActual=actual, deviationH=round4(actual - expected), isBackdated=is_backdated(observed, utc_now())
        )
        interval = _interval_metrics(
            state, str(candidate["embryoId"]), stage_number(str(candidate["stageCode"])), actual, expected, target_id
        )
        for key in ("intervalActual", "intervalExpected", "intervalDeviationH"):
            candidate.pop(key, None)
        if interval:
            candidate["intervalActual"], candidate["intervalExpected"], candidate["intervalDeviationH"] = interval
        state.observations[target_id] = candidate
        embryo_id = str(candidate["embryoId"])
        for before_interval, after_interval in _recompute_intervals(state, embryo_id):
            if after_interval["id"] != target_id:
                audit(
                    state,
                    request,
                    "UPDATE",
                    "embryo_observation",
                    str(after_interval["id"]),
                    before_interval,
                    after_interval,
                )
        old_embryo = copy.deepcopy(state.entities["embryos"].get(embryo_id, {}))
        _recompute_embryo(state, embryo_id)
        if old_embryo != state.entities["embryos"].get(embryo_id):
            audit(state, request, "UPDATE", "embryo", embryo_id, old_embryo, state.entities["embryos"][embryo_id])
        if fish := find_fish_for_embryo(state, embryo_id):
            fish_id = str(fish["id"])
            old_fish = copy.deepcopy(fish)
            recompute_fish(state, fish_id)
            if old_fish != state.entities["fish"].get(fish_id):
                audit(state, request, "UPDATE", "clone_fish", fish_id, old_fish, state.entities["fish"][fish_id])
    elif table == "clone_fish":
        old, candidate = apply_fish_update(state, target_id, {field: value})
    elif table == "fish_observation":
        candidate["overrideReason"] = reason
        candidate.setdefault("healthStatus", "UNDETERMINED")
        if (
            not fish_outcome_valid(str(candidate.get("outcome")))
            or not condition_valid(str(candidate.get("condition")))
            or not fish_health_status_valid(str(candidate.get("healthStatus")))
        ):
            raise APIError(422, "validation_error", "Invalid fish observation value")
        fish = state.entities["fish"].get(str(candidate["cloneFishId"]), {})
        try:
            observed = date.fromisoformat(str(candidate["observedOn"]))
            born = date.fromisoformat(str(fish["dob"]))
        except (ValueError, KeyError) as error:
            raise APIError(422, "validation_error", "Invalid observation date") from error
        if observed < born or observed > datetime.now(BANGKOK).date():
            raise APIError(422, "related_data_conflict", "Observation date is outside the fish lifetime")
        related = [
            other
            for other in state.fish_observations.values()
            if other.get("id") != target_id
            and other.get("cloneFishId") == candidate["cloneFishId"]
            and other.get("deletedAt") is None
        ]
        if candidate["outcome"] in {"DEAD", "FROZEN", "DISCARDED"} and any(
            str(other.get("observedOn")) > str(candidate["observedOn"]) for other in related
        ):
            raise APIError(422, "related_data_conflict", "A later fish observation already exists")
        if any(
            other.get("outcome") in {"DEAD", "FROZEN", "DISCARDED"}
            and str(other.get("observedOn")) < str(candidate["observedOn"])
            for other in related
        ):
            raise APIError(422, "related_data_conflict", "The fish has an earlier terminal observation")
        candidate.update(ageDays=age_days_on(born, observed), isBackdated=observed != datetime.now(BANGKOK).date())
        state.fish_observations[target_id] = candidate
        fish_id = str(candidate["cloneFishId"])
        old_fish = copy.deepcopy(state.entities["fish"].get(fish_id, {}))
        recompute_fish(state, fish_id)
        if old_fish != state.entities["fish"].get(fish_id):
            audit(state, request, "UPDATE", "clone_fish", fish_id, old_fish, state.entities["fish"][fish_id])
    audit(state, request, "UPDATE", table, target_id, old, {**candidate, "correctionReason": reason})


def build_corrections_router(store: Store) -> APIRouter:
    router = APIRouter(prefix="/api/v1/corrections", tags=["corrections"])

    def view(row: dict[str, Any], state: State, request: Request, *, validate: bool = False) -> dict[str, Any]:
        item = copy.deepcopy(row)
        target = None
        try:
            target = _target(state, row["targetTable"], row["targetId"])
        except APIError:
            pass
        item["targetLabel"] = _target_label(state, row["targetTable"], target) if target else row["targetId"]
        item["oldLabel"] = _value_label(state, row["fieldName"], row["oldValue"])
        item["proposedLabel"] = _value_label(state, row["fieldName"], row["proposedValue"])
        item["conflict"] = row["status"] == "pending" and (
            target is None
            or target.get(row["fieldName"]) != row["oldValue"]
            or str(target.get("updatedAt") or "") != row["sourceUpdatedAt"]
        )
        if item["conflict"]:
            item["currentValue"] = target.get(row["fieldName"]) if target else None
            item["currentLabel"] = _value_label(state, row["fieldName"], item["currentValue"])
            query = getattr(store, "query_audits", None)
            if query:
                logs, _ = query(
                    table=row["targetTable"],
                    record_id=row["targetId"],
                    operator_id=None,
                    from_time=parse_datetime(row["createdAt"]),
                    to_time=None,
                    cursor=None,
                    limit=100,
                )
            else:
                logs = [
                    entry
                    for entry in state.audits
                    if entry["tableName"] == row["targetTable"] and entry["recordId"] == row["targetId"]
                ]
                logs.sort(key=lambda entry: entry["occurredAt"], reverse=True)
            item["relatedAuditIds"] = [entry["id"] for entry in logs if str(entry["occurredAt"]) > row["createdAt"]][
                :10
            ]
        elif row["status"] == "pending" and validate:
            try:
                _validate_and_apply(
                    copy.deepcopy(state),
                    request,
                    row["targetTable"],
                    row["targetId"],
                    row["fieldName"],
                    row["proposedValue"],
                    row["reason"],
                )
            except APIError as error:
                item["validationMessage"] = error.message
        return item

    def notify(background: BackgroundTasks, request: Request, recipients: list[str], subject: str, body: str) -> None:
        auth = request.app.state.auth

        def deliver() -> None:
            for recipient in set(recipients):
                try:
                    auth._send(recipient, subject, body)
                except Exception:
                    LOGGER.exception("Correction notification failed")

        if recipients:
            background.add_task(deliver)

    @router.get("")
    def list_requests(request: Request) -> dict[str, Any]:
        user = request.state.user
        state = store.snapshot()
        rows = []
        for row in state.correction_requests.values():
            if user["role"] == "admin" or row["requesterId"] == user["id"]:
                rows.append(view(row, state, request))
            elif row["status"] == "approved":
                if row.get("recordedByUserId") == user["id"] or (
                    not row.get("recordedByUserId")
                    and user.get("operatorId")
                    and row.get("recordedOperatorId") == user["operatorId"]
                ):
                    rows.append(
                        {
                            **view(row, state, request),
                            "requesterId": "",
                            "requesterEmail": "",
                            "reason": "",
                            "decisionReason": None,
                            "notificationOnly": True,
                        }
                    )
        rows.sort(key=lambda row: row["createdAt"], reverse=True)
        return {"items": rows}

    @router.get("/markers")
    def markers(request: Request, targetTable: str, targetId: str) -> dict[str, Any]:
        state = store.snapshot()
        _target(state, targetTable, targetId)
        pending = [
            row
            for row in state.correction_requests.values()
            if row["targetTable"] == targetTable and row["targetId"] == targetId and row["status"] == "pending"
        ]
        return {
            "fields": sorted({row["fieldName"] for row in pending}),
            "ownFields": sorted(
                {row["fieldName"] for row in pending if row["requesterId"] == request.state.user["id"]}
            ),
        }

    @router.post("")
    async def create(request: Request, body: dict[str, Any], background_tasks: BackgroundTasks):
        body = normalize(body)
        table, target_id, field = body.get("targetTable"), body.get("targetId"), body.get("fieldName")
        reason, value = body.get("reason"), body.get("proposedValue")
        if (
            not isinstance(table, str)
            or not isinstance(target_id, str)
            or not isinstance(field, str)
            or field not in FIELDS.get(table, set())
        ):
            raise APIError(422, "validation_error", "This field cannot be corrected")
        if not isinstance(reason, str) or not 1 <= len(reason.strip()) <= 2000:
            raise APIError(422, "validation_error", "A reason of up to 2000 characters is required")
        reason = reason.strip()
        if (
            isinstance(value, (dict, list))
            or value is None
            and field
            not in {
                "notes",
                "remarks",
                "wellPosition",
                "fishBoxId",
                "recipientEggLotId",
                "csofLotId",
                "experimentGroupId",
            }
        ):
            raise APIError(422, "validation_error", "A proposed value is required")
        if isinstance(value, str) and len(value) > 2000 or isinstance(value, float) and not math.isfinite(value):
            raise APIError(422, "validation_error", "The proposed value is invalid")
        user = request.state.user
        creator_query = getattr(store, "creator_for_record", None)
        recorded_by = creator_query(table, target_id) if creator_query else None

        def operation(state: State):
            current = _target(state, table, target_id)
            if current.get(field) == value:
                raise APIError(422, "no_change", "The proposed value matches the current value")
            if any(
                row["requesterId"] == user["id"]
                and row["targetTable"] == table
                and row["targetId"] == target_id
                and row["fieldName"] == field
                and row["status"] == "pending"
                for row in state.correction_requests.values()
            ):
                raise APIError(409, "duplicate_request", "You already have a pending request for this field")
            now, request_id = iso_now(), uuid7()
            original_actor = recorded_by or next(
                (
                    entry.get("actorUserId")
                    for entry in state.audits
                    if entry.get("tableName") == table
                    and entry.get("recordId") == target_id
                    and entry.get("action") == "INSERT"
                ),
                None,
            )
            row = {
                "id": request_id,
                "requesterId": user["id"],
                "requesterEmail": user["email"],
                "recordedOperatorId": _operator_id(state, table, current),
                "recordedByUserId": original_actor,
                "targetTable": table,
                "targetId": target_id,
                "fieldName": field,
                "oldValue": current.get(field),
                "proposedValue": value,
                "sourceUpdatedAt": str(current.get("updatedAt") or ""),
                "reason": reason,
                "status": "pending",
                "decisionReason": None,
                "decidedByUserId": None,
                "appliedAuditId": None,
                "createdAt": now,
                "updatedAt": now,
            }
            state.correction_requests[request_id] = row
            audit(state, request, "INSERT", "correction_request", request_id, None, row)
            return 201, row

        response = store.execute_mutation(request, body, operation)
        users = request.app.state.auth.repository.list_users(utc_now())
        admins = [
            item["email"] for item in users if item["role"] == "admin" and item["active"] and item.get("verifiedAt")
        ]
        admin_url = f"{request.app.state.auth.config.app_base_url}/admin#corrections"
        notify(
            background_tasks,
            request,
            admins,
            "New correction request",
            f"{user['email']} requested a correction to {table} / {target_id} / {field}.\nOpen {admin_url} to review.",
        )
        return response

    @router.post("/{request_id}/withdraw")
    async def withdraw(request_id: str, request: Request, body: dict[str, Any]):
        def operation(state: State):
            row = state.correction_requests.get(request_id)
            if not row or row["requesterId"] != request.state.user["id"]:
                raise APIError(404, "not_found", "Request not found")
            if row["status"] != "pending":
                raise APIError(409, "invalid_state", "Only pending requests can be withdrawn")
            old = copy.deepcopy(row)
            row.update(status="withdrawn", updatedAt=iso_now())
            audit(state, request, "UPDATE", "correction_request", request_id, old, row)
            return 200, row

        return store.execute_mutation(request, body, operation)

    @router.post("/{request_id}/decide")
    async def decide(request_id: str, request: Request, body: dict[str, Any], background_tasks: BackgroundTasks):
        if request.state.user["role"] != "admin":
            raise APIError(403, "admin_required", "Admin access is required")
        body = normalize(body)
        decision, reason = body.get("decision"), body.get("reason")
        if decision not in {"approve", "reject"}:
            raise APIError(422, "validation_error", "Decision must be approve or reject")
        if decision == "reject" and (not isinstance(reason, str) or not 1 <= len(reason.strip()) <= 2000):
            raise APIError(422, "validation_error", "A rejection reason is required")
        if isinstance(reason, str):
            reason = reason.strip()

        def operation(state: State):
            row = state.correction_requests.get(request_id)
            if not row:
                raise APIError(404, "not_found", "Request not found")
            if row["status"] != "pending":
                raise APIError(409, "invalid_state", "This request has already been resolved")
            if decision == "approve":
                try:
                    current = _target(state, row["targetTable"], row["targetId"])
                except APIError as error:
                    raise APIError(
                        409, "source_changed", "The original record is no longer available. Reject this request"
                    ) from error
                changed = (
                    current.get(row["fieldName"]) != row["oldValue"]
                    or str(current.get("updatedAt") or "") != row["sourceUpdatedAt"]
                )
                if changed:
                    raise APIError(
                        409,
                        "source_changed",
                        "The original record changed. Reject this request and ask the member to submit a new one",
                    )
            old = copy.deepcopy(row)
            if decision == "approve":
                _validate_and_apply(
                    state,
                    request,
                    row["targetTable"],
                    row["targetId"],
                    row["fieldName"],
                    row["proposedValue"],
                    row["reason"],
                )
                row["appliedAuditId"] = state.audits[-1]["id"]
            row.update(
                status="approved" if decision == "approve" else "rejected",
                decisionReason=reason if decision == "reject" else None,
                decidedByUserId=request.state.user["id"],
                updatedAt=iso_now(),
            )
            audit(state, request, "UPDATE", "correction_request", request_id, old, row)
            return 200, row

        response = store.execute_mutation(request, body, operation)
        row = store.snapshot().correction_requests[request_id]
        users = request.app.state.auth.repository.list_users(utc_now())
        recipients = [row["requesterEmail"]]
        if decision == "approve":
            creator = next(
                (item for item in users if item["id"] == row.get("recordedByUserId") and item["active"]), None
            )
            if creator:
                recipients.append(creator["email"])
            elif not row.get("recordedByUserId"):
                recipients += [
                    item["email"]
                    for item in users
                    if item["active"]
                    and item.get("operatorId") == row.get("recordedOperatorId")
                    and item["email"] != row["requesterEmail"]
                ]
        request_url = f"{request.app.state.auth.config.app_base_url}/#my-requests"
        notify(
            background_tasks,
            request,
            recipients,
            f"Correction request {row['status']}",
            f"Request {request_id} for {row['targetTable']} / {row['targetId']} / "
            f"{row['fieldName']} is {row['status']}.\n"
            f"{'Reason: ' + reason if decision == 'reject' else 'The old and new values are in the request history.'}\n"
            f"Open {request_url} to review.",
        )
        return response

    @router.get("/{request_id}")
    def detail(request_id: str, request: Request) -> dict[str, Any]:
        state = store.snapshot()
        row = state.correction_requests.get(request_id)
        if not row or (request.state.user["role"] != "admin" and row["requesterId"] != request.state.user["id"]):
            raise APIError(404, "not_found", "Request not found")
        return view(row, state, request, validate=True)

    return router
