export type SearchMode = "number" | "phone" | "text";

/** Digits only. Search and duplicate checks share this. */
export function phoneDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Job numbers are an exact match. A digit-only query of at least 7 digits is a
 * phone. Anything else is a name or street search. Mixing those scans makes the
 * 50k-job search miss its budget.
 */
export function searchMode(value: string): SearchMode {
  const q = value.trim();
  if (/^J-\d+$/i.test(q)) {
    return "number";
  }
  const compact = q.replace(/[\s().+-]/g, "");
  const digits = phoneDigits(q);
  if (digits.length >= 7 && compact === digits) {
    return "phone";
  }
  return "text";
}

/** ILIKE pattern that treats % and _ in the query as literals. */
export function likeContains(value: string): string {
  const escaped = value.replace(/[\\%_]/g, (char) => `\\${char}`);
  return `%${escaped}%`;
}
