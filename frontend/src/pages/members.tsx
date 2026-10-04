import { type FormEvent, useEffect, useState } from "react";
import { type ApiItem, get, request } from "../api/client";
import type { Language } from "../types";

type Member = ApiItem & {
  id: string;
  email: string;
  role: "admin" | "member";
  active: boolean;
  verifiedAt?: string | null;
  operatorId?: string | null;
  syncDevices: { deviceId: string; pendingCount: number; lastReportedAt: string; stale: boolean }[];
};
type Session = { id: string; deviceId: string; createdAt: string; lastSeenAt: string; revokedAt?: string | null };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "The request failed";
}

export function Members({ language }: { language: Language }) {
  const th = language === "th";
  const [members, setMembers] = useState<Member[]>([]);
  const [operators, setOperators] = useState<ApiItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { role: "admin" | "member"; operatorId: string }>>({});
  const [sessions, setSessions] = useState<Record<string, Session[]>>({});
  const [sender, setSender] = useState("");
  const [smtpConfigured, setSmtpConfigured] = useState(false);
  const [mailSettingsLoaded, setMailSettingsLoaded] = useState(false);
  const [email, setEmail] = useState("");
  const [deactivateTarget, setDeactivateTarget] = useState<Member | null>(null);
  const [acknowledgeRisk, setAcknowledgeRisk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function reload() {
    const [users, operatorData, mailSettings] = await Promise.all([
      get("/auth/admin/users"),
      get("/operators"),
      get("/auth/admin/mail-settings"),
    ]);
    setMembers((users.items ?? []) as Member[]);
    setOperators(operatorData.items ?? []);
    setSender(String(mailSettings.senderEmail ?? ""));
    setSmtpConfigured(Boolean(mailSettings.smtpConfigured));
    setMailSettingsLoaded(true);
  }

  useEffect(() => {
    void reload().catch((cause) => setError(errorText(cause)));
  }, []);

  async function submitInvitation(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await request("/auth/admin/users", {
        method: "POST",
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const result = await response.json();
      setEmail("");
      setNotice(
        result.emailSent
          ? th
            ? "ส่งคำเชิญทางอีเมลแล้ว"
            : "Invitation email sent."
          : th
            ? "สร้างบัญชีแล้ว แต่ส่งอีเมลไม่สำเร็จ กรุณากดส่งคำเชิญอีกครั้งในรายชื่อสมาชิก"
            : "Account created, but email delivery failed. Use Resend invitation in the member list.",
      );
      await reload();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  function draftFor(member: Member) {
    return drafts[member.id] ?? { role: member.role, operatorId: member.operatorId ?? "" };
  }

  async function saveMember(member: Member) {
    const draft = draftFor(member);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request(`/auth/admin/users/${member.id}`, {
        method: "PATCH",
        body: JSON.stringify({ role: draft.role, operatorId: draft.operatorId || null }),
      });
      window.dispatchEvent(new CustomEvent("chronofish:auth-refresh"));
      setNotice(th ? "บันทึกสิทธิ์และผู้ปฏิบัติงานแล้ว" : "Role and operator link saved.");
      await reload();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  async function deactivate(member: Member) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request(`/auth/admin/users/${member.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: false, acknowledgePendingDataRisk: acknowledgeRisk }),
      });
      setDeactivateTarget(null);
      setAcknowledgeRisk(false);
      setNotice(th ? "ปิดบัญชีแล้วและยกเลิกทุก session" : "Account disabled and all sessions revoked.");
      await reload();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  async function toggleSessions(member: Member) {
    if (sessions[member.id]) {
      setSessions((current) => {
        const next = { ...current };
        delete next[member.id];
        return next;
      });
      return;
    }
    try {
      const result = await get(`/auth/admin/users/${member.id}/sessions`);
      setSessions((current) => ({ ...current, [member.id]: (result.items ?? []) as Session[] }));
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  async function revokeSession(member: Member, session: Session) {
    setBusy(true);
    setError("");
    try {
      await request(`/auth/admin/users/${member.id}/sessions/${session.id}`, { method: "DELETE" });
      const result = await get(`/auth/admin/users/${member.id}/sessions`);
      setSessions((current) => ({ ...current, [member.id]: (result.items ?? []) as Session[] }));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  async function resendInvitation(member: Member) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request(`/auth/admin/users/${member.id}/invite`, { method: "POST", body: "{}" });
      setNotice(th ? `ส่งคำเชิญไปที่ ${member.email} แล้ว` : `Invitation resent to ${member.email}.`);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  async function saveSender(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request("/auth/admin/mail-settings", {
        method: "PATCH",
        body: JSON.stringify({ senderEmail: sender.trim() }),
      });
      setNotice(th ? "บันทึกอีเมลผู้ส่งแล้ว" : "Sender email saved.");
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  const pendingTotal = (member: Member) => member.syncDevices.reduce((count, device) => count + device.pendingCount, 0);
  const syncStale = (member: Member) =>
    (!member.syncDevices.length && Boolean(member.verifiedAt)) || member.syncDevices.some((device) => device.stale);
  const canOverride = (member: Member) => syncStale(member);
  const blockedByPending = (member: Member) =>
    member.syncDevices.some((device) => !device.stale && device.pendingCount > 0);

  return (
    <section className="members-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">{th ? "การเข้าถึง" : "Access control"}</p>
          <h1>{th ? "สมาชิกห้องปฏิบัติการ" : "Lab members"}</h1>
          <p className="muted">
            {th
              ? "เชิญสมาชิกด้วยอีเมล @ku.th จัดการสิทธิ์ เชื่อมผู้ปฏิบัติงาน และตรวจสอบงานออฟไลน์ก่อนปิดบัญชี"
              : "Invite @ku.th members, assign roles and operators, and review offline work before disabling an account."}
          </p>
        </div>
      </header>

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="success" role="status">
          {notice}
        </div>
      )}

      <section className="form-card members-invite">
        <div>
          <h2>{th ? "เชิญสมาชิก" : "Invite a member"}</h2>
          <p className="muted">
            {th ? "ระบบจะส่งคำเชิญไปยังอีเมลนี้ทันที" : "The system sends an invitation email immediately."}
          </p>
        </div>
        <form className="members-inline-form" onSubmit={submitInvitation}>
          <label htmlFor="invite-email">{th ? "อีเมลมหาวิทยาลัย" : "University email"}</label>
          <input
            id="invite-email"
            type="email"
            required
            pattern=".+@ku\.th"
            placeholder="name@ku.th"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <button className="button button--primary" disabled={busy}>
            {th ? "เชิญสมาชิก" : "Send invitation"}
          </button>
        </form>
      </section>

      <section className="members-list" aria-label={th ? "รายชื่อสมาชิก" : "Member list"}>
        {members.map((member) => {
          const draft = draftFor(member);
          const pending = pendingTotal(member);
          return (
            <article className={`member-card ${member.active ? "" : "member-card--inactive"}`} key={member.id}>
              <div className="member-card__header">
                <div>
                  <h2>{member.email}</h2>
                  <span className={`member-status ${member.active ? "member-status--active" : ""}`}>
                    {member.active
                      ? member.verifiedAt
                        ? th
                          ? "ใช้งาน"
                          : "Active"
                        : th
                          ? "รอยืนยันอีเมล"
                          : "Invitation pending"
                      : th
                        ? "ปิดใช้งาน"
                        : "Disabled"}
                  </span>
                </div>
                <div className="member-card__actions">
                  {!member.verifiedAt && member.active && (
                    <button
                      className="button button--secondary"
                      type="button"
                      disabled={busy}
                      onClick={() => void resendInvitation(member)}
                    >
                      {th ? "ส่งคำเชิญอีกครั้ง" : "Resend invitation"}
                    </button>
                  )}
                  {member.active && (
                    <button
                      className="button button--secondary"
                      type="button"
                      onClick={() => {
                        setDeactivateTarget(member);
                        setAcknowledgeRisk(false);
                      }}
                    >
                      {th ? "ปิดบัญชี" : "Disable account"}
                    </button>
                  )}
                  {!member.active && (
                    <button
                      className="button button--secondary"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void request(`/auth/admin/users/${member.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({ active: true }),
                        })
                          .then(reload)
                          .catch((cause) => setError(errorText(cause)))
                      }
                    >
                      {th ? "เปิดใช้งานอีกครั้ง" : "Reactivate"}
                    </button>
                  )}
                </div>
              </div>

              <div className="member-fields">
                <label>
                  {th ? "บทบาท" : "Role"}
                  <select
                    value={draft.role}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [member.id]: { ...draft, role: event.target.value as "admin" | "member" },
                      }))
                    }
                  >
                    <option value="member">{th ? "สมาชิก" : "Member"}</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>
                <label>
                  {th ? "ผู้ปฏิบัติงานทดลอง" : "Experimental operator"}
                  <select
                    value={draft.operatorId}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [member.id]: { ...draft, operatorId: event.target.value },
                      }))
                    }
                  >
                    <option value="">{th ? "ยังไม่เชื่อม" : "Not linked"}</option>
                    {operators.map((operator) => (
                      <option key={String(operator.id)} value={String(operator.id)}>
                        {String(operator.name)}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="button button--secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => void saveMember(member)}
                >
                  {th ? "บันทึกสิทธิ์" : "Save access"}
                </button>
              </div>

              <div className="sync-summary">
                <strong>
                  {th ? "งานออฟไลน์ที่ทราบ" : "Known offline work"}: {pending}
                </strong>
                {member.syncDevices.length ? (
                  member.syncDevices.map((device) => (
                    <span key={device.deviceId}>
                      {device.deviceId.slice(0, 8)} · {device.pendingCount} {th ? "รายการ" : "items"} ·{" "}
                      {device.stale ? (th ? "สถานะเก่า" : "stale") : th ? "อัปเดตล่าสุด" : "reported recently"}
                    </span>
                  ))
                ) : (
                  <span>{th ? "ยังไม่มีอุปกรณ์รายงานสถานะ" : "No device has reported a sync status."}</span>
                )}
                {blockedByPending(member) && (
                  <p className="error-text">
                    {th
                      ? "มีงานค้างบนอุปกรณ์ที่ยังรายงานสถานะล่าสุด กรุณาให้สมาชิกเชื่อมต่อและ sync ก่อน"
                      : "A recently reported device still has pending work. Ask the member to reconnect and sync first."}
                  </p>
                )}
              </div>

              <details
                className="member-sessions"
                onToggle={(event) => {
                  if (event.currentTarget.open && !sessions[member.id]) void toggleSessions(member);
                }}
              >
                <summary>{th ? "Session และอุปกรณ์" : "Sessions and devices"}</summary>
                {(sessions[member.id] ?? []).map((session) => (
                  <div className="member-session" key={session.id}>
                    <span>
                      {session.deviceId} · {th ? "ใช้งานล่าสุด" : "last used"}{" "}
                      {new Date(session.lastSeenAt).toLocaleString(language === "th" ? "th-TH" : "en-US")}
                    </span>
                    {session.revokedAt ? (
                      <span>{th ? "ยกเลิกแล้ว" : "Revoked"}</span>
                    ) : (
                      <button
                        className="text-button"
                        type="button"
                        disabled={busy}
                        onClick={() => void revokeSession(member, session)}
                      >
                        {th ? "ยกเลิก session" : "Revoke session"}
                      </button>
                    )}
                  </div>
                ))}
              </details>

              {deactivateTarget?.id === member.id && (
                <div
                  className="deactivate-confirm"
                  role="group"
                  aria-label={th ? "ยืนยันการปิดบัญชี" : "Confirm account disable"}
                >
                  <strong>{th ? "ปิดบัญชีสมาชิกนี้?" : "Disable this account?"}</strong>
                  <p>
                    {th
                      ? "ระบบจะยกเลิกทุก session และเก็บประวัติไว้ งานออฟไลน์จะ sync ได้หลังเปิดบัญชีใหม่และเข้าสู่ระบบด้วยบัญชีเดิม"
                      : "All sessions will be revoked and history retained. Offline work can sync after reactivation and sign-in with this same account."}
                  </p>
                  {canOverride(member) && (
                    <label className="acknowledge-risk">
                      <input
                        type="checkbox"
                        checked={acknowledgeRisk}
                        onChange={(event) => setAcknowledgeRisk(event.target.checked)}
                      />
                      {th
                        ? "ฉันรับทราบว่าสถานะออฟไลน์ล้าสมัยหรือไม่พร้อม และยอมปิดบัญชี"
                        : "I acknowledge the offline status is stale or unavailable and approve disabling this account."}
                    </label>
                  )}
                  <div className="button-row">
                    <button
                      className="button button--secondary"
                      type="button"
                      onClick={() => setDeactivateTarget(null)}
                    >
                      {th ? "ยกเลิก" : "Cancel"}
                    </button>
                    <button
                      className="button button--primary"
                      type="button"
                      disabled={busy || blockedByPending(member) || (canOverride(member) && !acknowledgeRisk)}
                      onClick={() => void deactivate(member)}
                    >
                      {th ? "ยืนยันปิดบัญชี" : "Confirm disable"}
                    </button>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </section>

      <section className="form-card sender-settings">
        <div>
          <h2>{th ? "อีเมลผู้ส่งระบบ" : "System sender email"}</h2>
          <p className="muted">
            {th
              ? "เปลี่ยนที่อยู่อีเมลผู้ส่งได้ที่นี่ ส่วนข้อมูลยืนยัน SMTP จะเก็บใน server configuration เท่านั้น"
              : "Set the visible sender address here. SMTP credentials stay in server configuration."}
          </p>
        </div>
        {mailSettingsLoaded && !smtpConfigured && (
          <p className="error" role="status">
            {th
              ? "ยังไม่ได้ตั้งค่า SMTP ฝั่งเซิร์ฟเวอร์ การส่งคำเชิญและรหัสยืนยันทางอีเมลยังใช้ไม่ได้"
              : "Server SMTP is not configured. Invitations and sign-in codes cannot be emailed yet."}
          </p>
        )}
        <form className="members-inline-form" onSubmit={saveSender}>
          <label htmlFor="sender-email">{th ? "ส่งอีเมลจาก" : "Send email from"}</label>
          <input
            id="sender-email"
            type="email"
            required
            value={sender}
            onChange={(event) => setSender(event.target.value)}
          />
          <button className="button button--secondary" disabled={busy}>
            {th ? "บันทึกผู้ส่ง" : "Save sender"}
          </button>
        </form>
      </section>
    </section>
  );
}
