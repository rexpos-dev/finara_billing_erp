jest.mock('../server/config/database', () => ({
  student:    { findFirst: jest.fn() },
  invoice:    { findMany: jest.fn() },
  paymentAR:  { findFirst: jest.fn() },
  assessment: { findFirst: jest.fn() },
  $transaction: jest.fn(),
}));
jest.mock('../server/utils/glPost', () => ({ safePost: jest.fn().mockResolvedValue({}) }));
jest.mock('../server/utils/studentLedger', () => ({ append: jest.fn().mockResolvedValue({ id: 1 }) }));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn() }));
jest.mock('../server/utils/schoolInvoice', () => ({
  assertPostable: jest.fn().mockResolvedValue(undefined),
  AR_STUDENTS: '1110', ADVANCES: '2215',
}));

const prisma = require('../server/config/database');
const ctrl = require('../server/controllers/schoolBillingController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 6, params: {}, query: {}, body: {}, user: { id: 1 }, ...req },
     { json: resolve, status: () => ({ json: resolve }) }, reject);
});

// A tx stand-in whose paymentAR.findFirst sees writes made earlier IN THE SAME
// transaction, the way a real DB connection would — proves paymentNo
// generation still works once every invoice shares one transaction.
function fakeTx() {
  const paymentRows = [];
  return {
    paymentRows,
    paymentAR: {
      findFirst: jest.fn(async () => paymentRows.slice().sort((a, b) => b.paymentNo.localeCompare(a.paymentNo))[0] || null),
      create: jest.fn(async ({ data }) => { paymentRows.push(data); return data; }),
    },
    invoice:     { update: jest.fn().mockResolvedValue({}) },
    installment: { update: jest.fn().mockResolvedValue({}) },
    assessment:  { update: jest.fn().mockResolvedValue({}) },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  prisma.student.findFirst.mockResolvedValue({
    id: 1, businessId: 6, customerId: 100, studentNo: '2026-0001',
    firstName: 'Juan', lastName: 'Dela Cruz', middleName: null, suffix: null,
  });
  prisma.$transaction.mockImplementation((arg) => (
    typeof arg === 'function' ? arg(fakeTx()) : Promise.all(arg)
  ));
  // No open assessment for this student — advanceEnrollmentStatus (called at
  // the end of recordCollection) short-circuits and is not under test here.
  prisma.assessment.findFirst.mockResolvedValue(null);
});

describe('recording a collection against several open invoices', () => {
  test('settles every invoice inside one transaction instead of one per invoice', async () => {
    // Previously each invoice got its own prisma.$transaction call, so a
    // failure partway through a multi-invoice payment left earlier invoices
    // marked paid with nothing to roll them back — and a retry could
    // double-apply. One payment must be one atomic unit.
    prisma.invoice.findMany.mockResolvedValue([
      { id: 10, invoiceNo: 'SI-6-000001', totalAmount: 5000, paidAmount: 0, dueDate: new Date('2026-07-01'), installment: null },
      { id: 11, invoiceNo: 'SI-6-000002', totalAmount: 5000, paidAmount: 0, dueDate: new Date('2026-08-01'), installment: null },
    ]);

    const out = await run(ctrl.recordCollection, { body: { studentId: 1, amount: 10000 } });

    expect(out.applied).toHaveLength(2);
    expect(out.applied.map((a) => a.paymentNo)).toEqual(['SPR-6-000001', 'SPR-6-000002']);

    // One call for the whole invoice settlement, one for the ledger row —
    // never one call per invoice.
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  test('a single-invoice payment is unaffected', async () => {
    prisma.invoice.findMany.mockResolvedValue([
      { id: 10, invoiceNo: 'SI-6-000001', totalAmount: 5000, paidAmount: 0, dueDate: new Date('2026-07-01'), installment: null },
    ]);

    const out = await run(ctrl.recordCollection, { body: { studentId: 1, amount: 5000 } });

    expect(out.applied).toHaveLength(1);
    expect(out.applied[0].paymentNo).toBe('SPR-6-000001');
  });
});
