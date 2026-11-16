"""Browser regression for same-file reselection and operator changes, using a built app and isolated API fixtures."""

import mimetypes
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

root = Path.cwd().resolve()
dist = (root / "frontend/dist").resolve()
state = {"created": False, "errors": [], "documents": 0}
user = {"id": "admin-1", "email": "admin@example.test", "role": "admin"}
job = {
    "id": "job-1",
    "status": "draft",
    "inputKind": "xlsx",
    "revision": 1,
    "createdAt": "2026-11-16T00:00:00Z",
}
with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ctx = browser.new_context(
        service_workers="block", viewport={"width": 1100, "height": 850}
    )
    ctx.add_init_script("localStorage.setItem('chronofish.language','en')")
    page = ctx.new_page()
    page.on("pageerror", lambda e: state["errors"].append(str(e)))

    def route(r):
        path = urlparse(r.request.url).path
        if path.startswith("/api/v1/"):
            part = path[7:]
            method = r.request.method
            if part == "/auth/me":
                body = {"user": user}
            elif part == "/operators":
                body = {"items": [{"id": "op-1", "name": "Researcher"}]}
            elif part == "/imports/inspect":
                body = {
                    "inputKind": "xlsx",
                    "files": [{"name": "source.xlsx", "sheets": ["V1Fish"]}],
                }
            elif part == "/imports" and method == "POST":
                state["created"] = True
                body = {"job": job, "deferredFieldCount": 0}
            elif part == "/imports":
                body = {"items": [job] if state["created"] else []}
            elif part == "/imports/job-1":
                body = {
                    "job": job,
                    "files": [],
                    "recordCount": 0,
                    "issueCount": 0,
                    "deferredFieldCount": 0,
                }
            elif part.endswith("/mapping-requirements"):
                body = {
                    "canConfirmTemplate": True,
                    "unresolvedIssueCount": 0,
                    "donorSources": [],
                    "sheetNames": [],
                    "ambiguousZeroRecords": [],
                }
            elif part.endswith("/historical-summary"):
                body = {"stageCounts": [], "observations": []}
            elif part.endswith("/historical-structure"):
                body = {"total": 0, "items": []}
            elif part.endswith("/comparison"):
                body = {"matchedFiles": [], "records": []}
            elif part.endswith("/deferred-fields"):
                body = {"total": 0, "items": []}
            else:
                body = {"items": []}
            r.fulfill(json=body)
            return
        file = (
            (dist / path.lstrip("/")).resolve()
            if path not in ("", "/")
            else dist / "index.html"
        )
        if path == "/admin":
            state["documents"] += 1
            file = dist / "index.html"
        if not file.is_relative_to(dist) or not file.is_file():
            r.fulfill(status=404)
            return
        r.fulfill(
            body=file.read_bytes(),
            content_type=mimetypes.guess_type(file.name)[0]
            or "application/octet-stream",
        )

    page.route("**/*", route)
    page.goto("https://layout.test/admin#imports")
    page.locator('main[data-page="imports"]').wait_for()
    file = page.locator("input[type=file]")
    fixture = {
        "name": "registry-v5.xlsx",
        "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "buffer": b"fixture",
    }
    file.set_input_files(fixture)
    page.get_by_role("button", name="Inspect files").click()
    page.get_by_label("V1Fish").check()
    page.get_by_role("button", name="Create draft").click()
    page.get_by_text("Draft saved.", exact=False).first.wait_for()
    assert file.evaluate("e => e.files.length") == 0
    page.locator(".operator-menu summary").click()
    page.locator("#operator-select").select_option("op-1")
    assert page.locator(".import-page").get_attribute("data-step") == "2"
    assert state["documents"] == 1
    assert page.locator(".import-page__stepper, .import-stepper").count() > 0
    page.get_by_role("button", name="Back to import jobs").click()
    file.set_input_files(fixture)
    assert file.evaluate("e => e.files.length") == 1
    assert page.get_by_role("button", name="Inspect files").is_enabled()
    assert not state["errors"], state["errors"]
    print(
        "PASS: actual Chromium same-file reselection after draft; operator change keeps open draft and step; no page exceptions"
    )
    ctx.close()
    browser.close()
