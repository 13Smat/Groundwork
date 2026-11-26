import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { activeWorkspace, api, ApiError, loadMe } from "../session";
import {
  ImageryAdmin,
  type ImagerySourceRow,
  type IngestJobView,
  type IngestRequest,
  type LicenseSave,
} from "./imagery-page";

type SourceResponse = ImagerySourceRow & {
  workspaceId: string | null;
  gsdCm: number | null;
  captureDate: string | null;
  licenseUrl: string | null;
  notes: string | null;
};

type JobResponse = IngestJobView & { sourceId: string; captureId: string | null; year: number };

export function ImageryRoute() {
  const client = useQueryClient();
  const profile = useQuery({ queryKey: ["me"], queryFn: loadMe });
  const workspaceId = profile.data ? activeWorkspace(profile.data)?.workspace_id : undefined;
  const [job, setJob] = useState<JobResponse | null>(null);
  const sources = useQuery({
    queryKey: ["admin-imagery-sources", workspaceId],
    queryFn: () => request<{ sources: SourceResponse[] }>("/admin/imagery-sources", workspaceId),
    enabled: Boolean(workspaceId),
  });
  const ingest = useMutation({
    mutationFn: (input: IngestRequest) =>
      request<JobResponse>("/imagery/ingest", workspaceId, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: (next) => {
      setJob(next);
    },
  });
  const save = useMutation({
    mutationFn: (input: LicenseSave) =>
      request<SourceResponse>(`/admin/imagery-sources/${input.sourceId}`, workspaceId, {
        method: "PATCH",
        body: JSON.stringify({
          allowsTracing: input.allowsTracing,
          allowsMlTraining: input.allowsMlTraining,
          verifiedAt: input.verifiedAt,
          licenseText: input.licenseText,
          attribution: input.attribution,
        }),
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["admin-imagery-sources", workspaceId] });
    },
  });
  const create = useMutation({
    mutationFn: (input: { provider: string; name: string; bands: string }) =>
      request<SourceResponse>("/admin/imagery-sources", workspaceId, {
        method: "POST",
        body: JSON.stringify({
          ...input,
          allowsTracing: false,
          allowsMlTraining: false,
        }),
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["admin-imagery-sources", workspaceId] });
    },
  });

  useEffect(() => {
    if (!job || job.status !== "ingesting" || !workspaceId) {
      return;
    }
    const jobId = job.jobId;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void request<JobResponse>(`/imagery/ingest/${jobId}`, workspaceId)
        .then((next) => {
          if (!cancelled) {
            setJob(next);
          }
        })
        .catch(() => undefined);
    }, 500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [job, workspaceId]);

  const error =
    message(sources.error) ?? message(ingest.error) ?? message(save.error) ?? message(create.error);

  if (!workspaceId) {
    return <p>Create a workspace before editing imagery sources.</p>;
  }

  return (
    <ImageryAdmin
      sources={(sources.data?.sources ?? []).map(toRow)}
      job={job}
      error={error}
      busy={ingest.isPending || save.isPending || create.isPending}
      onIngest={(input) => {
        ingest.mutate(input);
      }}
      onSaveLicense={(input) => {
        save.mutate(input);
      }}
      onCreateSource={(input) => {
        create.mutate(input);
      }}
    />
  );
}

function toRow(source: SourceResponse): ImagerySourceRow {
  return {
    id: source.id,
    provider: source.provider,
    name: source.name,
    bands: source.bands,
    allowsTracing: source.allowsTracing,
    allowsMlTraining: source.allowsMlTraining,
    verifiedAt: source.verifiedAt,
    licenseText: source.licenseText,
    attribution: source.attribution,
    workspaceId: source.workspaceId,
    coverage: source.coverage,
  };
}

async function request<T>(
  path: string,
  workspaceId: string | undefined,
  init?: RequestInit,
): Promise<T> {
  if (!workspaceId) {
    throw new ApiError(400, "Choose a workspace first.");
  }
  const headers = new Headers(init?.headers);
  headers.set("x-workspace-id", workspaceId);
  return api<T>(path, { ...init, headers });
}

function message(error: unknown): string | null {
  if (!error) {
    return null;
  }
  return error instanceof Error ? error.message : "Request failed.";
}
