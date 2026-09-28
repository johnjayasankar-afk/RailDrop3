import type { Metadata } from "next";
import { PageFrame } from "@/components/page-frame";
import { FareLookup } from "@/components/fare-lookup";
import { getSessionUser } from "@/lib/auth/session";
import { localIsoDate } from "@/lib/domain/timezone";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Check a fare",
  description:
    "What an Amtrak route is listed at right now. No account, nothing saved, and never an estimated price.",
};

/* The most direct question the product can answer, finally on its own page.
 *
 * /api/fares has needed no database and no account since the day it was
 * written, but the only route to it was to try to save a watch and have the
 * save fail — the shortest path to a live price ran through an error. Someone
 * who just wants to know what Boston to New York costs on Thursday can now ask
 * that, and is told plainly that nothing is being saved or watched.
 */
export default async function FaresPage() {
  const user = await getSessionUser();
  const today = localIsoDate(new Date(), "America/New_York");

  return (
    <PageFrame email={user?.email} isGuest={Boolean(user?.isGuest)}>
      <main id="main" className="mx-auto max-w-5xl px-4 py-10">
        <p className="kicker">Live board</p>
        <h1 className="serif mt-3 text-4xl">What does this trip cost?</h1>
        <p className="mt-3 max-w-xl text-ink-soft">
          RailDrop reads what Amtrak is actually listing, right now, for the dates you pick. It
          never estimates, and it never averages two sources into a number neither of them said.
        </p>
        <FareLookup today={today} />
      </main>
    </PageFrame>
  );
}
