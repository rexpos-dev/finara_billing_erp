/**
 * schoolBillingController.js — The monthly billing run, the cashier window,
 * and subsidy collection.
 *
 * Two jobs with very different rhythms:
 *
 *   The billing run happens once a month and touches hundreds of students. It
 *   previews before it commits, is idempotent, and reports what it could not
 *   do rather than failing the whole batch.
 *
 *   The cashier window happens hundreds of times a day and touches one student.
 *   It allocates oldest-first across open invoices, posts as it goes, and parks
 *   any overpayment in a liability rather than recognising it as revenue.
 */

const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const glPost = require('../utils/glPost');
const logger = require('../utils/logger');
const { nextDocNumber } = require('../utils/docNumber');
const { recordAudit } = require('../utils/audit');
const { allocateInstallment, round2, toDate } = require('../utils/assessmentCalc');
const schoolInvoice = require('../utils/schoolInvoice');
const studentLedger = require('../utils/studentLedger');

const studentLabel = (s) =>
  `${[s.lastName + ',', s.firstName, s.middleName, s.suffix].filter(Boolean).join(' ')} (${s.studentNo})`;

// Payment method → the GL account the money actually lands in.
//
// Cash and a bank transfer are in hand the moment the cashier records them.
// A gateway payment is not: GCash, Maya and card payouts arrive days later and
// net of a fee, so they debit a clearing account and only reach the bank when
// the payout is recorded — see recordSettlement. Debiting the bank at the
// window would overstate it for the gap and leave bank reconciliation with
// nothing to match against.
const PAYMENT_ACCOUNT = {
  'Cash':          '1010',
  'Bank Transfer': '1020',
  'Check':         '1020',
  'GCash':         '1030',
  'Maya':          '1030',
  'Credit Card':   '1030',
  'Online':        '1030',
};

/** Methods whose money sits in clearing until the gateway pays out. */
const CLEARING_METHODS = new Set(['GCash', 'Maya', 'Credit Card', 'Online']);

async function nextReceiptNo(businessId) {
  const prefix = `OR-${businessId}-`;
  const last = await prisma.studentAdvance.findFirst({
    where:   { receiptNo: { startsWith: prefix } },
    orderBy: { receiptNo: 'desc' },
    select:  { receiptNo: true },
  });
  return nextDocNumber(prefix, last?.receiptNo, 6);
}

// ── Billing run ────────────────────────────────────────────────────────────

/**
 * Find every installment due on or before a cut-off that has not been billed.
 *
 * Shared by the preview and the commit so the two can never disagree about
 * what is in scope.
 */
async function findDueInstallments(businessId, { upTo, schoolYearId, gradeLevelId }) {
  return prisma.installment.findMany({
    where: {
      status:    'SCHEDULED',
      invoiceId: null,
      dueDate:   { lte: toDate(upTo) },
      seq:       { gt: 0 }, // seq 0 is billed when the assessment is issued
      assessment: {
        businessId,
        status: { in: ['POSTED', 'PARTIALLY_PAID'] },
        enrollment: {
          status: { in: ['ASSESSED', 'PARTIALLY_PAID', 'ENROLLED'] },
          ...(schoolYearId && { schoolYearId: Number(schoolYearId) }),
          ...(gradeLevelId && { gradeLevelId: Number(gradeLevelId) }),
        },
      },
    },
    orderBy: [{ dueDate: 'asc' }, { assessmentId: 'asc' }],
    include: {
      assessment: {
        include: {
          student: true,
          lines: { orderBy: { sortOrder: 'asc' } },
          enrollment: { include: { gradeLevel: { select: { code: true, name: true } } } },
        },
      },
    },
  });
}

exports.previewBillingRun = async (req, res, next) => {
  try {
    const { upTo, schoolYearId, gradeLevelId } = req.query;
    if (!upTo) throw createError('A cut-off date (upTo) is required', 400);

    const due = await findDueInstallments(req.businessId, { upTo, schoolYearId, gradeLevelId });

    // Anything dated before the books start would post no GL entry, so it is
    // surfaced as blocked rather than quietly billed into a void.
    const biz = await prisma.business.findUnique({
      where: { id: req.businessId }, select: { booksStartDate: true },
    });
    const cutover = glPost.dateKey(biz?.booksStartDate);

    const rows = due.map((i) => {
      const entry = glPost.dateKey(i.dueDate);
      return {
        installmentId: i.id,
        studentId:     i.assessment.student.id,
        student:       studentLabel(i.assessment.student),
        gradeLevel:    i.assessment.enrollment.gradeLevel.name,
        assessmentNo:  i.assessment.assessmentNo,
        label:         i.label,
        dueDate:       i.dueDate,
        amount:        Number(i.amount),
        blocked:       !!(cutover && entry && entry < cutover),
      };
    });

    const billable = rows.filter((r) => !r.blocked);
    const blocked  = rows.filter((r) => r.blocked);

    res.json({
      upTo,
      cutover,
      billable,
      blocked,
      totals: {
        count:         billable.length,
        amount:        round2(billable.reduce((s, r) => s + r.amount, 0)),
        blockedCount:  blocked.length,
        blockedAmount: round2(blocked.reduce((s, r) => s + r.amount, 0)),
      },
      ...(blocked.length && {
        warning:
          `${blocked.length} installment${blocked.length === 1 ? '' : 's'} fall before the books start ` +
          `date (${cutover}) and would post nothing to the general ledger. They are excluded from this run.`,
      }),
    });
  } catch (err) { next(err); }
};

/**
 * Commit the run.
 *
 * Each installment is billed on its own — one student's bad data must not
 * abandon the other 499. Failures are collected and returned so the accountant
 * can see exactly what needs attention, and re-running is safe because an
 * installment with an invoice is no longer SCHEDULED.
 */
exports.runBilling = async (req, res, next) => {
  try {
    const { upTo, schoolYearId, gradeLevelId } = req.body;
    if (!upTo) throw createError('A cut-off date (upTo) is required', 400);

    const all = await findDueInstallments(req.businessId, { upTo, schoolYearId, gradeLevelId });
    if (all.length === 0) {
      return res.json({ billed: 0, failed: 0, blocked: 0, totalAmount: 0, failures: [], blockedRows: [], message: 'Nothing due to bill.' });
    }

    // Split off anything dated before the books start, exactly as the preview
    // does. These are not failures — they are a configuration mismatch the
    // accountant has to resolve — and lumping them in with real errors would
    // bury the ones that actually need investigating.
    const biz = await prisma.business.findUnique({
      where: { id: req.businessId }, select: { booksStartDate: true },
    });
    const cutover = glPost.dateKey(biz?.booksStartDate);
    const isBlocked = (inst) => {
      const entry = glPost.dateKey(inst.dueDate);
      return !!(cutover && entry && entry < cutover);
    };

    const blockedRows = all.filter(isBlocked).map((i) => ({
      installmentId: i.id,
      student:       studentLabel(i.assessment.student),
      assessmentNo:  i.assessment.assessmentNo,
      label:         i.label,
      dueDate:       i.dueDate,
      amount:        Number(i.amount),
    }));
    const due = all.filter((i) => !isBlocked(i));

    const failures = [];
    let billed = 0, totalAmount = 0;

    for (const inst of due) {
      const a = inst.assessment;
      const label = studentLabel(a.student);
      try {
        const lines = allocateInstallment({
          installmentAmount: Number(inst.amount),
          lines: a.lines.map((l) => ({
            feeTypeId: l.feeTypeId, accountId: l.accountId, description: l.description,
            vatCode: l.vatCode, amount: Number(l.amount), billingBasis: l.billingBasis,
          })),
        });
        if (lines.length === 0) {
          throw new Error('No annual fee lines to allocate this installment against');
        }

        await schoolInvoice.billInstallment({
          installment: inst,
          lines,
          student: { id: a.student.id, customerId: a.student.customerId, label },
          businessId: req.businessId,
          userId: req.user?.id,
        });

        billed++;
        totalAmount = round2(totalAmount + Number(inst.amount));
      } catch (err) {
        logger.error(`[SCHOOL BILLING] ${a.assessmentNo} ${inst.label} — ${err.message}`);
        failures.push({
          installmentId: inst.id,
          student: label,
          assessmentNo: a.assessmentNo,
          label: inst.label,
          dueDate: inst.dueDate,
          amount: Number(inst.amount),
          error: err.message,
        });
      }
    }

    await recordAudit({
      action: 'CREATE', entity: 'Invoice', entityId: 'billing-run',
      summary: `Billing run to ${upTo}: ${billed} invoice${billed === 1 ? '' : 's'} ` +
               `totalling ₱${totalAmount.toLocaleString()}` +
               (failures.length ? `, ${failures.length} failed` : '') +
               (blockedRows.length ? `, ${blockedRows.length} blocked by the books start date` : ''),
      user: req.user, businessId: req.businessId,
    });

    res.json({
      billed,
      failed: failures.length,
      blocked: blockedRows.length,
      totalAmount, failures, blockedRows,
      ...(blockedRows.length && { cutover }),
      message: `Billed ${billed} installment${billed === 1 ? '' : 's'} for ₱${totalAmount.toLocaleString()}` +
               (failures.length ? `. ${failures.length} could not be billed — see the list.` : '.') +
               (blockedRows.length
                 ? ` ${blockedRows.length} fall before the books start date (${cutover}) and were skipped.`
                 : ''),
    });
  } catch (err) { next(err); }
};

// ── Cashier ────────────────────────────────────────────────────────────────

/**
 * What a student currently owes, oldest first — the cashier's working view.
 */
exports.getPayableItems = async (req, res, next) => {
  try {
    const studentId = Number(req.params.studentId);
    const student = await prisma.student.findFirst({
      where: { id: studentId, businessId: req.businessId },
    });
    if (!student) throw createError('Student not found', 404);

    const invoices = await prisma.invoice.findMany({
      where: {
        businessId: req.businessId,
        customerId: student.customerId,
        status: { in: ['OPEN', 'PARTIAL', 'OVERDUE'] },
      },
      orderBy: { dueDate: 'asc' },
      include: { installment: { select: { id: true, seq: true, label: true, assessmentId: true } } },
    });

    const today = new Date();
    const items = invoices
      .map((i) => ({
        invoiceId:   i.id,
        invoiceNo:   i.invoiceNo,
        description: i.description,
        dueDate:     i.dueDate,
        totalAmount: Number(i.totalAmount),
        paidAmount:  Number(i.paidAmount),
        balance:     round2(Number(i.totalAmount) - Number(i.paidAmount)),
        daysOverdue: Math.max(0, Math.floor((today - new Date(i.dueDate)) / 86400000)),
        installment: i.installment,
      }))
      .filter((i) => i.balance > 0.01);

    const advances = await prisma.studentAdvance.findMany({
      where: { studentId, businessId: req.businessId },
    });
    const credit = round2(advances.reduce((s, a) => s + (Number(a.amount) - Number(a.appliedAmount)), 0));

    res.json({
      student: { id: student.id, studentNo: student.studentNo, label: studentLabel(student) },
      items,
      totalDue: round2(items.reduce((s, i) => s + i.balance, 0)),
      overdue:  round2(items.filter((i) => i.daysOverdue > 0).reduce((s, i) => s + i.balance, 0)),
      unappliedCredit: credit,
    });
  } catch (err) { next(err); }
};

/**
 * Accept a payment.
 *
 * Allocation is oldest-due-first unless the cashier names specific invoices.
 * Anything left over becomes an advance (liability 2215) rather than revenue —
 * the school has the cash but has not yet earned it.
 */
exports.recordCollection = async (req, res, next) => {
  try {
    const {
      studentId, amount, paymentDate, paymentMethod = 'Cash',
      reference, notes, invoiceIds,
    } = req.body;

    const payAmount = round2(amount);
    if (payAmount <= 0) throw createError('Payment amount must be greater than zero', 400);

    const student = await prisma.student.findFirst({
      where: { id: Number(studentId), businessId: req.businessId },
    });
    if (!student) throw createError('Student not found', 404);

    const label = studentLabel(student);
    const payDate = paymentDate ? new Date(paymentDate) : new Date();
    await schoolInvoice.assertPostable(req.businessId, payDate);

    const invoices = await prisma.invoice.findMany({
      where: {
        businessId: req.businessId,
        customerId: student.customerId,
        status: { in: ['OPEN', 'PARTIAL', 'OVERDUE'] },
        ...(Array.isArray(invoiceIds) && invoiceIds.length && { id: { in: invoiceIds.map(Number) } }),
      },
      orderBy: { dueDate: 'asc' },
      include: { installment: true },
    });

    let remaining = payAmount;
    const applied = [];

    // One payment, one transaction — settling several invoices used to open a
    // separate transaction per invoice, so a failure partway through left the
    // earlier invoices already marked paid with no way back, and a retry
    // could double-apply. nextPaymentNo reads through `tx` too, so each
    // invoice still sees the paymentNo the one before it just wrote, even
    // though none of it is visible outside this transaction until it commits.
    await prisma.$transaction(async (tx) => {
      for (const inv of invoices) {
        if (remaining <= 0.009) break;
        const balance = round2(Number(inv.totalAmount) - Number(inv.paidAmount));
        if (balance <= 0.009) continue;

        const take = round2(Math.min(balance, remaining));
        const newPaid = round2(Number(inv.paidAmount) + take);
        const status = round2(Number(inv.totalAmount) - newPaid) <= 0.01 ? 'PAID' : 'PARTIAL';
        const paymentNo = await nextPaymentNo(req.businessId, tx);

        await tx.paymentAR.create({
          data: {
            paymentNo, invoiceId: inv.id, paymentDate: payDate,
            amount: take, paymentMethod, reference: reference || null, notes: notes || null,
          },
        });
        await tx.invoice.update({ where: { id: inv.id }, data: { paidAmount: newPaid, status } });

        if (inv.installment) {
          const instPaid = round2(Number(inv.installment.paidAmount) + take);
          await tx.installment.update({
            where: { id: inv.installment.id },
            data: {
              paidAmount: instPaid,
              status: round2(Number(inv.installment.amount) - instPaid) <= 0.01 ? 'PAID' : 'PARTIAL',
            },
          });
          await tx.assessment.update({
            where: { id: inv.installment.assessmentId },
            data:  { paidAmount: { increment: take } },
          });
        }

        applied.push({ invoiceNo: inv.invoiceNo, paymentNo, amount: take, invoiceStatus: status });
        remaining = round2(remaining - take);
      }
    });

    // ── Ledger ──────────────────────────────────────────────────────────────
    const appliedTotalForLedger = round2(payAmount - remaining);
    if (appliedTotalForLedger > 0) {
      await prisma.$transaction((tx) => studentLedger.append(tx, {
        businessId:  req.businessId,
        studentId:   student.id,
        entryDate:   payDate,
        type:        'PAYMENT',
        reference:   applied[0]?.paymentNo || reference || null,
        description: `Payment received — ${paymentMethod}`,
        credit:      appliedTotalForLedger,
        createdBy:   req.user?.id,
      }));
    }

    const cashAccount = PAYMENT_ACCOUNT[paymentMethod] || '1010';
    const appliedTotal = round2(payAmount - remaining);

    // Applied portion: cash in, receivable cleared.
    if (appliedTotal > 0) {
      await glPost.safePost({
        entryDate:   payDate,
        description: `Student Collection — ${label}`,
        reference:   applied[0]?.paymentNo || `COL-${student.studentNo}`,
        lines: [
          { accountCode: cashAccount, debit: appliedTotal, description: `Cash in — ${paymentMethod}` },
          { accountCode: schoolInvoice.AR_STUDENTS, credit: appliedTotal, description: `Clear AR — ${label}` },
        ],
        userId: req.user?.id || 1,
        businessId: req.businessId,
      });
    }

    // Overpayment: held as a liability until there is an invoice to apply it to.
    let advance = null;
    if (remaining > 0.009) {
      const receiptNo = await nextReceiptNo(req.businessId);
      advance = await prisma.studentAdvance.create({
        data: {
          businessId: req.businessId, studentId: student.id, receiptNo,
          paymentDate: payDate, amount: remaining, paymentMethod,
          reference: reference || null, notes: notes || null,
          createdBy: req.user?.id || null,
        },
      });
      await glPost.safePost({
        entryDate:   payDate,
        description: `Student Advance Payment — ${label}`,
        reference:   receiptNo,
        lines: [
          { accountCode: cashAccount, debit: remaining, description: `Cash in — ${paymentMethod}` },
          { accountCode: schoolInvoice.ADVANCES, credit: remaining, description: `Advance from ${label}` },
        ],
        userId: req.user?.id || 1,
        businessId: req.businessId,
      });

      // An advance is cash held, not a charge settled, so it sits on the
      // statement as a credit that has not yet been applied to anything.
      await prisma.$transaction((tx) => studentLedger.append(tx, {
        businessId:  req.businessId,
        studentId:   student.id,
        entryDate:   payDate,
        type:        'ADVANCE',
        reference:   receiptNo,
        description: `Advance payment — ${paymentMethod}`,
        credit:      remaining,
        createdBy:   req.user?.id,
      }));
    }

    // ── Status flow ─────────────────────────────────────────────────────────
    // Money arriving is what moves an enrollment from ASSESSED to ENROLLED.
    // The threshold is the enrolment installment: once that is settled the
    // student has done what the school asked to hold their seat.
    await advanceEnrollmentStatus(req.businessId, student.id);

    await recordAudit({
      action: 'CREATE', entity: 'PaymentAR', entityId: applied[0]?.paymentNo || 'advance',
      summary: `Collected ₱${payAmount.toLocaleString()} from ${label} via ${paymentMethod}` +
               (advance ? ` (₱${remaining.toLocaleString()} held as advance)` : ''),
      user: req.user, businessId: req.businessId,
    });

    res.json({
      collected: payAmount,
      appliedTotal,
      applied,
      advance,
      message: `Collected ₱${payAmount.toLocaleString()}` +
               (advance ? `. ₱${remaining.toLocaleString()} held as an advance payment.` : '.'),
    });
  } catch (err) { next(err); }
};

/**
 * Move an enrollment and its assessment along the status flow after money moves.
 *
 *   ASSESSED → PARTIALLY_PAID → ENROLLED   (enrollment)
 *   POSTED   → PARTIALLY_PAID → PAID       (assessment)
 *
 * The enrolment installment (seq 0) is the gate: a school holds the seat once
 * that is settled, whatever remains on the yearly schedule. Where a plan has no
 * enrolment payment, the first settled installment does the same job.
 */
async function advanceEnrollmentStatus(businessId, studentId) {
  const assessment = await prisma.assessment.findFirst({
    where: {
      businessId, studentId,
      status: { in: ['POSTED', 'PARTIALLY_PAID'] },
    },
    orderBy: { assessmentDate: 'desc' },
    include: { installments: { orderBy: { seq: 'asc' } } },
  });
  if (!assessment) return;

  const total = round2(assessment.installments.reduce((s, i) => s + Number(i.amount), 0));
  const paid  = round2(assessment.installments.reduce((s, i) => s + Number(i.paidAmount), 0));
  if (paid <= 0) return;

  const assessmentStatus = paid >= round2(total - 0.01) ? 'PAID' : 'PARTIALLY_PAID';

  const gate = assessment.installments.find((i) => i.seq === 0) || assessment.installments[0];
  const seatHeld = gate && round2(Number(gate.paidAmount)) >= round2(Number(gate.amount) - 0.01);

  await prisma.$transaction([
    prisma.assessment.update({ where: { id: assessment.id }, data: { status: assessmentStatus } }),
    prisma.enrollment.update({
      where: { id: assessment.enrollmentId },
      data:  { status: seatHeld ? 'ENROLLED' : 'PARTIALLY_PAID' },
    }),
    prisma.student.update({ where: { id: studentId }, data: { status: seatHeld ? 'ENROLLED' : 'ADMITTED' } }),
  ]);
}

async function nextPaymentNo(businessId, client = prisma) {
  const prefix = `SPR-${businessId}-`;
  const last = await client.paymentAR.findFirst({
    where:   { paymentNo: { startsWith: prefix } },
    orderBy: { paymentNo: 'desc' },
    select:  { paymentNo: true },
  });
  return nextDocNumber(prefix, last?.paymentNo, 6);
}

/**
 * Apply a student's unapplied advance against their open invoices.
 *
 * Called after a billing run so a full-year cash payer's invoices settle
 * themselves instead of showing as outstanding.
 *
 * No cash moves here — this only reclassifies the liability into the
 * receivable it was always meant to settle.
 */
exports.applyAdvances = async (req, res, next) => {
  try {
    const studentId = Number(req.params.studentId);
    const student = await prisma.student.findFirst({
      where: { id: studentId, businessId: req.businessId },
    });
    if (!student) throw createError('Student not found', 404);
    const label = studentLabel(student);

    const advances = await prisma.studentAdvance.findMany({
      where: { studentId, businessId: req.businessId },
      orderBy: { paymentDate: 'asc' },
    });
    let credit = round2(advances.reduce((s, a) => s + (Number(a.amount) - Number(a.appliedAmount)), 0));
    if (credit <= 0.009) {
      return res.json({ applied: 0, message: 'This student has no unapplied advance payments.' });
    }

    const invoices = await prisma.invoice.findMany({
      where: {
        businessId: req.businessId, customerId: student.customerId,
        status: { in: ['OPEN', 'PARTIAL', 'OVERDUE'] },
      },
      orderBy: { dueDate: 'asc' },
      include: { installment: true },
    });

    let appliedTotal = 0;
    const touched = [];

    // One atomic transaction across every invoice this advance touches — same
    // reasoning as recordCollection: separate per-invoice transactions leave
    // earlier invoices settled with no way back if a later one fails.
    await prisma.$transaction(async (tx) => {
      for (const inv of invoices) {
        if (credit <= 0.009) break;
        const balance = round2(Number(inv.totalAmount) - Number(inv.paidAmount));
        if (balance <= 0.009) continue;

        const take = round2(Math.min(balance, credit));
        const newPaid = round2(Number(inv.paidAmount) + take);
        const status = round2(Number(inv.totalAmount) - newPaid) <= 0.01 ? 'PAID' : 'PARTIAL';
        const paymentNo = await nextPaymentNo(req.businessId, tx);

        await tx.paymentAR.create({
          data: {
            paymentNo, invoiceId: inv.id, paymentDate: new Date(),
            amount: take, paymentMethod: 'Advance Payment',
            reference: 'Applied from student advance',
          },
        });
        await tx.invoice.update({ where: { id: inv.id }, data: { paidAmount: newPaid, status } });
        if (inv.installment) {
          const instPaid = round2(Number(inv.installment.paidAmount) + take);
          await tx.installment.update({
            where: { id: inv.installment.id },
            data: {
              paidAmount: instPaid,
              status: round2(Number(inv.installment.amount) - instPaid) <= 0.01 ? 'PAID' : 'PARTIAL',
            },
          });
          await tx.assessment.update({
            where: { id: inv.installment.assessmentId },
            data:  { paidAmount: { increment: take } },
          });
        }

        touched.push({ invoiceNo: inv.invoiceNo, amount: take });
        appliedTotal = round2(appliedTotal + take);
        credit = round2(credit - take);
      }
    });

    // Draw the applied amount down across the advances, oldest first.
    let toDraw = appliedTotal;
    for (const a of advances) {
      if (toDraw <= 0.009) break;
      const open = round2(Number(a.amount) - Number(a.appliedAmount));
      if (open <= 0.009) continue;
      const take = round2(Math.min(open, toDraw));
      await prisma.studentAdvance.update({
        where: { id: a.id },
        data:  { appliedAmount: round2(Number(a.appliedAmount) + take) },
      });
      toDraw = round2(toDraw - take);
    }

    if (appliedTotal > 0) {
      await glPost.safePost({
        entryDate:   new Date(),
        description: `Apply Student Advance — ${label}`,
        reference:   `ADV-APPLY-${student.studentNo}`,
        lines: [
          { accountCode: schoolInvoice.ADVANCES,    debit:  appliedTotal, description: `Advance applied — ${label}` },
          { accountCode: schoolInvoice.AR_STUDENTS, credit: appliedTotal, description: `Clear AR — ${label}` },
        ],
        userId: req.user?.id || 1,
        businessId: req.businessId,
      });

      // Economically the same event as a cash collection settling an invoice —
      // the AR clears either way — so it belongs on the statement the same way.
      await prisma.$transaction((tx) => studentLedger.append(tx, {
        businessId:  req.businessId,
        studentId:   student.id,
        entryDate:   new Date(),
        type:        'ADVANCE_APPLIED',
        reference:   `ADV-APPLY-${student.studentNo}`,
        description: `Advance applied to ${touched.length} invoice${touched.length === 1 ? '' : 's'}`,
        credit:      appliedTotal,
        createdBy:   req.user?.id,
      }));
    }

    res.json({
      applied: appliedTotal,
      invoices: touched,
      remainingCredit: credit,
      message: appliedTotal > 0
        ? `Applied ₱${appliedTotal.toLocaleString()} across ${touched.length} invoice${touched.length === 1 ? '' : 's'}.`
        : 'Nothing to apply — this student has no open invoices.',
    });
  } catch (err) { next(err); }
};

// ── Subsidies ──────────────────────────────────────────────────────────────

exports.listSubsidies = async (req, res, next) => {
  try {
    const { status, schoolYearId, type } = req.query;
    const subsidies = await prisma.studentSubsidy.findMany({
      where: {
        ...(status && { status }),
        ...(type && { type }),
        enrollment: {
          businessId: req.businessId,
          ...(schoolYearId && { schoolYearId: Number(schoolYearId) }),
        },
      },
      include: {
        enrollment: {
          include: {
            student:    { select: { id: true, studentNo: true, lastName: true, firstName: true, middleName: true, suffix: true } },
            gradeLevel: { select: { code: true, name: true } },
            schoolYear: { select: { code: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      items: subsidies.map((s) => ({
        ...s,
        student: studentLabel(s.enrollment.student),
        gradeLevel: s.enrollment.gradeLevel.name,
        schoolYear: s.enrollment.schoolYear.code,
        outstanding: round2(Number(s.amount) - Number(s.receivedAmount)),
      })),
      totals: {
        expected: round2(subsidies.reduce((t, s) => t + Number(s.amount), 0)),
        received: round2(subsidies.reduce((t, s) => t + Number(s.receivedAmount), 0)),
      },
    });
  } catch (err) { next(err); }
};

/**
 * Record a DepEd remittance against one or more subsidies.
 *
 * DR Cash in Bank / CR Receivable — DepEd ESC. Revenue was recognised when the
 * fee was billed; this only settles the receivable.
 */
exports.receiveSubsidy = async (req, res, next) => {
  try {
    const { subsidyIds = [], receivedDate, paymentMethod = 'Bank Transfer', reference } = req.body;
    if (!Array.isArray(subsidyIds) || subsidyIds.length === 0) {
      throw createError('Select at least one subsidy to record', 400);
    }

    const subsidies = await prisma.studentSubsidy.findMany({
      where: {
        id: { in: subsidyIds.map(Number) },
        enrollment: { businessId: req.businessId },
      },
      include: { enrollment: { include: { student: true } } },
    });
    if (subsidies.length === 0) throw createError('No matching subsidies found', 404);

    const date = receivedDate ? new Date(receivedDate) : new Date();
    await schoolInvoice.assertPostable(req.businessId, date);

    let total = 0;
    for (const s of subsidies) {
      const outstanding = round2(Number(s.amount) - Number(s.receivedAmount));
      if (outstanding <= 0.009) continue;
      await prisma.studentSubsidy.update({
        where: { id: s.id },
        data: {
          receivedAmount: Number(s.amount),
          status: 'RECEIVED',
          remarks: reference ? `Remittance ref ${reference}` : s.remarks,
        },
      });
      total = round2(total + outstanding);
    }

    if (total <= 0) {
      return res.json({ received: 0, message: 'Those subsidies have already been received in full.' });
    }

    const cashAccount = PAYMENT_ACCOUNT[paymentMethod] || '1020';
    await glPost.safePost({
      entryDate:   date,
      description: `DepEd Subsidy Remittance — ${subsidies.length} student${subsidies.length === 1 ? '' : 's'}`,
      reference:   reference || `SUB-${Date.now()}`,
      lines: [
        { accountCode: cashAccount,               debit:  total, description: `Subsidy remittance received (${paymentMethod})` },
        { accountCode: schoolInvoice.AR_SUBSIDY,  credit: total, description: 'Clear DepEd receivable' },
      ],
      userId: req.user?.id || 1,
      businessId: req.businessId,
    });

    await recordAudit({
      action: 'UPDATE', entity: 'StudentSubsidy', entityId: subsidyIds.join(','),
      summary: `Recorded ₱${total.toLocaleString()} DepEd subsidy remittance for ${subsidies.length} students`,
      user: req.user, businessId: req.businessId,
    });

    res.json({
      received: total,
      count: subsidies.length,
      message: `Recorded ₱${total.toLocaleString()} across ${subsidies.length} student${subsidies.length === 1 ? '' : 's'}.`,
    });
  } catch (err) { next(err); }
};
