"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { copyText as writeClipboard } from "@/lib/ui/clipboard";
import { scrollBehavior } from "@/lib/ui/motion";
import { ConfirmSheet } from "@/components/confirm-sheet";
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
  waitMinutes,
  connectionNote,
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
  ladderPercent,
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
  durationShare,
  hassleNote,
  monitorRemaining,
  moveLabel,
  travelUrgency,
  changeRuleNote,
  type BoardMove,
} from "@/lib/domain/board-moves";
import type { FareFamily } from "@/lib/domain/types";

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
  const [showAll, setShowAll] = useState(false);
  const [dateFilter, setDateFilter] = useState<string | "all">("all");
  const [service, setService] = useState<ServiceFilter>("all");
  const [bucket, setBucket] = useState<TimeBucket | "all">("all");
  const [savingsOnly, setSavingsOnly] = useState(false);
  const [sort, setSort] = useState<BoardSort>("rank");
  const [picked, setPicked] = useState<string[]>([]);
  const [pins, setPins] = useState<string[]>([]);
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [trainQuery, setTrainQuery] = useState("");
  const [departAfter, setDepartAfter] = useState("");
  const [arriveBefore, setArriveBefore] = useState("");
  const [durationCap, setDurationCap] = useState<number | null>(null);
  const [arriveBuffer, setArriveBuffer] = useState(false);
  const [stayDays, setStayDays] = useState(2);
  const [zen, setZen] = useState(false);
  const [hiddenKeys, setHiddenKeys] = useState<string[]>([]);
  const [hideDeparted, setHideDeparted] = useState(false);
  const [boardNow, setBoardNow] = useState<{
    minutes: number;
    label: string;
  } | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
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
  const [dockToolsOpen, setDockToolsOpen] = useState(false);
  const [compareDockOpen, setCompareDockOpen] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(`raildrop.compareDock.${watch.id}`) === "1") {
        setCompareDockOpen(true);
      }
    } catch {
      // private mode / quota
    }
  }, [watch.id]);

  function toggleCompareDock() {
    setCompareDockOpen((value) => {
      const next = !value;
      try {
        window.localStorage.setItem(`raildrop.compareDock.${watch.id}`, next ? "1" : "0");
      } catch {
        // private mode / quota
      }
      return next;
    });
  }
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const tripRailRef = useRef<HTMLDivElement>(null);
  const [settingsEmail, setSettingsEmail] = useState(watch.alertEmail);
  const [settingsThreshold, setSettingsThreshold] = useState(
    String(Math.round(watch.minimumSavingsCents / 100)),
  );
  const [settingsRestricted, setSettingsRestricted] = useState(watch.includeRestrictedFares);
  const [settingsThruway, setSettingsThruway] = useState(watch.includeThruway);
  const [settingsPreferred, setSettingsPreferred] = useState(watch.preferredDepartureTime ?? "");
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
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
  const filtersOn =
    dateFilter !== "all" ||
    service !== "all" ||
    bucket !== "all" ||
    savingsOnly ||
    pinnedOnly ||
    sort !== "rank" ||
    Boolean(trainQuery.trim()) ||
    Boolean(departAfter) ||
    Boolean(arriveBefore) ||
    durationCap != null ||
    arriveBuffer ||
    hiddenKeys.length > 0 ||
    hideDeparted;

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
  const clockOn = Boolean(departAfter || arriveBefore || durationCap);
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
          setNotice("Board partially refreshed — some dates missed");
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
        setNotice("Scan dismissed — board may still refresh in the background");
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
    const hours = preset === "24h" ? 24 : preset === "48h" ? 48 : 72;
    const end = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    void action(`/api/watches/${watch.id}`, "PATCH", {
      status: "ACTIVE",
      monitorPreset: preset,
      monitorStartAt: new Date().toISOString(),
      monitorEndAt: end,
    });
  }

  useEffect(() => {
    setSettingsEmail(watch.alertEmail);
    setSettingsThreshold(String(Math.round(watch.minimumSavingsCents / 100)));
    setSettingsRestricted(watch.includeRestrictedFares);
    setSettingsThruway(watch.includeThruway);
    setSettingsPreferred(watch.preferredDepartureTime ?? "");
  }, [
    watch.alertEmail,
    watch.minimumSavingsCents,
    watch.includeRestrictedFares,
    watch.includeThruway,
    watch.preferredDepartureTime,
  ]);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    helpRef.current = helpOpen;
  }, [helpOpen]);

  useEffect(() => {
    if (!shareOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const root = document.getElementById("share-sheet");
    root?.querySelector<HTMLElement>("button")?.focus();

    function onDoc(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("#share-sheet")) return;
      if (target.closest('[aria-controls="share-sheet"]')) return;
      setShareOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setShareOpen(false);
        return;
      }
      if (event.key !== "Tab" || !root) return;
      const focusable = [...root.querySelectorAll<HTMLElement>("button")];
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey, true);
      previous?.focus();
    };
  }, [shareOpen]);

  useEffect(() => {
    const el = tripRailRef.current;
    if (!el) return;
    function sync() {
      document.documentElement.style.setProperty("--trip-rail-h", `${el!.offsetHeight}px`);
    }
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--trip-rail-h");
    };
  }, [zen, shareOpen]);

  useEffect(() => {
    if (!helpOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const root = document.getElementById("help-sheet");
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.getElementById("help-close")?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setHelpOpen(false);
        return;
      }
      if (event.key !== "Tab" || !root) return;
      const focusable = [
        ...root.querySelectorAll<HTMLElement>("a[href], button, [tabindex]:not([tabindex='-1'])"),
      ];
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = overflow;
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- start on your train once per watch
    setFocusKey(candidateKey(start));
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- pin list is local-only; never write storage before read
    setPins(next);
  }, [watch.id]);

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

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
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
        void copyNotice(share, "Text for a friend copied");
      }
      if (event.key === "/" && !busyRef.current) {
        event.preventDefault();
        findRef.current?.focus();
      }
      if ((event.key === "r" || event.key === "R") && !busyRef.current) {
        event.preventDefault();
        setRebookOpen(true);
        window.setTimeout(() => {
          document.getElementById("rebook")?.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
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
        const idx = focusRef.current ? keys.indexOf(focusRef.current) : -1;
        const next = keys[Math.min(keys.length - 1, idx + 1)] ?? keys[0]!;
        setFocusKey(next);
        document.getElementById(`opt-${next}`)?.scrollIntoView({
          behavior: scrollBehavior(),
          block: "center",
        });
      }
      if ((event.key === "k" || event.key === "K") && !busyRef.current) {
        event.preventDefault();
        const keys = navRef.current;
        if (keys.length === 0) return;
        const idx = focusRef.current ? keys.indexOf(focusRef.current) : keys.length;
        const next = keys[Math.max(0, idx - 1)] ?? keys[0]!;
        setFocusKey(next);
        document.getElementById(`opt-${next}`)?.scrollIntoView({
          behavior: scrollBehavior(),
          block: "center",
        });
      }
      if ((event.key === "i" || event.key === "I") && !busyRef.current) {
        event.preventDefault();
        const key = focusRef.current;
        const candidate =
          rankedRef.current.find((item) => candidateKey(item) === key) ?? rankedRef.current[0];
        if (!candidate) return;
        void copyNotice(itineraryText(candidate), "Itinerary copied");
      }
      if ((event.key === "z" || event.key === "Z") && !busyRef.current) {
        event.preventDefault();
        setZen((value) => !value);
      }
      if ((event.key === "p" || event.key === "P") && !busyRef.current) {
        event.preventDefault();
        const key = focusRef.current;
        if (!key) {
          setNotice("Focus a train with J, then P to pin");
          window.setTimeout(() => setNotice(null), 1600);
          return;
        }
        setPins((current) => {
          const next = current.includes(key)
            ? current.filter((item) => item !== key)
            : [...current, key];
          try {
            window.localStorage.setItem(`raildrop.pins.${watch.id}`, JSON.stringify(next));
          } catch {
            // private mode / quota
          }
          return next;
        });
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
        setHiddenKeys((current) => (current.includes(key) ? current : [...current, key]));
        const keys = navRef.current.filter((item) => item !== key);
        const next = keys[0] ?? null;
        setFocusKey(next);
        if (next) {
          document.getElementById(`opt-${next}`)?.scrollIntoView({
            behavior: scrollBehavior(),
            block: "center",
          });
        }
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
        setHiddenKeys(stack.slice(0, -1));
        setFocusKey(last);
        document.getElementById(`opt-${last}`)?.scrollIntoView({
          behavior: scrollBehavior(),
          block: "center",
        });
        setNotice("Unhidden");
        window.setTimeout(() => setNotice(null), 1600);
      }
      if ((event.key === "y" || event.key === "Y") && !busyRef.current) {
        event.preventDefault();
        const key = focusRef.current;
        const candidate =
          rankedRef.current.find((item) => candidateKey(item) === key) ?? rankedRef.current[0];
        if (!candidate) return;
        void copyNotice(
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
        void copyNotice(stripRef.current, "Window copied");
      }
      if ((event.key === "g" || event.key === "G") && !busyRef.current) {
        event.preventDefault();
        document.getElementById("board")?.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
      }
      if ((event.key === "b" || event.key === "B") && !busyRef.current) {
        event.preventDefault();
        const next = beatsKeyRef.current[0];
        if (!next) {
          setNotice("No train beats yours right now");
          window.setTimeout(() => setNotice(null), 1600);
          return;
        }
        setFocusKey(next);
        document.getElementById(`opt-${next}`)?.scrollIntoView({
          behavior: scrollBehavior(),
          block: "center",
        });
      }
      if ((event.key === "n" || event.key === "N") && !busyRef.current) {
        event.preventDefault();
        const next = nextMatchingKey(navRef.current, focusRef.current, new Set(cheaperRef.current));
        if (!next) {
          setNotice("No cheaper listed train to jump to");
          window.setTimeout(() => setNotice(null), 1600);
          return;
        }
        setFocusKey(next);
        document.getElementById(`opt-${next}`)?.scrollIntoView({
          behavior: scrollBehavior(),
          block: "center",
        });
      }
      if ((event.key === "f" || event.key === "F") && !busyRef.current) {
        event.preventDefault();
        const key = focusRef.current;
        const candidate =
          rankedRef.current.find((item) => candidateKey(item) === key) ?? rankedRef.current[0];
        if (!candidate) return;
        void copyNotice(amtrakFieldsText(candidate), "Amtrak fields copied");
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
        setDateFilter("all");
        setService("all");
        setBucket("all");
        setSavingsOnly(false);
        setPinnedOnly(false);
        setSort("rank");
        setTrainQuery("");
        setDepartAfter("");
        setArriveBefore("");
        setDurationCap(null);
        setArriveBuffer(false);
        setHiddenKeys([]);
        setHideDeparted(false);
        setPicked([]);
        setFocusKey(null);
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

  function togglePick(key: string) {
    setPicked((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key].slice(-2),
    );
  }

  function togglePin(key: string) {
    setPins((current) => {
      const next = current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key];
      try {
        window.localStorage.setItem(`raildrop.pins.${watch.id}`, JSON.stringify(next));
      } catch {
        // private mode / quota
      }
      return next;
    });
  }


  function flashNotice(message: string, ms = 1600) {
    setNotice(message);
    window.setTimeout(() => setNotice(null), ms);
  }

  async function copyNotice(text: string, okLabel: string) {
    const ok = await writeClipboard(text);
    flashNotice(ok ? okLabel : "Couldn’t copy — check clipboard permission");
  }

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
    setFocusKey(key);
    document.getElementById(optionAnchor(candidate))?.scrollIntoView({
      behavior: scrollBehavior(),
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
    await copyNotice(window.location.href, "Link copied");
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
    await copyNotice(brief, "Decision copied");
  }

  async function copyFriend() {
    await copyNotice(share, "Text for a friend copied");
  }

  async function copyOptions() {
    await copyNotice(optionsCopy, "Cheaper options copied");
  }

  function clearFilters() {
    setDateFilter("all");
    setService("all");
    setBucket("all");
    setSavingsOnly(false);
    setPinnedOnly(false);
    setSort("rank");
    setTrainQuery("");
    setDepartAfter("");
    setArriveBefore("");
    setDurationCap(null);
    setArriveBuffer(false);
    setHiddenKeys([]);
    setHideDeparted(false);
    setFocusKey(null);
  }

  async function copyPacket() {
    await copyNotice(packet, "Decision packet copied");
  }

  async function copyFields(candidate: RankedCandidate) {
    await copyNotice(amtrakFieldsText(candidate), "Amtrak fields copied");
  }

  async function copyCompare(candidate: RankedCandidate) {
    await copyNotice(
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
    await copyNotice(strip, "Window copied");
  }

  function hideTrain(key: string) {
    setHiddenKeys((current) => (current.includes(key) ? current : [...current, key]));
    if (focusKey === key) {
      const next = navKeys.filter((item) => item !== key)[0] ?? null;
      setFocusKey(next);
    }
    setNotice("Hidden this visit");
    window.setTimeout(() => setNotice(null), 1600);
  }

  async function copyItinerary(candidate: RankedCandidate) {
    await copyNotice(itineraryText(candidate), "Itinerary copied");
  }

  return (
    <main id="main" className={`has-dock mx-auto max-w-6xl px-4 py-8${zen ? " is-zen" : ""}`}>
      {scanning ? (
        <SearchingOverlay
          origin={watch.originCode}
          destination={watch.destinationCode}
          date={watch.desiredTravelDate}
          elapsedSeconds={elapsed}
          flexibility={watch.dateFlexibilityDays}
          mode="recheck"
          onCancel={cancelScan}
        />
      ) : null}
      {helpOpen ? (
        <div
          id="help-sheet"
          className="help-sheet no-print"
          role="dialog"
          aria-modal="true"
          aria-labelledby="help-title"
          onClick={() => setHelpOpen(false)}
        >
          <div className="help-card" onClick={(event) => event.stopPropagation()}>
            <p id="help-title" className="text-[10px] uppercase tracking-[0.18em] text-gold">
              Board shortcuts
            </p>
            <ul className="help-grid mt-4 text-sm">
              <li>
                <kbd>C</kbd> Recheck live fares
              </li>
              <li>
                <kbd>T</kbd> Copy a one-liner for a friend
              </li>
              <li>
                <kbd>J</kbd> / <kbd>K</kbd> Move down / up the board
              </li>
              <li>
                <kbd>I</kbd> Copy the focused itinerary
              </li>
              <li>
                <kbd>Enter</kbd> Open Book on Amtrak for the focused train
              </li>
              <li>
                <kbd>P</kbd> Pin the focused train
              </li>
              <li>
                <kbd>Z</kbd> Zen — ticket and board only
              </li>
              <li>
                <kbd>H</kbd> Hide the focused train this visit
              </li>
              <li>
                <kbd>U</kbd> Undo last hide
              </li>
              <li>
                <kbd>Y</kbd> Copy you vs this train
              </li>
              <li>
                <kbd>W</kbd> Copy the cheapest listed train on each day
              </li>
              <li>
                <kbd>G</kbd> Jump to the timetable
              </li>
              <li>
                <kbd>B</kbd> Jump to a train that beats yours
              </li>
              <li>
                <kbd>N</kbd> Next cheaper listed train
              </li>
              <li>
                <kbd>F</kbd> Copy Amtrak search fields
              </li>
              <li>
                <kbd>/</kbd> Find a train number
              </li>
              <li>
                <kbd>R</kbd> Jump to I rebooked
              </li>
              <li>
                <kbd>?</kbd> Close this sheet
              </li>
              <li>
                <kbd>Esc</kbd> Close sheets, then clear filters
              </li>
            </ul>
            <p className="mt-4 text-xs opacity-70">
              Pins and change-fee estimates stay on this browser only. We never invent an Amtrak
              fee.
            </p>
            <button
              type="button"
              id="help-close"
              className="mt-4 underline"
              onClick={() => setHelpOpen(false)}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
      <BackLink>Your watches</BackLink>
      <h1 className="sr-only">
        {stationLabel(watch.originCode)} to {stationLabel(watch.destinationCode)}{" "}
        {formatDisplayDate(watch.desiredTravelDate)}
      </h1>
      <div ref={tripRailRef} className={`trip-rail no-print${zen ? " is-zen" : ""}`}>
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
        <span className="trip-rail-metric trip-rail-meta">
          <span className="trip-rail-to">You paid</span>
          <span className="price serif">{formatUsdCompact(watch.currentBookedPriceCents)}</span>
        </span>
        {best ? (
          <span className="trip-rail-metric">
            <span className="trip-rail-to">Best listed</span>
            <span className="price serif">{formatUsdCompact(best.totalPartyPriceCents)}</span>
          </span>
        ) : null}
        <span className="trip-rail-call">{verdict.label}</span>
        {best && best.savingsCents > 0 ? (
          <span className="trip-rail-save">save {formatUsdCompact(best.savingsCents)}</span>
        ) : null}
        <div className="trip-rail-tools">
          <a href="#board">Board</a>
          <button type="button" onClick={() => setZen((value) => !value)}>
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
          <button type="button" onClick={() => setHelpOpen(true)}>
            Shortcuts
          </button>
        </div>
      </div>
      <div className="print-only depart-strip mt-4" aria-hidden>
        <Flap>{watch.originCode}</Flap>
        <span className="text-[10px] uppercase tracking-[0.18em] opacity-70">to</span>
        <Flap>{watch.destinationCode}</Flap>
        <span className="depart-strip-rule" aria-hidden />
        <Flap>{formatDisplayDate(watch.desiredTravelDate)}</Flap>
        <span className="depart-strip-rule" aria-hidden />
        <span className="text-[10px] uppercase tracking-[0.16em] opacity-70">paid</span>
        <span className="price serif text-lg">
          {formatUsdCompact(watch.currentBookedPriceCents)}
        </span>
        {best ? (
          <>
            <span className="depart-strip-rule" aria-hidden />
            <span className="text-[10px] uppercase tracking-[0.16em] opacity-70">best</span>
            <span className="price serif text-lg">
              {formatUsdCompact(best.totalPartyPriceCents)}
            </span>
          </>
        ) : null}
      </div>
      {shareOpen ? (
        <div
          id="share-sheet"
          className="share-sheet no-print"
          role="dialog"
          aria-modal="true"
          aria-label="Share"
        >
          <button
            type="button"
            onClick={() => {
              void copyFriend();
              setShareOpen(false);
            }}
          >
            Text a friend
          </button>
          <button
            type="button"
            onClick={() => {
              void copyWindow();
              setShareOpen(false);
            }}
          >
            Copy window
          </button>
          <button
            type="button"
            onClick={() => {
              void copyPacket();
              setShareOpen(false);
            }}
          >
            Decision packet
          </button>
          <button
            type="button"
            onClick={() => {
              void copyShare();
              setShareOpen(false);
            }}
          >
            Copy link
          </button>
        </div>
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
      {stale || cycleStatus === "PARTIAL_SUCCESS" || cycleStatus === "PROVIDER_ERROR" || actionError ? (
        <div className="board-status mt-3 no-print" role="status">
          {cycleStatus === "PROVIDER_ERROR" ? (
            <p className="text-sm text-danger">
              Live fares are unavailable right now. Recheck in a minute.
              {snapshots.find((snapshot) => snapshot.errorMessage)?.errorMessage
                ? ` (${snapshots.find((snapshot) => snapshot.errorMessage)?.errorMessage})`
                : null}
            </p>
          ) : cycleStatus === "PARTIAL_SUCCESS" ? (
            <p className="text-sm text-drop">
              Best found: {best ? formatUsdCompact(best.totalPartyPriceCents) : "—"}.{" "}
              {datesFailed.map((date) => formatDisplayDate(date)).join(", ")} could not be refreshed.
            </p>
          ) : stale ? (
            <p className="text-sm text-drop">Board is stale — recheck for current listed fares.</p>
          ) : null}
          {actionError ? (
            <p className="mt-1 text-sm text-danger" role="alert">
              {actionError}
            </p>
          ) : null}
          {watch.status === "ACTIVE" && (stale || cycleStatus === "PROVIDER_ERROR") ? (
            <button
              type="button"
              className="btn btn-ink mt-3"
              disabled={busy}
              onClick={() => action(`/api/watches/${watch.id}/check`, "POST", undefined, true)}
            >
              Check now
            </button>
          ) : null}
        </div>
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
              placeholder="Custom"
              className="field mt-0 max-w-[5.5rem]"
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
              onClick={() => setDateFilter(selected ? "all" : date)}
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
                    else setDateFilter(date);
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
              onClick={() => setBucket(bucket === key ? "all" : key)}
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
                    behavior: scrollBehavior(),
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
            <button type="button" onClick={() => togglePin(candidateKey(best))}>
              {pins.includes(candidateKey(best)) ? "Unpin" : "Pin this train"}
            </button>
          </div>
        </section>
      ) : (
        <section className="ticket mt-8 p-6">
          <p className="kicker">Empty board</p>
          <h2 className="serif mt-3 text-2xl">No trains on the board yet.</h2>
          <p className="mt-2 max-w-lg text-sm text-ink-soft">
            Search live Amtrak inventory for this window. We never invent a fare.
          </p>
          <button
            type="button"
            className="btn btn-primary mt-5"
            disabled={busy || watch.status !== "ACTIVE"}
            onClick={() => action(`/api/watches/${watch.id}/check`, "POST", undefined, true)}
          >
            Check now
          </button>
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
        </div>
        {ranked.length === 0 ? (
          <p className="mt-4 max-w-lg text-sm text-ink-soft">
            {watch.status === "ACTIVE"
              ? "Scan the window to fill this board. Filters and exports appear once trains land."
              : "Resume this watch, then scan to fill the board."}
          </p>
        ) : (
          <>
          <div className="quiet-row no-print mt-3">
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
              <button type="button" onClick={() => setDateFilter("all")}>
                Show every date
              </button>
            ) : null}
            {withoutHero.length > 5 ? (
              <button type="button" onClick={() => setShowAll((value) => !value)}>
                {showAll ? "Show top 5" : "Show all options"}
              </button>
            ) : null}
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
                onClick={() => setService(value)}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              className={`chip ${savingsOnly ? "chip-save" : ""}`}
              aria-pressed={savingsOnly}
              onClick={() => setSavingsOnly((value) => !value)}
            >
              Savings only
            </button>
            {pins.length > 0 ? (
              <button
                type="button"
                className={`chip ${pinnedOnly ? "chip-on" : ""}`}
                aria-pressed={pinnedOnly}
                onClick={() => setPinnedOnly((value) => !value)}
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
                onClick={() => setBucket(value)}
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
                  setDepartAfter((value) =>
                    value === watch.preferredDepartureTime
                      ? ""
                      : (watch.preferredDepartureTime ?? ""),
                  )
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
                onClick={() => setHideDeparted((value) => !value)}
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
                onChange={(event) => setDepartAfter(event.target.value)}
                className="field mt-0 ml-2 w-auto py-1"
                aria-label="Leave after"
              />
            </label>
            <label className="text-xs text-ink-soft">
              Arrive by
              <input
                type="time"
                value={arriveBefore}
                onChange={(event) => setArriveBefore(event.target.value)}
                className="field mt-0 ml-2 w-auto py-1"
                aria-label="Arrive by"
              />
            </label>
            {arriveBefore ? (
              <button
                type="button"
                className={`chip ${arriveBuffer ? "chip-on" : ""}`}
                onClick={() => setArriveBuffer((value) => !value)}
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
                onClick={() => setDurationCap(value)}
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
              onChange={(event) => setTrainQuery(event.target.value)}
              placeholder="Find train"
              aria-label="Find train"
              className="field mt-0 max-w-[9rem] py-1"
            />
            {hiddenKeys.length > 0 ? (
              <>
                <button type="button" className="chip chip-on" onClick={() => setHiddenKeys([])}>
                  Show {hiddenKeys.length} hidden
                </button>
                <button
                  type="button"
                  className="chip"
                  onClick={() => {
                    const last = hiddenKeys[hiddenKeys.length - 1];
                    if (!last) return;
                    setHiddenKeys(hiddenKeys.slice(0, -1));
                    setFocusKey(last);
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
                onChange={(event) => setSort(event.target.value as BoardSort)}
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
            <Flap quiet>{String(board.length)}</Flap>
            <span>on board</span>
          </span>
          <span>
            <Flap quiet>{String(board.filter((item) => item.savingsCents > 0).length)}</Flap>
            <span>cheaper</span>
          </span>
          {yours ? (
            <span>
              <Flap quiet>{String(board.filter((item) => beatsBooked(item, yours)).length)}</Flap>
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
              {filtersOn ? (
                <>
                  No trains match these filters.{" "}
                  <button type="button" className="underline" onClick={clearFilters}>
                    Clear filters
                  </button>
                </>
              ) : hideHero && best ? (
                <>
                  Only the cheapest train is pinned above.{" "}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => {
                      setFocusKey(candidateKey(best));
                      document
                        .querySelector("[data-hero-opt]")
                        ?.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
                    }}
                  >
                    Jump to it
                  </button>
                </>
              ) : (
                <>No trains on this board yet.</>
              )}
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
                <TimetableRow
                  key={candidateKey(candidate)}
                  candidate={candidate}
                  index={index}
                  yours={yours}
                  preferred={preferred}
                  maxDuration={maxDuration}
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
                  onTogglePick={() => togglePick(candidateKey(candidate))}
                  onTogglePin={() => togglePin(candidateKey(candidate))}
                  onHide={() => hideTrain(candidateKey(candidate))}
                  onFocus={() => setFocusKey(candidateKey(candidate))}
                />
              ))}
            </>
          )}
        </div>
          </>
        )}
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
              const ok = await action(`/api/watches/${watch.id}/rebook`, "POST", {
                newBookedPriceCents: Math.round(Number(rebookPrice) * 100),
                newTrainNumber: rebookTrain.trim() || null,
                newFareFamily: rebookFamily || null,
              });
              if (!ok) return;
              setRebookPrice("");
              setRebookTrain("");
              setRebookOpen(false);
              flashNotice("Booked price updated");
            }}
          >
            <p className="eyebrow">After Amtrak</p>
            <h2 className="serif text-2xl">I rebooked</h2>
            <p className="text-sm text-ink-soft">Then type what you actually paid.</p>
            <div className="money-field mt-3">
              <span className="money-affix" aria-hidden>
                $
              </span>
              <input
                ref={rebookRef}
                required
                value={rebookPrice}
                onChange={(event) => setRebookPrice(event.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="128.00"
                className="field"
                inputMode="decimal"
                aria-label="New actual total paid"
              />
            </div>
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
          <form
            className="panel mt-3 max-w-lg space-y-3 p-4 text-sm"
            onSubmit={async (event) => {
              event.preventDefault();
              const email = settingsEmail.trim();
              if (email && !email.includes("@")) {
                setActionError("Enter a valid alert email, or leave it blank.");
                return;
              }
              const preferred = settingsPreferred.trim();
              const ok = await action(`/api/watches/${watch.id}`, "PATCH", {
                alertEmail: email || "",
                minimumSavingsCents: Math.round(Number(settingsThreshold) * 100),
                includeRestrictedFares: settingsRestricted,
                includeThruway: settingsThruway,
                preferredDepartureTime: preferred || null,
              });
              if (ok) {
                flashNotice("Settings saved");
                setSettingsOpen(false);
              }
            }}
          >
            <label className="block">
              Alert email · optional
              <input
                type="email"
                value={settingsEmail}
                onChange={(event) => setSettingsEmail(event.target.value)}
                className="field"
                placeholder="you@email.com"
              />
            </label>
            <label className="block">
              Alert when savings are at least
              <select
                value={settingsThreshold}
                onChange={(event) => setSettingsThreshold(event.target.value)}
                className="field"
              >
                <option value="1">$1</option>
                <option value="5">$5</option>
                <option value="10">$10</option>
                <option value="20">$20</option>
              </select>
            </label>
            <label className="block">
              Preferred departure · optional
              <input
                type="time"
                value={settingsPreferred}
                onChange={(event) => setSettingsPreferred(event.target.value)}
                className="field"
              />
            </label>
            <label className={`choice ${settingsRestricted ? "choice-on" : ""}`}>
              <input
                type="checkbox"
                checked={settingsRestricted}
                onChange={(event) => setSettingsRestricted(event.target.checked)}
              />{" "}
              Also include cheaper restricted fares
            </label>
            <label className={`choice ${settingsThruway ? "choice-on" : ""}`}>
              <input
                type="checkbox"
                checked={settingsThruway}
                onChange={(event) => setSettingsThruway(event.target.checked)}
              />{" "}
              Include Amtrak Thruway / bus connections
            </label>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              Save settings
            </button>
            <p className="text-xs text-ink-soft">
              Restricted or Thruway changes apply on the next Check now.
            </p>
          </form>
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
                {formatUsdCompact(best.totalPartyPriceCents)} — save{" "}
                {formatUsdCompact(best.savingsCents)}.
                {watch.alertEmail
                  ? ` ${watch.alertEmail}`
                  : " No alert email on this watch — add one in settings below."}
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
          <>
            <button
              type="button"
              className="dock-compare-toggle"
              aria-expanded={compareDockOpen}
              onClick={toggleCompareDock}
            >
              <span className="dock-compare-summary">
                You paid {formatUsdCompact(watch.currentBookedPriceCents)} · this train{" "}
                {formatUsdCompact(active.totalPartyPriceCents)}
                {compare.saveCents !== 0
                  ? ` · ${compare.saveCents > 0 ? "save" : "more"} ${formatUsdCompact(Math.abs(compare.saveCents))}`
                  : ""}
              </span>
              <span className="dock-compare-action">
                {compareDockOpen ? "Hide compare" : "Show compare"}
              </span>
            </button>
            {compareDockOpen ? (
              <div className={`live-compare${compare.beats ? " is-beats" : ""}`} aria-live="polite">
                <div className="live-col">
                  <p className="eyebrow opacity-70">You paid</p>
                  <p className="price serif text-2xl">
                    {formatUsdCompact(watch.currentBookedPriceCents)}
                  </p>
                </div>
                <div className="live-col">
                  <p className="eyebrow opacity-70">This train</p>
                  <p className="price serif text-2xl">
                    {formatUsdCompact(active.totalPartyPriceCents)}
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
                    {formatUsdCompact(Math.abs(compare.saveCents))}
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
            ) : null}
          </>
        ) : (
          <p className="live-hint">J / K walk · H skip · W window · Y you vs this</p>
        )}
        <div className="dock-btns">
          <div className="dock-primary">
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
              onClick={async () => {
                const next = watch.status === "PAUSED" ? "ACTIVE" : "PAUSED";
                const ok = await action(`/api/watches/${watch.id}`, "PATCH", {
                  status: next,
                });
                if (ok) flashNotice(next === "PAUSED" ? "Watch paused" : "Watch resumed");
              }}
            >
              {watch.status === "PAUSED" ? "Resume" : "Pause"}
            </button>
            <Link href={reverseHref as Route} className="btn btn-ghost">
              Watch return
            </Link>
            <button
              type="button"
              className="btn btn-ghost"
              aria-expanded={dockToolsOpen}
              onClick={() => setDockToolsOpen((value) => !value)}
            >
              {dockToolsOpen ? "Less" : "Tools"}
            </button>
            <button
              className="btn btn-ghost dock-danger"
              disabled={busy}
              onClick={() => setDeleteConfirmOpen(true)}
            >
              Delete
            </button>
          </div>
          {dockToolsOpen ? (
            <div className="dock-more">
              <div className="stay-dock">
                <span className="eyebrow">Stay</span>
                {([1, 2, 3, 4, 7] as const).map((days) => (
                  <button
                    key={days}
                    type="button"
                    className={`chip ${stayDays === days ? "chip-on" : ""}`}
                    aria-pressed={stayDays === days}
                    onClick={() => setStayDays(days)}
                  >
                    {days}d
                  </button>
                ))}
              </div>
              <button type="button" className="btn btn-ghost" onClick={() => void copyPacket()}>
                Copy packet
              </button>
            </div>
          ) : null}
        </div>
      </section>

      <ConfirmSheet
        open={deleteConfirmOpen}
        title="Delete this watch?"
        body="Your board history for this trip will be removed. This can’t be undone."
        confirmLabel="Delete watch"
        busy={busy}
        onCancel={() => setDeleteConfirmOpen(false)}
        onConfirm={async () => {
          const ok = await action(`/api/watches/${watch.id}`, "DELETE");
          if (ok) router.push("/dashboard");
          else setDeleteConfirmOpen(false);
        }}
      />

      <p className="mt-8 text-xs text-ink-soft">
        {snapshots.filter((item) => item.status !== "PROVIDER_ERROR").length} of {snapshots.length}{" "}
        days · {scanCount} scan{scanCount === 1 ? "" : "s"} · listed fares from {fareSourceLabel}.
        Confirm on Amtrak.
      </p>
    </main>
  );
}

function PriceLadder({
  ladder,
}: {
  ladder: { min: number; max: number; booked: number; marks: number[] };
}) {
  if (ladder.marks.length === 0) return null;
  const you = ladderPercent(ladder.booked, ladder.min, ladder.max);
  return (
    <section className="panel mt-4 p-4">
      <p className="text-xs uppercase tracking-[0.16em] text-ink-soft">Where you sit</p>
      <div className="ladder mt-4" aria-hidden>
        <span className="ladder-rail" />
        {ladder.marks.map((cents) => (
          <i
            key={cents}
            className={`ladder-dot ${cents < ladder.booked ? "is-save" : ""}`}
            style={{ left: `${ladderPercent(cents, ladder.min, ladder.max)}%` }}
          />
        ))}
        <span className="ladder-you" style={{ left: `${you}%` }}>
          You
        </span>
      </div>
      <p className="ladder-caption">
        Listed from {formatUsdCompact(ladder.min)} to {formatUsdCompact(ladder.max)} · you paid{" "}
        {formatUsdCompact(ladder.booked)}
      </p>
    </section>
  );
}

function ConnectionChip({ candidate }: { candidate: RankedCandidate }) {
  const note = connectionNote(candidate);
  const extra =
    note.quality === "tight" ? "chip-tight" : note.quality === "long" ? "chip-long" : "";
  return <span className={`chip ${extra}`}>{note.label}</span>;
}

function TimetableRow({
  candidate,
  index,
  yours,
  preferred,
  maxDuration,
  picked,
  pinned,
  passengers,
  feeCents,
  focused,
  beats,
  departed,
  resolver,
  onTogglePick,
  onTogglePin,
  onHide,
  onFocus,
}: {
  candidate: RankedCandidate;
  index: number;
  yours: RankedCandidate | null;
  preferred: RankedCandidate | null;
  maxDuration: number;
  picked: boolean;
  pinned: boolean;
  passengers: number;
  feeCents: number;
  focused: boolean;
  beats: boolean;
  departed: boolean;
  resolver: BookingLinkResolver;
  onTogglePick: () => void;
  onTogglePin: () => void;
  onHide: () => void;
  onFocus: () => void;
}) {
  const duration = formatDurationMinutes(candidate.journey.durationMinutes);
  const mine = yours ? candidateIsSame(candidate, yours) : false;
  const hourly = centsPerHour(candidate.totalPartyPriceCents, candidate.journey.durationMinutes);
  const each = perPersonCents(candidate.totalPartyPriceCents, passengers);
  const overnight = arrivalDateNote(candidate.journey.departureAt, candidate.journey.arrivalAt);
  const vsRide =
    yours && !mine ? formatDurationDelta(durationDeltaMinutes(yours, candidate)) : null;
  return (
    <article
      id={optionAnchor(candidate)}
      tabIndex={0}
      className={`board-row board-grid border-t border-line px-4 py-4 ${picked ? "board-row-on" : ""} ${mine ? "your-train" : ""} ${pinned ? "board-row-pin" : ""} ${focused ? "board-row-focus" : ""} ${departed ? "is-departed" : ""}`}
      onClick={(event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest("a, button, input, select, textarea, label")) return;
        onFocus();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const target = event.target as HTMLElement | null;
        if (target !== event.currentTarget) return;
        event.preventDefault();
        onFocus();
      }}
    >
      <p className="board-cell-index board-index">{String(index + 1).padStart(2, "0")}</p>
      <div className="board-cell-depart">
        <p className="board-mobile-label">Depart</p>
        <p className="price serif text-2xl md:text-xl">
          <Flap quiet>{formatClock(candidate.journey.departureAt)}</Flap>
        </p>
      </div>
      <div className="board-cell-arrive">
        <p className="board-mobile-label">Arrive</p>
        <p className="price serif text-2xl md:text-xl">
          <Flap quiet>{formatClock(candidate.journey.arrivalAt)}</Flap>
        </p>
        {overnight ? (
          <p className="text-[10px] uppercase tracking-[0.12em] text-ink-soft">{overnight}</p>
        ) : null}
      </div>
      <div className="board-cell-train min-w-0">
        <p>
          {candidate.journey.serviceName} {candidate.journey.trainNumber}
        </p>
        <p className="text-sm text-ink-soft">
          {formatDisplayDate(candidate.journey.searchedTravelDate)} ·{" "}
          {serviceTypeLabel(candidate.journey.serviceType)}
        </p>
        {candidate.journey.durationMinutes != null ? (
          <div className="duration-bar" aria-hidden>
            <span
              style={{
                width: `${durationShare(candidate.journey.durationMinutes, maxDuration)}%`,
              }}
            />
          </div>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-2">
          <ConnectionChip candidate={candidate} />
          {isAcela(candidate) ? <span className="chip">Acela</span> : null}
          {isOvernight(candidate.journey.departureAt, candidate.journey.arrivalAt) ? (
            <span className="chip">Overnight</span>
          ) : null}
          {hourly != null ? <span className="chip">{formatUsdCompact(hourly)}/hr</span> : null}
          {mine ? <span className="chip">Your train</span> : null}
          {preferred && candidateIsSame(preferred, candidate) ? (
            <span className="chip">Preferred time</span>
          ) : null}
          {candidate.fare.availability === "LIMITED" ? (
            <span className="chip">Limited seats</span>
          ) : null}
          {candidate.fare.fareFamilyRaw !== "WANDERU_LISTED" ? (
            <span className="chip">{fareFamilyLabel(candidate.fare.fareFamily)}</span>
          ) : null}
          {pinned ? <span className="chip">Pinned</span> : null}
          {beats ? <span className="chip chip-beats">Beats yours</span> : null}
        </div>
        <Legs candidate={candidate} />
        <div className="mt-2 flex flex-wrap gap-3 no-print">
          <button
            type="button"
            className={`text-xs underline ${pinned ? "text-ink" : "text-ink-soft"}`}
            onClick={onTogglePin}
          >
            {pinned ? "Unpin" : "Pin"}
          </button>
          <button
            type="button"
            className={`text-xs underline ${picked ? "text-ink" : "text-ink-soft"}`}
            onClick={onTogglePick}
          >
            {picked ? "Remove from compare" : "Compare"}
          </button>
          <button type="button" className="text-xs underline text-ink-soft" onClick={onHide}>
            Hide
          </button>
        </div>
      </div>
      <div className="board-cell-dur">
        <p className="board-mobile-label">Dur</p>
        <p className="text-sm">{duration ?? "—"}</p>
        {vsRide ? (
          <p className="text-[10px] uppercase tracking-[0.12em] opacity-70">{vsRide}</p>
        ) : null}
      </div>
      <div className="board-cell-price">
        <p className="board-mobile-label">Price</p>
        <p className="price serif text-2xl md:text-xl">
          <Flap quiet>{formatUsdCompact(candidate.totalPartyPriceCents)}</Flap>
        </p>
        {each ? <p className="text-xs opacity-70">{formatUsdCompact(each)} / person</p> : null}
      </div>
      <div className="board-cell-save">
        <p className="board-mobile-label">Save</p>
        <p className={candidate.savingsCents > 0 ? "text-sm text-save" : "text-sm opacity-70"}>
          {candidate.savingsCents > 0 ? formatUsdCompact(candidate.savingsCents) : "—"}
        </p>
        {feeCents > 0 && candidate.savingsCents > 0 ? (
          <p className="text-xs opacity-70">
            {netAfterFee(candidate.savingsCents, feeCents) > 0
              ? `${formatUsdCompact(netAfterFee(candidate.savingsCents, feeCents))} after fee`
              : "fee may wipe this"}
          </p>
        ) : null}
      </div>
      <div className="board-cell-actions no-print">
        <Handoff candidate={candidate} resolver={resolver} compact />
      </div>
    </article>
  );
}

function Legs({ candidate }: { candidate: RankedCandidate }) {
  if (candidate.journey.legs.length < 2) return null;
  return (
    <ol className="legs">
      {candidate.journey.legs.map((leg, index) => {
        const next = candidate.journey.legs[index + 1];
        const wait = next ? waitMinutes(leg.arrivalAt, next.departureAt) : null;
        return (
          <li key={`${leg.departureAt}-${index}`}>
            <span className="station-code">
              {leg.originCode} → {leg.destinationCode}
            </span>{" "}
            {formatClock(leg.departureAt)} {leg.serviceName ?? "Train"} {leg.trainNumber ?? ""} →{" "}
            {formatClock(leg.arrivalAt)}
            {wait != null ? ` · ${wait}m wait` : ""}
          </li>
        );
      })}
    </ol>
  );
}

function Handoff({
  candidate,
  resolver,
  compact = false,
}: {
  candidate: RankedCandidate;
  resolver: BookingLinkResolver;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  const handoff = resolver.resolve({ journey: candidate.journey, fare: candidate.fare });
  return (
    <div className={`space-y-2 text-sm ${compact ? "max-w-full" : ""}`}>
      <a href={handoff.url} target="_blank" rel="noreferrer" className="btn btn-primary">
        {handoff.label}
      </a>
      {compact ? null : <p className="max-w-xs text-xs text-ink-soft">{handoff.copyText}</p>}
      <button
        type="button"
        className="underline"
        onClick={async () => {
          const ok = await writeClipboard(handoff.copyText);
          setCopied(ok ? "ok" : "fail");
          window.setTimeout(() => setCopied(null), 1600);
        }}
      >
        {copied === "ok" ? "Copied" : copied === "fail" ? "Couldn’t copy" : "Copy trip details"}
      </button>
    </div>
  );
}
