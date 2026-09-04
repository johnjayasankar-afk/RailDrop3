import type { ReactNode } from "react";

/** Stable header chrome for route loading — avoids signed-in/out nav flash. */
export function LoadingChrome({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="site-header sticky top-0 z-20 border-b border-line bg-paper-elevated/90 backdrop-blur-md">
        <div className="rail-rule" />
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
          <span className="brand-lockup flex min-w-0 items-center gap-2.5" aria-hidden>
            <span className="rail-mark">
              <i />
              <i />
              <i />
            </span>
            <span className="serif text-xl tracking-tight">RailDrop</span>
          </span>
          <div className="flex items-center gap-3" aria-hidden>
            <span className="skeleton h-3.5 w-14" />
            <span className="skeleton h-3.5 w-12" />
            <span className="skeleton h-3.5 w-16" />
          </div>
        </div>
      </header>
      <div className="flex-1">{children}</div>
    </div>
  );
}
