// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { TaskReminders } from "../src/task-reminders";
import { renderPage } from "./helpers";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

it("counts unfinished daily work and links missing fields without extending the session", async () => {
  const fetch = vi.fn(
    async (input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify(
          String(input).includes("due-checkpoints")
            ? { overdue: [{}, {}] }
            : { items: [{ alreadyRecorded: true }, { alreadyRecorded: false }] },
        ),
      ),
  );
  vi.stubGlobal("fetch", fetch);
  const navigate = vi.fn();
  const field = document.createElement("input");
  field.id = "required-field";
  document.body.append(field);
  const page = await renderPage(
    <TaskReminders thai={false} fields={[{ id: field.id, label: "Protocol" }]} navigate={navigate} />,
  );
  expect(page.element.querySelector("summary strong")?.textContent).toBe("4");
  expect(
    fetch.mock.calls.every(
      ([, init]) =>
        (init as RequestInit)?.headers &&
        ((init as RequestInit).headers as Record<string, string>)["X-Session-Activity"] === "passive",
    ),
  ).toBe(true);
  const buttons = Array.from(page.element.querySelectorAll("button"));
  await act(async () => buttons.find((button) => button.textContent?.includes("Fish not checked"))?.click());
  expect(navigate).toHaveBeenCalledWith("fish");
  await act(async () => buttons.find((button) => button.textContent?.includes("Complete: Protocol"))?.click());
  expect(document.activeElement).toBe(field);
  await page.unmount();
});

it("does not announce completed work when task loading fails", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")));
  const page = await renderPage(<TaskReminders thai={false} fields={[]} navigate={vi.fn()} />);
  expect(page.element.textContent).toContain("Could not refresh tasks");
  expect(page.element.textContent).not.toContain("All currently due daily tasks are complete");
  await page.unmount();
});
