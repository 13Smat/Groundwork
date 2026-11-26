import { useEffect, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";

import { Button, SelectField, TextField } from "@groundwork/ui";

import { formatMoney } from "./money";
import type {
  FormulaCheck,
  PreviewBody,
  PreviewResult,
  Recipe,
  RecipeWrite,
  TakeoffItem,
} from "./types";
import { ALL_MEASURE_UNITS } from "./units";

const DEFAULT_VARIABLES = [
  { name: "depth_in", value: "2" },
  { name: "density_lb_ft3", value: "145" },
  { name: "waste_pct", value: "5" },
];

const fieldClass =
  "min-h-11 w-full rounded-md border border-line bg-paper px-3 text-base text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

type VariableRow = { id: string; name: string; value: string };
type ComponentRow = { id: string; catalogId: string; formula: string };
type CatalogChoice = { id: string; name: string; unit: string };
type VersionRow = { id: string; version: number; status: string };

function initialVariables(recipe: Recipe | null): VariableRow[] {
  if (!recipe) {
    return DEFAULT_VARIABLES.map((row, index) => ({ id: `seed-${index}`, ...row }));
  }
  return Object.entries(recipe.variables).map(([name, value], index) => ({
    id: `saved-${index}-${name}`,
    name,
    value,
  }));
}

function initialComponents(recipe: Recipe | null): ComponentRow[] {
  if (!recipe || recipe.components.length === 0) {
    return [{ id: "component-0", catalogId: "", formula: "" }];
  }
  return recipe.components.map((component) => ({
    id: component.id,
    catalogId: component.catalog_item_id,
    formula: component.qty_formula,
  }));
}

function banner(recipe: Recipe | null, openDraft: VersionRow | undefined): string {
  if (!recipe) {
    return "New recipes start as a draft.";
  }
  if (recipe.status === "archived") {
    return `Version ${recipe.version} is archived. This version stays unchanged.`;
  }
  if (recipe.status === "active" && openDraft) {
    return `Version ${recipe.version} is active. A draft of the next version already exists. This version stays unchanged.`;
  }
  if (recipe.status === "active") {
    return `Version ${recipe.version} is active. Saving edits creates version ${recipe.version + 1} as a draft. This version stays unchanged.`;
  }
  if (recipe.version > 1) {
    return `Version ${recipe.version} is a draft. Activating it archives the current active version. Older versions stay unchanged.`;
  }
  return `Version ${recipe.version} is a draft.`;
}

export function RecipeBuilder({
  recipe,
  catalog,
  takeoff,
  versions,
  canManage,
  notice,
  debounceMs = 300,
  onValidate,
  onSave,
  onActivate,
  onPreview,
}: {
  recipe: Recipe | null;
  catalog: CatalogChoice[];
  takeoff: Pick<TakeoffItem, "id" | "name" | "default_unit">[];
  versions: VersionRow[];
  canManage: boolean;
  notice: string | null;
  debounceMs?: number;
  onValidate: (formula: string, variables: string[]) => Promise<FormulaCheck>;
  onSave: (body: RecipeWrite) => Promise<void>;
  onActivate: () => Promise<void>;
  onPreview: (body: PreviewBody) => Promise<PreviewResult>;
}) {
  const [name, setName] = useState(recipe?.name ?? "");
  const [inputUnit, setInputUnit] = useState(recipe?.input_unit ?? "ft2");
  const [takeoffId, setTakeoffId] = useState(recipe?.takeoff_item_id ?? "");
  const [variables, setVariables] = useState<VariableRow[]>(() => initialVariables(recipe));
  const [components, setComponents] = useState<ComponentRow[]>(() => initialComponents(recipe));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [testQty, setTestQty] = useState("");
  const [testUnit, setTestUnit] = useState(recipe?.input_unit ?? "ft2");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewError, setPreviewError] = useState("");
  const openDraft = versions.find(
    (version) => version.status === "draft" && version.id !== recipe?.id,
  );
  const locked =
    !canManage ||
    recipe?.status === "archived" ||
    (recipe?.status === "active" && openDraft !== undefined);
  const variableNames = variables.map((row) => row.name.trim()).filter((row) => row !== "");
  const variableKey = variables.map((row) => `${row.name}=${row.value}`).join("|");

  useEffect(() => {
    if (!recipe || testQty.trim() === "") {
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(() => {
      const overrides: Record<string, string> = {};
      for (const row of variables) {
        if (row.name.trim() !== "") {
          overrides[row.name.trim()] = row.value.trim();
        }
      }
      void onPreview({
        input_qty: testQty.trim(),
        input_unit: testUnit,
        variables: overrides,
      })
        .then((result) => {
          if (!cancelled) {
            setPreview(result);
            setPreviewError("");
          }
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setPreview(null);
            setPreviewError(
              err instanceof Error ? err.message : "Could not preview this quantity.",
            );
          }
        });
    }, debounceMs);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [recipe, testQty, testUnit, variableKey, debounceMs, onPreview, variables]);

  function addDefaults() {
    setVariables((rows) => {
      const names = new Set(rows.map((row) => row.name));
      const next = [...rows];
      for (const item of DEFAULT_VARIABLES) {
        if (!names.has(item.name)) {
          next.push({ id: `default-${item.name}`, name: item.name, value: item.value });
        }
      }
      return next;
    });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked) {
      return;
    }
    setError("");
    const trimmed = name.trim();
    if (trimmed === "") {
      setError("Recipe name is required.");
      return;
    }
    const variableMap: Record<string, string> = {};
    for (const row of variables) {
      const key = row.name.trim();
      if (key === "" && row.value.trim() === "") {
        continue;
      }
      if (key === "" || row.value.trim() === "") {
        setError("Each variable needs a name and a decimal value.");
        return;
      }
      if (variableMap[key] !== undefined) {
        setError(`Variable ${key} is listed twice.`);
        return;
      }
      variableMap[key] = row.value.trim();
    }
    const filled = components.filter((row) => row.catalogId !== "" || row.formula.trim() !== "");
    if (filled.some((row) => row.catalogId === "" || row.formula.trim() === "")) {
      setError("Choose a catalog item and a formula for each component.");
      return;
    }
    setSaving(true);
    try {
      await onSave({
        name: trimmed,
        input_unit: inputUnit,
        takeoff_item_id: takeoffId === "" ? null : takeoffId,
        variables: variableMap,
        components: filled.map((row, index) => ({
          catalog_item_id: row.catalogId,
          qty_formula: row.formula.trim(),
          sort: index,
        })),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the recipe.");
    } finally {
      setSaving(false);
    }
  }

  const saveLabel =
    recipe?.status === "active" ? `Save as version ${recipe.version + 1}` : "Save draft";

  return (
    <div className="flex flex-col gap-6">
      <p id="recipe-version-banner" role="status" className="max-w-prose text-base leading-relaxed">
        {banner(recipe, openDraft)}
      </p>
      {openDraft ? (
        <Link
          className="text-base font-semibold underline"
          to="/catalog/recipes/$recipeId"
          params={{ recipeId: openDraft.id }}
        >
          Open version {openDraft.version}
        </Link>
      ) : null}
      {notice ? <p>{notice}</p> : null}
      {error ? (
        <p role="alert" className="text-base text-accent">
          {error}
        </p>
      ) : null}
      <form onSubmit={onSubmit} className="flex flex-col gap-6">
        <TextField
          id="recipe-name"
          label="Recipe name"
          value={name}
          readOnly={locked}
          required
          onChange={(event) => setName(event.target.value)}
        />
        <UnitSelect
          id="recipe-input-unit"
          label="Input unit"
          value={inputUnit}
          disabled={locked}
          onChange={setInputUnit}
        />
        <SelectField
          id="recipe-takeoff"
          label="Takeoff item"
          value={takeoffId}
          disabled={locked}
          onChange={(event) => {
            const next = event.target.value;
            setTakeoffId(next);
            const linked = takeoff.find((item) => item.id === next);
            if (linked) {
              setInputUnit(linked.default_unit);
            }
          }}
        >
          <option value="">Not linked</option>
          {takeoff.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </SelectField>
        <fieldset className="flex flex-col gap-3">
          <legend className="text-lg font-semibold">Variables</legend>
          {variables.map((row, index) => (
            <div key={row.id} className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
              <TextField
                id={`variable-name-${row.id}`}
                label={`Variable name ${index + 1}`}
                value={row.name}
                readOnly={locked}
                onChange={(event) => {
                  const value = event.target.value;
                  setVariables((rows) =>
                    rows.map((item) => (item.id === row.id ? { ...item, name: value } : item)),
                  );
                }}
              />
              <TextField
                id={`variable-value-${row.id}`}
                label={`Variable value ${index + 1}`}
                value={row.value}
                readOnly={locked}
                inputMode="decimal"
                onChange={(event) => {
                  const value = event.target.value;
                  setVariables((rows) =>
                    rows.map((item) => (item.id === row.id ? { ...item, value } : item)),
                  );
                }}
              />
              {locked ? null : (
                <div className="flex items-end">
                  <Button
                    variant="secondary"
                    onClick={() =>
                      setVariables((rows) => rows.filter((item) => item.id !== row.id))
                    }
                  >
                    Remove {row.name || `variable ${index + 1}`}
                  </Button>
                </div>
              )}
            </div>
          ))}
          {locked ? null : (
            <div className="flex flex-wrap gap-3">
              <Button
                variant="secondary"
                onClick={() =>
                  setVariables((rows) => [
                    ...rows,
                    { id: `var-${rows.length}-${Date.now()}`, name: "", value: "" },
                  ])
                }
              >
                Add variable
              </Button>
              <Button variant="secondary" onClick={addDefaults}>
                Add depth, density, and waste
              </Button>
            </div>
          )}
        </fieldset>
        <fieldset className="flex flex-col gap-4">
          <legend className="text-lg font-semibold">Components</legend>
          {components.map((row, index) => (
            <div key={row.id} className="flex flex-col gap-3 rounded-md border border-line p-3">
              <SelectField
                id={`component-item-${row.id}`}
                label={`Catalog item ${index + 1}`}
                value={row.catalogId}
                disabled={locked}
                onChange={(event) => {
                  const catalogId = event.target.value;
                  setComponents((rows) =>
                    rows.map((item) => (item.id === row.id ? { ...item, catalogId } : item)),
                  );
                }}
              >
                <option value="">Choose an item</option>
                {row.catalogId !== "" && !catalog.some((item) => item.id === row.catalogId) ? (
                  <option value={row.catalogId}>Archived item</option>
                ) : null}
                {catalog.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.unit})
                  </option>
                ))}
              </SelectField>
              <FormulaField
                id={`formula-${row.id}`}
                label={`Quantity formula ${index + 1}`}
                formula={row.formula}
                names={variableNames.join("\n")}
                debounceMs={debounceMs}
                readOnly={locked}
                onChange={(formula) =>
                  setComponents((rows) =>
                    rows.map((item) => (item.id === row.id ? { ...item, formula } : item)),
                  )
                }
                onValidate={onValidate}
              />
              {locked ? null : (
                <Button
                  variant="secondary"
                  onClick={() => setComponents((rows) => rows.filter((item) => item.id !== row.id))}
                >
                  Remove component {index + 1}
                </Button>
              )}
            </div>
          ))}
          {locked ? null : (
            <Button
              variant="secondary"
              onClick={() =>
                setComponents((rows) => [
                  ...rows,
                  { id: `component-${rows.length}-${Date.now()}`, catalogId: "", formula: "" },
                ])
              }
            >
              Add component
            </Button>
          )}
        </fieldset>
        {locked ? null : (
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={saving} aria-describedby="recipe-version-banner">
              {saveLabel}
            </Button>
            {recipe?.status === "draft" ? (
              <Button
                type="button"
                variant="secondary"
                disabled={saving}
                onClick={() => {
                  setSaving(true);
                  setError("");
                  void onActivate()
                    .catch((err: unknown) => {
                      setError(
                        err instanceof Error ? err.message : "Could not activate the recipe.",
                      );
                    })
                    .finally(() => setSaving(false));
                }}
              >
                Activate version {recipe.version}
              </Button>
            ) : null}
          </div>
        )}
      </form>
      {versions.length > 0 ? (
        <nav aria-label="Recipe versions">
          <ul className="flex flex-col gap-2">
            {versions.map((version) => (
              <li key={version.id}>
                <Link
                  to="/catalog/recipes/$recipeId"
                  params={{ recipeId: version.id }}
                  className="text-base font-semibold underline"
                  aria-current={version.id === recipe?.id ? "page" : undefined}
                >
                  Version {version.version}, {version.status}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Test quantity</h2>
        {recipe ? (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <TextField
                id="test-qty"
                label="Test quantity"
                value={testQty}
                inputMode="decimal"
                onChange={(event) => setTestQty(event.target.value)}
              />
              <UnitSelect
                id="test-unit"
                label="Test unit"
                value={testUnit}
                onChange={setTestUnit}
              />
            </div>
            {testQty.trim() !== "" && previewError ? (
              <p role="alert" className="text-base text-accent">
                {previewError}
              </p>
            ) : null}
            {testQty.trim() !== "" && preview ? (
              <PreviewTable preview={preview} canManage={canManage} />
            ) : null}
          </>
        ) : (
          <p>Save the draft to preview a quantity.</p>
        )}
      </section>
    </div>
  );
}

function UnitSelect({
  id,
  label,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const known = ALL_MEASURE_UNITS.some((item) => item.value === value);
  return (
    <SelectField
      id={id}
      label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {!known && value !== "" ? <option value={value}>{value}</option> : null}
      <optgroup label="Area">
        {ALL_MEASURE_UNITS.filter((item) => ["ft2", "yd2", "m2", "acre"].includes(item.value)).map(
          (item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ),
        )}
      </optgroup>
      <optgroup label="Length">
        {ALL_MEASURE_UNITS.filter((item) => ["ft", "yd", "m", "in"].includes(item.value)).map(
          (item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ),
        )}
      </optgroup>
      <optgroup label="Count">
        <option value="ea">Each (ea)</option>
      </optgroup>
    </SelectField>
  );
}

function FormulaField({
  id,
  label,
  formula,
  names,
  debounceMs,
  readOnly,
  onChange,
  onValidate,
}: {
  id: string;
  label: string;
  formula: string;
  names: string;
  debounceMs: number;
  readOnly: boolean;
  onChange: (formula: string) => void;
  onValidate: (formula: string, variables: string[]) => Promise<FormulaCheck>;
}) {
  const [result, setResult] = useState<FormulaCheck | null>(null);
  useEffect(() => {
    if (formula.trim() === "") {
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(() => {
      const variables = names.split("\n").filter((name) => name !== "");
      void onValidate(formula, variables)
        .then((next) => {
          if (!cancelled) {
            setResult(next);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setResult({
              ok: false,
              errors: [{ message: "Could not check this formula.", position: 0, length: 0 }],
              referenced_vars: [],
            });
          }
        });
    }, debounceMs);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [formula, names, debounceMs, onValidate]);
  const shown = formula.trim() === "" ? null : result;
  const problem = shown && !shown.ok ? shown.errors[0] : undefined;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <textarea
        id={id}
        className={`${fieldClass} min-h-24 font-mono`}
        value={formula}
        readOnly={readOnly}
        spellCheck={false}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? `${id}-error` : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {shown && !shown.ok
        ? shown.errors.map((item, index) => (
            <p
              key={`${item.position}-${item.message}`}
              id={index === 0 ? `${id}-error` : undefined}
              role="alert"
              className="text-base text-accent"
            >
              {item.message} Position {item.position}.
            </p>
          ))
        : null}
      {problem ? (
        <FormulaMark formula={formula} position={problem.position} length={problem.length} />
      ) : null}
    </div>
  );
}

function FormulaMark({
  formula,
  position,
  length,
}: {
  formula: string;
  position: number;
  length: number;
}) {
  const start = Math.min(Math.max(position, 0), formula.length);
  const end = Math.min(formula.length, start + Math.max(length, 0));
  const marked = formula.slice(start, end);
  return (
    <p className="overflow-x-auto font-mono text-sm" aria-hidden="true">
      {formula.slice(0, start)}
      <mark className="bg-accent text-paper">{marked === "" ? "│" : marked}</mark>
      {formula.slice(end)}
    </p>
  );
}

function PreviewTable({ preview, canManage }: { preview: PreviewResult; canManage: boolean }) {
  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      {preview.flagged ? (
        <p role="alert">A line is flagged. Its cost stays 0 until the formula is fixed.</p>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-base">
          <caption className="sr-only">Preview</caption>
          <thead>
            <tr>
              <th scope="col" className="border-b border-line py-2 pr-3">
                Component
              </th>
              <th scope="col" className="border-b border-line py-2 pr-3">
                Quantity
              </th>
              {canManage ? (
                <th scope="col" className="border-b border-line py-2">
                  Cost
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {preview.components.map((component) => (
              <tr key={component.id}>
                <th scope="row" className="py-2 pr-3 font-semibold">
                  {component.name}
                </th>
                <td className="py-2 pr-3">{component.qty}</td>
                {canManage ? (
                  <td className="py-2">
                    {component.cost_cents === undefined ? "" : formatMoney(component.cost_cents)}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canManage && preview.total_cost_cents !== undefined ? (
        <p>Total cost {formatMoney(preview.total_cost_cents)}</p>
      ) : null}
    </div>
  );
}
