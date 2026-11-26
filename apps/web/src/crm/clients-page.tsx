import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { api } from "../session";
import { message } from "./messages";
import { SearchBox } from "./search-box";
import type { Client } from "./types";
import { useWorkspace } from "./workspace";

export function ClientsPage() {
  const { workspaceId, ready } = useWorkspace();
  const clients = useQuery({
    queryKey: ["clients", workspaceId],
    queryFn: () => api<{ clients: Client[] }>("/clients"),
    enabled: Boolean(workspaceId),
  });
  const rows = clients.data?.clients ?? [];

  return (
    <div className="flex flex-col gap-6">
      <SearchBox workspaceId={workspaceId} />
      {!ready || clients.isLoading ? <p>Loading clients.</p> : null}
      {clients.isError ? (
        <p role="alert" className="text-base text-accent">
          {message(clients.error, "Could not load clients.")}
        </p>
      ) : null}
      {clients.isSuccess && rows.length === 0 ? <p>No clients yet.</p> : null}
      {rows.length > 0 ? (
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">Clients</caption>
          <thead>
            <tr>
              <th className="border-b border-line py-2 pr-3">Name</th>
              <th className="border-b border-line py-2 pr-3">Type</th>
              <th className="border-b border-line py-2 pr-3">Email</th>
              <th className="border-b border-line py-2">Phone</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((client) => (
              <tr key={client.id}>
                <td className="py-3 pr-3">
                  <Link
                    to="/clients/$clientId"
                    params={{ clientId: client.id }}
                    className="font-semibold underline"
                  >
                    {client.name}
                  </Link>
                </td>
                <td className="py-3 pr-3">{client.type}</td>
                <td className="py-3 pr-3">{client.email ?? ""}</td>
                <td className="py-3">{client.phone ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
