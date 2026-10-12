import { useEffect, useState } from "react";
import { type ApiItem, get } from "../api/client";
import type { AuthUser } from "../auth";
import { Metric } from "../components";

export function GuestDashboard({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const [language, setLanguage] = useState(() => localStorage.getItem("chronofish.language") ?? "th");
  const [data, setData] = useState<ApiItem | null>(null);
  const [error, setError] = useState("");
  const th = language !== "en";
  useEffect(() => {
    window.history.replaceState(null, "", `${window.location.pathname}#dashboard`);
    void get("/analytics/guest-dashboard")
      .then(setData)
      .catch((cause) => setError((cause as Error).message));
  }, []);
  useEffect(() => {
    localStorage.setItem("chronofish.language", language);
    document.documentElement.lang = language;
    document.title = "Dashboard · KUVACB AqLIMS";
  }, [language]);
  const metrics = [
    ["nBatches", th ? "ชุดการทดลอง" : "Batches"],
    ["nActivated", th ? "ไข่ที่กระตุ้น" : "Activated eggs"],
    ["nPromoted", th ? "ปลาที่เลื่อนระยะ" : "Promoted fish"],
    ["nFish", th ? "ปลาที่มีสถานะมีชีวิตหรือตาย" : "Fish with alive/dead status"],
    ["nAlive", th ? "ปลาที่มีชีวิต" : "Alive fish"],
    ["nDead", th ? "ปลาที่ตาย" : "Dead fish"],
  ];
  return (
    <main className="auth-shell auth-shell--guest">
      <div className="auth-topline">
        <span className="auth-brand">
          <img src="/brand/kuvacb-logo.png" alt="KUVACB" /> KUVACB AqLIMS
        </span>
        <button className="language" type="button" onClick={() => setLanguage(th ? "en" : "th")}>
          {th ? "EN" : "ไทย"}
        </button>
      </div>
      <section className="auth-card" aria-labelledby="guest-title">
        <p className="eyebrow">
          {th ? "ธนาคารเซลล์สัตว์ มหาวิทยาลัยเกษตรศาสตร์" : "Kasetsart University · Animal Cell Bank"}
        </p>
        <h1 id="guest-title">{th ? "ภาพรวมงานวิจัย" : "Research overview"}</h1>
        <p className="guest-identity">
          <span className="pill">Guest</span> {user.email}
        </p>
        <p className="muted">
          {th
            ? "แสดงข้อมูลรวมตามสิทธิ์ Guest ติดต่อผู้ดูแลระบบเพื่อขอสิทธิ์ทำงานในห้องแล็บ"
            : "Summary data for guest access. Contact an admin to request workspace access."}
        </p>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : data ? (
          <div className="metric-grid">
            {metrics.map(([key, label]) => (
              <Metric key={key} label={label} value={Number(data[key] ?? 0)} />
            ))}
          </div>
        ) : (
          <p role="status">{th ? "กำลังโหลด…" : "Loading…"}</p>
        )}
        <div className="auth-actions">
          <button
            className="button button--secondary"
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("chronofish:auth-refresh"))}
          >
            {th ? "ตรวจสอบสิทธิ์อีกครั้ง" : "Refresh access"}
          </button>
          <button className="text-button" type="button" onClick={onLogout}>
            {th ? "ออกจากระบบ" : "Sign out"}
          </button>
        </div>
      </section>
    </main>
  );
}
