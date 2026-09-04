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
