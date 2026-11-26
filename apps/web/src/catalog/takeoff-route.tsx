import { useQuery, useQueryClient } from "@tanstack/react-query";

import { activeWorkspace, loadMe } from "../session";
import { canManageCatalog } from "./access";
import { createTakeoffItem, errorMessage, listTakeoff, updateTakeoffItem } from "./client";
import { CatalogSectionNav } from "./section-nav";
import { TakeoffScreen } from "./takeoff-screen";

export function TakeoffRoute() {
  const client = useQueryClient();
  const profile = useQuery({ queryKey: ["me"], queryFn: loadMe });
  const workspaceId = profile.data ? activeWorkspace(profile.data)?.workspace_id : undefined;
  const items = useQuery({
    queryKey: ["takeoff-items", workspaceId],
    queryFn: () => listTakeoff(workspaceId ?? ""),
    enabled: Boolean(workspaceId),
  });

  if (!profile.data || !workspaceId) {
    return <p>Loading takeoff items.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <CatalogSectionNav />
      {items.error ? (
        <p role="alert">{errorMessage(items.error, "Could not load takeoff items.")}</p>
      ) : null}
      <TakeoffScreen
        items={items.data?.items ?? []}
        loading={items.isLoading}
        canManage={canManageCatalog(profile.data)}
        onCreate={async (body) => {
          await createTakeoffItem(workspaceId, body);
          await client.invalidateQueries({ queryKey: ["takeoff-items", workspaceId] });
        }}
        onPatch={async (id, patch) => {
          await updateTakeoffItem(workspaceId, id, patch);
          await client.invalidateQueries({ queryKey: ["takeoff-items", workspaceId] });
        }}
      />
    </div>
  );
}
