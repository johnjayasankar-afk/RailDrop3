'use server';

import { formatShortDate } from '@/lib/domain/dates';
import { formatCents } from '@/lib/domain/money';
import { getCurrentUser, getServerSupabase } from '@/lib/db/server';
import { toDateString } from '@/lib/format';

export interface PaletteTrip {
  id: string;
  originCode: string;
  destinationCode: string;
  originCity: string;
  destinationCity: string;
  dateLabel: string;
  /** Date plus what you paid — two trips on the same route and date are
   *  otherwise indistinguishable in a one-line result row. */
  hint: string;
}

/**
 * A light trip list for the command palette. Deliberately separate from the
 * dashboard query: the palette needs five columns, not a full render.
 */
export async function searchTripsAction(): Promise<PaletteTrip[]> {
  const user = await getCurrentUser();
  if (!user) return [];

  const db = await getServerSupabase();
  const { data } = await db
    .from('watches')
    .select('id, origin_code, destination_code, desired_date, benchmark_cents, status')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(50);

  const rows = (data ?? []) as Array<{
    id: string;
    origin_code: string;
    destination_code: string;
    desired_date: string;
    benchmark_cents: number;
    status: string;
  }>;
  if (rows.length === 0) return [];

  const codes = [...new Set(rows.flatMap((r) => [r.origin_code, r.destination_code]))];
  const { data: stations } = await db.from('stations').select('code, city').in('code', codes);
  const cityByCode = new Map(
    ((stations ?? []) as Array<{ code: string; city: string }>).map((s) => [s.code, s.city]),
  );

  return rows.map((row) => {
    const dateLabel = formatShortDate(toDateString(row.desired_date));
    const paid = formatCents(row.benchmark_cents, { showCents: false });
    const state = row.status === 'ACTIVE' ? '' : ` · ${row.status.toLowerCase()}`;
    return {
      id: row.id,
      originCode: row.origin_code,
      destinationCode: row.destination_code,
      originCity: cityByCode.get(row.origin_code) ?? '',
      destinationCity: cityByCode.get(row.destination_code) ?? '',
      dateLabel,
      hint: `${dateLabel} · ${paid}${state}`,
    };
  });
}
