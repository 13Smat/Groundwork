import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ReactNode } from "react";

export const Tabs = TabsPrimitive.Root;

export function TabList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <TabsPrimitive.List aria-label={label} className="flex flex-wrap gap-2">
      {children}
    </TabsPrimitive.List>
  );
}

const triggerClass =
  "inline-flex min-h-11 items-center rounded-md px-4 text-base font-semibold text-ink ring-1 ring-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink data-[state=active]:bg-ink data-[state=active]:text-paper data-[state=active]:ring-ink";

export function TabTrigger({ value, children }: { value: string; children: ReactNode }) {
  return (
    <TabsPrimitive.Trigger value={value} className={triggerClass}>
      {children}
    </TabsPrimitive.Trigger>
  );
}

/**
 * Every trigger's aria-controls has to name a panel that is in the document.
 * Inactive panels stay mounted and hidden so that reference stays valid.
 */
export function TabPanel({ value, children }: { value: string; children: ReactNode }) {
  return (
    <TabsPrimitive.Content value={value} forceMount>
      {children}
    </TabsPrimitive.Content>
  );
}
