import { hasPermission, type Permission } from "@groundwork/shared";

export type RecordAccess = {
  read: boolean;
  write: boolean;
  /** True when the caller may read only jobs they own, and records tied to those jobs. */
  assignedOnly: boolean;
};

export type JobAccess = RecordAccess & {
  forceWon: boolean;
};

function access(
  permissions: readonly string[],
  write: Permission,
  assigned: Permission,
): RecordAccess {
  const canWrite = hasPermission(permissions, write);
  const canAssigned = hasPermission(permissions, assigned);
  return {
    read: canWrite || canAssigned,
    write: canWrite,
    assignedOnly: !canWrite && canAssigned,
  };
}

export function crmAccess(permissions: readonly string[]): RecordAccess {
  return access(permissions, "crm.*", "crm.read.assigned");
}

export function jobAccess(permissions: readonly string[]): JobAccess {
  return {
    ...access(permissions, "jobs.*", "jobs.read.assigned"),
    forceWon: hasPermission(permissions, "jobs.force_won"),
  };
}
