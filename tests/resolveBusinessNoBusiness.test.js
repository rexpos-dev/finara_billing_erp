jest.mock('../server/config/database', () => ({
  userBusiness: { findFirst: jest.fn(), findUnique: jest.fn() },
}));
jest.mock('../server/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const prisma = require('../server/config/database');
const { resolveBusiness } = require('../server/middleware/auth');

const run = (user, headers = {}) => new Promise((resolve) => {
  const req = { user, headers };
  const res = { status: (code) => ({ json: (body) => resolve({ req, code, body }) }) };
  resolveBusiness(req, res, () => resolve({ req, next: true }));
});

beforeEach(() => jest.clearAllMocks());

// A fresh self-signup has no business. It used to fall back to business 1 and
// see another tenant's data.
describe('resolveBusiness with no business', () => {
  test('non-admin with no grant gets NO_BUSINESS, never business 1', async () => {
    prisma.userBusiness.findFirst.mockResolvedValue(null);
    const r = await run({ id: 9, role: 'MANAGER' });
    expect(r.code).toBe(403);
    expect(r.body.code).toBe('NO_BUSINESS');
    expect(r.req.businessId).toBeUndefined();
  });

  test('non-admin with a grant resolves to their business', async () => {
    prisma.userBusiness.findFirst.mockResolvedValue({ businessId: 6 });
    const r = await run({ id: 9, role: 'MANAGER' });
    expect(r.next).toBe(true);
    expect(r.req.businessId).toBe(6);
  });

  test('a header for a business they are not granted is denied', async () => {
    prisma.userBusiness.findUnique.mockResolvedValue(null);
    const r = await run({ id: 9, role: 'MANAGER' }, { 'x-business-id': '1' });
    expect(r.code).toBe(403);
  });

  test('ADMIN keeps the business-1 default', async () => {
    const r = await run({ id: 1, role: 'ADMIN' });
    expect(r.req.businessId).toBe(1);
  });
});
