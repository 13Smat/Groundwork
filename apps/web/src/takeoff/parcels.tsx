import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { message } from "../crm/messages";
import { api } from "../session";

export type ParcelHit = {
  id: string;
  provider: string;
  provider_parcel_id: string;
  geom: {
    type: "MultiPolygon";
    coordinates: number[][][][];
  };
  attrs: Record<string, unknown>;
};

export function siteBbox(point: { lat: number; lng: number }, pad = 0.002): string {
  return [point.lng - pad, point.lat - pad, point.lng + pad, point.lat + pad].join(",");
}

export function ParcelSelect({
  locationId,
  point,
  onChange,
}: {
  locationId: string;
  point: { lat: number; lng: number } | null;
  onChange: (parcels: readonly { hit: ParcelHit; selected: boolean }[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const bbox = point ? siteBbox(point) : "";
  const parcels = useQuery({
    queryKey: ["location-parcels", locationId, bbox],
    queryFn: () =>
      api<{ parcels: ParcelHit[] }>(
        `/locations/${locationId}/parcels?bbox=${encodeURIComponent(bbox)}`,
      ),
    enabled: open && Boolean(locationId) && bbox !== "",
  });

  useEffect(() => {
    if (!open) {
      onChange([]);
      return;
    }
    const rows = parcels.data?.parcels ?? [];
    onChange(rows.map((hit) => ({ hit, selected: selected.has(hit.id) })));
  }, [onChange, open, parcels.data, selected]);

  function toggle(id: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  const rows = parcels.data?.parcels ?? [];

  return (
    <section aria-label="Parcels" className="flex flex-col gap-2">
      <button
        type="button"
        className="min-h-11 w-fit rounded-md px-3 text-base font-semibold ring-1 ring-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        aria-pressed={open}
        onClick={() => setOpen((current) => !current)}
      >
        Select parcels
      </button>
      {open ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">
            Selected parcels are a reference. Measurements are not clipped to them.
          </p>
          {parcels.isLoading ? <p>Loading parcels.</p> : null}
          {parcels.isError ? (
            <p role="alert" className="text-base text-accent">
              {message(parcels.error, "Could not load parcels.")}
            </p>
          ) : null}
          {parcels.isSuccess && rows.length === 0 ? <p>No parcels in this view.</p> : null}
          {rows.length > 0 ? (
            <ul aria-label="Parcels in view" className="flex flex-col gap-2">
              {rows.map((row) => (
                <li key={row.id}>
                  <label className="flex min-h-11 items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-5 w-5"
                      checked={selected.has(row.id)}
                      aria-label={`Select parcel ${row.provider_parcel_id}`}
                      onChange={(event) => toggle(row.id, event.target.checked)}
                    />
                    <span>{row.provider_parcel_id}</span>
                  </label>
                </li>
              ))}
            </ul>
          ) : null}
          <p role="status">{selected.size} parcels selected</p>
        </div>
      ) : null}
    </section>
  );
}
