const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { computeVAT } = require('../utils/phCompliance');
const glPost = require('../utils/glPost');

// ─── Sequential numbers ───────────────────────────────────────────
// Derived from the highest existing quotationNo (not a row count) so that
// deleting a non-latest quotation can't shrink the count and collide with
// a still-existing higher number (QUO-000006 exists, QUO-000003 gets
// deleted, count-based numbering would then re-issue QUO-000006).
async function genQuotationNo() {
  const last = await prisma.quotation.findFirst({
    orderBy: { quotationNo: 'desc' },
    select: { quotationNo: true },
  });
  const next = last ? parseInt(last.quotationNo.replace('QUO-', ''), 10) + 1 : 1;
  return `QUO-${String(next).padStart(6, '0')}`;
}
async function genInvNo() {
  const count = await prisma.invoice.count();
  return `INV-${String(count + 1).padStart(6, '0')}`;
}

// Compute subtotal/VAT and per-line amounts (VAT-inclusive base, like AR invoices)
function computeTotals(lines = []) {
  let subtotal = 0, vatAmount = 0;
  const processed = lines.map((l) => {
    const amt = Number(l.quantity) * Number(l.unitPrice);
    const v = l.vatCode === 'VAT' ? computeVAT(amt) : { base: amt, vat: 0, total: amt };
    subtotal += v.base; vatAmount += v.vat;
    return { ...l, amount: v.base };
  });
  return { subtotal, vatAmount, processed };
}

// ─── List ─────────────────────────────────────────────────────────
exports.list = async (req, res, next) => {
  try {
    const { status, customerId, from, to, page = 1, limit = 20 } = req.query;
    const where = { businessId: req.businessId };
    if (status)     where.status     = status;
    if (customerId) where.customerId = Number(customerId);
    if (from || to) where.quotationDate = { ...(from && { gte: new Date(from) }), ...(to && { lte: new Date(to) }) };

    const [data, total] = await Promise.all([
      prisma.quotation.findMany({
        where,
        include: { customer: { select: { name: true, customerCode: true } }, lines: true },
        orderBy: { quotationDate: 'desc' },
        skip: (Number(page) - 1) * Number(limit), take: Number(limit),
      }),
      prisma.quotation.count({ where }),
    ]);
    res.json({ data, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (err) { next(err); }
};

// ─── Get one ──────────────────────────────────────────────────────
exports.get = async (req, res, next) => {
  try {
    const q = await prisma.quotation.findUnique({
      where: { id: Number(req.params.id) },
      include: { customer: true, lines: { include: { account: { select: { accountCode: true, accountName: true } } } } },
    });
    if (!q) throw createError('Quotation not found', 404);

    // createdBy is a plain user id (matches the createdBy convention used
    // elsewhere in this codebase, e.g. journalController) — resolve it to a
    // display name here rather than via a Prisma relation.
    let creator = null;
    if (q.createdBy) {
      creator = await prisma.user.findUnique({
        where: { id: q.createdBy },
        select: { firstName: true, lastName: true },
      });
    }

    res.json({ ...q, creator });
  } catch (err) { next(err); }
};

// ─── Create ───────────────────────────────────────────────────────
exports.create = async (req, res, next) => {
  try {
    const { customerId, quotationDate, validUntil, description, notes, lines } = req.body;
    const { subtotal, vatAmount, processed } = computeTotals(lines);

    // Retry once on a quotationNo collision (e.g. two near-simultaneous
    // submissions computing the same next number) rather than surfacing
    // the raw unique-constraint error to the user.
    let q;
    for (let attempt = 0; attempt < 3; attempt++) {
      const quotationNo = await genQuotationNo();
      try {
        q = await prisma.quotation.create({
          data: {
            businessId: req.businessId,
            quotationNo, customerId: Number(customerId),
            quotationDate: new Date(quotationDate), validUntil: new Date(validUntil),
            description, notes, subtotal, vatAmount, totalAmount: subtotal + vatAmount,
            createdBy: req.user?.id ?? null,
            lines: { create: processed.map((l) => ({
              // No GL account while quoting — it is assigned at convert-to-invoice.
              itemName: l.itemName || null,
              itemId:   l.itemId ? Number(l.itemId) : null,
              description: l.description,
              quantity: l.quantity, unitPrice: l.unitPrice, amount: l.amount, vatCode: l.vatCode,
            })) },
          },
          include: { customer: true, lines: true },
        });
        break;
      } catch (err) {
        if (err.code === 'P2002' && attempt < 2) continue;
        throw err;
      }
    }
    res.status(201).json(q);
  } catch (err) { next(err); }
};

// ─── Update (DRAFT only) ──────────────────────────────────────────
exports.update = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.quotation.findUnique({ where: { id } });
    if (!existing) throw createError('Quotation not found', 404);
    if (existing.status !== 'DRAFT') throw createError('Only DRAFT quotations can be edited', 400);

    const { customerId, quotationDate, validUntil, description, notes, lines } = req.body;
    const { subtotal, vatAmount, processed } = computeTotals(lines || []);

    await prisma.quotation.update({
      where: { id },
      data: {
        customerId:    customerId ? Number(customerId) : undefined,
        quotationDate: quotationDate ? new Date(quotationDate) : undefined,
        validUntil:    validUntil ? new Date(validUntil) : undefined,
        description,
        notes,
        ...(Array.isArray(lines) ? { subtotal, vatAmount, totalAmount: subtotal + vatAmount } : {}),
      },
    });

    if (Array.isArray(lines)) {
      await prisma.quotationLine.deleteMany({ where: { quotationId: id } });
      if (processed.length) {
        await prisma.quotationLine.createMany({
          data: processed.map((l) => ({
            quotationId: id,
            itemName: l.itemName || null,
            itemId:   l.itemId ? Number(l.itemId) : null,
            description: l.description,
            quantity: l.quantity, unitPrice: l.unitPrice, amount: l.amount, vatCode: l.vatCode,
          })),
        });
      }
    }

    const updated = await prisma.quotation.findUnique({ where: { id }, include: { customer: true, lines: true } });
    res.json(updated);
  } catch (err) { next(err); }
};

// ─── Status transitions ───────────────────────────────────────────
const transition = (target, allowedFrom) => async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const q = await prisma.quotation.findUnique({ where: { id } });
    if (!q) throw createError('Quotation not found', 404);
    if (!allowedFrom.includes(q.status)) throw createError(`Cannot mark ${target} from ${q.status}`, 400);
    const updated = await prisma.quotation.update({ where: { id }, data: { status: target } });
    res.json(updated);
  } catch (err) { next(err); }
};
exports.send   = transition('SENT',     ['DRAFT']);
exports.accept = transition('ACCEPTED', ['DRAFT', 'SENT']);
exports.reject = transition('REJECTED', ['DRAFT', 'SENT']);

// ─── Delete (anything except CONVERTED) ───────────────────────────
exports.remove = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const q = await prisma.quotation.findUnique({ where: { id } });
    if (!q) throw createError('Quotation not found', 404);
    if (q.status === 'CONVERTED') throw createError('Cannot delete a converted quotation', 400);
    await prisma.quotation.delete({ where: { id } });
    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
};

const DEFAULT_REVENUE_ACCOUNT = '4100'; // Advertising Services Revenue

// What the convert dialog needs: every line with a suggested revenue account.
// A line quoted from a stocked item inherits that item's revenue account;
// anything else falls back to the default for the user to confirm or change.
exports.convertPreview = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const q = await prisma.quotation.findFirst({
      where: { id, businessId: req.businessId },
      include: {
        customer: true,
        lines: { include: { item: { select: { sku: true, name: true, revenueAccountId: true } } } },
      },
    });
    if (!q) throw createError('Quotation not found', 404);
    if (q.status === 'CONVERTED') throw createError('Quotation already converted to an invoice', 400);

    const fallback = await prisma.account.findFirst({
      // Only suggest it while it's active — a trading company retires 4100.
      where: { accountCode: DEFAULT_REVENUE_ACCOUNT, businessId: req.businessId, isActive: true },
      select: { id: true },
    });

    res.json({
      quotationNo: q.quotationNo,
      customer:    q.customer,
      totalAmount: q.totalAmount,
      lines: q.lines.map((l) => ({
        id:          l.id,
        itemName:    l.itemName,
        description: l.description,
        quantity:    l.quantity,
        unitPrice:   l.unitPrice,
        amount:      l.amount,
        vatCode:     l.vatCode,
        suggestedAccountId: l.item?.revenueAccountId || fallback?.id || null,
        suggestedFrom:      l.item?.revenueAccountId ? `from ${l.item.sku}` : 'default — review',
      })),
    });
  } catch (err) { next(err); }
};

// ─── Convert to AR Invoice ────────────────────────────────────────
exports.convert = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const q = await prisma.quotation.findUnique({ where: { id }, include: { lines: true, customer: true } });
    if (!q) throw createError('Quotation not found', 404);
    if (q.status === 'CONVERTED') throw createError('Quotation already converted to an invoice', 400);
    if (!q.lines.length)         throw createError('Quotation has no line items', 400);

    const { dueDate, accounts } = req.body;

    // The revenue account is assigned here, not on the quotation. Every line
    // needs one before anything posts, so a missing account fails loudly
    // rather than silently booking revenue to the wrong place.
    const byLine = new Map((accounts || []).map((a) => [Number(a.lineId), Number(a.accountId)]));
    const missing = q.lines.filter((l) => !byLine.get(l.id) && !l.accountId);
    if (missing.length) {
      throw createError(
        `Assign a revenue account for every line before converting (${missing.length} missing)`,
        400
      );
    }
    const accountFor = (line) => byLine.get(line.id) || line.accountId;
    const invoiceNo = await genInvNo();
    const due = dueDate ? new Date(dueDate) : new Date(Date.now() + 30 * 86400000);

    // The quotation's own subtotal/amount were computed with no account
    // attached (accounts are assigned here, at conversion) so they can't
    // reflect contra-revenue accounts. Recompute per line now that every
    // line has a real account, so a Sales Discounts / Returns line
    // subtracts instead of adding — same rule as a normal AR invoice.
    const lineAccountIds = [...new Set(q.lines.map((l) => accountFor(l)))];
    const lineAccounts = await prisma.account.findMany({
      where: { id: { in: lineAccountIds } },
      select: { id: true, normalBalance: true },
    });
    const normalBalanceById = new Map(lineAccounts.map((a) => [a.id, a.normalBalance]));

    let subtotal = 0, vatAmount = 0;
    const invLines = q.lines.map((l) => {
      const accountId = accountFor(l);
      const sign = normalBalanceById.get(accountId) === 'DEBIT' ? -1 : 1;
      const amt = sign * Number(l.quantity) * Number(l.unitPrice);
      const v = l.vatCode === 'VAT' ? computeVAT(amt) : { base: amt, vat: 0, total: amt };
      subtotal += v.base; vatAmount += v.vat;
      return {
        accountId,
        description: l.itemName ? `${l.itemName} — ${l.description}` : l.description,
        quantity: l.quantity, unitPrice: l.unitPrice, amount: v.base, vatCode: l.vatCode,
      };
    });
    const totalAmount = subtotal + vatAmount;

    const inv = await prisma.invoice.create({
      data: {
        businessId: q.businessId,
        invoiceNo, customerId: q.customerId,
        invoiceDate: new Date(), dueDate: due,
        description: q.description || `From quotation ${q.quotationNo}`,
        subtotal, vatAmount, totalAmount,
        lines: { create: invLines },
      },
      include: { customer: true, lines: true },
    });

    // ── Auto-post to GL (same as a normal AR invoice) ───────────────────────────
    const glLines = [
      { accountCode: '1100', debit: Number(inv.totalAmount), description: `AR — ${inv.customer.name} (${inv.invoiceNo})` },
      ...inv.lines.map((l) => {
        const amt = Number(l.amount);
        return amt < 0
          ? { accountId: l.accountId, debit: -amt, description: l.description }
          : { accountId: l.accountId, credit: amt, description: l.description };
      }),
      ...(Number(inv.vatAmount) > 0 ? [{ accountCode: '2030', credit: Number(inv.vatAmount), description: 'Output VAT' }] : []),
    ];
    await glPost.safePost({
      entryDate:   inv.invoiceDate,
      description: `AR Invoice — ${inv.customer.name} (${inv.invoiceNo}) [from ${q.quotationNo}]`,
      reference:   inv.invoiceNo,
      lines:       glLines,
      userId:      req.user?.id || 1,
      businessId:  req.businessId,
    });

    await prisma.quotation.update({ where: { id }, data: { status: 'CONVERTED', convertedInvoiceId: inv.id } });

    res.status(201).json({ invoice: inv, quotationId: id });
  } catch (err) { next(err); }
};
