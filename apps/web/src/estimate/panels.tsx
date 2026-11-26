import { Button, Dialog, DialogClose, DialogContent, TextField } from "@groundwork/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";

import { formatCents } from "../crm/format";
import { message } from "../crm/messages";
import { api } from "../session";
import type { Estimate, EstimateSummary, QuantityDiff } from "./types";

const STATUS_LABEL: Record<Estimate["status"], string> = {
  draft: "Draft",
  ready: "Ready",
  sent: "Sent",
  accepted: "Accepted",
  superseded: "Superseded",
};

export function statusLabel(status: Estimate["status"]): string {
  return STATUS_LABEL[status];
}

export function TotalsPanel({
  estimate,
  currency,
  showCost,
  editable,
  onRates,
}: {
  estimate: Estimate;
  currency: string;
  showCost: boolean;
  editable: boolean;
  onRates: (input: { markup: string; overhead: string; tax: string }) => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setError("");
    setPending(true);
    try {
      await onRates({
        markup: String(data.get("markup") ?? ""),
        overhead: String(data.get("overhead") ?? ""),
        tax: String(data.get("tax") ?? ""),
      });
    } catch (err) {
      setError(message(err, "Could not update rates."));
    } finally {
      setPending(false);
    }
  }

  return (
    <aside
      aria-label="Totals and margin"
      className="flex flex-col gap-3 rounded-md p-4 ring-1 ring-line"
    >
      <h3 className="text-lg font-semibold">Totals and margin</h3>
      <dl className="grid grid-cols-2 gap-2">
        <dt>Subtotal</dt>
        <dd>{formatCents(estimate.subtotal_cents, currency)}</dd>
        <dt>Tax</dt>
        <dd>{formatCents(estimate.tax_cents, currency)}</dd>
        <dt>Total</dt>
        <dd aria-live="polite">{formatCents(estimate.total_cents, currency)}</dd>
        <dt>Optional</dt>
        <dd>{formatCents(estimate.optional_total_cents, currency)}</dd>
        {showCost ? (
          <>
            <dt>Cost</dt>
            <dd>
              {estimate.cost_cents === undefined ? "" : formatCents(estimate.cost_cents, currency)}
            </dd>
            <dt>Margin</dt>
            <dd>
              {estimate.margin_cents === undefined
                ? ""
                : `${formatCents(estimate.margin_cents, currency)}${estimate.margin_pct ? ` (${estimate.margin_pct}%)` : ""}`}
            </dd>
          </>
        ) : null}
      </dl>
      {editable ? (
        <form className="flex flex-col gap-3" onSubmit={(event) => void onSubmit(event)}>
          <TextField
            id="estimate-markup"
            name="markup"
            label="Markup percent"
            defaultValue={estimate.markup_pct}
            key={`markup-${estimate.markup_pct}`}
            inputMode="decimal"
          />
          <TextField
            id="estimate-overhead"
            name="overhead"
            label="Overhead percent"
            defaultValue={estimate.overhead_pct}
            key={`overhead-${estimate.overhead_pct}`}
            inputMode="decimal"
          />
          <TextField
            id="estimate-tax"
            name="tax"
            label="Tax rate (fraction)"
            defaultValue={estimate.tax_rate}
            key={`tax-${estimate.tax_rate}`}
            inputMode="decimal"
          />
          {error ? (
            <p role="alert" className="text-accent">
              {error}
            </p>
          ) : null}
          <Button type="submit" variant="secondary" disabled={pending}>
            {pending ? "Updating rates" : "Update rates"}
          </Button>
        </form>
      ) : null}
    </aside>
  );
}

export function QuantitySyncDialog({
  estimateId,
  open,
  onOpenChange,
  onApply,
}: {
  estimateId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (ids: string[]) => Promise<void>;
}) {
  const diff = useQuery({
    queryKey: ["quantity-diff", estimateId, open],
    queryFn: () => api<QuantityDiff>(`/estimates/${estimateId}/quantity-diff`),
    enabled: open,
  });
  const [picked, setPicked] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const items = diff.data?.items ?? [];
  const selected = picked ?? items.map((item) => item.takeoff_item_id);

  async function apply() {
    setError("");
    setPending(true);
    try {
      await onApply(selected);
      onOpenChange(false);
      setPicked(null);
    } catch (err) {
      setError(message(err, "Could not apply quantities."));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Quantity sync"
        description="Added, removed, and changed takeoff items. Applying updates only the lines you accept."
      >
        {diff.isLoading ? <p>Comparing takeoff quantities.</p> : null}
        {diff.isError ? (
          <p role="alert" className="text-accent">
            {message(diff.error, "Could not compare quantities.")}
          </p>
        ) : null}
        {diff.data ? (
          <p>Compared with takeoff version {diff.data.compared_takeoff_version ?? "none"}.</p>
        ) : null}
        {diff.data && items.length === 0 ? <p>Takeoff quantities match this estimate.</p> : null}
        {items.length > 0 ? (
          <ul className="flex flex-col gap-3" aria-label="Quantity changes">
            {items.map((item) => {
              const checked = selected.includes(item.takeoff_item_id);
              return (
                <li key={item.takeoff_item_id}>
                  <label className="flex min-h-11 items-start gap-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => {
                        setPicked(
                          event.target.checked
                            ? [...selected, item.takeoff_item_id]
                            : selected.filter((id) => id !== item.takeoff_item_id),
                        );
                      }}
                    />
                    <span>
                      <span className="font-semibold">
                        {item.change === "added"
                          ? "Added"
                          : item.change === "removed"
                            ? "Removed"
                            : "Changed"}{" "}
                        {item.name}
                      </span>
                      <span className="block">
                        {item.old_qty ?? "none"} to {item.new_qty ?? "none"} {item.unit}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        ) : null}
        {error ? (
          <p role="alert" className="text-accent">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-3">
          <Button
            type="button"
            disabled={pending || selected.length === 0}
            onClick={() => void apply()}
          >
            {pending ? "Applying quantities" : "Apply selected quantities"}
          </Button>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              Close
            </Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function VersionsDrawer({
  jobId,
  estimate,
  versions,
  open,
  canWrite,
  onOpenChange,
  onClone,
}: {
  jobId: string;
  estimate: Estimate;
  versions: readonly EstimateSummary[];
  open: boolean;
  canWrite: boolean;
  onOpenChange: (open: boolean) => void;
  onClone: () => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const family = versions.filter((row) => row.number === estimate.number);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Versions"
        description="A new version is a draft copy. Ready and sent versions are marked superseded."
        placement="end"
      >
        {canWrite ? (
          <Button
            type="button"
            disabled={pending}
            onClick={() => {
              setError("");
              setPending(true);
              void onClone()
                .catch((err: unknown) => {
                  setError(message(err, "Could not create a version."));
                })
                .finally(() => setPending(false));
            }}
          >
            {pending ? "Creating version" : "New version"}
          </Button>
        ) : null}
        {error ? (
          <p role="alert" className="mt-3 text-accent">
            {error}
          </p>
        ) : null}
        <ul className="mt-4 flex flex-col gap-3" aria-label="Estimate versions">
          {family.map((row) => (
            <li key={row.id}>
              <Link
                to="/jobs/$jobId/estimates/$estimateId"
                params={{ jobId, estimateId: row.id }}
                className="font-semibold underline"
                aria-current={row.id === estimate.id ? "page" : undefined}
                onClick={() => onOpenChange(false)}
              >
                {row.number} version {row.version}, {statusLabel(row.status)}
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-4">
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              Close
            </Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
