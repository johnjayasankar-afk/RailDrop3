import Link from "next/link";
import { HeaderShadow } from "@/components/header-shadow";

/* The whole header is static now.
 *
 * It used to take `email` and `isGuest` as props, which kept every route out
 * of the static shell; then the nav moved behind a Suspense boundary with a
 * `use cache: private` session read inside it. With no accounts there is no
 * session to read and no boundary to put it behind — the nav is the same for
 * everybody, so the header is just markup, prerendered and served from the
 * edge with nothing streamed into it.
 */
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
          <Link href="/fares" className="nav-watch text-ink">
            Check a fare
          </Link>
          <Link href="/how-it-works" className="hover:text-ink">
            How it works
          </Link>
        </nav>
      </div>
    </header>
  );
}
