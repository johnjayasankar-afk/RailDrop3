import type { Metadata } from "next";
import { PageFrame } from "@/components/page-frame";
import { FareLookup } from "@/components/fare-lookup";
import { getSessionUser } from "@/lib/auth/session";
import { localIsoDate } from "@/lib/domain/timezone";
import { readSharedSearch } from "@/lib/domain/share-search";
import { formatDisplayDateLong } from "@/lib/domain/calendar";

export const dynamic = "force-dynamic";

/* The title names the route when the link carries one, so a shared search
   reads as itself in a tab and a chat preview. Never the price: a fare in a
   title would be a number nobody observed by the time it is read. */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const params = await searchParams;
  const today = localIsoDate(new Date(), "America/New_York");
  const search = readSharedSearch(params, today);
  const named = typeof params.from === "string" || typeof params.to === "string";
  return {
    title: named
      ? `${search.originCode} → ${search.destinationCode} · Check a fare`
      : "Check a fare",
    description: named
      ? `What ${search.originCode} to ${search.destinationCode} is listed at on ${search.travelDate ? formatDisplayDateLong(search.travelDate) : "your date"}. Live fares only — never an estimate.`
      : "What an Amtrak route is listed at right now. No account, nothing saved, and never an estimated price.",
  };
}

/* The most direct question the product can answer, finally on its own page.
 *
 * /api/fares has needed no database and no account since the day it was
 * written, but the only route to it was to try to save a watch and have the
 * save fail — the shortest path to a live price ran through an error. Someone
 * who just wants to know what Boston to New York costs on Thursday can now ask
 * that, and is told plainly that nothing is being saved or watched.
 */
export default async function FaresPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getSessionUser();
  const today = localIsoDate(new Date(), "America/New_York");
  /* Everything here arrived in somebody else's link, so it is read as hostile
     input and falls back rather than being repaired. */
  const shared = readSharedSearch(await searchParams, today);

  return (
    <PageFrame email={user?.email} isGuest={Boolean(user?.isGuest)}>
      <main id="main" className="ambient mx-auto max-w-5xl px-4 py-10">
        <div className="lookup-eyebrow">
          <span className="pulse" aria-hidden />
          <span className="micro">Live board · reads Amtrak inventory directly</span>
        </div>
        <h1 className="lookup-title">What does this trip cost?</h1>
        <p className="lookup-lede">
          RailDrop reads what Amtrak is actually listing, right now, for the dates you pick. It
          never estimates, and it never averages two sources into a number neither of them said.
        </p>
        <div className="tick-rule is-major mt-6" aria-hidden />
        <FareLookup today={today} initial={shared} />
      </main>
    </PageFrame>
  );
}
