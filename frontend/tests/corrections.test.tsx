// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminHome, AdminRequests, CorrectionRequestButton, MyRequests } from "../src/pages/corrections";

const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
const settle = async () => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};
const setInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
const setSelect = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
const setTextarea = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("correction request interface", () => {
  it("submits a single proposed field as the signed-in member without an operator header", async () => {
    localStorage.setItem(
      "chronofish.auth_user",
      JSON.stringify({ id: "member-1", email: "member@ku.th", role: "member" }),
    );
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/corrections/markers")) return json({ fields: [], ownFields: [] });
      if (String(input).endsWith("/corrections") && init?.method === "POST") return json({ id: "request-1" });
      return json({ items: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const element = document.createElement("div");
    document.body.append(element);
    const root = createRoot(element);
    await act(async () => {
      root.render(
        <CorrectionRequestButton table="experiment_batch" item={{ id: "batch-1", notes: "old" }} language="en" />,
      );
      await settle();
    });
    await act(async () => {
      Array.from(element.querySelectorAll("button"))
        .find((button) => button.textContent === "Request correction")
        ?.click();
      await settle();
    });
    const form = element.querySelector("form") as HTMLFormElement;
    const fields = form.querySelector("select") as HTMLSelectElement;
    await act(async () => {
      setSelect?.call(fields, "notes");
      fields.dispatchEvent(new Event("change", { bubbles: true }));
      await settle();
    });
    const value = form.querySelector("input") as HTMLInputElement;
    const reason = form.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => {
      setInput?.call(value, "new value");
      value.dispatchEvent(new Event("input", { bubbles: true }));
      setTextarea?.call(reason, "paper record");
      reason.dispatchEvent(new Event("input", { bubbles: true }));
      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
      await settle();
    });
    const sent = fetchMock.mock.calls.find(
      ([input, init]) => String(input).endsWith("/corrections") && init?.method === "POST",
    );
    expect(JSON.parse(String(sent?.[1]?.body))).toMatchObject({
      fieldName: "notes",
      proposedValue: "new value",
      reason: "paper record",
    });
    expect(sent?.[1]?.headers).not.toHaveProperty("X-Operator-Id");
    expect(element.textContent).toContain("Request sent to administrators");
    await act(async () => root.unmount());
  });

  it("shows loading, then requires a detail review before administrator approval", async () => {
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
    let resolveList: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/corrections") && !init?.method)
        return new Promise<Response>((resolve) => {
          resolveList = resolve;
        });
      if (path.endsWith("/corrections/request-1")) return json(row);
      if (path.endsWith("/corrections/request-1/decide")) return json({ ...row, status: "approved" });
      return json({ items: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    const element = document.createElement("div");
    document.body.append(element);
    const root = createRoot(element);
    await act(async () => {
      root.render(<AdminRequests language="th" />);
      await Promise.resolve();
    });
    expect(element.textContent).toContain("กำลังโหลดคำร้อง");
    expect(element.textContent).not.toContain("ไม่มีคำร้องในสถานะนี้");
    await act(async () => {
      resolveList?.(json({ items: [row] }));
      await settle();
    });
    expect(element.textContent).toContain("การทดลอง: B-1");
    expect(element.textContent).toContain("รอพิจารณา");
    expect(element.textContent).not.toContain("อนุมัติและแก้ข้อมูล");
    await act(async () => {
      Array.from(element.querySelectorAll("button"))
        .find((button) => button.textContent === "ตรวจข้อมูลก่อนตัดสินใจ")
        ?.click();
      await settle();
    });
    expect(element.textContent).toContain("อนุมัติและแก้ข้อมูล");
    await act(async () => {
      Array.from(element.querySelectorAll("button"))
        .find((button) => button.textContent === "อนุมัติและแก้ข้อมูล")
        ?.click();
      await settle();
    });
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) => String(input).endsWith("/corrections/request-1/decide") && init?.method === "POST",
      ),
    ).toBe(true);
    await act(async () => root.unmount());
  });

  it("lets a member withdraw a pending own request", async () => {
    const row = {
      id: "request-2",
      requesterId: "member-1",
      requesterEmail: "member@ku.th",
      targetTable: "clone_fish",
      targetId: "fish-1",
      targetLabel: "F-1",
      fieldName: "sex",
      oldValue: "UNKNOWN",
      proposedValue: "F",
      reason: "checked",
      status: "pending",
      createdAt: "2026-10-05T00:00:00Z",
      updatedAt: "2026-10-05T00:00:00Z",
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/corrections") ? json({ items: [row] }) : json({ ...row, status: "withdrawn" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const element = document.createElement("div");
    document.body.append(element);
    const root = createRoot(element);
    await act(async () => {
      root.render(<MyRequests language="en" />);
      await settle();
    });
    await act(async () => {
      Array.from(element.querySelectorAll("button"))
        .find((button) => button.textContent === "Withdraw request")
        ?.click();
      await settle();
    });
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) => String(input).endsWith("/corrections/request-2/withdraw") && init?.method === "POST",
      ),
    ).toBe(true);
    await act(async () => root.unmount());
  });

  it("shows stale and invalid proposals and sends a mandatory rejection reason", async () => {
    const base = {
      requesterId: "member-1",
      requesterEmail: "member@ku.th",
      targetTable: "fish_observation",
      targetId: "observation-1",
      targetLabel: "F-1 / 2026-10-05",
      fieldName: "outcome",
      oldValue: "ALIVE",
      proposedValue: "DEAD",
      reason: "paper record",
      status: "pending",
      createdAt: "2026-10-05T00:00:00Z",
      updatedAt: "2026-10-05T00:00:00Z",
    };
    const rows = [
      { ...base, id: "stale-1", conflict: true, currentValue: "FROZEN", relatedAuditIds: ["audit-1"] },
      { ...base, id: "invalid-1", targetTable: "embryo_observation", validationMessage: "A later observation exists" },
      { ...base, id: "approved-1", status: "approved" },
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith("/decide") && init?.method === "POST" ? json(rows[0]) : json({ items: rows }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const element = document.createElement("div");
    document.body.append(element);
    const root = createRoot(element);
    await act(async () => {
      root.render(<AdminRequests language="en" />);
      await settle();
    });
    expect(element.textContent).toContain("The original record has changed");
    expect(element.textContent).toContain("A later observation exists");
    expect(element.querySelector('a[href*="auditLogId=audit-1"]')).not.toBeNull();
    const rejection = element.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => {
      setTextarea?.call(rejection, "source changed");
      rejection.dispatchEvent(new Event("input", { bubbles: true }));
      await settle();
    });
    await act(async () => {
      Array.from(element.querySelectorAll("button"))
        .find((button) => button.textContent === "Reject")
        ?.click();
      await settle();
    });
    const sent = fetchMock.mock.calls.find(
      ([input, init]) => String(input).endsWith("/stale-1/decide") && init?.method === "POST",
    );
    expect(JSON.parse(String(sent?.[1]?.body))).toEqual({ decision: "reject", reason: "source changed" });
    const filter = element.querySelector("select") as HTMLSelectElement;
    await act(async () => {
      setSelect?.call(filter, "approved");
      filter.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(element.textContent).toContain("Approved");
    expect(element.textContent).not.toContain("The original record has changed");
    await act(async () => root.unmount());
  });

  it("shows the empty Thai state and administrator dashboard links", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ items: [] })),
    );
    const first = document.createElement("div");
    document.body.append(first);
    const root = createRoot(first);
    await act(async () => {
      root.render(<MyRequests language="th" />);
      await settle();
    });
    expect(first.textContent).toContain("ยังไม่มีคำร้อง");
    await act(async () => root.unmount());
    const second = document.createElement("div");
    document.body.append(second);
    const adminRoot = createRoot(second);
    const onNavigate = vi.fn();
    await act(async () => {
      adminRoot.render(<AdminHome language="en" onNavigate={onNavigate} />);
      await settle();
    });
    expect(second.textContent).toContain("0 pending");
    await act(async () => {
      Array.from(second.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Members and invitations"))
        ?.click();
    });
    expect(onNavigate).toHaveBeenCalledWith("members");
    await act(async () => adminRoot.unmount());
    const third = document.createElement("div");
    document.body.append(third);
    const thaiRoot = createRoot(third);
    await act(async () => {
      thaiRoot.render(<AdminHome language="th" onNavigate={onNavigate} />);
      await settle();
    });
    expect(third.textContent).toContain("ดูแลระบบ");
    await act(async () => thaiRoot.unmount());
  });

  it("offers resource and boolean inputs in Thai while keeping pending-field details private", async () => {
    localStorage.setItem(
      "chronofish.auth_user",
      JSON.stringify({ id: "member-1", role: "member", email: "member@ku.th" }),
    );
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.includes("/corrections/markers")) return json({ fields: ["sex"], ownFields: ["sex"] });
      if (path.includes("/fish-boxes")) return json({ items: [{ id: "box-2", boxCode: "B-02" }] });
      if (init?.method === "POST") return json({ id: "request-3" });
      return json({ items: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const element = document.createElement("div");
    document.body.append(element);
    const root = createRoot(element);
    await act(async () => {
      root.render(
        <CorrectionRequestButton
          table="clone_fish"
          item={{ id: "fish-1", sex: "UNKNOWN", fishBoxId: null }}
          language="th"
        />,
      );
      await settle();
    });
    expect(element.textContent).toContain("มีคำร้องค้าง: เพศ");
    await act(async () => {
      element.querySelector("button")?.click();
      await settle();
    });
    const form = element.querySelector("form") as HTMLFormElement;
    const field = form.querySelector("select") as HTMLSelectElement;
    await act(async () => {
      setSelect?.call(field, "sex");
      field.dispatchEvent(new Event("change", { bubbles: true }));
      await settle();
    });
    expect(form.textContent).toContain("คุณมีคำร้องค้างสำหรับช่องนี้แล้ว");
    expect((form.querySelector("button") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      setSelect?.call(field, "fishBoxId");
      field.dispatchEvent(new Event("change", { bubbles: true }));
      await settle();
    });
    expect(form.textContent).toContain("B-02");
    const value = form.querySelectorAll("select")[1] as HTMLSelectElement;
    const reason = form.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => {
      setSelect?.call(value, "box-2");
      value.dispatchEvent(new Event("change", { bubbles: true }));
      setTextarea?.call(reason, "ย้ายตู้");
      reason.dispatchEvent(new Event("input", { bubbles: true }));
      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
      await settle();
    });
    const sent = fetchMock.mock.calls.find(
      ([input, init]) => String(input).endsWith("/corrections") && init?.method === "POST",
    );
    expect(JSON.parse(String(sent?.[1]?.body))).toMatchObject({ fieldName: "fishBoxId", proposedValue: "box-2" });
    await act(async () => root.unmount());
  });
});
