import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { formatCents } from "../crm/format";
import { message } from "../crm/messages";
import { useWorkspace } from "../crm/workspace";
import { api } from "../session";
import type { ProposalSummary } from "./types";

export function JobProposals({ jobId }: { jobId: string }) {
  const { currency } = useWorkspace();
  const proposals = useQuery({
    queryKey: ["job-proposals", jobId],
    queryFn: () => api<{ proposals: ProposalSummary[] }>(`/jobs/${jobId}/proposals`),
  });
  if (proposals.isLoading) {
    return <p>Loading proposals.</p>;
  }
  if (proposals.isError) {
    return (
      <p role="alert" className="text-accent">
        {message(proposals.error, "Could not load proposals.")}
      </p>
    );
  }
  const rows = proposals.data?.proposals ?? [];
  return (
    <div className="flex flex-col gap-4">
      <p>
        <Link to="/jobs/$jobId" params={{ jobId }} className="font-semibold underline">
          Back to job
        </Link>
      </p>
      <h2 className="text-2xl font-semibold">Proposals</h2>
      {rows.length === 0 ? <p>No proposals yet. Open a ready estimate and build one.</p> : null}
      <ul className="flex flex-col gap-3">
        {rows.map((item) => (
          <li key={item.id}>
            <Link
              to="/proposals/$proposalId"
              params={{ proposalId: item.id }}
              className="font-semibold underline"
            >
              {item.number}
            </Link>{" "}
            <span>
              {item.status} {formatCents(item.total_cents, currency)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
