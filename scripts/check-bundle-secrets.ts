/**
 * Fails the build if any server secret reached the client bundle.
 *
 * Two passes:
 *   1. the literal VALUE of every configured secret (the real leak)
 *   2. the NAME of every server-only variable (a leak in the making, e.g. an
 *      accidental `process.env.PARSE_API_KEY` in a client component)
 *
 * This runs as part of `npm run verify`, so a regression cannot ship quietly.
 */

import './load-env';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CLIENT_DIRS = ['.next/static'];

const SERVER_ONLY_VARS = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'PARSE_API_KEY',
  'RESEND_API_KEY',
  'CRON_SECRET',
  'SUPABASE_DB_URL',
];

/** Short or placeholder values would produce meaningless matches. */
const MIN_VALUE_LENGTH = 12;

function walk(dir: string): string[] {
  let out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) out = out.concat(walk(full));
    else if (/\.(js|mjs|cjs|json|css|map)$/.test(entry)) out.push(full);
  }
  return out;
}

function main(): void {
  const files = CLIENT_DIRS.flatMap(walk);
  if (files.length === 0) {
    console.error('check:secrets — no client bundle found. Run `npm run build` first.');
    process.exit(1);
  }

  const failures: string[] = [];

  for (const file of files) {
    const contents = readFileSync(file, 'utf8');

    for (const name of SERVER_ONLY_VARS) {
      if (contents.includes(name)) {
        failures.push(`${file}: contains the server-only variable NAME "${name}"`);
      }
      const value = process.env[name];
      if (value && value.length >= MIN_VALUE_LENGTH && contents.includes(value)) {
        failures.push(`${file}: contains the VALUE of ${name} — this is a live secret leak`);
      }
    }
  }

  console.log(`check:secrets — scanned ${files.length} client bundle files.`);

  if (failures.length > 0) {
    console.error('\nSECRET LEAK DETECTED:\n');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  const configured = SERVER_ONLY_VARS.filter(
    (n) => (process.env[n] ?? '').length >= MIN_VALUE_LENGTH,
  );
  console.log(
    `check:secrets — PASS. No server-only names or values present. ` +
      `(value scan covered ${configured.length}/${SERVER_ONLY_VARS.length} secrets that are set in this environment)`,
  );
}

main();
