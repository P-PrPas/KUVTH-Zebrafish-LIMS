import io

import pytest
from openpyxl import load_workbook
from starlette.requests import Request

from chronofish.domain.state import DEMO_OPERATOR_ID, State
from chronofish.runtime.errors import APIError
from chronofish.services.import_sources import _parse_matrix
from chronofish.services.import_template import SHEETS, template_bytes
from chronofish.services.import_template_apply import apply_template


def test_schema_template_is_parsed_by_header_instead_of_legacy_cell_position():
    sheet = _parse_matrix("clone_fish", [["fish_code", "dob"], ["F-001", "2024-04-26"]])
    assert len(sheet.records) == 1
    assert sheet.records[0].record_kind == "schema:clone_fish"
    assert sheet.records[0].working == {"fish_code": "F-001", "dob": "2024-04-26"}


def seeded():
    state = State.seeded()
    state.entities["sites"]["site"] = {"id": "site", "code": "KU", "timeZone": "Asia/Bangkok"}
    state.entities["donor-cell-lines"]["donor"] = {
        "id": "donor",
        "strain": "AB",
        "preparation": "DISSOCIATED",
        "preservation": "FRESH",
        "batchCode": "AB1",
    }
    state.entities["treatment-groups"]["group"] = {"id": "group", "code": "CONTROL", "armType": "SCNT"}
    return state


def request():
    result = Request(
        {"type": "http", "headers": [(b"x-operator-id", DEMO_OPERATOR_ID.encode()), (b"x-device-id", b"template-test")]}
    )
    result.state.user = {"id": "admin", "role": "admin"}
    return result


def records():
    rows = {
        "experiment_batch": {
            "batch_code": "B1",
            "experiment_date": "2024-04-26",
            "site": "KU",
            "operator": "Demo operator",
            "treatment_group": "CONTROL",
            "donor_strain": "AB",
            "donor_preparation": "DISSOCIATED",
            "donor_derivation": "FRESH",
            "donor_batch_code": "AB1",
            "lot_no": "1",
            "activated_at": "2024-04-26 10:00",
            "n_activated": 2,
        },
        "embryo": {"batch_code": "B1", "lot_no": "1", "seq_in_lot": 1},
        "clone_fish": {
            "fish_code": "F1",
            "embryo_code": "B1_1_1",
            "status": "ALIVE",
            "biological_condition": "NORMAL",
            "sex": "UNKNOWN",
        },
        "embryo_observation": {
            "embryo_code": "B1_1_1",
            "stage": "SH",
            "observed_at": "2024-04-26 16:00",
            "outcome": "ALIVE",
            "biological_condition": "NORMAL",
            "observer": "Demo operator",
        },
        "fish_observation": {
            "fish_code": "F1",
            "observed_on": "2024-05-02",
            "outcome": "ALIVE",
            "biological_condition": "NORMAL",
            "observer": "Demo operator",
        },
        "control_arm_count": {"batch_code": "B1", "arm_type": "IVF", "stage": "SH", "n_normal": 4, "n_abnormal": 1},
        "specimen": {
            "specimen_code": "CL1",
            "fish_code": "F1",
            "specimen_kind": "CL",
            "specimen_type": "CAUDAL_FIN_CLIP",
            "collected_on": "2024-05-02",
        },
    }
    return [
        {"id": name, "record_kind": "schema:" + name, "sheet_name": name, "row_no": 2, "values": row}
        for name, row in rows.items()
    ]


def test_complete_graph_preserves_relations_local_time_and_only_explicit_embryos():
    state = seeded()
    targets = apply_template(state, records(), request(), "job")
    assert len(targets) == 7
    assert len(state.entities["embryos"]) == 1
    fish = next(iter(state.entities["fish"].values()))
    embryo = next(iter(state.entities["embryos"].values()))
    assert fish["embryoId"] == embryo["id"]
    assert fish["dob"] == "2024-04-26"
    assert fish["runningNo"] == 1
    assert state.next_fish_no == 2
    observation = next(iter(state.observations.values()))
    assert observation["observedAt"] == "2024-04-26T09:00:00Z"
    assert observation["hpaActual"] == 6
    assert observation["hpaExpectedSnapshot"] == 6
    assert next(iter(state.fish_observations.values()))["ageDays"] == 6


@pytest.mark.parametrize(
    ("sheet", "field", "value", "message"),
    [
        ("clone_fish", "sex", "ND", "sex"),
        ("clone_fish", "status", "DEAD", "exit_date"),
        ("embryo_observation", "outcome", 1, "outcome"),
        ("embryo_observation", "observed_at", "2024-04-26 09:59", "precedes activation"),
        ("fish_observation", "fish_code", "missing", "fishCode"),
        ("control_arm_count", "n_normal", -1, "n_normal"),
    ],
)
def test_bad_values_fail_with_source_row(sheet, field, value, message):
    data = records()
    next(r for r in data if r["sheet_name"] == sheet)["values"][field] = value
    with pytest.raises(APIError) as error:
        apply_template(seeded(), data, request(), "job")
    assert f"{sheet} row 2" in error.value.message
    assert message in error.value.message


def test_download_is_blank_with_contract_headers_and_current_reference_values():
    book = load_workbook(io.BytesIO(template_bytes(seeded())))
    assert set(SHEETS) <= set(book.sheetnames)
    for name, columns in SHEETS.items():
        assert list(next(book[name].values)) == columns
        assert book[name].max_row == 1
        assert book[name].freeze_panes == "A2"
    assert any("AB1" in row for row in book["Reference"].values)


def test_unknown_duplicate_headers_and_formulas_block_template_drafts():
    parsed = _parse_matrix("clone_fish", [["fish_code", "fish_code", "mystery"], ["F1", "F2", "data"]])
    assert parsed.issues[0].code == "template_headers"
    assert parsed.issues[0].severity == "blocking"
    assert parsed.records[0].source["mystery"] == "data"
    parsed = _parse_matrix("clone_fish", [["fish_code"], ["cached"]], {"A2"})
    assert any(issue.code == "template_formula" and issue.severity == "blocking" for issue in parsed.issues)
