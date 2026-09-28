const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { recordAudit } = require('../utils/audit');
const { nextDocNumber } = require('../utils/docNumber');
const glPost = require('../utils/glPost');
const { buildReleaseEntry, buildLiquidationEntry } = require('../utils/cashAdvance');
const { matchAccountCode, KEYWORD_RULES, FALLBACK_ACCOUNT } = require('../utils/accountMap');

const genRequestNo = async () => {
  const last = await prisma.cashRequest.findFirst({
    orderBy: { id: 'desc' },
    select: { requestNo: true },
  });
  return nextDocNumber('CR-', last?.requestNo);
};

// req.user is the decoded JWT payload — it carries `name`, not firstName/lastName.
const actorName = (req) => req.user?.name?.trim() || null;

const sumItems = (items = []) =>
  items.reduce((s, i) => s + Number(i.estimatedCost || 0), 0);

const mapItems = (items = []) =>
  items
    .filter((i) => i.description && Number(i.estimatedCost) > 0)
    .map((i) => ({
      description:   i.description,
      quantity:      i.quantity != null && i.quantity !== '' ? Number(i.quantity) : null,
      estimatedCost: Number(i.estimatedCost),
      accountId:     i.accountId ? Number(i.accountId) : null,
    }));

exports.list = async (req, res, next) => {
  try {
    const { status, search, from, to, page = 1, limit = 20 } = req.query;
    const where = { businessId: req.businessId };
    if (status) where.status = status;
    if (search) where.OR = [
      { requestNo:    { contains: search } },
      { requestedFor: { contains: search } },
      { purpose:      { contains: search } },
    ];
    if (from || to) where.requestDate = {
      ...(from && { gte: new Date(from) }),
      ...(to   && { lte: new Date(to) }),
    };

    const [data, total] = await Promise.all([
      prisma.cashRequest.findMany({
        where,
        include: { items: true, liquidation: { select: { id: true, voucherNo: true, totalAmount: true } } },
        orderBy: { id: 'desc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
      }),
      prisma.cashRequest.count({ where }),
    ]);
    res.json({ data, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (err) { next(err); }
};

exports.getOne = async (req, res, next) => {
  try {
    const cr = await prisma.cashRequest.findFirst({
      where: { id: Number(req.params.id), businessId: req.businessId },
      include: {
        items: { include: { account: { select: { accountCode: true, accountName: true } } } },
        liquidation: {
          include: {
            items: { include: { account: { select: { accountCode: true, accountName: true } } } },
          },
        },
      },
    });
    if (!cr) throw createError('Cash request not found', 404);
    res.json(cr);
  } catch (err) { next(err); }
};

exports.create = async (req, res, next) => {
  try {
    const { requestDate, neededDate, requestedFor, purpose, notes, items } = req.body;
    if (!requestedFor?.trim()) throw createError('Requested for (name) is required', 400);
    if (!purpose?.trim())      throw createError('Purpose is required', 400);

    const rows = mapItems(items);
    if (!rows.length) throw createError('At least one item with an estimated cost is required', 400);

    const requestNo = await genRequestNo();
    const cr = await prisma.cashRequest.create({
      data: {
        businessId:      req.businessId,
        requestNo,
        requestDate:     requestDate ? new Date(requestDate) : new Date(),
        neededDate:      neededDate ? new Date(neededDate) : null,
        requestedFor:    requestedFor.trim(),
        purpose:         purpose.trim(),
        requestedAmount: sumItems(rows),
        notes:           notes || null,
        requestedBy:     actorName(req),
        items:           { create: rows },
      },
      include: { items: true },
    });

    await recordAudit({
      req, action: 'CREATE', entity: 'CashRequest', entityId: cr.id,
      summary: `Created cash request ${cr.requestNo} for ${cr.requestedFor}`,
    });
    res.status(201).json(cr);
  } catch (err) { next(err); }
};

exports.update = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const cr = await prisma.cashRequest.findFirst({ where: { id, businessId: req.businessId } });
    if (!cr) throw createError('Cash request not found', 404);
    if (!['DRAFT', 'SUBMITTED'].includes(cr.status)) {
      throw createError('Only DRAFT or SUBMITTED requests can be edited', 400);
    }

    const { requestDate, neededDate, requestedFor, purpose, notes, items } = req.body;
    const rows = items ? mapItems(items) : null;
    if (items && !rows.length) throw createError('At least one item with an estimated cost is required', 400);

    const updated = await prisma.$transaction(async (tx) => {
      if (rows) {
        await tx.cashRequestItem.deleteMany({ where: { requestId: id } });
        await tx.cashRequestItem.createMany({ data: rows.map((r) => ({ ...r, requestId: id })) });
      }
      return tx.cashRequest.update({
        where: { id },
        data: {
          ...(requestDate  && { requestDate: new Date(requestDate) }),
          ...(neededDate !== undefined && { neededDate: neededDate ? new Date(neededDate) : null }),
          ...(requestedFor && { requestedFor: requestedFor.trim() }),
          ...(purpose      && { purpose: purpose.trim() }),
          ...(notes !== undefined && { notes: notes || null }),
          ...(rows && { requestedAmount: sumItems(rows) }),
        },
        include: { items: true },
      });
    });

    await recordAudit({
      req, action: 'UPDATE', entity: 'CashRequest', entityId: id,
      summary: `Updated cash request ${cr.requestNo}`,
    });
    res.json(updated);
  } catch (err) { next(err); }
};

// Shared status transition helper
const transition = (from, to, verb, extraData = () => ({})) => async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const cr = await prisma.cashRequest.findFirst({ where: { id, businessId: req.businessId } });
    if (!cr) throw createError('Cash request not found', 404);
    if (!from.includes(cr.status)) {
      throw createError(`Only ${from.join(' or ')} requests can be ${verb}`, 400);
    }
    const updated = await prisma.cashRequest.update({
      where: { id },
      data: { status: to, ...extraData(req) },
      include: { items: true },
    });
    await recordAudit({
      req, action: 'UPDATE', entity: 'CashRequest', entityId: id,
      summary: `Cash request ${cr.requestNo} ${verb}`,
    });
    res.json(updated);
  } catch (err) { next(err); }
};

exports.submit = transition(['DRAFT'], 'SUBMITTED', 'submitted');

exports.approve = transition(['SUBMITTED'], 'APPROVED', 'approved', (req) => ({
  approvedBy: req.body.approvedBy || actorName(req),
}));

exports.reject = async (req, res, next) => {
  try {
    const { reason } = req.body;
    if (!reason?.trim()) throw createError('A reason is required to reject a request', 400);
    return transition(['SUBMITTED', 'APPROVED'], 'REJECTED', 'rejected', () => ({
      rejectedReason: reason.trim(),
    }))(req, res, next);
  } catch (err) { next(err); }
};

exports.cancel = transition(
  ['DRAFT', 'SUBMITTED', 'APPROVED'], 'CANCELLED', 'cancelled',
);

// Hand over the cash. Creates the accountability in 1104.
exports.release = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { releasedAmount, cashAccountCode, releasedBy, releasedDate } = req.body;

    const cr = await prisma.cashRequest.findFirst({ where: { id, businessId: req.businessId } });
    if (!cr) throw createError('Cash request not found', 404);
    if (cr.status !== 'APPROVED') throw createError('Only APPROVED requests can be released', 400);

    const amount = Number(releasedAmount);
    if (!(amount > 0)) throw createError('Released amount must be greater than zero', 400);
    if (!cashAccountCode) throw createError('Select the cash account the money comes from', 400);

    const cashAccount = await prisma.account.findFirst({
      where: { accountCode: String(cashAccountCode), businessId: req.businessId },
      select: { id: true },
    });
    if (!cashAccount) throw createError(`Cash account ${cashAccountCode} does not exist`, 400);

    // Throws on bad input before anything is written
    const { lines } = buildReleaseEntry({ requestNo: cr.requestNo, amount, cashAccountCode });

    const updated = await prisma.cashRequest.update({
      where: { id },
      data: {
        status:          'RELEASED',
        releasedAmount:  amount,
        cashAccountCode: String(cashAccountCode),
        releasedBy:      releasedBy || actorName(req),
        releasedDate:    releasedDate ? new Date(releasedDate) : new Date(),
      },
      include: { items: true },
    });

    await glPost.safePost({
      entryDate:   releasedDate || new Date().toISOString().slice(0, 10),
      description: `Cash Advance — ${cr.requestNo} (${cr.requestedFor})`,
      reference:   cr.requestNo,
      lines,
      userId:      req.user?.id || 1,
      businessId:  req.businessId,
    });

    await recordAudit({
      req, action: 'RELEASE', entity: 'CashRequest', entityId: id,
      summary: `Released ₱${amount.toLocaleString()} on ${cr.requestNo} to ${cr.requestedFor}`,
    });
    res.json(updated);
  } catch (err) { next(err); }
};

// Serves the keyword rules to the browser so the UI can match as the user
// types without a round-trip per keystroke. The server re-applies the same
// rules at liquidation, so this is a convenience, not the authority.
exports.accountMap = (_req, res) => {
  res.json({ rules: KEYWORD_RULES, fallback: FALLBACK_ACCOUNT });
};

// Fill in accountId for any line that arrived without one, using the same
// keyword rules the browser used. Batched: one query for all needed codes.
//
// Only ACTIVE accounts qualify. A business can retire the accounts a rule points
// at (a trading company drops the agency 50xx set); posting to one silently is
// worse than landing in Miscellaneous, so such a line falls back to FALLBACK_ACCOUNT.
const resolveLineAccounts = async (lines, businessId) => {
  const needing = lines.filter((l) => !l.accountId);
  if (!needing.length) return lines;

  const wanted = new Map(); // description -> code
  for (const l of needing) wanted.set(l.description, matchAccountCode(l.description));

  const codes = [...new Set([...wanted.values(), FALLBACK_ACCOUNT])];
  const accts = await prisma.account.findMany({
    where: { accountCode: { in: codes }, businessId, isActive: true },
    select: { id: true, accountCode: true },
  });
  const byCode = new Map(accts.map((a) => [a.accountCode, a.id]));

  return lines.map((l) =>
    l.accountId
      ? l
      : { ...l, accountId: byCode.get(wanted.get(l.description)) ?? byCode.get(FALLBACK_ACCOUNT) ?? null }
  );
};
exports.resolveLineAccounts = resolveLineAccounts;

// Settle the advance against receipts. Clears 1104 and books the real expense.
exports.liquidate = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { lines, receiptNo, liquidationDate, notes } = req.body;

    const cr = await prisma.cashRequest.findFirst({
      where: { id, businessId: req.businessId },
      include: { liquidation: { select: { id: true } } },
    });
    if (!cr) throw createError('Cash request not found', 404);
    if (cr.status !== 'RELEASED') throw createError('Only RELEASED requests can be liquidated', 400);
    if (cr.liquidation) throw createError('This request has already been liquidated', 400);

    const rawSpent = (lines || [])
      .filter((l) => l.description && Number(l.amount) > 0)
      .map((l) => ({
        description: l.description,
        amount:      Number(l.amount),
        accountId:   l.accountId ? Number(l.accountId) : null,
        receiptNo:   l.receiptNo || null,
      }));
    if (!rawSpent.length) throw createError('Add at least one liquidation line', 400);

    // Any line without an account gets one from the keyword rules, so nothing
    // silently lands in Miscellaneous just because the UI did not match it.
    const spent = await resolveLineAccounts(rawSpent, req.businessId);

    // Throws on bad input before anything is written
    const { lines: glLines, variance, mode } = buildLiquidationEntry({
      requestNo:       cr.requestNo,
      releasedAmount:  Number(cr.releasedAmount),
      lines:           spent,
      cashAccountCode: cr.cashAccountCode,
    });

    const actualSpent = spent.reduce((s, l) => s + l.amount, 0);
    const dateStr = liquidationDate || new Date().toISOString().slice(0, 10);

    const voucherNo = await (async () => {
      const last = await prisma.expenseVoucher.findFirst({
        orderBy: { id: 'desc' }, select: { voucherNo: true },
      });
      return nextDocNumber('EV-', last?.voucherNo);
    })();

    const result = await prisma.$transaction(async (tx) => {
      const voucher = await tx.expenseVoucher.create({
        data: {
          businessId:  req.businessId,
          voucherNo,
          type:        'LIQUIDATION',
          date:        new Date(dateStr),
          payee:       cr.requestedFor,
          category:    'MISCELLANEOUS',
          purpose:     `Liquidation of ${cr.requestNo} — ${cr.purpose}`,
          totalAmount: actualSpent,
          receiptNo:   receiptNo || null,
          status:      'PAID',
          requestedBy: cr.requestedFor,
          approvedBy:  cr.approvedBy,
          paidDate:    new Date(dateStr),
          notes:       notes || null,
          cashRequestId: cr.id,
          items: { create: spent.map((l) => ({
            description: l.description,
            accountId:   l.accountId,
            amount:      l.amount,
            receiptNo:   l.receiptNo,
          })) },
        },
        include: { items: true },
      });

      const updated = await tx.cashRequest.update({
        where: { id },
        data: { status: 'LIQUIDATED' },
        include: { items: true, liquidation: { include: { items: true } } },
      });

      return { voucher, updated };
    });

    await glPost.safePost({
      entryDate:   dateStr,
      description: `Liquidation — ${cr.requestNo} (${cr.requestedFor})`,
      reference:   cr.requestNo,
      lines:       glLines,
      userId:      req.user?.id || 1,
      businessId:  req.businessId,
    });

    await recordAudit({
      req, action: 'LIQUIDATE', entity: 'CashRequest', entityId: id,
      summary: `Liquidated ${cr.requestNo} — spent ₱${actualSpent.toLocaleString()} of ₱${Number(cr.releasedAmount).toLocaleString()} (${mode})`,
    });

    res.json({ ...result.updated, variance, mode });
  } catch (err) { next(err); }
};

exports.summary = async (req, res, next) => {
  try {
    const where = { businessId: req.businessId };
    const [pendingApproval, awaitingRelease, released] = await Promise.all([
      prisma.cashRequest.count({ where: { ...where, status: 'SUBMITTED' } }),
      prisma.cashRequest.count({ where: { ...where, status: 'APPROVED' } }),
      prisma.cashRequest.findMany({
        where: { ...where, status: 'RELEASED' },
        select: { releasedAmount: true },
      }),
    ]);

    res.json({
      pendingApproval,
      awaitingRelease,
      releasedCount:     released.length,
      outstandingAmount: released.reduce((s, r) => s + Number(r.releasedAmount), 0),
    });
  } catch (err) { next(err); }
};

// Outstanding advances grouped by holder. Groups by the free-text name, so
// spelling variants of the same person appear as separate rows.
exports.unliquidated = async (req, res, next) => {
  try {
    const rows = await prisma.cashRequest.findMany({
      where: { businessId: req.businessId, status: 'RELEASED' },
      select: { requestNo: true, requestedFor: true, releasedAmount: true, releasedDate: true },
      orderBy: { releasedDate: 'asc' },
    });

    const now = Date.now();
    const byPerson = new Map();
    for (const r of rows) {
      const key = r.requestedFor;
      const days = r.releasedDate
        ? Math.floor((now - new Date(r.releasedDate).getTime()) / 86400000)
        : 0;
      const cur = byPerson.get(key) || { requestedFor: key, count: 0, amount: 0, oldestDays: 0 };
      cur.count  += 1;
      cur.amount += Number(r.releasedAmount);
      cur.oldestDays = Math.max(cur.oldestDays, days);
      byPerson.set(key, cur);
    }

    res.json([...byPerson.values()].sort((a, b) => b.amount - a.amount));
  } catch (err) { next(err); }
};
