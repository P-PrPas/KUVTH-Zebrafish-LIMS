from io import BytesIO
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile

from chronofish.api.routes.exports import CLEAN_HEADERS, _clean_rows
from chronofish.domain.rules import stage_code
from chronofish.domain.state import State

NS = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def test_clean_export_matches_client_workbook_and_validates_age_criteria(client, write_headers):
    reference = Path(__file__).parents[2] / "docs/examples/example_data/Experiment_Cloning_03_Clean table v1.xlsx"
    with ZipFile(reference) as archive:
        strings = ["".join(item.itertext()) for item in ET.fromstring(archive.read("xl/sharedStrings.xml"))]
        header = ET.fromstring(archive.read("xl/worksheets/sheet1.xml")).find("x:sheetData/x:row", NS)
        assert [strings[int(cell.find("x:v", NS).text)] for cell in header] == CLEAN_HEADERS
    response = client.post(
        "/api/v1/exports/excel",
        headers=write_headers,
        json={"format": "clean", "fishStageAgeDays": [7, 30, 90]},
    )
    assert response.status_code == 200
    with ZipFile(BytesIO(response.content)) as archive:
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        assert [sheet.attrib["name"] for sheet in workbook.find("x:sheets", NS)] == ["v4"]
        sheet = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))
        assert ["".join(cell.itertext()) for cell in sheet.find("x:sheetData/x:row", NS)] == CLEAN_HEADERS
        assert sheet.find("x:autoFilter", NS).attrib["ref"] == "A1:AD1"
    assert "fry7-juvenile30-adult90" in response.headers["content-disposition"]
    for ages in (None, [], [7, 30], [30, 7, 90], [7, 7, 90], [True, 30, 90], [-1, 30, 90], [7, 30.5, 90]):
        assert (
            client.post(
                "/api/v1/exports/excel",
                headers=write_headers,
                json={"format": "clean", "fishStageAgeDays": ages},
            ).status_code
            == 422
        )
    assert client.post("/api/v1/exports/excel", headers=write_headers, json={"format": "unknown"}).status_code == 422
    assert (
        client.post(
            "/api/v1/exports/excel",
            headers=write_headers,
            json={"format": "clean", "fishStageAgeDays": [7, 30, 90], "sheets": ["01_Batches"]},
        ).status_code
        == 422
    )


def test_clean_counts_map_stages_and_count_each_linked_fish_once():
    state = State()
    state.entities["sites"]["site"] = {"code": "KU"}
    state.entities["donor-cell-lines"]["donor"] = {"strain": "AB"}
    state.entities["batches"]["batch"] = {
        "id": "batch",
        "siteId": "site",
        "replicateNo": 1,
        "experimentGroupId": "group",
    }
    state.entities["injection-lots"]["lot"] = {
        "batchId": "batch",
        "donorCellLineId": "donor",
        "activatedAt": "2026-01-01T00:00:00Z",
    }
    for index, order in enumerate((8, 9, 23, 24, 25)):
        embryo_id = f"e{index}"
        state.entities["embryos"][embryo_id] = {"id": embryo_id, "injectionLotId": "lot"}
        state.observations[embryo_id] = {"embryoId": embryo_id, "stageCode": stage_code(order), "outcome": "ALIVE"}
    state.entities["fish"] = {
        "f1": {"id": "f1", "embryoId": "e0"},
        "f2": {"id": "f2", "embryoId": "e1"},
        "manual": {"id": "manual"},
    }
    state.fish_observations = {
        "1": {"cloneFishId": "f1", "ageDays": 30, "outcome": "ALIVE"},
        "2": {"cloneFishId": "f1", "ageDays": 90, "outcome": "ALIVE"},
        "3": {"cloneFishId": "f2", "ageDays": 7, "outcome": "ALIVE"},
        "4": {"cloneFishId": "f2", "ageDays": 30, "outcome": "DEAD"},
        "5": {"cloneFishId": "manual", "ageDays": 90, "outcome": "ALIVE"},
        "6": {"cloneFishId": "f2", "ageDays": 90, "outcome": "ALIVE", "deletedAt": "2026-09-09"},
    }
    [row] = _clean_rows(state, {"experimentGroupId": "group"}, [7, 30, 90])
    values = dict(zip(CLEAN_HEADERS, row, strict=True))
    assert values["64-cell"] == 5 and values["256-cell"] == 4
    assert [values[key] for key in ("Day1", "Day3", "Day4")] == [3, 2, 1]
    assert [values[key] for key in ("Fry", "Juvenile", "Adult")] == [2, 1, 1]
    assert _clean_rows(state, {"experimentGroupId": "other"}, [7, 30, 90]) == []
