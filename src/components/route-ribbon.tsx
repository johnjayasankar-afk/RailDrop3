import { stationSubtitle } from "@/lib/stations/catalog";

export function RouteRibbon({
  origin,
  destination,
  compact = false,
}: {
  origin: string;
  destination: string;
  compact?: boolean;
}) {
  return (
    <div className={`route-ribbon ${compact ? "route-ribbon-compact" : ""}`}>
      <div>
        <p className="station-code">{origin}</p>
        {compact ? null : <p className="mt-1 text-xs text-ink-soft">{stationSubtitle(origin)}</p>}
      </div>
      <div className="route-track" aria-hidden>
        <i />
        <span />
        <i />
      </div>
      <div className="text-right">
        <p className="station-code">{destination}</p>
        {compact ? null : (
          <p className="mt-1 text-xs text-ink-soft">{stationSubtitle(destination)}</p>
        )}
      </div>
    </div>
  );
}
