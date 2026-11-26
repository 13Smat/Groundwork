import { Button, SelectField } from "@groundwork/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { message } from "../crm/messages";
import { api } from "../session";
import type { Proposal, ProposalSummary, ProposalTemplate } from "./types";

export function ProposalStartPage({ jobId, estimateId }: { jobId: string; estimateId: string }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const proposals = useQuery({
    queryKey: ["estimate-proposals", estimateId],
    queryFn: () => api<{ proposals: ProposalSummary[] }>(`/estimates/${estimateId}/proposals`),
  });
  const templates = useQuery({
    queryKey: ["proposal-templates"],
    queryFn: () => api<{ templates: ProposalTemplate[] }>("/proposal-templates"),
  });
  const [templateId, setTemplateId] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function create() {
    setError("");
    setPending(true);
    try {
      const created = await api<Proposal>(`/estimates/${estimateId}/proposals`, {
        method: "POST",
        body: JSON.stringify(templateId ? { template_id: templateId } : {}),
      });
      client.setQueryData(["proposal", created.id], created);
      await client.invalidateQueries({ queryKey: ["estimate-proposals", estimateId] });
      await navigate({ to: "/proposals/$proposalId", params: { proposalId: created.id } });
    } catch (err) {
      setError(message(err, "Could not create the proposal."));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <p>
        <Link
          to="/jobs/$jobId/estimates/$estimateId"
          params={{ jobId, estimateId }}
          className="font-semibold underline"
        >
          Back to estimate
        </Link>
      </p>
      <h2 className="text-2xl font-semibold">Proposal</h2>
      {error ? (
        <p role="alert" className="text-accent">
          {error}
        </p>
      ) : null}
      {proposals.data && proposals.data.proposals.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {proposals.data.proposals.map((item) => (
            <li key={item.id}>
              <Link
                to="/proposals/$proposalId"
                params={{ proposalId: item.id }}
                className="font-semibold underline"
              >
                Open {item.number}
              </Link>{" "}
              <span>{item.status}</span>
            </li>
          ))}
        </ul>
      ) : (
        <>
          <SelectField
            id="proposal-template"
            label="Template"
            value={templateId}
            onChange={(event) => setTemplateId(event.target.value)}
          >
            <option value="">Blank</option>
            {(templates.data?.templates ?? []).map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </SelectField>
          <Button type="button" disabled={pending} onClick={() => void create()}>
            Create proposal
          </Button>
        </>
      )}
    </div>
  );
}
