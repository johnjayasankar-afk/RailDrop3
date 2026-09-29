import Link from "next/link";
import { getSessionUser } from "@/lib/auth/session";

/* The half of the header that depends on who you are.
 *
 * Every page used to read the session at its top level and hand it down to
 * PageFrame, so a cookie read on line one of /how-it-works — a hero and
 * twelve hard-coded FAQ strings — made the entire route render on demand.
 * Eight pages carried `export const dynamic = "force-dynamic"` and the build
 * table had no static page in it at all.
 *
 * Under Cache Components a request read cannot be in the static shell, but it
 * can be the only thing that is not. This component is what sits behind the
 * boundary; everything around it — the brand, the rule, the footer's own
 * chrome — prerenders and is served from the edge.
 *
 * `use cache: private` keeps the resolved nav in the browser only, never on
 * the server, which is what makes it safe for something derived from a
 * session cookie: it is per-viewer by construction and cannot leak between
 * them.
 */
export async function HeaderAccount() {
  "use cache: private";

  const user = await getSessionUser();
  const email = user?.email ?? null;
  const isGuest = Boolean(user?.isGuest);
  const active = Boolean(user);

  if (!active) {
    return (
      <>
        <Link href="/api/auth/guest?next=%2Fwatches%2Fnew" className="nav-watch text-ink">
          Watch trip
        </Link>
        <Link href="/login" className="hover:text-ink">
          Sign in
        </Link>
      </>
    );
  }

  return (
    <>
      <Link href="/dashboard" className="hidden sm:inline hover:text-ink">
        Watches
      </Link>
      <Link href="/fares" className="hidden sm:inline hover:text-ink">
        Check a fare
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
  );
}

/**
 * What the shell shows while the session resolves.
 *
 * Not a spinner and not nothing: the two links every visitor gets either way,
 * so the header does not change width or reflow when the real nav arrives.
 * `aria-hidden` and `inert`, because announcing a placeholder that is about
 * to be replaced is worse than announcing nothing.
 */
export function HeaderAccountFallback() {
  return (
    <span className="header-account-pending" aria-hidden inert>
      <span className="nav-watch text-ink">Watch trip</span>
      <span>Sign in</span>
    </span>
  );
}
