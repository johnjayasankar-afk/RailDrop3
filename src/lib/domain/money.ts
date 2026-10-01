export function dollarsToCents(value: string | number): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return Math.round(value * 100);
  }

  const cleaned = value.replace(/[^0-9.-]/g, "").trim();
  if (!cleaned || cleaned === "-" || cleaned === ".") return null;
  const parsed = Number.parseFloat(cleaned);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100);
}

export function formatUsd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${sign}$${dollars.toLocaleString("en-US")}.${remainder.toString().padStart(2, "0")}`;
}

export function formatUsdCompact(cents: number): string {
  if (cents % 100 === 0) {
    const sign = cents < 0 ? "-" : "";
    return `${sign}$${Math.abs(cents / 100).toLocaleString("en-US")}`;
  }
  return formatUsd(cents);
}

/* A derived rate, to the dollar.
 *
 * Cost-per-hour is arithmetic on a fare and a duration, and it rendered as
 * "$29.42/hr" — two decimal places on a quotient, which reads as a measured
 * amount of money rather than a comparison. Nobody uses the cents: the figure
 * exists so a $126 four-hour train and a $141 three-hour one can be ranked at
 * a glance, and the exact fare is on the same line. Rounded, not truncated, so
 * the rate never reads lower than it is. */
export function formatUsdPerHour(cents: number): string {
  return formatUsdCompact(Math.round(cents / 100) * 100);
}

export function savingsCents(bookedCents: number, candidateCents: number): number {
  return bookedCents - candidateCents;
}

export function meetsSavingsThreshold(
  bookedCents: number,
  candidateCents: number,
  minimumSavingsCents: number,
): boolean {
  return savingsCents(bookedCents, candidateCents) >= minimumSavingsCents;
}

export function partyTotalCents(perTravelerCents: number, passengerCount: number): number {
  return perTravelerCents * passengerCount;
}
