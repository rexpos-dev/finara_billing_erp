const { PERIODS, computePaidUntil, computeYearlyAmount } = require('../server/utils/orderPricing');

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

describe('computeYearlyAmount', () => {
  test('0% discount is monthly times twelve', () => {
    expect(computeYearlyAmount(1000, 0)).toBe(12000);
  });

  test('applies a typical discount', () => {
    expect(computeYearlyAmount(1105, 5)).toBe(12597);
  });

  test('rounds to the nearest centavo', () => {
    expect(computeYearlyAmount(100, 33.33)).toBe(800.04);
  });

  test('100% discount is free', () => {
    expect(computeYearlyAmount(500, 100)).toBe(0);
  });

  test('rejects a negative monthly amount', () => {
    expect(() => computeYearlyAmount(-1, 5)).toThrow('Invalid monthly amount');
  });

  test('rejects a discount outside 0-100', () => {
    expect(() => computeYearlyAmount(1000, 150)).toThrow('Invalid discount percent');
    expect(() => computeYearlyAmount(1000, -1)).toThrow('Invalid discount percent');
  });
});
