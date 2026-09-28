/**
 * billingAdjustmentController.js — Corrections, credit memos, refunds, and
 * gateway settlement.
 *
 * The four things the blueprint's billing formula needs that invoices cannot
 * express:
 *
 *   ADJUSTMENT   a fee charged in error, one that was missed, a late penalty
 *   CREDIT MEMO  a credit granted against the account
 *   REFUND       money going back out to the parent
 *   SETTLEMENT   a gateway payout landing in the bank, net of its fee
 *
 * Everything here posts through glPost and lands on the student ledger, so a
 * correction is visible on the statement rather than hidden inside a re-issued
 * assessment.
 */

const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const glPost = require('../utils/glPost');
const { nextDocNumber } = require('../utils/docNumber');
const { recordAudit } = require('../utils/audit');
const { round2 } = require('../utils/assessmentCalc');
const schoolInvoice = require('../utils/schoolInvoice');
const studentLedger = require('../utils/studentLedger');

const CLEARING = '1030'; // Online Payment Clearing
const GATEWAY_FEE = '6360'; // Bank Charges & Service Fees

const studentLabel = (s) =>
  `${[s.lastName + ',', s.firstName, s.middleName, s.suffix].filter(Boolean).join(' ')} (${s.studentNo})`;

async function nextNo(businessId, prefix, model, field) {
  const p = `${prefix}-${businessId}-`;
  const last = await prisma[model].findFirst({
    where:   { [field]: { startsWith: p } },
    orderBy: { [field]: 'desc' },
    select:  { [field]: true },
  });
  return nextDocNumber(p, last?.[field], 6);
}

// ── Adjustments ────────────────────────────────────────────────────────────

exports.listAdjustments = async (req, res, next) => {
  try {
    const { studentId, status, from, to } = req.query;
    const items = await prisma.billingAdjustment.findMany({
      where: {
        businessId: req.businessId,
        ...(studentId && { studentId: Number(studentId) }),
        ...(status && { status }),
        ...((from || to) && {
          adjustmentDate: { ...(from && { gte: new Date(from) }), ...(to && { lte: new Date(to) }) },
        }),
      },
      include: {
        student: { select: { id: true, studentNo: true, lastName: true, firstName: true, middleName: true, suffix: true } },
        account: { select: { accountCode: true, accountName: true } },
        assessment: { select: { assessmentNo: true } },
      },
      orderBy: { adjustmentDate: 'desc' },
    });

    const posted = items.filter((i) => i.status === 'POSTED');
    res.json({
      items: items.map((i) => ({ ...i, studentLabel: studentLabel(i.student) })),
      totals: {
        debits:  round2(posted.filter((i) => i.direction === 'DEBIT').reduce((s, i) => s + Number(i.amount), 0)),
        credits: round2(posted.filter((i) => i.direction === 'CREDIT').reduce((s, i) => s + Number(i.amount), 0)),
      },
    });
  } catch (err) { next(err); }
};

/**
 * Raise an adjustment. Created as a draft — posting is a separate, approved step.
 */
exports.createAdjustment = async (req, res, next) => {
  try {
    const { studentId, assessmentId, adjustmentDate, direction, category, accountId, amount, vatCode, reason } = req.body;

    const value = round2(amount);
    if (value <= 0) throw createError('Adjustment amount must be greater than zero', 400);

    const student = await prisma.student.findFirst({
      where: { id: Number(studentId), businessId: req.businessId },
    });
    if (!student) throw createError('Student not found', 404);

    const account = await prisma.account.findFirst({
      where: { id: Number(accountId), businessId: req.businessId },
    });
    if (!account) throw createError('Account not found in this business', 400);

    // A DEBIT adjustment raises what the student owes, so its other leg is a
    // credit to revenue. A CREDIT lowers it and debits revenue back out. Either
    // way the account being adjusted has to be one that carries revenue.
    if (!['REVENUE', 'EXPENSE'].includes(account.accountType)) {
      throw createError(
        `${account.accountCode} is a ${account.accountType} account. An adjustment must name the revenue ` +
        `account being corrected — the receivable side is posted for you.`, 400
      );
    }

    if (assessmentId) {
      const a = await prisma.assessment.findFirst({
        where: { id: Number(assessmentId), businessId: req.businessId, studentId: student.id },
      });
      if (!a) throw createError('Assessment not found for this student', 400);
    }

    const created = await prisma.billingAdjustment.create({
      data: {
        businessId:     req.businessId,
        adjustmentNo:   await nextNo(req.businessId, 'ADJ', 'billingAdjustment', 'adjustmentNo'),
        studentId:      student.id,
        assessmentId:   assessmentId ? Number(assessmentId) : null,
        adjustmentDate: adjustmentDate ? new Date(adjustmentDate) : new Date(),
        direction,
        category:       category || 'CORRECTION',
        accountId:      account.id,
        amount:         value,
        vatCode:        vatCode || 'EXEMPT',
        reason,
        createdBy:      req.user?.id || null,
      },
    });

    res.status(201).json(created);
  } catch (err) { next(err); }
};

/**
 * Post a draft adjustment: journal entry, then ledger row.
 *
 *   DEBIT   DR Accounts Receivable — Students / CR the named revenue account
 *   CREDIT  DR the named revenue account      / CR Accounts Receivable — Students
 */
exports.postAdjustment = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const adj = await prisma.billingAdjustment.findFirst({
      where: { id, businessId: req.businessId },
      include: { student: true, account: true },
    });
    if (!adj) throw createError('Adjustment not found', 404);
    if (adj.status !== 'DRAFT') {
      throw createError(`Adjustment ${adj.adjustmentNo} is already ${adj.status.toLowerCase()}`, 400);
    }

    await schoolInvoice.assertPostable(req.businessId, adj.adjustmentDate);

    const label = studentLabel(adj.student);
    const amount = round2(adj.amount);
    const isDebit = adj.direction === 'DEBIT';

    const entry = await glPost.post({
      entryDate:   adj.adjustmentDate,
      description: `${isDebit ? 'Billing Adjustment' : 'Credit Memo'} — ${label} (${adj.adjustmentNo})`,
      reference:   adj.adjustmentNo,
      notes:       adj.reason,
      lines: isDebit
        ? [
            { accountCode: schoolInvoice.AR_STUDENTS, debit: amount, description: `${adj.category} — ${label}` },
            { accountId:   adj.accountId,             credit: amount, description: adj.reason.slice(0, 200) },
          ]
        : [
            { accountId:   adj.accountId,             debit: amount, description: adj.reason.slice(0, 200) },
            { accountCode: schoolInvoice.AR_STUDENTS, credit: amount, description: `${adj.category} — ${label}` },
          ],
      userId: req.user?.id || 1,
      businessId: req.businessId,
    });

    if (!entry || entry.skipped) {
      throw createError('The adjustment could not be posted to the general ledger. Nothing was recorded.', 422);
    }

    await prisma.$transaction(async (tx) => {
      await tx.billingAdjustment.update({
        where: { id },
        data:  { status: 'POSTED', approvedBy: req.user?.id || null },
      });
      await studentLedger.append(tx, {
        businessId:   req.businessId,
        studentId:    adj.studentId,
        entryDate:    adj.adjustmentDate,
        type:         adj.category === 'CREDIT_MEMO' ? 'CREDIT_MEMO' : 'ADJUSTMENT',
        reference:    adj.adjustmentNo,
        description:  adj.reason.slice(0, 255),
        ...(isDebit ? { debit: amount } : { credit: amount }),
        assessmentId: adj.assessmentId,
        entryNo:      entry.entryNo,
        createdBy:    req.user?.id,
      });
    });

    await recordAudit({
      action: 'UPDATE', entity: 'BillingAdjustment', entityId: String(id),
      summary: `Posted ${adj.direction.toLowerCase()} adjustment ${adj.adjustmentNo} of ₱${amount.toLocaleString()} for ${label}`,
      user: req.user, businessId: req.businessId,
    });

    res.json({ adjustment: { ...adj, status: 'POSTED' }, entryNo: entry.entryNo });
  } catch (err) { next(err); }
};

/**
 * Void a posted adjustment by reversing it, never by deleting it.
 */
exports.voidAdjustment = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { reason } = req.body;
    const adj = await prisma.billingAdjustment.findFirst({
      where: { id, businessId: req.businessId },
      include: { student: true },
    });
    if (!adj) throw createError('Adjustment not found', 404);
    if (adj.status === 'VOIDED') throw createError('Already voided', 400);

    const label = studentLabel(adj.student);
    const amount = round2(adj.amount);
    const isDebit = adj.direction === 'DEBIT';

    if (adj.status === 'POSTED') {
      // Reverse the original rather than editing it — the audit trail has to
      // show both what was posted and what undid it.
      await glPost.safePost({
        entryDate:   new Date(),
        description: `Reversal of ${adj.adjustmentNo} — ${label}`,
        reference:   `${adj.adjustmentNo}-REV`,
        notes:       reason || null,
        lines: isDebit
          ? [
              { accountId:   adj.accountId,             debit: amount, description: 'Reversal' },
              { accountCode: schoolInvoice.AR_STUDENTS, credit: amount, description: `Reversal — ${label}` },
            ]
          : [
              { accountCode: schoolInvoice.AR_STUDENTS, debit: amount, description: `Reversal — ${label}` },
              { accountId:   adj.accountId,             credit: amount, description: 'Reversal' },
            ],
        userId: req.user?.id || 1,
        businessId: req.businessId,
      });

      await prisma.$transaction((tx) => studentLedger.append(tx, {
        businessId:  req.businessId,
        studentId:   adj.studentId,
        entryDate:   new Date(),
        type:        'REVERSAL',
        reference:   `${adj.adjustmentNo}-REV`,
        description: `Reversal of ${adj.adjustmentNo}${reason ? ` — ${reason}` : ''}`,
        ...(isDebit ? { credit: amount } : { debit: amount }),
        createdBy:   req.user?.id,
      }));
    }

    await prisma.billingAdjustment.update({ where: { id }, data: { status: 'VOIDED' } });
    res.json({ message: `Adjustment ${adj.adjustmentNo} voided` });
  } catch (err) { next(err); }
};

// ── Refunds ────────────────────────────────────────────────────────────────

exports.listRefunds = async (req, res, next) => {
  try {
    const { studentId, status } = req.query;
    const items = await prisma.refund.findMany({
      where: {
        businessId: req.businessId,
        ...(studentId && { studentId: Number(studentId) }),
        ...(status && { status }),
      },
      include: { student: { select: { id: true, studentNo: true, lastName: true, firstName: true, middleName: true, suffix: true } } },
      orderBy: { refundDate: 'desc' },
    });
    res.json({
      items: items.map((r) => ({ ...r, studentLabel: studentLabel(r.student) })),
      total: round2(items.filter((r) => r.status === 'PAID').reduce((s, r) => s + Number(r.amount), 0)),
    });
  } catch (err) { next(err); }
};

/**
 * Raise a refund against a student's unapplied advance.
 *
 * Capped at what the school is actually holding unearned. Refunding beyond
 * that would be handing back money that is already settling a real receivable.
 */
exports.createRefund = async (req, res, next) => {
  try {
    const { studentId, refundDate, amount, method, reference, reason } = req.body;
    const value = round2(amount);
    if (value <= 0) throw createError('Refund amount must be greater than zero', 400);

    const student = await prisma.student.findFirst({
      where: { id: Number(studentId), businessId: req.businessId },
    });
    if (!student) throw createError('Student not found', 404);

    const advances = await prisma.studentAdvance.findMany({
      where: { studentId: student.id, businessId: req.businessId },
    });
    const available = round2(advances.reduce((s, a) => s + (Number(a.amount) - Number(a.appliedAmount)), 0));

    const pending = await prisma.refund.aggregate({
      where: { studentId: student.id, businessId: req.businessId, status: { in: ['DRAFT', 'APPROVED'] } },
      _sum: { amount: true },
    });
    const alreadyClaimed = round2(Number(pending._sum.amount || 0));
    const refundable = round2(available - alreadyClaimed);

    if (value > refundable) {
      throw createError(
        `Only ₱${refundable.toLocaleString()} can be refunded — that is the unapplied advance ` +
        `the school is holding for ${studentLabel(student)}` +
        (alreadyClaimed > 0 ? `, after ₱${alreadyClaimed.toLocaleString()} already claimed on open refunds` : '') +
        `. Anything more is already settling invoices.`, 400
      );
    }

    const created = await prisma.refund.create({
      data: {
        businessId: req.businessId,
        refundNo:   await nextNo(req.businessId, 'RF', 'refund', 'refundNo'),
        studentId:  student.id,
        refundDate: refundDate ? new Date(refundDate) : new Date(),
        amount:     value,
        method:     method || 'Cash',
        reference:  reference || null,
        reason,
        createdBy:  req.user?.id || null,
      },
    });

    res.status(201).json({ ...created, refundable });
  } catch (err) { next(err); }
};

/**
 * Pay an approved refund.
 *
 *   DR Advance Payments from Students
 *     CR Cash / Bank
 *
 * The liability the school was carrying is discharged; no revenue is touched,
 * because none was ever recognised on this money.
 */
exports.payRefund = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const refund = await prisma.refund.findFirst({
      where: { id, businessId: req.businessId },
      include: { student: true },
    });
    if (!refund) throw createError('Refund not found', 404);
    if (refund.status === 'PAID')   throw createError('This refund has already been paid', 400);
    if (refund.status === 'VOIDED') throw createError('This refund was voided', 400);

    await schoolInvoice.assertPostable(req.businessId, refund.refundDate);

    const label = studentLabel(refund.student);
    const amount = round2(refund.amount);
    const cashAccount = refund.method === 'Cash' ? '1010' : '1020';

    const entry = await glPost.post({
      entryDate:   refund.refundDate,
      description: `Student Refund — ${label} (${refund.refundNo})`,
      reference:   refund.refundNo,
      notes:       refund.reason,
      lines: [
        { accountCode: schoolInvoice.ADVANCES, debit:  amount, description: `Refund to ${label}` },
        { accountCode: cashAccount,            credit: amount, description: `Refund paid — ${refund.method}` },
      ],
      userId: req.user?.id || 1,
      businessId: req.businessId,
    });
    if (!entry || entry.skipped) {
      throw createError('The refund could not be posted to the general ledger. Nothing was recorded.', 422);
    }

    await prisma.$transaction(async (tx) => {
      // Draw the refund down across the student's advances, oldest first, so
      // the advance rows and the liability account stay in step.
      let toDraw = amount;
      const advances = await tx.studentAdvance.findMany({
        where: { studentId: refund.studentId, businessId: req.businessId },
        orderBy: { paymentDate: 'asc' },
      });
      for (const a of advances) {
        if (toDraw <= 0.009) break;
        const open = round2(Number(a.amount) - Number(a.appliedAmount));
        if (open <= 0.009) continue;
        const take = round2(Math.min(open, toDraw));
        await tx.studentAdvance.update({
          where: { id: a.id },
          data:  { appliedAmount: round2(Number(a.appliedAmount) + take) },
        });
        toDraw = round2(toDraw - take);
      }

      await tx.refund.update({
        where: { id },
        data:  { status: 'PAID', approvedBy: req.user?.id || null },
      });

      // A refund removes a credit the student was holding, so it debits the
      // statement — the balance goes back up by what was handed back.
      await studentLedger.append(tx, {
        businessId:  req.businessId,
        studentId:   refund.studentId,
        entryDate:   refund.refundDate,
        type:        'REFUND',
        reference:   refund.refundNo,
        description: `Refund — ${refund.reason}`.slice(0, 255),
        debit:       amount,
        entryNo:     entry.entryNo,
        createdBy:   req.user?.id,
      });
    });

    await recordAudit({
      action: 'UPDATE', entity: 'Refund', entityId: String(id),
      summary: `Paid refund ${refund.refundNo} of ₱${amount.toLocaleString()} to ${label}`,
      user: req.user, businessId: req.businessId,
    });

    res.json({ message: `Refund ${refund.refundNo} paid`, entryNo: entry.entryNo });
  } catch (err) { next(err); }
};

// ── Gateway settlement ─────────────────────────────────────────────────────

/** What is still sitting in the clearing account, waiting for a payout. */
async function clearingBalance(businessId) {
  const account = await prisma.account.findFirst({
    where: { businessId, accountCode: CLEARING },
  });
  if (!account) return { account: null, balance: 0 };

  const lines = await prisma.journalLine.findMany({
    where: { accountId: account.id, entry: { businessId, status: 'POSTED' } },
    select: { debit: true, credit: true },
  });
  return {
    account,
    balance: round2(lines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0)),
  };
}

exports.getClearing = async (req, res, next) => {
  try {
    const { account, balance } = await clearingBalance(req.businessId);
    if (!account) {
      return res.json({
        available: false,
        balance: 0,
        message: `Account ${CLEARING} Online Payment Clearing is not in this chart of accounts. ` +
                 `Run: node prisma/seedSchool.js --business=${req.businessId}`,
      });
    }

    const settlements = await prisma.paymentSettlement.findMany({
      where: { businessId: req.businessId },
      include: { bankAccount: { select: { accountCode: true, accountName: true } } },
      orderBy: { settlementDate: 'desc' },
      take: 50,
    });

    res.json({
      available: true,
      balance,
      account: { code: account.accountCode, name: account.accountName },
      settlements,
      totals: {
        settled: round2(settlements.reduce((s, x) => s + Number(x.grossAmount), 0)),
        fees:    round2(settlements.reduce((s, x) => s + Number(x.feeAmount), 0)),
      },
    });
  } catch (err) { next(err); }
};

/**
 * Record a gateway payout.
 *
 *   DR Cash in Bank                 the net amount that actually arrived
 *   DR Bank Charges & Service Fees  the gateway's cut
 *     CR Online Payment Clearing    the gross that was collected
 *
 * Capped at the live clearing balance: the ledger is the record of what is
 * still owed by the gateway, so settling more than that would mean recording a
 * payout for money nobody collected.
 */
exports.recordSettlement = async (req, res, next) => {
  try {
    const { settlementDate, method, grossAmount, feeAmount, bankAccountId, reference, notes } = req.body;

    const gross = round2(grossAmount);
    const fee   = round2(feeAmount || 0);
    const net   = round2(gross - fee);

    if (gross <= 0) throw createError('Settlement amount must be greater than zero', 400);
    if (fee < 0)    throw createError('The gateway fee cannot be negative', 400);
    if (net < 0)    throw createError('The fee cannot exceed the amount settled', 400);

    const { account, balance } = await clearingBalance(req.businessId);
    if (!account) {
      throw createError(
        `Account ${CLEARING} Online Payment Clearing is not set up for this business. ` +
        `Run: node prisma/seedSchool.js --business=${req.businessId}`, 400
      );
    }
    if (gross > round2(balance + 0.01)) {
      throw createError(
        `Only ₱${balance.toLocaleString()} is sitting in Online Payment Clearing. ` +
        `Settling ₱${gross.toLocaleString()} would record a payout for money that was never collected.`, 400
      );
    }

    const bank = await prisma.account.findFirst({
      where: { id: Number(bankAccountId), businessId: req.businessId },
    });
    if (!bank) throw createError('Bank account not found in this business', 400);
    if (bank.accountType !== 'ASSET') {
      throw createError(`${bank.accountCode} is a ${bank.accountType} account — a payout lands in an asset`, 400);
    }

    const date = settlementDate ? new Date(settlementDate) : new Date();
    await schoolInvoice.assertPostable(req.businessId, date);

    const settlementNo = await nextNo(req.businessId, 'STL', 'paymentSettlement', 'settlementNo');

    const entry = await glPost.post({
      entryDate:   date,
      description: `${method} Settlement — ${settlementNo}`,
      reference:   settlementNo,
      notes:       notes || null,
      lines: [
        { accountId: bank.id, debit: net, description: `${method} payout received` },
        ...(fee > 0 ? [{ accountCode: GATEWAY_FEE, debit: fee, description: `${method} gateway fee` }] : []),
        { accountCode: CLEARING, credit: gross, description: `Clear ${method} collections` },
      ],
      userId: req.user?.id || 1,
      businessId: req.businessId,
    });
    if (!entry || entry.skipped) {
      throw createError('The settlement could not be posted to the general ledger. Nothing was recorded.', 422);
    }

    const created = await prisma.paymentSettlement.create({
      data: {
        businessId:     req.businessId,
        settlementNo,
        settlementDate: date,
        method,
        grossAmount:    gross,
        feeAmount:      fee,
        netAmount:      net,
        bankAccountId:  bank.id,
        reference:      reference || null,
        notes:          notes || null,
        createdBy:      req.user?.id || null,
      },
    });

    await recordAudit({
      action: 'CREATE', entity: 'PaymentSettlement', entityId: String(created.id),
      summary: `Settled ₱${gross.toLocaleString()} of ${method} collections to ${bank.accountCode}` +
               (fee > 0 ? ` (₱${fee.toLocaleString()} fee)` : ''),
      user: req.user, businessId: req.businessId,
    });

    res.status(201).json({
      settlement: created,
      entryNo: entry.entryNo,
      remainingClearing: round2(balance - gross),
      message: `Settled ₱${gross.toLocaleString()}; ₱${net.toLocaleString()} reached ${bank.accountName}.`,
    });
  } catch (err) { next(err); }
};

// ── Student ledger ─────────────────────────────────────────────────────────

exports.getStudentLedger = async (req, res, next) => {
  try {
    const studentId = Number(req.params.studentId);
    const student = await prisma.student.findFirst({
      where: { id: studentId, businessId: req.businessId },
    });
    if (!student) throw createError('Student not found', 404);

    const { from, to, type } = req.query;
    const { rows, totals } = await studentLedger.read(req.businessId, studentId, { from, to, type });

    res.json({
      student: { id: student.id, studentNo: student.studentNo, label: studentLabel(student) },
      rows, totals,
    });
  } catch (err) { next(err); }
};

/**
 * Recompute one student's running balances.
 *
 * The repair tool for after a backdated row. Deliberately manual — a ledger
 * that silently reflows is one nobody can reconcile against a statement that
 * was already printed and handed to a parent.
 */
exports.rebuildStudentLedger = async (req, res, next) => {
  try {
    const studentId = Number(req.params.studentId);
    const student = await prisma.student.findFirst({
      where: { id: studentId, businessId: req.businessId },
    });
    if (!student) throw createError('Student not found', 404);

    const result = await studentLedger.rebuild(studentId);
    await recordAudit({
      action: 'UPDATE', entity: 'StudentLedger', entityId: String(studentId),
      summary: `Rebuilt ledger for ${studentLabel(student)} — ${result.rows} rows, closing ₱${result.closingBalance.toLocaleString()}`,
      user: req.user, businessId: req.businessId,
    });
    res.json({ ...result, message: `Recomputed ${result.rows} rows.` });
  } catch (err) { next(err); }
};
