/**
 * Hosts tile serving must never contact. The same suffixes live in
 * `services/tiles/groundwork_tiles/guard.py`. This module stays free of the
 * HTTP error type so the migration CLI can import config without building
 * `@groundwork/shared`.
 */
export const FORBIDDEN_HOST_SUFFIXES = [
  "googleapis.com",
  "google.com",
  "gstatic.com",
  "mapbox.com",
  "nconemap.gov",
  "arcgis.com",
] as const;

export function hostIsForbidden(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (host === "") {
    return true;
  }
  return FORBIDDEN_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}
