const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { computeVAT } = require('../utils/phCompliance');
const glPost = require('../utils/glPost');
const logger = require('../utils/logger');
const { recordAudit } = require('../utils/audit');
const { nextDocNumber } = require('../utils/docNumber');

// Derive the next number from the LAST ISSUED number, never from a row count.
// A count is wrong the moment a row is deleted: with 5 invoices created and one
// deleted, count()+1 yields INV-000005, which already exists, and the unique
// constraint then rejects every subsequent create forever. See utils/docNumber.js.
//
// The startsWith filter keeps this series separate from the school billing
// series (SI-<businessId>-nnnnnn), which numbers itself independently.
const genInvNo = async () => {
  const last = await prisma.invoice.findFirst({
    where:   { invoiceNo: { startsWith: 'INV-' } },
    orderBy: { invoiceNo: 'desc' },
    select:  { invoiceNo: true },
  });
  return nextDocNumber('INV-', last?.invoiceNo, 6);
};
const genPayNo = async () => {
  const last = await prisma.paymentAR.findFirst({
    where:   { paymentNo: { startsWith: 'PAR-' } },
    orderBy: { paymentNo: 'desc' },
    select:  { paymentNo: true },
  });
  return nextDocNumber('PAR-', last?.paymentNo, 6);
};

// Shared by createInvoice/updateInvoice: recompute per-line VAT + running totals.
// Contra-revenue accounts (e.g. Sales Discounts, Sales Returns & Allowances —
// REVENUE type but normalBalance DEBIT) reduce the subtotal instead of adding
// to it, so their line amount is negated before VAT is applied.
async function computeInvoiceTotals(lines) {
  const accountIds = [...new Set(lines.map((l) => Number(l.accountId)))];
  const accounts = await prisma.account.findMany({
    where: { id: { in: accountIds } },
    select: { id: true, normalBalance: true },
  });
  const normalBalanceById = new Map(accounts.map((a) => [a.id, a.normalBalance]));

  let subtotal = 0, vatAmount = 0;
  const processedLines = lines.map((l) => {
    const sign = normalBalanceById.get(Number(l.accountId)) === 'DEBIT' ? -1 : 1;
    const amt = sign * Number(l.quantity) * Number(l.unitPrice);
    const v = l.vatCode === 'VAT' ? computeVAT(amt) : { base: amt, vat: 0, total: amt };
    subtotal += v.base; vatAmount += v.vat;
    return { ...l, amount: v.base };
  });
  return { subtotal, vatAmount, totalAmount: subtotal + vatAmount, processedLines };
}

// Shared by createInvoice/updateInvoice: DR AR / revenue lines (CR) or
// contra-revenue lines (DR, since l.amount is already negative for those,
// matching their DEBIT normal balance) / CR Output VAT.
function buildInvoiceGLLines(inv) {
  return [
    { accountCode: '1100', debit: Number(inv.totalAmount), description: `AR — ${inv.customer.name} (${inv.invoiceNo})` },
    ...inv.lines.map((l) => {
      const amt = Number(l.amount);
      return amt < 0
        ? { accountId: l.accountId, debit: -amt, description: l.description }
        : { accountId: l.accountId, credit: amt, description: l.description };
    }),
    ...(Number(inv.vatAmount) > 0 ? [{ accountCode: '2030', credit: Number(inv.vatAmount), description: 'Output VAT' }] : []),
  ];
}

exports.listCustomers = async (req, res, next) => {
  try {
    const { search, active } = req.query;
    const where = { businessId: req.businessId };
    if (active !== undefined) where.isActive = active === 'true';
    if (search) where.OR = [{ name: { contains: search } }, { customerCode: { contains: search } }];
    res.json(await prisma.customer.findMany({ where, orderBy: { name: 'asc' } }));
  } catch (err) { next(err); }
};

// Generate the next sequential customer code (CUS-001, CUS-002, …) for a business
async function nextCustomerCode(businessId) {
  const rows = await prisma.customer.findMany({
    where: { businessId, customerCode: { startsWith: 'CUS-' } },
    select: { customerCode: true },
  });
  let max = 0;
  for (const { customerCode } of rows) {
    const m = /^CUS-(\d+)$/.exec(customerCode);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return 'CUS-' + String(max + 1).padStart(3, '0');
}

exports.createCustomer = async (req, res, next) => {
  try {
    const { customerCode, name, tin, address, contactName, email, phone } = req.body;
    const base = { businessId: req.businessId, name, tin, address, contactName, email, phone };

    // Manual code supplied → use as-is. Otherwise auto-generate, retrying on the
    // off chance a concurrent create grabbed the same sequential number.
    if (customerCode && customerCode.trim()) {
      return res.status(201).json(await prisma.customer.create({ data: { ...base, customerCode: customerCode.trim() } }));
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const code = await nextCustomerCode(req.businessId);
        return res.status(201).json(await prisma.customer.create({ data: { ...base, customerCode: code } }));
      } catch (err) {
        if (err.code === 'P2002' && attempt < 4) continue; // collision → retry
        throw err;
      }
    }
  } catch (err) { next(err); }
};

exports.updateCustomer = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { name, tin, address, contactName, email, phone, isActive } = req.body;
    res.json(await prisma.customer.update({ where: { id }, data: { name, tin, address, contactName, email, phone, isActive } }));
  } catch (err) { next(err); }
};

exports.listInvoices = async (req, res, next) => {
  try {
    const { status, customerId, from, to, page = 1, limit = 20 } = req.query;
    const where = { businessId: req.businessId };
    if (status) where.status = status;
    if (customerId) where.customerId = Number(customerId);
    if (from || to) where.invoiceDate = { ...(from && { gte: new Date(from) }), ...(to && { lte: new Date(to) }) };

    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        include: {
          customer: { select: { name: true, customerCode: true } },
          lines: true,
          payments: { orderBy: { paymentDate: 'asc' } },
        },
        orderBy: { invoiceDate: 'desc' },
        skip: (Number(page)-1)*Number(limit), take: Number(limit),
      }),
      prisma.invoice.count({ where }),
    ]);
    res.json({ data: invoices, total, page: Number(page), pages: Math.ceil(total/Number(limit)) });
  } catch (err) { next(err); }
};

exports.getInvoice = async (req, res, next) => {
  try {
    const inv = await prisma.invoice.findUnique({
      where: { id: Number(req.params.id) },
      include: { customer: true, lines: { include: { account: true } }, payments: true },
    });
    if (!inv) throw createError('Invoice not found', 404);
    res.json(inv);
  } catch (err) { next(err); }
};

exports.createInvoice = async (req, res, next) => {
  try {
    const { customerId, invoiceDate, dueDate, description, notes, lines } = req.body;
    const { subtotal, vatAmount, totalAmount, processedLines } = await computeInvoiceTotals(lines);

    const invoiceNo = await genInvNo();
    const inv = await prisma.invoice.create({
      data: {
        businessId: req.businessId,
        invoiceNo, customerId: Number(customerId),
        invoiceDate: new Date(invoiceDate), dueDate: new Date(dueDate),
        description, notes, subtotal, vatAmount, totalAmount,
        lines: { create: processedLines.map((l) => ({
          accountId: Number(l.accountId), description: l.description,
          quantity: l.quantity, unitPrice: l.unitPrice, amount: l.amount, vatCode: l.vatCode,
        })) },
      },
      include: { customer: true, lines: true },
    });

    // ── Auto-post to GL ──────────────────────────────────────────────────────
    const glLines = buildInvoiceGLLines(inv);
    await glPost.safePost({
      entryDate:   inv.invoiceDate,
      description: `AR Invoice — ${inv.customer.name} (${inv.invoiceNo})`,
      reference:   inv.invoiceNo,
      lines:       glLines,
      userId:      req.user?.id || 1,
      businessId:  req.businessId,
    });

    res.status(201).json(inv);
  } catch (err) { next(err); }
};

exports.updateInvoice = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const inv = await prisma.invoice.findFirst({ where: { id, businessId: req.businessId } });
    if (!inv) throw createError('Invoice not found', 404);
    if (inv.status === 'PAID') throw createError('Cannot edit a fully paid invoice.', 400);
    if (inv.status === 'VOID') throw createError('Cannot edit a voided invoice.', 400);

    const { customerId, invoiceDate, dueDate, description, notes, lines } = req.body;
    const { subtotal, vatAmount, totalAmount, processedLines } = await computeInvoiceTotals(lines);

    if (totalAmount < Number(inv.paidAmount) - 0.01) {
      throw createError(
        `New total (₱${totalAmount.toFixed(2)}) is less than the amount already collected (₱${Number(inv.paidAmount).toFixed(2)}). Adjust line items so the total covers what's been paid.`,
        400
      );
    }

    const remaining = totalAmount - Number(inv.paidAmount);
    const status = remaining <= 0.01 ? 'PAID' : (Number(inv.paidAmount) > 0 ? 'PARTIAL' : inv.status);

    const updated = await prisma.invoice.update({
      where: { id },
      data: {
        customerId: Number(customerId),
        invoiceDate: new Date(invoiceDate),
        dueDate: new Date(dueDate),
        description, notes, subtotal, vatAmount, totalAmount, status,
        lines: {
          deleteMany: {},
          create: processedLines.map((l) => ({
            accountId: Number(l.accountId), description: l.description,
            quantity: l.quantity, unitPrice: l.unitPrice, amount: l.amount, vatCode: l.vatCode,
          })),
        },
      },
      include: { customer: true, lines: { include: { account: true } }, payments: true },
    });

    // ── GL correction: void the old entry (if any), post a fresh one ────────
    const oldEntry = await prisma.journalEntry.findFirst({
      where: { businessId: req.businessId, reference: updated.invoiceNo, status: 'POSTED' },
    });
    if (oldEntry) {
      try {
        await prisma.journalEntry.update({ where: { id: oldEntry.id }, data: { status: 'VOIDED' } });
      } catch (err) {
        logger.error(`[INVOICE EDIT — GL VOID FAILED] invoiceNo=${updated.invoiceNo} biz=${req.businessId} — ${err.message}`);
        try {
          await recordAudit({
            action:     'GL_POST_FAILED',
            entity:     'JournalEntry',
            entityId:   String(oldEntry.id),
            summary:    `Failed to void prior GL entry for edited invoice ${updated.invoiceNo} — ${err.message}`,
            user:       req.user?.id ? { id: req.user.id } : undefined,
            businessId: req.businessId,
          });
        } catch { /* auditing must never break anything either */ }
      }
    }

    const glLines = buildInvoiceGLLines(updated);
    await glPost.safePost({
      entryDate:   updated.invoiceDate,
      description: `AR Invoice (Edited) — ${updated.customer.name} (${updated.invoiceNo})`,
      reference:   updated.invoiceNo,
      lines:       glLines,
      userId:      req.user?.id || 1,
      businessId:  req.businessId,
    });

    res.json(updated);
  } catch (err) { next(err); }
};

exports.recordPayment = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { paymentDate, amount, paymentMethod, reference, notes } = req.body;
    const inv = await prisma.invoice.findUnique({ where: { id } });
    if (!inv) throw createError('Invoice not found', 404);
    if (inv.status === 'VOID') throw createError('Cannot collect on a voided invoice', 400);

    const paymentNo = await genPayNo();
    const newPaid = Number(inv.paidAmount) + Number(amount);
    const remaining = Number(inv.totalAmount) - newPaid;
    const status = remaining <= 0.01 ? 'PAID' : 'PARTIAL';

    await prisma.$transaction([
      prisma.paymentAR.create({ data: { paymentNo, invoiceId: id, paymentDate: new Date(paymentDate), amount: Number(amount), paymentMethod, reference, notes } }),
      prisma.invoice.update({ where: { id }, data: { paidAmount: newPaid, status } }),
    ]);

    // ── Auto-post to GL ──────────────────────────────────────────────────────
    // Map payment method → GL account
    const PAYMENT_ACCOUNT = {
      'Cash':          '1010', // Cash on Hand
      'Bank Transfer': '1020', // Cash in Bank — BDO Checking
      'Check':         '1020',
      'GCash':         '1024', // Cash in Bank — UnionBank (GCash)
      'Maya':          '1024',
      'Credit Card':   '1020',
      'Online':        '1020',
    };
    const cashAccount = PAYMENT_ACCOUNT[paymentMethod] || '1010';
    const customer = await prisma.customer.findUnique({ where: { id: inv.customerId }, select: { name: true } });
    await glPost.safePost({
      entryDate:   paymentDate,
      description: `AR Collection — ${customer?.name} (${inv.invoiceNo})`,
      reference:   paymentNo,
      lines: [
        { accountCode: cashAccount, debit:  Number(amount), description: `Cash in — ${paymentNo} (${paymentMethod})` },
        { accountCode: '1100',      credit: Number(amount), description: `Clear AR — ${customer?.name}` },
      ],
      userId: req.user?.id || 1,
      businessId: req.businessId,
    });

    res.json({ message: 'Payment collected', remainingBalance: Math.max(0, remaining) });
  } catch (err) { next(err); }
};

exports.voidInvoice = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const inv = await prisma.invoice.findUnique({ where: { id } });
    if (!inv) throw createError('Invoice not found', 404);
    if (inv.paidAmount > 0) throw createError('Cannot void an invoice with collections. Reverse first.', 400);
    const updated = await prisma.invoice.update({ where: { id }, data: { status: 'VOID' } });

    // Void the invoice's GL posting too — otherwise its revenue/AR impact keeps
    // showing up in the Income Statement, Trial Balance, and Balance Sheet.
    const entry = await prisma.journalEntry.findFirst({
      where: { businessId: inv.businessId, reference: inv.invoiceNo, status: 'POSTED' },
    });
    if (entry) {
      try {
        await prisma.journalEntry.update({ where: { id: entry.id }, data: { status: 'VOIDED' } });
      } catch (err) {
        logger.error(`[INVOICE VOID — GL VOID FAILED] invoiceNo=${inv.invoiceNo} biz=${inv.businessId} — ${err.message}`);
        try {
          await recordAudit({
            action:     'GL_POST_FAILED',
            entity:     'JournalEntry',
            entityId:   String(entry.id),
            summary:    `Failed to void GL entry for voided invoice ${inv.invoiceNo} — ${err.message}`,
            user:       req.user?.id ? { id: req.user.id } : undefined,
            businessId: inv.businessId,
          });
        } catch { /* auditing must never break anything either */ }
      }
    }

    res.json(updated);
  } catch (err) { next(err); }
};

exports.markShipped = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const inv = await prisma.invoice.findFirst({ where: { id, businessId: req.businessId } });
    if (!inv) throw createError('Invoice not found', 404);
    if (inv.status === 'VOID') throw createError('Cannot ship a voided invoice.', 400);

    const { shippedDate, shippingAddress, courier, trackingNumber } = req.body;
    const updated = await prisma.invoice.update({
      where: { id },
      data: {
        deliveryStatus:  'SHIPPED',
        shippedDate:     shippedDate ? new Date(shippedDate) : new Date(),
        shippingAddress: shippingAddress || null,
        courier:         courier || null,
        trackingNumber:  trackingNumber || null,
      },
    });

    res.json(updated);
  } catch (err) { next(err); }
};

exports.agingReport = async (req, res, next) => {
  try {
    const today = new Date();
    const invoices = await prisma.invoice.findMany({
      where: { businessId: req.businessId, status: { in: ['OPEN','PARTIAL','OVERDUE'] } },
    });

    // Fetch customer names separately (not via `include`) so an invoice whose
    // customer was deleted out from under it (orphaned FK) can't crash the
    // whole report — Prisma throws on `include` when a required relation
    // resolves to null.
    const customerIds = [...new Set(invoices.map((inv) => inv.customerId))];
    const customers = await prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true } });
    const customerNames = Object.fromEntries(customers.map((c) => [c.id, c.name]));

    const report = invoices.map((inv) => {
      const due = new Date(inv.dueDate);
      const daysOverdue = Math.max(0, Math.floor((today - due) / 86400000));
      const outstanding = Number(inv.totalAmount) - Number(inv.paidAmount);
      return {
        invoiceNo: inv.invoiceNo, customer: customerNames[inv.customerId] || 'Unknown customer', customerId: inv.customerId,
        dueDate: inv.dueDate, outstanding, daysOverdue, notes: inv.notes,
        bucket: daysOverdue === 0 ? 'Current'
          : daysOverdue <= 30 ? '1-30 days'
          : daysOverdue <= 60 ? '31-60 days'
          : daysOverdue <= 90 ? '61-90 days'
          : 'Over 90 days',
      };
    });
    const buckets = ['Current','1-30 days','31-60 days','61-90 days','Over 90 days'];
    const summary = Object.fromEntries(buckets.map((b) => [b, report.filter((r) => r.bucket === b).reduce((s, r) => s + r.outstanding, 0)]));
    res.json({ items: report, summary, total: report.reduce((s, r) => s + r.outstanding, 0) });
  } catch (err) { next(err); }
};
