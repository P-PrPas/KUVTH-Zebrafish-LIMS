// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Export, PrintableDashboard } from "../src/pages/export";
import { text } from "../src/types";

const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });

describe("export page", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    window.history.replaceState(null, "", "/#export");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("loads the printable report from one filtered dashboard snapshot", async () => {
    window.history.replaceState(null, "", "/?siteId=site-1&status=DEAD#export");
    const print = vi.fn();
    Object.defineProperty(window, "print", { configurable: true, value: print });
    let resolveDashboard!: (response: Response) => void;
    const dashboardResponse = new Promise<Response>((resolve) => {
      resolveDashboard = resolve;
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.includes("/analytics/dashboard")) {
        return dashboardResponse;
      }
      return json({ items: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const rootElement = document.createElement("div");
    document.body.append(rootElement);
    const root = createRoot(rootElement);

    await act(async () => {
      root.render(<Export t={text.en} />);
    });
    const printButton = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Print / PDF"),
    ) as HTMLButtonElement;
    expect(printButton.disabled).toBe(true);
    await act(async () => {
      printButton.click();
    });
    expect(print).not.toHaveBeenCalled();

    await act(async () => {
      resolveDashboard(
        json({
          reportMeta: { generatedAt: "2026-08-24T10:00:00Z", timingProfileVersions: [1] },
          kpi: {
            stage1: { nActivated: 3, nPromoted: 1, pctNormal: null, controlComparison: [] },
            stage2: { nAlive: 1, nFrozen: 0, nDiscarded: 0, nNormal: 1, nAbnormal: 0 },
          },
          funnel: { items: [] },
          survival: { items: [] },
          timingDeviation: { items: [] },
          abnormalityOnset: { items: [] },
          fishSurvival: { items: [] },
          observationGaps: { items: [] },
          pipeline: { items: [{ step: "Activated", count: 0, pctOfStart: null, pctOfPrevious: null }] },
        }),
      );
      await dashboardResponse;
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const dashboardCalls = fetchMock.mock.calls.filter(([input]) => String(input).includes("/analytics/dashboard"));
    expect(dashboardCalls).toHaveLength(1);
    expect(String(dashboardCalls[0][0])).toContain("siteId=site-1");
    expect(String(dashboardCalls[0][0])).not.toContain("status=DEAD");
    expect(document.body.textContent).toContain("Filters: Site: site-1");
    expect(document.body.textContent).not.toContain("status=DEAD");
    expect(document.querySelector(".print-report__meta > div:last-child dd")?.textContent).toBe("1");
    expect(document.querySelector(".print-report__meta > div:first-child dd")?.textContent).toBe(
      "24/08/2026 17:00 UTC+7",
    );
    expect(document.body.textContent).toContain("Unknown");
    expect(document.body.textContent).toContain("Download R CSV");

    expect(printButton.disabled).toBe(false);
    await act(async () => {
      printButton?.click();
    });
    expect(print).toHaveBeenCalledOnce();
    root.unmount();
  });

  it("shows a loading state and an error when the dashboard snapshot fails", async () => {
    let resolveDashboard!: (response: Response) => void;
    const dashboardResponse = new Promise<Response>((resolve) => {
      resolveDashboard = resolve;
    });
    const fetchMock = vi.fn().mockReturnValue(dashboardResponse);
    vi.stubGlobal("fetch", fetchMock);
    const rootElement = document.createElement("div");
    document.body.append(rootElement);
    const root = createRoot(rootElement);

    await act(async () => {
      root.render(<PrintableDashboard filters={{}} t={text.en} />);
    });
    expect(document.body.textContent).toContain("Preparing report…");
    await act(async () => {
      resolveDashboard(new Response("unavailable", { status: 500 }));
      await dashboardResponse;
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.body.textContent).toContain("HTTP 500");
    expect(fetchMock).toHaveBeenCalledOnce();
    root.unmount();
  });

  it("renders populated analytical panels and opens a print preview", async () => {
    window.history.replaceState(null, "", "/?siteId=site-1#export");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/sites"))
        return json({ items: [{ id: "site-1", code: "KUVACB", name: "Animal Cell Bank" }] });
      if (String(input).includes("/analytics/dashboard"))
        return json({
          reportMeta: { generatedAt: "2026-09-02T01:00:00Z", timingProfileVersions: [3, 4] },
          kpi: {
            stage1: {
              nActivated: 10,
              nPromoted: 4,
              nReachedShield: 3,
              nReachedDay1: 2,
              nBatches: 1,
              pctNormal: 50,
              controlComparison: [
                { armType: "SCNT", stageLabel: "Shield", n: 3, nNormal: 2, nAbnormal: 1, pctNormal: 66.7 },
              ],
            },
            stage2: { nAlive: 2, nFrozen: 1, nDiscarded: 1, nNormal: 2, nAbnormal: 1 },
          },
          funnel: { items: [{ step: "Activated", count: 10, pctOfStart: 100, pctOfPrevious: 100 }] },
          survival: { items: [{ site: "KU", strain: "AB", stageLabel: "Shield", riskSet: 4, alive: 3, surv: 0.75 }] },
          timingDeviation: {
            items: [
              {
                treatmentGroup: "SCNT",
                siteId: "site-1",
                strain: "AB",
                stageLabel: "Shield",
                n: 3,
                meanDeviationH: 1,
                medianDeviationH: 1,
                sdDeviationH: 0.5,
              },
            ],
          },
          abnormalityOnset: { items: [{ stageLabel: "Day 1", count: 1 }] },
          fishSurvival: {
            items: [
              {
                condition: "NORMAL",
                strain: "AB",
                treatmentGroup: "SCNT",
                ageDays: 30,
                atRisk: 3,
                alive: 2,
                nDead: 1,
                nFrozen: 0,
                nDiscarded: 0,
                nMale: 1,
                nFemale: 1,
                nBoxes: 1,
                surv: 0.67,
              },
            ],
          },
          observationGaps: { items: [{ fishCode: "F-1", lastObservedOn: "2026-09-01", missedDays: 2 }] },
          pipeline: { items: [{ step: "Activated", count: 10, pctOfStart: 100, pctOfPrevious: 100 }] },
        });
      return json({ items: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const rootElement = document.createElement("div");
    document.body.append(rootElement);
    const root = createRoot(rootElement);
    await act(async () => {
      root.render(<Export t={text.en} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const preview = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Preview report before printing",
    ) as HTMLButtonElement;
    expect(preview.disabled).toBe(false);
    await act(async () => {
      preview.click();
      await Promise.resolve();
    });
    expect(document.querySelector(".report-preview")?.className).toContain("report-preview--open");
    expect(document.querySelector(".print-report--meeting")).not.toBeNull();
    expect(document.body.textContent).toContain("Filters: Site: Animal Cell Bank");
    expect(document.body.textContent).toContain("KUVACB / AB / SCNT");
    await act(async () => {
      (document.querySelector('input[name="report-format"][value="full"]') as HTMLInputElement).click();
    });
    expect(document.querySelector(".print-report--full")).not.toBeNull();
    expect(document.body.textContent).toContain("Stage 1 survival curve");
    expect(document.body.textContent).not.toContain("SCNT / control comparison");
    expect(document.body.textContent).toContain("F-1");
    expect(document.querySelector(".print-report__meta > div:last-child dd")?.textContent).toBe("3, 4");
    root.unmount();
  });

  it("keeps a large meeting brief bounded, ranks follow-up rows and preserves every row in full mode", async () => {
    const gaps = Array.from({ length: 500 }, (_, i) => ({
      fishCode: `F-${i}`,
      lastObservedOn: "2026-09-01",
      missedDays: i,
    }));
    const deviations = Array.from({ length: 500 }, (_, i) => ({
      treatmentGroup: `Group-${i}`,
      stageLabel: "Shield",
      n: 5,
      medianDeviationH: -i / 10,
    }));
    const comparisons = Array.from({ length: 500 }, (_, i) => ({
      armType: `Arm-${i}`,
      stageLabel: "Shield",
      n: i,
      nNormal: 0,
      nAbnormal: 0,
      pctNormal: null,
    }));
    const fetchMock = vi.fn(async () =>
      json({
        reportMeta: { generatedAt: "2026-09-02T01:00:00Z" },
        kpi: {
          stage1: { nActivated: 1200, controlComparison: comparisons },
          stage2: { nAlive: 100 },
          meta: { unknown: { fishSex: 3 } },
        },
        survival: { items: [{ stageLabel: "Unconfirmed checkpoint", riskSet: null, alive: null, surv: null }] },
        observationGaps: { items: gaps },
        timingDeviation: { items: deviations },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const element = document.createElement("div");
    document.body.append(element);
    const root = createRoot(element);
    await act(async () => {
      root.render(<PrintableDashboard filters={{}} t={text.en} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const tables = document.querySelectorAll(".meeting-page--review table");
    expect(tables).toHaveLength(2);
    for (const table of tables) expect(table.querySelectorAll("tbody tr")).toHaveLength(5);
    expect(tables[0].querySelector("tbody tr")?.textContent).toContain("F-499");
    expect(tables[1].querySelector("tbody tr")?.textContent).toContain("Group-499");
    expect(document.body.textContent).not.toContain("Arm-499");
    expect(document.body.textContent).toContain("Showing 5 of 500 rows");
    expect(document.body.textContent).toContain("Incomplete source data");
    expect(document.querySelector(".report-headline-metrics strong")?.textContent).toBe("1,200");
    expect(document.querySelectorAll(".report-headline-metrics strong")[1].textContent).toBe("—");
    expect(gaps[0].fishCode).toBe("F-0");
    await act(async () => {
      root.render(<PrintableDashboard filters={{}} t={text.en} mode="full" />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.querySelectorAll(".print-report--full tbody tr").length).toBeGreaterThanOrEqual(1000);
    expect(document.body.textContent).not.toContain("Arm-499");
    expect(document.body.textContent).toContain("F-0");
    expect(document.body.textContent).toContain("F-499");
    const survivalPanel = Array.from(document.querySelectorAll(".report-panel")).find(
      (panel) => panel.querySelector("h2")?.textContent === "Stage 1 survival curve",
    );
    expect(survivalPanel?.querySelector(":scope > .table-wrap tbody tr")?.textContent).toContain(
      "Unconfirmed checkpoint——Unknown",
    );
    root.unmount();
  });

  it("downloads Excel and R files with the selected export format", async () => {
    sessionStorage.setItem("chronofish.operator_id", "operator-1");
    const createObjectURL = vi.fn(() => "blob:download");
    const revokeObjectURL = vi.fn();
    const originalCreate = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
    const originalRevoke = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: createObjectURL },
      revokeObjectURL: { configurable: true, value: revokeObjectURL },
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.includes("/analytics/dashboard"))
        return json({
          reportMeta: {},
          kpi: {},
          funnel: { items: [] },
          survival: { items: [] },
          timingDeviation: { items: [] },
          abnormalityOnset: { items: [] },
          fishSurvival: { items: [] },
          observationGaps: { items: [] },
          pipeline: { items: [] },
        });
      if (path.includes("/exports/")) return new Response("export", { headers: { "Content-Type": "text/csv" } });
      return json({ items: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const rootElement = document.createElement("div");
    document.body.append(rootElement);
    const root = createRoot(rootElement);
    await act(async () => {
      root.render(<Export t={text.en} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Download Excel"))
        ?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Download R CSV"))
        ?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(
      fetchMock.mock.calls.some(([input, init]) => String(input).endsWith("/exports/excel") && init?.method === "POST"),
    ).toBe(true);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/exports/r-table"))).toBe(true);
    expect(click).toHaveBeenCalledTimes(2);
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
    const cleanForm = document.querySelector(".export-clean-form") as HTMLFormElement;
    const ageInputs = Array.from(cleanForm.querySelectorAll<HTMLInputElement>('input[type="number"]'));
    await act(async () => {
      ageInputs.forEach((input, index) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, [7, 30, 90][index]);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    });
    await act(async () => {
      cleanForm.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input).endsWith("/exports/excel") &&
          JSON.parse(String(init?.body)).format === "clean" &&
          JSON.parse(String(init?.body)).fishStageAgeDays.join() === "7,30,90",
      ),
    ).toBe(true);
    expect(click).toHaveBeenCalledTimes(3);
    if (originalCreate) Object.defineProperty(URL, "createObjectURL", originalCreate);
    else delete (URL as typeof URL & { createObjectURL?: unknown }).createObjectURL;
    if (originalRevoke) Object.defineProperty(URL, "revokeObjectURL", originalRevoke);
    else delete (URL as typeof URL & { revokeObjectURL?: unknown }).revokeObjectURL;
    root.unmount();
  });
});
