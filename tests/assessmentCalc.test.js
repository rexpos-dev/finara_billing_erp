const {
  computeAssessment, buildSchedule, allocateInstallment, addMonths, toDate,
} = require('../server/utils/assessmentCalc');

// A Grade 7 fee structure, the worked example from the module plan.
const feeType = (id, name, category, accountId, vatCode = 'EXEMPT') =>
  ({ id, name, category, accountId, vatCode });

const STRUCTURE = [
  { feeTypeId: 1, amount: 42000, billingBasis: 'ANNUAL',   sortOrder: 0, feeType: feeType(1, 'Tuition Fee', 'TUITION', 101) },
  { feeTypeId: 2, amount: 1500,  billingBasis: 'ONE_TIME', sortOrder: 1, feeType: feeType(2, 'Registration', 'OTHER', 102) },
  { feeTypeId: 3, amount: 6500,  billingBasis: 'ANNUAL',   sortOrder: 2, feeType: feeType(3, 'Miscellaneous', 'MISCELLANEOUS', 103) },
  { feeTypeId: 4, amount: 3500,  billingBasis: 'ANNUAL',   sortOrder: 3, feeType: feeType(4, 'Books', 'BOOKS', 104, 'VAT') },
];

const MONTHLY = { code: 'MONTHLY_10', installmentCount: 10, downPaymentAmount: 3500, discountPct: 0, surchargePct: 0 };
const CASH    = { code: 'CASH',       installmentCount: 1,  downPaymentAmount: 0,    discountPct: 5, surchargePct: 0 };

describe('computeAssessment', () => {
  test('totals the fee structure', () => {
    const r = computeAssessment({ structureLines: STRUCTURE, scheme: MONTHLY });
    expect(r.grossAmount).toBe(53500);
    expect(r.tuitionTotal).toBe(42000);
    expect(r.netPayable).toBe(53500);
  });

  test('scheme discount applies to tuition only, not the whole assessment', () => {
    const r = computeAssessment({ structureLines: STRUCTURE, scheme: CASH });
    // 5% of 42,000 tuition = 2,100. Discounting the 53,500 gross would be 2,675
    // and would quietly give away more than the school intended.
    expect(r.schemeDiscount).toBe(2100);
    expect(r.netAmount).toBe(51400);
  });

  test('percentage student discounts are of tuition; fixed ones are pesos', () => {
    const r = computeAssessment({
      structureLines: STRUCTURE,
      scheme: MONTHLY,
      discounts: [
        { type: 'SIBLING',  label: 'Sibling',  basis: 'PCT',   value: 5 },
        { type: 'ACADEMIC', label: 'Honor',    basis: 'FIXED', value: 1000 },
      ],
    });
    expect(r.studentDiscounts[0].amount).toBe(2100); // 5% of 42,000
    expect(r.studentDiscounts[1].amount).toBe(1000);
    expect(r.discountAmount).toBe(3100);
  });

  test('a subsidy moves who pays without reducing what the school earns', () => {
    const r = computeAssessment({
      structureLines: STRUCTURE,
      scheme: MONTHLY,
      subsidies: [{ type: 'ESC', amount: 9000 }],
    });
    expect(r.netAmount).toBe(53500);   // the school still earns the full fee
    expect(r.netPayable).toBe(44500);  // the parent owes 9,000 less
  });

  test('the full worked example: discount plus ESC', () => {
    const r = computeAssessment({
      structureLines: STRUCTURE,
      scheme: MONTHLY,
      discounts: [{ type: 'SIBLING', label: 'Sibling', basis: 'PCT', value: 5 }],
      subsidies: [{ type: 'ESC', amount: 9000 }],
    });
    expect(r.grossAmount).toBe(53500);
    expect(r.discountAmount).toBe(2100);
    expect(r.subsidyAmount).toBe(9000);
    expect(r.netPayable).toBe(42400);
  });

  test('refuses an assessment that discounts below zero', () => {
    expect(() => computeAssessment({
      structureLines: STRUCTURE,
      scheme: MONTHLY,
      discounts: [{ type: 'OTHER', label: 'Too much', basis: 'FIXED', value: 60000 }],
    })).toThrow(/exceed/i);
  });

  test('drops zero-amount lines but keeps the VAT code on the rest', () => {
    const r = computeAssessment({
      structureLines: [...STRUCTURE, { feeTypeId: 9, amount: 0, billingBasis: 'ANNUAL', sortOrder: 9, feeType: feeType(9, 'Unused', 'OTHER', 109) }],
      scheme: MONTHLY,
    });
    expect(r.lines).toHaveLength(4);
    expect(r.lines.find((l) => l.description === 'Books').vatCode).toBe('VAT');
  });

  test('needs a fee structure and a scheme', () => {
    expect(() => computeAssessment({ structureLines: [], scheme: MONTHLY })).toThrow(/at least one fee/i);
    expect(() => computeAssessment({ structureLines: STRUCTURE, scheme: null })).toThrow(/payment scheme/i);
  });
});

describe('buildSchedule', () => {
  const base = computeAssessment({
    structureLines: STRUCTURE,
    scheme: MONTHLY,
    discounts: [{ type: 'SIBLING', label: 'Sibling', basis: 'PCT', value: 5 }],
    subsidies: [{ type: 'ESC', amount: 9000 }],
  });

  test('installment 0 collects every one-time fee plus the down payment', () => {
    const s = buildSchedule({
      netPayable: base.netPayable, lines: base.lines, scheme: MONTHLY,
      startDate: '2026-06-15', assessmentDate: '2026-05-20',
    });
    // Registration 1,500 (ONE_TIME) + 3,500 down payment
    expect(s[0].seq).toBe(0);
    expect(s[0].amount).toBe(5000);
    expect(s[0].label).toBe('Upon Enrollment');
  });

  test('the schedule always sums to the payable exactly', () => {
    const s = buildSchedule({
      netPayable: base.netPayable, lines: base.lines, scheme: MONTHLY,
      startDate: '2026-06-15', assessmentDate: '2026-05-20',
    });
    const total = s.reduce((t, x) => t + x.amount, 0);
    expect(Math.round(total * 100) / 100).toBe(base.netPayable);
  });

  test('the last installment absorbs the rounding remainder', () => {
    // 1,000 over 3 installments is 333.33 each, leaving a stray cent.
    const s = buildSchedule({
      netPayable: 1000,
      lines: [{ billingBasis: 'ANNUAL', amount: 1000 }],
      scheme: { installmentCount: 3, downPaymentAmount: 0, surchargePct: 0 },
      startDate: '2026-06-15', assessmentDate: '2026-06-15',
    });
    expect(s.map((x) => x.amount)).toEqual([333.33, 333.33, 333.34]);
    expect(s.reduce((t, x) => t + x.amount, 0)).toBeCloseTo(1000, 2);
  });

  test('due dates run monthly from the school year start', () => {
    const s = buildSchedule({
      netPayable: 10000,
      lines: [{ billingBasis: 'ANNUAL', amount: 10000 }],
      scheme: { installmentCount: 3, downPaymentAmount: 0, surchargePct: 0 },
      startDate: '2026-06-15', assessmentDate: '2026-06-01',
    });
    expect(s.map((x) => x.dueDate.toISOString().slice(0, 10)))
      .toEqual(['2026-06-15', '2026-07-15', '2026-08-15']);
  });

  test('a full-payment scheme produces a single settled row', () => {
    const cash = computeAssessment({ structureLines: STRUCTURE, scheme: CASH });
    const s = buildSchedule({
      netPayable: cash.netPayable, lines: cash.lines, scheme: CASH,
      startDate: '2026-06-15', assessmentDate: '2026-05-20',
    });
    expect(s).toHaveLength(2);           // enrollment row + the single payment
    expect(s[1].label).toBe('Full Payment');
  });

  test('a surcharge is added to the financed balance, not to the down payment', () => {
    const s = buildSchedule({
      netPayable: 11000,
      lines: [{ billingBasis: 'ANNUAL', amount: 11000 }],
      scheme: { installmentCount: 2, downPaymentAmount: 1000, surchargePct: 10 },
      startDate: '2026-06-15', assessmentDate: '2026-06-01',
    });
    expect(s[0].amount).toBe(1000);            // down payment, no surcharge
    expect(s[1].amount + s[2].amount).toBe(11000); // 10,000 + 10% = 11,000
  });
});

describe('allocateInstallment', () => {
  const lines = [
    { feeTypeId: 1, accountId: 101, description: 'Tuition',       vatCode: 'EXEMPT', amount: 42000, billingBasis: 'ANNUAL' },
    { feeTypeId: 3, accountId: 103, description: 'Miscellaneous', vatCode: 'EXEMPT', amount: 6500,  billingBasis: 'ANNUAL' },
    { feeTypeId: 2, accountId: 102, description: 'Registration',  vatCode: 'EXEMPT', amount: 1500,  billingBasis: 'ONE_TIME' },
  ];

  test('splits an installment across annual lines, pro rata', () => {
    const parts = allocateInstallment({ installmentAmount: 4850, lines });
    expect(parts).toHaveLength(2);                       // one-time line excluded
    expect(parts.find((p) => p.accountId === 101).amount).toBe(4200);
    expect(parts.find((p) => p.accountId === 103).amount).toBe(650);
  });

  test('the parts always sum to the installment', () => {
    const parts = allocateInstallment({ installmentAmount: 3333.33, lines });
    const total = parts.reduce((s, p) => s + p.amount, 0);
    expect(Math.round(total * 100) / 100).toBe(3333.33);
  });

  test('includes one-time lines when asked, for the enrollment invoice', () => {
    const parts = allocateInstallment({ installmentAmount: 5000, lines, includeOneTime: true });
    expect(parts).toHaveLength(3);
    expect(parts.reduce((s, p) => s + p.amount, 0)).toBeCloseTo(5000, 2);
  });

  // Regression: a one-time fee used to be pro-rated along with everything else,
  // so a ₱1,500 registration payment landed mostly on the tuition account and,
  // because a VATable books line was in the pool, picked up VAT on a payment
  // that is entirely exempt.
  test('a one-time fee is billed at face value, not pro-rated', () => {
    const parts = allocateInstallment({ installmentAmount: 1500, lines, includeOneTime: true });
    expect(parts).toHaveLength(1);
    expect(parts[0].accountId).toBe(102);        // Registration, in full
    expect(parts[0].amount).toBe(1500);
  });

  test('anything beyond the one-time fees spreads over the annual lines', () => {
    // 1,500 registration at face value, then 3,500 across tuition + misc.
    const parts = allocateInstallment({ installmentAmount: 5000, lines, includeOneTime: true });
    const reg = parts.find((p) => p.accountId === 102);
    expect(reg.amount).toBe(1500);
    const spread = parts.filter((p) => p.accountId !== 102);
    expect(spread.reduce((s, p) => s + p.amount, 0)).toBeCloseTo(3500, 2);
    // Pro rata over 42,000 : 6,500
    expect(spread.find((p) => p.accountId === 101).amount).toBeCloseTo(3030.93, 2);
  });

  test('a down payment smaller than the one-time fees is capped, not overdrawn', () => {
    const parts = allocateInstallment({ installmentAmount: 900, lines, includeOneTime: true });
    expect(parts).toHaveLength(1);
    expect(parts[0].amount).toBe(900);
    expect(parts.reduce((s, p) => s + p.amount, 0)).toBe(900);
  });

  test('several one-time fees under a capped down payment split pro rata, not first-come-first-served', () => {
    // A heavily discounted/subsidised enrollment can cap the down payment
    // below the combined one-time fees (see buildSchedule). With two such
    // fees, billing the first in full and starving the second would make the
    // shortfall depend on array order rather than being shared fairly.
    const twoOneTime = [
      { feeTypeId: 1, accountId: 101, description: 'Tuition',      vatCode: 'EXEMPT', amount: 42000, billingBasis: 'ANNUAL' },
      { feeTypeId: 2, accountId: 102, description: 'Registration', vatCode: 'EXEMPT', amount: 1000,  billingBasis: 'ONE_TIME' },
      { feeTypeId: 5, accountId: 105, description: 'ID Fee',       vatCode: 'EXEMPT', amount: 500,   billingBasis: 'ONE_TIME' },
    ];
    const parts = allocateInstallment({ installmentAmount: 900, lines: twoOneTime, includeOneTime: true });

    expect(parts).toHaveLength(2);
    expect(parts.find((p) => p.accountId === 102).amount).toBe(600);  // 1000 * (900/1500)
    expect(parts.find((p) => p.accountId === 105).amount).toBe(300);  // 500  * (900/1500)
    expect(parts.reduce((s, p) => s + p.amount, 0)).toBe(900);
  });

  test('one-time lines never appear on a regular installment', () => {
    const parts = allocateInstallment({ installmentAmount: 4090, lines });
    expect(parts.find((p) => p.accountId === 102)).toBeUndefined();
    expect(parts.reduce((s, p) => s + p.amount, 0)).toBeCloseTo(4090, 2);
  });

  test('carries the VAT code through, so books stay VATable', () => {
    const withBooks = [...lines, { feeTypeId: 4, accountId: 104, description: 'Books', vatCode: 'VAT', amount: 3500, billingBasis: 'ANNUAL' }];
    const parts = allocateInstallment({ installmentAmount: 5200, lines: withBooks });
    expect(parts.find((p) => p.accountId === 104).vatCode).toBe('VAT');
    expect(parts.find((p) => p.accountId === 101).vatCode).toBe('EXEMPT');
  });

  test('returns nothing when there is no annual line to allocate against', () => {
    const onlyOneTime = [{ feeTypeId: 2, accountId: 102, description: 'Registration', vatCode: 'EXEMPT', amount: 1500, billingBasis: 'ONE_TIME' }];
    expect(allocateInstallment({ installmentAmount: 500, lines: onlyOneTime })).toEqual([]);
  });
});

describe('addMonths', () => {
  test('clamps to the end of a shorter month', () => {
    // 31 Jan + 1 month must be 28 Feb, never 3 March — a due date must not
    // skip into the following month.
    expect(addMonths('2026-01-31', 1).toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1).toISOString().slice(0, 10)).toBe('2024-02-29');
  });

  test('rolls over the year boundary', () => {
    expect(addMonths('2026-11-15', 3).toISOString().slice(0, 10)).toBe('2027-02-15');
  });

  test('is timezone-stable, matching glPost.dateKey', () => {
    expect(toDate('2026-06-15').toISOString().slice(0, 10)).toBe('2026-06-15');
    expect(addMonths('2026-06-15', 0).toISOString().slice(0, 10)).toBe('2026-06-15');
  });
});
