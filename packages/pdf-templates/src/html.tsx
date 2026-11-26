import { renderToStaticMarkup } from "react-dom/server";

import { ProposalDocument } from "./document.js";
import type { ProposalPdfModel } from "./types.js";

const STYLE = `
  @page { size: letter; margin: 0.6in; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Liberation Sans", "DejaVu Sans", sans-serif;
    color: #1c1915;
    font-size: 12pt;
    line-height: 1.4;
  }
  h1, h2, h3 { font-weight: 600; line-height: 1.2; }
  h1 { font-size: 22pt; }
  h2 { font-size: 14pt; margin-top: 18pt; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 4px 8px 4px 0; border-bottom: 1px solid #d9d1c3; vertical-align: top; }
  img { width: 480px; height: auto; }
  footer { margin-top: 18pt; font-size: 10pt; }
`;

/** Static HTML for Playwright. No external requests and no clock. */
export function renderProposalHtml(model: ProposalPdfModel): string {
  const body = renderToStaticMarkup(<ProposalDocument model={model} />);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Proposal ${escapeText(model.number)}</title><style>${STYLE}</style></head><body>${body}</body></html>`;
}

function escapeText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
