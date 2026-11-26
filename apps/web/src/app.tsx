import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
  useRouterState,
} from "@tanstack/react-router";
import { AppShell, PrimaryNav, type NavLinkProps } from "@groundwork/ui";

const NAV = [
  { to: "/", label: "Office" },
  { to: "/jobs", label: "Jobs" },
  { to: "/takeoff", label: "Takeoff" },
  { to: "/catalog", label: "Catalog" },
  { to: "/estimates", label: "Estimates" },
  { to: "/proposals", label: "Proposals" },
  { to: "/schedule", label: "Schedule" },
  { to: "/invoices", label: "Invoices" },
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
};

function titleFor(pathname: string): string {
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

function OfficeNav({ pathname }: { pathname: string }) {
  return (
    <PrimaryNav
      items={NAV.map((item) => ({ href: item.to, label: item.label }))}
      currentPath={pathname}
      renderLink={OfficeLink}
    />
  );
}

function Section({ children }: { children: string }) {
  return <p className="max-w-prose text-lg leading-relaxed">{children}</p>;
}

const rootRoute = createRootRoute({
  component: function RootLayout() {
    const pathname = useRouterState({ select: (state) => state.location.pathname });
    return (
      <AppShell title={titleFor(pathname)} nav={<OfficeNav pathname={pathname} />}>
        <Outlet />
      </AppShell>
    );
  },
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: function HomePage() {
    return (
      <Section>
        Measure a site, price the work, and send a proposal. This is the office app shell.
      </Section>
    );
  },
});

function placeholder(sentence: string) {
  return function PlaceholderPage() {
    return <Section>{sentence}</Section>;
  };
}

const jobsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/jobs",
  component: placeholder("No job records are loaded in this slice."),
});

const takeoffRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/takeoff",
  component: placeholder("No takeoff records are loaded in this slice."),
});

const catalogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/catalog",
  component: placeholder("No catalog records are loaded in this slice."),
});

const estimatesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/estimates",
  component: placeholder("No estimate records are loaded in this slice."),
});

const proposalsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/proposals",
  component: placeholder("No proposal records are loaded in this slice."),
});

const scheduleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/schedule",
  component: placeholder("No schedule records are loaded in this slice."),
});

const invoicesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/invoices",
  component: placeholder("No invoice records are loaded in this slice."),
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  jobsRoute,
  takeoffRoute,
  catalogRoute,
  estimatesRoute,
  proposalsRoute,
  scheduleRoute,
  invoicesRoute,
]);

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const queryClient = new QueryClient();

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
