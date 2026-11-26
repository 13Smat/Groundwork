import { Button, Dialog, DialogContent } from "@groundwork/ui";
import { useState } from "react";

import { message } from "../crm/messages";
import { api } from "../session";
import type { Proposal } from "./types";

const fieldClass =
  "min-h-11 w-full rounded-md border border-line bg-paper px-3 py-2 text-base text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

export function SendDialog({
  proposalId,
  open,
  onOpenChange,
  onSent,
}: {
  proposalId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent: (proposal: Proposal) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function send() {
    setError("");
    setPending(true);
    try {
      const next = await api<Proposal>(`/proposals/${proposalId}/send`, {
        method: "POST",
        body: JSON.stringify({
          recipients: [{ name, email }],
          message: note,
        }),
      });
      onSent(next);
      onOpenChange(false);
    } catch (err) {
      setError(message(err, "Could not send the proposal."));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Send for signature"
        description="The client receives this proposal. Optional items are locked after it is sent."
        initialFocusId="send-recipient-name"
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <label
            className="flex flex-col gap-1 text-sm font-semibold"
            htmlFor="send-recipient-name"
          >
            Recipient name
            <input
              id="send-recipient-name"
              className={fieldClass}
              value={name}
              autoComplete="name"
              required
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label
            className="flex flex-col gap-1 text-sm font-semibold"
            htmlFor="send-recipient-email"
          >
            Recipient email
            <input
              id="send-recipient-email"
              className={fieldClass}
              type="email"
              value={email}
              autoComplete="email"
              required
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold" htmlFor="send-message">
            Message
            <textarea
              id="send-message"
              className={fieldClass}
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          {error ? (
            <p role="alert" className="text-accent">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={pending}>
            Send proposal
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
