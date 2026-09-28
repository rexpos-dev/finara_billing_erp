jest.mock('../server/config/database', () => ({
  systemSetting: { findUnique: jest.fn(), upsert: jest.fn() },
  assessment:    { count: jest.fn(), findMany: jest.fn(), aggregate: jest.fn() },
  schoolYear:    { findFirst: jest.fn() },
  amortizationRun: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn() },
  account:       { findMany: jest.fn() },
  business:      { findUnique: jest.fn() },
}));
jest.mock('../server/utils/glPost', () => ({
  post:     jest.fn(),
  safePost: jest.fn(),
  dateKey:  jest.requireActual('../server/utils/glPost').dateKey,
}));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn() }));

const prisma = require('../server/config/database');
const policy = require('../server/utils/schoolPolicy');
const glPost = require('../server/utils/glPost');
const ctrl = require('../server/controllers/amortizationController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 6, params: {}, query: {}, body: {}, user: { id: 1 }, ...req },
     { json: resolve, status: () => ({ json: resolve }) }, reject);
});

beforeEach(() => {
  jest.clearAllMocks();
  policy.clearCache();
  prisma.business.findUnique.mockResolvedValue({ booksStartDate: null });
});

describe('revenue policy', () => {
  test('defaults to recognising as billed when nothing is configured', async () => {
    prisma.systemSetting.findUnique.mockResolvedValue(null);
    await expect(policy.getPolicy(6)).resolves.toBe('ON_BILLING');
  });

  test('an unrecognised stored value falls back to the default rather than breaking posting', async () => {
    prisma.systemSetting.findUnique.mockResolvedValue({ value: 'SOMETHING_ELSE' });
    await expect(policy.getPolicy(6)).resolves.toBe('ON_BILLING');
  });

  test('reads the configured policy', async () => {
    prisma.systemSetting.findUnique.mockResolvedValue({ value: 'ON_ASSESSMENT' });
    await expect(policy.getPolicy(6)).resolves.toBe('ON_ASSESSMENT');
  });

  test('refuses to switch once an assessment has been issued', async () => {
    prisma.systemSetting.findUnique.mockResolvedValue({ value: 'ON_BILLING' });
    prisma.assessment.count.mockResolvedValue(3);
    // Switching mid-year would leave revenue double-counted or unrecognised.
    await expect(policy.setPolicy(6, 'ON_ASSESSMENT')).rejects.toMatchObject({ statusCode: 409 });
    expect(prisma.systemSetting.upsert).not.toHaveBeenCalled();
  });

  test('allows the switch while no assessment has been issued', async () => {
    prisma.systemSetting.findUnique.mockResolvedValue({ value: 'ON_BILLING' });
    prisma.assessment.count.mockResolvedValue(0);
    await expect(policy.setPolicy(6, 'ON_ASSESSMENT')).resolves.toBe('ON_ASSESSMENT');
    expect(prisma.systemSetting.upsert).toHaveBeenCalled();
  });

  test('re-saving the current policy is allowed even with issued assessments', async () => {
    prisma.systemSetting.findUnique.mockResolvedValue({ value: 'ON_ASSESSMENT' });
    prisma.assessment.count.mockResolvedValue(12);
    await expect(policy.setPolicy(6, 'ON_ASSESSMENT')).resolves.toBe('ON_ASSESSMENT');
  });

  test('rejects an unknown policy name', async () => {
    prisma.systemSetting.findUnique.mockResolvedValue(null);
    await expect(policy.setPolicy(6, 'WHATEVER')).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('amortisation', () => {
  const schoolYear = {
    id: 1, code: 'SY2026-2027',
    startDate: new Date('2026-06-01T00:00:00Z'),
    endDate:   new Date('2027-03-31T00:00:00Z'),   // 10 months
  };

  const assessments = [
    {
      id: 1, grossAmount: 53500,
      lines: [
        { accountId: 101, amount: 42000, vatCode: 'EXEMPT' },
        { accountId: 102, amount: 1500,  vatCode: 'EXEMPT' },
        { accountId: 103, amount: 6500,  vatCode: 'EXEMPT' },
        { accountId: 104, amount: 3500,  vatCode: 'VAT'    },
      ],
    },
  ];

  const asDeferred = () => prisma.systemSetting.findUnique.mockResolvedValue({ value: 'ON_ASSESSMENT' });

  test('says there is nothing to do under the recognise-as-billed policy', async () => {
    prisma.systemSetting.findUnique.mockResolvedValue({ value: 'ON_BILLING' });
    const out = await run(ctrl.previewAmortization, { query: { period: '2026-07' } });
    expect(out.applicable).toBe(false);
    expect(out.message).toMatch(/nothing to amortise/i);
  });

  test('refuses to post under the recognise-as-billed policy', async () => {
    prisma.systemSetting.findUnique.mockResolvedValue({ value: 'ON_BILLING' });
    await expect(run(ctrl.runAmortization, { body: { period: '2026-07' } }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(glPost.post).not.toHaveBeenCalled();
  });

  test('recognises one tenth of the gross assessment per month', async () => {
    asDeferred();
    prisma.schoolYear.findFirst.mockResolvedValue(schoolYear);
    prisma.amortizationRun.findUnique.mockResolvedValue(null);
    prisma.assessment.findMany.mockResolvedValue(assessments);
    prisma.account.findMany.mockResolvedValue([
      { id: 101, accountCode: '4400', accountName: 'Tuition Fees' },
      { id: 102, accountCode: '4410', accountName: 'Registration' },
      { id: 103, accountCode: '4420', accountName: 'Miscellaneous Fees' },
      { id: 104, accountCode: '4470', accountName: 'Books' },
    ]);

    const out = await run(ctrl.previewAmortization, { query: { period: '2026-07' } });
    expect(out.months).toBe(10);
    expect(out.total).toBe(5350);       // 53,500 / 10
  });

  test('the credits always sum to the debit, VAT included', async () => {
    asDeferred();
    prisma.schoolYear.findFirst.mockResolvedValue(schoolYear);
    prisma.amortizationRun.findUnique.mockResolvedValue(null);
    prisma.assessment.findMany.mockResolvedValue(assessments);
    prisma.account.findMany.mockResolvedValue([]);

    const out = await run(ctrl.previewAmortization, { query: { period: '2026-07' } });
    const credits = out.lines.reduce((s, l) => s + l.amount, 0);
    expect(Math.round(credits * 100) / 100).toBe(out.total);
  });

  test('a VATable fee is split into revenue and output VAT', async () => {
    asDeferred();
    prisma.schoolYear.findFirst.mockResolvedValue(schoolYear);
    prisma.amortizationRun.findUnique.mockResolvedValue(null);
    prisma.assessment.findMany.mockResolvedValue(assessments);
    prisma.account.findMany.mockResolvedValue([
      { id: 104, accountCode: '4470', accountName: 'Books' },
    ]);

    const out = await run(ctrl.previewAmortization, { query: { period: '2026-07' } });
    const vat = out.lines.find((l) => l.accountCode === '2030');
    expect(vat).toBeDefined();
    // Books are 3,500/yr = 350/month VAT-inclusive -> 312.50 revenue + 37.50 VAT
    expect(vat.amount).toBeCloseTo(37.5, 2);
  });

  test('refuses a period that was already recognised', async () => {
    asDeferred();
    prisma.schoolYear.findFirst.mockResolvedValue(schoolYear);
    prisma.amortizationRun.findUnique.mockResolvedValue({
      period: '2026-07', amount: 5350, runAt: new Date('2026-07-31T00:00:00Z'),
    });

    // Running a month twice would double that month's revenue.
    await expect(run(ctrl.runAmortization, { body: { period: '2026-07' } }))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(glPost.post).not.toHaveBeenCalled();
  });

  test('refuses a period outside the school year', async () => {
    asDeferred();
    prisma.schoolYear.findFirst.mockResolvedValue(schoolYear);
    await expect(run(ctrl.runAmortization, { body: { period: '2027-08' } }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('rejects a malformed period', async () => {
    asDeferred();
    await expect(run(ctrl.runAmortization, { body: { period: '2026-13' } }))
      .rejects.toMatchObject({ statusCode: 400 });
    await expect(run(ctrl.runAmortization, { body: { period: 'June' } }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('posts a balanced entry dated the last day of the period', async () => {
    asDeferred();
    prisma.schoolYear.findFirst.mockResolvedValue(schoolYear);
    prisma.amortizationRun.findUnique.mockResolvedValue(null);
    prisma.assessment.findMany.mockResolvedValue(assessments);
    glPost.post.mockResolvedValue({ id: 99, entryNo: 'JE-6-000099' });

    const out = await run(ctrl.runAmortization, { body: { period: '2026-07' } });

    expect(glPost.post).toHaveBeenCalledTimes(1);
    const entry = glPost.post.mock.calls[0][0];
    expect(entry.entryDate.toISOString().slice(0, 10)).toBe('2026-07-31');

    const debits  = entry.lines.reduce((s, l) => s + (l.debit  || 0), 0);
    const credits = entry.lines.reduce((s, l) => s + (l.credit || 0), 0);
    expect(Math.round(debits * 100) / 100).toBe(Math.round(credits * 100) / 100);
    expect(entry.lines[0].accountCode).toBe('2210');  // DR Unearned Tuition
    expect(out.recognised).toBe(5350);
  });

  test('records the run only after the entry actually posted', async () => {
    asDeferred();
    prisma.schoolYear.findFirst.mockResolvedValue(schoolYear);
    prisma.amortizationRun.findUnique.mockResolvedValue(null);
    prisma.assessment.findMany.mockResolvedValue(assessments);
    // glPost returns a skip marker when the date is before the books start.
    glPost.post.mockResolvedValue({ skipped: 'PRE_CUTOVER' });

    await expect(run(ctrl.runAmortization, { body: { period: '2026-07' } }))
      .rejects.toMatchObject({ statusCode: 422 });
    // A run row with no journal entry behind it would block the month forever.
    expect(prisma.amortizationRun.create).not.toHaveBeenCalled();
  });

  test('recognises nothing when no assessment has been issued', async () => {
    asDeferred();
    prisma.schoolYear.findFirst.mockResolvedValue(schoolYear);
    prisma.amortizationRun.findUnique.mockResolvedValue(null);
    prisma.assessment.findMany.mockResolvedValue([]);

    const out = await run(ctrl.runAmortization, { body: { period: '2026-07' } });
    expect(out.recognised).toBe(0);
    expect(glPost.post).not.toHaveBeenCalled();
  });

  test('ten monthly runs recognise the whole assessment, to the peso', async () => {
    asDeferred();
    prisma.schoolYear.findFirst.mockResolvedValue(schoolYear);
    prisma.amortizationRun.findUnique.mockResolvedValue(null);
    prisma.assessment.findMany.mockResolvedValue(assessments);
    prisma.account.findMany.mockResolvedValue([]);

    let total = 0;
    for (const p of ['2026-06','2026-07','2026-08','2026-09','2026-10','2026-11','2026-12','2027-01','2027-02','2027-03']) {
      const out = await run(ctrl.previewAmortization, { query: { period: p } });
      total += out.total;
    }
    expect(Math.round(total * 100) / 100).toBe(53500);
  });
});
