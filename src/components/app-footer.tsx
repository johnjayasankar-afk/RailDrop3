import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";

/* The whole footer is static now.
 *
 * It had a Suspense boundary around a `use cache: private` session read, to
 * vary three hrefs between a signed-in and a signed-out visitor. There are
 * no visitors to tell apart any more, so the boundary, the cache scope and
 * the fallback all go with it.
 */
export function AppFooter() {
  return (
    <footer className="mt-16 border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-7 text-sm text-ink-soft">
        <Link
          href="/"
          className="brand-lockup flex items-center gap-2 text-ink no-underline"
          aria-label="RailDrop"
        >
          <span className="rail-mark" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <span className="serif text-lg">RailDrop</span>
        </Link>
        <nav className="flex flex-wrap gap-4">
          <Link href="/fares" className="hover:text-ink">
            Check a fare
          </Link>
          <Link href="/how-it-works" className="hover:text-ink">
            How it works
          </Link>
        </nav>
        <ThemeToggle />
      </div>
    </footer>
  );
}
