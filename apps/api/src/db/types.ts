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
  takeoff_item: {
    id: string;
    workspace_id: string;
    name: string;
    measure_kind: string;
    default_unit: string;
    category: string | null;
    color: string | null;
    archived_at: Date | null;
    created_at: Generated<Date>;
    updated_at: Generated<Date>;
    created_by: string | null;
  };
  catalog_item: {
    id: string;
    workspace_id: string;
    kind: string;
    name: string;
    unit: string;
    unit_cost_cents: string;
    unit_price_cents: string;
    waste_pct: string;
    vendor: string | null;
    sku: string | null;
    tax_code: string | null;
    archived_at: Date | null;
    created_at: Generated<Date>;
    updated_at: Generated<Date>;
    created_by: string | null;
  };
  cost_recipe: {
    id: string;
    workspace_id: string;
    family_id: string;
    name: string;
    takeoff_item_id: string | null;
    input_unit: string;
    variables: ColumnType<unknown, unknown, unknown>;
    version: number;
    status: string;
    created_at: Generated<Date>;
    updated_at: Generated<Date>;
    created_by: string | null;
  };
  recipe_component: {
    id: string;
    workspace_id: string;
    recipe_id: string;
    catalog_item_id: string;
    qty_formula: string;
    sort: number;
    created_at: Generated<Date>;
    updated_at: Generated<Date>;
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
  takeoff: {
    id: string;
    workspace_id: string;
    job_id: string;
    location_id: string | null;
    lineage_id: string;
    supersedes_id: string | null;
    kind: string;
    imagery_capture_id: string | null;
    status: string;
    version: number;
    created_at: Generated<Date>;
    updated_at: Generated<Date>;
    created_by: string | null;
  };
  measurement: {
    id: string;
    workspace_id: string;
    takeoff_id: string;
    takeoff_item_id: string;
    kind: string;
    geom: unknown;
    value_m2: string | null;
    value_m: string | null;
    count: number | null;
    source: string;
    confidence: number | null;
    label: string | null;
    deductions: ColumnType<unknown, unknown, unknown>;
    created_at: Generated<Date>;
    updated_at: Generated<Date>;
    created_by: string | null;
  };
  estimate: {
    id: string;
    workspace_id: string;
    job_id: string;
    takeoff_id: string | null;
    number: string;
    version: number;
    status: string;
    markup_pct: string;
    overhead_pct: string;
    tax_rate: string;
    subtotal_cents: string;
    tax_cents: string;
    total_cents: string;
    optional_subtotal_cents: string;
    optional_tax_cents: string;
    optional_total_cents: string;
    snapshot: ColumnType<unknown, unknown, unknown> | null;
    notes: string | null;
    created_at: Generated<Date>;
    updated_at: Generated<Date>;
    created_by: string | null;
  };
  line_item: {
    id: string;
    workspace_id: string;
    estimate_id: string;
    grp: string | null;
    description: string;
    qty: string;
    unit: string;
    unit_cost_cents: string;
    unit_price_cents: string;
    cost_cents: string;
    price_cents: string;
    tax_cents: string;
    source: string;
    recipe_id: string | null;
    recipe_version: number | null;
    recipe_component_id: string | null;
    catalog_item_id: string | null;
    takeoff_item_id: string | null;
    input_qty: string | null;
    input_unit: string | null;
    variables: ColumnType<unknown, unknown, unknown>;
    markup_pct: string | null;
    overhead_pct: string | null;
    tax_code: string | null;
    flagged: boolean;
    optional: boolean;
    price_overridden: boolean;
    measurement_ids: ColumnType<string[], unknown, unknown>;
    sort: number;
    created_at: Generated<Date>;
    updated_at: Generated<Date>;
  };
  detection_run: {
    id: string;
    workspace_id: string;
    takeoff_id: string;
    imagery_capture_id: string | null;
    mode: string;
    classes: string[];
    status: string;
    gpu_seconds: string | null;
    error: string | null;
    idempotency_key: string;
    request_hash: string;
    created_at: Generated<Date>;
    updated_at: Generated<Date>;
    created_by: string | null;
  };
  detection_feature: {
    id: string;
    workspace_id: string;
    run_id: string;
    class: string | null;
    geom: unknown;
    score: number | null;
    accepted_measurement_id: string | null;
    takeoff_item_id: string | null;
    created_at: Generated<Date>;
    updated_at: Generated<Date>;
    created_by: string | null;
  };
  proposal_template: {
    id: string;
    workspace_id: string;
    name: string;
    intro: string;
    scope_note: string;
    terms: string;
    include_site_map: boolean;
    include_optional: boolean;
    created_at: Generated<Date>;
    updated_at: Generated<Date>;
    created_by: string | null;
  };
  proposal: {
    id: string;
    workspace_id: string;
    estimate_id: string;
    template_id: string | null;
    number: string;
    status: string;
    intro: string;
    scope_note: string;
    terms: string;
    include_site_map: boolean;
    include_optional: boolean;
    selected_optional_line_ids: ColumnType<string[], unknown, unknown>;
    public_token_hash: string;
    estimate_version: number;
    snapshot: ColumnType<unknown, unknown, unknown>;
    pdf_file_id: string | null;
    signed_pdf_file_id: string | null;
    provider: string | null;
    provider_envelope_id: string | null;
    expires_at: Date | null;
    created_at: Generated<Date>;
    updated_at: Generated<Date>;
    created_by: string | null;
  };
  signature: {
    id: string;
    workspace_id: string;
    proposal_id: string;
    signer_name: string | null;
    signer_email: string | null;
    signed_at: Date | null;
    ip: string | null;
    provider_event_id: string | null;
    created_at: Generated<Date>;
    updated_at: Generated<Date>;
  };
}
