import type { ReactNode } from "react";

export function AppShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-paper font-sans text-ink">
      <a
        href="#main"
        className="absolute left-4 top-4 z-10 -translate-y-24 rounded-md bg-ink px-4 py-3 text-base font-semibold text-paper focus:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        Skip to content
      </a>
      <header className="border-b border-line px-4 py-4">
        <p className="text-sm font-semibold tracking-wide text-accent">Groundwork</p>
        <h1 className="mt-1 text-2xl font-semibold">{title}</h1>
      </header>
      <main id="main" className="mx-auto w-full max-w-5xl px-4 py-6">
        {children}
      </main>
    </div>
  );
}
