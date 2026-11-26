import { describe, expect, it } from "vitest";

import {
  PERMISSIONS,
  SYSTEM_ROLE_NAMES,
  SYSTEM_ROLE_PERMISSIONS,
  hasPermission,
} from "./permissions.js";

describe("system role permissions", () => {
  it("names the six system roles from spec 02", () => {
    expect(SYSTEM_ROLE_NAMES).toEqual(["owner", "admin", "estimator", "office", "foreman", "crew"]);
  });

  it("uses only tokens from the permission list", () => {
    const known = new Set<string>(PERMISSIONS);
    for (const name of SYSTEM_ROLE_NAMES) {
      for (const permission of SYSTEM_ROLE_PERMISSIONS[name]) {
        expect(known.has(permission)).toBe(true);
      }
    }
  });

  it("matches the spec 02 matrix, including the qualified cells", () => {
    expect(SYSTEM_ROLE_PERMISSIONS.owner).toContain("billing");
    expect(SYSTEM_ROLE_PERMISSIONS.owner).toContain("workspace.manage");
    expect(SYSTEM_ROLE_PERMISSIONS.admin).toContain("workspace.manage");
    expect(SYSTEM_ROLE_PERMISSIONS.admin).not.toContain("billing");
    expect(SYSTEM_ROLE_PERMISSIONS.admin).toContain("members.manage");
    expect(SYSTEM_ROLE_PERMISSIONS.estimator).toContain("catalog.manage");
    expect(SYSTEM_ROLE_PERMISSIONS.estimator).toContain("proposal.send");
    expect(SYSTEM_ROLE_PERMISSIONS.office).not.toContain("catalog.manage");
    expect(SYSTEM_ROLE_PERMISSIONS.office).toContain("takeoff.read");
    expect(SYSTEM_ROLE_PERMISSIONS.office).toContain("estimate.read");
    expect(SYSTEM_ROLE_PERMISSIONS.office).toContain("proposal.read");
    expect(SYSTEM_ROLE_PERMISSIONS.office).toContain("invoice.*");
    expect(SYSTEM_ROLE_PERMISSIONS.foreman).toEqual([
      "crm.read.assigned",
      "jobs.read.assigned",
      "schedule.read",
      "time.own",
      "checklist.own",
      "photo.own",
      "time.approve.crew",
    ]);
    expect(SYSTEM_ROLE_PERMISSIONS.crew).toEqual([
      "schedule.read.own",
      "time.own",
      "checklist.own",
      "photo.own",
    ]);
    expect(hasPermission(SYSTEM_ROLE_PERMISSIONS.crew, "catalog.manage")).toBe(false);
    expect(hasPermission(SYSTEM_ROLE_PERMISSIONS.estimator, "catalog.manage")).toBe(true);
  });
});
