import * as NavigationMenu from "@radix-ui/react-navigation-menu";
import type { KeyboardEvent, ReactElement } from "react";

export type NavItem<Href extends string = string> = {
  href: Href;
  label: string;
};

export type NavLinkProps<Href extends string> = {
  href: Href;
  className: string;
  children: string;
  "aria-current"?: "page";
};

const linkClass =
  "flex min-h-11 items-center rounded-md px-3 text-base font-semibold text-ink hover:bg-line/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink aria-[current=page]:bg-accent aria-[current=page]:text-paper";

function moveLinkFocus(event: KeyboardEvent<HTMLElement>): void {
  const target = event.target;
  if (!(target instanceof HTMLAnchorElement) || !event.currentTarget.contains(target)) {
    return;
  }
  const links = Array.from(event.currentTarget.querySelectorAll<HTMLAnchorElement>("a"));
  const index = links.indexOf(target);
  if (index < 0) {
    return;
  }
  let next: number;
  if (event.key === "ArrowDown" || event.key === "ArrowRight") {
    next = (index + 1) % links.length;
  } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
    next = (index - 1 + links.length) % links.length;
  } else if (event.key === "Home") {
    next = 0;
  } else if (event.key === "End") {
    next = links.length - 1;
  } else {
    return;
  }
  event.preventDefault();
  links[next]?.focus();
}

export function PrimaryNav<Href extends string>({
  items,
  currentPath,
  renderLink,
}: {
  items: readonly NavItem<Href>[];
  currentPath: string;
  renderLink?: (props: NavLinkProps<Href>) => ReactElement;
}) {
  return (
    <NavigationMenu.Root orientation="vertical" aria-label="Primary" className="w-full">
      <NavigationMenu.List className="flex flex-col gap-1" onKeyDown={moveLinkFocus}>
        {items.map((item) => {
          const current = item.href === currentPath;
          const ariaCurrent = current ? ("page" as const) : undefined;
          return (
            <NavigationMenu.Item key={item.href}>
              {renderLink ? (
                <NavigationMenu.Link asChild active={current}>
                  {renderLink({
                    href: item.href,
                    className: linkClass,
                    children: item.label,
                    ...(ariaCurrent ? { "aria-current": ariaCurrent } : {}),
                  })}
                </NavigationMenu.Link>
              ) : (
                <NavigationMenu.Link
                  href={item.href}
                  className={linkClass}
                  active={current}
                  {...(ariaCurrent ? { "aria-current": ariaCurrent } : {})}
                >
                  {item.label}
                </NavigationMenu.Link>
              )}
            </NavigationMenu.Item>
          );
        })}
      </NavigationMenu.List>
    </NavigationMenu.Root>
  );
}
