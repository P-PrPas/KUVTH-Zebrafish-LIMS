// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { deviceId, request } = vi.hoisted(() => ({ deviceId: vi.fn(() => "device-1"), request: vi.fn() }));
vi.mock("../src/api/client", () => ({ deviceId, request }));

import { Login } from "../src/pages/login";
import { renderPage } from "./helpers";

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

async function changeValue(selector: string, value: string, event = "input") {
  await act(async () => {
    const input = document.querySelector<HTMLInputElement>(selector);
    if (!input) throw new Error(`Missing input ${selector}`);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event(event, { bubbles: true }));
  });
}

async function submitForm() {
  await act(async () => {
    document.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe("email OTP login", () => {
  let onLogin: ReturnType<typeof vi.fn>;
  let unmount: (() => Promise<void>) | undefined;

  beforeEach(() => {
    request.mockReset();
    deviceId.mockClear();
    localStorage.clear();
    sessionStorage.clear();
    onLogin = vi.fn();
  });

  afterEach(async () => {
    await unmount?.();
    unmount = undefined;
    document.body.innerHTML = "";
  });

  it("requests a code for a normalized KU email and enforces a cooldown", async () => {
    request.mockResolvedValueOnce(jsonResponse({}));
    const rendered = await renderPage(<Login onLogin={onLogin} />);
    unmount = rendered.unmount;
    await changeValue("#login-email", " PEERAPAS.C@KU.TH ");
    await submitForm();
    expect(request).toHaveBeenCalledWith("/auth/request-code", {
      method: "POST",
      body: JSON.stringify({ email: "peerapas.c@ku.th" }),
    });
    expect(rendered.element.textContent).toContain("รหัสยืนยัน 6 หลัก");
    expect(rendered.element.textContent).toContain("ส่งรหัสอีกครั้งใน 60 วินาที");
    expect(rendered.element.querySelector<HTMLButtonElement>(".auth-actions button:last-child")?.disabled).toBe(true);
  });

  it("filters the code to six digits and signs in with the device id", async () => {
    request.mockResolvedValueOnce(jsonResponse({})).mockResolvedValueOnce(
      jsonResponse({
        user: { id: "user-1", email: "member@ku.th", role: "member", operatorId: "operator-1" },
      }),
    );
    const rendered = await renderPage(<Login onLogin={onLogin} />);
    unmount = rendered.unmount;
    await changeValue("#login-email", "member@ku.th");
    await submitForm();
    await changeValue("#login-code", "12a345678");
    expect(rendered.element.querySelector<HTMLInputElement>("#login-code")?.value).toBe("123456");
    await submitForm();
    expect(request).toHaveBeenLastCalledWith("/auth/verify-code", {
      method: "POST",
      headers: { "X-Device-Id": "device-1" },
      body: JSON.stringify({ email: "member@ku.th", code: "123456" }),
    });
    expect(onLogin).toHaveBeenCalledWith({
      id: "user-1",
      email: "member@ku.th",
      role: "member",
      operatorId: "operator-1",
    });
    expect(sessionStorage.getItem("chronofish.operator_id")).toBe("operator-1");
  });

  it.each([
    [429, "กรุณารอสักครู่ก่อนขอรหัสใหม่"],
    [503, "ระบบส่งอีเมลยังตั้งค่าไม่เสร็จ กรุณาติดต่อผู้ดูแลระบบ"],
    [500, "HTTP 500"],
  ])("shows the appropriate request-code error for HTTP %s", async (status, message) => {
    request.mockRejectedValueOnce(Object.assign(new Error(`HTTP ${status}`), { status }));
    const rendered = await renderPage(<Login onLogin={onLogin} />);
    unmount = rendered.unmount;
    await changeValue("#login-email", "member@ku.th");
    await submitForm();
    expect(rendered.element.querySelector('[role="alert"]')?.textContent).toBe(message);
  });

  it("shows an expired-code error and lets the user change email or switch language", async () => {
    request
      .mockResolvedValueOnce(jsonResponse({}))
      .mockRejectedValueOnce(Object.assign(new Error("invalid"), { status: 401 }));
    const rendered = await renderPage(<Login onLogin={onLogin} />);
    unmount = rendered.unmount;
    await changeValue("#login-email", "member@ku.th");
    await submitForm();
    await changeValue("#login-code", "123456");
    await submitForm();
    expect(rendered.element.querySelector('[role="alert"]')?.textContent).toContain("รหัสไม่ถูกต้องหรือหมดอายุ");
    await act(async () => rendered.element.querySelector<HTMLButtonElement>(".auth-actions button")?.click());
    expect(rendered.element.querySelector("#login-email")).not.toBeNull();
    await act(async () => rendered.element.querySelector<HTMLButtonElement>(".language")?.click());
    expect(rendered.element.textContent).toContain("Sign in to your lab");
    expect(localStorage.getItem("chronofish.language")).toBeNull();
  });

  it("finishes a queued logout before requesting a fresh code", async () => {
    localStorage.setItem("chronofish.logout_pending", "true");
    request.mockResolvedValue(jsonResponse({}));
    const rendered = await renderPage(<Login onLogin={onLogin} />);
    unmount = rendered.unmount;
    await changeValue("#login-email", "member@ku.th");
    await submitForm();
    expect(request).toHaveBeenNthCalledWith(1, "/auth/logout", { method: "POST" });
    expect(request).toHaveBeenNthCalledWith(2, "/auth/request-code", {
      method: "POST",
      body: JSON.stringify({ email: "member@ku.th" }),
    });
    expect(localStorage.getItem("chronofish.logout_pending")).toBeNull();
  });
});
