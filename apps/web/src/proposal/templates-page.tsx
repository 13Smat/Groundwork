import { Button, TextField } from "@groundwork/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { message } from "../crm/messages";
import { api } from "../session";
import type { ProposalTemplate } from "./types";

export function ProposalTemplatesPage() {
  const client = useQueryClient();
  const templates = useQuery({
    queryKey: ["proposal-templates"],
    queryFn: () => api<{ templates: ProposalTemplate[] }>("/proposal-templates"),
  });
  const [name, setName] = useState("");
  const [intro, setIntro] = useState("");
  const [terms, setTerms] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <h2 className="text-2xl font-semibold">Proposal templates</h2>
      <p>
        Open a ready estimate to build a proposal. Templates hold the default introduction and
        terms.
      </p>
      {error ? (
        <p role="alert" className="text-accent">
          {error}
        </p>
      ) : null}
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setError("");
          setPending(true);
          void api<ProposalTemplate>("/proposal-templates", {
            method: "POST",
            body: JSON.stringify({
              name: name.trim(),
              intro,
              terms,
            }),
          })
            .then(async () => {
              setName("");
              setIntro("");
              setTerms("");
              await client.invalidateQueries({ queryKey: ["proposal-templates"] });
            })
            .catch((err: unknown) => {
              setError(message(err, "Could not save the template."));
            })
            .finally(() => setPending(false));
        }}
      >
        <TextField
          id="template-name"
          label="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <TextField
          id="template-intro"
          label="Introduction"
          value={intro}
          onChange={(event) => setIntro(event.target.value)}
        />
        <TextField
          id="template-terms"
          label="Terms"
          value={terms}
          onChange={(event) => setTerms(event.target.value)}
        />
        <Button type="submit" disabled={pending || name.trim() === ""}>
          Save template
        </Button>
      </form>
      <ul className="flex flex-col gap-2">
        {(templates.data?.templates ?? []).map((template) => (
          <li key={template.id}>
            <span className="font-semibold">{template.name}</span>
          </li>
        ))}
      </ul>
      <p>
        <Link to="/jobs" className="font-semibold underline">
          Jobs
        </Link>
      </p>
    </div>
  );
}
