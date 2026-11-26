export function formatCents(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.trunc(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

export function formatMoney(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.trunc(abs / 100).toLocaleString("en-US");
  const frac = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}$${whole}.${frac}`;
}

/** Dollar text such as 12.5 or 12.50. Returns integer cents, or null when the text is not a price. */
export function parseDollars(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) {
    return null;
  }
  const [whole = "0", frac = ""] = trimmed.split(".");
  const cents = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  if (!Number.isSafeInteger(cents)) {
    return null;
  }
  return cents;
}

export function parseWaste(text: string): string | null {
  const trimmed = text.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(trimmed)) {
    return null;
  }
  const value = Number(trimmed);
  if (value < 0 || value > 100) {
    return null;
  }
  return trimmed;
}
