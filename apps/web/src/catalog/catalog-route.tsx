import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { activeWorkspace, loadMe } from "../session";
import { canManageCatalog } from "./access";
import { CatalogScreen } from "./catalog-screen";
import { CatalogSectionNav } from "./section-nav";
import {
  applyCatalogImport,
  createCatalogItem,
  deleteCatalogItem,
  errorMessage,
  exportCatalog,
  listCatalog,
  loadStarterPack,
  previewCatalogImport,
  updateCatalogItem,
} from "./client";
import { isCatalogKind, type CatalogKind } from "./types";

export function CatalogRoute() {
  const client = useQueryClient();
  const profile = useQuery({ queryKey: ["me"], queryFn: loadMe });
  const workspaceId = profile.data ? activeWorkspace(profile.data)?.workspace_id : undefined;
  const [kind, setKind] = useState<CatalogKind>("material");
  const items = useQuery({
    queryKey: ["catalog-items", workspaceId],
    queryFn: () => listCatalog(workspaceId ?? ""),
    enabled: Boolean(workspaceId),
  });

  if (!profile.data || !workspaceId) {
    return <p>Loading catalog.</p>;
  }

  async function refresh() {
    await client.invalidateQueries({ queryKey: ["catalog-items", workspaceId] });
  }

  return (
    <div className="flex flex-col gap-6">
      <CatalogSectionNav />
      {items.error ? (
        <p role="alert">{errorMessage(items.error, "Could not load the catalog.")}</p>
      ) : null}
      <CatalogScreen
        kind={kind}
        onKind={(next) => {
          if (isCatalogKind(next)) {
            setKind(next);
          }
        }}
        items={items.data?.items ?? []}
        loading={items.isLoading}
        canManage={canManageCatalog(profile.data)}
        onCreate={async (body) => {
          await createCatalogItem(workspaceId, body);
          await refresh();
        }}
        onPatch={async (id, patch) => {
          await updateCatalogItem(workspaceId, id, patch);
          await refresh();
        }}
        onRemove={async (id) => {
          await deleteCatalogItem(workspaceId, id);
          await refresh();
        }}
        onExport={async () => {
          const csv = await exportCatalog(workspaceId);
          const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
          const link = document.createElement("a");
          link.href = url;
          link.download = "catalog.csv";
          link.click();
          URL.revokeObjectURL(url);
        }}
        onPreviewImport={(csv) => previewCatalogImport(workspaceId, csv)}
        onApplyImport={async (csv) => {
          await applyCatalogImport(workspaceId, csv);
          await refresh();
        }}
        onStarter={async () => {
          const result = await loadStarterPack(workspaceId);
          await client.invalidateQueries({ queryKey: ["catalog-items", workspaceId] });
          await client.invalidateQueries({ queryKey: ["takeoff-items", workspaceId] });
          await client.invalidateQueries({ queryKey: ["cost-recipes", workspaceId] });
          return result;
        }}
      />
    </div>
  );
}
