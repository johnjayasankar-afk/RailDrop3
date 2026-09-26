import type { Metadata } from "next";
import Link from "next/link";
import { PageFrame } from "@/components/page-frame";
import { getSessionUser } from "@/lib/auth/session";
import { STATION_BY_CODE } from "@/lib/stations/catalog";
import { unmappedStationCodes } from "@/lib/stations/coverage";
import { WANDERU_STATION_IDS } from "@/lib/providers/wanderu-station-map";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "Where RailDrop's fares come from, what a listed fare is, what we do not know, and what the numbers can and cannot tell you.",
};

/* The methodology page.
 *
 * This is the page that separates a scraper with a nice interface from a
 * product with a point of view. Its job is to say, in public and in plain
 * words, what we observe, what we infer, and what we simply do not know — in
 * enough detail that someone could hold us to it.
 *
 * The counts below are read from the catalog and the provider map at render
 * time rather than typed into the copy, so this page cannot quietly drift
 * away from the software it describes. If coverage improves, the page says so
 * on its own. If it regresses, the page admits that too.
 */
export default async function HowItWorksPage() {
  const user = await getSessionUser();
  const totalStations = STATION_BY_CODE.size;
  const verified = Object.keys(WANDERU_STATION_IDS).length;
  const unverified = unmappedStationCodes().length;

  return (
    <PageFrame email={user?.email} isGuest={Boolean(user?.isGuest)}>
      <main id="main" className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
        <p className="kicker">Methodology</p>
        <h1 className="serif mt-3 text-4xl leading-tight sm:text-5xl">
          What we observe, and what we do not.
        </h1>
        <p className="mt-5 text-lg text-ink-soft">
          RailDrop watches a trip you have already booked and tells you when a cheaper listed fare
          appears. This page explains where those numbers come from and where they stop. If
          something here is vague, treat the number it describes as vague.
        </p>

        <Section title="Where the fares come from">
          <p>
            RailDrop reads <strong>listed fares</strong> from a third-party rail search service. We
            do not scrape amtrak.com, we do not hold an Amtrak data agreement, and we are not
            affiliated with Amtrak.
          </p>
          <p>
            A listed fare is the price shown for a seat at the moment we looked. It is not a quote,
            not a hold, and not a promise. Fares move, inventory sells, and the final price is
            whatever Amtrak charges you at the moment you book. Every screen that shows a fare says
            when it was observed, and every handoff sends you to Amtrak to confirm it.
          </p>
        </Section>

        <Section title="How often we look">
          <p>
            Three times a day — morning, afternoon and evening in the timezone of your trip — for as
            long as your monitoring window runs, plus once immediately when you create the watch.
            The window is your travel date give or take a day by default.
          </p>
          <p>
            When two people watch the same route on the same date, we look once and share the
            answer. A search older than twenty minutes is not reused.
          </p>
        </Section>

        <Section title="What we will not do">
          <ul>
            <li>
              <strong>Invent a price.</strong> If a date could not be checked, the board says so. A
              provider outage is never rendered as “no cheaper fare”, and a check we paused for
              budget reasons is never rendered as an empty market. Those are opposite claims.
            </li>
            <li>
              <strong>Invent a link.</strong> No verified, stable Amtrak deep link exists for a
              specific itinerary, so we do not fabricate one. You get the official site and the
              details to paste in.
            </li>
            <li>
              <strong>Predict a price.</strong> Nothing in RailDrop forecasts. Where we describe a
              pattern, it is a count of what we have already observed, with the sample size shown.
            </li>
            <li>
              <strong>Touch your booking.</strong> RailDrop observes and reports. Every change is
              yours to make on Amtrak.
            </li>
          </ul>
        </Section>

        <Section title="What we do not know">
          <p>Some of this is knowable and we have not built it. Some is not available to us.</p>
          <ul>
            <li>
              <strong>Your ticket&rsquo;s change rules.</strong> We know the fare family a listing
              advertises. We do not know what your specific ticket permits, what it costs to change,
              or whether a refund is a credit. The change-fee field on the board is your estimate,
              used only for your own arithmetic — we never supply a number.
            </li>
            <li>
              <strong>Seat inventory.</strong> We see a price, not how many seats remain behind it.
              A fare can vanish between our check and your booking.
            </li>
            <li>
              <strong>Anything outside the listing.</strong> Accessibility, bikes, pets, checked
              baggage, seat maps and equipment changes are not in what we read.
            </li>
          </ul>
        </Section>

        <Section title="Which stations this actually works for">
          <p>
            Our catalog lists {totalStations} stations. <strong>{verified}</strong> of them have a
            provider station identifier we have verified. The other <strong>{unverified}</strong>{" "}
            are matched by city name, which can return nothing or, in a city with more than one
            station, the wrong platform.
          </p>
          <p>
            We label those stations <em>coverage unverified</em> in the picker rather than letting
            you create a watch that may never return a result. These counts are read from the
            software when this page renders, so they cannot drift from the truth.
          </p>
        </Section>

        <Section title="What the statistics can and cannot tell you">
          <p>
            Where RailDrop shows a pattern — how often a corridor drops, where today&rsquo;s price
            sits in the range we have seen — it is describing observations we actually recorded,
            with the number of them stated. A pattern over nine Thursdays is a description of nine
            Thursdays. It is not a probability, and we will not dress it as one.
          </p>
          <p>
            We would rather say <em>not enough data yet</em> than compute a statistic from a handful
            of points. If a number appears without a sample size next to it, that is a bug — please
            tell us.
          </p>
        </Section>

        <Section title="What we store">
          <p>
            The route, the date, the amount you told us you paid, your timezone, and an email only
            if you asked for alerts. Prices we observe are kept so the history on your board is
            real. You can export or delete everything from Settings, including as a guest.
          </p>
        </Section>

        <div className="mt-12 flex flex-wrap items-center gap-3">
          <Link href="/api/auth/guest?next=%2Fwatches%2Fnew" className="btn btn-primary">
            Watch a booked trip
          </Link>
          <Link href="/" className="btn btn-ghost">
            Back to the front
          </Link>
        </div>
      </main>
    </PageFrame>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="serif text-2xl">{title}</h2>
      <div className="method-prose mt-3 space-y-3 text-ink-soft">{children}</div>
    </section>
  );
}
