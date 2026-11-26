const WARNING_KEY = "groundwork.job-warnings.";

export function stashWarnings(jobId: string, warnings: string[]): void {
  if (warnings.length === 0) {
    sessionStorage.removeItem(WARNING_KEY + jobId);
    return;
  }
  sessionStorage.setItem(WARNING_KEY + jobId, JSON.stringify(warnings));
}

export function takeWarnings(jobId: string): string[] {
  const raw = sessionStorage.getItem(WARNING_KEY + jobId);
  sessionStorage.removeItem(WARNING_KEY + jobId);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}
