// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminRequests, CorrectionRequestButton, MyRequests } from "../src/pages/corrections";

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const selectValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
const inputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
const textareaValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;

async function mount(node: ReactNode) {
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  await act(async () => {
    root.render(node);
    await tick();
  });
  return { element, root };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});

describe("correction request edge states", () => {
  it("keeps another member's request private and explains offline and server failures", async () => {
    localStorage.setItem(
      "chronofish.auth_user",
      JSON.stringify({ id: "member-1", email: "member@ku.th", role: "member" }),
    );
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/markers")) return json({ fields: ["notes"], ownFields: [] });
      if (init?.method === "POST") return json({ error: { message: "Duplicate request" } }, 409);
      return json({ items: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { element, root } = await mount(
      <CorrectionRequestButton table="experiment_batch" item={{ id: "batch-1", notes: "old" }} language="en" />,
    );
    await act(async () => {
      element.querySelector("button")?.click();
      await tick();
    });
    const form = element.querySelector("form") as HTMLFormElement;
    const field = form.querySelector("select") as HTMLSelectElement;
    await act(async () => {
      selectValue?.call(field, "notes");
      field.dispatchEvent(new Event("change", { bubbles: true }));
      await tick();
    });
    expect(form.textContent).toContain("Another member has a pending request");
    const value = form.querySelector("input") as HTMLInputElement;
    const reason = form.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => {
      inputValue?.call(value, "new");
      value.dispatchEvent(new Event("input", { bubbles: true }));
      textareaValue?.call(reason, "paper");
      reason.dispatchEvent(new Event("input", { bubbles: true }));
    });
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    await act(async () => {
      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
      await tick();
    });
    expect(element.textContent).toContain("Connect to the internet");
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    await act(async () => {
      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
      await tick();
    });
    expect(element.textContent).toContain("Duplicate request");
    await act(async () => root.unmount());
  });

  it("converts typed proposals and describes boolean values in Thai", async () => {
    localStorage.setItem(
      "chronofish.auth_user",
      JSON.stringify({ id: "member-1", email: "member@ku.th", role: "member" }),
    );
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes("/markers")
        ? json({ fields: [], ownFields: [] })
        : init?.method === "POST"
          ? json({ id: "request-1" })
          : json({ items: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { element, root } = await mount(
      <>
        <CorrectionRequestButton
          table="injection_lot"
          item={{ id: "lot-1", enuPowerPct: 20, enuStartAt: "2026-10-05T08:00:00Z" }}
          language="en"
        />
        <CorrectionRequestButton table="clone_fish" item={{ id: "fish-1", finClipped: false }} language="th" />
      </>,
    );
    const first = element.querySelectorAll(".correction-entry")[0] as HTMLElement;
    await act(async () => {
      first.querySelector("button")?.click();
      await tick();
    });
    const field = first.querySelector("select") as HTMLSelectElement;
    await act(async () => {
      selectValue?.call(field, "enuPowerPct");
      field.dispatchEvent(new Event("change", { bubbles: true }));
      await tick();
    });
    expect((first.querySelector("input") as HTMLInputElement).type).toBe("number");
    await act(async () => {
      selectValue?.call(field, "enuStartAt");
      field.dispatchEvent(new Event("change", { bubbles: true }));
      await tick();
    });
    const value = first.querySelector("input") as HTMLInputElement;
    expect(value.type).toBe("datetime-local");
    const reason = first.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => {
      inputValue?.call(value, "2026-10-05T09:00");
      value.dispatchEvent(new Event("input", { bubbles: true }));
      textareaValue?.call(reason, "paper time");
      reason.dispatchEvent(new Event("input", { bubbles: true }));
      first.querySelector("form")?.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
      await tick();
    });
    const sent = fetchMock.mock.calls.find(
      ([input, init]) => String(input).endsWith("/corrections") && init?.method === "POST",
    );
    expect(JSON.parse(String(sent?.[1]?.body)).proposedValue).toContain("2026-10-05T");
    await act(async () => {
      first.querySelector("button")?.click();
      await tick();
    });
    const numberField = first.querySelector("select") as HTMLSelectElement;
    await act(async () => {
      selectValue?.call(numberField, "enuPowerPct");
      numberField.dispatchEvent(new Event("change", { bubbles: true }));
      await tick();
    });
    const number = first.querySelector("input") as HTMLInputElement;
    const numberReason = first.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => {
      inputValue?.call(number, "42");
      number.dispatchEvent(new Event("input", { bubbles: true }));
      textareaValue?.call(numberReason, "meter reading");
      numberReason.dispatchEvent(new Event("input", { bubbles: true }));
      first.querySelector("form")?.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
      await tick();
    });
    const numericPost = fetchMock.mock.calls.filter(
      ([input, init]) => String(input).endsWith("/corrections") && init?.method === "POST",
    )[1];
    expect(JSON.parse(String(numericPost?.[1]?.body)).proposedValue).toBe(42);
    const second = element.querySelectorAll(".correction-entry")[1] as HTMLElement;
    await act(async () => {
      second.querySelector("button")?.click();
      await tick();
    });
    const secondField = second.querySelector("select") as HTMLSelectElement;
    await act(async () => {
      selectValue?.call(secondField, "finClipped");
      secondField.dispatchEvent(new Event("change", { bubbles: true }));
      await tick();
    });
    expect(second.textContent).toContain("ค่าเดิม: ไม่ใช่");
    expect((second.querySelectorAll("select")[1] as HTMLSelectElement).value).toBe("false");
    const booleanReason = second.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => {
      textareaValue?.call(booleanReason, "not clipped");
      booleanReason.dispatchEvent(new Event("input", { bubbles: true }));
      second.querySelector("form")?.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
      await tick();
    });
    const booleanPost = fetchMock.mock.calls.filter(
      ([input, init]) => String(input).endsWith("/corrections") && init?.method === "POST",
    )[2];
    expect(JSON.parse(String(booleanPost?.[1]?.body)).proposedValue).toBe(false);
    await act(async () => root.unmount());
  });

  it("shows recorder notifications without exposing the requester and hides request controls from admins", async () => {
    const row = {
      id: "request-1",
      targetTable: "clone_fish",
      targetId: "fish-1",
      targetLabel: "F-1",
      fieldName: "sex",
      oldValue: "UNKNOWN",
      proposedValue: "F",
      status: "approved",
      notificationOnly: true,
      reason: "",
      decisionReason: "reviewed",
      createdAt: "2026-10-05T00:00:00Z",
      updatedAt: "2026-10-05T00:00:00Z",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ items: [row] })),
    );
    const { element, root } = await mount(
      <>
        <MyRequests language="th" />
        <CorrectionRequestButton table="clone_fish" item={{ id: "fish-1" }} language="th" />
      </>,
    );
    expect(element.textContent).toContain("ข้อมูลที่คุณบันทึกไว้ได้รับการแก้ไข");
    expect(element.textContent).toContain("เพศเมีย");
    expect(element.textContent).not.toContain("ขอแก้ไขข้อมูล");
    await act(async () => root.unmount());
  });

  it("keeps administrator errors visible and offers all request statuses", async () => {
    const row = {
      id: "request-1",
      requesterId: "member-1",
      requesterEmail: "member@ku.th",
      targetTable: "experiment_batch",
      targetId: "batch-1",
      targetLabel: "B-1",
      fieldName: "notes",
      oldValue: "old",
      proposedValue: "new",
      reason: "paper record",
      status: "pending",
      createdAt: "2026-10-05T00:00:00Z",
      updatedAt: "2026-10-05T00:00:00Z",
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/corrections/request-1")
        ? json({ error: { message: "Review unavailable" } }, 503)
        : json({ items: [row] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { element, root } = await mount(<AdminRequests language="en" />);
    await act(async () => {
      Array.from(element.querySelectorAll("button"))
        .find((button) => button.textContent === "Review before decision")
        ?.click();
      await tick();
    });
    expect(element.textContent).toContain("Review unavailable");
    const filter = element.querySelector("select") as HTMLSelectElement;
    await act(async () => {
      selectValue?.call(filter, "rejected");
      filter.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(element.textContent).toContain("No requests in this status");
    await act(async () => {
      selectValue?.call(filter, "all");
      filter.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(element.textContent).toContain("B-1");
    await act(async () => root.unmount());

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ error: { message: "List unavailable" } }, 503)),
    );
    const failed = await mount(<AdminRequests language="th" />);
    expect(failed.element.textContent).toContain("List unavailable");
    expect(failed.element.textContent).toContain("ไม่มีคำร้องในสถานะนี้");
    await act(async () => failed.root.unmount());
  });

  it("does not approve without confirmation and reports a stale approval response", async () => {
    const row = {
      id: "request-2",
      requesterId: "member-1",
      requesterEmail: "member@ku.th",
      targetTable: "experiment_batch",
      targetId: "batch-2",
      targetLabel: "B-2",
      fieldName: "notes",
      oldValue: "old",
      proposedValue: "new",
      reason: "paper record",
      status: "pending",
      createdAt: "2026-10-05T00:00:00Z",
      updatedAt: "2026-10-05T00:00:00Z",
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith("/decide") && init?.method === "POST"
        ? json({ error: { message: "Source changed during review" } }, 409)
        : String(input).endsWith("/corrections/request-2")
          ? json(row)
          : json({ items: [row] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    vi.stubGlobal("confirm", confirm);
    const { element, root } = await mount(<AdminRequests language="en" />);
    await act(async () => {
      Array.from(element.querySelectorAll("button"))
        .find((button) => button.textContent === "Review before decision")
        ?.click();
      await tick();
    });
    const approve = () =>
      Array.from(element.querySelectorAll("button")).find((button) => button.textContent === "Approve and apply");
    await act(async () => {
      approve()?.click();
      await tick();
    });
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    await act(async () => {
      approve()?.click();
      await tick();
    });
    expect(element.textContent).toContain("Source changed during review");
    await act(async () => root.unmount());
  });
});
