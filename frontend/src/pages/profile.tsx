import { useCallback, useEffect, useState } from "react";
import { get, request } from "../api/client";
import type { AuthUser } from "../auth";
import { ErrorMessage, Icon } from "../components";
import { notify } from "../notifications";
import { formatBangkokDateTime } from "../time";
import type { ApiItem, Language } from "../types";
import { ProfileOperatorRequests } from "./corrections";

export function Profile({
  user,
  operators,
  language,
  onLogout,
}: {
  user: AuthUser;
  operators: ApiItem[];
  language: Language;
  onLogout: () => void;
}) {
  const thai = language === "th";
  const [sessions, setSessions] = useState<ApiItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const refresh = useCallback(() => {
    void get("/auth/sessions")
      .then((data) => {
        setSessions(data.items ?? []);
        setError("");
      })
      .catch((cause: Error) => setError(cause.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(refresh, [refresh]);
  const operator = operators.find((item) => String(item.id) === user.operatorId);
  const operatorName =
    operator?.name ??
    (user.operatorId
      ? thai
        ? "กำลังโหลดชื่อผู้ปฏิบัติงาน"
        : "Loading operator name"
      : thai
        ? "ยังไม่ได้เชื่อมผู้ปฏิบัติงาน"
        : "No linked operator");
  const revoke = async (id: string) => {
    if (!window.confirm(thai ? "ออกจากระบบในอุปกรณ์นี้หรือไม่?" : "Sign out this device?")) return;
    setBusy(id);
    try {
      await request(`/auth/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
      notify(thai ? "ออกจากระบบในอุปกรณ์นั้นแล้ว" : "Device signed out.");
      refresh();
    } catch (cause) {
      notify((cause as Error).message, "danger");
      setError((cause as Error).message);
    } finally {
      setBusy("");
    }
  };
  return (
    <section className="profile-page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">{thai ? "บัญชีและการเข้าถึง" : "Account & access"}</span>
          <h1>{thai ? "โปรไฟล์ของฉัน" : "My profile"}</h1>
          <p>
            {thai ? "ข้อมูลบัญชี ผู้ปฏิบัติงาน และอุปกรณ์ที่เข้าสู่ระบบ" : "Your account, recording identity and signed-in devices."}
          </p>
        </div>
      </header>
      <div className="profile-layout">
        <section className="profile-panel">
          <div className="profile-identity">
            <span className="profile-avatar" aria-hidden="true">
              <Icon name="people" />
            </span>
            <div>
              <h2>{thai ? "ข้อมูลบัญชี" : "Account details"}</h2>
              <span className="account-badge">{user.role === "admin" ? "Admin" : thai ? "สมาชิก" : "Member"}</span>
            </div>
          </div>
          <dl>
            <div>
              <dt>{thai ? "อีเมล" : "Email"}</dt>
              <dd>{user.email}</dd>
            </div>
            <div>
              <dt>{thai ? "ผู้ปฏิบัติงานที่เชื่อมกับบัญชี" : "Linked operator"}</dt>
              <dd>{String(operatorName)}</dd>
            </div>
          </dl>
          <p>
            {thai
              ? "อีเมลและสิทธิ์บัญชีจัดการโดยผู้ดูแลระบบ"
              : "Your email and account permissions are managed by an administrator."}
          </p>
        </section>
        <section className="profile-panel">
          <h2>{thai ? "ผู้ปฏิบัติงาน" : "Recording identity"}</h2>
          <p>
            {thai
              ? "ชื่อที่ใช้ระบุผู้บันทึกข้อมูลใหม่ การเปลี่ยนชื่อที่เชื่อมกับบัญชีต้องได้รับอนุมัติ และไม่เปลี่ยนผู้บันทึกในข้อมูลเดิม"
              : "Your linked identity is used for new records. Changes require approval and leave existing records unchanged."}
          </p>
          {user.role === "member" ? (
            <ProfileOperatorRequests user={user} language={language} />
          ) : (
            <p>{thai ? "Admin เลือกผู้ปฏิบัติงานได้ในหน้าบันทึกข้อมูล" : "Admins can select an operator on recording pages."}</p>
          )}
        </section>
      </div>
      <section className="profile-panel profile-security">
        <div className="profile-panel-heading">
          <div>
            <h2>{thai ? "ความปลอดภัย" : "Security"}</h2>
            <p>
              {thai
                ? "ตรวจอุปกรณ์ที่เข้าสู่ระบบ และออกจากระบบในอุปกรณ์ที่ไม่ได้ใช้งาน"
                : "Review signed-in devices and end sessions you no longer use."}
            </p>
          </div>
          <button type="button" className="button button--secondary" onClick={refresh}>
            {thai ? "รีเฟรช" : "Refresh"}
          </button>
        </div>
        {error && <ErrorMessage message={error} />}
        {loading && <p role="status">{thai ? "กำลังโหลดอุปกรณ์…" : "Loading devices…"}</p>}
        {!loading && !error && !sessions.some((session) => !session.revokedAt) && (
          <p>{thai ? "ไม่พบ session ที่ใช้งานอยู่" : "No active sessions found."}</p>
        )}
        <ul className="profile-sessions">
          {sessions
            .filter((session) => !session.revokedAt)
            .map((session) => {
              const current = String(session.id) === user.sessionId;
              return (
                <li key={String(session.id)}>
                  <div>
                    <strong>{current ? (thai ? "อุปกรณ์นี้" : "This device") : thai ? "อุปกรณ์อื่น" : "Other device"}</strong>
                    <small>
                      {thai ? "ใช้งานล่าสุด" : "Last active"}:{" "}
                      {formatBangkokDateTime(String(session.lastSeenAt ?? session.createdAt))}
                    </small>
                    <small>
                      {thai ? "รหัสอุปกรณ์" : "Device ID"}: {String(session.deviceId ?? "—")}
                    </small>
                  </div>
                  {current ? (
                    <span className="account-badge">{thai ? "กำลังใช้งาน" : "Current session"}</span>
                  ) : (
                    <button
                      type="button"
                      className="button button--secondary"
                      disabled={Boolean(busy)}
                      onClick={() => void revoke(String(session.id))}
                    >
                      {busy === String(session.id)
                        ? thai
                          ? "กำลังออก…"
                          : "Signing out…"
                        : thai
                          ? "ออกจากระบบอุปกรณ์นี้"
                          : "Sign out device"}
                    </button>
                  )}
                </li>
              );
            })}
        </ul>
        <button className="button button--secondary" type="button" onClick={onLogout}>
          {thai ? "ออกจากระบบในอุปกรณ์นี้" : "Sign out on this device"}
        </button>
      </section>
    </section>
  );
}
