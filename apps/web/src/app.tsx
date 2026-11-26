import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
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
import { CatalogRoute } from "./catalog/catalog-route";
import { RecipeCreateRoute, RecipeEditorRoute, RecipeIndexRoute } from "./catalog/recipe-route";
import { TakeoffRoute } from "./catalog/takeoff-route";
import { ClientDetailPage } from "./crm/client-detail-page";
import { ClientsPage } from "./crm/clients-page";
import { JobCreatePage } from "./crm/job-create-page";
import { JobDetailPage } from "./crm/job-detail-page";
import { JobsPage } from "./crm/jobs-page";
import { LocationPage } from "./crm/location-page";
import { PipelinePage } from "./crm/pipeline-page";
import { activeWorkspace, loadMe, queryClient, rememberNext } from "./session";
import { TakeoffsPage } from "./takeoff/start";

const TakeoffEditorPage = lazy(() => import("./takeoff/editor-page"));

const NAV = [
  { to: "/", label: "Office" },
  { to: "/pipeline", label: "Pipeline" },
  { to: "/jobs", label: "Jobs" },
  { to: "/clients", label: "Clients" },
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
  "/pipeline": "Pipeline",
  "/jobs": "Jobs",
  "/clients": "Clients",
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
  if (pathname.startsWith("/catalog/recipes")) {
    return "Cost recipes";
  }
  if (pathname === "/catalog/takeoff") {
    return "Takeoff items";
  }
  if (pathname === "/jobs/new") {
    return "New job";
  }
  if (/^\/jobs\/[^/]+\/takeoffs\/[^/]+$/.test(pathname)) {
    return "Takeoff editor";
  }
  if (/^\/jobs\/[^/]+\/takeoffs$/.test(pathname)) {
    return "Takeoffs";
  }
  if (pathname.startsWith("/jobs/")) {
    return "Job";
  }
  if (pathname.startsWith("/clients/")) {
    return "Client";
  }
  if (pathname.startsWith("/locations/")) {
    return "Location";
  }
  if (pathname in TITLES) {
    return TITLES[pathname as OfficePath];
  }
  return "Office";
}

function sectionPath(pathname: string): string {
  if (pathname.startsWith("/jobs")) {
    return "/jobs";
  }
  if (pathname.startsWith("/clients") || pathname.startsWith("/locations")) {
    return "/clients";
  }
  if (pathname.startsWith("/catalog")) {
    return "/catalog";
  }
  return pathname;
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
      currentPath={sectionPath(pathname)}
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

const pipelineRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/pipeline",
  component: PipelinePage,
});

const jobsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/jobs",
  component: JobsPage,
});

const newJobRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/jobs/new",
  component: JobCreatePage,
});

const jobDetailRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/jobs/$jobId",
  component: function JobDetailRoute() {
    const { jobId } = jobDetailRoute.useParams();
    return <JobDetailPage jobId={jobId} />;
  },
});

const clientsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/clients",
  component: ClientsPage,
});

const clientDetailRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/clients/$clientId",
  component: function ClientDetailRoute() {
    const { clientId } = clientDetailRoute.useParams();
    return <ClientDetailPage clientId={clientId} />;
  },
});

const locationRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/locations/$locationId",
  component: function LocationRoute() {
    const { locationId } = locationRoute.useParams();
    return <LocationPage locationId={locationId} />;
  },
});

const takeoffRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/takeoff",
  component: placeholder("Open a job and choose Takeoffs to measure on license-cleared imagery."),
});

const jobTakeoffsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/jobs/$jobId/takeoffs",
  component: function JobTakeoffsRoute() {
    const { jobId } = jobTakeoffsRoute.useParams();
    return <TakeoffsPage jobId={jobId} />;
  },
});

const takeoffEditorRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/jobs/$jobId/takeoffs/$takeoffId",
  component: function TakeoffEditorRoute() {
    const { jobId, takeoffId } = takeoffEditorRoute.useParams();
    return (
      <Suspense fallback={<p>Loading the takeoff editor.</p>}>
        <TakeoffEditorPage jobId={jobId} takeoffId={takeoffId} />
      </Suspense>
    );
  },
});

const catalogRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/catalog",
  component: CatalogRoute,
});

const takeoffItemsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/catalog/takeoff",
  component: TakeoffRoute,
});

const recipeIndexRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/catalog/recipes",
  component: RecipeIndexRoute,
});

const recipeCreateRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/catalog/recipes/new",
  component: RecipeCreateRoute,
});

const recipeEditRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: "/catalog/recipes/$recipeId",
  component: function RecipeEditPage() {
    const { recipeId } = recipeEditRoute.useParams();
    return <RecipeEditorRoute recipeId={recipeId} />;
  },
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
    pipelineRoute,
    jobsRoute,
    newJobRoute,
    jobDetailRoute,
    jobTakeoffsRoute,
    takeoffEditorRoute,
    clientsRoute,
    clientDetailRoute,
    locationRoute,
    takeoffRoute,
    catalogRoute,
    takeoffItemsRoute,
    recipeIndexRoute,
    recipeCreateRoute,
    recipeEditRoute,
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
