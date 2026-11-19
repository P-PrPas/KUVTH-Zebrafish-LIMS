// Import-job workflow: loading a job and its reads, paging, refresh after writes, and the
// commit/revert/validate transitions. Plain TypeScript; the page subscribes and renders.
export type Job = { id: string; status: string; inputKind: string; revision: number; createdAt: string };
export type Detail = {
  job: Job;
  files: { id: string; fileName: string; sha256: string; sizeBytes: number }[];
  recordCount: number;
  issueCount: number;
  deferredFieldCount: number;
};
export type RecordRow = {
  id: string;
  sheetName: string;
  sourceLocator: string;
  recordKind: string;
  status: string;
  source: Record<string, unknown>;
  working: Record<string, unknown>;
  targetTable?: string | null;
  targetId?: string | null;
};
export type Issue = {
  id: string;
  recordId: string | null;
  sheetName: string;
  rowNo: number | null;
  sourceColumn: string | null;
  sourceValue: string | null;
  severity: string;
  code: string;
  message: string;
  status: string;
};
export type MappingRequirements = {
  canConfirmTemplate?: boolean;
  donorSources: string[];
  sheetNames: string[];
  recordKinds: string[];
  ambiguousZeroRecords: string[];
  unresolvedIssueCount: number;
  canConfirmFishSpecimens: boolean;
  canConfirmAggregate: boolean;
  aggregateWarningCount: number;
  aggregateWarningPreview: string[];
  canConfirmEmbryos: boolean;
  embryoWarningCount: number;
  embryoWarningPreview: string[];
  canConfirmMixed: boolean;
};
export type MasterOption = {
  id: string;
  code?: string;
  name?: string;
  strain?: string;
  preparation?: string;
  batchCode?: string;
  timeZone?: string | null;
};
export type ImportedFishStatus = {
  id: string;
  fishCode: string;
  status: string;
  lifeState: string;
  disposition: string;
  exitDate: string | null;
  rowVersion: number;
};
export type DeferredField = {
  id: string;
  jobId: string;
  sheetName: string;
  sourceLocator: string;
  sourceColumn: string;
  sourceValue: unknown;
  status: string;
  targetTable: string | null;
  targetId: string | null;
  targetField?: string | null;
  targetFields: string[];
  rowVersion: number | null;
};
export type HistoricalSummary = {
  stageCounts: {
    stageLabel: string;
    armType: string | null;
    sourceCount: number;
    nTotal: number | null;
    nAlive: number | null;
    nNormal: number | null;
    nAbnormal: number | null;
    numerator: number | null;
    denominator: number | null;
  }[];
  observations: {
    subjectType: string;
    stageLabel: string | null;
    outcome: string | null;
    timePrecision: string;
    count: number;
  }[];
};
export type HistoricalStructure = {
  total: number;
  items: {
    id: string;
    sourceSheet: string;
    sourceKind: string;
    experimentDate: string | null;
    siteId: string | null;
    recipientSource: string | null;
    eggCodeSource: string | null;
    groupSource: string | null;
    csofSource: string | null;
    lots: {
      id: string;
      lotNoSource: string | null;
      donorSource: string | null;
      injectionSource: string | null;
      activationLocalTime: string | null;
    }[];
  }[];
};
export type ImportComparison = {
  matchedFiles: {
    currentFile: string;
    priorFile: string;
    priorJobId: string;
    priorJobStatus: string;
    sha256: string;
  }[];
  records: {
    recordId: string;
    sheetName: string;
    sourceLocator: string;
    recordKind: string;
    activeTargetId: string | null;
    previousJobId: string | null;
    previousRecordId: string | null;
    sameSourcePosition: boolean;
    sourceChanged: boolean | null;
    workingChanged: boolean | null;
    changedFieldCount: number;
    changedFields: { field: string; before: string | null; after: string | null }[];
  }[];
};

type JsonResponse = { json(): Promise<unknown> };
export type RequestFn = (path: string, init?: RequestInit) => Promise<JsonResponse>;

export type ImportWorkflowState = {
  jobs: Job[];
  detail: Detail | null;
  records: RecordRow[];
  issues: Issue[];
  recordOffset: number;
  issueOffset: number;
  mappingRequirements: MappingRequirements | null;
  siteOptions: MasterOption[];
  donorOptions: MasterOption[];
  fishStatuses: ImportedFishStatus[];
  historicalSummary: HistoricalSummary | null;
  historicalStructure: HistoricalStructure | null;
  structureOffset: number;
  comparison: ImportComparison | null;
  importStep: number;
  confirmationMode: string;
  // Write succeeded but the follow-up reads failed: show success + a read-only retry, never re-send the write.
  refreshNeeded: "committed" | "reverted" | null;
  deferredFields: DeferredField[];
  deferredTotal: number;
  deferredOffset: number;
};

// Page-owned form state that must reset in the same batch as a load.
export type ImportWorkflowHooks = {
  onNewJob: () => void;
  onJobLoaded: (loaded: { fishStatuses: ImportedFishStatus[] }) => void;
  onDeferredLoaded: (items: DeferredField[]) => void;
};

const PAGE = 50;

export function createImportWorkflow(request: RequestFn, hooks: ImportWorkflowHooks) {
  let state: ImportWorkflowState = {
    jobs: [],
    detail: null,
    records: [],
    issues: [],
    recordOffset: 0,
    issueOffset: 0,
    mappingRequirements: null,
    siteOptions: [],
    donorOptions: [],
    fishStatuses: [],
    historicalSummary: null,
    historicalStructure: null,
    structureOffset: 0,
    comparison: null,
    importStep: 2,
    confirmationMode: "mixed",
    refreshNeeded: null,
    deferredFields: [],
    deferredTotal: 0,
    deferredOffset: 0,
  };
  const listeners = new Set<() => void>();
  function set(patch: Partial<ImportWorkflowState>) {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  }
  async function json<T>(path: string, init?: RequestInit): Promise<T> {
    return (await (await request(path, init)).json()) as T;
  }
  const jobId = () => state.detail?.job.id as string;
  // Bumped by every openJob and by closeJob; a job-scoped response applies only if it is still the latest.
  let generation = 0;
  const stillOpen = (id: string) => state.detail?.job.id === id;

  async function reloadJobs() {
    set({ jobs: (await json<{ items: Job[] }>("/imports")).items });
  }
  async function loadDeferred(offset = 0) {
    const result = await json<{ total: number; items: DeferredField[] }>(
      `/imports/deferred-fields?offset=${offset}&limit=${PAGE}`,
    );
    hooks.onDeferredLoaded(result.items);
    set({ deferredFields: result.items, deferredTotal: result.total, deferredOffset: offset });
  }
  async function loadStructure(id: string, offset = 0) {
    const mine = generation;
    const result = await json<HistoricalStructure>(
      `/imports/${id}/historical-structure?offset=${offset}&limit=${PAGE}`,
    );
    if (mine !== generation || !stillOpen(id)) return;
    set({ historicalStructure: result, structureOffset: offset });
  }
  async function openJob(id: string, nextRecords = 0, nextIssues = 0) {
    const mine = ++generation;
    const newJob = state.detail?.job.id !== id;
    if (newJob) hooks.onNewJob();
    const [
      nextDetail,
      nextRecordPage,
      nextIssuePage,
      requirements,
      siteCatalog,
      donorCatalog,
      importedFish,
      summary,
      nextComparison,
      structure,
    ] = await Promise.all([
      json<Detail>(`/imports/${id}`),
      json<{ items: RecordRow[] }>(`/imports/${id}/records?offset=${nextRecords}&limit=${PAGE}`),
      json<{ items: Issue[] }>(`/imports/${id}/issues?offset=${nextIssues}&limit=${PAGE}`),
      json<MappingRequirements>(`/imports/${id}/mapping-requirements`),
      json<{ items: MasterOption[] }>("/sites?limit=500"),
      json<{ items: MasterOption[] }>("/donor-cell-lines?limit=500"),
      json<{ items: ImportedFishStatus[] }>(`/imports/${id}/fish-status`),
      json<HistoricalSummary>(`/imports/${id}/historical-summary`),
      json<ImportComparison>(`/imports/${id}/comparison?offset=${nextRecords}&limit=${PAGE}`),
      json<HistoricalStructure>(`/imports/${id}/historical-structure?offset=0&limit=${PAGE}`),
    ]);
    if (mine !== generation) return;
    const patch: Partial<ImportWorkflowState> = {
      detail: nextDetail,
      records: nextRecordPage.items,
      issues: nextIssuePage.items,
      recordOffset: nextRecords,
      issueOffset: nextIssues,
      mappingRequirements: requirements,
      siteOptions: siteCatalog.items,
      donorOptions: donorCatalog.items,
      fishStatuses: importedFish.items,
      historicalSummary: summary,
      historicalStructure: structure,
      structureOffset: 0,
      comparison: nextComparison,
    };
    if (newJob) patch.refreshNeeded = null;
    if (newJob || nextDetail.job.status !== "draft") {
      patch.importStep = nextDetail.job.status === "draft" ? 2 : 5;
      patch.confirmationMode = requirements.canConfirmTemplate
        ? "template"
        : requirements.canConfirmMixed
          ? "mixed"
          : requirements.canConfirmFishSpecimens
            ? "fish"
            : requirements.canConfirmEmbryos
              ? "embryos"
              : "aggregate";
    }
    hooks.onJobLoaded({ fishStatuses: importedFish.items });
    set(patch);
  }
  // Re-read the open job and the job list; the write that preceded it is never repeated.
  async function refreshAfterWrite(id: string) {
    if (stillOpen(id)) await openJob(id);
    await reloadJobs();
    if (stillOpen(id)) set({ refreshNeeded: null });
  }
  const reloadCurrent = () => openJob(jobId(), state.recordOffset, state.issueOffset);

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    reloadJobs,
    loadDeferred,
    loadStructure,
    openJob,
    closeJob: () => {
      generation++;
      set({ detail: null });
    },
    setStep: (importStep: number) => set({ importStep }),
    setConfirmationMode: (confirmationMode: string) => set({ confirmationMode }),
    // The pager buttons are disabled at the ends; these guards keep the same limits for any other caller.
    async pageRecords(direction: 1 | -1) {
      const { recordOffset, records, issueOffset, detail } = state;
      if (direction === 1 ? recordOffset + records.length >= (detail?.recordCount ?? 0) : recordOffset === 0) return;
      await openJob(jobId(), Math.max(0, recordOffset + direction * PAGE), issueOffset);
    },
    async pageIssues(direction: 1 | -1) {
      const { issueOffset, issues, recordOffset, detail } = state;
      if (direction === 1 ? issueOffset + issues.length >= (detail?.issueCount ?? 0) : issueOffset === 0) return;
      await openJob(jobId(), recordOffset, Math.max(0, issueOffset + direction * PAGE));
    },
    // Edit/decision/bypass/fish-status writes: send, then reload the current page of the open job.
    async writeAndReload(path: string, body: unknown, method = "POST") {
      await json(path, { method, body: JSON.stringify(body) });
      await reloadCurrent();
    },
    async applyDeferred(id: string, body: unknown) {
      await json(`/imports/deferred-fields/${id}/apply`, { method: "POST", body: JSON.stringify(body) });
      await loadDeferred(state.deferredOffset);
    },
    // Like submitTemplate(commit): once the write succeeds the job is committed; failing reads only set refreshNeeded.
    async confirm<T extends { revision?: number }>(fields: Record<string, unknown>, onWritten: (result: T) => void) {
      const detail = state.detail as Detail;
      const result = await json<T>(`/imports/${detail.job.id}/confirm`, {
        method: "POST",
        body: JSON.stringify({ revision: detail.job.revision, ...fields }),
      });
      onWritten(result);
      if (!stillOpen(detail.job.id)) return void (await reloadJobs().catch(() => undefined));
      set({
        detail: {
          ...detail,
          job: { ...detail.job, status: "committed", revision: result.revision ?? detail.job.revision },
        },
        importStep: 5,
        historicalSummary: null,
      });
      try {
        await reloadJobs();
        await reloadCurrent();
        if (stillOpen(detail.job.id)) set({ refreshNeeded: null });
      } catch {
        if (stillOpen(detail.job.id)) set({ refreshNeeded: "committed" });
      }
    },
    // onWritten runs right after the write succeeds, before the follow-up reads.
    async submitTemplate(commit: boolean, onWritten: (result: { recordCount: number }) => void) {
      const detail = state.detail as Detail;
      const result = await json<{ recordCount: number; revision: number }>(
        `/imports/${detail.job.id}/${commit ? "confirm-template" : "validate-template"}`,
        { method: "POST", body: JSON.stringify({ revision: detail.job.revision }) },
      );
      onWritten(result);
      if (!commit || !stillOpen(detail.job.id)) return;
      set({
        detail: { ...detail, job: { ...detail.job, status: "committed", revision: result.revision } },
        importStep: 5,
        historicalSummary: null,
      });
      await refreshAfterWrite(detail.job.id).catch(() => set({ refreshNeeded: "committed" }));
    },
    async revert(reason: string, onWritten: () => void) {
      const detail = state.detail as Detail;
      const result = await json<{ revision: number }>(`/imports/${detail.job.id}/revert`, {
        method: "POST",
        body: JSON.stringify({ revision: detail.job.revision, reason }),
      });
      if (stillOpen(detail.job.id)) {
        set({
          detail: { ...detail, job: { ...detail.job, status: "reverted", revision: result.revision } },
          importStep: 5,
          historicalSummary: null,
        });
      }
      onWritten();
      await refreshAfterWrite(detail.job.id).catch(() => set({ refreshNeeded: "reverted" }));
    },
    // Read-only retry after a committed/reverted write whose follow-up reads failed.
    retryRefresh: () => refreshAfterWrite(jobId()),
  };
}

export type ImportWorkflow = ReturnType<typeof createImportWorkflow>;
