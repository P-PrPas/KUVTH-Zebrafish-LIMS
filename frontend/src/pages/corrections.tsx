import { type FormEvent, useCallback, useEffect, useState } from "react";
import { type ApiItem, get, request } from "../api/client";
import { cachedUser } from "../auth";
import { ErrorMessage } from "../components";
import { dateTimeLocalToRFC3339, rfc3339ToDateTimeLocal } from "../time";
import type { Language } from "../types";

type Correction = {
  id: string;
  requesterEmail: string;
  requesterId: string;
  targetTable: string;
  targetId: string;
  targetLabel?: string;
  fieldName: string;
  oldValue: unknown;
  oldLabel?: string | null;
  proposedValue: unknown;
  proposedLabel?: string | null;
  currentValue?: unknown;
  currentLabel?: string | null;
  reason: string;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  decisionReason?: string | null;
  conflict?: boolean;
  relatedAuditIds?: string[];
  validationMessage?: string;
  createdAt: string;
  updatedAt: string;
  notificationOnly?: boolean;
};

type Field = {
  name: string;
  th: string;
  en: string;
  kind?: "date" | "datetime" | "number" | "boolean";
  options?: string[];
  resource?: string;
};
const tableLabels: Record<string, [string, string]> = {
  experiment_batch: ["การทดลอง", "Experiment"],
  injection_lot: ["ล็อตฉีด", "Injection lot"],
  embryo: ["ตัวอ่อน", "Embryo"],
  embryo_observation: ["ผลตรวจตัวอ่อน", "Embryo observation"],
  clone_fish: ["ปลา", "Fish"],
  fish_observation: ["ผลตรวจปลา", "Fish observation"],
};
const statusLabels: Record<Correction["status"], [string, string]> = {
  pending: ["รอพิจารณา", "Pending"],
  approved: ["อนุมัติ", "Approved"],
  rejected: ["ปฏิเสธ", "Rejected"],
  withdrawn: ["ถอนคำร้อง", "Withdrawn"],
};
const valueLabels: Record<string, [string, string]> = {
  ALIVE: ["มีชีวิต", "Alive"],
  DEAD: ["ตาย", "Dead"],
  DEGENERATED: ["เสื่อมสภาพ", "Degenerated"],
  FROZEN: ["แช่แข็ง", "Frozen"],
  DISCARDED: ["คัดทิ้ง", "Discarded"],
  NOT_OBSERVED: ["ไม่ได้ตรวจ", "Not observed"],
  NORMAL: ["ปกติ", "Normal"],
  ABNORMAL: ["ผิดปกติ", "Abnormal"],
  UNDETERMINED: ["ยังไม่ระบุ", "Undetermined"],
  UNKNOWN: ["ยังไม่ทราบ", "Unknown"],
  HEALTHY: ["สุขภาพดี", "Healthy"],
  WEAK: ["อ่อนแอ", "Weak"],
  SICK: ["ป่วย", "Sick"],
  DISABLED: ["พิการ", "Disabled"],
  AGED: ["ชรา", "Aged"],
  M: ["เพศผู้", "Male"],
  F: ["เพศเมีย", "Female"],
};
export const correctionFields: Record<string, Field[]> = {
  experiment_batch: [
    { name: "experimentDate", th: "วันที่ทดลอง", en: "Experiment date", kind: "date" },
    { name: "dayNo", th: "วันทดลองลำดับที่", en: "Day number", kind: "number" },
    { name: "siteId", th: "สถานที่", en: "Site", resource: "sites" },
    { name: "operatorId", th: "ผู้ปฏิบัติงาน", en: "Operator", resource: "operators" },
    { name: "experimentGroupId", th: "กลุ่มการทดลอง", en: "Experiment group", resource: "experiment-groups" },
    { name: "treatmentGroupId", th: "กลุ่มเปรียบเทียบ", en: "Treatment group", resource: "treatment-groups" },
    { name: "recipientEggLotId", th: "ล็อตไข่", en: "Recipient egg lot", resource: "recipient-egg-lots" },
    { name: "csofLotId", th: "ล็อต CSOF", en: "CSOF lot", resource: "csof-lots" },
    { name: "clutchCode", th: "รหัสชุดไข่", en: "Clutch code" },
    { name: "replicateNo", th: "ครั้งที่ทำซ้ำ", en: "Replicate", kind: "number" },
    { name: "incubationTempC", th: "อุณหภูมิ", en: "Incubation temperature", kind: "number" },
    { name: "notes", th: "หมายเหตุ", en: "Notes" },
  ],
  injection_lot: [
    { name: "donorCellLineId", th: "เซลล์ผู้ให้", en: "Donor cell line", resource: "donor-cell-lines" },
    { name: "enuPowerPct", th: "กำลัง ENU (%)", en: "ENU power", kind: "number" },
    { name: "enuPulseUs", th: "จังหวะ ENU", en: "ENU pulse", kind: "number" },
    { name: "enuLed", th: "ค่า ENU LED", en: "ENU LED", kind: "number" },
    { name: "enuStartAt", th: "เวลาเริ่ม ENU", en: "ENU start", kind: "datetime" },
    { name: "enuFinishAt", th: "เวลาสิ้นสุด ENU", en: "ENU finish", kind: "datetime" },
    { name: "nEggs", th: "จำนวนไข่", en: "Egg count", kind: "number" },
    { name: "nManipulated", th: "จำนวนที่ทำ", en: "Manipulated count", kind: "number" },
    { name: "notes", th: "หมายเหตุ", en: "Notes" },
  ],
  embryo: [{ name: "wellPosition", th: "ตำแหน่งหลุม", en: "Well position" }],
  embryo_observation: [
    { name: "observedAt", th: "เวลาตรวจ", en: "Observed at", kind: "datetime" },
    { name: "outcome", th: "ผลตรวจ", en: "Outcome", options: ["ALIVE", "DEAD", "DEGENERATED", "NOT_OBSERVED"] },
    { name: "condition", th: "สภาพ", en: "Condition", options: ["NORMAL", "ABNORMAL", "UNDETERMINED"] },
    { name: "notes", th: "หมายเหตุ", en: "Notes" },
  ],
  clone_fish: [
    { name: "fishCode", th: "รหัสปลา", en: "Fish code" },
    { name: "fishBoxId", th: "กล่องปลา", en: "Fish box", resource: "fish-boxes" },
    { name: "sex", th: "เพศ", en: "Sex", options: ["UNKNOWN", "M", "F"] },
    { name: "finClipped", th: "ตัดครีบแล้ว", en: "Fin clipped", kind: "boolean" },
    { name: "remarks", th: "หมายเหตุ", en: "Remarks" },
  ],
  fish_observation: [
    { name: "observedOn", th: "วันที่ตรวจ", en: "Observed on", kind: "date" },
    { name: "outcome", th: "ผลตรวจ", en: "Outcome", options: ["ALIVE", "DEAD", "FROZEN", "DISCARDED"] },
    { name: "condition", th: "สภาพ", en: "Condition", options: ["NORMAL", "ABNORMAL", "UNDETERMINED"] },
    {
      name: "healthStatus",
      th: "สุขภาพ",
      en: "Health status",
      options: ["HEALTHY", "WEAK", "SICK", "DISABLED", "AGED", "UNDETERMINED"],
    },
    { name: "notes", th: "หมายเหตุ", en: "Notes" },
  ],
};

function display(value: unknown, language: Language = "en"): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return language === "th" ? (value ? "ใช่" : "ไม่ใช่") : value ? "Yes" : "No";
  return valueLabels[String(value)]?.[language === "th" ? 0 : 1] ?? String(value);
}

export function CorrectionRequestButton({
  table,
  item,
  language,
}: {
  table: string;
  item: ApiItem;
  language: Language;
}) {
  const thai = language === "th";
  const fields = correctionFields[table] ?? [];
  const [open, setOpen] = useState(false);
  const [fieldName, setFieldName] = useState(fields[0]?.name ?? "");
  const [proposed, setProposed] = useState("");
  const [reason, setReason] = useState("");
  const [options, setOptions] = useState<ApiItem[]>([]);
  const [pendingFields, setPendingFields] = useState<string[]>([]);
  const [ownPendingFields, setOwnPendingFields] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const field = fields.find((candidate) => candidate.name === fieldName);
  const clearable = [
    "notes",
    "remarks",
    "wellPosition",
    "fishBoxId",
    "recipientEggLotId",
    "csofLotId",
    "experimentGroupId",
  ].includes(fieldName);

  useEffect(() => {
    if (!item.id || cachedUser()?.role !== "member") return;
    void get(
      `/corrections/markers?targetTable=${encodeURIComponent(table)}&targetId=${encodeURIComponent(String(item.id))}`,
    )
      .then((result) => {
        setPendingFields((result.fields as string[]) ?? []);
        setOwnPendingFields((result.ownFields as string[]) ?? []);
      })
      .catch(() => {
        setPendingFields([]);
        setOwnPendingFields([]);
      });
  }, [open, table, item.id]);
  useEffect(() => {
    if (!field?.resource || !open) return;
    void get(`/${field.resource}?includeInactive=true`)
      .then((result) => setOptions(result.items ?? []))
      .catch(() => setOptions([]));
  }, [field?.resource, open]);
  useEffect(() => {
    const current = item[fieldName];
    setProposed(
      field?.kind === "datetime" && current
        ? rfc3339ToDateTimeLocal(String(current))
        : current == null
          ? ""
          : String(current),
    );
  }, [fieldName, field?.kind, item]);

  if (cachedUser()?.role !== "member" || !fields.length) return null;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!navigator.onLine) {
      setMessage(thai ? "ต้องเชื่อมต่ออินเทอร์เน็ตก่อนส่งคำร้อง" : "Connect to the internet before submitting.");
      return;
    }
    setSaving(true);
    setMessage("");
    let value: unknown = proposed;
    if (clearable && proposed === "") value = null;
    if (field?.kind === "number") value = Number(proposed);
    if (field?.kind === "boolean") value = proposed === "true";
    if (field?.kind === "datetime") value = dateTimeLocalToRFC3339(proposed);
    try {
      await request("/corrections", {
        method: "POST",
        body: JSON.stringify({ targetTable: table, targetId: item.id, fieldName, proposedValue: value, reason }),
      });
      setPendingFields((current) => [...current, fieldName]);
      setOwnPendingFields((current) => [...current, fieldName]);
      setReason("");
      setOpen(false);
      setMessage(thai ? "ส่งคำร้องให้แอดมินแล้ว" : "Request sent to administrators.");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="correction-entry">
      <button className="button button--secondary" type="button" onClick={() => setOpen(!open)}>
        {thai ? "ขอแก้ไขข้อมูล" : "Request correction"}
      </button>
      {pendingFields.length > 0 && (
        <small>
          {thai
            ? `มีคำร้องค้าง: ${pendingFields.map((name) => fields.find((entry) => entry.name === name)?.th ?? name).join(", ")}`
            : `Pending: ${pendingFields.join(", ")}`}
        </small>
      )}
      {message && <p role="status">{message}</p>}
      {open && (
        <form className="form-card correction-form" onSubmit={(event) => void submit(event)}>
          <h3>{thai ? "ยื่นคำร้องแก้ไข" : "Request a correction"}</h3>
          <label>
            {thai ? "ช่องข้อมูล" : "Field"}
            <select value={fieldName} onChange={(event) => setFieldName(event.target.value)}>
              {fields.map((entry) => (
                <option key={entry.name} value={entry.name}>
                  {thai ? entry.th : entry.en}
                </option>
              ))}
            </select>
          </label>
          <p>
            {thai ? "ค่าเดิม" : "Current value"}: <strong>{display(item[fieldName], language)}</strong>
          </p>
          {pendingFields.includes(fieldName) && (
            <p role="status">
              {ownPendingFields.includes(fieldName)
                ? thai
                  ? "คุณมีคำร้องค้างสำหรับช่องนี้แล้ว"
                  : "You already have a pending request for this field."
                : thai
                  ? "สมาชิกคนอื่นมีคำร้องค้างอยู่ คุณยังยื่นคำร้องได้"
                  : "Another member has a pending request. You may still submit yours."}
            </p>
          )}
          <label>
            {thai ? "ค่าที่ต้องการแก้" : "Proposed value"}
            {field?.resource ? (
              <select required={!clearable} value={proposed} onChange={(event) => setProposed(event.target.value)}>
                <option value="">{clearable ? (thai ? "ไม่ระบุ" : "None") : thai ? "เลือกค่า" : "Select a value"}</option>
                {options.map((option) => (
                  <option key={String(option.id)} value={String(option.id)}>
                    {String(
                      option.name ??
                        option.code ??
                        option.label ??
                        option.boxCode ??
                        option.lotCode ??
                        option.strain ??
                        option.id,
                    )}
                  </option>
                ))}
              </select>
            ) : field?.options ? (
              <select required value={proposed} onChange={(event) => setProposed(event.target.value)}>
                <option value="">{thai ? "เลือกค่า" : "Select a value"}</option>
                {field.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : field?.kind === "boolean" ? (
              <select value={proposed} onChange={(event) => setProposed(event.target.value)}>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            ) : (
              <input
                required={!clearable}
                maxLength={field?.kind ? undefined : 2000}
                type={
                  field?.kind === "number"
                    ? "number"
                    : field?.kind === "date"
                      ? "date"
                      : field?.kind === "datetime"
                        ? "datetime-local"
                        : "text"
                }
                step={field?.kind === "number" ? "any" : undefined}
                value={proposed}
                onChange={(event) => setProposed(event.target.value)}
              />
            )}
          </label>
          <label>
            {thai ? "เหตุผล" : "Reason"}
            <textarea required maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          <button className="button button--primary" disabled={saving || ownPendingFields.includes(fieldName)}>
            {saving ? (thai ? "กำลังส่ง…" : "Sending…") : thai ? "ส่งคำร้อง" : "Submit request"}
          </button>
        </form>
      )}
    </div>
  );
}

function useCorrections() {
  const [items, setItems] = useState<Correction[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(() => {
    void get("/corrections")
      .then((data) => {
        setItems((data.items ?? []) as unknown as Correction[]);
        setError("");
      })
      .catch((cause: Error) => setError(cause.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);
  return { items, error, loading, refresh };
}

function RequestCard({
  row,
  language,
  admin,
  onChanged,
}: {
  row: Correction;
  language: Language;
  admin: boolean;
  onChanged: () => void;
}) {
  const thai = language === "th";
  const [rejectReason, setRejectReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewed, setReviewed] = useState<Correction | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const review = async () => {
    setReviewing(true);
    setError("");
    try {
      const result = await get(`/corrections/${row.id}`);
      setReviewed(result as unknown as Correction);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setReviewing(false);
    }
  };
  const detail = reviewed ?? row;
  const act = async (action: "approve" | "reject" | "withdraw") => {
    if (
      action === "approve" &&
      !window.confirm(thai ? "อนุมัติและแก้ข้อมูลทันทีหรือไม่?" : "Approve and apply this correction now?")
    )
      return;
    setBusy(true);
    setError("");
    try {
      await request(`/corrections/${row.id}/${action === "withdraw" ? "withdraw" : "decide"}`, {
        method: "POST",
        body: JSON.stringify(action === "withdraw" ? {} : { decision: action, reason: rejectReason }),
      });
      onChanged();
    } catch (cause) {
      setError((cause as Error).message);
      onChanged();
    } finally {
      setBusy(false);
    }
  };
  const label = correctionFields[row.targetTable]?.find((field) => field.name === row.fieldName);
  const audit = `/admin?auditTable=${encodeURIComponent(row.targetTable)}&auditRecordId=${encodeURIComponent(row.targetId)}#audit`;
  return (
    <article className="correction-card">
      <div className="correction-card__header">
        <strong>{thai ? (label?.th ?? row.fieldName) : (label?.en ?? row.fieldName)}</strong>
        <span className={`correction-status correction-status--${row.status}`}>
          {statusLabels[row.status][thai ? 0 : 1]}
        </span>
      </div>
      <small>
        {tableLabels[row.targetTable]?.[thai ? 0 : 1] ?? row.targetTable}: {row.targetLabel ?? row.targetId} ·{" "}
        {new Date(row.createdAt).toLocaleString()}
      </small>
      {admin && (
        <p>
          {thai ? "ผู้ยื่น" : "Requester"}: {row.requesterEmail}
        </p>
      )}
      <div className="correction-values">
        <span>
          {thai ? "เดิม" : "Before"} <strong>{display(row.oldLabel ?? row.oldValue, language)}</strong>
        </span>
        <span>→</span>
        <span>
          {thai ? "เสนอ" : "Proposed"} <strong>{display(row.proposedLabel ?? row.proposedValue, language)}</strong>
        </span>
      </div>
      {row.notificationOnly && (
        <p>
          {thai
            ? "ข้อมูลที่คุณบันทึกไว้ได้รับการแก้ไขตามคำร้องที่แอดมินอนุมัติ"
            : "A record you entered was corrected after administrator approval."}
        </p>
      )}
      {row.reason && (
        <p>
          {thai ? "เหตุผล" : "Reason"}: {row.reason}
        </p>
      )}
      {detail.conflict && (
        <div className="error" role="alert">
          <strong>
            {thai
              ? "ข้อมูลต้นฉบับเปลี่ยนไปแล้ว — ไม่สามารถอนุมัติคำร้องนี้"
              : "The original record has changed. This request cannot be approved."}
          </strong>
          <p>
            {thai ? "ค่าปัจจุบัน" : "Current value"}: {display(detail.currentLabel ?? detail.currentValue, language)}
          </p>
          {admin && (
            <p>
              {thai ? "ตรวจประวัติรายการที่เปลี่ยน" : "Review related changes"}:{" "}
              <a href={audit}>{thai ? "เปิด audit log" : "Open audit log"}</a>
            </p>
          )}
          {admin && detail.relatedAuditIds?.length ? (
            <ul>
              {detail.relatedAuditIds.map((id) => (
                <li key={id}>
                  <a
                    href={`/admin?auditTable=${encodeURIComponent(row.targetTable)}&auditRecordId=${encodeURIComponent(row.targetId)}&auditLogId=${encodeURIComponent(id)}#audit`}
                  >
                    Log {id}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
      {detail.validationMessage && (
        <div className="error" role="alert">
          {thai ? "ค่าใหม่ยังใช้ไม่ได้: " : "The proposed value cannot be applied: "}
          {detail.validationMessage}
        </div>
      )}
      {row.decisionReason && (
        <p>
          {thai ? "เหตุผลที่ปิดคำร้อง" : "Decision reason"}: {row.decisionReason}
        </p>
      )}
      {row.status === "approved" && admin && <a href={audit}>{thai ? "ดูประวัติการแก้ไข" : "View audit history"}</a>}
      {error && <ErrorMessage message={error} />}
      {row.status === "pending" &&
        (admin ? (
          <div className="correction-actions">
            <button
              className="button button--secondary"
              type="button"
              disabled={reviewing}
              onClick={() => void review()}
            >
              {reviewing ? (thai ? "กำลังตรวจ…" : "Checking…") : thai ? "ตรวจข้อมูลก่อนตัดสินใจ" : "Review before decision"}
            </button>
            {reviewed && !detail.conflict && !detail.validationMessage && (
              <button
                className="button button--primary"
                type="button"
                disabled={busy}
                onClick={() => void act("approve")}
              >
                {thai ? "อนุมัติและแก้ข้อมูล" : "Approve and apply"}
              </button>
            )}
            <label>
              {thai ? "เหตุผลที่ปฏิเสธ" : "Rejection reason"}
              <textarea
                required
                maxLength={2000}
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
              />
            </label>
            <button
              className="button button--secondary"
              type="button"
              disabled={busy || !rejectReason.trim()}
              onClick={() => void act("reject")}
            >
              {thai ? "ปฏิเสธคำร้อง" : "Reject"}
            </button>
          </div>
        ) : (
          <button
            className="button button--secondary"
            type="button"
            disabled={busy}
            onClick={() => void act("withdraw")}
          >
            {thai ? "ถอนคำร้อง" : "Withdraw request"}
          </button>
        ))}
    </article>
  );
}

export function MyRequests({ language }: { language: Language }) {
  const { items, error, loading, refresh } = useCorrections();
  const thai = language === "th";
  return (
    <section className="corrections-page">
      <h1>{thai ? "คำร้องของฉัน" : "My correction requests"}</h1>
      <p className="muted">
        {thai ? "ติดตามผลคำร้องและถอนคำร้องที่ยังไม่ถูกตัดสิน" : "Track your requests and withdraw pending ones."}
      </p>
      {error && <ErrorMessage message={error} />}
      {loading ? (
        <p role="status">{thai ? "กำลังโหลดคำร้อง…" : "Loading requests…"}</p>
      ) : items.length ? (
        items.map((row) => <RequestCard key={row.id} row={row} language={language} admin={false} onChanged={refresh} />)
      ) : (
        <p>{thai ? "ยังไม่มีคำร้อง" : "No requests yet."}</p>
      )}
    </section>
  );
}

export function AdminRequests({ language }: { language: Language }) {
  const { items, error, loading, refresh } = useCorrections();
  const [status, setStatus] = useState("pending");
  const thai = language === "th";
  const shown = items.filter((row) => status === "all" || row.status === status);
  return (
    <section className="corrections-page">
      <h1>{thai ? "คำร้องแก้ไขข้อมูล" : "Correction requests"}</h1>
      <p className="muted">
        {thai ? "ตรวจค่าเดิม ค่าใหม่ และผลกระทบก่อนอนุมัติ" : "Review the old and proposed values before approval."}
      </p>
      <label>
        {thai ? "สถานะ" : "Status"}
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="pending">{thai ? "รอพิจารณา" : "Pending"}</option>
          <option value="approved">{thai ? "อนุมัติแล้ว" : "Approved"}</option>
          <option value="rejected">{thai ? "ปฏิเสธแล้ว" : "Rejected"}</option>
          <option value="all">{thai ? "ทั้งหมด" : "All"}</option>
        </select>
      </label>
      {error && <ErrorMessage message={error} />}
      {loading ? (
        <p role="status">{thai ? "กำลังโหลดคำร้อง…" : "Loading requests…"}</p>
      ) : shown.length ? (
        shown.map((row) => <RequestCard key={row.id} row={row} language={language} admin onChanged={refresh} />)
      ) : (
        <p>{thai ? "ไม่มีคำร้องในสถานะนี้" : "No requests in this status."}</p>
      )}
    </section>
  );
}

export function AdminHome({
  language,
  onNavigate,
}: {
  language: Language;
  onNavigate: (page: "corrections" | "members" | "master" | "timing" | "audit") => void;
}) {
  const { items, error } = useCorrections();
  const thai = language === "th";
  const pending = items.filter((item) => item.status === "pending").length;
  return (
    <section className="admin-home">
      <h1>{thai ? "ดูแลระบบ" : "Administration"}</h1>
      <p className="muted">{thai ? "งานที่ต้องพิจารณาและการตั้งค่าห้องแล็บ" : "Pending decisions and lab settings."}</p>
      {error && <ErrorMessage message={error} />}
      <div className="admin-home__grid">
        <button type="button" onClick={() => onNavigate("corrections")}>
          <strong>{thai ? "คำร้องแก้ไขข้อมูล" : "Correction requests"}</strong>
          <span>
            {pending} {thai ? "รายการรอพิจารณา" : "pending"}
          </span>
        </button>
        <button type="button" onClick={() => onNavigate("members")}>
          <strong>{thai ? "สมาชิกและคำเชิญ" : "Members and invitations"}</strong>
          <span>{thai ? "เชิญสมาชิกและจัดการบทบาท" : "Invite members and assign roles"}</span>
        </button>
        <button type="button" onClick={() => onNavigate("master")}>
          <strong>{thai ? "ข้อมูลตั้งค่าห้องแล็บ" : "Lab settings"}</strong>
        </button>
        <button type="button" onClick={() => onNavigate("timing")}>
          <strong>{thai ? "เวลามาตรฐาน" : "Timing profiles"}</strong>
        </button>
        <button type="button" onClick={() => onNavigate("audit")}>
          <strong>{thai ? "ประวัติการแก้ไข" : "Audit history"}</strong>
        </button>
      </div>
    </section>
  );
}
