/**
 * Loads .env.local then .env into process.env for CLI scripts.
 *
 * Without this, every command in SETUP_REQUIRED.md runs with an empty
 * environment and reports the variable you just finished setting as missing.
 * Written by hand rather than pulled in as a dependency: it is twenty lines, it
 * runs before anything else, and it must never be the reason an install fails.
 *
 * Existing environment variables always win, so `FOO=x npm run ...` overrides
 * the file, which is what an operator expects.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function parse(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function loadEnvFiles(cwd: string = process.cwd()): string[] {
  const loaded: string[] = [];
  // .env.local first so it takes precedence over .env.
  for (const file of ['.env.local', '.env']) {
    const path = join(cwd, file);
    if (!existsSync(path)) continue;
    const values = parse(readFileSync(path, 'utf8'));
    let applied = 0;
    for (const [key, value] of Object.entries(values)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
        applied += 1;
      }
    }
    loaded.push(`${file} (${applied} vars)`);
  }
  return loaded;
}

loadEnvFiles();
