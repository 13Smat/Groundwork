import { Button, Dialog, DialogContent, DialogTrigger, TextField } from "@groundwork/ui";
import { useState } from "react";

import {
  correctionNotice,
  itemColor,
  liveTotal,
  overlapNotice,
  showsServer,
  sourceBadge,
  summaryQuantity,
  summaryTotal,
  type SummaryMode,
} from "./quantities";
import type { DrawTool, EditorFeature, SummaryItem, TakeoffItemRow } from "./types";

const TOOLS: { id: DrawTool; label: string }[] = [
  { id: "select", label: "Select" },
  { id: "polygon", label: "Polygon" },
  { id: "hole", label: "Hole" },
  { id: "linestring", label: "Line" },
  { id: "point", label: "Point" },
  { id: "split", label: "Split" },
  { id: "ruler", label: "Measure ruler" },
];

export function ToolBar({
  tool,
  readOnly,
  canFinish,
  snap,
  canUndo,
  canRedo,
  onTool,
  onFinish,
  onSnap,
  onUndo,
  onRedo,
}: {
  tool: DrawTool;
  readOnly: boolean;
  canFinish: boolean;
  snap: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onTool: (tool: DrawTool) => void;
  onFinish: () => void;
  onSnap: (enabled: boolean) => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex flex-wrap gap-3">
        <legend className="text-sm font-semibold">Drawing tool</legend>
        {TOOLS.map((item) => (
          <label key={item.id} className="flex min-h-11 items-center gap-2">
            <input
              type="radio"
              name="draw-tool"
              value={item.id}
              className="h-5 w-5"
              checked={tool === item.id}
              disabled={readOnly && item.id !== "select"}
              onChange={() => onTool(item.id)}
            />
            {item.label}
          </label>
        ))}
      </fieldset>
      <label className="flex min-h-11 items-center gap-2">
        <input
          type="checkbox"
          className="h-5 w-5"
          checked={snap}
          disabled={readOnly}
          onChange={(event) => onSnap(event.target.checked)}
        />
        Snap to vertices and edges
      </label>
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="secondary"
          disabled={!canFinish || readOnly}
          onClick={onFinish}
        >
          Finish shape
        </Button>
        <Button type="button" variant="secondary" disabled={!canUndo || readOnly} onClick={onUndo}>
          Undo
        </Button>
        <Button type="button" variant="secondary" disabled={!canRedo || readOnly} onClick={onRedo}>
          Redo
        </Button>
      </div>
    </div>
  );
}

export function ItemPanel({
  items,
  features,
  summary,
  selectedItemId,
  hiddenItemIds,
  onSelectItem,
  onToggle,
}: {
  items: readonly TakeoffItemRow[];
  features: readonly EditorFeature[];
  summary: readonly SummaryItem[];
  selectedItemId: string | null;
  hiddenItemIds: ReadonlySet<string>;
  onSelectItem: (id: string) => void;
  onToggle: (id: string, hidden: boolean) => void;
}) {
  return (
    <section aria-label="Takeoff items" className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Takeoff items</h2>
      {items.length === 0 ? <p>No takeoff items yet. Load them from the catalog.</p> : null}
      <ul className="flex flex-col gap-3">
        {items.map((item, index) => {
          const own = features.filter((feature) => feature.itemId === item.id);
          const row = summary.find((entry) => entry.takeoff_item_id === item.id);
          const total =
            own.length > 0 && own.every(showsServer) && row
              ? `Server total ${summaryTotal(row)}`
              : own.length > 0
                ? `Live total ${liveTotal(
                    item.measure_kind,
                    own.map((feature) => feature.geometry),
                  )}`
                : "No measurements";
          return (
            <li key={item.id} className="flex flex-col gap-1 rounded-md border border-line p-2">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-block h-4 w-4 shrink-0 rounded-sm border border-line"
                  style={{ backgroundColor: itemColor(item.color, index) }}
                />
                <button
                  type="button"
                  className="min-h-11 flex-1 text-left text-base font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                  aria-pressed={selectedItemId === item.id}
                  onClick={() => onSelectItem(item.id)}
                >
                  {item.name}
                </button>
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={!hiddenItemIds.has(item.id)}
                  aria-label={`Show ${item.name}`}
                  onChange={(event) => onToggle(item.id, !event.target.checked)}
                />
              </div>
              <p className="text-base">{total}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function FeaturePanel({
  feature,
  itemName,
  items,
  readOnly,
  canMerge,
  onLabel,
  onDelete,
  onRetag,
  onMerge,
}: {
  feature: EditorFeature | null;
  itemName: string | null;
  items: readonly TakeoffItemRow[];
  readOnly: boolean;
  canMerge: boolean;
  onLabel: (id: string, label: string) => void;
  onDelete: (id: string) => void;
  onRetag: (id: string, itemId: string) => void;
  onMerge: () => void;
}) {
  if (!feature) {
    return (
      <section aria-label="Selected measurement" className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Measurement</h2>
        <p>Select a measurement to see its quantity.</p>
      </section>
    );
  }
  return (
    <section aria-label="Selected measurement" className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Measurement</h2>
      <p>{itemName ?? "Takeoff item"}</p>
      <p>
        Source <span className="font-semibold">{sourceBadge(feature.source)}</span>
      </p>
      <QuantityLines feature={feature} />
      <label className="flex flex-col gap-1 text-base" htmlFor="measurement-item">
        <span className="text-sm font-semibold">Takeoff item</span>
        <select
          id="measurement-item"
          className="min-h-11 rounded-md border border-line bg-paper px-2"
          value={feature.itemId}
          disabled={readOnly}
          onChange={(event) => onRetag(feature.id, event.target.value)}
        >
          {items
            .filter((item) => item.measure_kind === feature.kind && item.archived_at === null)
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
        </select>
      </label>
      <TextField
        id="measurement-label"
        label="Label"
        value={feature.label ?? ""}
        maxLength={200}
        disabled={readOnly}
        onChange={(event) => onLabel(feature.id, event.target.value)}
      />
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="secondary"
          disabled={readOnly || !canMerge}
          onClick={onMerge}
        >
          Merge with another
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={readOnly}
          onClick={() => onDelete(feature.id)}
        >
          Delete measurement
        </Button>
      </div>
    </section>
  );
}

function QuantityLines({ feature }: { feature: EditorFeature }) {
  if (showsServer(feature) && feature.server) {
    const display = feature.server.display;
    if (feature.kind === "area") {
      return (
        <dl className="grid gap-1">
          <div>
            <dt className="text-sm font-semibold">Server area</dt>
            <dd>{display.ft2 ?? "—"} ft²</dd>
          </div>
          <div>
            <dt className="text-sm font-semibold">Server square yards</dt>
            <dd>{display.yd2 ?? "—"} yd²</dd>
          </div>
          <div>
            <dt className="text-sm font-semibold">Server acres</dt>
            <dd>{display.acres ?? "—"} acres</dd>
          </div>
        </dl>
      );
    }
    if (feature.kind === "length") {
      return <p>Server length {display.ft ?? "—"} ft</p>;
    }
    return <p>Server count {feature.server.count ?? 0}</p>;
  }
  return <p>Live quantity {liveTotal(feature.kind, [feature.geometry])}</p>;
}

export function SummaryDrawer({ items }: { items: readonly SummaryItem[] }) {
  const [mode, setMode] = useState<SummaryMode>("sum");
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="secondary">
          Quantity summary
        </Button>
      </DialogTrigger>
      <DialogContent
        placement="end"
        title="Quantity summary"
        description="Server totals per takeoff item. Sum counts overlapping area twice. Union per item does not."
      >
        <fieldset className="mb-3 flex flex-wrap gap-3">
          <legend className="text-sm font-semibold">Quantity</legend>
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="radio"
              name="summary-mode"
              className="h-5 w-5"
              checked={mode === "sum"}
              onChange={() => setMode("sum")}
            />
            Sum
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="radio"
              name="summary-mode"
              className="h-5 w-5"
              checked={mode === "union"}
              onChange={() => setMode("union")}
            />
            Union per item
          </label>
        </fieldset>
        {items.length === 0 ? (
          <p>Save measurements to load server totals.</p>
        ) : (
          <table className="w-full text-left text-base">
            <caption className="sr-only">Quantity summary</caption>
            <thead>
              <tr>
                <th className="py-2 pr-3">Item</th>
                <th className="py-2">{mode === "sum" ? "Sum" : "Union"}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.takeoff_item_id} className="border-t border-line">
                  <th scope="row" className="py-2 pr-3 font-semibold">
                    {item.name}
                    {item.overlap_count > 0 ? (
                      <span className="mt-1 block text-sm font-normal">
                        Overlaps another measurement
                      </span>
                    ) : null}
                  </th>
                  <td className="py-2">{summaryQuantity(item, mode)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function MeasurementWarnings({
  corrections,
  overlaps,
}: {
  corrections: number;
  overlaps: number;
}) {
  const correction = correctionNotice(corrections);
  const overlap = overlapNotice(overlaps);
  if (!correction && !overlap) {
    return null;
  }
  return (
    <div role="status" className="flex flex-col gap-1">
      {correction ? <p>{correction}</p> : null}
      {overlap ? <p>{overlap}</p> : null}
    </div>
  );
}
