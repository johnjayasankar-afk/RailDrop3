import { ladderPercent } from "@/lib/domain/board-act";
import { formatUsdCompact } from "@/lib/domain/money";

export function PriceLadder({
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
      <p className="mt-5 text-xs text-ink-soft">
        Listed from {formatUsdCompact(ladder.min)} to {formatUsdCompact(ladder.max)} · you paid{" "}
        {formatUsdCompact(ladder.booked)}
      </p>
    </section>
  );
}
