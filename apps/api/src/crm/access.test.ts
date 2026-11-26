import { SYSTEM_ROLE_PERMISSIONS } from "@groundwork/shared";
import { describe, expect, it } from "vitest";

import { crmAccess, jobAccess } from "./access.js";

describe("crm and job access", () => {
  it("lets owner, admin, estimator, and office write", () => {
    for (const name of ["owner", "admin", "estimator", "office"] as const) {
      expect(crmAccess(SYSTEM_ROLE_PERMISSIONS[name]).write).toBe(true);
      expect(jobAccess(SYSTEM_ROLE_PERMISSIONS[name]).write).toBe(true);
      expect(jobAccess(SYSTEM_ROLE_PERMISSIONS[name]).assignedOnly).toBe(false);
    }
  });

  it("limits a foreman to assigned reads and gives crew nothing", () => {
    const foreman = SYSTEM_ROLE_PERMISSIONS.foreman;
    expect(crmAccess(foreman)).toEqual({ read: true, write: false, assignedOnly: true });
    expect(jobAccess(foreman).read).toBe(true);
    expect(jobAccess(foreman).write).toBe(false);
    expect(jobAccess(foreman).assignedOnly).toBe(true);
    expect(jobAccess(foreman).forceWon).toBe(false);
    expect(crmAccess(SYSTEM_ROLE_PERMISSIONS.crew).read).toBe(false);
    expect(jobAccess(SYSTEM_ROLE_PERMISSIONS.crew).read).toBe(false);
  });

  it("gives jobs.force_won to owner and admin only", () => {
    expect(jobAccess(SYSTEM_ROLE_PERMISSIONS.owner).forceWon).toBe(true);
    expect(jobAccess(SYSTEM_ROLE_PERMISSIONS.admin).forceWon).toBe(true);
    expect(jobAccess(SYSTEM_ROLE_PERMISSIONS.estimator).forceWon).toBe(false);
    expect(jobAccess(SYSTEM_ROLE_PERMISSIONS.office).forceWon).toBe(false);
  });
});
