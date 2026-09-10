import type { ApiItem } from "./api/client";

export type ObservationWorkspaceDraft = {
  version: 1;
  due: ApiItem;
  entry: ApiItem | null;
  selectedId: string;
  stageCodes: Record<string, string>;
  outcomes: Record<string, string>;
  conditions: Record<string, string>;
  notes: Record<string, string>;
  savedIds: Record<string, string>;
  confirmedAt: string;
  savedAt?: string;
};
const prefix = "chronofish.observation-draft.v1";
const key = (operator: string, lot: string) => `${prefix}:${operator}:${lot}`;

export function readObservationDraft(operator: string, lot: string): ObservationWorkspaceDraft | null {
  const raw = localStorage.getItem(key(operator, lot));
  if (!raw) return null;
  const value = JSON.parse(raw);
  if (
    value?.version !== 1 ||
    value.due?.injectionLotId !== lot ||
    typeof value.due?.stageCode !== "string" ||
    typeof value.selectedId !== "string" ||
    typeof value.confirmedAt !== "string" ||
    (value.savedAt != null && typeof value.savedAt !== "string")
  )
    throw new Error("Invalid observation draft");
  for (const field of ["stageCodes", "outcomes", "conditions", "notes", "savedIds"]) {
    const map = value[field];
    if (
      !map ||
      typeof map !== "object" ||
      Array.isArray(map) ||
      Object.values(map).some((item) => typeof item !== "string")
    )
      throw new Error("Invalid observation draft fields");
  }
  if (
    value.entry !== null &&
    (!value.entry ||
      !Array.isArray(value.entry.embryos) ||
      value.entry.embryos.some((item: unknown) => !item || typeof item !== "object"))
  )
    throw new Error("Invalid cached checkpoint");
  return value;
}

export function saveObservationDraft(operator: string, draft: ObservationWorkspaceDraft): void {
  if (!operator) return;
  localStorage.setItem(key(operator, String(draft.due.injectionLotId)), JSON.stringify(draft));
}

export function readObservationLocation(operator: string): ApiItem | null {
  if (!operator) return null;
  try {
    const value = JSON.parse(localStorage.getItem(`${prefix}:location:${operator}`) ?? "null");
    return value && typeof value.injectionLotId === "string" && typeof value.stageCode === "string" ? value : null;
  } catch {
    return null;
  }
}

export function saveObservationLocation(operator: string, due: ApiItem | null): void {
  if (!operator) return;
  if (due) localStorage.setItem(`${prefix}:location:${operator}`, JSON.stringify(due));
  else localStorage.removeItem(`${prefix}:location:${operator}`);
}
