import type { ReactNode } from "react";
import { text } from "./types";

// Sentinel codes thrown by the API client are not user-facing copy. Mapping
// them here covers every page at once, and <html lang> already carries the
// language so no caller has to pass it down.
const errorCopy: Record<string, keyof typeof text.th> = { OPERATOR_REQUIRED: "operatorRequired" };

export function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function ReportPanel({
  title,
  children,
  loading = false,
  loadingMessage,
  empty = false,
  emptyMessage = "No data",
  quality,
  emphasis = false,
}: {
  title: string;
  children: ReactNode;
  loading?: boolean;
  loadingMessage?: string;
  empty?: boolean;
  emptyMessage?: string;
  quality?: ReactNode;
  emphasis?: boolean;
}) {
  const localizedLoading = loadingMessage ?? (/[฀-๿]/.test(title) ? "กำลังโหลดข้อมูลวิเคราะห์…" : "Loading analytics…");
  return (
    <section className={emphasis ? "report-panel report-panel--featured" : "report-panel"} aria-busy={loading}>
      <h2>{title}</h2>
      {loading ? (
        <p className="table-note" role="status">
          {localizedLoading}
        </p>
      ) : empty ? (
        <>
          <p className="table-note">{emptyMessage}</p>
          {quality}
        </>
      ) : (
        <>
          {children}
          {quality}
        </>
      )}
    </section>
  );
}

export function ReportTable({
  headers,
  rows,
  caption,
  emptyMessage = "No data",
  collapsed = false,
  summary = "View supporting data",
}: {
  headers: string[];
  rows: (string | number)[][];
  caption?: string;
  emptyMessage?: string;
  collapsed?: boolean;
  summary?: string;
}) {
  const localizedEmpty =
    emptyMessage === "No data" && headers.some((header) => /[฀-๿]/.test(header)) ? "ไม่มีข้อมูล" : emptyMessage;
  const table = (
    <div className="table-wrap" role="region" tabIndex={0} aria-label={caption ?? summary}>
      <table>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header} scope="col">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={headers.length}>{localizedEmpty}</td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr key={index}>
                {row.map((value, cell) => (
                  <td key={cell}>{String(value)}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
  return collapsed ? (
    <details className="data-disclosure">
      <summary>{summary}</summary>
      {table}
    </details>
  ) : (
    table
  );
}

export function Empty({
  message,
  actionLabel,
  onAction,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="empty">
      <span aria-hidden="true">
        <svg
          className="icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <path d="M4 7h16v12H4zM8 7V4h8v3M9 12h6" />
        </svg>
      </span>
      <p>{message}</p>
      {actionLabel && onAction && (
        <button type="button" className="button button--secondary" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}

export function ErrorMessage({ message }: { message: string }) {
  const key = errorCopy[message];
  const copy = key ? text[document.documentElement.lang === "en" ? "en" : "th"][key] : message;
  return (
    <p className="error" role="alert" tabIndex={-1} autoFocus>
      {copy}
    </p>
  );
}

const iconPaths: Record<string, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    </>
  ),
  due: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  batches: (
    <>
      <path d="M4 7h16v13H4z" />
      <path d="M8 7V4h8v3M8 12h8M8 16h5" />
    </>
  ),
  fish: (
    <>
      <path d="M4 12c3-5 9-6 14-2l3-3v10l-3-3c-5 4-11 3-14-2Z" />
      <circle cx="15.5" cy="11" r=".7" />
    </>
  ),
  master: (
    <>
      <path d="M4 5h16v14H4zM8 9h8M8 13h8M8 17h5" />
    </>
  ),
  timing: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4h4M9 2h6" />
    </>
  ),
  promotions: (
    <>
      <path d="M12 21V9M7 14c-3 0-4-2-4-5 3 0 5 1 6 4M17 10c3 0 4-2 4-5-3 0-5 1-6 4" />
    </>
  ),
  controls: (
    <>
      <path d="M4 6h16M4 12h16M4 18h16" />
      <circle cx="9" cy="6" r="2" />
      <circle cx="15" cy="12" r="2" />
      <circle cx="7" cy="18" r="2" />
    </>
  ),
  audit: (
    <>
      <path d="M6 3h12v18H6zM9 8h6M9 12h6M9 16h4" />
      <path d="m4 5 2 2" />
    </>
  ),
  export: (
    <>
      <path d="M12 3v12M7 10l5 5 5-5M5 19h14" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
};

export function Icon({ name, className = "icon" }: { name: string; className?: string }) {
  return (
    <svg
      className={className}
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {iconPaths[name]}
    </svg>
  );
}
