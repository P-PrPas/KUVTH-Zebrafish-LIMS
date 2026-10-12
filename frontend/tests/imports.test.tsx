// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { Imports } from "../src/pages/imports";

const job = {
  id: "job-1",
  status: "draft",
  inputKind: "xlsx",
  revision: 2,
  createdAt: "2024-01-01T00:00:00Z",
};
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
          ? {
              inputKind,
              files: [{ name: "source.xlsx", sheets: ["V1Fish"] }],
            }
          : {
              inputKind,
              files: [
                {
                  name: "V1Fish.csv",
                  encoding: "utf-8-sig",
                  delimiter: ",",
                  preview: [["A", "B"]],
                },
              ],
            };
      if (path === "/imports" && init?.method === "POST") return { job: { ...job, status }, deferredFieldCount: 1 };
      if (path === "/imports/job-1")
        return {
          job: { ...job, status },
          files: [
            {
              id: "file-1",
              fileName: "source.xlsx",
              sha256: "1234567890abcdef",
              sizeBytes: 42,
            },
          ],
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
      if (path === "/sites")
        return {
          items: [{ id: "site-1", code: "KU", timeZone: "Asia/Bangkok" }],
        };
      if (path === "/donor-cell-lines")
        return {
          items: [{ id: "donor-1", strain: "AB", preparation: "CHUNKS" }],
        };
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
            {
              subjectType: "fish",
              stageLabel: "Day1",
              outcome: "ALIVE",
              timePrecision: "date",
              count: 1,
            },
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
        return {
          interpretation: { fishCode: "CL1", observations: [{ day: 1 }] },
        };
      if (path === "/imports/job-1/confirm-fish-specimens") return { fishCount: 1, specimenCount: 1 };
      if (path === "/imports/job-1/confirm-aggregate") return { historicalCountRows: 1 };
      if (path === "/imports/job-1/confirm-v2-embryos")
        return {
          historicalEmbryoCount: 1,
          historicalObservationCount: 1,
          historicalControlCount: 1,
        };
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

it.each(["en", "th"] as const)(
  "reviews embryo interpretation, warning decisions and paginated source rows (%s)",
  async (language) => {
    const api = mockImportApi();
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await api(input, init);
      const body = await response.json();
      const url = String(input);
      if (url.endsWith("/imports/job-1")) body.recordCount = 51;
      if (url.includes("/records?") || url.endsWith("/records")) {
        body.items[0].recordKind = "embryo_candidate";
      }
      if (url.endsWith("/interpretation"))
        body.interpretation = {
          stageObservations: [{ stage: "2-cell" }],
          dailySurvival: [{ day: 1 }],
          counts: [1],
          controlCounts: [2],
        };
      if ((url.includes("/issues?") || url.endsWith("/issues")) && !init?.method) {
        body.items = [
          {
            ...body.items[0],
            id: "warning",
            recordId: null,
            rowNo: null,
            sourceColumn: null,
            sourceValue: null,
            severity: "warning",
            message: "Verify source layout",
          },
          { ...body.items[0], id: "closed", status: "corrected", severity: "blocking" },
        ];
      }
      return new Response(JSON.stringify(body));
    });
    const root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(async () => root.render(<Imports language={language} />));
    await openJob();
    const issue = Array.from(document.querySelectorAll<HTMLElement>("article.import-page__item")).find((item) =>
      item.textContent?.includes("Verify source layout"),
    )!;
    expect(issue.querySelectorAll("input")).toHaveLength(1);
    await fill(issue.querySelector<HTMLInputElement>("input")!, "Reviewed original workbook");
    await act(async () => {
      issue.querySelector<HTMLButtonElement>("button")!.click();
      await Promise.resolve();
    });
    await flush();
    expect(
      api.mock.calls.some(
        ([input, init]) =>
          String(input).endsWith("/decision") && JSON.parse(String(init?.body)).decision === "dismissed",
      ),
    ).toBe(true);
    await clickButton(language === "en" ? "View interpretation" : "ดูความหมายที่ระบบอ่านได้");
    expect(document.body.textContent).toContain(language === "en" ? "Recorded embryo stages: 1" : "ระยะตัวอ่อนที่บันทึก: 1");
    const pager = Array.from(document.querySelectorAll<HTMLElement>(".import-page__pager")).at(-1)!;
    await act(async () => {
      pager.querySelectorAll<HTMLButtonElement>("button")[1].click();
      await Promise.resolve();
    });
    await flush();
    expect(api.mock.calls.some(([input]) => String(input).includes("offset=50"))).toBe(true);
    root.unmount();
  },
);

it.each(["en", "th"] as const)("archives summary-only sheets as references (%s)", async (language) => {
  const api = mockImportApi("draft", true);
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await api(input, init);
    const body = await response.json();
    if (String(input).endsWith("/mapping-requirements"))
      Object.assign(body, {
        recordKinds: ["reconciliation"],
        canConfirmFishSpecimens: false,
        canConfirmEmbryos: false,
        canConfirmAggregate: false,
      });
    if (String(input).endsWith("/comparison")) Object.assign(body, { matchedFiles: [], records: [] });
    return new Response(JSON.stringify(body));
  });
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root.render(<Imports language={language} />));
  await openJob();
  const button = document.querySelector<HTMLButtonElement>(".import-page__mapping button")!;
  await act(async () => {
    button.click();
    await Promise.resolve();
  });
  await flush();
  expect(api.mock.calls.some(([input]) => String(input).endsWith("/confirm-all"))).toBe(true);
  expect(document.body.textContent).toContain(
    language === "en" ? "Summary sheets archived as references" : "เก็บชีตสรุปเป็นเอกสารอ้างอิงแล้ว",
  );
  root.unmount();
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

it.each(["en", "th"] as const)(
  "expands historical counts and preserves evidence for fish disposition changes (%s)",
  async (language) => {
    const api = mockImportApi("committed");
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await api(input, init);
      const body = await response.json();
      if (String(input).endsWith("/historical-summary")) {
        body.stageCounts = Array.from({ length: 31 }, (_, index) => ({
          stageLabel: `Day${index}`,
          armType: null,
          nTotal: null,
          nAlive: null,
          nNormal: 2,
          nAbnormal: 1,
        }));
        body.observations = [
          { subjectType: "embryo", stageLabel: null, outcome: null, timePrecision: "date", count: 1 },
        ];
      }
      if (String(input).includes("/historical-structure")) {
        const experiment = body.items[0];
        Object.assign(experiment, {
          experimentDate: null,
          recipientSource: null,
          eggCodeSource: null,
          groupSource: null,
          csofSource: null,
        });
        Object.assign(experiment.lots[0], {
          lotNoSource: null,
          donorSource: null,
          injectionSource: null,
          activationLocalTime: null,
        });
      }
      return new Response(JSON.stringify(body));
    });
    const root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(async () => root.render(<Imports language={language} />));
    await openJob();
    expect(document.body.textContent).not.toContain("Day30");
    await clickButton(language === "en" ? "Show all" : "แสดงทั้งหมด");
    expect(document.body.textContent).toContain("Day30");
    await clickButton(language === "en" ? "Show less" : "แสดงน้อยลง");
    expect(document.body.textContent).not.toContain("Day30");
    const controls = document.querySelectorAll<HTMLSelectElement>(".import-page__status-row select");
    for (const status of ["ALIVE", "DEAD", "FROZEN", "DISCARDED", "UNKNOWN"]) {
      await act(async () => {
        controls[0].value = status;
        controls[0].dispatchEvent(new Event("change", { bubbles: true }));
      });
      expect(controls[1].value).toBe(status === "ALIVE" || status === "DEAD" ? status : "UNKNOWN");
      expect(controls[2].value).toBe(status === "FROZEN" || status === "DISCARDED" ? status : "NONE");
    }
    await act(async () => {
      controls[1].value = "DEAD";
      controls[1].dispatchEvent(new Event("change", { bubbles: true }));
      controls[2].value = "LOST";
      controls[2].dispatchEvent(new Event("change", { bubbles: true }));
    });
    await fill(document.querySelector<HTMLInputElement>(".import-page__status-row input[type='date']")!, "2026-04-29");
    await fill(
      document.querySelector<HTMLInputElement>(".import-page__status-row input:not([type='date'])")!,
      "Lab notebook evidence",
    );
    await clickButton(language === "en" ? "Save status" : "บันทึกสถานะ");
    const saved = api.mock.calls.find(([input]) => String(input).endsWith("/fish-status/fish-1"));
    expect(JSON.parse(String(saved?.[1]?.body))).toMatchObject({
      disposition: "LOST",
      exitDate: "2026-04-29",
      reason: "Lab notebook evidence",
      rowVersion: 1,
    });
    root.unmount();
  },
);

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
  Object.defineProperty(fileInput, "files", {
    configurable: true,
    value: [new File(["source"], "source.xlsx")],
  });
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
  Object.defineProperty(fileInput, "files", {
    configurable: true,
    value: [new File(["A,B"], "V1Fish.csv")],
  });
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
    files: [
      {
        include: true,
        sheetName: "V1Fish",
        encoding: "utf-8-sig",
        delimiter: ",",
        ignoreReason: "Duplicate",
      },
    ],
  });
  root.unmount();
});

it("shows the CSV source choices in Thai", async () => {
  mockImportApi("draft", false, "csv_set");
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root.render(<Imports language="th" />));
  const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(fileInput, "files", {
    configurable: true,
    value: [new File(["A,B"], "V1Fish.csv")],
  });
  await act(async () => fileInput.dispatchEvent(new Event("change", { bubbles: true })));
  await act(async () => {
    document.querySelector<HTMLButtonElement>(".import-page__panel button")!.click();
    await Promise.resolve();
  });
  expect(document.querySelectorAll(".import-page__csv")).toHaveLength(1);
  root.unmount();
});

it.each(["en", "th"] as const)("keeps a missing embryo identity editable and blocks bypass (%s)", async (language) => {
  const api = mockImportApi();
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await api(input, init);
    if (String(input).includes("/issues") && !init?.method) {
      const body = await response.json();
      body.items[0] = {
        ...body.items[0],
        severity: "blocking",
        code: "embryo_incomplete",
        sourceColumn: "AJ",
        sourceValue: "",
        message: "Source embryo number is missing",
      };
      return new Response(JSON.stringify(body));
    }
    if (String(input).endsWith("/correct-cell")) {
      return new Response(
        JSON.stringify({
          error: {
            code: "invalid_correction",
            message: "Source embryo number is missing",
          },
        }),
        { status: 409 },
      );
    }
    return response;
  });
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root.render(<Imports language={language} />));
  await openJob();
  const issue = Array.from(document.querySelectorAll<HTMLElement>("article.import-page__item")).find((item) =>
    item.textContent?.includes("Source embryo number is missing"),
  )!;
  expect(issue.querySelector('input[type="checkbox"]')).toBeNull();
  expect(issue.querySelectorAll("button")).toHaveLength(2);
  const inputs = issue.querySelectorAll<HTMLInputElement>("input");
  await fill(inputs[0], "Verified lab notebook");
  await fill(inputs[1], "invalid");
  await act(async () => {
    issue.querySelector<HTMLButtonElement>("button")!.click();
    await Promise.resolve();
  });
  await flush();
  expect(document.body.textContent).toContain("Source embryo number is missing");
  expect(
    api.mock.calls.some(
      ([input, init]) => String(input).endsWith("/correct-cell") && JSON.parse(String(init?.body)).revision === 2,
    ),
  ).toBe(true);
  root.unmount();
});

it.each(["en", "th"] as const)("renders all guarded confirmation paths in %s", async (language) => {
  const api = mockImportApi("draft", true);
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root.render(<Imports language={language} />));
  await openJob();
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".import-page__mapping button")).filter(
    (button) => button.textContent?.includes(language === "en" ? "Confirm" : "ยืนยัน"),
  );
  expect(buttons).toHaveLength(4);
  for (const button of buttons) {
    await act(async () => {
      button.click();
      await Promise.resolve();
    });
    await flush();
  }
  expect(api.mock.calls.filter(([input]) => String(input).includes("/confirm-")).length).toBe(4);
  root.unmount();
});

it.each(["/confirm-all", "/confirm-fish-specimens", "/confirm-v2-embryos", "/confirm-aggregate"])(
  "shows stale revision errors from %s without claiming success",
  async (endpoint) => {
    const api = mockImportApi("draft", true);
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith(endpoint)
        ? new Response(
            JSON.stringify({
              error: {
                code: "revision_conflict",
                message: "Draft changed; reload before confirming",
              },
            }),
            { status: 409 },
          )
        : api(input, init),
    );
    const root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(async () => root.render(<Imports language="en" />));
    await openJob();
    const labels: Record<string, string> = {
      "/confirm-all": "Confirm all selected sheets",
      "/confirm-fish-specimens": "Confirm entire job",
      "/confirm-v2-embryos": "Confirm entire embryo job",
      "/confirm-aggregate": "Confirm entire count job",
    };
    await clickButton(labels[endpoint]);
    expect(document.body.textContent).toContain("Draft changed; reload before confirming");
    root.unmount();
  },
);
