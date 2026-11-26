import { Button, TextField } from "@groundwork/ui";
import { type FormEvent, useState } from "react";

import { formatCents } from "../crm/format";
import { groupLines, overrideMap, variableKeys } from "./group";
import type { EstimateLine } from "./types";

const inputClass =
  "min-h-11 w-24 rounded-md border border-line bg-paper px-2 text-base text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

export function LineTable({
  lines,
  currency,
  showCost,
  editable,
  onOverride,
  onOptional,
}: {
  lines: readonly EstimateLine[];
  currency: string;
  showCost: boolean;
  editable: boolean;
  onOverride: (line: EstimateLine, variables: Record<string, string>) => Promise<boolean | void>;
  onOptional: (line: EstimateLine, optional: boolean) => Promise<boolean | void>;
}) {
  const groups = groupLines(lines);
  const columns = 6 + (showCost ? 2 : 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-base">
        <caption className="sr-only">Estimate lines by takeoff item</caption>
        <thead>
          <tr>
            {[
              "Description",
              "Qty",
              "Unit",
              ...(showCost ? ["Unit cost"] : []),
              "Unit price",
              "Total",
              ...(showCost ? ["Margin"] : []),
              "Source",
              "Alternate",
            ].map((label) => (
              <th key={label} scope="col" className="border-b border-line py-2 pr-3 text-left">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.key}>
            <tr>
              <th scope="rowgroup" colSpan={columns} className="bg-paper py-3 text-left text-lg">
                {group.title}
                {group.lines[0]?.input_qty ? (
                  <span className="ml-2 text-base font-normal">
                    {group.lines[0].input_qty} {group.lines[0].input_unit}
                  </span>
                ) : null}
              </th>
            </tr>
            {group.lines.map((line) => (
              <LineRow
                key={line.id}
                line={line}
                currency={currency}
                showCost={showCost}
                editable={editable}
                onOverride={onOverride}
                onOptional={onOptional}
              />
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function LineRow({
  line,
  currency,
  showCost,
  editable,
  onOverride,
  onOptional,
}: {
  line: EstimateLine;
  currency: string;
  showCost: boolean;
  editable: boolean;
  onOverride: (line: EstimateLine, variables: Record<string, string>) => Promise<boolean | void>;
  onOptional: (line: EstimateLine, optional: boolean) => Promise<boolean | void>;
}) {
  const keys = line.source === "recipe" ? variableKeys(line) : [];
  return (
    <tr className="align-top">
      <th scope="row" className="py-3 pr-3 font-semibold">
        <span className="block">{line.description}</span>
        {line.flagged ? <span className="mt-1 block text-accent">Needs a price</span> : null}
        {keys.length > 0 ? (
          <div className="mt-2 flex flex-col gap-2">
            {keys.map((key) => (
              <VariableChip
                key={key}
                line={line}
                variable={key}
                editable={editable}
                onOverride={onOverride}
              />
            ))}
          </div>
        ) : null}
      </th>
      <td className="py-3 pr-3">{line.qty}</td>
      <td className="py-3 pr-3">{line.unit}</td>
      {showCost ? (
        <td className="py-3 pr-3">
          {line.unit_cost_cents === undefined ? "" : formatCents(line.unit_cost_cents, currency)}
        </td>
      ) : null}
      <td className="py-3 pr-3">{formatCents(line.unit_price_cents, currency)}</td>
      <td className="py-3 pr-3">{formatCents(line.price_cents, currency)}</td>
      {showCost ? (
        <td className="py-3 pr-3">
          {line.margin_cents === undefined
            ? ""
            : `${formatCents(line.margin_cents, currency)}${line.margin_pct ? ` (${line.margin_pct}%)` : ""}`}
        </td>
      ) : null}
      <td className="py-3 pr-3">
        <span className="rounded-md px-2 py-1 ring-1 ring-line">
          {line.source === "recipe" ? "Recipe" : "Manual"}
        </span>
      </td>
      <td className="py-3">
        <OptionalToggle line={line} editable={editable} onOptional={onOptional} />
      </td>
    </tr>
  );
}

function OptionalToggle({
  line,
  editable,
  onOptional,
}: {
  line: EstimateLine;
  editable: boolean;
  onOptional: (line: EstimateLine, optional: boolean) => Promise<boolean | void>;
}) {
  const [savedOptional, setSavedOptional] = useState(line.optional);
  const [checked, setChecked] = useState(line.optional);
  if (line.optional !== savedOptional) {
    setSavedOptional(line.optional);
    setChecked(line.optional);
  }

  return (
    <label className="inline-flex min-h-11 items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        disabled={!editable}
        aria-label={`Optional alternate for ${line.description}`}
        onChange={(event) => {
          const next = event.target.checked;
          setChecked(next);
          void onOptional(line, next).then((saved) => {
            if (saved === false) {
              setChecked(line.optional);
            }
          });
        }}
      />
      <span aria-hidden="true">Optional</span>
    </label>
  );
}

function VariableChip({
  line,
  variable,
  editable,
  onOverride,
}: {
  line: EstimateLine;
  variable: string;
  editable: boolean;
  onOverride: (line: EstimateLine, variables: Record<string, string>) => Promise<boolean | void>;
}) {
  const id = `${line.id}-${variable}`;
  const value = line.variables[variable] ?? line.recipe_variables[variable] ?? "";
  const overridden = line.variables[variable] !== undefined;
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const next = String(data.get("value") ?? "").trim();
        void onOverride(line, overrideMap(line, variable, next));
      }}
    >
      <label htmlFor={id} className="text-sm font-semibold">
        {variable} for {line.description}
      </label>
      <input
        id={id}
        name="value"
        defaultValue={value}
        key={`${id}-${value}`}
        disabled={!editable}
        inputMode="decimal"
        autoComplete="off"
        className={inputClass}
      />
      {overridden ? <span className="text-sm">Override</span> : null}
      {editable ? (
        <button type="submit" className="min-h-11 px-2 font-semibold underline">
          Save {variable} for {line.description}
        </button>
      ) : null}
    </form>
  );
}

export function ManualLineForm({
  showCost,
  onCreate,
}: {
  showCost: boolean;
  onCreate: (input: {
    description: string;
    qty: string;
    unit: string;
    group: string;
    unitPrice: string;
    unitCost: string;
    optional: boolean;
  }) => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setError("");
    setPending(true);
    try {
      await onCreate({
        description: String(data.get("description") ?? ""),
        qty: String(data.get("qty") ?? ""),
        unit: String(data.get("unit") ?? ""),
        group: String(data.get("group") ?? ""),
        unitPrice: String(data.get("unit_price") ?? ""),
        unitCost: String(data.get("unit_cost") ?? ""),
        optional: data.get("optional") === "on",
      });
      form.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the line.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="flex max-w-3xl flex-col gap-3" onSubmit={(event) => void onSubmit(event)}>
      <fieldset className="flex flex-col gap-3">
        <legend className="text-lg font-semibold">Manual line</legend>
        <TextField
          id="manual-description"
          name="description"
          label="Description"
          required
          maxLength={500}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField
            id="manual-qty"
            name="qty"
            label="Quantity"
            required
            inputMode="decimal"
            defaultValue="1"
          />
          <TextField
            id="manual-unit"
            name="unit"
            label="Unit"
            required
            maxLength={40}
            defaultValue="ea"
          />
          <TextField id="manual-group" name="group" label="Group" maxLength={200} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            id="manual-price"
            name="unit_price"
            label="Unit price (dollars)"
            inputMode="decimal"
          />
          {showCost ? (
            <TextField
              id="manual-cost"
              name="unit_cost"
              label="Unit cost (dollars)"
              inputMode="decimal"
            />
          ) : null}
        </div>
        <label className="inline-flex min-h-11 items-center gap-2">
          <input type="checkbox" name="optional" />
          Optional alternate
        </label>
      </fieldset>
      {error ? (
        <p role="alert" className="text-accent">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Adding line" : "Add manual line"}
      </Button>
    </form>
  );
}
