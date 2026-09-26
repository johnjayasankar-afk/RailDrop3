"use client";

import type { BookingLinkResolver } from "@/lib/booking/booking-link-resolver";
import { arrivalDateNote, netAfterFee } from "@/lib/domain/board-act";
import {
  candidateIsSame,
  durationDeltaMinutes,
  formatDurationDelta,
} from "@/lib/domain/board-decision";
import { durationShare } from "@/lib/domain/board-moves";
import { isOvernight } from "@/lib/domain/board-insights";
import { optionAnchor, perPersonCents } from "@/lib/domain/board-picks";
import { centsPerHour, isAcela } from "@/lib/domain/board-tools";
import { formatDisplayDate, formatDurationMinutes } from "@/lib/domain/calendar";
import { fareFamilyLabel } from "@/lib/domain/fare-family";
import { formatUsdCompact } from "@/lib/domain/money";
import { serviceTypeLabel } from "@/lib/domain/service-type";
import { formatClock } from "@/lib/domain/timezone";
import type { RankedCandidate } from "@/lib/domain/types";
import { memo } from "react";
import { Flap } from "@/components/flap";
import { ConnectionChip } from "./ConnectionChip";
import { Handoff } from "./Handoff";
import { Legs } from "./Legs";

function BoardRowImpl({
  rowKey,
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
  rowKey: string;
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
  /* Key-taking rather than pre-bound, so the parent can hand every row the
     same stable function instead of building four closures per row. */
  onTogglePick: (key: string) => void;
  onTogglePin: (key: string) => void;
  onHide: (key: string) => void;
  onFocus: (key: string) => void;
}) {
  const duration = formatDurationMinutes(candidate.journey.durationMinutes);
  const mine = yours ? candidateIsSame(candidate, yours) : false;
  const hourly = centsPerHour(candidate.totalPartyPriceCents, candidate.journey.durationMinutes);
  const each = perPersonCents(candidate.totalPartyPriceCents, passengers);
  const overnight = arrivalDateNote(candidate.journey.departureAt, candidate.journey.arrivalAt);
  const vsRide =
    yours && !mine ? formatDurationDelta(durationDeltaMinutes(yours, candidate)) : null;
  return (
    <div
      id={optionAnchor(candidate)}
      role="button"
      tabIndex={0}
      className={`board-row board-grid border-t border-line px-4 py-4 ${picked ? "board-row-on" : ""} ${mine ? "your-train" : ""} ${pinned ? "board-row-pin" : ""} ${focused ? "board-row-focus" : ""} ${departed ? "is-departed" : ""}`}
      onClick={(event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest("a, button, input, select, textarea, label")) return;
        onFocus(rowKey);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const target = event.target as HTMLElement | null;
        if (target !== event.currentTarget) return;
        event.preventDefault();
        onFocus(rowKey);
      }}
    >
      <p className="board-cell-index board-index">{String(index + 1).padStart(2, "0")}</p>
      <div className="board-cell-depart">
        <p className="board-mobile-label">Depart</p>
        <p className="price serif text-2xl md:text-xl">
          <Flap>{formatClock(candidate.journey.departureAt)}</Flap>
        </p>
      </div>
      <div className="board-cell-arrive">
        <p className="board-mobile-label">Arrive</p>
        <p className="price serif text-2xl md:text-xl">
          <Flap>{formatClock(candidate.journey.arrivalAt)}</Flap>
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
            onClick={() => onTogglePin(rowKey)}
          >
            {pinned ? "Unpin" : "Pin"}
          </button>
          <button
            type="button"
            className={`text-xs underline ${picked ? "text-ink" : "text-ink-soft"}`}
            onClick={() => onTogglePick(rowKey)}
          >
            {picked ? "Remove from compare" : "Compare"}
          </button>
          <button
            type="button"
            className="text-xs underline text-ink-soft"
            onClick={() => onHide(rowKey)}
          >
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
          <Flap>{formatUsdCompact(candidate.totalPartyPriceCents)}</Flap>
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
    </div>
  );
}

/* Memoised on its props.
 *
 * A filter or sort change re-renders the whole board; without this every row
 * rebuilt its flaps, chips and handoff even when nothing about it changed. It
 * only pays off because the four callbacks above are stable — a memo whose
 * props are freshly-built closures is a memo that never hits. */
export const BoardRow = memo(BoardRowImpl);
