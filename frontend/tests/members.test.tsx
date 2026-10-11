// @vitest-environment happy-dom
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { get, request } = vi.hoisted(() => ({ get: vi.fn(), request: vi.fn() }));
vi.mock("../src/api/client", () => ({ get, request }));

import { Members } from "../src/pages/members";
import { renderPage } from "./helpers";

const members = [
  {
    id: "member-1",
    email: "active@ku.th",
    role: "member",
    active: true,
    verifiedAt: "2026-01-01T00:00:00Z",
    syncDevices: [{ deviceId: "device-recent", pendingCount: 2, lastReportedAt: "2026-01-01T00:00:00Z", stale: false }],
  },
  {
    id: "member-2",
    email: "invited@ku.th",
    role: "member",
    active: true,
    verifiedAt: null,
    operatorId: "operator-1",
    syncDevices: [{ deviceId: "device-stale", pendingCount: 3, lastReportedAt: "2025-01-01T00:00:00Z", stale: true }],
  },
  { id: "member-3", email: "disabled@ku.th", role: "admin", active: false, syncDevices: [] },
  {
    id: "member-4",
    email: "unknown-sync@ku.th",
    role: "member",
    active: true,
    verifiedAt: "2026-01-01T00:00:00Z",
    syncDevices: [],
  },
];
const sessions = [
  { id: "session-1", deviceId: "ipad-1", createdAt: "2026-01-01T00:00:00Z", lastSeenAt: "2026-01-02T00:00:00Z" },
  {
    id: "session-2",
    deviceId: "ipad-2",
    createdAt: "2025-01-01T00:00:00Z",
    lastSeenAt: "2025-01-02T00:00:00Z",
    revokedAt: "2025-01-03T00:00:00Z",
  },
];

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function enterValue(input: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype,
      "value",
    );
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

async function click(button: HTMLButtonElement | null) {
  await act(async () => {
    button?.click();
    await Promise.resolve();
  });
  await settle();
}

function buttonIn(element: ParentNode, text: string): HTMLButtonElement | null {
  return Array.from(element.querySelectorAll("button")).find((button) => button.textContent?.trim() === text) ?? null;
}

function card(email: string): HTMLElement {
  const found = Array.from(document.querySelectorAll<HTMLElement>(".member-card")).find((item) =>
    item.textContent?.includes(email),
  );
  if (!found) throw new Error(`Missing member card: ${email}`);
  return found;
}

describe("admin member management", () => {
  it.each(["en", "th"] as const)("shows and clears a login lock in %s", async (language) => {
    get.mockImplementation((path: string) => {
      if (path === "/auth/admin/users") {
        return Promise.resolve({ items: [{ ...members[0], loginLockedUntil: "2026-11-01T00:00:00Z" }] });
      }
      return Promise.resolve({ items: [], senderEmail: "admin@ku.th", smtpConfigured: true });
    });
    const rendered = await renderPage(<Members language={language} />);
    await settle();
    expect(rendered.element.textContent).toContain(language === "en" ? "Sign-in locked until" : "ล็อกการเข้าสู่ระบบถึง");
    await click(buttonIn(rendered.element, language === "en" ? "Unlock account" : "ปลดล็อกบัญชี"));
    expect(request).toHaveBeenCalledWith("/auth/admin/users/member-1/unlock", { method: "POST", body: "{}" });
    expect(rendered.element.textContent).toContain(language === "en" ? "Account unlocked" : "ปลดล็อกบัญชีแล้ว");
    request.mockRejectedValueOnce(new Error("Unlock failed"));
    await click(buttonIn(rendered.element, language === "en" ? "Unlock account" : "ปลดล็อกบัญชี"));
    expect(rendered.element.querySelector('[role="alert"]')?.textContent).toContain("Unlock failed");
    await rendered.unmount();
  });
  beforeEach(() => {
    get.mockReset();
    request.mockReset().mockResolvedValue({ json: async () => ({ emailSent: true }) });
    get.mockImplementation((path: string) => {
      if (path === "/auth/admin/users") return Promise.resolve({ items: members });
      if (path === "/operators") return Promise.resolve({ items: [{ id: "operator-1", name: "Researcher One" }] });
      if (path === "/auth/admin/mail-settings") {
        return Promise.resolve({ senderEmail: "peerapas.c@ku.th", smtpConfigured: false });
      }
      if (path.endsWith("/sessions")) return Promise.resolve({ items: sessions });
      return Promise.reject(new Error(`Unexpected GET ${path}`));
    });
    document.body.innerHTML = "";
  });

  it("loads member states, pending-sync warnings, sender settings, and unconfigured SMTP notice", async () => {
    const rendered = await renderPage(<Members language="en" />);
    await settle();
    expect(rendered.element.textContent).toContain("Invitation pending");
    expect(rendered.element.textContent).toContain("A recently reported device still has pending work.");
    expect(card("active@ku.th").textContent).toContain("recent · 2 items");
    expect(rendered.element.textContent).toContain("No device has reported a sync status.");
    expect(rendered.element.textContent).toContain("Server SMTP is not configured.");
    expect(rendered.element.querySelector<HTMLInputElement>("#sender-email")?.value).toBe("peerapas.c@ku.th");
    await rendered.unmount();
  });

  it("invites a normalized address and saves the visible sender address", async () => {
    const rendered = await renderPage(<Members language="en" />);
    await settle();
    const invite = rendered.element.querySelector<HTMLInputElement>("#invite-email")!;
    await enterValue(invite, " New.Member@KU.TH ");
    await act(async () => {
      rendered.element
        .querySelector(".members-invite form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(request).toHaveBeenCalledWith("/auth/admin/users", {
      method: "POST",
      body: JSON.stringify({ email: "new.member@ku.th" }),
    });
    expect(rendered.element.querySelector<HTMLInputElement>("#invite-email")?.value).toBe("");
    expect(rendered.element.textContent).toContain("Invitation email sent.");

    await enterValue(rendered.element.querySelector<HTMLInputElement>("#sender-email")!, "lab@ku.th");
    await act(async () => {
      rendered.element
        .querySelector(".sender-settings form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(request).toHaveBeenLastCalledWith("/auth/admin/mail-settings", {
      method: "PATCH",
      body: JSON.stringify({ senderEmail: "lab@ku.th" }),
    });
    expect(rendered.element.textContent).toContain("Sender email saved.");
    await rendered.unmount();
  });

  it("shows resend guidance when the account was created but email failed", async () => {
    request.mockResolvedValueOnce({ json: async () => ({ emailSent: false }) });
    const rendered = await renderPage(<Members language="en" />);
    await settle();
    await enterValue(rendered.element.querySelector<HTMLInputElement>("#invite-email")!, "failed@ku.th");
    await act(async () => {
      rendered.element
        .querySelector(".members-invite form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(rendered.element.textContent).toContain("Use Resend invitation in the member list.");
    await rendered.unmount();
  });

  it("updates a member role and operator, and resends an unverified invitation", async () => {
    const rendered = await renderPage(<Members language="en" />);
    await settle();
    const invited = card("invited@ku.th");
    const selects = invited.querySelectorAll<HTMLSelectElement>("select");
    await enterValue(selects[0], "admin");
    await enterValue(selects[1], "");
    await click(buttonIn(invited, "Save access"));
    expect(request).toHaveBeenCalledWith("/auth/admin/users/member-2", {
      method: "PATCH",
      body: JSON.stringify({ role: "admin", operatorId: null }),
    });
    expect(rendered.element.textContent).toContain("Role and operator link saved.");

    await click(buttonIn(card("invited@ku.th"), "Resend invitation"));
    expect(request).toHaveBeenCalledWith("/auth/admin/users/member-2/invite", { method: "POST", body: "{}" });
    expect(rendered.element.textContent).toContain("Invitation resent to invited@ku.th.");
    await rendered.unmount();
  });

  it("blocks disabling for recent pending work and requires acknowledgement for stale sync state", async () => {
    const rendered = await renderPage(<Members language="en" />);
    await settle();
    const active = card("active@ku.th");
    await click(buttonIn(active, "Disable account"));
    const activeConfirm = active.querySelector<HTMLButtonElement>(".deactivate-confirm .button--primary")!;
    expect(activeConfirm.disabled).toBe(true);
    await click(buttonIn(active, "Cancel"));

    const invited = card("invited@ku.th");
    await click(buttonIn(invited, "Disable account"));
    const confirm = invited.querySelector<HTMLButtonElement>(".deactivate-confirm .button--primary")!;
    expect(confirm.disabled).toBe(true);
    expect(invited.querySelector<HTMLInputElement>(".acknowledge-risk input")).not.toBeNull();
    const checkbox = invited.querySelector<HTMLInputElement>(".acknowledge-risk input")!;
    await act(async () => {
      checkbox.click();
    });
    expect(confirm.disabled).toBe(false);
    await click(confirm);
    expect(request).toHaveBeenCalledWith("/auth/admin/users/member-2", {
      method: "PATCH",
      body: JSON.stringify({ active: false, acknowledgePendingDataRisk: true }),
    });
    expect(rendered.element.textContent).toContain("Account disabled and all sessions revoked.");
    await rendered.unmount();
  });

  it("requires explicit acknowledgement before disabling a member with no sync report", async () => {
    const rendered = await renderPage(<Members language="en" />);
    await settle();
    const unknown = card("unknown-sync@ku.th");
    await click(buttonIn(unknown, "Disable account"));
    const confirm = unknown.querySelector<HTMLButtonElement>(".deactivate-confirm .button--primary")!;
    expect(confirm.disabled).toBe(true);
    expect(unknown.querySelector(".acknowledge-risk")?.textContent).toContain("status is stale or unavailable");
    await act(async () => unknown.querySelector<HTMLInputElement>(".acknowledge-risk input")?.click());
    expect(confirm.disabled).toBe(false);
    await click(confirm);
    expect(request).toHaveBeenCalledWith("/auth/admin/users/member-4", {
      method: "PATCH",
      body: JSON.stringify({ active: false, acknowledgePendingDataRisk: true }),
    });
    await rendered.unmount();
  });

  it("loads and revokes sessions, then reactivates a disabled member", async () => {
    const rendered = await renderPage(<Members language="en" />);
    await settle();
    const active = card("active@ku.th");
    await act(async () => {
      const details = active.querySelector("details")!;
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(get).toHaveBeenCalledWith("/auth/admin/users/member-1/sessions");
    expect(active.querySelectorAll(".member-session")).toHaveLength(2);
    await click(buttonIn(active, "Revoke session"));
    expect(request).toHaveBeenCalledWith("/auth/admin/users/member-1/sessions/session-1", { method: "DELETE" });

    const inactive = card("disabled@ku.th");
    await click(buttonIn(inactive, "Reactivate"));
    expect(request).toHaveBeenCalledWith("/auth/admin/users/member-3", {
      method: "PATCH",
      body: JSON.stringify({ active: true }),
    });
    await rendered.unmount();
  });

  it("surfaces request errors and renders the Thai copy", async () => {
    request.mockRejectedValueOnce(new Error("Mail server unavailable"));
    const rendered = await renderPage(<Members language="th" />);
    await settle();
    const resend = buttonIn(card("invited@ku.th"), "ส่งคำเชิญอีกครั้ง");
    await click(resend);
    expect(rendered.element.querySelector('[role="alert"]')?.textContent).toBe("Mail server unavailable");
    expect(rendered.element.textContent).toContain("สมาชิกห้องปฏิบัติการ");
    expect(rendered.element.textContent).toContain("ยังไม่ได้ตั้งค่า SMTP ฝั่งเซิร์ฟเวอร์");
    await rendered.unmount();
  });
});
