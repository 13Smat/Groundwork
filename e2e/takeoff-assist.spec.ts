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

async function enableAssist(page: Page): Promise<void> {
  const id = await workspaceId(page);
  const status = await page.evaluate(async (current) => {
    const response = await fetch(`/workspaces/${current}`, {
      method: "PATCH",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        "x-workspace-id": current,
      },
      body: JSON.stringify({ features: { ai_assist: true } }),
    });
    return response.status;
  }, id);
  if (status !== 200) {
    throw new Error(`Could not enable assist (${status}).`);
  }
  await page.reload();
  await expect
    .poll(async () =>
      page.evaluate(async (current) => {
        const response = await fetch(`/workspaces/${current}`, {
          credentials: "include",
          headers: { "x-workspace-id": current },
        });
        if (!response.ok) {
          return false;
        }
        const body = (await response.json()) as { features?: { ai_assist?: boolean } };
        return body.features?.ai_assist === true;
      }, id),
    )
    .toBe(true);
  await expect(page.getByText("No jobs yet")).toBeVisible();
}

async function loadStarter(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Catalog", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Catalog" })).toBeVisible();
  await page.getByRole("button", { name: "Load starter pack" }).click();
  await expect(page.getByText(/takeoff items/)).toBeVisible();
}

async function createJob(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Jobs" }).click();
  await expect(page.getByRole("heading", { name: "Jobs" })).toBeVisible();
  await page.getByRole("link", { name: "New job" }).click();
  await expect(page.getByRole("heading", { name: "New job" })).toBeVisible();
  await page.getByLabel("Site address").fill("100 Main St, Morganton, NC 28655");
  await page.getByRole("button", { name: "Look up address" }).click();
  await expect(page.getByText("Site: 100 Main St, Morganton, NC 28655")).toBeVisible();
  await page.getByLabel("Client name").fill("Morganton Homes");
  await page.getByRole("button", { name: "Create job" }).click();
  await expect(page.getByRole("heading", { name: "J-1001" })).toBeVisible();
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

async function chooseCapture(page: Page, label: string): Promise<void> {
  const select = page.getByLabel("Imagery capture");
  const value = await select.locator("option", { hasText: label }).getAttribute("value");
  if (!value) {
    throw new Error(`No imagery option includes ${label}.`);
  }
  await select.selectOption(value);
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

async function openEditor(page: Page, logs: readonly string[]): Promise<void> {
  await page.getByRole("tab", { name: "Takeoffs" }).click();
  await expect(page.getByRole("heading", { name: "Takeoffs" })).toBeVisible();
  await page.getByRole("button", { name: "New takeoff" }).click();
  await expect(page.getByRole("heading", { name: "Takeoff editor" })).toBeVisible();
  await expectMapReady(page, logs);
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

async function dragMap(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  const canvas = page.getByLabel("Takeoff drawing surface");
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error("The takeoff map has no box.");
  }
  await page.mouse.move(box.x + box.width * from.x, box.y + box.height * from.y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to.x, box.y + box.height * to.y, { steps: 8 });
  await page.mouse.up();
}

async function dragAcceptedVertex(page: Page): Promise<void> {
  const canvas = page.getByLabel("Takeoff drawing surface");
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error("The takeoff map has no box.");
  }
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  await page.mouse.click(centerX, centerY);
  await page.mouse.move(centerX - 14, centerY + 17);
  await page.mouse.down();
  await page.mouse.move(centerX - 48, centerY + 52, { steps: 10 });
  await page.mouse.up();
}

test("assist controls stay hidden when the workspace flag is off", async ({ page }) => {
  test.setTimeout(120_000);
  const logs = watchPage(page);
  await signUp(page, "Assist Off");
  await workspaceId(page);
  await loadStarter(page);
  await createJob(page);
  await openEditor(page, logs);
  await expect(page.getByRole("checkbox", { name: "Assist" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Accept" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Refine" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Discard" })).toHaveCount(0);
});

test("prompt, refine, accept, and edit a mock assist polygon", async ({ page }) => {
  test.setTimeout(180_000);
  const logs = watchPage(page);
  await signUp(page, "Assist On");
  await enableAssist(page);
  await loadStarter(page);
  await createJob(page);
  await openEditor(page, logs);
  await chooseCapture(page, "Fixture");
  await expect(page.getByLabel("Imagery capture").locator("option:checked")).toContainText(
    "Fixture",
  );
  await expectMapReady(page, logs);
  await page.getByRole("button", { name: "Aggregate base" }).click();

  await page.getByRole("checkbox", { name: "Assist" }).check();
  await page.getByRole("radio", { name: "Box" }).click();
  await dragMap(page, { x: 0.42, y: 0.42 }, { x: 0.58, y: 0.58 });
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("Draft polygon. Dashed until you accept.")).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole("button", { name: "Refine" }).click();
  await expect(
    page.getByText("Add a positive or negative point, or drag a box, to refine."),
  ).toBeVisible();
  await page.getByRole("radio", { name: "Positive point" }).click();
  await clickMap(page, 0.52, 0.48);
  await expect(page.getByText("Draft polygon. Dashed until you accept.")).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole("button", { name: "Accept" }).click();
  await expect(
    page.getByText("Accepted. The polygon is a measurement you can edit."),
  ).toBeVisible();
  const measurement = page.getByRole("region", { name: "Selected measurement" });
  await expect(measurement.getByText("AI assist")).toBeVisible();
  await expect(page.getByText(/Server total \d+ ft²/)).toBeVisible();

  await page.getByRole("radio", { name: "Select" }).click();
  await dragAcceptedVertex(page);
  await expect(page.getByText(/Live total \d+ ft²/)).toBeVisible();
  await page.getByRole("button", { name: "Save measurements" }).click();
  await expect(page.getByLabel("Save result")).toContainText("Saved");
  await expect(page.getByText(/Server total \d+ ft²/)).toBeVisible();
});
