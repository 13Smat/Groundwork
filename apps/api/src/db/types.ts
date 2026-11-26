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
}
