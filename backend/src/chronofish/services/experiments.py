from __future__ import annotations

import re
from typing import Any

from ..domain.state import State


def _numeric_lot_number(value: str) -> int | None:
    return int(value) if re.fullmatch(r"[0-9]+", value) else None


def lot_number_scope(state: State, batch: dict[str, Any]) -> tuple[str, str]:
    recipient_lot = state.entities["recipient-egg-lots"].get(str(batch.get("recipientEggLotId") or ""), {})
    # Group membership is intentionally not a lot-number key: one experiment
    # group can contain multiple experiment codes. Keep an unlinked batch isolated.
    experiment_code = str(recipient_lot.get("label") or "").strip() or str(batch.get("clutchCode") or "").strip()
    if not experiment_code:
        experiment_code = f"batch:{batch.get('id', '')}"
    return experiment_code.casefold(), str(batch.get("experimentDate", ""))


def next_lot_number(state: State, batch: dict[str, Any]) -> str:
    scope = lot_number_scope(state, batch)
    existing = [
        str(item.get("lotNo", "")).strip()
        for item in state.entities["injection-lots"].values()
        if (parent := state.entities["batches"].get(str(item.get("batchId", ""))))
        and lot_number_scope(state, parent) == scope
    ]
    numeric = [number for value in existing if (number := _numeric_lot_number(value)) is not None]
    used = {value.casefold() for value in existing}
    number = max(numeric, default=0) + 1
    while str(number).casefold() in used:
        number += 1
    return str(number)


def lot_number_sort_key(item: dict[str, Any]) -> tuple[int, int | str]:
    value = str(item.get("lotNo", ""))
    number = _numeric_lot_number(value)
    return (0, number) if number is not None else (1, value.casefold())
