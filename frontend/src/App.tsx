import { type FormEvent, useEffect, useRef, useState } from "react";
import { get, operatorId, request } from "./api/client";
import {
  type AuthUser,
  cachedUser,
  clearLogoutPending,
  finishPendingLogout,
  forgetUser,
  hasPendingLogout,
  markLogoutPending,
  verifySession,
} from "./auth";
import { Icon } from "./components";
import {
  discardRejected,
  drainQueue,
  type QueuedWriteRecord,
  queueCount,
  queueCountForOtherAccounts,
  rejectedQueueItems,
  retryRejected,
  startQueueSync,
  unassignedQueueCount,
} from "./offline";
import { Audit } from "./pages/audit";
import { Batches } from "./pages/batches";
import { AdminHome, AdminRequests, MyRequests } from "./pages/corrections";
import { Dashboard } from "./pages/dashboard";
import { Due } from "./pages/due";
import { Export } from "./pages/export";
import { Fish } from "./pages/fish";
import { Imports } from "./pages/imports";
import { Login } from "./pages/login";
import { Master } from "./pages/master";
import { Members } from "./pages/members";
import { Controls, Promotions, Timing } from "./pages/settings";
import { type ApiItem, type Language, type Page, text } from "./types";

type NavItem = { page: Page; label: string; icon: string; group: "primary" | "research" | "system" };

const productName = "KUVACB AqLIMS";

function pageForWrite(path: string): Page {
  if (path.startsWith("/observations/embryo")) return "due";
  if (path.startsWith("/batches") || path.startsWith("/injection-lots") || path.startsWith("/embryos"))
    return "batches";
  if (path.startsWith("/fish") || path.startsWith("/observations/fish")) return "fish";
  if (path.startsWith("/timing-profiles")) return "timing";
  if (path.startsWith("/promotions")) return "promotions";
  if (path.includes("control-arm-counts")) return "controls";
  return "master";
}

export function markInvalidFields(form: HTMLFormElement | null, page: Page, language: Language) {
  return Array.from(
    form?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea") ?? [],
  )
    .filter((control) => !control.validity.valid)
    .map((control, index) => {
      if (!control.id) {
        let suffix = index + 1;
        while (document.getElementById(`invalid-${page}-${suffix}`)) suffix += 1;
        control.id = `invalid-${page}-${suffix}`;
      }
      const errorId = `${control.id}-error`;
      const message = language === "th" ? "กรุณากรอกหรือแก้ไขข้อมูลในช่องนี้" : "Enter or correct this field.";
      control.setAttribute("aria-invalid", "true");
      control.setAttribute(
        "aria-describedby",
        [...new Set([...(control.getAttribute("aria-describedby")?.split(" ") ?? []), errorId])].join(" "),
      );
      control.parentElement?.setAttribute("data-field-error", message);
      return {
        id: control.id,
        errorId,
        label:
          control.labels?.[0]?.textContent?.trim() ||
          control.getAttribute("aria-label") ||
          (language === "th" ? `ช่องที่ ${index + 1}` : `Field ${index + 1}`),
        message,
      };
    });
}

function Workspace({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const isAdmin = user.role === "admin";
  const adminMode = window.location.pathname === "/admin" || window.location.pathname.startsWith("/admin/");
  const adminPages: Page[] = ["admin", "corrections", "master", "timing", "members", "audit", "imports"];
  const initialPage = location.hash.slice(1) as Page;
  const [page, setPage] = useState<Page>(() =>
    adminMode
      ? adminPages.includes(initialPage)
        ? initialPage
        : "admin"
      : adminPages.includes(initialPage)
        ? "dashboard"
        : initialPage || "dashboard",
  );
  const [language, setLanguage] = useState<Language>(() =>
    localStorage.getItem("chronofish.language") === "en" ? "en" : "th",
  );
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(0);
  const [rejected, setRejected] = useState<QueuedWriteRecord[]>([]);
  const [otherAccountWork, setOtherAccountWork] = useState(0);
  const [unassignedWork, setUnassignedWork] = useState(0);
  const pendingRef = useRef(0);
  const rejectedRef = useRef(0);
  const otherAccountWorkRef = useRef(0);
  const unassignedWorkRef = useRef(0);
  const [syncing, setSyncing] = useState(false);
  const [operators, setOperators] = useState<ApiItem[]>([]);
  const [formErrors, setFormErrors] = useState<{ id: string; errorId: string; label: string; message: string }[]>([]);
  const validationFrame = useRef(0);
  const previousPage = useRef(page);
  const currentOperator = operatorId();
  const writePage = ![
    "dashboard",
    "audit",
    "export",
    "members",
    "admin",
    "corrections",
    "my-requests",
    "imports",
  ].includes(page);
  const t = text[language];
  const navItems: NavItem[] = [
    { page: "dashboard", label: t.dashboard, icon: "dashboard", group: "primary" },
    { page: "batches", label: t.batches, icon: "batches", group: "primary" },
    { page: "due", label: t.due, icon: "due", group: "primary" },
    { page: "fish", label: t.fish, icon: "fish", group: "primary" },
    { page: "my-requests", label: language === "th" ? "คำร้องของฉัน" : "My requests", icon: "audit", group: "primary" },
    { page: "promotions", label: t.promotions, icon: "promotions", group: "research" },
    { page: "controls", label: t.controls, icon: "controls", group: "research" },
    { page: "timing", label: t.timing, icon: "timing", group: "system" },
    { page: "export", label: t.export, icon: "export", group: "research" },
    { page: "master", label: t.master, icon: "master", group: "system" },
    { page: "audit", label: t.audit, icon: "audit", group: "system" },
    { page: "members", label: t.members, icon: "people", group: "system" },
    { page: "admin", label: language === "th" ? "ดูแลระบบ" : "Administration", icon: "dashboard", group: "primary" },
    { page: "corrections", label: language === "th" ? "คำร้องแก้ไข" : "Corrections", icon: "audit", group: "primary" },
  ];
  navItems.push({
    page: "imports",
    label: language === "th" ? "นำเข้าข้อมูล" : "Imports",
    icon: "export",
    group: "system",
  });
  const visibleNav = adminMode
    ? navItems.filter((item) => adminPages.includes(item.page))
    : navItems.filter((item) => !adminPages.includes(item.page));
  const currentNav = visibleNav.find((item) => item.page === page) ?? visibleNav[0];

  useEffect(() => {
    pendingRef.current = pending;
    rejectedRef.current = rejected.length;
    otherAccountWorkRef.current = otherAccountWork;
    unassignedWorkRef.current = unassignedWork;
  }, [pending, rejected.length, otherAccountWork, unassignedWork]);

  useEffect(() => {
    void get("/operators")
      .then((data) => setOperators(data.items ?? []))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    document.documentElement.lang = language;
    localStorage.setItem("chronofish.language", language);
  }, [language]);
  useEffect(() => {
    document.title = `${currentNav.label} · ${adminMode ? "KUVACB Admin" : productName}`;
  }, [adminMode, currentNav.label]);
  useEffect(() => {
    if ((!adminMode && adminPages.includes(page)) || (adminMode && !adminPages.includes(page))) {
      const fallback = adminMode ? "admin" : "dashboard";
      setPage(fallback);
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${fallback}`);
    }
  }, [adminMode, page]);
  useEffect(() => {
    if (previousPage.current === page) return;
    previousPage.current = page;
    setFormErrors([]);
    window.scrollTo({ top: 0, behavior: "auto" });
    window.requestAnimationFrame(() => document.getElementById("main-content")?.focus());
  }, [page]);
  useEffect(() => {
    const followHistory = () => {
      const next = location.hash.slice(1) as Page;
      if (navItems.some((item) => item.page === next) && adminMode === adminPages.includes(next)) setPage(next);
    };
    window.addEventListener("hashchange", followHistory);
    window.addEventListener("popstate", followHistory);
    return () => {
      window.removeEventListener("hashchange", followHistory);
      window.removeEventListener("popstate", followHistory);
    };
  }, []);
  useEffect(() => {
    const refreshQueue = () =>
      void Promise.all([
        queueCount(),
        rejectedQueueItems(user.id),
        queueCountForOtherAccounts(user.id),
        unassignedQueueCount(),
      ]).then(([count, rejectedItems, otherCount, unassignedCount]) => {
        setPending(count);
        setRejected(rejectedItems);
        setOtherAccountWork(otherCount);
        setUnassignedWork(unassignedCount);
      });
    const on = () => {
      setOnline(true);
      void drainQueue().then(refreshQueue);
    };
    const off = () => setOnline(false);
    const queueChanged = () => refreshQueue();
    const syncStarted = () => setSyncing(true);
    const syncIdle = () => {
      setSyncing(false);
      refreshQueue();
    };
    const beforeClose = (event: BeforeUnloadEvent) => {
      if (pendingRef.current + rejectedRef.current + otherAccountWorkRef.current + unassignedWorkRef.current > 0) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    window.addEventListener("chronofish:queue-enqueued", queueChanged);
    window.addEventListener("chronofish:queue-drained", queueChanged);
    window.addEventListener("chronofish:queue-rejected", queueChanged);
    window.addEventListener("chronofish:queue-discarded", queueChanged);
    window.addEventListener("chronofish:auth-changed", queueChanged);
    window.addEventListener("chronofish:queue-syncing", syncStarted);
    window.addEventListener("chronofish:queue-sync-idle", syncIdle);
    window.addEventListener("beforeunload", beforeClose);
    void drainQueue().then(refreshQueue);
    const stopQueueSync = startQueueSync(refreshQueue, user.id);
    return () => {
      stopQueueSync();
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      window.removeEventListener("chronofish:queue-enqueued", queueChanged);
      window.removeEventListener("chronofish:queue-drained", queueChanged);
      window.removeEventListener("chronofish:queue-rejected", queueChanged);
      window.removeEventListener("chronofish:queue-discarded", queueChanged);
      window.removeEventListener("chronofish:auth-changed", queueChanged);
      window.removeEventListener("chronofish:queue-syncing", syncStarted);
      window.removeEventListener("chronofish:queue-sync-idle", syncIdle);
      window.removeEventListener("beforeunload", beforeClose);
    };
  }, [user.id]);

  const navigate = (next: Page) => {
    if (next !== page)
      window.history.pushState(
        null,
        "",
        `${window.location.pathname}${adminMode ? "" : window.location.search}#${next}`,
      );
    setPage(next);
  };
  const renderNav = (items: NavItem[]) =>
    items.map((item) => (
      <button
        key={item.page}
        aria-current={page === item.page ? "page" : undefined}
        className={page === item.page ? "nav-link nav-link--active" : "nav-link"}
        onClick={(event) => {
          event.currentTarget.closest(".nav-disclosure--mobile")?.removeAttribute("open");
          navigate(item.page);
        }}
      >
        <Icon name={item.icon} />
        <span>{item.label}</span>
      </button>
    ));
  return (
    <div className={adminMode ? "app app--admin" : "app"}>
      <a className="skip-link" href="#main-content">
        {language === "th" ? "ข้ามไปยังเนื้อหาหลัก" : "Skip to main content"}
      </a>
      <aside className="sidebar">
        <a
          className="brand-lockup"
          href={adminMode ? "#admin" : "#dashboard"}
          aria-label={
            adminMode ? "KUVACB Admin" : language === "th" ? "KUVACB · สรุปผลการทดลอง" : "KUVACB · Experiment dashboard"
          }
        >
          <span className="brand-logo">
            <img src="/brand/kuvacb-logo.png" width="1095" height="351" alt="KUVACB" />
          </span>
          <span className="brand-copy">
            <span className="brand">{adminMode ? "KUVACB Admin" : "KUVACB AqLIMS"}</span>
            <span className="tagline">
              {adminMode
                ? language === "th"
                  ? "ดูแลสมาชิกและข้อมูลระบบ"
                  : "Member and system management"
                : language === "th"
                  ? "ระบบบันทึกงานวิจัยปลาม้าลาย"
                  : "Zebrafish research workspace"}
            </span>
          </span>
        </a>
        <nav aria-label={language === "th" ? "เมนูหลัก" : "Main navigation"} className="sidebar-nav">
          <div className="nav-group nav-group--primary">
            <p className="nav-group__label">{language === "th" ? "งาน" : "Task"}</p>
            {renderNav(visibleNav.filter((item) => item.group === "primary"))}
          </div>
          <details className="nav-disclosure nav-disclosure--desktop" open>
            <summary>{language === "th" ? "งานต่อเนื่องและรายงาน" : "Follow-up & reports"}</summary>
            <div className="nav-group">{renderNav(visibleNav.filter((item) => item.group === "research"))}</div>
          </details>
          {visibleNav.some((item) => item.group === "system") && (
            <details
              className="nav-disclosure nav-disclosure--desktop"
              open={visibleNav.some((item) => item.group === "system" && item.page === page)}
            >
              <summary>{language === "th" ? "ข้อมูลอ้างอิงและระบบ" : "Reference & system"}</summary>
              <div className="nav-group">{renderNav(visibleNav.filter((item) => item.group === "system"))}</div>
            </details>
          )}
          <details className="nav-disclosure nav-disclosure--mobile">
            <summary>
              <Icon name="more" />
              <span>{language === "th" ? "เพิ่มเติม" : "More"}</span>
            </summary>
            <div className="nav-group">{renderNav(visibleNav.filter((item) => item.group !== "primary"))}</div>
          </details>
        </nav>
        <div className="sidebar-note">
          <Icon name="audit" />
          <span>
            <strong>{language === "th" ? "ทุกบันทึกมีความหมาย" : "Every record matters"}</strong>
            <small>
              {language === "th"
                ? "ตรวจสอบประวัติการแก้ไข และบันทึกต่อได้เมื่อออฟไลน์"
                : "Traceable changes. Keep recording even when offline."}
            </small>
          </span>
        </div>
      </aside>
      <header className="topbar">
        <div className="workspace-context">
          <span>
            <span className="workspace-kicker">
              {language === "th" ? "ธนาคารเซลล์สัตว์ มหาวิทยาลัยเกษตรศาสตร์" : "Kasetsart University · Animal Cell Bank"}
            </span>
            <strong>{currentNav.label}</strong>
          </span>
        </div>
        <div className="top-actions">
          <span className="account-badge" title={user.role === "admin" ? "Admin" : "Member"}>
            <span>{user.email}</span>
            <small>{user.role === "admin" ? "Admin" : language === "th" ? "สมาชิก" : "Member"}</small>
          </span>
          {(!adminMode || page === "master" || page === "timing") && (
            <label className="operator-select">
              <span>{t.operator}</span>
              <select
                id="operator-select"
                aria-label={isAdmin ? t.chooseOperator : t.operator}
                value={currentOperator}
                disabled={!isAdmin}
                onChange={(event) => {
                  sessionStorage.setItem("chronofish.operator_id", event.target.value);
                  window.location.reload();
                }}
              >
                <option value="">{t.chooseOperator}</option>
                {operators.map((operator) => (
                  <option key={String(operator.id)} value={String(operator.id)}>
                    {String(operator.name)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!currentOperator && isAdmin && writePage && (
            <span className="sr-only" role="status">
              {t.operatorRequired}
            </span>
          )}
          <span className={`connection connection--${online ? "online" : "offline"}`} aria-live="polite">
            <span aria-hidden="true" />
            {online ? t.online : t.offline}
          </span>
          <span className={`queue ${pending + rejected.length ? "queue--pending" : ""}`} aria-live="polite">
            {syncing ? t.syncing : pending + rejected.length ? `${t.pending} ${pending + rejected.length}` : t.saved}
          </span>
          {rejected.length > 0 && (
            <details className="queue-review">
              <summary>
                {t.reviewRejected} ({rejected.length})
              </summary>
              <div className="queue-review__panel">
                {rejected.map(({ id, value }) => (
                  <div className="queue-review__item" key={String(id)}>
                    <strong>
                      {value.method} {value.path}
                    </strong>
                    <span>{value.lastError || t.rejectedFallback}</span>
                    <div>
                      <button type="button" onClick={() => navigate(pageForWrite(value.path))}>
                        {t.openRelated}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(t.confirmDiscard)) void discardRejected(id);
                        }}
                      >
                        {t.discardRejected}
                      </button>
                    </div>
                  </div>
                ))}
                <button className="queue-retry" type="button" onClick={() => void retryRejected(user.id)}>
                  {t.retryRejected}
                </button>
              </div>
            </details>
          )}
          <button
            className="language"
            onClick={() => setLanguage(language === "th" ? "en" : "th")}
            aria-label={language === "th" ? "เปลี่ยนภาษาเป็นอังกฤษ" : "Switch language to Thai"}
          >
            {language === "th" ? "EN" : "ไทย"}
          </button>
          {isAdmin && (
            <a className="button button--secondary" href={adminMode ? "/" : "/admin"}>
              {adminMode ? (language === "th" ? "กลับเว็บหลัก" : "Research workspace") : "Admin"}
            </a>
          )}
          <button className="button button--secondary logout-button" type="button" onClick={onLogout}>
            {language === "th" ? "ออกจากระบบ" : "Sign out"}
          </button>
        </div>
      </header>
      <main className="content" id="main-content" tabIndex={-1} data-page={page}>
        {(otherAccountWork > 0 || unassignedWork > 0) && (
          <div className="queue-account-warning" role="status">
            {otherAccountWork > 0 && (
              <p>
                {language === "th"
                  ? "มีงานออฟไลน์ที่บันทึกไว้สำหรับบัญชีอื่น งานเหล่านี้จะไม่ sync ด้วยบัญชีปัจจุบัน กรุณาเข้าสู่ระบบด้วยบัญชีเดิมบนอุปกรณ์นี้"
                  : `${otherAccountWork} offline item(s) are saved for another account. They will not sync under this account. Sign in as the original account on this device to sync them.`}
              </p>
            )}
            {unassignedWork > 0 && (
              <p>
                {language === "th"
                  ? "มีงานออฟไลน์เก่าที่ยังไม่ระบุบัญชีผู้บันทึก ระบบจะไม่ sync งานเหล่านี้โดยอัตโนมัติ กรุณาให้ผู้ดูแลตรวจสอบก่อนล้างข้อมูลเบราว์เซอร์"
                  : `${unassignedWork} older offline item(s) have no recorded account. They will not sync automatically. Ask a lab administrator to review them before clearing browser data.`}
              </p>
            )}
          </div>
        )}
        {writePage && !currentOperator && (
          <div className="operator-gate" role="alert">
            <strong>
              {isAdmin
                ? t.operatorRequired
                : language === "th"
                  ? "บัญชีนี้ยังไม่เชื่อมกับผู้ปฏิบัติงาน กรุณาติดต่อผู้ดูแลระบบ"
                  : "Ask an administrator to link your account to an operator before recording work."}
            </strong>
            {isAdmin && (
              <button type="button" onClick={() => document.getElementById("operator-select")?.focus()}>
                {t.chooseOperator}
              </button>
            )}
          </div>
        )}
        {formErrors.length > 0 && (
          <div className="error form-error-summary" id="form-error-summary" role="alert" tabIndex={-1}>
            <strong>{language === "th" ? "ตรวจสอบข้อมูลที่ต้องแก้ไข" : "Check the fields that need attention"}</strong>
            <ul>
              {formErrors.map((item) => (
                <li id={item.errorId} key={item.id}>
                  <a href={`#${item.id}`}>{item.label}</a>: {item.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        <fieldset
          className="page-gate"
          disabled={writePage && !currentOperator}
          aria-describedby={writePage && !currentOperator ? "operator-select" : undefined}
          onInvalid={(event: FormEvent<HTMLElement>) => {
            const field = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
            window.cancelAnimationFrame(validationFrame.current);
            validationFrame.current = window.requestAnimationFrame(() => {
              setFormErrors(markInvalidFields(field.form, page, language));
              window.requestAnimationFrame(() => document.getElementById("form-error-summary")?.focus());
            });
          }}
          onChange={(event: FormEvent<HTMLElement>) => {
            const field = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
            if (field.validity?.valid) {
              field.removeAttribute("aria-invalid");
              const describedBy = field
                .getAttribute("aria-describedby")
                ?.split(" ")
                .filter((id) => id !== `${field.id}-error`)
                .join(" ");
              if (describedBy) field.setAttribute("aria-describedby", describedBy);
              else field.removeAttribute("aria-describedby");
              field.parentElement?.removeAttribute("data-field-error");
              setFormErrors((current) => current.filter((item) => item.id !== field.id));
            }
          }}
        >
          {writePage && (
            <p className="required-note">
              {language === "th" ? "ช่องที่มีเครื่องหมาย * จำเป็นต้องกรอก" : "Fields marked * are required"}
            </p>
          )}
          {page === "dashboard" && <Dashboard onNavigate={navigate} t={t} />}
          {page === "my-requests" && <MyRequests language={language} />}
          {page === "admin" && isAdmin && <AdminHome language={language} onNavigate={navigate} />}
          {page === "corrections" && isAdmin && <AdminRequests language={language} />}
          {page === "imports" && isAdmin && <Imports language={language} />}
          {page === "due" && <Due t={t} />}
          {page === "batches" && <Batches t={t} />}
          {page === "fish" && <Fish t={t} />}
          {page === "master" && <Master t={t} />}
          {page === "timing" && <Timing t={t} />}
          {page === "promotions" && <Promotions t={t} />}
          {page === "controls" && <Controls t={t} />}
          {page === "audit" && <Audit t={t} />}
          {page === "export" && <Export t={t} />}
          {page === "members" && isAdmin && <Members language={language} />}
        </fieldset>
        <footer className="workspace-footer">
          <span>{productName}</span>
          <span>
            {language === "th"
              ? "ธนาคารเซลล์สัตว์ มหาวิทยาลัยเกษตรศาสตร์"
              : "Kasetsart University Veterinary Animal Cell Bank"}
          </span>
        </footer>
      </main>
    </div>
  );
}

function App() {
  const [user, setUser] = useState<AuthUser | null>(() => (hasPendingLogout() ? null : cachedUser()));
  const [authState, setAuthState] = useState<"checking" | "signed-in" | "signed-out">(() =>
    hasPendingLogout() ? "signed-out" : cachedUser() ? "signed-in" : navigator.onLine ? "checking" : "signed-out",
  );

  useEffect(() => {
    let mounted = true;
    const checkSession = async () => {
      if (hasPendingLogout()) {
        try {
          await finishPendingLogout();
        } catch {
          // Keep the marker so reconnects retry revoking the old cookie.
        }
        if (mounted) {
          forgetUser();
          setUser(null);
          setAuthState("signed-out");
        }
        return;
      }
      if (!navigator.onLine) {
        const localUser = cachedUser();
        if (mounted) {
          setUser(localUser);
          setAuthState(localUser ? "signed-in" : "signed-out");
        }
        return;
      }
      const localUser = cachedUser();
      try {
        const verified = await verifySession();
        if (mounted) {
          setUser(verified);
          setAuthState("signed-in");
        }
      } catch (cause) {
        const status = (cause as Error & { status?: number }).status;
        const stillValidOffline = status === 401 ? null : localUser;
        if (status === 401) forgetUser();
        if (mounted) {
          setUser(stillValidOffline);
          setAuthState(stillValidOffline ? "signed-in" : "signed-out");
        }
      }
    };
    const expireSession = () => {
      forgetUser();
      setUser(null);
      setAuthState("signed-out");
    };
    const refreshAccount = () =>
      void verifySession()
        .then((verified) => {
          if (mounted) {
            setUser(verified);
            setAuthState("signed-in");
          }
        })
        .catch((cause) => {
          if ((cause as Error & { status?: number }).status === 401) expireSession();
        });
    const online = () => void checkSession();
    const offline = () => {
      const localUser = cachedUser();
      setUser(localUser);
      setAuthState(localUser ? "signed-in" : "signed-out");
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    window.addEventListener("chronofish:auth-expired", expireSession);
    window.addEventListener("chronofish:auth-refresh", refreshAccount);
    void checkSession();
    return () => {
      mounted = false;
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      window.removeEventListener("chronofish:auth-expired", expireSession);
      window.removeEventListener("chronofish:auth-refresh", refreshAccount);
    };
  }, []);

  const logout = async () => {
    try {
      await request("/auth/logout", { method: "POST" });
      clearLogoutPending();
    } catch {
      markLogoutPending();
    }
    forgetUser();
    setUser(null);
    setAuthState("signed-out");
  };

  if (authState === "checking") {
    return (
      <main className="auth-shell auth-shell--loading">
        <p role="status">Checking your sign-in…</p>
      </main>
    );
  }
  if (!user)
    return (
      <Login
        onLogin={(nextUser) => {
          setUser(nextUser);
          setAuthState("signed-in");
        }}
      />
    );
  if (
    (window.location.pathname === "/admin" || window.location.pathname.startsWith("/admin/")) &&
    user.role !== "admin"
  )
    return (
      <main className="auth-shell">
        <h1>Admin access required</h1>
        <p>บัญชีนี้ไม่มีสิทธิ์เข้าหน้า Admin</p>
        <a className="button button--primary" href="/">
          กลับเว็บหลัก
        </a>
      </main>
    );
  return <Workspace key={user.id} user={user} onLogout={() => void logout()} />;
}

export default App;
