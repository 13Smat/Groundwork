import { TextField } from "@groundwork/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { api } from "../session";
import type { SearchResults } from "./types";

export function SearchBox({ workspaceId }: { workspaceId: string | undefined }) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(q.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [q]);

  const results = useQuery({
    queryKey: ["search", workspaceId, debounced],
    queryFn: () => api<SearchResults>(`/search?q=${encodeURIComponent(debounced)}`),
    enabled: Boolean(workspaceId) && debounced.length > 0,
  });

  const data = results.data;
  const total = data
    ? data.clients.length + data.contacts.length + data.jobs.length + data.locations.length
    : 0;

  return (
    <div className="flex flex-col gap-3">
      <TextField
        id="global-search"
        label="Search clients, jobs, and sites"
        value={q}
        onChange={(event) => setQ(event.target.value)}
        autoComplete="off"
      />
      {debounced.length > 0 ? (
        <div
          role="region"
          aria-label="Search results"
          aria-live="polite"
          className="flex flex-col gap-3"
        >
          {results.isFetching ? <p>Searching.</p> : null}
          {data && total === 0 && !results.isFetching ? <p>No matches.</p> : null}
          {data && data.clients.length > 0 ? (
            <section>
              <h2 className="text-lg font-semibold">Clients</h2>
              <ul>
                {data.clients.map((client) => (
                  <li key={client.id}>
                    <Link
                      to="/clients/$clientId"
                      params={{ clientId: client.id }}
                      className="text-base font-semibold underline"
                    >
                      {client.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {data && data.contacts.length > 0 ? (
            <section>
              <h2 className="text-lg font-semibold">Contacts</h2>
              <ul>
                {data.contacts.map((contact) => (
                  <li key={contact.id}>
                    <Link
                      to="/clients/$clientId"
                      params={{ clientId: contact.client_id }}
                      className="underline"
                    >
                      {contact.name}
                    </Link>
                    {contact.phone ? ` · ${contact.phone}` : ""}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {data && data.jobs.length > 0 ? (
            <section>
              <h2 className="text-lg font-semibold">Jobs</h2>
              <ul>
                {data.jobs.map((job) => (
                  <li key={job.id}>
                    <Link
                      to="/jobs/$jobId"
                      params={{ jobId: job.id }}
                      className="text-base font-semibold underline"
                    >
                      {job.number} {job.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {data && data.locations.length > 0 ? (
            <section>
              <h2 className="text-lg font-semibold">Sites</h2>
              <ul>
                {data.locations.map((location) => (
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
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
