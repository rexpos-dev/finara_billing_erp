const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { recordAudit } = require('../utils/audit');
const { COMPANY_TYPES } = require('../utils/companyTypes');
const { PERIODS, computePaidUntil, computeYearlyAmount } = require('../utils/orderPricing');
const { createProvisionedBusiness } = require('../utils/provisionBusiness');
const { removeStoredFile } = require('../utils/orderUploads');
const logger = require('../utils/logger');

const ORDER_STATUSES = ['PENDING_PAYMENT', 'PROOF_SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED'];

// ─── Prices ──────────────────────────────────────────────────────
exports.getPrices = async (req, res, next) => {
  try { res.json(await prisma.planPrice.findMany({ orderBy: [{ companyType: 'asc' }, { period: 'asc' }] })); }
  catch (err) { next(err); }
};

exports.savePrices = async (req, res, next) => {
  try {
    const { prices } = req.body;
    if (!Array.isArray(prices)) throw createError('prices must be a list', 400);

    const monthlyByType = {}; // companyType -> { amount, isActive, discountPercent }
    const yearlyByType = {};  // companyType -> { isActive }

    prices.forEach((p) => {
      if (!COMPANY_TYPES[p.companyType]) throw createError(`Unknown company type "${p.companyType}"`, 400);
      if (!PERIODS.includes(p.period)) throw createError(`Unknown period "${p.period}"`, 400);
      const isActive = p.isActive !== false;

      if (p.period === 'MONTHLY') {
        const amount = Number(p.amount);
        if (!Number.isFinite(amount) || amount < 0) throw createError('Amounts must be zero or more', 400);
        const discountPercent = p.discountPercent === undefined || p.discountPercent === null || p.discountPercent === ''
          ? 0 : Number(p.discountPercent);
        if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
          throw createError('Discount must be between 0 and 100', 400);
        }
        monthlyByType[p.companyType] = { amount, isActive, discountPercent };
      } else {
        yearlyByType[p.companyType] = { isActive };
      }
    });

    // Only company types genuinely submitted as MONTHLY should get a MONTHLY
    // upsert. Captured before the DB-fallback lookup below mutates
    // monthlyByType by merging in DB-only data for YEARLY-only submissions.
    const submittedMonthlyTypes = new Set(Object.keys(monthlyByType));

    // A YEARLY row's amount is always derived from its sibling MONTHLY row. If
    // that sibling wasn't part of this save, fall back to the DB so the
    // amount can still be computed correctly.
    const missingTypes = Object.keys(yearlyByType).filter((t) => !monthlyByType[t]);
    if (missingTypes.length) {
      const existing = await prisma.planPrice.findMany({
        where: { period: 'MONTHLY', companyType: { in: missingTypes } },
      });
      existing.forEach((row) => {
        monthlyByType[row.companyType] = {
          amount: Number(row.amount), isActive: row.isActive, discountPercent: Number(row.discountPercent || 0),
        };
      });
    }

    const ops = [];
    submittedMonthlyTypes.forEach((companyType) => {
      const m = monthlyByType[companyType];
      ops.push(prisma.planPrice.upsert({
        where: { companyType_period: { companyType, period: 'MONTHLY' } },
        update: { amount: m.amount, isActive: m.isActive, discountPercent: m.discountPercent },
        create: { companyType, period: 'MONTHLY', amount: m.amount, isActive: m.isActive, discountPercent: m.discountPercent },
      }));
    });
    Object.entries(yearlyByType).forEach(([companyType, y]) => {
      const m = monthlyByType[companyType];
      // "Blank/not offered": no monthly row exists, or it isn't active — nothing to compute from.
      const canOffer = !!m && m.isActive;
      const amount = m ? computeYearlyAmount(m.amount, m.discountPercent) : 0;
      ops.push(prisma.planPrice.upsert({
        where: { companyType_period: { companyType, period: 'YEARLY' } },
        update: { amount, isActive: canOffer && y.isActive, discountPercent: null },
        create: { companyType, period: 'YEARLY', amount, isActive: canOffer && y.isActive, discountPercent: null },
      }));
    });

    await prisma.$transaction(ops);
    await recordAudit({ req, action: 'UPDATE', entity: 'PlanPrice', summary: `Updated ${ops.length} plan price(s)` });
    res.json(await prisma.planPrice.findMany({ orderBy: [{ companyType: 'asc' }, { period: 'asc' }] }));
  } catch (err) { next(err); }
};

// ─── Payment instructions ────────────────────────────────────────
exports.getInstructions = async (req, res, next) => {
  try {
    const ins = await prisma.paymentInstruction.findUnique({ where: { id: 1 } });
    res.json({ text: ins?.text || '', hasQr: !!ins?.qrFileName });
  } catch (err) { next(err); }
};

exports.saveInstructions = async (req, res, next) => {
  try {
    const text = String(req.body.text || '');
    const existing = await prisma.paymentInstruction.findUnique({ where: { id: 1 } });
    const update = { text };
    if (req.file) {
      update.qrFileName = req.file.filename;
      update.qrMimeType = req.file.mimetype;
    }
    const saved = await prisma.paymentInstruction.upsert({
      where: { id: 1 }, update, create: { id: 1, ...update },
    });
    if (req.file && existing?.qrFileName) removeStoredFile(existing.qrFileName);
    await recordAudit({ req, action: 'UPDATE', entity: 'PaymentInstruction', entityId: 1, summary: 'Updated payment instructions' });
    res.json({ text: saved.text ?? text, hasQr: !!(saved.qrFileName ?? existing?.qrFileName) });
  } catch (err) { next(err); }
};

// ─── Orders ──────────────────────────────────────────────────────
exports.listOrders = async (req, res, next) => {
  try {
    const status = req.query.status;
    if (status && !ORDER_STATUSES.includes(String(status))) throw createError('Invalid status', 400);
    const where = status ? { status: String(status) } : {};
    res.json(await prisma.businessOrder.findMany({
      where,
      orderBy: { id: 'desc' },
      include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
    }));
  } catch (err) { next(err); }
};

// Atomic claim: only one caller can move PROOF_SUBMITTED → APPROVED, so a
// double-click or two admins can never create two businesses. Provisioning
// uses the global prisma client (not a tx), so if provisioning fails we revert
// the claim (createProvisionedBusiness has already rolled its own half-built
// rows back); a failed revert is logged so the original error still surfaces.
// Once the business exists the order is never reverted (a retry would create a
// duplicate): a failed businessId link is only logged for manual reconciliation.
exports.approve = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const claimed = await prisma.businessOrder.updateMany({
      where: { id, status: 'PROOF_SUBMITTED' },
      data: { status: 'APPROVED', reviewedById: req.user.id, reviewedAt: new Date() },
    });
    if (!claimed.count) throw createError('This order is not awaiting approval', 409);

    let order, biz;
    try {
      order = await prisma.businessOrder.findUnique({ where: { id }, include: { user: true } });
      biz = await createProvisionedBusiness({
        name: order.companyName, tin: order.tin, address: order.address, phone: order.phone,
        email: order.user.email,
        companyType: order.companyType, taxType: order.taxType, booksStartDate: order.booksStartDate,
        ownerUserId: order.userId,
        paidUntil: computePaidUntil(new Date(), order.period),
      });
    } catch (err) {
      try {
        await prisma.businessOrder.updateMany({
          where: { id },
          data: { status: 'PROOF_SUBMITTED', reviewedById: null, reviewedAt: null },
        });
      } catch (revertErr) {
        logger.error(`Failed to revert claim on business order ${id}: ${revertErr.message}`);
      }
      throw err;
    }

    try {
      await prisma.businessOrder.update({ where: { id }, data: { businessId: biz.id } });
    } catch (linkErr) {
      logger.error(`Business order ${order.orderNo} (id ${id}) is APPROVED but linking business ${biz.id} failed: ${linkErr.message}`);
    }
    await recordAudit({ req, action: 'APPROVE', entity: 'BusinessOrder', entityId: id, businessId: biz.id, summary: `Approved ${order.orderNo}; created business "${biz.name}"` });
    res.json({ message: `Approved — ${biz.name} created`, businessId: biz.id });
  } catch (err) { next(err); }
};

exports.reject = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const note = String(req.body.note || '').trim();
    if (!note) throw createError('Tell the customer why the payment was rejected', 400);
    const { count } = await prisma.businessOrder.updateMany({
      where: { id, status: 'PROOF_SUBMITTED' },
      data: { status: 'REJECTED', reviewNote: note.slice(0, 500), reviewedById: req.user.id, reviewedAt: new Date() },
    });
    if (!count) throw createError('This order is not awaiting review', 409);
    await recordAudit({ req, action: 'REJECT', entity: 'BusinessOrder', entityId: id, summary: `Rejected business order: ${note}` });
    res.json({ message: 'Order rejected' });
  } catch (err) { next(err); }
};
