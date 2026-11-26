const KEY = "groundwork.job-takeoffs";

function readAll(): Record<string, string[]> {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    const next: Record<string, string[]> = {};
    for (const [jobId, value] of Object.entries(parsed)) {
      if (Array.isArray(value)) {
        next[jobId] = value.filter((id): id is string => typeof id === "string");
      }
    }
    return next;
  } catch {
    return {};
  }
}

/** Ids created in this browser. There is no list route. ADR 0014. */
export function rememberedTakeoffs(jobId: string): string[] {
  return readAll()[jobId] ?? [];
}

export function rememberTakeoff(jobId: string, takeoffId: string): void {
  try {
    const all = readAll();
    const rest = (all[jobId] ?? []).filter((id) => id !== takeoffId);
    all[jobId] = [takeoffId, ...rest].slice(0, 20);
    sessionStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // The editor URL still opens the takeoff when storage is blocked.
  }
}
