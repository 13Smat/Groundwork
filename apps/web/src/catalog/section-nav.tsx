import { Link, useRouterState } from "@tanstack/react-router";

const linkClass =
  "inline-flex min-h-11 items-center rounded-md px-3 text-base font-semibold text-ink ring-1 ring-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink aria-[current=page]:bg-ink aria-[current=page]:text-paper";

const LINKS = [
  { href: "/catalog", label: "Catalog items" },
  { href: "/catalog/takeoff", label: "Takeoff items" },
  { href: "/catalog/recipes", label: "Cost recipes" },
] as const;

function current(pathname: string, href: (typeof LINKS)[number]["href"]): boolean {
  if (href === "/catalog") {
    return pathname === "/catalog";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function CatalogSectionNav() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return (
    <nav aria-label="Catalog sections" className="flex flex-wrap gap-2">
      {LINKS.map((item) => {
        const active = current(pathname, item.href);
        return (
          <Link
            key={item.href}
            to={item.href}
            className={linkClass}
            aria-current={active ? "page" : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
