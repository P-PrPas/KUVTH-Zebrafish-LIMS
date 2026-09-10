from uuid import uuid4

from chronofish.domain.state import PROTOCOL_ID


def test_parent_groups_scope_batches_and_reports(client, master_data, write_headers):
    def write(method, path, body):
        return getattr(client, method)(
            "/api/v1" + path, json=body, headers={**write_headers, "X-Idempotency-Key": str(uuid4())}
        )

    group = write("post", "/experiment-groups", {"code": "SCNT-2026", "name": "Research programme"})
    assert group.status_code == 201
    group_id = group.json()["id"]
    assert write("post", "/experiment-groups", {"code": "scnt-2026", "name": "Duplicate"}).status_code == 409
    assert write("post", "/experiment-groups", {"code": None, "name": "Invalid"}).status_code == 422
    body = {
        "batchCode": "GROUPED",
        "experimentDate": "2026-09-09",
        "siteId": master_data["site"]["id"],
        "operatorId": master_data["operator"]["id"],
        "protocolId": PROTOCOL_ID,
        "treatmentGroupId": master_data["treatment"]["id"],
        "experimentGroupId": group_id,
    }
    batch = write("post", "/batches", body)
    assert batch.status_code == 201, batch.text
    for invalid in (False, 0, "", []):
        assert write("post", "/batches", {**body, "experimentGroupId": invalid}).status_code == 422
    assert write("post", "/batches", {**body, "batchCode": "UNGROUPED", "experimentGroupId": None}).status_code == 201
    assert (
        write("post", "/batches", {**body, "batchCode": "INVALID", "experimentGroupId": str(uuid4())}).status_code
        == 422
    )
    assert [
        item["id"] for item in client.get("/api/v1/batches", params={"experimentGroupId": group_id}).json()["items"]
    ] == [batch.json()["id"]]
    assert client.get("/api/v1/analytics/kpi", params={"experimentGroupId": group_id}).json()["stage1"]["nBatches"] == 1
    assert write("patch", "/experiment-groups/" + group_id, {"active": False}).status_code == 200
    assert write("post", "/batches", {**body, "batchCode": "ARCHIVED"}).status_code == 422
    assert write("patch", "/batches/" + batch.json()["id"], {"notes": "Old group still valid"}).status_code == 200
    assert write("patch", "/batches/" + batch.json()["id"], {"experimentGroupId": None}).status_code == 200
    assert client.get("/api/v1/batches", params={"experimentGroupId": group_id}).json()["items"] == []
    assert write("patch", "/experiment-groups/" + group_id, {"active": True}).status_code == 200
    assert write("patch", "/batches/" + batch.json()["id"], {"experimentGroupId": group_id}).status_code == 200
