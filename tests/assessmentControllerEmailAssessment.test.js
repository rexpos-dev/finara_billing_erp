jest.mock('../server/config/database', () => ({
  assessment: { findFirst: jest.fn() },
  systemSetting: { findFirst: jest.fn() },
}));
jest.mock('../server/utils/mailer', () => ({
  getTransporter: jest.fn(() => true),
  sendAssessmentEmail: jest.fn(),
}));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn() }));

const prisma = require('../server/config/database');
const mailer = require('../server/utils/mailer');
const { recordAudit } = require('../server/utils/audit');
const ctrl = require('../server/controllers/assessmentController');

const run = (req) => new Promise((resolve, reject) => {
  ctrl.emailAssessment({ businessId: 6, params: { id: '2' }, user: { id: 9 }, ...req }, { json: resolve }, reject);
});

const baseStudent = {
  id: 23, lastName: 'Domingo', firstName: 'Rex', middleName: 'Test', suffix: null,
  studentNo: '2026-0002', email: null, guardians: [],
  customer: { name: 'Domingo, Rex Test', email: null },
};

const baseAssessment = {
  id: 2, assessmentNo: 'ASM-6-000002', grossAmount: 24875, discountAmount: 0,
  subsidyAmount: 0, netAmount: 24875, lines: [], installments: [],
  student: baseStudent,
};

beforeEach(() => {
  jest.clearAllMocks();
  mailer.getTransporter.mockReturnValue(true);
  prisma.systemSetting.findFirst.mockResolvedValue(null);
  mailer.sendAssessmentEmail.mockResolvedValue(true);
});

describe('assessmentController.emailAssessment', () => {
  test('400s when SMTP is not configured', async () => {
    mailer.getTransporter.mockReturnValue(null);
    await expect(run({})).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.assessment.findFirst).not.toHaveBeenCalled();
  });

  test('404s when the assessment does not exist', async () => {
    prisma.assessment.findFirst.mockResolvedValue(null);
    await expect(run({})).rejects.toMatchObject({ statusCode: 404 });
  });

  test('400s when neither a guardian nor the student has an email on file', async () => {
    prisma.assessment.findFirst.mockResolvedValue(baseAssessment);
    await expect(run({})).rejects.toMatchObject({ statusCode: 400 });
    expect(mailer.sendAssessmentEmail).not.toHaveBeenCalled();
  });

  test('prefers the primary-payer guardian\'s email', async () => {
    prisma.assessment.findFirst.mockResolvedValue({
      ...baseAssessment,
      student: {
        ...baseStudent,
        email: 'rex.student@example.com',
        guardians: [
          { name: 'Mother Domingo', email: 'mother@example.com', isPrimaryPayer: false },
          { name: 'Father Domingo', email: 'father@example.com', isPrimaryPayer: true },
        ],
      },
    });

    const out = await run({});

    expect(mailer.sendAssessmentEmail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ email: 'father@example.com', name: 'Father Domingo' }),
      expect.anything()
    );
    expect(out.message).toContain('father@example.com');
  });

  test('falls back to any guardian with an email when no primary payer has one', async () => {
    prisma.assessment.findFirst.mockResolvedValue({
      ...baseAssessment,
      student: {
        ...baseStudent,
        guardians: [
          { name: 'Father Domingo', email: null, isPrimaryPayer: true },
          { name: 'Mother Domingo', email: 'mother@example.com', isPrimaryPayer: false },
        ],
      },
    });

    await run({});

    expect(mailer.sendAssessmentEmail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ email: 'mother@example.com' }),
      expect.anything()
    );
  });

  test('falls back to the student\'s own email when no guardian has one', async () => {
    prisma.assessment.findFirst.mockResolvedValue({
      ...baseAssessment,
      student: { ...baseStudent, email: 'rex.student@example.com', guardians: [] },
    });

    await run({});

    expect(mailer.sendAssessmentEmail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ email: 'rex.student@example.com' }),
      expect.anything()
    );
  });

  test('falls back to the customer record\'s email when neither a guardian nor the student has one', async () => {
    prisma.assessment.findFirst.mockResolvedValue({
      ...baseAssessment,
      student: {
        ...baseStudent,
        email: null, guardians: [],
        customer: { name: 'Domingo, Rex Test', email: 'ar-customer@example.com' },
      },
    });

    await run({});

    expect(mailer.sendAssessmentEmail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ email: 'ar-customer@example.com' }),
      expect.anything()
    );
  });

  test('400s (not masked as a generic 500) when sendAssessmentEmail reports failure', async () => {
    prisma.assessment.findFirst.mockResolvedValue({
      ...baseAssessment,
      student: { ...baseStudent, email: 'rex.student@example.com' },
    });
    mailer.sendAssessmentEmail.mockResolvedValue(false);

    await expect(run({})).rejects.toMatchObject({ statusCode: 400 });
  });

  test('records an audit entry naming the recipient', async () => {
    prisma.assessment.findFirst.mockResolvedValue({
      ...baseAssessment,
      student: { ...baseStudent, email: 'rex.student@example.com' },
    });

    await run({});

    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'EMAIL', entity: 'Assessment', entityId: 2,
      summary: expect.stringContaining('rex.student@example.com'),
    }));
  });

  test('scopes the assessment lookup to the requesting business', async () => {
    prisma.assessment.findFirst.mockResolvedValue({
      ...baseAssessment,
      student: { ...baseStudent, email: 'rex.student@example.com' },
    });

    await run({ businessId: 99 });

    expect(prisma.assessment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ businessId: 99 }) })
    );
  });
});
