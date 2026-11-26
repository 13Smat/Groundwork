import { describe, expect, it } from "vitest";

import { FIELD_VERIFY_NOTE, renderProposalHtml, type ProposalPdfModel } from "./index.js";

const COST_TEXT = "$1,234.56";

function model(): ProposalPdfModel {
  return {
    number: "P-1001",
    estimateNumber: "E-1001",
    estimateVersion: 1,
    workspaceName: "Ada Paving",
    clientName: "Morganton Homes",
    siteAddress: "100 Main St",
    jobName: "Driveway",
    preparedOn: "2026-11-26",
    intro: "Thanks for asking us to price this work.",
    scopeNote: "Work is limited to the measured areas.",
    terms: "This proposal is good for 30 days.",
    lines: [
      {
        id: "line-required",
        group: "Asphalt",
        description: "Surface course",
        qty: "120.0000",
        unit: "sy",
        unitPriceCents: 5000,
        priceCents: 600000,
        taxCents: 0,
        optional: false,
      },
      {
        id: "line-optional",
        group: "Asphalt",
        description: "Seal coat",
        qty: "1.0000",
        unit: "ea",
        unitPriceCents: 8000,
        priceCents: 8000,
        taxCents: 0,
        optional: true,
      },
    ],
    selectedOptionalIds: ["line-optional"],
    includeSiteMap: true,
    includeOptional: true,
    siteMapPngBase64: null,
    imagery: [
      {
        provider: "nc_ortho",
        name: "Burke 2024",
        captureDate: "2024-02-11",
        gsdCm: "15",
        attribution: "NC Orthoimagery Program",
      },
    ],
  };
}

describe("proposal html", () => {
  it("prints imagery credits and the field-verify note, and hides cost", () => {
    const html = renderProposalHtml(model());
    expect(html).toContain("nc_ortho");
    expect(html).toContain("Burke 2024");
    expect(html).toContain("2024-02-11");
    expect(html).toContain("GSD 15 cm");
    expect(html).toContain("NC Orthoimagery Program");
    expect(html).toContain(FIELD_VERIFY_NOTE);
    expect(html).toContain("$50.00");
    expect(html).toContain("Included");
    expect(html).not.toContain(COST_TEXT);
    const body = html.replace(/<style>[\s\S]*?<\/style>/, "");
    expect(body.toLowerCase()).not.toContain("margin");
    expect(body.toLowerCase()).not.toContain("unit cost");
  });

  it("is stable for the same model", () => {
    expect(renderProposalHtml(model())).toBe(renderProposalHtml(model()));
  });
});
