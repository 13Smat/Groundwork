import { Button } from "@groundwork/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { formatCents } from "../crm/format";
import { message } from "../crm/messages";
import { api } from "../session";

type PublicLine = {
  id: string;
  description: string;
  qty: string;
  unit: string;
  price_cents: number;
  optional: boolean;
  selected: boolean;
};

type PublicProposal = {
  number: string;
  status: string;
  workspace_name: string;
  intro: string;
  terms: string;
  include_optional: boolean;
  expires_at: string | null;
  total_cents: number;
  lines: PublicLine[];
  recipients: { name: string; email: string; signed: boolean }[];
  mock_sign: boolean;
  bounced: boolean;
};

export function PublicProposalPage({ token }: { token: string }) {
  const client = useQueryClient();
  const proposal = useQuery({
    queryKey: ["public-proposal", token],
    queryFn: () => api<PublicProposal>(`/public/proposals/${encodeURIComponent(token)}`),
  });
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  if (proposal.isLoading) {
    return <p className="p-6 text-lg">Loading proposal.</p>;
  }
  if (proposal.isError || !proposal.data) {
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
        <h1 className="text-2xl font-semibold">Proposal</h1>
        <p role="alert" className="text-accent">
          {message(proposal.error, "That proposal link is not available.")}
        </p>
      </main>
    );
  }

  const row = proposal.data;
  const choosing = row.status === "rendered" && row.include_optional;
  const optional = row.lines.filter((line) => line.optional);

  async function save(lineIds: string[]) {
    setError("");
    setPending(true);
    try {
      const next = await api<PublicProposal>(`/public/proposals/${encodeURIComponent(token)}`, {
        method: "POST",
        body: JSON.stringify({ selected_optional_line_ids: lineIds }),
      });
      client.setQueryData(["public-proposal", token], next);
    } catch (err) {
      setError(message(err, "Could not save the optional items."));
    } finally {
      setPending(false);
    }
  }

  async function sign(email: string | undefined) {
    setError("");
    setPending(true);
    try {
      const next = await api<PublicProposal>(
        `/public/proposals/${encodeURIComponent(token)}/sign`,
        {
          method: "POST",
          body: JSON.stringify(email ? { email } : {}),
        },
      );
      client.setQueryData(["public-proposal", token], next);
    } catch (err) {
      setError(message(err, "Could not record the test signature."));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-semibold">{row.workspace_name}</p>
        <h1 className="text-3xl font-semibold">{row.number}</h1>
        <p>
          Status <strong>{row.status}</strong>. Total {formatCents(row.total_cents, "USD")}.
        </p>
      </header>
      {error ? (
        <p role="alert" className="text-accent">
          {error}
        </p>
      ) : null}
      {row.intro ? <p>{row.intro}</p> : null}
      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Scope</h2>
        <ul className="flex flex-col gap-3">
          {row.lines
            .filter((line) => !line.optional)
            .map((line) => (
              <li key={line.id} className="flex min-h-11 items-center justify-between gap-4">
                <span>
                  {line.description} ({line.qty} {line.unit})
                </span>
                <span>{formatCents(line.price_cents, "USD")}</span>
              </li>
            ))}
        </ul>
      </section>
      {optional.length > 0 && row.include_optional ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="text-xl font-semibold">Optional items</legend>
          {optional.map((line) => (
            <label key={line.id} className="flex min-h-11 items-center gap-3 text-lg">
              <input
                type="checkbox"
                className="size-6"
                checked={line.selected}
                disabled={!choosing || pending}
                onChange={(event) => {
                  const ids = optional
                    .filter((item) => (item.id === line.id ? event.target.checked : item.selected))
                    .map((item) => item.id);
                  void save(ids);
                }}
              />
              <span>
                {line.description} {formatCents(line.price_cents, "USD")}
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}
      {row.terms ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold">Terms</h2>
          <p>{row.terms}</p>
        </section>
      ) : null}
      {row.mock_sign ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">Test signature</h2>
          <p>This workspace uses the local signature provider.</p>
          {row.recipients.map((recipient) => (
            <Button
              key={recipient.email}
              type="button"
              disabled={pending || recipient.signed}
              onClick={() => void sign(recipient.email)}
            >
              {recipient.signed ? `${recipient.name} signed` : `Sign as ${recipient.name}`}
            </Button>
          ))}
        </section>
      ) : null}
    </main>
  );
}
