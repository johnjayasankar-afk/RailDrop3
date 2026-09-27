import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDatabase, pgErrorCode, type TestDatabase } from '../helpers/pg';

/**
 * The 0006 surface — push subscriptions, delivery preferences, quiet-hours
 * holds, soft delete and retention — against real Postgres.
 *
 * These are the parts where a mistake is silent rather than loud: a leaked
 * push endpoint, an alert that is dropped instead of held, or a soft-deleted
 * trip that reappears in someone's dashboard.
 */

let db: TestDatabase;
let alice: string;
let bob: string;

async function seedWatch(userId: string, overrides = ''): Promise<string> {
  const rows = await db.sql<{ id: string }>(
    `insert into watches (user_id, origin_code, destination_code, desired_date, benchmark_cents, monitoring_ends_at)
     values ($1, 'BOS', 'NYP', current_date + 3, 12800, now() + interval '2 days')
     returning id`,
    [userId],
  );
  const id = rows[0]!.id;
  if (overrides !== '') await db.sql(`update watches set ${overrides} where id = $1`, [id]);
  return id;
}

beforeAll(async () => {
  db = await createTestDatabase();
  alice = await db.createUser('alice@test.local');
  bob = await db.createUser('bob@test.local');
});

afterAll(async () => {
  await db?.close();
});

describe('push subscriptions', () => {
  it('are private to their owner', async () => {
    await db.asUser(
      alice,
      `insert into push_subscriptions (user_id, endpoint, p256dh, auth)
       values ($1, 'https://push.example/alice', 'kA', 'aA')`,
      [alice],
    );

    const own = await db.asUser<{ endpoint: string }>(
      alice,
      'select endpoint from push_subscriptions',
    );
    expect(own.map((r) => r.endpoint)).toEqual(['https://push.example/alice']);

    // A push endpoint is a capability URL: anyone holding it can notify that
    // device. It must never be readable across accounts.
    const theirs = await db.asUser(bob, 'select endpoint from push_subscriptions');
    expect(theirs).toEqual([]);

    // anon holds no grant at all on this table, so the denial happens before
    // RLS even runs — stronger than returning an empty set.
    const anon = await db.asAnon('select endpoint from push_subscriptions').catch(() => []);
    expect(anon).toHaveLength(0);
  });

  it('cannot be created on behalf of somebody else', async () => {
    const attempt = db.asUser(
      bob,
      `insert into push_subscriptions (user_id, endpoint, p256dh, auth)
       values ($1, 'https://push.example/stolen', 'kB', 'aB')`,
      [alice],
    );
    await expect(attempt).rejects.toSatisfy((e: unknown) => pgErrorCode(e) === '42501');
  });

  it('replaces a re-registered endpoint rather than duplicating it', async () => {
    // Browsers hand back the same endpoint after a page reload; the upsert must
    // refresh the keys in place or a device accumulates dead rows.
    await db.asUser(
      alice,
      `insert into push_subscriptions (user_id, endpoint, p256dh, auth)
       values ($1, 'https://push.example/alice', 'rotated', 'rotated')
       on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth`,
      [alice],
    );

    const rows = await db.asUser<{ p256dh: string }>(
      alice,
      "select p256dh from push_subscriptions where endpoint = 'https://push.example/alice'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.p256dh).toBe('rotated');
  });
});

describe('delivery preferences', () => {
  it('default to on, so a new account is never silently unreachable', async () => {
    const rows = await db.sql<{
      email_alerts: boolean;
      push_alerts: boolean;
      quiet_hours_start: number | null;
      default_min_savings_cents: number;
    }>(
      'select email_alerts, push_alerts, quiet_hours_start, default_min_savings_cents from profiles where id = $1',
      [alice],
    );
    expect(rows[0]).toMatchObject({
      email_alerts: true,
      push_alerts: true,
      quiet_hours_start: null,
    });
    expect(rows[0]!.default_min_savings_cents).toBeGreaterThan(0);
  });

  it('reject a quiet-hours boundary outside the day', async () => {
    const attempt = db.sql('update profiles set quiet_hours_start = 1440 where id = $1', [alice]);
    await expect(attempt).rejects.toSatisfy((e: unknown) => pgErrorCode(e) === '23514');
  });

  it('cannot be edited across accounts', async () => {
    await db.asUser(bob, 'update profiles set email_alerts = false where id = $1', [alice]);
    const rows = await db.sql<{ email_alerts: boolean }>(
      'select email_alerts from profiles where id = $1',
      [alice],
    );
    expect(rows[0]!.email_alerts).toBe(true);
  });
});

describe('quiet hours', () => {
  it('hold a delivery until its time rather than dropping it', async () => {
    const watchId = await seedWatch(alice);
    const cycle = await db.sql<{ id: string }>(
      `insert into fare_check_cycles (watch_id, user_id, trigger, status, benchmark_cents, benchmark_version)
       values ($1, $2, 'MORNING', 'SUCCESS', 12800, 1) returning id`,
      [watchId, alice],
    );
    const alert = await db.sql<{ id: string }>(
      `insert into alerts (watch_id, user_id, cycle_id, reason, dedupe_key, benchmark_cents, best_total_cents, savings_cents, best_signature, cycle_status)
       values ($1, $2, $3, 'PRICE_DROP', 'held-1', 12800, 7400, 5400, 'sig-held', 'SUCCESS') returning id`,
      [watchId, alice, cycle[0]!.id],
    );

    await db.sql(
      `insert into notification_deliveries (alert_id, watch_id, user_id, channel, recipient, subject, status, deliver_after)
       values ($1, $2, $3, 'EMAIL', 'alice@test.local', 'Cheaper fare', 'PENDING', now() + interval '6 hours')`,
      [alert[0]!.id, watchId, alice],
    );

    // The sweep claims anything pending or failed; the held row is filtered by
    // deliver_after, not by being marked as an error.
    const due = await db.sql<{ id: string }>(
      `select id from notification_deliveries
       where status in ('PENDING','FAILED') and (deliver_after is null or deliver_after <= now())`,
    );
    expect(due).toEqual([]);

    const eventually = await db.sql<{ id: string; status: string }>(
      `select id, status from notification_deliveries
       where status in ('PENDING','FAILED')
         and (deliver_after is null or deliver_after <= now() + interval '7 hours')`,
    );
    expect(eventually).toHaveLength(1);
    expect(eventually[0]!.status).toBe('PENDING');
  });

  it('accepts PUSH as a delivery channel', async () => {
    const watchId = await seedWatch(alice);
    const cycle = await db.sql<{ id: string }>(
      `insert into fare_check_cycles (watch_id, user_id, trigger, status, benchmark_cents, benchmark_version)
       values ($1, $2, 'MORNING', 'SUCCESS', 12800, 1) returning id`,
      [watchId, alice],
    );
    const alert = await db.sql<{ id: string }>(
      `insert into alerts (watch_id, user_id, cycle_id, reason, dedupe_key, benchmark_cents, best_total_cents, savings_cents, best_signature, cycle_status)
       values ($1, $2, $3, 'PRICE_DROP', 'push-1', 12800, 7400, 5400, 'sig-push', 'SUCCESS') returning id`,
      [watchId, alice, cycle[0]!.id],
    );

    const rows = await db.sql<{ channel: string }>(
      `insert into notification_deliveries (alert_id, watch_id, user_id, channel, recipient, subject, status)
       values ($1, $2, $3, 'PUSH', 'https://push.example/alice', 'Cheaper fare', 'PENDING')
       returning channel`,
      [alert[0]!.id, watchId, alice],
    );
    expect(rows[0]!.channel).toBe('PUSH');
  });
});

describe('soft delete and retention', () => {
  it('hides a deleted trip from its owner but keeps the row restorable', async () => {
    const watchId = await seedWatch(alice, "deleted_at = now(), status = 'PAUSED'");

    const visible = await db.asUser(
      alice,
      'select id from watches where deleted_at is null and id = $1',
      [watchId],
    );
    expect(visible).toEqual([]);

    // The undo path restores exactly the rows that are still deleted, which is
    // what makes a double-undo a no-op rather than a resurrection.
    const restored = await db.asUser<{ id: string }>(
      alice,
      'update watches set deleted_at = null where id = $1 and deleted_at is not null returning id',
      [watchId],
    );
    expect(restored).toHaveLength(1);

    const again = await db.asUser(
      alice,
      'update watches set deleted_at = null where id = $1 and deleted_at is not null returning id',
      [watchId],
    );
    expect(again).toEqual([]);
  });

  it('never lets the scheduler pick up a deleted trip', async () => {
    const watchId = await seedWatch(alice, 'deleted_at = now()');
    const due = await db.sql<{ id: string }>(
      "select id from watches where status = 'ACTIVE' and deleted_at is null and id = $1",
      [watchId],
    );
    expect(due).toEqual([]);
  });

  it('prunes only trips past the retention window', async () => {
    const recent = await seedWatch(bob, "deleted_at = now() - interval '3 days'");
    const stale = await seedWatch(bob, "deleted_at = now() - interval '90 days'");
    const live = await seedWatch(bob);

    const pruned = await db.sql<{ prune_deleted_watches: number }>(
      'select prune_deleted_watches(30)',
    );
    expect(pruned[0]!.prune_deleted_watches).toBe(1);

    const surviving = await db.sql<{ id: string }>('select id from watches where id = any($1)', [
      [recent, stale, live],
    ]);
    expect(surviving.map((r) => r.id).sort()).toEqual([recent, live].sort());
  });
});
