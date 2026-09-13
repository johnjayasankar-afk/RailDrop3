import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Wordmark } from '@/components/AppShell';
import { DemoBanner } from '@/components/DemoBanner';
import { RouteLine } from '@/components/RouteLine';
import { ThemeToggle } from '@/components/ThemeToggle';
import { getCurrentUser } from '@/lib/db/server';
import { isSupabaseConfigured } from '@/lib/env';
import { describeActiveProvider } from '@/lib/providers';

// This page branches on the signed-in session, so it must never be cached
// and served to another visitor.
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  if (isSupabaseConfigured()) {
    const user = await getCurrentUser();
    if (user) redirect('/dashboard');
  }

  // Stated from the deployment rather than asserted in copy. The footer used
  // to claim a "licensed API" on every deployment, including ones running the
  // deterministic demo provider — an integration claim the product could not
  // back, on its most public surface.
  const provider = describeActiveProvider();

  return (
    <div className="min-h-dvh">
      <DemoBanner />
      <header className="sticky top-0 z-40 border-b border-line bg-paper/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-5">
          <Wordmark />
          <div className="flex items-center gap-3">
            <span className="hidden sm:block">
              <ThemeToggle />
            </span>
            <Link
              href="/login"
              className="inline-flex min-h-9 items-center text-[13px] font-semibold text-muted transition-colors hover:text-ink"
            >
              Sign in
            </Link>
          </div>
        </div>
      </header>

      <main id="main">
        {/* ── Hero ──────────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-5xl px-5 pb-14 pt-14 sm:pb-20 sm:pt-24">
          <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr]">
            <div>
              <p className="rd-label">Amtrak fare monitoring</p>
              <h1 className="mt-4 text-[40px] font-bold leading-[1.03] tracking-[-0.025em] text-ink sm:text-[58px]">
                Know when your
                <br />
                train gets <span className="text-rust">cheaper</span>.
              </h1>
              <p className="mt-5 max-w-lg text-[17px] leading-relaxed text-muted">
                You already bought the ticket. RailDrop keeps watching the same route and tells you
                the moment a materially cheaper option appears — on your date, the day before, or
                the day after.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link href="/login" className="rd-btn rd-btn-primary">
                  Start watching a trip
                </Link>
                <span className="text-[13px] text-faint">No card, no billing</span>
              </div>

              <dl className="mt-10 grid max-w-md grid-cols-3 gap-6 border-t border-line pt-6">
                <Metric value="3×" label="checks a day" />
                <Metric value="±1" label="day either side" />
                <Metric value="0" label="changes to your booking" />
              </dl>
            </div>

            {/* A real card in the product's own design language, with sample
                numbers — not a screenshot that can go stale. */}
            <DemoCard />
          </div>
        </section>

        {/* ── How it works ──────────────────────────────────────────────── */}
        <section className="border-y border-line bg-raised/40">
          <div className="mx-auto grid max-w-5xl gap-px bg-line sm:grid-cols-3">
            {[
              {
                n: '01',
                title: 'Tell us what you paid',
                body: 'Two stations, your travel date, and the amount actually on your receipt. That number is the benchmark — nothing is estimated from it.',
              },
              {
                n: '02',
                title: 'We watch three days, three times a day',
                body: 'Your date plus the day before and after, checked at 8am, 2pm and 8pm in your timezone, for as long as your window runs.',
              },
              {
                n: '03',
                title: 'You hear from us only when it matters',
                body: 'One email or push when a materially cheaper option appears, with the alternatives ranked and ready to book on Amtrak.',
              },
            ].map((step) => (
              <div key={step.n} className="bg-paper px-6 py-9">
                <div className="ticket text-[12px] font-bold tracking-[0.12em] text-rust">
                  {step.n}
                </div>
                <h2 className="mt-3 text-[17px] font-semibold leading-snug tracking-tight text-ink">
                  {step.title}
                </h2>
                <p className="mt-2 text-[14px] leading-relaxed text-muted">{step.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Features ──────────────────────────────────────────────────── */}
        {/* Grouped, not listed. Ten equal bullets gave "your data stays yours"
            the same weight as the thing the product is actually for, and read
            as a feature dump rather than a point of view. */}
        <section className="mx-auto max-w-5xl px-5 py-16">
          <h2 className="rd-label">What you get</h2>
          <div className="mt-7 space-y-10">
            {FEATURE_GROUPS.map((group) => (
              <div key={group.title} className="grid gap-x-10 gap-y-5 lg:grid-cols-[220px_1fr]">
                <div>
                  <h3 className="text-[18px] font-bold leading-snug tracking-tight text-ink">
                    {group.title}
                  </h3>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-muted lg:max-w-[200px]">
                    {group.lede}
                  </p>
                </div>

                <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
                  {group.items.map((item) => (
                    <div key={item.title}>
                      <h4 className="flex items-start gap-2 text-[14.5px] font-semibold leading-snug text-ink">
                        <span
                          aria-hidden="true"
                          className="mt-[7px] size-1.5 shrink-0 rounded-full bg-rust"
                        />
                        {item.title}
                      </h4>
                      <p className="mt-1.5 pl-3.5 text-[13.5px] leading-relaxed text-muted">
                        {item.body}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Honesty ───────────────────────────────────────────────────── */}
        <section className="border-t border-line">
          <div className="mx-auto max-w-5xl px-5 py-14">
            <h2 className="rd-label">What RailDrop does not do</h2>
            <ul className="mt-4 grid max-w-3xl gap-2.5 text-[15px] leading-relaxed text-muted sm:grid-cols-2">
              {[
                'It never changes or cancels your reservation.',
                'It never guesses a price. If a date could not be checked, it says so.',
                'It never emails you twice about the same thing.',
                'It never claims a link points at inventory it cannot see.',
              ].map((line) => (
                <li key={line} className="flex gap-3">
                  <span aria-hidden="true" className="text-line-strong">
                    —
                  </span>
                  {line}
                </li>
              ))}
            </ul>

            <div className="mt-10">
              <Link href="/login" className="rd-btn rd-btn-primary">
                Watch your first trip
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-5 py-7">
          <p className="text-[12px] leading-relaxed text-faint">
            RailDrop is an independent fare monitor and is not affiliated with Amtrak. It never
            scrapes amtrak.com.{' '}
            {provider.isLive
              ? `Fares are read from a third-party fare API (${provider.id}).`
              : 'This deployment is running a deterministic demo provider, so every fare shown is generated rather than live.'}
          </p>
          <span className="sm:hidden">
            <ThemeToggle />
          </span>
        </div>
      </footer>
    </div>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <dt className="sr-only">{label}</dt>
      <dd>
        <span className="tnum block text-[26px] font-bold leading-none tracking-tight text-ink">
          {value}
        </span>
        <span className="mt-1.5 block text-[12px] leading-snug text-faint">{label}</span>
      </dd>
    </div>
  );
}

/**
 * The hero visual is the product's own card, built from the same components and
 * tokens as the real thing — so it can never drift from what people actually
 * see, the way a screenshot would.
 */
function DemoCard() {
  return (
    <div aria-hidden="true" className="relative">
      <div className="rd-card-raised overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <RouteLine origin="BOS" destination="NYP" />
          <span className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">
            Sep 20 · ±1 day
          </span>
        </div>

        <div className="px-5 py-5">
          <div className="flex flex-wrap items-end gap-x-7 gap-y-4">
            <div>
              <div className="rd-label">Paid</div>
              <div className="tnum mt-1 text-[25px] font-bold leading-none tracking-tight text-ink">
                $128
              </div>
            </div>
            <div>
              <div className="rd-label">Best now</div>
              <div className="tnum mt-1 text-[25px] font-bold leading-none tracking-tight text-save">
                $74
              </div>
            </div>
            <div className="rounded-lg border border-save-line bg-save-soft px-3 py-1.5">
              <span className="tnum text-[15px] font-bold text-save">Save $54</span>
              <span className="ml-1.5 tnum text-[11.5px] font-semibold text-save/80">42%</span>
            </div>
          </div>

          <p className="mt-4 text-[13px] leading-relaxed text-muted">
            <span className="font-semibold text-ink-2">Sep 19</span> · Northeast Regional 179 ·{' '}
            <span className="ticket">7:05 AM</span> · 1 day earlier
          </p>

          {/* A miniature of the real price chart. */}
          <svg viewBox="0 0 300 56" className="mt-5 w-full" aria-hidden="true">
            <line
              x1="0"
              x2="300"
              y1="14"
              y2="14"
              stroke="var(--rd-line-strong)"
              strokeWidth="1.5"
              strokeDasharray="4 4"
            />
            <path
              d="M0 18 L40 20 L80 17 L120 26 L160 24 L200 36 L240 33 L300 44 L300 14 L0 14 Z"
              fill="var(--rd-save)"
              opacity="0.1"
            />
            <polyline
              points="0,18 40,20 80,17 120,26 160,24 200,36 240,33 300,44"
              fill="none"
              stroke="var(--rd-rust)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle
              cx="200"
              cy="36"
              r="4.5"
              fill="var(--rd-surface)"
              stroke="var(--rd-save)"
              strokeWidth="2.5"
            />
            <circle cx="300" cy="44" r="3" fill="var(--rd-rust)" />
          </svg>
          <p className="mt-1.5 text-[11px] text-faint">
            Dashed line is what you paid. The ring is an alert we sent.
          </p>
        </div>

        <div className="flex items-center justify-between border-t border-line px-5 py-3">
          <span className="tnum text-[12px] text-faint">Updated 2:02 PM · Next check 8:00 PM</span>
          <span className="text-[13px] font-semibold text-ink underline decoration-line-strong underline-offset-4">
            View 8 cheaper options
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Three groups, in the order a person meets them: what it watches, how it
 * reaches you, and what it refuses to guess.
 */
const FEATURE_GROUPS = [
  {
    title: 'It watches properly',
    lede: 'Not just the train you booked, and not just your date.',
    items: [
      {
        title: 'Every eligible train competes',
        body: 'Any Amtrak service on any of your dates, ranked by price first. Filter to direct trains, a part of the day, or a single date.',
      },
      {
        title: 'Name your number',
        body: 'Set a target and RailDrop tells you the moment the fare reaches it — even on a quiet week when nothing else changed materially.',
      },
      {
        title: 'Round trips, both directions',
        body: 'Each leg is watched against its own receipt total, because fares on the two directions move independently.',
      },
      {
        title: 'Price history you can read',
        body: 'Every check since you started, plus where today sits in the range actually observed for your trip.',
      },
    ],
  },
  {
    title: 'It reaches you well',
    lede: 'Fares move in minutes, so timing is most of the value.',
    items: [
      {
        title: 'Push the moment it drops',
        body: 'Install RailDrop and get an instant notification. An email eight hours later is often too late.',
      },
      {
        title: 'Quiet hours that hold, not drop',
        body: 'Overnight alerts wait until morning. You still get every one of them.',
      },
      {
        title: 'A record of every check',
        body: 'A timeline of what RailDrop actually did: each check, each alert, each thing you changed. A silent week is visible, not implied.',
      },
      {
        title: 'What you really saved',
        body: 'Not just what was on offer. Tell RailDrop what you paid when you rebook and it counts the money that genuinely changed hands.',
      },
    ],
  },
  {
    title: 'It never guesses',
    lede: 'The hard part of a fare monitor is knowing when to say nothing.',
    items: [
      {
        title: 'Honest about failure',
        body: 'If a date could not be checked, it says so. A provider outage is never rendered as "no cheaper fare".',
      },
      {
        title: 'No verdict without evidence',
        body: 'It will not call a price good until it has enough completed checks to support the claim, and it never forecasts.',
      },
      {
        title: 'It never touches your booking',
        body: 'RailDrop observes and reports. Rebooking stays entirely your decision, on Amtrak.',
      },
      {
        title: 'Your data stays yours',
        body: 'Export every trip, check and alert as JSON whenever you like, and delete the account outright in one place.',
      },
    ],
  },
] as const;
