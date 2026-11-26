import { Button } from "@groundwork/ui";

import type { Proposal } from "./types";

export function ProposalTimeline({
  proposal,
  pending,
  onVoid,
  onRevise,
}: {
  proposal: Proposal;
  pending: boolean;
  onVoid: () => void;
  onRevise: () => void;
}) {
  const canChange = proposal.status !== "signed" && proposal.status !== "draft";
  return (
    <section className="flex flex-col gap-3" aria-label="Proposal timeline">
      <h3 className="text-lg font-semibold">Timeline</h3>
      {proposal.bounced ? (
        <p role="alert" className="text-accent">
          A signer email bounced. The proposal is still waiting for signature.
        </p>
      ) : null}
      <p>
        Status <strong>{proposal.status}</strong>
        {proposal.estimate_status ? `. Estimate ${proposal.estimate_status}` : ""}.
      </p>
      {proposal.recipients.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {proposal.recipients.map((recipient) => {
            const signed = proposal.signatures.some(
              (signature) =>
                signature.signer_email?.toLowerCase() === recipient.email.toLowerCase() &&
                signature.signed_at,
            );
            return (
              <li key={recipient.email}>
                {recipient.name} {signed ? "signed" : "has not signed"}
              </li>
            );
          })}
        </ul>
      ) : (
        <p>No recipients yet.</p>
      )}
      {proposal.work_order_id ? <p>Work order ready.</p> : null}
      {canChange ? (
        <div className="flex flex-wrap gap-3">
          {proposal.status !== "void" ? (
            <Button type="button" variant="secondary" disabled={pending} onClick={onVoid}>
              Void
            </Button>
          ) : null}
          <Button type="button" variant="secondary" disabled={pending} onClick={onRevise}>
            Revise
          </Button>
        </div>
      ) : null}
    </section>
  );
}
