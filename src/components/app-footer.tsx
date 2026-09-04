import Link from "next/link";

export function AppFooter({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <footer className="mt-16 border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-7 text-sm text-ink-soft">
        <Link
          href={signedIn ? "/dashboard" : "/"}
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
          <Link href={signedIn ? "/dashboard" : "/"} className="hover:text-ink">
            {signedIn ? "Your watches" : "Home"}
          </Link>
          <Link href={signedIn ? "/watches/new" : "/login"} className="hover:text-ink">
            Watch a trip
          </Link>
          {signedIn ? (
            <Link href="/settings" className="hover:text-ink">
              Settings
            </Link>
          ) : (
            <Link href="/login" className="hover:text-ink">
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </footer>
  );
}
