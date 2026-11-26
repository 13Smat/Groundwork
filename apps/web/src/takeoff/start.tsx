import { Button } from "@groundwork/ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { message } from "../crm/messages";
import type { Job, Location } from "../crm/types";
import { useWorkspace } from "../crm/workspace";
import { api } from "../session";
import { allowedCaptures, NO_CAPTURE_MESSAGE, NO_POINT_MESSAGE } from "./imagery";
import { ImageryNotice } from "./notice";
import type { ImageryCapture, TakeoffRecord } from "./types";

type ListedTakeoff = Pick<TakeoffRecord, "id" | "version" | "status">;

function statusLabel(status: ListedTakeoff["status"]): string {
  if (status === "in_review") {
    return "In review";
  }
  if (status === "final") {
    return "Final";
  }
  return "Draft";
}

export function TakeoffStart({
  captures,
  loading,
  creating,
  error,
  takeoffs,
  onCreate,
  onOpen,
}: {
  captures: ImageryCapture[] | null;
  loading: boolean;
  creating: boolean;
  error: string;
  takeoffs: readonly ListedTakeoff[] | null;
  onCreate: () => void;
  onOpen: (takeoffId: string) => void;
}) {
  const blocked = captures !== null && captures.length === 0;
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <h3 className="text-xl font-semibold">Takeoffs</h3>
      <p className="max-w-prose text-base leading-relaxed">
        An aerial takeoff opens on the newest license-cleared capture for this site. The parcel line
        is a reference and does not clip what you draw.
      </p>
      {loading ? <p>Checking imagery for this site.</p> : null}
      {error ? (
        <p role="alert" className="text-base text-accent">
          {error}
        </p>
      ) : null}
      {blocked ? (
        <p role="alert" className="text-base text-accent">
          {NO_CAPTURE_MESSAGE}
        </p>
      ) : null}
      {captures && captures[0] ? <ImageryNotice capture={captures[0]} /> : null}
      <Button
        type="button"
        disabled={loading || creating || blocked || captures === null}
        onClick={onCreate}
      >
        {creating ? "Creating takeoff" : "New takeoff"}
      </Button>
      {takeoffs && takeoffs.length > 0 ? (
        <ul className="flex flex-col gap-2" aria-label="Takeoffs for this job">
          {takeoffs.map((takeoff) => (
            <li key={takeoff.id}>
              <button
                type="button"
                className="min-h-11 text-base font-semibold underline"
                onClick={() => onOpen(takeoff.id)}
              >
                Version {takeoff.version}, {statusLabel(takeoff.status)}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {takeoffs && takeoffs.length === 0 ? <p>No takeoffs yet.</p> : null}
    </div>
  );
}

export function TakeoffsPanel({ jobId }: { jobId: string }) {
  const navigate = useNavigate();
  const { workspaceId } = useWorkspace();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const job = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api<Job>(`/jobs/${jobId}`),
    enabled: Boolean(workspaceId),
  });
  const locationId = job.data?.location_id ?? undefined;
  const location = useQuery({
    queryKey: ["location", locationId],
    queryFn: () => api<Location>(`/locations/${locationId}`),
    enabled: Boolean(workspaceId && locationId),
  });
  const captures = useQuery({
    queryKey: ["imagery-captures", locationId],
    queryFn: () =>
      api<{ captures: ImageryCapture[] }>(`/imagery/captures?locationId=${locationId}`),
    enabled: Boolean(workspaceId && locationId && location.data?.point),
  });
  const takeoffs = useQuery({
    queryKey: ["job-takeoffs", jobId],
    queryFn: () => api<{ takeoffs: TakeoffRecord[] }>(`/jobs/${jobId}/takeoffs`),
    enabled: Boolean(workspaceId),
  });

  const allowed = captures.data ? allowedCaptures(captures.data.captures) : null;
  const waiting =
    !workspaceId ||
    job.isLoading ||
    takeoffs.isLoading ||
    (Boolean(locationId) && location.isLoading) ||
    (Boolean(location.data?.point) && captures.isLoading);

  async function onCreate() {
    const capture = allowed?.[0];
    const siteId = job.data?.location_id;
    if (!capture || !siteId) {
      return;
    }
    setError("");
    setCreating(true);
    try {
      const created = await api<TakeoffRecord>(`/jobs/${jobId}/takeoffs`, {
        method: "POST",
        body: JSON.stringify({
          kind: "aerial",
          location_id: siteId,
          imagery_capture_id: capture.id,
        }),
      });
      await navigate({
        to: "/jobs/$jobId/takeoffs/$takeoffId",
        params: { jobId, takeoffId: created.id },
      });
    } catch (err) {
      setError(message(err, "Could not create the takeoff."));
      setCreating(false);
    }
  }

  let pointError = "";
  if (job.data && !job.data.location_id) {
    pointError = NO_POINT_MESSAGE;
  } else if (location.data && !location.data.point) {
    pointError = NO_POINT_MESSAGE;
  } else if (captures.isError) {
    pointError = message(captures.error, "Could not load imagery for this site.");
  }

  return (
    <TakeoffStart
      captures={pointError ? null : allowed}
      loading={waiting}
      creating={creating}
      error={
        error ||
        (job.isError
          ? message(job.error, "That job was not found.")
          : takeoffs.isError
            ? message(takeoffs.error, "Could not load takeoffs for this job.")
            : pointError)
      }
      takeoffs={takeoffs.isSuccess ? takeoffs.data.takeoffs : null}
      onCreate={() => {
        void onCreate();
      }}
      onOpen={(takeoffId) => {
        void navigate({
          to: "/jobs/$jobId/takeoffs/$takeoffId",
          params: { jobId, takeoffId },
        });
      }}
    />
  );
}

export function TakeoffsPage({ jobId }: { jobId: string }) {
  return <TakeoffsPanel jobId={jobId} />;
}
