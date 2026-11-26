import type { Address } from "../session";

export type LatLng = { lat: number; lng: number };

export type Client = {
  id: string;
  name: string;
  type: string;
  email: string | null;
  phone: string | null;
  tags: string[];
};

export type Contact = {
  id: string;
  client_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  is_primary: boolean;
};

export type SiteGeom = {
  type: "MultiPolygon";
  coordinates: number[][][][];
};

export type Location = {
  id: string;
  client_id: string | null;
  address: Address;
  point: LatLng | null;
  site_geom: SiteGeom | null;
  notes: string | null;
};

export type Job = {
  id: string;
  number: string;
  name: string;
  stage: string;
  client_id: string | null;
  client_name: string | null;
  location_id: string | null;
  location_line1: string | null;
  point: LatLng | null;
  bid_value_cents: number | null;
  owner_member_id: string | null;
  source: string | null;
  lost_reason: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
};

export type JobFile = {
  id: string;
  file_id: string;
  mime: string | null;
  bytes: number | null;
  status: string;
  storage_key: string;
  created_at: string;
  download_url: string;
};

export type Note = {
  id: string;
  body: string;
  created_by: string | null;
  created_at: string;
};

export type Task = {
  id: string;
  title: string;
  done: boolean;
  due_at: string | null;
  created_at: string;
};

export type ActivityEvent = {
  id: string;
  actor_member_id: string | null;
  action: string | null;
  at: string | null;
  diff: {
    from: string | null;
    to: string | null;
    reason: string | null;
    forced: boolean;
  } | null;
};

export type SearchResults = {
  clients: Client[];
  contacts: Contact[];
  jobs: Job[];
  locations: Location[];
};

export type StageSummary = {
  stage: string;
  count: number;
  bid_value_cents: number;
};

export type AddressLookup = {
  addressText: string;
  formatted: string | null;
  line1: string | null;
  point: LatLng | null;
  warning: string | null;
};

export type CreateJobInput = {
  name: string;
  address: string;
  point: LatLng | null;
  bidValueCents: number | null;
  ownerMemberId: string | null;
  clientId: string | null;
  client: { type: string; name: string; email: string; phone: string } | null;
};

export type ResolveResult = {
  point: LatLng | null;
  formatted: string | null;
  address: { line1?: string } | null;
  warnings: string[];
};
