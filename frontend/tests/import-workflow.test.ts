import { expect, it, vi } from "vitest";
import { createImportWorkflow, type ImportWorkflowHooks, type RequestFn } from "../src/import-workflow";

const job = { id: "job-1", status: "draft", inputKind: "xlsx", revision: 2, createdAt: "2024-01-01T00:00:00Z" };

function setup(options: { status?: string; issueCount?: number; recordCount?: number } = {}) {
  const calls: { path: string; method: string }[] = [];
  let status = options.status ?? "draft";
  let failReads = false;
  let writeError: Error | null = null;
  const bodies: Record<string, unknown> = {};
  const recordCount = options.recordCount ?? 120;
  const issueCount = options.issueCount ?? 120;
  const route = (path: string, method: string): unknown => {
    const url = new URL(path, "http://x");
    const p = url.pathname;
    const offset = Number(url.searchParams.get("offset") ?? 0);
    if (method !== "GET") {
      if (writeError) throw writeError;
      if (p.endsWith("/confirm-template")) status = "committed";
      if (p.endsWith("/revert")) status = "reverted";
      return { recordCount: 3, revision: 3 };
    }
    if (failReads) throw new Error("network down");
    if (p === "/imports") return { items: [{ ...job, status }] };
    if (p === "/imports/job-1")
      return { job: { ...job, status }, files: [], recordCount, issueCount, deferredFieldCount: 0 };
    if (p.endsWith("/records")) return { items: offset >= recordCount ? [] : [{ id: `r${offset}` }] };
    if (p.endsWith("/issues")) return { items: offset >= issueCount ? [] : [{ id: `i${offset}` }] };
    if (p.endsWith("/mapping-requirements")) return { canConfirmMixed: true, recordKinds: [] };
    if (p.endsWith("/fish-status")) return { items: [] };
    if (p === "/sites" || p === "/donor-cell-lines") return { items: [] };
    if (p.endsWith("/historical-structure")) return { total: 0, items: [] };
    if (p.endsWith("/result"))
      return {
        counts: [{ entity: "experiment_batch", count: 1 }],
        total: 1,
        items: [{ kind: "batch", id: "b1", code: `B${offset}` }],
      };
    return {};
  };
  const request: RequestFn = async (path, init) => {
    const method = init?.method ?? "GET";
    calls.push({ path, method });
    if (init?.body) bodies[path] = JSON.parse(String(init.body));
    const data = route(path, method);
    return { json: async () => data };
  };
  const hooks: ImportWorkflowHooks = { onNewJob: vi.fn(), onJobLoaded: vi.fn(), onDeferredLoaded: vi.fn() };
  const workflow = createImportWorkflow(request, hooks);
  return {
    workflow,
    hooks,
    calls,
    bodies,
    failReads: (value: boolean) => {
      failReads = value;
    },
    failWrite: (error: Error | null) => {
      writeError = error;
    },
    writes: () => calls.filter((call) => call.method !== "GET"),
  };
}

it("opens a job and loads every related read", async () => {
  const { workflow, calls, hooks } = setup();
  await workflow.openJob("job-1");
  expect(calls.map((call) => call.path)).toEqual([
    "/imports/job-1",
    "/imports/job-1/records?offset=0&limit=50",
    "/imports/job-1/issues?offset=0&limit=50",
    "/imports/job-1/mapping-requirements",
    "/sites?limit=500",
    "/donor-cell-lines?limit=500",
    "/imports/job-1/fish-status",
    "/imports/job-1/historical-summary",
    "/imports/job-1/comparison?offset=0&limit=50",
    "/imports/job-1/historical-structure?offset=0&limit=50",
    "/imports/job-1/result?offset=0&limit=50",
  ]);
  const state = workflow.getState();
  expect(state.detail?.job.id).toBe("job-1");
  expect(state.records).toHaveLength(1);
  expect(state.confirmationMode).toBe("mixed");
  expect(state.importStep).toBe(2);
  expect(hooks.onNewJob).toHaveBeenCalledTimes(1);
  await workflow.openJob("job-1");
  expect(hooks.onNewJob).toHaveBeenCalledTimes(1);
});

it("loads the import result with the job, pages it, and keeps it across a commit whose reads fail", async () => {
  const t = setup();
  await t.workflow.openJob("job-1");
  expect(t.workflow.getState().importResult?.counts).toEqual([{ entity: "experiment_batch", count: 1 }]);
  await t.workflow.loadResult("job-1", 50);
  expect(t.workflow.getState()).toMatchObject({ resultOffset: 50, importResult: { items: [{ code: "B50" }] } });
  t.failReads(true);
  await t.workflow.submitTemplate(true, () => {});
  expect(t.workflow.getState()).toMatchObject({ importResult: null, refreshNeeded: "committed" });
  t.failReads(false);
  await t.workflow.retryRefresh();
  expect(t.workflow.getState().importResult?.total).toBe(1);
});

it("pages issues and records within bounds and handles an empty issue page", async () => {
  const { workflow, calls } = setup({ issueCount: 60, recordCount: 0 });
  await workflow.openJob("job-1");
  await workflow.pageIssues(-1);
  await workflow.pageRecords(1);
  expect(calls).toHaveLength(11);
  await workflow.pageIssues(1);
  expect(workflow.getState().issueOffset).toBe(50);
  expect(workflow.getState().recordOffset).toBe(0);
  expect(calls.some((call) => call.path === "/imports/job-1/issues?offset=50&limit=50")).toBe(true);
  // Past the end the server returns an empty page; state keeps the offset with no rows.
  await workflow.openJob("job-1", 0, 200);
  expect(workflow.getState().issues).toEqual([]);
  expect(workflow.getState().issueOffset).toBe(200);
  const before = calls.length;
  await workflow.pageIssues(1);
  expect(calls).toHaveLength(before);
  await workflow.pageIssues(-1);
  expect(workflow.getState().issueOffset).toBe(150);
});

it("commit succeeds but reads fail: committed with read-retry, retry sends GETs only", async () => {
  const t = setup();
  await t.workflow.openJob("job-1");
  t.calls.length = 0;
  t.failReads(true);
  const written = vi.fn();
  await t.workflow.submitTemplate(true, written);
  expect(written).toHaveBeenCalledWith({ recordCount: 3, revision: 3 });
  const state = t.workflow.getState();
  expect(state.detail?.job).toMatchObject({ status: "committed", revision: 3 });
  expect(state.importStep).toBe(5);
  expect(state.refreshNeeded).toBe("committed");
  expect(t.writes()).toEqual([{ path: "/imports/job-1/confirm-template", method: "POST" }]);
  expect(t.bodies["/imports/job-1/confirm-template"]).toEqual({ revision: 2 });

  t.calls.length = 0;
  t.failReads(false);
  await t.workflow.retryRefresh();
  expect(t.writes()).toEqual([]);
  expect(t.calls.length).toBeGreaterThan(0);
  expect(t.workflow.getState().refreshNeeded).toBeNull();
  expect(t.workflow.getState().detail?.job.status).toBe("committed");
});

it("a failed retry keeps the read-retry marker and still sends no write", async () => {
  const t = setup();
  await t.workflow.openJob("job-1");
  t.failReads(true);
  await t.workflow.submitTemplate(true, () => {});
  t.calls.length = 0;
  await expect(t.workflow.retryRefresh()).rejects.toThrow("network down");
  expect(t.workflow.getState().refreshNeeded).toBe("committed");
  expect(t.writes()).toEqual([]);
});

it("validate does not change the job or refresh", async () => {
  const t = setup();
  await t.workflow.openJob("job-1");
  t.calls.length = 0;
  await t.workflow.submitTemplate(false, () => {});
  expect(t.calls).toEqual([{ path: "/imports/job-1/validate-template", method: "POST" }]);
  expect(t.workflow.getState().detail?.job.status).toBe("draft");
});

it("a stale-revision 409 surfaces the error and leaves state untouched", async () => {
  const t = setup();
  await t.workflow.openJob("job-1");
  const snapshot = t.workflow.getState();
  t.calls.length = 0;
  t.failWrite(new Error("REVISION_CONFLICT"));
  await expect(t.workflow.submitTemplate(true, () => {})).rejects.toThrow("REVISION_CONFLICT");
  await expect(t.workflow.revert("because", () => {})).rejects.toThrow("REVISION_CONFLICT");
  await expect(t.workflow.writeAndReload("/imports/job-1/issues/i1/decision", { revision: 1 })).rejects.toThrow(
    "REVISION_CONFLICT",
  );
  await expect(t.workflow.confirm({}, () => {})).rejects.toThrow("REVISION_CONFLICT");
  expect(t.workflow.getState()).toBe(snapshot);
  expect(t.calls.every((call) => call.method === "POST")).toBe(true);
});

it("revert succeeds but reads fail: reverted with read-retry, retry is read-only", async () => {
  const t = setup({ status: "committed" });
  await t.workflow.openJob("job-1");
  t.calls.length = 0;
  t.failReads(true);
  const written = vi.fn();
  await t.workflow.revert("wrong file", written);
  expect(written).toHaveBeenCalledTimes(1);
  expect(t.workflow.getState().detail?.job).toMatchObject({ status: "reverted", revision: 3 });
  expect(t.workflow.getState().refreshNeeded).toBe("reverted");
  expect(t.bodies["/imports/job-1/revert"]).toEqual({ revision: 2, reason: "wrong file" });

  t.calls.length = 0;
  t.failReads(false);
  await t.workflow.retryRefresh();
  expect(t.writes()).toEqual([]);
  expect(t.workflow.getState().refreshNeeded).toBeNull();
});

it("confirm sends revision first, then reloads jobs and the current page", async () => {
  const t = setup();
  await t.workflow.openJob("job-1", 50, 50);
  t.calls.length = 0;
  await t.workflow.confirm({ siteMappings: {} }, () => {});
  expect(t.calls[0]).toEqual({ path: "/imports/job-1/confirm", method: "POST" });
  expect(t.calls[1]).toEqual({ path: "/imports", method: "GET" });
  expect(t.calls[2].path).toBe("/imports/job-1");
  expect(t.calls.some((call) => call.path === "/imports/job-1/issues?offset=50&limit=50")).toBe(true);
  expect(Object.keys(t.bodies["/imports/job-1/confirm"] as object)).toEqual(["revision", "siteMappings"]);
});

it("confirm succeeds but reads fail: committed + refreshNeeded, retry is GET-only", async () => {
  const t = setup();
  await t.workflow.openJob("job-1");
  t.calls.length = 0;
  t.failReads(true);
  const written = vi.fn();
  await t.workflow.confirm({ siteMappings: {} }, written);
  expect(written).toHaveBeenCalledTimes(1);
  const state = t.workflow.getState();
  expect(state.detail?.job).toMatchObject({ status: "committed", revision: 3 });
  expect(state.importStep).toBe(5);
  expect(state.refreshNeeded).toBe("committed");
  expect(t.writes()).toEqual([{ path: "/imports/job-1/confirm", method: "POST" }]);

  t.calls.length = 0;
  t.failReads(false);
  await t.workflow.retryRefresh();
  expect(t.writes()).toEqual([]);
  expect(t.workflow.getState().refreshNeeded).toBeNull();
});

it("notifies subscribers on state change", () => {
  const t = setup();
  const listener = vi.fn();
  const off = t.workflow.subscribe(listener);
  t.workflow.setStep(4);
  expect(listener).toHaveBeenCalledTimes(1);
  off();
  t.workflow.setStep(3);
  expect(listener).toHaveBeenCalledTimes(1);
});

// Job-scoped reads: `/imports/<id>` detail and historical-structure can be held until released; so can writes.
function gated() {
  const gates = new Map<string, () => void>();
  let failJobList = false;
  const request: RequestFn = async (path, init) => {
    const url = new URL(path, "http://x");
    if (init?.method === "POST") {
      await new Promise<void>((resolve) => gates.set(`POST ${url.pathname}`, resolve));
      return { json: async () => ({ recordCount: 1, revision: 3 }) };
    }
    if (url.pathname === "/imports" && failJobList) throw new Error("network down");
    const m = url.pathname.match(/^\/imports\/(job-\w+)(\/historical-structure)?$/);
    if (m) {
      const key = m[1] + (m[2] ?? "");
      if (!m[2] || url.searchParams.get("offset") === "50")
        await new Promise<void>((resolve) => gates.set(`${key}?${url.searchParams.get("offset")}`, resolve));
      if (m[2]) return { json: async () => ({ total: 0, items: [{ id: `${m[1]}-s` }] }) };
      return {
        json: async () => ({
          job: { ...job, id: m[1] },
          files: [],
          recordCount: 120,
          issueCount: 0,
          deferredFieldCount: 0,
        }),
      };
    }
    if (url.pathname.endsWith("/mapping-requirements"))
      return { json: async () => ({ canConfirmMixed: true, recordKinds: [] }) };
    if (
      url.pathname.endsWith("/records") ||
      url.pathname.endsWith("/issues") ||
      url.pathname.endsWith("/fish-status") ||
      url.pathname === "/sites" ||
      url.pathname === "/donor-cell-lines"
    )
      return { json: async () => ({ items: [] }) };
    return { json: async () => ({ total: 0, items: [] }) };
  };
  const workflow = createImportWorkflow(request, {
    onNewJob: vi.fn(),
    onJobLoaded: vi.fn(),
    onDeferredLoaded: vi.fn(),
  });
  const release = async (key: string) => {
    await vi.waitFor(() => expect(gates.has(key)).toBe(true));
    gates.get(key)?.();
  };
  const failJobs = () => {
    failJobList = true;
  };
  return { workflow, release, failJobs };
}

it("keeps the latest opened job when an older response arrives last", async () => {
  const { workflow, release } = gated();
  const a = workflow.openJob("job-a");
  const b = workflow.openJob("job-b");
  await release("job-b?null");
  await b;
  expect(workflow.getState().detail?.job.id).toBe("job-b");
  await release("job-a?null");
  await a;
  expect(workflow.getState().detail?.job.id).toBe("job-b");
});

it("does not reopen a job that was closed while loading", async () => {
  const { workflow, release } = gated();
  const a = workflow.openJob("job-a");
  workflow.closeJob();
  await release("job-a?null");
  await a;
  expect(workflow.getState().detail).toBeNull();
});

it("ignores a structure page for a job that is no longer open", async () => {
  const { workflow, release } = gated();
  const a = workflow.openJob("job-a");
  await release("job-a?null");
  await a;
  const page = workflow.loadStructure("job-a", 50);
  const b = workflow.openJob("job-b");
  await release("job-b?null");
  await b;
  await release("job-a/historical-structure?50");
  await page;
  expect(workflow.getState().structureOffset).toBe(0);
  expect(workflow.getState().detail?.job.id).toBe("job-b");
});

it("a commit that finishes after the user picked another job leaves that job on screen", async () => {
  const { workflow, release } = gated();
  const a = workflow.openJob("job-a");
  await release("job-a?null");
  await a;
  const write = workflow.submitTemplate(true, () => {});
  const b = workflow.openJob("job-b");
  await release("POST /imports/job-a/confirm-template");
  await write;
  await release("job-b?null");
  await b;
  expect(workflow.getState().detail?.job.id).toBe("job-b");
  expect(workflow.getState().refreshNeeded).toBeNull();
});

it("a revert whose job-list refresh fails after the user opened another job leaves no retry banner", async () => {
  const { workflow, release, failJobs } = gated();
  const a = workflow.openJob("job-a");
  await release("job-a?null");
  await a;
  const write = workflow.revert("wrong batch", () => {});
  const b = workflow.openJob("job-b");
  await release("job-b?null");
  await b;
  failJobs();
  await release("POST /imports/job-a/revert");
  await write;
  expect(workflow.getState().detail?.job.id).toBe("job-b");
  expect(workflow.getState().refreshNeeded).toBeNull();
});
