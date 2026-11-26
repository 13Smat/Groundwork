import { QueryClient } from "@tanstack/react-query";

export type Address = {
  line1?: string;
  line2?: string;
  city?: string;
  region?: string;
  postal_code?: string;
  country?: string;
};

export type Membership = {
  id: string;
  workspace_id: string;
  role_id: string;
  role: string;
  status: string;
  permissions: string[];
  workspace: { id: string; name: string; slug: string };
};

export type Me = {
  user: {
    id: string;
    email: string;
    name: string;
    phone: string | null;
    email_verified: boolean;
  };
  active_workspace_id: string | null;
  memberships: Membership[];
};

export type Workspace = {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  timezone: string;
  currency: string;
  units_pref: "imperial" | "metric";
  plan: string | null;
  address: Address | null;
  license_number: string | null;
};

export type MemberRow = {
  id: string;
  workspace_id: string;
  user_id: string | null;
  role_id: string;
  role: string;
  status: string;
  email: string | null;
  name: string | null;
};

export type RoleRow = {
  id: string;
  name: string;
  permissions: string[];
  is_system: boolean;
};

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
  }
}

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 0 } },
});

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, { ...init, headers, credentials: "include" });
  if (!response.ok) {
    const problem = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new ApiError(response.status, problem?.detail ?? "The request failed.");
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export function loadMe(): Promise<Me> {
  return api<Me>("/me");
}

export function activeWorkspace(me: Me): Membership | undefined {
  const current = me.memberships.find(
    (member) => member.status === "active" && member.workspace_id === me.active_workspace_id,
  );
  return current ?? me.memberships.find((member) => member.status === "active");
}

const NEXT_KEY = "groundwork.next";

export function rememberNext(pathname: string): void {
  if (pathname.startsWith("/invites/")) {
    sessionStorage.setItem(NEXT_KEY, pathname);
  }
}

export function takeInviteToken(): string | undefined {
  const next = sessionStorage.getItem(NEXT_KEY);
  sessionStorage.removeItem(NEXT_KEY);
  const match = next?.match(/^\/invites\/([^/]+)$/);
  return match?.[1];
}
