import { type FormEvent, useEffect, useState } from "react";
import { deviceId, request } from "../api/client";
import { type AuthUser, finishPendingLogout, rememberUser, setOfflineQueueIdentity } from "../auth";
import { notify } from "../notifications";
import { ResearchArtwork } from "../research-artwork";

type Props = { onLogin: (user: AuthUser) => void };

export function Login({ onLogin }: Props) {
  const [language, setLanguage] = useState<"th" | "en">(() =>
    localStorage.getItem("chronofish.language") === "en" ? "en" : "th",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<"login" | "register" | "reset">("login");
  const [step, setStep] = useState<"credentials" | "code">("credentials");
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const th = language === "th";
  const settingPassword = mode !== "login";
  useEffect(() => {
    if (error) notify(error, "danger");
  }, [error]);

  useEffect(() => {
    document.documentElement.lang = language;
    localStorage.setItem("chronofish.language", language);
  }, [language]);
  useEffect(() => {
    if (!cooldown) return;
    const timer = window.setTimeout(() => setCooldown((current) => Math.max(0, current - 1)), 1_000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  function switchMode(next: typeof mode) {
    setMode(next);
    setStep("credentials");
    setPassword("");
    setConfirmation("");
    setCode("");
    setError("");
  }

  async function sendCode() {
    await request("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
    });
    setStep("code");
    setCooldown(60);
    notify(th ? "ส่งรหัสยืนยันแล้ว กรุณาตรวจสอบอีเมล" : "Verification code sent. Check your email.");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (settingPassword && password !== confirmation) {
      setError(th ? "รหัสผ่านทั้งสองช่องไม่ตรงกัน" : "Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await finishPendingLogout();
      if (settingPassword && step === "credentials") {
        await sendCode();
        return;
      }
      const response = await request(step === "code" ? "/auth/verify-code" : "/auth/login", {
        method: "POST",
        headers: { "X-Device-Id": deviceId() },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password, ...(step === "code" ? { code } : {}) }),
      });
      const result = (await response.json()) as { user: AuthUser };
      setPassword("");
      setConfirmation("");
      rememberUser(result.user);
      setOfflineQueueIdentity();
      onLogin(result.user);
      notify(th ? "เข้าสู่ระบบสำเร็จ" : "Signed in successfully.");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    setError("");
    try {
      await sendCode();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const title =
    mode === "register"
      ? th
        ? "สมัครบัญชีใหม่"
        : "Create an account"
      : mode === "reset"
        ? th
          ? "ตั้งหรือรีเซ็ตรหัสผ่าน"
          : "Set or reset your password"
        : th
          ? "เข้าสู่ระบบห้องปฏิบัติการ"
          : "Sign in to your lab";

  return (
    <main className="auth-shell auth-shell--login">
      <div className="auth-topline">
        <span className="auth-brand">
          <img src="/brand/kuvacb-logo.png" alt="KUVACB" /> KUVACB AqLIMS
        </span>
        <button className="language" type="button" onClick={() => setLanguage(th ? "en" : "th")}>
          {th ? "EN" : "ไทย"}
        </button>
      </div>
      <div className="auth-layout">
        <aside className="auth-intro" aria-labelledby="auth-intro-title">
          <div className="auth-intro__copy">
            <p className="eyebrow">KUVACB / AQUATIC RESEARCH</p>
            <h2 id="auth-intro-title">{th ? "ระบบงานวิจัยปลาม้าลาย" : "Zebrafish research workspace"}</h2>
            <p>
              {th
                ? "พื้นที่ทำงานสำหรับทีมวิจัยปลาม้าลาย ตั้งแต่การทดลอง การติดตามตัวอ่อน ไปจนถึงการดูแลปลา"
                : "A shared workspace for zebrafish research, from experiments and embryo observations to daily fish care."}
            </p>
          </div>
          <ResearchArtwork thai={th} animated={false} />
          <p className="auth-intro__caption">Kasetsart University Veterinary Animal Cell Bank</p>
        </aside>
        <section className="auth-card" aria-labelledby="login-title">
          <p className="eyebrow">Kasetsart University · Animal Cell Bank</p>
          <h1 id="login-title">{title}</h1>
          <p className="muted">{th ? "ใช้อีเมล @ku.th" : "Use your @ku.th email."}</p>
          <form
            className="auth-form"
            onSubmit={submit}
            onInvalid={() => notify(th ? "กรุณาตรวจสอบข้อมูลในฟอร์ม" : "Check the form fields.", "danger")}
          >
            {step === "credentials" ? (
              <>
                <label htmlFor="login-email">{th ? "อีเมลมหาวิทยาลัย" : "University email"}</label>
                <input
                  id="login-email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                  maxLength={254}
                  placeholder="name@ku.th"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
                <label htmlFor="login-password">{th ? "รหัสผ่าน" : "Password"}</label>
                <input
                  id="login-password"
                  name="password"
                  type="password"
                  autoComplete={settingPassword ? "new-password" : "current-password"}
                  required
                  minLength={8}
                  maxLength={128}
                  aria-describedby="password-help"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <p className="auth-help" id="password-help">
                  {th ? "8 ตัวขึ้นไป" : "At least 8 characters."}
                </p>
                {settingPassword && (
                  <>
                    <label htmlFor="confirm-password">{th ? "ยืนยันรหัสผ่าน" : "Confirm password"}</label>
                    <input
                      id="confirm-password"
                      name="confirmation"
                      type="password"
                      autoComplete="new-password"
                      required
                      minLength={8}
                      maxLength={128}
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value)}
                    />
                  </>
                )}
              </>
            ) : (
              <>
                <p className="auth-recipient">
                  {th ? "ส่งรหัสยืนยันไปที่" : "Verification code sent to"} <strong>{email}</strong>
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
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                />
                <p className="auth-help" id="code-help">
                  {th ? "รหัสใช้ได้ครั้งเดียวและหมดอายุใน 10 นาที" : "The code works once and expires after 10 minutes."}
                </p>
                <button
                  className="text-button"
                  type="button"
                  disabled={busy || cooldown > 0}
                  onClick={() => void resend()}
                >
                  {cooldown > 0 ? `${th ? "ส่งอีกครั้งใน" : "Resend in"} ${cooldown}s` : th ? "ส่งรหัสอีกครั้ง" : "Resend code"}
                </button>
              </>
            )}
            <button className="button button--primary auth-submit" type="submit" disabled={busy}>
              {busy
                ? th
                  ? "กำลังดำเนินการ…"
                  : "Please wait…"
                : step === "code"
                  ? th
                    ? "ยืนยันและเข้าสู่ระบบ"
                    : "Verify and sign in"
                  : settingPassword
                    ? th
                      ? "ส่งรหัสยืนยันอีเมล"
                      : "Send verification code"
                    : th
                      ? "เข้าสู่ระบบ"
                      : "Sign in"}
            </button>
          </form>
          {error && (
            <p className="error auth-error" role="alert">
              {error}
            </p>
          )}
          <div className="auth-actions">
            <button
              className="text-button"
              type="button"
              disabled={busy}
              onClick={() => switchMode(mode === "login" ? "register" : "login")}
            >
              {mode === "login" ? (th ? "สมัครบัญชีใหม่" : "Create an account") : th ? "กลับไปเข้าสู่ระบบ" : "Back to sign in"}
            </button>
            {mode === "login" && (
              <button className="text-button" type="button" disabled={busy} onClick={() => switchMode("reset")}>
                {th ? "ลืมรหัสผ่าน / บัญชีเดิมยังไม่มีรหัสผ่าน" : "Forgot password / Set your first password"}
              </button>
            )}
          </div>
        </section>
      </div>
      <footer className="auth-footer">Zebrafish research workspace · Kasetsart University</footer>
    </main>
  );
}
