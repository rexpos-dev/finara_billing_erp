// Billing periods for add-business orders and how far each one extends
// Business.paidUntil.
const PERIODS = ['MONTHLY', 'YEARLY'];

/** `from` + 1 month (MONTHLY) or 12 months (YEARLY), UTC, clamped to month end. */
function computePaidUntil(from, period) {
  if (!PERIODS.includes(period)) throw new Error('Invalid period');
  const d = new Date(from);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + (period === 'YEARLY' ? 12 : 1));
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

/** monthlyAmount x 12, less discountPercent (0-100), rounded to the nearest centavo. */
function computeYearlyAmount(monthlyAmount, discountPercent) {
  const amount = Number(monthlyAmount);
  const discount = Number(discountPercent);
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Invalid monthly amount');
  if (!Number.isFinite(discount) || discount < 0 || discount > 100) throw new Error('Invalid discount percent');
  return Math.round(amount * 12 * (1 - discount / 100) * 100) / 100;
}

module.exports = { PERIODS, computePaidUntil, computeYearlyAmount };
