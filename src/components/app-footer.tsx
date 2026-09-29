import { Suspense } from "react";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { getSessionUser } from "@/lib/auth/session";

/* The footer, with its session-dependent links behind a boundary.
 *
 * Same reason as the header: the brand, the rule and "How it works" are the
 * same for everybody, and only three of the links are not. Keeping the whole
 * footer out of the static shell to vary three hrefs is what a route segment
 * config used to cost.
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
          <Link href="/how-it-works" className="hover:text-ink">
            How it works
          </Link>
          <Suspense fallback={<FooterAccountFallback />}>
            <FooterAccount />
          </Suspense>
        </nav>
        <ThemeToggle />
      </div>
    </footer>
  );
}

async function FooterAccount() {
  "use cache: private";

  const user = await getSessionUser();
  const signedIn = Boolean(user);
  const isGuest = Boolean(user?.isGuest);

  return (
    <>
      <Link href={signedIn ? "/dashboard" : "/"} className="hover:text-ink">
        {signedIn ? "Your watches" : "Home"}
      </Link>
      <Link
        href={signedIn ? "/watches/new" : "/api/auth/guest?next=%2Fwatches%2Fnew"}
        className="hover:text-ink"
      >
        Watch a trip
      </Link>
      {signedIn && !isGuest ? (
        <Link href="/settings" className="hover:text-ink">
          Settings
        </Link>
      ) : (
        <Link href="/login" className="hover:text-ink">
          Sign in
        </Link>
      )}
    </>
  );
}

/** The signed-out links, so the footer does not reflow when the real ones land. */
function FooterAccountFallback() {
  return (
    <span className="footer-account-pending" aria-hidden inert>
      <span>Home</span>
      <span>Watch a trip</span>
      <span>Sign in</span>
    </span>
  );
}
