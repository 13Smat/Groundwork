const CONTROL_LABELS: ReadonlyArray<readonly [string, string]> = [
  [".maplibregl-ctrl-zoom-in", "Zoom in"],
  [".maplibregl-ctrl-zoom-out", "Zoom out"],
  [".maplibregl-ctrl-compass", "Reset bearing"],
  [".maplibregl-ctrl-attrib-button", "Toggle attribution"],
  [".maplibregl-ctrl-fullscreen", "Toggle fullscreen"],
];

/** Name MapLibre controls that would otherwise be unlabeled buttons. */
export function labelMapControls(root: ParentNode): void {
  for (const [selector, label] of CONTROL_LABELS) {
    for (const node of root.querySelectorAll(selector)) {
      if (node instanceof HTMLElement && !node.getAttribute("aria-label")) {
        node.setAttribute("aria-label", label);
      }
    }
  }
  for (const canvas of root.querySelectorAll("canvas")) {
    if (canvas instanceof HTMLCanvasElement && !canvas.getAttribute("aria-label")) {
      canvas.setAttribute("aria-label", "Map");
    }
  }
}
