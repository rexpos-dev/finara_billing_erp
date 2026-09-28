jest.mock('../server/config/database', () => ({
  feeType:       { findMany: jest.fn() },
  schoolYear:    { findFirst: jest.fn() },
  gradeLevel:    { findFirst: jest.fn() },
  feeStructure:  { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  $transaction:  jest.fn(),
}));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn() }));

const prisma = require('../server/config/database');
const ctrl   = require('../server/controllers/schoolSetupController');

const BODY = {
  schoolYearId: 18,
  gradeLevelId: 3,
  name: 'Kinder 2 — SY2026-2027',
  lines: [{ feeTypeId: 1, amount: 30000, billingBasis: 'ANNUAL' }],
};

/** Resolves on a response, rejects with the error passed to next(). */
const run = (body = BODY, businessId = 6) => new Promise((resolve, reject) => {
  const res = {
    status: (code) => ({ json: (payload) => resolve({ statusCode: code, body: payload }) }),
    json:   (payload) => resolve({ statusCode: 200, body: payload }),
  };
  ctrl.saveFeeStructure({ body, businessId, user: { id: 1 } }, res, reject);
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.feeType.findMany.mockResolvedValue([{ id: 1, businessId: 6 }]);
  prisma.schoolYear.findFirst.mockResolvedValue({ id: 18, businessId: 6 });
  prisma.gradeLevel.findFirst.mockResolvedValue({ id: 3, businessId: 6 });
  prisma.feeStructure.findFirst.mockResolvedValue(null);
  prisma.feeStructure.create.mockImplementation(async ({ data }) => ({ id: 9, ...data }));
});

// The registrar hit `Foreign key constraint violated: schoolYearId` — a raw
// MySQL error surfaced as a 400 with nothing to act on. The cause was a
// dropdown the browser had loaded before the school year was deleted, so the
// save posted an id that no longer existed. saveFeeStructure checked that the
// fee types belonged to the business but never checked the year or the level,
// even though cloneFeeStructure right below it checks both.
describe('saveFeeStructure guards the year and the level', () => {
  test('a school year that no longer exists is refused before it reaches the database', async () => {
    prisma.schoolYear.findFirst.mockResolvedValue(null);

    await expect(run()).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/school year is not available/i),
    });
    expect(prisma.feeStructure.create).not.toHaveBeenCalled();
  });

  test('a grade level that no longer exists is refused the same way', async () => {
    prisma.gradeLevel.findFirst.mockResolvedValue(null);

    await expect(run()).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/grade level is not available/i),
    });
    expect(prisma.feeStructure.create).not.toHaveBeenCalled();
  });

  test("another business's school year is not visible, so it cannot be attached", async () => {
    // The lookup is scoped by businessId, so a live id belonging to someone
    // else comes back null — without that scope the FK would be satisfied and
    // this business's fee structure would point at their school year.
    prisma.schoolYear.findFirst.mockResolvedValue(null);

    await expect(run({ ...BODY, schoolYearId: 1 })).rejects.toMatchObject({ statusCode: 400 });

    expect(prisma.schoolYear.findFirst).toHaveBeenCalledWith({
      where: { id: 1, businessId: 6 },
    });
    expect(prisma.feeStructure.create).not.toHaveBeenCalled();
  });

  test('a valid year and level still save normally', async () => {
    const { statusCode, body } = await run();

    expect(statusCode).toBe(201);
    expect(body.schoolYearId).toBe(18);
    expect(body.gradeLevelId).toBe(3);
    expect(body.businessId).toBe(6);
    expect(prisma.feeStructure.create).toHaveBeenCalledTimes(1);
  });

  test('the fee-type check still runs, and runs before anything is written', async () => {
    prisma.feeType.findMany.mockResolvedValue([]); // none matched this business

    await expect(run()).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/fee types do not belong/i),
    });
    expect(prisma.feeStructure.create).not.toHaveBeenCalled();
  });

  test('an empty fee structure is still refused', async () => {
    await expect(run({ ...BODY, lines: [] })).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/at least one fee line/i),
    });
  });
});
