/**
 * assessmentCalc.js — Tuition assessment maths.
 *
 * Pure module: no Prisma, no I/O, no request context. Everything it needs is
 * passed in, so the whole engine is unit-testable without a database — the same
 * shape as accountMap.js and phCompliance.js.
 *
 * Revenue policy (Option B): the assessment is a MEMO document. It computes
 * what is owed and when, but posts nothing. Revenue is recognised as each
 * installment is billed, so nothing here touches the GL.
 *
 * Money rules, applied consistently:
 *   - every intermediate is rounded to 2dp as it is produced, never at the end
 *   - the final installment absorbs any rounding remainder, so the schedule
 *     always sums to the net payable exactly (a peso lost here is a peso the
 *     cashier can never collect and the AR can never clear)
 */

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Compute an assessment from a fee structure, its discounts and subsidies.
 *
 * @param {Object}   opts
 * @param {Array}    opts.structureLines  [{ feeTypeId, amount, billingBasis, feeType: { code, name, category, accountId, vatCode }, sortOrder }]
 * @param {Object}   opts.scheme          { code, installmentCount, downPaymentAmount, discountPct, surchargePct }
 * @param {Array}    [opts.discounts]     [{ type, label, basis: 'PCT'|'FIXED', value }]
 * @param {Array}    [opts.subsidies]     [{ type, amount }]
 * @returns {{ lines, tuitionTotal, grossAmount, schemeDiscount, discountAmount, subsidyAmount, netAmount, netPayable }}
 */
function computeAssessment({ structureLines, scheme, discounts = [], subsidies = [] }) {
  if (!Array.isArray(structureLines) || structureLines.length === 0) {
    throw new Error('Assessment needs at least one fee line');
  }
  if (!scheme) throw new Error('Assessment needs a payment scheme');

  const lines = structureLines
    .filter((l) => Number(l.amount) > 0)
    .map((l, i) => ({
      feeTypeId:    l.feeTypeId,
      accountId:    l.feeType.accountId,
      description:  l.feeType.name,
      category:     l.feeType.category,
      vatCode:      l.feeType.vatCode,
      billingBasis: l.billingBasis || 'ANNUAL',
      amount:       round2(l.amount),
      sortOrder:    l.sortOrder ?? i,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const grossAmount  = round2(lines.reduce((s, l) => s + l.amount, 0));
  const tuitionTotal = round2(
    lines.filter((l) => l.category === 'TUITION').reduce((s, l) => s + l.amount, 0)
  );

  // Scheme discount (e.g. 5% for paying the year in cash) applies to tuition
  // only — that is how PH schools quote it, and discounting the miscellaneous
  // bundle as well would quietly give away more than intended.
  const schemeDiscount = round2(tuitionTotal * (Number(scheme.discountPct || 0) / 100));

  // Per-student discounts: PCT is of tuition, FIXED is a peso amount.
  const studentDiscounts = discounts.map((d) => ({
    type:   d.type,
    label:  d.label,
    basis:  d.basis,
    value:  Number(d.value || 0),
    amount: d.basis === 'FIXED'
      ? round2(d.value)
      : round2(tuitionTotal * (Number(d.value || 0) / 100)),
  }));

  const discountAmount = round2(
    schemeDiscount + studentDiscounts.reduce((s, d) => s + d.amount, 0)
  );

  // Subsidies do not reduce revenue — they change who pays. The school still
  // earns the full fee; DepEd settles part of it. See schoolBillingController.
  const subsidyAmount = round2(subsidies.reduce((s, x) => s + Number(x.amount || 0), 0));

  // netAmount is what the school will earn after discounts (subsidies included,
  // since the school still collects them). netPayable is what the parent owes.
  const netAmount  = round2(grossAmount - discountAmount);
  const netPayable = round2(netAmount - subsidyAmount);

  if (netPayable < 0) {
    throw new Error(
      `Discounts and subsidies (₱${round2(discountAmount + subsidyAmount).toLocaleString()}) ` +
      `exceed the assessment (₱${grossAmount.toLocaleString()})`
    );
  }

  return {
    lines,
    tuitionTotal,
    grossAmount,
    schemeDiscount,
    studentDiscounts,
    discountAmount,
    subsidyAmount,
    netAmount,
    netPayable,
  };
}

/**
 * Build the installment schedule.
 *
 * Sequence 0 is the enrolment payment: every ONE_TIME fee (registration, ID)
 * plus the scheme's down payment. Sequences 1..n spread the remainder monthly
 * from the month after enrolment.
 *
 * @param {Object}       opts
 * @param {number}       opts.netPayable
 * @param {Array}        opts.lines            from computeAssessment()
 * @param {Object}       opts.scheme
 * @param {Date|string}  opts.startDate        first installment month (usually school year start)
 * @param {Date|string}  opts.assessmentDate   date of the enrolment payment
 * @returns {Array} [{ seq, label, dueDate, amount }]
 */
function buildSchedule({ netPayable, lines, scheme, startDate, assessmentDate }) {
  const oneTimeTotal = round2(
    (lines || []).filter((l) => l.billingBasis === 'ONE_TIME').reduce((s, l) => s + l.amount, 0)
  );
  const downPayment = round2(Math.min(
    round2(oneTimeTotal + Number(scheme.downPaymentAmount || 0)),
    netPayable
  ));

  const schedule = [];
  if (downPayment > 0) {
    schedule.push({
      seq:     0,
      label:   'Upon Enrollment',
      dueDate: toDate(assessmentDate),
      amount:  downPayment,
    });
  }

  const balance = round2(netPayable - downPayment);
  const count   = Math.max(1, Number(scheme.installmentCount || 1));

  // A full-payment scheme has nothing left to schedule once the down payment
  // covers the balance.
  if (balance <= 0) return schedule;

  const surcharge = round2(balance * (Number(scheme.surchargePct || 0) / 100));
  const payable   = round2(balance + surcharge);

  const per = round2(payable / count);
  let allocated = 0;

  const first = toDate(startDate);
  for (let i = 1; i <= count; i++) {
    const isLast = i === count;
    // The last installment absorbs the rounding remainder so the schedule sums
    // to the payable exactly.
    const amount = isLast ? round2(payable - allocated) : per;
    allocated = round2(allocated + amount);

    schedule.push({
      seq:     i,
      label:   count === 1 ? 'Full Payment' : `Installment ${i} of ${count}`,
      dueDate: addMonths(first, i - 1),
      amount,
    });
  }

  return schedule;
}

/**
 * Split one installment across the assessment's ANNUAL fee lines, pro rata.
 *
 * Used by the billing run to turn an installment into invoice lines that point
 * at the right revenue accounts. Without this, every peso would land on a
 * single account and the income statement would be useless.
 *
 * The largest line absorbs the rounding remainder so the parts always sum to
 * the installment amount.
 *
 * @returns {Array} [{ accountId, description, amount, vatCode, feeTypeId }]
 */
function allocateInstallment({ installmentAmount, lines, includeOneTime = false }) {
  const all = lines || [];
  const amount = round2(installmentAmount);
  if (amount <= 0) return [];

  const map = (l, value) => ({
    feeTypeId:   l.feeTypeId,
    accountId:   l.accountId,
    description: l.description,
    vatCode:     l.vatCode,
    amount:      round2(value),
  });

  const parts = [];
  let remaining = amount;

  // One-time fees are billed at FACE VALUE on the enrolment invoice. A
  // registration fee is a fixed charge, not a share of whatever was paid that
  // day. Pro-rating it against the annual lines would push part of it onto
  // the tuition account and, where a VATable line is in the mix, put VAT on a
  // payment that is entirely exempt.
  //
  // When the down payment itself was capped below the combined one-time fees
  // (a heavily discounted/subsidised enrollment — see buildSchedule), there is
  // not enough to give every one-time fee its face value. Split what there is
  // pro rata across them instead of paying whichever fee comes first in the
  // array in full and leaving the rest at zero.
  if (includeOneTime) {
    const oneTime = all.filter((x) => x.billingBasis === 'ONE_TIME');
    const oneTimeTotal = round2(oneTime.reduce((s, l) => s + l.amount, 0));

    if (remaining >= oneTimeTotal) {
      for (const l of oneTime) {
        if (l.amount <= 0) continue;
        parts.push(map(l, l.amount));
        remaining = round2(remaining - l.amount);
      }
    } else if (oneTimeTotal > 0) {
      const spread = oneTime.map((l) => map(l, remaining * (l.amount / oneTimeTotal)));
      const allocated = round2(spread.reduce((s, p) => s + p.amount, 0));
      const drift = round2(remaining - allocated);
      if (drift !== 0) {
        let biggest = 0;
        for (let i = 1; i < spread.length; i++) if (spread[i].amount > spread[biggest].amount) biggest = i;
        spread[biggest].amount = round2(spread[biggest].amount + drift);
      }
      parts.push(...spread);
      remaining = 0;
    }
  }

  // Whatever is left spreads across the annual lines, pro rata.
  const pool = all.filter((l) => l.billingBasis === 'ANNUAL');
  const poolTotal = round2(pool.reduce((s, l) => s + l.amount, 0));

  if (remaining > 0 && pool.length && poolTotal > 0) {
    const spread = pool.map((l) => map(l, remaining * (l.amount / poolTotal)));

    const allocated = round2(spread.reduce((s, p) => s + p.amount, 0));
    const drift = round2(remaining - allocated);
    if (drift !== 0) {
      // Put the remainder on the biggest line, where it is proportionally
      // smallest and least likely to look like a data-entry error.
      let biggest = 0;
      for (let i = 1; i < spread.length; i++) if (spread[i].amount > spread[biggest].amount) biggest = i;
      spread[biggest].amount = round2(spread[biggest].amount + drift);
    }
    parts.push(...spread);
  }

  return parts.filter((p) => p.amount !== 0);
}

// ── Date helpers ───────────────────────────────────────────────────────────
// Dates are handled in UTC throughout, matching glPost.dateKey(), so a
// due date never drifts a day either way across a timezone boundary.

function toDate(d) {
  if (d instanceof Date) return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const s = String(d).slice(0, 10);
  const [y, m, day] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

/**
 * Add whole months, clamping to the end of the target month.
 * 31 Jan + 1 month is 28/29 Feb, not 2/3 March — a due date must never skip
 * into the following month.
 */
function addMonths(date, months) {
  const d = toDate(date);
  const targetMonth = d.getUTCMonth() + months;
  const y = d.getUTCFullYear() + Math.floor(targetMonth / 12);
  const m = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), lastDay)));
}

module.exports = {
  computeAssessment,
  buildSchedule,
  allocateInstallment,
  round2,
  addMonths,
  toDate,
};
