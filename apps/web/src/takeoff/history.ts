import type { EditorFeature } from "./types";
import { geometryKey } from "./quantities";

/** Vertex drags closer than this become one undo step. */
export const COALESCE_MS = 600;

export type Snapshot = {
  at: number;
  before: EditorFeature[];
  after: EditorFeature[];
};

export type History = {
  past: Snapshot[];
  future: Snapshot[];
};

export function emptyHistory(): History {
  return { past: [], future: [] };
}

function cloneFeature(feature: EditorFeature): EditorFeature {
  return {
    ...feature,
    geometry: structuredClone(feature.geometry),
  };
}

function signature(features: readonly EditorFeature[]): string {
  return features
    .map((feature) => `${feature.id}|${feature.itemId}|${geometryKey(feature.geometry)}`)
    .sort()
    .join("\n");
}

function singleGeometryId(command: Snapshot): string | null {
  if (command.before.length !== command.after.length) {
    return null;
  }
  const before = new Map(command.before.map((feature) => [feature.id, feature]));
  let changed: string | null = null;
  for (const next of command.after) {
    const previous = before.get(next.id);
    if (!previous || previous.itemId !== next.itemId) {
      return null;
    }
    if (geometryKey(previous.geometry) !== geometryKey(next.geometry)) {
      if (changed) {
        return null;
      }
      changed = next.id;
    }
  }
  return changed;
}

export function snapshotCommand(
  before: readonly EditorFeature[],
  after: readonly EditorFeature[],
  now: number,
): Snapshot | null {
  if (signature(before) === signature(after)) {
    return null;
  }
  return {
    at: now,
    before: before.map(cloneFeature),
    after: after.map(cloneFeature),
  };
}

export function pushHistory(history: History, command: Snapshot): History {
  const last = history.past[history.past.length - 1];
  const id = singleGeometryId(command);
  if (
    last &&
    id &&
    singleGeometryId(last) === id &&
    command.at - last.at < COALESCE_MS &&
    signature(last.after) === signature(command.before)
  ) {
    return {
      past: [...history.past.slice(0, -1), { ...last, after: command.after, at: command.at }],
      future: [],
    };
  }
  return { past: [...history.past, command], future: [] };
}

export function undoHistory(
  history: History,
): { history: History; features: EditorFeature[] } | null {
  const command = history.past[history.past.length - 1];
  if (!command) {
    return null;
  }
  return {
    history: { past: history.past.slice(0, -1), future: [...history.future, command] },
    features: command.before.map(cloneFeature),
  };
}

export function redoHistory(
  history: History,
): { history: History; features: EditorFeature[] } | null {
  const command = history.future[history.future.length - 1];
  if (!command) {
    return null;
  }
  return {
    history: { past: [...history.past, command], future: history.future.slice(0, -1) },
    features: command.after.map(cloneFeature),
  };
}
