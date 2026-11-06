import { useEffect, useState } from "react";
import type { ApiItem } from "./api/client";
import { request } from "./api/client";
import type { Page } from "./types";

type Field = { id: string; label: string };

export function TaskReminders({
  thai,
  fields,
  navigate,
}: {
  thai: boolean;
  fields: Field[];
  navigate: (page: Page) => void;
}) {
  const [counts, setCounts] = useState<{ embryos: number; fish: number } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let loading = false;
    const refresh = async () => {
      if (document.hidden || loading) return;
      loading = true;
      try {
        const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
        const read = (path: string) =>
          request(path, { headers: { "X-Session-Activity": "passive" } }).then((r) => r.json());
        const [due, rollcall] = await Promise.all([read("/due-checkpoints"), read(`/fish/roll-call?date=${today}`)]);
        if (active) {
          setCounts({
            embryos: (due.overdue ?? []).length,
            fish: (rollcall.items ?? []).filter((fish: ApiItem) => !fish.alreadyRecorded).length,
          });
          setFailed(false);
        }
      } catch {
        if (active) setFailed(true);
      } finally {
        loading = false;
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("hashchange", refresh);
    window.addEventListener("chronofish:queue-drained", refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("hashchange", refresh);
      window.removeEventListener("chronofish:queue-drained", refresh);
    };
  }, []);
  const total = (counts?.embryos ?? 0) + (counts?.fish ?? 0) + fields.length;
  return (
    <details className={`task-reminders ${total ? "task-reminders--pending" : ""}`}>
      <summary>
        <span className="task-bird" aria-hidden="true" />
        <span>
          {thai ? "งานที่ยังไม่ครบ" : "Unfinished tasks"}
          <strong>{total || (counts ? "✓" : "…")}</strong>
        </span>
      </summary>
      <div className="task-reminders__panel">
        <p>{thai ? "รายการที่รอคุณอยู่" : "Waiting for your attention"}</p>
        {failed && (
          <p role="status">
            {thai ? "ยังตรวจงานล่าสุดไม่ได้ ลองใหม่เมื่อออนไลน์" : "Could not refresh tasks. Reconnect to try again."}
          </p>
        )}
        {counts && (
          <>
            <button type="button" onClick={() => navigate("due")}>
              {thai ? "รอบตรวจตัวอ่อนที่ถึงเวลา" : "Embryo checkpoints due"} <strong>{counts.embryos}</strong>
            </button>
            <button type="button" onClick={() => navigate("fish")}>
              {thai ? "ปลาที่ยังไม่ตรวจวันนี้" : "Fish not checked today"} <strong>{counts.fish}</strong>
            </button>
          </>
        )}
        {fields.map((field) => (
          <button key={field.id} type="button" onClick={() => document.getElementById(field.id)?.focus()}>
            {thai ? "กรอกข้อมูล: " : "Complete: "}
            {field.label}
          </button>
        ))}
        {counts && !total && !failed && (
          <p>{thai ? "งานประจำวันที่ถึงเวลาครบแล้ว" : "All currently due daily tasks are complete."}</p>
        )}
      </div>
    </details>
  );
}
