import { Button } from "@groundwork/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";

import { formatCents } from "../crm/format";
import { message } from "../crm/messages";
import { useWorkspace } from "../crm/workspace";
import { activeWorkspace, api, loadMe } from "../session";
import { statusLabel } from "./panels";
import type { Estimate, EstimateSummary, TakeoffChoice } from "./types";

export function JobEstimates({ jobId }: { jobId: string }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const { workspaceId, currency } = useWorkspace();
  const profile = useQuery({ queryKey: ["me"], queryFn: loadMe });
  const canWrite = profile.data
    ? (activeWorkspace(profile.data)?.permissions.includes("estimate.*") ?? false)
    : false;
  const estimates = useQuery({
    queryKey: ["job-estimates", jobId],
    queryFn: () => api<{ estimates: EstimateSummary[] }>(`/jobs/${jobId}/estimates`),
    enabled: Boolean(workspaceId),
  });
  const takeoffs = useQuery({
    queryKey: ["job-takeoffs", jobId],
    queryFn: () => api<{ takeoffs: TakeoffChoice[] }>(`/jobs/${jobId}/takeoffs`),
    enabled: Boolean(workspaceId),
  });
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const takeoffId = String(new FormData(event.currentTarget).get("takeoff") ?? "");
    if (!takeoffId) {
      setError("Choose a takeoff.");
      return;
    }
    setError("");
    setPending(true);
    try {
      const created = await api<Estimate>(`/jobs/${jobId}/estimates`, {
        method: "POST",
        body: JSON.stringify({ from_takeoff_id: takeoffId }),
      });
      client.setQueryData(["estimate", created.id], created);
      await client.invalidateQueries({ queryKey: ["job-estimates", jobId] });
      await navigate({
        to: "/jobs/$jobId/estimates/$estimateId",
        params: { jobId, estimateId: created.id },
      });
    } catch (err) {
      setError(message(err, "Could not create the estimate."));
      setPending(false);
    }
  }

  if (!workspaceId || estimates.isLoading) {
    return <p>Loading estimates.</p>;
  }

  const rows = estimates.data?.estimates ?? [];

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <h3 className="text-xl font-semibold">Estimates</h3>
      <p className="max-w-prose text-base leading-relaxed">
        An estimate prices the latest takeoff. Quantity changes stay on the takeoff until you sync
        them.
      </p>
      {estimates.isError ? (
        <p role="alert" className="text-accent">
          {message(estimates.error, "Could not load estimates.")}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-accent">
          {error}
        </p>
      ) : null}
      {canWrite ? (
        <form className="flex flex-col gap-3" onSubmit={(event) => void onCreate(event)}>
          <div className="flex flex-col gap-1">
            <label htmlFor="estimate-takeoff" className="text-sm font-semibold">
              Takeoff
            </label>
            <select
              id="estimate-takeoff"
              name="takeoff"
              className="min-h-11 rounded-md border border-line bg-paper px-3 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              defaultValue=""
            >
              <option value="">Choose a takeoff</option>
              {(takeoffs.data?.takeoffs ?? []).map((takeoff) => (
                <option key={takeoff.id} value={takeoff.id}>
                  Version {takeoff.version}, {takeoff.status}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" disabled={pending || takeoffs.isLoading}>
            {pending ? "Creating estimate" : "Create estimate"}
          </Button>
        </form>
      ) : null}
      {rows.length === 0 ? <p>No estimates yet.</p> : null}
      {rows.length > 0 ? (
        <ul className="flex flex-col gap-2" aria-label="Estimates for this job">
          {rows.map((estimate) => (
            <li key={estimate.id}>
              <Link
                to="/jobs/$jobId/estimates/$estimateId"
                params={{ jobId, estimateId: estimate.id }}
                className="font-semibold underline"
              >
                {estimate.number} version {estimate.version}, {statusLabel(estimate.status)},{" "}
                {formatCents(estimate.total_cents, currency)}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
