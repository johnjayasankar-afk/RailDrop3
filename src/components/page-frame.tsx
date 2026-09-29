import type { ReactNode } from "react";
import { AppHeader } from "@/components/app-header";
import { AppFooter } from "@/components/app-footer";
import { Spotlight } from "@/components/spotlight";

/* The frame takes no session.
 *
 * It used to take `email` and `isGuest`, so every page read a cookie before
 * it could render page chrome — and that single read is what kept all eight
 * pages out of the static shell. The header resolves its own nav behind a
 * Suspense boundary now, and the footer's one session-dependent link does
 * the same. */
export function PageFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Spotlight />
      <AppHeader />
      <div className="flex-1">{children}</div>
      <AppFooter />
    </div>
  );
}
