import { describe, expect, it } from 'vitest';
import {
  SLOT_LOCAL_MINUTES,
  decideDispatch,
  dueSlots,
  isMonitoringOpen,
  nextScheduledCheckAt,
  slotDisplayName,
  zonedTimeToInstant,
} from '@/lib/domain/schedule';
import type { ScheduledSlot } from '@/lib/domain/types';
import { makeWatch } from '../helpers/factories';

const NY = 'America/New_York';
const none = new Set<ScheduledSlot>();

describe('slot definitions', () => {
  it('defines exactly three local slots', () => {
    expect(SLOT_LOCAL_MINUTES).toEqual({ MORNING: 480, AFTERNOON: 840, EVENING: 1200 });
    expect(slotDisplayName('EVENING')).toBe('8:00 PM');
  });

  it('reports which slots are due for a local time', () => {
    expect(dueSlots(7 * 60 + 59)).toEqual([]);
    expect(dueSlots(8 * 60)).toEqual(['MORNING']);
    expect(dueSlots(13 * 60)).toEqual(['MORNING']);
    expect(dueSlots(14 * 60)).toEqual(['MORNING', 'AFTERNOON']);
    expect(dueSlots(20 * 60 + 1)).toEqual(['MORNING', 'AFTERNOON', 'EVENING']);
  });
});

describe('dispatch decisions', () => {
  it('claims nothing before the first local slot', () => {
    // 07:59 in New York
    const decision = decideDispatch(new Date('2026-09-20T11:59:00.000Z'), NY, none);
    expect(decision.claim).toBeNull();
    expect(decision.skip).toEqual([]);
    expect(decision.localDate).toBe('2026-09-20');
  });

  it('claims the morning slot at exactly 08:00 local', () => {
    const decision = decideDispatch(new Date('2026-09-20T12:00:00.000Z'), NY, none);
    expect(decision.claim).toBe('MORNING');
  });

  it('claims only the latest due slot and records earlier ones as skipped', () => {
    // 20:01 in New York: all three slots are due, none recorded.
    const decision = decideDispatch(new Date('2026-09-21T00:01:00.000Z'), NY, none);
    expect(decision.localDate).toBe('2026-09-20');
    expect(decision.claim).toBe('EVENING');
    // Crucially NOT three cycles (nine provider calls) at once after an outage.
    expect(decision.skip.map((s) => s.slot)).toEqual(['MORNING', 'AFTERNOON']);
    expect(decision.skip.every((s) => s.reason === 'MISSED_WINDOW')).toBe(true);
  });

  it('claims nothing when the due slot is already recorded', () => {
    const decision = decideDispatch(
      new Date('2026-09-20T12:30:00.000Z'),
      NY,
      new Set<ScheduledSlot>(['MORNING']),
    );
    expect(decision.claim).toBeNull();
  });

  it('does not re-skip slots that were already recorded', () => {
    const decision = decideDispatch(
      new Date('2026-09-21T00:01:00.000Z'),
      NY,
      new Set<ScheduledSlot>(['MORNING', 'AFTERNOON']),
    );
    expect(decision.claim).toBe('EVENING');
    expect(decision.skip).toEqual([]);
  });

  it('is idempotent across repeated heartbeats in the same hour', () => {
    const first = decideDispatch(new Date('2026-09-20T12:00:00.000Z'), NY, none);
    expect(first.claim).toBe('MORNING');
    const second = decideDispatch(
      new Date('2026-09-20T12:20:00.000Z'),
      NY,
      new Set<ScheduledSlot>([first.claim as ScheduledSlot]),
    );
    expect(second.claim).toBeNull();
  });
});

describe('DST correctness', () => {
  it('keeps 08:00 local meaning 08:00 across US spring forward', () => {
    // 2026-03-08 is the US spring-forward date.
    const before = decideDispatch(new Date('2026-03-07T13:00:00.000Z'), NY, none); // 08:00 EST
    const after = decideDispatch(new Date('2026-03-08T12:00:00.000Z'), NY, none); // 08:00 EDT
    expect(before.claim).toBe('MORNING');
    expect(after.claim).toBe('MORNING');
    expect(before.localDate).toBe('2026-03-07');
    expect(after.localDate).toBe('2026-03-08');

    // The same wall-clock slot maps to different UTC instants either side.
    expect(zonedTimeToInstant('2026-03-07', 480, NY).toISOString()).toBe(
      '2026-03-07T13:00:00.000Z',
    );
    expect(zonedTimeToInstant('2026-03-08', 480, NY).toISOString()).toBe(
      '2026-03-08T12:00:00.000Z',
    );
  });

  it('keeps 08:00 local meaning 08:00 across US fall back', () => {
    // 2026-11-01 is the US fall-back date; 01:00 local occurs twice.
    expect(zonedTimeToInstant('2026-10-31', 480, NY).toISOString()).toBe(
      '2026-10-31T12:00:00.000Z',
    );
    expect(zonedTimeToInstant('2026-11-01', 480, NY).toISOString()).toBe(
      '2026-11-01T13:00:00.000Z',
    );

    // Both repeats of 01:30 local fall before the morning slot, so no slot is
    // claimed twice by the repeated hour.
    const firstPass = decideDispatch(new Date('2026-11-01T05:30:00.000Z'), NY, none);
    const secondPass = decideDispatch(new Date('2026-11-01T06:30:00.000Z'), NY, none);
    expect(firstPass.claim).toBeNull();
    expect(secondPass.claim).toBeNull();
  });

  it('handles non-hour offsets', () => {
    // India is UTC+05:30 year round.
    expect(zonedTimeToInstant('2026-09-20', 480, 'Asia/Kolkata').toISOString()).toBe(
      '2026-09-20T02:30:00.000Z',
    );
    expect(decideDispatch(new Date('2026-09-20T02:30:00.000Z'), 'Asia/Kolkata', none).claim).toBe(
      'MORNING',
    );

    // Chatham Islands is UTC+12:45 outside NZ daylight time.
    expect(zonedTimeToInstant('2026-09-20', 480, 'Pacific/Chatham').toISOString()).toBe(
      '2026-09-19T19:15:00.000Z',
    );
  });

  it('assigns the correct local date on either side of the international date line', () => {
    const instant = new Date('2026-09-20T10:00:00.000Z');
    expect(decideDispatch(instant, 'Pacific/Kiritimati', none).localDate).toBe('2026-09-21');
    expect(decideDispatch(instant, 'Pacific/Midway', none).localDate).toBe('2026-09-19');
  });
});

describe('monitoring window', () => {
  const watch = makeWatch({
    monitoringStartsAt: '2026-09-02T00:00:00.000Z',
    monitoringEndsAt: '2026-09-04T00:00:00.000Z',
  });

  it('is open only inside the window and only while active', () => {
    expect(isMonitoringOpen(watch, new Date('2026-09-03T00:00:00.000Z'))).toBe(true);
    expect(isMonitoringOpen(watch, new Date('2026-09-01T23:59:00.000Z'))).toBe(false);
    expect(isMonitoringOpen(watch, new Date('2026-09-04T00:00:00.000Z'))).toBe(false);
    expect(
      isMonitoringOpen({ ...watch, status: 'PAUSED' }, new Date('2026-09-03T00:00:00.000Z')),
    ).toBe(false);
  });

  it('reports the next scheduled check in local time', () => {
    // 09:00 local on Sep 2 -> next slot is 14:00 local the same day.
    const next = nextScheduledCheckAt(watch, new Date('2026-09-02T13:00:00.000Z'));
    expect(next?.toISOString()).toBe('2026-09-02T18:00:00.000Z');
  });

  it('rolls to tomorrow morning after the evening slot', () => {
    const next = nextScheduledCheckAt(watch, new Date('2026-09-03T01:00:00.000Z')); // 21:00 Sep 2
    expect(next?.toISOString()).toBe('2026-09-03T12:00:00.000Z');
  });

  it('returns null when monitoring ends before the next slot', () => {
    expect(nextScheduledCheckAt(watch, new Date('2026-09-03T23:00:00.000Z'))).toBeNull();
    expect(
      nextScheduledCheckAt({ ...watch, status: 'PAUSED' }, new Date('2026-09-02T13:00:00.000Z')),
    ).toBeNull();
  });
});
