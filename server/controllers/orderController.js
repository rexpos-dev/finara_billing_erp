const crypto = require('crypto');
const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { recordAudit } = require('../utils/audit');
const { COMPANY_TYPES, TAX_TYPES } = require('../utils/companyTypes');
const { PERIODS } = require('../utils/orderPricing');
const { removeStoredFile, sendStoredFile } = require('../utils/orderUploads');

const OPEN = ['PENDING_PAYMENT', 'PROOF_SUBMITTED'];

// Active prices + what to tell the user about paying.
exports.plans = async (req, res, next) => {
  try {
    const [prices, ins] = await Promise.all([
      prisma.planPrice.findMany({ where: { isActive: true } }),
      prisma.paymentInstruction.findUnique({ where: { id: 1 } }),
    ]);
    res.json({ prices, instructions: { text: ins?.text || '', hasQr: !!ins?.qrFileName } });
  } catch (err) { next(err); }
};

// The QR image is shown to any signed-in user who has to pay.
exports.paymentQr = async (req, res, next) => {
  try {
    const ins = await prisma.paymentInstruction.findUnique({ where: { id: 1 } });
    if (!ins?.qrFileName) throw createError('No payment QR has been set up', 404);
    sendStoredFile(res, { fileName: ins.qrFileName, mimeType: ins.qrMimeType });
  } catch (err) { next(err); }
};

exports.create = async (req, res, next) => {
  try {
    const { name, tin, address, phone, companyType, taxType, booksStartDate, period } = req.body;
    if (!name || !String(name).trim()) throw createError('Company name is required', 400);
    if (!COMPANY_TYPES[companyType]) throw createError('Choose a company type', 400);
    if (!TAX_TYPES.includes(taxType)) throw createError('Choose a tax type (VAT or Non-VAT)', 400);
    if (!PERIODS.includes(period)) throw createError('Choose a billing period', 400);

    const price = await prisma.planPrice.findUnique({
      where: { companyType_period: { companyType, period } },
    });
    if (!price || !price.isActive) {
      throw createError('This plan is not available yet. Please contact the administrator.', 400);
    }

    const order = await prisma.businessOrder.create({
      data: {
        orderNo: `ORD-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
        userId: req.user.id,
        companyName: String(name).trim(),
        tin, address, phone, companyType, taxType,
        booksStartDate: booksStartDate ? new Date(booksStartDate) : null,
        period,
        amount: price.amount,
        status: 'PENDING_PAYMENT',
      },
    });
    await recordAudit({ req, action: 'CREATE', entity: 'BusinessOrder', entityId: order.id, summary: `Ordered business "${order.companyName}" (${order.orderNo})` });
    res.status(201).json(order);
  } catch (err) { next(err); }
};

exports.list = async (req, res, next) => {
  try {
    res.json(await prisma.businessOrder.findMany({ where: { userId: req.user.id }, orderBy: { id: 'desc' } }));
  } catch (err) { next(err); }
};

exports.submitProof = async (req, res, next) => {
  const newFile = req.file?.filename;
  let stored = false; // true once the DB write succeeded and the new file is referenced
  try {
    const id = Number(req.params.id);
    const referenceNo = String(req.body.referenceNo || '').trim();
    if (referenceNo.length > 100) throw createError('Reference number is too long', 400);
    const order = await prisma.businessOrder.findFirst({ where: { id, userId: req.user.id } });
    if (!order) throw createError('Order not found', 404);
    if (!OPEN.includes(order.status)) throw createError('This order can no longer be changed', 409);
    if (!referenceNo && !req.file) throw createError('Enter the payment reference number or attach a proof', 400);

    const data = { status: 'PROOF_SUBMITTED', referenceNo: referenceNo || order.referenceNo };
    if (req.file) {
      Object.assign(data, {
        proofFileName: req.file.filename,
        proofOriginalName: req.file.originalname.slice(-255),
        proofMimeType: req.file.mimetype,
      });
    }
    // Status-guarded write: an admin approving in between makes this a no-op.
    const { count } = await prisma.businessOrder.updateMany({
      where: { id, userId: req.user.id, status: { in: OPEN } },
      data,
    });
    if (!count) throw createError('This order can no longer be changed', 409);
    stored = true;
    if (req.file) removeStoredFile(order.proofFileName);
    await recordAudit({ req, action: 'UPDATE', entity: 'BusinessOrder', entityId: id, summary: `Submitted payment proof for ${order.orderNo}` });
    res.json({ ...order, ...data });
  } catch (err) {
    if (!stored) removeStoredFile(newFile);
    next(err);
  }
};

exports.cancel = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { count } = await prisma.businessOrder.updateMany({
      where: { id, userId: req.user.id, status: { in: OPEN } },
      data: { status: 'CANCELLED' },
    });
    if (!count) throw createError('Order not found or can no longer be cancelled', 409);
    await recordAudit({ req, action: 'UPDATE', entity: 'BusinessOrder', entityId: id, summary: 'Cancelled business order' });
    res.json({ message: 'Order cancelled' });
  } catch (err) { next(err); }
};

// Owner, or SUPER_ADMIN reviewing the order.
exports.downloadProof = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const where = req.user.role === 'SUPER_ADMIN' ? { id } : { id, userId: req.user.id };
    const order = await prisma.businessOrder.findFirst({ where });
    if (!order?.proofFileName) throw createError('No proof on file', 404);
    sendStoredFile(res, {
      fileName: order.proofFileName, mimeType: order.proofMimeType, originalName: order.proofOriginalName,
    });
  } catch (err) { next(err); }
};
