import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export async function expectNoSeriousViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const violations = results.violations.filter(
    (item) => item.impact === "serious" || item.impact === "critical",
  );
  const summary = violations.map((item) => {
    const nodes = item.nodes
      .slice(0, 3)
      .map((node) => node.target.join(" "))
      .join("; ");
    return `${item.id} (${item.impact}): ${item.help} [${nodes}]`;
  });
  expect(summary, summary.join("\n")).toEqual([]);
}

export async function expectFocusStaysInDialog(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  for (let step = 0; step < 6; step += 1) {
    await page.keyboard.press("Tab");
    const inside = await dialog.evaluate((node) => node.contains(document.activeElement));
    expect(inside).toBe(true);
  }
}
