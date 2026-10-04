// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import {
  clearObservationDraft,
  type ObservationWorkspaceDraft,
  readObservationDraft,
  saveObservationDraft,
} from "../src/observation-draft";

const draft = (lot: string, savedAt = new Date().toISOString()): ObservationWorkspaceDraft => ({
  version: 1,
  due: { injectionLotId: lot, stageCode: "stage_02_2C" },
  entry: null,
  selectedId: "",
  stageCodes: {},
  outcomes: {},
  conditions: {},
  notes: {},
  savedIds: {},
  confirmedAt: "",
  savedAt,
});

afterEach(() => localStorage.clear());

describe("observation draft retention", () => {
  it("reads a current draft and removes one after it reaches the 30-day TTL", () => {
    saveObservationDraft("operator-1", draft("lot-current"));
    expect(readObservationDraft("operator-1", "lot-current")?.due.injectionLotId).toBe("lot-current");

    const oldKey = "chronofish.observation-draft.v1:operator-1:lot-old";
    localStorage.setItem(oldKey, JSON.stringify(draft("lot-old", "2020-01-01T00:00:00Z")));
    expect(readObservationDraft("operator-1", "lot-old")).toBeNull();
    expect(localStorage.getItem(oldKey)).toBeNull();
  });

  it("prunes expired lots when saving another draft and can clear a completed lot", () => {
    const oldKey = "chronofish.observation-draft.v1:operator-1:lot-old";
    localStorage.setItem(oldKey, JSON.stringify(draft("lot-old", "2020-01-01T00:00:00Z")));
    saveObservationDraft("operator-1", draft("lot-current"));
    expect(localStorage.getItem(oldKey)).toBeNull();

    clearObservationDraft("operator-1", "lot-current");
    expect(readObservationDraft("operator-1", "lot-current")).toBeNull();
  });
});
