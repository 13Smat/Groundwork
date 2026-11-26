import { useState, type FormEvent } from "react";

import { Button, SelectField, TextField } from "@groundwork/ui";

import { EditableCell } from "./editable-cell";
import {
  MEASURE_KINDS,
  TAKEOFF_CATEGORIES,
  isMeasureKind,
  isTakeoffCategory,
  type MeasureKind,
  type TakeoffCreate,
  type TakeoffItem,
  type TakeoffPatch,
} from "./types";
import { defaultUnit, unitMatchesKind, unitsFor } from "./units";

const wrap = "border-b border-line py-2 pr-2 align-top";
const head = "border-b border-line py-2 pr-2 text-left font-semibold";
const selectClass =
  "min-h-11 w-full min-w-[8rem] rounded-md border border-line bg-paper px-2 text-base text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

export function TakeoffScreen({
  items,
  loading,
  canManage,
  onCreate,
  onPatch,
}: {
  items: TakeoffItem[];
  loading: boolean;
  canManage: boolean;
  onCreate: (body: TakeoffCreate) => Promise<void>;
  onPatch: (id: string, patch: TakeoffPatch) => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [measure, setMeasure] = useState<MeasureKind>("area");
  const [unit, setUnit] = useState("ft2");
  const [archiveId, setArchiveId] = useState<string | null>(null);

  async function save(item: TakeoffItem, patch: TakeoffPatch) {
    setError("");
    try {
      await onPatch(item.id, patch);
      setNotice("Saved.");
    } catch (err) {
      setNotice("");
      setError(err instanceof Error ? err.message : "Could not save the takeoff item.");
    }
  }

  async function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    const color = String(data.get("color") ?? "").trim();
    const category = String(data.get("category") ?? "");
    if (name === "") {
      setError("Name is required.");
      return;
    }
    try {
      await onCreate({
        name,
        measure_kind: measure,
        default_unit: unit,
        category: isTakeoffCategory(category) ? category : null,
        color: color === "" ? null : color,
      });
      form.reset();
      setMeasure("area");
      setUnit("ft2");
      setNotice("Saved.");
    } catch (err) {
      setNotice("");
      setError(err instanceof Error ? err.message : "Could not add the takeoff item.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-prose text-base leading-relaxed">
        Takeoff items are what gets measured. A recipe can link to one when the units measure the
        same kind of quantity.
      </p>
      {error ? (
        <p role="alert" className="text-base text-accent">
          {error}
        </p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      {canManage ? (
        <form onSubmit={addItem} className="grid gap-4 md:grid-cols-2">
          <TextField id="new-takeoff-name" name="name" label="New takeoff name" required />
          <SelectField
            id="new-measure"
            label="New measure kind"
            value={measure}
            onChange={(event) => {
              const next = event.target.value;
              if (!isMeasureKind(next)) {
                return;
              }
              setMeasure(next);
              if (!unitMatchesKind(unit, next)) {
                setUnit(defaultUnit(next));
              }
            }}
          >
            {MEASURE_KINDS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </SelectField>
          <SelectField
            id="new-unit"
            label="New default unit"
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
          >
            {unitsFor(measure).map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </SelectField>
          <TextField id="new-color" name="color" label="New color" placeholder="#3f6b3a" />
          <SelectField id="new-category" name="category" label="New category" defaultValue="">
            <option value="">None</option>
            {TAKEOFF_CATEGORIES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </SelectField>
          <div className="flex items-end">
            <Button type="submit">Add takeoff item</Button>
          </div>
        </form>
      ) : null}
      {loading ? (
        <p>Loading takeoff items.</p>
      ) : items.length === 0 ? (
        <p>No takeoff items yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table data-grid="takeoff" className="w-full border-collapse text-left text-base">
            <caption className="sr-only">Takeoff items</caption>
            <thead>
              <tr>
                {["Name", "Measure", "Default unit", "Color", "Category", "Archive"].map(
                  (label) => (
                    <th key={label} scope="col" className={head}>
                      {label}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {items.map((item, row) => {
                const unitChoices = unitsFor(item.measure_kind);
                const knownUnit = unitChoices.some((choice) => choice.value === item.default_unit);
                return (
                  <tr key={item.id}>
                    <td className={wrap}>
                      {canManage ? (
                        <EditableCell
                          grid="takeoff"
                          row={row}
                          col={0}
                          id={`takeoff-name-${item.id}`}
                          label={`Name for ${item.name}`}
                          value={item.name}
                          onCommit={(text) => {
                            const name = text.trim();
                            if (name === "" || name === item.name) {
                              return;
                            }
                            void save(item, { name });
                          }}
                        />
                      ) : (
                        item.name
                      )}
                    </td>
                    <td className={wrap}>
                      <label className="sr-only" htmlFor={`takeoff-measure-${item.id}`}>
                        Measure for {item.name}
                      </label>
                      <select
                        id={`takeoff-measure-${item.id}`}
                        className={selectClass}
                        value={item.measure_kind}
                        disabled={!canManage}
                        onChange={(event) => {
                          if (!isMeasureKind(event.target.value)) {
                            return;
                          }
                          const next = event.target.value;
                          const nextUnit = unitMatchesKind(item.default_unit, next)
                            ? item.default_unit
                            : defaultUnit(next);
                          void save(item, { measure_kind: next, default_unit: nextUnit });
                        }}
                      >
                        {MEASURE_KINDS.map((kind) => (
                          <option key={kind} value={kind}>
                            {kind}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className={wrap}>
                      <label className="sr-only" htmlFor={`takeoff-unit-${item.id}`}>
                        Default unit for {item.name}
                      </label>
                      <select
                        id={`takeoff-unit-${item.id}`}
                        className={selectClass}
                        value={item.default_unit}
                        disabled={!canManage}
                        onChange={(event) => {
                          void save(item, { default_unit: event.target.value });
                        }}
                      >
                        {!knownUnit ? (
                          <option value={item.default_unit}>{item.default_unit}</option>
                        ) : null}
                        {unitChoices.map((choice) => (
                          <option key={choice.value} value={choice.value}>
                            {choice.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className={wrap}>
                      {canManage ? (
                        <EditableCell
                          grid="takeoff"
                          row={row}
                          col={1}
                          id={`takeoff-color-${item.id}`}
                          label={`Color for ${item.name}`}
                          value={item.color ?? ""}
                          onCommit={(text) => {
                            const color = text.trim() === "" ? null : text.trim();
                            if (color === item.color) {
                              return;
                            }
                            void save(item, { color });
                          }}
                        />
                      ) : (
                        <span>
                          <span className="sr-only">Color for {item.name}</span>
                          {item.color ?? "—"}
                        </span>
                      )}
                    </td>
                    <td className={wrap}>
                      <label className="sr-only" htmlFor={`takeoff-category-${item.id}`}>
                        Category for {item.name}
                      </label>
                      <select
                        id={`takeoff-category-${item.id}`}
                        className={selectClass}
                        value={item.category ?? ""}
                        disabled={!canManage}
                        onChange={(event) => {
                          const category = event.target.value;
                          void save(item, {
                            category: isTakeoffCategory(category) ? category : null,
                          });
                        }}
                      >
                        <option value="">None</option>
                        {TAKEOFF_CATEGORIES.map((category) => (
                          <option key={category} value={category}>
                            {category}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className={wrap}>
                      {canManage ? (
                        archiveId === item.id ? (
                          <Button
                            variant="secondary"
                            onClick={() => void save(item, { archived: true })}
                          >
                            Confirm archive {item.name}
                          </Button>
                        ) : (
                          <Button variant="secondary" onClick={() => setArchiveId(item.id)}>
                            Archive {item.name}
                          </Button>
                        )
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
