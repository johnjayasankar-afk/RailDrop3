import { formatUsdCompact } from "@/lib/domain/money";

export function SavingsMeter({
  bookedCents,
  foundCents,
}: {
  bookedCents: number;
  foundCents: number | null;
}) {
  if (foundCents == null || bookedCents <= 0) return null;
  const max = Math.max(bookedCents, foundCents, 1);
  const saving = bookedCents - foundCents;
  return (
    <div className="mt-4">
      <div className="flex justify-between text-xs uppercase tracking-[0.14em] text-ink-soft">
        <span>You paid {formatUsdCompact(bookedCents)}</span>
        <span className={saving > 0 ? "text-save" : ""}>
          Best now {formatUsdCompact(foundCents)}
        </span>
      </div>
      <div className="meter mt-2" aria-hidden>
        <span className="meter-booked" style={{ width: `${(bookedCents / max) * 100}%` }} />
        <span
          className={saving > 0 ? "meter-found" : "meter-even"}
          style={{ width: `${(foundCents / max) * 100}%` }}
        />
      </div>
    </div>
  );
}
