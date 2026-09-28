jest.mock('../server/config/database', () => ({
  systemSetting: { findUnique: jest.fn() },
  business:      { findUnique: jest.fn() },
}));

const prisma = require('../server/config/database');
const requireSchool = require('../server/middleware/requireSchool');

function run(businessId) {
  const req = { businessId };
  let status = 200, body = null, nexted = false;
  const res = {
    status(code) { status = code; return this; },
    json(payload) { body = payload; return payload; },
  };
  return requireSchool(req, res, () => { nexted = true; })
    .then(() => ({ status, body, nexted }));
}

beforeEach(() => {
  jest.clearAllMocks();
  requireSchool.clearCache();
  prisma.business.findUnique.mockResolvedValue({ code: 'BIZ-001', name: 'BFaith on Print' });
});

describe('requireSchool', () => {
  test('lets a configured school business through', async () => {
    prisma.systemSetting.findUnique.mockResolvedValue({ value: 'true' });
    const out = await run(6);
    expect(out.nexted).toBe(true);
    expect(out.body).toBeNull();
  });

  // The real scenario: an admin left the business switcher on the advertising
  // agency, opened School → Students and registered a student there. Nothing
  // stopped them, and the failure only surfaced when an assessment was issued
  // and glPost could not find account 1110 in that COA.
  test('refuses a business with no school setup, before anything is written', async () => {
    prisma.systemSetting.findUnique.mockResolvedValue(null);
    const out = await run(1);
    expect(out.nexted).toBe(false);
    expect(out.status).toBe(409);
    expect(out.body.code).toBe('SCHOOL_NOT_ENABLED');
  });

  test('names the business and the exact command that fixes it', async () => {
    prisma.systemSetting.findUnique.mockResolvedValue(null);
    const out = await run(1);
    expect(out.body.error).toContain('BFaith on Print');
    expect(out.body.error).toContain('seedSchool.js --business=1');
  });

  test('treats any value other than "true" as not set up', async () => {
    prisma.systemSetting.findUnique.mockResolvedValue({ value: 'false' });
    const out = await run(2);
    expect(out.nexted).toBe(false);
    expect(out.status).toBe(409);
  });

  test('still answers when the business row cannot be read', async () => {
    prisma.systemSetting.findUnique.mockResolvedValue(null);
    prisma.business.findUnique.mockResolvedValue(null);
    const out = await run(99);
    expect(out.status).toBe(409);
    expect(out.body.error).toContain('business 99');
  });

  test('caches the answer per business', async () => {
    prisma.systemSetting.findUnique.mockResolvedValue({ value: 'true' });
    await run(6);
    await run(6);
    expect(prisma.systemSetting.findUnique).toHaveBeenCalledTimes(1);
  });

  test('caches each business separately', async () => {
    prisma.systemSetting.findUnique
      .mockResolvedValueOnce({ value: 'true' })
      .mockResolvedValueOnce(null);
    expect((await run(6)).nexted).toBe(true);
    expect((await run(1)).nexted).toBe(false);
  });
});
