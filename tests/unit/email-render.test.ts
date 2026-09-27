import { describe, expect, it } from 'vitest';
import {
  buildAlertSubject,
  escapeHtml,
  renderAlertEmail,
  renderReadyEmail,
  sanitizeHeaderValue,
  type AlertEmailInput,
} from '@/lib/email/render';
import { isValidRecipient } from '@/lib/email/transport';
import { convenienceScore } from '@/lib/domain/ranking';
import type { Opportunity } from '@/lib/domain/types';
import { makeCandidate, makeWatch } from '../helpers/factories';

const watch = makeWatch({ benchmarkCents: 12800 });

function opportunity(cents: number, date: string, displacement: number): Opportunity {
  const candidate = makeCandidate({
    displacementDays: displacement,
    journey: {
      providerJourneyId: `j-${date}`,
      travelDate: date,
      departureLocal: `${date}T07:05`,
      arrivalLocal: `${date}T11:14`,
    },
    fare: { amountCents: cents, partyTotalCents: cents },
  });
  return {
    candidate,
    totalCents: cents,
    savingsCents: 12800 - cents,
    displacementDays: displacement,
    convenienceScore: convenienceScore(candidate, watch),
    signature: `${date}|179`,
    pricingAmbiguous: false,
  };
}

const input: AlertEmailInput = {
  watch,
  reason: 'FIRST_DROP',
  best: opportunity(7400, '2026-09-19', -1),
  others: [opportunity(8100, '2026-09-20', 0), opportunity(8600, '2026-09-21', 1)],
  benchmarkCents: 12800,
  cycleStatus: 'SUCCESS',
  uncheckedDates: [],
  watchUrl: 'https://raildrop.example/watches/abc',
};

describe('alert email', () => {
  it('builds the subject from the spec', () => {
    expect(buildAlertSubject(input)).toBe('Fare drop: BOS to NYP from $74 - save $54');
  });

  it('includes the current ticket, cheapest option and other options', () => {
    const { text, html } = renderAlertEmail(input);

    expect(text).toContain('CURRENT TICKET');
    expect(text).toContain('$128');
    expect(text).toContain('CHEAPEST');
    expect(text).toContain('$74');
    expect(text).toContain('Save $54');
    expect(text).toContain('Northeast Regional 179');
    expect(text).toContain('7:05 AM - 11:14 AM');
    expect(text).toContain('Flexible Coach');
    expect(text).toContain('1 day earlier');
    expect(text).toContain('OTHER OPTIONS');
    expect(text).toContain('$81');
    expect(text).toContain('$86');
    expect(text).toContain('https://raildrop.example/watches/abc');

    expect(html).toContain('View options');
    expect(html).toContain('Save $54');
  });

  it('always carries the non-modification footer', () => {
    const { text, html } = renderAlertEmail(input);
    const footer =
      'Fares and availability may change. RailDrop does not automatically modify your Amtrak reservation.';
    expect(text).toContain(footer);
    expect(html).toContain(footer);
  });

  it('discloses dates that could not be checked', () => {
    const partial = renderAlertEmail({
      ...input,
      cycleStatus: 'PARTIAL_SUCCESS',
      uncheckedDates: ['2026-09-21'],
    });
    expect(partial.text).toContain('could not check');
    expect(partial.text).toContain('Sep 21');
    expect(partial.html).toContain('could not check');
  });

  it('omits the other-options block when there is only one option', () => {
    const single = renderAlertEmail({ ...input, others: [] });
    expect(single.text).not.toContain('OTHER OPTIONS');
  });

  it('escapes HTML so provider or user strings cannot inject markup', () => {
    const hostile = renderAlertEmail({
      ...input,
      best: {
        ...input.best,
        candidate: {
          ...input.best.candidate,
          journey: {
            ...input.best.candidate.journey,
            serviceName: '<script>alert("xss")</script>',
          },
        },
      },
    });
    expect(hostile.html).not.toContain('<script>alert');
    expect(hostile.html).toContain('&lt;script&gt;');
  });

  it('escapes the five dangerous characters', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });

  it('strips CR and LF from header values, blocking header injection', () => {
    expect(sanitizeHeaderValue('Subject\r\nBcc: attacker@example.com')).toBe(
      'Subject Bcc: attacker@example.com',
    );
    expect(buildAlertSubject(input)).not.toMatch(/[\r\n]/);
  });

  it('renders the readiness email', () => {
    const ready = renderReadyEmail('https://raildrop.example');
    expect(ready.subject).toBe('RailDrop is ready');
    expect(ready.html).toContain('https://raildrop.example');
    expect(ready.text).toContain('RailDrop is ready');
  });
});

describe('recipient validation', () => {
  it('accepts ordinary addresses', () => {
    expect(isValidRecipient('user@example.com')).toBe(true);
    expect(isValidRecipient('first.last+tag@sub.example.co.uk')).toBe(true);
  });

  it('rejects malformed addresses and injection attempts', () => {
    for (const bad of [
      '',
      'no-at-sign',
      'a@b',
      'user@example.com\r\nBcc: attacker@example.com',
      'user@example.com, other@example.com',
      '<user@example.com>',
      `${'a'.repeat(250)}@example.com`,
    ]) {
      expect(isValidRecipient(bad), bad).toBe(false);
    }
  });
});
