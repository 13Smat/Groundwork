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
  await page.getByLabel("Email").fill(email("esign"));
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Create workspace" })).toBeVisible();
  await page.getByLabel("Company name").fill(`${name} Co`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await skipOnboarding(page);
}

async function workspaceId(page: Page): Promise<string> {
  let id = "";
  await expect
    .poll(async () => {
      id = await page.evaluate(async () => {
        const response = await fetch("/me", { credentials: "include" });
        if (!response.ok) {
          return "";
        }
        const body = (await response.json()) as {
          active_workspace_id?: string | null;
          memberships?: { workspace_id?: string }[];
        };
        return body.active_workspace_id ?? body.memberships?.[0]?.workspace_id ?? "";
      });
      return id;
    })
    .not.toBe("");
  return id;
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

test("choose an optional item, send, and record a test signature", async ({ page }) => {
  test.setTimeout(180_000);
  await signUp(page, "Esign Owner");
  await workspaceId(page);
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
      optional: true,
    },
  });
  await call(page, `/estimates/${estimate.id}/lines`, {
    method: "POST",
    body: { description: "Base", qty: "1", unit: "sy", unit_price_cents: 5000 },
  });
  await call(page, `/estimates/${estimate.id}/transition`, {
    method: "POST",
    body: { to: "ready" },
  });

  await page.goto(`/jobs/${job.id}/estimates/${estimate.id}`);
  await expect(page.getByRole("heading", { name: /E-1001/ })).toBeVisible();
  await page.getByRole("link", { name: "Build proposal" }).click();
  await page.getByRole("button", { name: "Create proposal" }).click();
  await expect(page.getByRole("heading", { name: "P-1001" })).toBeVisible();
  await page.getByRole("button", { name: "Render PDF" }).click();
  await expect(page.getByText("Preview ready")).toBeVisible({ timeout: 45_000 });
  const proposalUrl = page.url();

  await page.getByRole("button", { name: "Client link" }).click();
  const linkField = page.getByLabel("Client link");
  await expect(linkField).not.toHaveValue("");
  const clientLink = await linkField.inputValue();
  await page.goto(clientLink);
  await expect(page.getByRole("heading", { name: "P-1001" })).toBeVisible();
  await expect(page.getByText(/Status rendered\. Total \$50\.00/)).toBeVisible();
  await page.getByRole("checkbox", { name: /Surface course/ }).click();
  await expect(page.getByText(/Status rendered\. Total \$150\.00/)).toBeVisible({
    timeout: 45_000,
  });
  await expect(page.getByRole("checkbox", { name: /Surface course/ })).toBeChecked();

  await page.goto(proposalUrl);
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByLabel("Recipient name").fill("Ada Owner");
  await page.getByLabel("Recipient email").fill("ada@example.com");
  await page.getByRole("button", { name: "Send proposal" }).click();
  await expect(page.getByRole("region", { name: "Proposal timeline" })).toContainText("sent");

  await page.goto(clientLink);
  await page.getByRole("button", { name: "Sign as Ada Owner" }).click();
  await expect(page.getByText(/Status signed/)).toBeVisible();

  await page.goto(proposalUrl);
  await expect(page.getByText("Work order ready.")).toBeVisible();
  await page.goto(`/jobs/${job.id}`);
  await expect(page.locator("dd").filter({ hasText: /^Won$/ })).toBeVisible();
});
