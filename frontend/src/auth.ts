import { request } from "./api/client";

export type AuthRole = "admin" | "member";
export type AuthUser = {
  id: string;
  email: string;
  role: AuthRole;
  operatorId?: string | null;
  sessionId?: string;
  deviceId?: string;
};

const cacheKey = "chronofish.auth_user";
const pendingLogoutKey = "chronofish.logout_pending";

export function hasPendingLogout(): boolean {
  return localStorage.getItem(pendingLogoutKey) === "true";
}

export function markLogoutPending(): void {
  localStorage.setItem(pendingLogoutKey, "true");
}

export function clearLogoutPending(): void {
  localStorage.removeItem(pendingLogoutKey);
}

export async function finishPendingLogout(): Promise<void> {
  if (!hasPendingLogout()) return;
  await request("/auth/logout", { method: "POST" });
  clearLogoutPending();
}

export function cachedUser(): AuthUser | null {
  try {
    const value = JSON.parse(localStorage.getItem(cacheKey) ?? "null") as AuthUser | null;
    if (value && typeof value.id === "string" && typeof value.email === "string") return value;
  } catch {
    // Ignore an incomplete local cache and ask the server to verify the cookie.
  }
  return null;
}

export function rememberUser(user: AuthUser): void {
  const previous = cachedUser();
  const accountChanged = !previous || previous.id !== user.id;
  if (previous && previous.id !== user.id) sessionStorage.removeItem("chronofish.operator_id");
  localStorage.setItem(cacheKey, JSON.stringify(user));
  clearLogoutPending();
  if (accountChanged && user.operatorId) sessionStorage.setItem("chronofish.operator_id", user.operatorId);
}

export function forgetUser(): void {
  localStorage.removeItem(cacheKey);
}

export async function verifySession(): Promise<AuthUser> {
  const result = (await request("/auth/me").then((response) => response.json())) as { user: AuthUser };
  rememberUser(result.user);
  return result.user;
}

export function setOfflineQueueIdentity(): void {
  window.dispatchEvent(new CustomEvent("chronofish:auth-changed"));
}

export const KU_EMAIL_PATTERN = ".+@[kK][uU]\\.[tT][hH]";
