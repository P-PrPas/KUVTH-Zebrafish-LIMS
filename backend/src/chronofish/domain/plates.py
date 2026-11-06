from __future__ import annotations

from typing import Any

from ..runtime.errors import APIError

PLATE_SHAPES = {6: (2, 3), 12: (3, 4), 24: (4, 6), 48: (6, 8), 96: (8, 12)}


def plate_wells(size: Any = 96) -> list[str]:
    if isinstance(size, bool) or not isinstance(size, int) or size not in PLATE_SHAPES:
        raise APIError(422, "validation_error", "Well Plate must have 6, 12, 24, 48 or 96 wells")
    rows, columns = PLATE_SHAPES[size]
    return [f"{chr(65 + row)}{column}" for row in range(rows) for column in range(1, columns + 1)]


def embryo_code(batch: dict[str, Any], lot: dict[str, Any], sequence: int) -> str:
    return f"{batch['batchCode']}_{lot['lotNo']}_{sequence}_{batch['experimentDate']}"
