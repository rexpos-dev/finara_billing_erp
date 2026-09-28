jest.mock('../server/config/database', () => ({
  student:        { findFirst: jest.fn() },
  invoice:        { findMany: jest.fn() },
  assessment:     { findMany: jest.fn() },
  studentAdvance: { findMany: jest.fn() },
}));
jest.mock('../server/utils/schoolPolicy', () => ({
  getPolicy:    jest.fn(),
  ON_BILLING:   'ON_BILLING',
  ON_ASSESSMENT: 'ON_ASSESSMENT',
}));

const prisma = require('../server/config/database');
const policy = require('../server/utils/schoolPolicy');
const ctrl = require('../server/controllers/studentController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 6, params: { id: '1' }, query: {}, body: {}, user: { id: 1 }, ...req },
     { json: resolve, status: () => ({ json: resolve }) }, reject);
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.student.findFirst.mockResolvedValue({
    id: 1, businessId: 6, customerId: 100, firstName: 'Juan', lastName: 'Dela Cruz',
  });
  prisma.studentAdvance.findMany.mockResolvedValue([]);
});

describe("getLedger's outstanding balance under ON_ASSESSMENT", () => {
  test('counts the full posted assessment as owed, not just what has been invoiced so far', async () => {
    // Under ON_ASSESSMENT the whole year is booked when the assessment is
    // issued; only the first installment has been billed as an invoice.
    // Reading invoices alone (the ON_BILLING behaviour) would show the
    // student as owing only the down payment, hiding the rest of the year.
    policy.getPolicy.mockResolvedValue('ON_ASSESSMENT');
    prisma.invoice.findMany.mockResolvedValue([
      {
        id: 1, invoiceNo: 'SI-6-000001', status: 'PAID',
        totalAmount: 5000, paidAmount: 5000,
        invoiceDate: new Date('2026-06-01'), dueDate: new Date('2026-06-01'),
        lines: [], payments: [],
      },
    ]);
    prisma.assessment.findMany.mockResolvedValue([
      {
        id: 1, status: 'POSTED', assessmentDate: new Date('2026-06-01'),
        netAmount: 50000, subsidyAmount: 0, paidAmount: 5000,
        installments: [
          { id: 1, seq: 0, amount: 5000,  paidAmount: 5000, status: 'PAID',      dueDate: new Date('2026-06-01') },
          { id: 2, seq: 1, amount: 15000, paidAmount: 0,    status: 'SCHEDULED', dueDate: new Date('2026-07-01') },
          { id: 3, seq: 2, amount: 15000, paidAmount: 0,    status: 'SCHEDULED', dueDate: new Date('2026-08-01') },
          { id: 4, seq: 3, amount: 15000, paidAmount: 0,    status: 'SCHEDULED', dueDate: new Date('2026-09-01') },
        ],
        enrollment: { schoolYear: { code: 'SY2026' }, gradeLevel: { code: 'G7', name: 'Grade 7' }, paymentScheme: { name: 'Quarterly' } },
      },
    ]);

    const out = await run(ctrl.getLedger, { businessId: 6 });
    expect(out.summary.totalBilled).toBe(50000);
    expect(out.summary.totalPaid).toBe(5000);
    expect(out.summary.outstanding).toBe(45000);
  });

  test('an overdue installment counts even though it was never invoiced', async () => {
    policy.getPolicy.mockResolvedValue('ON_ASSESSMENT');
    prisma.invoice.findMany.mockResolvedValue([]);
    prisma.assessment.findMany.mockResolvedValue([{
      id: 1, status: 'POSTED', assessmentDate: new Date('2026-06-01'),
      netAmount: 20000, subsidyAmount: 0, paidAmount: 0,
      installments: [
        { id: 1, seq: 1, amount: 20000, paidAmount: 0, status: 'SCHEDULED', dueDate: new Date('2020-01-01') },
      ],
      enrollment: { schoolYear: { code: 'SY2026' }, gradeLevel: { code: 'G7', name: 'Grade 7' }, paymentScheme: { name: 'Full' } },
    }]);

    const out = await run(ctrl.getLedger, { businessId: 6 });
    expect(out.summary.overdue).toBe(20000);
  });

  test('a cancelled assessment is not counted as owed', async () => {
    policy.getPolicy.mockResolvedValue('ON_ASSESSMENT');
    prisma.invoice.findMany.mockResolvedValue([]);
    prisma.assessment.findMany.mockResolvedValue([{
      id: 1, status: 'VOIDED', assessmentDate: new Date('2026-06-01'),
      netAmount: 20000, subsidyAmount: 0, paidAmount: 0,
      installments: [
        { id: 1, seq: 1, amount: 20000, paidAmount: 0, status: 'CANCELLED', dueDate: new Date('2020-01-01') },
      ],
      enrollment: { schoolYear: { code: 'SY2026' }, gradeLevel: { code: 'G7', name: 'Grade 7' }, paymentScheme: { name: 'Full' } },
    }]);

    const out = await run(ctrl.getLedger, { businessId: 6 });
    expect(out.summary.totalBilled).toBe(0);
    expect(out.summary.outstanding).toBe(0);
  });
});

describe("getLedger's outstanding balance under ON_BILLING (unchanged)", () => {
  test('still reads straight from invoices', async () => {
    policy.getPolicy.mockResolvedValue('ON_BILLING');
    prisma.invoice.findMany.mockResolvedValue([
      {
        id: 1, invoiceNo: 'SI-6-000001', status: 'PARTIAL',
        totalAmount: 15000, paidAmount: 5000,
        invoiceDate: new Date('2026-07-01'), dueDate: new Date('2026-07-01'),
        lines: [], payments: [],
      },
    ]);
    prisma.assessment.findMany.mockResolvedValue([]);

    const out = await run(ctrl.getLedger, { businessId: 6 });
    expect(out.summary.totalBilled).toBe(15000);
    expect(out.summary.totalPaid).toBe(5000);
    expect(out.summary.outstanding).toBe(10000);
  });
});
