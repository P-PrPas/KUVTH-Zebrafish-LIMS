"""Check the built app's navigation geometry with isolated API fixtures.

Run after `npm run build` in frontend. No server or real accounts are used.
"""

import json
import mimetypes
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "frontend/dist"
OUTPUT = ROOT / ".tmp/reminder-layout"


def run():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    results = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        for language in ("th", "en"):
            for width in (320, 375, 699, 700, 1199, 1200, 1440):
                context = browser.new_context(
                    viewport={"width": width, "height": 900}, service_workers="block"
                )
                context.add_init_script(
                    f"localStorage.setItem('chronofish.language', '{language}')"
                )
                page = context.new_page()
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))

                def route(request):
                    path = urlparse(request.request.url).path
                    if path.startswith("/api/"):
                        body = {"items": []}
                        if path.endswith("/auth/me"):
                            body = {
                                "user": {
                                    "id": "layout-member",
                                    "email": "layout@example.test",
                                    "role": "member",
                                    "operatorId": "operator-1",
                                }
                            }
                        elif path.endswith("/due-checkpoints"):
                            body = {
                                "overdue": [{"id": str(i)} for i in range(123)],
                                "due": [],
                            }
                        elif path.endswith("/fish/roll-call"):
                            body = {
                                "items": [{"id": "fish-1", "alreadyRecorded": False}]
                            }
                        request.fulfill(json=body)
                        return
                    file = (
                        (DIST / path.lstrip("/")).resolve()
                        if path != "/"
                        else DIST / "index.html"
                    )
                    if not file.is_relative_to(DIST.resolve()) or not file.is_file():
                        request.fulfill(status=404)
                        return
                    request.fulfill(
                        body=file.read_bytes(),
                        content_type=mimetypes.guess_type(file.name)[0]
                        or "application/octet-stream",
                    )

                page.route("**/*", route)
                page.goto("https://layout.test/#dashboard")
                page.locator(".task-reminders summary strong").filter(
                    has_text="124"
                ).wait_for()
                page.evaluate("document.fonts.ready")
                for expanded in (False, True):
                    page.locator(".task-reminders").evaluate(
                        "(node, open) => { node.open = open; }", expanded
                    )
                    metrics = page.evaluate("""() => {
                      const reminder = document.querySelector('.task-reminders');
                      const box = reminder.getBoundingClientRect();
                      const summary = reminder.querySelector('summary');
                      const controls = [...document.querySelectorAll('.nav-group--primary > button, .nav-disclosure--mobile > summary')]
                        .filter(node => node.getClientRects().length);
                      const intersects = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
                        Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
                      const content = [...reminder.querySelectorAll('summary, summary span, strong, button')]
                        .filter(node => node.getClientRects().length);
                      return {
                        overlap: controls.some(node => intersects(box, node.getBoundingClientRect())),
                        contentOutside: content.some(node => { const r = node.getBoundingClientRect();
                          return r.left < box.left - 1 || r.right > box.right + 1 || node.scrollWidth > node.clientWidth + 1; }),
                        fullRow: innerWidth >= 1200 || controls.every(node => node.getBoundingClientRect().top >= box.bottom),
                        touchTarget: summary.getBoundingClientRect().height >= 44,
                        overflow: document.documentElement.scrollWidth > innerWidth,
                      };
                    }""")
                    assert not errors, errors
                    assert not metrics["overlap"] and not metrics["contentOutside"], (
                        language,
                        width,
                        expanded,
                        metrics,
                    )
                    assert (
                        metrics["fullRow"]
                        and metrics["touchTarget"]
                        and not metrics["overflow"]
                    ), metrics
                    results.append(
                        {
                            "language": language,
                            "width": width,
                            "expanded": expanded,
                            **metrics,
                        }
                    )
                    if width in (320, 375):
                        page.locator(".sidebar").screenshot(
                            path=str(
                                OUTPUT
                                / f"{language}-{width}-{'open' if expanded else 'closed'}.png"
                            )
                        )
                # Native details must remain operable using the keyboard.
                page.locator(".task-reminders summary").focus()
                page.keyboard.press("Enter")
                assert not page.locator(".task-reminders").evaluate("node => node.open")
                if width == 320:
                    # Negative control: restore the old single-cell placement.
                    # This must violate the row separation checked above.
                    page.locator(".task-reminders").evaluate(
                        "node => { node.style.gridColumn = 'auto'; }"
                    )
                    assert page.evaluate("""() => document.querySelector('.nav-group--primary > button')
                        .getBoundingClientRect().top < document.querySelector('.task-reminders').getBoundingClientRect().bottom""")
                context.close()
        browser.close()
    (OUTPUT / "results.json").write_text(
        json.dumps(results, indent=2), encoding="utf-8"
    )
    print(
        f"Passed {len(results)} geometry cases, 14 keyboard checks and 2 negative controls; evidence: {OUTPUT}"
    )


if __name__ == "__main__":
    run()
