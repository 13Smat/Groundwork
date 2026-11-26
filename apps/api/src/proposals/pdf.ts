import { chromium, type Browser, type Request } from "playwright-core";

import { createLogger } from "../logging.js";

const logger = createLogger("proposal-pdf");

let browserPromise: Promise<Browser> | undefined;
let blockedRequestCount = 0;

/**
 * Chromium starts with its sandbox. This process is not a container that
 * refuses the sandbox, so the launch does not pass `--no-sandbox`.
 */
function proposalBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch();
  }
  return browserPromise;
}

function allowedProposalRequest(url: string): boolean {
  return url.startsWith("data:") || url === "about:blank" || url.startsWith("about:blank");
}

/** http(s) and ws(s) reach `context.route`. Playwright does not deliver `file:`. */
function routeIntercepts(url: string): boolean {
  return /^https?:/i.test(url) || /^wss?:/i.test(url);
}

/**
 * Requests the last render aborted, or `file:` loads Playwright's route never
 * sees. Chromium still refuses `file:` from the blank document. Zero means
 * the document did not ask for a remote or local file.
 */
export function blockedProposalRequests(): number {
  return blockedRequestCount;
}

/** Static HTML, printed by local Chromium. JavaScript is off and remote URLs are aborted. */
export async function renderProposalPdf(html: string): Promise<Buffer> {
  const browser = await proposalBrowser();
  const context = await browser.newContext({ javaScriptEnabled: false });
  let blocked = 0;
  const counted = new Set<Request>();
  const note = (request: Request): void => {
    if (counted.has(request)) {
      return;
    }
    counted.add(request);
    const url = request.url();
    if (allowedProposalRequest(url)) {
      return;
    }
    blocked += 1;
    logger.debug({ url }, "aborted proposal PDF request");
  };
  try {
    await context.route("**/*", async (route) => {
      const request = route.request();
      note(request);
      if (allowedProposalRequest(request.url())) {
        await route.continue();
        return;
      }
      await route.abort("blockedbyclient");
    });
    context.on("request", (request) => {
      if (!routeIntercepts(request.url())) {
        note(request);
      }
    });
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "load", timeout: 10_000 });
    const bytes = await page.pdf({
      preferCSSPageSize: true,
      printBackground: true,
      margin: { top: "0.5in", bottom: "0.6in", left: "0.6in", right: "0.6in" },
    });
    return Buffer.from(bytes);
  } finally {
    blockedRequestCount = blocked;
    await context.close();
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
