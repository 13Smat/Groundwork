import { useQuery } from "@tanstack/react-query";

import { activeWorkspace, api, loadMe, type MemberRow, type Workspace } from "../session";

export function useWorkspace() {
  const profile = useQuery({ queryKey: ["me"], queryFn: loadMe });
  const membership = profile.data ? activeWorkspace(profile.data) : undefined;
  const workspaceId = membership?.workspace_id;
  const workspace = useQuery({
    queryKey: ["workspace", workspaceId],
    queryFn: () => api<Workspace>(`/workspaces/${workspaceId}`),
    enabled: Boolean(workspaceId),
  });
  return {
    workspaceId,
    memberId: membership?.id,
    currency: workspace.data?.currency ?? "USD",
    ready: Boolean(workspaceId),
  };
}

export function useMembers(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["members", workspaceId],
    queryFn: () => api<{ members: MemberRow[] }>(`/workspaces/${workspaceId}/members`),
    enabled: Boolean(workspaceId),
  });
}
