from chronofish.domain.state import State
from chronofish.services.experiments import lot_number_scope, lot_number_sort_key, next_lot_number


def test_lot_number_sequence_uses_code_and_date_not_experiment_group():
    state = State()
    state.entities["recipient-egg-lots"].update(
        {
            "egg-1": {"id": "egg-1", "label": "E4_2026-08-20"},
            "egg-2": {"id": "egg-2", "label": "E4_2026-08-20"},
        }
    )
    batches = {
        "batch-1": {
            "id": "batch-1",
            "recipientEggLotId": "egg-1",
            "experimentDate": "2026-08-20",
            "experimentGroupId": "group-a",
        },
        "batch-2": {
            "id": "batch-2",
            "recipientEggLotId": "egg-2",
            "experimentDate": "2026-08-20",
            "experimentGroupId": "group-b",
        },
        "batch-next-day": {
            "id": "batch-next-day",
            "recipientEggLotId": "egg-1",
            "experimentDate": "2026-08-21",
            "experimentGroupId": "group-a",
        },
        "batch-unlinked-1": {
            "id": "batch-unlinked-1",
            "experimentDate": "2026-08-20",
            "experimentGroupId": "group-a",
        },
        "batch-unlinked-2": {
            "id": "batch-unlinked-2",
            "experimentDate": "2026-08-20",
            "experimentGroupId": "group-a",
        },
    }
    state.entities["batches"].update(batches)
    state.entities["injection-lots"].update(
        {
            "lot-1": {"id": "lot-1", "batchId": "batch-1", "lotNo": "1"},
            "lot-2": {"id": "lot-2", "batchId": "batch-2", "lotNo": "2"},
            "deleted-lot": {"id": "deleted-lot", "batchId": "batch-2", "lotNo": "3", "deletedAt": "now"},
        }
    )

    assert lot_number_scope(state, batches["batch-1"]) == lot_number_scope(state, batches["batch-2"])
    assert next_lot_number(state, batches["batch-2"]) == "4"
    assert next_lot_number(state, batches["batch-next-day"]) == "1"
    assert next_lot_number(state, batches["batch-unlinked-1"]) == "1"
    assert next_lot_number(state, batches["batch-unlinked-2"]) == "1"


def test_lot_numbers_sort_numerically_before_legacy_text_values():
    lots = [{"lotNo": value} for value in ("10", "2", "June_2", "1")]

    assert [item["lotNo"] for item in sorted(lots, key=lot_number_sort_key)] == ["1", "2", "10", "June_2"]
