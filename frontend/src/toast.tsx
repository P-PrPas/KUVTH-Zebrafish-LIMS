import { useEffect, useRef, useState } from "react";
import { type Notice, saveNotice } from "./notifications";
import type { QueuedWrite } from "./offline";

export function Toast({ notice, onDismiss }: { notice: Notice | null; onDismiss: () => void }) {
  const [paused, setPaused] = useState(false);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const th = document.documentElement.lang !== "en";
  useEffect(() => {
    if (!notice || paused) return;
    const timer = window.setTimeout(() => dismiss.current(), 5_000);
    return () => window.clearTimeout(timer);
  }, [notice, paused]);
  return (
    <div
      className="member-toast-region"
      aria-live={notice?.tone === "danger" ? "assertive" : "polite"}
      aria-atomic="true"
    >
      {notice && (
        <div
          className={`member-toast member-toast--${notice.tone}`}
          role="group"
          aria-label={th ? "การแจ้งเตือน" : "Notification"}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocusCapture={() => setPaused(true)}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false);
          }}
        >
          <strong>{notice.message}</strong>
          <button
            type="button"
            aria-label={th ? "ปิดการแจ้งเตือน" : "Dismiss notification"}
            onClick={() => {
              setPaused(false);
              onDismiss();
            }}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

function writeLabel(path: string, method: string | undefined, th: boolean) {
  if (method === "DELETE") return th ? "ยกเลิกรายการ" : "Record removal";
  if (path.startsWith("/observations/embryo")) return th ? "ผลตรวจตัวอ่อน" : "Embryo observations";
  if (path.startsWith("/observations/fish")) return th ? "ผลตรวจปลา" : "Fish observations";
  if (path.includes("/specimens")) return th ? "ข้อมูลตัวอย่างปลา" : "Fish specimens";
  if (path.includes("control-arm-counts")) return th ? "ข้อมูลกลุ่มควบคุม" : "Control counts";
  if (path.startsWith("/fish/") || path === "/fish") return th ? "ทะเบียนปลา" : "Fish record";
  if (path.startsWith("/promotions")) return th ? "การย้ายเข้าสู่ระยะปลา" : "Fish promotion";
  if (path.startsWith("/timing-profiles")) return th ? "แผนเวลาตรวจ" : "Timing profile";
  if (path.startsWith("/batches")) return th ? "รอบทดลอง" : "Experiment";
  if (path.startsWith("/injection-lots")) return th ? "ชุดฉีดและตัวอ่อน" : "Injection lot and embryos";
  return th ? "ข้อมูล" : "Record";
}

export function ActionToasts() {
  const [notice, setNotice] = useState<Notice | null>(null);
  useEffect(() => {
    const show = (event: Event) => setNotice({ ...(event as CustomEvent<Notice>).detail });
    const queue = (event: Event) => {
      const item = (event as CustomEvent<QueuedWrite & { result?: Record<string, unknown> }>).detail;
      if (!item?.path) return;
      const th = document.documentElement.lang !== "en";
      const label = writeLabel(item.path, item.method, th);
      const failed = event.type === "chronofish:queue-rejected";
      const authRequired = event.type === "chronofish:queue-auth-required";
      const deferred = event.type === "chronofish:queue-deferred";
      const queued = event.type === "chronofish:queue-enqueued" || deferred;
      const next: Notice =
        event.type === "chronofish:queue-drained"
          ? saveNotice(item.result ?? {}, label)
          : {
              tone: failed ? "danger" : queued || authRequired ? "warning" : "success",
              message: failed
                ? `${th ? "บันทึกไม่สำเร็จ" : "Save failed"}: ${label} — ${item.lastError ?? ""}`
                : authRequired
                  ? th
                    ? "กรุณาเข้าสู่ระบบอีกครั้งเพื่อส่งข้อมูลที่บันทึกไว้"
                    : "Sign in again to sync your saved work."
                  : deferred
                    ? th
                      ? `${label}: ยังส่งไม่สำเร็จ ข้อมูลอยู่ในอุปกรณ์และจะลองส่งใหม่`
                      : `${label}: sync failed; saved on this device and will retry.`
                    : queued
                      ? th
                        ? `${label}: เก็บไว้ในอุปกรณ์แล้ว รอส่งข้อมูล`
                        : `${label}: saved on this device; waiting to sync.`
                      : th
                        ? `บันทึก${label}สำเร็จ`
                        : `${label} saved successfully.`,
            };
      // A later successful item in a bulk operation must not hide its failed item.
      setNotice((current) =>
        current?.tone === "danger" && next.tone !== "danger" && event.type !== "chronofish:queue-enqueued"
          ? current
          : next,
      );
    };
    const events = [
      "chronofish:queue-enqueued",
      "chronofish:queue-drained",
      "chronofish:queue-rejected",
      "chronofish:queue-auth-required",
      "chronofish:queue-deferred",
    ];
    window.addEventListener("chronofish:notice", show);
    for (const event of events) window.addEventListener(event, queue);
    return () => {
      window.removeEventListener("chronofish:notice", show);
      for (const event of events) window.removeEventListener(event, queue);
    };
  }, []);
  return <Toast notice={notice} onDismiss={() => setNotice(null)} />;
}
