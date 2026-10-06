import { useEffect, useState } from "react";
import { request } from "../api/client";
import type { Language } from "../types";

type InspectFile = { name: string; sheets?: string[]; encoding?: string; delimiter?: string; preview?: string[][] };
type Inspect = { inputKind: "xlsx" | "csv_set"; files: InspectFile[] };
type Job = { id: string; status: string; inputKind: string; revision: number; createdAt: string };
type Detail = { job: Job; files: { id: string; fileName: string; sha256: string; sizeBytes: number }[]; recordCount: number; issueCount: number; deferredFieldCount: number };
type RecordRow = { id: string; sheetName: string; sourceLocator: string; recordKind: string; source: Record<string, unknown>; working: Record<string, unknown>; targetTable?: string | null; targetId?: string | null };
type Issue = { id: string; recordId: string | null; sheetName: string; rowNo: number | null; sourceColumn: string | null; sourceValue: string | null; severity: string; code: string; message: string; status: string };
type MappingRequirements = { donorSources: string[]; sheetNames: string[]; recordKinds: string[]; ambiguousZeroRecords: string[]; unresolvedIssueCount: number; canConfirmFishSpecimens: boolean; canConfirmAggregate: boolean; aggregateWarningCount: number; aggregateWarningPreview: string[]; canConfirmEmbryos: boolean; embryoWarningCount: number; embryoWarningPreview: string[]; canConfirmMixed: boolean };
type MasterOption = { id: string; code?: string; name?: string; strain?: string; preparation?: string; batchCode?: string; timeZone?: string | null };
type ImportedFishStatus = { id: string; fishCode: string; status: string; lifeState: string; disposition: string; exitDate: string | null; rowVersion: number };
type FishStatusEdit = { status: string; lifeState: string; disposition: string; exitDate: string; reason: string };
type DeferredField = { id: string; jobId: string; sheetName: string; sourceLocator: string; sourceColumn: string; sourceValue: unknown; status: string; targetTable: string | null; targetId: string | null; targetField?: string | null; targetFields: string[]; rowVersion: number | null };
type DeferredEdit = { targetField: string; value: string; reason: string };
type HistoricalSummary = { stageCounts: { stageLabel: string; armType: string | null; sourceCount: number; nTotal: number | null; nAlive: number | null; nNormal: number | null; nAbnormal: number | null; numerator: number | null; denominator: number | null }[]; observations: { subjectType: string; stageLabel: string | null; outcome: string | null; timePrecision: string; count: number }[] };
type HistoricalStructure = { total: number; items: { id: string; sourceSheet: string; sourceKind: string; experimentDate: string | null; siteId: string | null; recipientSource: string | null; eggCodeSource: string | null; groupSource: string | null; csofSource: string | null; lots: { id: string; lotNoSource: string | null; donorSource: string | null; injectionSource: string | null; activationLocalTime: string | null }[] }[] };
type ImportComparison = { matchedFiles: { currentFile: string; priorFile: string; priorJobId: string; priorJobStatus: string; sha256: string }[]; records: { recordId: string; sheetName: string; sourceLocator: string; recordKind: string; activeTargetId: string | null; previousJobId: string | null; previousRecordId: string | null; sameSourcePosition: boolean; sourceChanged: boolean | null; workingChanged: boolean | null; changedFieldCount: number; changedFields: { field: string; before: string | null; after: string | null }[] }[] };

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  return (await (await request(path, init)).json()) as T;
}

export function Imports({ language }: { language: Language }) {
  const th = language === "th";
  const [jobs, setJobs] = useState<Job[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [inspection, setInspection] = useState<Inspect | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [csvOptions, setCsvOptions] = useState<{ include: boolean; sheetName: string; encoding: string; delimiter: string; ignoreReason: string }[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [recordOffset, setRecordOffset] = useState(0);
  const [issueOffset, setIssueOffset] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [interpretation, setInterpretation] = useState<{ recordId: string; value: Record<string, unknown> } | null>(null);
  const [workingText, setWorkingText] = useState("");
  const [reason, setReason] = useState("");
  const [decisionReason, setDecisionReason] = useState<Record<string, string>>({});
  const [correctedValues, setCorrectedValues] = useState<Record<string, string>>({});
  const [selectedIssueIds, setSelectedIssueIds] = useState<string[]>([]);
  const [bulkBypassReason, setBulkBypassReason] = useState("");
  const [mappingRequirements, setMappingRequirements] = useState<MappingRequirements | null>(null);
  const [siteOptions, setSiteOptions] = useState<MasterOption[]>([]);
  const [donorOptions, setDonorOptions] = useState<MasterOption[]>([]);
  const [siteMappings, setSiteMappings] = useState<Record<string, string>>({});
  const [donorMappings, setDonorMappings] = useState<Record<string, string>>({});
  const [zeroBypassReason, setZeroBypassReason] = useState("");
  const [aggregateWarningReason, setAggregateWarningReason] = useState("");
  const [embryoWarningReason, setEmbryoWarningReason] = useState("");
  const [fishStatuses, setFishStatuses] = useState<ImportedFishStatus[]>([]);
  const [fishStatusEdits, setFishStatusEdits] = useState<Record<string, FishStatusEdit>>({});
  const [revertReason, setRevertReason] = useState("");
  const [activeTab, setActiveTab] = useState<"jobs" | "deferred">("jobs");
  const [deferredFields, setDeferredFields] = useState<DeferredField[]>([]);
  const [deferredTotal, setDeferredTotal] = useState(0);
  const [deferredOffset, setDeferredOffset] = useState(0);
  const [deferredEdits, setDeferredEdits] = useState<Record<string, DeferredEdit>>({});
  const [historicalSummary, setHistoricalSummary] = useState<HistoricalSummary | null>(null);
  const [historicalStructure, setHistoricalStructure] = useState<HistoricalStructure | null>(null);
  const [structureOffset, setStructureOffset] = useState(0);
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [comparison, setComparison] = useState<ImportComparison | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function reloadJobs() {
    const result = await json<{ items: Job[] }>("/imports");
    setJobs(result.items);
  }
  async function loadDeferred(offset = 0) {
    const result = await json<{ total: number; items: DeferredField[] }>(`/imports/deferred-fields?offset=${offset}&limit=50`);
    setDeferredFields(result.items); setDeferredTotal(result.total); setDeferredOffset(offset);
    setDeferredEdits(Object.fromEntries(result.items.map((field) => [field.id, {
      targetField: field.targetFields[0] ?? "",
      value: typeof field.sourceValue === "string" ? field.sourceValue : JSON.stringify(field.sourceValue),
      reason: "",
    }])));
  }
  async function loadStructure(jobId: string, offset = 0) {
    const result = await json<HistoricalStructure>(`/imports/${jobId}/historical-structure?offset=${offset}&limit=50`);
    setHistoricalStructure(result); setStructureOffset(offset);
  }
  async function openJob(id: string, nextRecords = 0, nextIssues = 0) {
    if (detail?.job.id !== id) {
      setSiteMappings({}); setDonorMappings({}); setZeroBypassReason("");
    }
    const [nextDetail, nextRecordPage, nextIssuePage, requirements, siteCatalog, donorCatalog, importedFish, summary, nextComparison, structure] = await Promise.all([
      json<Detail>(`/imports/${id}`),
      json<{ items: RecordRow[] }>(`/imports/${id}/records?offset=${nextRecords}&limit=50`),
      json<{ items: Issue[] }>(`/imports/${id}/issues?offset=${nextIssues}&limit=50`),
      json<MappingRequirements>(`/imports/${id}/mapping-requirements`),
      json<{ items: MasterOption[] }>("/sites?limit=500"),
      json<{ items: MasterOption[] }>("/donor-cell-lines?limit=500"),
      json<{ items: ImportedFishStatus[] }>(`/imports/${id}/fish-status`),
      json<HistoricalSummary>(`/imports/${id}/historical-summary`),
      json<ImportComparison>(`/imports/${id}/comparison?offset=${nextRecords}&limit=50`),
      json<HistoricalStructure>(`/imports/${id}/historical-structure?offset=0&limit=50`),
    ]);
    setDetail(nextDetail);
    setRecords(nextRecordPage.items);
    setIssues(nextIssuePage.items);
    setSelectedIssueIds([]);
    setRecordOffset(nextRecords);
    setIssueOffset(nextIssues);
    setMappingRequirements(requirements);
    setSiteOptions(siteCatalog.items);
    setDonorOptions(donorCatalog.items);
    setFishStatuses(importedFish.items);
    setHistoricalSummary(summary);
    setHistoricalStructure(structure); setStructureOffset(0);
    setComparison(nextComparison);
    setSummaryExpanded(false);
    setFishStatusEdits(Object.fromEntries(importedFish.items.map((fish) => [fish.id, {
      status: fish.status, lifeState: fish.lifeState, disposition: fish.disposition,
      exitDate: fish.exitDate ?? "", reason: "",
    }])));
    setEditing(null);
    setInterpretation(null);
  }
  useEffect(() => { void reloadJobs().catch((cause: Error) => setError(cause.message)); }, []);

  async function applyDeferred(field: DeferredField) {
    const edit = deferredEdits[field.id];
    if (!edit || field.rowVersion === null) return;
    setBusy(true); setError("");
    try {
      await json(`/imports/deferred-fields/${field.id}/apply`, { method: "POST",
        body: JSON.stringify({ ...edit, rowVersion: field.rowVersion }) });
      await loadDeferred(deferredOffset);
      setNotice(th ? "เพิ่มค่าจากไฟล์ต้นฉบับแล้ว" : "Deferred source value applied.");
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function inspect() {
    if (!files.length) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const form = new FormData();
      files.forEach((file) => form.append("files", file));
      const result = await json<Inspect>("/imports/inspect", { method: "POST", body: form });
      setInspection(result);
      setSelected([]);
      setCsvOptions(result.files.map((file) => ({
        include: true, sheetName: file.name.replace(/\.csv$/i, ""),
        encoding: file.encoding ?? "utf-8-sig", delimiter: file.delimiter ?? ",", ignoreReason: "",
      })));
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function create() {
    if (!inspection) return;
    setBusy(true); setError("");
    try {
      const selection = inspection.inputKind === "xlsx" ? { sheets: selected } : { files: csvOptions };
      const form = new FormData();
      files.forEach((file) => form.append("files", file));
      form.append("selection", JSON.stringify(selection));
      const created = await json<{ job: Job; deferredFieldCount: number }>("/imports", { method: "POST", body: form });
      await reloadJobs();
      await openJob(created.job.id);
      setInspection(null); setFiles([]);
      setNotice(th ? `บันทึกฉบับร่างแล้ว มี ${created.deferredFieldCount} ค่ารอเพิ่มฟิลด์ในภายหลัง` :
        `Draft saved. ${created.deferredFieldCount} source values await future field mapping.`);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function saveRecord(row: RecordRow) {
    if (!detail) return;
    setBusy(true); setError("");
    try {
      const working = JSON.parse(workingText) as Record<string, unknown>;
      if (!working || typeof working !== "object" || Array.isArray(working)) throw new Error("Working values must be a JSON object");
      await json(`/imports/${detail.job.id}/records/${row.id}`, {
        method: "PATCH", body: JSON.stringify({ revision: detail.job.revision, working, reason }),
      });
      await openJob(detail.job.id, recordOffset, issueOffset);
      setNotice(th ? "บันทึกการแก้ไขแล้ว" : "Edit saved.");
      setReason("");
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function decide(issue: Issue, decision: string) {
    if (!detail) return;
    setBusy(true); setError("");
    try {
      await json(`/imports/${detail.job.id}/issues/${issue.id}/decision`, {
        method: "POST", body: JSON.stringify({ revision: detail.job.revision, decision, reason: decisionReason[issue.id] ?? "" }),
      });
      await openJob(detail.job.id, recordOffset, issueOffset);
      setNotice(th ? "บันทึกการตัดสินใจแล้ว" : "Decision saved.");
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function correctCell(issue: Issue) {
    if (!detail) return;
    setBusy(true); setError("");
    try {
      await json(`/imports/${detail.job.id}/issues/${issue.id}/correct-cell`, { method: "POST",
        body: JSON.stringify({ revision: detail.job.revision,
          value: correctedValues[issue.id] ?? "", reason: decisionReason[issue.id] ?? "" }) });
      await openJob(detail.job.id, recordOffset, issueOffset);
      setNotice(th ? "แก้ค่าของเซลล์และปิดประเด็นแล้ว" : "Cell corrected and issue resolved.");
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function bulkBypass() {
    if (!detail || !selectedIssueIds.length || !bulkBypassReason.trim()) return;
    setBusy(true); setError("");
    try {
      await json(`/imports/${detail.job.id}/issues/bulk-bypass`, { method: "POST",
        body: JSON.stringify({ revision: detail.job.revision,
          issueIds: selectedIssueIds, reason: bulkBypassReason }) });
      await openJob(detail.job.id, recordOffset, issueOffset);
      setBulkBypassReason("");
      setNotice(th ? `ข้าม ${selectedIssueIds.length} ประเด็นพร้อมบันทึกเหตุผลแล้ว` :
        `Bypassed ${selectedIssueIds.length} issues with an audit reason.`);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function download(id: string, name: string) {
    if (!detail) return;
    try {
      const response = await request(`/imports/${detail.job.id}/files/${id}`);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a"); link.href = url; link.download = name; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (cause) { setError((cause as Error).message); }
  }

  async function showInterpretation(id: string) {
    if (!detail) return;
    try {
      const result = await json<{ interpretation: Record<string, unknown> }>(`/imports/${detail.job.id}/records/${id}/interpretation`);
      setInterpretation({ recordId: id, value: result.interpretation });
    } catch (cause) { setError((cause as Error).message); }
  }

  async function confirmFishSpecimens() {
    if (!detail || !mappingRequirements) return;
    if (!window.confirm(th ? "ยืนยันนำเข้าปลาและ specimen ทั้งงาน?" : "Commit every fish and specimen in this job?")) return;
    setBusy(true); setError("");
    try {
      const result = await json<{ fishCount: number; specimenCount: number }>(`/imports/${detail.job.id}/confirm-fish-specimens`, {
        method: "POST",
        body: JSON.stringify({ revision: detail.job.revision, siteMappings, donorMappings, zeroBypassReason }),
      });
      await reloadJobs();
      await openJob(detail.job.id, recordOffset, issueOffset);
      setNotice(th ? `นำเข้าแล้ว: ปลา ${result.fishCount} ตัว, specimen ${result.specimenCount} รายการ` :
        `Imported ${result.fishCount} fish and ${result.specimenCount} specimens.`);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function confirmAggregate() {
    if (!detail || !mappingRequirements) return;
    if (!window.confirm(th ? "ยืนยันนำเข้าข้อมูลนับจำนวนทั้งหมดในงานนี้?" : "Commit every historical count in this job?")) return;
    setBusy(true); setError("");
    try {
      const result = await json<{ historicalCountRows: number }>(`/imports/${detail.job.id}/confirm-aggregate`, {
        method: "POST",
        body: JSON.stringify({ revision: detail.job.revision, warningBypassReason: aggregateWarningReason }),
      });
      await reloadJobs(); await openJob(detail.job.id, recordOffset, issueOffset);
      setNotice(th ? `นำเข้าข้อมูลนับจำนวน ${result.historicalCountRows} รายการแล้ว` :
        `Imported ${result.historicalCountRows} historical count rows.`);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function confirmEmbryos() {
    if (!detail || !mappingRequirements) return;
    if (!window.confirm(th ? "ยืนยันนำเข้าตัวอ่อนย้อนหลังทั้งหมดในงานนี้?" : "Commit every historical embryo in this job?")) return;
    setBusy(true); setError("");
    try {
      const result = await json<{ historicalEmbryoCount: number; historicalObservationCount: number; historicalControlCount: number }>(`/imports/${detail.job.id}/confirm-v2-embryos`, {
        method: "POST", body: JSON.stringify({ revision: detail.job.revision,
          siteMappings, warningBypassReason: embryoWarningReason }),
      });
      await reloadJobs(); await openJob(detail.job.id, recordOffset, issueOffset);
      setNotice(th ? `นำเข้าตัวอ่อน ${result.historicalEmbryoCount} ตัว การสังเกต ${result.historicalObservationCount} และข้อมูลควบคุม ${result.historicalControlCount} รายการแล้ว` :
        `Imported ${result.historicalEmbryoCount} embryos, ${result.historicalObservationCount} observations and ${result.historicalControlCount} control counts.`);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function confirmAll() {
    if (!detail || !mappingRequirements) return;
    if (!window.confirm(th ? "ยืนยันนำเข้าทุกชีตในงานนี้พร้อมกัน?" : "Commit every selected sheet in one transaction?")) return;
    setBusy(true); setError("");
    try {
      await json(`/imports/${detail.job.id}/confirm-all`, { method: "POST",
        body: JSON.stringify({ revision: detail.job.revision, siteMappings, donorMappings,
          zeroBypassReason, aggregateWarningBypassReason: aggregateWarningReason,
          embryoWarningBypassReason: embryoWarningReason }) });
      await reloadJobs(); await openJob(detail.job.id, recordOffset, issueOffset);
      setNotice(th ? "นำเข้าทุกชีตในงานพร้อมกันแล้ว" : "All selected sheets were imported atomically.");
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function saveFishStatus(fish: ImportedFishStatus) {
    if (!detail) return;
    const edit = fishStatusEdits[fish.id];
    if (!edit) return;
    setBusy(true); setError("");
    try {
      await json(`/imports/${detail.job.id}/fish-status/${fish.id}`, {
        method: "POST", body: JSON.stringify({ ...edit, exitDate: edit.exitDate || null, rowVersion: fish.rowVersion }),
      });
      await openJob(detail.job.id, recordOffset, issueOffset);
      setNotice(th ? "บันทึกการยืนยันสถานะปลาแล้ว" : "Fish status reviewed.");
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function revertJob() {
    if (!detail || !revertReason.trim()) return;
    if (!window.confirm(th ? "ยืนยันย้อนงานนำเข้าทั้งงาน? ระบบจะตรวจงานที่มาอ้างอิงก่อน" : "Revert this entire import? Dependencies will be checked first.")) return;
    setBusy(true); setError("");
    try {
      await json(`/imports/${detail.job.id}/revert`, {
        method: "POST", body: JSON.stringify({ revision: detail.job.revision, reason: revertReason }),
      });
      await reloadJobs(); await openJob(detail.job.id);
      setRevertReason("");
      setNotice(th ? "ย้อนงานนำเข้าแล้ว" : "Import reverted.");
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  return <section className="import-page">
    <header className="import-page__header"><div><p className="eyebrow">ADMIN · DATA MIGRATION</p><h1>{th ? "นำเข้าข้อมูลย้อนหลัง" : "Historical import"}</h1>
      <p className="muted">{th ? "เลือกต้นทาง ตรวจข้อมูลและแก้ฉบับร่างก่อนนำเข้าระบบ" : "Select sources and review draft values before importing."}</p></div></header>
    {error && <p className="import-page__error" role="alert">{error}</p>}
    {notice && <p className="import-page__notice" role="status">{notice}</p>}
    <nav className="import-page__tabs" aria-label={th ? "ส่วนงานนำเข้า" : "Import sections"}>
      <button type="button" aria-current={activeTab === "jobs" ? "page" : undefined} onClick={() => setActiveTab("jobs")}>{th ? "งานนำเข้า" : "Import jobs"}</button>
      <button type="button" aria-current={activeTab === "deferred" ? "page" : undefined} onClick={() => { setActiveTab("deferred"); void loadDeferred().catch((cause: Error) => setError(cause.message)); }}>{th ? "ฟิลด์ที่รอเพิ่ม" : "Deferred fields"}</button>
    </nav>
    {activeTab === "jobs" && <>
    <div className="import-page__columns"><section className="import-page__panel"><h2>{th ? "1. เลือกไฟล์" : "1. Select files"}</h2>
      <p className="muted">{th ? "หนึ่งไฟล์ XLSX หรือ CSV หลายไฟล์ โดย CSV หนึ่งไฟล์แทนหนึ่งชีท" : "One XLSX file, or multiple CSV files with one sheet per file."}</p>
      <input aria-label={th ? "ไฟล์นำเข้า" : "Import files"} type="file" multiple accept=".xlsx,.csv" onChange={(event) => { setFiles(Array.from(event.target.files ?? [])); setInspection(null); }} />
      <button type="button" disabled={busy || !files.length} onClick={() => void inspect()}>{th ? "ตรวจไฟล์" : "Inspect files"}</button>
      {inspection?.inputKind === "xlsx" && <fieldset><legend>{th ? "เลือกชีทที่ต้องการ" : "Select sheets"}</legend>
        {inspection.files[0].sheets?.map((sheet) => <label key={sheet} className="import-page__choice"><input type="checkbox" checked={selected.includes(sheet)} onChange={(event) => setSelected(event.target.checked ? [...selected, sheet] : selected.filter((name) => name !== sheet))} />{sheet}</label>)}
      </fieldset>}
      {inspection?.inputKind === "csv_set" && inspection.files.map((file, index) => <div key={`${file.name}-${index}`} className="import-page__csv"><strong>{file.name}</strong>
        <label><input type="checkbox" checked={csvOptions[index]?.include ?? false} onChange={(event) => setCsvOptions(csvOptions.map((row, i) => i === index ? { ...row, include: event.target.checked } : row))} /> {th ? "รวมไฟล์นี้" : "Include this file"}</label>
        {csvOptions[index]?.include ? <><label>{th ? "ชื่อชีทต้นทาง" : "Source sheet name"}<input value={csvOptions[index].sheetName} onChange={(event) => setCsvOptions(csvOptions.map((row, i) => i === index ? { ...row, sheetName: event.target.value } : row))} /></label>
          <label>Encoding<select value={csvOptions[index].encoding} onChange={(event) => setCsvOptions(csvOptions.map((row, i) => i === index ? { ...row, encoding: event.target.value } : row))}>{["utf-8-sig", "utf-8", "utf-16", "cp874"].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Delimiter<select value={csvOptions[index].delimiter} onChange={(event) => setCsvOptions(csvOptions.map((row, i) => i === index ? { ...row, delimiter: event.target.value } : row))}>{[",", ";", "\t", "|"].map((value) => <option key={value} value={value}>{value === "\t" ? "Tab" : value}</option>)}</select></label>
          <pre>{file.preview?.map((row) => row.join(" | ")).join("\n")}</pre></>
          : <label>{th ? "เหตุผลที่ข้าม" : "Reason for ignoring"}<input value={csvOptions[index]?.ignoreReason ?? ""} onChange={(event) => setCsvOptions(csvOptions.map((row, i) => i === index ? { ...row, ignoreReason: event.target.value } : row))} /></label>}
      </div>)}
      {inspection && <button type="button" disabled={busy || (inspection.inputKind === "xlsx" ? !selected.length : !csvOptions.some((row) => row.include))} onClick={() => void create()}>{th ? "สร้างฉบับร่าง" : "Create draft"}</button>}
    </section><section className="import-page__panel"><h2>{th ? "งานนำเข้า" : "Import jobs"}</h2>
      <div className="import-page__jobs">{jobs.map((job) => <button type="button" key={job.id} aria-current={detail?.job.id === job.id ? "true" : undefined} onClick={() => void openJob(job.id).catch((cause: Error) => setError(cause.message))}>
        <strong>{new Date(job.createdAt).toLocaleString(th ? "th-TH" : "en-US")}</strong><span>{job.inputKind} · {job.status}</span></button>)}</div>
    </section></div>
    {detail && <section className="import-page__panel"><h2>{th ? "2. ตรวจฉบับร่าง" : "2. Review draft"}</h2>
      <p>{detail.recordCount} {th ? "รายการ" : "records"} · {detail.issueCount} {th ? "ประเด็น" : "issues"} · Revision {detail.job.revision}</p>
      <p className="muted">{th ? "ไฟล์ต้นฉบับเก็บแยกจากข้อมูลที่แก้ไข ทุกการตัดสินใจมีประวัติ" : "Original files are separate from edits. Every decision is audited."}</p>
      {comparison && (comparison.matchedFiles.length > 0 || comparison.records.length > 0) && <div className="import-page__warning" role="alert">
        <h3>{th ? "ตรวจไฟล์ซ้ำและความต่างก่อนนำเข้า" : "Review duplicate sources and changes"}</h3>
        <p>{th ? "รหัสปลาหรือตัวอย่างที่มีอยู่จะนำเข้าซ้ำไม่ได้ ถ้าต้องแก้ข้อมูลเก่า ให้ตรวจ dependency และย้อนงานเดิมก่อน แล้วจึงนำเข้าไฟล์ที่แก้แล้ว" : "Existing fish or specimen codes cannot be imported twice. Review dependencies and revert the previous job before a corrected reimport."}</p>
        {comparison.matchedFiles.map((match, index) => <p key={index}>{th ? "ไฟล์ตรงกันทุกไบต์" : "Exact file match"}: {match.currentFile} · {th ? "งานเดิม" : "prior job"} {match.priorJobId} ({match.priorJobStatus}) · SHA-256 {match.sha256.slice(0, 12)}…</p>)}
        {comparison.records.map((match) => <details key={match.recordId}><summary><strong>{match.sheetName} · {match.sourceLocator}</strong> · {match.recordKind} · {match.activeTargetId ? (th ? "รหัสนี้มีอยู่แล้ว" : "active code exists") : (th ? "ตำแหน่งต้นทางเคยนำเข้า" : "source position imported before")}{match.workingChanged !== null ? ` · ${match.changedFieldCount} ${th ? "ค่าต่างกัน" : "changed fields"}` : ""}</summary>
          {match.activeTargetId && <p>{th ? "ข้อมูลจริง" : "Active target"}: {match.activeTargetId}</p>}
          {match.previousJobId && <button type="button" onClick={() => void openJob(match.previousJobId!).catch((cause: Error) => setError(cause.message))}>{th ? "เปิดงานนำเข้าเดิม" : "Open prior job"}</button>}
          {match.changedFields.length > 0 && <table><thead><tr><th>{th ? "ฟิลด์" : "Field"}</th><th>{th ? "เดิม" : "Before"}</th><th>{th ? "ใหม่" : "After"}</th></tr></thead><tbody>{match.changedFields.map((change, index) => <tr key={index}><td>{change.field}</td><td>{change.before ?? "—"}</td><td>{change.after ?? "—"}</td></tr>)}</tbody></table>}
          {match.changedFieldCount > match.changedFields.length && <p>{th ? "แสดงบางส่วน กรุณาเปิดไฟล์ต้นฉบับเพื่อตรวจทั้งหมด" : "Showing the first changes; inspect the source files for the rest."}</p>}
        </details>)}
      </div>}
      <div className="import-page__files">{detail.files.map((file) => <button type="button" key={file.id} onClick={() => void download(file.id, file.fileName)}>{file.fileName} ↓ <small>SHA-256 {file.sha256.slice(0, 12)}…</small></button>)}</div>
      {detail.job.status === "draft" && mappingRequirements?.canConfirmMixed && <div className="import-page__mapping">
        <h3>{th ? "ยืนยันงานที่มีหลายชนิดชีต" : "Confirm mixed-sheet job"}</h3>
        <p className="muted">{th ? "ทุกชีตที่เลือกรวมเป็นงานเดียว หากส่วนใดผิดพลาดจะไม่นำเข้าส่วนอื่น" : "Every selected sheet commits together. Any validation failure rolls back the entire job."}</p>
        {mappingRequirements.unresolvedIssueCount > 0 && <p className="import-page__warning" role="alert">{mappingRequirements.unresolvedIssueCount} {th ? "ประเด็นที่ต้องแก้หรือข้าม" : "issues need decisions"}</p>}
        {mappingRequirements.sheetNames.map((sheet) => <label key={sheet}>{th ? `สถานที่ของ ${sheet}` : `Site for ${sheet}`}
          <select value={siteMappings[sheet] ?? ""} onChange={(event) => setSiteMappings({ ...siteMappings, [sheet]: event.target.value })}><option value="">{th ? "เลือกสถานที่" : "Select site"}</option>{siteOptions.filter((site) => site.timeZone).map((site) => <option key={site.id} value={site.id}>{site.code} · {site.timeZone}</option>)}</select></label>)}
        {mappingRequirements.donorSources.map((source) => <label key={source}>{th ? `Donor จากไฟล์: ${source || "(ไม่ระบุ)"}` : `Donor source: ${source || "(blank)"}`}
          <select value={donorMappings[source] ?? ""} onChange={(event) => setDonorMappings({ ...donorMappings, [source]: event.target.value })}><option value="">{th ? "เลือก donor cell" : "Select donor cell"}</option>{donorOptions.map((donor) => <option key={donor.id} value={donor.id}>{donor.strain} · {donor.preparation}{donor.batchCode ? ` · ${donor.batchCode}` : ""}</option>)}</select></label>)}
        {mappingRequirements.ambiguousZeroRecords.length > 0 && <label>{th ? `เหตุผลสำหรับค่า 0 ที่ยังไม่ชัดเจน (${mappingRequirements.ambiguousZeroRecords.length} รายการ)` : `Reason for unresolved zero flags (${mappingRequirements.ambiguousZeroRecords.length})`}<textarea rows={2} value={zeroBypassReason} onChange={(event) => setZeroBypassReason(event.target.value)} /></label>}
        {mappingRequirements.aggregateWarningCount > 0 && <div className="import-page__warning"><strong>{mappingRequirements.aggregateWarningCount} {th ? "ข้อควรตรวจในข้อมูลนับจำนวน" : "aggregate warnings"}</strong><ul>{mappingRequirements.aggregateWarningPreview.map((item, index) => <li key={index}>{item}</li>)}</ul><label>{th ? "เหตุผลที่ยอมรับ" : "Reason to accept"}<textarea rows={2} value={aggregateWarningReason} onChange={(event) => setAggregateWarningReason(event.target.value)} /></label></div>}
        {mappingRequirements.recordKinds.includes("embryo_candidate") && <div className={mappingRequirements.embryoWarningCount > 0 ? "import-page__warning" : ""}><strong>{mappingRequirements.embryoWarningCount} {th ? "ข้อควรตรวจในข้อมูลตัวอ่อน" : "embryo warnings"}</strong><ul>{mappingRequirements.embryoWarningPreview.map((item, index) => <li key={index}>{item}</li>)}</ul><label>{th ? "เหตุผลหากยอมรับเวลาหรือค่าที่ไม่ชัดเจน" : "Reason for uncertain embryo values or clocks"}<textarea rows={2} value={embryoWarningReason} onChange={(event) => setEmbryoWarningReason(event.target.value)} /></label></div>}
        <button type="button" disabled={busy || mappingRequirements.unresolvedIssueCount > 0 || mappingRequirements.sheetNames.some((sheet) => !siteMappings[sheet]) || mappingRequirements.donorSources.some((source) => !donorMappings[source]) || (mappingRequirements.ambiguousZeroRecords.length > 0 && !zeroBypassReason.trim()) || (mappingRequirements.aggregateWarningCount > 0 && !aggregateWarningReason.trim()) || (mappingRequirements.embryoWarningCount > 0 && !embryoWarningReason.trim())} onClick={() => void confirmAll()}>{th ? "ยืนยันนำเข้าทุกชีตพร้อมกัน" : "Confirm all selected sheets"}</button>
      </div>}
      {detail.job.status === "draft" && mappingRequirements?.canConfirmFishSpecimens && <div className="import-page__mapping"><h3>{th ? "3. จับคู่ข้อมูลก่อนยืนยัน" : "3. Map before confirmation"}</h3>
        <p className="muted">{th ? "เลือกสถานที่และ donor cell ที่มีอยู่จริง ระบบจะนำเข้าทั้งงานพร้อมกัน" : "Choose existing sites and donor cells. The job commits as one transaction."}</p>
        {mappingRequirements.unresolvedIssueCount > 0 && <p className="import-page__warning" role="alert">{th ? `ยังมีประเด็นที่ต้องแก้หรือข้ามพร้อมเหตุผล ${mappingRequirements.unresolvedIssueCount} รายการ` : `${mappingRequirements.unresolvedIssueCount} blocking or overridable issues still need decisions.`}</p>}
        {mappingRequirements.sheetNames.map((sheet) => <label key={sheet}>{th ? `สถานที่ของ ${sheet}` : `Site for ${sheet}`}
          <select value={siteMappings[sheet] ?? ""} onChange={(event) => setSiteMappings({ ...siteMappings, [sheet]: event.target.value })}><option value="">{th ? "เลือกสถานที่" : "Select site"}</option>
            {siteOptions.filter((site) => site.timeZone).map((site) => <option key={site.id} value={site.id}>{site.code} · {site.timeZone}</option>)}</select></label>)}
        {mappingRequirements.donorSources.map((source) => <label key={source}>{th ? `Donor จากไฟล์: ${source || "(ไม่ระบุ)"}` : `Donor source: ${source || "(blank)"}`}
          <select value={donorMappings[source] ?? ""} onChange={(event) => setDonorMappings({ ...donorMappings, [source]: event.target.value })}><option value="">{th ? "เลือก donor cell" : "Select donor cell"}</option>
            {donorOptions.map((donor) => <option key={donor.id} value={donor.id}>{donor.strain} · {donor.preparation}{donor.batchCode ? ` · ${donor.batchCode}` : ""}</option>)}</select></label>)}
        {mappingRequirements.ambiguousZeroRecords.length > 0 && <div className="import-page__warning"><strong>{th ? "ค่า 0 หลังการหยุดติดตามที่ไม่ทราบวันที่" : "Zeros after an undated disposition"}</strong>
          <p>{mappingRequirements.ambiguousZeroRecords.join(", ")}</p>
          <label>{th ? "เหตุผลที่ยอมรับความไม่ชัดเจน" : "Reason to keep these outcomes unresolved"}<textarea value={zeroBypassReason} onChange={(event) => setZeroBypassReason(event.target.value)} rows={3} /></label></div>}
        <button type="button" disabled={busy || mappingRequirements.unresolvedIssueCount > 0 || mappingRequirements.sheetNames.some((sheet) => !siteMappings[sheet]) || mappingRequirements.donorSources.some((source) => !donorMappings[source]) || (mappingRequirements.ambiguousZeroRecords.length > 0 && !zeroBypassReason.trim())} onClick={() => void confirmFishSpecimens()}>{th ? "ยืนยันนำเข้าทั้งงาน" : "Confirm entire job"}</button>
      </div>}
      {detail.job.status === "draft" && mappingRequirements?.canConfirmEmbryos && <div className="import-page__mapping">
        <h3>{th ? "ตรวจตัวอ่อน V2 ก่อนนำเข้า" : "Review V2 embryos"}</h3>
        <p className="muted">{th ? "เลือกสถานที่พร้อมเขตเวลา เวลาที่ไม่ชัดเจนจะเก็บเป็นวันที่เท่านั้น และไม่ใช้คำนวณตัวชี้วัดเวลา" : "Choose a site with a time zone. Uncertain clocks become date-only observations and stay out of timing metrics."}</p>
        {mappingRequirements.sheetNames.map((sheet) => <label key={sheet}>{th ? `สถานที่ของ ${sheet}` : `Site for ${sheet}`}
          <select value={siteMappings[sheet] ?? ""} onChange={(event) => setSiteMappings({ ...siteMappings, [sheet]: event.target.value })}><option value="">{th ? "เลือกสถานที่" : "Select site"}</option>
            {siteOptions.filter((site) => site.timeZone).map((site) => <option key={site.id} value={site.id}>{site.code} · {site.timeZone}</option>)}</select></label>)}
        {mappingRequirements.unresolvedIssueCount > 0 && <p className="import-page__warning" role="alert">{mappingRequirements.unresolvedIssueCount} {th ? "ประเด็นที่ต้องแก้หรือข้าม" : "issues need decisions"}</p>}
        {mappingRequirements.embryoWarningCount > 0 && <div className="import-page__warning" role="alert">
          <strong>{mappingRequirements.embryoWarningCount} {th ? "ข้อควรตรวจเกี่ยวกับตัวอ่อนหรือเวลา" : "embryo or timing warnings"}</strong>
          <ul>{mappingRequirements.embryoWarningPreview.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
          <label>{th ? "เหตุผลที่ยอมรับข้อมูลที่ยังไม่ชัดเจน" : "Reason to accept uncertain values"}<textarea rows={3} value={embryoWarningReason} onChange={(event) => setEmbryoWarningReason(event.target.value)} /></label>
        </div>}
        {mappingRequirements.embryoWarningCount === 0 && <label>{th ? "เหตุผลหากพบเวลาไม่ชัดเจนหลังเลือกเขตเวลา" : "Reason if site time zone reveals an ambiguous clock"}<input value={embryoWarningReason} onChange={(event) => setEmbryoWarningReason(event.target.value)} /></label>}
        <button type="button" disabled={busy || mappingRequirements.unresolvedIssueCount > 0 || mappingRequirements.sheetNames.some((sheet) => !siteMappings[sheet]) || (mappingRequirements.embryoWarningCount > 0 && !embryoWarningReason.trim())} onClick={() => void confirmEmbryos()}>{th ? "ยืนยันนำเข้าตัวอ่อนทั้งงาน" : "Confirm entire embryo job"}</button>
      </div>}
      {detail.job.status === "draft" && mappingRequirements?.canConfirmAggregate && <div className="import-page__mapping">
        <h3>{th ? "ตรวจข้อมูลนับจำนวนก่อนนำเข้า" : "Review historical counts"}</h3>
        <p className="muted">{th ? "ข้อมูล V1, MSU และ QC จะถูกเก็บพร้อมตำแหน่งเซลล์ต้นฉบับ โดยไม่สร้างเวลาสังเกตที่ไม่มีในไฟล์" : "V1, MSU and QC counts keep their source cell locations. Missing observation times are not invented."}</p>
        {mappingRequirements.unresolvedIssueCount > 0 && <p className="import-page__warning" role="alert">{mappingRequirements.unresolvedIssueCount} {th ? "ประเด็นที่ต้องแก้หรือข้าม" : "issues need decisions"}</p>}
        {mappingRequirements.aggregateWarningCount > 0 && <div className="import-page__warning" role="alert">
          <strong>{mappingRequirements.aggregateWarningCount} {th ? "ข้อควรตรวจ: ค่า/วันที่บางส่วนอ่านไม่ได้" : "warnings: some counts or dates could not be interpreted"}</strong>
          <ul>{mappingRequirements.aggregateWarningPreview.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
          <label>{th ? "เหตุผลที่ยอมรับความเสี่ยงและนำเข้าเฉพาะค่าที่อ่านได้" : "Reason to import interpretable values"}<textarea rows={3} value={aggregateWarningReason} onChange={(event) => setAggregateWarningReason(event.target.value)} /></label>
        </div>}
        <button type="button" disabled={busy || mappingRequirements.unresolvedIssueCount > 0 || (mappingRequirements.aggregateWarningCount > 0 && !aggregateWarningReason.trim())} onClick={() => void confirmAggregate()}>{th ? "ยืนยันนำเข้าข้อมูลนับจำนวนทั้งงาน" : "Confirm entire count job"}</button>
      </div>}
      {detail.job.status === "committed" && historicalSummary && <div className="import-page__mapping">
        <h3>{th ? "สรุปข้อมูลย้อนหลัง" : "Historical data summary"}</h3>
        <p className="muted">{th ? "แสดงข้อมูลย้อนหลังแยกจากตัวชี้วัดการทดลองปัจจุบัน เวลาแบบวันที่อย่างเดียวไม่ถูกนำไปคำนวณ timing" : "Historical data stays separate from current experiment metrics. Date-only observations do not enter timing calculations."}</p>
        {historicalStructure && <div><h4>{th ? "การทดลองและ lot จากต้นฉบับ" : "Source experiments and lots"}</h4>
          {historicalStructure.items.map((experiment) => <details key={experiment.id} className="import-page__experiment"><summary><strong>{experiment.sourceSheet}</strong> · {experiment.experimentDate ?? (th ? "ไม่ทราบวันที่" : "unknown date")} · {experiment.sourceKind} · {experiment.groupSource ?? "—"} · {experiment.lots.length} lot</summary>
            <p>{th ? "ไข่" : "Egg"}: {experiment.eggCodeSource ?? "—"} · {th ? "ไข่รับ" : "Recipient"}: {experiment.recipientSource ?? "—"} · CSOF: {experiment.csofSource ?? "—"}</p>
            {experiment.lots.map((lot) => <p key={lot.id}>{th ? "lot" : "Lot"} {lot.lotNoSource ?? "—"} · {th ? "เซลล์" : "Cell"} {lot.donorSource ?? "—"} · {th ? "ฉีด" : "Injection"} {lot.injectionSource ?? "—"} · {th ? "เวลาเริ่ม" : "Activation"} {lot.activationLocalTime ?? "—"}</p>)}
          </details>)}
          <div className="import-page__pager"><button disabled={structureOffset === 0} onClick={() => void loadStructure(detail.job.id, Math.max(0, structureOffset - 50))}>←</button><span>{structureOffset + 1}–{structureOffset + historicalStructure.items.length} / {historicalStructure.total}</span><button disabled={structureOffset + historicalStructure.items.length >= historicalStructure.total} onClick={() => void loadStructure(detail.job.id, structureOffset + 50)}>→</button></div>
        </div>}
        <div className="import-page__summary"><div><h4>{th ? "จำนวนนับตามระยะ" : "Counts by stage"}</h4>
          <table><thead><tr><th>{th ? "ระยะ / กลุ่ม" : "Stage / arm"}</th><th>N</th><th>{th ? "รอด" : "Alive"}</th><th>{th ? "ปกติ" : "Normal"}</th><th>{th ? "ผิดปกติ" : "Abnormal"}</th></tr></thead><tbody>
            {historicalSummary.stageCounts.slice(0, summaryExpanded ? undefined : 30).map((row, index) => <tr key={index}><td>{row.stageLabel}{row.armType ? ` · ${row.armType}` : ""}</td><td>{row.nTotal ?? "—"}</td><td>{row.nAlive ?? "—"}</td><td>{row.nNormal ?? "—"}</td><td>{row.nAbnormal ?? "—"}</td></tr>)}
          </tbody></table></div><div><h4>{th ? "ผลการสังเกต" : "Observed outcomes"}</h4>
          <table><thead><tr><th>{th ? "ชนิด / ระยะ" : "Subject / stage"}</th><th>{th ? "ผล" : "Outcome"}</th><th>{th ? "ความแม่นของเวลา" : "Time precision"}</th><th>{th ? "จำนวน" : "Count"}</th></tr></thead><tbody>
            {historicalSummary.observations.slice(0, summaryExpanded ? undefined : 30).map((row, index) => <tr key={index}><td>{row.subjectType} · {row.stageLabel ?? "—"}</td><td>{row.outcome ?? "—"}</td><td>{row.timePrecision}</td><td>{row.count}</td></tr>)}
          </tbody></table></div></div>
        {(historicalSummary.stageCounts.length > 30 || historicalSummary.observations.length > 30) && <button type="button" onClick={() => setSummaryExpanded(!summaryExpanded)}>{summaryExpanded ? (th ? "แสดงน้อยลง" : "Show less") : (th ? "แสดงทั้งหมด" : "Show all")}</button>}
      </div>}
      {detail.job.status === "committed" && <div className="import-page__mapping">{fishStatuses.length > 0 && <><h3>{th ? "ตรวจสถานะปลาหลังนำเข้า" : "Review imported fish status"}</h3>
        <p className="muted">{th ? "สถานะไม่ทราบต้องมีหลักฐานก่อนยืนยัน การแก้ไขจะถูกบันทึกและอาจทำให้ย้อนงานนำเข้าไม่ได้" : "Confirm status from evidence. A later edit may prevent whole-job revert."}</p></>}
        {fishStatuses.map((fish) => { const edit = fishStatusEdits[fish.id]; return edit && <div key={fish.id} className="import-page__status-row"><strong>{fish.fishCode}</strong>
          <label>{th ? "สถานะ" : "Status"}<select value={edit.status} onChange={(event) => {
            const status = event.target.value;
            setFishStatusEdits({ ...fishStatusEdits, [fish.id]: { ...edit, status,
              lifeState: status === "ALIVE" ? "ALIVE" : status === "DEAD" ? "DEAD" : "UNKNOWN",
              disposition: status === "FROZEN" || status === "DISCARDED" ? status : "NONE",
              exitDate: status === "ALIVE" || status === "UNKNOWN" ? "" : edit.exitDate } });
          }}>{["UNKNOWN", "ALIVE", "DEAD", "FROZEN", "DISCARDED"].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>{th ? "การมีชีวิต" : "Life state"}<select value={edit.lifeState} onChange={(event) => setFishStatusEdits({ ...fishStatusEdits, [fish.id]: { ...edit, lifeState: event.target.value } })}>{["UNKNOWN", "ALIVE", "DEAD"].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>{th ? "การจัดการ" : "Disposition"}<select value={edit.disposition} onChange={(event) => setFishStatusEdits({ ...fishStatusEdits, [fish.id]: { ...edit, disposition: event.target.value } })}>{["NONE", "UNKNOWN", "FROZEN", "DISCARDED", "LOST"].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>{th ? "วันที่ออกจากการติดตาม" : "Exit date"}<input type="date" value={edit.exitDate} onChange={(event) => setFishStatusEdits({ ...fishStatusEdits, [fish.id]: { ...edit, exitDate: event.target.value } })} /></label>
          <label>{th ? "หลักฐานหรือเหตุผล" : "Evidence or reason"}<input value={edit.reason} onChange={(event) => setFishStatusEdits({ ...fishStatusEdits, [fish.id]: { ...edit, reason: event.target.value } })} /></label>
          <button type="button" disabled={busy || !edit.reason.trim()} onClick={() => void saveFishStatus(fish)}>{th ? "บันทึกสถานะ" : "Save status"}</button>
        </div>; })}
        <div className="import-page__warning"><h4>{th ? "ย้อนงานนำเข้า" : "Revert import"}</h4>
          <p>{th ? "ระบบจะปฏิเสธถ้ามีข้อมูลใหม่อ้างอิงหรือมีการแก้ไขหลังนำเข้า" : "Revert is refused if later records depend on this import or imported records changed."}</p>
          <label>{th ? "เหตุผล" : "Reason"}<textarea rows={2} value={revertReason} onChange={(event) => setRevertReason(event.target.value)} /></label>
          <button type="button" disabled={busy || !revertReason.trim()} onClick={() => void revertJob()}>{th ? "ตรวจและย้อนทั้งงาน" : "Check and revert job"}</button>
        </div>
      </div>}
      <h3>{th ? "ประเด็นที่ต้องตรวจ" : "Issues"}</h3>
      {detail.job.status === "draft" && issues.some((issue) => issue.status === "open" && issue.severity === "overridable") && <div className="import-page__mapping">
        <h4>{th ? "ข้ามหลายประเด็นในหน้านี้" : "Bypass several issues on this page"}</h4>
        <p className="muted">{th ? "เลือกได้เฉพาะประเด็นที่อนุญาตให้ข้าม ระบบจะเก็บเหตุผลเดียวกับทุกประเด็นที่เลือก" : "Select overridable issues only. The same reason is audited on every selected issue."}</p>
        <label>{th ? "เหตุผลที่ยอมรับความเสี่ยง" : "Reason to accept the risk"}<textarea rows={2} value={bulkBypassReason} onChange={(event) => setBulkBypassReason(event.target.value)} /></label>
        <button type="button" disabled={busy || !selectedIssueIds.length || !bulkBypassReason.trim()} onClick={() => void bulkBypass()}>{th ? `ข้าม ${selectedIssueIds.length} ประเด็น` : `Bypass ${selectedIssueIds.length} selected`}</button>
      </div>}
      {issues.length ? issues.map((issue) => <article key={issue.id} className="import-page__item"><div><strong>{issue.sheetName}{issue.rowNo ? ` · ${issue.sourceColumn ?? ""}${issue.rowNo}` : ""}</strong> <span className={`import-page__badge import-page__badge--${issue.severity}`}>{issue.severity}</span> <span>{issue.status}</span></div>
        {issue.status === "open" && issue.severity === "overridable" && <label className="import-page__choice"><input type="checkbox" checked={selectedIssueIds.includes(issue.id)} onChange={(event) => setSelectedIssueIds(event.target.checked ? [...selectedIssueIds, issue.id] : selectedIssueIds.filter((id) => id !== issue.id))} />{th ? "เลือกข้ามเป็นชุด" : "Select for bulk bypass"}</label>}
        <p>{issue.message}</p>{issue.sourceValue && <code>{issue.sourceValue}</code>}
        {issue.status === "open" && <div className="import-page__actions"><label>{th ? "เหตุผล" : "Reason"}<input value={decisionReason[issue.id] ?? ""} onChange={(event) => setDecisionReason({ ...decisionReason, [issue.id]: event.target.value })} /></label>
          {issue.recordId && issue.sourceColumn ? <>
            <label>{th ? `ค่าใหม่ของ ${issue.sourceColumn}${issue.rowNo ?? ""}` : `New value for ${issue.sourceColumn}${issue.rowNo ?? ""}`}<input value={correctedValues[issue.id] ?? ""} onChange={(event) => setCorrectedValues({ ...correctedValues, [issue.id]: event.target.value })} /></label>
            <button disabled={busy || !decisionReason[issue.id]?.trim() || !correctedValues[issue.id]?.trim()} onClick={() => void correctCell(issue)}>{th ? "แก้เซลล์และตรวจค่า" : "Apply and validate cell"}</button>
            <button disabled={busy || !decisionReason[issue.id]?.trim()} onClick={() => void decide(issue, "corrected")}>{th ? "ตรวจค่าที่แก้ในแถวแล้ว" : "Validate edited row"}</button>
          </> : <p className="muted">{th ? "ประเด็นนี้ไม่มีแถวให้แก้บนเว็บ กรุณาอัปโหลดต้นฉบับที่แก้แล้ว" : "No editable row is linked to this issue; upload a corrected source."}</p>}
          {issue.severity === "overridable" && <button disabled={busy || !decisionReason[issue.id]?.trim()} onClick={() => void decide(issue, "bypassed")}>{th ? "ข้ามพร้อมเหตุผล" : "Bypass with reason"}</button>}
          {issue.severity === "warning" && <button disabled={busy || !decisionReason[issue.id]?.trim()} onClick={() => void decide(issue, "dismissed")}>{th ? "รับทราบ" : "Acknowledge"}</button>}
        </div>}</article>) : <p className="muted">{th ? "ไม่มีประเด็นในหน้านี้" : "No issues on this page."}</p>}
      <div className="import-page__pager"><button disabled={issueOffset === 0} onClick={() => void openJob(detail.job.id, recordOffset, Math.max(0, issueOffset - 50))}>←</button><span>{issueOffset + 1}–{issueOffset + issues.length}</span><button disabled={issueOffset + issues.length >= detail.issueCount} onClick={() => void openJob(detail.job.id, recordOffset, issueOffset + 50)}>→</button></div>
      <h3>{th ? "ข้อมูลต้นทางและฉบับแก้ไข" : "Source and working values"}</h3>
      {records.map((row) => <article key={row.id} className="import-page__item"><div><strong>{row.sheetName} · {row.sourceLocator}</strong> <span>{row.recordKind}</span></div>
        {row.targetId && <p className="muted">{th ? "บันทึกเป็น" : "Imported as"} {row.targetTable} · {row.targetId}</p>}
        {(["fish", "specimen", "embryo_candidate", "legacy_lot", "scnt_aggregate", "control_aggregate"].includes(row.recordKind)) && <button type="button" onClick={() => void showInterpretation(row.id)}>{th ? "ดูความหมายที่ระบบอ่านได้" : "View interpretation"}</button>}
        {interpretation?.recordId === row.id && <div className="import-page__interpretation"><strong>{th ? "ผลอ่านข้อมูล" : "Interpreted values"}</strong>
          <pre>{JSON.stringify({ ...interpretation.value, observations: undefined, stageObservations: undefined, dailySurvival: undefined, counts: undefined, controlCounts: undefined }, null, 2)}</pre>
          {Array.isArray(interpretation.value.observations) && <p>{th ? "รายการสังเกต" : "Observations"}: {interpretation.value.observations.length}</p>}
          {Array.isArray(interpretation.value.stageObservations) && <p>{th ? "ระยะตัวอ่อนที่บันทึก" : "Recorded embryo stages"}: {interpretation.value.stageObservations.length}</p>}
          {Array.isArray(interpretation.value.dailySurvival) && <p>{th ? "วันที่ติดตาม" : "Daily tracking entries"}: {interpretation.value.dailySurvival.length}</p>}
          {Array.isArray(interpretation.value.counts) && <p>{th ? "รายการนับจำนวน" : "Count values"}: {interpretation.value.counts.length}</p>}
          {Array.isArray(interpretation.value.controlCounts) && <p>{th ? "ข้อมูลควบคุม" : "Control counts"}: {interpretation.value.controlCounts.length}</p>}
        </div>}
        <div className="import-page__comparison"><div><h4>{th ? "ต้นฉบับ" : "Original"}</h4><pre>{JSON.stringify(row.source, null, 2)}</pre></div><div><h4>{th ? "ฉบับแก้ไข" : "Working copy"}</h4>{editing === row.id ? <><textarea rows={9} value={workingText} onChange={(event) => setWorkingText(event.target.value)} aria-label="Working JSON" /><label>{th ? "เหตุผลการแก้" : "Edit reason"}<input value={reason} onChange={(event) => setReason(event.target.value)} /></label><button disabled={busy || !reason.trim()} onClick={() => void saveRecord(row)}>{th ? "บันทึก" : "Save"}</button><button onClick={() => setEditing(null)}>{th ? "ยกเลิก" : "Cancel"}</button></> : <><pre>{JSON.stringify(row.working, null, 2)}</pre><button disabled={detail.job.status !== "draft"} onClick={() => { setEditing(row.id); setWorkingText(JSON.stringify(row.working, null, 2)); setReason(""); }}>{th ? "แก้ไขข้อมูล" : "Edit values"}</button></>}</div></div>
      </article>)}
      <div className="import-page__pager"><button disabled={recordOffset === 0} onClick={() => void openJob(detail.job.id, Math.max(0, recordOffset - 50), issueOffset)}>←</button><span>{recordOffset + 1}–{recordOffset + records.length}</span><button disabled={recordOffset + records.length >= detail.recordCount} onClick={() => void openJob(detail.job.id, recordOffset + 50, issueOffset)}>→</button></div>
    </section>}</>}
    {activeTab === "deferred" && <section className="import-page__panel">
      <h2>{th ? "ค่าจากต้นฉบับที่ยังไม่มีฟิลด์รองรับ" : "Source values awaiting field mapping"}</h2>
      <p className="muted">{th ? "ค่าต้นฉบับยังอยู่ครบ เมื่อทีมพัฒนาเพิ่มฟิลด์ที่รองรับแล้ว ให้เลือกปลายทางและกดเพิ่มพร้อมเหตุผล" : "Original values remain available. Once a supported target field exists, select it and apply with a reason."}</p>
      {deferredFields.map((field) => { const edit = deferredEdits[field.id]; return <article key={field.id} className="import-page__item">
        <div><strong>{field.sheetName} · {field.sourceLocator} · {field.sourceColumn}</strong> <span>{field.status}</span></div>
        <pre>{JSON.stringify(field.sourceValue, null, 2)}</pre>
        <p className="muted">{field.targetTable ?? "—"} {field.targetId ?? ""}</p>
        {field.status === "pending" && field.targetFields.length > 0 && edit && <div className="import-page__deferred-edit">
          <label>{th ? "ฟิลด์ปลายทาง" : "Target field"}<select value={edit.targetField} onChange={(event) => setDeferredEdits({ ...deferredEdits, [field.id]: { ...edit, targetField: event.target.value } })}>{field.targetFields.map((name) => <option key={name}>{name}</option>)}</select></label>
          <label>{th ? "ค่าที่จะเพิ่ม" : "Value to apply"}<input value={edit.value} onChange={(event) => setDeferredEdits({ ...deferredEdits, [field.id]: { ...edit, value: event.target.value } })} /></label>
          <label>{th ? "เหตุผล" : "Reason"}<input value={edit.reason} onChange={(event) => setDeferredEdits({ ...deferredEdits, [field.id]: { ...edit, reason: event.target.value } })} /></label>
          <button type="button" disabled={busy || !edit.value.trim() || !edit.reason.trim()} onClick={() => void applyDeferred(field)}>{th ? "เพิ่มลงข้อมูลจริง" : "Apply value"}</button>
        </div>}
      </article>; })}
      <div className="import-page__pager"><button disabled={deferredOffset === 0} onClick={() => void loadDeferred(Math.max(0, deferredOffset - 50))}>←</button><span>{deferredOffset + 1}–{deferredOffset + deferredFields.length} / {deferredTotal}</span><button disabled={deferredOffset + deferredFields.length >= deferredTotal} onClick={() => void loadDeferred(deferredOffset + 50)}>→</button></div>
    </section>}
  </section>;
}
