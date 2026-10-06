import { type FormEvent, useCallback, useEffect, useState } from "react";
import { type ApiItem, get } from "../api/client";
import { Empty, ErrorMessage } from "../components";
import { putQueue, type QueuedWrite } from "../offline";
import { type AppText, text } from "../types";

type MasterResource =
  | "operators"
  | "donor-cell-lines"
  | "recipient-egg-lots"
  | "csof-lots"
  | "experiment-groups"
  | "treatment-groups"
  | "fish-boxes";
const masterConfig: Record<
  MasterResource,
  {
    label: string;
    fields: {
      key: string;
      label: string;
      type?: string;
      options?: string[];
      required?: boolean;
      placeholder?: string;
    }[];
  }
> = {
  "experiment-groups": {
    label: "Experiment groups",
    fields: [
      { key: "code", label: "Code", required: true },
      { key: "name", label: "Name", required: true },
      { key: "description", label: "Description" },
    ],
  },
  operators: { label: "Operators", fields: [{ key: "name", label: "Name", required: true }] },
  "donor-cell-lines": {
    label: "Donor cells",
    fields: [
      { key: "strain", label: "Strain", required: true },
      { key: "preparation", label: "Types of Specimen", options: ["DISSOCIATED", "CHUNKS", "UNKNOWN"], required: true },
      { key: "preservation", label: "Preservation", options: ["FRESH", "CRYOPRESERVED", "UNKNOWN"], required: true },
      { key: "batchCode", label: "Batch code" },
      { key: "sampleInfo", label: "Cryovial / sample detail" },
    ],
  },
  "recipient-egg-lots": {
    label: "Recipient egg lots",
    fields: [
      { key: "breed", label: "Breed", required: true },
      { key: "lotDate", label: "Egg stripping date", type: "date" },
      { key: "donorFishCode", label: "Donor fish code" },
      { key: "label", label: "Label", required: true, placeholder: "[E1...] YYYY-MM-DD" },
    ],
  },
  "csof-lots": {
    label: "Egg holding medium",
    fields: [{ key: "lotCode", label: "Lot code", required: true, placeholder: "[medium name] YYYY-NN" }],
  },
  "treatment-groups": {
    label: "Treatment groups",
    fields: [
      { key: "code", label: "Code", required: true },
      { key: "name", label: "Name" },
      { key: "armType", label: "Arm type", options: ["SCNT", "NATURAL_BREEDING", "IVF"], required: true },
    ],
  },
  "fish-boxes": {
    label: "Fish boxes",
    fields: [
      { key: "boxCode", label: "Box code", required: true },
      { key: "siteId", label: "Site ID" },
    ],
  },
};
const thaiResource: Record<MasterResource, string> = {
  "experiment-groups": "โครงการวิจัย",
  operators: "ผู้ปฏิบัติงาน",
  "donor-cell-lines": "เซลล์ผู้ให้",
  "recipient-egg-lots": "ชุดไข่ผู้รับ",
  "csof-lots": "อาหารเลี้ยงไข่ (Egg holding medium)",
  "treatment-groups": "แขนการทดลอง",
  "fish-boxes": "ตู้ปลา",
};
const thaiField: Record<string, string> = {
  description: "คำอธิบาย",
  name: "ชื่อ",
  strain: "สายพันธุ์",
  preparation: "รูปแบบตัวอย่าง (Types of Specimen)",
  preservation: "การเก็บรักษา",
  batchCode: "รหัสชุด",
  sampleInfo: "รายละเอียดตัวอย่าง/หลอดแช่แข็ง",
  breed: "สายพันธุ์",
  lotDate: "วันที่รีดไข่",
  donorFishCode: "รหัสปลาผู้ให้ไข่",
  label: "ชื่อเรียก",
  lotCode: "รหัสชุด",
  code: "รหัส",
  armType: "ประเภทแขนการทดลอง",
  boxCode: "รหัสตู้ปลา",
  siteId: "สถานที่",
};

export function Master({ t }: { t: AppText }) {
  const thai = t === text.th;
  const [sites, setSites] = useState<ApiItem[]>([]);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [timeZone, setTimeZone] = useState("");
  const [editing, setEditing] = useState<ApiItem | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const load = useCallback(() => {
    setLoading(true);
    setError("");
    setLoadFailed(false);
    void get("/sites")
      .then((data) => setSites(data.items ?? []))
      .catch((e: Error) => {
        setError(e.message);
        setLoadFailed(true);
      })
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    const refresh = () => load();
    const reject = (event: Event) => {
      const detail = (event as CustomEvent<QueuedWrite>).detail;
      if (detail.path === "/sites" || detail.path.startsWith("/sites/")) {
        load();
        setMessage("");
        setError(detail.lastError ?? "Queued site rejected");
      }
    };
    window.addEventListener("chronofish:queue-drained", refresh);
    window.addEventListener("chronofish:queue-rejected", reject);
    return () => {
      window.removeEventListener("chronofish:queue-drained", refresh);
      window.removeEventListener("chronofish:queue-rejected", reject);
    };
  }, [load]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const draft = { code, name, timeZone };
    setMessage("");
    setError("");
    try {
      const result = await putQueue("/sites", draft);
      setCode("");
      setName("");
      setTimeZone("");
      if (result.queued) {
        setSites((current) => [{ ...draft, id: `queued-${Date.now()}`, queued: true }, ...current]);
        setMessage(thai ? "บันทึกไว้แล้ว ระบบจะซิงก์อัตโนมัติ" : "Saved locally; will sync automatically");
      } else {
        setMessage(thai ? "บันทึกแล้ว" : "Saved");
        load();
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const editSite = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    const previous = sites;
    setMessage("");
    setError("");
    setSites((current) =>
      current.map((item) =>
        item.id === editing.id ? { ...item, code: editing.code, name: editing.name, timeZone: editing.timeZone, queued: true } : item,
      ),
    );
    try {
      await putQueue(
        `/sites/${editing.id}`,
        { code: editing.code, name: editing.name, timeZone: editing.timeZone, active: editing.active !== false },
        "application/json",
        "PATCH",
      );
      setEditing(null);
      setMessage(thai ? "แก้ไขสถานที่แล้ว" : "Site updated");
    } catch (e) {
      setSites(previous);
      setError((e as Error).message);
    }
  };
  const inactivate = async (site: ApiItem) => {
    if (!window.confirm(thai ? `เลิกใช้ ${String(site.code)} หรือไม่?` : `Inactivate ${String(site.code)}?`)) return;
    const previous = sites;
    setMessage("");
    setError("");
    setSites((current) =>
      current.map((item) => (item.id === site.id ? { ...item, active: false, queued: true } : item)),
    );
    try {
      await putQueue(`/sites/${site.id}`, { active: false }, "application/json", "PATCH");
      setMessage(thai ? "เลิกใช้สถานที่แล้ว" : "Site inactivated");
    } catch (e) {
      setSites(previous);
      setError((e as Error).message);
    }
  };
  return (
    <section>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{thai ? "ข้อมูลอ้างอิงของห้องแล็บ" : "LAB REFERENCE DATA"}</p>
          <h1>{t.master}</h1>
          <p className="muted">
            {thai
              ? "จัดการรายชื่อ สถานที่ วัสดุ และกลุ่มที่ใช้ซ้ำในการบันทึกการทดลอง"
              : "Manage the people, locations, materials and groups reused across experiment records."}
          </p>
        </div>
      </div>
      <div className="admin-layout">
        <section className="task-surface">
          <div className="task-section__head">
            <div>
              <h2>{thai ? "สถานที่ปฏิบัติงาน" : "Lab locations"}</h2>
              <p className="muted">
                {thai
                  ? "ใช้ระบุสถานที่ของการทดลองและตู้ปลา"
                  : "Used to identify where experiments and fish boxes are located."}
              </p>
            </div>
          </div>
          <form className="form-card form-card--inline" onSubmit={submit}>
            <label>
              {thai ? "รหัสสถานที่" : "Site code"}
              <input required value={code} onChange={(e) => setCode(e.target.value)} />
            </label>
            <label>
              {thai ? "ชื่อสถานที่" : "Site name"}
              <input required value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              {thai ? "เขตเวลา (IANA)" : "Time zone (IANA)"}
              <input required list="site-time-zones" value={timeZone} onChange={(e) => setTimeZone(e.target.value)} placeholder="Asia/Bangkok" />
            </label>
            <datalist id="site-time-zones"><option value="Asia/Bangkok" /><option value="America/Detroit" /></datalist>
            <button className="button button--primary" type="submit">
              {t.save}
            </button>
          </form>
          {editing && (
            <form className="form-card form-card--inline" onSubmit={editSite}>
              <label>
                {thai ? "แก้ไขรหัส" : "Editing code"}
                <input
                  required
                  value={String(editing.code ?? "")}
                  onChange={(e) => setEditing({ ...editing, code: e.target.value })}
                />
              </label>
              <label>
                {thai ? "แก้ไขชื่อ" : "Editing name"}
                <input
                  required
                  value={String(editing.name ?? "")}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                />
              </label>
              <label>
                {thai ? "เขตเวลา (IANA)" : "Time zone (IANA)"}
                <input required list="site-time-zones" value={String(editing.timeZone ?? "")} onChange={(e) => setEditing({ ...editing, timeZone: e.target.value })} />
              </label>
              <button className="button button--primary">{thai ? "บันทึกการแก้ไข" : "Save changes"}</button>
              <button className="button button--secondary" type="button" onClick={() => setEditing(null)}>
                {thai ? "ยกเลิก" : "Cancel"}
              </button>
            </form>
          )}
          {message && (
            <p className="notice" role="status">
              {message}
            </p>
          )}
          {error && <ErrorMessage message={error} />}
          {loading ? (
            <p className="notice" role="status">
              {thai ? "กำลังโหลดสถานที่…" : "Loading sites…"}
            </p>
          ) : loadFailed ? (
            <button className="button button--secondary" type="button" onClick={load}>
              Retry
            </button>
          ) : sites.length === 0 ? (
            <Empty message={t.empty} />
          ) : (
            <div className="list">
              {sites.map((site) => (
                <div className="list-row" key={String(site.id)}>
                  <span>
                    <strong>{String(site.code)}</strong>
                    <small>{String(site.name)}</small>
                    <small>{String(site.timeZone ?? (thai ? "ยังไม่กำหนดเขตเวลา" : "Time zone missing"))}</small>
                  </span>
                  <span>
                    <span className="pill">
                      {site.active === false ? (thai ? "เลิกใช้แล้ว" : "inactive") : thai ? "กำลังใช้งาน" : "active"}
                    </span>
                    <button className="inline-action" type="button" onClick={() => setEditing(site)}>
                      {thai ? "แก้ไข" : "Edit"}
                    </button>
                    {site.active !== false && (
                      <button
                        className="inline-action inline-action--danger"
                        type="button"
                        onClick={() => void inactivate(site)}
                      >
                        {thai ? "เลิกใช้" : "Inactivate"}
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
        <MasterCatalog t={t} />
      </div>
    </section>
  );
}

export function MasterCatalog({ t = text.en }: { t?: AppText } = {}) {
  const thai = t === text.th;
  const [resource, setResource] = useState<MasterResource>("operators");
  const [items, setItems] = useState<ApiItem[]>([]);
  const [form, setForm] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<ApiItem | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [sites, setSites] = useState<ApiItem[]>([]);
  const config = masterConfig[resource];
  const load = useCallback(() => {
    setLoading(true);
    setError("");
    setLoadFailed(false);
    void Promise.all([get(`/${resource}`), get("/sites")])
      .then(([data, siteData]) => {
        setItems(data.items ?? []);
        setSites(siteData.items ?? []);
      })
      .catch((e: Error) => {
        setError(e.message);
        setLoadFailed(true);
      })
      .finally(() => setLoading(false));
  }, [resource]);
  useEffect(() => {
    setForm({});
    setEditing(null);
    setMessage("");
    load();
  }, [load]);
  useEffect(() => {
    const refresh = () => load();
    const reject = (event: Event) => {
      const detail = (event as CustomEvent<QueuedWrite>).detail;
      const path = `/${resource}`;
      if (detail.path === path || detail.path.startsWith(`${path}/`)) {
        load();
        setMessage("");
        setError(detail.lastError ?? "Queued master record rejected");
      }
    };
    window.addEventListener("chronofish:queue-drained", refresh);
    window.addEventListener("chronofish:queue-rejected", reject);
    return () => {
      window.removeEventListener("chronofish:queue-drained", refresh);
      window.removeEventListener("chronofish:queue-rejected", reject);
    };
  }, [load, resource]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage("");
    setError("");
    try {
      const result = await putQueue(`/${resource}`, { ...form });
      setForm({});
      if (result.queued) {
        setItems((current) => [{ ...form, id: `queued-${Date.now()}`, queued: true }, ...current]);
        setMessage(thai ? "บันทึกไว้แล้ว ระบบจะซิงก์อัตโนมัติ" : "Saved locally; will sync automatically");
      } else {
        setMessage("Saved");
        load();
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const saveEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    const previous = items;
    setMessage("");
    setError("");
    setItems((current) =>
      current.map((item) => (item.id === editing.id ? { ...item, ...editing, queued: true } : item)),
    );
    try {
      const payload = Object.fromEntries(config.fields.map((field) => [field.key, editing[field.key] ?? null]));
      await putQueue(`/${resource}/${editing.id}`, payload, "application/json", "PATCH");
      setEditing(null);
      setMessage("Record updated");
    } catch (e) {
      setItems(previous);
      setError((e as Error).message);
    }
  };
  const inactivate = async (item: ApiItem) => {
    if (!window.confirm(thai ? "เลิกใช้รายการนี้หรือไม่?" : "Inactivate this record?")) return;
    const previous = items;
    setMessage("");
    setError("");
    setItems((current) =>
      current.map((candidate) =>
        candidate.id === item.id ? { ...candidate, active: false, queued: true } : candidate,
      ),
    );
    try {
      await putQueue(`/${resource}/${item.id}`, { active: false }, "application/json", "PATCH");
      setMessage(thai ? "เลิกใช้รายการแล้ว" : "Record inactivated");
    } catch (e) {
      setItems(previous);
      setError((e as Error).message);
    }
  };
  const fieldEditor = (
    field: { key: string; label: string; type?: string; options?: string[]; required?: boolean; placeholder?: string },
    value: string,
    onChange: (value: string) => void,
  ) => {
    const options =
      field.key === "siteId"
        ? sites.map((site) => ({ value: String(site.id), label: String(site.code ?? site.name) }))
        : (field.options ?? []).map((option) => ({
            value: option,
            label:
              option === "NATURAL_BREEDING"
                ? thai
                  ? "ผสมพันธุ์ตามธรรมชาติ"
                  : "Natural breeding"
                : option === "FRESH"
                  ? thai
                    ? "สด"
                    : "Fresh"
                  : option === "CRYOPRESERVED"
                    ? thai
                      ? "แช่แข็งเก็บรักษา"
                      : "Cryopreserved"
                    : option,
          }));
    return options.length ? (
      <select required={field.required} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{thai ? "เลือก" : "Select"}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    ) : (
      <input
        required={field.required}
        placeholder={field.placeholder}
        type={field.type ?? "text"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  };
  const formatHint = (field: { key: string }) => {
    const hint =
      resource === "recipient-egg-lots" && field.key === "label"
        ? thai
          ? "รูปแบบตามบรีฟ: [E1...] YYYY-MM-DD"
          : "Requested format: [E1...] YYYY-MM-DD"
        : resource === "csof-lots" && field.key === "lotCode"
          ? thai
            ? "รูปแบบตามบรีฟ: [ชื่อ medium] YYYY-NN"
            : "Requested format: [medium name] YYYY-NN"
          : null;
    return hint ? <span className="field-hint">{hint}</span> : null;
  };
  const label = (field: { key: string; label: string }) => (thai ? (thaiField[field.key] ?? field.label) : field.label);
  return (
    <section className="master-catalog task-surface">
      <div>
        <p className="eyebrow">{thai ? "รายการที่ใช้ซ้ำ" : "REUSABLE REFERENCE LISTS"}</p>
        <h2>{thai ? "บุคลากร วัสดุ และโครงการวิจัย" : "People, materials and experiment groups"}</h2>
        <p className="task-intro">
          {thai
            ? "เลือกประเภทข้อมูลหนึ่งรายการเพื่อเพิ่ม แก้ไข หรือเลิกใช้ โดยประวัติเดิมจะไม่ถูกลบ"
            : "Choose one data type to add, edit or retire without deleting historical records."}
        </p>
      </div>
      <nav className="admin-toolbar" aria-label={thai ? "ประเภทข้อมูล" : "Data type"}>
        {(Object.keys(masterConfig) as MasterResource[]).map((key) => (
          <button
            type="button"
            key={key}
            aria-pressed={resource === key}
            className={resource === key ? "tab tab--active" : "tab"}
            onClick={() => setResource(key)}
          >
            {thai ? thaiResource[key] : masterConfig[key].label}
          </button>
        ))}
      </nav>
      <form className="form-card form-card--inline" onSubmit={submit}>
        {config.fields.map((field) => (
          <label key={field.key}>
            {label(field)}
            {fieldEditor(field, form[field.key] ?? "", (value) => setForm({ ...form, [field.key]: value }))}
            {formatHint(field)}
          </label>
        ))}
        <button className="button button--primary" type="submit">
          {thai ? `เพิ่ม${thaiResource[resource]}` : "Save"}
        </button>
      </form>
      {editing && (
        <form className="form-card" onSubmit={saveEdit}>
          <h3>{thai ? `แก้ไข${thaiResource[resource]}` : `Edit ${config.label}`}</h3>
          {config.fields.map((field) => (
            <label key={field.key}>
              {label(field)}
              {fieldEditor(field, String(editing[field.key] ?? ""), (value) =>
                setEditing({ ...editing, [field.key]: value }),
              )}
              {formatHint(field)}
            </label>
          ))}
          <div className="button-row">
            <button className="button button--primary">{thai ? "บันทึกการแก้ไข" : "Save changes"}</button>
            <button className="button button--secondary" type="button" onClick={() => setEditing(null)}>
              {thai ? "ยกเลิก" : "Cancel"}
            </button>
          </div>
        </form>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {error && <ErrorMessage message={error} />}
      {loading ? (
        <p className="notice" role="status">
          {thai ? "กำลังโหลดข้อมูล…" : "Loading master data…"}
        </p>
      ) : loadFailed ? (
        <button className="button button--secondary" type="button" onClick={load}>
          Retry
        </button>
      ) : items.length === 0 ? (
        <Empty message={thai ? "ยังไม่มีรายการในหมวดนี้" : "No master records"} />
      ) : (
        <div className="list">
          {items.map((item) => (
            <div className="list-row" key={String(item.id)}>
              <span>
                <strong>
                  {String(item.name ?? item.code ?? item.label ?? item.lotCode ?? item.boxCode ?? item.strain)}
                </strong>
                <small>
                  {config.fields.map((field) => `${label(field)}: ${String(item[field.key] ?? "—")}`).join(" · ")}
                </small>
              </span>
              <span>
                <span className="pill">
                  {item.active === false ? (thai ? "เลิกใช้แล้ว" : "inactive") : thai ? "กำลังใช้งาน" : "active"}
                </span>
                <button className="inline-action" type="button" onClick={() => setEditing(item)}>
                  {thai ? "แก้ไข" : "Edit"}
                </button>
                {item.active !== false && (
                  <button
                    className="inline-action inline-action--danger"
                    type="button"
                    onClick={() => void inactivate(item)}
                  >
                    {thai ? "เลิกใช้" : "Inactivate"}
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
