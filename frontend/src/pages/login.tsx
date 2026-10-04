import { type FormEvent, useEffect, useState } from "react";
import { deviceId, request } from "../api/client";
import { type AuthUser, finishPendingLogout, rememberUser, setOfflineQueueIdentity } from "../auth";

type Props = { onLogin: (user: AuthUser) => void };

export function Login({ onLogin }: Props) {
  const [language, setLanguage] = useState<"th" | "en">(() =>
    localStorage.getItem("chronofish.language") === "en" ? "en" : "th",
  );
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const th = language === "th";

  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setTimeout(() => setCooldown((current) => Math.max(0, current - 1)), 1_000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function sendCode(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError("");
    try {
      await finishPendingLogout();
      await request("/auth/request-code", {
        method: "POST",
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      setStep("code");
      setCooldown(60);
    } catch (cause) {
      const status = (cause as Error & { status?: number }).status;
      setError(
        status === 429
          ? th
            ? "กรุณารอสักครู่ก่อนขอรหัสใหม่"
            : "Please wait before requesting another code."
          : status === 503
            ? th
              ? "ระบบส่งอีเมลยังตั้งค่าไม่เสร็จ กรุณาติดต่อผู้ดูแลระบบ"
              : "Email delivery is not configured yet. Contact an administrator."
            : (cause as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await finishPendingLogout();
      const response = await request("/auth/verify-code", {
        method: "POST",
        headers: { "X-Device-Id": deviceId() },
        body: JSON.stringify({ email: email.trim().toLowerCase(), code }),
      });
      const result = (await response.json()) as { user: AuthUser };
      rememberUser(result.user);
      setOfflineQueueIdentity();
      onLogin(result.user);
    } catch (cause) {
      const status = (cause as Error & { status?: number }).status;
      setError(
        status === 401
          ? th
            ? "รหัสไม่ถูกต้องหรือหมดอายุ ขอรหัสใหม่แล้วลองอีกครั้ง"
            : "That code is invalid or expired. Request a new one and try again."
          : (cause as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <div className="auth-topline">
        <span className="auth-brand">
          <img src="/brand/kuvacb-logo.png" alt="KUVACB" /> KUVACB AqLIMS
        </span>
        <button className="language" type="button" onClick={() => setLanguage(th ? "en" : "th")}>
          {th ? "EN" : "ไทย"}
        </button>
      </div>
      <section className="auth-card" aria-labelledby="login-title">
        <p className="eyebrow">Kasetsart University · Animal Cell Bank</p>
        <h1 id="login-title">{th ? "เข้าสู่ระบบห้องปฏิบัติการ" : "Sign in to your lab"}</h1>
        <p className="muted">
          {th
            ? "ใช้รหัสครั้งเดียวที่ส่งไปยังอีเมลมหาวิทยาลัยที่ได้รับเชิญ"
            : "Use a one-time code sent to your invited university email."}
        </p>
        {step === "email" ? (
          <form className="auth-form" onSubmit={sendCode}>
            <label htmlFor="login-email">{th ? "อีเมลมหาวิทยาลัย" : "University email"}</label>
            <input
              id="login-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              pattern=".+@ku\.th"
              title={th ? "ใช้เฉพาะอีเมลที่ลงท้ายด้วย @ku.th" : "Use an email ending in @ku.th"}
              placeholder="name@ku.th"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <button className="button button--primary auth-submit" type="submit" disabled={busy}>
              {busy ? (th ? "กำลังส่ง…" : "Sending…") : th ? "ส่งรหัส 6 หลัก" : "Send 6-digit code"}
            </button>
          </form>
        ) : (
          <form className="auth-form" onSubmit={verifyCode}>
            <p className="auth-recipient">
              {th ? "ส่งรหัสไปที่" : "Code sent to"} <strong>{email}</strong>
            </p>
            <label htmlFor="login-code">{th ? "รหัสยืนยัน 6 หลัก" : "6-digit verification code"}</label>
            <input
              id="login-code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              autoFocus
              aria-describedby="code-help"
              placeholder="000000"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            />
            <p className="auth-help" id="code-help">
              {th ? "รหัสใช้ได้ครั้งเดียวและหมดอายุใน 10 นาที" : "The code works once and expires after 10 minutes."}
            </p>
            <button className="button button--primary auth-submit" type="submit" disabled={busy || code.length !== 6}>
              {busy ? (th ? "กำลังตรวจสอบ…" : "Verifying…") : th ? "ยืนยันและเข้าสู่ระบบ" : "Verify and sign in"}
            </button>
            <div className="auth-actions">
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  setStep("email");
                  setError("");
                }}
              >
                {th ? "เปลี่ยนอีเมล" : "Change email"}
              </button>
              <button
                className="text-button"
                type="button"
                disabled={busy || cooldown > 0}
                onClick={() => void sendCode()}
              >
                {cooldown > 0
                  ? th
                    ? `ส่งรหัสอีกครั้งใน ${cooldown} วินาที`
                    : `Resend in ${cooldown}s`
                  : th
                    ? "ส่งรหัสอีกครั้ง"
                    : "Resend code"}
              </button>
            </div>
          </form>
        )}
        {error && (
          <p className="error auth-error" role="alert">
            {error}
          </p>
        )}
        <div className="auth-footnote">
          <span aria-hidden="true">●</span>
          {th
            ? "เข้าใช้ได้เฉพาะสมาชิกที่ผู้ดูแลเชิญด้วยอีเมล @ku.th"
            : "Only members invited by an administrator can sign in with @ku.th."}
        </div>
      </section>
      <footer className="auth-footer">Zebrafish research workspace · Kasetsart University</footer>
    </main>
  );
}
