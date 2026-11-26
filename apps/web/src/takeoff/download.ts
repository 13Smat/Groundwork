import { activeWorkspace, ApiError, queryClient, type Me } from "../session";

export async function downloadTakeoff(takeoffId: string, format: "geojson" | "png"): Promise<void> {
  const me = queryClient.getQueryData<Me>(["me"]);
  const workspaceId = me ? activeWorkspace(me)?.workspace_id : undefined;
  const response = await fetch(`/takeoffs/${takeoffId}/export?format=${format}`, {
    credentials: "include",
    headers: workspaceId ? { "x-workspace-id": workspaceId } : {},
  });
  if (!response.ok) {
    const problem = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new ApiError(response.status, problem?.detail ?? "The export failed.");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = format === "png" ? "takeoff.png" : "takeoff.geojson";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
