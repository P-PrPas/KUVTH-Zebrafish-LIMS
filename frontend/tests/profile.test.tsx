// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Profile } from "../src/pages/profile";
import { renderPage } from "./helpers";

const user = {
  id: "member-1",
  email: "member@ku.th",
  role: "member" as const,
  operatorId: "operator-1",
  sessionId: "session-1",
};
const operators = [
  { id: "operator-1", name: "Jan" },
  { id: "operator-2", name: "New researcher" },
];
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};
const row = {
  id: "request-1",
  requesterId: user.id,
  requesterEmail: user.email,
  targetTable: "auth_user",
  targetId: user.id,
  fieldName: "operatorId",
  oldValue: "operator-1",
  oldLabel: "Jan",
  proposedValue: "operator-2",
  proposedLabel: "New researcher",
  reason: "Changed lab",
  status: "pending",
  createdAt: "2026-10-12T08:00:00Z",
  updatedAt: "2026-10-12T08:00:00Z",
};
afterEach(() => {
  localStorage.clear();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("profile", () => {
  it("creates an operator request directly and keeps the draft across account refreshes", async () => {
    localStorage.setItem("chronofish.auth_user", JSON.stringify(user));
    let sent = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/corrections") && init?.method === "POST") {
        sent = true;
        return json(row);
      }
      if (path.endsWith("/corrections")) return json({ items: sent ? [row] : [] });
      if (path.includes("/markers")) return json({ fields: [], ownFields: [] });
      if (path.includes("/operators")) return json({ items: operators });
      return json({ items: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const view = await renderPage(<Profile user={user} operators={operators} language="en" onLogout={() => {}} />);
    await act(settle);
    await act(async () => {
      Array.from(view.element.querySelectorAll("button"))
        .find((button) => button.textContent === "Request an operator change")!
        .click();
      await settle();
    });
    const form = view.element.querySelector<HTMLFormElement>(".correction-form")!;
    await act(async () => {
      const select = form.querySelectorAll("select")[1];
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, "operator-2");
      select.dispatchEvent(new Event("change", { bubbles: true }));
      const reason = form.querySelector("textarea")!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(reason, "Changed lab");
      reason.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      view.root.render(<Profile user={{ ...user }} operators={operators} language="en" onLogout={() => {}} />);
      await settle();
    });
    expect(form.querySelectorAll("select")[1].value).toBe("operator-2");
    await act(async () => {
      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
      await settle();
    });
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(String(post[1]?.body))).toEqual({
      targetTable: "auth_user",
      targetId: user.id,
      fieldName: "operatorId",
      proposedValue: "operator-2",
      reason: "Changed lab",
    });
    expect(view.element.textContent).toContain("Pending");
    expect(view.element.querySelector(".correction-form")).toBeNull();
    await view.unmount();
  });

  it("shows a pending assignment and lets the member withdraw it without leaving profile", async () => {
    localStorage.setItem("chronofish.auth_user", JSON.stringify(user));
    let withdrawn = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        withdrawn = true;
        return json({ ...row, status: "withdrawn" });
      }
      return json({
        items: String(input).endsWith("/corrections") ? [{ ...row, status: withdrawn ? "withdrawn" : "pending" }] : [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const view = await renderPage(<Profile user={user} operators={operators} language="en" onLogout={() => {}} />);
    await act(settle);
    expect(view.element.textContent).toContain("New researcher");
    expect(view.element.textContent).not.toContain("Request an operator change");
    await act(async () => {
      Array.from(view.element.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Withdraw"))!
        .click();
      await settle();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/corrections/request-1/withdraw",
      expect.objectContaining({ method: "POST" }),
    );
    expect(view.element.textContent).toContain("Request an operator change");
    await view.unmount();
  });

  it("revokes only another active session and retains it when the server refuses", async () => {
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    let fail = true;
    let revoked = false;
    const sessions = [
      { id: "session-1", deviceId: "current", lastSeenAt: row.createdAt },
      { id: "session-2", deviceId: "other", lastSeenAt: row.createdAt },
      { id: "old", revokedAt: row.createdAt },
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        if (fail) return json({ error: { code: "conflict", message: "Cannot revoke now" } }, 409);
        revoked = true;
        return new Response(null, { status: 204 });
      }
      return json({
        items: String(input).endsWith("/auth/sessions")
          ? sessions.filter((session) => !revoked || session.id !== "session-2")
          : [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const view = await renderPage(
      <Profile user={{ ...user, role: "admin" }} operators={operators} language="en" onLogout={() => {}} />,
    );
    await act(settle);
    expect(view.element.querySelectorAll(".profile-sessions li")).toHaveLength(2);
    expect(view.element.querySelectorAll(".profile-sessions button")).toHaveLength(1);
    await act(async () => {
      view.element.querySelector<HTMLButtonElement>(".profile-sessions button")!.click();
      await settle();
    });
    expect(view.element.querySelectorAll(".profile-sessions li")).toHaveLength(2);
    expect(view.element.querySelector('[role="alert"]')).not.toBeNull();
    fail = false;
    await act(async () => {
      view.element.querySelector<HTMLButtonElement>(".profile-sessions button")!.click();
      await settle();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/auth/sessions/session-2",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(view.element.querySelectorAll(".profile-sessions li")).toHaveLength(1);
    await view.unmount();
  });
});
