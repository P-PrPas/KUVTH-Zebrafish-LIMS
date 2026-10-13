import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type ApiItem, get, request } from "../api/client";
import { type AuthUser, cachedUser } from "../auth";
import { Empty, ErrorMessage, Icon } from "../components";
import { notify } from "../notifications";
import { dateTimeLocalToRFC3339, formatBangkokDateTime, rfc3339ToDateTimeLocal } from "../time";
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
  auth_user: ["บัญชีผู้ใช้", "User account"],
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
  auth_user: [{ name: "operatorId", th: "ผู้ปฏิบัติงานที่เชื่อมกับบัญชี", en: "Linked operator", resource: "operators" }],
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
  defaultOpen = false,
  onSubmitted,
}: {
  table: string;
  item: ApiItem;
  language: Language;
  defaultOpen?: boolean;
  onSubmitted?: () => void;
}) {
  const thai = language === "th";
  const fields = correctionFields[table] ?? [];
  const [open, setOpen] = useState(defaultOpen);
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
      notify(thai ? "ส่งคำร้องแก้ไขแล้ว" : "Correction request submitted.");
      setPendingFields((current) => [...current, fieldName]);
      setOwnPendingFields((current) => [...current, fieldName]);
      setReason("");
      setOpen(false);
      setMessage(thai ? "ส่งคำร้องให้แอดมินแล้ว" : "Request sent to administrators.");
      onSubmitted?.();
    } catch (error) {
      setMessage((error as Error).message);
      notify((error as Error).message, "danger");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="correction-entry">
      {!defaultOpen && (
        <button className="button button--secondary" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
          {thai ? "ขอแก้ไขข้อมูล" : "Request correction"}
        </button>
      )}
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
          <p className="muted correction-target">
            {tableLabels[table]?.[thai ? 0 : 1] ?? table} ·{" "}
            {String(item.email ?? item.batchCode ?? item.fishCode ?? item.embryoCode ?? item.id)}
          </p>
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
            {thai ? "ค่าเดิม" : "Current value"}:{" "}
            <strong>
              {display(
                field?.resource
                  ? (options.find((option) => option.id === item[fieldName])?.name ?? item[fieldName])
                  : item[fieldName],
                language,
              )}
            </strong>
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
                {options
                  .filter((option) => table !== "auth_user" || (option.active !== false && !option.deletedAt))
                  .map((option) => (
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
          <button
            className="button button--primary"
            disabled={
              saving ||
              ownPendingFields.includes(fieldName) ||
              (table === "auth_user" && proposed === String(item.operatorId ?? ""))
            }
          >
            {saving ? (thai ? "กำลังส่ง…" : "Sending…") : thai ? "ส่งคำร้อง" : "Submit request"}
          </button>
        </form>
      )}
    </div>
  );
}

function fieldLabel(table: string, name: string, language: Language) {
  const field = correctionFields[table]?.find((entry) => entry.name === name);
  return (language === "th" ? field?.th : field?.en) ?? name;
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

export function ProfileOperatorRequests({ user, language }: { user: AuthUser; language: Language }) {
  const { items, error, loading, refresh } = useCorrections();
  const [creating, setCreating] = useState(false);
  const thai = language === "th";
  const account = useMemo(
    () => ({ id: user.id, email: user.email, operatorId: user.operatorId ?? undefined }),
    [user.id, user.email, user.operatorId],
  );
  const own = items
    .filter((row) => row.targetTable === "auth_user" && row.targetId === user.id && row.requesterId === user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const pending = own.find((row) => row.status === "pending");
  const latest = pending ?? own[0];
  useEffect(() => {
    const updateAccount = () => window.dispatchEvent(new Event("chronofish:auth-refresh"));
    updateAccount();
    window.addEventListener("focus", updateAccount);
    const timer = window.setInterval(updateAccount, 30_000);
    return () => {
      window.removeEventListener("focus", updateAccount);
      window.clearInterval(timer);
    };
  }, []);
  return (
    <div className="profile-operator-requests">
      {error && <ErrorMessage message={error} />}
      {loading ? (
        <p role="status">{thai ? "กำลังตรวจสอบคำขอ…" : "Checking requests…"}</p>
      ) : (
        <>
          {latest && <RequestCard row={latest} language={language} admin={false} onChanged={refresh} />}
          {!pending && !error && (
            <button
              className="button button--secondary"
              type="button"
              aria-expanded={creating}
              onClick={() => setCreating(!creating)}
            >
              {creating ? (thai ? "ยกเลิก" : "Cancel") : thai ? "ขอเปลี่ยนผู้ปฏิบัติงาน" : "Request an operator change"}
            </button>
          )}
          {creating && !pending && !error && (
            <CorrectionRequestButton
              key={`${user.id}:${user.operatorId}`}
              table="auth_user"
              item={account}
              language={language}
              defaultOpen
              onSubmitted={() => {
                setCreating(false);
                refresh();
              }}
            />
          )}
        </>
      )}
      <a href="/#my-requests">{thai ? "ดูประวัติคำร้องทั้งหมด" : "View all request history"}</a>
    </div>
  );
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
      notify(
        action === "approve"
          ? thai
            ? "อนุมัติและแก้ไขข้อมูลแล้ว"
            : "Correction approved and applied."
          : action === "reject"
            ? thai
              ? "ปฏิเสธคำร้องแล้ว"
              : "Correction request rejected."
            : thai
              ? "ถอนคำร้องแล้ว"
              : "Correction request withdrawn.",
      );
      onChanged();
    } catch (cause) {
      setError((cause as Error).message);
      notify((cause as Error).message, "danger");
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
        {formatBangkokDateTime(row.createdAt)}
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
        <span className="correction-values__arrow" aria-hidden="true">
          →
        </span>
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
      {error && <ErrorMessage message={error} toast />}
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
            <details className="correction-reject">
              <summary>{thai ? "ปฏิเสธคำร้อง" : "Reject request"}</summary>
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
            </details>
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

function RequestCreator({
  language,
  onSubmitted,
  onCancel,
}: {
  language: Language;
  onSubmitted: () => void;
  onCancel: () => void;
}) {
  const thai = language === "th";
  const [account] = useState<ApiItem | null>(() => {
    const user = cachedUser();
    return user ? { ...user, operatorId: user.operatorId ?? undefined } : null;
  });
  const [kind, setKind] = useState(
    new URLSearchParams(location.search).get("request") === "operator" ? "operator" : "data",
  );
  const [table, setTable] = useState("experiment_batch");
  const [roots, setRoots] = useState<ApiItem[]>([]);
  const [rootId, setRootId] = useState("");
  const [detail, setDetail] = useState<ApiItem | null>(null);
  const [targetId, setTargetId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const resource = table === "clone_fish" || table === "fish_observation" ? "fish" : "batches";
  useEffect(() => {
    if (kind !== "data") return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setRoots([]);
    void get(`/${resource}`)
      .then((data) => {
        if (!cancelled) setRoots(data.items ?? []);
      })
      .catch((cause) => {
        if (!cancelled) setError((cause as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [resource, kind]);
  useEffect(() => {
    setDetail(null);
    if (!rootId || kind !== "data") return;
    let cancelled = false;
    setLoading(true);
    setError("");
    void get(`/${resource}/${rootId}`)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((cause) => {
        if (!cancelled) setError((cause as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [rootId, resource, kind]);
  const rootTable = table === "experiment_batch" || table === "clone_fish";
  const lots = (detail?.injectionLots as ApiItem[] | undefined) ?? [];
  const records =
    table === "injection_lot"
      ? lots
      : table === "embryo"
        ? lots.flatMap((lot) => (lot.embryos as ApiItem[] | undefined) ?? [])
        : ((detail?.observations as ApiItem[] | undefined) ?? []);
  const target = rootTable ? detail : records.find((record) => record.id === targetId);
  return (
    <section className="form-card request-creator" id="request-creator">
      <div className="request-creator__heading">
        <h2>{thai ? "สร้างคำร้องใหม่" : "Create a request"}</h2>
        <button className="button button--secondary" type="button" onClick={onCancel}>
          {thai ? "ยกเลิก" : "Cancel"}
        </button>
      </div>
      <label>
        {thai ? "ประเภทคำร้อง" : "Request type"}
        <select value={kind} onChange={(event) => setKind(event.target.value)}>
          <option value="data">{thai ? "ขอแก้ไขข้อมูล" : "Correct a record"}</option>
          <option value="operator">{thai ? "ขอเปลี่ยนผู้ปฏิบัติงานของบัญชี" : "Change my linked operator"}</option>
        </select>
      </label>
      {kind === "operator" && account ? (
        <>
          <p className="muted">
            {thai
              ? "ผู้ปฏิบัติงานผูกกับบัญชี เลือกชื่อที่ต้องการและระบุเหตุผลเพื่อให้ Admin พิจารณา การเปลี่ยนมีผลเมื่ออนุมัติแล้ว"
              : "Your operator is linked to your account. Choose the requested operator and explain why. The change takes effect after admin approval."}
          </p>
          <CorrectionRequestButton
            table="auth_user"
            item={account}
            language={language}
            defaultOpen
            onSubmitted={onSubmitted}
          />
        </>
      ) : (
        <>
          <div className="request-record-picker">
            <label>
              {thai ? "ข้อมูลที่ต้องการแก้" : "Record type"}
              <select
                value={table}
                onChange={(event) => {
                  setTable(event.target.value);
                  setRootId("");
                  setTargetId("");
                  setDetail(null);
                }}
              >
                {["experiment_batch", "injection_lot", "embryo", "clone_fish", "fish_observation"].map((key) => (
                  <option key={key} value={key}>
                    {tableLabels[key][thai ? 0 : 1]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {resource === "fish" ? (thai ? "เลือกปลา" : "Select fish") : thai ? "เลือกการทดลอง" : "Select experiment"}
              <select
                disabled={loading}
                value={rootId}
                onChange={(event) => {
                  setRootId(event.target.value);
                  setTargetId("");
                  setDetail(null);
                }}
              >
                <option value="">{thai ? "เลือกรายการ" : "Select a record"}</option>
                {roots.map((record) => (
                  <option key={String(record.id)} value={String(record.id)}>
                    {String(record.batchCode ?? record.fishCode ?? record.id)}
                  </option>
                ))}
              </select>
            </label>
            {!rootTable && detail && (
              <label>
                {thai ? "เลือกรายการย่อย" : "Select related record"}
                <select value={targetId} onChange={(event) => setTargetId(event.target.value)}>
                  <option value="">{thai ? "เลือกรายการ" : "Select a record"}</option>
                  {records.map((record) => (
                    <option key={String(record.id)} value={String(record.id)}>
                      {String(record.embryoCode ?? record.observedOn ?? `Lot ${record.lotNo}`)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <p className="muted">
            {thai
              ? "ผลตรวจตัวอ่อนสามารถส่งคำร้องจากรายการตรวจในหน้าติดตามตัวอ่อน"
              : "For embryo observations, open the observation in developmental tracking."}{" "}
            <a href="#due">{thai ? "เปิดหน้าติดตามตัวอ่อน" : "Open developmental tracking"}</a>
          </p>
          {loading && <p role="status">{thai ? "กำลังโหลดรายการ…" : "Loading records…"}</p>}
          {error && <ErrorMessage message={error} toast />}
          {!loading && target && (
            <CorrectionRequestButton
              key={`${table}:${target.id}`}
              table={table}
              item={target}
              language={language}
              defaultOpen
              onSubmitted={onSubmitted}
            />
          )}
        </>
      )}
    </section>
  );
}

export function MyRequests({ language }: { language: Language }) {
  return <RequestsWorkspace language={language} admin={false} />;
}

export function AdminRequests({ language }: { language: Language }) {
  return <RequestsWorkspace language={language} admin />;
}

function RequestsWorkspace({ language, admin }: { language: Language; admin: boolean }) {
  const { items, error, loading, refresh } = useCorrections();
  const [status, setStatus] = useState(admin ? "pending" : "all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const member = cachedUser()?.role === "member";
  const [creatorOpen, setCreatorOpen] = useState(
    member && new URLSearchParams(location.search).get("request") === "operator",
  );
  const listPosition = useRef(0);
  const listScroll = useRef(0);
  const detailRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const thai = language === "th";
  const shown = items.filter(
    (row) =>
      (status === "all" || row.status === status) &&
      [
        row.targetLabel,
        row.targetId,
        row.requesterEmail,
        row.reason,
        fieldLabel(row.targetTable, row.fieldName, language),
      ].some((value) => value?.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())),
  );
  const selected = shown.find((row) => row.id === selectedId) ?? shown[0];
  return (
    <section className="work-screen corrections-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">{thai ? "คำร้องและประวัติ" : "Requests & history"}</p>
          <h1>
            {admin ? (thai ? "คำร้องแก้ไขข้อมูล" : "Correction requests") : thai ? "คำร้องของฉัน" : "My correction requests"}
          </h1>
          <p className="muted">
            {admin
              ? thai
                ? "ตรวจค่าเดิม ค่าใหม่ และผลกระทบก่อนอนุมัติ"
                : "Review the old and proposed values before approval."
              : thai
                ? "ติดตามผลคำร้องและถอนคำร้องที่ยังไม่ถูกตัดสิน"
                : "Track your requests and withdraw pending ones."}
          </p>
        </div>
        <div className="request-heading-actions">
          {!admin && member && (
            <button
              className="button button--primary"
              type="button"
              aria-expanded={creatorOpen}
              aria-controls="request-creator"
              onClick={() => setCreatorOpen(!creatorOpen)}
            >
              {thai ? "สร้างคำร้อง" : "Create request"}
            </button>
          )}
          {!loading && (
            <span className="correction-status correction-status--pending">
              {items.filter((row) => row.status === "pending").length} {thai ? "รายการรอพิจารณา" : "pending"}
            </span>
          )}
        </div>
      </header>
      {!admin && creatorOpen && (
        <RequestCreator
          language={language}
          onCancel={() => setCreatorOpen(false)}
          onSubmitted={() => {
            setCreatorOpen(false);
            setStatus("pending");
            setQuery("");
            setDetailOpen(false);
            refresh();
          }}
        />
      )}
      <div className="request-toolbar">
        <label>
          {thai ? "สถานะ" : "Status"}
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setDetailOpen(false);
            }}
          >
            <option value="pending">{thai ? "รอพิจารณา" : "Pending"}</option>
            <option value="approved">{thai ? "อนุมัติแล้ว" : "Approved"}</option>
            <option value="rejected">{thai ? "ปฏิเสธแล้ว" : "Rejected"}</option>
            <option value="withdrawn">{thai ? "ถอนแล้ว" : "Withdrawn"}</option>
            <option value="all">{thai ? "ทั้งหมด" : "All"}</option>
          </select>
        </label>
        <label>
          {thai ? "ค้นหาในคำร้องที่โหลดแล้ว" : "Search loaded requests"}
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setDetailOpen(false);
            }}
            placeholder={thai ? "รหัสรายการ ผู้ยื่น หรือเหตุผล" : "Record, requester or reason"}
          />
        </label>
        <span className="muted">
          {shown.length} / {items.length} {thai ? "รายการ" : "requests"}
        </span>
      </div>
      {error && <ErrorMessage message={error} toast />}
      {loading ? (
        <p role="status">{thai ? "กำลังโหลดคำร้อง…" : "Loading requests…"}</p>
      ) : shown.length ? (
        <div className="requests-workspace" data-detail-open={detailOpen && Boolean(selected)}>
          <div className="request-list" ref={listRef} tabIndex={-1} aria-label={thai ? "รายการคำร้อง" : "Request list"}>
            {shown.map((row) => (
              <button
                className="request-list__item"
                type="button"
                key={row.id}
                aria-pressed={selected?.id === row.id}
                onClick={() => {
                  listPosition.current = window.scrollY;
                  listScroll.current = listRef.current?.scrollTop ?? 0;
                  setSelectedId(row.id);
                  setDetailOpen(true);
                  if (window.matchMedia("(max-width: 1100px)").matches)
                    window.requestAnimationFrame(() => {
                      detailRef.current?.scrollIntoView({ block: "start" });
                      detailRef.current?.focus({ preventScroll: true });
                    });
                }}
              >
                <span className="request-list__top">
                  <span className="mono">{row.targetLabel ?? row.targetId}</span>
                  <span className={`correction-status correction-status--${row.status}`}>
                    {statusLabels[row.status][thai ? 0 : 1]}
                  </span>
                </span>
                <strong>
                  {thai ? "ขอแก้ไข" : "Correct "}
                  {fieldLabel(row.targetTable, row.fieldName, language)} ·{" "}
                  {tableLabels[row.targetTable]?.[thai ? 0 : 1] ?? row.targetTable}
                </strong>
                <small>
                  {admin ? `${row.requesterEmail} · ` : ""}
                  {formatBangkokDateTime(row.createdAt)}
                </small>
              </button>
            ))}
          </div>
          {selected && (
            <div
              className="request-detail"
              ref={detailRef}
              tabIndex={-1}
              role="region"
              aria-label={thai ? "รายละเอียดคำร้อง" : "Request details"}
            >
              <button
                className="button button--secondary request-detail__back"
                type="button"
                onClick={() => {
                  setDetailOpen(false);
                  window.requestAnimationFrame(() => {
                    if (listRef.current) listRef.current.scrollTop = listScroll.current;
                    window.scrollTo({ top: listPosition.current, behavior: "auto" });
                    const active = listRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
                    (active ?? listRef.current)?.focus({ preventScroll: true });
                  });
                }}
              >
                {thai ? "กลับรายการคำร้อง" : "Back to requests"}
              </button>
              <RequestCard key={selected.id} row={selected} language={language} admin={admin} onChanged={refresh} />
            </div>
          )}
        </div>
      ) : (
        <Empty
          message={
            !items.length && !admin
              ? thai
                ? "ยังไม่มีคำร้อง"
                : "No requests yet."
              : thai
                ? "ไม่มีคำร้องในสถานะนี้"
                : "No requests in this status."
          }
        />
      )}
    </section>
  );
}

export function AdminHome({
  language,
  onNavigate,
}: {
  language: Language;
  onNavigate: (page: "corrections" | "members" | "master" | "timing" | "audit" | "imports") => void;
}) {
  const { items, error, loading } = useCorrections();
  const thai = language === "th";
  const pending = items.filter((item) => item.status === "pending").length;
  return (
    <section className="work-screen admin-home">
      <header className="page-heading">
        <div>
          <p className="eyebrow">KUVACB · Administration</p>
          <h1>{thai ? "ดูแลระบบ" : "Administration"}</h1>
          <p className="muted">{thai ? "งานที่ต้องพิจารณาและการตั้งค่าห้องแล็บ" : "Pending decisions and lab settings."}</p>
        </div>
        <a className="button button--secondary" href="/">
          {thai ? "กลับเว็บหลัก" : "Research workspace"}
        </a>
      </header>
      {error && <ErrorMessage message={error} toast />}
      <div className="admin-home__grid">
        <button className="admin-home__feature" type="button" onClick={() => onNavigate("corrections")}>
          <Icon name="audit" />
          <span className="admin-home__count">{loading ? "…" : pending}</span>
          <strong>{thai ? "คำร้องแก้ไขข้อมูล" : "Correction requests"}</strong>
          <span>
            {loading
              ? thai
                ? "กำลังโหลดคำร้อง…"
                : "Loading requests…"
              : `${pending} ${thai ? "รายการรอพิจารณา" : "pending"}`}
          </span>
          <span className="admin-home__link">{thai ? "เปิดคำร้องที่รอพิจารณา" : "Review pending requests"} →</span>
        </button>
        <button type="button" onClick={() => onNavigate("imports")}>
          <Icon name="export" />
          <strong>{thai ? "นำเข้าข้อมูลย้อนหลัง" : "Historical import"}</strong>
          <span>{thai ? "อัปโหลดและตรวจข้อมูลเก่าของห้องแล็บ" : "Upload and review historical lab data"}</span>
        </button>
        <button type="button" onClick={() => onNavigate("members")}>
          <Icon name="people" />
          <strong>{thai ? "สมาชิกและคำเชิญ" : "Members and invitations"}</strong>
          <span>{thai ? "เชิญสมาชิกและจัดการบทบาท" : "Invite members and assign roles"}</span>
        </button>
        <button type="button" onClick={() => onNavigate("master")}>
          <Icon name="master" />
          <strong>{thai ? "ข้อมูลตั้งค่าห้องแล็บ" : "Lab settings"}</strong>
          <span>{thai ? "สถานที่ วัสดุ และผู้ปฏิบัติงาน" : "Locations, materials and operators"}</span>
        </button>
        <button type="button" onClick={() => onNavigate("timing")}>
          <Icon name="timing" />
          <strong>{thai ? "เวลามาตรฐาน" : "Timing profiles"}</strong>
          <span>{thai ? "โปรโตคอลและประวัติเวอร์ชัน" : "Protocols and version history"}</span>
        </button>
        <button type="button" onClick={() => onNavigate("audit")}>
          <Icon name="audit" />
          <strong>{thai ? "ประวัติการแก้ไข" : "Audit history"}</strong>
          <span>{thai ? "ตรวจหลักฐานก่อนและหลังเปลี่ยนข้อมูล" : "Review changes and their source"}</span>
        </button>
      </div>
    </section>
  );
}
