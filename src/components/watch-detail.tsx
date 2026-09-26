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
import { formatRelativeTime, isCheckStale } from "@/lib/domain/relative-time";
import { extensionWindow } from "@/lib/domain/monitoring";
import { shouldHandleBoardKey } from "@/lib/domain/board-keys";
import { copyText } from "@/lib/clipboard";
import { BoardRow } from "./board/BoardRow";
import { HelpSheet } from "./board/HelpSheet";
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
  const [rebookPrice, setRebookPrice] = useState("");
  const [rebookTrain, setRebookTrain] = useState("");
  const [rebookFamily, setRebookFamily] = useState<FareFamily | "">(watch.bookedFareFamily);
  const [shareOpen, setShareOpen] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rebookOpen, setRebookOpen] = useState(false);
  const [liveMoreOpen, setLiveMoreOpen] = useState(false);
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
  const pinsLoaded = useRef(false);
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
    didFocus.current = false;
  }, [watch.id]);

  useEffect(() => {
    if (didFocus.current) return;
    const start = yours ?? best ?? ranked[0];
    if (!start) return;
    didFocus.current = true;
    // dispatch, not setState: the reducer made the suppression unnecessary
    dispatch({ type: "SET_FOCUS", key: candidateKey(start) });
  }, [yours, best, ranked]);

  useEffect(() => {
    let next: string[] = [];
    try {
      const raw = window.localStorage.getItem(`raildrop.pins.${watch.id}`);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
          next = parsed;
        }
      }
    } catch {
      next = [];
    }
    dispatch({ type: "LOAD_PINS", pins: next });
    pinsLoaded.current = true;
  }, [watch.id]);

  // The reducer is pure, so writing pins is an effect of the state changing
  // rather than something each of the three pin call sites does for itself.
  // Guarded on the read above: without it the first render would persist an
  // empty list over whatever was stored.
  useEffect(() => {
    if (!pinsLoaded.current) return;
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
  const copy = useCallback(async (text: string, message: string) => {
    const outcome = await copyText(text);
    if (outcome === "failed") {
      setManualCopy({ text, message });
      return;
    }
    setNotice(message);
    window.setTimeout(() => setNotice(null), 1600);
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      // Declines anything the browser, the OS, or an IME already owns. Without
      // it, Cmd+C both swallowed the copy and spent a provider credit on a
      // recheck, and Cmd+R / Cmd+P / Cmd+F were unusable on this page.
      if (!shouldHandleBoardKey(event)) return;
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
        void copy(share, "Text for a friend copied");
      }
      if (event.key === "/" && !busyRef.current) {
        event.preventDefault();
        findRef.current?.focus();
      }
      if ((event.key === "r" || event.key === "R") && !busyRef.current) {
        event.preventDefault();
        setRebookOpen(true);
        window.setTimeout(() => {
          document
            .getElementById("rebook")
            ?.scrollIntoView({ behavior: "smooth", block: "center" });
          rebookRef.current?.focus();
        }, 80);
      }
      if (event.key === "?" && !busyRef.current) {
        event.preventDefault();
        setHelpOpen((value) => !value);
      }
      if ((event.key === "j" || event.key === "J") && !busyRef.current) {
        event.preventDefault();
        const keys = navRef.current;
        if (keys.length === 0) return;
        dispatch({ type: "MOVE_FOCUS", direction: "next", keys });
        scrollToOption(focusAfterMove(keys, focusRef.current, "next"));
      }
      if ((event.key === "k" || event.key === "K") && !busyRef.current) {
        event.preventDefault();
        const keys = navRef.current;
        if (keys.length === 0) return;
        dispatch({ type: "MOVE_FOCUS", direction: "previous", keys });
        scrollToOption(focusAfterMove(keys, focusRef.current, "previous"));
      }
      if ((event.key === "i" || event.key === "I") && !busyRef.current) {
        event.preventDefault();
        const key = focusRef.current;
        const candidate =
          rankedRef.current.find((item) => candidateKey(item) === key) ?? rankedRef.current[0];
        if (!candidate) return;
        void copy(itineraryText(candidate), "Itinerary copied");
      }
      if ((event.key === "z" || event.key === "Z") && !busyRef.current) {
        event.preventDefault();
        dispatch({ type: "TOGGLE_ZEN" });
      }
      if ((event.key === "p" || event.key === "P") && !busyRef.current) {
        event.preventDefault();
        const key = focusRef.current;
        if (!key) {
          setNotice("Focus a train with J, then P to pin");
          window.setTimeout(() => setNotice(null), 1600);
          return;
        }
        dispatch({ type: "TOGGLE_PIN", key });
        setNotice("Pin updated");
        window.setTimeout(() => setNotice(null), 1600);
      }
      if ((event.key === "h" || event.key === "H") && !busyRef.current) {
        event.preventDefault();
        const key = focusRef.current;
        if (!key) {
          setNotice("Focus a train with J, then H to skip it");
          window.setTimeout(() => setNotice(null), 1600);
          return;
        }
        const next = navRef.current.filter((item) => item !== key)[0] ?? null;
        dispatch({ type: "HIDE", key, nextFocus: next });
        if (next) scrollToOption(next);
        setNotice("Hidden this visit");
        window.setTimeout(() => setNotice(null), 1600);
      }
      if ((event.key === "u" || event.key === "U") && !busyRef.current) {
        event.preventDefault();
        const stack = hiddenRef.current;
        const last = stack[stack.length - 1];
        if (!last) {
          setNotice("Nothing hidden to undo");
          window.setTimeout(() => setNotice(null), 1600);
          return;
        }
        dispatch({ type: "UNDO_HIDE" });
        scrollToOption(last);
        setNotice("Unhidden");
        window.setTimeout(() => setNotice(null), 1600);
      }
      if ((event.key === "y" || event.key === "Y") && !busyRef.current) {
        event.preventDefault();
        const key = focusRef.current;
        const candidate =
          rankedRef.current.find((item) => candidateKey(item) === key) ?? rankedRef.current[0];
        if (!candidate) return;
        void copy(
          compareLine({
            originCode: watch.originCode,
            destinationCode: watch.destinationCode,
            desiredTravelDate: watch.desiredTravelDate,
            bookedCents: watch.currentBookedPriceCents,
            focused: candidate,
          }),
          "You vs this copied",
        );
      }
      if ((event.key === "w" || event.key === "W") && !busyRef.current) {
        event.preventDefault();
        void copy(stripRef.current, "Window copied");
      }
      if ((event.key === "g" || event.key === "G") && !busyRef.current) {
        event.preventDefault();
        document.getElementById("board")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      if ((event.key === "b" || event.key === "B") && !busyRef.current) {
        event.preventDefault();
        const next = beatsKeyRef.current[0];
        if (!next) {
          setNotice("No train beats yours right now");
          window.setTimeout(() => setNotice(null), 1600);
          return;
        }
        dispatch({ type: "SET_FOCUS", key: next });
        scrollToOption(next);
      }
      if ((event.key === "n" || event.key === "N") && !busyRef.current) {
        event.preventDefault();
        const next = nextMatchingKey(navRef.current, focusRef.current, new Set(cheaperRef.current));
        if (!next) {
          setNotice("No cheaper listed train to jump to");
          window.setTimeout(() => setNotice(null), 1600);
          return;
        }
        dispatch({ type: "SET_FOCUS", key: next });
        scrollToOption(next);
      }
      if ((event.key === "f" || event.key === "F") && !busyRef.current) {
        event.preventDefault();
        const key = focusRef.current;
        const candidate =
          rankedRef.current.find((item) => candidateKey(item) === key) ?? rankedRef.current[0];
        if (!candidate) return;
        void copy(amtrakFieldsText(candidate), "Amtrak fields copied");
      }
      if (event.key === "Enter" && !busyRef.current) {
        const tag = target?.tagName;
        if (tag === "BUTTON" || tag === "A" || target?.closest("a, button")) return;
        event.preventDefault();
        const key = focusRef.current;
        const candidate =
          rankedRef.current.find((item) => candidateKey(item) === key) ?? rankedRef.current[0];
        if (!candidate) return;
        const handoff = new BookingLinkResolver().resolve({
          journey: candidate.journey,
          fare: candidate.fare,
        });
        window.open(handoff.url, "_blank", "noopener,noreferrer");
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

  async function copyShare() {
    await copy(window.location.href, "Link copied");
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
    await copy(brief, "Decision copied");
  }

  async function copyFriend() {
    await copy(share, "Text for a friend copied");
  }

  async function copyOptions() {
    await copy(optionsCopy, "Cheaper options copied");
  }

  function clearFilters() {
    // Deliberately CLEAR_FILTERS, not RESET_VIEW: the button leaves the
    // compare pair in place where Escape drops it. Pre-existing difference,
    // recorded in docs/AUDIT.md rather than silently unified here.
    dispatch({ type: "CLEAR_FILTERS" });
  }

  async function copyPacket() {
    await copy(packet, "Decision packet copied");
  }

  async function copyFields(candidate: RankedCandidate) {
    await copy(amtrakFieldsText(candidate), "Amtrak fields copied");
  }

  async function copyCompare(candidate: RankedCandidate) {
    await copy(
      compareLine({
        originCode: watch.originCode,
        destinationCode: watch.destinationCode,
        desiredTravelDate: watch.desiredTravelDate,
        bookedCents: watch.currentBookedPriceCents,
        focused: candidate,
      }),
      "You vs this copied",
    );
  }

  async function copyWindow() {
    await copy(strip, "Window copied");
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
          <button type="button" className="trip-rail-shortcuts" onClick={() => setHelpOpen(true)}>
            Shortcuts
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
        />
      ) : null}
      <p className="mt-3 text-sm text-ink-soft">
        {stationLabel(watch.originCode)} → {stationLabel(watch.destinationCode)}
        {watch.bookedTrainNumber ? ` · ${watch.bookedTrainNumber}` : ""} ·{" "}
        {formatDaysUntil(watch.desiredTravelDate, today)}
        {drops ? ` · ${drops} cheaper` : ""} · {formatRelativeTime(watch.lastCheckedAt)}
      </p>
      {notice ? (
        <p className="board-toast no-print" role="status">
          {notice}
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
                    title={`${scan.status} · ${formatRelativeTime(scan.at)}`}
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
              Copy link
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
            <p className="px-4 py-6 text-sm text-ink-soft">
              No other trains for this filter.
              {filtersOn ? (
                <>
                  {" "}
                  <button type="button" className="underline" onClick={clearFilters}>
                    Clear filters
                  </button>
                </>
              ) : null}
            </p>
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

          <section className="panel p-4">
            <h2 className="eyebrow">Price history</h2>
            <p className="mt-2 text-sm">
              Current booked benchmark {formatUsdCompact(watch.currentBookedPriceCents)}
            </p>
            <Sparkline values={trend} label="Booked price over time" />
            <ul className="mt-3 space-y-1 text-sm">
              {events.map((event) => (
                <li key={event.id}>
                  {formatUsdCompact(event.previousPriceCents)} →{" "}
                  {formatUsdCompact(event.newPriceCents)} · {event.note}
                </li>
              ))}
              {watch.bestPriceCents ? (
                <li>Observed best {formatUsdCompact(watch.bestPriceCents)}</li>
              ) : null}
              {events.length === 0 && !watch.bestPriceCents ? (
                <li className="text-ink-soft">No rebooks yet.</li>
              ) : null}
            </ul>
          </section>

          {alerts.length > 0 ? (
            <section className="panel p-4">
              <h2 className="eyebrow">Alerts sent</h2>
              <ul className="mt-3 space-y-2 text-sm">
                {alerts.map((alert) => (
                  <li key={alert.id}>
                    <span className="text-ink-soft">{formatRelativeTime(alert.createdAt)}</span>
                    {" · "}
                    {alert.subject}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}

      <section className="action-dock no-print mt-8 text-sm">
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
          <div className="dock-more">
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
            <button type="button" className="btn btn-ghost" onClick={() => void copyPacket()}>
              Copy packet
            </button>
            {/* Two steps, because this is irreversible and sits one click from
                "Copy packet". Deleting a watch takes its whole price history
                with it — the thing the traveler has been accumulating — and
                there is no undo anywhere in the product. */}
            <button
              className="btn btn-ghost dock-danger"
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
