import { formatClock } from "@/lib/domain/timezone";
import { waitMinutes } from "@/lib/domain/board-insights";
import type { RankedCandidate } from "@/lib/domain/types";

export function Legs({ candidate }: { candidate: RankedCandidate }) {
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
