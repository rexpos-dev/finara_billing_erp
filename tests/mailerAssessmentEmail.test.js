process.env.SMTP_HOST = 'smtp.test.local';
process.env.SMTP_USER = 'user@test.local';
process.env.SMTP_PASS = 'secret';

jest.mock('nodemailer');

const mailer = require('../server/utils/mailer');
const nodemailer = require('nodemailer');

const sendMailMock = jest.fn().mockResolvedValue({});
nodemailer.createTransport.mockReturnValue({ sendMail: sendMailMock });

const assessment = {
  assessmentNo: 'ASM-6-000002',
  studentLabel: 'Republik, Pickleball I.T (2026-0002)',
  grossAmount: 24875,
  discountAmount: 0,
  subsidyAmount: 0,
  netAmount: 24875,
  lines: [
    { description: 'Tuition Fee', amount: 2500 },
    { description: 'Registration / Enrollment', amount: 2500 },
  ],
  installments: [
    { label: 'Upon Enrollment', dueDate: '2026-09-08', amount: 15000, paidAmount: 15000, status: 'PAID' },
    { label: 'Full Payment',    dueDate: '2026-06-08', amount: 14875, paidAmount: 1500,  status: 'PARTIAL' },
  ],
};
const recipient = { name: 'Juan Dela Cruz', email: 'guardian@example.com' };

beforeEach(() => sendMailMock.mockClear());

describe('mailer.sendAssessmentEmail', () => {
  test('sends to the given recipient with the assessment number in the subject', async () => {
    await mailer.sendAssessmentEmail(assessment, recipient, { companyName: 'Bridges Academy' });
    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({
      to: 'guardian@example.com',
      subject: expect.stringContaining('ASM-6-000002'),
    }));
  });

  test('lists every fee line and the total payable', async () => {
    await mailer.sendAssessmentEmail(assessment, recipient, { companyName: 'Bridges Academy' });
    const html = sendMailMock.mock.calls[0][0].html;
    expect(html).toContain('Tuition Fee');
    expect(html).toContain('Registration / Enrollment');
    expect(html).toContain('24,875.00');
  });

  test('lists the payment schedule with due dates', async () => {
    await mailer.sendAssessmentEmail(assessment, recipient, { companyName: 'Bridges Academy' });
    const html = sendMailMock.mock.calls[0][0].html;
    expect(html).toContain('Upon Enrollment');
    expect(html).toContain('Full Payment');
    expect(html).toContain('15,000.00');
    expect(html).toContain('14,875.00');
  });

  test('shows what has already been paid on each installment, and its status', async () => {
    await mailer.sendAssessmentEmail(assessment, recipient, { companyName: 'Bridges Academy' });
    const html = sendMailMock.mock.calls[0][0].html;
    // Upon Enrollment: fully paid.
    expect(html).toContain('PAID');
    // Full Payment: partially paid — the guardian needs to see the paid
    // amount, not just the original installment amount, to know the balance.
    expect(html).toContain('1,500.00');
    expect(html).toContain('PARTIAL');
  });

  test('shows discount and subsidy lines only when present', async () => {
    await mailer.sendAssessmentEmail(assessment, recipient, {});
    let html = sendMailMock.mock.calls[0][0].html;
    expect(html).not.toContain('Less: discounts');
    expect(html).not.toContain('Less: DepEd subsidy');

    await mailer.sendAssessmentEmail(
      { ...assessment, discountAmount: 1000, subsidyAmount: 500, netAmount: 23875 },
      recipient, {}
    );
    html = sendMailMock.mock.calls[1][0].html;
    expect(html).toContain('Less: discounts');
    expect(html).toContain('Less: DepEd subsidy');
  });

  test('returns false without sending when the recipient has no email', async () => {
    const result = await mailer.sendAssessmentEmail(assessment, { name: 'No Email' }, {});
    expect(result).toBe(false);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  test('escapes fee descriptions and recipient name to prevent HTML injection', async () => {
    const malicious = {
      ...assessment,
      lines: [{ description: '<img src=x onerror=alert(1)>', amount: 100 }],
    };
    await mailer.sendAssessmentEmail(malicious, { name: '<script>alert(1)</script>', email: 'evil@example.com' }, {});
    const html = sendMailMock.mock.calls[0][0].html;
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<script>alert(1)</script>');
  });
});
