import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { geodesicRectangle, INTERNATIONAL_FOOT_M } from "@groundwork/geo";
import {
  FIELD_VERIFY_NOTE,
  renderProposalHtml,
  type ProposalPdfModel,
} from "@groundwork/pdf-templates";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { afterAll, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
GlobalWorkerOptions.workerSrc = pathToFileURL(
  require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs"),
).href;

import { closeProposalBrowser, renderProposalPdf } from "./pdf.js";
import { renderSiteMap } from "../takeoff/site-map.js";

const COST_TEXT = "$1,234.56";
const STAMP = {
  provider: "nc_ortho",
  name: "Burke leaf-off",
  captureDate: "2024-02-11",
  gsdCm: "15",
  attribution: "NC Orthoimagery Program",
};

function model(): ProposalPdfModel {
  const lines = Array.from({ length: 40 }, (_, index) => ({
    id: `line-${index + 1}`,
    group: index % 2 === 0 ? "Asphalt" : "Stone",
    description: `Scope line ${index + 1}`,
    qty: "10.0000",
    unit: "sy",
    unitPriceCents: 5000,
    priceCents: 50000,
    taxCents: 0,
    optional: index === 39,
  }));
  return {
    number: "P-1001",
    estimateNumber: "E-1001",
    estimateVersion: 2,
    workspaceName: "Ada Paving",
    clientName: "Morganton Homes",
    siteAddress: "100 Main St, Morganton, NC 28655",
    jobName: "Driveway",
    preparedOn: "2026-11-26",
    intro: "Thanks for asking us to price this work.",
    scopeNote: "Work is limited to the measured areas.",
    terms: "This proposal is good for 30 days.",
    lines,
    selectedOptionalIds: ["line-40"],
    includeSiteMap: true,
    includeOptional: true,
    siteMapPngBase64: renderSiteMap(
      [
        {
          kind: "area",
          geometry: geodesicRectangle({
            origin: [-81.703, 35.748],
            widthM: 30 * INTERNATIONAL_FOOT_M,
            heightM: 20 * INTERNATIONAL_FOOT_M,
          }),
        },
      ],
      STAMP,
    ).toString("base64"),
    imagery: [STAMP],
  };
}

async function pdfText(bytes: Buffer): Promise<string> {
  const doc = await getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
  }).promise;
  const pages: string[] = [];
  for (let number = 1; number <= doc.numPages; number += 1) {
    const page = await doc.getPage(number);
    const content = await page.getTextContent();
    pages.push(
      content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " "),
    );
  }
  await doc.destroy();
  return pages.join("\n");
}

describe("proposal pdf", () => {
  afterAll(async () => {
    await closeProposalBrowser();
  });

  it("renders 40 lines and a site image in under 10 seconds, with stable text", async () => {
    const html = renderProposalHtml(model());
    expect(html).toContain("data:image/png;base64,");
    await renderProposalPdf("<!doctype html><html><body><p>warm</p></body></html>");
    const started = performance.now();
    const first = await renderProposalPdf(html);
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(10_000);
    const second = await renderProposalPdf(html);
    const firstText = await pdfText(first);
    const secondText = await pdfText(second);
    expect(secondText).toBe(firstText);
    expect(firstText).toContain("Proposal P-1001");
    expect(firstText).toContain("Scope line 1");
    expect(firstText).toContain("Scope line 40");
    expect(firstText).toContain("$50.00");
    expect(firstText).toContain("nc_ortho");
    expect(firstText).toContain("Burke leaf-off");
    expect(firstText).toContain("2024-02-11");
    expect(firstText).toContain("GSD 15 cm");
    expect(firstText).toContain("NC Orthoimagery Program");
    expect(firstText).toContain(FIELD_VERIFY_NOTE);
    expect(firstText).toContain("Included");
    expect(firstText).not.toContain(COST_TEXT);
    expect(firstText.toLowerCase()).not.toContain("margin");
    expect(firstText.toLowerCase()).not.toContain("unit cost");
  }, 30_000);
});
