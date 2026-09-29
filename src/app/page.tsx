import Link from "next/link";
import { PageFrame } from "@/components/page-frame";
import { JsonLd } from "@/components/json-ld";
import { RouteRibbon } from "@/components/route-ribbon";
import { Flap } from "@/components/flap";
import { cadencePhrase } from "@/lib/domain/cadence";

const SAMPLE = [
  ["06:10", "Northeast Regional 95", "4h 08m", "$47", "save $81"],
  ["07:00", "Acela 2155", "3h 50m", "$133", "listed"],
  ["09:20", "Northeast Regional 93", "4h 02m", "$61", "save $67"],
  ["13:00", "Acela 2167", "3h 47m", "$141", "listed"],
] as const;

const FAQ = [
  [
    "Do I need an account?",
    "No. Watch a trip as a guest. Add an email on the trip only if you want fare-drop alerts. Sign-in is optional.",
  ],
  [
    "Do you invent Amtrak prices?",
    "No. If the live board is down, you see that — never a guessed fare. Confirm on Amtrak before you change a ticket.",
  ],
  [
    "Will you rebook for me?",
    "No. We watch and rank. You book on Amtrak, then tell us what you actually paid.",
  ],
  [
    "What does ±1 day mean?",
    "The day before, your travel day, and the day after — every bookable rail option, not just the train you bought.",
  ],
  [
    "How often do you check?",
    `Immediately when you create a watch, then ${cadencePhrase()} for as long as you are watching. Press C to recheck now.`,
  ],
  [
    "If I already booked a specific train?",
    "Add the train number. The board pins it next to the cheapest listed option.",
  ],
  [
    "Do you know if I should actually change the ticket?",
    "We show what moved and how close departure is. Change rules depend on Flexible / Value / Saver. We never invent a fee.",
  ],
  [
    "Can I send this to someone else on the trip?",
    "Yes. Copy a one-liner with T — stations, cheapest listed train, and what you paid. They still confirm on Amtrak.",
  ],
  [
    "Do you subtract the Amtrak change fee?",
    "Only if you type an estimate, or tap $10 / $20 / $50. We never invent a fee. Confirm the real one on Amtrak.",
  ],
  [
    "Can I filter by when I need to leave or arrive?",
    "Yes — leave after, arrive by, duration cap, and a 30-minute arrive buffer. The view lives in the URL, so you can copy it, reload it, or send it to whoever you are travelling with.",
  ],
  [
    "What does Beats your train mean?",
    "Cheaper and not slower than yours — or faster and not more expensive. Press Z for ticket-and-board only. Confirm on Amtrak.",
  ],
  [
    "How do I walk the board without drowning in panels?",
    "J / K focus a train. H hides it this visit, U undoes, Y copies you vs this, W copies the window, F copies Amtrak fields.",
  ],
] as const;

export default async function HomePage() {
  return (
    <PageFrame>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "RailDrop",
          applicationCategory: "TravelApplication",
          operatingSystem: "Web",
          description:
            "Live Amtrak fare watch for trips you already booked. Emails you when listed rail fares actually drop.",
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        }}
      />
      <main id="main" className="mx-auto max-w-6xl px-4 py-16 md:py-24">
        {/* The proposition is the headline.
            It used to be a <p> at text-4xl underneath an <h1> that said
            "RailDrop" at text-7xl — the wordmark, set as the largest object
            on the page, forty pixels below the same wordmark in the header,
            and above the sentence that actually says what the product does.
            The biggest type on a page is its one chance to be understood by
            somebody who will not read the second line. */}
        <div className="grid items-center gap-12 lg:grid-cols-[1.08fr_0.92fr]">
          <div className="reveal">
            <p className="lookup-eyebrow">
              <span className="pulse" aria-hidden />
              <span className="micro">Amtrak fare watch · live inventory</span>
            </p>
            <h1 className="serif mt-5 max-w-3xl text-[2.6rem] leading-[1.02] sm:text-6xl md:text-7xl">
              What is Amtrak charging right now?
            </h1>
            <p className="mt-6 max-w-xl text-lg text-ink-soft">
              Listed fares for every bookable train on your route, read from live inventory the
              moment you ask. No account, nothing saved, and never an estimate.
            </p>
            {/* A plain GET form, on purpose.
                The front door of this product is a price, and a price is one
                question: where, where, when. /fares already reads from/to/on
                out of the query string for shared links, so the landing page
                can hand off to it with no JavaScript at all — this works
                before hydration, and with it switched off. Leaving the date
                empty is not a gap: readSharedSearch falls back to today, and
                today is what most people mean. */}
            <form action="/fares" method="get" className="hero-search mt-9">
              <label className="hero-field">
                <span className="micro">From</span>
                <input name="from" defaultValue="BOS" maxLength={3} autoComplete="off" />
              </label>
              <label className="hero-field">
                <span className="micro">To</span>
                <input name="to" defaultValue="NYP" maxLength={3} autoComplete="off" />
              </label>
              <label className="hero-field hero-field-date">
                <span className="micro">Date · today if blank</span>
                <input name="on" type="date" />
              </label>
              <button type="submit" className="btn btn-primary hero-go">
                See live fares
              </button>
            </form>
            <p className="mt-5 text-xs uppercase tracking-[0.16em] text-ink-soft">
              No account · nothing saved · never an invented price
            </p>
            {/* The watch is the second question, and only worth asking once
                you have seen the first answer. */}
            <p className="mt-4 text-sm text-ink-soft">
              Already booked?{" "}
              <Link href="/api/auth/guest?next=%2Fwatches%2Fnew" className="text-ink underline">
                Watch the trip
              </Link>{" "}
              and we will email you if a listed fare drops.
            </p>
          </div>
          <section className="ticket reveal" style={{ animationDelay: "80ms" }}>
            <div className="border-b border-line px-5 py-4">
              <p className="text-[10px] uppercase tracking-[0.16em] text-ink-soft">
                Northeast corridor · sample board
              </p>
              <div className="mt-3">
                <RouteRibbon origin="BOS" destination="NYP" />
              </div>
              <p className="mt-3 text-xs text-save">You paid $128 · cheapest listed $47</p>
            </div>
            <div className="timetable">
              <div className="sample-head">
                <span>Depart</span>
                <span>Train</span>
                <span className="text-right">Price</span>
              </div>
              {SAMPLE.map(([time, name, duration, price, note]) => (
                <div key={name} className="sample-row border-t border-line px-5 py-3">
                  <p className="price serif text-2xl">
                    <Flap>{time}</Flap>
                  </p>
                  <p className="sample-train min-w-0">
                    {name}
                    <span className="mt-0.5 block text-xs text-ink-soft">{duration}</span>
                  </p>
                  <p className="price serif text-right text-xl">
                    <Flap>{price}</Flap>
                    <span
                      className={`mt-0.5 block text-[10px] uppercase tracking-[0.14em] ${note.startsWith("save") ? "text-save" : "text-ink-soft"}`}
                    >
                      {note}
                    </span>
                  </p>
                </div>
              ))}
              <p className="border-t border-line px-5 py-3 text-xs text-save">
                Regional 95 dropped $14 · Look at switching
              </p>
            </div>
          </section>
        </div>

        {/* A spec strip, not three cards.
            These were three 365x86 panels holding two short lines each — the
            least-earning elements on the page, and identical in weight to the
            numbered how-it-works cards below them, which say considerably
            more. A specification reads as one row under one rule, the way it
            does on the back of an instrument. */}
        {/* One object, not two saying the same thing.
            A spec strip and three numbered cards ran back to back and
            overlapped about seventy percent — "±1 day" was the headline of a
            cell AND of a card — and the cards used 01/02/03, which is the
            same mark the ordered steps further down use for a genuinely
            ordered list. Two devices, one meaning, and one of them borrowed.
            The strip keeps the three-word answer and takes the cards'
            sentences, which were the only thing the cards had that it did
            not. */}
        <section className="spec-strip mt-14" aria-label="What this is">
          {[
            [
              "Right now",
              "Read when you ask",
              "Live Amtrak inventory at the moment you search — not a cached table.",
            ],
            [
              "Every train",
              "Regional, Acela, connections",
              "All bookable rail on the route, not just the one you had in mind.",
            ],
            [
              "Honest",
              "Never invent a price",
              "If the live board is down you see that, not a guess.",
            ],
          ].map(([value, label, copy]) => (
            <div key={label} className="spec-cell">
              <span className="micro">{label}</span>
              <span className="spec-value">{value}</span>
              <span className="spec-copy">{copy}</span>
            </div>
          ))}
        </section>

        {/* Two lists that were doing the page's most important work with no
            design at all: three unmarked <li>s in ink-soft, twice. The
            sequence and the refusal are different kinds of statement, so
            they get different marks — a counted step, and a struck-through
            rule that means "not this". */}
        <section className="mt-16 grid gap-12 md:grid-cols-2">
          <div>
            <h2 className="serif text-3xl">How it works</h2>
            <ol className="step-list mt-7">
              <li>
                <span className="step-lede">Book on Amtrak.</span> Whatever you actually paid.
              </li>
              <li>
                <span className="step-lede">Tell us stations, date, and price.</span> We search the
                window immediately.
              </li>
              <li>
                <span className="step-lede">One email when it drops.</span> Confirm on Amtrak before
                you change anything.
              </li>
            </ol>
          </div>
          <div>
            <h2 className="serif text-3xl">What we will not do</h2>
            <ul className="deny-list mt-7">
              <li>
                <span className="step-lede">Invent Amtrak prices.</span> If the live board is down,
                you see that — not a guess.
              </li>
              <li>
                <span className="step-lede">Deep-link a fake itinerary.</span> You copy trip details
                and book on Amtrak.
              </li>
              <li>
                <span className="step-lede">Spam you.</span> Alerts fire only when the opportunity
                actually improves.
              </li>
            </ul>
          </div>
        </section>

        <section className="mt-16">
          <h2 className="serif text-3xl">Questions, answered</h2>
          {/* Two columns, as two columns — not as CSS multi-column.
              `columns: 2` reflows: opening one question makes the flow
              taller, so items migrate across the column boundary and up to
              six OTHER questions jump to different positions under the
              reader's cursor. A disclosure list is the worst possible
              content for a reflowing container, because every interaction
              with it changes its own height. Two real containers, each
              holding a fixed half in reading order, cannot migrate anything. */}
          <div className="faq mt-6">
            {[FAQ.slice(0, Math.ceil(FAQ.length / 2)), FAQ.slice(Math.ceil(FAQ.length / 2))].map(
              (column, index) => (
                <div key={index} className="faq-col">
                  {column.map(([question, answer]) => (
                    <details key={question}>
                      <summary>{question}</summary>
                      <p>{answer}</p>
                    </details>
                  ))}
                </div>
              ),
            )}
          </div>
        </section>

        {/* A closing band, not a centred white box. The page ends on the
            same rule it is organised by, with the sentence and the action on
            one line at width — a box here is a fifteenth object on a page
            that already has too many. */}
        <section className="closer mt-20">
          <div className="closer-line">
            <p className="serif closer-say">See what your route costs right now.</p>
            <Link href="/fares" className="btn btn-primary">
              Check a fare
            </Link>
          </div>
          <p className="micro closer-foot">You book on Amtrak · we never invent a price</p>
        </section>
      </main>
    </PageFrame>
  );
}
