import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Per-route JavaScript budget.
 *
 * Bundle regressions are invisible in review: one import at module scope in a
 * client component pulls a whole SDK into the first load, nothing fails, and
 * the page is simply slower forever. `/login` reached 175 kB that way — the
 * heaviest route in the app, on the first page an unauthenticated visitor ever
 * sees — because a ~70 kB Supabase client was imported statically for a call
 * that only happens on submit.
 *
 * Budgets are set a little above today's numbers: enough headroom for ordinary
 * work, tight enough that an accidental SDK trips it. `/login` at its old size
 * would fail its budget by nearly 60 kB.
 *
 * Measured **gzipped**, because that is what a browser actually downloads —
 * and it is the same figure `next build` prints as "First Load JS", so the two
 * can be compared directly.
 */

const DIST = process.env.NEXT_DIST_DIR ?? '.next';
const ROOT = process.cwd();

/** Route → maximum First Load JS, gzipped kilobytes. */
const BUDGETS: Record<string, number> = {
  '/page': 118,
  '/login/page': 118,
  '/dashboard/page': 125,
  '/watches/[id]/page': 131,
  '/watches/new/page': 124,
  '/settings/page': 124,
  '/alerts/page': 118,
  '/usage/page': 118,
};

/** Every route carries the layout; it is the floor nothing can go below. */
const SHARED_BUDGET_KB = 128;

interface Manifest {
  pages: Record<string, string[]>;
}

function sizeOf(file: string): number {
  try {
    return gzipSync(readFileSync(join(ROOT, DIST, file))).length;
  } catch {
    return 0;
  }
}

function main(): void {
  let manifest: Manifest;
  try {
    manifest = JSON.parse(
      readFileSync(join(ROOT, DIST, 'app-build-manifest.json'), 'utf8'),
    ) as Manifest;
  } catch {
    console.error(`check:budget — no build found in ${DIST}. Run \`npm run build\` first.`);
    process.exit(1);
  }

  const failures: string[] = [];
  const report: Array<[string, number, number]> = [];

  for (const [route, budgetKb] of Object.entries(BUDGETS)) {
    const files = manifest.pages[route];
    if (!files) {
      // A renamed or deleted route must fail loudly rather than pass by
      // silently measuring nothing.
      failures.push(`${route}: not present in the build manifest — has it moved?`);
      continue;
    }

    // Unique files only: a chunk listed twice is still downloaded once.
    const bytes = [...new Set(files)].reduce((total, file) => total + sizeOf(file), 0);
    const kb = bytes / 1024;
    report.push([route, kb, budgetKb]);
    if (kb > budgetKb) {
      failures.push(`${route}: ${kb.toFixed(1)} kB exceeds its ${budgetKb} kB budget`);
    }
  }

  const shared = manifest.pages['/layout'] ?? [];
  const sharedKb = [...new Set(shared)].reduce((total, file) => total + sizeOf(file), 0) / 1024;
  if (sharedKb > SHARED_BUDGET_KB) {
    failures.push(
      `shared layout: ${sharedKb.toFixed(1)} kB exceeds its ${SHARED_BUDGET_KB} kB budget`,
    );
  }

  for (const [route, kb, budget] of report.sort((a, b) => b[1] - a[1])) {
    const bar = kb > budget ? 'OVER ' : '     ';
    console.log(`${bar}${route.padEnd(24)} ${kb.toFixed(1).padStart(7)} kB / ${budget} kB`);
  }
  console.log(
    `     ${'(shared layout)'.padEnd(24)} ${sharedKb.toFixed(1).padStart(7)} kB / ${SHARED_BUDGET_KB} kB`,
  );

  if (failures.length > 0) {
    console.error(`\ncheck:budget — FAIL\n  ${failures.join('\n  ')}`);
    console.error(
      '\nUsually one static import of a large dependency in a client component.\n' +
        'Move it behind a dynamic import() at the point of use, or raise the budget deliberately.',
    );
    process.exit(1);
  }

  console.log(`\ncheck:budget — PASS. ${report.length} routes within budget.`);
}

main();
