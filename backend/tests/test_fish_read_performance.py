from datetime import date, timedelta
from types import SimpleNamespace

from chronofish.api.routes.fish import build_fish_router
from chronofish.domain.state import State
from chronofish.services.fish import enrich_fish


class ScanBudget(dict):
    def __init__(self, rows, budget):
        super().__init__(rows)
        self.scans = 0
        self.budget = budget

    def values(self):
        self.scans += 1
        assert self.scans <= self.budget, "Observation collection rescanned per fish"
        return super().values()


def test_large_fish_reads_scan_observations_at_most_once_per_snapshot():
    state = State()
    today = date.today().isoformat()
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    for index in range(2000):
        fish_id = str(index)
        state.entities["fish"][fish_id] = {
            "id": fish_id,
            "fishCode": fish_id,
            "dob": yesterday,
            "status": "ALIVE",
            "condition": "NORMAL",
            "isDisabled": index % 2 == 0,
        }
    state.observations = ScanBudget(
        {str(i): {"embryoId": str(i % 2000), "condition": "NORMAL"} for i in range(40000)}, 0
    )
    state.fish_observations = ScanBudget(
        {
            str(i): {
                "id": str(i),
                "cloneFishId": str(i % 2000),
                "observedOn": today if i < 1000 else yesterday,
                "condition": "NORMAL",
                "outcome": "ALIVE",
            }
            for i in range(60000)
        },
        1,
    )
    for fish in state.entities["fish"].values():
        enriched = enrich_fish(state, fish)
        assert enriched["isDisabled"] == fish["isDisabled"]
        assert enriched["condition"] == ("ABNORMAL" if fish["isDisabled"] else "NORMAL")
    router = build_fish_router(SimpleNamespace(snapshot=lambda: state))
    roll_call = next(route.endpoint for route in router.routes if route.path == "/api/v1/fish/roll-call")
    result = roll_call(date_value=today, siteId=None, boxId=None)
    assert len(result["items"]) == 2000
    for item in result["items"]:
        assert item["isDisabled"] == (int(item["fishId"]) % 2 == 0)
        assert item["alreadyRecorded"] == (int(item["fishId"]) < 1000)
    assert state.observations.scans == 0
    assert state.fish_observations.scans == 1
