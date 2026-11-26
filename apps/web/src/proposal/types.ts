export type ProposalLine = {
  id: string;
  group: string | null;
  description: string;
  qty: string;
  unit: string;
  unit_price_cents: number;
  price_cents: number;
  tax_cents: number;
  optional: boolean;
  selected: boolean;
};

export type Proposal = {
  id: string;
  job_id: string;
  estimate_id: string;
  template_id: string | null;
  number: string;
  status: string;
  intro: string;
  scope_note: string;
  terms: string;
  include_site_map: boolean;
  include_optional: boolean;
  selected_optional_line_ids: string[];
  estimate_number: string;
  estimate_version: number;
  expires_at: string | null;
  pdf_file_id: string | null;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  lines: ProposalLine[];
  created_at: string;
  updated_at: string;
};

export type ProposalSummary = {
  id: string;
  job_id: string;
  estimate_id: string;
  number: string;
  status: string;
  total_cents: number;
  updated_at: string;
};

export type ProposalTemplate = {
  id: string;
  name: string;
  intro: string;
  scope_note: string;
  terms: string;
  include_site_map: boolean;
  include_optional: boolean;
};
