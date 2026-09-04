"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { SavingsMeter } from "@/components/savings-meter";
import { SearchingOverlay } from "@/components/searching-overlay";
import { ConfirmSheet } from "@/components/confirm-sheet";
import { formatUsdCompact } from "@/lib/domain/money";
import {
  formatDisplayDate,
  formatDaysUntil,
  dateOffsetDays,
  daysUntilFlap,
} from "@/lib/domain/calendar";
import { travelUrgency } from "@/lib/domain/board-moves";
import { formatRelativeTime, isCheckStale } from "@/lib/domain/relative-time";
import { savingsPercent } from "@/lib/domain/board-tools";
import { stationLabel } from "@/lib/stations/catalog";
import { RouteRibbon } from "@/components/route-ribbon";
import {
  perPersonCents,
  roundTripPairs,
  duplicateWatchIds,
  sortWatches,
  type WatchListSort,
} from "@/lib/domain/board-picks";
import { watchAttention } from "@/lib/domain/board-act";
import { returnTravelDate } from "@/lib/domain/watch-query";
import type { WatchRecord } from "@/lib/db/models";
import { Flap } from "@/components/flap";

export function WatchList({ watches, today }: { watches: WatchRecord[]; today: string }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<"all" | "drops" | "paused">("all");
  const [listSort, setListSort] = useState<WatchListSort>("drops");
  const [scanning, setScanning] = useState<WatchRecord | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<WatchRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const visible = watches.filter((watch) => {
    const haystack =
      `${watch.originCode} ${watch.destinationCode} ${stationLabel(watch.originCode)} ${stationLabel(watch.destinationCode)} ${labels[watch.id] ?? ""}`.toLowerCase();
    if (query && !haystack.includes(query.toLowerCase())) return false;
    if (filter === "drops") return (watch.bestSavingsCents ?? 0) > 0;
    if (filter === "paused") return watch.status === "PAUSED";
    return true;
  });
  const ordered = sortWatches(visible, listSort);
  const pairs = roundTripPairs(watches);
  const dupes = duplicateWatchIds(watches);
  const attention = watches.filter((watch) => {
    const level = watchAttention(watch, today).level;
    return watch.status === "ACTIVE" && level !== "ok";
  });

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("raildrop.labels");
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return;
      const next: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value === "string" && value.trim()) next[key] = value.trim();
      }
      // eslint-disable-next-line react-hooks/set-state-in-effect -- nicknames are local-only
      setLabels(next);
    } catch {
      // ignore broken label cache
    }
  }, []);

  function persistLabel(id: string, value: string, trim = false) {
    setLabels((current) => {
      const next = { ...current };
      const stored = trim ? value.trim() : value;
      if (!stored) delete next[id];
      else next[id] = stored;
      try {
        window.localStorage.setItem("raildrop.labels", JSON.stringify(next));
      } catch {
        // private mode / quota
      }
      return next;
    });
  }

  async function checkNow(watch: WatchRecord) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setScanning(watch);
    setElapsed(0);
    setCheckError(null);
    const timer = setInterval(() => setElapsed((seconds) => seconds + 1), 1000);
    try {
      const response = await fetch(`/api/watches/${watch.id}/check`, {
        method: "POST",
        signal: controller.signal,
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setCheckError(payload?.error ?? "Could not refresh that board");
        return;
      }
      router.refresh();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setCheckError("Could not refresh that board");
    } finally {
      clearInterval(timer);
      if (abortRef.current === controller) abortRef.current = null;
      setScanning(null);
      setElapsed(0);
    }
  }

  async function patchWatch(watch: WatchRecord, body: Record<string, unknown>) {
    setCheckError(null);
    try {
      const response = await fetch(`/api/watches/${watch.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setCheckError(payload?.error ?? "Could not update that watch");
        return;
      }
      router.refresh();
    } catch {
      setCheckError("Could not update that watch");
    }
  }

  async function deleteWatch(watch: WatchRecord) {
    setDeleting(true);
    setCheckError(null);
    try {
      const response = await fetch(`/api/watches/${watch.id}`, { method: "DELETE" });
      if (!response.ok) {
        setCheckError("Could not delete that watch");
        return;
      }
      setPendingDelete(null);
      router.refresh();
    } catch {
      setCheckError("Could not delete that watch");
    } finally {
      setDeleting(false);
    }
  }

  function cancelScan() {
    abortRef.current?.abort();
    setScanning(null);
    setElapsed(0);
  }

  return (
    <div>
      {scanning ? (
        <SearchingOverlay
          origin={scanning.originCode}
          destination={scanning.destinationCode}
          date={scanning.desiredTravelDate}
          elapsedSeconds={elapsed}
          flexibility={scanning.dateFlexibilityDays}
          mode="recheck"
          onCancel={cancelScan}
        />
      ) : null}
      <div className="mt-6 flex flex-wrap items-end gap-x-6 gap-y-3">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by station"
          className="field mt-0 max-w-xs"
          aria-label="Filter watches"
        />
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em] text-ink-soft">Show</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {(
              [
                ["all", "All"],
                ["drops", "Drops"],
                ["paused", "Paused"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`chip ${filter === value ? "chip-on" : ""}`}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em] text-ink-soft">Order</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {(
              [
                ["drops", "Biggest drop"],
                ["soonest", "Soonest trip"],
                ["checked", "Last checked"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`chip ${listSort === value ? "chip-on" : ""}`}
                aria-pressed={listSort === value}
                onClick={() => setListSort(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      {checkError ? (
        <p className="mt-4 text-sm text-danger" role="alert">
          {checkError}
        </p>
      ) : null}
      {attention.length > 0 ? (
        <div className="panel attention-edge mt-6 p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">Needs a look</p>
          <ul className="mt-3 space-y-2 text-sm">
            {attention.map((watch) => {
              const item = watchAttention(watch, today);
              return (
                <li key={watch.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {watch.originCode} → {watch.destinationCode} · {item.label}
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/watches/${watch.id}`} className="btn btn-ghost">
                      View board
                    </Link>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={watch.status !== "ACTIVE"}
                      onClick={() => checkNow(watch)}
                    >
                      Check now
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {dupes.size > 0 ? (
        <div className="beats mt-6 p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">Same trip twice</p>
          <p className="mt-2 text-sm">
            More than one watch on the same origin, destination, and date. Pause or delete the
            extra.
          </p>
        </div>
      ) : null}
      {pairs.length > 0 ? (
        <div className="ticket mt-6 p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">Round trip</p>
          <ul className="mt-3 space-y-3 text-sm">
            {pairs.map((pair) => (
              <li key={`${pair.outbound.id}-${pair.inbound.id}`}>
                <p>
                  {pair.outbound.originCode} ⇄ {pair.inbound.originCode}
                  {pair.savingsCents > 0 ? (
                    <>
                      {" · combined save "}
                      <Flap>{formatUsdCompact(pair.savingsCents)}</Flap>
                    </>
                  ) : (
                    " · watching both directions"
                  )}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Link href={`/watches/${pair.outbound.id}`} className="btn btn-ghost">
                    {pair.outbound.originCode} → {pair.outbound.destinationCode}
                  </Link>
                  <Link href={`/watches/${pair.inbound.id}`} className="btn btn-ghost">
                    {pair.inbound.originCode} → {pair.inbound.destinationCode}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {visible.length === 0 ? (
        <div className="ticket mt-6 p-5">
          <p className="serif text-2xl">Nothing matches</p>
          <p className="mt-2 text-sm text-ink-soft">
            No watches match that filter
            {query.trim() ? ` for “${query.trim()}”` : ""}. Adjust the filter or show everything.
          </p>
          <button
            type="button"
            className="btn btn-ghost mt-4"
            onClick={() => {
              setQuery("");
              setFilter("all");
            }}
          >
            Show all
          </button>
        </div>
      ) : (
        <ul className="mt-6 space-y-4">
          {ordered.map((watch) => {
            const pct = watch.bestPriceCents
              ? savingsPercent(watch.currentBookedPriceCents, watch.bestPriceCents)
              : null;
            const reverse = `/watches/new?origin=${watch.destinationCode}&destination=${watch.originCode}&date=${returnTravelDate(watch.desiredTravelDate, 2, today)}&price=${watch.currentBookedPriceCents / 100}`;
            const eachBooked = perPersonCents(watch.currentBookedPriceCents, watch.passengerCount);
            const eachBest = watch.bestPriceCents
              ? perPersonCents(watch.bestPriceCents, watch.passengerCount)
              : null;
            const attentionLevel = watchAttention(watch, today).level;
            return (
              <li
                key={watch.id}
                className={`ticket ticket-hover p-5${attentionLevel !== "ok" ? " attention-edge" : ""}${attentionLevel === "soon" ? " is-urgent" : ""}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <RouteRibbon
                      origin={watch.originCode}
                      destination={watch.destinationCode}
                      compact
                    />
                    <p className="mt-2 text-sm text-ink-soft">
                      {stationLabel(watch.originCode)} → {stationLabel(watch.destinationCode)}
                    </p>
                    <input
                      value={labels[watch.id] ?? ""}
                      onChange={(event) => persistLabel(watch.id, event.target.value)}
                      onBlur={(event) => persistLabel(watch.id, event.target.value, true)}
                      placeholder="Nickname · optional"
                      aria-label={`Nickname for ${watch.originCode} to ${watch.destinationCode}`}
                      className="field mt-2 max-w-xs py-1 text-sm"
                    />
                    <p className="mt-2 text-sm">
                      <Flap>{formatDisplayDate(watch.desiredTravelDate)}</Flap>{" "}
                      <Flap>{daysUntilFlap(watch.desiredTravelDate, today)}</Flap>{" "}
                      {watch.dateFlexibilityDays === 0
                        ? "exact date"
                        : `±${watch.dateFlexibilityDays} day${watch.dateFlexibilityDays === 1 ? "" : "s"}`}
                      {watch.passengerCount > 1 ? ` · ${watch.passengerCount} passengers` : ""}
                    </p>
                    <p className="mt-1 text-xs text-ink-soft">
                      {formatDaysUntil(watch.desiredTravelDate, today)}
                      {watch.bookedTrainNumber ? ` · train ${watch.bookedTrainNumber}` : ""}
                      {isCheckStale(watch.lastCheckedAt) ? " · board may be stale" : ""}
                    </p>
                    {travelUrgency(dateOffsetDays(today, watch.desiredTravelDate)).level ===
                    "now" ? (
                      <p className="mt-1 text-xs text-drop">Act soon — travel is immediate.</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-start gap-2">
                    {dupes.has(watch.id) ? (
                      <span className="chip chip-beats">Duplicate</span>
                    ) : null}
                    <StatusPill
                      status={watch.status}
                      savings={watch.bestSavingsCents}
                      attention={watchAttention(watch, today).label}
                    />
                  </div>
                </div>
                <dl className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-3">
                  <div>
                    <dt className="text-xs uppercase tracking-[0.14em] text-ink-soft">
                      Current booking
                    </dt>
                    <dd className="price serif text-3xl">
                      {formatUsdCompact(watch.currentBookedPriceCents)}
                    </dd>
                    {eachBooked ? (
                      <p className="text-xs text-ink-soft">
                        {formatUsdCompact(eachBooked)} / person
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-[0.14em] text-ink-soft">Best now</dt>
                    <dd className="price serif text-3xl">
                      {watch.bestPriceCents ? (
                        <Flap>{formatUsdCompact(watch.bestPriceCents)}</Flap>
                      ) : (
                        "—"
                      )}
                    </dd>
                    {eachBest ? (
                      <p className="text-xs text-ink-soft">{formatUsdCompact(eachBest)} / person</p>
                    ) : null}
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-[0.14em] text-ink-soft">
                      Potential savings
                    </dt>
                    <dd className="price serif text-3xl text-save">
                      {watch.bestSavingsCents ? formatUsdCompact(watch.bestSavingsCents) : "—"}
                      {pct != null ? (
                        <span className="ml-2 text-base font-sans tracking-normal">({pct}%)</span>
                      ) : null}
                    </dd>
                  </div>
                </dl>
                <SavingsMeter
                  bookedCents={watch.currentBookedPriceCents}
                  foundCents={watch.bestPriceCents}
                />
                <p className="mt-4 text-sm text-ink-soft">
                  Checked {formatRelativeTime(watch.lastCheckedAt)} · Next scan{" "}
                  {watch.nextCheckAtLabel ?? "—"}
                </p>
                <div className="mt-4 flex flex-wrap gap-2 text-sm">
                  <Link href={`/watches/${watch.id}`} className="btn btn-ink">
                    View board
                  </Link>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={watch.status !== "ACTIVE"}
                    onClick={() => checkNow(watch)}
                  >
                    Check now
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={watch.status === "COMPLETED"}
                    onClick={() =>
                      patchWatch(watch, {
                        status: watch.status === "PAUSED" ? "ACTIVE" : "PAUSED",
                      })
                    }
                  >
                    {watch.status === "PAUSED" ? "Resume" : "Pause"}
                  </button>
                  <Link href={reverse as Route} className="btn btn-ghost">
                    Watch return
                  </Link>
                  <button
                    type="button"
                    className="btn btn-ghost dock-danger"
                    onClick={() => setPendingDelete(watch)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <ConfirmSheet
        open={Boolean(pendingDelete)}
        title="Delete this watch?"
        body={
          pendingDelete
            ? `${pendingDelete.originCode} → ${pendingDelete.destinationCode} board history will be removed. This can’t be undone.`
            : "Your board history for this trip will be removed."
        }
        confirmLabel="Delete watch"
        busy={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) void deleteWatch(pendingDelete);
        }}
      />
    </div>
  );
}

function StatusPill({
  status,
  savings,
  attention,
}: {
  status: string;
  savings: number | null;
  attention: string;
}) {
  const label =
    status === "COMPLETED"
      ? "Monitoring ended"
      : status === "PAUSED"
        ? "Paused"
        : attention !== "Watching"
          ? attention
          : savings && savings > 0
            ? "Drop found"
            : "Watching";
  return (
    <span
      className={`chip ${savings && savings > 0 ? "chip-save" : ""} ${attention === "Act soon" ? "chip-tight" : ""} ${status === "PAUSED" ? "opacity-70" : ""}`}
    >
      {label}
    </span>
  );
}
