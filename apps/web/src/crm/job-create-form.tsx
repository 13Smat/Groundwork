import { Button, SelectField, TextField } from "@groundwork/ui";
import { type FormEvent, useState } from "react";

import { dollarsToCents } from "./format";
import { SiteMap } from "./site-map";
import type { AddressLookup, CreateJobInput, LatLng } from "./types";

const CLIENT_TYPES = [
  { value: "residential", label: "Residential" },
  { value: "commercial", label: "Commercial" },
  { value: "gov", label: "Government" },
  { value: "hoa", label: "HOA" },
] as const;

export function JobCreateForm({
  clients,
  members,
  currentMemberId,
  currency,
  lookup,
  lookingUp,
  submitting,
  error,
  onLookup,
  onCreate,
  mapEnabled = true,
}: {
  clients: { id: string; name: string }[];
  members: { id: string; name: string | null; email: string | null }[];
  currentMemberId: string | undefined;
  currency: string;
  lookup: AddressLookup | null;
  lookingUp: boolean;
  submitting: boolean;
  error: string | null;
  onLookup: (address: string) => void;
  onCreate: (input: CreateJobInput) => void;
  mapEnabled?: boolean;
}) {
  const [address, setAddress] = useState("");
  const [customName, setCustomName] = useState<string | null>(null);
  const [mode, setMode] = useState<"existing" | "new">(clients.length > 0 ? "existing" : "new");
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [clientName, setClientName] = useState("");
  const [clientType, setClientType] = useState<string>("residential");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [bid, setBid] = useState("");
  const [ownerId, setOwnerId] = useState(currentMemberId ?? "");
  const [latText, setLatText] = useState("");
  const [lngText, setLngText] = useState("");
  const [formError, setFormError] = useState("");
  const suggestedName = lookup?.line1 || lookup?.formatted || lookup?.addressText || "";
  const name = customName ?? suggestedName;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    if (address.trim() === "") {
      setFormError("Enter an address.");
      return;
    }
    if (!lookup || lookup.addressText !== address.trim()) {
      onLookup(address.trim());
      setFormError("Look up the address, then create the job.");
      return;
    }
    if (name.trim() === "") {
      setFormError("Enter a job name.");
      return;
    }
    let bidValueCents: number | null;
    try {
      bidValueCents = dollarsToCents(bid);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Enter a dollar amount.");
      return;
    }
    if (mode === "existing" && clientId === "") {
      setFormError("Choose a client.");
      return;
    }
    if (mode === "new" && clientName.trim() === "") {
      setFormError("Enter a client name.");
      return;
    }
    onCreate({
      name: name.trim(),
      address: address.trim(),
      point: lookup.point ?? readPin(latText, lngText),
      bidValueCents,
      ownerMemberId: ownerId || null,
      clientId: mode === "existing" ? clientId : null,
      client:
        mode === "new"
          ? { type: clientType, name: clientName.trim(), email: email.trim(), phone: phone.trim() }
          : null,
    });
  }

  const needsPin = lookup !== null && lookup.point === null;
  const shownError = formError || error;

  return (
    <form onSubmit={onSubmit} className="flex max-w-xl flex-col gap-4">
      <p className="max-w-prose text-base leading-relaxed">
        Start with the site address. The job name fills in from that address.
      </p>
      <TextField
        id="job-address"
        label="Site address"
        value={address}
        autoComplete="street-address"
        required
        onChange={(event) => setAddress(event.target.value)}
      />
      <div>
        <Button
          type="button"
          variant="secondary"
          disabled={lookingUp}
          onClick={() => onLookup(address.trim())}
        >
          Look up address
        </Button>
      </div>
      {lookup && lookup.addressText === address.trim() && lookup.formatted ? (
        <p role="status">Site: {lookup.formatted}</p>
      ) : null}
      {needsPin && lookup.addressText === address.trim() ? (
        <div className="flex flex-col gap-3">
          <p role="status">{lookup.warning ?? "Address could not be geocoded."}</p>
          <SiteMap
            enabled={mapEnabled}
            workspaceId={undefined}
            point={readPin(latText, lngText)}
            parcel={null}
            interactive
            onPick={(next) => {
              setLatText(String(next.lat));
              setLngText(String(next.lng));
            }}
          />
          <TextField
            id="pin-lat"
            label="Latitude"
            inputMode="decimal"
            value={latText}
            onChange={(event) => setLatText(event.target.value)}
          />
          <TextField
            id="pin-lng"
            label="Longitude"
            inputMode="decimal"
            value={lngText}
            onChange={(event) => setLngText(event.target.value)}
          />
          <p className="text-sm text-muted">
            Drop a pin on the map, or type a latitude and longitude. You can also create the job
            without a point.
          </p>
        </div>
      ) : null}
      <TextField
        id="job-name"
        label="Job name"
        value={name}
        required
        onChange={(event) => setCustomName(event.target.value)}
      />
      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold">Client</legend>
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="radio"
            name="client-mode"
            value="existing"
            className="h-5 w-5"
            checked={mode === "existing"}
            disabled={clients.length === 0}
            onChange={() => setMode("existing")}
          />
          Existing client
        </label>
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="radio"
            name="client-mode"
            value="new"
            className="h-5 w-5"
            checked={mode === "new"}
            onChange={() => setMode("new")}
          />
          New client
        </label>
      </fieldset>
      {mode === "existing" ? (
        <SelectField
          id="existing-client"
          label="Choose client"
          value={clientId}
          onChange={(event) => setClientId(event.target.value)}
        >
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </SelectField>
      ) : (
        <div className="flex flex-col gap-4">
          <TextField
            id="client-name"
            label="Client name"
            value={clientName}
            required
            onChange={(event) => setClientName(event.target.value)}
          />
          <SelectField
            id="client-type"
            label="Client type"
            value={clientType}
            onChange={(event) => setClientType(event.target.value)}
          >
            {CLIENT_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </SelectField>
          <TextField
            id="client-email"
            label="Email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <TextField
            id="client-phone"
            label="Phone"
            type="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        </div>
      )}
      <TextField
        id="bid-value"
        label={`Bid value (${currency})`}
        inputMode="decimal"
        value={bid}
        onChange={(event) => setBid(event.target.value)}
      />
      <SelectField
        id="job-owner"
        label="Owner"
        value={ownerId}
        onChange={(event) => setOwnerId(event.target.value)}
      >
        <option value="">Unassigned</option>
        {members.map((member) => (
          <option key={member.id} value={member.id}>
            {member.name || member.email || "Member"}
          </option>
        ))}
      </SelectField>
      {shownError ? (
        <p role="alert" className="text-base text-accent">
          {shownError}
        </p>
      ) : null}
      <Button type="submit" disabled={submitting || lookingUp}>
        Create job
      </Button>
    </form>
  );
}

function readPin(latText: string, lngText: string): LatLng | null {
  if (latText.trim() === "" || lngText.trim() === "") {
    return null;
  }
  const lat = Number(latText);
  const lng = Number(lngText);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null;
  }
  return { lat, lng };
}
