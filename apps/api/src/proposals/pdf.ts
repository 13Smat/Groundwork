import { chromium, type Browser } from "playwright-core";

let browserPromise: Promise<Browser> | undefined;

function proposalBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  }
  return browserPromise;
}

/** HTML from the proposal template, printed by the local Chromium. No network. */
export async function renderProposalPdf(html: string): Promise<Buffer> {
  const browser = await proposalBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "load", timeout: 10_000 });
    const bytes = await page.pdf({
      preferCSSPageSize: true,
      printBackground: true,
      margin: { top: "0.5in", bottom: "0.6in", left: "0.6in", right: "0.6in" },
    });
    return Buffer.from(bytes);
  } finally {
    await page.close();
  }
}

export async function closeProposalBrowser(): Promise<void> {
  const pending = browserPromise;
  browserPromise = undefined;
  if (!pending) {
    return;
  }
  const browser = await pending.catch(() => undefined);
  await browser?.close();
}
