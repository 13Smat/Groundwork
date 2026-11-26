// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CatalogGrid } from "./catalog-grid";
import { ImportPanel } from "./import-panel";
import { RecipeBuilder } from "./recipe-builder";
import { TakeoffScreen } from "./takeoff-screen";
import type { CatalogItem, ImportPlan, Recipe, TakeoffItem } from "./types";

afterEach(() => {
  cleanup();
});

const stone: CatalogItem = {
  id: "stone",
  kind: "material",
  name: "Alpha",
  unit: "ton",
  unit_cost_cents: 1000,
  unit_price_cents: 2000,
  waste_pct: "0",
  vendor: null,
  sku: "GW-A",
  tax_code: null,
  archived_at: null,
};

const beta: CatalogItem = { ...stone, id: "beta", name: "Beta", sku: "GW-B" };

const recipe: Recipe = {
  id: "recipe-1",
  family_id: "recipe-1",
  name: "Surface course",
  takeoff_item_id: null,
  input_unit: "ft2",
  variables: { depth_in: "2" },
  version: 1,
  status: "active",
  components: [
    {
      id: "component-1",
      catalog_item_id: "stone",
      qty_formula: "qty + nope",
      sort: 0,
    },
  ],
  created_at: "2026-11-26T00:00:00.000Z",
  updated_at: "2026-11-26T00:00:00.000Z",
};

describe("catalog grid", () => {
  it("moves between name cells with the down arrow and saves a unit cost", async () => {
    const user = userEvent.setup();
    const onPatch = vi.fn().mockResolvedValue(undefined);
    render(
      <CatalogGrid
        caption="Materials"
        items={[stone, beta]}
        canManage
        onPatch={onPatch}
        onOpen={vi.fn()}
        onError={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    const alpha = screen.getByLabelText("Name for Alpha");
    alpha.focus();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByLabelText("Name for Beta"));

    const cost = screen.getByLabelText("Unit cost for Alpha");
    await user.clear(cost);
    await user.type(cost, "12.50");
    await user.tab();
    expect(onPatch).toHaveBeenCalledWith("stone", { unit_cost_cents: 1250 });
  });

  it("hides unit cost when the person cannot manage the catalog", () => {
    render(
      <CatalogGrid
        caption="Materials"
        items={[stone]}
        canManage={false}
        onPatch={vi.fn()}
        onOpen={vi.fn()}
        onError={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.queryByRole("columnheader", { name: "Unit cost" })).toBeNull();
    expect(screen.getByRole("columnheader", { name: "Sell price" })).toBeTruthy();
    expect(screen.queryByText("10.00")).toBeNull();
    expect(screen.getByText("20.00")).toBeTruthy();
  });
});

describe("csv import", () => {
  it("shows the add and update diff before apply", async () => {
    const user = userEvent.setup();
    const plan: ImportPlan = {
      apply: false,
      created: [{ sku: "GW-CSV-2", name: "Joint sand" }],
      updated: [
        {
          sku: "GW-CSV-1",
          changes: [{ field: "unit_cost_cents", from: "1000", to: "1500" }],
        },
      ],
      unchanged: [],
      errors: [],
    };
    const onPreview = vi.fn().mockResolvedValue(plan);
    const onApply = vi.fn().mockResolvedValue(undefined);
    render(<ImportPanel onPreview={onPreview} onApply={onApply} />);
    await user.type(screen.getByLabelText("Catalog CSV"), "sku,kind,name");
    await user.click(screen.getByRole("button", { name: "Preview import" }));
    expect(await screen.findByText("Joint sand (GW-CSV-2)")).toBeTruthy();
    expect(screen.getByText("unit_cost_cents from 1000 to 1500")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Apply import" }));
    expect(onApply).toHaveBeenCalledWith("sku,kind,name");
  });

  it("keeps apply disabled when the preview has an error", async () => {
    const user = userEvent.setup();
    const onPreview = vi.fn().mockResolvedValue({
      apply: false,
      created: [],
      updated: [],
      unchanged: [],
      errors: [{ row: 2, message: "SKU is required." }],
    });
    render(<ImportPanel onPreview={onPreview} onApply={vi.fn()} />);
    await user.type(screen.getByLabelText("Catalog CSV"), "sku");
    await user.click(screen.getByRole("button", { name: "Preview import" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Row 2: SKU is required.",
    );
    expect(screen.getByRole("button", { name: "Apply import" }).hasAttribute("disabled")).toBe(
      true,
    );
  });
});

describe("recipe builder", () => {
  it("shows the formula error position and the version banner", async () => {
    render(
      <RecipeBuilder
        recipe={recipe}
        catalog={[{ id: "stone", name: "Hot mix", unit: "ton" }]}
        takeoff={[]}
        versions={[]}
        canManage
        notice={null}
        debounceMs={0}
        onValidate={vi.fn().mockResolvedValue({
          ok: false,
          errors: [{ message: "Unknown variable nope.", position: 6, length: 4 }],
          referenced_vars: ["nope"],
        })}
        onSave={vi.fn()}
        onActivate={vi.fn()}
        onPreview={vi.fn()}
      />,
    );
    expect(
      screen.getByText(
        "Version 1 is active. Saving edits creates version 2 as a draft. This version stays unchanged.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save as version 2" })).toBeTruthy();
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Unknown variable nope. Position 6.",
    );
  });

  it("previews a quantity without a cost column when costs are hidden", async () => {
    const user = userEvent.setup();
    const onPreview = vi.fn().mockImplementation(async (body: { input_qty: string }) => ({
      flagged: false,
      components: [
        {
          id: "component-1",
          catalog_item_id: "stone",
          name: "Hot mix",
          qty: body.input_qty,
          flags: [],
          errors: [],
        },
      ],
    }));
    render(
      <RecipeBuilder
        recipe={{ ...recipe, components: [{ ...recipe.components[0]!, qty_formula: "qty" }] }}
        catalog={[{ id: "stone", name: "Hot mix", unit: "ton" }]}
        takeoff={[]}
        versions={[]}
        canManage={false}
        notice={null}
        debounceMs={0}
        onValidate={vi.fn().mockResolvedValue({ ok: true, errors: [], referenced_vars: ["qty"] })}
        onSave={vi.fn()}
        onActivate={vi.fn()}
        onPreview={onPreview}
      />,
    );
    await user.type(screen.getByLabelText("Test quantity"), "10");
    expect(await screen.findByRole("cell", { name: "10" })).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: "Cost" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save as version 2" })).toBeNull();
  });
});

const sod: TakeoffItem = {
  id: "sod",
  name: "Sod area",
  measure_kind: "area",
  default_unit: "ft2",
  category: "landscape",
  color: "#3f6b3a",
  archived_at: null,
};

describe("takeoff items", () => {
  it("labels name, measure, unit, color, and category", () => {
    render(
      <TakeoffScreen
        items={[sod]}
        loading={false}
        canManage
        onCreate={vi.fn()}
        onPatch={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Name for Sod area")).toBeTruthy();
    expect(screen.getByLabelText("Measure for Sod area")).toBeTruthy();
    expect(screen.getByLabelText("Default unit for Sod area")).toBeTruthy();
    expect(screen.getByLabelText("Color for Sod area")).toBeTruthy();
    expect(screen.getByLabelText("Category for Sod area")).toBeTruthy();
  });
});
