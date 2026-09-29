import Link from "next/link";
import { PageFrame } from "@/components/page-frame";
import { WatchList } from "@/components/watch-list";
import { Flap } from "@/components/flap";
import { getSessionUser, guestEntryHref } from "@/lib/auth/session";
import { getRepository } from "@/lib/services";
import { formatUsdCompact } from "@/lib/domain/money";
import { localIsoDate } from "@/lib/domain/timezone";
import { watchAttention } from "@/lib/domain/board-act";
import { soonestWatch } from "@/lib/domain/board-picks";
import { daysUntilFlap, formatDisplayDate } from "@/lib/domain/calendar";
import { redirect } from "next/navigation";
import { loadPageData } from "@/lib/pages/load-guard";
import { RecordsUnreachable } from "@/components/records-unreachable";
import { AssistantPanel } from "@/components/assistant-panel";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect(guestEntryHref("/dashboard"));
  const loaded = await loadPageData({ page: "/dashboard", userId: user.id }, () =>
    getRepository().listWatchesForUser(user.id),
  );
  if (!loaded.reachable) {
    return (
      <PageFrame email={user.email} isGuest={Boolean(user.isGuest)}>
        <main id="main" className="ambient mx-auto max-w-6xl px-4 py-8">
          <h1 className="lookup-title">Your watches</h1>
          <RecordsUnreachable what="watches" retryHref="/dashboard" permanent={loaded.permanent} />
        </main>
      </PageFrame>
    );
  }
  const watches = loaded.data;
  const ranked = [...watches].sort((a, b) => (b.bestSavingsCents ?? 0) - (a.bestSavingsCents ?? 0));
  const active = watches.filter((watch) => watch.status === "ACTIVE");
  const bestSavings = Math.max(0, ...watches.map((watch) => watch.bestSavingsCents ?? 0));
  const today = localIsoDate(
    new Date(),
    watches.find((watch) => watch.timezone)?.timezone ?? "America/New_York",
  );
  const needsLook = watches.filter(
    (watch) => watch.status === "ACTIVE" && watchAttention(watch, today).level !== "ok",
  ).length;
  const next = soonestWatch(watches, today);

  return (
    <PageFrame email={user.email} isGuest={Boolean(user.isGuest)}>
      <main id="main" className="ambient mx-auto max-w-6xl px-4 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="lookup-title">Your watches</h1>
            <p className="text-ink-soft">
              {user.isGuest
                ? "Browsing as a guest: add an alert email on a trip if you want updates."
                : "Trips you already booked."}
            </p>
          </div>
          <Link href="/watches/new" className="btn btn-primary">
            Watch trip
          </Link>
        </div>
        {/* Nothing to summarise before there is anything to summarise.
            Four cards reading "—" above an empty state is furniture: it fills
            the screen with the shape of information and none of it, and it
            pushes the one thing a new visitor should read further down. */}
        {watches.length === 0 ? null : (
          <section className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4 stagger">
            <Metric label="Active watches" value={String(active.length)} />
            <Metric
              label="Best savings found"
              value={bestSavings ? formatUsdCompact(bestSavings) : "—"}
            />
            <Metric
              label="On the table"
              value={
                watches.some((watch) => (watch.bestSavingsCents ?? 0) > 0)
                  ? formatUsdCompact(
                      watches.reduce(
                        (sum, watch) => sum + Math.max(0, watch.bestSavingsCents ?? 0),
                        0,
                      ),
                    )
                  : "—"
              }
            />
            <Metric label="Needs a look" value={needsLook ? String(needsLook) : "—"} />
          </section>
        )}
        {next ? (
          <Link href={`/watches/${next.id}`} className="depart-strip mt-6 no-underline">
            <span className="text-[10px] uppercase tracking-[0.16em] opacity-70">Next trip</span>
            <Flap>{next.originCode}</Flap>
            <span className="text-[10px] uppercase tracking-[0.18em] opacity-70">to</span>
            <Flap>{next.destinationCode}</Flap>
            <span className="depart-strip-rule" aria-hidden />
            <Flap>{formatDisplayDate(next.desiredTravelDate)}</Flap>
            <Flap>{daysUntilFlap(next.desiredTravelDate, today)}</Flap>
            {next.bestSavingsCents ? (
              <span className="depart-strip-cta text-xs text-save">
                save {formatUsdCompact(next.bestSavingsCents)}
              </span>
            ) : (
              <span className="depart-strip-cta text-[10px] uppercase tracking-[0.16em] opacity-70">
                Open board
              </span>
            )}
          </Link>
        ) : null}
        {watches.length === 0 ? (
          <div className="ticket mt-12 p-8">
            <p className="kicker">Empty board</p>
            <h2 className="serif mt-3 text-3xl">Watch a trip you already booked.</h2>
            <p className="mt-2 max-w-lg text-ink-soft">
              Enter stations and what you paid: we search your window for a cheaper listed fare.
            </p>
            <Link href="/watches/new" className="btn btn-primary mt-6">
              Create first watch
            </Link>
          </div>
        ) : (
          <div className="stagger">
            <WatchList watches={ranked} today={today} />
          </div>
        )}
        {/* Only once there is something to compare. With no trips the answer to
            every question is the same sentence the empty state already says. */}
        {watches.length > 0 && <AssistantPanel />}
      </main>
    </PageFrame>
  );
}

/* A readout, not a card of text. Tick rule above it the way a scale is
   printed above a gauge, the label in the micro convention, and the figure in
   tabular numerals so four of them line up across the row. */
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric bracketed">
      <div className="tick-rule" aria-hidden />
      <p className="micro mt-2">{label}</p>
      <p className="metric-value readout">
        <Flap>{value}</Flap>
      </p>
    </div>
  );
}
