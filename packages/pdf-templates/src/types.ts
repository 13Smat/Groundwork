/** Client-facing proposal. Cost and margin are not fields on this model. */
export type ProposalPdfLine = {
  id: string;
  group: string | null;
  description: string;
  qty: string;
  unit: string;
  unitPriceCents: number;
  priceCents: number;
  taxCents: number;
  optional: boolean;
};

export type ProposalImageryCredit = {
  provider: string;
  name: string;
  captureDate: string;
  gsdCm: string;
  attribution: string;
};

export type ProposalPdfModel = {
  number: string;
  estimateNumber: string;
  estimateVersion: number;
  workspaceName: string;
  clientName: string;
  siteAddress: string;
  jobName: string;
  preparedOn: string;
  intro: string;
  scopeNote: string;
  terms: string;
  lines: ProposalPdfLine[];
  selectedOptionalIds: readonly string[];
  includeSiteMap: boolean;
  includeOptional: boolean;
  siteMapPngBase64: string | null;
  imagery: readonly ProposalImageryCredit[];
};

export const FIELD_VERIFY_NOTE = "Quantities measured from aerial imagery; field verify.";
