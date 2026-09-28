jest.mock('../server/config/database', () => ({
  student:  { findFirst: jest.fn().mockResolvedValue(null) },
  customer: { findFirst: jest.fn().mockResolvedValue(null) },
  $transaction: jest.fn(),
}));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn() }));

const prisma = require('../server/config/database');
const ctrl = require('../server/controllers/studentController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 6, params: {}, query: {}, body: {}, user: { id: 1 }, ...req },
     { json: resolve, status: () => ({ json: resolve }) }, reject);
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.student.findFirst.mockResolvedValue(null);
  prisma.customer.findFirst.mockResolvedValue(null);
  prisma.$transaction.mockImplementation((cb) => cb({
    customer: { create: jest.fn().mockResolvedValue({ id: 100, customerCode: 'STU-00001' }) },
    student:  { create: jest.fn(({ data }) => Promise.resolve({ id: 1, ...data, guardians: [], customer: { customerCode: 'STU-00001' } })) },
  }));
});

describe('registering a new student', () => {
  test('starts life as an applicant, not already enrolled', async () => {
    // The registry form is personal-info-only — no enrollment, no assessment,
    // no payment happens here. A student who has never been through the
    // enrollment wizard has nothing to show on their ledger, so defaulting to
    // ENROLLED (the schema's old default) leaves a blank, misleading ledger
    // page. Only advanceEnrollmentStatus (after the seat-holding installment
    // is paid) should ever move a student to ENROLLED.
    const out = await run(ctrl.createStudent, {
      body: { lastName: 'Domingo', firstName: 'Rex', guardians: [] },
    });

    expect(out.status).toBe('APPLICANT');
  });
});
