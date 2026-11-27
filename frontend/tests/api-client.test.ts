// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { load } from "js-yaml";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiBase, deviceId, mutationHeaders, operatorId, request, WRITE_KINDS, writeKind } from "../src/api/client";

describe("API write context", () => {
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("persists one UUID v7 device identifier", () => {
    const first = deviceId();
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(deviceId()).toBe(first);
    expect(localStorage.getItem("chronofish.device_id")).toBe(first);
  });

  it("keeps the selected operator in the browser session and sends both identifiers", () => {
    sessionStorage.setItem("chronofish.operator_id", "operator-a");
    localStorage.setItem("chronofish.device_id", "device-a");

    expect(operatorId()).toBe("operator-a");
    expect(mutationHeaders("request-a")).toEqual({
      "X-Operator-Id": "operator-a",
      "X-Device-Id": "device-a",
      "X-Idempotency-Key": "request-a",
      "X-Actor-User-Id": "01900000-0000-7000-8000-000000000099",
    });
  });

  it("uses the member's linked operator even when the browser has another selection", () => {
    localStorage.setItem(
      "chronofish.auth_user",
      JSON.stringify({ id: "member-1", role: "member", operatorId: "linked" }),
    );
    sessionStorage.setItem("chronofish.operator_id", "forged");
    expect(operatorId()).toBe("linked");
    expect(mutationHeaders("request-a")["X-Operator-Id"]).toBe("linked");
    localStorage.setItem("chronofish.auth_user", JSON.stringify({ id: "member-1", role: "member", operatorId: null }));
    expect(operatorId()).toBe("");
  });

  it("migrates a legacy localStorage operator into the session once", () => {
    localStorage.setItem("chronofish.operator_id", "legacy-operator");
    expect(operatorId()).toBe("legacy-operator");
    expect(sessionStorage.getItem("chronofish.operator_id")).toBe("legacy-operator");
    expect(localStorage.getItem("chronofish.operator_id")).toBeNull();
  });

  it("sends a fresh idempotency key unless the caller supplies one", () => {
    sessionStorage.setItem("chronofish.operator_id", "operator-a");
    expect(mutationHeaders()["X-Idempotency-Key"]).not.toBe(mutationHeaders()["X-Idempotency-Key"]);
    expect(mutationHeaders("known-key")["X-Idempotency-Key"]).toBe("known-key");
  });

  it("rejects every mutation before network access when no operator is selected", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(request("/batches", { method: "POST", body: "{}" })).rejects.toThrow("OPERATOR_REQUIRED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["POST", "/imports/job-1/validate-template", "operator"],
    ["POST", "/imports/job-1/confirm-template", "operator"],
    ["PATCH", "/batches/b-1?x=1", "operator"],
    ["POST", "/corrections/c-1/decide", "account"],
    ["POST", "/imports/inspect", "account"],
    ["POST", "/imports/job-1/confirm-all", "account"],
    ["POST", "/auth/logout", "none"],
  ] as const)("sends %s %s with %s write context", async (method, path, kind) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    expect(writeKind(method, path)).toBe(kind);
    if (kind === "operator") await expect(request(path, { method, body: "{}" })).rejects.toThrow("OPERATOR_REQUIRED");
    sessionStorage.setItem("chronofish.operator_id", "operator-a");
    await request(path, { method, body: "{}" });
    const sent = fetchMock.mock.calls.at(-1)?.[1].headers;
    expect(sent["X-Operator-Id"]).toBe(kind === "operator" ? "operator-a" : undefined);
    expect(sent["X-Idempotency-Key"] === undefined).toBe(kind === "none");
  });

  it("refuses a mutation whose write kind is not declared", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(request("/unknown", { method: "POST", body: "{}" })).rejects.toThrow("No write kind declared");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("declares the same write kind as api/openapi.yaml for every mutating operation", () => {
    const document = load(readFileSync(resolve(__dirname, "../../api/openapi.yaml"), "utf8")) as {
      paths: Record<string, Record<string, { parameters?: Param[] }> & { parameters?: Param[] }>;
      components: { parameters: Record<string, { name: string }> };
    };
    type Param = { $ref?: string; name?: string };
    const names = (parameters: Param[] = []) =>
      parameters.map((p) => (p.$ref ? document.components.parameters[p.$ref.split("/").pop() as string].name : p.name));
    const expected: Record<string, string> = {};
    for (const [path, item] of Object.entries(document.paths))
      for (const [method, operation] of Object.entries(item))
        if (["post", "put", "patch", "delete"].includes(method)) {
          const declared = [...names(item.parameters), ...names(operation.parameters)];
          expected[`${method.toUpperCase()} ${path}`] = declared.includes("X-Operator-Id")
            ? "operator"
            : path.startsWith("/auth/")
              ? "none"
              : "account";
          // Every declared operation must resolve to itself from a concrete path.
          expect(writeKind(method.toUpperCase(), path.replace(/\{[^/]+\}/g, "id"))).toBe(
            expected[`${method.toUpperCase()} ${path}`],
          );
        }
    expect(WRITE_KINDS).toEqual(expected);
  });

  it("honors supplied context without requiring a session operator", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    await request("/sites", {
      method: "POST",
      body: "{}",
      headers: new Headers({ "x-operator-id": "original-operator" }),
    });
    expect(fetchMock.mock.calls[0][1].headers["X-Operator-Id"]).toBe("original-operator");
  });

  it("preserves structured API error details for row-level feedback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: { message: "CSV needs changes", details: { rows: [{ row: 3, message: "duplicate stage" }] } },
            }),
            { status: 422, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    await expect(request("/timing-profiles/csv")).rejects.toMatchObject({
      message: "CSV needs changes",
      status: 422,
      details: { rows: [{ row: 3, message: "duplicate stage" }] },
    });
  });

  it("adds write context only to mutations and JSON content type only to bodies", async () => {
    sessionStorage.setItem("chronofish.operator_id", "operator-a");
    localStorage.setItem("chronofish.device_id", "device-a");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await request("/health");
    await request("/sites", { method: "POST", body: "{}" });

    const getHeaders = fetchMock.mock.calls[0][1].headers;
    const postHeaders = fetchMock.mock.calls[1][1].headers;
    expect(getHeaders).toEqual({ Accept: "application/json" });
    expect(postHeaders).toMatchObject({
      "Content-Type": "application/json",
      "X-Operator-Id": "operator-a",
      "X-Device-Id": "device-a",
    });
  });

  it("keeps caller supplied headers and falls back for non-JSON errors", async () => {
    sessionStorage.setItem("chronofish.operator_id", "operator-a");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(
        new Response("server unavailable", { status: 500, headers: { "Content-Type": "text/plain" } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await request("/timing-profiles/csv", { method: "POST", body: "csv", headers: { "Content-Type": "text/csv" } });
    await expect(request("/health")).rejects.toThrow("HTTP 500");
    expect(fetchMock.mock.calls[0][1].headers["Content-Type"]).toBe("text/csv");
  });

  it("uses the default API base URL in this build", () => {
    expect(apiBase).toBe("/api/v1");
  });
});
