import type { ReactNode } from "react";

import { KeyboardHelp } from "./keyboard-help";

export function AppShell({
  title,
  nav,
  children,
}: {
  title: string;
  nav?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-paper font-sans text-ink">
      <a
        href="#main"
        className="absolute left-4 top-4 z-10 -translate-y-24 rounded-md bg-ink px-4 py-3 text-base font-semibold text-paper focus:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        Skip to content
      </a>
      <div className="md:grid md:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="border-b border-line md:min-h-screen md:border-b-0 md:border-r">
          <p className="px-4 pt-4 text-sm font-semibold tracking-wide text-accent">Groundwork</p>
          <div className="px-2 py-3">{nav}</div>
        </div>
        <div>
          <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-4 py-4">
            <h1 className="text-2xl font-semibold">{title}</h1>
            <KeyboardHelp />
          </header>
          <main id="main" className="mx-auto w-full max-w-5xl px-4 py-6">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
