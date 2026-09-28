jest.mock('../server/config/database', () => ({
  invoice:     { findFirst: jest.fn(), create: jest.fn() },
  installment: { update: jest.fn() },
  assessment:  { update: jest.fn() },
  studentLedger: { findFirst: jest.fn(), create: jest.fn() },
  business:    { findUnique: jest.fn() },
  systemSetting: { findUnique: jest.fn() },
  $transaction: jest.fn(),
}));
jest.mock('../server/utils/glPost', () => ({
  safePost: jest.fn(),
  dateKey:  jest.requireActual('../server/utils/glPost').dateKey,
}));

const prisma = require('../server/config/database');
const glPost = require('../server/utils/glPost');
const policy = require('../server/utils/schoolPolicy');
const schoolInvoice = require('../server/utils/schoolInvoice');

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// A school assesses "Books ₱3,500" — a price the parent pays, not a base to
// add 12% onto. So the installment amount and the invoice total must agree.
const installment = { id: 1, assessmentId: 1, seq: 1, label: 'Installment 1 of 10', dueDate: new Date('2026-10-01T00:00:00Z') };
const student = { id: 1, customerId: 1, label: 'Dela Cruz, Juan (2026-0001)' };

beforeEach(() => {
  jest.clearAllMocks();
  policy.clearCache();
  prisma.business.findUnique.mockResolvedValue({ booksStartDate: null });
  prisma.systemSetting.findUnique.mockResolvedValue({ value: 'ON_BILLING' });
  prisma.invoice.findFirst.mockResolvedValue(null);
  prisma.studentLedger.findFirst.mockResolvedValue(null);
  prisma.studentLedger.create.mockImplementation(async ({ data }) => ({ id: 1, ...data }));

  // Run the transaction body against the mocked client and hand back the
  // invoice it built, so the totals under test are the ones actually written.
  prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
  prisma.invoice.create.mockImplementation(async ({ data }) => ({
    id: 1, ...data, lines: data.lines.create,
  }));
});

describe('school invoice VAT treatment', () => {
  test('a VATable line is treated as VAT-inclusive, so the invoice matches the installment', async () => {
    const lines = [
      { accountId: 101, description: 'Tuition',       vatCode: 'EXEMPT', amount: 3814.71 },
      { accountId: 104, description: 'Books',         vatCode: 'VAT',    amount: 275.29 },
    ];
    const invoice = await schoolInvoice.billInstallment({
      installment, lines, student, businessId: 6, userId: 1,
    });

    // 4,090.00 was scheduled; 4,090.00 must be billed.
    expect(r2(invoice.totalAmount)).toBe(4090);
    // The VAT is carved OUT of the 275.29, not added to it.
    expect(r2(invoice.vatAmount)).toBeCloseTo(29.5, 2);
    expect(r2(invoice.subtotal)).toBeCloseTo(4060.5, 2);
  });

  test('an all-exempt installment carries no output VAT at all', async () => {
    const lines = [
      { accountId: 101, description: 'Tuition',       vatCode: 'EXEMPT', amount: 3000 },
      { accountId: 103, description: 'Miscellaneous', vatCode: 'EXEMPT', amount: 1090 },
    ];
    const invoice = await schoolInvoice.billInstallment({
      installment, lines, student, businessId: 6, userId: 1,
    });
    expect(r2(invoice.vatAmount)).toBe(0);
    expect(r2(invoice.totalAmount)).toBe(4090);
  });

  test('the GL entry balances and debits student receivables', async () => {
    const lines = [
      { accountId: 101, description: 'Tuition', vatCode: 'EXEMPT', amount: 3814.71 },
      { accountId: 104, description: 'Books',   vatCode: 'VAT',    amount: 275.29 },
    ];
    await schoolInvoice.billInstallment({ installment, lines, student, businessId: 6, userId: 1 });

    expect(glPost.safePost).toHaveBeenCalledTimes(1);
    const entry = glPost.safePost.mock.calls[0][0];
    const dr = r2(entry.lines.reduce((s, l) => s + (l.debit  || 0), 0));
    const cr = r2(entry.lines.reduce((s, l) => s + (l.credit || 0), 0));
    expect(dr).toBe(cr);
    expect(entry.lines[0].accountCode).toBe('1110');
    expect(entry.lines[0].debit).toBe(4090);
    expect(entry.lines.some((l) => l.accountCode === '2030')).toBe(true);
  });

  test('under the defer-and-amortise policy the invoice posts nothing', async () => {
    prisma.systemSetting.findUnique.mockResolvedValue({ value: 'ON_ASSESSMENT' });
    const lines = [{ accountId: 101, description: 'Tuition', vatCode: 'EXEMPT', amount: 4090 }];

    const invoice = await schoolInvoice.billInstallment({
      installment, lines, student, businessId: 6, userId: 1,
    });

    // The receivable was booked in full when the assessment was issued;
    // posting again here would double-count AR and revenue.
    expect(glPost.safePost).not.toHaveBeenCalled();
    expect(r2(invoice.totalAmount)).toBe(4090);
  });

  test('under ON_BILLING the charge lands on the student ledger once, at the gross', async () => {
    const lines = [
      { accountId: 101, description: 'Tuition', vatCode: 'EXEMPT', amount: 3814.71 },
      { accountId: 104, description: 'Books',   vatCode: 'VAT',    amount: 275.29 },
    ];
    await schoolInvoice.billInstallment({ installment, lines, student, businessId: 6, userId: 1 });

    expect(prisma.studentLedger.create).toHaveBeenCalledTimes(1);
    const row = prisma.studentLedger.create.mock.calls[0][0].data;
    // The parent owes the VAT-inclusive total, not the ex-VAT subtotal.
    expect(r2(row.debit)).toBe(4090);
    expect(row.credit).toBe(0);
    expect(row.type).toBe('CHARGE');
    expect(row.studentId).toBe(student.id);
    // First row for this student: seq 1, and the balance is the charge itself.
    expect(row.seq).toBe(1);
    expect(r2(row.balance)).toBe(4090);
  });

  test('under ON_ASSESSMENT the invoice is a notice, so it adds no ledger row', async () => {
    prisma.systemSetting.findUnique.mockResolvedValue({ value: 'ON_ASSESSMENT' });
    const lines = [{ accountId: 101, description: 'Tuition', vatCode: 'EXEMPT', amount: 4090 }];

    await schoolInvoice.billInstallment({ installment, lines, student, businessId: 6, userId: 1 });

    // The whole year was charged when the assessment was issued — charging
    // again here would show the parent double what they owe.
    expect(prisma.studentLedger.create).not.toHaveBeenCalled();
  });

  test('refuses to bill before the books start, rather than posting nothing silently', async () => {
    prisma.business.findUnique.mockResolvedValue({ booksStartDate: new Date('2026-09-07T00:00:00Z') });
    const early = { ...installment, dueDate: new Date('2026-06-01T00:00:00Z') };

    await expect(schoolInvoice.billInstallment({
      installment: early,
      lines: [{ accountId: 101, description: 'Tuition', vatCode: 'EXEMPT', amount: 3000 }],
      student, businessId: 6, userId: 1,
    })).rejects.toMatchObject({ code: 'PRE_CUTOVER', statusCode: 422 });

    expect(prisma.invoice.create).not.toHaveBeenCalled();
  });
});

describe('the assessment opening entry (defer and amortise)', () => {
  test('the three debits sum to the gross credited to unearned income', async () => {
    await schoolInvoice.postAssessmentOpening({
      businessId: 6, userId: 1, date: '2026-09-08',
      assessmentNo: 'ASM-6-000001', studentLabel: 'Dela Cruz, Juan',
      grossAmount: 53500, discountAmount: 2100, subsidyAmount: 9000, netPayable: 42400,
    });

    const entry = glPost.safePost.mock.calls[0][0];
    const dr = r2(entry.lines.reduce((s, l) => s + (l.debit  || 0), 0));
    const cr = r2(entry.lines.reduce((s, l) => s + (l.credit || 0), 0));
    expect(dr).toBe(53500);
    expect(cr).toBe(53500);

    const byCode = Object.fromEntries(entry.lines.map((l) => [l.accountCode, l]));
    expect(byCode['1110'].debit).toBe(42400);   // parent owes
    expect(byCode['4499'].debit).toBe(2100);    // given away
    expect(byCode['1120'].debit).toBe(9000);    // DepEd owes
    expect(byCode['2210'].credit).toBe(53500);  // deferred
  });

  test('omits the discount and subsidy legs when there are none', async () => {
    await schoolInvoice.postAssessmentOpening({
      businessId: 6, userId: 1, date: '2026-09-08',
      assessmentNo: 'ASM-6-000002', studentLabel: 'Reyes, Ana',
      grossAmount: 30000, discountAmount: 0, subsidyAmount: 0, netPayable: 30000,
    });
    const entry = glPost.safePost.mock.calls[0][0];
    expect(entry.lines).toHaveLength(2);
    expect(entry.lines[0].debit).toBe(30000);
    expect(entry.lines[1].credit).toBe(30000);
  });
});
