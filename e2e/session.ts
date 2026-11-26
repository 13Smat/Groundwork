import { expect, type Page } from "@playwright/test";

export async function skipOnboarding(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Set up your workspace" })).toBeVisible();
  await page.getByRole("button", { name: "Skip setup" }).click();
  await expect(page.getByText("No jobs yet")).toBeVisible();
}
