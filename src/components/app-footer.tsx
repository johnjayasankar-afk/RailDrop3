import Link from "next/link";

export function AppFooter({
  signedIn = false,
  isGuest = false,
}: {
  signedIn?: boolean;
  isGuest?: boolean;
}) {
  return (
    <footer className="mt-16 border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-7 text-sm text-ink-soft sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="space-y-2">
          <Link
            href={signedIn ? "/dashboard" : "/"}
            className="brand-lockup inline-flex items-center gap-2 text-ink no-underline"
            aria-label="RailDrop"
          >
            <span className="rail-mark" aria-hidden>
              <i />
              <i />
              <i />
            </span>
            <span className="serif text-lg">RailDrop</span>
          </Link>
          <p className="max-w-md text-xs leading-relaxed">
            Listed fares · confirm on Amtrak · we never invent prices.
          </p>
        </div>
        <nav className="flex flex-wrap gap-4">
          <Link href={signedIn ? "/dashboard" : "/"} className="hover:text-ink">
            {signedIn ? "Your watches" : "Home"}
          </Link>
          <Link
            href={signedIn ? "/watches/new" : "/api/auth/guest?next=%2Fwatches%2Fnew"}
            className="hover:text-ink"
          >
            Watch a trip
          </Link>
          {signedIn ? (
            <Link href="/settings" className="hover:text-ink">
              Settings
            </Link>
          ) : null}
          {isGuest || !signedIn ? (
            <Link href="/login" className="hover:text-ink">
              Sign in
            </Link>
          ) : null}
        </nav>
      </div>
    </footer>
  );
}
