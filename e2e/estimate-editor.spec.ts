import { expect, test, type Page } from "@playwright/test";

import { skipOnboarding } from "./session";

const PASSWORD = "correct-horse-battery";

function uuidV7(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const ms = BigInt(Date.now());
  bytes[0] = Number((ms >> 40n) & 0xffn);
  bytes[1] = Number((ms >> 32n) & 0xffn);
  bytes[2] = Number((ms >> 24n) & 0xffn);
  bytes[3] = Number((ms >> 16n) & 0xffn);
  bytes[4] = Number((ms >> 8n) & 0xffn);
  bytes[5] = Number(ms & 0xffn);
  const sixth = bytes[6] ?? 0;
  const eighth = bytes[8] ?? 0;
  bytes[6] = (sixth & 0x0f) | 0x70;
  bytes[8] = (eighth & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function email(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}@example.com`;
}

const SQUARE = {
  type: "Polygon",
  coordinates: [
    [
      [-81.7, 35.7],
      [-81.699, 35.7],
      [-81.699, 35.701],
      [-81.7, 35.701],
      [-81.7, 35.7],
    ],
  ],
};

const LARGER = {
  type: "Polygon",
  coordinates: [
    [
      [-81.7, 35.7],
      [-81.698, 35.7],
      [-81.698, 35.702],
      [-81.7, 35.702],
      [-81.7, 35.7],
    ],
  ],
};

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

test("create an estimate, override a variable, sync quantities, and mark ready", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signUp(page, "Estimate Editor");
  await page.getByRole("link", { name: "Catalog", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Catalog" })).toBeVisible();
  await page.getByRole("button", { name: "Load starter pack" }).click();
  await expect(page.getByText(/takeoff items/)).toBeVisible();
  await page.getByRole("link", { name: "Cost recipes" }).click();
  await page.getByRole("link", { name: "Open Aggregate base version 1" }).click();
  await page.getByRole("button", { name: "Activate version 1" }).click();
  await expect(page.getByRole("link", { name: "Version 1, active" })).toBeVisible();

  await page.getByRole("link", { name: "Jobs" }).click();
  await expect(page.getByRole("heading", { name: "Jobs" })).toBeVisible();
  await page.getByRole("link", { name: "New job" }).click();
  await page.getByLabel("Site address").fill("100 Main St, Morganton, NC 28655");
  await page.getByRole("button", { name: "Look up address" }).click();
  await expect(page.getByText("Site: 100 Main St, Morganton, NC 28655")).toBeVisible();
  await page.getByLabel("Client name").fill("Morganton Homes");
  await page.getByRole("button", { name: "Create job" }).click();
  await expect(page.getByRole("heading", { name: "J-1001" })).toBeVisible();
  const jobId = page.url().match(/\/jobs\/([^/]+)/)?.[1];
  if (!jobId) {
    throw new Error("The job page did not include an id.");
  }

  const featureId = uuidV7();
  const items = (await call(page, "/takeoff-items")) as {
    items: { id: string; name: string }[];
  };
  const aggregate = items.items.find((item) => item.name === "Aggregate base");
  if (!aggregate) {
    throw new Error("Aggregate base was not in the starter pack.");
  }
  const takeoff = (await call(page, `/jobs/${jobId}/takeoffs`, {
    method: "POST",
    body: { kind: "planset" },
  })) as { id: string };
  await call(page, `/takeoffs/${takeoff.id}/measurements`, {
    method: "PUT",
    body: {
      features: [
        {
          id: featureId,
          takeoff_item_id: aggregate.id,
          kind: "area",
          geom: SQUARE,
        },
      ],
    },
  });

  await page.locator("#main").getByRole("link", { name: "Estimates", exact: true }).click();
  await expect(page.getByRole("heading", { level: 3, name: "Estimates" })).toBeVisible();
  await page.getByLabel("Takeoff").selectOption({ label: "Version 1, draft" });
  await page.getByRole("button", { name: "Create estimate" }).click();
  await expect(page.getByRole("heading", { name: /E-1001/ })).toBeVisible();
  await expect(page.getByText("Crushed aggregate base", { exact: true })).toBeVisible();

  const row = page.getByRole("row", { name: /Crushed aggregate base/ });
  const qty = row.getByRole("cell").first();
  const before = (await qty.innerText()).trim();
  await row.getByLabel("depth_in for Crushed aggregate base").fill("9");
  await row.getByRole("button", { name: "Save depth_in for Crushed aggregate base" }).click();
  await expect(qty).not.toHaveText(before);

  await page.getByLabel("Description").fill("Mobilization");
  await page.getByLabel("Quantity").fill("1");
  await page.getByLabel("Unit", { exact: true }).fill("ea");
  await page.getByLabel("Unit price (dollars)").fill("150");
  await page.getByRole("button", { name: "Add manual line" }).click();
  const mobilization = page.getByRole("row", { name: /Mobilization/ });
  await expect(mobilization).toBeVisible();
  await mobilization.getByRole("checkbox", { name: "Optional alternate for Mobilization" }).check();
  await expect(page.getByText("$150.00").first()).toBeVisible();

  await call(page, `/takeoffs/${takeoff.id}/measurements`, {
    method: "PUT",
    body: {
      features: [
        {
          id: featureId,
          takeoff_item_id: aggregate.id,
          kind: "area",
          geom: LARGER,
        },
      ],
    },
  });
  const syncedQty = (await qty.innerText()).trim();
  await page.getByRole("button", { name: "Sync quantities" }).click();
  await expect(page.getByRole("heading", { name: "Quantity sync" })).toBeVisible();
  await expect(page.getByText("Changed Aggregate base")).toBeVisible();
  await page.getByRole("button", { name: "Apply selected quantities" }).click();
  await expect(page.getByRole("heading", { name: "Quantity sync" })).toHaveCount(0);
  await expect(qty).not.toHaveText(syncedQty);

  await page.getByRole("button", { name: "Versions" }).click();
  await expect(page.getByRole("heading", { name: "Versions" })).toBeVisible();
  await page.getByRole("button", { name: "New version" }).click();
  await expect(page.getByRole("heading", { name: /version 2/ })).toBeVisible();
  await expect(page.getByText("Status Draft")).toBeVisible();
  await page.getByRole("button", { name: "Mark ready" }).click();
  await expect(page.getByText("Ready", { exact: true })).toBeVisible();
  await expect(page.getByText("Clone a version before syncing quantities.")).toBeVisible();
});
