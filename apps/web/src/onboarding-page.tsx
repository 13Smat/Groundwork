import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Button, SelectField, TextField } from "@groundwork/ui";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { loadStarterPack } from "./catalog/client";
import type { StarterResult } from "./catalog/types";
import { TIME_ZONES } from "./pages";
import {
  ApiError,
  activeWorkspace,
  api,
  loadMe,
  queryClient,
  type Address,
  type Workspace,
} from "./session";

type Step = 0 | 1 | 2;

const STEP_TITLE = ["Company profile", "Units and timezone", "Starter catalog"] as const;

function message(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function packNotice(result: StarterResult): string {
  return `Added ${result.catalog_created.length} catalog items, ${result.takeoff_created.length} takeoff items, and ${result.recipes_created.length} recipes. Skipped ${result.catalog_skipped.length} catalog items already in the workspace.`;
}

export function OnboardingPage() {
  const navigate = useNavigate();
  const profile = useQuery({ queryKey: ["me"], queryFn: loadMe });
  const workspaceId = profile.data ? activeWorkspace(profile.data)?.workspace_id : undefined;
  const workspace = useQuery({
    queryKey: ["workspace", workspaceId],
    queryFn: () => api<Workspace>(`/workspaces/${workspaceId}`),
    enabled: Boolean(workspaceId),
  });

  useEffect(() => {
    if (workspace.data?.features.onboarding_complete === true) {
      void navigate({ to: "/" });
    }
  }, [navigate, workspace.data]);

  if (!profile.data) {
    return <p>Loading setup.</p>;
  }
  if (!workspaceId) {
    return <p>Create a workspace before setup.</p>;
  }
  if (!workspace.data) {
    return <p>Loading setup.</p>;
  }
  if (workspace.data.features.onboarding_complete === true) {
    return <p>Setup is already finished.</p>;
  }
  return <Wizard workspace={workspace.data} />;
}

function Wizard({ workspace }: { workspace: Workspace }) {
  const navigate = useNavigate();
  const heading = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState<Step>(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  async function save(body: Record<string, unknown>): Promise<Workspace> {
    const saved = await api<Workspace>(`/workspaces/${workspace.id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    queryClient.setQueryData(["workspace", workspace.id], saved);
    await queryClient.invalidateQueries({ queryKey: ["me"] });
    return saved;
  }

  async function finish(): Promise<void> {
    setError("");
    setBusy(true);
    try {
      await save({ features: { onboarding_complete: true } });
      await navigate({ to: "/" });
    } catch (err) {
      setError(message(err, "Could not finish setup."));
      setBusy(false);
    }
  }

  async function onProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const address: Address = {
      line1: String(form.get("line1") ?? ""),
      line2: String(form.get("line2") ?? ""),
      city: String(form.get("city") ?? ""),
      region: String(form.get("region") ?? ""),
      postal_code: String(form.get("postal_code") ?? ""),
      country: String(form.get("country") ?? ""),
    };
    setBusy(true);
    try {
      await save({
        name: String(form.get("name") ?? ""),
        license_number: String(form.get("license_number") ?? "") || null,
        address,
      });
      setStep(1);
    } catch (err) {
      setError(message(err, "Could not save the company profile."));
    } finally {
      setBusy(false);
    }
  }

  async function onDefaults(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await save({
        timezone: String(form.get("timezone") ?? ""),
        units_pref: String(form.get("units_pref") ?? ""),
      });
      setStep(2);
    } catch (err) {
      setError(message(err, "Could not save the defaults."));
    } finally {
      setBusy(false);
    }
  }

  async function onStarter() {
    setError("");
    setBusy(true);
    try {
      const result = await loadStarterPack(workspace.id);
      setNotice(packNotice(result));
    } catch (err) {
      setNotice("");
      setError(message(err, "Could not load the starter pack."));
    } finally {
      setBusy(false);
    }
  }

  const zones = TIME_ZONES.includes(workspace.timezone)
    ? TIME_ZONES
    : [workspace.timezone, ...TIME_ZONES];

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <p className="text-sm font-semibold">Step {step + 1} of 3</p>
      <h2
        id="onboarding-step"
        ref={heading}
        tabIndex={-1}
        className="text-xl font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        {STEP_TITLE[step]}
      </h2>
      {error ? (
        <p role="alert" className="text-base text-accent">
          {error}
        </p>
      ) : null}
      {step === 0 ? (
        <form onSubmit={(event) => void onProfile(event)} className="flex flex-col gap-4">
          <TextField
            id="company"
            name="name"
            label="Company name"
            defaultValue={workspace.name}
            autoComplete="organization"
            required
          />
          <TextField
            id="license"
            name="license_number"
            label="License number"
            defaultValue={workspace.license_number ?? ""}
          />
          <fieldset className="flex flex-col gap-4">
            <legend className="text-sm font-semibold">Company address</legend>
            <TextField
              id="line1"
              name="line1"
              label="Street"
              autoComplete="address-line1"
              defaultValue={workspace.address?.line1 ?? ""}
            />
            <TextField
              id="line2"
              name="line2"
              label="Street line 2"
              autoComplete="address-line2"
              defaultValue={workspace.address?.line2 ?? ""}
            />
            <TextField
              id="city"
              name="city"
              label="City"
              autoComplete="address-level2"
              defaultValue={workspace.address?.city ?? ""}
            />
            <TextField
              id="region"
              name="region"
              label="State"
              autoComplete="address-level1"
              defaultValue={workspace.address?.region ?? ""}
            />
            <TextField
              id="postal"
              name="postal_code"
              label="Postal code"
              autoComplete="postal-code"
              defaultValue={workspace.address?.postal_code ?? ""}
            />
            <TextField
              id="country"
              name="country"
              label="Country"
              autoComplete="country-name"
              defaultValue={workspace.address?.country ?? "US"}
            />
          </fieldset>
          <Button type="submit" disabled={busy}>
            Save and continue
          </Button>
        </form>
      ) : null}
      {step === 1 ? (
        <form onSubmit={(event) => void onDefaults(event)} className="flex flex-col gap-4">
          <p className="max-w-prose text-base leading-relaxed">
            Measurements are stored in meters. These defaults are how the office displays them.
          </p>
          <SelectField
            id="timezone"
            name="timezone"
            label="Timezone"
            defaultValue={workspace.timezone}
          >
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </SelectField>
          <SelectField
            id="units"
            name="units_pref"
            label="Units"
            defaultValue={workspace.units_pref}
          >
            <option value="imperial">Imperial</option>
            <option value="metric">Metric</option>
          </SelectField>
          <Button type="submit" disabled={busy}>
            Save and continue
          </Button>
        </form>
      ) : null}
      {step === 2 ? (
        <div className="flex flex-col gap-4">
          <p className="max-w-prose text-base leading-relaxed">
            Load the Groundwork paving and landscaping starter. Running it again skips catalog
            items, takeoff items, and recipes that are already in this workspace. Recipes stay
            drafts until you activate them.
          </p>
          {notice ? <p role="status">{notice}</p> : null}
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => void onStarter()}
            >
              Load starter pack
            </Button>
            <Button type="button" disabled={busy} onClick={() => void finish()}>
              Finish setup
            </Button>
          </div>
        </div>
      ) : null}
      <Button type="button" variant="secondary" disabled={busy} onClick={() => void finish()}>
        Skip setup
      </Button>
    </div>
  );
}
