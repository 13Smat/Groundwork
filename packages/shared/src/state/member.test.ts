import { describe, expect, it } from "vitest";

import {
  INVITE_TTL_MS,
  IllegalMemberTransitionError,
  InviteExpiredError,
  LastOwnerError,
  MEMBER_STATUSES,
  assertInviteCurrent,
  assertKeepsAnOwner,
  inviteExpiresAt,
  transitionMember,
} from "./member.js";

describe("member state machine", () => {
  it("allows invited to active, active to disabled, disabled to active, and invited to revoked", () => {
    expect(transitionMember("invited", "active")).toBe("active");
    expect(transitionMember("active", "disabled")).toBe("disabled");
    expect(transitionMember("disabled", "active")).toBe("active");
    expect(transitionMember("invited", "revoked")).toBe("revoked");
  });

  it("leaves a member on the same status without treating it as a change", () => {
    for (const status of MEMBER_STATUSES) {
      expect(transitionMember(status, status)).toBe(status);
    }
  });

  it("rejects every other pair", () => {
    const legal = new Set([
      "invited->active",
      "invited->revoked",
      "active->disabled",
      "disabled->active",
    ]);
    for (const from of MEMBER_STATUSES) {
      for (const to of MEMBER_STATUSES) {
        if (from === to || legal.has(`${from}->${to}`)) {
          continue;
        }
        expect(() => transitionMember(from, to)).toThrow(IllegalMemberTransitionError);
      }
    }
  });

  it("expires an invite after seven days and at the exact expiry instant", () => {
    const now = new Date("2026-11-26T12:00:00.000Z");
    const expires = inviteExpiresAt(now);
    expect(expires.getTime() - now.getTime()).toBe(INVITE_TTL_MS);
    expect(() => assertInviteCurrent(expires, new Date(expires.getTime() - 1))).not.toThrow();
    expect(() => assertInviteCurrent(expires, expires)).toThrow(InviteExpiredError);
    expect(() => assertInviteCurrent(expires, new Date(expires.getTime() + 1))).toThrow(
      InviteExpiredError,
    );
  });

  it("refuses to remove the last active owner and allows it when another owner remains", () => {
    expect(() =>
      assertKeepsAnOwner({
        activeOwnerCount: 1,
        wasActiveOwner: true,
        willBeActiveOwner: false,
      }),
    ).toThrow(LastOwnerError);
    expect(() =>
      assertKeepsAnOwner({
        activeOwnerCount: 2,
        wasActiveOwner: true,
        willBeActiveOwner: false,
      }),
    ).not.toThrow();
    expect(() =>
      assertKeepsAnOwner({
        activeOwnerCount: 1,
        wasActiveOwner: true,
        willBeActiveOwner: true,
      }),
    ).not.toThrow();
    expect(() =>
      assertKeepsAnOwner({
        activeOwnerCount: 1,
        wasActiveOwner: false,
        willBeActiveOwner: false,
      }),
    ).not.toThrow();
  });
});
