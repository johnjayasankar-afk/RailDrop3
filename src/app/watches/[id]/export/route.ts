import { NextResponse } from 'next/server';

import { formatMediumDate } from '@/lib/domain/dates';
import { formatCents } from '@/lib/domain/money';
import { getCurrentUser, getServerSupabase } from '@/lib/db/server';
import { loadWatchDetail } from '@/lib/queries';
import { toDateString } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

/**
 * Export a trip.
 *
 *   ?format=csv  price history, one row per completed check
 *   ?format=ics  a calendar event for the travel date, with the trip details
 *
 * Everything here is the user's own data, read through the RLS-scoped client —
 * another user's id simply matches no rows.
 */
export async function GET(request: Request, { params }: Params): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });

  const { id } = await params;
  const format = new URL(request.url).searchParams.get('format') ?? 'csv';

  const db = await getServerSupabase();
  const detail = await loadWatchDetail(db, id);
  if (!detail) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const { row } = detail;
  const slug = `${row.origin_code}-${row.destination_code}-${toDateString(row.desired_date)}`;

  if (format === 'ics') {
    return new NextResponse(buildIcs(detail, slug), {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="raildrop-${slug}.ics"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  if (format !== 'csv') {
    return NextResponse.json({ error: 'Unsupported format.' }, { status: 400 });
  }

  const rows: string[][] = [
    [
      'checked_at',
      'trigger',
      'status',
      'dates_succeeded',
      'dates_total',
      'best_total_usd',
      'saving_vs_paid_usd',
    ],
    ...detail.recentCycles.map((cycle) => [
      String(cycle.started_at),
      cycle.trigger,
      cycle.status,
      String(cycle.dates_succeeded),
      String(cycle.dates_total),
      cycle.best_total_cents !== null ? (cycle.best_total_cents / 100).toFixed(2) : '',
      cycle.best_total_cents !== null
        ? ((row.benchmark_cents - cycle.best_total_cents) / 100).toFixed(2)
        : '',
    ]),
  ];

  return new NextResponse(toCsv(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="raildrop-${slug}-history.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}

/** RFC 4180: quote everything, double internal quotes. Also blocks CSV injection. */
function toCsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          // A leading =, +, - or @ makes a spreadsheet treat the cell as a
          // formula. Prefix it so exported data can never execute.
          const safe = /^[=+\-@]/.test(cell) ? `'${cell}` : cell;
          return `"${safe.replace(/"/g, '""')}"`;
        })
        .join(','),
    )
    .join('\r\n');
}

function icsEscape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function buildIcs(detail: Awaited<ReturnType<typeof loadWatchDetail>>, slug: string): string {
  if (!detail) return '';
  const { row } = detail;
  const date = toDateString(row.desired_date).replace(/-/g, '');
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

  const description = [
    `Route: ${row.origin_code} to ${row.destination_code}`,
    `Date: ${formatMediumDate(toDateString(row.desired_date))}`,
    `Paid: ${formatCents(row.benchmark_cents)}`,
    row.original_train_number ? `Train: ${row.original_train_number}` : null,
    row.original_departure_local ? `Departs: ${row.original_departure_local}` : null,
    `Passengers: ${row.passengers}`,
    '',
    'Watched by RailDrop. Fares and availability change; RailDrop does not modify your reservation.',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  // An all-day event: the exact departure time is context, not the commitment.
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//RailDrop//Trip//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:raildrop-${slug}@raildrop`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${date}`,
    `SUMMARY:${icsEscape(`Train ${row.origin_code} to ${row.destination_code}`)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}
