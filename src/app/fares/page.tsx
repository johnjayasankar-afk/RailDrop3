import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { PageFrame } from "@/components/page-frame";
import { FareLookup } from "@/components/fare-lookup";
import { localIsoDate } from "@/lib/domain/timezone";
import { readSharedSearch } from "@/lib/domain/share-search";
import { formatDisplayDateLong } from "@/lib/domain/calendar";

/* The title names the route when the link carries one, so a shared search
   reads as itself in a tab and a chat preview. Never the price: a fare in a
   title would be a number nobody observed by the time it is read. */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const params = await searchParams;
  /* No clock here.
   *
   * This used to resolve the travel date against `new Date()` so a shared
   * link with no `on=` could still name a day in its description. Under
   * Cache Components an unstable value in a prerender is an error, not a
   * warning — and metadata is prerendered — so the whole route was logging
   * one on every build. It was also the wrong sentence: naming today's date
   * in a title for a link that means "whenever you open this" is a date
   * nobody asked for.
   *
   * A date is named only when the link carries one. Everything else here is
   * already request-free. */
  const search = readSharedSearch(params, "");
  const named = typeof params.from === "string" || typeof params.to === "string";
  const on = typeof params.on === "string" && search.travelDate ? search.travelDate : null;
  return {
    title: named
      ? `${search.originCode} → ${search.destinationCode} · Check a fare`
      : "Check a fare",
    description: named
      ? `What ${search.originCode} to ${search.destinationCode} is listed at ` +
        `${on ? `on ${formatDisplayDateLong(on)}` : "on your date"}. ` +
        "Live fares only — never an estimate."
      : "What an Amtrak route is listed at right now. No account, nothing saved, and never an estimated price.",
  };
}

/* The most direct question the product can answer, finally on its own page.
 *
 * /api/fares has needed no database and no account since the day it was
 * written, but the only route to it was to try to save a watch and have the
 * save fail — the shortest path to a live price ran through an error.
 *
 * The heading is the same for everybody; only the form's starting values are
   not. So the page prerenders and the form streams.

   Two runtime reads live below the boundary, and both are real: searchParams,
   because a shared link carries the route and the date, and the clock, because
   "today" decides which dates the picker will accept. Neither can be in a
   static shell, and neither needs to be — they decide what is IN the form, not
   what the page looks like. */
export default function FaresPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <PageFrame>
      <main id="main" className="ambient mx-auto max-w-6xl px-4 py-10">
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
        <Suspense fallback={<LookupSkeleton />}>
          <Lookup searchParams={searchParams} />
        </Suspense>
      </main>
    </PageFrame>
  );
}

async function Lookup({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /* `new Date()` is a request-time read the same way cookies() is: it
     produces different output per request, so prerendering it would bake one
     day's answer into the shell. connection() is how you say that about a
     value the framework cannot detect on its own. */
  await connection();
  const today = localIsoDate(new Date(), "America/New_York");
  /* Everything here arrived in somebody else's link, so it is read as hostile
     input and falls back rather than being repaired. */
  const shared = readSharedSearch(await searchParams, today);
  return <FareLookup today={today} initial={shared} />;
}

/** The form's own footprint, so the page does not jump when it arrives. */
function LookupSkeleton() {
  return (
    <div className="panel mt-6 space-y-4 p-5" aria-hidden>
      <div className="skeleton h-10" />
      <div className="skeleton h-10" />
      <div className="skeleton h-10 max-w-xs" />
    </div>
  );
}
