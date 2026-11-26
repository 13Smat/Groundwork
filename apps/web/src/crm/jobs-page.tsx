import { Button, SelectField, TextField } from "@groundwork/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { api } from "../session";
import { BOARD_STAGES, formatCents, formatWhen, memberName, stageLabel } from "./format";
import { message } from "./messages";
import { SearchBox } from "./search-box";
import type { Job } from "./types";
import { useMembers, useWorkspace } from "./workspace";

export function JobsPage() {
  const { workspaceId, currency, ready } = useWorkspace();
  const members = useMembers(workspaceId);
  const [stage, setStage] = useState("");
  const [owner, setOwner] = useState("");
  const [since, setSince] = useState("");
  const [tag, setTag] = useState("");
  const jobs = useQuery({
    queryKey: ["jobs", workspaceId, "list", stage, owner, since, tag],
    queryFn: () => api<{ jobs: Job[] }>(`/jobs?${queryString({ stage, owner, since, tag })}`),
    enabled: Boolean(workspaceId),
  });
  const rows = jobs.data?.jobs ?? [];
  const people = members.data?.members ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild>
          <Link to="/jobs/new">New job</Link>
        </Button>
        <Link to="/pipeline" className="text-base font-semibold underline">
          Pipeline
        </Link>
      </div>
      <SearchBox workspaceId={workspaceId} />
      <div className="grid gap-4 md:grid-cols-4">
        <SelectField
          id="filter-stage"
          label="Stage"
          value={stage}
          onChange={(event) => setStage(event.target.value)}
        >
          <option value="">Any stage</option>
          {BOARD_STAGES.map((item) => (
            <option key={item} value={item}>
              {stageLabel(item)}
            </option>
          ))}
        </SelectField>
        <SelectField
          id="filter-owner"
          label="Owner"
          value={owner}
          onChange={(event) => setOwner(event.target.value)}
        >
          <option value="">Anyone</option>
          {people
            .filter((member) => member.status === "active")
            .map((member) => (
              <option key={member.id} value={member.id}>
                {member.name || member.email || "Member"}
              </option>
            ))}
        </SelectField>
        <TextField
          id="filter-since"
          label="Updated since"
          type="date"
          value={since}
          onChange={(event) => setSince(event.target.value)}
        />
        <TextField
          id="filter-tag"
          label="Tag"
          value={tag}
          onChange={(event) => setTag(event.target.value)}
        />
      </div>
      {!ready || jobs.isLoading ? <p>Loading jobs.</p> : null}
      {jobs.isError ? (
        <p role="alert" className="text-base text-accent">
          {message(jobs.error, "Could not load jobs.")}
        </p>
      ) : null}
      {jobs.isSuccess && rows.length === 0 ? <p>No jobs match these filters.</p> : null}
      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Jobs</caption>
            <thead>
              <tr>
                <th className="border-b border-line py-2 pr-3">Number</th>
                <th className="border-b border-line py-2 pr-3">Name</th>
                <th className="border-b border-line py-2 pr-3">Stage</th>
                <th className="border-b border-line py-2 pr-3">Client</th>
                <th className="border-b border-line py-2 pr-3">Owner</th>
                <th className="border-b border-line py-2 pr-3">Updated</th>
                <th className="border-b border-line py-2 pr-3">Bid</th>
                <th className="border-b border-line py-2">Tags</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((job) => (
                <tr key={job.id}>
                  <td className="py-3 pr-3">
                    <Link
                      to="/jobs/$jobId"
                      params={{ jobId: job.id }}
                      className="font-semibold underline"
                    >
                      {job.number}
                    </Link>
                  </td>
                  <td className="py-3 pr-3">{job.name}</td>
                  <td className="py-3 pr-3">{stageLabel(job.stage)}</td>
                  <td className="py-3 pr-3">
                    {job.client_id ? (
                      <Link
                        to="/clients/$clientId"
                        params={{ clientId: job.client_id }}
                        className="underline"
                      >
                        {job.client_name ?? "Client"}
                      </Link>
                    ) : (
                      "No client"
                    )}
                  </td>
                  <td className="py-3 pr-3">{memberName(people, job.owner_member_id)}</td>
                  <td className="py-3 pr-3">{formatWhen(job.updated_at)}</td>
                  <td className="py-3 pr-3">
                    {job.bid_value_cents === null
                      ? "Not set"
                      : formatCents(job.bid_value_cents, currency)}
                  </td>
                  <td className="py-3">{job.tags.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function queryString(filter: { stage: string; owner: string; since: string; tag: string }): string {
  const params = new URLSearchParams();
  params.set("limit", "200");
  if (filter.stage) {
    params.set("stage", filter.stage);
  }
  if (filter.owner) {
    params.set("owner", filter.owner);
  }
  if (filter.since) {
    params.set("updatedSince", filter.since);
  }
  if (filter.tag.trim()) {
    params.set("tag", filter.tag.trim());
  }
  return params.toString();
}
