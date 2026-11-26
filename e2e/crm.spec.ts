import { expect, test, type Page } from "@playwright/test";

import { skipOnboarding } from "./session";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("address-first job creation, stage moves, upload, and search", async ({ page }) => {
  const email = `owner-${Date.now()}@example.com`;
  await signUp(page, email);

  await page.getByRole("link", { name: "Jobs" }).click();
  await expect(page.getByRole("heading", { name: "Jobs" })).toBeVisible();
  await expect(page.getByText("No jobs match these filters.")).toBeVisible();
  await page.getByRole("link", { name: "New job" }).click();
  await expect(page.getByRole("heading", { name: "New job" })).toBeVisible();

  const address = "100 Main St, Morganton, NC 28655";
  await page.getByLabel("Site address").fill(address);
  await page.getByRole("button", { name: "Look up address" }).click();
  await expect(page.getByText(`Site: ${address}`)).toBeVisible();
  await expect(page.getByLabel("Job name")).toHaveValue("100 Main St");
  await page.getByLabel("Client name").fill("Morganton Homes");
  await page.getByRole("button", { name: "Create job" }).click();

  await expect(page.getByRole("heading", { name: "J-1001" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Morganton Homes" })).toBeVisible();
  await expect(page.getByRole("link", { name: "100 Main St" })).toBeVisible();

  await page.getByRole("link", { name: "Pipeline" }).click();
  await expect(page.getByRole("heading", { name: "Pipeline" })).toBeVisible();
  const lead = page.getByRole("region", { name: /^Lead,/ });
  await expect(lead.getByRole("link", { name: "100 Main St" })).toBeVisible();
  await expect(lead).toContainText("1 job");

  await page.getByLabel("Move 100 Main St").selectOption("won");
  await expect(page.getByRole("alert")).toContainText("Cannot change a job from lead to won.");

  await page.getByLabel("Move 100 Main St").selectOption("lost");
  await expect(page.getByRole("heading", { name: "Why was this job lost?" })).toBeVisible();
  await expect(page.getByLabel("Reason")).toBeFocused();
  await page.getByLabel("Reason").fill("Went with another bid");
  await page.getByRole("button", { name: "Mark lost" }).click();

  const lost = page.getByRole("region", { name: /^Lost,/ });
  await expect(lost.getByRole("link", { name: "100 Main St" })).toBeVisible();
  await expect(lead.getByRole("link", { name: "100 Main St" })).toHaveCount(0);

  await lost.getByRole("link", { name: "100 Main St" }).click();
  await expect(page.getByRole("heading", { name: "J-1001" })).toBeVisible();
  await page.getByRole("tab", { name: "Activity" }).click();
  await expect(page.getByText("Reason: Went with another bid")).toBeVisible();

  await page.getByRole("tab", { name: "Files and photos" }).click();
  await page.getByLabel("Photo or file").setInputFiles({
    name: "site.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await page.getByRole("button", { name: "Upload file" }).click();
  const photo = page.getByRole("img", { name: "Uploaded photo" });
  await expect(photo).toBeVisible();
  await expect
    .poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);

  await page.reload();
  await expect(page.getByRole("heading", { name: "J-1001" })).toBeVisible();
  await page.getByRole("tab", { name: "Files and photos" }).click();
  const again = page.getByRole("img", { name: "Uploaded photo" });
  await expect
    .poll(() => again.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);

  await page.getByRole("link", { name: "Jobs" }).click();
  await expect(page.getByRole("heading", { name: "Jobs" })).toBeVisible();
  const search = page.getByLabel("Search clients, jobs, and sites");
  const results = page.getByRole("region", { name: "Search results" });
  await search.fill("Morganton Homes");
  await expect(results.getByRole("heading", { name: "Clients" })).toBeVisible();
  await expect(results.getByRole("link", { name: "Morganton Homes" })).toBeVisible();
  await search.fill("J-1001");
  await expect(results.getByRole("heading", { name: "Jobs" })).toBeVisible();
  await expect(results.getByRole("link", { name: /J-1001/ })).toBeVisible();
  await search.fill("Main St");
  await expect(results.getByRole("heading", { name: "Sites" })).toBeVisible();
  await expect(
    results.getByRole("link", { name: "100 Main St, Morganton, NC 28655" }),
  ).toBeVisible();
});

async function signUp(page: Page, email: string) {
  await page.goto("/sign-up");
  await expect(page.getByRole("heading", { name: "Create account" })).toBeVisible();
  await page.getByLabel("Name").fill("Pat Owner");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Create workspace" })).toBeVisible();
  await page.getByLabel("Company name").fill("Pat Paving");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await skipOnboarding(page);
}
