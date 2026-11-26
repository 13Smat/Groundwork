import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  redirect,
  RouterProvider,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { AppShell, Button, PrimaryNav, type NavLinkProps } from "@groundwork/ui";

import {
  AcceptInvitePage,
  CreateWorkspacePage,
  DashboardPage,
  MembersPage,
  RolesPage,
  SettingsPage,
  SignInPage,
  SignUpPage,
  WorkspaceSwitcher,
  signOut,
} from "./pages";
import { ImageryRoute } from "./admin/imagery-route";
import { activeWorkspace, loadMe, queryClient, rememberNext } from "./session";

const NAV = [
  { to: "/", label: "Office" },
  { to: "/jobs", label: "Jobs" },
  { to: "/takeoff", label: "Takeoff" },
  { to: "/catalog", label: "Catalog" },
  { to: "/estimates", label: "Estimates" },
  { to: "/proposals", label: "Proposals" },
  { to: "/schedule", label: "Schedule" },
  { to: "/invoices", label: "Invoices" },
  { to: "/settings", label: "Settings" },
  { to: "/members", label: "Members" },
  { to: "/roles", label: "Roles" },
  { to: "/admin/imagery", label: "Imagery" },
] as const;

type OfficePath = (typeof NAV)[number]["to"];

const TITLES: Record<OfficePath, string> = {
  "/": "Office",
  "/jobs": "Jobs",
  "/takeoff": "Takeoff",
  "/catalog": "Catalog",
  "/estimates": "Estimates",
  "/proposals": "Proposals",
  "/schedule": "Schedule",
  "/invoices": "Invoices",
  "/settings": "Settings",
  "/members": "Members",
  "/roles": "Roles",
  "/admin/imagery": "Imagery sources",
};

function titleFor(pathname: string): string {
  if (pathname === "/workspaces/new") {
    return "Create workspace";
  }
  if (pathname.startsWith("/invites/")) {
    return "Accept invite";
  }
  if (pathname in TITLES) {
    return TITLES[pathname as OfficePath];
  }
  return "Office";
}

function OfficeLink({
  href,
  className,
  children,
  "aria-current": ariaCurrent,
}: NavLinkProps<OfficePath>) {
  return (
    <Link to={href} className={className} aria-current={ariaCurrent}>
      {children}
    </Link>
  );
}

function OfficeNav({ pathname, role }: { pathname: string; role: string | undefined }) {
  const items = NAV.filter(
    (item) => item.to !== "/admin/imagery" || role === "owner" || role === "admin",
  );
  return (
    <PrimaryNav
      items={items.map((item) => ({ href: item.to, label: item.label }))}
      currentPath={pathname}
      renderLink={OfficeLink}
    />
  );
}

function placeholder(sentence: string) {
  return function PlaceholderPage() {
    return <p className="max-w-prose text-lg leading-relaxed">{sentence}</p>;
  };
}

const rootRoute = createRootRoute({
  component: function RootLayout() {
    return <Outlet />;
  },
});

const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sign-in",
  beforeLoad: async () => {
    try {
      await queryClient.ensureQueryData({ queryKey: ["me"], queryFn: loadMe });
    } catch {
      return;
    }
    throw redirect({ to: "/" });
  },
  component: SignInPage,
});

const signUpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sign-up",
  beforeLoad: async () => {
    try {
      await queryClient.ensureQueryData({ queryKey: ["me"], queryFn: loadMe });
    } catch {
      return;
    }
    throw redirect({ to: "/" });
  },
  component: SignUpPage,
});

const authedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "authed",
  beforeLoad: async ({ location }) => {
    let profile;
    try {
      profile = await queryClient.ensureQueryData({ queryKey: ["me"], queryFn: loadMe });
    } catch {
      rememberNext(location.pathname);
      throw redirect({ to: "/sign-in" });
    }
    const active = profile.memberships.some((member) => member.status === "active");
    const open =
      location.pathname === "/workspaces/new" || location.pathname.startsWith("/invites/");
    if (!active && !open) {
      throw redirect({ to: "/workspaces/new" });
    }
  },
  component: function AuthedLayout() {
    const pathname = useRouterState({ select: (state) => state.location.pathname });
    const navigate = useNavigate();
    const profile = useQuery({ queryKey: ["me"], queryFn: loadMe });
    const role = profile.data ? activeWorkspace(profile.data)?.role : undefined;
    return (
      <AppShell
        title={titleFor(pathname)}
        nav={<OfficeNav pathname={pathname} role={role} />}
        actions={
          <>
            {profile.data ? <WorkspaceSwitcher me={profile.data} /> : null}
            <Button variant="secondary" onClick={() => void signOut(navigate)}>
              Sign out
            </Button>
          </>
        }
      >
        <Outlet />
      </AppShell>
    );
  },
});

const indexRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/",
  component: DashboardPage,
});

const jobsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/jobs",
  component: placeholder("No job records are loaded in this slice."),
});

const takeoffRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/takeoff",
  component: placeholder("No takeoff records are loaded in this slice."),
});

const catalogRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/catalog",
  component: placeholder("No catalog records are loaded in this slice."),
});

const estimatesRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/estimates",
  component: placeholder("No estimate records are loaded in this slice."),
});

const proposalsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/proposals",
  component: placeholder("No proposal records are loaded in this slice."),
});

const scheduleRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/schedule",
  component: placeholder("No schedule records are loaded in this slice."),
});

const invoicesRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/invoices",
  component: placeholder("No invoice records are loaded in this slice."),
});

const settingsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/settings",
  component: SettingsPage,
});

const membersRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/members",
  component: MembersPage,
});

const rolesRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/roles",
  component: RolesPage,
});

const imageryAdminRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/admin/imagery",
  component: ImageryRoute,
});

const createWorkspaceRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/workspaces/new",
  component: CreateWorkspacePage,
});

const acceptRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/invites/$token",
  component: function AcceptRoute() {
    const { token } = acceptRoute.useParams();
    return <AcceptInvitePage token={token} />;
  },
});

const routeTree = rootRoute.addChildren([
  signInRoute,
  signUpRoute,
  authedRoute.addChildren([
    indexRoute,
    jobsRoute,
    takeoffRoute,
    catalogRoute,
    estimatesRoute,
    proposalsRoute,
    scheduleRoute,
    invoicesRoute,
    settingsRoute,
    membersRoute,
    rolesRoute,
    imageryAdminRoute,
    createWorkspaceRoute,
    acceptRoute,
  ]),
]);

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
