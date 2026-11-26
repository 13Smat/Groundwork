import { formatGsd, leafLabel, sourceLabel } from "./imagery";
import type { ImageryCapture } from "./types";

export function ImageryNotice({
  capture,
  extraWarnings = [],
}: {
  capture: ImageryCapture;
  extraWarnings?: readonly string[];
}) {
  const warnings = [...capture.warnings];
  for (const warning of extraWarnings) {
    if (!warnings.includes(warning)) {
      warnings.push(warning);
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <dl className="grid gap-2 sm:grid-cols-2">
        <div>
          <dt className="text-sm font-semibold">Source</dt>
          <dd>{sourceLabel(capture)}</dd>
        </div>
        <div>
          <dt className="text-sm font-semibold">Capture date</dt>
          <dd>{capture.captureDate}</dd>
        </div>
        <div>
          <dt className="text-sm font-semibold">GSD</dt>
          <dd>{formatGsd(capture.gsdCm)}</dd>
        </div>
        <div>
          <dt className="text-sm font-semibold">Leaf</dt>
          <dd>{leafLabel(capture.leaf)}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-sm font-semibold">Attribution</dt>
          <dd>{capture.attribution ?? "Attribution not recorded"}</dd>
        </div>
      </dl>
      {warnings.length > 0 ? (
        <div role="status" aria-label="Imagery warnings" className="flex flex-col gap-1">
          {warnings.map((warning) => (
            <p key={warning} className="text-base text-accent">
              {warning}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
