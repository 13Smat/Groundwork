export const BOARD_STAGES = ["lead", "estimating", "proposed", "won", "lost"] as const;

export type BoardStage = (typeof BOARD_STAGES)[number];

const STAGE_LABEL: Record<BoardStage, string> = {
  lead: "Lead",
  estimating: "Estimating",
  proposed: "Proposed",
  won: "Won",
  lost: "Lost",
};

export function isBoardStage(stage: string): stage is BoardStage {
  return (BOARD_STAGES as readonly string[]).includes(stage);
}

export function stageLabel(stage: string): string {
  return isBoardStage(stage) ? STAGE_LABEL[stage] : stage;
}

export function formatCents(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

/** Dollars typed in a field, stored as integer cents. Blank is null. */
export function dollarsToCents(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match || match[1] === undefined) {
    throw new Error("Enter a dollar amount with up to two decimal places.");
  }
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) {
    throw new Error("That amount is too large.");
  }
  return cents;
}

export function formatWhen(value: string | null): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function memberName(
  members: { id: string; name: string | null; email: string | null }[],
  id: string | null,
): string {
  if (!id) {
    return "Unassigned";
  }
  const member = members.find((item) => item.id === id);
  return member?.name || member?.email || "Member";
}

export function jobCountLabel(count: number): string {
  return count === 1 ? "1 job" : `${count} jobs`;
}
