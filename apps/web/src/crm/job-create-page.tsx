import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { api } from "../session";
import { JobCreateForm } from "./job-create-form";
import { message } from "./messages";
import type { AddressLookup, Client, CreateJobInput, Job, ResolveResult } from "./types";
import { useMembers, useWorkspace } from "./workspace";
import { stashWarnings } from "./warnings";

export function JobCreatePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { workspaceId, memberId, currency, ready } = useWorkspace();
  const members = useMembers(workspaceId);
  const clients = useQuery({
    queryKey: ["clients", workspaceId],
    queryFn: () => api<{ clients: Client[] }>("/clients"),
    enabled: Boolean(workspaceId),
  });
  const [lookup, setLookup] = useState<AddressLookup | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onLookup(address: string) {
    if (address === "") {
      setError("Enter an address.");
      return;
    }
    setError(null);
    setLookingUp(true);
    try {
      const result = await api<ResolveResult>("/locations/resolve", {
        method: "POST",
        body: JSON.stringify({ address }),
      });
      setLookup({
        addressText: address,
        formatted: result.formatted,
        line1: result.address?.line1 ?? null,
        point: result.point,
        warning: result.warnings[0] ?? null,
      });
    } catch (err) {
      setError(message(err, "Could not look up that address."));
    } finally {
      setLookingUp(false);
    }
  }

  async function onCreate(input: CreateJobInput) {
    setError(null);
    setSubmitting(true);
    try {
      const job = await api<Job & { warnings: string[] }>("/jobs", {
        method: "POST",
        body: JSON.stringify({
          name: input.name,
          address: input.address,
          ...(input.point ? { point: input.point } : {}),
          ...(input.bidValueCents === null ? {} : { bid_value_cents: input.bidValueCents }),
          ...(input.ownerMemberId ? { owner_member_id: input.ownerMemberId } : {}),
          ...(input.clientId ? { client_id: input.clientId } : {}),
          ...(input.client
            ? {
                client: {
                  type: input.client.type,
                  name: input.client.name,
                  email: input.client.email === "" ? null : input.client.email,
                  phone: input.client.phone === "" ? null : input.client.phone,
                },
              }
            : {}),
        }),
      });
      stashWarnings(job.id, job.warnings);
      await queryClient.invalidateQueries({ queryKey: ["jobs"] });
      await queryClient.invalidateQueries({ queryKey: ["pipeline"] });
      await queryClient.invalidateQueries({ queryKey: ["clients"] });
      await navigate({ to: "/jobs/$jobId", params: { jobId: job.id } });
    } catch (err) {
      setError(message(err, "Could not create the job."));
      setSubmitting(false);
    }
  }

  if (!ready || clients.isLoading) {
    return <p>Loading the job form.</p>;
  }

  return (
    <JobCreateForm
      clients={(clients.data?.clients ?? []).map((client) => ({
        id: client.id,
        name: client.name,
      }))}
      members={members.data?.members ?? []}
      currentMemberId={memberId}
      currency={currency}
      lookup={lookup}
      lookingUp={lookingUp}
      submitting={submitting}
      error={error}
      onLookup={(address) => {
        void onLookup(address);
      }}
      onCreate={(input) => {
        void onCreate(input);
      }}
    />
  );
}
