import type { Metadata } from "next";
import Link from "next/link";
import { PageFrame } from "@/components/page-frame";
import { getRepository } from "@/lib/services";
import { unsubscribeTokenValid } from "@/lib/notifications/unsubscribe";
import { logger } from "@/lib/logger";
import { loadPageData } from "@/lib/pages/load-guard";

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
  let outcome: "done" | "already" | "invalid" | "unreachable" = "invalid";

  if (watchId && token && unsubscribeTokenValid(watchId, token)) {
    /* A fourth outcome, because the other three would all be lies.
     *
     * These five database calls were unguarded, so an unreachable database sent
     * the most sensitive page in the app to "The board could not load. Try
     * again: this is usually a brief hitch" — leaving someone who had just
     * asked us to stop emailing them with no idea whether we had. Saying
     * "Stopped." would claim a write that failed; saying "not valid" would
     * blame their link. Neither is true, so this says the true thing.
     */
    const stopped = await loadPageData(
      { page: "/unsubscribe", watchId },
      async (): Promise<"done" | "already"> => {
        const repo = getRepository();
        const watch = await repo.getWatch(watchId);
        const email = watch?.alertEmail?.trim();
        if (!watch || !email) return "already";
        await repo.suppressEmail({
          email,
          reason: "UNSUBSCRIBED",
          watchId,
          detail: "Unsubscribe link in an alert email.",
        });
        await repo.updateWatch(watchId, { alertEmail: "" });
        logger.info("alert.unsubscribed", { watch_id: watchId, via: "page" });
        return "done";
      },
    );
    outcome = stopped.reachable ? stopped.data : "unreachable";
  }

  return (
    <PageFrame>
      <main id="main" className="mx-auto max-w-xl px-4 py-16">
        {outcome === "unreachable" ? (
          <>
            <p className="kicker">Unsubscribe</p>
            <h1 className="serif mt-3 text-3xl">We could not stop it just now.</h1>
            <p className="mt-4 text-ink-soft">
              Your link is valid and nothing is wrong on your end — we cannot reach our own records
              at the moment, so we will not claim to have stopped anything we have not. The link
              does not expire on this failure: opening it again later will work.
            </p>
            <p className="mt-3 text-ink-soft">
              If you would rather not wait, reply to any RailDrop email and we will stop it by hand.
            </p>
          </>
        ) : outcome === "invalid" ? (
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
