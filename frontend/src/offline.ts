import { deviceId, mutationHeaders, operatorId, request } from "./api/client";
import { cachedUser } from "./auth";
import { uuidv7 } from "./uuidv7";

export type QueueStatus = "pending" | "rejected" | "auth-required";
export type QueuedWrite = {
  path: string;
  method: string;
  body: unknown;
  contentType: string;
  key: string;
  operatorId: string;
  deviceId: string;
  actorUserId?: string;
  actorEmail?: string;
  createdAt: number;
  attempt: number;
  nextAttempt: number;
  status: QueueStatus;
  identity?: string;
  lastError?: string;
};
export type QueuedWriteRecord = { id: IDBValidKey; value: QueuedWrite };

const databaseName = "chronofish";
const databaseVersion = 3;
const storeName = "writes";

export type JitterSource = () => number;

export function retryDelay(attempt: number, random: JitterSource = () => 0.5): number {
  const base = Math.min(15 * 60_000, 1_000 * 2 ** Math.min(Math.max(attempt, 0), 10));
  const jitter = Math.max(0, Math.min(1, random())) * 0.2 - 0.1;
  return Math.round(Math.min(15 * 60_000, Math.max(250, base * (1 + jitter))));
}

export function nextAttemptAt(attempt: number, now = Date.now(), random: JitterSource = () => 0.5): number {
  return now + retryDelay(attempt, random);
}

export function queuedHeaders(
  item: Pick<QueuedWrite, "operatorId" | "deviceId" | "key" | "contentType" | "actorUserId">,
): Record<string, string> {
  return {
    "Content-Type": item.contentType || "application/json",
    "X-Operator-Id": item.operatorId,
    "X-Device-Id": item.deviceId,
    "X-Idempotency-Key": item.key,
    "X-Actor-User-Id": item.actorUserId ?? "",
  };
}

function withoutClientUuid(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutClientUuid);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "clientUuid")
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, withoutClientUuid(entry)]),
  );
}

export function writeIdentity(
  path: string,
  method: string,
  body: unknown,
  operator = "",
  device = "",
  actor = "",
): string {
  return `${actor}\0${operator}\0${device}\0${method.toUpperCase()} ${path} ${JSON.stringify(withoutClientUuid(body))}`;
}

function openQueue(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(databaseName, databaseVersion);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(storeName))
        open.result.createObjectStore(storeName, { autoIncrement: true });
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => resolve(open.result);
  });
}

function records(db: IDBDatabase): Promise<{ key: IDBValidKey; value: QueuedWrite }[]> {
  // ponytail: scan the small lab queue; add an IndexedDB index if backlog volume warrants it.
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName);
    const store = tx.objectStore(storeName);
    const values = store.getAll();
    const keys = store.getAllKeys();
    tx.oncomplete = () =>
      resolve((values.result as QueuedWrite[]).map((value, index) => ({ key: keys.result[index], value })));
    tx.onerror = () => reject(tx.error);
  });
}

async function updateQueued(db: IDBDatabase, key: IDBValidKey, value: QueuedWrite): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function persistQueuedWrite(item: QueuedWrite): Promise<QueuedWrite> {
  const db = await openQueue();
  try {
    const existing = (await records(db)).find(
      ({ value }) =>
        (value.status === "pending" || value.status === "auth-required") &&
        (value.identity ??
          writeIdentity(value.path, value.method, value.body, value.operatorId, value.deviceId, value.actorUserId)) ===
          item.identity,
    );
    if (existing) return existing.value;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).add(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    window.dispatchEvent(new CustomEvent("chronofish:queue-enqueued", { detail: item }));
    return item;
  } finally {
    db.close();
  }
}

const activeWrites = new Map<string, Promise<QueuedWrite>>();

export function queueWrite(item: QueuedWrite): Promise<QueuedWrite> {
  const stored = {
    ...item,
    identity:
      item.identity ??
      writeIdentity(item.path, item.method, item.body, item.operatorId, item.deviceId, item.actorUserId),
  };
  const existing = activeWrites.get(stored.identity);
  if (existing) return existing;
  const pending = persistQueuedWrite(stored).finally(() => activeWrites.delete(stored.identity!));
  activeWrites.set(stored.identity, pending);
  return pending;
}

export async function queueCount(): Promise<number> {
  const userId = cachedUser()?.id;
  return countQueueForActor(userId);
}

export async function queueCountForOtherAccounts(actorUserId: string): Promise<number> {
  return countUnownedOrForeign(actorUserId, false);
}

export async function unassignedQueueCount(): Promise<number> {
  return countUnownedOrForeign("", true);
}

async function countUnownedOrForeign(actorUserId: string, unassignedOnly: boolean): Promise<number> {
  if (!window.indexedDB) return 0;
  let db: IDBDatabase | undefined;
  try {
    db = await openQueue();
    return (await records(db)).filter(({ value }) => {
      const unresolved = value.status === "pending" || value.status === "auth-required" || value.status === "rejected";
      if (!unresolved) return false;
      if (unassignedOnly) return !value.actorUserId;
      return Boolean(value.actorUserId && value.actorUserId !== actorUserId);
    }).length;
  } catch {
    return 0;
  } finally {
    db?.close();
  }
}

export async function countQueueForActor(actorUserId?: string): Promise<number> {
  if (!window.indexedDB) return 0;
  let db: IDBDatabase | undefined;
  try {
    db = await openQueue();
    return (await records(db)).filter(
      ({ value }) =>
        (value.status === "pending" || value.status === "auth-required") &&
        (actorUserId === undefined || value.actorUserId === actorUserId),
    ).length;
  } catch {
    return 0;
  } finally {
    db?.close();
  }
}

export async function rejectedQueueCount(): Promise<number> {
  return countByStatus("rejected");
}

export async function rejectedQueueItems(actorUserId?: string): Promise<QueuedWriteRecord[]> {
  return (await queuedWriteItems()).filter(
    ({ value }) => value.status === "rejected" && (actorUserId === undefined || value.actorUserId === actorUserId),
  );
}

export async function queuedWriteItems(): Promise<QueuedWriteRecord[]> {
  if (!("indexedDB" in window)) return [];
  let db: IDBDatabase | undefined;
  try {
    db = await openQueue();
    return (await records(db)).map(({ key, value }) => ({ id: key, value }));
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

export async function discardRejected(id: IDBValidKey): Promise<void> {
  if (!("indexedDB" in window)) return;
  const db = await openQueue();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      const current = store.get(id);
      current.onsuccess = () => {
        if ((current.result as QueuedWrite | undefined)?.status === "rejected") store.delete(id);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    window.dispatchEvent(new CustomEvent("chronofish:queue-discarded"));
  } finally {
    db.close();
  }
}

async function countByStatus(status: QueueStatus): Promise<number> {
  if (!("indexedDB" in window)) return 0;
  let db: IDBDatabase | undefined;
  try {
    db = await openQueue();
    return (await records(db)).filter(({ value }) => value.status === status).length;
  } catch {
    return 0;
  } finally {
    db?.close();
  }
}

export async function putQueue(
  path: string,
  body: unknown,
  contentType = "application/json",
  method = "POST",
): Promise<ApiQueueResult> {
  const key = uuidv7();
  const actor = cachedUser();
  if (!actor) throw new Error("AUTHENTICATION_REQUIRED");
  const headers = mutationHeaders(key);
  const item: QueuedWrite = {
    path,
    method,
    body,
    contentType,
    key,
    operatorId: headers["X-Operator-Id"],
    deviceId: headers["X-Device-Id"],
    actorUserId: actor.id,
    actorEmail: actor.email,
    createdAt: Date.now(),
    attempt: 0,
    nextAttempt: Date.now(),
    status: "pending",
    identity: writeIdentity(path, method, body, headers["X-Operator-Id"], headers["X-Device-Id"], actor.id),
  };
  // Durable intent is written before any network attempt. A tab close between
  // fetch() and IndexedDB used to lose the mutation (and its idempotency key).
  if (!("indexedDB" in window)) {
    const serialized = contentType === "application/json" ? JSON.stringify(body) : String(body);
    return responseValue(
      await request(path, { method, body: serialized, headers: { ...headers, "Content-Type": contentType } }),
    );
  }
  const stored = await queueWrite(item);
  if (!navigator.onLine) return { queued: true, key: stored.key };
  // Return the optimistic queued state immediately. The durable record is the
  // source of truth; replay runs independently so a slow network never blocks
  // a lab form or loses the original headers/key.
  void drainQueue(true);
  return { queued: true, key: stored.key };
}

export type ApiQueueResult = { queued?: boolean; key?: string; [key: string]: unknown };

export async function retryRejected(actorUserId = cachedUser()?.id): Promise<void> {
  if (!("indexedDB" in window)) return;
  const db = await openQueue();
  for (const record of await records(db)) {
    if (record.value.status === "rejected" && record.value.actorUserId === actorUserId)
      await updateQueued(db, record.key, {
        ...record.value,
        status: "pending",
        nextAttempt: Date.now(),
        lastError: undefined,
      });
  }
  db.close();
  window.dispatchEvent(new CustomEvent("chronofish:queue-enqueued"));
  await drainQueue(true);
}

let activeDrain: Promise<void> | undefined;

async function drainQueueInternal(force: boolean): Promise<void> {
  if (!navigator.onLine || !("indexedDB" in window)) return;
  const actorUserId = cachedUser()?.id;
  if (!actorUserId) return;
  try {
    const db = await openQueue();
    try {
      for (const record of await records(db)) {
        const item = record.value;
        if (
          (item.status !== "pending" && item.status !== "auth-required") ||
          item.actorUserId !== actorUserId ||
          (!force && item.nextAttempt > Date.now())
        )
          continue;
        try {
          await transmit(db, record);
        } catch (error) {
          // transmit() persists rejected/next-attempt state before returning.
          void error;
        }
      }
    } finally {
      db.close();
    }
  } catch {
    // IndexedDB may be unavailable or full; the next online tick retries.
  }
}

export function drainQueue(force = false): Promise<void> {
  if (!navigator.onLine || !("indexedDB" in window)) return Promise.resolve();
  if (activeDrain) return activeDrain;
  window.dispatchEvent(new CustomEvent("chronofish:queue-syncing"));
  activeDrain = drainQueueInternal(force).finally(() => {
    activeDrain = undefined;
    window.dispatchEvent(new CustomEvent("chronofish:queue-sync-idle"));
  });
  return activeDrain;
}

async function transmit(db: IDBDatabase, record: { key: IDBValidKey; value: QueuedWrite }): Promise<ApiQueueResult> {
  const item = record.value;
  const contentType = item.contentType || "application/json";
  const body = contentType === "application/json" ? JSON.stringify(item.body) : String(item.body);
  const headers = queuedHeaders({
    ...item,
    operatorId: item.operatorId || operatorId(),
    deviceId: item.deviceId || deviceId(),
    contentType,
  });
  try {
    const response = await request(item.path, { method: item.method || "POST", body, headers });
    const result = await responseValue(response);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).delete(record.key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    window.dispatchEvent(new CustomEvent("chronofish:queue-drained", { detail: { ...item, result } }));
    return result;
  } catch (error) {
    const status = (error as Error & { status?: number }).status;
    if (status === 401) {
      await updateQueued(db, record.key, {
        ...item,
        status: "auth-required",
        lastError: "Sign in again to sync this work",
      });
      window.dispatchEvent(new CustomEvent("chronofish:queue-auth-required", { detail: item }));
      return { queued: true, key: item.key };
    }
    if (status && status >= 400 && status < 500 && status !== 429) {
      await updateQueued(db, record.key, { ...item, status: "rejected", lastError: (error as Error).message });
      window.dispatchEvent(
        new CustomEvent("chronofish:queue-rejected", { detail: { ...item, lastError: (error as Error).message } }),
      );
      throw error;
    }
    const attempt = item.attempt + 1;
    await updateQueued(db, record.key, {
      ...item,
      attempt,
      nextAttempt: nextAttemptAt(attempt, Date.now(), Math.random),
    });
    return { queued: true, key: item.key };
  }
}

async function responseValue(response: Response): Promise<ApiQueueResult> {
  if (response.status === 204) return {};
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.includes("json")) return {};
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as ApiQueueResult;
  } catch {
    return {};
  }
}

export function startQueueSync(refresh: () => void, actorUserId?: string): () => void {
  let lastSyncReport = 0;
  const reportSync = () => {
    const current = cachedUser();
    if (!current || (actorUserId && current.id !== actorUserId) || !navigator.onLine) return;
    if (Date.now() - lastSyncReport < 30_000) return;
    lastSyncReport = Date.now();
    void countQueueForActor(current.id).then((pendingCount) =>
      request("/auth/devices/sync-status", {
        method: "POST",
        headers: { "X-Device-Id": deviceId(), "X-Actor-User-Id": current.id },
        body: JSON.stringify({ pendingCount }),
      }).catch(() => undefined),
    );
  };
  const tick = () => void drainQueue().then(refresh).then(reportSync);
  const timer = window.setInterval(tick, 5_000);
  const reportTimer = window.setInterval(reportSync, 30_000);
  window.addEventListener("online", tick);
  reportSync();
  return () => {
    window.clearInterval(timer);
    window.clearInterval(reportTimer);
    window.removeEventListener("online", tick);
  };
}
