import { useState, type FormEvent } from "react";

import { Button, TextField } from "@groundwork/ui";

export type ImagerySourceRow = {
  id: string;
  provider: string;
  name: string;
  bands: string;
  allowsTracing: boolean;
  allowsMlTraining: boolean;
  verifiedAt: string | null;
  licenseText: string | null;
  attribution: string | null;
  coverage: { west: number; south: number; east: number; north: number } | null;
};

export type IngestJobView = {
  jobId: string;
  status: "ingesting" | "ready" | "failed";
  error: string | null;
  captureDate: string | null;
  gsdCm: number | null;
  leaf: string | null;
  cogKey: string | null;
};

export type LicenseSave = {
  sourceId: string;
  allowsTracing: boolean;
  allowsMlTraining: boolean;
  verifiedAt: string | null;
  licenseText: string | null;
  attribution: string | null;
};

export type IngestRequest = {
  sourceId: string;
  year: number;
  countyFips?: string;
  aoi?: {
    type: "Polygon";
    coordinates: number[][][];
  };
};

const fieldClass =
  "min-h-11 w-full rounded-md border border-line bg-paper px-3 text-base text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

export function ImageryAdmin({
  sources,
  job,
  error,
  busy,
  onIngest,
  onSaveLicense,
  onCreateSource,
}: {
  sources: ImagerySourceRow[];
  job: IngestJobView | null;
  error: string | null;
  busy: boolean;
  onIngest: (input: IngestRequest) => void;
  onSaveLicense: (input: LicenseSave) => void;
  onCreateSource: (input: { provider: string; name: string; bands: string }) => void;
}) {
  return (
    <div className="flex flex-col gap-8">
      <p className="max-w-prose text-base leading-relaxed">
        Internal registry for measurement imagery. A source is served only after it is verified and
        tracing is allowed. Owner and admin can edit licenses and start a county or AOI ingest.
      </p>
      {error ? (
        <p role="alert" className="rounded-md border border-line bg-paper px-3 py-3 text-base">
          {error}
        </p>
      ) : null}
      <SourceTable sources={sources} />
      <LicenseForm sources={sources} busy={busy} onSave={onSaveLicense} />
      <IngestForm sources={sources} busy={busy} onIngest={onIngest} />
      <IngestStatus job={job} />
      <CreateSourceForm busy={busy} onCreate={onCreateSource} />
    </div>
  );
}

function SourceTable({ sources }: { sources: ImagerySourceRow[] }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold">Sources</h2>
      {sources.length === 0 ? (
        <p>No imagery sources are registered.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-base">
            <caption className="sr-only">Imagery sources and license flags</caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="py-2 pr-3 font-semibold">
                  Name
                </th>
                <th scope="col" className="py-2 pr-3 font-semibold">
                  Provider
                </th>
                <th scope="col" className="py-2 pr-3 font-semibold">
                  Tracing
                </th>
                <th scope="col" className="py-2 pr-3 font-semibold">
                  ML training
                </th>
                <th scope="col" className="py-2 pr-3 font-semibold">
                  Verified
                </th>
                <th scope="col" className="py-2 font-semibold">
                  Coverage
                </th>
              </tr>
            </thead>
            <tbody>
              {sources.map((source) => (
                <tr key={source.id} className="border-b border-line">
                  <th scope="row" className="py-3 pr-3 font-semibold">
                    {source.name}
                  </th>
                  <td className="py-3 pr-3">{source.provider}</td>
                  <td className="py-3 pr-3">{source.allowsTracing ? "Allowed" : "Blocked"}</td>
                  <td className="py-3 pr-3">{source.allowsMlTraining ? "Allowed" : "Blocked"}</td>
                  <td className="py-3 pr-3">{source.verifiedAt ? "Verified" : "Unverified"}</td>
                  <td className="py-3">{coverageText(source.coverage)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function LicenseForm({
  sources,
  busy,
  onSave,
}: {
  sources: ImagerySourceRow[];
  busy: boolean;
  onSave: (input: LicenseSave) => void;
}) {
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const source = sources.find((item) => item.id === sourceId) ?? sources[0];
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold">License</h2>
      {source ? (
        <form
          key={source.id}
          className="flex max-w-xl flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const verified = String(data.get("verifiedAt") ?? "").trim();
            onSave({
              sourceId: source.id,
              allowsTracing: data.get("allowsTracing") === "on",
              allowsMlTraining: data.get("allowsMlTraining") === "on",
              verifiedAt: verified === "" ? null : verified,
              licenseText: emptyToNull(data.get("licenseText")),
              attribution: emptyToNull(data.get("attribution")),
            });
          }}
        >
          <label className="flex flex-col gap-1 text-sm font-semibold" htmlFor="license-source">
            Source
            <select
              id="license-source"
              className={fieldClass}
              value={source.id}
              onChange={(event) => setSourceId(event.target.value)}
            >
              {sources.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-h-11 items-center gap-3 text-base font-semibold">
            <input
              className="size-5"
              type="checkbox"
              name="allowsTracing"
              defaultChecked={source.allowsTracing}
            />
            Allow tracing
          </label>
          <label className="flex min-h-11 items-center gap-3 text-base font-semibold">
            <input
              className="size-5"
              type="checkbox"
              name="allowsMlTraining"
              defaultChecked={source.allowsMlTraining}
            />
            Allow ML training
          </label>
          <TextField
            id="verified-at"
            name="verifiedAt"
            label="Verified at"
            defaultValue={source.verifiedAt ?? ""}
            autoComplete="off"
          />
          <LabeledArea
            id="license-text"
            name="licenseText"
            label="License text"
            defaultValue={source.licenseText ?? ""}
          />
          <TextField
            id="attribution"
            name="attribution"
            label="Attribution"
            defaultValue={source.attribution ?? ""}
          />
          <Button type="submit" disabled={busy}>
            Save license
          </Button>
        </form>
      ) : (
        <p>Add a source before editing a license.</p>
      )}
    </section>
  );
}

function IngestForm({
  sources,
  busy,
  onIngest,
}: {
  sources: ImagerySourceRow[];
  busy: boolean;
  onIngest: (input: IngestRequest) => void;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold">Ingest</h2>
      <p id="ingest-scope" className="max-w-prose text-base leading-relaxed">
        One county FIPS code or one AOI bounding box. A whole state is refused.
      </p>
      {formError ? (
        <p role="alert" className="text-base">
          {formError}
        </p>
      ) : null}
      <form
        className="flex max-w-xl flex-col gap-4"
        onSubmit={(event) => submitIngest(event, setFormError, onIngest)}
      >
        <label className="flex flex-col gap-1 text-sm font-semibold" htmlFor="ingest-source">
          Source
          <select id="ingest-source" name="sourceId" className={fieldClass} required>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
          </select>
        </label>
        <TextField
          id="ingest-year"
          name="year"
          label="Year"
          type="number"
          required
          defaultValue="2026"
        />
        <TextField
          id="county-fips"
          name="countyFips"
          label="County FIPS"
          inputMode="numeric"
          autoComplete="off"
          aria-describedby="ingest-scope"
        />
        <TextField
          id="aoi-bbox"
          name="aoi"
          label="AOI bounding box"
          autoComplete="off"
          aria-describedby="ingest-scope"
        />
        <Button type="submit" disabled={busy || sources.length === 0}>
          Start ingest
        </Button>
      </form>
    </section>
  );
}

function IngestStatus({ job }: { job: IngestJobView | null }) {
  return (
    <section
      aria-labelledby="ingest-status-heading"
      aria-live="polite"
      aria-atomic="true"
      className="flex flex-col gap-2"
    >
      <h2 id="ingest-status-heading" className="text-xl font-semibold">
        Ingest status
      </h2>
      {job ? (
        <dl className="grid grid-cols-[10rem_minmax(0,1fr)] gap-y-2 text-base">
          <dt className="font-semibold">Status</dt>
          <dd>{job.status}</dd>
          <dt className="font-semibold">Job</dt>
          <dd>{job.jobId}</dd>
          {job.error ? (
            <>
              <dt className="font-semibold">Error</dt>
              <dd>{job.error}</dd>
            </>
          ) : null}
          {job.status === "ready" ? (
            <>
              <dt className="font-semibold">Capture date</dt>
              <dd>{job.captureDate}</dd>
              <dt className="font-semibold">GSD</dt>
              <dd>{job.gsdCm} cm</dd>
              <dt className="font-semibold">Leaf</dt>
              <dd>{job.leaf}</dd>
            </>
          ) : null}
        </dl>
      ) : (
        <p>No ingest job yet.</p>
      )}
    </section>
  );
}

function CreateSourceForm({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: (input: { provider: string; name: string; bands: string }) => void;
}) {
  return (
    <details className="max-w-xl">
      <summary className="min-h-11 cursor-pointer py-2 text-base font-semibold">
        Add a source
      </summary>
      <form
        className="mt-3 flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          onCreate({
            provider: String(data.get("provider") ?? ""),
            name: String(data.get("name") ?? ""),
            bands: String(data.get("bands") ?? ""),
          });
        }}
      >
        <label className="flex flex-col gap-1 text-sm font-semibold" htmlFor="new-provider">
          Provider
          <select id="new-provider" name="provider" className={fieldClass} defaultValue="nc_ortho">
            <option value="nc_ortho">nc_ortho</option>
            <option value="nc_helene_2025">nc_helene_2025</option>
            <option value="naip">naip</option>
            <option value="county">county</option>
            <option value="other">other</option>
          </select>
        </label>
        <TextField id="new-name" name="name" label="Name" required />
        <TextField id="new-bands" name="bands" label="Bands" required defaultValue="RGBIR" />
        <Button type="submit" disabled={busy}>
          Create source
        </Button>
      </form>
    </details>
  );
}

function LabeledArea({
  id,
  name,
  label,
  defaultValue,
}: {
  id: string;
  name: string;
  label: string;
  defaultValue: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm font-semibold" htmlFor={id}>
      {label}
      <textarea id={id} name={name} className={fieldClass} rows={3} defaultValue={defaultValue} />
    </label>
  );
}

function submitIngest(
  event: FormEvent<HTMLFormElement>,
  setFormError: (message: string | null) => void,
  onIngest: (input: IngestRequest) => void,
): void {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const county = String(data.get("countyFips") ?? "").trim();
  const aoiText = String(data.get("aoi") ?? "").trim();
  if ((county === "") === (aoiText === "")) {
    setFormError("Enter a county FIPS code or an AOI, not both.");
    return;
  }
  if (county.endsWith("000")) {
    setFormError("A state FIPS code is not a county.");
    return;
  }
  let aoi: IngestRequest["aoi"];
  if (aoiText !== "") {
    try {
      aoi = bboxPolygon(aoiText);
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "AOI must be west, south, east, north.",
      );
      return;
    }
  }
  setFormError(null);
  const request: IngestRequest = {
    sourceId: String(data.get("sourceId") ?? ""),
    year: Number(data.get("year")),
  };
  if (county !== "") {
    request.countyFips = county;
  }
  if (aoi) {
    request.aoi = aoi;
  }
  onIngest(request);
}

function bboxPolygon(value: string): IngestRequest["aoi"] {
  const parts = value.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    throw new Error("AOI must be west, south, east, north.");
  }
  const west = parts[0]!;
  const south = parts[1]!;
  const east = parts[2]!;
  const north = parts[3]!;
  if (west >= east || south >= north) {
    throw new Error("AOI must have west < east and south < north.");
  }
  return {
    type: "Polygon",
    coordinates: [
      [
        [west, south],
        [west, north],
        [east, north],
        [east, south],
        [west, south],
      ],
    ],
  };
}

function coverageText(
  coverage: { west: number; south: number; east: number; north: number } | null,
): string {
  if (!coverage) {
    return "No coverage";
  }
  return `${coverage.west.toFixed(2)}, ${coverage.south.toFixed(2)} to ${coverage.east.toFixed(2)}, ${coverage.north.toFixed(2)}`;
}

function emptyToNull(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? "").trim();
  return text === "" ? null : text;
}
