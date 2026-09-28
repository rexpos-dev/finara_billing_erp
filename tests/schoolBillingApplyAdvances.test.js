jest.mock('../server/config/database', () => ({
  student:        { findFirst: jest.fn() },
  studentAdvance: { findMany: jest.fn(), update: jest.fn() },
  invoice:        { findMany: jest.fn() },
  paymentAR:      { findFirst: jest.fn().mockResolvedValue(null) },
  $transaction:   jest.fn(),
}));
jest.mock('../server/utils/glPost', () => ({ safePost: jest.fn().mockResolvedValue({}) }));
jest.mock('../server/utils/studentLedger', () => ({ append: jest.fn().mockResolvedValue({ id: 1 }) }));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn() }));

const prisma = require('../server/config/database');
const studentLedger = require('../server/utils/studentLedger');
const ctrl = require('../server/controllers/schoolBillingController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 6, params: { studentId: '1' }, query: {}, body: {}, user: { id: 1 }, ...req },
     { json: resolve, status: () => ({ json: resolve }) }, reject);
});

function fakeTx() {
  return {
    paymentAR: {
      findFirst: jest.fn().mockResolvedValue(null),
      create:    jest.fn().mockResolvedValue({}),
    },
    invoice:     { update: jest.fn().mockResolvedValue({}) },
    installment: { update: jest.fn().mockResolvedValue({}) },
    assessment:  { update: jest.fn().mockResolvedValue({}) },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  prisma.paymentAR.findFirst.mockResolvedValue(null);
  prisma.student.findFirst.mockResolvedValue({
    id: 1, businessId: 6, customerId: 100, studentNo: '2026-0001',
    firstName: 'Juan', lastName: 'Dela Cruz', middleName: null, suffix: null,
  });
  prisma.$transaction.mockImplementation((arg) => (
    typeof arg === 'function' ? arg(fakeTx()) : Promise.all(arg)
  ));
});

describe('applying a student advance to open invoices', () => {
  test('logs an ADVANCE_APPLIED ledger row, same as a cash collection would', async () => {
    // recordCollection appends a PAYMENT row when cash settles an invoice.
    // Applying an advance settles the invoice the same way — the AR clears —
    // so the statement of account must show it too, or the running ledger
    // balance stops matching what the invoices actually say is owed.
    prisma.studentAdvance.findMany.mockResolvedValue([
      { id: 1, amount: 5000, appliedAmount: 0, paymentDate: new Date('2026-06-01') },
    ]);
    prisma.invoice.findMany.mockResolvedValue([
      { id: 10, invoiceNo: 'SI-6-000001', totalAmount: 5000, paidAmount: 0, dueDate: new Date('2026-07-01'), installment: null },
    ]);

    const out = await run(ctrl.applyAdvances);

    expect(out.applied).toBe(5000);
    expect(studentLedger.append).toHaveBeenCalledTimes(1);
    const entry = studentLedger.append.mock.calls[0][1];
    expect(entry.type).toBe('ADVANCE_APPLIED');
    expect(entry.credit).toBe(5000);
    expect(entry.studentId).toBe(1);
    expect(entry.businessId).toBe(6);
  });

  test('writes no ledger row when there is nothing to apply', async () => {
    prisma.studentAdvance.findMany.mockResolvedValue([]);

    await run(ctrl.applyAdvances);

    expect(studentLedger.append).not.toHaveBeenCalled();
  });
});
