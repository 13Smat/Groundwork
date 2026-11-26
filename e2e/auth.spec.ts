import { expect, test } from "@playwright/test";

test("a new user can sign up, create a workspace, and see an empty dashboard", async ({ page }) => {
  const email = `owner-${Date.now()}@example.com`;
  await page.goto("/sign-up");
  await page.getByLabel("Name").focus();
  await page.keyboard.type("Pat Owner");
  await page.keyboard.press("Tab");
  await page.keyboard.type(email);
  await page.keyboard.press("Tab");
  await page.keyboard.type("correct-horse-battery");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");

  await expect(page.getByRole("heading", { name: "Create workspace" })).toBeVisible();
  await page.getByLabel("Company name").fill("Pat Paving");
  await page.keyboard.press("Enter");

  await expect(page.getByText("No jobs yet")).toBeVisible();
  await expect(page.getByLabel("Workspace")).toHaveValue(/.+/);
  await expect(page.getByLabel("Workspace")).toContainText("Pat Paving");
});

test("an owner can invite a member from the members page", async ({ page }) => {
  const email = `owner-${Date.now()}@example.com`;
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Riley Owner");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Company name").fill("Riley Paving");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await page.getByRole("link", { name: "Members" }).click();

  const invite = `crew-${Date.now()}@example.com`;
  await page.getByLabel("Email").fill(invite);
  await page.getByLabel("Role", { exact: true }).selectOption({ label: "crew" });
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByRole("cell", { name: invite, exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "invited", exact: true })).toBeVisible();
});
