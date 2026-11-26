import type { GeoJsonGeometry, GeoJsonPolygon } from "@groundwork/geo";
import { describe, expect, it } from "vitest";

import { cutHole } from "./edit-geometry";
import {
  emptyHistory,
  pushHistory,
  redoHistory,
  snapshotCommand,
  undoHistory,
  type Snapshot,
} from "./history";
import type { EditorFeature } from "./types";

function feature(id: string, geometry: GeoJsonGeometry, itemId = "item-a"): EditorFeature {
  return {
    id,
    mode: "polygon",
    itemId,
    kind: "area",
    label: null,
    source: "manual",
    geometry,
    hidden: false,
    server: null,
    measuredKey: null,
  };
}

const SQUARE: GeoJsonGeometry = {
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ],
  ],
};

const NUDGED: GeoJsonGeometry = {
  type: "Polygon",
  coordinates: [
    [
      [0, 0],
      [1.2, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ],
  ],
};

function push(
  history: ReturnType<typeof emptyHistory>,
  before: EditorFeature[],
  after: EditorFeature[],
  at: number,
) {
  const command = snapshotCommand(before, after, at);
  expect(command).not.toBeNull();
  return pushHistory(history, command as Snapshot);
}

describe("takeoff command stack", () => {
  it("undoes and redoes create, vertex edit, delete, and re-tag", () => {
    const created = feature("m-1", SQUARE);
    let history = push(emptyHistory(), [], [created], 0);
    const nudged = feature("m-1", NUDGED);
    history = push(history, [created], [nudged], 1_000);
    const retagged = feature("m-1", NUDGED, "item-b");
    history = push(history, [nudged], [retagged], 2_000);
    history = push(history, [retagged], [], 3_000);

    const undoneDelete = undoHistory(history);
    expect(undoneDelete?.features.map((row) => row.itemId)).toEqual(["item-b"]);
    const undoneTag = undoHistory(undoneDelete!.history);
    expect(undoneTag?.features[0]?.itemId).toBe("item-a");
    expect(undoneTag?.features[0]?.geometry).toEqual(NUDGED);
    const undoneVertex = undoHistory(undoneTag!.history);
    expect(undoneVertex?.features[0]?.geometry).toEqual(SQUARE);
    const undoneCreate = undoHistory(undoneVertex!.history);
    expect(undoneCreate?.features).toEqual([]);
    const redone = redoHistory(undoneCreate!.history);
    expect(redone?.features).toHaveLength(1);
    expect(redone?.features[0]?.geometry).toEqual(SQUARE);
  });

  it("collapses a vertex drag into one step", () => {
    const start = feature("m-1", SQUARE);
    const mid = feature("m-1", NUDGED);
    const end = feature("m-1", {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [1.4, 0],
          [1, 1],
          [0, 1],
          [0, 0],
        ],
      ],
    });
    let history = push(emptyHistory(), [start], [mid], 0);
    history = push(history, [mid], [end], 200);
    expect(history.past).toHaveLength(1);
    expect(undoHistory(history)?.features[0]?.geometry).toEqual(SQUARE);
  });

  it("undoes a hole on an accepted assist polygon and keeps ai_assist", () => {
    const shell: GeoJsonPolygon = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [0.002, 0],
          [0.002, 0.002],
          [0, 0.002],
          [0, 0],
        ],
      ],
    };
    const hole: GeoJsonPolygon = {
      type: "Polygon",
      coordinates: [
        [
          [0.0005, 0.0005],
          [0.001, 0.0005],
          [0.001, 0.001],
          [0.0005, 0.001],
          [0.0005, 0.0005],
        ],
      ],
    };
    const cut = cutHole(shell, hole);
    expect(cut?.coordinates).toHaveLength(2);
    const assist = { ...feature("m-1", shell), source: "ai_assist" as const };
    const holed = { ...assist, geometry: cut ?? shell };
    const history = push(emptyHistory(), [assist], [holed], 0);
    const undone = undoHistory(history);
    expect(undone?.features[0]?.source).toBe("ai_assist");
    expect(undone?.features[0]?.geometry).toEqual(shell);
    const redone = redoHistory(undone!.history);
    expect(redone?.features[0]?.source).toBe("ai_assist");
    expect(redone?.features[0]?.geometry).toEqual(cut);
  });
});
