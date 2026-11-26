import { Button, Dialog, DialogContent, DialogTrigger, TextField } from "@groundwork/ui";

import {
  itemColor,
  liveTotal,
  showsServer,
  sourceBadge,
  summaryTotal,
  summaryUnion,
} from "./quantities";
import type { DrawTool, EditorFeature, SummaryItem, TakeoffItemRow } from "./types";

const TOOLS: { id: DrawTool; label: string }[] = [
  { id: "select", label: "Select" },
  { id: "polygon", label: "Polygon" },
  { id: "linestring", label: "Line" },
  { id: "point", label: "Point" },
  { id: "ruler", label: "Measure ruler" },
];

export function ToolBar({
  tool,
  readOnly,
  canFinish,
  onTool,
  onFinish,
}: {
  tool: DrawTool;
  readOnly: boolean;
  canFinish: boolean;
  onTool: (tool: DrawTool) => void;
  onFinish: () => void;
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
      <div>
        <Button
          type="button"
          variant="secondary"
          disabled={!canFinish || readOnly}
          onClick={onFinish}
        >
          Finish shape
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
  readOnly,
  onLabel,
  onDelete,
}: {
  feature: EditorFeature | null;
  itemName: string | null;
  readOnly: boolean;
  onLabel: (id: string, label: string) => void;
  onDelete: (id: string) => void;
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
      <TextField
        id="measurement-label"
        label="Label"
        value={feature.label ?? ""}
        maxLength={200}
        disabled={readOnly}
        onChange={(event) => onLabel(feature.id, event.target.value)}
      />
      <Button
        type="button"
        variant="secondary"
        disabled={readOnly}
        onClick={() => onDelete(feature.id)}
      >
        Delete measurement
      </Button>
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
        description="Server totals per takeoff item. The sum counts overlapping area twice. The union does not."
      >
        {items.length === 0 ? (
          <p>Save measurements to load server totals.</p>
        ) : (
          <table className="w-full text-left text-base">
            <caption className="sr-only">Quantity summary</caption>
            <thead>
              <tr>
                <th className="py-2 pr-3">Item</th>
                <th className="py-2 pr-3">Sum</th>
                <th className="py-2">Union</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.takeoff_item_id} className="border-t border-line">
                  <th scope="row" className="py-2 pr-3 font-semibold">
                    {item.name}
                  </th>
                  <td className="py-2 pr-3">{summaryTotal(item)}</td>
                  <td className="py-2">{summaryUnion(item)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DialogContent>
    </Dialog>
  );
}
