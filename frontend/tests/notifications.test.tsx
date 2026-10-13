// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorMessage } from "../src/components";
import { notify } from "../src/notifications";
import { drainQueue, putQueue, queueCount, rejectedQueueCount } from "../src/offline";
import { ActionToasts } from "../src/toast";
import { renderPage, withoutIndexedDB } from "./helpers";

let view: Awaited<ReturnType<typeof renderPage>>;
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

beforeEach(async () => {
  document.documentElement.lang = "en";
  sessionStorage.setItem("chronofish.operator_id", "operator-1");
  view = await renderPage(<ActionToasts />);
});
afterEach(async () => {
  await view.unmount();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("action feedback", () => {
  it("does not treat legacy success banners as failed actions", async () => {
    await act(async () => {
      notify("Experiment saved.");
    });
    await act(async () => {
      view.root.render(
        <>
          <ActionToasts />
          <ErrorMessage message="Batch updated" />
        </>,
      );
    });
    expect(view.element.querySelector(".member-toast--danger")).toBeNull();
    expect(view.element.querySelector(".member-toast--success")?.textContent).toContain("Experiment saved.");
    await act(async () => {
      view.root.render(
        <>
          <ActionToasts />
          <ErrorMessage message="Correction reason is required" toast />
        </>,
      );
    });
    expect(view.element.querySelector(".member-toast--danger")?.textContent).toContain("Correction reason is required");
  });
  it("shows waiting feedback until the server confirms a durable embryo write", async () => {
    let respond: (value: Response) => void = () => {};
    const fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          respond = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetch);
    await act(async () => {
      await putQueue("/observations/embryo", { observations: [{ embryoId: "e-1" }] });
    });
    expect(view.element.querySelector(".member-toast--warning")?.textContent).toContain("waiting to sync");
    expect(view.element.querySelector(".member-toast--success")).toBeNull();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    await act(async () => {
      respond(json({ results: [{ id: "o-1", status: "created" }] }));
      await drainQueue(true);
    });
    expect(view.element.querySelector(".member-toast--success")?.textContent).toContain(
      "Embryo observations saved successfully",
    );
    expect(await queueCount()).toBe(0);
  });

  it("keeps offline work on device, then shows rejection instead of success when syncing fails", async () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const fetch = vi.fn(async () => json({ error: { message: "Observation is locked" } }, 409));
    vi.stubGlobal("fetch", fetch);
    await act(async () => {
      await putQueue("/observations/embryo", { observations: [{ embryoId: "e-2" }] });
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(view.element.querySelector(".member-toast--warning")?.textContent).toContain("saved on this device");
    online.mockReturnValue(true);
    await act(async () => {
      await drainQueue(true);
    });
    expect(view.element.querySelector(".member-toast--danger")?.textContent).toContain("Observation is locked");
    expect(view.element.querySelector(".member-toast-region")?.getAttribute("aria-live")).toBe("assertive");
    expect(await rejectedQueueCount()).toBe(1);
  });

  it("reports a server outage while retaining work for retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ error: { message: "Unavailable" } }, 503)),
    );
    await act(async () => {
      await putQueue("/fish", { fishCode: "F-1" });
      await drainQueue(true);
    });
    expect(view.element.querySelector(".member-toast--warning")?.textContent).toContain("will retry");
    expect(await queueCount()).toBe(1);
  });

  it.each([false, true])("reports partial HTTP 200 rejection without a green success (queue=%s)", async (queued) => {
    if (!queued) withoutIndexedDB();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          results: [
            { id: "o-1", status: "created" },
            { status: "rejected", error: { message: "Stage invalid" } },
          ],
        }),
      ),
    );
    await act(async () => {
      await putQueue("/observations/embryo", { observations: [{ embryoId: "e-3" }, { embryoId: "e-4" }] });
      await drainQueue(true);
    });
    expect(view.element.querySelector(".member-toast--danger")?.textContent).toContain("1 item(s)");
    expect(view.element.querySelector(".member-toast--danger")?.textContent).toContain("Stage invalid");
    expect(view.element.querySelector(".member-toast--success")).toBeNull();
  });

  it("keeps a bulk failure visible when another item succeeds, and shows authentication or retry state", async () => {
    const emit = (type: string, detail?: unknown) =>
      act(async () => {
        window.dispatchEvent(new CustomEvent(type, { detail }));
      });
    await emit("chronofish:queue-enqueued");
    expect(view.element.querySelector(".member-toast")).toBeNull();
    await emit("chronofish:queue-rejected", { path: "/fish", lastError: "Box is full" });
    await emit("chronofish:queue-drained", { path: "/fish", result: {} });
    expect(view.element.querySelector(".member-toast--danger")?.textContent).toContain("Box is full");
    await act(async () => {
      view.element.querySelector<HTMLButtonElement>(".member-toast button")?.click();
    });
    await emit("chronofish:queue-auth-required", { path: "/fish" });
    expect(view.element.querySelector(".member-toast--warning")?.textContent).toContain("Sign in again");
  });

  it.each(["th", "en"])("covers creation, editing, removal and confirmation feedback in %s", async (language) => {
    document.documentElement.lang = language;
    for (const path of [
      "/batches",
      "/injection-lots/1/embryos",
      "/observations/fish",
      "/fish",
      "/fish/1",
      "/fish/1/specimens",
      "/batches/1/control-arm-counts",
      "/promotions",
      "/timing-profiles",
      "/sites",
      "/observations/embryo",
    ]) {
      await act(async () => {
        window.dispatchEvent(new CustomEvent("chronofish:queue-drained", { detail: { path, result: {} } }));
      });
      expect(view.element.querySelector(".member-toast--success")?.textContent).toContain(
        language === "th" ? "สำเร็จ" : "successfully",
      );
    }
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("chronofish:queue-drained", { detail: { path: "/fish/1", method: "DELETE", result: {} } }),
      );
    });
    expect(view.element.textContent).toContain(language === "th" ? "ยกเลิกรายการ" : "Record removal");
  });

  it("localizes guards and restarts dismissal for repeated actions while supporting focus pause", async () => {
    vi.useFakeTimers();
    document.documentElement.lang = "th";
    await act(async () => {
      notify("OPERATOR_REQUIRED", "danger");
    });
    expect(view.element.textContent).toContain("กรุณาเลือกผู้ปฏิบัติงาน");
    await act(async () => {
      notify("AUTHENTICATION_REQUIRED", "danger");
    });
    expect(view.element.textContent).toContain("กรุณาเข้าสู่ระบบ");
    await act(async () => {
      notify("Saved.");
    });
    await act(async () => {
      vi.advanceTimersByTime(4_000);
      notify("Saved.");
    });
    await act(async () => {
      vi.advanceTimersByTime(4_000);
    });
    expect(view.element.querySelector(".member-toast")).not.toBeNull();
    await act(async () => {
      view.element.querySelector<HTMLButtonElement>(".member-toast button")?.focus();
    });
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(view.element.querySelector(".member-toast")).not.toBeNull();
    await act(async () => {
      view.element.querySelector<HTMLButtonElement>(".member-toast button")?.blur();
    });
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    expect(view.element.querySelector(".member-toast")).toBeNull();
  });
});
