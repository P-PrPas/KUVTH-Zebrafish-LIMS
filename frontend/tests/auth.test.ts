import { beforeEach, describe, expect, it, vi } from "vitest";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../src/api/client", () => ({ request }));

import {
  cachedUser,
  clearLogoutPending,
  finishPendingLogout,
  forgetUser,
  hasPendingLogout,
  markLogoutPending,
  rememberUser,
  setOfflineQueueIdentity,
  verifySession,
} from "../src/auth";

const user = { id: "user-1", email: "member@ku.th", role: "member" as const, operatorId: "operator-1" };

describe("authentication browser state", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    request.mockReset();
  });

  it("ignores missing, invalid and incomplete cached users", () => {
    expect(cachedUser()).toBeNull();
    localStorage.setItem("chronofish.auth_user", "{");
    expect(cachedUser()).toBeNull();
    localStorage.setItem("chronofish.auth_user", JSON.stringify({ id: 1, email: "member@ku.th" }));
    expect(cachedUser()).toBeNull();
  });

  it("stores a valid cached user and forgets it", () => {
    rememberUser(user);
    expect(cachedUser()).toEqual(user);
    forgetUser();
    expect(cachedUser()).toBeNull();
  });

  it("sets the operator for a new account and clears an operator when switching accounts", () => {
    rememberUser(user);
    expect(sessionStorage.getItem("chronofish.operator_id")).toBe("operator-1");
    rememberUser({ id: "user-2", email: "admin@ku.th", role: "admin" });
    expect(sessionStorage.getItem("chronofish.operator_id")).toBeNull();
    expect(cachedUser()?.id).toBe("user-2");
  });

  it("keeps the selected operator when remembering the same account without an operator", () => {
    sessionStorage.setItem("chronofish.operator_id", "operator-2");
    rememberUser({ id: "user-1", email: "member@ku.th", role: "member" });
    expect(sessionStorage.getItem("chronofish.operator_id")).toBe("operator-2");
  });

  it("marks, clears and completes a pending server logout", async () => {
    expect(hasPendingLogout()).toBe(false);
    markLogoutPending();
    expect(hasPendingLogout()).toBe(true);
    request.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await finishPendingLogout();
    expect(request).toHaveBeenCalledWith("/auth/logout", { method: "POST" });
    expect(hasPendingLogout()).toBe(false);
    markLogoutPending();
    clearLogoutPending();
    expect(hasPendingLogout()).toBe(false);
  });

  it("does not call the server without a pending logout and retains the marker on failure", async () => {
    await finishPendingLogout();
    expect(request).not.toHaveBeenCalled();
    markLogoutPending();
    request.mockRejectedValueOnce(new Error("offline"));
    await expect(finishPendingLogout()).rejects.toThrow("offline");
    expect(hasPendingLogout()).toBe(true);
  });

  it("verifies the cookie session and remembers its user", async () => {
    request.mockResolvedValueOnce(new Response(JSON.stringify({ user }), { status: 200 }));
    await expect(verifySession()).resolves.toEqual(user);
    expect(request).toHaveBeenCalledWith("/auth/me");
    expect(cachedUser()).toEqual(user);
  });

  it("dispatches the queue identity change event", () => {
    const listener = vi.fn();
    window.addEventListener("chronofish:auth-changed", listener);
    setOfflineQueueIdentity();
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener("chronofish:auth-changed", listener);
  });
});
