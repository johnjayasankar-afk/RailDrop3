import Link from "next/link";

export function AppHeader({
  email,
  isGuest = false,
}: {
  email?: string | null;
  isGuest?: boolean;
}) {
  const active = Boolean(email) || isGuest;
  return (
    <header className="site-header sticky top-0 z-20 border-b border-line bg-paper-elevated/90 backdrop-blur-md">
      <div className="rail-rule" />
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
        <Link
          href={active ? "/dashboard" : "/"}
          className="brand-lockup flex min-w-0 items-center gap-2.5"
          aria-label={active ? "RailDrop dashboard" : "RailDrop home"}
        >
          <span className="rail-mark" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <span className="serif text-xl tracking-tight">RailDrop</span>
        </Link>
        <nav className="flex min-w-0 items-center gap-2.5 text-sm text-ink-soft sm:gap-4">
          {active ? (
            <>
              <Link href="/dashboard" className="hidden sm:inline hover:text-ink">
                Watches
              </Link>
              <Link href="/watches/new" className="nav-watch text-ink">
                Watch trip
              </Link>
              <Link href="/settings" className="hover:text-ink" aria-label="Settings">
                <span className="sm:hidden">Prefs</span>
                <span className="hidden sm:inline">Settings</span>
              </Link>
              {email ? (
                <span className="hidden max-w-[12rem] truncate text-xs md:inline">{email}</span>
              ) : isGuest ? (
                <span className="hidden text-xs md:inline">Guest</span>
              ) : null}
              {isGuest ? (
                <Link href="/login" className="hover:text-ink">
                  Sign in
                </Link>
              ) : (
                <form action="/api/auth/signout" method="post">
                  <button type="submit" className="hover:text-ink">
                    Sign out
                  </button>
                </form>
              )}
            </>
          ) : (
            <>
              <Link href="/api/auth/guest?next=%2Fwatches%2Fnew" className="nav-watch text-ink">
                Watch trip
              </Link>
              <Link href="/login" className="hover:text-ink">
                Sign in
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
