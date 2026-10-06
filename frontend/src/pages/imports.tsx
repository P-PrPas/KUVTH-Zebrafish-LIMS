import { useEffect, useState } from "react";
import { request } from "../api/client";
import type { Language } from "../types";

type InspectFile = { name: string; sheets?: string[]; encoding?: string; delimiter?: string; preview?: string[][] };
type Inspect = { inputKind: "xlsx" | "csv_set"; files: InspectFile[] };
type Job = { id: string; status: string; inputKind: string; revision: number; createdAt: string };
type Detail = { job: Job; files: { id: string; fileName: string; sha256: string; sizeBytes: number }[]; recordCount: number; issueCount: number };
type RecordRow = { id: string; sheetName: string; sourceLocator: string; recordKind: string; source: Record<string, unknown>; working: Record<string, unknown>; targetTable?: string | null; targetId?: string | null };
type Issue = { id: string; sheetName: string; rowNo: number | null; sourceColumn: string | null; sourceValue: string | null; severity: string; code: string; message: string; status: string };
type MappingRequirements = { donorSources: string[]; sheetNames: string[]; recordKinds: string[]; ambiguousZeroRecords: string[]; unresolvedIssueCount: number; canConfirmFishSpecimens: boolean };
type MasterOption = { id: string; code?: string; name?: string; strain?: string; preparation?: string; batchCode?: string; timeZone?: string | null };

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
  const [mappingRequirements, setMappingRequirements] = useState<MappingRequirements | null>(null);
  const [siteOptions, setSiteOptions] = useState<MasterOption[]>([]);
  const [donorOptions, setDonorOptions] = useState<MasterOption[]>([]);
  const [siteMappings, setSiteMappings] = useState<Record<string, string>>({});
  const [donorMappings, setDonorMappings] = useState<Record<string, string>>({});
  const [zeroBypassReason, setZeroBypassReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function reloadJobs() {
    const result = await json<{ items: Job[] }>("/imports");
    setJobs(result.items);
  }
  async function openJob(id: string, nextRecords = 0, nextIssues = 0) {
    if (detail?.job.id !== id) {
      setSiteMappings({}); setDonorMappings({}); setZeroBypassReason("");
    }
    const [nextDetail, nextRecordPage, nextIssuePage, requirements, siteCatalog, donorCatalog] = await Promise.all([
      json<Detail>(`/imports/${id}`),
      json<{ items: RecordRow[] }>(`/imports/${id}/records?offset=${nextRecords}&limit=50`),
      json<{ items: Issue[] }>(`/imports/${id}/issues?offset=${nextIssues}&limit=50`),
      json<MappingRequirements>(`/imports/${id}/mapping-requirements`),
      json<{ items: MasterOption[] }>("/sites?limit=500"),
      json<{ items: MasterOption[] }>("/donor-cell-lines?limit=500"),
    ]);
    setDetail(nextDetail);
    setRecords(nextRecordPage.items);
    setIssues(nextIssuePage.items);
    setRecordOffset(nextRecords);
    setIssueOffset(nextIssues);
    setMappingRequirements(requirements);
    setSiteOptions(siteCatalog.items);
    setDonorOptions(donorCatalog.items);
    setEditing(null);
    setInterpretation(null);
  }
  useEffect(() => { void reloadJobs().catch((cause: Error) => setError(cause.message)); }, []);

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
      const created = await json<{ job: Job }>("/imports", { method: "POST", body: form });
      await reloadJobs();
      await openJob(created.job.id);
      setInspection(null); setFiles([]);
      setNotice(th ? "บันทึกฉบับร่างสำหรับตรวจข้อมูลแล้ว" : "Draft saved for review.");
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

  return <section className="import-page">
    <header className="import-page__header"><div><p className="eyebrow">ADMIN · DATA MIGRATION</p><h1>{th ? "นำเข้าข้อมูลย้อนหลัง" : "Historical import"}</h1>
      <p className="muted">{th ? "เลือกต้นทาง ตรวจข้อมูลและแก้ฉบับร่างก่อนนำเข้าระบบ" : "Select sources and review draft values before importing."}</p></div></header>
    {error && <p className="import-page__error" role="alert">{error}</p>}
    {notice && <p className="import-page__notice" role="status">{notice}</p>}
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
      <div className="import-page__files">{detail.files.map((file) => <button type="button" key={file.id} onClick={() => void download(file.id, file.fileName)}>{file.fileName} ↓ <small>SHA-256 {file.sha256.slice(0, 12)}…</small></button>)}</div>
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
      <h3>{th ? "ประเด็นที่ต้องตรวจ" : "Issues"}</h3>
      {issues.length ? issues.map((issue) => <article key={issue.id} className="import-page__item"><div><strong>{issue.sheetName}{issue.rowNo ? ` · ${issue.sourceColumn ?? ""}${issue.rowNo}` : ""}</strong> <span className={`import-page__badge import-page__badge--${issue.severity}`}>{issue.severity}</span> <span>{issue.status}</span></div>
        <p>{issue.message}</p>{issue.sourceValue && <code>{issue.sourceValue}</code>}
        {issue.status === "open" && <div className="import-page__actions"><label>{th ? "เหตุผล" : "Reason"}<input value={decisionReason[issue.id] ?? ""} onChange={(event) => setDecisionReason({ ...decisionReason, [issue.id]: event.target.value })} /></label>
          <button disabled={busy || !decisionReason[issue.id]?.trim()} onClick={() => void decide(issue, "corrected")}>{th ? "แก้ไขแล้ว" : "Corrected"}</button>
          {issue.severity === "overridable" && <button disabled={busy || !decisionReason[issue.id]?.trim()} onClick={() => void decide(issue, "bypassed")}>{th ? "ข้ามพร้อมเหตุผล" : "Bypass with reason"}</button>}
          {issue.severity === "warning" && <button disabled={busy || !decisionReason[issue.id]?.trim()} onClick={() => void decide(issue, "dismissed")}>{th ? "รับทราบ" : "Acknowledge"}</button>}
        </div>}</article>) : <p className="muted">{th ? "ไม่มีประเด็นในหน้านี้" : "No issues on this page."}</p>}
      <div className="import-page__pager"><button disabled={issueOffset === 0} onClick={() => void openJob(detail.job.id, recordOffset, Math.max(0, issueOffset - 50))}>←</button><span>{issueOffset + 1}–{issueOffset + issues.length}</span><button disabled={issueOffset + issues.length >= detail.issueCount} onClick={() => void openJob(detail.job.id, recordOffset, issueOffset + 50)}>→</button></div>
      <h3>{th ? "ข้อมูลต้นทางและฉบับแก้ไข" : "Source and working values"}</h3>
      {records.map((row) => <article key={row.id} className="import-page__item"><div><strong>{row.sheetName} · {row.sourceLocator}</strong> <span>{row.recordKind}</span></div>
        {row.targetId && <p className="muted">{th ? "บันทึกเป็น" : "Imported as"} {row.targetTable} · {row.targetId}</p>}
        {(["fish", "specimen", "embryo_candidate"].includes(row.recordKind)) && <button type="button" onClick={() => void showInterpretation(row.id)}>{th ? "ดูความหมายที่ระบบอ่านได้" : "View interpretation"}</button>}
        {interpretation?.recordId === row.id && <div className="import-page__interpretation"><strong>{th ? "ผลอ่านข้อมูล" : "Interpreted values"}</strong>
          <pre>{JSON.stringify({ ...interpretation.value, observations: undefined, stageObservations: undefined, dailySurvival: undefined }, null, 2)}</pre>
          {Array.isArray(interpretation.value.observations) && <p>{th ? "รายการสังเกต" : "Observations"}: {interpretation.value.observations.length}</p>}
          {Array.isArray(interpretation.value.stageObservations) && <p>{th ? "ระยะตัวอ่อนที่บันทึก" : "Recorded embryo stages"}: {interpretation.value.stageObservations.length}</p>}
          {Array.isArray(interpretation.value.dailySurvival) && <p>{th ? "วันที่ติดตาม" : "Daily tracking entries"}: {interpretation.value.dailySurvival.length}</p>}
        </div>}
        <div className="import-page__comparison"><div><h4>{th ? "ต้นฉบับ" : "Original"}</h4><pre>{JSON.stringify(row.source, null, 2)}</pre></div><div><h4>{th ? "ฉบับแก้ไข" : "Working copy"}</h4>{editing === row.id ? <><textarea rows={9} value={workingText} onChange={(event) => setWorkingText(event.target.value)} aria-label="Working JSON" /><label>{th ? "เหตุผลการแก้" : "Edit reason"}<input value={reason} onChange={(event) => setReason(event.target.value)} /></label><button disabled={busy || !reason.trim()} onClick={() => void saveRecord(row)}>{th ? "บันทึก" : "Save"}</button><button onClick={() => setEditing(null)}>{th ? "ยกเลิก" : "Cancel"}</button></> : <><pre>{JSON.stringify(row.working, null, 2)}</pre><button disabled={detail.job.status !== "draft"} onClick={() => { setEditing(row.id); setWorkingText(JSON.stringify(row.working, null, 2)); setReason(""); }}>{th ? "แก้ไขข้อมูล" : "Edit values"}</button></>}</div></div>
      </article>)}
      <div className="import-page__pager"><button disabled={recordOffset === 0} onClick={() => void openJob(detail.job.id, Math.max(0, recordOffset - 50), issueOffset)}>←</button><span>{recordOffset + 1}–{recordOffset + records.length}</span><button disabled={recordOffset + records.length >= detail.recordCount} onClick={() => void openJob(detail.job.id, recordOffset + 50, issueOffset)}>→</button></div>
    </section>}
  </section>;
}
