import type { ApiItem } from "./api/client";

export const plateShapes: Record<number, readonly [number, number]> = {
  6: [2, 3],
  12: [3, 4],
  24: [4, 6],
  48: [6, 8],
  96: [8, 12],
};
export const allWells = Array.from(
  { length: 96 },
  (_, index) => `${String.fromCharCode(65 + Math.floor(index / 12))}${(index % 12) + 1}`,
);

export function plateWells(size = 96): string[] {
  const [rows, columns] = plateShapes[size] ?? plateShapes[96];
  return allWells.filter((well) => well.charCodeAt(0) - 65 < rows && Number(well.slice(1)) <= columns);
}

export function embryoCode(batch: ApiItem, lotNo: string, sequence: number): string {
  return `${String(batch.batchCode)}_${lotNo}_${sequence}_${String(batch.experimentDate)}`;
}
