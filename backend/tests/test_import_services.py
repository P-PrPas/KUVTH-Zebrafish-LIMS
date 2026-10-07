from __future__ import annotations

from io import BytesIO

import pytest
from openpyxl import Workbook
from openpyxl.utils.cell import column_index_from_string

from chronofish.services.import_deferred import deferred_cells
from chronofish.services.import_interpret import interpret
from chronofish.services.import_sources import (
    SourceFormatError,
    _parse_matrix,
    csv_delimiter,
    decode_csv,
    parse_csv,
    parse_xlsx,
    record_json,
    xlsx_sheet_names,
)


def row(**cells: object) -> list[object | None]:
    values: list[object | None] = [None] * max(column_index_from_string(column) for column in cells)
    for column, value in cells.items():
        values[column_index_from_string(column) - 1] = value
    return values


def test_csv_and_xlsx_keep_source_values_and_formula_warnings():
    csv_sheet, encoding, delimiter = parse_csv(b"Number,Code,Material\n1,RT7,whole adult\n", "V1Specimen")
    assert (encoding, delimiter) == ("utf-8-sig", ",")
    assert csv_sheet.records[0].source == {"A": "1", "B": "RT7", "C": "whole adult"}
    csv_sheet.records[0].working["C"] = "caudal fin clip"
    source_json, working_json = record_json(csv_sheet.records[0])
    assert '"whole adult"' in source_json and '"caudal fin clip"' in working_json

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "V1Specimen"
    sheet.append(["Number", "Code", "Material"])
    sheet.append([1, "CL8", "whole embryo"])
    sheet["D3"] = "=1+1"
    output = BytesIO()
    workbook.save(output)
    content = output.getvalue()
    assert xlsx_sheet_names(content) == ["V1Specimen"]
    parsed = parse_xlsx(content, ["V1Specimen"])[0]
    assert parsed.records[0].natural_key == "cl8"
    assert [(issue.code, issue.source_locator) for issue in parsed.issues] == [("formula_cache_missing", "D3")]
    with pytest.raises(SourceFormatError, match="Selected sheets"):
        parse_xlsx(content, ["missing"])
    with pytest.raises(SourceFormatError, match="distinct"):
        parse_xlsx(content, ["V1Specimen", "V1Specimen"])


@pytest.mark.parametrize(
    ("name", "matrix", "kind", "record_kind", "issue"),
    [
        (
            "V1Fish",
            [row(A="No", S="D1"), row(A=1, B="CL1", F="2024-01-01", K="F-1", L="mystery", S=2)],
            "v1_fish",
            "fish",
            "unknown_fish_status",
        ),
        (
            "V2Fish",
            [row(A="No", N="Day 1"), row(A=2, B="2024-01-01", C="MSU", K="normal", N=1)],
            "v2_fish",
            "fish",
            None,
        ),
        (
            "V1Raw",
            [row(A="head"), row(A="sub"), row(B="2024-01-01", C="egg", F="CSOF", G="group", M=5, N=10, S=7)],
            "v1_raw",
            "legacy_lot",
            None,
        ),
        (
            "QC_NBD_IVF",
            [row(A="head"), row(A="sub"), row(A="2024-01-01", B="QC1", D=10, E=5), row(E="1/2")],
            "qc",
            "control_aggregate",
            None,
        ),
        (
            "V1-MSU-test",
            [row(A="head"), row(A="sub"), row(A="2024-01-01", B=10, C=8, D=2)],
            "msu_aggregate",
            "scnt_aggregate",
            None,
        ),
        ("Summary", [row(A="head"), row(A="review")], "reconciliation", "reconciliation", None),
        (
            "V1Specimen",
            [row(B="Code", C="Specimen type"), row(B="RT2", C="unknown")],
            "specimen",
            "specimen",
            "unknown_specimen_material",
        ),
        (
            "V1Specimen",
            [row(B="Code", C="Specimen type"), row(B="BAD", C="whole adult")],
            "specimen",
            "specimen",
            "invalid_specimen_code",
        ),
    ],
)
def test_sheet_types_and_source_issues(name, matrix, kind, record_kind, issue):
    parsed = _parse_matrix(name, matrix)
    assert parsed.kind == kind
    assert parsed.records[0].record_kind == record_kind
    assert parsed.row_count == len(parsed.records)
    if issue:
        assert issue in {item.code for item in parsed.issues}
    if record_kind in {"fish", "specimen", "legacy_lot", "control_aggregate", "scnt_aggregate"}:
        meaning = interpret(record_kind, parsed.records[0].working)
        assert meaning is not None and meaning["entity"]
        assert isinstance(deferred_cells(record_kind, parsed.records[0].working), list)


def test_v2_embryo_block_interprets_one_as_alive_and_zero_as_not_surviving():
    matrix = [row(AL="Stage", AM="Stage"), row(AL="Observation time")]
    matrix.extend(
        [
            row(B="2024-01-01", C="MSU eggs", D=3, AF="09:30", AH=7, AI=1, AJ=7, AK=1, AL=1, AM=0, BN=1),
            row(AL="Observation time", AM="10:00"),
            row(AL="Degenerated", AM="Degenerated"),
            row(AL="Observed dead"),
            row(AL="normal", AM="abnormal"),
        ]
    )
    parsed = _parse_matrix("V2Raw", matrix)
    embryo = next(record for record in parsed.records if record.record_kind == "embryo_candidate")
    meaning = interpret(embryo.record_kind, embryo.working)
    assert meaning is not None
    assert meaning["siteSuggestion"] == "MSU"
    assert [entry["outcome"] for entry in meaning["stageObservations"][:2]] == ["ALIVE", "DEGENERATED"]
    assert meaning["controlCounts"][0]["nNormal"] == 3
    assert meaning["dailySurvival"][0]["outcome"] == "ALIVE"
    assert set(deferred_cells("embryo_candidate", embryo.source)) == {("sourceContext.AH", 7), ("sourceContext.AI", 1)}


def test_validation_limits_and_unrecognized_sources():
    assert _parse_matrix("mystery", [["x"]]).issues[0].code == "unknown_sheet"
    assert _parse_matrix("Template1", [["x"]]).records == []
    assert "fish_dob_missing" in {issue.code for issue in _parse_matrix("V1Fish", [row(A="head"), row(A=1)]).issues}
    assert deferred_cells("sheet_metadata", {"A": 1}) == [("A", 1)]
    assert deferred_cells("unknown", {"A": 1}) == []
    assert interpret("unknown", {"A": 1}) is None
    assert csv_delimiter("a;b\n1;2\n") == ";"
    assert csv_delimiter("single") == ","
    with pytest.raises(SourceFormatError, match="delimiter"):
        csv_delimiter("a,b", ":")
    with pytest.raises(SourceFormatError, match="encoding"):
        decode_csv(b"x", "latin1")
    with pytest.raises(SourceFormatError, match="decoded"):
        decode_csv(b"\xff", "utf-8")
    with pytest.raises(SourceFormatError, match="valid XLSX"):
        xlsx_sheet_names(b"not a zip")
    with pytest.raises(SourceFormatError, match="too many columns"):
        _parse_matrix("V1Specimen", [[None] * 501])
    with pytest.raises(SourceFormatError, match="too long"):
        _parse_matrix("V1Specimen", [["x" * 20_001]])
