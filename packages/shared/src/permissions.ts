/**
 * System-role permission tokens. The matrix in spec 02 uses checkmarks plus
 * qualifiers ("read", "read assigned", "read own", "crew only") that are not
 * a vocabulary. ADR 0007 records the tokens below. A later ticket must use
 * these strings; do not invent a second encoding.
 *
 * `jobs.force_won` is not in the spec 02 matrix. Spec 03 requires it to mark a
 * job won without a signed proposal. Wildcards are not expanded, so `jobs.*`
 * does not include it. Owner and admin hold the token. ADR 0009.
 */
export const PERMISSIONS = [
  "workspace.manage",
  "billing",
  "members.manage",
  "crm.*",
  "jobs.*",
  "jobs.force_won",
  "crm.read.assigned",
  "jobs.read.assigned",
  "takeoff.*",
  "estimate.*",
  "proposal.send",
  "takeoff.read",
  "estimate.read",
  "proposal.read",
  "catalog.manage",
  "schedule.manage",
  "schedule.read",
  "schedule.read.own",
  "time.own",
  "checklist.own",
  "photo.own",
  "time.approve",
  "time.approve.crew",
  "invoice.*",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const SYSTEM_ROLE_NAMES = [
  "owner",
  "admin",
  "estimator",
  "office",
  "foreman",
  "crew",
] as const;

export type SystemRoleName = (typeof SYSTEM_ROLE_NAMES)[number];

const OWN = ["time.own", "checklist.own", "photo.own"] as const satisfies readonly Permission[];

export const SYSTEM_ROLE_PERMISSIONS: Record<SystemRoleName, readonly Permission[]> = {
  owner: [
    "workspace.manage",
    "billing",
    "members.manage",
    "crm.*",
    "jobs.*",
    "takeoff.*",
    "estimate.*",
    "proposal.send",
    "catalog.manage",
    "schedule.manage",
    ...OWN,
    "time.approve",
    "invoice.*",
    "jobs.force_won",
  ],
  admin: [
    "workspace.manage",
    "members.manage",
    "crm.*",
    "jobs.*",
    "takeoff.*",
    "estimate.*",
    "proposal.send",
    "catalog.manage",
    "schedule.manage",
    ...OWN,
    "time.approve",
    "invoice.*",
    "jobs.force_won",
  ],
  estimator: [
    "crm.*",
    "jobs.*",
    "takeoff.*",
    "estimate.*",
    "proposal.send",
    "catalog.manage",
    ...OWN,
  ],
  office: [
    "crm.*",
    "jobs.*",
    "takeoff.read",
    "estimate.read",
    "proposal.read",
    "schedule.manage",
    ...OWN,
    "time.approve",
    "invoice.*",
  ],
  foreman: [
    "crm.read.assigned",
    "jobs.read.assigned",
    "schedule.read",
    ...OWN,
    "time.approve.crew",
  ],
  crew: ["schedule.read.own", ...OWN],
};

export function isSystemRoleName(value: string): value is SystemRoleName {
  return (SYSTEM_ROLE_NAMES as readonly string[]).includes(value);
}

export function hasPermission(permissions: readonly string[], permission: Permission): boolean {
  return permissions.includes(permission);
}
