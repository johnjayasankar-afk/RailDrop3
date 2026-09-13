import { describe, expect, it } from 'vitest';
import {
  clockToMinutes,
  computeMonitoringEnd,
  createWatchSchema,
  rebookSchema,
} from '@/lib/services/watches';
import { isAuthorizedCron } from '@/lib/api';
import { resetServerEnvCache } from '@/lib/env';

const NY = 'America/New_York';

describe('monitoring window', () => {
  const start = new Date('2026-09-02T18:00:00.000Z');

  it('adds the preset number of hours', () => {
    expect(computeMonitoringEnd('24H', null, start, '2026-09-20', NY).toISOString()).toBe(
      '2026-09-03T18:00:00.000Z',
    );
    expect(computeMonitoringEnd('48H', null, start, '2026-09-20', NY).toISOString()).toBe(
      '2026-09-04T18:00:00.000Z',
    );
    expect(computeMonitoringEnd('72H', null, start, '2026-09-20', NY).toISOString()).toBe(
      '2026-09-05T18:00:00.000Z',
    );
  });

  it('supports a custom number of hours', () => {
    expect(computeMonitoringEnd('CUSTOM', 6, start, '2026-09-20', NY).toISOString()).toBe(
      '2026-09-03T00:00:00.000Z',
    );
  });

  it('runs to the end of the travel day for UNTIL_DEPARTURE', () => {
    // 23:59 local on 2026-09-20 in New York is 03:59Z the next day.
    expect(
      computeMonitoringEnd('UNTIL_DEPARTURE', null, start, '2026-09-20', NY).toISOString(),
    ).toBe('2026-09-21T03:59:00.000Z');
  });

  it('never monitors past the travel day, even for a long preset', () => {
    // Travel is tomorrow, so a 72h window must be truncated.
    const end = computeMonitoringEnd('72H', null, start, '2026-09-03', NY);
    expect(end.toISOString()).toBe('2026-09-04T03:59:00.000Z');
  });

  it('never produces a window that is already closed', () => {
    // Travel date already today and late in the day.
    const late = new Date('2026-09-20T23:00:00.000Z');
    const end = computeMonitoringEnd('72H', null, late, '2026-09-20', NY);
    expect(end.getTime()).toBeGreaterThan(late.getTime());
  });
});

describe('create watch validation', () => {
  const base = {
    originCode: 'bos',
    destinationCode: 'nyp',
    desiredDate: '2026-09-20',
    amountPaid: '128.00',
  };

  it('accepts a minimal valid payload and applies defaults', () => {
    const parsed = createWatchSchema.parse(base);
    expect(parsed.originCode).toBe('BOS');
    expect(parsed.destinationCode).toBe('NYP');
    expect(parsed.amountPaid).toBe(12800);
    expect(parsed.passengers).toBe(1);
    expect(parsed.dateFlexibilityDays).toBe(1); // +/-1 is the documented default
    expect(parsed.travelClass).toBe('COACH');
    expect(parsed.fareFamily).toBe('FLEXIBLE');
    expect(parsed.monitoringPreset).toBe('48H'); // 48 hours is the documented default
  });

  it('stores money as integer cents', () => {
    expect(createWatchSchema.parse({ ...base, amountPaid: '$1,284.50' }).amountPaid).toBe(128450);
    expect(createWatchSchema.parse({ ...base, amountPaid: 74 }).amountPaid).toBe(7400);
  });

  it('rejects an unparseable amount', () => {
    expect(createWatchSchema.safeParse({ ...base, amountPaid: 'about a hundred' }).success).toBe(
      false,
    );
  });

  it('rejects identical stations', () => {
    const result = createWatchSchema.safeParse({ ...base, destinationCode: 'BOS' });
    expect(result.success).toBe(false);
  });

  it('rejects bad station codes and dates', () => {
    expect(createWatchSchema.safeParse({ ...base, originCode: 'BOSTON' }).success).toBe(false);
    expect(createWatchSchema.safeParse({ ...base, desiredDate: '20/09/2026' }).success).toBe(false);
  });

  it('constrains flexibility to 0, 1 or 2', () => {
    for (const value of [0, 1, 2]) {
      expect(createWatchSchema.safeParse({ ...base, dateFlexibilityDays: value }).success).toBe(
        true,
      );
    }
    expect(createWatchSchema.safeParse({ ...base, dateFlexibilityDays: 3 }).success).toBe(false);
  });

  it('constrains passenger counts', () => {
    expect(createWatchSchema.safeParse({ ...base, passengers: 0 }).success).toBe(false);
    expect(createWatchSchema.safeParse({ ...base, passengers: 9 }).success).toBe(false);
    expect(createWatchSchema.safeParse({ ...base, passengers: 8 }).success).toBe(true);
  });

  it('requires custom hours when the custom preset is chosen', () => {
    expect(createWatchSchema.safeParse({ ...base, monitoringPreset: 'CUSTOM' }).success).toBe(
      false,
    );
    expect(
      createWatchSchema.safeParse({
        ...base,
        monitoringPreset: 'CUSTOM',
        customMonitoringHours: 12,
      }).success,
    ).toBe(true);
  });

  it('validates preferred departure times', () => {
    expect(createWatchSchema.safeParse({ ...base, preferredDepartureTime: '07:05' }).success).toBe(
      true,
    );
    expect(createWatchSchema.safeParse({ ...base, preferredDepartureTime: '25:00' }).success).toBe(
      false,
    );
  });
});

describe('rebook validation', () => {
  it('requires the new amount and accepts optional details', () => {
    expect(rebookSchema.safeParse({}).success).toBe(false);
    const parsed = rebookSchema.parse({
      amountPaid: '74.00',
      travelDate: '2026-09-19',
      trainNumber: '179',
      departureTime: '07:05',
      fareFamily: 'FLEXIBLE',
    });
    expect(parsed.amountPaid).toBe(7400);
    expect(parsed.travelDate).toBe('2026-09-19');
  });

  it('converts clock times to minutes', () => {
    expect(clockToMinutes('07:05')).toBe(425);
    expect(clockToMinutes(null)).toBeNull();
  });
});

describe('cron authorization', () => {
  it('accepts only the exact bearer secret', () => {
    process.env.CRON_SECRET = 'super-secret-value';
    resetServerEnvCache();

    const withHeader = (value: string) =>
      isAuthorizedCron(
        new Request('https://x.test/api/cron/dispatch', { headers: { authorization: value } }),
      );

    expect(withHeader('Bearer super-secret-value')).toBe(true);
    expect(withHeader('Bearer super-secret-valu')).toBe(false);
    expect(withHeader('Bearer super-secret-value-extra')).toBe(false);
    expect(withHeader('super-secret-value')).toBe(false);
    expect(withHeader('Bearer ')).toBe(false);
    expect(isAuthorizedCron(new Request('https://x.test/api/cron/dispatch'))).toBe(false);
  });

  it('denies everything when no secret is configured', () => {
    process.env.CRON_SECRET = '';
    resetServerEnvCache();
    expect(
      isAuthorizedCron(
        new Request('https://x.test/api/cron/dispatch', { headers: { authorization: 'Bearer ' } }),
      ),
    ).toBe(false);
  });
});

describe('round trip input', () => {
  const base = {
    originCode: 'BOS',
    destinationCode: 'NYP',
    desiredDate: '2026-09-20',
    amountPaid: '250.00',
  };

  it('accepts a return on or after the outbound date', () => {
    expect(
      createWatchSchema.safeParse({ ...base, returnDate: '2026-09-24', returnAmountPaid: '180.00' })
        .success,
    ).toBe(true);
    expect(
      createWatchSchema.safeParse({ ...base, returnDate: '2026-09-20', returnAmountPaid: '180.00' })
        .success,
    ).toBe(true);
  });

  it('rejects a return before the outbound date', () => {
    const result = createWatchSchema.safeParse({
      ...base,
      returnDate: '2026-09-19',
      returnAmountPaid: '180.00',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('returnDate'))).toBe(true);
    }
  });

  it('rejects a return date with no amount — RailDrop never splits one total across two legs', () => {
    const result = createWatchSchema.safeParse({ ...base, returnDate: '2026-09-24' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('returnAmountPaid'))).toBe(true);
    }
  });

  it('treats a missing return as an ordinary one-way', () => {
    const result = createWatchSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.returnDate ?? null).toBeNull();
  });
});
