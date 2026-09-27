/**
 * Grouping linked round-trip legs for display.
 *
 * Kept pure and separate from React because the edge cases are all data
 * problems, not rendering ones: a link that points at a filtered-out row, a
 * link that points at a deleted row, and a link that is not reciprocated.
 */

export interface Leggable {
  id: string;
  linkedWatchId: string | null;
}

export type TripGroup<T extends Leggable> =
  { kind: 'single'; leg: T } | { kind: 'pair'; outbound: T; inbound: T };

/**
 * Collapse linked pairs into one group, preserving the input order.
 *
 * A pair takes the position of whichever leg came first, so the caller's sort
 * still decides where the journey lands. A leg whose partner is not in the
 * list — filtered out, soft-deleted, or never reciprocated — falls back to a
 * single rather than disappearing, because a trip vanishing from the dashboard
 * is far worse than one shown without its return.
 */
export function groupTrips<T extends Leggable>(legs: readonly T[]): Array<TripGroup<T>> {
  const byId = new Map(legs.map((leg) => [leg.id, leg]));
  const claimed = new Set<string>();
  const groups: Array<TripGroup<T>> = [];

  for (const leg of legs) {
    if (claimed.has(leg.id)) continue;

    const partnerId = leg.linkedWatchId;
    const partner = partnerId === null ? undefined : byId.get(partnerId);

    // Only pair on a reciprocated link. A one-sided link means the two rows
    // disagree about being a journey, and guessing which is right would show a
    // pairing the data does not actually support.
    if (partner && partner.id !== leg.id && partner.linkedWatchId === leg.id) {
      claimed.add(leg.id);
      claimed.add(partner.id);
      groups.push({ kind: 'pair', outbound: leg, inbound: partner });
      continue;
    }

    claimed.add(leg.id);
    groups.push({ kind: 'single', leg });
  }

  return groups;
}

/** Every leg in a group, in display order. */
export function legsOf<T extends Leggable>(group: TripGroup<T>): T[] {
  return group.kind === 'pair' ? [group.outbound, group.inbound] : [group.leg];
}
