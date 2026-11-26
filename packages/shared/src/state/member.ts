export const MEMBER_STATUSES = ["invited", "active", "disabled", "revoked"] as const;

export type MemberStatus = (typeof MEMBER_STATUSES)[number];

/** Spec 02: invite tokens last 7 days. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const TRANSITIONS: Record<MemberStatus, readonly MemberStatus[]> = {
  invited: ["active", "revoked"],
  active: ["disabled"],
  disabled: ["active"],
  revoked: [],
};

export class IllegalMemberTransitionError extends Error {
  readonly from: MemberStatus;
  readonly to: MemberStatus;

  constructor(from: MemberStatus, to: MemberStatus) {
    super(`Cannot change a member from ${from} to ${to}.`);
    this.name = "IllegalMemberTransitionError";
    this.from = from;
    this.to = to;
  }
}

export class InviteExpiredError extends Error {
  constructor() {
    super("The invite has expired.");
    this.name = "InviteExpiredError";
  }
}

export class LastOwnerError extends Error {
  constructor() {
    super("The workspace needs one active owner.");
    this.name = "LastOwnerError";
  }
}

export function isMemberStatus(value: string): value is MemberStatus {
  return (MEMBER_STATUSES as readonly string[]).includes(value);
}

/**
 * Spec 02: invited -> active, active -> disabled, disabled -> active,
 * invited -> revoked. Anything else is illegal. The API maps that to 409.
 * Revoked keeps the row. The spec's "(deleted)" wording is recorded in ADR 0007.
 */
export function transitionMember(from: MemberStatus, to: MemberStatus): MemberStatus {
  if (from === to) {
    return from;
  }
  if (!TRANSITIONS[from].includes(to)) {
    throw new IllegalMemberTransitionError(from, to);
  }
  return to;
}

export function inviteExpiresAt(now: Date): Date {
  return new Date(now.getTime() + INVITE_TTL_MS);
}

/** An invite whose expiry is now or earlier cannot be accepted. */
export function assertInviteCurrent(expiresAt: Date, now: Date): void {
  if (expiresAt.getTime() <= now.getTime()) {
    throw new InviteExpiredError();
  }
}

/**
 * Demoting, disabling, or revoking the last active owner is refused.
 * `activeOwnerCount` includes the member being changed.
 */
export function assertKeepsAnOwner(input: {
  activeOwnerCount: number;
  wasActiveOwner: boolean;
  willBeActiveOwner: boolean;
}): void {
  if (input.wasActiveOwner && !input.willBeActiveOwner && input.activeOwnerCount <= 1) {
    throw new LastOwnerError();
  }
}
