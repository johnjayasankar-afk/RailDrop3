import type { PGlite } from '@electric-sql/pglite';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * A supabase-js-shaped client backed by REAL Postgres (PGlite).
 *
 * The point is fidelity: integration tests run the actual dispatcher, batch
 * runner and alert service — not reimplementations — against real constraints,
 * real unique-violation codes (23505), real `FOR UPDATE SKIP LOCKED`, and the
 * real SECURITY DEFINER functions. A hand-rolled in-memory fake could pass while
 * production failed; this cannot.
 *
 * It implements exactly the query surface RailDrop uses, and throws loudly on
 * anything it does not understand rather than silently returning empty data.
 */

interface PgError {
  message: string;
  code: string | null;
  details: string | null;
  hint: string | null;
}

interface Result<T> {
  data: T;
  error: PgError | null;
  count: number | null;
  status: number;
}

type Filter =
  | { kind: 'eq' | 'gt' | 'gte' | 'lt' | 'lte' | 'neq'; column: string; value: unknown }
  | { kind: 'in'; column: string; values: unknown[] }
  | { kind: 'not-in'; column: string; raw: string }
  | { kind: 'not-is'; column: string }
  | { kind: 'is'; column: string; value: null }
  | { kind: 'or'; expression: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toArrayLiteral(value: unknown[]): string {
  return `{${value.map((v) => (v === null ? 'NULL' : `"${String(v).replace(/"/g, '\\"')}"`)).join(',')}}`;
}

function toParam(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return toArrayLiteral(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

/**
 * Encode a value for a specific column. Postgres distinguishes a jsonb array
 * (JSON text) from a native array column (an array literal); PostgREST hides
 * this behind JSON, so the shim has to consult the real column types.
 */
function toColumnParam(value: unknown, udt: string | undefined): unknown {
  if (value === null || value === undefined) return null;
  if (udt === 'json' || udt === 'jsonb') return JSON.stringify(value);
  if (udt?.startsWith('_')) {
    return Array.isArray(value) ? toArrayLiteral(value) : toArrayLiteral([value]);
  }
  return toParam(value);
}

/** table -> column -> udt_name, loaded once per table. */
const columnTypeCache = new Map<string, Map<string, string>>();

async function columnTypes(pg: PGlite, table: string): Promise<Map<string, string>> {
  const cached = columnTypeCache.get(table);
  if (cached) return cached;
  const result = await pg.query<{ column_name: string; udt_name: string }>(
    `select column_name, udt_name from information_schema.columns
      where table_schema = 'public' and table_name = $1`,
    [table],
  );
  const map = new Map(result.rows.map((r) => [r.column_name, r.udt_name]));
  columnTypeCache.set(table, map);
  return map;
}

export interface ScopedRunner {
  userId: string;
}

/**
 * PGlite is ONE connection. Scoped reads wrap each statement in an explicit
 * transaction (BEGIN; set local role; ...; COMMIT) so RLS applies — but two
 * concurrent requests sharing that connection would interleave their
 * transaction control and clobber each other, which shows up as a write that
 * silently does not stick. Everything therefore queues through one chain.
 *
 * The chain lives on globalThis, NOT in module scope: Next bundles each route
 * separately, so a module-level variable gives every route its own private copy
 * and serializes nothing at all.
 */
const QUEUE_KEY = Symbol.for('raildrop.e2e.pgqueue');
type QueueHolder = { [QUEUE_KEY]?: Promise<unknown> };
const holder = globalThis as unknown as QueueHolder;
holder[QUEUE_KEY] ??= Promise.resolve();

export function serializePg<T>(task: () => Promise<T>): Promise<T> {
  return serialize(task);
}

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const previous = holder[QUEUE_KEY] as Promise<unknown>;
  const run = previous.then(task, task);
  // Keep the chain alive regardless of individual failures.
  holder[QUEUE_KEY] = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Run a statement either as the owner (service role) or, when scoped, inside a
 * transaction as `authenticated` with the user's JWT claim set - which is
 * exactly how Supabase evaluates RLS.
 */
/** MUST be called from inside a serializePg slot - it issues BEGIN/COMMIT. */
async function runScoped(
  pg: PGlite,
  scoped: ScopedRunner | null,
  sql: string,
  params: unknown[],
): Promise<Record<string, unknown>[]> {
  if (!scoped) {
    const result = await pg.query<Record<string, unknown>>(sql, params as never[]);
    return result.rows;
  }
  await pg.exec('begin');
  try {
    await pg.query(`select set_config('request.jwt.claim.sub', $1, true)`, [scoped.userId]);
    await pg.exec('set local role authenticated');
    const result = await pg.query<Record<string, unknown>>(sql, params as never[]);
    await pg.exec('commit');
    return result.rows;
  } catch (error) {
    await pg.exec('rollback');
    throw error;
  }
}

function normaliseError(error: unknown): PgError {
  const e = error as { message?: string; code?: string; detail?: string; hint?: string };
  return {
    message: e?.message ?? String(error),
    code: e?.code ?? null,
    details: e?.detail ?? null,
    hint: e?.hint ?? null,
  };
}

class QueryBuilder<T = Record<string, unknown>> implements PromiseLike<Result<T[] | T | null>> {
  private operation: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
  private columns = '*';
  private returning: string | null = null;
  private payload: Record<string, unknown>[] = [];
  private conflictTarget: string | null = null;
  private filters: Filter[] = [];
  private orders: Array<{ column: string; ascending: boolean }> = [];
  private limitValue: number | null = null;
  private rowMode: 'many' | 'single' | 'maybeSingle' = 'many';
  private wantCount = false;
  private headOnly = false;

  constructor(
    private readonly pg: PGlite,
    private readonly table: string,
    private readonly scoped: ScopedRunner | null = null,
  ) {}

  select(columns = '*', options?: { count?: 'exact'; head?: boolean }): this {
    if (this.operation === 'select') this.columns = columns;
    else this.returning = columns;
    if (options?.count === 'exact') this.wantCount = true;
    if (options?.head) this.headOnly = true;
    return this;
  }

  insert(values: Record<string, unknown> | Record<string, unknown>[]): this {
    this.operation = 'insert';
    this.payload = Array.isArray(values) ? values : [values];
    return this;
  }

  upsert(
    values: Record<string, unknown> | Record<string, unknown>[],
    options?: { onConflict?: string },
  ): this {
    this.operation = 'upsert';
    this.payload = Array.isArray(values) ? values : [values];
    this.conflictTarget = options?.onConflict ?? null;
    return this;
  }

  update(values: Record<string, unknown>): this {
    this.operation = 'update';
    this.payload = [values];
    return this;
  }

  delete(): this {
    this.operation = 'delete';
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ kind: 'eq', column, value });
    return this;
  }
  neq(column: string, value: unknown): this {
    this.filters.push({ kind: 'neq', column, value });
    return this;
  }
  gt(column: string, value: unknown): this {
    this.filters.push({ kind: 'gt', column, value });
    return this;
  }
  gte(column: string, value: unknown): this {
    this.filters.push({ kind: 'gte', column, value });
    return this;
  }
  lt(column: string, value: unknown): this {
    this.filters.push({ kind: 'lt', column, value });
    return this;
  }
  lte(column: string, value: unknown): this {
    this.filters.push({ kind: 'lte', column, value });
    return this;
  }
  is(column: string, value: null): this {
    this.filters.push({ kind: 'is', column, value });
    return this;
  }
  in(column: string, values: unknown[]): this {
    this.filters.push({ kind: 'in', column, values });
    return this;
  }
  or(expression: string): this {
    this.filters.push({ kind: 'or', expression });
    return this;
  }

  /**
   * Supports the PostgREST forms used in this codebase:
   *   not(col, 'in', '("A","B")')  and  not(col, 'is', null).
   * An unsupported operator throws rather than silently matching everything —
   * a shim that quietly widens a filter would turn a scoped query into a
   * table scan and make the test suite lie.
   */
  not(column: string, operator: string, value: unknown): this {
    if (operator === 'in') {
      this.filters.push({ kind: 'not-in', column, raw: String(value) });
      return this;
    }
    if (operator === 'is' && value === null) {
      this.filters.push({ kind: 'not-is', column });
      return this;
    }
    throw new Error(`pglite-supabase: unsupported not(${operator})`);
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.orders.push({ column, ascending: options?.ascending ?? true });
    return this;
  }

  limit(count: number): this {
    this.limitValue = count;
    return this;
  }

  single(): this {
    this.rowMode = 'single';
    return this;
  }

  maybeSingle(): this {
    this.rowMode = 'maybeSingle';
    return this;
  }

  private buildWhere(params: unknown[]): string {
    if (this.filters.length === 0) return '';
    const clauses = this.filters.map((filter) => {
      switch (filter.kind) {
        case 'eq':
        case 'neq':
        case 'gt':
        case 'gte':
        case 'lt':
        case 'lte': {
          const ops = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' } as const;
          params.push(toParam(filter.value));
          return `${filter.column} ${ops[filter.kind]} $${params.length}`;
        }
        case 'is':
          return `${filter.column} is null`;
        case 'not-is':
          return `${filter.column} is not null`;
        case 'in': {
          if (filter.values.length === 0) return 'false';
          const placeholders = filter.values.map((value) => {
            params.push(toParam(value));
            return `$${params.length}`;
          });
          return `${filter.column} in (${placeholders.join(',')})`;
        }
        case 'not-in': {
          const values = filter.raw
            .replace(/^\(|\)$/g, '')
            .split(',')
            .map((v) => v.trim().replace(/^"|"$/g, ''));
          const placeholders = values.map((value) => {
            params.push(value);
            return `$${params.length}`;
          });
          return `${filter.column} not in (${placeholders.join(',')})`;
        }
        case 'or': {
          // PostgREST `or=(a.ilike.%x%,b.ilike.%x%)` form, as used by station search.
          const parts = filter.expression.split(',').map((part) => {
            const [column, operator, ...rest] = part.split('.');
            const value = rest.join('.');
            if (operator !== 'ilike')
              throw new Error(`pglite-supabase: unsupported or(${operator})`);
            params.push(value);
            return `${column} ilike $${params.length}`;
          });
          return `(${parts.join(' or ')})`;
        }
      }
    });
    return ` where ${clauses.join(' and ')}`;
  }

  private async buildSql(): Promise<{ sql: string; params: unknown[] }> {
    const params: unknown[] = [];
    const types = await columnTypes(this.pg, this.table);

    if (this.operation === 'select') {
      const projection = this.headOnly && this.wantCount ? 'count(*)::int as count' : this.columns;
      let sql = `select ${projection} from ${this.table}`;
      sql += this.buildWhere(params);
      if (!this.headOnly) {
        if (this.orders.length > 0) {
          sql += ` order by ${this.orders.map((o) => `${o.column} ${o.ascending ? 'asc' : 'desc'}`).join(', ')}`;
        }
        if (this.limitValue !== null) sql += ` limit ${this.limitValue}`;
      }
      return { sql, params };
    }

    if (this.operation === 'insert' || this.operation === 'upsert') {
      const columns = [...new Set(this.payload.flatMap((row) => Object.keys(row)))];
      if (columns.length === 0) throw new Error('pglite-supabase: insert with no columns');
      const tuples = this.payload.map((row) => {
        const placeholders = columns.map((column) => {
          params.push(toColumnParam(row[column] ?? null, types.get(column)));
          return `$${params.length}`;
        });
        return `(${placeholders.join(',')})`;
      });
      let sql = `insert into ${this.table} (${columns.join(',')}) values ${tuples.join(',')}`;
      if (this.operation === 'upsert') {
        const target = this.conflictTarget ?? 'id';
        const updates = columns.filter(
          (c) =>
            !target
              .split(',')
              .map((t) => t.trim())
              .includes(c),
        );
        sql +=
          updates.length > 0
            ? ` on conflict (${target}) do update set ${updates.map((c) => `${c} = excluded.${c}`).join(', ')}`
            : ` on conflict (${target}) do nothing`;
      }
      sql += ` returning ${this.returning ?? '*'}`;
      return { sql, params };
    }

    if (this.operation === 'update') {
      const row = this.payload[0] ?? {};
      const assignments = Object.keys(row).map((column) => {
        params.push(toColumnParam(row[column] ?? null, types.get(column)));
        return `${column} = $${params.length}`;
      });
      let sql = `update ${this.table} set ${assignments.join(', ')}`;
      sql += this.buildWhere(params);
      sql += ` returning ${this.returning ?? 'id'}`;
      return { sql, params };
    }

    let sql = `delete from ${this.table}`;
    sql += this.buildWhere(params);
    sql += ` returning ${this.returning ?? 'id'}`;
    return { sql, params };
  }

  async run(): Promise<Result<T[] | T | null>> {
    try {
      const rows = await serializePg(async () => {
        const { sql, params } = await this.buildSql();
        return runScoped(this.pg, this.scoped, sql, params);
      });

      if (this.headOnly && this.wantCount) {
        const count = Number((rows[0] as { count?: number } | undefined)?.count ?? 0);
        return { data: null, error: null, count, status: 200 };
      }

      if (this.rowMode === 'single') {
        if (rows.length !== 1) {
          return {
            data: null,
            error: {
              message: `JSON object requested, multiple (or no) rows returned (${rows.length})`,
              code: 'PGRST116',
              details: null,
              hint: null,
            },
            count: null,
            status: 406,
          };
        }
        return { data: rows[0] as T, error: null, count: null, status: 200 };
      }

      if (this.rowMode === 'maybeSingle') {
        return { data: (rows[0] as T) ?? null, error: null, count: null, status: 200 };
      }

      return {
        data: rows as T[],
        error: null,
        count: this.wantCount ? rows.length : null,
        status: 200,
      };
    } catch (error) {
      return { data: null, error: normaliseError(error), count: null, status: 400 };
    }
  }

  then<R1 = Result<T[] | T | null>, R2 = never>(
    onfulfilled?: ((value: Result<T[] | T | null>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.run().then(onfulfilled, onrejected);
  }
}

/** Cache of function argument names/types, so RPC params get the right casts. */
const signatureCache = new Map<string, Array<{ name: string; type: string }>>();

async function functionSignature(
  pg: PGlite,
  name: string,
): Promise<Array<{ name: string; type: string }>> {
  const cached = signatureCache.get(name);
  if (cached) return cached;

  const result = await pg.query<{ args: string }>(
    `select pg_get_function_arguments(p.oid) as args
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = $1
      limit 1`,
    [name],
  );
  const raw = result.rows[0]?.args ?? '';
  const parsed = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const withoutDefault = part.split(' DEFAULT ')[0] ?? part;
      const tokens = withoutDefault.trim().split(/\s+/);
      const argName = tokens.shift() ?? '';
      return { name: argName, type: tokens.join(' ') || 'text' };
    })
    .filter((a) => a.name !== '');

  signatureCache.set(name, parsed);
  return parsed;
}

export interface PgliteClientOptions {
  /**
   * When set, every statement runs inside a transaction as the `authenticated`
   * role with this user's JWT claim, so RLS is genuinely enforced.
   */
  asUserId?: string | null;
}

export function createPgliteSupabase(
  pg: PGlite,
  options: PgliteClientOptions = {},
): SupabaseClient {
  const scoped: ScopedRunner | null = options.asUserId ? { userId: options.asUserId } : null;

  const client = {
    from<T = Record<string, unknown>>(table: string) {
      return new QueryBuilder<T>(pg, table, scoped);
    },

    async rpc(name: string, args: Record<string, unknown> = {}) {
      try {
        const rows = await serializePg(async () => {
          const signature = await functionSignature(pg, name);
          const params: unknown[] = [];
          const callArgs = signature
            .filter((arg) => arg.name in args)
            .map((arg) => {
              const value = args[arg.name];
              params.push(toParam(value));
              return `${arg.name} => $${params.length}::${arg.type}`;
            });

          const result = await pg.query<Record<string, unknown>>(
            `select * from public.${name}(${callArgs.join(', ')})`,
            params as never[],
          );
          return result.rows;
        });

        // A scalar-returning function yields one row, one column named after it.
        if (
          rows.length === 1 &&
          Object.keys(rows[0] ?? {}).length === 1 &&
          name in (rows[0] ?? {})
        ) {
          const scalar = (rows[0] as Record<string, unknown>)[name];
          return { data: scalar === '' ? null : scalar, error: null };
        }
        return { data: rows, error: null };
      } catch (error) {
        return { data: null, error: normaliseError(error) };
      }
    },
  };

  return client as unknown as SupabaseClient;
}

export { UUID_RE };
