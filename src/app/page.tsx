import Link from "next/link";
import { PageFrame } from "@/components/page-frame";
import { JsonLd } from "@/components/json-ld";
import { RouteRibbon } from "@/components/route-ribbon";
import { Flap } from "@/components/flap";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const SAMPLE = [
  ["06:10", "Northeast Regional 95", "4h 08m", "$47", "save $81"],
  ["07:00", "Acela 2155", "3h 50m", "$133", "listed"],
  ["09:20", "Northeast Regional 93", "4h 02m", "$61", "save $67"],
  ["13:00", "Acela 2167", "3h 47m", "$141", "listed"],
] as const;

const FAQ = [
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
    "Immediately when you create a watch, then morning / afternoon / evening. Press C to recheck now.",
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
    "Yes — leave after, arrive by, duration cap, and a 30-minute arrive buffer. Filters stay on this visit only.",
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
  const user = await getSessionUser();
  return (
    <PageFrame email={user?.email}>
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
        <div className="grid items-end gap-12 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="reveal">
            <p className="kicker">Amtrak fare watch</p>
            <h1 className="serif mt-4 max-w-3xl text-[2.65rem] leading-[1.05] sm:text-5xl md:text-7xl">
              Know when your train gets cheaper.
            </h1>
            <p className="mt-6 max-w-xl text-lg text-ink-soft">
              Book the trip. We watch every bookable Amtrak rail option across your window.
            </p>
            <div className="mt-10 flex flex-wrap gap-3">
              <Link href={user ? "/watches/new" : "/login"} className="btn btn-primary">
                Watch a booked trip
              </Link>
              <Link href="/login" className="btn btn-ghost">
                Sign in with email
              </Link>
            </div>
            <p className="mt-5 text-xs uppercase tracking-[0.16em] text-ink-soft">
              Live listed fares · no invented prices · one precise alert
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

        <section className="mt-16 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ["Live", "On-demand board"],
            ["±1 day", "Default window"],
            ["3× / day", "While watching"],
            ["$0 fake", "Never invented"],
          ].map(([value, label], index) => (
            <div
              key={label}
              className="panel reveal px-3 py-4 sm:px-4"
              style={{ animationDelay: `${90 + index * 50}ms` }}
            >
              <p className="serif text-xl sm:text-2xl">{value}</p>
              <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-ink-soft sm:text-xs">
                {label}
              </p>
            </div>
          ))}
        </section>

        <section className="mt-16 grid gap-4 md:grid-cols-3">
          {[
            [
              "01",
              "Same stations, every train",
              "Regional, Acela, connections — not just the train you already bought.",
            ],
            ["02", "±1 day by default", "If tomorrow is cheaper than today, you should know."],
            ["03", "One precise alert", "Email only when the opportunity actually improves."],
          ].map(([num, title, copy], index) => (
            <article
              key={title}
              className="panel reveal p-5"
              style={{ animationDelay: `${120 + index * 70}ms` }}
            >
              <p className="font-mono text-xs text-gold">{num}</p>
              <h2 className="serif mt-3 text-2xl">{title}</h2>
              <p className="mt-2 text-sm text-ink-soft">{copy}</p>
            </article>
          ))}
        </section>

        <section className="mt-16 grid gap-8 md:grid-cols-2">
          <div>
            <h2 className="serif text-3xl">How it works</h2>
            <ol className="mt-6 space-y-3 text-sm text-ink-soft">
              <li>
                <span className="text-ink">Book on Amtrak.</span> Whatever you actually paid.
              </li>
              <li>
                <span className="text-ink">Tell us stations, date, and price.</span> We search the
                window immediately.
              </li>
              <li>
                <span className="text-ink">One email when it drops.</span> Confirm on Amtrak before
                you change anything.
              </li>
            </ol>
          </div>
          <div>
            <h2 className="serif text-3xl">What we will not do</h2>
            <ul className="mt-6 space-y-4 text-sm text-ink-soft">
              <li>Invent Amtrak prices. If the live board is down, you see that — not a guess.</li>
              <li>Deep-link into a fake Amtrak itinerary. You copy trip details and book there.</li>
              <li>Spam you. Alerts fire only when the opportunity actually improves.</li>
            </ul>
          </div>
        </section>

        <section className="mt-16">
          <h2 className="serif text-3xl">Questions, answered</h2>
          <div className="faq mt-6">
            {FAQ.map(([question, answer]) => (
              <details key={question}>
                <summary>{question}</summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
    </PageFrame>
  );
}
