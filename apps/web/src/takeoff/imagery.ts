import type { ImageryCapture } from "./types";

const RANK: Record<string, number> = {
  nc_helene_2025: 0,
  nc_ortho: 1,
  naip: 2,
};

/** Registry names that are never measurement imagery. The API already omits them. */
export const BLOCKED_IMAGERY_NAMES = [
  "google_satellite",
  "mapbox_satellite",
  "nc_ortho_latest_viewing",
] as const;

const BLOCKED = new Set<string>(BLOCKED_IMAGERY_NAMES);

const SOURCE_LABEL: Record<string, string> = {
  nc_helene_2025: "Helene 2025",
  nc_ortho: "NC Ortho",
  naip: "NAIP",
  fixture_rgbir: "Fixture",
};

const LEAF_LABEL: Record<string, string> = {
  on: "Leaf-on",
  off: "Leaf-off",
  mixed: "Mixed leaf",
  unknown: "Leaf unknown",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const NO_CAPTURE_MESSAGE =
  "No verified imagery that allows tracing covers this site. Measuring stays blocked until a capture is available.";

export const NO_POINT_MESSAGE =
  "This site has no point, so imagery cannot be chosen. Measuring stays blocked.";

export function sourceLabel(capture: Pick<ImageryCapture, "name" | "provider">): string {
  return SOURCE_LABEL[capture.name] ?? SOURCE_LABEL[capture.provider] ?? capture.name;
}

export function leafLabel(leaf: ImageryCapture["leaf"]): string {
  if (leaf === null) {
    return "Leaf not recorded";
  }
  return LEAF_LABEL[leaf] ?? "Leaf not recorded";
}

export function formatGsd(cm: number): string {
  if (!Number.isFinite(cm) || cm <= 0) {
    return "GSD unknown";
  }
  const inches = cm / 2.54;
  const nearest = Math.round(inches);
  const cmText = formatCm(cm);
  if (nearest >= 1 && nearest <= 36 && Math.abs(inches - nearest) < 0.05) {
    return `${nearest} in (${cmText} cm)`;
  }
  return `${cmText} cm`;
}

function formatCm(cm: number): string {
  if (Number.isInteger(cm)) {
    return String(cm);
  }
  return cm.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

/** Helene, then NC ortho newest first, then NAIP, then anything else allowed. */
export function allowedCaptures(captures: readonly ImageryCapture[]): ImageryCapture[] {
  return captures
    .filter((capture) => !BLOCKED.has(capture.name) && !BLOCKED.has(capture.provider))
    .slice()
    .sort((a, b) => {
      const rank = (RANK[a.provider] ?? 3) - (RANK[b.provider] ?? 3);
      if (rank !== 0) {
        return rank;
      }
      if (a.captureDate !== b.captureDate) {
        return a.captureDate < b.captureDate ? 1 : -1;
      }
      if (a.id === b.id) {
        return 0;
      }
      return a.id < b.id ? -1 : 1;
    });
}

export function captureOptionLabel(capture: ImageryCapture): string {
  return `${sourceLabel(capture)} · ${capture.captureDate} · ${formatGsd(capture.gsdCm)} · ${leafLabel(capture.leaf)}`;
}

/**
 * Relative XYZ path on our tile proxy. The browser never receives a Google,
 * Mapbox, or state ImageServer URL.
 */
export function tileTemplate(captureId: string): string {
  if (!UUID.test(captureId)) {
    throw new Error("Imagery tiles need a capture id.");
  }
  const path = `/imagery/tiles/${captureId}/{z}/{x}/{y}`;
  const lowered = path.toLowerCase();
  if (
    lowered.includes("google") ||
    lowered.includes("mapbox") ||
    lowered.includes("nconemap") ||
    lowered.includes("://")
  ) {
    throw new Error("Imagery tiles must stay on the Groundwork proxy.");
  }
  return path;
}
