"""One continuous API journey, with export readback of the resulting animal."""

from datetime import datetime
from io import BytesIO
from zoneinfo import ZoneInfo

from openpyxl import load_workbook
from test_experiments import headers
from test_fish import setup_eligible_embryo


def test_eligible_embryo_to_fish_specimen_disposition_and_export(client, write_headers):
    embryo = setup_eligible_embryo(client, write_headers)
    promoted = client.post(
        "/api/v1/promotions",
        headers=headers(write_headers, 901),
        json={"promotions": [{"clientUuid": "01900000-0000-7000-8000-000000000901", "embryoId": embryo["id"]}]},
    )
    assert promoted.status_code == 201, promoted.text
    fish = promoted.json()["items"][0]["fish"]
    assert not client.get("/api/v1/promotions/pending").json()["items"]
    specimen = client.post(
        f"/api/v1/fish/{fish['id']}/specimens",
        headers=headers(write_headers, 902),
        json={
            "specimenCode": "ACCEPTANCE-FIN",
            "specimenKind": "CL",
            "specimenType": "CAUDAL_FIN_CLIP",
            "markFinClipped": True,
        },
    )
    assert specimen.status_code == 201, specimen.text
    observed = client.post(
        "/api/v1/observations/fish",
        headers=headers(write_headers, 903),
        json={
            "observations": [
                {
                    "clientUuid": "01900000-0000-7000-8000-000000000903",
                    "cloneFishId": fish["id"],
                    "observedOn": datetime.now(ZoneInfo("Asia/Bangkok")).date().isoformat(),
                    "outcome": "DEAD",
                    "condition": "NORMAL",
                }
            ]
        },
    )
    assert observed.json()["results"][0]["status"] == "created", observed.text
    detail = client.get(f"/api/v1/fish/{fish['id']}").json()
    assert detail["status"] == "DEAD" and detail["finClipped"]
    exported = client.post("/api/v1/exports/excel", headers=headers(write_headers, 904), json={})
    assert exported.status_code == 200, exported.text
    workbook = load_workbook(BytesIO(exported.content), read_only=True, data_only=True)
    values = {str(value) for sheet in workbook for row in sheet.values for value in row if value is not None}
    assert {fish["fishCode"], "ACCEPTANCE-FIN", "DEAD"} <= values
    workbook.close()
