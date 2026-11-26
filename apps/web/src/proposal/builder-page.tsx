import { Button } from "@groundwork/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { formatCents } from "../crm/format";
import { message } from "../crm/messages";
import { useWorkspace } from "../crm/workspace";
import { api } from "../session";
import { ProposalPreview } from "./preview";
import { SendDialog } from "./send-dialog";
import { ProposalTimeline } from "./timeline";
import type { Proposal } from "./types";

const fieldClass =
  "min-h-11 w-full rounded-md border border-line bg-paper px-3 py-2 text-base text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

export function ProposalBuilderPage({ proposalId }: { proposalId: string }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { currency } = useWorkspace();
  const proposal = useQuery({
    queryKey: ["proposal", proposalId],
    queryFn: () => api<Proposal>(`/proposals/${proposalId}`),
  });
  const [intro, setIntro] = useState("");
  const [scope, setScope] = useState("");
  const [terms, setTerms] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [synced, setSynced] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [clientLink, setClientLink] = useState("");

  if (proposal.data && synced !== proposal.data.updated_at) {
    setIntro(proposal.data.intro);
    setScope(proposal.data.scope_note);
    setTerms(proposal.data.terms);
    setSelected(proposal.data.selected_optional_line_ids);
    setSynced(proposal.data.updated_at);
  }

  if (proposal.isLoading) {
    return <p>Loading proposal.</p>;
  }
  if (proposal.isError || !proposal.data) {
    return (
      <p role="alert" className="text-accent">
        {message(proposal.error, "That proposal was not found.")}
      </p>
    );
  }

  const row = proposal.data;
  const draft = row.status === "draft";
  const optional = row.lines.filter((line) => line.optional);

  async function save(): Promise<Proposal | undefined> {
    setError("");
    setPending(true);
    try {
      const next = await api<Proposal>(`/proposals/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          intro,
          scope_note: scope,
          terms,
          selected_optional_line_ids: selected,
        }),
      });
      client.setQueryData(["proposal", row.id], next);
      return next;
    } catch (err) {
      setError(message(err, "Could not save the proposal."));
      return undefined;
    } finally {
      setPending(false);
    }
  }

  async function shareLink() {
    setError("");
    setPending(true);
    try {
      const issued = await api<{ token: string }>(`/proposals/${row.id}/link`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setClientLink(`${window.location.origin}/p/${issued.token}`);
    } catch (err) {
      setError(message(err, "Could not create a client link."));
    } finally {
      setPending(false);
    }
  }

  async function voidProposal() {
    setError("");
    setPending(true);
    try {
      const next = await api<Proposal>(`/proposals/${row.id}/void`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      client.setQueryData(["proposal", row.id], next);
    } catch (err) {
      setError(message(err, "Could not void the proposal."));
    } finally {
      setPending(false);
    }
  }

  async function revise() {
    setError("");
    setPending(true);
    try {
      if (row.status !== "void" && row.status !== "signed") {
        await api<Proposal>(`/proposals/${row.id}/void`, {
          method: "POST",
          body: JSON.stringify({}),
        });
      }
      const created = await api<{ id: string }>(`/estimates/${row.estimate_id}/versions`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await navigate({
        to: "/jobs/$jobId/estimates/$estimateId",
        params: { jobId: row.job_id, estimateId: created.id },
      });
    } catch (err) {
      setError(message(err, "Could not revise the estimate."));
      setPending(false);
    }
  }

  async function renderPdf() {
    setError("");
    setPending(true);
    try {
      if (draft) {
        const saved = await api<Proposal>(`/proposals/${row.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            intro,
            scope_note: scope,
            terms,
            selected_optional_line_ids: selected,
          }),
        });
        client.setQueryData(["proposal", row.id], saved);
      }
      const rendered = await api<{ pdf_file_id: string }>(`/proposals/${row.id}/render`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await client.invalidateQueries({ queryKey: ["proposal", row.id] });
      return rendered.pdf_file_id;
    } catch (err) {
      setError(message(err, "Could not render the proposal."));
      return undefined;
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <p>
        <Link to="/jobs/$jobId" params={{ jobId: row.job_id }} className="font-semibold underline">
          Back to job
        </Link>
      </p>
      <header className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold">{row.number}</h2>
        <p>
          Estimate {row.estimate_number} version {row.estimate_version}. Status{" "}
          <strong>{row.status}</strong>. Total {formatCents(row.total_cents, currency)}.
        </p>
        {error ? (
          <p role="alert" className="text-accent">
            {error}
          </p>
        ) : null}
      </header>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="flex flex-col gap-1 text-sm font-semibold" htmlFor="proposal-intro">
            Introduction
            <textarea
              id="proposal-intro"
              className={fieldClass}
              rows={4}
              value={intro}
              disabled={!draft || pending}
              onChange={(event) => setIntro(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold" htmlFor="proposal-scope">
            Scope
            <textarea
              id="proposal-scope"
              className={fieldClass}
              rows={4}
              value={scope}
              disabled={!draft || pending}
              onChange={(event) => setScope(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold" htmlFor="proposal-terms">
            Terms
            <textarea
              id="proposal-terms"
              className={fieldClass}
              rows={4}
              value={terms}
              disabled={!draft || pending}
              onChange={(event) => setTerms(event.target.value)}
            />
          </label>
          {optional.length > 0 ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-semibold">Optional items</legend>
              {optional.map((line) => (
                <label key={line.id} className="flex min-h-11 items-center gap-3 text-base">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={selected.includes(line.id)}
                    disabled={!draft || pending}
                    onChange={(event) => {
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, line.id]
                          : current.filter((id) => id !== line.id),
                      );
                    }}
                  />
                  <span>
                    {line.description} {formatCents(line.price_cents, currency)}
                  </span>
                </label>
              ))}
            </fieldset>
          ) : null}
          <div className="flex flex-wrap gap-3">
            {draft ? (
              <Button type="submit" variant="secondary" disabled={pending}>
                Save sections
              </Button>
            ) : null}
            <Button type="button" disabled={pending || !draft} onClick={() => void renderPdf()}>
              Render PDF
            </Button>
            {row.status === "rendered" && row.pdf_file_id ? (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => void shareLink()}
                >
                  Client link
                </Button>
                <Button type="button" disabled={pending} onClick={() => setSendOpen(true)}>
                  Send
                </Button>
              </>
            ) : null}
          </div>
          {clientLink ? (
            <label className="flex flex-col gap-1 text-sm font-semibold" htmlFor="client-link">
              Client link
              <input id="client-link" className={fieldClass} readOnly value={clientLink} />
            </label>
          ) : null}
        </form>
        {row.pdf_file_id ? (
          <ProposalPreview key={row.pdf_file_id} proposalId={row.id} />
        ) : (
          <p>Render the proposal to preview the PDF.</p>
        )}
      </div>
      {row.status !== "draft" ? (
        <ProposalTimeline
          proposal={row}
          pending={pending}
          onVoid={() => void voidProposal()}
          onRevise={() => void revise()}
        />
      ) : null}
      <SendDialog
        proposalId={row.id}
        open={sendOpen}
        onOpenChange={setSendOpen}
        onSent={(next) => {
          client.setQueryData(["proposal", row.id], next);
        }}
      />
    </div>
  );
}

export default ProposalBuilderPage;
