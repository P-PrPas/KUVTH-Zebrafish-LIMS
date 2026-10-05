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

export function mutationHeaders(key = uuidv7()): Record<string, string> {
  let actorUserId = "";
  try {
    actorUserId = JSON.parse(localStorage.getItem("chronofish.auth_user") ?? "null")?.id ?? "";
  } catch {
    actorUserId = "";
  }
  return {
    "X-Operator-Id": requireOperator(),
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

export async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const authRequest = path.startsWith("/auth/");
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(init.body ? { "Content-Type": "application/json" } : {}),
    ...(method !== "GET" && method !== "HEAD" && !authRequest
      ? path.startsWith("/corrections")
        ? accountMutationHeaders()
        : mutationHeaders()
      : {}),
    ...((init.headers as Record<string, string> | undefined) ?? {}),
  };
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
