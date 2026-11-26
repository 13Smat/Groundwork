import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { api } from "../session";
import { message } from "./messages";
import { SiteMap } from "./site-map";
import type { Job, Location } from "./types";
import { useWorkspace } from "./workspace";

export function LocationPage({ locationId }: { locationId: string }) {
  const { workspaceId } = useWorkspace();
  const location = useQuery({
    queryKey: ["location", locationId],
    queryFn: () => api<Location>(`/locations/${locationId}`),
    enabled: Boolean(workspaceId),
  });
  const jobs = useQuery({
    queryKey: ["jobs", workspaceId, "location", locationId],
    queryFn: () => api<{ jobs: Job[] }>("/jobs?limit=200"),
    enabled: Boolean(workspaceId),
  });

  if (!workspaceId || location.isLoading) {
    return <p>Loading location.</p>;
  }
  if (location.isError || !location.data) {
    return (
      <p role="alert" className="text-base text-accent">
        {message(location.error, "That location was not found.")}
      </p>
    );
  }

  const row = location.data;
  const address = [row.address.line1, row.address.city, row.address.region, row.address.postal_code]
    .filter((part) => part && part.trim() !== "")
    .join(", ");
  const related = (jobs.data?.jobs ?? []).filter((job) => job.location_id === locationId);

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold">{row.address.line1 ?? "Site"}</h2>
      <p>{address || "No street address"}</p>
      {row.client_id ? (
        <p>
          <Link to="/clients/$clientId" params={{ clientId: row.client_id }} className="underline">
            Client
          </Link>
        </p>
      ) : null}
      <p>
        {row.point ? `${row.point.lat.toFixed(5)}, ${row.point.lng.toFixed(5)}` : "No point yet."}
      </p>
      <p>{row.site_geom ? "Parcel outline is shown for context." : "No parcel is linked."}</p>
      {row.notes ? <p>{row.notes}</p> : null}
      <SiteMap
        workspaceId={workspaceId}
        point={row.point}
        parcel={row.site_geom}
        interactive={false}
      />
      <h3 className="text-xl font-semibold">Jobs</h3>
      {jobs.isSuccess && related.length === 0 ? <p>No jobs at this site.</p> : null}
      <ul>
        {related.map((job) => (
          <li key={job.id}>
            <Link to="/jobs/$jobId" params={{ jobId: job.id }} className="underline">
              {job.number} {job.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
