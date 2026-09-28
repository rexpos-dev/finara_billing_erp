jest.mock('../server/config/database', () => ({
  account: { findMany: jest.fn() },
}));
jest.mock('../server/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const prisma = require('../server/config/database');
const { resolveLineAccounts } = require('../server/controllers/cashRequestController');

beforeEach(() => jest.clearAllMocks());

// A trading company deactivates the agency 50xx accounts. A keyword rule that
// still points at one of them must not post to it.
describe('resolveLineAccounts', () => {
  test('only looks at ACTIVE accounts of this business, including the fallback', async () => {
    prisma.account.findMany.mockResolvedValue([]);

    await resolveLineAccounts([{ description: 'Plywood 4 pcs' }], 7);

    const where = prisma.account.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ businessId: 7, isActive: true });
    expect(where.accountCode.in).toEqual(expect.arrayContaining(['5021', '6390']));
  });

  test('uses the matched account when it is active', async () => {
    prisma.account.findMany.mockResolvedValue([
      { id: 21, accountCode: '5021' }, { id: 90, accountCode: '6390' },
    ]);

    const [line] = await resolveLineAccounts([{ description: 'Plywood 4 pcs' }], 1);
    expect(line.accountId).toBe(21);
  });

  test('falls back to Miscellaneous when the matched account is inactive', async () => {
    // 5021 was deactivated, so the query (isActive: true) does not return it
    prisma.account.findMany.mockResolvedValue([{ id: 90, accountCode: '6390' }]);

    const [line] = await resolveLineAccounts([{ description: 'Plywood 4 pcs' }], 1);
    expect(line.accountId).toBe(90);
  });

  test('leaves accountId null only when even the fallback is unavailable', async () => {
    prisma.account.findMany.mockResolvedValue([]);

    const [line] = await resolveLineAccounts([{ description: 'Plywood 4 pcs' }], 1);
    expect(line.accountId).toBeNull();
  });

  test('never overrides a line that already has an account, and skips the query if none need one', async () => {
    const lines = [{ description: 'Plywood', accountId: 5 }];

    expect(await resolveLineAccounts(lines, 1)).toEqual(lines);
    expect(prisma.account.findMany).not.toHaveBeenCalled();
  });
});
