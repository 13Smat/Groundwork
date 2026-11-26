import type { ColumnType, Generated } from "kysely";

/**
 * Column names match the SQL. audit_log and usage_event follow the spec 01
 * sketch (bigserial, `at`). event_log has no workspace_id. ADR 0005.
 */
export interface Database {
  counters: {
    id: string;
    workspace_id: string;
    prefix: string;
    last_value: string;
    created_at: Generated<Date>;
    updated_at: Generated<Date>;
    created_by: string | null;
  };
  file: {
    id: string;
    workspace_id: string;
    storage_key: string;
    mime: string | null;
    bytes: string | null;
    sha256: string | null;
    status: string;
    created_at: Generated<Date>;
    updated_at: Generated<Date>;
    created_by: string | null;
  };
  event_log: {
    id: string;
    provider: string;
    event_id: string;
    payload: ColumnType<unknown, unknown, unknown> | null;
    processed_at: Date | null;
  };
  audit_log: {
    id: Generated<string>;
    workspace_id: string;
    actor_member_id: string | null;
    entity_type: string | null;
    entity_id: string | null;
    action: string | null;
    diff: ColumnType<unknown, unknown, unknown> | null;
    at: Generated<Date | null>;
  };
  usage_event: {
    id: Generated<string>;
    workspace_id: string;
    kind: string | null;
    units: string | null;
    cost_estimate_cents: string | null;
    at: Generated<Date | null>;
  };
  app_user: {
    id: string;
    name: string;
    email: string;
    email_verified: boolean;
    image: string | null;
    phone: string | null;
    created_at: Generated<Date>;
    updated_at: Generated<Date>;
  };
  workspace: {
    id: string;
    name: string;
    slug: string;
    logo: string | null;
    created_at: Generated<Date>;
    updated_at: Generated<Date>;
    metadata: string | null;
    timezone: string;
    currency: string;
    units_pref: string;
    features: ColumnType<Record<string, unknown>, Record<string, unknown>, Record<string, unknown>>;
    plan: string | null;
    address: ColumnType<
      Record<string, unknown> | null,
      Record<string, unknown> | null,
      Record<string, unknown> | null
    >;
    license_number: string | null;
  };
  role: {
    id: string;
    workspace_id: string | null;
    name: string;
    permissions: string[];
    is_system: boolean;
    created_at: Generated<Date>;
    updated_at: Generated<Date>;
  };
  member: {
    id: string;
    workspace_id: string;
    user_id: string | null;
    role: string;
    role_id: string;
    status: string;
    invite_email: string | null;
    created_at: Generated<Date>;
    updated_at: Generated<Date>;
  };
  invitation: {
    id: string;
    workspace_id: string;
    email: string;
    role: string | null;
    status: string;
    expires_at: Date;
    created_at: Generated<Date>;
    inviter_id: string;
    member_id: string | null;
  };
  /**
   * Global rows use a null workspace_id. The read policy is in 0003_imagery.sql.
   * Spatial queries go through sql so dates are cast to text there.
   */
  imagery_source: {
    id: string;
    workspace_id: string | null;
    provider: string;
    name: string;
    coverage: unknown;
    capture_date: string | null;
    gsd_cm: string | null;
    bands: string;
    license_text: string | null;
    license_url: string | null;
    allows_tracing: boolean;
    allows_ml_training: boolean;
    attribution: string | null;
    verified_at: Date | null;
    notes: string | null;
    created_at: Generated<Date>;
    updated_at: Generated<Date>;
    created_by: string | null;
  };
  imagery_capture: {
    id: string;
    workspace_id: string | null;
    source_id: string;
    coverage: unknown;
    capture_date: string;
    gsd_cm: string;
    bands: string;
    leaf: string | null;
    cog_key: string | null;
    status: string;
    notes: string | null;
    created_at: Generated<Date>;
    updated_at: Generated<Date>;
    created_by: string | null;
  };
  imagery_ingest_job: {
    id: string;
    workspace_id: string;
    source_id: string;
    capture_id: string;
    county_fips: string | null;
    aoi: unknown;
    year: number;
    idempotency_key: string;
    request_hash: string;
    status: string;
    error: string | null;
    created_at: Generated<Date>;
    updated_at: Generated<Date>;
    created_by: string | null;
  };
  parcel_cache: {
    id: string;
    provider: string;
    provider_parcel_id: string;
    geom: unknown;
    attrs: ColumnType<unknown, unknown, unknown>;
    fetched_at: Generated<Date>;
  };
  client: {
    id: string;
    workspace_id: string;
    type: string;
    name: string;
    billing_address: unknown | null;
    email: string | null;
    phone: string | null;
    tags: string[];
    archived_at: Date | null;
    created_at: Generated<Date>;
    updated_at: Generated<Date>;
    created_by: string | null;
  };
  contact: {
    id: string;
    workspace_id: string;
    client_id: string;
    name: string;
    email: string | null;
    phone: string | null;
    role: string | null;
    is_primary: boolean;
    created_at: Generated<Date>;
    updated_at: Generated<Date>;
    created_by: string | null;
  };
  location: {
    id: string;
    workspace_id: string;
    client_id: string | null;
    address: unknown;
    point: unknown;
    parcel_cache_id: string | null;
    site_geom: unknown;
    notes: string | null;
    created_at: Generated<Date>;
    updated_at: Generated<Date>;
    created_by: string | null;
  };
  job: {
    id: string;
    workspace_id: string;
    number: string;
    client_id: string | null;
    location_id: string | null;
    name: string;
    stage: string;
    bid_value_cents: ColumnType<string | null, string | number | null, string | number | null>;
    owner_member_id: string | null;
    source: string | null;
    lost_reason: string | null;
    tags: string[];
    created_at: Generated<Date>;
    updated_at: Generated<Date>;
    created_by: string | null;
  };
  job_note: {
    id: string;
    workspace_id: string;
    job_id: string;
    body: string;
    created_at: Generated<Date>;
    updated_at: Generated<Date>;
    created_by: string | null;
  };
  job_task: {
    id: string;
    workspace_id: string;
    job_id: string;
    title: string;
    done: boolean;
    due_at: Date | null;
    created_at: Generated<Date>;
    updated_at: Generated<Date>;
    created_by: string | null;
  };
  job_file: {
    id: string;
    workspace_id: string;
    job_id: string;
    file_id: string;
    created_at: Generated<Date>;
    created_by: string | null;
  };
}
