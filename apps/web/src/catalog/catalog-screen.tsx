import { useState, type FormEvent } from "react";

import {
  Button,
  Dialog,
  DialogContent,
  TabList,
  TabTrigger,
  Tabs,
  TextField,
} from "@groundwork/ui";

import { CatalogGrid } from "./catalog-grid";
import { ItemDrawerForm } from "./catalog-drawer";
import { ImportPanel } from "./import-panel";
import { parseDollars } from "./money";
import {
  CATALOG_KINDS,
  DEFAULT_CATALOG_UNIT,
  KIND_LABEL,
  isCatalogKind,
  type CatalogCreate,
  type CatalogItem,
  type CatalogKind,
  type CatalogPatch,
  type ImportPlan,
  type StarterResult,
} from "./types";

export function CatalogScreen({
  kind,
  onKind,
  items,
  loading,
  canManage,
  onCreate,
  onPatch,
  onRemove,
  onExport,
  onPreviewImport,
  onApplyImport,
  onStarter,
}: {
  kind: CatalogKind;
  onKind: (kind: CatalogKind) => void;
  items: CatalogItem[];
  loading: boolean;
  canManage: boolean;
  onCreate: (body: CatalogCreate) => Promise<void>;
  onPatch: (id: string, patch: CatalogPatch) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onExport: () => Promise<void>;
  onPreviewImport: (csv: string) => Promise<ImportPlan>;
  onApplyImport: (csv: string) => Promise<void>;
  onStarter: () => Promise<StarterResult>;
}) {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const visible = items.filter((item) => item.kind === kind);
  const detail = items.find((item) => item.id === detailId) ?? null;
  const counts = new Map<CatalogKind, number>();
  for (const item of items) {
    counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  }

  async function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    const unit = String(data.get("unit") ?? "").trim();
    const cost = parseDollars(String(data.get("cost") ?? "")) ?? 0;
    const price = parseDollars(String(data.get("price") ?? "")) ?? 0;
    const costText = String(data.get("cost") ?? "").trim();
    const priceText = String(data.get("price") ?? "").trim();
    if (name === "" || unit === "") {
      setError("Name and unit are required.");
      return;
    }
    if (
      (costText !== "" && parseDollars(costText) === null) ||
      (priceText !== "" && parseDollars(priceText) === null)
    ) {
      setError("Cost and sell price are dollar amounts like 12.50.");
      return;
    }
    try {
      await onCreate({
        kind,
        name,
        unit,
        unit_cost_cents: cost,
        unit_price_cents: price,
        sku: String(data.get("sku") ?? "").trim() || null,
      });
      form.reset();
      setNotice("Saved.");
    } catch (err) {
      setNotice("");
      setError(err instanceof Error ? err.message : "Could not add the item.");
    }
  }

  async function starter() {
    setBusy(true);
    setError("");
    try {
      const result = await onStarter();
      setNotice(
        `Added ${result.catalog_created.length} catalog items, ${result.takeoff_created.length} takeoff items, and ${result.recipes_created.length} recipes. Skipped ${result.catalog_skipped.length} catalog items already in the workspace.`,
      );
    } catch (err) {
      setNotice("");
      setError(err instanceof Error ? err.message : "Could not load the starter pack.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-prose text-base leading-relaxed">
        Materials, labor, equipment, subs, and fees for this workspace. Sell price stays visible.
        Unit cost is shown to people who can manage the catalog.
      </p>
      {error ? (
        <p role="alert" className="text-base text-accent">
          {error}
        </p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      <Tabs
        value={kind}
        onValueChange={(value) => {
          if (isCatalogKind(value)) {
            onKind(value);
          }
        }}
      >
        <TabList label="Catalog kind">
          {CATALOG_KINDS.map((item) => (
            <TabTrigger key={item} value={item}>
              {KIND_LABEL[item]} ({counts.get(item) ?? 0})
            </TabTrigger>
          ))}
        </TabList>
      </Tabs>
      {canManage ? (
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" disabled={busy} onClick={() => void starter()}>
            Load starter pack
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              void onExport().catch((err: unknown) => {
                setError(err instanceof Error ? err.message : "Could not export the catalog.");
              });
            }}
          >
            Export CSV
          </Button>
          <Button variant="secondary" onClick={() => setImportOpen(true)}>
            Import CSV
          </Button>
        </div>
      ) : null}
      {canManage ? (
        <form key={kind} onSubmit={addItem} className="grid gap-4 md:grid-cols-2">
          <TextField id="new-name" name="name" label="New item name" required />
          <TextField
            id="new-unit"
            name="unit"
            label="New item unit"
            defaultValue={DEFAULT_CATALOG_UNIT[kind]}
            required
          />
          <TextField id="new-sku" name="sku" label="New item SKU" />
          <TextField
            id="new-cost"
            name="cost"
            label="New item unit cost"
            inputMode="decimal"
            placeholder="0.00"
          />
          <TextField
            id="new-price"
            name="price"
            label="New item sell price"
            inputMode="decimal"
            placeholder="0.00"
          />
          <div className="flex items-end">
            <Button type="submit">Add item</Button>
          </div>
        </form>
      ) : null}
      {loading ? (
        <p>Loading catalog.</p>
      ) : (
        <CatalogGrid
          caption={KIND_LABEL[kind]}
          items={visible}
          canManage={canManage}
          onPatch={async (id, patch) => {
            setError("");
            await onPatch(id, patch);
            setNotice("Saved.");
          }}
          onOpen={(item) => setDetailId(item.id)}
          onError={(message) => {
            setNotice("");
            setError(message);
          }}
          onSaved={() => setNotice("Saved.")}
        />
      )}
      <Dialog open={detail !== null} onOpenChange={(open) => !open && setDetailId(null)}>
        {detail ? (
          <DialogContent placement="end" title={detail.name} description="Catalog item details.">
            <ItemDrawerForm
              key={detail.id}
              item={detail}
              canManage={canManage}
              onPatch={onPatch}
              onRemove={onRemove}
              onClose={() => setDetailId(null)}
            />
          </DialogContent>
        ) : null}
      </Dialog>
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent
          title="Import CSV"
          description="Preview the SKU add and update diff before anything is written. The header is sku, kind, name, unit, unit_cost_cents, unit_price_cents, waste_pct, vendor, tax_code."
        >
          <ImportPanel
            onPreview={onPreviewImport}
            onApply={async (csv) => {
              await onApplyImport(csv);
              setImportOpen(false);
              setNotice("Saved.");
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
