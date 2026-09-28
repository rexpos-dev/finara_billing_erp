jest.mock('../server/config/database', () => ({
  planPrice:          { findMany: jest.fn(), findUnique: jest.fn() },
  paymentInstruction: { findUnique: jest.fn() },
  businessOrder:      { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
}));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn() }));
jest.mock('../server/utils/orderUploads', () => ({
  uploadMiddleware: jest.fn(), removeStoredFile: jest.fn(), sendStoredFile: jest.fn(),
}));

const prisma = require('../server/config/database');
const uploads = require('../server/utils/orderUploads');
const ctrl = require('../server/controllers/orderController');

const user = { id: 7, email: 'u@example.com', role: 'MANAGER' };
const call = (fn, req) => new Promise((resolve, reject) => {
  const res = { json: resolve, status: () => ({ json: resolve }) };
  fn({ user, params: {}, body: {}, ...req }, res, reject);
});

const valid = { name: ' Acme ', companyType: 'SERVICES', taxType: 'VAT', period: 'MONTHLY' };

beforeEach(() => {
  jest.clearAllMocks();
  prisma.planPrice.findUnique.mockResolvedValue({ amount: 999, isActive: true });
  prisma.businessOrder.create.mockImplementation(async ({ data }) => ({ id: 1, ...data }));
});

describe('orderController.create', () => {
  test.each([
    [{ ...valid, name: '  ' }, 'Company name is required'],
    [{ ...valid, companyType: 'HACK' }, 'Choose a company type'],
    [{ ...valid, taxType: 'NOPE' }, 'Choose a tax type (VAT or Non-VAT)'],
    [{ ...valid, period: 'WEEKLY' }, 'Choose a billing period'],
  ])('rejects invalid input %#', async (body, message) => {
    await expect(call(ctrl.create, { body })).rejects.toMatchObject({ statusCode: 400, message });
    expect(prisma.businessOrder.create).not.toHaveBeenCalled();
  });

  test('400s when no active price exists for that type and period', async () => {
    prisma.planPrice.findUnique.mockResolvedValue(null);
    await expect(call(ctrl.create, { body: valid })).rejects.toMatchObject({ statusCode: 400 });
    prisma.planPrice.findUnique.mockResolvedValue({ amount: 999, isActive: false });
    await expect(call(ctrl.create, { body: valid })).rejects.toMatchObject({ statusCode: 400 });
  });

  test('snapshots the price and creates a PENDING_PAYMENT order for the caller', async () => {
    const order = await call(ctrl.create, { body: valid });

    expect(prisma.planPrice.findUnique).toHaveBeenCalledWith({
      where: { companyType_period: { companyType: 'SERVICES', period: 'MONTHLY' } },
    });
    expect(order).toMatchObject({
      userId: 7, companyName: 'Acme', companyType: 'SERVICES', taxType: 'VAT',
      period: 'MONTHLY', amount: 999, status: 'PENDING_PAYMENT',
    });
    expect(order.orderNo).toMatch(/^ORD-[0-9A-F]{6}$/);
  });
});

describe('orderController.list / plans', () => {
  test('list is scoped to the caller', async () => {
    prisma.businessOrder.findMany.mockResolvedValue([]);
    await call(ctrl.list, {});
    expect(prisma.businessOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 7 } }));
  });

  test('plans returns active prices and whether a QR exists', async () => {
    prisma.planPrice.findMany.mockResolvedValue([{ companyType: 'SERVICES', period: 'MONTHLY', amount: 999 }]);
    prisma.paymentInstruction.findUnique.mockResolvedValue({ text: 'GCash 0917', qrFileName: 'q.png' });
    const out = await call(ctrl.plans, {});
    expect(prisma.planPrice.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { isActive: true } }));
    expect(out.instructions).toEqual({ text: 'GCash 0917', hasQr: true });
  });
});

describe('orderController.submitProof', () => {
  const order = { id: 5, userId: 7, status: 'PENDING_PAYMENT', proofFileName: null };

  test('404s for an order that is not the caller\'s', async () => {
    prisma.businessOrder.findFirst.mockResolvedValue(null);
    await expect(call(ctrl.submitProof, { params: { id: '5' }, body: { referenceNo: 'X1' } }))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.businessOrder.findFirst).toHaveBeenCalledWith({ where: { id: 5, userId: 7 } });
  });

  test('requires a reference number or a file', async () => {
    prisma.businessOrder.findFirst.mockResolvedValue(order);
    await expect(call(ctrl.submitProof, { params: { id: '5' }, body: { referenceNo: '  ' } }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test.each(['APPROVED', 'REJECTED', 'CANCELLED'])('refuses a %s order', async (status) => {
    prisma.businessOrder.findFirst.mockResolvedValue({ ...order, status });
    await expect(call(ctrl.submitProof, { params: { id: '5' }, body: { referenceNo: 'X1' } }))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  test('moves the order to PROOF_SUBMITTED and stores the reference + file', async () => {
    prisma.businessOrder.findFirst.mockResolvedValue({ ...order, proofFileName: 'old.png' });
    prisma.businessOrder.updateMany.mockResolvedValue({ count: 1 });
    const file = { filename: 'new.png', originalname: 'gcash.png', mimetype: 'image/png' };

    const out = await call(ctrl.submitProof, { params: { id: '5' }, body: { referenceNo: ' GC123 ' }, file });

    expect(prisma.businessOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 5, userId: 7, status: { in: ['PENDING_PAYMENT', 'PROOF_SUBMITTED'] } },
    }));
    expect(out).toMatchObject({ status: 'PROOF_SUBMITTED', referenceNo: 'GC123', proofFileName: 'new.png' });
    expect(uploads.removeStoredFile).toHaveBeenCalledWith('old.png');
  });

  test('a lost race (count 0) is a 409 and removes only the NEW upload', async () => {
    prisma.businessOrder.findFirst.mockResolvedValue({ ...order, proofFileName: 'old.png' });
    prisma.businessOrder.updateMany.mockResolvedValue({ count: 0 });
    const file = { filename: 'new.png', originalname: 'g.png', mimetype: 'image/png' };
    await expect(call(ctrl.submitProof, { params: { id: '5' }, body: { referenceNo: 'X' }, file }))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(uploads.removeStoredFile).toHaveBeenCalledWith('new.png');
    expect(uploads.removeStoredFile).not.toHaveBeenCalledWith('old.png');
  });

  test('the old proof is removed only after the write succeeds', async () => {
    prisma.businessOrder.findFirst.mockResolvedValue({ ...order, proofFileName: 'old.png' });
    let writeDone = false;
    prisma.businessOrder.updateMany.mockImplementation(async () => { writeDone = true; return { count: 1 }; });
    uploads.removeStoredFile.mockImplementation((n) => { if (n === 'old.png') expect(writeDone).toBe(true); });
    const file = { filename: 'new.png', originalname: 'g.png', mimetype: 'image/png' };
    await call(ctrl.submitProof, { params: { id: '5' }, body: { referenceNo: 'X' }, file });
    expect(uploads.removeStoredFile).toHaveBeenCalledWith('old.png');
    uploads.removeStoredFile.mockReset();
  });

  test('a failed write removes the new upload and keeps the old proof', async () => {
    prisma.businessOrder.findFirst.mockResolvedValue({ ...order, proofFileName: 'old.png' });
    prisma.businessOrder.updateMany.mockRejectedValue(new Error('db down'));
    const file = { filename: 'new.png', originalname: 'g.png', mimetype: 'image/png' };
    await expect(call(ctrl.submitProof, { params: { id: '5' }, body: { referenceNo: 'X' }, file }))
      .rejects.toThrow('db down');
    expect(uploads.removeStoredFile).toHaveBeenCalledWith('new.png');
    expect(uploads.removeStoredFile).not.toHaveBeenCalledWith('old.png');
  });

  test('a reference number over 100 chars is a 400 and removes the new upload', async () => {
    prisma.businessOrder.findFirst.mockResolvedValue(order);
    const file = { filename: 'new.png', originalname: 'g.png', mimetype: 'image/png' };
    await expect(call(ctrl.submitProof, { params: { id: '5' }, body: { referenceNo: 'x'.repeat(101) }, file }))
      .rejects.toMatchObject({ statusCode: 400, message: 'Reference number is too long' });
    expect(uploads.removeStoredFile).toHaveBeenCalledWith('new.png');
    expect(prisma.businessOrder.updateMany).not.toHaveBeenCalled();
  });
});

describe('orderController.cancel', () => {
  test('only cancels the caller\'s open orders', async () => {
    prisma.businessOrder.updateMany.mockResolvedValue({ count: 1 });
    await call(ctrl.cancel, { params: { id: '5' } });
    expect(prisma.businessOrder.updateMany).toHaveBeenCalledWith({
      where: { id: 5, userId: 7, status: { in: ['PENDING_PAYMENT', 'PROOF_SUBMITTED'] } },
      data: { status: 'CANCELLED' },
    });
  });

  test('409s when nothing was cancellable', async () => {
    prisma.businessOrder.updateMany.mockResolvedValue({ count: 0 });
    await expect(call(ctrl.cancel, { params: { id: '5' } })).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('orderController.downloadProof', () => {
  const withProof = { proofFileName: 'p.png', proofMimeType: 'image/png', proofOriginalName: 'p.png' };
  const run = (req) => new Promise((resolve, reject) => {
    uploads.sendStoredFile.mockImplementation(() => resolve('sent'));
    ctrl.downloadProof(req, {}, reject);
  });

  test('owner can download', async () => {
    prisma.businessOrder.findFirst.mockResolvedValue(withProof);
    await run({ user, params: { id: '5' } });
    expect(prisma.businessOrder.findFirst).toHaveBeenCalledWith({ where: { id: 5, userId: 7 } });
  });

  test('SUPER_ADMIN can download any order\'s proof', async () => {
    prisma.businessOrder.findFirst.mockResolvedValue(withProof);
    await run({ user: { id: 1, role: 'SUPER_ADMIN' }, params: { id: '5' } });
    expect(prisma.businessOrder.findFirst).toHaveBeenCalledWith({ where: { id: 5 } });
  });

  test('404s when there is no proof on file', async () => {
    prisma.businessOrder.findFirst.mockResolvedValue({ proofFileName: null });
    await expect(call(ctrl.downloadProof, { params: { id: '5' } })).rejects.toMatchObject({ statusCode: 404 });
  });
});
