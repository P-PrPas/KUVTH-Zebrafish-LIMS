import "fake-indexeddb/auto";
import { indexedDB as fakeIndexedDB } from "fake-indexeddb";
import { afterEach, beforeEach, vi } from "vitest";
import { resetBrowserState } from "./helpers";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const reportError = console.error.bind(console);

beforeEach(async () => {
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "indexedDB", { configurable: true, value: fakeIndexedDB });
    await resetBrowserState();
    localStorage.setItem(
      "chronofish.auth_user",
      JSON.stringify({ id: "01900000-0000-7000-8000-000000000099", email: "tester@ku.th", role: "admin" }),
    );
  }
  vi.stubGlobal("console", {
    ...console,
    error: (...args: unknown[]) => {
      if (String(args[0]).includes("act(")) return;
      reportError(...args);
    },
  });
});

afterEach(() => vi.unstubAllGlobals());
