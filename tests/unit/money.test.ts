import { describe, expect, it } from 'vitest';
import {
  MoneyError,
  assertCents,
  dollarsToCents,
  formatCents,
  formatCentsCompact,
  multiplyCents,
} from '@/lib/domain/money';

describe('money', () => {
  it('parses dollar inputs into integer cents', () => {
    expect(dollarsToCents('128')).toBe(12800);
    expect(dollarsToCents('128.5')).toBe(12850);
    expect(dollarsToCents('128.50')).toBe(12850);
    expect(dollarsToCents('$1,284.00')).toBe(128400);
    expect(dollarsToCents(74)).toBe(7400);
    expect(dollarsToCents('0.01')).toBe(1);
  });

  it('rejects anything that is not a clean amount', () => {
    for (const bad of ['', 'abc', '12.345', '-5', '1.2.3', '12,', ',5', '$', '1,23,456']) {
      expect(() => dollarsToCents(bad)).toThrow(MoneyError);
    }
  });

  it('never produces a fractional cent', () => {
    // 0.1 + 0.2 float trap: the parser must not go through float addition.
    expect(dollarsToCents('0.10') + dollarsToCents('0.20')).toBe(30);
    expect(Number.isInteger(dollarsToCents('19.99'))).toBe(true);
  });

  it('rejects non-integer or negative cents', () => {
    expect(() => assertCents(10.5)).toThrow(MoneyError);
    expect(() => assertCents(-1)).toThrow(MoneyError);
    expect(() => assertCents(Number.NaN)).toThrow(MoneyError);
  });

  it('multiplies by whole passengers only', () => {
    expect(multiplyCents(7400, 2)).toBe(14800);
    expect(() => multiplyCents(7400, 0)).toThrow(MoneyError);
    expect(() => multiplyCents(7400, 1.5)).toThrow(MoneyError);
  });

  it('formats for display', () => {
    expect(formatCents(12800)).toBe('$128');
    expect(formatCents(12850)).toBe('$128.50');
    expect(formatCents(128400)).toBe('$1,284');
    expect(formatCentsCompact(12850)).toBe('$129');
  });
});
