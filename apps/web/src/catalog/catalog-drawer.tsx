import { useState, type FormEvent } from "react";

import { Button, SelectField, TextField } from "@groundwork/ui";

import { formatCents, parseDollars, parseWaste } from "./money";
import {
  CATALOG_KINDS,
  KIND_LABEL,
  type CatalogItem,
  type CatalogKind,
  type CatalogPatch,
} from "./types";

export function ItemDrawerForm({
  item,
  canManage,
  onPatch,
  onRemove,
  onClose,
}: {
  item: CatalogItem;
  canManage: boolean;
  onPatch: (id: string, patch: CatalogPatch) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage) {
      return;
    }
    setError("");
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const unit = String(form.get("unit") ?? "").trim();
    const price = parseDollars(String(form.get("price") ?? ""));
    const waste = parseWaste(String(form.get("waste") ?? ""));
    const kind = String(form.get("kind") ?? item.kind) as CatalogKind;
    if (name === "" || unit === "") {
      setError("Name and unit are required.");
      return;
    }
    if (price === null || waste === null) {
      setError("Sell price is a dollar amount. Waste percent is from 0 to 100.");
      return;
    }
    const patch: CatalogPatch = {
      kind,
      name,
      unit,
      sku: String(form.get("sku") ?? "").trim() || null,
      vendor: String(form.get("vendor") ?? "").trim() || null,
      tax_code: String(form.get("tax") ?? "").trim() || null,
      unit_price_cents: price,
      waste_pct: waste,
    };
    if (canManage) {
      const cost = parseDollars(String(form.get("cost") ?? ""));
      if (cost === null) {
        setError("Unit cost is a dollar amount like 12.50.");
        return;
      }
      patch.unit_cost_cents = cost;
    }
    setBusy(true);
    try {
      await onPatch(item.id, patch);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the item.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError("");
    try {
      await onRemove(item.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove the item.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <SelectField
        id="detail-kind"
        name="kind"
        label="Kind"
        defaultValue={item.kind}
        disabled={!canManage}
      >
        {CATALOG_KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {KIND_LABEL[kind]}
          </option>
        ))}
      </SelectField>
      <TextField
        id="detail-name"
        name="name"
        label="Item name"
        defaultValue={item.name}
        required
        readOnly={!canManage}
      />
      <TextField
        id="detail-unit"
        name="unit"
        label="Item unit"
        defaultValue={item.unit}
        required
        readOnly={!canManage}
      />
      <TextField
        id="detail-sku"
        name="sku"
        label="Item SKU"
        defaultValue={item.sku ?? ""}
        readOnly={!canManage}
      />
      {canManage ? (
        <TextField
          id="detail-cost"
          name="cost"
          label="Item unit cost"
          defaultValue={formatCents(item.unit_cost_cents ?? 0)}
          inputMode="decimal"
          required
        />
      ) : null}
      <TextField
        id="detail-price"
        name="price"
        label="Item sell price"
        defaultValue={formatCents(item.unit_price_cents)}
        inputMode="decimal"
        required
        readOnly={!canManage}
      />
      <TextField
        id="detail-waste"
        name="waste"
        label="Waste percent"
        defaultValue={item.waste_pct}
        inputMode="decimal"
        required
        readOnly={!canManage}
      />
      <TextField
        id="detail-vendor"
        name="vendor"
        label="Vendor"
        defaultValue={item.vendor ?? ""}
        readOnly={!canManage}
      />
      <TextField
        id="detail-tax"
        name="tax"
        label="Tax code"
        defaultValue={item.tax_code ?? ""}
        readOnly={!canManage}
      />
      {error ? (
        <p role="alert" className="text-base text-accent">
          {error}
        </p>
      ) : null}
      {canManage ? (
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={busy}>
            Save details
          </Button>
          {confirming ? (
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void remove()}>
              Confirm remove
            </Button>
          ) : (
            <Button type="button" variant="secondary" onClick={() => setConfirming(true)}>
              Remove item
            </Button>
          )}
        </div>
      ) : null}
      {confirming ? (
        <p>A recipe that uses this item archives it. Otherwise it is deleted.</p>
      ) : null}
    </form>
  );
}
