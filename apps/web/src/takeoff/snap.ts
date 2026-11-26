export type SnapHost = {
  updateModeOptions: (mode: string, options: Record<string, unknown>) => void;
};

function snapping(enabled: boolean): Record<string, unknown> {
  if (!enabled) {
    return { toCoordinate: false, toLine: false };
  }
  return {
    toCoordinate: true,
    toLine: true,
    toFeature: {
      filter: () => true,
      toLine: true,
      toCoordinate: true,
    },
  };
}

function coordinateFlags(enabled: boolean): Record<string, unknown> {
  return {
    midpoints: true,
    draggable: true,
    deletable: true,
    snappable: enabled ? snapping(true) : false,
  };
}

function selectFlags(enabled: boolean): Record<string, unknown> {
  return {
    polygon: { feature: { draggable: true, coordinates: coordinateFlags(enabled) } },
    linestring: { feature: { draggable: true, coordinates: coordinateFlags(enabled) } },
    point: { feature: { draggable: true } },
  };
}

/** Snap new vertices, and vertex edits, to existing vertices and edges. */
export function applySnap(draw: SnapHost, enabled: boolean): void {
  const next = snapping(enabled);
  for (const mode of ["polygon", "linestring", "point", "ruler"]) {
    draw.updateModeOptions(mode, { snapping: next });
  }
  draw.updateModeOptions("select", { flags: selectFlags(enabled) });
}
