import { useState, type FormEvent } from "react";

import { Button } from "@groundwork/ui";

import type { ImportPlan } from "./types";

const CSV_HEADER = "sku,kind,name,unit,unit_cost_cents,unit_price_cents,waste_pct,vendor,tax_code";

export function ImportPanel({
  onPreview,
  onApply,
}: {
  onPreview: (csv: string) => Promise<ImportPlan>;
  onApply: (csv: string) => Promise<void>;
}) {
  const [csv, setCsv] = useState("");
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const canApply =
    plan !== null &&
    plan.errors.length === 0 &&
    (plan.created.length > 0 || plan.updated.length > 0) &&
    !busy;

  async function preview(event: FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      setPlan(await onPreview(csv));
    } catch (err) {
      setPlan(null);
      setError(err instanceof Error ? err.message : "Could not preview the import.");
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    setError("");
    setBusy(true);
    try {
      await onApply(csv);
      setCsv("");
      setPlan(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply the import.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={preview} className="flex flex-col gap-4">
      <label htmlFor="catalog-csv" className="text-sm font-semibold">
        Catalog CSV
      </label>
      <textarea
        id="catalog-csv"
        className="min-h-32 w-full rounded-md border border-line bg-paper px-3 py-2 font-mono text-base text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        value={csv}
        spellCheck={false}
        onChange={(event) => {
          setCsv(event.target.value);
          setPlan(null);
        }}
      />
      <div className="flex flex-wrap gap-3">
        <label className="inline-flex min-h-11 cursor-pointer items-center rounded-md bg-paper px-4 text-base font-semibold text-ink ring-1 ring-line">
          CSV file
          <input
            className="sr-only"
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) {
                return;
              }
              void file.text().then((text) => {
                setCsv(text);
                setPlan(null);
              });
            }}
          />
        </label>
        <Button type="button" variant="secondary" onClick={() => setCsv(`${CSV_HEADER}\n`)}>
          Insert header
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-base text-accent">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={busy || csv.trim() === ""}>
          Preview import
        </Button>
        <Button type="button" variant="secondary" disabled={!canApply} onClick={() => void apply()}>
          Apply import
        </Button>
      </div>
      {plan ? <ImportDiff plan={plan} /> : null}
    </form>
  );
}

function ImportDiff({ plan }: { plan: ImportPlan }) {
  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      <h3 className="text-lg font-semibold">Will add</h3>
      {plan.created.length === 0 ? (
        <p>No new SKUs.</p>
      ) : (
        <ul className="list-disc pl-5">
          {plan.created.map((row) => (
            <li key={row.sku}>
              {row.name} ({row.sku})
            </li>
          ))}
        </ul>
      )}
      <h3 className="text-lg font-semibold">Will update</h3>
      {plan.updated.length === 0 ? (
        <p>No SKU updates.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {plan.updated.map((row) => (
            <li key={row.sku}>
              <p className="font-semibold">{row.sku}</p>
              <ul className="list-disc pl-5">
                {row.changes.map((change) => (
                  <li key={change.field}>
                    {change.field} from {change.from ?? "blank"} to {change.to ?? "blank"}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      <p>Unchanged: {plan.unchanged.length}</p>
      {plan.errors.length > 0 ? (
        <ul>
          {plan.errors.map((row) => (
            <li key={`${row.row}-${row.message}`} role="alert">
              Row {row.row}: {row.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
