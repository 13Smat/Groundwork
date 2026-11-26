import { Button } from "@groundwork/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { api } from "../session";
import { message } from "./messages";
import { PipelineBoard, type BoardJob } from "./pipeline-board";
import type { Job, StageSummary } from "./types";
import { useWorkspace } from "./workspace";

export function PipelinePage() {
  const { workspaceId, currency, ready } = useWorkspace();
  const client = useQueryClient();
  const summary = useQuery({
    queryKey: ["pipeline", workspaceId],
    queryFn: () => api<{ stages: StageSummary[] }>("/pipeline/summary"),
    enabled: Boolean(workspaceId),
  });
  const jobs = useQuery({
    queryKey: ["jobs", workspaceId, "board"],
    queryFn: () => api<{ jobs: Job[] }>("/jobs?limit=200"),
    enabled: Boolean(workspaceId),
  });

  async function onMove(job: BoardJob, to: string, reason?: string) {
    await api(`/jobs/${job.id}/transition`, {
      method: "POST",
      body: JSON.stringify({ to, ...(reason ? { reason } : {}) }),
    });
    await client.invalidateQueries({ queryKey: ["jobs", workspaceId] });
    await client.invalidateQueries({ queryKey: ["pipeline", workspaceId] });
    await client.invalidateQueries({ queryKey: ["job", job.id] });
  }

  if (!ready || summary.isLoading || jobs.isLoading) {
    return <p>Loading pipeline.</p>;
  }
  if (summary.isError || jobs.isError) {
    return (
      <p role="alert" className="text-base text-accent">
        {message(summary.error ?? jobs.error, "Could not load the pipeline.")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button asChild>
          <Link to="/jobs/new">New job</Link>
        </Button>
      </div>
      <PipelineBoard
        jobs={jobs.data?.jobs ?? []}
        summary={summary.data?.stages ?? []}
        currency={currency}
        renderJob={(job) => (
          <Link to="/jobs/$jobId" params={{ jobId: job.id }} className="underline">
            {job.name}
          </Link>
        )}
        onMove={onMove}
      />
    </div>
  );
}
