import { uuidv7 } from "../uuidv7";
import type { components } from "./schema";

export type ApiRecord = Partial<
  components["schemas"]["Site"] &
    components["schemas"]["Operator"] &
    components["schemas"]["Batch"] &
    components["schemas"]["DueCheckpoint"] &
    components["schemas"]["CloneFish"] &
    components["schemas"]["PromotionCandidate"] &
    components["schemas"]["ControlArmCount"] & {
      id: string;
      batchId: string;
      fishCode: string;
      operatorId: string;
      clientUuid: string;
      stageCode: string;
      stageLabel: string;
      stageOrder: number;
      expectedHpa: number;
      code: string;
      label: string;
      defaultCondition: string;
      minutesLate: number;
      condition: string;
      observedOn: string;
      outcome: string;
      stage1: { nActivated?: number; nPromoted?: number; nBatches?: number };
      stage2: { nAlive?: number };
      status: string;
      queued: boolean;
      nNormal: number;
      nAbnormal: number;
      fishId: string;
      alreadyRecorded: boolean;
      recordId: string;
      tableName: string;
      action: string;
      occurredAt: string;
      operatorName: string;
      error: string;
      pendingPromotionCount: number;
      riskSet: number;
      alive: number;
      nPrev: number;
      nDead: number;
      surv: number;
      pctOfDevelopment: number;
      pctOfActivated: number;
      n: number;
      meanDeviationH: number;
      medianDeviationH: number;
      sdDeviationH: number;
      minDeviationH: number;
      maxDeviationH: number;
      date: string;
      count: number;
      dead: number;
      batchCode: string;
      lotNo: string;
      lastObservedOn: string;
      missedDays: number;
    }
> & { [key: string]: unknown };

export interface ApiItem extends ApiRecord {
  items?: ApiItem[];
  overdue?: ApiItem[];
  upcoming?: ApiItem[];
  embryos?: ApiItem[];
  injectionLots?: ApiItem[];
  entries?: ApiItem[];
  results?: ApiItem[];
}

export const apiBase = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";
export function deviceId(): string {
  const key = "chronofish.device_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = uuidv7();
    localStorage.setItem(key, id);
  }
  return id;
}

export function operatorId(): string {
  try {
    const user = JSON.parse(localStorage.getItem("chronofish.auth_user") ?? "null") as {
      role?: string;
      operatorId?: string | null;
    } | null;
    if (user?.role === "member") return user.operatorId ?? "";
  } catch {
    return "";
  }
  const current = sessionStorage.getItem("chronofish.operator_id");
  if (current) return current;
  // Migrate the pre-session setting once; mutations thereafter remain scoped
  // to this browser session rather than permanently selecting a demo user.
  const legacy = localStorage.getItem("chronofish.operator_id");
  if (legacy) {
    sessionStorage.setItem("chronofish.operator_id", legacy);
    localStorage.removeItem("chronofish.operator_id");
    return legacy;
  }
  return "";
}

export function requireOperator(): string {
  const id = operatorId();
  if (!id) throw new Error("OPERATOR_REQUIRED");
  return id;
}

export function mutationHeaders(key = uuidv7(), operator = requireOperator()): Record<string, string> {
  let actorUserId = "";
  try {
    actorUserId = JSON.parse(localStorage.getItem("chronofish.auth_user") ?? "null")?.id ?? "";
  } catch {
    actorUserId = "";
  }
  return {
    "X-Operator-Id": operator,
    "X-Device-Id": deviceId(),
    "X-Idempotency-Key": key,
    ...(actorUserId ? { "X-Actor-User-Id": actorUserId } : {}),
  };
}

export function accountMutationHeaders(key = uuidv7()): Record<string, string> {
  let actorUserId = "";
  try {
    actorUserId = JSON.parse(localStorage.getItem("chronofish.auth_user") ?? "null")?.id ?? "";
  } catch {
    actorUserId = "";
  }
  return {
    "X-Device-Id": deviceId(),
    "X-Idempotency-Key": key,
    ...(actorUserId ? { "X-Actor-User-Id": actorUserId } : {}),
  };
}

// Headers each mutating operation sends, keyed by "METHOD /openapi/path". api/openapi.yaml is the source of truth:
// "operator" declares X-Operator-Id, "account" sends device/idempotency/actor headers without an operator, and
// "none" is the /auth surface. tests/api-client.test.ts pins this table to the contract.
export type WriteKind = "operator" | "account" | "none";
export const WRITE_KINDS: Record<string, WriteKind> = {
  "POST /auth/login": "none",
  "POST /auth/register": "none",
  "POST /auth/password/request-code": "none",
  "POST /imports/{jobId}/validate-template": "operator",
  "POST /imports/{jobId}/confirm-template": "operator",
  "POST /imports/inspect": "account",
  "POST /imports": "account",
  "POST /imports/deferred-fields/{fieldId}/apply": "account",
  "POST /imports/{jobId}/issues/bulk-bypass": "account",
  "POST /imports/{jobId}/issues/{issueId}/correct-cell": "account",
  "PATCH /imports/{jobId}/records/{recordId}": "account",
  "POST /imports/{jobId}/issues/{issueId}/decision": "account",
  "POST /imports/{jobId}/confirm": "account",
  "POST /imports/{jobId}/confirm-fish-specimens": "account",
  "POST /imports/{jobId}/confirm-aggregate": "account",
  "POST /imports/{jobId}/confirm-v2-embryos": "account",
  "POST /imports/{jobId}/confirm-all": "account",
  "POST /imports/{jobId}/fish-status/{fishId}": "account",
  "POST /imports/{jobId}/revert": "account",
  "POST /auth/request-code": "none",
  "POST /auth/verify-code": "none",
  "POST /auth/logout": "none",
  "POST /auth/devices/sync-status": "none",
  "DELETE /auth/sessions/{session_id}": "none",
  "POST /auth/admin/users": "none",
  "PATCH /auth/admin/users/{user_id}": "none",
  "POST /auth/admin/users/{user_id}/invite": "none",
  "POST /auth/admin/users/{user_id}/unlock": "none",
  "DELETE /auth/admin/users/{user_id}/sessions/{session_id}": "none",
  "POST /auth/admin/mail-settings/test": "none",
  "PATCH /auth/admin/mail-settings": "none",
  "POST /sites": "operator",
  "PATCH /sites/{id}": "operator",
  "POST /operators": "operator",
  "POST /donor-cell-lines": "operator",
  "POST /recipient-egg-lots": "operator",
  "POST /csof-lots": "operator",
  "POST /experiment-groups": "operator",
  "POST /treatment-groups": "operator",
  "POST /fish-boxes": "operator",
  "PATCH /operators/{id}": "operator",
  "PATCH /donor-cell-lines/{id}": "operator",
  "PATCH /recipient-egg-lots/{id}": "operator",
  "PATCH /csof-lots/{id}": "operator",
  "PATCH /experiment-groups/{id}": "operator",
  "PATCH /treatment-groups/{id}": "operator",
  "PATCH /fish-boxes/{id}": "operator",
  "POST /timing-profiles": "operator",
  "POST /timing-profiles/csv": "operator",
  "POST /batches": "operator",
  "PATCH /batches/{id}": "operator",
  "POST /batches/{id}/duplicate": "operator",
  "POST /batches/{id}/injection-lots": "operator",
  "PATCH /injection-lots/{id}": "operator",
  "POST /injection-lots/{id}/embryos": "operator",
  "PATCH /embryos/{id}": "operator",
  "DELETE /embryos/{id}": "operator",
  "PUT /batches/{id}/control-arm-counts": "operator",
  "POST /observations/embryo": "operator",
  "PATCH /observations/embryo/{id}": "operator",
  "DELETE /observations/embryo/{id}": "operator",
  "POST /observations/fish": "operator",
  "PATCH /observations/fish/{id}": "operator",
  "DELETE /observations/fish/{id}": "operator",
  "POST /promotions": "operator",
  "POST /fish": "operator",
  "PATCH /fish/{id}": "operator",
  "POST /fish/{id}/specimens": "operator",
  "POST /exports/excel": "account",
  "POST /corrections": "account",
  "POST /corrections/{request_id}/withdraw": "account",
  "POST /corrections/{request_id}/decide": "account",
};

const WRITE_ROUTES = Object.entries(WRITE_KINDS).map(([operation, kind]) => {
  const [method, template] = operation.split(" ");
  return { method, kind, pattern: new RegExp(`^${template.replace(/\{[^/]+\}/g, "[^/]+")}$`) };
});

export function writeKind(method: string, path: string): WriteKind {
  const pathname = path.split("?")[0];
  const route = WRITE_ROUTES.find((item) => item.method === method && item.pattern.test(pathname));
  if (!route) throw new Error(`No write kind declared for ${method} ${pathname}`);
  return route.kind;
}

function writeHeaders(kind: WriteKind, operator?: string): Record<string, string> {
  if (kind === "none") return {};
  return kind === "account" ? accountMutationHeaders() : mutationHeaders(undefined, operator);
}

export async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const authRequest = path.startsWith("/auth/");
  const suppliedOperator = new Headers(init.headers).get("X-Operator-Id") || undefined;
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
    ...(method !== "GET" && method !== "HEAD" ? writeHeaders(writeKind(method, path), suppliedOperator) : {}),
  };
  const suppliedHeaders = new Headers(init.headers);
  suppliedHeaders.forEach((value, name) => {
    const existing = Object.keys(headers).find((key) => key.toLowerCase() === name);
    headers[existing ?? name] = value;
  });
  const response = await fetch(`${apiBase}${path}`, { ...init, credentials: "include", headers });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: { message?: string; details?: unknown } };
    const error = new Error(body?.error?.message ?? `HTTP ${response.status}`) as Error & {
      status?: number;
      details?: unknown;
    };
    error.status = response.status;
    error.details = body.error?.details;
    if (response.status === 401 && !authRequest) window.dispatchEvent(new CustomEvent("chronofish:auth-expired"));
    throw error;
  }
  return response;
}

export async function get(path: string): Promise<ApiItem> {
  return (await (await request(path)).json()) as ApiItem;
}
