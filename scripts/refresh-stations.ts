/**
 * Refreshes the local station catalog from the provider's `get_stations`
 * endpoint. Deliberately manual: station data changes rarely, and typeahead must
 * never spend credits.
 *
 * Cost: one request (~2 credits).
 */

import './load-env';
import { Client } from 'pg';
import { getServerEnv } from '../src/lib/env';

interface StationLike {
  code?: string;
  stationCode?: string;
  name?: string;
  stationName?: string;
  city?: string;
  state?: string;
  timezone?: string;
}

function pickStations(payload: unknown): StationLike[] {
  const containers = ['stations', 'data', 'results', 'items'];
  if (Array.isArray(payload)) return payload as StationLike[];
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    for (const key of containers) {
      const value = record[key];
      if (Array.isArray(value)) return value as StationLike[];
      if (value && typeof value === 'object') {
        const nested = pickStations(value);
        if (nested.length > 0) return nested;
      }
    }
  }
  return [];
}

async function main(): Promise<void> {
  const env = getServerEnv();
  if (!env.parseApiKey) {
    console.error('PARSE_API_KEY is not set.');
    process.exit(1);
  }
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    console.error('SUPABASE_DB_URL is not set.');
    process.exit(1);
  }

  const url = `${env.parseBaseUrl}/scraper/${env.parseScraperId}/get_stations`;
  console.log(`Fetching station catalog (1 request, ~2 credits)...`);

  const response = await fetch(url, {
    headers: { 'X-API-Key': env.parseApiKey, Accept: 'application/json' },
    signal: AbortSignal.timeout(env.providerTimeoutMs),
  });
  if (!response.ok) {
    console.error(`Provider returned HTTP ${response.status}`);
    console.error((await response.text()).slice(0, 400));
    process.exit(1);
  }

  const stations = pickStations(await response.json());
  const normalized = stations
    .map((s) => ({
      code: (s.code ?? s.stationCode ?? '').toUpperCase().trim(),
      name: (s.name ?? s.stationName ?? '').trim(),
      city: (s.city ?? '').trim(),
      state: (s.state ?? '').trim(),
      timezone: s.timezone ?? null,
    }))
    .filter((s) => /^[A-Z]{3}$/.test(s.code) && s.name !== '');

  if (normalized.length === 0) {
    console.error('No usable stations found in the response — the shape may have changed.');
    console.error('The existing local catalog has been left untouched.');
    process.exit(1);
  }

  console.log(`Parsed ${normalized.length} stations. Upserting...`);

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    for (const station of normalized) {
      await client.query(
        `insert into public.stations (code, name, city, state, timezone)
         values ($1,$2,$3,$4,$5)
         on conflict (code) do update set name = excluded.name, city = excluded.city,
           state = excluded.state, timezone = coalesce(excluded.timezone, stations.timezone),
           updated_at = now()`,
        [
          station.code,
          station.name,
          station.city || station.name,
          station.state || '--',
          station.timezone,
        ],
      );
    }
    const count = await client.query<{ count: string }>('select count(*) from public.stations');
    console.log(`Station catalog now has ${count.rows[0]?.count} rows.`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
