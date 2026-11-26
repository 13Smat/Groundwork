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
}
