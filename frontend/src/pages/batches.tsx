import { type FormEvent, useCallback, useEffect, useState } from "react";
import { type ApiItem, get, operatorId } from "../api/client";
import { Empty, ErrorMessage } from "../components";
import { parseFilters, withFilters } from "../filters";
import { saveObservationLocation } from "../observation-draft";
import { putQueue, type QueuedWrite } from "../offline";
import { dateTimeLocalToRFC3339, formatBangkokDateTime, rfc3339ToDateTimeLocal } from "../time";
import { type AppText, text } from "../types";

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
const dateTimeInput = (value: string) =>
  value ? rfc3339ToDateTimeLocal(value) : rfc3339ToDateTimeLocal(new Date().toISOString());
const wells = Array.from(
  { length: 96 },
  (_, index) => `${String.fromCharCode(65 + Math.floor(index / 12))}${(index % 12) + 1}`,
);

const masterName = (items: ApiItem[] | undefined, id: unknown) => {
  const item = items?.find((candidate) => candidate.id === id);
  return String(item?.name ?? item?.strain ?? item?.label ?? item?.lotCode ?? item?.code ?? "");
};

type ExperimentStatus = "all" | "tracking" | "completed";

const experimentStatus = (item: ApiItem): Exclude<ExperimentStatus, "all"> =>
  item.hasOpenEmbryos === false ? "completed" : "tracking";

export function Batches({ t }: { t: AppText }) {
  const [dashboardFilters] = useState(parseFilters);
  const [items, setItems] = useState<ApiItem[]>([]);
  const [groups, setGroups] = useState<ApiItem[]>([]);
  const [groupId, setGroupId] = useState(dashboardFilters.experimentGroupId ?? "");
  const [statusFilter, setStatusFilter] = useState<ExperimentStatus>("all");
  useEffect(() => {
    void get("/experiment-groups?includeInactive=true")
      .then((data) => setGroups(data.items ?? []))
      .catch((e: Error) => setMessage(e.message));
  }, []);
  const [selected, setSelected] = useState<ApiItem | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const load = useCallback(() => {
    void get(withFilters("/batches", { ...dashboardFilters, experimentGroupId: groupId || undefined }))
      .then((data) => {
        const filtered = (data.items ?? []).filter(
          (item) => !dashboardFilters.batchId || String(item.id) === dashboardFilters.batchId,
        );
        setItems(filtered);
        if (dashboardFilters.batchId && filtered.length === 1) setSelected(filtered[0]);
      })
      .catch((e: Error) => setMessage(e.message));
  }, [dashboardFilters, groupId]);
  useEffect(load, [load]);
  useEffect(() => {
    const refresh = () => load();
    const reject = (event: Event) => {
      const detail = (event as CustomEvent<QueuedWrite>).detail;
      if (detail.path === "/batches") {
        setItems((current) => current.filter((item) => !item.queued));
        setMessage(detail.lastError ?? "Queued batch rejected");
      }
    };
    window.addEventListener("chronofish:queue-drained", refresh);
    window.addEventListener("chronofish:queue-rejected", reject);
    return () => {
      window.removeEventListener("chronofish:queue-drained", refresh);
      window.removeEventListener("chronofish:queue-rejected", reject);
    };
  }, [load]);
  if (selected) return <BatchDetail batch={selected} t={t} onBack={() => setSelected(null)} />;
  const thai = t === text.th;
  const visibleItems = items.filter(
    (item) =>
      (!groupId || item.experimentGroupId === groupId) &&
      (statusFilter === "all" || experimentStatus(item) === statusFilter) &&
      `${item.batchCode ?? ""} ${item.experimentDate ?? ""}`
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase()),
  );
  const addQueued = (batch: ApiItem) => {
    setItems((current) => [{ ...batch, id: `queued-${Date.now()}`, queued: true }, ...current]);
    setShowForm(false);
    setMessage("Saved locally; will sync automatically");
  };
  if (showForm)
    return (
      <section>
        <button className="back" onClick={() => setShowForm(false)}>
          ← {thai ? "กลับไปการทดลองทั้งหมด" : "Back to experiments"}
        </button>
        <BatchForm
          t={t}
          initialGroupId={groups.find((group) => group.id === groupId && group.active !== false) ? groupId : ""}
          onSaved={() => {
            setShowForm(false);
            load();
          }}
          onQueued={addQueued}
        />
      </section>
    );
  return (
    <section>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{thai ? "สมุดงานวิจัย" : "RESEARCH WORKSPACE"}</p>
          <h1>{thai ? "การทดลองทั้งหมด" : "Experiments"}</h1>
          <p className="muted">
            {thai
              ? "เปิดการทดลองเพื่อดูชุดตัวอ่อนและงานตรวจตามเวลา หรือเริ่มการทดลองใหม่"
              : "Open an experiment to review embryo lots and scheduled observations, or start a new one."}
          </p>
        </div>
        <button className="button button--primary" onClick={() => setShowForm(true)}>
          {thai ? "+ รอบทดลองใหม่" : "+ New experiment"}
        </button>
      </div>
      <div className="record-toolbar">
        <label>
          {thai ? "โครงการวิจัย" : "Experiment group"}
          <select value={groupId} onChange={(event) => setGroupId(event.target.value)}>
            <option value="">{thai ? "ทุกโครงการวิจัย" : "All experiment groups"}</option>
            {groups.map((group) => (
              <option key={String(group.id)} value={String(group.id)}>
                {String(group.code)} · {String(group.name)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {thai ? "ค้นหาการทดลอง" : "Find an experiment"}
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={thai ? "รหัสการทดลอง หรือวันที่ YYYY-MM-DD" : "Experiment code or YYYY-MM-DD"}
          />
        </label>
        <fieldset className="status-filter">
          <legend>{thai ? "สถานะการทดลอง" : "Experiment status"}</legend>
          <div className="tabs" role="group" aria-label={thai ? "กรองสถานะการทดลอง" : "Filter experiment status"}>
            {(
              [
                ["all", thai ? "ทั้งหมด" : "All"],
                ["tracking", thai ? "กำลังติดตาม" : "Tracking"],
                ["completed", thai ? "จบแล้ว" : "Completed"],
              ] as const
            ).map(([value, label]) => (
              <button
                className={statusFilter === value ? "tab tab--active" : "tab"}
                type="button"
                aria-pressed={statusFilter === value}
                key={value}
                onClick={() => setStatusFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>
        <p className="muted" role="status">
          {thai
            ? `แสดง ${visibleItems.length} จาก ${items.length} การทดลอง`
            : `${visibleItems.length} of ${items.length} experiments`}
        </p>
      </div>
      {message && <ErrorMessage message={message} />}
      {visibleItems.length === 0 ? (
        <Empty
          message={
            search.trim()
              ? thai
                ? "ไม่พบการทดลอง ลองค้นหาด้วยรหัสหรือวันที่อื่น"
                : "No matching experiments. Try another code or date."
              : t.empty
          }
        />
      ) : (
        <div className="list">
          {visibleItems.map((item) => (
            <button className="list-row" key={String(item.id)} onClick={() => setSelected(item)}>
              <span>
                <strong>{String(item.batchCode)}</strong>
                <small>
                  {masterName(groups, item.experimentGroupId) || (thai ? "ยังไม่เชื่อมโยง" : "Ungrouped")} ·{" "}
                  {String(item.experimentDate)} · {thai ? "โปรไฟล์เวลา" : "profile"}{" "}
                  {item.timingProfileVersion != null
                    ? String(item.timingProfileVersion)
                    : thai
                      ? "ที่ตรึงไว้กับรอบนี้"
                      : "pinned to this experiment"}
                </small>
              </span>
              <span className="pill">
                {item.queued
                  ? t.queued
                  : experimentStatus(item) === "tracking"
                    ? thai
                      ? "กำลังติดตาม"
                      : "Tracking"
                    : thai
                      ? "จบแล้ว"
                      : "Completed"}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function BatchForm({
  t,
  batch,
  initialGroupId = "",
  onSaved,
  onQueued,
}: {
  t: AppText;
  batch?: ApiItem;
  initialGroupId?: string;
  onSaved: () => void;
  onQueued?: (batch: ApiItem) => void;
}) {
  const thai = t === text.th;
  const [form, setForm] = useState({
    batchCode: String(batch?.batchCode ?? ""),
    dayNo: String(batch?.dayNo ?? ""),
    experimentDate: String(batch?.experimentDate ?? today()),
    siteId: String(batch?.siteId ?? ""),
    operatorId: String(batch?.operatorId ?? operatorId()),
    protocolId: String(batch?.protocolId ?? ""),
    experimentGroupId: String(batch?.experimentGroupId ?? initialGroupId),
    treatmentGroupId: String(batch?.treatmentGroupId ?? ""),
    recipientEggLotId: String(batch?.recipientEggLotId ?? ""),
    csofLotId: String(batch?.csofLotId ?? ""),
    clutchCode: String(batch?.clutchCode ?? ""),
    replicateNo: String(batch?.replicateNo ?? ""),
    incubationTempC: String(batch?.incubationTempC ?? ""),
    notes: String(batch?.notes ?? ""),
  });
  const [masters, setMasters] = useState<Record<string, ApiItem[]>>({
    sites: [],
    operators: [],
    protocols: [],
    "experiment-groups": [],
    "treatment-groups": [],
    "recipient-egg-lots": [],
    "csof-lots": [],
  });
  const [error, setError] = useState("");
  useEffect(() => {
    void Promise.all(
      [
        "sites",
        "operators",
        "protocols",
        "experiment-groups",
        "treatment-groups",
        "recipient-egg-lots",
        "csof-lots",
      ].map((resource) =>
        get(`/${resource}${batch ? "?includeInactive=true" : ""}`).then(
          (data) => [resource, data.items ?? []] as [string, ApiItem[]],
        ),
      ),
    )
      .then((result) => {
        const next = Object.fromEntries(result);
        setMasters(next);
        setForm((current) => ({
          ...current,
          protocolId: current.protocolId || String(next.protocols?.[0]?.id ?? ""),
        }));
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  const set = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    const payload = {
      ...form,
      dayNo: form.dayNo ? Number(form.dayNo) : null,
      batchCode: form.batchCode || null,
      experimentGroupId: form.experimentGroupId || null,
      recipientEggLotId: form.recipientEggLotId || null,
      csofLotId: form.csofLotId || null,
      clutchCode: form.clutchCode || null,
      replicateNo: form.replicateNo ? Number(form.replicateNo) : null,
      incubationTempC: form.incubationTempC ? Number(form.incubationTempC) : null,
      notes: form.notes || null,
    };
    try {
      const result = (await putQueue(
        batch ? `/batches/${batch.id}` : "/batches",
        payload,
        "application/json",
        batch ? "PATCH" : "POST",
      )) as ApiItem;
      if (result.queued && onQueued) onQueued(form as unknown as ApiItem);
      else onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <form className="task-surface form-card batch-form" onSubmit={submit}>
      <h1>{batch ? (thai ? "แก้ไขข้อมูลการทดลอง" : "Edit experiment") : thai ? "เริ่มการทดลองใหม่" : "New experiment"}</h1>
      <p className="muted">
        {thai
          ? "กรอกข้อมูลรอบทดลองและผู้รับผิดชอบให้ครบ ส่วนข้อมูลตัวอย่างเพิ่มเติมสามารถกรอกภายหลังได้"
          : "Complete the experiment details and responsible team. Optional sample details can be added later."}
      </p>
      <fieldset className="form-section">
        <legend>
          <span aria-hidden="true">01</span>
          {thai ? "ข้อมูลรอบทดลอง" : "Experiment details"}
        </legend>
        <div className="form-card--inline batch-form__fields batch-form__fields--details">
          <label>
            {thai ? "โครงการวิจัย" : "Experiment group"}
            <select value={form.experimentGroupId} onChange={(event) => set("experimentGroupId", event.target.value)}>
              <option value="">{thai ? "ยังไม่เชื่อมโยง" : "Ungrouped"}</option>
              {masters["experiment-groups"].map((item) => (
                <option key={String(item.id)} value={String(item.id)}>
                  {String(item.code)} · {String(item.name)}
                </option>
              ))}
            </select>
            <small>
              {thai
                ? "สร้างโครงการวิจัยได้ที่ข้อมูลอ้างอิงและระบบ → ข้อมูลตั้งต้น"
                : "Manage groups in Reference & system → Master data."}
            </small>
          </label>
          <label>
            {thai ? "ลำดับวันทดลอง" : "Day no."}
            <input
              required
              data-testid="batch-day-no"
              type="number"
              min="1"
              value={form.dayNo}
              onChange={(e) => set("dayNo", e.target.value)}
            />
          </label>
          <label>
            {thai ? "รหัสรอบทดลอง" : "Batch code"}
            <input
              required={Boolean(batch)}
              data-testid="batch-code"
              value={form.batchCode}
              placeholder={thai ? "เว้นว่างเพื่อสร้างรหัสอัตโนมัติ" : "Leave blank to generate a code"}
              onChange={(e) => set("batchCode", e.target.value)}
            />
          </label>
          <label>
            {thai ? "วันที่ทดลอง" : "Experiment date"}
            <input
              required
              type="date"
              value={form.experimentDate}
              onChange={(e) => set("experimentDate", e.target.value)}
            />
          </label>
        </div>
      </fieldset>
      <fieldset className="form-section">
        <legend>
          <span aria-hidden="true">02</span>
          {thai ? "ผู้รับผิดชอบและแผนการทดลอง" : "Team and protocol"}
        </legend>
        <div className="form-card--inline batch-form__fields batch-form__fields--team">
          <label>
            {thai ? "ผู้ปฏิบัติงาน" : "Operator"}
            <select required value={form.operatorId} onChange={(e) => set("operatorId", e.target.value)}>
              <option value="">{thai ? "เลือกผู้ปฏิบัติงาน" : "Choose operator"}</option>
              {(masters.operators ?? []).map((item) => (
                <option key={String(item.id)} value={String(item.id)}>
                  {String(item.name ?? item.code ?? item.id)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {thai ? "สถานที่" : "Site"}
            <select required value={form.siteId} onChange={(e) => set("siteId", e.target.value)}>
              <option value="">{thai ? "เลือกสถานที่" : "Select site"}</option>
              {(masters.sites ?? []).map((site) => (
                <option key={String(site.id)} value={String(site.id)}>
                  {String(site.code)} — {String(site.name)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {thai ? "โพรโทคอล" : "Protocol"}
            <select
              required
              disabled={Boolean(batch)}
              value={form.protocolId}
              onChange={(e) => set("protocolId", e.target.value)}
            >
              <option value="">{thai ? "เลือกโพรโทคอล" : "Select protocol"}</option>
              {(masters.protocols ?? []).map((item) => (
                <option key={String(item.id)} value={String(item.id)}>
                  {String(item.code ?? item.name ?? item.id)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {thai ? "แขนการทดลอง" : "Treatment group"}
            <select required value={form.treatmentGroupId} onChange={(e) => set("treatmentGroupId", e.target.value)}>
              <option value="">{thai ? "เลือกแขนการทดลอง" : "Select treatment"}</option>
              {(masters["treatment-groups"] ?? []).map((item) => (
                <option key={String(item.id)} value={String(item.id)}>
                  {String(item.code ?? item.name)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>
      <details className="workflow-disclosure">
        <summary>{thai ? "ข้อมูลตัวอย่างและเงื่อนไขเพิ่มเติม (ไม่บังคับ)" : "Sample and environment details (optional)"}</summary>
        <div className="workflow-disclosure__body">
          <div className="form-card--inline batch-form__fields batch-form__fields--optional">
            <label>
              {thai ? "ชุดไข่ผู้รับ" : "Recipient egg lot"}
              <select value={form.recipientEggLotId} onChange={(e) => set("recipientEggLotId", e.target.value)}>
                <option value="">{thai ? "ยังไม่เชื่อมโยง" : "Not linked"}</option>
                {(masters["recipient-egg-lots"] ?? []).map((item) => (
                  <option key={String(item.id)} value={String(item.id)}>
                    {String(item.label ?? item.lotCode ?? item.id)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {thai ? "ชุดน้ำยา CSOF" : "CSOF lot"}
              <select value={form.csofLotId} onChange={(e) => set("csofLotId", e.target.value)}>
                <option value="">{thai ? "ยังไม่เชื่อมโยง" : "Not linked"}</option>
                {(masters["csof-lots"] ?? []).map((item) => (
                  <option key={String(item.id)} value={String(item.id)}>
                    {String(item.lotCode ?? item.code ?? item.id)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {thai ? "รหัสชุดไข่ (Clutch)" : "Clutch code"}
              <input value={form.clutchCode} onChange={(e) => set("clutchCode", e.target.value)} />
            </label>
          </div>
          <div className="form-card--inline batch-form__fields batch-form__fields--optional">
            <label>
              {thai ? "ลำดับซ้ำ" : "Replicate no."}
              <input
                type="number"
                min="1"
                value={form.replicateNo}
                onChange={(e) => set("replicateNo", e.target.value)}
              />
            </label>
            <label>
              {thai ? "อุณหภูมิเลี้ยง (°C)" : "Incubation °C"}
              <input
                type="number"
                min="0"
                max="50"
                step="0.1"
                value={form.incubationTempC}
                onChange={(e) => set("incubationTempC", e.target.value)}
              />
            </label>
            <label>
              {thai ? "หมายเหตุ" : "Notes"}
              <input value={form.notes} onChange={(e) => set("notes", e.target.value)} />
            </label>
          </div>
        </div>
      </details>
      {error && <ErrorMessage message={error} />}
      <div className="form-actions">
        <button className="button button--primary" type="submit">
          {batch ? (thai ? "บันทึกการแก้ไข" : "Save changes") : thai ? "สร้างรอบทดลอง" : "Save batch"}
        </button>
      </div>
    </form>
  );
}

function BatchDetail({ batch, t, onBack }: { batch: ApiItem; t: AppText; onBack: () => void }) {
  const [detail, setDetail] = useState<ApiItem | null>(null);
  const [embryos, setEmbryos] = useState<Record<string, ApiItem[]>>({});
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState(false);
  const [showLotForm, setShowLotForm] = useState(false);
  const [lot, setLot] = useState({
    lotNo: "1",
    donorCellLineId: "",
    activatedAt: dateTimeInput(""),
    enuPowerPct: "",
    enuPulseUs: "",
    enuLed: "",
    enuStartAt: "",
    enuFinishAt: "",
    nEggs: "",
    nActivated: "1",
    notes: "",
    wellPositions: "",
  });
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [masters, setMasters] = useState<Record<string, ApiItem[]>>({});
  const [count, setCount] = useState(1);
  const load = useCallback(() => {
    void get(`/batches/${batch.id}`)
      .then(async (value) => {
        setDetail(value);
        const lots = (value.injectionLots as ApiItem[] | undefined) ?? [];
        const loaded = await Promise.all(
          lots.map(
            async (item: ApiItem) =>
              [String(item.id), (await get(`/injection-lots/${item.id}/embryos?aliveOnly=false`)).items ?? []] as [
                string,
                ApiItem[],
              ],
          ),
        );
        setEmbryos(Object.fromEntries(loaded));
      })
      .catch((e: Error) => setMessage(e.message));
  }, [batch.id]);
  useEffect(load, [load]);
  useEffect(() => {
    const resources = ["sites", "operators", "treatment-groups", "donor-cell-lines"];
    void Promise.all(
      resources.map((resource) =>
        get(`/${resource}?includeInactive=true`).then((data) => [resource, data.items ?? []] as [string, ApiItem[]]),
      ),
    )
      .then((items) => setMasters(Object.fromEntries(items)))
      .catch((error: Error) => setMessage(error.message));
  }, []);
  useEffect(() => {
    const rejected = (event: Event) => {
      const detail = (event as CustomEvent<QueuedWrite>).detail;
      if (
        detail.path.startsWith(`/batches/${String(batch.id)}`) ||
        detail.path.startsWith("/injection-lots/") ||
        detail.path.startsWith("/embryos/")
      ) {
        load();
        setMessage(detail.lastError ?? "Queued change was rejected; data was restored");
      }
    };
    window.addEventListener("chronofish:queue-rejected", rejected);
    return () => window.removeEventListener("chronofish:queue-rejected", rejected);
  }, [batch.id, load]);
  const setLotValue = (key: string, value: string) => setLot((current) => ({ ...current, [key]: value }));
  const duplicate = async () => {
    const requestedDate = window.prompt(thai ? "วันที่ทดลอง (ปปปป-ดด-วว)" : "Experiment date (YYYY-MM-DD)", today());
    if (!requestedDate) return;
    const requestedDayNo = window.prompt(
      thai ? "ลำดับวันในชุดการทดลอง (เว้นว่างเพื่อใช้วันถัดไป)" : "Day number in the experiment series (blank = next)",
      "",
    );
    if (requestedDayNo === null) return;
    const copyLots = window.confirm(
      thai ? "คัดลอกชุดฉีดเป็นแม่แบบที่ยังไม่กระตุ้นหรือไม่?" : "Copy injection lots as unactivated templates?",
    );
    try {
      const result = await putQueue(`/batches/${batch.id}/duplicate`, {
        experimentDate: requestedDate,
        dayNo: requestedDayNo.trim() ? Number(requestedDayNo) : null,
        copyInjectionLots: copyLots,
      });
      setMessage(
        result.queued
          ? thai
            ? "รอส่งสำเนาการทดลอง"
            : "Duplicate queued for sync"
          : thai
            ? "ทำสำเนาการทดลองแล้ว"
            : "Batch duplicated",
      );
      load();
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  const createLot = async (event: FormEvent) => {
    event.preventDefault();
    const positions = lot.wellPositions
      .split(/[ ,\n]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    const optimisticId = templateId ?? `queued-lot-${Date.now()}`;
    const optimistic = {
      ...lot,
      id: optimisticId,
      batchId: batch.id,
      nActivated: Number(lot.nActivated),
      activatedAt: dateTimeLocalToRFC3339(lot.activatedAt),
      queued: true,
    };
    const previousDetail = detail;
    try {
      const payload = {
        ...lot,
        activatedAt: dateTimeLocalToRFC3339(lot.activatedAt),
        enuStartAt: lot.enuStartAt ? dateTimeLocalToRFC3339(lot.enuStartAt) : null,
        enuFinishAt: lot.enuFinishAt ? dateTimeLocalToRFC3339(lot.enuFinishAt) : null,
        enuPowerPct: lot.enuPowerPct ? Number(lot.enuPowerPct) : null,
        enuPulseUs: lot.enuPulseUs ? Number(lot.enuPulseUs) : null,
        enuLed: lot.enuLed ? Number(lot.enuLed) : null,
        nEggs: lot.nEggs ? Number(lot.nEggs) : null,
        nActivated: Number(lot.nActivated),
        wellPositions: positions,
      };
      if (
        !window.confirm(
          thai
            ? `${templateId ? "กระตุ้น" : "สร้าง"} ชุด ${lot.lotNo} ที่มีตัวอ่อน ${payload.nActivated} ตัวหรือไม่?`
            : `${templateId ? "Activate" : "Create"} lot ${lot.lotNo} with ${payload.nActivated} embryos?`,
        )
      )
        return;
      const path = templateId ? `/injection-lots/${templateId}` : `/batches/${batch.id}/injection-lots`;
      const result = await putQueue(path, payload, "application/json", templateId ? "PATCH" : "POST");
      if (result.queued) {
        setDetail((current) =>
          current
            ? {
                ...current,
                injectionLots: templateId
                  ? ((current.injectionLots as ApiItem[] | undefined) ?? []).map((item) =>
                      item.id === templateId ? optimistic : item,
                    )
                  : [...((current.injectionLots as ApiItem[] | undefined) ?? []), optimistic],
              }
            : current,
        );
        setEmbryos((current) => ({
          ...current,
          [optimisticId]: positions.map((wellPosition, index) => ({
            id: `${optimisticId}-${index + 1}`,
            injectionLotId: optimisticId,
            embryoCode: `${String(detail?.batchCode ?? batch.batchCode)}_${lot.lotNo}_${index + 1}`,
            wellPosition,
            queued: true,
          })),
        }));
        setMessage(thai ? "บันทึกชุดไว้แล้ว ระบบจะซิงก์อัตโนมัติ" : "Lot saved locally; it will sync automatically");
      } else {
        setMessage(
          (result.warnings as string[] | undefined)?.join(" ") ||
            (templateId ? "Lot template activated" : "Lot created"),
        );
        load();
      }
      setTemplateId(null);
    } catch (e) {
      setDetail(previousDetail);
      setMessage((e as Error).message);
    }
  };
  const useTemplate = (item: ApiItem) => {
    setShowLotForm(true);
    setTemplateId(String(item.id));
    setLot({
      lotNo: String(item.lotNo ?? "1"),
      donorCellLineId: String(item.donorCellLineId ?? ""),
      activatedAt: dateTimeInput(""),
      enuPowerPct: String(item.enuPowerPct ?? ""),
      enuPulseUs: String(item.enuPulseUs ?? ""),
      enuLed: String(item.enuLed ?? ""),
      enuStartAt: "",
      enuFinishAt: "",
      nEggs: String(item.nEggs ?? ""),
      nActivated: "1",
      notes: String(item.notes ?? ""),
      wellPositions: "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const addEmbryos = async (lotId: string) => {
    if (lotId.startsWith("queued-")) {
      // The lot itself is still in the offline queue with a placeholder id; a
      // child write here would 404 forever against /injection-lots/queued-lot-*.
      setMessage(
        thai ? "ชุดนี้ยังไม่ซิงก์ รอสักครู่แล้วลองใหม่" : "This lot has not synced yet; try again once it clears the queue.",
      );
      return;
    }
    const previous = embryos[lotId] ?? [];
    const optimistic = Array.from({ length: count }, (_, index) => ({
      id: `queued-embryo-${Date.now()}-${index}`,
      embryoCode: `queued-${previous.length + index + 1}`,
      injectionLotId: lotId,
      queued: true,
    }));
    setEmbryos((current) => ({
      ...current,
      [lotId]: [...previous, ...optimistic],
    }));
    try {
      const result = await putQueue(`/injection-lots/${lotId}/embryos`, {
        count,
      });
      if (result.queued) setMessage(thai ? "บันทึกตัวอ่อนแล้ว กำลังซิงก์" : "Embryos saved; syncing automatically");
      else {
        setMessage("Embryos added");
        load();
      }
    } catch (e) {
      setEmbryos((current) => ({ ...current, [lotId]: previous }));
      setMessage((e as Error).message);
    }
  };
  const updateWell = async (embryo: ApiItem, wellPosition: string | null) => {
    const lotId = String(embryo.injectionLotId ?? "");
    const previous = embryos[lotId] ?? [];
    setEmbryos((current) => ({
      ...current,
      [lotId]: (current[lotId] ?? []).map((item) =>
        item.id === embryo.id ? { ...item, wellPosition: wellPosition || null } : item,
      ),
    }));
    try {
      await putQueue(`/embryos/${embryo.id}`, { wellPosition: wellPosition || null }, "application/json", "PATCH");
      if (!String(embryo.id).startsWith("queued-")) load();
    } catch (e) {
      setEmbryos((current) => ({ ...current, [lotId]: previous }));
      setMessage((e as Error).message);
    }
  };
  const deleteEmbryo = async (embryo: ApiItem) => {
    const reason = window.prompt(thai ? "เหตุผลที่ลบตัวอ่อนนี้" : "Reason for deleting this embryo");
    if (!reason?.trim()) return;
    const lotId = String(embryo.injectionLotId ?? "");
    const previous = embryos[lotId] ?? [];
    setEmbryos((current) => ({
      ...current,
      [lotId]: (current[lotId] ?? []).filter((item) => item.id !== embryo.id),
    }));
    try {
      await putQueue(
        `/embryos/${embryo.id}?reason=${encodeURIComponent(reason)}`,
        undefined,
        "application/json",
        "DELETE",
      );
    } catch (e) {
      setEmbryos((current) => ({ ...current, [lotId]: previous }));
      setMessage((e as Error).message);
    }
  };
  const preview = Array.from(
    { length: Math.min(Math.max(Number(lot.nActivated) || 0, 0), 96) },
    (_, index) => `${String(detail?.batchCode ?? batch.batchCode)}_${lot.lotNo}_${index + 1}`,
  );
  const selectedWells = lot.wellPositions
    .split(/[ ,\n]+/)
    .map((value) => value.trim().toUpperCase())
    .filter((value, index, values) => wells.includes(value) && values.indexOf(value) === index)
    .slice(0, preview.length);
  const openHistoricalCheckpoint = (item: ApiItem) => {
    saveObservationLocation(operatorId(), {
      injectionLotId: item.id,
      batchCode: detail?.batchCode ?? batch.batchCode,
      lotNo: item.lotNo,
      stageCode: "stage_01_1C",
      stageLabel: thai ? "ระยะเริ่มต้น" : "Activated",
      stageOrder: 1,
      historical: true,
    });
    window.location.hash = "due";
  };
  const toggleWell = (well: string) => {
    const next = selectedWells.includes(well)
      ? selectedWells.filter((value) => value !== well)
      : selectedWells.length < preview.length
        ? [...selectedWells, well]
        : selectedWells;
    setLotValue("wellPositions", next.join(", "));
  };
  const thai = t === text.th;
  const displayMaster = (items: ApiItem[] | undefined, id: unknown) =>
    masterName(items, id) || (items ? "—" : thai ? "กำลังโหลด…" : "Loading…");
  return (
    <section>
      <button className="back" onClick={onBack}>
        ← {thai ? "การทดลองทั้งหมด" : "Experiments"}
      </button>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{thai ? "บันทึกการทดลอง" : "EXPERIMENT RECORD"}</p>
          <h1>{String(detail?.batchCode ?? batch.batchCode)}</h1>
          <p className="muted">
            {String(detail?.experimentDate ?? batch.experimentDate)} ·{" "}
            {displayMaster(masters.sites, detail?.siteId ?? batch.siteId)} ·{" "}
            {displayMaster(masters.operators, detail?.operatorId ?? batch.operatorId)} ·{" "}
            {displayMaster(masters["treatment-groups"], detail?.treatmentGroupId ?? batch.treatmentGroupId)}
          </p>
        </div>
        <div className="button-row">
          <button
            className="button button--primary"
            onClick={() => {
              setTemplateId(null);
              setShowLotForm((value) => !value);
            }}
          >
            {showLotForm ? (thai ? "ปิดแบบฟอร์ม" : "Close form") : thai ? "+ เพิ่มชุดตัวอ่อน" : "+ Add injection lot"}
          </button>
          <button className="button button--secondary" onClick={() => setEditing(!editing)}>
            {thai ? "แก้ไขข้อมูลการทดลอง" : "Edit batch"}
          </button>
          <button className="button button--secondary" onClick={() => void duplicate()}>
            {thai ? "ทำสำเนาการทดลอง" : "Duplicate"}
          </button>
        </div>
      </div>
      <div className="record-facts">
        <div className="record-fact">
          <span>{thai ? "สถานะ" : "Status"}</span>
          <strong>
            {experimentStatus(detail ?? batch) === "tracking"
              ? thai
                ? "กำลังติดตาม"
                : "Tracking"
              : thai
                ? "จบแล้ว"
                : "Completed"}
          </strong>
        </div>
        <div className="record-fact">
          <span>{thai ? "วันที่ทดลอง" : "Experiment date"}</span>
          <strong>{String(detail?.experimentDate ?? batch.experimentDate ?? "—")}</strong>
        </div>
        <div className="record-fact">
          <span>{thai ? "สถานที่" : "Site"}</span>
          <strong>{displayMaster(masters.sites, detail?.siteId ?? batch.siteId)}</strong>
        </div>
        <div className="record-fact">
          <span>{thai ? "ผู้ปฏิบัติงาน" : "Operator"}</span>
          <strong>{displayMaster(masters.operators, detail?.operatorId ?? batch.operatorId)}</strong>
        </div>
        <div className="record-fact">
          <span>{thai ? "กลุ่มเปรียบเทียบ" : "Comparison group"}</span>
          <strong>
            {displayMaster(masters["treatment-groups"], detail?.treatmentGroupId ?? batch.treatmentGroupId)}
          </strong>
        </div>
        <div className="record-fact">
          <span>{thai ? "ชุดตัวอ่อน" : "Injection lots"}</span>
          <strong>{String((detail?.injectionLots ?? []).length)}</strong>
        </div>
      </div>
      {message && <ErrorMessage message={message} />}
      {editing && detail && (
        <BatchForm
          t={t}
          batch={detail}
          onSaved={() => {
            setEditing(false);
            setMessage("Batch updated");
            load();
          }}
        />
      )}
      {showLotForm && (
        <form className="form-card lot-builder" onSubmit={createLot}>
          <h2>
            {templateId
              ? thai
                ? "เปิดใช้งานแม่แบบ injection lot"
                : "Activate injection lot template"
              : thai
                ? "เพิ่ม Injection lot"
                : "Injection lot"}
          </h2>
          <div className="form-card--inline">
            <label>
              {thai ? "หมายเลขชุดตัวอ่อน" : "Lot number"}
              <input required value={lot.lotNo} onChange={(event) => setLotValue("lotNo", event.target.value)} />
            </label>
            <label>
              {thai ? "สายเซลล์ผู้ให้" : "Donor cell line"}
              <select
                required
                value={lot.donorCellLineId}
                onChange={(event) => setLotValue("donorCellLineId", event.target.value)}
              >
                <option value="">{thai ? "เลือกสายเซลล์ผู้ให้" : "Select donor"}</option>
                {(masters["donor-cell-lines"] ?? [])
                  .filter((item) => item.active !== false)
                  .map((item) => (
                    <option key={String(item.id)} value={String(item.id)}>
                      {String(item.strain ?? item.batchCode ?? item.id)}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              {thai ? "เวลาเริ่มกระตุ้น" : "Activated at"}
              <input
                required
                type="datetime-local"
                value={lot.activatedAt}
                onChange={(event) => setLotValue("activatedAt", event.target.value)}
              />
            </label>
          </div>
          <div className="form-card--inline">
            <label>
              {thai ? "จำนวนไข่ตั้งต้น" : "Eggs"}
              <input
                type="number"
                min="0"
                value={lot.nEggs}
                onChange={(event) => setLotValue("nEggs", event.target.value)}
              />
            </label>
            <label>
              {thai ? "จำนวนตัวอ่อนที่กระตุ้น" : "Activated embryos"}
              <input
                required
                type="number"
                min="0"
                max="96"
                value={lot.nActivated}
                onChange={(event) => setLotValue("nActivated", event.target.value)}
              />
            </label>
            <label>
              {thai ? "กำลัง ENU (%)" : "ENU power %"}
              <input
                type="number"
                min="0"
                max="100"
                value={lot.enuPowerPct}
                onChange={(event) => setLotValue("enuPowerPct", event.target.value)}
              />
            </label>
          </div>
          <details className="workflow-disclosure">
            <summary>
              {thai ? "ค่าการกระตุ้นและตำแหน่งหลุม (กรอกเมื่อจำเป็น)" : "ENU and well-position details (optional)"}
            </summary>
            <div className="workflow-disclosure__body">
              <div className="form-card--inline">
                <label>
                  ENU pulse µs
                  <input
                    type="number"
                    min="0"
                    value={lot.enuPulseUs}
                    onChange={(event) => setLotValue("enuPulseUs", event.target.value)}
                  />
                </label>
                <label>
                  ENU LED
                  <input
                    type="number"
                    min="0"
                    value={lot.enuLed}
                    onChange={(event) => setLotValue("enuLed", event.target.value)}
                  />
                </label>
                <label>
                  ENU start at
                  <input
                    type="datetime-local"
                    value={lot.enuStartAt}
                    onChange={(event) => setLotValue("enuStartAt", event.target.value)}
                  />
                </label>
              </div>
              <div className="form-card--inline">
                <label>
                  ENU finish at
                  <input
                    type="datetime-local"
                    value={lot.enuFinishAt}
                    onChange={(event) => setLotValue("enuFinishAt", event.target.value)}
                  />
                </label>
                <label>
                  Notes
                  <input value={lot.notes} onChange={(event) => setLotValue("notes", event.target.value)} />
                </label>
              </div>
              <label>
                Well positions (comma or newline separated)
                <textarea
                  rows={2}
                  value={lot.wellPositions}
                  placeholder="A1, A2, A3"
                  onChange={(event) => setLotValue("wellPositions", event.target.value)}
                />
              </label>
            </div>
          </details>
          <button className="button button--primary" type="submit">
            {templateId ? (thai ? "เปิดใช้งานแม่แบบ" : "Activate template") : thai ? "สร้าง lot" : "Create lot"}
          </button>
        </form>
      )}
      {showLotForm && (
        <details className="workflow-disclosure">
          <summary>
            {thai
              ? `ตรวจตำแหน่งบนแผ่น 96 หลุม · ${preview.length} ตัวอ่อน`
              : `Review 96-well placement · ${preview.length} embryos`}
          </summary>
          <div className="workflow-disclosure__body">
            <h2>{thai ? "ตัวอย่างรหัสและตำแหน่งหลุม" : "96-well code preview"}</h2>
            <p className="muted">{preview.length} code(s); verify positions before saving.</p>
            <div className="well-grid well-grid--plate">
              {wells.map((well) => {
                const embryoIndex = selectedWells.indexOf(well);
                return (
                  <button
                    type="button"
                    className="well"
                    aria-pressed={embryoIndex >= 0}
                    key={well}
                    onClick={() => toggleWell(well)}
                  >
                    <strong>{well}</strong>
                    <small>{embryoIndex >= 0 ? preview[embryoIndex] : "Available"}</small>
                  </button>
                );
              })}
            </div>
            <ol className="well-list--mobile">
              {preview.map((code, index) => (
                <li key={code}>
                  <strong>{selectedWells[index] ?? "Unassigned"}</strong> {code}
                </li>
              ))}
            </ol>
          </div>
        </details>
      )}
      {(detail?.injectionLots ?? []).map((item: ApiItem) => (
        <article className="form-card lot-card" key={String(item.id)}>
          <div className="page-heading">
            <div>
              <h2>
                {thai ? "ชุดตัวอ่อน" : "Lot"} {String(item.lotNo)}
              </h2>
              <p className="muted">
                {thai ? "เซลล์ผู้ให้" : "Donor"} {masterName(masters["donor-cell-lines"], item.donorCellLineId)} ·{" "}
                {String(item.nActivated ?? 0)} {thai ? "ตัวอ่อน" : "activated"} ·{" "}
                {formatBangkokDateTime(String(item.activatedAt ?? ""))}
              </p>
            </div>
            <div className="button-row">
              {Boolean(item.activatedAt) && !String(item.id).startsWith("queued-") && (
                <button
                  className="button button--secondary"
                  type="button"
                  onClick={() => openHistoricalCheckpoint(item)}
                >
                  {thai ? "ดู/แก้ไขผลตรวจ" : "View / edit results"}
                </button>
              )}
              {item.activatedAt && String(item.id).startsWith("queued-") ? (
                <span className="pill">{thai ? "รอซิงก์ก่อนเพิ่มตัวอ่อน" : "Sync pending"}</span>
              ) : item.activatedAt ? (
                <button className="button button--secondary" type="button" onClick={() => addEmbryos(String(item.id))}>
                  {thai ? `เพิ่มตัวอ่อน ${count} ตัว` : `Add ${count} embryos`}
                </button>
              ) : (
                <button className="button button--primary" type="button" onClick={() => useTemplate(item)}>
                  {thai ? "เปิดใช้แม่แบบชุดนี้" : "Activate template"}
                </button>
              )}
            </div>
          </div>
          {Boolean(item.activatedAt) && (
            <label className="form-card--inline">
              {thai ? "จำนวนตัวอ่อนที่จะเพิ่ม" : "Additional embryos"}
              <input
                type="number"
                min="1"
                max="96"
                value={count}
                onChange={(event) => setCount(Number(event.target.value))}
              />
            </label>
          )}
          <details className="data-disclosure">
            <summary>
              {thai
                ? `จัดการตัวอ่อน ${String((embryos[String(item.id)] ?? []).length)} รายการ`
                : `Manage ${(embryos[String(item.id)] ?? []).length} embryos`}
            </summary>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{thai ? "หลุม" : "Well"}</th>
                    <th>{thai ? "รหัสตัวอ่อน" : "Embryo"}</th>
                    <th>{thai ? "จัดการ" : "Action"}</th>
                  </tr>
                </thead>
                <tbody>
                  {(embryos[String(item.id)] ?? []).map((embryo) => (
                    <tr key={String(embryo.id)}>
                      <td>
                        <select
                          aria-label={`${thai ? "หลุมของ" : "Well for"} ${String(embryo.embryoCode)}`}
                          value={String(embryo.wellPosition ?? "")}
                          onChange={(event) => void updateWell(embryo, event.target.value)}
                        >
                          <option value="">{thai ? "ยังไม่กำหนด" : "Unassigned"}</option>
                          {wells.map((well) => (
                            <option key={well}>{well}</option>
                          ))}
                        </select>
                      </td>
                      <td>{String(embryo.embryoCode)}</td>
                      <td>
                        <button
                          className="inline-action inline-action--danger"
                          type="button"
                          onClick={() => void updateWell(embryo, null)}
                        >
                          {thai ? "เอาออกจากหลุม" : "Clear well"}
                        </button>
                        <button
                          className="inline-action inline-action--danger"
                          type="button"
                          onClick={() => void deleteEmbryo(embryo)}
                        >
                          {thai ? "ลบตัวอ่อน" : "Delete embryo"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </article>
      ))}
    </section>
  );
}
