import { expect, test, type Page } from "@playwright/test";

import { skipOnboarding } from "./session";

const PASSWORD = "correct-horse-battery";

function email(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}@example.com`;
}

async function signUp(page: Page, name: string): Promise<void> {
  await page.goto("/sign-up");
  await expect(page.getByRole("heading", { name: "Create account" })).toBeVisible();
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email("proposal"));
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Create workspace" })).toBeVisible();
  await page.getByLabel("Company name").fill(`${name} Co`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await skipOnboarding(page);
}

async function call(page: Page, path: string, init?: { method?: string; body?: unknown }) {
  return page.evaluate(
    async ({ path, init }) => {
      const me = (await fetch("/me", { credentials: "include" }).then((response) =>
        response.json(),
      )) as { active_workspace_id: string };
      const headers = new Headers();
      headers.set("x-workspace-id", me.active_workspace_id);
      if (init?.body !== undefined) {
        headers.set("content-type", "application/json");
      }
      const response = await fetch(path, {
        method: init?.method ?? "GET",
        headers,
        body: init?.body === undefined ? undefined : JSON.stringify(init.body),
        credentials: "include",
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`${response.status} ${path} ${text}`);
      }
      return text ? (JSON.parse(text) as unknown) : null;
    },
    { path, init },
  );
}

test("create a proposal, render it, and show the pdf preview", async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page, "Proposal Builder");
  const job = (await call(page, "/jobs", {
    method: "POST",
    body: {
      name: "Driveway",
      client: { name: "Morganton Homes", type: "residential" },
      address: "100 Main St, Morganton, NC 28655",
    },
  })) as { id: string };
  const estimate = (await call(page, `/jobs/${job.id}/estimates`, {
    method: "POST",
    body: {},
  })) as { id: string };
  await call(page, `/estimates/${estimate.id}/lines`, {
    method: "POST",
    body: {
      description: "Surface course",
      qty: "2",
      unit: "sy",
      unit_price_cents: 5000,
    },
  });
  await call(page, `/estimates/${estimate.id}/transition`, {
    method: "POST",
    body: { to: "ready" },
  });

  await page.goto(`/jobs/${job.id}/estimates/${estimate.id}`);
  await expect(page.getByRole("heading", { name: /E-1001/ })).toBeVisible();
  await page.getByRole("link", { name: "Build proposal" }).click();
  await expect(page.getByRole("button", { name: "Create proposal" })).toBeVisible();
  await page.getByRole("button", { name: "Create proposal" }).click();
  await expect(page.getByRole("heading", { name: "P-1001" })).toBeVisible();
  await page.getByLabel("Introduction").fill("Thanks for the visit.");
  await page.getByRole("button", { name: "Save sections" }).click();
  await expect(page.getByLabel("Introduction")).toHaveValue("Thanks for the visit.");
  await page.getByRole("button", { name: "Render PDF" }).click();
  await expect(page.getByText("Preview ready")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByLabel("Proposal PDF preview")).toBeVisible();
});
