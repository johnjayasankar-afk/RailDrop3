import type { Metadata } from "next";
import Link from "next/link";
import { PageFrame } from "@/components/page-frame";
import { STATION_BY_CODE } from "@/lib/stations/catalog";
import { unmappedStationCodes } from "@/lib/stations/coverage";
import { WANDERU_STATION_IDS } from "@/lib/providers/wanderu-station-map";

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
  const totalStations = STATION_BY_CODE.size;
  const verified = Object.keys(WANDERU_STATION_IDS).length;
  const unverified = unmappedStationCodes().length;

  return (
    <PageFrame>
      <main id="main" className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
        <p className="kicker">Methodology</p>
        <h1 className="serif mt-3 text-4xl leading-tight sm:text-5xl">
          What we observe, and what we do not.
        </h1>
        <p className="mt-5 text-lg text-ink-soft">
          RailDrop reads what Amtrak is listing for a route, right now, and shows you all of it.
          This page explains where those numbers come from and exactly where they stop. If something
          here is vague, treat the number it describes as vague.
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

        <Section title="When we look">
          <p>
            When you ask, and only then. There is no schedule, no background job and no cached
            answer from an earlier visitor: pressing the button opens a real browser against the
            corridor for each date in your window, which is why it takes ten seconds rather than
            one.
          </p>
          <p>
            That also means a reading goes stale the moment it is taken. Every result says when it
            was read, and if you are looking at a tab you opened an hour ago, that is an hour-old
            answer.
          </p>
        </Section>

        <Section title="What we will not do">
          <ul>
            <li>
              <strong>Invent a price.</strong> A date we could not read keeps its place in the
              results and says which kind of nothing it was. A provider outage is never rendered as
              “no fares listed”, because those are opposite claims.
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
              or whether a refund is a credit.
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
            you run a search that may never return a result. These counts are read from the software
            when this page renders, so they cannot drift from the truth.
          </p>
        </Section>

        <Section title="What the numbers can and cannot tell you">
          <p>
            Everything on a result is either a fare somebody was observed listing, or arithmetic on
            fares somebody was observed listing. The cheapest of a set, the gap between two of them,
            a cost per hour, the spread between the floor and the ceiling — all of those are
            descriptions of what was seen.
          </p>
          <p>
            What they are not is a forecast. We will tell you that the cheapest fare in the three
            days you asked about is on the Tuesday; we will not tell you that Tuesdays are cheap.
            The first is a reading. The second is a claim about days we never looked at, and a
            pattern over nine Thursdays is a description of nine Thursdays.
          </p>
          <p>
            We would rather say <em>not enough data yet</em> than compute a statistic from a handful
            of points. If a number appears without something next to it saying how much was seen,
            that is a bug — please tell us.
          </p>
        </Section>

        <Section title="What we store">
          <p>
            Nothing. There is no database, no account and no session — the route and the date live
            in the address bar while you are looking at them, and vanish when you close the tab. The
            amount you type into &ldquo;what you paid&rdquo; is subtracted in your browser and never
            sent anywhere.
          </p>
          <p>
            This is a reduction, not a privacy claim we engineered. The product used to watch trips
            and email you; that needed accounts, a database and a scheduler, and all three are gone.
          </p>
        </Section>

        <div className="mt-12 flex flex-wrap items-center gap-3">
          <Link href="/fares" className="btn btn-primary">
            Check a fare
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
