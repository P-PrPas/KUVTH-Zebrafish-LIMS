// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { GuestDashboard } from "../src/pages/guest-dashboard";
import { Login } from "../src/pages/login";
import { Members } from "../src/pages/members";

const guest = { id: "01900000-0000-7000-8000-000000000001", email: "guest@ku.th", role: "guest" };
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.setItem("chronofish.language", "en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  container.remove();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

async function input(id: string, value: string) {
  const element = container.querySelector<HTMLInputElement>(`#${id}`);
  expect(element).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(element, value);
    element?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(label: string) {
  const button = Array.from(container.querySelectorAll("button")).find((item) => item.textContent?.trim() === label);
  expect(button).toBeDefined();
  await act(async () => button?.click());
}
async function submit() {
  await act(async () =>
    container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe("KU authentication", () => {
  it.each(["th", "en"])("shows pending sign-in and retains input after a failure in %s", async (language) => {
    localStorage.setItem("chronofish.language", language);
    let rejectRequest: (cause: Error) => void = () => undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((_resolve, reject) => {
            rejectRequest = reject;
          }),
      ),
    );
    await act(async () => root.render(<Login onLogin={vi.fn()} />));
    await input("login-email", guest.email);
    await input("login-password", "password-for-test");
    await submit();
    expect(container.querySelector<HTMLButtonElement>(".auth-submit")?.disabled).toBe(true);
    expect(container.querySelector(".auth-submit")?.textContent).toBe(
      language === "th" ? "กำลังดำเนินการ…" : "Please wait…",
    );
    await act(async () => rejectRequest(new Error("Server unavailable")));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Server unavailable");
    expect(container.querySelector<HTMLInputElement>("#login-email")?.value).toBe(guest.email);
    expect(container.querySelector<HTMLButtonElement>(".auth-submit")?.disabled).toBe(false);
  });

  it("keeps guest metrics and account actions readable when switching languages", async () => {
    localStorage.removeItem("chronofish.language");
    const logout = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          response({ nBatches: 8, nActivated: 192, nPromoted: 124, nFish: 124, nAlive: 112, nDead: 12 }),
        ),
    );
    await act(async () => root.render(<GuestDashboard user={{ ...guest, role: "guest" }} onLogout={logout} />));
    expect(container.querySelectorAll(".metric")).toHaveLength(6);
    expect(container.querySelector(".metric strong")?.textContent).toBe("8");
    expect(container.querySelector(".auth-shell--guest")).not.toBeNull();
    await click("EN");
    expect(container.querySelector("#guest-title")?.textContent).toBe("Research overview");
    expect(container.querySelectorAll(".metric")).toHaveLength(6);
    const refresh = vi.fn();
    window.addEventListener("chronofish:auth-refresh", refresh);
    try {
      await click("Refresh access");
      expect(refresh).toHaveBeenCalledOnce();
      await click("ไทย");
      expect(document.documentElement.lang).toBe("th");
      await click("ออกจากระบบ");
      expect(logout).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener("chronofish:auth-refresh", refresh);
    }
  });

  it("shows a guest data failure without hiding the account recovery actions", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network unavailable")));
    await act(async () => root.render(<GuestDashboard user={{ ...guest, role: "guest" }} onLogout={vi.fn()} />));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Network unavailable");
    expect(container.querySelectorAll(".auth-actions button")).toHaveLength(2);
    expect(container.querySelector(".metric-grid")).toBeNull();
  });

  it.each(["th", "en"])("keeps the redesigned password and verification forms usable in %s", async (language) => {
    vi.useFakeTimers();
    const th = language === "th";
    localStorage.setItem("chronofish.language", language);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ status: "sent" })));
    await act(async () => root.render(<Login onLogin={vi.fn()} />));
    expect(container.querySelector(".auth-intro")?.getAttribute("aria-labelledby")).toBe("auth-intro-title");
    expect(container.querySelector("#login-title")?.textContent).toBe(
      th ? "เข้าสู่ระบบห้องปฏิบัติการ" : "Sign in to your lab",
    );
    await click(th ? "ลืมรหัสผ่าน / บัญชีเดิมยังไม่มีรหัสผ่าน" : "Forgot password / Set your first password");
    expect(container.querySelector("#login-title")?.textContent).toBe(
      th ? "ตั้งหรือรีเซ็ตรหัสผ่าน" : "Set or reset your password",
    );
    await input("login-email", guest.email);
    await input("login-password", "password-for-test");
    await input("confirm-password", "different-password");
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      th ? "รหัสผ่านทั้งสองช่องไม่ตรงกัน" : "Passwords do not match.",
    );
    await input("confirm-password", "password-for-test");
    await submit();
    expect(container.querySelector("#login-code")?.getAttribute("autoComplete")).toBe("one-time-code");
    expect(container.querySelector(".auth-recipient")?.textContent).toContain(guest.email);
    expect(container.querySelector(".auth-submit")?.textContent).toBe(th ? "ยืนยันและเข้าสู่ระบบ" : "Verify and sign in");
    expect(container.querySelector<HTMLButtonElement>(".auth-form .text-button")?.disabled).toBe(true);
    for (let second = 0; second < 60; second += 1) {
      await act(async () => vi.advanceTimersByTime(1_000));
    }
    expect(container.querySelector<HTMLButtonElement>(".auth-form .text-button")?.disabled).toBe(false);
    await click(th ? "ส่งรหัสอีกครั้ง" : "Resend code");
    expect(container.querySelector<HTMLButtonElement>(".auth-form .text-button")?.disabled).toBe(true);
    await click(th ? "กลับไปเข้าสู่ระบบ" : "Back to sign in");
    await click(th ? "สมัครบัญชีใหม่" : "Create an account");
    expect(container.querySelector("#login-title")?.textContent).toBe(th ? "สมัครบัญชีใหม่" : "Create an account");
    expect(container.querySelector<HTMLInputElement>("#login-password")?.value).toBe("");
    await click(th ? "EN" : "ไทย");
    expect(document.documentElement.lang).toBe(th ? "en" : "th");
  });

  it("signs in with a password without requesting an email code", async () => {
    const fetch = vi.fn().mockResolvedValue(response({ user: guest }));
    vi.stubGlobal("fetch", fetch);
    const onLogin = vi.fn();
    await act(async () => root.render(<Login onLogin={onLogin} />));
    await input("login-email", "guest@ku.th");
    await input("login-password", "correct horse battery staple");
    await submit();
    expect(fetch).toHaveBeenCalledWith("/api/v1/auth/login", expect.objectContaining({ credentials: "include" }));
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      email: guest.email,
      password: "correct horse battery staple",
    });
    expect(onLogin).toHaveBeenCalledWith(guest);
    expect(localStorage.getItem("chronofish.auth_user")).not.toContain("password");
  });

  it("checks password confirmation and verifies email before finishing registration", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ status: "sent" }))
      .mockResolvedValueOnce(response({ user: guest }));
    vi.stubGlobal("fetch", fetch);
    const onLogin = vi.fn();
    await act(async () => root.render(<Login onLogin={onLogin} />));
    await click("Create an account");
    expect(container.querySelector<HTMLInputElement>("#login-password")?.minLength).toBe(8);
    expect(container.querySelector<HTMLInputElement>("#confirm-password")?.minLength).toBe(8);
    expect(container.querySelector("#password-help")?.textContent).toBe("At least 8 characters.");
    await input("login-email", guest.email);
    await input("login-password", "correct horse battery staple");
    await input("confirm-password", "different password");
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Passwords do not match");
    expect(fetch).not.toHaveBeenCalled();
    await input("confirm-password", "correct horse battery staple");
    await submit();
    expect(fetch.mock.calls[0][0]).toBe("/api/v1/auth/register");
    expect(onLogin).not.toHaveBeenCalled();
    await input("login-code", "123456");
    await submit();
    expect(fetch.mock.calls[1][0]).toBe("/api/v1/auth/verify-code");
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
      email: guest.email,
      password: "correct horse battery staple",
      code: "123456",
    });
    expect(onLogin).toHaveBeenCalledWith(guest);
  });

  it("renders only the central dashboard for a guest even with a restricted URL", async () => {
    window.history.replaceState(null, "", "/?operatorId=secret#members");
    localStorage.setItem("chronofish.auth_user", JSON.stringify(guest));
    const fetch = vi.fn(async (url: string) =>
      response(url.endsWith("/auth/me") ? { user: guest } : { nBatches: 3, nAlive: 2 }),
    );
    vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(<App />));
    expect(container.textContent).toContain("Research overview");
    expect(container.textContent).toContain("Contact an admin");
    expect(container.querySelector("nav")).toBeNull();
    expect(container.querySelector("#operator-select")).toBeNull();
    expect(fetch.mock.calls.map(([url]) => url).sort()).toEqual(
      ["/api/v1/analytics/guest-dashboard", "/api/v1/auth/me"].sort(),
    );
    expect(window.location.hash).toBe("#dashboard");
    expect(window.location.search).toBe("");
    await click("Refresh access");
    expect(fetch.mock.calls.filter(([url]) => url.endsWith("/auth/me"))).toHaveLength(2);
  });

  it("lets an admin grant member access to a registered guest", async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return response({ user: { ...guest, role: "member" } });
      if (url.endsWith("/auth/admin/users"))
        return response({ items: [{ ...guest, active: true, verifiedAt: "2026-10-11T00:00:00Z", syncDevices: [] }] });
      if (url.endsWith("mail-settings")) return response({ senderEmail: "lab@ku.th", smtpConfigured: true });
      return response({ items: [] });
    });
    vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(<Members language="en" />));
    expect(container.textContent).toContain("Invite a member");
    const access = container.querySelector<HTMLDetailsElement>(".member-access")!;
    expect(access.open).toBe(false);
    expect(container.querySelector(".member-card__identity")?.textContent).toContain("guest");
    await act(async () => {
      access.open = true;
    });
    const select = container.querySelector<HTMLSelectElement>(".member-fields select");
    expect(select?.value).toBe("guest");
    await act(async () => {
      if (select) select.value = "member";
      select?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.querySelector(".member-access__unsaved")?.textContent).toBe("Unsaved changes");
    await click("Save access");
    const call = fetch.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(call?.[0]).toBe(`/api/v1/auth/admin/users/${guest.id}`);
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ role: "member", operatorId: null });
    expect(container.querySelector(".member-toast--success")?.textContent).toContain("Access saved.");
    expect(container.querySelector(".member-toast-region")?.getAttribute("aria-live")).toBe("polite");
    await click("×");
    expect(container.querySelector(".member-toast")).toBeNull();
  });

  it("separates inactive accounts, moves disabled accounts, and shows red and green toasts", async () => {
    const accounts = [
      { ...guest, active: true, verifiedAt: "2026-10-11T00:00:00Z", syncDevices: [] },
      { ...guest, id: "01900000-0000-7000-8000-000000000002", email: "disabled@ku.th", active: false, syncDevices: [] },
    ];
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        const changes = JSON.parse(String(init.body));
        const account = accounts.find((item) => url.endsWith(item.id));
        if (account) account.active = changes.active;
        return response({ user: account });
      }
      if (url.endsWith("/auth/admin/users")) return response({ items: accounts });
      if (url.endsWith("mail-settings")) return response({ senderEmail: "lab@ku.th", smtpConfigured: true });
      return response({ items: [] });
    });
    vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(<Members language="en" />));
    const panel = () => container.querySelector('[role="tabpanel"]');
    expect(panel()?.textContent).toContain(guest.email);
    expect(panel()?.textContent).not.toContain("disabled@ku.th");
    await click("Inactive");
    expect(panel()?.textContent).toContain("disabled@ku.th");
    expect(panel()?.textContent).not.toContain(guest.email);
    await click("Active");
    await click("Disable account");
    expect(container.querySelector<HTMLButtonElement>(".deactivate-confirm .button--primary")?.disabled).toBe(true);
    await act(async () => container.querySelector<HTMLInputElement>(".acknowledge-risk input")?.click());
    await click("Confirm disable");
    expect(container.querySelector(".member-toast--danger")?.textContent).toContain("Account disabled.");
    expect(panel()?.textContent).not.toContain(guest.email);
    expect(panel()?.textContent).toContain("No accounts in this list.");
    await click("Inactive");
    expect(panel()?.textContent).toContain(guest.email);
    const card = Array.from(container.querySelectorAll(".member-card")).find((item) =>
      item.textContent?.includes(guest.email),
    );
    await act(async () => card?.querySelector<HTMLButtonElement>(".member-card__actions button")?.click());
    expect(container.querySelector(".member-toast--success")?.textContent).toContain("Account reactivated.");
    expect(panel()?.textContent).not.toContain(guest.email);
    await click("Active");
    expect(panel()?.textContent).toContain(guest.email);
    expect(panel()?.textContent).not.toContain("disabled@ku.th");
    expect(
      fetch.mock.calls.filter(([, init]) => init?.method === "PATCH").map(([, init]) => JSON.parse(String(init?.body))),
    ).toEqual([{ active: false, acknowledgePendingDataRisk: true }, { active: true }]);
  });

  it("shows a failed disable as a red toast and keeps the account active", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "PATCH")
          return new Response(JSON.stringify({ error: { message: "Pending offline work" } }), { status: 409 });
        if (url.endsWith("/auth/admin/users"))
          return response({ items: [{ ...guest, active: true, syncDevices: [] }] });
        if (url.endsWith("mail-settings")) return response({ senderEmail: "lab@ku.th", smtpConfigured: true });
        return response({ items: [] });
      }),
    );
    await act(async () => root.render(<Members language="en" />));
    await click("Disable account");
    await act(async () => container.querySelector<HTMLInputElement>(".acknowledge-risk input")?.click());
    await click("Confirm disable");
    expect(container.querySelector(".member-toast--danger")?.textContent).toContain("Pending offline work");
    expect(container.querySelector(".member-toast-region")?.getAttribute("aria-live")).toBe("assertive");
    expect(container.querySelector('[role="tabpanel"]')?.textContent).toContain(guest.email);
  });

  it("supports keyboard tabs and pauses toast dismissal while focused", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "PATCH") return response({ user: guest });
        if (url.endsWith("/auth/admin/users"))
          return response({ items: [{ ...guest, active: true, syncDevices: [] }] });
        if (url.endsWith("mail-settings")) return response({ senderEmail: "lab@ku.th", smtpConfigured: true });
        return response({ items: [] });
      }),
    );
    await act(async () => root.render(<Members language="en" />));
    await act(async () =>
      container
        .querySelector("#members-tab-active")
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
    );
    expect(container.querySelector("#members-tab-inactive")?.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement?.id).toBe("members-tab-inactive");
    await act(async () =>
      container
        .querySelector("#members-tab-inactive")
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })),
    );
    vi.useFakeTimers();
    try {
      await act(async () => {
        container.querySelector<HTMLDetailsElement>(".member-access")!.open = true;
      });
      await click("Save access");
      await act(async () => container.querySelector<HTMLButtonElement>(".member-toast button")?.focus());
      await act(async () => vi.advanceTimersByTime(6_000));
      expect(container.querySelector(".member-toast")).not.toBeNull();
      await act(async () => container.querySelector<HTMLButtonElement>(".member-toast button")?.blur());
      await act(async () => vi.advanceTimersByTime(5_000));
      expect(container.querySelector(".member-toast")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
