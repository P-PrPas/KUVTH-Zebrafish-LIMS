import io
from datetime import datetime, time

import pytest
from openpyxl import load_workbook
from test_import_template import request, seeded

from chronofish.runtime.errors import APIError
from chronofish.services.import_sources import parse_xlsx
from chronofish.services.import_v5 import EMBRYOS, EXPERIMENT, FISH, SPECIMENS, apply_v5, download_bytes


def workbook(kind):
    return load_workbook(io.BytesIO(download_bytes(kind)))


@pytest.mark.parametrize("kind", ["experiment", "registry"])
def test_download_matches_the_supplied_customer_workbook(kind):
    from pathlib import Path

    original = Path(__file__).parents[2] / "docs" / "planning" / "csv-import" / "v5" / f"{kind}-template-v5.xlsx"
    assert download_bytes(kind) == original.read_bytes()


def parse(book, sheets):
    output = io.BytesIO()
    book.save(output)
    return parse_xlsx(output.getvalue(), sheets)


def records(parsed):
    assert not [i for s in parsed for i in s.issues], [i for s in parsed for i in s.issues]
    return [
        {
            "id": f"{s.name}-{r.row_no}",
            "sheet_name": s.name,
            "row_no": r.row_no,
            "record_kind": r.record_kind,
            "values": r.working,
        }
        for s in parsed
        for r in s.records
    ]


def experiment():
    book = workbook("experiment")
    s = book[EXPERIMENT]
    for cell, value in {
        "B5": 1,
        "E5": datetime(2024, 4, 26),
        "H5": "KU",
        "B6": "Demo operator",
        "E6": "CONTROL",
        "H6": "V2",
        "A13": 1,
        "C13": datetime(2024, 4, 26, 10),
        "D13": "AB",
        "E13": "DISSOCIATED",
        "F13": "FRESH",
        "G13": "AB1",
        "H13": 2,
    }.items():
        s[cell] = value
    s = book[EMBRYOS]
    for cell, value in {
        "A8": 1,
        "B8": 1,
        "G8": "Demo operator",
        "H8": datetime(2024, 4, 26),
        "M8": 1,
        "M9": time(10),
        "M10": "NORMAL",
        "N8": 0,
        "N9": datetime(2024, 4, 26, 11),
        "N10": "ABNORMAL",
    }.items():
        s[cell] = value
    return book


@pytest.mark.parametrize("kind,sheets", [("experiment", [EXPERIMENT, EMBRYOS]), ("registry", [FISH, SPECIMENS])])
def test_original_blank_v5_templates_have_no_phantom_rows_or_formula_issues(kind, sheets):
    parsed = parse(workbook(kind), sheets)
    assert not records(parsed)


def test_experiment_original_form_recomputes_uncached_codes_and_preserves_zero_and_site_time():
    state = seeded()
    source = records(parse(experiment(), [EXPERIMENT, EMBRYOS]))
    targets, extra = apply_v5(state, source, request(), "job")
    assert len(targets) == 2
    assert not extra["aggregates"]
    assert len(state.entities["embryos"]) == 1  # n_activated is not an instruction to create embryos.
    assert next(iter(state.entities["batches"].values()))["batchCode"] == "1_Demo operator_CONTROL_1_240426"
    assert next(iter(state.entities["embryos"].values()))["embryoCode"] == "1_Demo operator_CONTROL_1_1_240426"
    observations = list(state.observations.values())
    assert {o["outcome"] for o in observations} == {"ALIVE", "DEAD"}
    assert observations[0]["observedAt"] == "2024-04-26T03:00:00Z"


def registry():
    book = workbook("registry")
    s = book[FISH]
    for row, fish in [(9, "F1"), (13, "F2")]:
        for col, value in {
            "A": fish,
            "D": datetime(2024, 4, 26),
            "E": "AB",
            "F": "DISSOCIATED",
            "G": "FRESH",
            "H": "AB1",
            "I": "ALIVE",
            "J": "NORMAL",
            "L": "ND",
            "M": "KU",
            "O": "N",
            "U": "Demo operator",
            "W": "RT1",
            "X": "DC1",
        }.items():
            s[f"{col}{row}"] = value
    for cell, value in {
        "I9": "DEAD",
        "P9": datetime(2024, 5, 1),
        "Q9": "INTACT",
        "R9": "FROZEN",
        "Z9": 0,
        "Z10": "พิการ",
        "Z11": datetime(2024, 5, 1),
    }.items():
        s[cell] = value
    s = book[SPECIMENS]
    s.append([])
    for row, code, kind in [(8, "RT1", "Caudal fin clip"), (9, "DC1", "left over cells")]:
        s.cell(row, 2, code)
        s.cell(row, 3, kind)
    return book


def test_registry_terminal_state_actual_observation_dates_health_and_shared_specimens():
    state = seeded()
    targets, extra = apply_v5(state, records(parse(registry(), [FISH, SPECIMENS])), request(), "job")
    fish = next(f for f in state.entities["fish"].values() if f["fishCode"] == "F1")
    assert (fish["status"], fish["lifeState"], fish["disposition"], fish["sex"]) == (
        "FROZEN",
        "DEAD",
        "FROZEN",
        "UNKNOWN",
    )
    obs = next(iter(state.fish_observations.values()))
    assert (obs["observedOn"], obs["ageDays"], obs["outcome"], obs["isDisabled"]) == ("2024-05-01", 5, "DEAD", True)
    assert all(len(s["linkedFishIds"]) == 2 and s["cloneFishId"] is None for s in state.entities["specimens"].values())
    assert len(extra["specimen_links"]) == 4
    assert len(targets) == 4


@pytest.mark.parametrize("cell,value", [("M8", "=1+1"), ("D8", '=HYPERLINK("https://example.com")')])
def test_arbitrary_formulas_are_blocked_even_with_a_cached_result(cell, value):
    book = experiment()
    book[EMBRYOS][cell] = value
    parsed = parse(book, [EXPERIMENT, EMBRYOS])
    assert any(i.code == "v5_format" for s in parsed for i in s.issues)


def test_observation_without_a_real_date_fails_instead_of_guessing_from_day_column():
    book = registry()
    book[FISH]["Z11"] = None
    with pytest.raises(APIError, match="Excel date"):
        apply_v5(seeded(), records(parse(book, [FISH, SPECIMENS])), request(), "job")


def test_counts_are_kept_separate_and_cannot_duplicate_individual_lots():
    book = experiment()
    s = book[EXPERIMENT]
    s["A68"], s["C68"], s["D68"] = 1, 2, 0
    with pytest.raises(APIError, match="mix aggregate and individual"):
        apply_v5(seeded(), records(parse(book, [EXPERIMENT, EMBRYOS])), request(), "job")
    targets, extra = apply_v5(seeded(), records(parse(book, [EXPERIMENT])), request(), "job")
    assert len(targets) == 2
    assert extra["aggregates"][0]["v5_counts"][1]["count"] == 0


def test_example_codes_and_broken_four_row_blocks_are_rejected():
    book = registry()
    book[FISH]["A9"] = "CLIENT_FISH_01"
    with pytest.raises(APIError, match="real reference code"):
        apply_v5(seeded(), records(parse(book, [FISH, SPECIMENS])), request(), "job")
    book = registry()
    book[FISH]["T10"] = "DATE"
    assert parse(book, [FISH])[0].issues


@pytest.fixture(scope="module")
def source_forms():
    return {
        "experiment": records(parse(experiment(), [EXPERIMENT, EMBRYOS])),
        "registry": records(parse(registry(), [FISH, SPECIMENS])),
    }


@pytest.mark.parametrize(
    "form,index,path,value,message",
    [
        ("experiment", 0, ["cells", "A"], 0, "positive integer"),
        ("experiment", 0, ["cells", "B"], "CLIENT_BATCH", "real reference"),
        ("experiment", 0, ["metadata", "experiment_no"], "1.5", "positive integer"),
        ("experiment", 0, ["metadata", "treatment_group"], None, "explicit batch_code"),
        ("experiment", 1, ["lot"], {}, "lot_no must match"),
        ("experiment", 1, ["rows"], [], "four v5 source rows"),
        ("experiment", 1, ["rows", 0, "H"], None, "time-only observation"),
        ("experiment", 1, ["rows", 0, "M"], "?", "Outcome must"),
        ("experiment", 1, ["rows", 1, "M"], "2024-04-26T11:30:00", "time order"),
        ("registry", 0, ["rows", 0, "I"], "UNKNOWN", "status must"),
        ("registry", 0, ["rows", 0, "Q"], "WRONG", "Invalid exit"),
        ("registry", 0, ["rows", 0, "Q"], "LOST", "FROZEN requires"),
        ("registry", 0, ["rows", 0, "R"], "DISCARDED", "DISCARDED requires"),
        ("registry", 0, ["rows", 0, "I"], "ALIVE", "alive fish cannot"),
        ("registry", 0, ["rows", 0, "L"], "X", "sex must"),
        ("registry", 0, ["rows", 0, "J"], None, "recorded health"),
        ("registry", 0, ["rows", 1, "Z"], None, "observation health"),
        ("registry", 0, ["rows", 0, "W"], "CL1", "RT prefix"),
        ("registry", 0, ["rows", 0, "W"], "RTmissing", "must exist"),
        ("registry", 0, ["rows", 2, "Z"], "2024-05-02", "after exit_date"),
        ("registry", 2, ["cells", "C"], "wrong type", "Specimen type"),
        ("registry", 2, ["cells", "B"], "ZZ1", "CL/CLA/RT/DC"),
        ("registry", 2, ["cells", "B"], "RT", "CL/CLA/RT/DC"),
    ],
)
def test_v5_rejects_incomplete_contradictory_or_unlinked_source_facts(source_forms, form, index, path, value, message):
    import copy

    source = copy.deepcopy(source_forms[form])
    target = source[index]["values"]
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value
    with pytest.raises(APIError, match=message):
        apply_v5(seeded(), source, request(), "job")


@pytest.mark.parametrize("payload", [None, [], {"cells": None}, {"cells": {}, "metadata": []}])
def test_edited_draft_must_keep_v5_object_structure(payload):
    source = [{"id": "one", "sheet_name": EXPERIMENT, "row_no": 13, "record_kind": "schema:v5_lot", "values": payload}]
    with pytest.raises(APIError, match="object"):
        apply_v5(seeded(), source, request(), "job")


def test_unknown_historical_health_is_preserved_and_does_not_become_disability(source_forms):
    import copy

    source = copy.deepcopy(source_forms["registry"])
    source[0]["values"]["rows"][0]["J"] = "รอตรวจ: สุขภาพไม่ทราบ"
    source[0]["values"]["rows"][1]["Z"] = "ว่ายน้ำอ่อนแรง"
    state = seeded()
    apply_v5(state, source, request(), "job")
    fish = next(f for f in state.entities["fish"].values() if f["fishCode"] == "F1")
    assert fish["condition"] == "UNDETERMINED"
    assert not fish["isDisabled"]
    assert fish["sickNote"] == "รอตรวจ: สุขภาพไม่ทราบ"
    assert next(iter(state.fish_observations.values()))["healthStatus"] == "WEAK"
