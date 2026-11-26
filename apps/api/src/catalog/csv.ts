import { catalogKindSchema } from "@groundwork/shared";

export const CSV_COLUMNS = [
  "sku",
  "kind",
  "name",
  "unit",
  "unit_cost_cents",
  "unit_price_cents",
  "waste_pct",
  "vendor",
  "tax_code",
] as const;

export type CsvColumn = (typeof CSV_COLUMNS)[number];

export type CatalogCsvRow = {
  sku: string;
  kind: string;
  name: string;
  unit: string;
  unit_cost_cents: string;
  unit_price_cents: string;
  waste_pct: string;
  vendor: string | null;
  tax_code: string | null;
};

export type CsvChange = { from: string | null; to: string | null };

export type CatalogCsvPlan = {
  created: CatalogCsvRow[];
  updated: { sku: string; changes: Record<string, CsvChange> }[];
  unchanged: string[];
  errors: { row: number; message: string }[];
};

type ParsedRow = { line: number; cells: string[] };

const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

export function sameDecimal(left: string, right: string): boolean {
  return normalizeDecimal(left) !== null && normalizeDecimal(left) === normalizeDecimal(right);
}

function normalizeDecimal(value: string): string | null {
  if (!DECIMAL.test(value)) {
    return null;
  }
  const [wholeRaw = "0", fracRaw = ""] = value.split(".");
  const whole = wholeRaw.replace(/^0+/, "") || "0";
  const frac = fracRaw.replace(/0+$/, "");
  if (whole === "0" && frac === "") {
    return "0";
  }
  return frac === "" ? whole : `${whole}.${frac}`;
}

function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function parseCsv(text: string): { header: string[]; rows: ParsedRow[] } {
  const input = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const table: ParsedRow[] = [];
  let cells: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let fieldLine = 1;

  const pushField = () => {
    cells.push(field);
    field = "";
  };
  const pushRow = () => {
    if (!(cells.length === 1 && cells[0] === "")) {
      table.push({ line: fieldLine, cells });
    }
    cells = [];
    fieldLine = line + 1;
  };

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
          continue;
        }
        quoted = false;
        continue;
      }
      if (char === "\n") {
        line += 1;
      }
      field += char;
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      pushField();
      continue;
    }
    if (char === "\n") {
      pushField();
      pushRow();
      line += 1;
      continue;
    }
    field += char;
  }
  if (quoted) {
    throw new Error("CSV quote was not closed.");
  }
  if (field.length > 0 || cells.length > 0) {
    pushField();
    pushRow();
  }
  const headerRow = table[0];
  if (!headerRow) {
    throw new Error("CSV is empty.");
  }
  return {
    header: headerRow.cells.map((cell) => cell.trim()),
    rows: table.slice(1),
  };
}

function escapeCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

export function serializeCatalogCsv(rows: readonly CatalogCsvRow[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.sku,
        row.kind,
        row.name,
        row.unit,
        row.unit_cost_cents,
        row.unit_price_cents,
        row.waste_pct,
        row.vendor ?? "",
        row.tax_code ?? "",
      ]
        .map((cell) => escapeCell(cell))
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

function rowFromCells(
  line: number,
  header: string[],
  cells: string[],
): CatalogCsvRow | { error: string } {
  const byName = new Map<string, string>();
  header.forEach((name, index) => {
    byName.set(name, cells[index] ?? "");
  });
  const read = (name: CsvColumn) => (byName.get(name) ?? "").trim();
  const sku = read("sku");
  if (sku === "") {
    return { error: "SKU is required." };
  }
  if (sku.length > 80) {
    return { error: "SKU is too long." };
  }
  const kind = read("kind");
  if (!catalogKindSchema.safeParse(kind).success) {
    return { error: `Unknown kind ${kind}.` };
  }
  const name = read("name");
  if (name === "" || name.length > 200) {
    return { error: "Name is required." };
  }
  const unit = read("unit");
  if (unit === "" || unit.length > 40) {
    return { error: "Unit is required." };
  }
  const cost = read("unit_cost_cents");
  const price = read("unit_price_cents");
  if (!/^(?:0|[1-9]\d*)$/.test(cost) || !/^(?:0|[1-9]\d*)$/.test(price)) {
    return { error: "Costs and prices must be integer cents." };
  }
  const waste = read("waste_pct") === "" ? "0" : read("waste_pct");
  const wasteNormal = normalizeDecimal(waste);
  if (
    wasteNormal === null ||
    Number(waste) < 0 ||
    Number(waste) > 100 ||
    (waste.split(".")[1]?.length ?? 0) > 2
  ) {
    return { error: "Waste percent must be from 0 to 100 with at most two decimal places." };
  }
  const vendor = blankToNull(read("vendor"));
  const tax = blankToNull(read("tax_code"));
  if ((vendor && vendor.length > 200) || (tax && tax.length > 40)) {
    return { error: "Vendor or tax code is too long." };
  }
  return {
    sku,
    kind,
    name,
    unit,
    unit_cost_cents: cost,
    unit_price_cents: price,
    waste_pct: wasteNormal,
    vendor,
    tax_code: tax,
  };
}

function changesBetween(current: CatalogCsvRow, next: CatalogCsvRow): Record<string, CsvChange> {
  const changes: Record<string, CsvChange> = {};
  const fields: (keyof CatalogCsvRow)[] = [
    "kind",
    "name",
    "unit",
    "unit_cost_cents",
    "unit_price_cents",
    "waste_pct",
    "vendor",
    "tax_code",
  ];
  for (const field of fields) {
    const from = current[field];
    const to = next[field];
    const same =
      field === "waste_pct" ? sameDecimal(String(from), String(to)) : (from ?? "") === (to ?? "");
    if (!same) {
      changes[field] = { from: from ?? null, to: to ?? null };
    }
  }
  return changes;
}

export function planCatalogImport(csv: string, existing: readonly CatalogCsvRow[]): CatalogCsvPlan {
  let parsed: { header: string[]; rows: ParsedRow[] };
  try {
    parsed = parseCsv(csv);
  } catch (error) {
    const message = error instanceof Error ? error.message : "CSV could not be read.";
    return { created: [], updated: [], unchanged: [], errors: [{ row: 1, message }] };
  }
  const missing = CSV_COLUMNS.filter((column) => !parsed.header.includes(column));
  if (missing.length > 0) {
    return {
      created: [],
      updated: [],
      unchanged: [],
      errors: [{ row: 1, message: `CSV is missing ${missing.join(", ")}.` }],
    };
  }
  const bySku = new Map(existing.map((row) => [row.sku, row]));
  const seen = new Set<string>();
  const plan: CatalogCsvPlan = { created: [], updated: [], unchanged: [], errors: [] };
  for (const row of parsed.rows) {
    const parsedRow = rowFromCells(row.line, parsed.header, row.cells);
    if ("error" in parsedRow) {
      plan.errors.push({ row: row.line, message: parsedRow.error });
      continue;
    }
    if (seen.has(parsedRow.sku)) {
      plan.errors.push({ row: row.line, message: `Duplicate SKU ${parsedRow.sku}.` });
      continue;
    }
    seen.add(parsedRow.sku);
    const current = bySku.get(parsedRow.sku);
    if (!current) {
      plan.created.push(parsedRow);
      continue;
    }
    const changes = changesBetween(current, parsedRow);
    if (Object.keys(changes).length === 0) {
      plan.unchanged.push(parsedRow.sku);
    } else {
      plan.updated.push({ sku: parsedRow.sku, changes });
    }
  }
  return plan;
}
