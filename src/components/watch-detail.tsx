"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { formatUsdCompact } from "@/lib/domain/money";
import {
  dateBadge,
  formatDisplayDate,
  formatDurationMinutes,
  formatDaysUntil,
  dateOffsetDays,
} from "@/lib/domain/calendar";
import { formatClock, formatBoardStamp, zonedDateTime } from "@/lib/domain/timezone";
import { fareFamilyLabel, travelClassLabel } from "@/lib/domain/fare-family";
import { serviceTypeLabel } from "@/lib/domain/service-type";
import { isCheckStale } from "@/lib/domain/relative-time";
import { RelativeTime } from "@/components/relative-time";
import { extensionWindow } from "@/lib/domain/monitoring";
import { shouldHandleBoardKey } from "@/lib/domain/board-keys";
import { copyText } from "@/lib/clipboard";
import { BoardRow } from "./board/BoardRow";
import { HelpSheet } from "./board/HelpSheet";
import { CommandPalette, type Command } from "./board/CommandPalette";
import { FareHistory } from "./board/FareHistory";
import { BoardEmpty } from "./board/BoardEmpty";
import { emptyBoardState } from "@/lib/domain/board-empty";
import type { Observation } from "@/lib/domain/fare-history";
import type { CorridorStats } from "@/lib/domain/corridor-stats";
import { commandToast } from "@/lib/domain/command-palette";
import { ShareSheet } from "./board/ShareSheet";
import { WatchSettingsForm } from "./board/WatchSettingsForm";
import { ConnectionChip } from "./board/ConnectionChip";
import { Handoff } from "./board/Handoff";
import { Legs } from "./board/Legs";
import { PriceLadder } from "./board/PriceLadder";
import {
  boardReducer,
  clockFiltersActive,
  filtersActive,
  focusAfterMove,
  initialBoardState,
} from "@/lib/domain/board-state";
import {
  BOARD_STATE_PARAM,
  boardStateUrl,
  decodeBoardState,
  hasBoardState,
  unmatchedKeys,
  withBoardLink,
} from "@/lib/domain/board-url";
import {
  boardCsv,
  candidateKey,
  centsPerHour,
  filterBoard,
  isAcela,
  savingsPercent,
  sortBoard,
  type BoardSort,
  type ServiceFilter,
  type TimeBucket,
} from "@/lib/domain/board-tools";
import {
  cheaperCount,
  cheapestByBucket,
  fastestCheaper,
  isOvernight,
  sparklineValues,
} from "@/lib/domain/board-insights";
import { BookingLinkResolver } from "@/lib/booking/booking-link-resolver";
import type { RankedCandidate } from "@/lib/domain/types";
import type { BookingPriceEvent, DateSnapshotRecord, WatchRecord } from "@/lib/db/models";
import { SearchingOverlay } from "@/components/searching-overlay";
import { SavingsMeter } from "@/components/savings-meter";
import { BackLink } from "@/components/page-frame";
import { Sparkline } from "@/components/sparkline";
import { Flap } from "@/components/flap";
import { stationLabel } from "@/lib/stations/catalog";
import { returnTravelDate } from "@/lib/domain/watch-query";
import {
  calendarIcs,
  candidateIsSame,
  closestToPreferred,
  decisionBrief,
  findBookedCandidate,
  formatDurationDelta,
  durationDeltaMinutes,
  sameDayCheapest,
  friendText,
  trainLabel,
  windowInsight,
} from "@/lib/domain/board-decision";
import {
  decisionPicks,
  optionAnchor,
  perPersonCents,
  withPinnedVisible,
  cheapestDirect,
  acelaContrast,
  beatsBooked,
  trainsThatBeat,
  beatNote,
  compareFocus,
  compareLine,
  pairNote,
  feeCeilingNote,
  windowStrip,
  switchVerdict,
} from "@/lib/domain/board-picks";
import {
  cheaperOptionsText,
  feeNote,
  itineraryText,
  matchesTrainQuery,
  missedBestNote,
  neighborDepartures,
  netAfterFee,
  priceLadder,
  sameTrainAcrossDates,
  scanTone,
  applyArriveBuffer,
  decisionPacket,
  lastDeparture,
  earliestDeparture,
  nextMatchingKey,
  amtrakFieldsText,
  arrivalDateNote,
  hasDeparted,
  minutesUntilDepart,
} from "@/lib/domain/board-act";
import {
  hassleNote,
  monitorRemaining,
  moveLabel,
  travelUrgency,
  changeRuleNote,
  type BoardMove,
} from "@/lib/domain/board-moves";
import type { FareFamily } from "@/lib/domain/types";

/** Keeps the smooth-scroll out of the reducer, which owns state only. */
function scrollToOption(key: string | null) {
  if (!key) return;
  document.getElementById(`opt-${key}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
}

export function WatchDetail({
  watch,
  ranked,
  dates,
  byDate,
  snapshots,
  events,
  cycleStatus,
  datesFailed,
  today,
  moves,
  alerts,
  scanCount,
  corridor,
  observations,
  scans,
  fareSourceLabel = "live board",
}: {
  watch: WatchRecord;
  ranked: RankedCandidate[];
  dates: string[];
  byDate: Array<[string, RankedCandidate]>;
  snapshots: DateSnapshotRecord[];
  events: BookingPriceEvent[];
  cycleStatus: string | null;
  datesFailed: string[];
  today: string;
  moves: BoardMove[];
  alerts: Array<{ id: string; subject: string; createdAt: string }>;
  scanCount: number;
  /** What this route costs across every watch. Null below the evidence floor. */
  corridor: CorridorStats | null;
  /** One entry per completed check: what the board saw, and when. */
  observations: Observation[];
  fareSourceLabel?: string;
  scans: Array<{ id: string; status: string; at: string }>;
}) {
  const router = useRouter();
  // One reducer for how the board is being looked at: filters, sort, pins,
  // hidden rows, the compare pair, zen and focus. Each transition is written
  // once and tested in tests/unit/board-state.test.ts; before this they were
  // eighteen useState calls whose keyboard and click paths had drifted apart.
  const [view, dispatch] = useReducer(boardReducer, initialBoardState);
  const {
    showAll,
    dateFilter,
    service,
    bucket,
    savingsOnly,
    sort,
    picked,
    pins,
    pinnedOnly,
    trainQuery,
    departAfter,
    arriveBefore,
    durationCap,
    arriveBuffer,
    zen,
    hiddenKeys,
    hideDeparted,
    focusKey,
  } = view;
  const [stayDays, setStayDays] = useState(2);
  const [boardNow, setBoardNow] = useState<{
    minutes: number;
    label: string;
  } | null>(null);
  const [feeDollars, setFeeDollars] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [rebookPrice, setRebookPrice] = useState("");
  const [rebookTrain, setRebookTrain] = useState("");
  const [rebookFamily, setRebookFamily] = useState<FareFamily | "">(watch.bookedFareFamily);
  const [shareOpen, setShareOpen] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rebookOpen, setRebookOpen] = useState(false);
  const [liveMoreOpen, setLiveMoreOpen] = useState(false);
  /**
   * Whether the pinned dock is showing all of itself. Phone widths only.
   *
   * Measured at 390×844 on a scrolled board: the header was 59px, the sticky
   * trip rail 120px and the dock 519px — 698 of 844, so 16% of the screen was
   * not underneath something pinned, and taps aimed at chips in that band hit
   * the dock instead. Collapsed to its summary line the dock is about 50px, and
   * every control it holds is one tap away. Above 768px the toggle is not
   * rendered at all and this does nothing.
   */
  const [dockOpen, setDockOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  /** First click arms the delete; it disarms itself so it cannot sit armed. */
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** Set only when both clipboard routes failed, so the text can be shown. */
  const [manualCopy, setManualCopy] = useState<{ text: string; message: string } | null>(null);
  /**
   * How many rows a shared link named that this board does not have.
   *
   * A row key is `journeyId:fareId`, and a journey id is the provider's trip id
   * — a later cycle can legitimately produce a different one for the same
   * train, and a fare can simply sell out. So a link is allowed to be partly
   * stale, and the board says which part rather than quietly showing something
   * other than what was shared.
   */
  const [staleFromLink, setStaleFromLink] = useState(0);
  const busyRef = useRef(false);
  const findRef = useRef<HTMLInputElement>(null);
  const rebookRef = useRef<HTMLInputElement>(null);
  const helpRef = useRef(false);
  const navRef = useRef<string[]>([]);
  const focusRef = useRef<string | null>(null);
  const rankedRef = useRef(ranked);
  const cheaperRef = useRef<string[]>([]);
  const beatsKeyRef = useRef<string[]>([]);
  const hiddenRef = useRef<string[]>([]);
  const stripRef = useRef("");
  /** Set once the link and storage have been read; guards every write back. */
  const hydrated = useRef(false);
  /** The last URL this component wrote, so the sync effect can skip no-ops. */
  const writtenUrl = useRef<string | null>(null);
  /** The view, for the copy handlers, which are stable and must not close over it. */
  const viewRef = useRef(view);
  const didFocus = useRef(false);
  const resolver = useMemo(() => new BookingLinkResolver(), []);
  const best = ranked[0];
  const dateMap = new Map(byDate);
  const pct = best
    ? savingsPercent(watch.currentBookedPriceCents, best.totalPartyPriceCents)
    : null;
  const stale = isCheckStale(watch.lastCheckedAt);
  const reverseHref = `/watches/new?origin=${watch.destinationCode}&destination=${watch.originCode}&date=${returnTravelDate(watch.desiredTravelDate, stayDays, today)}&price=${watch.currentBookedPriceCents / 100}`;
  const yours = useMemo(
    () => findBookedCandidate(ranked, watch.bookedTrainNumber, watch.desiredTravelDate),
    [ranked, watch.bookedTrainNumber, watch.desiredTravelDate],
  );
  const sameDay = useMemo(
    () => sameDayCheapest(ranked, watch.desiredTravelDate),
    [ranked, watch.desiredTravelDate],
  );
  const preferred = useMemo(() => closestToPreferred(ranked), [ranked]);
  const insight = useMemo(
    () => windowInsight(byDate, watch.desiredTravelDate),
    [byDate, watch.desiredTravelDate],
  );
  const brief = useMemo(
    () =>
      decisionBrief({
        originCode: watch.originCode,
        destinationCode: watch.destinationCode,
        desiredTravelDate: watch.desiredTravelDate,
        bookedCents: watch.currentBookedPriceCents,
        bookedTrainNumber: watch.bookedTrainNumber,
        best,
        yours,
        sameDay,
      }),
    [
      watch.originCode,
      watch.destinationCode,
      watch.desiredTravelDate,
      watch.currentBookedPriceCents,
      watch.bookedTrainNumber,
      best,
      yours,
      sameDay,
    ],
  );
  const buckets = useMemo(() => cheapestByBucket(ranked), [ranked]);
  const fastest = useMemo(() => fastestCheaper(ranked), [ranked]);
  const direct = useMemo(() => cheapestDirect(ranked), [ranked]);
  const contrast = useMemo(() => acelaContrast(ranked), [ranked]);
  const missed = missedBestNote(watch.bestPriceCents, best?.totalPartyPriceCents);
  const drops = cheaperCount(ranked);
  const daysLeft = dateOffsetDays(today, watch.desiredTravelDate);
  const urgency = travelUrgency(daysLeft);
  /* Day granularity, from the date the server resolved, not from a clock read
     during render — that is the hydration bug fixed in RelativeTime, and it
     would be the same bug here. Good enough for the wait-or-book call, whose
     only threshold is "inside a day". */
  const hoursToDeparture = Number.isFinite(daysLeft) ? Math.max(0, daysLeft) * 24 : null;
  const remaining = monitorRemaining(watch.monitorEndAt);
  const maxDuration = Math.max(
    1,
    ...ranked.map((candidate) => candidate.journey.durationMinutes ?? 0),
  );
  const hassle = best
    ? hassleNote({
        savingsCents: best.savingsCents,
        minimumSavingsCents: watch.minimumSavingsCents,
        daysUntil: daysLeft,
      })
    : null;
  const trend = sparklineValues(events, watch.currentBookedPriceCents);
  const eachBest = best ? perPersonCents(best.totalPartyPriceCents, watch.passengerCount) : null;
  const stamp = formatBoardStamp(watch.lastCheckedAt, watch.timezone);
  const share = useMemo(
    () =>
      friendText({
        originCode: watch.originCode,
        destinationCode: watch.destinationCode,
        desiredTravelDate: watch.desiredTravelDate,
        bookedCents: watch.currentBookedPriceCents,
        best: best ?? null,
      }),
    [
      watch.originCode,
      watch.destinationCode,
      watch.desiredTravelDate,
      watch.currentBookedPriceCents,
      best,
    ],
  );
  const picks = useMemo(
    () => decisionPicks({ best, fastest, preferred, yours, direct }),
    [best, fastest, preferred, yours, direct],
  );
  const feeCents = useMemo(() => {
    const value = Number(feeDollars);
    if (!Number.isFinite(value) || value <= 0) return 0;
    return Math.round(value * 100);
  }, [feeDollars]);
  const netBest = best ? netAfterFee(best.savingsCents, feeCents) : 0;
  const feeCopy = best ? feeNote(best.savingsCents, feeCents) : null;
  const verdict = useMemo(
    () => switchVerdict({ best: best ?? null, yours, feeCents }),
    [best, yours, feeCents],
  );
  const ceiling = feeCeilingNote(best?.savingsCents ?? 0);
  const strip = useMemo(
    () =>
      windowStrip({
        originCode: watch.originCode,
        destinationCode: watch.destinationCode,
        bookedCents: watch.currentBookedPriceCents,
        days: dates.map((date) => ({
          date,
          candidate: byDate.find(([day]) => day === date)?.[1] ?? null,
        })),
      }),
    [watch.originCode, watch.destinationCode, watch.currentBookedPriceCents, dates, byDate],
  );
  const beats = useMemo(() => trainsThatBeat(ranked, yours), [ranked, yours]);
  const packet = useMemo(() => decisionPacket({ brief, feeCopy, beats }), [brief, feeCopy, beats]);
  const sameTrain = useMemo(
    () => sameTrainAcrossDates(ranked, watch.bookedTrainNumber, dates),
    [ranked, watch.bookedTrainNumber, dates],
  );
  const neighbors = useMemo(
    () =>
      neighborDepartures(ranked, {
        travelDate: watch.desiredTravelDate,
        aroundIso: yours?.journey.departureAt ?? watch.bookedDepartureAt,
        preferredTime: watch.preferredDepartureTime,
        excludeId: yours?.journey.id ?? null,
      }),
    [ranked, watch.desiredTravelDate, yours, watch.bookedDepartureAt, watch.preferredDepartureTime],
  );
  const ladder = useMemo(
    () => priceLadder(ranked, watch.currentBookedPriceCents),
    [ranked, watch.currentBookedPriceCents],
  );
  const optionsCopy = useMemo(
    () =>
      cheaperOptionsText({
        originCode: watch.originCode,
        destinationCode: watch.destinationCode,
        desiredTravelDate: watch.desiredTravelDate,
        bookedCents: watch.currentBookedPriceCents,
        cheaper: ranked.filter((candidate) => candidate.savingsCents > 0),
      }),
    [
      watch.originCode,
      watch.destinationCode,
      watch.desiredTravelDate,
      watch.currentBookedPriceCents,
      ranked,
    ],
  );
  const filtersOn = filtersActive(view);
  const shareLabel =
    filtersOn || picked.length > 0 || view.focusIntent ? "Copy this view" : "Copy link";

  /* "Copy link" and "Copy this view" are different promises, and the board
     knows which one it can keep: the URL only describes a particular view once
     something has been narrowed or a pair has been selected. */

  const filteredSorted = useMemo(() => {
    const base = sortBoard(
      filterBoard(ranked, {
        dateFilter,
        service,
        bucket,
        savingsOnly,
        departAfter,
        arriveBefore:
          arriveBuffer && arriveBefore ? applyArriveBuffer(arriveBefore, 30) : arriveBefore,
        maxDuration: durationCap,
      }),
      sort,
    );
    const query = trainQuery.trim();
    return query ? base.filter((candidate) => matchesTrainQuery(candidate, query)) : base;
  }, [
    ranked,
    dateFilter,
    service,
    bucket,
    savingsOnly,
    sort,
    trainQuery,
    departAfter,
    arriveBefore,
    durationCap,
    arriveBuffer,
  ]);
  const schedulePool = hideDeparted
    ? filteredSorted.filter(
        (candidate) =>
          !hasDeparted(
            candidate.journey.searchedTravelDate,
            candidate.journey.departureAt,
            today,
            boardNow?.minutes ?? null,
          ),
      )
    : filteredSorted;
  const departedCount = ranked.filter((candidate) =>
    hasDeparted(
      candidate.journey.searchedTravelDate,
      candidate.journey.departureAt,
      today,
      boardNow?.minutes ?? null,
    ),
  ).length;
  const hideHero =
    Boolean(best) &&
    sort === "rank" &&
    dateFilter === "all" &&
    service === "all" &&
    bucket === "all" &&
    !savingsOnly &&
    !pinnedOnly &&
    !trainQuery.trim() &&
    !departAfter &&
    !arriveBefore &&
    durationCap == null &&
    !arriveBuffer &&
    !hideDeparted;
  const withoutHero =
    hideHero && best
      ? schedulePool.filter((candidate) => candidateKey(candidate) !== candidateKey(best))
      : schedulePool;
  const pool = pinnedOnly
    ? schedulePool.filter((candidate) => pins.includes(candidateKey(candidate)))
    : withoutHero;
  const keepKeys = [...pins];
  for (const candidate of [
    fastest,
    preferred,
    yours,
    direct,
    contrast?.acela ?? null,
    contrast?.regional ?? null,
    ...beats,
  ]) {
    if (candidate && (!best || candidateKey(candidate) !== candidateKey(best))) {
      keepKeys.push(candidateKey(candidate));
    }
  }
  const kept = withPinnedVisible(pool, showAll ? null : 5, keepKeys, candidateKey);
  const board = kept.filter((candidate) => !hiddenKeys.includes(candidateKey(candidate)));
  const compared = ranked.filter((candidate) => picked.includes(candidateKey(candidate)));
  const navKeys = (() => {
    const items: RankedCandidate[] = [];
    if (best && !hiddenKeys.includes(candidateKey(best))) items.push(best);
    for (const candidate of board) {
      if (!best || candidateKey(candidate) !== candidateKey(best)) items.push(candidate);
    }
    return items.map(candidateKey);
  })();
  const clockOn = clockFiltersActive(view);
  const fitPool = schedulePool.filter((candidate) => !hiddenKeys.includes(candidateKey(candidate)));
  const earliest = earliestDeparture(fitPool);
  const latest = lastDeparture(fitPool);
  const active = useMemo(() => {
    if (focusKey) {
      const match = ranked.find((item) => candidateKey(item) === focusKey);
      if (match) return match;
    }
    return best ?? null;
  }, [focusKey, ranked, best]);
  const compare = active ? compareFocus(active, watch.currentBookedPriceCents, yours) : null;
  /** What the collapsed dock says. The comparison, in one line. */
  const dockSummary = (() => {
    const paid = `You paid ${formatUsdCompact(watch.currentBookedPriceCents)}`;
    if (!best) return `${paid} · nothing cheaper listed`;
    const shown = active ?? best;
    const label = active ? "this train" : "cheapest";
    const save = shown.savingsCents > 0 ? ` · save ${formatUsdCompact(shown.savingsCents)}` : "";
    return `${paid} · ${label} ${formatUsdCompact(shown.totalPartyPriceCents)}${save}`;
  })();
  const untilActive =
    active && boardNow
      ? minutesUntilDepart(
          active.journey.searchedTravelDate,
          active.journey.departureAt,
          today,
          boardNow.minutes,
        )
      : null;
  const activeArrive = active
    ? arrivalDateNote(active.journey.departureAt, active.journey.arrivalAt)
    : null;

  async function action(
    path: string,
    method = "POST",
    body?: unknown,
    scan = false,
  ): Promise<boolean> {
    setActionError(null);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setScanning(scan);
    setElapsed(0);
    const timer = scan ? setInterval(() => setElapsed((seconds) => seconds + 1), 1000) : null;
    try {
      const response = await fetch(path, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? `Request failed: ${response.status}`);
      }
      if (scan) {
        const payload = (await response.json().catch(() => null)) as {
          cycle?: { status?: string };
          rankedCount?: number;
        } | null;
        const status = payload?.cycle?.status;
        if (status === "PROVIDER_ERROR") {
          setActionError("Live fares are unavailable right now. Recheck in a minute.");
        } else if (status === "PARTIAL_SUCCESS") {
          setNotice("Board partially refreshed: some dates missed");
          window.setTimeout(() => setNotice(null), 2200);
        } else {
          const count = payload?.rankedCount;
          setNotice(
            typeof count === "number"
              ? `Board refreshed · ${count} option${count === 1 ? "" : "s"}`
              : "Board refreshed",
          );
          window.setTimeout(() => setNotice(null), 1800);
        }
      }
      router.refresh();
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setNotice("Scan dismissed: board may still refresh in the background");
        window.setTimeout(() => setNotice(null), 2200);
        return false;
      }
      setActionError(error instanceof Error ? error.message : "Action failed");
      return false;
    } finally {
      if (timer) clearInterval(timer);
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
      setScanning(false);
      setElapsed(0);
    }
  }

  function cancelScan() {
    abortRef.current?.abort();
    setScanning(false);
    setBusy(false);
    setElapsed(0);
  }

  function extendMonitoring(preset: "24h" | "48h" | "72h") {
    void action(`/api/watches/${watch.id}`, "PATCH", {
      status: "ACTIVE",
      monitorPreset: preset,
      ...extensionWindow(preset),
    });
  }

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    helpRef.current = helpOpen;
  }, [helpOpen]);

  useEffect(() => {
    if (!shareOpen) return;
    function onDoc(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("#share-sheet")) return;
      if (target.closest('[aria-controls="share-sheet"]')) return;
      setShareOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [shareOpen]);

  useEffect(() => {
    if (!helpOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    document.getElementById("help-close")?.focus();
    return () => {
      previous?.focus();
    };
  }, [helpOpen]);

  useEffect(() => {
    navRef.current = navKeys;
  }, [navKeys]);

  useEffect(() => {
    focusRef.current = focusKey;
  }, [focusKey]);

  useEffect(() => {
    rankedRef.current = ranked;
    cheaperRef.current = ranked.filter((candidate) => candidate.savingsCents > 0).map(candidateKey);
  }, [ranked]);

  useEffect(() => {
    beatsKeyRef.current = beats.map(candidateKey);
  }, [beats]);

  useEffect(() => {
    hiddenRef.current = hiddenKeys;
  }, [hiddenKeys]);

  useEffect(() => {
    stripRef.current = strip;
  }, [strip]);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    didFocus.current = false;
  }, [watch.id]);

  useEffect(() => {
    if (didFocus.current) return;
    const start = yours ?? best ?? ranked[0];
    if (!start) return;
    didFocus.current = true;
    // AUTO_FOCUS, not SET_FOCUS: the board is choosing a starting row so the
    // keyboard has somewhere to begin. Nobody picked it, so it stays out of the
    // shareable URL — otherwise every first visit rewrote its own address bar.
    dispatch({ type: "AUTO_FOCUS", key: candidateKey(start) });
  }, [yours, best, ranked]);

  /* Where the view comes from on arrival.
   *
   * A link wins, because someone who was sent one asked for that view and not
   * for whatever this browser was last looking at. Storage is the fallback, and
   * it still owns pins specifically: an untouched link restores the pins from
   * the last visit, which is the one piece of board state a person expects to
   * persist without being asked.
   *
   * One dispatch rather than fourteen: replaying the setters would mean
   * fourteen renders and, through the sync effect below, fourteen history
   * writes on first paint.
   *
   * Read here and not in useReducer's initializer: the server renders this too,
   * where there is no location and no storage, and seeding from them there
   * would hydrate a different tree than it sent. */
  useEffect(() => {
    let stored: string[] = [];
    try {
      const raw = window.localStorage.getItem(`raildrop.pins.${watch.id}`);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
          stored = parsed;
        }
      }
    } catch {
      stored = [];
    }

    const raw = new URLSearchParams(window.location.search).get(BOARD_STATE_PARAM);
    const linked = decodeBoardState(raw);
    const next = hasBoardState(raw)
      ? { ...linked, pins: linked.pins.length > 0 ? linked.pins : stored }
      : { ...initialBoardState, pins: stored };

    dispatch({ type: "HYDRATE", state: next });
    if (hasBoardState(raw)) {
      // `ranked` on mount, deliberately: the question is what this link asked
      // for against the board it opened on, not against every later cycle.
      const missing = unmatchedKeys(next, ranked.map(candidateKey));
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the link is a client-only source; there is nothing to read during render
      if (missing.length > 0) setStaleFromLink(missing.length);
    }
    writtenUrl.current = window.location.href;
    hydrated.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per watch; `ranked` is read as of mount by design
  }, [watch.id]);

  /* The URL follows the board.
   *
   * replaceState, not pushState: a person who has adjusted six filters wants
   * Back to leave the page, not to walk them out one filter at a time.
   *
   * Coalesced on a frame rather than written per dispatch, because J and K move
   * focus — holding one down would otherwise write a hundred entries a second,
   * and Safari throttles replaceState hard enough to throw. */
  useEffect(() => {
    if (!hydrated.current) return;
    const handle = window.setTimeout(() => {
      const next = boardStateUrl(window.location.href, view);
      if (next === window.location.href) return;
      try {
        window.history.replaceState(window.history.state, "", next);
        writtenUrl.current = next;
      } catch {
        // Throttled, or a context that forbids it. The board is unaffected;
        // only the shareable link goes stale, and copyView rebuilds it anyway.
      }
    }, 120);
    return () => window.clearTimeout(handle);
  }, [view]);

  // The reducer is pure, so writing pins is an effect of the state changing
  // rather than something each of the three pin call sites does for itself.
  // Guarded on the read above: without it the first render would persist an
  // empty list over whatever was stored.
  useEffect(() => {
    if (!hydrated.current) return;
    try {
      window.localStorage.setItem(`raildrop.pins.${watch.id}`, JSON.stringify(pins));
    } catch {
      // private mode / quota
    }
  }, [pins, watch.id]);

  useEffect(() => {
    let next = "";
    try {
      const raw = window.localStorage.getItem(`raildrop.fee.${watch.id}`);
      if (raw) {
        const cents = Number(raw);
        if (Number.isFinite(cents) && cents > 0) next = String(cents / 100);
      }
    } catch {
      next = "";
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fee is local-only; never write storage before read
    setFeeDollars(next);
  }, [watch.id]);

  useEffect(() => {
    function tick() {
      const zoned = zonedDateTime(new Date(), watch.timezone);
      const stamp = `${zoned.isoDate}T${String(zoned.hour).padStart(2, "0")}:${String(zoned.minute).padStart(2, "0")}:00`;
      setBoardNow({
        minutes: zoned.hour * 60 + zoned.minute,
        label: formatClock(stamp),
      });
    }
    tick();
    const timer = window.setInterval(tick, 30_000);
    return () => window.clearInterval(timer);
  }, [watch.timezone]);

  /* One copy path for the whole board.
   *
   * Every one of these used to be an unawaited navigator.clipboard.writeText
   * followed by a success toast that fired whether or not the text arrived.
   * copyText tries the Clipboard API, falls back to a selection copy, and says
   * when neither worked — and then the reader gets the text on screen to copy
   * by hand rather than a toast claiming something that did not happen. */
  /* The link to the board exactly as it looks right now.
   *
   * Rebuilt at the moment of copying rather than read off location.href: the
   * sync effect above coalesces on a timer, so someone who filters and
   * immediately presses T would otherwise copy the previous view. Read from a
   * ref because every copy handler is a stable callback by design — inline
   * arrows here were rebuilt for each of sixty rows and defeated the row memo. */
  const viewUrl = useCallback(() => {
    if (typeof window === "undefined") return null;
    return boardStateUrl(window.location.href, viewRef.current);
  }, []);

  /** The same link, opened on one row. "You vs this" is about that row. */
  const rowUrl = useCallback((candidate: RankedCandidate) => {
    if (typeof window === "undefined") return null;
    return boardStateUrl(window.location.href, {
      ...viewRef.current,
      focusKey: candidateKey(candidate),
      focusIntent: true,
    });
  }, []);

  /** One toast, one timeout. This was written out nine times. */
  const flash = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 1600);
  }, []);

  const copy = useCallback(
    async (text: string, message: string) => {
      const outcome = await copyText(text);
      if (outcome === "failed") {
        setManualCopy({ text, message });
        return;
      }
      flash(message);
    },
    [flash],
  );

  /* The board's actions as named functions.
   *
   * They used to live in the bodies of the keydown handler's nineteen `if`
   * blocks, which made them unreachable from anywhere else — so the command
   * palette would have had to be a second implementation of each one, free to
   * drift from the key that is supposed to do the same thing. Stable identities,
   * reading refs, for the reason the row callbacks are: the keydown listener is
   * registered once and must not close over a stale board. */

  const focusedCandidate = useCallback((): RankedCandidate | null => {
    const key = focusRef.current;
    return (
      rankedRef.current.find((item) => candidateKey(item) === key) ?? rankedRef.current[0] ?? null
    );
  }, []);

  const moveFocus = useCallback((direction: "next" | "previous") => {
    const keys = navRef.current;
    if (keys.length === 0) return;
    dispatch({ type: "MOVE_FOCUS", direction, keys });
    scrollToOption(focusAfterMove(keys, focusRef.current, direction));
  }, []);

  const pinFocused = useCallback(() => {
    const key = focusRef.current;
    if (!key) return flash("Focus a train with J, then P to pin");
    dispatch({ type: "TOGGLE_PIN", key });
    flash("Pin updated");
  }, [flash]);

  const hideFocused = useCallback(() => {
    const key = focusRef.current;
    if (!key) return flash("Focus a train with J, then H to skip it");
    const next = navRef.current.filter((item) => item !== key)[0] ?? null;
    dispatch({ type: "HIDE", key, nextFocus: next });
    if (next) scrollToOption(next);
    flash("Hidden this visit");
  }, [flash]);

  const undoLastHide = useCallback(() => {
    const stack = hiddenRef.current;
    const last = stack[stack.length - 1];
    if (!last) return flash("Nothing hidden to undo");
    dispatch({ type: "UNDO_HIDE" });
    scrollToOption(last);
    flash("Unhidden");
  }, [flash]);

  const jumpToBoard = useCallback(() => {
    document.getElementById("board")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const jumpToFirstBeat = useCallback(() => {
    const next = beatsKeyRef.current[0];
    if (!next) return flash("No train beats yours right now");
    dispatch({ type: "SET_FOCUS", key: next });
    scrollToOption(next);
  }, [flash]);

  const jumpToNextCheaper = useCallback(() => {
    const next = nextMatchingKey(navRef.current, focusRef.current, new Set(cheaperRef.current));
    if (!next) return flash("No cheaper listed train to jump to");
    dispatch({ type: "SET_FOCUS", key: next });
    scrollToOption(next);
  }, [flash]);

  const openFocusedBooking = useCallback(() => {
    const candidate = focusedCandidate();
    if (!candidate) return;
    const handoff = new BookingLinkResolver().resolve({
      journey: candidate.journey,
      fare: candidate.fare,
    });
    window.open(handoff.url, "_blank", "noopener,noreferrer");
  }, [focusedCandidate]);

  const openRebook = useCallback(() => {
    setRebookOpen(true);
    window.setTimeout(() => {
      document.getElementById("rebook")?.scrollIntoView({ behavior: "smooth", block: "center" });
      rebookRef.current?.focus();
    }, 80);
  }, []);

  const focusFind = useCallback(() => {
    findRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      /* Before the guard, deliberately: shouldHandleBoardKey declines every
         modifier combination, which is right for the single-key shortcuts and
         wrong for the one combination this page does own. Cmd/Ctrl+K is not a
         browser shortcut inside a document, and it is the convention people
         already try. It works from inside a text field too — that is the whole
         point of a palette. */
      if ((event.key === "k" || event.key === "K") && (event.metaKey || event.ctrlKey)) {
        if (event.altKey || event.shiftKey) return;
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      // Declines anything the browser, the OS, or an IME already owns. Without
      // it, Cmd+C both swallowed the copy and spent a provider credit on a
      // recheck, and Cmd+R / Cmd+P / Cmd+F were unusable on this page.
      if (!shouldHandleBoardKey(event)) return;
      // The palette owns the keyboard while it is open; its own handler runs on
      // the dialog. Without this, typing "copy" into it would also pin a row,
      // hide a row and open Amtrak.
      if (paletteOpen) return;
      if (
        (event.key === "c" || event.key === "C") &&
        watch.status === "ACTIVE" &&
        !busyRef.current
      ) {
        event.preventDefault();
        void action(`/api/watches/${watch.id}/check`, "POST", undefined, true);
      }
      if ((event.key === "t" || event.key === "T") && !busyRef.current) {
        event.preventDefault();
        void copy(withBoardLink(share, viewUrl()), "Text for a friend copied");
      }
      if (event.key === "/" && !busyRef.current) {
        event.preventDefault();
        focusFind();
      }
      if ((event.key === "r" || event.key === "R") && !busyRef.current) {
        event.preventDefault();
        openRebook();
      }
      if (event.key === "?" && !busyRef.current) {
        event.preventDefault();
        setHelpOpen((value) => !value);
      }
      if ((event.key === "j" || event.key === "J") && !busyRef.current) {
        event.preventDefault();
        moveFocus("next");
      }
      if ((event.key === "k" || event.key === "K") && !busyRef.current) {
        event.preventDefault();
        moveFocus("previous");
      }
      if ((event.key === "i" || event.key === "I") && !busyRef.current) {
        event.preventDefault();
        const candidate = focusedCandidate();
        if (candidate) void copy(itineraryText(candidate), "Itinerary copied");
      }
      if ((event.key === "z" || event.key === "Z") && !busyRef.current) {
        event.preventDefault();
        dispatch({ type: "TOGGLE_ZEN" });
      }
      if ((event.key === "p" || event.key === "P") && !busyRef.current) {
        event.preventDefault();
        pinFocused();
      }
      if ((event.key === "h" || event.key === "H") && !busyRef.current) {
        event.preventDefault();
        hideFocused();
      }
      if ((event.key === "u" || event.key === "U") && !busyRef.current) {
        event.preventDefault();
        undoLastHide();
      }
      if ((event.key === "y" || event.key === "Y") && !busyRef.current) {
        event.preventDefault();
        const candidate = focusedCandidate();
        if (!candidate) return;
        void copy(
          withBoardLink(
            compareLine({
              originCode: watch.originCode,
              destinationCode: watch.destinationCode,
              desiredTravelDate: watch.desiredTravelDate,
              bookedCents: watch.currentBookedPriceCents,
              focused: candidate,
            }),
            rowUrl(candidate),
          ),
          "You vs this copied",
        );
      }
      if ((event.key === "w" || event.key === "W") && !busyRef.current) {
        event.preventDefault();
        void copy(withBoardLink(stripRef.current, viewUrl()), "Window copied");
      }
      if ((event.key === "g" || event.key === "G") && !busyRef.current) {
        event.preventDefault();
        jumpToBoard();
      }
      if ((event.key === "b" || event.key === "B") && !busyRef.current) {
        event.preventDefault();
        jumpToFirstBeat();
      }
      if ((event.key === "n" || event.key === "N") && !busyRef.current) {
        event.preventDefault();
        jumpToNextCheaper();
      }
      if ((event.key === "f" || event.key === "F") && !busyRef.current) {
        event.preventDefault();
        const candidate = focusedCandidate();
        if (candidate) void copy(amtrakFieldsText(candidate), "Amtrak fields copied");
      }
      if (event.key === "Enter" && !busyRef.current) {
        const tag = target?.tagName;
        if (tag === "BUTTON" || tag === "A" || target?.closest("a, button")) return;
        event.preventDefault();
        openFocusedBooking();
      }
      if (event.key === "Escape" && !busyRef.current) {
        if (helpRef.current) {
          setHelpOpen(false);
          return;
        }
        if (shareOpen) {
          setShareOpen(false);
          return;
        }
        dispatch({ type: "RESET_VIEW" });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- C reads latest action; busy is a ref
  }, [
    watch.id,
    watch.status,
    paletteOpen,
    share,
    shareOpen,
    watch.originCode,
    watch.destinationCode,
    watch.desiredTravelDate,
    watch.currentBookedPriceCents,
  ]);

  function persistFee(value: string) {
    setFeeDollars(value);
    try {
      const cents = Math.round(Number(value) * 100);
      if (!value.trim() || !Number.isFinite(cents) || cents <= 0) {
        window.localStorage.removeItem(`raildrop.fee.${watch.id}`);
        return;
      }
      window.localStorage.setItem(`raildrop.fee.${watch.id}`, String(cents));
    } catch {
      // private mode / quota
    }
  }

  function jumpTo(candidate: RankedCandidate) {
    const key = candidateKey(candidate);
    dispatch({ type: "SET_FOCUS", key });
    document.getElementById(optionAnchor(candidate))?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }

  function downloadCsv() {
    const blob = new Blob([boardCsv(filteredSorted)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `raildrop-${watch.originCode}-${watch.destinationCode}-${watch.desiredTravelDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  /* "Copy this view".
   *
   * The URL carries the filters, the sort, the pins, the hidden rows and the
   * compare pair, so the person who opens it sees the board that was described
   * to them rather than a fresh one they have to rebuild from the message. */
  async function copyShare() {
    await copy(
      viewUrl() ?? "",
      shareLabel === "Copy link" ? "Link copied" : "Link to this view copied",
    );
  }

  function downloadIcs(candidate: RankedCandidate) {
    const blob = new Blob([calendarIcs(candidate)], { type: "text/calendar" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `raildrop-${candidate.journey.originCode}-${candidate.journey.destinationCode}.ics`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function copyDecision() {
    await copy(withBoardLink(brief, viewUrl()), "Decision copied");
  }

  async function copyFriend() {
    await copy(withBoardLink(share, viewUrl()), "Text for a friend copied");
  }

  async function copyOptions() {
    await copy(withBoardLink(optionsCopy, viewUrl()), "Cheaper options copied");
  }

  function clearFilters() {
    // Deliberately CLEAR_FILTERS, not RESET_VIEW: the button leaves the
    // compare pair in place where Escape drops it. Pre-existing difference,
    // recorded in docs/AUDIT.md rather than silently unified here.
    dispatch({ type: "CLEAR_FILTERS" });
  }

  async function copyPacket() {
    await copy(withBoardLink(packet, viewUrl()), "Decision packet copied");
  }

  async function copyFields(candidate: RankedCandidate) {
    await copy(amtrakFieldsText(candidate), "Amtrak fields copied");
  }

  async function copyCompare(candidate: RankedCandidate) {
    await copy(
      withBoardLink(
        compareLine({
          originCode: watch.originCode,
          destinationCode: watch.destinationCode,
          desiredTravelDate: watch.desiredTravelDate,
          bookedCents: watch.currentBookedPriceCents,
          focused: candidate,
        }),
        rowUrl(candidate),
      ),
      "You vs this copied",
    );
  }

  async function copyWindow() {
    await copy(withBoardLink(strip, viewUrl()), "Window copied");
  }

  /* The four callbacks every board row gets.
   *
   * Stable identities, deliberately: they used to be inline arrows rebuilt for
   * each of up to 60 rows on every render, which made React.memo on the row
   * useless — the props always differed. Reading the volatile bits from refs
   * (the same refs the keyboard handler already uses) lets these close over
   * nothing that changes, so an empty dependency list is honest. */
  const handleTogglePick = useCallback((key: string) => {
    dispatch({ type: "TOGGLE_PICK", key });
  }, []);

  const handleTogglePin = useCallback((key: string) => {
    dispatch({ type: "TOGGLE_PIN", key });
  }, []);

  const handleFocusRow = useCallback((key: string) => {
    dispatch({ type: "SET_FOCUS", key });
  }, []);

  const hideTrain = useCallback((key: string) => {
    // Focus only moves if the hidden row was the focused one — the click path
    // has always differed from the H key here, which always moves focus.
    const focused = focusRef.current;
    const nextFocus =
      focused === key ? (navRef.current.filter((item) => item !== key)[0] ?? null) : focused;
    dispatch({ type: "HIDE", key, nextFocus });
    setNotice("Hidden this visit");
    window.setTimeout(() => setNotice(null), 1600);
  }, []);

  async function copyItinerary(candidate: RankedCandidate) {
    await copy(itineraryText(candidate), "Itinerary copied");
  }

  /* Why the board is empty, which is six different facts and used to be one
     sentence. Ordering matters and lives in the domain module. */
  const emptyState = emptyBoardState({
    scanning,
    // A date whose snapshot carries a plausibility summary is one we reached
    // and could not parse — different from one the provider never answered.
    unreadableDates: snapshots.filter(
      (snapshot) =>
        snapshot.status === "PROVIDER_ERROR" &&
        /plausibility check/i.test(snapshot.errorMessage ?? ""),
    ).length,
    failedDates: datesFailed.length,
    totalDates: Math.max(dates.length, snapshots.length),
    rankedCount: ranked.length,
    visibleCount: board.length,
    filtersActive: filtersOn,
    watchStatus:
      watch.status === "PAUSED" || watch.status === "COMPLETED" ? watch.status : "ACTIVE",
    daysUntilTravel: daysLeft,
    nextCheckLabel: watch.nextCheckAtLabel,
  });

  /* Every action the board has, in one list.
   *
   * The source of truth for the palette, and deliberately the same functions the
   * keys call rather than copies of them. `unavailable` is a sentence, not a
   * boolean: a command that cannot run right now says why instead of being
   * absent, because absent is indistinguishable from never existed.
   *
   * Each one flashes what it did and which key would have done it, so the
   * palette teaches its way out of being needed. */
  const commands: Command[] = useMemo(() => {
    const said = (spec: { shortcut?: string }, message: string) =>
      commandToast(spec as Parameters<typeof commandToast>[0], message);
    const focusFirst = "Nothing on the board to act on yet";
    const list: Command[] = [
      {
        id: "down",
        label: "Move down the board",
        group: "Navigate",
        shortcut: "J",
        keywords: "next row focus",
        run: () => moveFocus("next"),
      },
      {
        id: "up",
        label: "Move up the board",
        group: "Navigate",
        shortcut: "K",
        keywords: "previous row focus",
        run: () => moveFocus("previous"),
      },
      {
        id: "timetable",
        label: "Jump to the timetable",
        group: "Navigate",
        shortcut: "G",
        keywords: "board scroll",
        run: jumpToBoard,
      },
      {
        id: "beat",
        label: "Jump to the first train that beats yours",
        group: "Navigate",
        shortcut: "B",
        keywords: "better faster cheaper",
        unavailable: beats.length === 0 ? "nothing beats yours right now" : undefined,
        run: jumpToFirstBeat,
      },
      {
        id: "cheaper",
        label: "Jump to the next cheaper train",
        group: "Navigate",
        shortcut: "N",
        keywords: "save",
        unavailable: drops === 0 ? "nothing cheaper is listed" : undefined,
        run: jumpToNextCheaper,
      },
      {
        id: "find",
        label: "Find a train number",
        group: "Navigate",
        shortcut: "/",
        keywords: "search filter",
        run: focusFind,
      },
      {
        id: "book",
        label: "Open Book on Amtrak for the focused train",
        group: "Navigate",
        shortcut: "\u21B5",
        keywords: "enter reserve handoff",
        unavailable: ranked.length === 0 ? focusFirst : undefined,
        run: openFocusedBooking,
      },

      {
        id: "sort-price",
        label: "Sort by price",
        group: "Filter",
        keywords: "cheapest first",
        run: () => {
          dispatch({ type: "SET_SORT", sort: "price" });
          flash("Cheapest first");
        },
      },
      {
        id: "sort-depart",
        label: "Sort by departure",
        group: "Filter",
        keywords: "earliest time",
        run: () => {
          dispatch({ type: "SET_SORT", sort: "depart" });
          flash("Earliest first");
        },
      },
      {
        id: "sort-duration",
        label: "Sort by journey length",
        group: "Filter",
        keywords: "fastest shortest",
        run: () => {
          dispatch({ type: "SET_SORT", sort: "duration" });
          flash("Shortest first");
        },
      },
      {
        id: "sort-rank",
        label: "Sort by best match",
        group: "Filter",
        keywords: "default rank reset",
        run: () => {
          dispatch({ type: "SET_SORT", sort: "rank" });
          flash("Best match first");
        },
      },
      {
        id: "savings-only",
        label: savingsOnly ? "Show every train, not only cheaper ones" : "Show only cheaper trains",
        group: "Filter",
        keywords: "savings filter",
        run: () => {
          dispatch({ type: "TOGGLE_SAVINGS_ONLY" });
          flash(savingsOnly ? "Showing every train" : "Cheaper than yours only");
        },
      },
      {
        id: "show-all",
        label: showAll ? "Show the top five only" : "Show every option",
        group: "Filter",
        keywords: "expand collapse more",
        run: () => {
          dispatch({ type: "TOGGLE_SHOW_ALL" });
          flash(showAll ? "Top five" : "Every option");
        },
      },
      {
        id: "pin",
        label: "Pin or unpin the focused train",
        group: "Filter",
        shortcut: "P",
        keywords: "keep save",
        run: pinFocused,
      },
      {
        id: "pinned-only",
        label: pinnedOnly ? "Stop showing pinned only" : "Show pinned only",
        group: "Filter",
        keywords: "filter",
        unavailable: pins.length === 0 && !pinnedOnly ? "nothing is pinned" : undefined,
        run: () => {
          dispatch({ type: "TOGGLE_PINNED_ONLY" });
          flash(pinnedOnly ? "Showing everything" : "Pinned only");
        },
      },
      {
        id: "hide",
        label: "Hide the focused train for this visit",
        group: "Filter",
        shortcut: "H",
        keywords: "skip remove",
        run: hideFocused,
      },
      {
        id: "undo-hide",
        label: "Undo the last hide",
        group: "Filter",
        shortcut: "U",
        keywords: "restore back",
        unavailable: hiddenKeys.length === 0 ? "nothing is hidden" : undefined,
        run: undoLastHide,
      },
      {
        id: "zen",
        label: zen ? "Leave zen mode" : "Zen mode: ticket and board only",
        group: "Filter",
        shortcut: "Z",
        keywords: "focus quiet hide",
        run: () => {
          dispatch({ type: "TOGGLE_ZEN" });
          flash(zen ? "Zen off" : "Zen on");
        },
      },
      {
        id: "clear",
        label: "Clear the filters",
        group: "Filter",
        keywords: "reset escape",
        unavailable: filtersOn ? undefined : "no filters are on",
        run: () => {
          dispatch({ type: "CLEAR_FILTERS" });
          flash("Filters cleared");
        },
      },

      {
        id: "copy-view",
        label: shareLabel,
        group: "Copy",
        keywords: "share link url send",
        run: () => {
          void copyShare();
        },
      },
      {
        id: "copy-friend",
        label: "Copy a line for a friend",
        group: "Copy",
        shortcut: "T",
        keywords: "text message share",
        run: () => {
          void copy(
            withBoardLink(share, viewUrl()),
            said({ shortcut: "T" }, "Copied for a friend"),
          );
        },
      },
      {
        id: "copy-compare",
        label: "Copy you vs the focused train",
        group: "Copy",
        shortcut: "Y",
        keywords: "difference compare",
        unavailable: ranked.length === 0 ? focusFirst : undefined,
        run: () => {
          const candidate = focusedCandidate();
          if (candidate) void copyCompare(candidate);
        },
      },
      {
        id: "copy-window",
        label: "Copy the cheapest train on each day",
        group: "Copy",
        shortcut: "W",
        keywords: "window dates strip",
        run: () => {
          void copy(withBoardLink(strip, viewUrl()), said({ shortcut: "W" }, "Window copied"));
        },
      },
      {
        id: "copy-itinerary",
        label: "Copy the focused itinerary",
        group: "Copy",
        shortcut: "I",
        keywords: "details train",
        unavailable: ranked.length === 0 ? focusFirst : undefined,
        run: () => {
          const candidate = focusedCandidate();
          if (candidate)
            void copy(itineraryText(candidate), said({ shortcut: "I" }, "Itinerary copied"));
        },
      },
      {
        id: "copy-fields",
        label: "Copy Amtrak search fields",
        group: "Copy",
        shortcut: "F",
        keywords: "paste form",
        unavailable: ranked.length === 0 ? focusFirst : undefined,
        run: () => {
          const candidate = focusedCandidate();
          if (candidate)
            void copy(amtrakFieldsText(candidate), said({ shortcut: "F" }, "Amtrak fields copied"));
        },
      },
      {
        id: "copy-decision",
        label: "Copy the decision",
        group: "Copy",
        keywords: "brief summary verdict",
        run: () => {
          void copyDecision();
        },
      },
      {
        id: "copy-packet",
        label: "Copy the decision packet",
        group: "Copy",
        keywords: "everything long full",
        run: () => {
          void copyPacket();
        },
      },
      {
        id: "csv",
        label: "Download the board as CSV",
        group: "Copy",
        keywords: "export spreadsheet",
        unavailable: ranked.length === 0 ? "the board is empty" : undefined,
        run: downloadCsv,
      },
      {
        id: "print",
        label: "Print the board",
        group: "Copy",
        keywords: "paper pdf",
        run: () => window.print(),
      },

      {
        id: "recheck",
        label: "Check live fares now",
        group: "Trip",
        shortcut: "C",
        keywords: "refresh scan rescan",
        unavailable:
          watch.status !== "ACTIVE" ? `this watch is ${watch.status.toLowerCase()}` : undefined,
        run: () => {
          void action(`/api/watches/${watch.id}/check`, "POST", undefined, true);
        },
      },
      {
        id: "rebook",
        label: "I rebooked: update the benchmark",
        group: "Trip",
        shortcut: "R",
        keywords: "price paid changed",
        run: openRebook,
      },
      {
        id: "calendar",
        label: "Add the focused train to a calendar",
        group: "Trip",
        keywords: "ics event",
        unavailable: ranked.length === 0 ? focusFirst : undefined,
        run: () => {
          const candidate = focusedCandidate();
          if (candidate) downloadIcs(candidate);
        },
      },
      {
        id: "pause",
        label: watch.status === "PAUSED" ? "Resume watching this trip" : "Pause watching this trip",
        group: "Trip",
        keywords: "stop start alerts",
        unavailable: watch.status === "COMPLETED" ? "this watch is finished" : undefined,
        run: () => {
          void action(`/api/watches/${watch.id}`, "PATCH", {
            status: watch.status === "PAUSED" ? "ACTIVE" : "PAUSED",
          });
        },
      },
      {
        id: "settings",
        label: "Open the watch settings",
        group: "Trip",
        keywords: "edit change email flexibility",
        run: () => setSettingsOpen(true),
      },
      {
        id: "method",
        label: "How RailDrop gets these prices",
        group: "Help",
        keywords: "method sources coverage stations",
        run: () => router.push("/how-it-works"),
      },
      {
        id: "shortcuts",
        label: "Board shortcuts",
        group: "Help",
        shortcut: "?",
        keywords: "keys keyboard help",
        run: () => setHelpOpen(true),
      },
    ];
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the action fns are stable; the rest are the labels and availability this list reads
  }, [
    beats.length,
    drops,
    filtersOn,
    hiddenKeys.length,
    pins.length,
    pinnedOnly,
    ranked.length,
    savingsOnly,
    shareLabel,
    share,
    showAll,
    strip,
    watch.id,
    watch.status,
    zen,
  ]);

  return (
    <main id="main" className={`mx-auto max-w-6xl px-4 py-8${zen ? " is-zen" : ""}`}>
      {scanning ? (
        <SearchingOverlay
          origin={watch.originCode}
          destination={watch.destinationCode}
          date={watch.desiredTravelDate}
          elapsedSeconds={elapsed}
          flexibility={watch.dateFlexibilityDays}
          onCancel={cancelScan}
        />
      ) : null}
      {helpOpen ? <HelpSheet onClose={() => setHelpOpen(false)} /> : null}
      {paletteOpen ? (
        <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />
      ) : null}
      <BackLink>Your watches</BackLink>
      <h1 className="sr-only">
        {stationLabel(watch.originCode)} to {stationLabel(watch.destinationCode)}{" "}
        {formatDisplayDate(watch.desiredTravelDate)}
      </h1>
      <div className={`trip-rail no-print${zen ? " is-zen" : ""}`}>
        <Flap>{watch.originCode}</Flap>
        <span className="trip-rail-to">to</span>
        <Flap>{watch.destinationCode}</Flap>
        <span className="depart-strip-rule" aria-hidden />
        <Flap>{formatDisplayDate(watch.desiredTravelDate)}</Flap>
        {watch.dateFlexibilityDays ? (
          <span className="trip-rail-to">±{watch.dateFlexibilityDays}</span>
        ) : null}
        {boardNow ? (
          <span className="board-clock trip-rail-meta" aria-live="polite">
            <span className="trip-rail-to">Now</span>
            <Flap>{boardNow.label}</Flap>
          </span>
        ) : null}
        <span className="trip-rail-to trip-rail-meta">You paid</span>
        <span className="price serif trip-rail-meta">
          {formatUsdCompact(watch.currentBookedPriceCents)}
        </span>
        {best ? (
          <span className="price serif">{formatUsdCompact(best.totalPartyPriceCents)}</span>
        ) : null}
        <span className="trip-rail-call">{verdict.label}</span>
        {best && best.savingsCents > 0 ? (
          <span className="trip-rail-save">save {formatUsdCompact(best.savingsCents)}</span>
        ) : null}
        <div className="trip-rail-tools">
          <a href="#board">Board</a>
          <button type="button" onClick={() => dispatch({ type: "TOGGLE_ZEN" })}>
            {zen ? "Full" : "Zen"}
          </button>
          <button
            type="button"
            aria-expanded={shareOpen}
            aria-haspopup="true"
            aria-controls="share-sheet"
            onClick={() => setShareOpen((value) => !value)}
          >
            Share
          </button>
          {/* The palette, not the shortcut sheet, is the way in now: it lists
              every action with its key, so the sheet is one row inside it. */}
          <button
            type="button"
            className="trip-rail-shortcuts"
            onClick={() => setPaletteOpen(true)}
            aria-keyshortcuts="Meta+K Control+K"
          >
            Commands <kbd className="rail-kbd">⌘K</kbd>
          </button>
        </div>
      </div>
      {shareOpen ? (
        <ShareSheet
          onClose={() => setShareOpen(false)}
          copyFriend={copyFriend}
          copyWindow={copyWindow}
          copyPacket={copyPacket}
          copyShare={copyShare}
          shareLabel={shareLabel}
        />
      ) : null}
      <p className="mt-3 text-sm text-ink-soft">
        {stationLabel(watch.originCode)} → {stationLabel(watch.destinationCode)}
        {watch.bookedTrainNumber ? ` · ${watch.bookedTrainNumber}` : ""} ·{" "}
        {formatDaysUntil(watch.desiredTravelDate, today)}
        {drops ? ` · ${drops} cheaper` : ""} ·{" "}
        <RelativeTime at={watch.lastCheckedAt} fallback={stamp} />
      </p>
      {notice ? (
        <p className="board-toast no-print" role="status">
          {notice}
        </p>
      ) : null}
      {staleFromLink > 0 ? (
        /* A shared link named rows this board does not have. Saying so is the
           whole point: the alternative is a link that silently shows a
           different board than the one that was described. */
        <p className="board-note no-print" role="status">
          {staleFromLink === 1
            ? "One train from this link is not on the board any more — it sold out, or the fare was relisted."
            : `${staleFromLink} trains from this link are not on the board any more — they sold out, or the fares were relisted.`}{" "}
          Everything else in the link was applied.{" "}
          <button type="button" className="underline" onClick={() => setStaleFromLink(0)}>
            Dismiss
          </button>
        </p>
      ) : null}
      {manualCopy ? (
        /* Both clipboard routes refused. Rather than a toast claiming success,
           the text goes on screen where it can be selected by hand. */
        <div className="copy-fallback no-print" role="alertdialog" aria-label={manualCopy.message}>
          <p>
            This browser blocked the clipboard. Select the text below and copy it yourself — the
            board did not copy it for you.
          </p>
          <textarea
            readOnly
            rows={4}
            value={manualCopy.text}
            aria-label={manualCopy.message}
            onFocus={(event) => event.currentTarget.select()}
            ref={(node) => node?.select()}
          />
          <button type="button" className="underline" onClick={() => setManualCopy(null)}>
            Done
          </button>
        </div>
      ) : null}
      {urgency.level !== "watch" || remaining ? (
        <div
          className={`mt-3 text-sm ${urgency.level === "now" ? "urgency-now px-3 py-2" : ""} ${urgency.level === "soon" ? "urgency-soon px-3 py-2" : ""}`}
        >
          {urgency.level !== "watch" ? <p>{urgency.copy}</p> : null}
          {remaining ? (
            <>
              <p className="eyebrow mt-1">{remaining.label}</p>
              <div className="fuse mt-2" aria-hidden>
                <span style={{ width: `${remaining.percent}%` }} />
              </div>
              {watch.status === "ACTIVE" ? (
                <div className="mt-3 flex flex-wrap gap-2 no-print">
                  {(["24h", "48h", "72h"] as const).map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className="btn btn-ghost"
                      disabled={busy}
                      onClick={() => extendMonitoring(preset)}
                    >
                      +{preset}
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
      {stale ? (
        <p className="mt-3 text-sm text-drop">Board is stale: recheck for current listed fares.</p>
      ) : null}
      {cycleStatus === "PARTIAL_SUCCESS" ? (
        <p className="mt-3 text-sm text-drop">
          Best found: {best ? formatUsdCompact(best.totalPartyPriceCents) : "—"}.{" "}
          {datesFailed.map((date) => formatDisplayDate(date)).join(", ")} could not be refreshed.
        </p>
      ) : null}
      {cycleStatus === "PROVIDER_ERROR" ? (
        <p className="mt-3 text-sm text-danger">
          Live fares are unavailable right now. Recheck in a minute.
          {snapshots.find((snapshot) => snapshot.errorMessage)?.errorMessage
            ? ` (${snapshots.find((snapshot) => snapshot.errorMessage)?.errorMessage})`
            : null}
        </p>
      ) : null}
      {actionError ? (
        <p className="mt-3 text-sm text-danger" role="alert">
          {actionError}
        </p>
      ) : null}
      {watch.status === "COMPLETED" ? (
        <div className="panel mt-3 p-4 no-print">
          <p className="text-sm text-ink-soft">Monitoring ended.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(["24h", "48h", "72h"] as const).map((preset) => (
              <button
                key={preset}
                type="button"
                className="btn btn-ghost"
                disabled={busy}
                onClick={() => extendMonitoring(preset)}
              >
                Watch another {preset}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {missed ? <p className="mt-2 text-sm text-drop">{missed}</p> : null}
      <div className={`verdict mt-4 px-4 py-3 verdict-${verdict.kind}`}>
        <p className="serif text-2xl">{verdict.label}</p>
        {best && best.savingsCents > 0 ? (
          <p className="mt-1 text-save">
            Save up to {formatUsdCompact(best.savingsCents)}
            {pct != null ? ` · ${pct}%` : ""}
            {feeCents > 0
              ? netBest > 0
                ? ` · ${formatUsdCompact(netBest)} after fee`
                : " · fee may wipe listed savings"
              : ""}
          </p>
        ) : (
          <p className="mt-1 text-sm opacity-80">{verdict.copy}</p>
        )}
        {ceiling ? <p className="mt-1 text-sm text-save">{ceiling}</p> : null}
        <p className="mt-2 text-xs opacity-70">{changeRuleNote(watch.bookedFareFamily)}</p>
        {hassle ? <p className="mt-2 text-sm text-drop">{hassle}</p> : null}
        <div className="mt-3 no-print">
          <p className="eyebrow opacity-70">Estimated change fee</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {([0, 10, 20, 50] as const).map((dollars) => {
              const current = Number(feeDollars);
              const on = dollars === 0 ? !feeDollars.trim() : current === dollars;
              return (
                <button
                  key={dollars}
                  type="button"
                  className={`chip ${on ? "chip-on" : ""}`}
                  aria-pressed={on}
                  onClick={() => persistFee(dollars === 0 ? "" : String(dollars))}
                >
                  {dollars === 0 ? "No fee" : `$${dollars}`}
                </button>
              );
            })}
            <label className="sr-only" htmlFor="fee-estimate">
              Custom fee dollars
            </label>
            <input
              id="fee-estimate"
              value={feeDollars}
              onChange={(event) => persistFee(event.target.value)}
              inputMode="decimal"
              placeholder="$"
              className="field mt-0 max-w-[4.5rem]"
              aria-label="Estimated change fee dollars"
            />
          </div>
          {feeCopy ? <p className="mt-2 text-sm text-drop">{feeCopy}</p> : null}
          <p className="mt-1 text-[11px] opacity-60">Your estimate only · we never invent a fee</p>
        </div>
      </div>

      {moves.some((move) => move.kind === "drop") ? (
        <section className="moves-strip mt-4 no-print" aria-label="Price drops">
          <p className="eyebrow">What moved</p>
          <ul className="mt-2 space-y-1 text-sm">
            {moves
              .filter((move) => move.kind === "drop")
              .slice(0, 3)
              .map((move) => (
                <li key={move.key} className="move-drop">
                  {moveLabel(move)}
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {dates.map((date) => {
          const candidate = dateMap.get(date);
          const desired = date === watch.desiredTravelDate;
          const selected = dateFilter === date;
          const beatsDay = Boolean(candidate && yours && beatsBooked(candidate, yours));
          return (
            <button
              type="button"
              key={date}
              onClick={() => dispatch({ type: "SET_DATE", date: selected ? "all" : date })}
              className={`date-card px-3 py-3 text-left ${desired || selected ? "is-on" : ""}`}
            >
              <p className="eyebrow opacity-70">
                {formatDisplayDate(date)}
                {desired ? " · desired" : ""}
                {selected ? " · on" : ""}
              </p>
              <p className="mt-1 text-[10px] uppercase tracking-[0.14em] opacity-70">
                {dateBadge(dateOffsetDays(watch.desiredTravelDate, date))}
              </p>
              <p className="price serif text-2xl">
                {candidate ? (
                  <>
                    from <Flap>{formatUsdCompact(candidate.totalPartyPriceCents)}</Flap>
                  </>
                ) : (
                  "—"
                )}
              </p>
              {beatsDay ? <p className="mt-1 text-xs text-save">Beats your train</p> : null}
              {candidate && dateMap.get(watch.desiredTravelDate) && date !== watch.desiredTravelDate
                ? (() => {
                    const desiredPrice = dateMap.get(watch.desiredTravelDate)!.totalPartyPriceCents;
                    const save = desiredPrice - candidate.totalPartyPriceCents;
                    if (save > 0) {
                      return (
                        <p className="mt-1 text-xs text-save">{formatUsdCompact(save)} less</p>
                      );
                    }
                    if (save < 0) {
                      return (
                        <p className="mt-1 text-xs opacity-70">{formatUsdCompact(-save)} more</p>
                      );
                    }
                    return null;
                  })()
                : null}
            </button>
          );
        })}
      </section>
      {ranked.length > 0 ? (
        <p className="quiet-row">
          <button type="button" className="no-print" onClick={() => void copyWindow()}>
            Copy window
          </button>
        </p>
      ) : null}

      {ranked.length > 0 ? (
        <div className="analysis">
          <PriceLadder ladder={ladder} />
        </div>
      ) : null}

      {sameTrain.length > 0 ? (
        <section className="mt-4">
          <p className="eyebrow">Train {watch.bookedTrainNumber} across your window</p>
          <div className="same-train mt-2">
            {sameTrain.map(({ date, candidate }) => {
              const desired = date === watch.desiredTravelDate;
              return (
                <button
                  type="button"
                  key={date}
                  className={`date-card same-train-cell px-3 py-3 ${desired ? "is-on" : ""}`}
                  onClick={() => {
                    if (candidate) jumpTo(candidate);
                    else dispatch({ type: "SET_DATE", date });
                  }}
                >
                  <p className="eyebrow opacity-70">
                    {formatDisplayDate(date)}
                    {desired ? " · yours" : ""}
                  </p>
                  <p className="price serif mt-1 text-2xl">
                    {candidate ? formatUsdCompact(candidate.totalPartyPriceCents) : "—"}
                  </p>
                  {candidate ? (
                    <p className="mt-1 text-xs opacity-70">
                      <Flap>{formatClock(candidate.journey.departureAt)}</Flap>
                    </p>
                  ) : (
                    <p className="mt-1 text-xs opacity-70">Not listed</p>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {ranked.length > 0 ? (
        <section className="mt-4 grid grid-cols-3 gap-2">
          {(
            [
              ["Morning", "morning", buckets.morning],
              ["Afternoon", "afternoon", buckets.afternoon],
              ["Evening", "evening", buckets.evening],
            ] as const
          ).map(([label, key, candidate]) => (
            <button
              key={label}
              type="button"
              className={`date-card px-3 py-2 text-left ${bucket === key ? "is-on" : ""}`}
              onClick={() => dispatch({ type: "TOGGLE_BUCKET", bucket: key })}
            >
              <p className="eyebrow opacity-70">{label}</p>
              <p className="price serif text-lg">
                {candidate ? <Flap>{formatUsdCompact(candidate.totalPartyPriceCents)}</Flap> : "—"}
              </p>
            </button>
          ))}
        </section>
      ) : null}
      {insight ? <p className="analysis mt-2 text-xs text-ink-soft">{insight}</p> : null}
      {fastest && best && candidateKey(fastest) !== candidateKey(best) ? (
        <p className="analysis mt-2 text-xs text-ink-soft">
          Fastest cheaper · {trainLabel(fastest)} ·{" "}
          {formatDurationMinutes(fastest.journey.durationMinutes)} ·{" "}
          {formatUsdCompact(fastest.totalPartyPriceCents)}
        </p>
      ) : null}

      {picks.length > 0 ? (
        <section className="mt-5">
          <p className="eyebrow">Decision picks</p>
          <div className="pick-grid mt-2">
            {picks.map((pick) => (
              <button
                key={pick.kind}
                type="button"
                className="date-card pick-card px-3 py-3"
                onClick={() => jumpTo(pick.candidate)}
              >
                <p className="eyebrow opacity-70">{pick.label}</p>
                <p className="price serif mt-1 text-2xl">
                  {formatUsdCompact(pick.candidate.totalPartyPriceCents)}
                </p>
                <p className="mt-1 text-sm">{trainLabel(pick.candidate)}</p>
                <p className="text-xs opacity-70">
                  {formatClock(pick.candidate.journey.departureAt)} →{" "}
                  {formatClock(pick.candidate.journey.arrivalAt)}
                </p>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {neighbors.length > 0 ? (
        <section className="mt-4 panel p-4">
          <p className="eyebrow">Nearby departures</p>
          <ul className="mt-3 space-y-2">
            {neighbors.slice(0, 4).map((candidate) => (
              <li key={candidateKey(candidate)}>
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => jumpTo(candidate)}
                >
                  <span className="price serif text-xl">
                    {formatUsdCompact(candidate.totalPartyPriceCents)}
                  </span>
                  <span className="ml-2 text-sm">
                    {trainLabel(candidate)} · {formatClock(candidate.journey.departureAt)}
                  </span>
                  {candidate.savingsCents > 0 ? (
                    <span className="ml-2 text-sm text-save">
                      save {formatUsdCompact(candidate.savingsCents)}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {contrast ? (
        <section className="analysis panel mt-4 p-4 text-sm">
          <p className="eyebrow">Acela vs Regional</p>
          <p className="mt-2">
            {trainLabel(contrast.acela)} is {formatUsdCompact(Math.abs(contrast.extraCents))}
            {contrast.extraCents >= 0 ? " more" : " less"}
            {contrast.fasterMinutes != null && contrast.fasterMinutes > 0
              ? ` and ${formatDurationMinutes(contrast.fasterMinutes)} faster`
              : contrast.fasterMinutes != null && contrast.fasterMinutes < 0
                ? ` and ${formatDurationMinutes(-contrast.fasterMinutes)} longer`
                : ""}{" "}
            than {trainLabel(contrast.regional)}.
          </p>
          <div className="quiet-row">
            <button type="button" onClick={() => jumpTo(contrast.regional)}>
              Regional {formatUsdCompact(contrast.regional.totalPartyPriceCents)}
            </button>
            <button type="button" onClick={() => jumpTo(contrast.acela)}>
              Acela {formatUsdCompact(contrast.acela.totalPartyPriceCents)}
            </button>
          </div>
        </section>
      ) : null}

      {best ? (
        <section
          className={`ticket mt-8 p-5 md:p-8 ticket-hero ${focusKey === candidateKey(best) ? "board-row-focus" : ""}`}
          data-hero-opt={candidateKey(best)}
        >
          <p className="eyebrow">Cheapest in your window</p>
          <p className="price serif mt-2 text-6xl md:text-7xl">
            <Flap className="flap-hero">{formatUsdCompact(best.totalPartyPriceCents)}</Flap>
          </p>
          {eachBest ? (
            <p className="mt-1 text-sm text-ink-soft">{formatUsdCompact(eachBest)} / person</p>
          ) : null}
          {best.savingsCents > 0 ? (
            <p className="mt-1 text-lg text-save">
              SAVE {formatUsdCompact(best.savingsCents)}
              {pct != null ? ` · ${pct}%` : ""}
              {feeCents > 0 && netBest > 0 ? ` · ${formatUsdCompact(netBest)} after fee` : ""}
            </p>
          ) : null}
          <SavingsMeter
            bookedCents={watch.currentBookedPriceCents}
            foundCents={best.totalPartyPriceCents}
          />
          <p className="mt-4 text-lg">{trainLabel(best)}</p>
          <div className="clock-pair mt-3">
            <div>
              <p className="eyebrow">Depart</p>
              <p className="price serif text-4xl">
                <Flap>{formatClock(best.journey.departureAt)}</Flap>
              </p>
            </div>
            <p className="text-ink-soft">→</p>
            <div>
              <p className="eyebrow">Arrive</p>
              <p className="price serif text-4xl">
                <Flap>{formatClock(best.journey.arrivalAt)}</Flap>
              </p>
            </div>
            {formatDurationMinutes(best.journey.durationMinutes) ? (
              <p className="text-sm text-ink-soft">
                {formatDisplayDate(best.journey.searchedTravelDate)} ·{" "}
                {formatDurationMinutes(best.journey.durationMinutes)}
              </p>
            ) : (
              <p className="text-sm text-ink-soft">
                {formatDisplayDate(best.journey.searchedTravelDate)}
              </p>
            )}
          </div>
          <p className="station-code mt-2 text-sm">
            {best.journey.originCode} → {best.journey.destinationCode}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="chip">{serviceTypeLabel(best.journey.serviceType)}</span>
            {best.journey.transferCount > 0 ? (
              <ConnectionChip candidate={best} />
            ) : (
              <span className="chip">Nonstop</span>
            )}
            {centsPerHour(best.totalPartyPriceCents, best.journey.durationMinutes) != null ? (
              <span className="chip">
                {formatUsdCompact(
                  centsPerHour(best.totalPartyPriceCents, best.journey.durationMinutes)!,
                )}
                /hr
              </span>
            ) : null}
            {isOvernight(best.journey.departureAt, best.journey.arrivalAt) ? (
              <span className="chip">Overnight</span>
            ) : null}
            {isAcela(best) ? <span className="chip">Acela</span> : null}
            {best.fare.availability === "LIMITED" ? (
              <span className="chip">Limited seats</span>
            ) : null}
            {yours && beatsBooked(best, yours) ? (
              <span className="chip chip-beats">Beats your train</span>
            ) : null}
            {yours && candidateIsSame(yours, best) ? (
              <span className="chip">Your train</span>
            ) : null}
            {preferred && candidateIsSame(preferred, best) ? (
              <span className="chip">Closest to preferred time</span>
            ) : null}
          </div>
          <Legs candidate={best} />
          <p className="mt-3">
            Listed {travelClassLabel(best.fare.travelClass)} fare
            {best.fare.fareFamilyRaw === "WANDERU_LISTED"
              ? " · confirm on Amtrak"
              : ` · ${fareFamilyLabel(best.fare.fareFamily)}`}
          </p>
          <p className="text-sm text-ink-soft">{dateBadge(best.dateOffsetDays)}</p>
          <div className="mt-5">
            <Handoff candidate={best} resolver={resolver} />
          </div>
          <div className="quiet-row no-print">
            <button
              type="button"
              onClick={() => {
                setRebookPrice(String(best.totalPartyPriceCents / 100));
                setRebookTrain(best.journey.trainNumber ?? "");
                setRebookOpen(true);
                window.setTimeout(() => {
                  document.getElementById("rebook")?.scrollIntoView({
                    behavior: "smooth",
                    block: "center",
                  });
                  rebookRef.current?.focus();
                }, 80);
              }}
            >
              Use this price in I rebooked
            </button>
            <button type="button" onClick={() => downloadIcs(best)}>
              Add to calendar
            </button>
            <button type="button" onClick={() => void copyItinerary(best)}>
              Copy itinerary
            </button>
            <button type="button" onClick={() => void copyFields(best)}>
              Copy Amtrak fields
            </button>
            <button type="button" onClick={() => handleTogglePin(candidateKey(best))}>
              {pins.includes(candidateKey(best)) ? "Unpin" : "Pin this train"}
            </button>
          </div>
        </section>
      ) : (
        <section className="panel mt-8 p-6">
          <h2 className="serif text-2xl">No trains on the board yet.</h2>
          <p className="mt-2 text-sm text-ink-soft">
            Check now to search live inventory for this window.
          </p>
        </section>
      )}

      {/* Above the board, not behind "More analysis".
          "Should I switch now or wait" is the question the product exists to
          answer, and it was the one thing it never said. Hiding it one click
          down would be filing the answer under further reading.

          Was: a sparkline of booking_price_events — the traveler's own
          benchmark, which changes only when they press "I rebooked", so for
          almost every watch it was a single point under a heading that said
          "Price history". This is the fares we actually observed. */}
      <div className="mt-8 no-print">
        <FareHistory
          observations={observations}
          bookedCents={watch.currentBookedPriceCents}
          bestCents={best?.totalPartyPriceCents ?? null}
          changeFeeCents={feeCents}
          hoursToDeparture={hoursToDeparture}
          corridor={corridor}
          timezone={watch.timezone}
        />
      </div>

      <section id="board" className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="serif text-3xl">Board</h2>
            <p className="mt-1 text-xs text-ink-soft">
              {stamp ? `Board as of ${stamp}` : "Board not scanned yet"}
              {pins.length > 0 ? ` · ${pins.length} pinned` : ""}
            </p>
            {scans.length > 0 ? (
              <div className="scan-pulse mt-2" aria-label="Recent scans">
                {scans.map((scan) => (
                  <i
                    key={scan.id}
                    className={`tone-${scanTone(scan.status)}`}
                    // An absolute stamp, not a relative one: a title attribute
                    // that disagrees across hydration is a mismatch too, and a
                    // tooltip is the one place the exact time is wanted anyway.
                    title={`${scan.status} · ${formatBoardStamp(scan.at, watch.timezone) ?? scan.at}`}
                  />
                ))}
              </div>
            ) : null}
          </div>
          <div className="quiet-row no-print">
            <button type="button" onClick={downloadCsv}>
              Export CSV
            </button>
            <button type="button" onClick={() => void copyOptions()}>
              Copy cheaper options
            </button>
            <button type="button" onClick={() => window.print()}>
              Print board
            </button>
            <button type="button" onClick={() => void copyShare()}>
              {shareLabel}
            </button>
            {filtersOn ? (
              <button type="button" onClick={clearFilters}>
                Clear filters
              </button>
            ) : null}
            {dateFilter !== "all" ? (
              <button type="button" onClick={() => dispatch({ type: "SET_DATE", date: "all" })}>
                Show every date
              </button>
            ) : null}
            {withoutHero.length > 5 ? (
              <button type="button" onClick={() => dispatch({ type: "TOGGLE_SHOW_ALL" })}>
                {showAll ? "Show top 5" : "Show all options"}
              </button>
            ) : null}
          </div>
        </div>
        <div className="filter-stack mt-4 text-sm no-print">
          <div className="filter-block">
            <span className="filter-label">Train</span>
            {(
              [
                ["all", "All trains"],
                ["regional", "Regional"],
                ["acela", "Acela"],
                ["direct", "Direct only"],
              ] as Array<[ServiceFilter, string]>
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`chip ${service === value ? "chip-on" : ""}`}
                aria-pressed={service === value}
                onClick={() => dispatch({ type: "SET_SERVICE", service: value })}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              className={`chip ${savingsOnly ? "chip-save" : ""}`}
              aria-pressed={savingsOnly}
              onClick={() => dispatch({ type: "TOGGLE_SAVINGS_ONLY" })}
            >
              Savings only
            </button>
            {pins.length > 0 ? (
              <button
                type="button"
                className={`chip ${pinnedOnly ? "chip-on" : ""}`}
                aria-pressed={pinnedOnly}
                onClick={() => dispatch({ type: "TOGGLE_PINNED_ONLY" })}
              >
                Pinned
              </button>
            ) : null}
          </div>
          <div className="filter-block">
            <span className="filter-label">When</span>
            {(
              [
                ["all", "Any time"],
                ["morning", "Morning"],
                ["afternoon", "Afternoon"],
                ["evening", "Evening"],
              ] as Array<[TimeBucket | "all", string]>
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`chip ${bucket === value ? "chip-on" : ""}`}
                aria-pressed={bucket === value}
                onClick={() => dispatch({ type: "SET_BUCKET", bucket: value })}
              >
                {label}
              </button>
            ))}
            {watch.preferredDepartureTime ? (
              <button
                type="button"
                className={`chip ${departAfter === watch.preferredDepartureTime ? "chip-on" : ""}`}
                aria-pressed={departAfter === watch.preferredDepartureTime}
                onClick={() =>
                  dispatch({
                    type: "SET_DEPART_AFTER",
                    time:
                      departAfter === watch.preferredDepartureTime
                        ? ""
                        : (watch.preferredDepartureTime ?? ""),
                  })
                }
              >
                From preferred
              </button>
            ) : null}
            {earliest ? (
              <button type="button" className="chip" onClick={() => jumpTo(earliest)}>
                Earliest {formatClock(earliest.journey.departureAt)}
              </button>
            ) : null}
            {latest && (!earliest || candidateKey(latest) !== candidateKey(earliest)) ? (
              <button type="button" className="chip" onClick={() => jumpTo(latest)}>
                {clockOn ? "Last that fits" : "Last listed"}{" "}
                {formatClock(latest.journey.departureAt)}
              </button>
            ) : null}
            {departedCount > 0 ? (
              <button
                type="button"
                className={`chip ${hideDeparted ? "chip-on" : ""}`}
                onClick={() => dispatch({ type: "TOGGLE_HIDE_DEPARTED" })}
              >
                {hideDeparted ? "Show departed" : `Hide ${departedCount} departed`}
              </button>
            ) : null}
          </div>
          <div className="filter-block">
            <span className="filter-label">Fit</span>
            <label className="text-xs text-ink-soft">
              Leave after
              <input
                type="time"
                value={departAfter}
                onChange={(event) =>
                  dispatch({ type: "SET_DEPART_AFTER", time: event.target.value })
                }
                className="field mt-0 ml-2 w-auto py-1"
                aria-label="Leave after"
              />
            </label>
            <label className="text-xs text-ink-soft">
              Arrive by
              <input
                type="time"
                value={arriveBefore}
                onChange={(event) =>
                  dispatch({ type: "SET_ARRIVE_BEFORE", time: event.target.value })
                }
                className="field mt-0 ml-2 w-auto py-1"
                aria-label="Arrive by"
              />
            </label>
            {arriveBefore ? (
              <button
                type="button"
                className={`chip ${arriveBuffer ? "chip-on" : ""}`}
                onClick={() => dispatch({ type: "TOGGLE_ARRIVE_BUFFER" })}
              >
                +30m buffer
              </button>
            ) : null}
            {(
              [
                [null, "Any length"],
                [240, "≤ 4h"],
                [300, "≤ 5h"],
              ] as Array<[number | null, string]>
            ).map(([value, label]) => (
              <button
                key={label}
                type="button"
                className={`chip ${durationCap === value ? "chip-on" : ""}`}
                onClick={() => dispatch({ type: "SET_DURATION_CAP", minutes: value })}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="filter-block">
            <span className="filter-label">Find</span>
            <input
              ref={findRef}
              value={trainQuery}
              onChange={(event) => dispatch({ type: "SET_TRAIN_QUERY", query: event.target.value })}
              placeholder="Find train"
              aria-label="Find train"
              className="field mt-0 max-w-[9rem] py-1"
            />
            {hiddenKeys.length > 0 ? (
              <>
                <button
                  type="button"
                  className="chip chip-on"
                  onClick={() => dispatch({ type: "UNHIDE_ALL" })}
                >
                  Show {hiddenKeys.length} hidden
                </button>
                <button
                  type="button"
                  className="chip"
                  onClick={() => {
                    dispatch({ type: "UNDO_HIDE" });
                  }}
                >
                  Undo hide
                </button>
              </>
            ) : null}
            <label className="ml-auto text-xs text-ink-soft">
              Sort
              <select
                className="field mt-0 ml-2 w-auto py-1"
                value={sort}
                onChange={(event) =>
                  dispatch({ type: "SET_SORT", sort: event.target.value as BoardSort })
                }
              >
                <option value="rank">Best match</option>
                <option value="price">Price</option>
                <option value="depart">Departure</option>
                <option value="duration">Duration</option>
                <option value="savings">Savings</option>
              </select>
            </label>
          </div>
        </div>
        <div className="census mt-4" aria-label="Board counts">
          <span>
            <Flap>{String(board.length)}</Flap>
            <span>on board</span>
          </span>
          <span>
            <Flap>{String(board.filter((item) => item.savingsCents > 0).length)}</Flap>
            <span>cheaper</span>
          </span>
          {yours ? (
            <span>
              <Flap>{String(board.filter((item) => beatsBooked(item, yours)).length)}</Flap>
              <span>beat yours</span>
            </span>
          ) : null}
          {filtersOn ? (
            <span>
              <span className="text-xs opacity-70">
                {board.length} of {pinnedOnly ? pool.length : schedulePool.length}
                {hideHero && !pinnedOnly ? " besides cheapest" : ""}
                {clockOn ? ` · ${fitPool.length} fit` : ""}
                {hiddenKeys.length > 0 ? ` · ${hiddenKeys.length} hidden` : ""}
                {hideDeparted ? " · departed off" : ""}
              </span>
            </span>
          ) : null}
        </div>
        <div className="timetable mt-4">
          {board.length === 0 ? (
            <BoardEmpty
              state={emptyState}
              busy={busy}
              onClearFilters={clearFilters}
              onRecheck={() => {
                void action(`/api/watches/${watch.id}/check`, "POST", undefined, true);
              }}
              onResume={() => {
                void action(`/api/watches/${watch.id}`, "PATCH", { status: "ACTIVE" });
              }}
            />
          ) : (
            <>
              <div className="board-head" aria-hidden>
                <span className="board-cell-index">#</span>
                <span className="board-cell-depart">Depart</span>
                <span className="board-cell-arrive">Arrive</span>
                <span className="board-cell-train">Train</span>
                <span className="board-cell-dur">Dur</span>
                <span className="board-cell-price">Price</span>
                <span className="board-cell-save">Save</span>
                <span className="board-cell-actions">Book</span>
              </div>
              {board.map((candidate, index) => (
                <BoardRow
                  key={candidateKey(candidate)}
                  candidate={candidate}
                  index={index}
                  yours={yours}
                  preferred={preferred}
                  maxDuration={maxDuration}
                  rowKey={candidateKey(candidate)}
                  picked={picked.includes(candidateKey(candidate))}
                  pinned={pins.includes(candidateKey(candidate))}
                  passengers={watch.passengerCount}
                  feeCents={feeCents}
                  focused={focusKey === candidateKey(candidate)}
                  beats={yours ? beatsBooked(candidate, yours) : false}
                  departed={hasDeparted(
                    candidate.journey.searchedTravelDate,
                    candidate.journey.departureAt,
                    today,
                    boardNow?.minutes ?? null,
                  )}
                  resolver={resolver}
                  onTogglePick={handleTogglePick}
                  onTogglePin={handleTogglePin}
                  onHide={hideTrain}
                  onFocus={handleFocusRow}
                />
              ))}
            </>
          )}
        </div>
      </section>

      <div id="rebook" className="no-print mt-6 max-w-lg">
        <button
          type="button"
          className={`chip ${rebookOpen ? "chip-on" : ""}`}
          aria-expanded={rebookOpen}
          onClick={() => {
            setRebookOpen((value) => !value);
            if (!rebookOpen) {
              window.setTimeout(() => rebookRef.current?.focus(), 80);
            }
          }}
        >
          I rebooked
        </button>
        {rebookOpen ? (
          <form
            className="ticket mt-3 space-y-3 p-5"
            onSubmit={async (event) => {
              event.preventDefault();
              await action(`/api/watches/${watch.id}/rebook`, "POST", {
                newBookedPriceCents: Math.round(Number(rebookPrice) * 100),
                newTrainNumber: rebookTrain.trim() || null,
                newFareFamily: rebookFamily || null,
              });
              setRebookPrice("");
              setRebookTrain("");
            }}
          >
            <p className="eyebrow">After Amtrak</p>
            <h2 className="serif text-2xl">I rebooked</h2>
            <p className="text-sm text-ink-soft">Then type what you actually paid.</p>
            <input
              ref={rebookRef}
              required
              value={rebookPrice}
              onChange={(event) => setRebookPrice(event.target.value)}
              placeholder="New actual total paid"
              className="field mt-0"
              inputMode="decimal"
              aria-label="New actual total paid"
            />
            <input
              value={rebookTrain}
              onChange={(event) => setRebookTrain(event.target.value)}
              placeholder="New train number · optional"
              className="field mt-0"
            />
            <fieldset className="text-sm">
              <legend className="mb-2 text-xs text-ink-soft">Fare you bought · optional</legend>
              <div className="flex flex-wrap gap-2">
                {(["FLEXIBLE", "VALUE", "SAVER"] as const).map((family) => (
                  <button
                    key={family}
                    type="button"
                    className={`chip ${rebookFamily === family ? "chip-on" : ""}`}
                    onClick={() => setRebookFamily(family)}
                  >
                    {family === "FLEXIBLE" ? "Flexible" : family === "VALUE" ? "Value" : "Saver"}
                  </button>
                ))}
              </div>
              {rebookFamily ? (
                <p className="mt-2 text-xs text-ink-soft">{changeRuleNote(rebookFamily)}</p>
              ) : null}
            </fieldset>
            <button className="btn btn-primary" disabled={busy}>
              Update benchmark
            </button>
          </form>
        ) : null}
      </div>

      {beats.length > 0 && yours ? (
        <section className="beats mt-6 p-4">
          <p className="eyebrow">Beats your train</p>
          <ul className="mt-3 space-y-2">
            {beats.map((candidate) => (
              <li key={candidateKey(candidate)}>
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => jumpTo(candidate)}
                >
                  <span className="price serif text-xl">
                    {formatUsdCompact(candidate.totalPartyPriceCents)}
                  </span>
                  <span className="ml-2 text-sm">
                    {trainLabel(candidate)} · {formatClock(candidate.journey.departureAt)}
                  </span>
                  <span className="ml-2 text-sm text-save">{beatNote(candidate, yours)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {best ? (
        <section className="analysis panel mt-6 p-4 text-sm">
          <p className="eyebrow">Stay or switch</p>
          <details className="mt-2">
            <summary className="cursor-pointer text-ink-soft">{verdict.copy}</summary>
            <p className="mt-2 leading-relaxed text-ink-soft">{brief}</p>
          </details>
          {hassle ? <p className="mt-2 text-sm text-drop">{hassle}</p> : null}
          <p className="mt-2 text-xs text-ink-soft">{changeRuleNote(watch.bookedFareFamily)}</p>
          {feeCopy ? <p className="mt-2 text-sm text-drop">{feeCopy}</p> : null}
          <div className="quiet-row">
            <button type="button" className="no-print" onClick={() => void copyDecision()}>
              Copy this decision
            </button>
            <button type="button" className="no-print" onClick={() => void copyPacket()}>
              Copy decision packet
            </button>
          </div>
        </section>
      ) : null}

      <div className="no-print mt-4">
        <button
          type="button"
          className={`chip ${settingsOpen ? "chip-on" : ""}`}
          aria-expanded={settingsOpen}
          onClick={() => setSettingsOpen((value) => !value)}
        >
          Watch settings
        </button>
        {settingsOpen ? (
          <WatchSettingsForm
            // Remounts when a save brings new persisted values back, which is
            // what replaced the re-seeding effect.
            key={`${watch.alertEmail}|${watch.minimumSavingsCents}|${watch.includeRestrictedFares}|${watch.includeThruway}|${watch.preferredDepartureTime ?? ""}`}
            alertEmail={watch.alertEmail}
            minimumSavingsCents={watch.minimumSavingsCents}
            includeRestrictedFares={watch.includeRestrictedFares}
            includeThruway={watch.includeThruway}
            preferredDepartureTime={watch.preferredDepartureTime}
            busy={busy}
            onInvalidEmail={setActionError}
            onSave={(values) => {
              void action(`/api/watches/${watch.id}`, "PATCH", values);
            }}
          />
        ) : null}
        {settingsOpen ? (
          /* Delete lives here now, with the other things that change the watch
             itself, rather than pinned to the bottom of the screen all session
             one click away from "Copy packet".

             Still two steps, and still for the same reason: this is
             irreversible, it takes the whole price history with it — the thing
             the traveler has been accumulating — and there is no undo anywhere
             in the product. */
          <div className="settings-danger mt-5">
            <p className="eyebrow">Delete this watch</p>
            <p className="mt-1 text-sm text-ink-soft">
              This removes the trip and every price we have recorded for it. It cannot be undone,
              and it does not affect your Amtrak booking.
            </p>
            <button
              type="button"
              className="btn btn-ghost dock-danger mt-3"
              disabled={busy}
              aria-label={confirmDelete ? "Confirm deleting this watch" : "Delete this watch"}
              onClick={async () => {
                if (!confirmDelete) {
                  setConfirmDelete(true);
                  window.setTimeout(() => setConfirmDelete(false), 4000);
                  return;
                }
                const ok = await action(`/api/watches/${watch.id}`, "DELETE");
                if (ok) router.push("/dashboard");
              }}
            >
              {confirmDelete ? "Delete for good?" : "Delete"}
            </button>
          </div>
        ) : null}
      </div>

      <div className="analysis mt-4 no-print">
        <button type="button" className="chip" onClick={() => setAnalysisOpen((value) => !value)}>
          {analysisOpen ? "Hide deeper analysis" : "More analysis"}
        </button>
      </div>

      {analysisOpen ? (
        <div className="stack-grid analysis">
          {yours && best && !candidateIsSame(yours, best) ? (
            <section className="panel your-train p-4">
              <p className="eyebrow">Your train</p>
              <p className="serif mt-2 text-2xl">{trainLabel(yours)}</p>
              <p className="mt-1 text-sm">
                Listed {formatUsdCompact(yours.totalPartyPriceCents)} · paid{" "}
                {formatUsdCompact(watch.currentBookedPriceCents)}
                {yours.savingsCents > 0 ? ` · save ${formatUsdCompact(yours.savingsCents)}` : ""}
              </p>
              <p className="mt-1 text-sm text-ink-soft">
                {formatClock(yours.journey.departureAt)} → {formatClock(yours.journey.arrivalAt)}
                {formatDurationDelta(durationDeltaMinutes(best, yours))
                  ? ` · ${formatDurationDelta(durationDeltaMinutes(best, yours))}`
                  : ""}
              </p>
            </section>
          ) : null}

          {best ? (
            <section className="panel p-4 text-sm">
              <p className="eyebrow">Text a friend</p>
              <p className="friend-text mt-3">{share}</p>
              <div className="quiet-row">
                <button type="button" className="no-print" onClick={() => void copyFriend()}>
                  Copy text for a friend
                </button>
              </div>
            </section>
          ) : null}

          {best && best.savingsCents > 0 ? (
            <section className="panel p-4 text-sm">
              <p className="eyebrow">Alert preview</p>
              <p className="mt-2 text-ink-soft">
                {watch.originCode} → {watch.destinationCode} from{" "}
                {formatUsdCompact(best.totalPartyPriceCents)} · save{" "}
                {formatUsdCompact(best.savingsCents)}. {watch.alertEmail}
              </p>
            </section>
          ) : null}

          {compared.length === 2 ? (
            <section className="ticket p-4">
              <p className="eyebrow">Compare</p>
              <p className="mt-2 text-sm text-ink-soft">{pairNote(compared[0]!, compared[1]!)}</p>
              <div className="compare-grid mt-4">
                {compared.map((candidate) => (
                  <div key={candidateKey(candidate)}>
                    <p className="price serif text-3xl">
                      {formatUsdCompact(candidate.totalPartyPriceCents)}
                    </p>
                    <p className="mt-1">
                      {candidate.journey.serviceName} {candidate.journey.trainNumber}
                    </p>
                    <p className="text-sm text-ink-soft">
                      {formatClock(candidate.journey.departureAt)} →{" "}
                      {formatClock(candidate.journey.arrivalAt)} ·{" "}
                      {formatDurationMinutes(candidate.journey.durationMinutes) ?? "—"}
                    </p>
                    <p className="mt-1 text-sm">
                      {candidate.savingsCents > 0
                        ? `Save ${formatUsdCompact(candidate.savingsCents)}`
                        : "No savings"}
                      {candidate.journey.transferCount > 0
                        ? ` · ${candidate.journey.transferCount} transfer${candidate.journey.transferCount === 1 ? "" : "s"}`
                        : " · Nonstop"}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="panel p-4">
            <p className="eyebrow">What moved</p>
            {moves.length === 0 ? (
              <p className="mt-3 text-sm text-ink-soft">
                {scanCount < 2
                  ? "Need a second scan. Press C or Check now."
                  : "No listed price changes."}
              </p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm">
                {moves.map((move) => (
                  <li
                    key={move.key}
                    className={
                      move.kind === "drop" ? "move-drop" : move.kind === "rise" ? "move-rise" : ""
                    }
                  >
                    {moveLabel(move)}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {events.length > 0 ? (
            <section className="panel p-4">
              <h2 className="eyebrow">What you paid</h2>
              <p className="mt-2 text-sm">
                Current benchmark {formatUsdCompact(watch.currentBookedPriceCents)}
              </p>
              <Sparkline values={trend} label="Your booking price over time" />
              <ul className="mt-3 space-y-1 text-sm">
                {events.map((event) => (
                  <li key={event.id}>
                    {formatUsdCompact(event.previousPriceCents)} →{" "}
                    {formatUsdCompact(event.newPriceCents)} · {event.note}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {alerts.length > 0 ? (
            <section className="panel p-4">
              <h2 className="eyebrow">Alerts sent</h2>
              <ul className="mt-3 space-y-2 text-sm">
                {alerts.map((alert) => (
                  <li key={alert.id}>
                    <span className="text-ink-soft">
                      <RelativeTime
                        at={alert.createdAt}
                        fallback={formatBoardStamp(alert.createdAt, watch.timezone)}
                      />
                    </span>
                    {" · "}
                    {alert.subject}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}

      <section className={`action-dock no-print mt-8 text-sm${dockOpen ? " is-expanded" : ""}`}>
        {/* Rendered only below 768px, by CSS. The summary is the tap target. */}
        <button
          type="button"
          className="dock-compare-toggle"
          aria-expanded={dockOpen}
          aria-controls="dock-body"
          onClick={() => setDockOpen((value) => !value)}
        >
          <span className="dock-compare-summary">{dockSummary}</span>
          <span className="dock-compare-action">{dockOpen ? "Less" : "Actions"}</span>
        </button>
        <div id="dock-body" className="dock-body">
          {active && compare ? (
            <div className={`live-compare${compare.beats ? " is-beats" : ""}`} aria-live="polite">
              <div className="live-col">
                <p className="eyebrow opacity-70">You paid</p>
                <p className="price serif text-2xl">
                  <Flap>{formatUsdCompact(watch.currentBookedPriceCents)}</Flap>
                </p>
              </div>
              <div className="live-col">
                <p className="eyebrow opacity-70">This train</p>
                <p className="price serif text-2xl">
                  <Flap>{formatUsdCompact(active.totalPartyPriceCents)}</Flap>
                </p>
                <p className="mt-1 text-xs opacity-80">
                  {trainLabel(active)} · {formatClock(active.journey.departureAt)}
                  {activeArrive ? ` · ${activeArrive}` : ""}
                  {untilActive == null
                    ? ""
                    : untilActive >= 0
                      ? ` · in ${untilActive}m`
                      : " · departed"}
                </p>
              </div>
              <div className="live-col">
                <p className="eyebrow opacity-70">
                  {compare.saveCents > 0 ? "Save" : compare.saveCents < 0 ? "More" : "Vs paid"}
                </p>
                <p
                  className={`price serif text-2xl ${compare.saveCents > 0 ? "text-save" : compare.saveCents < 0 ? "text-drop" : ""}`}
                >
                  <Flap>{formatUsdCompact(Math.abs(compare.saveCents))}</Flap>
                </p>
                <p className="mt-1 text-xs opacity-80">
                  {compare.beats
                    ? "Beats your train"
                    : (compare.vsYours ??
                      (compare.saveCents > 0 ? "Cheaper listed" : "No listed save"))}
                </p>
                {feeCents > 0 && compare.saveCents > 0 ? (
                  <p className="mt-1 text-xs opacity-80">
                    {netAfterFee(compare.saveCents, feeCents) > 0
                      ? `${formatUsdCompact(netAfterFee(compare.saveCents, feeCents))} after fee`
                      : "Fee estimate would wipe this save"}
                  </p>
                ) : compare.saveCents > 0 ? (
                  <p className="mt-1 text-xs opacity-80">
                    Covers a fee under {formatUsdCompact(compare.saveCents)}
                  </p>
                ) : null}
              </div>
              <div className="live-actions">
                <Handoff candidate={active} resolver={resolver} compact />
                <div className="quiet-row">
                  <button type="button" onClick={() => void copyCompare(active)}>
                    Copy you vs this
                  </button>
                  <button
                    type="button"
                    className="live-more-toggle"
                    aria-expanded={liveMoreOpen}
                    onClick={() => setLiveMoreOpen((value) => !value)}
                  >
                    {liveMoreOpen ? "Less" : "More"}
                  </button>
                </div>
                {liveMoreOpen ? (
                  <div className="quiet-row live-more">
                    <button type="button" onClick={() => downloadIcs(active)}>
                      Add to calendar
                    </button>
                    <button type="button" onClick={() => void copyFields(active)}>
                      Copy Amtrak fields
                    </button>
                    <button type="button" onClick={() => void copyWindow()}>
                      Copy window
                    </button>
                    <button type="button" onClick={() => hideTrain(candidateKey(active))}>
                      Hide this visit
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="live-hint">J / K walk · H skip · W window · Y you vs this</p>
          )}
          <div className="dock-btns">
            <button
              className="btn btn-ink"
              disabled={busy || watch.status !== "ACTIVE"}
              onClick={() => action(`/api/watches/${watch.id}/check`, "POST", undefined, true)}
            >
              Check now
            </button>
            <button
              className="btn btn-ghost"
              disabled={busy || watch.status === "COMPLETED"}
              onClick={() =>
                action(`/api/watches/${watch.id}`, "PATCH", {
                  status: watch.status === "PAUSED" ? "ACTIVE" : "PAUSED",
                })
              }
            >
              {watch.status === "PAUSED" ? "Resume" : "Pause"}
            </button>
            <Link href={reverseHref as Route} className="btn btn-ghost">
              Watch return
            </Link>
            {/* Stay stays: it changes what the board shows, so it belongs with
                the board. "Copy packet" left because the Share sheet already
                offers it as "Decision packet", and Delete left because a
                destructive action does not belong pinned to the bottom of every
                screen for the whole session. Both are in the command palette,
                and Delete now lives under Watch settings with the rest of the
                things that change the watch itself. */}
            <div className="stay-dock">
              <span className="eyebrow">Stay</span>
              {([1, 2, 3, 4, 7] as const).map((days) => (
                <button
                  key={days}
                  type="button"
                  className={`chip ${stayDays === days ? "chip-on" : ""}`}
                  onClick={() => setStayDays(days)}
                >
                  {days}d
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <p className="mt-8 text-xs text-ink-soft">
        {snapshots.filter((item) => item.status !== "PROVIDER_ERROR").length} of {snapshots.length}{" "}
        days · {scanCount} scan{scanCount === 1 ? "" : "s"} · listed fares from {fareSourceLabel}.
        Confirm on Amtrak.
      </p>
    </main>
  );
}
