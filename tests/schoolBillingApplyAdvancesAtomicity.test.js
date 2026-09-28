jest.mock('../server/config/database', () => ({
  student:        { findFirst: jest.fn() },
  studentAdvance: { findMany: jest.fn(), update: jest.fn() },
  invoice:        { findMany: jest.fn() },
  paymentAR:      { findFirst: jest.fn() },
  $transaction:   jest.fn(),
}));
jest.mock('../server/utils/glPost', () => ({ safePost: jest.fn().mockResolvedValue({}) }));
jest.mock('../server/utils/studentLedger', () => ({ append: jest.fn().mockResolvedValue({ id: 1 }) }));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn() }));

const prisma = require('../server/config/database');
const ctrl = require('../server/controllers/schoolBillingController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 6, params: { studentId: '1' }, query: {}, body: {}, user: { id: 1 }, ...req },
     { json: resolve, status: () => ({ json: resolve }) }, reject);
});

function fakeTx() {
  const paymentRows = [];
  return {
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
});

describe('applying an advance across several open invoices', () => {
  test('settles every invoice inside one transaction, with distinct payment numbers', async () => {
    prisma.studentAdvance.findMany.mockResolvedValue([
      { id: 1, amount: 10000, appliedAmount: 0, paymentDate: new Date('2026-06-01') },
    ]);
    prisma.invoice.findMany.mockResolvedValue([
      { id: 10, invoiceNo: 'SI-6-000001', totalAmount: 5000, paidAmount: 0, dueDate: new Date('2026-07-01'), installment: null },
      { id: 11, invoiceNo: 'SI-6-000002', totalAmount: 5000, paidAmount: 0, dueDate: new Date('2026-08-01'), installment: null },
    ]);

    const out = await run(ctrl.applyAdvances);

    expect(out.applied).toBe(10000);
    expect(out.invoices.map((i) => i.invoiceNo)).toEqual(['SI-6-000001', 'SI-6-000002']);
    // One transaction for the invoice settlement, one for the ledger row.
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });
});
