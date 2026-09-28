jest.mock('../server/config/database', () => ({
  $transaction: jest.fn((ops) => Promise.all(ops)),
  planPrice:          { findMany: jest.fn(), upsert: jest.fn() },
  paymentInstruction: { findUnique: jest.fn(), upsert: jest.fn() },
  businessOrder:      { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
}));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn() }));
jest.mock('../server/utils/orderUploads', () => ({ removeStoredFile: jest.fn() }));
jest.mock('../server/utils/provisionBusiness', () => ({ createProvisionedBusiness: jest.fn() }));

jest.mock('../server/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const prisma = require('../server/config/database');
const { recordAudit } = require('../server/utils/audit');
const logger = require('../server/utils/logger');
const { createProvisionedBusiness } = require('../server/utils/provisionBusiness');
const { removeStoredFile } = require('../server/utils/orderUploads');
const ctrl = require('../server/controllers/orderAdminController');

const admin = { id: 1, email: 'sa@example.com', role: 'SUPER_ADMIN' };
const call = (fn, req) => new Promise((resolve, reject) => {
  fn({ user: admin, params: {}, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

const order = {
  id: 9, orderNo: 'ORD-AAAAAA', userId: 7, companyName: 'Acme', tin: null, address: null, phone: null,
  companyType: 'SERVICES', taxType: 'VAT', booksStartDate: null, period: 'YEARLY',
  user: { id: 7, email: 'u@example.com' },
};

beforeEach(() => {
  jest.clearAllMocks();
  prisma.businessOrder.updateMany.mockResolvedValue({ count: 1 });
  prisma.businessOrder.findUnique.mockResolvedValue(order);
  prisma.businessOrder.update.mockResolvedValue({});
  createProvisionedBusiness.mockResolvedValue({ id: 42, name: 'Acme' });
});

describe('approve', () => {
  test('claims only a PROOF_SUBMITTED order, provisions for the orderer, sets paidUntil and links the business', async () => {
    const out = await call(ctrl.approve, { params: { id: '9' } });

    expect(prisma.businessOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 9, status: 'PROOF_SUBMITTED' },
      data: expect.objectContaining({ status: 'APPROVED', reviewedById: 1 }),
    }));
    const arg = createProvisionedBusiness.mock.calls[0][0];
    expect(arg).toMatchObject({
      name: 'Acme', companyType: 'SERVICES', taxType: 'VAT', ownerUserId: 7, email: 'u@example.com',
    });
    expect(arg.paidUntil).toBeInstanceOf(Date);
    expect(arg.paidUntil.getTime()).toBeGreaterThan(Date.now() + 360 * 864e5); // ~1 year out
    expect(prisma.businessOrder.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { businessId: 42 } });
    expect(out).toMatchObject({ businessId: 42 });
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'APPROVE', businessId: 42 }));
  });

  test('a second approve (status already claimed) is a 409 and creates nothing', async () => {
    prisma.businessOrder.updateMany.mockResolvedValue({ count: 0 });
    await expect(call(ctrl.approve, { params: { id: '9' } })).rejects.toMatchObject({ statusCode: 409 });
    expect(createProvisionedBusiness).not.toHaveBeenCalled();
  });

  test('if provisioning fails the order goes back to PROOF_SUBMITTED and the error surfaces', async () => {
    createProvisionedBusiness.mockRejectedValue(new Error('boom'));
    await expect(call(ctrl.approve, { params: { id: '9' } })).rejects.toThrow('boom');
    expect(prisma.businessOrder.updateMany).toHaveBeenLastCalledWith({
      where: { id: 9 },
      data: { status: 'PROOF_SUBMITTED', reviewedById: null, reviewedAt: null },
    });
  });

  test('if linking the business fails the order stays APPROVED (no revert) and the failure is logged', async () => {
    prisma.businessOrder.update.mockRejectedValue(new Error('link failed'));
    const out = await call(ctrl.approve, { params: { id: '9' } });
    expect(out).toMatchObject({ businessId: 42 });
    expect(prisma.businessOrder.updateMany).toHaveBeenCalledTimes(1); // the claim only
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('42'));
  });

  test('if provisioning AND the revert both fail, the original provisioning error surfaces', async () => {
    createProvisionedBusiness.mockRejectedValue(new Error('boom'));
    prisma.businessOrder.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockRejectedValueOnce(new Error('revert failed'));
    await expect(call(ctrl.approve, { params: { id: '9' } })).rejects.toThrow('boom');
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('listOrders', () => {
  test.each(['PENDING_PAYMENT', 'PROOF_SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED'])('passes status %s through', async (status) => {
    prisma.businessOrder.findMany.mockResolvedValue([]);
    await call(ctrl.listOrders, { query: { status } });
    expect(prisma.businessOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status } }));
  });

  test('no status means no filter', async () => {
    prisma.businessOrder.findMany.mockResolvedValue([]);
    await call(ctrl.listOrders, { query: {} });
    expect(prisma.businessOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  test('an unknown status is a 400', async () => {
    await expect(call(ctrl.listOrders, { query: { status: 'HACKED' } })).rejects.toMatchObject({ statusCode: 400, message: 'Invalid status' });
    expect(prisma.businessOrder.findMany).not.toHaveBeenCalled();
  });
});

describe('reject', () => {
  test('requires a note', async () => {
    await expect(call(ctrl.reject, { params: { id: '9' }, body: { note: '  ' } })).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.businessOrder.updateMany).not.toHaveBeenCalled();
  });

  test('rejects only a PROOF_SUBMITTED order and stores the note', async () => {
    await call(ctrl.reject, { params: { id: '9' }, body: { note: 'Amount does not match' } });
    expect(prisma.businessOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 9, status: 'PROOF_SUBMITTED' },
      data: expect.objectContaining({ status: 'REJECTED', reviewNote: 'Amount does not match', reviewedById: 1 }),
    }));
  });

  test('409s when the order is not awaiting review', async () => {
    prisma.businessOrder.updateMany.mockResolvedValue({ count: 0 });
    await expect(call(ctrl.reject, { params: { id: '9' }, body: { note: 'x' } })).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('savePrices', () => {
  test.each([
    [[{ companyType: 'HACK', period: 'MONTHLY', amount: 1 }]],
    [[{ companyType: 'SERVICES', period: 'WEEKLY', amount: 1 }]],
    [[{ companyType: 'SERVICES', period: 'MONTHLY', amount: -5 }]],
    [[{ companyType: 'SERVICES', period: 'MONTHLY', amount: 'abc' }]],
    ['nope'],
  ])('rejects invalid rows %#', async (prices) => {
    await expect(call(ctrl.savePrices, { body: { prices } })).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.planPrice.upsert).not.toHaveBeenCalled();
  });

  test('upserts each row by (companyType, period)', async () => {
    prisma.planPrice.findMany.mockResolvedValue([]);
    await call(ctrl.savePrices, { body: { prices: [{ companyType: 'SERVICES', period: 'MONTHLY', amount: '499.5', isActive: true }] } });
    expect(prisma.planPrice.upsert).toHaveBeenCalledWith({
      where: { companyType_period: { companyType: 'SERVICES', period: 'MONTHLY' } },
      update: { amount: 499.5, isActive: true },
      create: { companyType: 'SERVICES', period: 'MONTHLY', amount: 499.5, isActive: true },
    });
  });
});

describe('saveInstructions', () => {
  test('replaces the QR file and removes the old one', async () => {
    prisma.paymentInstruction.findUnique.mockResolvedValue({ qrFileName: 'old.png' });
    prisma.paymentInstruction.upsert.mockImplementation(async ({ update }) => update);
    await call(ctrl.saveInstructions, { body: { text: 'GCash 0917' }, file: { filename: 'new.png', mimetype: 'image/png' } });
    expect(prisma.paymentInstruction.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { text: 'GCash 0917', qrFileName: 'new.png', qrMimeType: 'image/png' },
    }));
    expect(removeStoredFile).toHaveBeenCalledWith('old.png');
  });

  test('keeps the existing QR when no file is sent', async () => {
    prisma.paymentInstruction.findUnique.mockResolvedValue({ qrFileName: 'old.png' });
    prisma.paymentInstruction.upsert.mockImplementation(async ({ update }) => update);
    await call(ctrl.saveInstructions, { body: { text: 'New text' } });
    expect(prisma.paymentInstruction.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { text: 'New text' } }));
    expect(removeStoredFile).not.toHaveBeenCalled();
  });
});
