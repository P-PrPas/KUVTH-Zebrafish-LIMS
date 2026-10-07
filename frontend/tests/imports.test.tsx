// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { Imports } from "../src/pages/imports";

const job = { id: "job-1", status: "draft", inputKind: "xlsx", revision: 2, createdAt: "2024-01-01T00:00:00Z" };
const requirements = {
  donorSources: ["AB"],
  sheetNames: ["V1Fish"],
  recordKinds: ["fish", "embryo_candidate", "legacy_lot"],
  ambiguousZeroRecords: ["V1Fish A2"],
  unresolvedIssueCount: 1,
  canConfirmFishSpecimens: true,
  canConfirmAggregate: true,
  aggregateWarningCount: 1,
  aggregateWarningPreview: ["Count exceeds total"],
  canConfirmEmbryos: true,
  embryoWarningCount: 1,
  embryoWarningPreview: ["Clock is uncertain"],
  canConfirmMixed: true,
};

function mockImportApi(status = "draft", ready = false, inputKind: "xlsx" | "csv_set" = "xlsx") {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), "http://testserver").pathname.replace("/api/v1", "");
    const result = (() => {
      if (path === "/imports" && !init?.method) return { items: [{ ...job, status }] };
      if (path === "/imports/inspect")
        return inputKind === "xlsx"
          ? { inputKind, files: [{ name: "source.xlsx", sheets: ["V1Fish"] }] }
          : {
              inputKind,
              files: [{ name: "V1Fish.csv", encoding: "utf-8-sig", delimiter: ",", preview: [["A", "B"]] }],
            };
      if (path === "/imports" && init?.method === "POST") return { job: { ...job, status }, deferredFieldCount: 1 };
      if (path === "/imports/job-1")
        return {
          job: { ...job, status },
          files: [{ id: "file-1", fileName: "source.xlsx", sha256: "1234567890abcdef", sizeBytes: 42 }],
          recordCount: 1,
          issueCount: ready ? 0 : 1,
          deferredFieldCount: 1,
        };
      if (path === "/imports/job-1/records")
        return {
          items: [
            {
              id: "record-1",
              sheetName: "V1Fish",
              sourceLocator: "A2",
              recordKind: "fish",
              status: "draft",
              source: { A: 1, K: "CL1" },
              working: { A: 1, K: "CL1" },
              targetTable: "clone_fish",
              targetId: status === "committed" ? "fish-1" : null,
            },
          ],
        };
      if (path === "/imports/job-1/issues")
        return {
          items: ready
            ? []
            : [
                {
                  id: "issue-1",
                  recordId: "record-1",
                  sheetName: "V1Fish",
                  rowNo: 2,
                  sourceColumn: "L",
                  sourceValue: "unknown",
                  severity: "overridable",
                  code: "unknown_fish_status",
                  message: "Check fish status",
                  status: "open",
                },
              ],
        };
      if (path === "/imports/job-1/mapping-requirements")
        return ready
          ? {
              ...requirements,
              donorSources: [],
              sheetNames: [],
              ambiguousZeroRecords: [],
              unresolvedIssueCount: 0,
              aggregateWarningCount: 0,
              embryoWarningCount: 0,
            }
          : requirements;
      if (path === "/sites") return { items: [{ id: "site-1", code: "KU", timeZone: "Asia/Bangkok" }] };
      if (path === "/donor-cell-lines") return { items: [{ id: "donor-1", strain: "AB", preparation: "CHUNKS" }] };
      if (path === "/imports/job-1/fish-status")
        return {
          items: [
            {
              id: "fish-1",
              fishCode: "CL1",
              status: "UNKNOWN",
              lifeState: "UNKNOWN",
              disposition: "UNKNOWN",
              exitDate: null,
              rowVersion: 1,
            },
          ],
        };
      if (path === "/imports/job-1/historical-summary")
        return {
          stageCounts: [
            {
              stageLabel: "Day1",
              armType: "SCNT",
              sourceCount: 1,
              nTotal: 10,
              nAlive: 8,
              nNormal: null,
              nAbnormal: null,
              numerator: null,
              denominator: null,
            },
          ],
          observations: [
            { subjectType: "fish", stageLabel: "Day1", outcome: "ALIVE", timePrecision: "date", count: 1 },
          ],
        };
      if (path === "/imports/job-1/comparison")
        return {
          matchedFiles: [
            {
              currentFile: "source.xlsx",
              priorFile: "old.xlsx",
              priorJobId: "old-job",
              priorJobStatus: "committed",
              sha256: "1234567890abcdef",
            },
          ],
          records: [
            {
              recordId: "record-1",
              sheetName: "V1Fish",
              sourceLocator: "A2",
              recordKind: "fish",
              activeTargetId: "fish-1",
              previousJobId: null,
              previousRecordId: null,
              sameSourcePosition: true,
              sourceChanged: true,
              workingChanged: true,
              changedFieldCount: 1,
              changedFields: [{ field: "L", before: "unknown", after: "alive" }],
            },
          ],
        };
      if (path === "/imports/job-1/historical-structure")
        return {
          total: 1,
          items: [
            {
              id: "experiment-1",
              sourceSheet: "V1Raw",
              sourceKind: "SCNT",
              experimentDate: "2024-01-01",
              siteId: "site-1",
              recipientSource: "AB",
              eggCodeSource: "egg",
              groupSource: "group",
              csofSource: "CSOF",
              lots: [
                {
                  id: "lot-1",
                  lotNoSource: "1",
                  donorSource: "AB",
                  injectionSource: "needle",
                  activationLocalTime: "09:00",
                },
              ],
            },
          ],
        };
      if (path === "/imports/deferred-fields")
        return {
          total: 1,
          items: [
            {
              id: "field-1",
              jobId: "job-1",
              sheetName: "V1Fish",
              sourceLocator: "A2",
              sourceColumn: "Q",
              sourceValue: "value",
              status: "pending",
              targetTable: "clone_fish",
              targetId: "fish-1",
              targetFields: ["notes"],
              rowVersion: 1,
            },
          ],
        };
      if (path === "/imports/job-1/records/record-1/interpretation")
        return { interpretation: { fishCode: "CL1", observations: [{ day: 1 }] } };
      if (path === "/imports/job-1/confirm-fish-specimens") return { fishCount: 1, specimenCount: 1 };
      if (path === "/imports/job-1/confirm-aggregate") return { historicalCountRows: 1 };
      if (path === "/imports/job-1/confirm-v2-embryos")
        return { historicalEmbryoCount: 1, historicalObservationCount: 1, historicalControlCount: 1 };
      return {};
    })();
    return new Response(JSON.stringify(result), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function openJob() {
  await flush();
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>(".import-page__jobs button"))[0];
  await act(async () => {
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function clickButton(label: string) {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) => candidate.textContent === label,
  );
  expect(button, label).toBeDefined();
  await act(async () => {
    button?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function fill(control: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), "value")?.set;
  await act(async () => {
    setter?.call(control, value);
    control.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

it("shows a reviewable import draft with source, issues, mapping, and deferred fields", async () => {
  const fetchMock = mockImportApi();
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root.render(<Imports language="en" />));
  await openJob();
  expect(document.body.textContent).toContain("Review duplicate sources and changes");
  expect(document.body.textContent).toContain("Confirm all selected sheets");
  expect(document.body.textContent).toContain("Check fish status");
  const interpretation = Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent === "View interpretation",
  );
  await act(async () => {
    interpretation?.click();
    await Promise.resolve();
  });
  expect(document.body.textContent).toContain("Interpreted values");
  const deferred = Array.from(document.querySelectorAll("button")).find(
    (button) => button.textContent === "Deferred fields",
  );
  await act(async () => {
    deferred?.click();
    await Promise.resolve();
  });
  expect(document.body.textContent).toContain("Source values awaiting field mapping");
  expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/imports/deferred-fields"), expect.anything());
  const deferredReason = document.querySelectorAll<HTMLInputElement>(".import-page__deferred-edit input")[1];
  await fill(deferredReason, "Add researcher notes");
  await clickButton("Apply value");
  expect(document.body.textContent).toContain("Deferred source value applied");
  root.unmount();
});

it("shows committed fish status and guarded rollback actions", async () => {
  const fetchMock = mockImportApi("committed");
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root.render(<Imports language="en" />));
  await openJob();
  expect(document.body.textContent).toContain("Review imported fish status");
  expect(document.body.textContent).toContain("Source experiments and lots");
  expect(document.body.textContent).toContain("Check and revert job");
  await fill(
    document.querySelector<HTMLInputElement>(".import-page__status-row input:not([type='date'])")!,
    "Lab notebook",
  );
  await clickButton("Save status");
  await fill(
    document.querySelector<HTMLTextAreaElement>(".import-page__mapping .import-page__warning textarea")!,
    "Wrong file",
  );
  await clickButton("Check and revert job");
  expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/revert"))).toBe(true);
  root.unmount();
});

it("inspects an XLSX, creates a draft, and exercises review decisions", async () => {
  const fetchMock = mockImportApi();
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root.render(<Imports language="en" />));
  const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(fileInput, "files", { configurable: true, value: [new File(["source"], "source.xlsx")] });
  await act(async () => fileInput.dispatchEvent(new Event("change", { bubbles: true })));
  await clickButton("Inspect files");
  const sheetChoice = document.querySelector<HTMLInputElement>('fieldset input[type="checkbox"]')!;
  await act(async () => sheetChoice.click());
  await clickButton("Create draft");
  expect(document.body.textContent).toContain("Draft saved");
  expect(
    fetchMock.mock.calls.some(([input, init]) => String(input).endsWith("/imports") && init?.method === "POST"),
  ).toBe(true);
  await clickButton("Edit values");
  const editReason = Array.from(document.querySelectorAll<HTMLInputElement>(".import-page__comparison input"))[0];
  await fill(editReason, "Correct source row");
  await clickButton("Save");
  expect(document.body.textContent).toContain("Edit saved");
  const issue = Array.from(document.querySelectorAll<HTMLElement>("article.import-page__item")).find((item) =>
    item.textContent?.includes("Check fish status"),
  )!;
  const inputs = issue.querySelectorAll<HTMLInputElement>("input");
  await fill(inputs[1], "Reviewed against workbook");
  await fill(inputs[2], "Alive");
  await clickButton("Apply and validate cell");
  expect(document.body.textContent).toContain("Cell corrected");
  const refreshedIssue = Array.from(document.querySelectorAll<HTMLElement>("article.import-page__item")).find((item) =>
    item.textContent?.includes("Check fish status"),
  )!;
  await act(async () => refreshedIssue.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  const bulkSection = Array.from(document.querySelectorAll<HTMLElement>(".import-page__mapping")).find((section) =>
    section.textContent?.includes("Bypass several issues on this page"),
  )!;
  await fill(bulkSection.querySelector<HTMLTextAreaElement>("textarea")!, "Source status cannot be confirmed");
  await clickButton("Bypass 1 selected");
  expect(document.body.textContent).toContain("Bypassed 1 issues");
  root.unmount();
});

it("confirms each supported draft type through the guarded actions", async () => {
  const fetchMock = mockImportApi("draft", true);
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root.render(<Imports language="en" />));
  await openJob();
  for (const label of [
    "Confirm all selected sheets",
    "Confirm entire job",
    "Confirm entire embryo job",
    "Confirm entire count job",
  ]) {
    await clickButton(label);
  }
  expect(fetchMock.mock.calls.filter(([input]) => String(input).includes("/confirm-")).length).toBe(4);
  root.unmount();
});

it("renders the draft and deferred review in Thai", async () => {
  mockImportApi();
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root.render(<Imports language="th" />));
  await openJob();
  expect(document.querySelectorAll(".import-page__mapping").length).toBeGreaterThan(2);
  await act(async () => {
    document.querySelectorAll<HTMLButtonElement>(".import-page__tabs button")[1].click();
    await Promise.resolve();
  });
  expect(document.querySelectorAll(".import-page__deferred-edit")).toHaveLength(1);
  root.unmount();
});

it("renders committed summaries and fish status in Thai", async () => {
  mockImportApi("committed");
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root.render(<Imports language="th" />));
  await openJob();
  expect(document.querySelectorAll(".import-page__status-row")).toHaveLength(1);
  expect(document.querySelectorAll(".import-page__experiment")).toHaveLength(1);
  root.unmount();
});

it("inspects separate CSV sheets and sends the selected source options", async () => {
  const fetchMock = mockImportApi("draft", false, "csv_set");
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root.render(<Imports language="en" />));
  const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(fileInput, "files", { configurable: true, value: [new File(["A,B"], "V1Fish.csv")] });
  await act(async () => fileInput.dispatchEvent(new Event("change", { bubbles: true })));
  await clickButton("Inspect files");
  expect(document.body.textContent).toContain("Source sheet name");
  expect(document.body.textContent).toContain("A | B");
  const include = document.querySelector<HTMLInputElement>('.import-page__csv input[type="checkbox"]')!;
  await act(async () => include.click());
  await fill(document.querySelector<HTMLInputElement>(".import-page__csv input:not([type='checkbox'])")!, "Duplicate");
  expect(document.querySelector<HTMLButtonElement>(".import-page__panel button:last-of-type")?.disabled).toBe(true);
  await act(async () => include.click());
  await clickButton("Create draft");
  const create = fetchMock.mock.calls.find(
    ([input, init]) => String(input).endsWith("/imports") && init?.method === "POST",
  );
  const form = create?.[1]?.body as FormData;
  expect(JSON.parse(String(form.get("selection")))).toEqual({
    files: [{ include: true, sheetName: "V1Fish", encoding: "utf-8-sig", delimiter: ",", ignoreReason: "Duplicate" }],
  });
  root.unmount();
});

it("shows the CSV source choices in Thai", async () => {
  mockImportApi("draft", false, "csv_set");
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root.render(<Imports language="th" />));
  const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(fileInput, "files", { configurable: true, value: [new File(["A,B"], "V1Fish.csv")] });
  await act(async () => fileInput.dispatchEvent(new Event("change", { bubbles: true })));
  await act(async () => {
    document.querySelector<HTMLButtonElement>(".import-page__panel button")!.click();
    await Promise.resolve();
  });
  expect(document.querySelectorAll(".import-page__csv")).toHaveLength(1);
  root.unmount();
});
