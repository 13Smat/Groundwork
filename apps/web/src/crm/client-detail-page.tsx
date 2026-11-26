import { Button, SelectField, TextField } from "@groundwork/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";

import { api } from "../session";
import { stageLabel } from "./format";
import { message } from "./messages";
import type { Client, Contact, Job, Location } from "./types";
import { useWorkspace } from "./workspace";

export function ClientDetailPage({ clientId }: { clientId: string }) {
  const { workspaceId } = useWorkspace();
  const client = useQuery({
    queryKey: ["client", clientId],
    queryFn: () => api<Client>(`/clients/${clientId}`),
    enabled: Boolean(workspaceId),
  });
  const contacts = useQuery({
    queryKey: ["contacts", clientId],
    queryFn: () => api<{ contacts: Contact[] }>(`/clients/${clientId}/contacts`),
    enabled: Boolean(workspaceId),
  });
  const locations = useQuery({
    queryKey: ["locations", workspaceId],
    queryFn: () => api<{ locations: Location[] }>("/locations"),
    enabled: Boolean(workspaceId),
  });
  const jobs = useQuery({
    queryKey: ["jobs", workspaceId, "client", clientId],
    queryFn: () => api<{ jobs: Job[] }>("/jobs?limit=200"),
    enabled: Boolean(workspaceId),
  });

  if (!workspaceId || client.isLoading) {
    return <p>Loading client.</p>;
  }
  if (client.isError || !client.data) {
    return (
      <p role="alert" className="text-base text-accent">
        {message(client.error, "That client was not found.")}
      </p>
    );
  }

  const row = client.data;
  const sites = (locations.data?.locations ?? []).filter(
    (location) => location.client_id === clientId,
  );
  const clientJobs = (jobs.data?.jobs ?? []).filter((job) => job.client_id === clientId);

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h2 className="text-2xl font-semibold">{row.name}</h2>
        <p>
          {row.type}
          {row.email ? ` · ${row.email}` : ""}
          {row.phone ? ` · ${row.phone}` : ""}
        </p>
      </header>
      <section className="flex flex-col gap-3">
        <h3 className="text-xl font-semibold">Contacts</h3>
        <ContactForm clientId={clientId} />
        {(contacts.data?.contacts ?? []).length === 0 && contacts.isSuccess ? (
          <p>No contacts yet.</p>
        ) : null}
        <ul className="flex flex-col gap-2">
          {(contacts.data?.contacts ?? []).map((contact) => (
            <li key={contact.id}>
              {contact.name}
              {contact.role ? ` · ${contact.role}` : ""}
              {contact.phone ? ` · ${contact.phone}` : ""}
              {contact.email ? ` · ${contact.email}` : ""}
              {contact.is_primary ? " · primary" : ""}
            </li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-3">
        <h3 className="text-xl font-semibold">Locations</h3>
        {locations.isSuccess && sites.length === 0 ? <p>No locations yet.</p> : null}
        <ul>
          {sites.map((location) => (
            <li key={location.id}>
              <Link
                to="/locations/$locationId"
                params={{ locationId: location.id }}
                className="underline"
              >
                {location.address.line1 ?? "Site"}
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-3">
        <h3 className="text-xl font-semibold">Jobs</h3>
        {jobs.isSuccess && clientJobs.length === 0 ? <p>No jobs yet.</p> : null}
        <ul>
          {clientJobs.map((job) => (
            <li key={job.id}>
              <Link to="/jobs/$jobId" params={{ jobId: job.id }} className="underline">
                {job.number} {job.name}
              </Link>
              {` · ${stageLabel(job.stage)}`}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function ContactForm({ clientId }: { clientId: string }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setWarnings([]);
    const form = event.currentTarget;
    const data = new FormData(form);
    const email = String(data.get("email") ?? "").trim();
    const phone = String(data.get("phone") ?? "").trim();
    try {
      const created = await api<Contact & { warnings: string[] }>(`/clients/${clientId}/contacts`, {
        method: "POST",
        body: JSON.stringify({
          name: String(data.get("name") ?? ""),
          email: email === "" ? null : email,
          phone: phone === "" ? null : phone,
          role: String(data.get("role") ?? "") || null,
          is_primary: data.get("primary") === "on",
        }),
      });
      setWarnings(created.warnings);
      form.reset();
      await queryClient.invalidateQueries({ queryKey: ["contacts", clientId] });
    } catch (err) {
      setError(message(err, "Could not add the contact."));
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-xl flex-col gap-3">
      <TextField id="contact-name" name="name" label="Contact name" required />
      <TextField id="contact-role" name="role" label="Role" />
      <TextField id="contact-email" name="email" label="Email" type="email" />
      <TextField id="contact-phone" name="phone" label="Phone" type="tel" />
      <SelectField id="contact-primary" name="primary" label="Primary contact" defaultValue="off">
        <option value="off">No</option>
        <option value="on">Yes</option>
      </SelectField>
      {error ? (
        <p role="alert" className="text-base text-accent">
          {error}
        </p>
      ) : null}
      {warnings.map((warning) => (
        <p key={warning} role="alert" className="text-base text-accent">
          {warning}
        </p>
      ))}
      <Button type="submit">Add contact</Button>
    </form>
  );
}
