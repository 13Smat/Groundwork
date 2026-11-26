import { expect, test, type Page } from "@playwright/test";

import { expectFocusStaysInDialog, expectNoSeriousViolations } from "./a11y";

const PASSWORD = "correct-horse-battery";

async function signUp(page: Page): Promise<void> {
  await page.goto("/sign-up");
  await expect(page.getByRole("heading", { name: "Create account" })).toBeVisible();
  await expectNoSeriousViolations(page);
  await page.getByLabel("Name").fill("Cedar Owner");
  await page.getByLabel("Email").fill(`onboard-${crypto.randomUUID()}@example.com`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Create workspace" })).toBeVisible();
  await expectNoSeriousViolations(page);
}

test("guided setup loads the starter pack once and the core screens stay accessible", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expectNoSeriousViolations(page);

  await signUp(page);
  await page.getByLabel("Company name").fill("Cedar Ridge Paving");
  await page.getByLabel("Units").selectOption("imperial");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Set up your workspace" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Company profile" })).toBeVisible();
  await expectNoSeriousViolations(page);

  await page.getByLabel("License number").fill("NC-PW-44021");
  await page.getByLabel("Street", { exact: true }).fill("18 Mill Pond Lane");
  await page.getByLabel("City").fill("Morganton");
  await page.getByLabel("State").fill("NC");
  await page.getByLabel("Postal code").fill("28655");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByRole("heading", { name: "Units and timezone" })).toBeFocused();
  await expectNoSeriousViolations(page);

  await page.getByLabel("Timezone").selectOption("America/New_York");
  await page.getByLabel("Units").selectOption("imperial");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByRole("heading", { name: "Starter catalog" })).toBeFocused();
  await expectNoSeriousViolations(page);

  await page.getByRole("button", { name: "Load starter pack" }).click();
  await expect(page.getByRole("status")).toContainText(/Added \d+ catalog items/);
  await expect(page.getByRole("status")).not.toContainText("Added 0 catalog items");
  await page.getByRole("button", { name: "Load starter pack" }).click();
  await expect(page.getByRole("status")).toContainText("Added 0 catalog items");
  await expect(page.getByRole("status")).toContainText(/Skipped \d+ catalog items/);
  await page.getByRole("button", { name: "Finish setup" }).click();

  await expect(page.getByText("No jobs yet")).toBeVisible();
  await expectNoSeriousViolations(page);

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByLabel("Company name")).toHaveValue("Cedar Ridge Paving");
  await expect(page.getByLabel("Units")).toHaveValue("imperial");
  await expect(page.getByLabel("License number")).toHaveValue("NC-PW-44021");
  await expectNoSeriousViolations(page);

  await page.getByRole("link", { name: "Jobs" }).click();
  await expect(page.getByRole("heading", { name: "Jobs" })).toBeVisible();
  await expectNoSeriousViolations(page);

  await page.getByRole("link", { name: "Clients" }).click();
  await expect(page.getByRole("heading", { name: "Clients" })).toBeVisible();
  await expectNoSeriousViolations(page);

  await page.getByRole("link", { name: "Catalog", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Catalog" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Details for Hot-mix asphalt" })).toBeVisible();
  await expectNoSeriousViolations(page);
  await page.getByRole("button", { name: "Details for Hot-mix asphalt" }).click();
  await expect(page.getByRole("dialog", { name: "Hot-mix asphalt" })).toBeVisible();
  await expectFocusStaysInDialog(page);
  await expectNoSeriousViolations(page);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Keyboard help" }).click();
  await expect(page.getByRole("dialog", { name: "Keyboard help" })).toBeVisible();
  await expectFocusStaysInDialog(page);
  await expectNoSeriousViolations(page);
});
