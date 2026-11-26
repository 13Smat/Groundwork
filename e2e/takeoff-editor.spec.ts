import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "correct-horse-battery";

function email(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}@example.com`;
}

async function signUp(page: Page, name: string): Promise<void> {
  await page.goto("/sign-up");
  await expect(page.getByRole("heading", { name: "Create account" })).toBeVisible();
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email(name.toLowerCase().replaceAll(" ", "-")));
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Create workspace" })).toBeVisible();
  await page.getByLabel("Company name").fill(`${name} Co`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByText("No jobs yet")).toBeVisible();
}

async function loadStarter(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Catalog", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Catalog" })).toBeVisible();
  await page.getByRole("button", { name: "Load starter pack" }).click();
  await expect(page.getByText(/takeoff items/)).toBeVisible();
}

async function createJob(
  page: Page,
  address: string,
  client: string,
  pin?: { lat: string; lng: string },
) {
  await page.getByRole("link", { name: "Jobs" }).click();
  await expect(page.getByRole("heading", { name: "Jobs" })).toBeVisible();
  await page.getByRole("link", { name: "New job" }).click();
  await expect(page.getByRole("heading", { name: "New job" })).toBeVisible();
  await page.getByLabel("Site address").fill(address);
  await page.getByRole("button", { name: "Look up address" }).click();
  if (pin) {
    await expect(page.getByLabel("Latitude")).toBeVisible();
    await page.getByLabel("Latitude").fill(pin.lat);
    await page.getByLabel("Longitude").fill(pin.lng);
  } else {
    await expect(page.getByText(`Site: ${address}`)).toBeVisible();
  }
  await page.getByLabel("Client name").fill(client);
  await page.getByRole("button", { name: "Create job" }).click();
  await expect(page.getByRole("heading", { name: "J-1001" })).toBeVisible();
}

async function clickMap(page: Page, x: number, y: number): Promise<void> {
  const canvas = page.getByLabel("Takeoff drawing surface");
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error("The takeoff map has no box.");
  }
  await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
}

test("draw a polygon, line, and point, then switch imagery", async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page, "Takeoff Owner");
  await loadStarter(page);
  await createJob(page, "100 Main St, Morganton, NC 28655", "Morganton Homes");

  await page.getByRole("tab", { name: "Takeoffs" }).click();
  await expect(page.getByRole("heading", { name: "Takeoffs" })).toBeVisible();
  await page.getByRole("button", { name: "New takeoff" }).click();
  await expect(page.getByRole("heading", { name: "Takeoff editor" })).toBeVisible();
  await expect(page.getByText("Map ready")).toBeVisible();

  const options = page.getByLabel("Imagery capture").locator("option");
  await expect(options.first()).toContainText("Helene 2025");
  await expect(options.first()).toContainText("2025-04-15");
  await expect(options.first()).toContainText("6 in");
  await expect(page.getByText("NC Collaboratory at UNC Chapel Hill")).toBeVisible();
  await expect(
    page.getByText("This capture is more than 12 months old. New construction may be missing."),
  ).toBeVisible();
  await expect(page.getByText("Seamline smears are possible off major roads.")).toBeVisible();
  const labels = await options.allTextContents();
  expect(labels.join("\n")).not.toMatch(/google|mapbox|latest viewing/i);

  await page.getByRole("radio", { name: "Polygon" }).click();
  await expect(page.getByText("Drawing Aggregate base.")).toBeVisible();
  await clickMap(page, 0.35, 0.4);
  await clickMap(page, 0.62, 0.4);
  await clickMap(page, 0.62, 0.62);
  await clickMap(page, 0.35, 0.62);
  await clickMap(page, 0.35, 0.4);
  await page.getByRole("button", { name: "Finish shape" }).click();
  await expect(page.getByText(/Live total \d+ ft²/)).toBeVisible();

  await page.getByRole("radio", { name: "Line", exact: true }).click();
  await expect(page.getByText("Drawing Concrete curb.")).toBeVisible();
  await clickMap(page, 0.28, 0.75);
  await clickMap(page, 0.5, 0.7);
  await clickMap(page, 0.72, 0.75);
  await page.getByRole("button", { name: "Finish shape" }).click();
  await expect(page.getByText(/Live total \d+ ft$/)).toBeVisible();

  await page.getByRole("radio", { name: "Point" }).click();
  await expect(page.getByText("Drawing Shrub planting.")).toBeVisible();
  await clickMap(page, 0.5, 0.5);
  await expect(page.getByText("Live total 1", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Save measurements" }).click();
  await expect(page.getByLabel("Save result")).toContainText("Saved");
  await expect(page.getByText(/Server total \d+ ft²/)).toBeVisible();
  await expect(page.getByText(/Server total \d+ ft$/)).toBeVisible();
  await expect(page.getByText("Server total 1", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Quantity summary" }).click();
  const summary = page.getByRole("dialog", { name: "Quantity summary" });
  await expect(summary.getByRole("row", { name: /Aggregate base/ })).toBeVisible();
  await expect(summary.getByRole("row", { name: /Concrete curb/ })).toBeVisible();
  await expect(summary.getByRole("row", { name: /Shrub planting/ })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Takeoff editor" })).toBeVisible();
  await expect(page.getByText("Map ready")).toBeVisible();
  await expect(page.getByText("Server total 1", { exact: true })).toBeVisible();

  await page.getByLabel("Imagery capture").selectOption({ label: /NC Ortho · 2024-03-15/ });
  await expect(page.getByRole("heading", { name: "Switch imagery?" })).toBeVisible();
  await page.getByRole("button", { name: "Keep this capture" }).click();
  await expect(page.getByLabel("Imagery capture").locator("option:checked")).toContainText(
    "2025-04-15",
  );
  await page.getByLabel("Imagery capture").selectOption({ label: /NC Ortho · 2024-03-15/ });
  await page.getByRole("button", { name: "Switch capture" }).click();
  await expect(page.getByLabel("Imagery capture").locator("option:checked")).toContainText(
    "2024-03-15",
  );
  await expect(page.getByText(/different capture/)).toBeVisible();
  await expect(page.getByText(/Server total \d+ ft²/)).toBeVisible();
});

test("measuring stays blocked when no allowed capture covers the site", async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page, "Blocked Owner");
  await createJob(page, "1 Ice Road, Nowhere", "Nowhere Homes", { lat: "10", lng: "10" });
  await page.getByRole("tab", { name: "Takeoffs" }).click();
  await expect(page.getByRole("heading", { name: "Takeoffs" })).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "Measuring stays blocked" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "New takeoff" })).toBeDisabled();
});

test("a site outside North Carolina shows the NAIP banner", async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page, "Naip Owner");
  await createJob(page, "1 Prairie Road, Kansas", "Prairie Homes", { lat: "39", lng: "-98" });
  await page.getByRole("tab", { name: "Takeoffs" }).click();
  await expect(page.getByText("Lower resolution (60 cm, leaf-on).")).toBeVisible();
  await expect(page.getByText("USDA NAIP")).toBeVisible();
  await page.getByRole("button", { name: "New takeoff" }).click();
  await expect(page.getByRole("heading", { name: "Takeoff editor" })).toBeVisible();
  await expect(page.getByText("Map ready")).toBeVisible();
  const labels = await page.getByLabel("Imagery capture").locator("option").allTextContents();
  expect(labels.join("\n")).toMatch(/NAIP/);
  expect(labels.join("\n")).not.toMatch(/Helene|NC Ortho/);
});
