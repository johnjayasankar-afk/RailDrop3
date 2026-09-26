import type { Metadata } from "next";
import Link from "next/link";
import { PageFrame } from "@/components/page-frame";
import { getRepository } from "@/lib/services";
import { unsubscribeTokenValid } from "@/lib/notifications/unsubscribe";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Unsubscribe",
  robots: { index: false, follow: false },
};

/* Stopping the mail, with no account and no login.
 *
 * The person reading this may never have signed up for anything — a guest can
 * put an email on a watch and, until now, had no way to make it stop. So the
 * signed token in the link is the only thing asked of them, and the action
 * happens on arrival rather than behind another button. Someone who clicked
 * "unsubscribe" has already expressed their intent; making them confirm it is
 * a dark pattern.
 */
export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ w?: string; t?: string }>;
}) {
  const { w: watchId, t: token } = await searchParams;
  let outcome: "done" | "already" | "invalid" = "invalid";

  if (watchId && token && unsubscribeTokenValid(watchId, token)) {
    const repo = getRepository();
    const watch = await repo.getWatch(watchId);
    const email = watch?.alertEmail?.trim();
    if (watch && email) {
      await repo.suppressEmail({
        email,
        reason: "UNSUBSCRIBED",
        watchId,
        detail: "Unsubscribe link in an alert email.",
      });
      await repo.updateWatch(watchId, { alertEmail: "" });
      logger.info("alert.unsubscribed", { watch_id: watchId, via: "page" });
      outcome = "done";
    } else {
      outcome = "already";
    }
  }

  return (
    <PageFrame>
      <main id="main" className="mx-auto max-w-xl px-4 py-16">
        {outcome === "invalid" ? (
          <>
            <p className="kicker">Unsubscribe</p>
            <h1 className="serif mt-3 text-3xl">This link is not valid.</h1>
            <p className="mt-4 text-ink-soft">
              It may have been altered in transit, or it may be from a very old email. Nothing has
              changed. If you are still receiving mail you did not ask for, reply to any RailDrop
              email and we will stop it by hand.
            </p>
          </>
        ) : (
          <>
            <p className="kicker">Unsubscribe</p>
            <h1 className="serif mt-3 text-3xl">
              {outcome === "done" ? "Stopped." : "Already stopped."}
            </h1>
            <p className="mt-4 text-ink-soft">
              {outcome === "done"
                ? "That address will not receive any more RailDrop email — not for this trip, and not for any other."
                : "That trip has no alert email on it, so there was nothing to stop."}
            </p>
            <p className="mt-3 text-ink-soft">
              Your booking is untouched and nothing has been deleted. The board for this trip still
              works if you open it; it simply will not write to you.
            </p>
          </>
        )}

        <div className="mt-10 flex flex-wrap gap-3">
          <Link href="/" className="btn btn-ghost">
            Back to RailDrop
          </Link>
        </div>
      </main>
    </PageFrame>
  );
}
