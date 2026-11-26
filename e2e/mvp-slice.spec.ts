import { expect, test, type Page } from "@playwright/test";

import { expectFocusStaysInDialog, expectNoSeriousViolations } from "./a11y";

const PASSWORD = "correct-horse-battery";

function email(): string {
  return `slice-${crypto.randomUUID()}@example.com`;
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

function watchPage(page: Page): string[] {
  const logs: string[] = [];
  page.on("console", (message) => {
    logs.push(`console ${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => {
    logs.push(`pageerror: ${error.message}`);
  });
  return logs;
}

async function expectMapReady(page: Page, logs: readonly string[]): Promise<void> {
  const ready = page.getByText("Map ready", { exact: true });
  const failed = page.getByText("The map could not start");
  try {
    await expect(ready.or(failed)).toBeVisible({ timeout: 30_000 });
    await expect(failed).toHaveCount(0);
  } catch (error) {
    const body = await page.locator("body").innerText();
    const reason = error instanceof Error ? error.message : "The map was not ready.";
    throw new Error(`${reason}\n--- console ---\n${logs.join("\n")}\n--- page ---\n${body}`, {
      cause: error,
    });
  }
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

test("a new workspace can measure, price, sign, and win a job", async ({ page }) => {
  test.setTimeout(240_000);
  const logs = watchPage(page);

  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Slice Owner");
  await page.getByLabel("Email").fill(email());
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Create workspace" })).toBeVisible();
  await page.getByLabel("Company name").fill("Slice Paving");
  await page.getByLabel("Units").selectOption("imperial");
  await page.getByRole("button", { name: "Create workspace" }).click();

  await expect(page.getByRole("heading", { name: "Company profile" })).toBeVisible();
  await page.getByLabel("Street", { exact: true }).fill("18 Mill Pond Lane");
  await page.getByLabel("City").fill("Morganton");
  await page.getByLabel("State").fill("NC");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByRole("heading", { name: "Units and timezone" })).toBeVisible();
  await page.getByLabel("Units").selectOption("imperial");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await page.getByRole("button", { name: "Load starter pack" }).click();
  await expect(page.getByRole("status")).toContainText(/Added \d+ catalog items/);
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page.getByText("No jobs yet")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();

  await page.getByRole("link", { name: "Catalog", exact: true }).click();
  await page.getByRole("link", { name: "Cost recipes" }).click();
  await page.getByRole("link", { name: "Open Aggregate base version 1" }).click();
  await page.getByRole("button", { name: "Activate version 1" }).click();
  await expect(page.getByRole("link", { name: "Version 1, active" })).toBeVisible();

  await page.getByRole("link", { name: "Jobs" }).click();
  await expect(page.getByRole("heading", { name: "Jobs" })).toBeVisible();
  await page.getByRole("link", { name: "New job" }).click();
  await expect(page.getByRole("heading", { name: "New job" })).toBeVisible();
  await expectNoSeriousViolations(page);
  await page.getByLabel("Site address").fill("100 Main St, Morganton, NC 28655");
  await page.getByRole("button", { name: "Look up address" }).click();
  await expect(page.getByText("Site: 100 Main St, Morganton, NC 28655")).toBeVisible();
  await page.getByLabel("Client name").fill("Hale Family");
  await page.getByRole("button", { name: "Create job" }).click();
  await expect(page.getByRole("heading", { name: "J-1001" })).toBeVisible();
  const jobId = page.url().match(/\/jobs\/([^/]+)/)?.[1];
  if (!jobId) {
    throw new Error("The job page did not include an id.");
  }

  await page.getByRole("tab", { name: "Takeoffs" }).click();
  await expect(page.getByRole("heading", { name: "Takeoffs" })).toBeVisible();
  await page.getByRole("button", { name: "New takeoff" }).click();
  await expect(page.getByRole("heading", { name: "Takeoff editor" })).toBeVisible();
  await expectMapReady(page, logs);
  await expectNoSeriousViolations(page);

  await page.getByRole("radio", { name: "Polygon" }).click();
  await expect(page.getByText("Drawing Aggregate base.")).toBeVisible();
  await clickMap(page, 0.35, 0.4);
  await clickMap(page, 0.62, 0.4);
  await clickMap(page, 0.62, 0.62);
  await clickMap(page, 0.35, 0.62);
  await clickMap(page, 0.35, 0.4);
  await page.getByRole("button", { name: "Finish shape" }).click();
  await expect(page.getByText(/Live total \d+ ft²/)).toBeVisible();
  await page.getByRole("button", { name: "Save measurements" }).click();
  await expect(page.getByLabel("Save result")).toContainText("Saved");

  await page.getByRole("link", { name: "Back to job" }).click();
  await expect(page.getByRole("heading", { name: "J-1001" })).toBeVisible();
  await page.getByRole("tab", { name: "Estimates" }).click();
  await expect(page.getByRole("heading", { level: 3, name: "Estimates" })).toBeVisible();
  await page.getByLabel("Takeoff").selectOption({ label: "Version 1, draft" });
  await page.getByRole("button", { name: "Create estimate" }).click();
  await expect(page.getByRole("heading", { name: /E-1001/ })).toBeVisible();
  await expect(page.getByText("Crushed aggregate base", { exact: true })).toBeVisible();
  await expectNoSeriousViolations(page);

  await page.getByLabel("Description").fill("Edge restraint");
  await page.getByLabel("Quantity").fill("1");
  await page.getByLabel("Unit", { exact: true }).fill("ea");
  await page.getByLabel("Unit price (dollars)").fill("75");
  await page.getByRole("checkbox", { name: "Optional alternate", exact: true }).check();
  await page.getByRole("button", { name: "Add manual line" }).click();
  await expect(page.getByRole("row", { name: /Edge restraint/ })).toBeVisible();
  await page.getByRole("button", { name: "Mark ready" }).click();
  await expect(page.getByRole("link", { name: "Build proposal" })).toBeVisible();
  await page.getByRole("link", { name: "Build proposal" }).click();
  await page.getByRole("button", { name: "Create proposal" }).click();
  await expect(page.getByRole("heading", { name: "P-1001" })).toBeVisible();
  await expectNoSeriousViolations(page);
  await page.getByRole("button", { name: "Render PDF" }).click();
  await expect(page.getByText("Preview ready")).toBeVisible({ timeout: 60_000 });

  await page.getByRole("button", { name: "Client link" }).click();
  const clientLink = await page.getByLabel("Client link").inputValue();
  expect(clientLink).toContain("/p/");
  const proposalUrl = page.url();
  await page.goto(clientLink);
  await expect(page.getByRole("heading", { name: "P-1001" })).toBeVisible();
  await expectNoSeriousViolations(page);
  await page.getByRole("checkbox", { name: /Edge restraint/ }).click();
  await expect(page.getByRole("checkbox", { name: /Edge restraint/ })).toBeChecked({
    timeout: 45_000,
  });

  await page.goto(proposalUrl);
  await expect(page.getByRole("heading", { name: "P-1001" })).toBeVisible();
  await page.getByRole("button", { name: "Send" }).click();
  await expectFocusStaysInDialog(page);
  await page.getByLabel("Recipient name").fill("Rowan Hale");
  await page.getByLabel("Recipient email").fill("rowan.hale@example.com");
  await page.getByRole("button", { name: "Send proposal" }).click();
  await expect(page.getByRole("region", { name: "Proposal timeline" })).toContainText("sent");

  await page.goto(clientLink);
  await page.getByRole("button", { name: "Sign as Rowan Hale" }).click();
  await expect(page.getByText(/Status signed/)).toBeVisible();

  await page.goto(proposalUrl);
  await expect(page.getByText("Work order ready.")).toBeVisible();
  const proposalId = page.url().match(/\/proposals\/([^/]+)/)?.[1];
  if (!proposalId) {
    throw new Error("The proposal page did not include an id.");
  }
  const proposal = (await call(page, `/proposals/${proposalId}`)) as {
    status: string;
    work_order_id: string | null;
  };
  expect(proposal.status).toBe("signed");
  expect(proposal.work_order_id).toBeTruthy();

  await page.goto(`/jobs/${jobId}`);
  await expect(page.locator("dd").filter({ hasText: /^Won$/ })).toBeVisible();
  const job = (await call(page, `/jobs/${jobId}`)) as { stage: string };
  expect(job.stage).toBe("won");
});
