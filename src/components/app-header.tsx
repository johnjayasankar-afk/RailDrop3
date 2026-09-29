import { Suspense } from "react";
import Link from "next/link";
import { HeaderShadow } from "@/components/header-shadow";
import { HeaderAccount, HeaderAccountFallback } from "@/components/header-account";

/* The header is a static shell with one boundary in it.
 *
 * It used to take `email` and `isGuest` as props, which meant every page had
 * to read the session before it could render its own chrome — and under Cache
 * Components a request read at the top of a page keeps the whole route out of
 * the static shell. The brand, the rule and the layout are the same for
 * everybody; only the nav is not. */
export function AppHeader() {
  return (
    <header className="site-header sticky top-0 z-20 border-b border-line bg-paper-elevated/90 backdrop-blur-md">
      <HeaderShadow />
      <div className="rail-rule" />
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
        <Link
          href="/"
          className="brand-lockup flex min-w-0 items-center gap-2.5"
          aria-label="RailDrop home"
        >
          <span className="rail-mark" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <span className="serif text-xl tracking-tight">RailDrop</span>
        </Link>
        <nav className="flex min-w-0 items-center gap-2.5 text-sm text-ink-soft sm:gap-4">
          <Suspense fallback={<HeaderAccountFallback />}>
            <HeaderAccount />
          </Suspense>
        </nav>
      </div>
    </header>
  );
}
