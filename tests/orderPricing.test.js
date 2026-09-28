const { PERIODS, computePaidUntil } = require('../server/utils/orderPricing');

const iso = (d) => d.toISOString().slice(0, 10);

describe('computePaidUntil', () => {
  test('exports the two periods', () => {
    expect(PERIODS).toEqual(['MONTHLY', 'YEARLY']);
  });

  test('monthly adds one calendar month', () => {
    expect(iso(computePaidUntil('2026-09-26T00:00:00Z', 'MONTHLY'))).toBe('2026-10-26');
  });

  test('monthly clamps to the last day of a shorter month', () => {
    expect(iso(computePaidUntil('2026-01-31T00:00:00Z', 'MONTHLY'))).toBe('2026-02-28');
  });

  test('yearly adds twelve months', () => {
    expect(iso(computePaidUntil('2026-09-26T00:00:00Z', 'YEARLY'))).toBe('2027-09-26');
  });

  test('yearly from a leap day clamps to Feb 28', () => {
    expect(iso(computePaidUntil('2028-02-29T00:00:00Z', 'YEARLY'))).toBe('2029-02-28');
  });

  test('rejects an unknown period', () => {
    expect(() => computePaidUntil('2026-09-26T00:00:00Z', 'WEEKLY')).toThrow('Invalid period');
  });
});
