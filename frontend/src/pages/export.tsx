import { useEffect, useState } from "react";
import { type ApiItem, get, request } from "../api/client";
import { ErrorMessage, Metric, ReportPanel, ReportTable } from "../components";
import { analyticsFilters, type DashboardFilters, parseFilters, updateFilterURL, withFilters } from "../filters";
import { notify } from "../notifications";
import { formatBangkokDate, formatBangkokDateTime } from "../time";
import { type AppText, text } from "../types";
import { FilterBar, FunnelChart, percent, SurvivalChart, useDashboardMasterOptions } from "./dashboard";

type PrintableReport = {
  generatedAt: string;
  timingProfileVersions: number[];
  kpi: ApiItem | null;
  funnel: ApiItem[];
  survival: ApiItem[];
  deviation: ApiItem[];
  abnormality: ApiItem[];
  fishSurvival: ApiItem[];
  gaps: ApiItem[];
  pipeline: ApiItem[];
  loading: boolean;
  error: string;
};

function filterSummary(
  filters: DashboardFilters,
  thai: boolean,
  options?: ReturnType<typeof useDashboardMasterOptions>,
): string {
  const labels: Record<string, string> = {
    siteId: thai ? "สถานที่" : "Site",
    batchId: thai ? "รอบทดลอง" : "Batch",
    operatorId: thai ? "ผู้ปฏิบัติงาน" : "Operator",
    experimentGroupId: thai ? "โครงการวิจัย" : "Experiment group",
    treatmentGroupId: thai ? "แขนการทดลอง" : "Treatment group",
    donorCellLineId: thai ? "เซลล์ผู้ให้" : "Donor cell line",
    strain: thai ? "สายพันธุ์" : "Strain",
    dateFrom: thai ? "ตั้งแต่" : "From",
    dateTo: thai ? "ถึง" : "To",
  };
  const lists: Record<string, ApiItem[] | undefined> = {
    siteId: options?.sites,
    batchId: options?.batches,
    operatorId: options?.operators,
    experimentGroupId: options?.groups,
    treatmentGroupId: options?.treatments,
    donorCellLineId: options?.donors,
  };
  const values = Object.entries(filters).filter(([, value]) => value);
  return values.length === 0
    ? thai
      ? "ข้อมูลทั้งหมด"
      : "All records"
    : values
        .map(([key, value]) => {
          const item = lists[key]?.find((entry) => String(entry.id) === value);
          const display =
            key === "dateFrom" || key === "dateTo"
              ? formatBangkokDate(String(value))
              : (item?.name ?? item?.code ?? item?.batchCode ?? value);
          return `${labels[key] ?? key}: ${display}`;
        })
        .join(" · ");
}

function reportPercent(value: unknown, thai: boolean) {
  return value == null && thai ? "ไม่ทราบ" : percent(value);
}

function timingGroup(point: ApiItem, thai: boolean, siteLabels: Record<string, string>) {
  return (
    [point.siteId ? (siteLabels[String(point.siteId)] ?? point.siteId) : point.site, point.strain, point.treatmentGroup]
      .filter(Boolean)
      .join(" / ") || (thai ? "ทั้งหมด" : "All")
  );
}

export function Export({ t = text.en }: { t?: AppText } = {}) {
  const options = useDashboardMasterOptions();
  const [filters, setFilters] = useState<DashboardFilters>(() => analyticsFilters(parseFilters()));
  const [message, setMessage] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [reportReady, setReportReady] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [reportMode, setReportMode] = useState<"meeting" | "full">("meeting");
  const [fishAges, setFishAges] = useState(["", "", ""]);
  useEffect(() => {
    const onPop = () => setFilters(analyticsFilters(parseFilters()));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const download = async (path: string, init: RequestInit, filename: string) => {
    setDownloading(true);
    setMessage("");
    try {
      const response = await request(path, init);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.rel = "noopener";
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      notify(t === text.th ? "เตรียมไฟล์แล้ว เริ่มดาวน์โหลด" : "File ready. Download started.");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setDownloading(false);
    }
  };
  const downloadExcel = () =>
    download(
      "/exports/excel",
      { method: "POST", body: JSON.stringify({ locale: "th", filters }) },
      "kuvth-zebrafish-lims-export.xlsx",
    );
  const downloadRTable = () =>
    download(withFilters("/exports/r-table", filters), {}, "kuvth-zebrafish-lims-r-analysis.csv");
  const thai = t === text.th;
  return (
    <>
      <section className="export-controls">
        <div className="page-heading">
          <div>
            <p className="eyebrow">{thai ? "ข้อมูลพร้อมใช้งานต่อ" : "ANALYSIS-READY DATA"}</p>
            <h1>{thai ? "ดาวน์โหลดข้อมูลและรายงาน" : "Downloads and reports"}</h1>
            <p className="muted">
              {thai
                ? "เลือกข้อมูลชุดเดียวกับหน้าผลการทดลอง แล้วดาวน์โหลดในรูปแบบที่เหมาะกับงานต่อไป"
                : "Choose the same records used in Research results, then download the format that fits your next task."}
            </p>
          </div>
        </div>
        <FilterBar
          filters={filters}
          options={options}
          t={t}
          onChange={(next) => {
            setFilters(next);
            updateFilterURL(next);
          }}
        />
        <form
          className="form-card export-clean-form"
          onSubmit={(event) => {
            event.preventDefault();
            const ages = fishAges.map(Number);
            if (!(ages[0] < ages[1] && ages[1] < ages[2])) {
              setMessage(
                thai
                  ? "อายุ Fry, Juvenile และ Adult ต้องเรียงจากน้อยไปมาก"
                  : "Fry, Juvenile and Adult ages must increase in order.",
              );
              return;
            }
            void download(
              "/exports/excel",
              {
                method: "POST",
                body: JSON.stringify({ format: "clean", filters, fishStageAgeDays: ages }),
              },
              `kuvth-clean-fry${ages[0]}-juvenile${ages[1]}-adult${ages[2]}.xlsx`,
            );
          }}
        >
          <h2>{thai ? "Excel สำหรับวิเคราะห์ · Clean dataset" : "Analysis Excel · Clean dataset"}</h2>
          <p className="muted">
            {thai
              ? "30 คอลัมน์ตามไฟล์ตัวอย่าง · 1 แถวต่อสถานที่ สายพันธุ์ และซ้ำการทดลอง"
              : "30 columns matching the example · one row per site, strain and replicate"}
          </p>
          <fieldset className="filter-bar">
            <legend>
              {thai ? "กำหนดอายุที่ใช้วัดแต่ละระยะ (วันนับจากวันเกิด)" : "Age milestone for each stage (days from birth)"}
            </legend>
            {["Fry", "Juvenile", "Adult"].map((label, index) => (
              <label key={label}>
                {label}
                <input
                  type="number"
                  min="0"
                  step="1"
                  required
                  value={fishAges[index]}
                  onChange={(event) =>
                    setFishAges((current) =>
                      current.map((value, position) => (position === index ? event.target.value : value)),
                    )
                  }
                />
              </label>
            ))}
          </fieldset>
          <p className="table-note">
            {thai
              ? "ใช้เกณฑ์ของงานวิจัยนี้ นับปลาที่มีผลตรวจว่ารอดถึงอายุที่กำหนดหรือมากกว่า ค่า 0 หมายถึงยังไม่มีผลยืนยันว่ารอดถึงระยะนั้น เกณฑ์อายุจะแนบในชื่อไฟล์"
              : "Use your study's age criteria. Counts require an alive observation at or beyond each milestone. Zero means no confirmed survivors at that milestone. Ages are included in the filename."}
          </p>
          <button className="button button--primary" disabled={downloading} aria-busy={downloading}>
            {thai ? "ดาวน์โหลด Clean Excel" : "Download Clean Excel"}
          </button>
        </form>
        <fieldset className="report-format-picker">
          <legend>{thai ? "รูปแบบรายงาน PDF" : "PDF report format"}</legend>
          <label>
            <input
              type="radio"
              name="report-format"
              value="meeting"
              checked={reportMode === "meeting"}
              onChange={() => setReportMode("meeting")}
            />
            <span>
              <strong>{thai ? "สรุปสำหรับประชุม · 2 หน้า" : "Meeting brief · 2 pages"}</strong>
              <small>
                {thai ? "ผลรวม กระบวนการ และรายการสำคัญที่ต้องติดตาม" : "Totals, workflow and priority items for follow-up"}
              </small>
            </span>
          </label>
          <label>
            <input
              type="radio"
              name="report-format"
              value="full"
              checked={reportMode === "full"}
              onChange={() => setReportMode("full")}
            />
            <span>
              <strong>{thai ? "รายงานวิเคราะห์ฉบับเต็ม" : "Full analytical report"}</strong>
              <small>
                {thai
                  ? "กราฟและตารางครบทุกแถว · จำนวนหน้าขึ้นกับข้อมูล"
                  : "All charts and table rows · page count depends on the data"}
              </small>
            </span>
          </label>
        </fieldset>
        <div className="action-grid">
          <button className="action-card" onClick={downloadExcel} disabled={downloading} aria-busy={downloading}>
            <strong>{t.downloadExcel}</strong>
            <span>{thai ? "สำหรับตรวจข้อมูลและส่งต่อในทีม · 13 ชีต" : "For review and team handoff · 13 sheets"}</span>
          </button>
          <button className="action-card" onClick={downloadRTable} disabled={downloading} aria-busy={downloading}>
            <strong>{thai ? "ดาวน์โหลด R CSV" : "Download R CSV"}</strong>
            <span>
              {thai ? "สำหรับนำเข้า R โดยตรง · UTF-8 จำนวน 30 คอลัมน์" : "Ready for R · UTF-8, 30-column analysis table"}
            </span>
          </button>
          <button
            className="action-card"
            onClick={() => {
              notify(thai ? "เปิดหน้าต่างพิมพ์รายงาน" : "Opening the report print dialog.");
              window.print();
            }}
            type="button"
            disabled={!reportReady}
          >
            <strong>{t.printPDF}</strong>
            <span>
              {reportReady
                ? thai
                  ? reportMode === "meeting"
                    ? "พิมพ์สรุปผลสำหรับประชุม 2 หน้า"
                    : "พิมพ์รายงานวิเคราะห์ครบทุกแถว"
                  : reportMode === "meeting"
                    ? "Print the two-page meeting brief."
                    : "Print the complete analytical report."
                : thai
                  ? "กำลังเตรียมหน้ารายงาน…"
                  : "Preparing analytical panels…"}
            </span>
          </button>
        </div>
        <button
          className="button button--secondary"
          type="button"
          disabled={!reportReady}
          onClick={() => setPreviewOpen((value) => !value)}
        >
          {previewOpen
            ? thai
              ? "ซ่อนตัวอย่างรายงาน"
              : "Hide report preview"
            : thai
              ? "ดูตัวอย่างรายงานก่อนพิมพ์"
              : "Preview report before printing"}
        </button>
        {downloading && (
          <p className="table-note" role="status">
            {thai ? "กำลังเตรียมไฟล์…" : "Preparing export…"}
          </p>
        )}
        {message && <ErrorMessage message={message} toast />}
      </section>
      <div className={previewOpen ? "report-preview report-preview--open" : "report-preview"}>
        <PrintableDashboard
          filters={filters}
          t={t}
          mode={reportMode}
          scope={filterSummary(filters, thai, options)}
          siteLabels={Object.fromEntries(
            options.sites.map((site) => [String(site.id), String(site.code ?? site.name ?? site.id)]),
          )}
          onReadyChange={setReportReady}
        />
      </div>
    </>
  );
}

function MeetingReport({
  report,
  thai,
  siteLabels,
}: {
  report: PrintableReport;
  thai: boolean;
  siteLabels: Record<string, string>;
}) {
  const stage1 = report.kpi?.stage1 as ApiItem | undefined;
  const stage2 = report.kpi?.stage2 as ApiItem | undefined;
  const number = (value: unknown) => (value == null ? "—" : Number(value).toLocaleString(thai ? "th-TH" : "en-US"));
  const gaps = [...report.gaps].sort((a, b) => Number(b.missedDays ?? 0) - Number(a.missedDays ?? 0)).slice(0, 5);
  const deviations = [...report.deviation]
    .sort((a, b) => Math.abs(Number(b.medianDeviationH ?? 0)) - Math.abs(Number(a.medianDeviationH ?? 0)))
    .slice(0, 5);
  const stepLabels: Record<string, string> = {
    Activated: "เริ่มติดตามตัวอ่อน",
    "Reached Shield": "ถึงระยะ Shield",
    "Reached Day 1": "ถึง Day 1",
    Promoted: "เลื่อนเป็นปลาโคลน",
    "Alive Fish": "ปลาโคลนที่มีชีวิต",
  };
  const selectionNote = (shown: number, total: number, order: string) =>
    thai ? `แสดง ${shown} จาก ${total} รายการ · ${order}` : `Showing ${shown} of ${total} rows · ${order}`;
  const footer = (page: number) => (
    <footer className="meeting-page-footer">
      <span>KUVACB AqLIMS · {thai ? "รายงานสรุปสำหรับประชุม" : "Meeting brief"}</span>
      <span>{page} / 2</span>
    </footer>
  );
  const quality = report.kpi?.meta as ApiItem | undefined;
  const incomplete = [quality?.unknown, quality?.missing].some(
    (counts) => counts && Object.values(counts).some((count) => Number(count) > 0),
  );
  return (
    <>
      <div className="meeting-page meeting-page--summary">
        <div className="meeting-section-heading">
          <span>01</span>
          <h2>{thai ? "ผลรวมของชุดข้อมูลที่เลือก" : "Results at a glance"}</h2>
        </div>
        <div className="metric-grid report-headline-metrics">
          <Metric label={thai ? "ตัวอ่อนที่เริ่มติดตาม" : "Activated embryos"} value={number(stage1?.nActivated)} />
          <Metric label={thai ? "ถึงระยะ Shield" : "Reached Shield"} value={number(stage1?.nReachedShield)} />
          <Metric label={thai ? "เลื่อนเป็นปลาโคลน" : "Promoted fish"} value={number(stage1?.nPromoted)} />
          <Metric label={thai ? "ปลาที่มีชีวิตทั้งหมด" : "All living fish"} value={number(stage2?.nAlive)} />
        </div>
        <ReportPanel title={thai ? "เส้นทางจากตัวอ่อนสู่ปลาโคลน" : "Embryo-to-cloned-fish workflow"}>
          <ReportTable
            caption={thai ? "ผลรวมกระบวนการ" : "Workflow totals"}
            headers={[
              thai ? "ขั้นตอน" : "Step",
              thai ? "จำนวน" : "Count",
              thai ? "% จากขั้นก่อน" : "% previous",
              thai ? "% จากเริ่มต้น" : "% activated",
            ]}
            rows={report.pipeline
              .slice(0, 5)
              .map((point) => [
                thai ? (stepLabels[String(point.step)] ?? String(point.step)) : String(point.step),
                number(point.count),
                reportPercent(point.pctOfPrevious, thai),
                reportPercent(point.pctOfStart, thai),
              ])}
          />
          <p className="meeting-note">
            {thai
              ? "เส้นทางนี้นับเฉพาะปลาที่เลื่อนจากตัวอ่อน ส่วนจำนวนปลาที่มีชีวิตด้านบนรวมปลาทั้งหมดในชุดข้อมูล"
              : "The workflow counts fish promoted from embryos. The living-fish total above includes all fish in the selected dataset."}
          </p>
        </ReportPanel>
        <div className="meeting-outcomes">
          <ReportPanel title={thai ? "ผลระยะตัวอ่อน" : "Embryo outcomes"}>
            <ReportTable
              headers={[thai ? "รายการ" : "Measure", thai ? "ผล" : "Result"]}
              rows={[
                [thai ? "รอบทดลอง" : "Experiment batches", number(stage1?.nBatches)],
                [thai ? "ถึง Day 1" : "Reached Day 1", number(stage1?.nReachedDay1)],
                [thai ? "ตัวอ่อนปกติ" : "Normal embryos", reportPercent(stage1?.pctNormal, thai)],
              ]}
            />
          </ReportPanel>
          <ReportPanel title={thai ? "สถานะปลาทั้งหมด" : "All fish status"}>
            <ReportTable
              headers={[thai ? "รายการ" : "Measure", thai ? "จำนวน" : "Count"]}
              rows={[
                [thai ? "ตาย" : "Dead", number(stage2?.nDead)],
                [thai ? "แช่แข็ง" : "Frozen", number(stage2?.nFrozen)],
                [thai ? "คัดทิ้ง" : "Discarded", number(stage2?.nDiscarded)],
                [
                  thai ? "ปกติ / ผิดปกติ" : "Normal / abnormal",
                  `${number(stage2?.nNormal)} / ${number(stage2?.nAbnormal)}`,
                ],
              ]}
            />
          </ReportPanel>
        </div>
        <aside className="meeting-method">
          <strong>{thai ? "ขอบเขตและการอ่านผล" : "Scope and interpretation"}</strong>
          <p>
            {thai
              ? "ตัวเลขเป็นผลรวมตามตัวกรองที่ระบุ ไม่ใช่ข้อสรุปทางสถิติ ค่า — หรือไม่ทราบหมายถึงไม่มีข้อมูลยืนยัน ไม่ใช่ศูนย์ สถานะการมีชีวิตและความปกติเป็นคนละมิติ จึงไม่ควรนำจำนวนมาบวกรวมกัน"
              : "Figures follow the stated filters and are descriptive, not statistical conclusions. — or Unknown means unavailable, not zero. Vital status and condition are separate dimensions and must not be added together."}
          </p>
          {incomplete && (
            <p className="meeting-quality">
              {thai
                ? "พบข้อมูลต้นทางไม่ครบ: ตรวจรายละเอียดความครบถ้วนในหน้าผลการทดลองก่อนสรุปผล"
                : "Incomplete source data: review data-quality details in Research results before drawing conclusions."}
            </p>
          )}
        </aside>
        {footer(1)}
      </div>
      <div className="meeting-page meeting-page--review">
        <div className="meeting-section-heading">
          <span>02</span>
          <h2>{thai ? "ประเด็นประกอบการประชุม" : "Items for discussion"}</h2>
        </div>
        <p className="meeting-intro">
          {thai
            ? "คัดรายการตามเกณฑ์ด้านล่างเพื่อให้ตรวจติดตามได้ทันที รายงานวิเคราะห์ฉบับเต็มมีตารางครบทุกแถว"
            : "Rows are selected by the criteria below for immediate follow-up. The full analytical report contains every row."}
        </p>
        <ReportPanel title={thai ? "01 / ปลาที่ขาดผลตรวจนานที่สุด" : "01 / Longest observation gaps"}>
          <p className="meeting-note">
            {selectionNote(gaps.length, report.gaps.length, thai ? "เรียงวันขาดตรวจมากไปน้อย" : "most missed days first")}
          </p>
          <ReportTable
            headers={[
              thai ? "รหัสปลา" : "Fish",
              thai ? "ตรวจล่าสุด" : "Last observed",
              thai ? "ขาดตรวจ (วัน)" : "Missed days",
            ]}
            rows={gaps.map((point) => [
              String(point.fishCode ?? "—"),
              formatBangkokDate(String(point.lastObservedOn ?? "")) || "—",
              number(point.missedDays),
            ])}
            emptyMessage={thai ? "ไม่มีรายการขาดผลตรวจในชุดข้อมูลนี้" : "No observation gaps in this dataset"}
          />
        </ReportPanel>
        <ReportPanel title={thai ? "02 / กลุ่มที่เวลาตรวจคลาดเคลื่อนมากที่สุด" : "02 / Largest checkpoint timing deviations"}>
          <p className="meeting-note">
            {selectionNote(
              deviations.length,
              report.deviation.length,
              thai
                ? "เรียงขนาดมัธยฐานคลาดเคลื่อน · บวก = ช้า / ลบ = เร็ว"
                : "absolute median deviation · positive = late / negative = early",
            )}
          </p>
          <ReportTable
            headers={[thai ? "กลุ่ม" : "Group", thai ? "ระยะ" : "Stage", "n", thai ? "มัธยฐาน (ชม.)" : "Median (hours)"]}
            rows={deviations.map((point) => [
              timingGroup(point, thai, siteLabels),
              String(point.stageLabel ?? point.stageOrder ?? "—"),
              number(point.n),
              point.medianDeviationH == null ? "—" : Number(point.medianDeviationH).toFixed(2),
            ])}
          />
        </ReportPanel>
        <aside className="meeting-method">
          <strong>{thai ? "ข้อมูลสำหรับตรวจสอบต่อ" : "Further review"}</strong>
          <p>
            {thai
              ? "รายละเอียดเส้นโค้งการรอด รายกลุ่ม รายระยะ และรายอายุอยู่ในรายงานวิเคราะห์ฉบับเต็ม ส่วนข้อมูลสำหรับวิเคราะห์ต่อดาวน์โหลดเป็น Excel หรือ R CSV ได้จากหน้าเดียวกัน"
              : "Group, stage and age-specific survival details are available in the full analytical report. Excel and R CSV downloads provide data for further analysis."}
          </p>
        </aside>
        {footer(2)}
      </div>
    </>
  );
}

export function PrintableDashboard({
  filters,
  t = text.en,
  mode = "meeting",
  scope,
  siteLabels = {},
  onReadyChange,
}: {
  filters: DashboardFilters;
  t?: AppText;
  mode?: "meeting" | "full";
  scope?: string;
  siteLabels?: Record<string, string>;
  onReadyChange?: (ready: boolean) => void;
}) {
  const [report, setReport] = useState<PrintableReport>({
    generatedAt: "",
    timingProfileVersions: [],
    kpi: null,
    funnel: [],
    survival: [],
    deviation: [],
    abnormality: [],
    fishSurvival: [],
    gaps: [],
    pipeline: [],
    loading: true,
    error: "",
  });
  useEffect(() => {
    let cancelled = false;
    onReadyChange?.(false);
    setReport((current) => ({ ...current, loading: true, error: "" }));
    void get(withFilters("/analytics/dashboard", filters))
      .then((bundle) => {
        const items = (value: unknown) => (value as ApiItem | undefined)?.items ?? [];
        if (!cancelled)
          setReport({
            generatedAt: String((bundle.reportMeta as ApiItem | undefined)?.generatedAt ?? ""),
            timingProfileVersions:
              ((bundle.reportMeta as ApiItem | undefined)?.timingProfileVersions as number[] | undefined) ?? [],
            kpi: (bundle.kpi as ApiItem | null) ?? null,
            funnel: items(bundle.funnel),
            survival: items(bundle.survival),
            deviation: items(bundle.timingDeviation),
            abnormality: items(bundle.abnormalityOnset),
            fishSurvival: items(bundle.fishSurvival),
            gaps: items(bundle.observationGaps),
            pipeline: items(bundle.pipeline),
            loading: false,
            error: "",
          });
        if (!cancelled) onReadyChange?.(true);
      })
      .catch((error: Error) => {
        if (!cancelled)
          setReport((current) => ({
            ...current,
            loading: false,
            error: error.message,
          }));
      });
    return () => {
      cancelled = true;
    };
  }, [filters, onReadyChange]);
  const stage1 = report.kpi?.stage1 as ApiItem | undefined;
  const stage2 = report.kpi?.stage2 as ApiItem | undefined;
  const thai = t === text.th;
  return (
    <section className={`print-report print-report--${mode}`} aria-labelledby="print-report-title">
      <div className="print-report__header">
        <img className="print-report__logo" src="/brand/kuvacb-logo.png" width="1095" height="351" alt="KUVACB" />
        <p className="eyebrow">KUVACB AqLIMS / {thai ? "รายงานผลการทดลอง" : "RESEARCH RESULTS"}</p>
        <h1 id="print-report-title">
          {mode === "meeting"
            ? thai
              ? "สรุปผลการทดลองสำหรับประชุม"
              : "Research meeting brief"
            : thai
              ? "รายงานวิเคราะห์ผลการทดลอง"
              : "Experiment analysis report"}
        </h1>
        <p className="muted">
          {thai
            ? "สร้างจากชุดข้อมูลและตัวกรองเดียวกับหน้าผลการทดลองและไฟล์ Excel"
            : "Generated from the same filtered dataset as Research results and the Excel workbook."}
        </p>
        <p className="muted print-report__filters">
          {thai ? "ตัวกรอง" : "Filters"}: {scope ?? filterSummary(filters, thai)}
        </p>
        <dl className="print-report__meta">
          <div>
            <dt>{thai ? "สร้างรายงานเมื่อ" : "Generated"}</dt>
            <dd>
              {formatBangkokDateTime(report.generatedAt) || "—"} <small>UTC+7</small>
            </dd>
          </div>
          <div>
            <dt>{thai ? "เวอร์ชันเวลามาตรฐาน" : "Timing profile versions"}</dt>
            <dd>{report.timingProfileVersions.join(", ") || "—"}</dd>
          </div>
        </dl>
      </div>
      {report.loading && (
        <p className="notice" role="status">
          {thai ? "กำลังเตรียมรายงาน…" : "Preparing report…"}
        </p>
      )}
      {report.error && <ErrorMessage message={report.error} />}
      {!report.loading && !report.error && mode === "meeting" && (
        <MeetingReport report={report} thai={thai} siteLabels={siteLabels} />
      )}
      {!report.loading && !report.error && mode === "full" && (
        <>
          <div className="metric-grid report-headline-metrics">
            <Metric label={thai ? "ตัวอ่อนที่เริ่มติดตาม" : "Activated embryos"} value={Number(stage1?.nActivated ?? 0)} />
            <Metric label={thai ? "ถึงระยะ Shield" : "Reached Shield"} value={Number(stage1?.nReachedShield ?? 0)} />
            <Metric label={thai ? "เลื่อนเป็นปลาโคลน" : "Promoted fish"} value={Number(stage1?.nPromoted ?? 0)} />
            <Metric label={thai ? "ปลาที่มีชีวิต" : "Alive fish"} value={Number(stage2?.nAlive ?? 0)} />
          </div>
          <h2 className="report-support-heading">{thai ? "ข้อมูลประกอบ" : "Supporting measures"}</h2>
          <div className="metric-grid report-support-metrics">
            <Metric label={thai ? "รอบทดลอง" : "Batches"} value={Number(stage1?.nBatches ?? 0)} />
            <Metric label={thai ? "ถึง Day 1" : "Reached Day 1"} value={Number(stage1?.nReachedDay1 ?? 0)} />
            <Metric label={thai ? "ตัวอ่อนปกติ" : "Normal embryos"} value={reportPercent(stage1?.pctNormal, thai)} />
            <Metric label={thai ? "ปลาแช่แข็ง" : "Frozen fish"} value={Number(stage2?.nFrozen ?? 0)} />
            <Metric label={thai ? "ปลาคัดทิ้ง" : "Discarded fish"} value={Number(stage2?.nDiscarded ?? 0)} />
            <Metric label={thai ? "ปลาปกติ" : "Normal fish"} value={Number(stage2?.nNormal ?? 0)} />
            <Metric label={thai ? "ปลาผิดปกติ" : "Abnormal fish"} value={Number(stage2?.nAbnormal ?? 0)} />
          </div>
          <ReportPanel title={thai ? "ภาพรวมกระบวนการ" : "Overview pipeline"}>
            <ReportTable
              headers={[
                thai ? "ขั้นตอน" : "Step",
                "n",
                thai ? "% จากขั้นก่อนหน้า" : "% previous",
                thai ? "% จากเริ่มต้น" : "% activated",
              ]}
              rows={report.pipeline.map((point) => [
                String(point.step ?? "—"),
                Number(point.count ?? 0),
                reportPercent(point.pctOfPrevious, thai),
                reportPercent(point.pctOfStart, thai),
              ])}
            />
          </ReportPanel>
          <ReportPanel title={thai ? "การรอดของตัวอ่อนตามระยะ" : "Stage 1 survival curve"}>
            <SurvivalChart points={report.survival} thai={thai} />
            <ReportTable
              headers={[
                thai ? "สถานที่ / สายพันธุ์ / แขนทดลอง" : "Site / strain / treatment",
                thai ? "ระยะ" : "Stage",
                thai ? "กลุ่มเสี่ยง" : "Risk set",
                thai ? "รอด" : "Alive",
                thai ? "อัตรารอด" : "Survival",
              ]}
              rows={report.survival.map((point) => [
                [point.site, point.strain, point.treatmentGroup]
                  .map((value) => String(value ?? (thai ? "ทั้งหมด" : "All")))
                  .join(" / "),
                String(point.stageLabel ?? point.stageOrder ?? "—"),
                point.riskSet == null ? "—" : Number(point.riskSet),
                point.alive == null ? "—" : Number(point.alive),
                point.surv == null ? reportPercent(null, thai) : Number(point.surv).toFixed(4),
              ])}
            />
          </ReportPanel>
          <ReportPanel title={thai ? "การสูญเสียและระยะเริ่มพบความผิดปกติ" : "Attrition / abnormality onset"}>
            <FunnelChart points={report.funnel} thai={thai} />
            <ReportTable
              headers={[thai ? "ระยะ" : "Stage", thai ? "จำนวน" : "Count"]}
              rows={report.abnormality.map((point) => [
                String(point.stageLabel ?? point.stageOrder ?? "—"),
                Number(point.count ?? 0),
              ])}
            />
          </ReportPanel>
          <ReportPanel title={thai ? "ความคลาดเคลื่อนของเวลาตามกลุ่ม" : "Timing deviation / group comparison"}>
            <ReportTable
              headers={[
                thai ? "กลุ่ม" : "Group",
                thai ? "ระยะ" : "Stage",
                "n",
                thai ? "เฉลี่ย (ชม.)" : "Mean H",
                thai ? "มัธยฐาน (ชม.)" : "Median H",
                thai ? "SD (ชม.)" : "SD H",
              ]}
              rows={report.deviation.map((point) => [
                timingGroup(point, thai, siteLabels),
                String(point.stageLabel ?? point.stageOrder ?? "—"),
                Number(point.n ?? 0),
                Number(point.meanDeviationH ?? 0).toFixed(4),
                Number(point.medianDeviationH ?? 0).toFixed(4),
                point.sdDeviationH == null ? "—" : Number(point.sdDeviationH).toFixed(4),
              ])}
            />
          </ReportPanel>
          <ReportPanel title={thai ? "การรอดของปลาตามอายุ" : "Stage 2 fish survival"}>
            <ReportTable
              headers={[
                thai ? "สภาพ / สายพันธุ์ / แขนทดลอง" : "Condition / strain / treatment",
                thai ? "อายุ (วัน)" : "Age day",
                thai ? "กลุ่มเสี่ยง" : "At risk",
                thai ? "รอด" : "Alive",
                thai ? "ตาย" : "Dead",
                thai ? "อัตรารอด" : "Survival",
              ]}
              rows={report.fishSurvival.map((point) => [
                [point.condition, point.strain, point.treatmentGroup]
                  .map((value) => String(value ?? (thai ? "ทั้งหมด" : "All")))
                  .join(" / "),
                Number(point.ageDays ?? 0),
                Number(point.atRisk ?? 0),
                Number(point.alive ?? 0),
                Number(point.nDead ?? 0),
                point.surv == null ? reportPercent(null, thai) : Number(point.surv).toFixed(4),
              ])}
            />
            <h3 className="fish-census-heading">
              {thai ? "รายละเอียดสถานะ เพศ และตู้ปลา" : "Status, sex and housing details"}
            </h3>
            <ReportTable
              headers={[
                thai ? "สภาพ / สายพันธุ์ / แขนทดลอง" : "Condition / strain / treatment",
                thai ? "อายุ (วัน)" : "Age day",
                thai ? "แช่แข็ง" : "Frozen",
                thai ? "คัดทิ้ง" : "Discarded",
                thai ? "ผู้ / เมีย" : "M / F",
                thai ? "ตู้ปลา" : "Boxes",
              ]}
              rows={report.fishSurvival.map((point) => [
                [point.condition, point.strain, point.treatmentGroup]
                  .map((value) => String(value ?? (thai ? "ทั้งหมด" : "All")))
                  .join(" / "),
                Number(point.ageDays ?? 0),
                Number(point.nFrozen ?? 0),
                Number(point.nDiscarded ?? 0),
                `${Number(point.nMale ?? 0)}/${Number(point.nFemale ?? 0)}`,
                Number(point.nBoxes ?? 0),
              ])}
            />
          </ReportPanel>
          <ReportPanel title={thai ? "ช่วงที่ขาดผลตรวจ" : "Observation gaps"}>
            <ReportTable
              headers={[
                thai ? "รหัสปลา" : "Fish",
                thai ? "ตรวจล่าสุด" : "Last observed",
                thai ? "ขาดตรวจ (วัน)" : "Missed days",
              ]}
              rows={report.gaps.map((point) => [
                String(point.fishCode ?? "—"),
                String(point.lastObservedOn ?? "—"),
                Number(point.missedDays ?? 0),
              ])}
            />
          </ReportPanel>
          <footer className="print-report__footer">
            KUVACB AqLIMS · {thai ? "ธนาคารเซลล์สัตว์ มหาวิทยาลัยเกษตรศาสตร์" : "Kasetsart University · Animal Cell Bank"}
          </footer>
        </>
      )}
    </section>
  );
}
