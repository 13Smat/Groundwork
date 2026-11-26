import { activeWorkspace, type Me } from "../session";

export function canManageCatalog(me: Me | undefined): boolean {
  const permissions = me ? activeWorkspace(me)?.permissions : undefined;
  return permissions?.includes("catalog.manage") ?? false;
}
