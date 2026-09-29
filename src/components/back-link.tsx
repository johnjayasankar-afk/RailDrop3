import type { ReactNode } from "react";
import Link from "next/link";

/* Its own module, because of what importing it used to cost.
 *
 * BackLink lived in page-frame.tsx. It is a Link and nothing else, but
 * page-frame now reaches the session through its header and footer — so
 * `import { BackLink } from "@/components/page-frame"` in the client
 * watch-detail pulled lib/auth/session, the Supabase server client,
 * playwright and puppeteer-core toward the browser bundle. A barrel file is
 * only free until one of the things in it grows a dependency.
 */
export function BackLink({ children }: { children: ReactNode }) {
  return (
    <Link href="/dashboard" className="text-sm text-ink-soft hover:text-ink">
      ← {children}
    </Link>
  );
}
