import type { ReactNode } from "react";

import { Button } from "@groundwork/ui";

import { EditableCell } from "./editable-cell";
import { formatCents, parseDollars, parseWaste } from "./money";
import type { CatalogItem, CatalogPatch } from "./types";

const wrap = "border-b border-line py-2 pr-2 align-top";
const head = "border-b border-line py-2 pr-2 text-left font-semibold";

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex min-h-11 items-center">
      <span className="sr-only">{label}</span>
      {value === "" ? "—" : value}
    </span>
  );
}

export function CatalogGrid({
  caption,
  items,
  canManage,
  onPatch,
  onOpen,
  onError,
  onSaved,
}: {
  caption: string;
  items: CatalogItem[];
  canManage: boolean;
  onPatch: (id: string, patch: CatalogPatch) => Promise<void>;
  onOpen: (item: CatalogItem) => void;
  onError: (message: string) => void;
  onSaved: () => void;
}) {
  async function commit(item: CatalogItem, patch: CatalogPatch | null, invalid?: string) {
    if (invalid) {
      onError(invalid);
      return;
    }
    if (!patch) {
      return;
    }
    try {
      await onPatch(item.id, patch);
      onSaved();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not save the catalog item.");
    }
  }

  const columns: {
    header: string;
    cell: (item: CatalogItem, row: number, col: number) => ReactNode;
  }[] = [
    {
      header: "SKU",
      cell: (item, row, col) =>
        canManage ? (
          <EditableCell
            grid="catalog"
            row={row}
            col={col}
            id={`sku-${item.id}`}
            label={`SKU for ${item.name}`}
            value={item.sku ?? ""}
            onCommit={(text) => {
              const sku = text.trim() === "" ? null : text.trim();
              if (sku === item.sku) {
                return;
              }
              void commit(item, { sku });
            }}
          />
        ) : (
          <ReadOnly label={`SKU for ${item.name}`} value={item.sku ?? ""} />
        ),
    },
    {
      header: "Name",
      cell: (item, row, col) =>
        canManage ? (
          <EditableCell
            grid="catalog"
            row={row}
            col={col}
            id={`name-${item.id}`}
            label={`Name for ${item.name}`}
            value={item.name}
            onCommit={(text) => {
              const name = text.trim();
              if (name === "") {
                void commit(item, null, "Name is required.");
                return;
              }
              if (name === item.name) {
                return;
              }
              void commit(item, { name });
            }}
          />
        ) : (
          <ReadOnly label={`Name for ${item.name}`} value={item.name} />
        ),
    },
    {
      header: "Unit",
      cell: (item, row, col) =>
        canManage ? (
          <EditableCell
            grid="catalog"
            row={row}
            col={col}
            id={`unit-${item.id}`}
            label={`Unit for ${item.name}`}
            value={item.unit}
            onCommit={(text) => {
              const unit = text.trim();
              if (unit === "") {
                void commit(item, null, "Unit is required.");
                return;
              }
              if (unit === item.unit) {
                return;
              }
              void commit(item, { unit });
            }}
          />
        ) : (
          <ReadOnly label={`Unit for ${item.name}`} value={item.unit} />
        ),
    },
  ];

  if (canManage) {
    columns.push({
      header: "Unit cost",
      cell: (item, row, col) => (
        <EditableCell
          grid="catalog"
          row={row}
          col={col}
          id={`cost-${item.id}`}
          label={`Unit cost for ${item.name}`}
          value={formatCents(item.unit_cost_cents ?? 0)}
          inputMode="decimal"
          onCommit={(text) => {
            const cents = parseDollars(text);
            if (cents === null) {
              void commit(item, null, `${item.name} unit cost must be a dollar amount like 12.50.`);
              return;
            }
            if (cents === (item.unit_cost_cents ?? 0)) {
              return;
            }
            void commit(item, { unit_cost_cents: cents });
          }}
        />
      ),
    });
  }

  columns.push({
    header: "Sell price",
    cell: (item, row, col) =>
      canManage ? (
        <EditableCell
          grid="catalog"
          row={row}
          col={col}
          id={`price-${item.id}`}
          label={`Sell price for ${item.name}`}
          value={formatCents(item.unit_price_cents)}
          inputMode="decimal"
          onCommit={(text) => {
            const cents = parseDollars(text);
            if (cents === null) {
              void commit(
                item,
                null,
                `${item.name} sell price must be a dollar amount like 12.50.`,
              );
              return;
            }
            if (cents === item.unit_price_cents) {
              return;
            }
            void commit(item, { unit_price_cents: cents });
          }}
        />
      ) : (
        <ReadOnly
          label={`Sell price for ${item.name}`}
          value={formatCents(item.unit_price_cents)}
        />
      ),
  });

  columns.push({
    header: "Waste %",
    cell: (item, row, col) =>
      canManage ? (
        <EditableCell
          grid="catalog"
          row={row}
          col={col}
          id={`waste-${item.id}`}
          label={`Waste percent for ${item.name}`}
          value={item.waste_pct}
          inputMode="decimal"
          onCommit={(text) => {
            const waste = parseWaste(text);
            if (waste === null) {
              void commit(item, null, `${item.name} waste percent must be from 0 to 100.`);
              return;
            }
            if (waste === item.waste_pct) {
              return;
            }
            void commit(item, { waste_pct: waste });
          }}
        />
      ) : (
        <ReadOnly label={`Waste percent for ${item.name}`} value={item.waste_pct} />
      ),
  });

  columns.push({
    header: "Vendor",
    cell: (item, row, col) =>
      canManage ? (
        <EditableCell
          grid="catalog"
          row={row}
          col={col}
          id={`vendor-${item.id}`}
          label={`Vendor for ${item.name}`}
          value={item.vendor ?? ""}
          onCommit={(text) => {
            const vendor = text.trim() === "" ? null : text.trim();
            if (vendor === item.vendor) {
              return;
            }
            void commit(item, { vendor });
          }}
        />
      ) : (
        <ReadOnly label={`Vendor for ${item.name}`} value={item.vendor ?? ""} />
      ),
  });

  if (items.length === 0) {
    return <p>No {caption.toLowerCase()} yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table data-grid="catalog" className="w-full border-collapse text-left text-base">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.header} scope="col" className={head}>
                {column.header}
              </th>
            ))}
            <th scope="col" className={head}>
              Details
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, row) => (
            <tr key={item.id}>
              {columns.map((column, col) => (
                <td key={column.header} className={wrap}>
                  {column.cell(item, row, col)}
                </td>
              ))}
              <td className={wrap}>
                <Button variant="secondary" onClick={() => onOpen(item)}>
                  Details for {item.name}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
