import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "correct-horse-battery";

function email(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}@example.com`;
}

async function signUp(page: Page, name: string, address: string): Promise<void> {
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(address);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Create workspace" })).toBeVisible();
}

async function invite(page: Page, address: string, role: string): Promise<string> {
  await page.getByLabel("Email").fill(address);
  await page.getByLabel("Role", { exact: true }).selectOption({ label: role });
  const response = page.waitForResponse(
    (result) => result.url().includes("/invites") && result.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Send invite" }).click();
  const body = (await (await response).json()) as { id: string };
  return body.id;
}

async function acceptInvite(
  page: Page,
  address: string,
  name: string,
  token: string,
): Promise<void> {
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("link", { name: "Create an account" }).click();
  await signUp(page, name, address);
  await page.goto(`/invites/${token}`);
  await expect(page.getByRole("button", { name: "Accept invite" })).toBeVisible();
  await page.getByRole("button", { name: "Accept invite" }).click();
  await expect(page.getByText("No jobs yet")).toBeVisible();
}

test("a recipe validates, previews, and versions without changing the active formula", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signUp(page, "Recipe Owner", email("recipe-owner"));
  await page.getByLabel("Company name").fill("Recipe Office Co");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByText("No jobs yet")).toBeVisible();

  await page.getByRole("link", { name: "Catalog", exact: true }).click();
  await page.getByLabel("New item name").fill("Hot mix");
  await page.getByLabel("New item unit", { exact: true }).fill("ton");
  await page.getByLabel("New item SKU").fill("GW-E2E-MIX");
  await page.getByLabel("New item unit cost").fill("85.00");
  await page.getByLabel("New item sell price").fill("120.00");
  await page.getByRole("button", { name: "Add item" }).click();
  await expect(page.getByLabel("Name for Hot mix")).toHaveValue("Hot mix");

  await page.getByRole("link", { name: "Cost recipes" }).click();
  await page.getByRole("link", { name: "New recipe" }).click();
  await page.getByLabel("Recipe name").fill("Surface course");
  await expect(page.getByLabel("Catalog item 1")).toContainText("Hot mix");
  await page.getByLabel("Catalog item 1").selectOption({ label: "Hot mix (ton)" });
  await page.getByLabel("Quantity formula 1").fill("qty + nope");
  await expect(page.getByRole("alert").filter({ hasText: "Unknown variable nope" })).toContainText(
    "Position 6",
  );
  await page.getByLabel("Quantity formula 1").fill("qty");
  await expect(page.getByRole("alert").filter({ hasText: "Unknown variable nope" })).toHaveCount(0);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByLabel("Test quantity")).toBeVisible();
  await page.getByLabel("Test quantity").fill("1000");
  await expect(page.getByRole("cell", { name: "1000" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Cost" })).toBeVisible();

  await page.getByRole("button", { name: "Activate version 1" }).click();
  await expect(page.locator("#recipe-version-banner")).toContainText(
    "Saving edits creates version 2 as a draft",
  );
  await page.getByLabel("Quantity formula 1").fill("qty * 2");
  await page.getByRole("button", { name: "Save as version 2" }).click();
  await expect(page.locator("#recipe-version-banner")).toContainText("Version 2 is a draft");
  await page.getByRole("link", { name: "Version 1, active" }).click();
  await expect(page.getByLabel("Quantity formula 1")).toHaveValue("qty");
  await expect(page.locator("#recipe-version-banner")).toContainText("Version 1 is active");
  await expect(page.locator("#recipe-version-banner")).toContainText("stays unchanged");
});

test("csv import previews the sku diff before it writes", async ({ page }) => {
  test.setTimeout(90_000);
  await signUp(page, "Csv Owner", email("csv-owner"));
  await page.getByLabel("Company name").fill("Csv Co");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await page.getByRole("link", { name: "Catalog", exact: true }).click();
  await page.getByLabel("New item name").fill("Base stone");
  await page.getByLabel("New item unit", { exact: true }).fill("ton");
  await page.getByLabel("New item SKU").fill("GW-CSV-1");
  await page.getByLabel("New item unit cost").fill("10.00");
  await page.getByLabel("New item sell price").fill("20.00");
  await page.getByRole("button", { name: "Add item" }).click();
  await expect(page.getByLabel("Unit cost for Base stone")).toHaveValue("10.00");

  await page.getByRole("button", { name: "Import CSV" }).click();
  await page
    .getByLabel("Catalog CSV")
    .fill(
      [
        "sku,kind,name,unit,unit_cost_cents,unit_price_cents,waste_pct,vendor,tax_code",
        "GW-CSV-1,material,Base stone,ton,1500,2000,0,,",
        "GW-CSV-2,material,Joint sand,ton,400,700,0,,",
      ].join("\n"),
    );
  await page.getByRole("button", { name: "Preview import" }).click();
  await expect(page.getByText("Joint sand (GW-CSV-2)")).toBeVisible();
  await expect(page.getByText("unit_cost_cents from 1000 to 1500")).toBeVisible();
  await expect(page.getByLabel("Name for Joint sand")).toHaveCount(0);
  await page.getByRole("button", { name: "Apply import" }).click();
  await expect(page.getByLabel("Name for Joint sand")).toHaveValue("Joint sand");
  await expect(page.getByLabel("Unit cost for Base stone")).toHaveValue("15.00");
});

test("office sees no unit cost and an estimator can edit it", async ({ page }) => {
  test.setTimeout(120_000);
  const owner = email("cost-owner");
  const office = email("cost-office");
  const estimator = email("cost-estimator");
  await signUp(page, "Cost Owner", owner);
  await page.getByLabel("Company name").fill("Cost Visibility Co");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await page.getByRole("link", { name: "Catalog", exact: true }).click();
  await page.getByLabel("New item name").fill("Crushed stone");
  await page.getByLabel("New item unit", { exact: true }).fill("ton");
  await page.getByLabel("New item unit cost").fill("42.50");
  await page.getByLabel("New item sell price").fill("60.00");
  await page.getByRole("button", { name: "Add item" }).click();
  await expect(page.getByLabel("Unit cost for Crushed stone")).toHaveValue("42.50");

  await page.getByRole("link", { name: "Members" }).click();
  await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();
  const officeToken = await invite(page, office, "office");
  const estimatorToken = await invite(page, estimator, "estimator");

  await acceptInvite(page, office, "Office Person", officeToken);
  await page.getByRole("link", { name: "Catalog", exact: true }).click();
  await expect(page.getByRole("columnheader", { name: "Unit cost" })).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "Sell price" })).toBeVisible();
  await expect(page.getByText("60.00")).toBeVisible();
  await expect(page.getByText("42.50")).toHaveCount(0);
  await expect(page.getByLabel("New item name")).toHaveCount(0);

  await acceptInvite(page, estimator, "Estimate Person", estimatorToken);
  await page.getByRole("link", { name: "Catalog", exact: true }).click();
  const cost = page.getByLabel("Unit cost for Crushed stone");
  await expect(cost).toHaveValue("42.50");
  await cost.fill("43.00");
  await cost.press("Tab");
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.reload();
  await expect(page.getByLabel("Unit cost for Crushed stone")).toHaveValue("43.00");
});
