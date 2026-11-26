import { Button } from "@groundwork/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { dollarsToCents } from "../crm/format";
import { message } from "../crm/messages";
import { useWorkspace } from "../crm/workspace";
import { activeWorkspace, api, loadMe } from "../session";
import { LineTable, ManualLineForm } from "./line-table";
import { QuantitySyncDialog, statusLabel, TotalsPanel, VersionsDrawer } from "./panels";
import type { Estimate, EstimateSummary } from "./types";

export function EstimateEditorPage({ jobId, estimateId }: { jobId: string; estimateId: string }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { currency } = useWorkspace();
  const profile = useQuery({ queryKey: ["me"], queryFn: loadMe });
  const permissions = profile.data ? (activeWorkspace(profile.data)?.permissions ?? []) : [];
  const canWrite = permissions.includes("estimate.*");
  const showCost = permissions.includes("catalog.manage");
  const estimate = useQuery({
    queryKey: ["estimate", estimateId],
    queryFn: () => api<Estimate>(`/estimates/${estimateId}`),
  });
  const versions = useQuery({
    queryKey: ["job-estimates", jobId],
    queryFn: () => api<{ estimates: EstimateSummary[] }>(`/jobs/${jobId}/estimates`),
  });
  const [error, setError] = useState("");
  const [syncOpen, setSyncOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function refresh(next?: Estimate) {
    if (next) {
      client.setQueryData(["estimate", next.id], next);
    }
    await client.invalidateQueries({ queryKey: ["estimate", estimateId] });
    await client.invalidateQueries({ queryKey: ["job-estimates", jobId] });
    await client.invalidateQueries({ queryKey: ["quantity-diff", estimateId] });
  }

  async function run(action: () => Promise<void>): Promise<boolean> {
    setError("");
    setPending(true);
    try {
      await action();
      return true;
    } catch (err) {
      setError(message(err, "Could not update the estimate."));
      return false;
    } finally {
      setPending(false);
    }
  }

  if (estimate.isLoading) {
    return <p>Loading estimate.</p>;
  }
  if (estimate.isError || !estimate.data) {
    return (
      <p role="alert" className="text-accent">
        {message(estimate.error, "That estimate was not found.")}
      </p>
    );
  }

  const row = estimate.data;
  const draft = row.status === "draft";
  const editable = canWrite && draft;
  const flagged = row.lines.some((line) => line.flagged);

  return (
    <div className="flex flex-col gap-6">
      <p>
        <Link to="/jobs/$jobId" params={{ jobId }} className="font-semibold underline">
          Back to job
        </Link>
      </p>
      <header className="flex flex-col gap-3">
        <h2 className="text-2xl font-semibold">
          {row.number} <span className="text-lg font-normal">version {row.version}</span>
        </h2>
        <p>
          Status <strong>{statusLabel(row.status)}</strong>
        </p>
        {flagged ? (
          <p role="alert" className="text-accent">
            A flagged line has no price. Ready stays blocked until it is priced.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-accent">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          {editable ? (
            <Button
              type="button"
              disabled={pending}
              onClick={() =>
                void run(async () => {
                  const next = await api<Estimate>(`/estimates/${row.id}/transition`, {
                    method: "POST",
                    body: JSON.stringify({ to: "ready" }),
                  });
                  await refresh(next);
                })
              }
            >
              Mark ready
            </Button>
          ) : null}
          {canWrite && draft ? (
            <Button type="button" variant="secondary" onClick={() => setSyncOpen(true)}>
              Sync quantities
            </Button>
          ) : null}
          {canWrite && !draft ? <p>Clone a version before syncing quantities.</p> : null}
          <Button type="button" variant="secondary" onClick={() => setVersionsOpen(true)}>
            Versions
          </Button>
          {row.status === "ready" || row.status === "sent" ? (
            <Button asChild variant="secondary">
              <Link
                to="/jobs/$jobId/estimates/$estimateId/proposal"
                params={{ jobId, estimateId: row.id }}
              >
                Build proposal
              </Link>
            </Button>
          ) : null}
        </div>
      </header>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex flex-col gap-6">
          {row.lines.length === 0 ? (
            <p>No lines yet. Add a manual line or sync a takeoff.</p>
          ) : null}
          <LineTable
            lines={row.lines}
            currency={currency}
            showCost={showCost}
            editable={editable}
            onOverride={(line, variables) =>
              run(async () => {
                const next = await api<Estimate>(`/line-items/${line.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({ variables }),
                });
                await refresh(next);
              })
            }
            onOptional={(line, optional) =>
              run(async () => {
                const next = await api<Estimate>(`/line-items/${line.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({ optional }),
                });
                await refresh(next);
              })
            }
          />
          {editable ? (
            <ManualLineForm
              showCost={showCost}
              onCreate={async (input) => {
                const price =
                  input.unitPrice.trim() === "" ? undefined : dollarsToCents(input.unitPrice);
                const cost =
                  input.unitCost.trim() === "" ? undefined : dollarsToCents(input.unitCost);
                const next = await api<Estimate>(`/estimates/${row.id}/lines`, {
                  method: "POST",
                  body: JSON.stringify({
                    description: input.description.trim(),
                    qty: input.qty.trim(),
                    unit: input.unit.trim(),
                    ...(input.group.trim() ? { group: input.group.trim() } : {}),
                    ...(price !== undefined && price !== null ? { unit_price_cents: price } : {}),
                    ...(cost !== undefined && cost !== null ? { unit_cost_cents: cost } : {}),
                    optional: input.optional,
                  }),
                });
                await refresh(next);
              }}
            />
          ) : null}
        </div>
        <TotalsPanel
          estimate={row}
          currency={currency}
          showCost={showCost}
          editable={editable}
          onRates={async (input) => {
            const next = await api<Estimate>(`/estimates/${row.id}`, {
              method: "PATCH",
              body: JSON.stringify({
                markup_pct: input.markup.trim(),
                overhead_pct: input.overhead.trim(),
                tax_rate: input.tax.trim(),
              }),
            });
            await refresh(next);
          }}
        />
      </div>
      <QuantitySyncDialog
        estimateId={row.id}
        open={syncOpen}
        onOpenChange={setSyncOpen}
        onApply={async (ids) => {
          const next = await api<Estimate>(`/estimates/${row.id}/apply-quantities`, {
            method: "POST",
            body: JSON.stringify({ takeoff_item_ids: ids }),
          });
          await refresh(next);
        }}
      />
      <VersionsDrawer
        jobId={jobId}
        estimate={row}
        versions={versions.data?.estimates ?? []}
        open={versionsOpen}
        canWrite={canWrite}
        onOpenChange={setVersionsOpen}
        onClone={async () => {
          const next = await api<Estimate>(`/estimates/${row.id}/versions`, {
            method: "POST",
            body: JSON.stringify({}),
          });
          client.setQueryData(["estimate", next.id], next);
          await client.invalidateQueries({ queryKey: ["job-estimates", jobId] });
          setVersionsOpen(false);
          await navigate({
            to: "/jobs/$jobId/estimates/$estimateId",
            params: { jobId, estimateId: next.id },
          });
        }}
      />
    </div>
  );
}
