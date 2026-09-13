import { describe, expect, it } from 'vitest';
import { evaluateEligibility } from '@/lib/domain/eligibility';
import { buildOpportunities, opportunitySignature } from '@/lib/domain/opportunity';
import { derivePartyTotal } from '@/lib/providers/parse/adapter';
import {
  makeCandidate,
  makeFare,
  makeJourney,
  makeRequest,
  makeResult,
  makeWatch,
} from '../helpers/factories';

function dated(date: string, displacement: number, cents: number, id = date) {
  return {
    result: makeResult(
      [
        makeJourney({
          providerJourneyId: id,
          travelDate: date,
          departureLocal: `${date}T07:05`,
          arrivalLocal: `${date}T11:14`,
          fares: [makeFare({ id: `${id}-f`, amountCents: cents, partyTotalCents: cents })],
        }),
      ],
      { request: makeRequest({ date }) },
    ),
    searchDate: { date, displacementDays: displacement },
  };
}

describe('opportunity engine', () => {
  const watch = makeWatch({ benchmarkCents: 12800 });

  it('qualifies only options at or below benchmark minus minimum savings', () => {
    const eligibility = evaluateEligibility(watch, [
      dated('2026-09-19', -1, 7400),
      dated('2026-09-20', 0, 12500), // only $3 cheaper, below the $5 threshold
      dated('2026-09-21', 1, 12800), // same price
    ]);
    const out = buildOpportunities({ watch, benchmarkCents: 12800, eligibility });

    expect(out.opportunities.map((o) => o.totalCents)).toEqual([7400]);
    expect(out.allRanked).toHaveLength(3);
    expect(out.bestTotalCents).toBe(7400);
  });

  it('computes savings against the benchmark', () => {
    const eligibility = evaluateEligibility(watch, [dated('2026-09-19', -1, 7400)]);
    const out = buildOpportunities({ watch, benchmarkCents: 12800, eligibility });
    expect(out.opportunities[0]?.savingsCents).toBe(5400);
  });

  it('records the cheapest price per date for the fare strip', () => {
    const eligibility = evaluateEligibility(watch, [
      dated('2026-09-19', -1, 7400),
      dated('2026-09-20', 0, 8100),
      dated('2026-09-21', 1, 8600),
    ]);
    const out = buildOpportunities({ watch, benchmarkCents: 12800, eligibility });
    expect([...out.cheapestByDate.entries()].sort()).toEqual([
      ['2026-09-19', 7400],
      ['2026-09-20', 8100],
      ['2026-09-21', 8600],
    ]);
  });

  it('produces a price-independent signature so identity survives a price change', () => {
    const a = makeCandidate({ fare: { amountCents: 8900, partyTotalCents: 8900 } });
    const b = makeCandidate({ fare: { amountCents: 9500, partyTotalCents: 9500 } });
    expect(opportunitySignature(a)).toBe(opportunitySignature(b));
  });

  it('flags ambiguous party pricing rather than trusting it', () => {
    const partyWatch = makeWatch({ passengers: 2, benchmarkCents: 25600 });
    const ambiguous = derivePartyTotal(7400, 2, 'UNKNOWN');
    expect(ambiguous.pricingConfidence).toBe('AMBIGUOUS');

    const eligibility = evaluateEligibility(partyWatch, [
      {
        result: makeResult(
          [
            makeJourney({
              fares: [
                makeFare({
                  amountCents: 7400,
                  partyTotalCents: ambiguous.partyTotalCents,
                  pricingConfidence: 'AMBIGUOUS',
                }),
              ],
            }),
          ],
          { request: makeRequest({ passengers: 2 }) },
        ),
        searchDate: { date: '2026-09-20', displacementDays: 0 },
      },
    ]);
    const out = buildOpportunities({ watch: partyWatch, benchmarkCents: 25600, eligibility });
    expect(out.opportunities[0]?.pricingAmbiguous).toBe(true);
  });
});

describe('party pricing derivation', () => {
  it('multiplies for a confirmed per-passenger basis', () => {
    expect(derivePartyTotal(7400, 2, 'PER_PASSENGER')).toEqual({
      partyTotalCents: 14800,
      pricingConfidence: 'CONFIRMED',
    });
  });

  it('leaves a confirmed total-party price alone', () => {
    expect(derivePartyTotal(14800, 2, 'TOTAL_PARTY')).toEqual({
      partyTotalCents: 14800,
      pricingConfidence: 'CONFIRMED',
    });
  });

  it('treats a single passenger as unambiguous even with an unknown basis', () => {
    expect(derivePartyTotal(7400, 1, 'UNKNOWN')).toEqual({
      partyTotalCents: 7400,
      pricingConfidence: 'UNAMBIGUOUS_SINGLE',
    });
  });

  it('marks multi-passenger unknown-basis prices ambiguous', () => {
    expect(derivePartyTotal(7400, 3, 'UNKNOWN')).toEqual({
      partyTotalCents: 22200,
      pricingConfidence: 'AMBIGUOUS',
    });
  });
});
