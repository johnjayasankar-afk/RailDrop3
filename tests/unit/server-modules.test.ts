import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A `'use server'` module may export **only** async functions.
 *
 * Exporting a plain constant from one compiles cleanly, passes typecheck and
 * passes lint — and then every Server Action in that module fails at runtime
 * with "A 'use server' file can only export async functions, found object".
 * The whole file goes dark, not just the offending export, so the symptom is a
 * form that silently never submits.
 *
 * Types are erased before this rule applies, so `export type` and
 * `export interface` are fine. Everything else has to be an async function.
 */

const SRC = join(process.cwd(), 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory()
      ? walk(path)
      : path.endsWith('.ts') || path.endsWith('.tsx')
        ? [path]
        : [];
  });
}

function serverModules(): Array<{ path: string; source: string }> {
  return walk(SRC)
    .map((path) => ({ path, source: readFileSync(path, 'utf8') }))
    .filter(({ source }) =>
      /^\s*['"]use server['"]\s*;?\s*$/m.test(source.split('\n').slice(0, 5).join('\n')),
    );
}

describe("'use server' modules", () => {
  const modules = serverModules();

  it('exist — the scan itself has to be finding files', () => {
    expect(modules.length).toBeGreaterThan(0);
  });

  it.each(modules.map((m) => [m.path.replace(`${process.cwd()}/`, ''), m.source] as const))(
    '%s exports only async functions',
    (path, source) => {
      const offenders: string[] = [];

      for (const line of source.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('export ')) continue;
        // Type-only exports are erased before the rule applies.
        if (/^export\s+(type|interface)\b/.test(trimmed)) continue;
        if (/^export\s+\{[^}]*\}\s*from/.test(trimmed)) continue;
        if (/^export\s+async\s+function\b/.test(trimmed)) continue;
        offenders.push(trimmed.slice(0, 90));
      }

      expect(
        offenders,
        `${path} exports something that is not an async function:\n  ${offenders.join('\n  ')}\n` +
          'Move plain values into a normal module — otherwise every action in this file breaks at runtime.',
      ).toEqual([]);
    },
  );
});
