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

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect(guestEntryHref("/dashboard"));
  const watches = await getRepository().listWatchesForUser(user.id);
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
  const empty = watches.length === 0;

  return (
    <PageFrame email={user.email} isGuest={Boolean(user.isGuest)}>
      <main id="main" className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="serif text-4xl">Your watches</h1>
            <p className="text-ink-soft">
              {user.isGuest
                ? "Browsing as a guest — add an alert email on a trip if you want updates."
                : "Trips you already booked."}
            </p>
          </div>
          <Link href="/watches/new" className="btn btn-primary">
            Watch trip
          </Link>
        </div>
        {empty ? (
          <div className="ticket mt-12 p-8">
            <p className="kicker">Empty board</p>
            <h2 className="serif mt-3 text-3xl">Watch a trip you already booked.</h2>
            <p className="mt-2 max-w-lg text-ink-soft">
              Enter stations and what you paid — we search your window for a cheaper listed fare.
            </p>
            {user.isGuest ? (
              <p className="mt-3 max-w-lg text-sm text-ink-soft">
                Guest mode keeps this device’s watches. Add an alert email on the trip if you want
                fare-drop notices, or{" "}
                <Link href="/login" className="underline">
                  sign in
                </Link>{" "}
                to keep them across devices.
              </p>
            ) : null}
            <Link href="/watches/new" className="btn btn-primary mt-6">
              Create first watch
            </Link>
          </div>
        ) : (
          <>
            <section className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
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
            <WatchList watches={ranked} today={today} />
          </>
        )}
      </main>
    </PageFrame>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel p-4">
      <p className="text-xs uppercase tracking-[0.14em] text-ink-soft">{label}</p>
      <p className="serif mt-1 text-2xl">
        <Flap>{value}</Flap>
      </p>
    </div>
  );
}
