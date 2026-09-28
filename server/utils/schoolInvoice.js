/**
 * schoolInvoice.js — Turns an installment into a real AR invoice.
 *
 * This is the single seam between school billing and the accounting system.
 * Once an installment has an invoice, every existing feature — aging, the BIR
 * sales book, collections, printing, the trial balance — treats it as ordinary
 * receivable, because that is exactly what it is.
 *
 * Two deliberate departures from receivableController:
 *
 *  1. Numbering. Invoice numbers here come from the LAST ISSUED number, not
 *     from a row count. A count is wrong the moment a row is deleted, and a
 *     billing run creating hundreds of invoices at once would hit that
 *     collision immediately. See utils/docNumber.js.
 *
 *  2. Cutover. glPost silently skips anything dated before the business's
 *     booksStartDate. Silent is fine for a stray backdated expense; for a
 *     billing run it would mean hundreds of invoices with no GL entries and
 *     nothing on screen saying so. We check first and refuse loudly instead.
 */

const prisma = require('../config/database');
const glPost = require('./glPost');
const policy = require('./schoolPolicy');
const studentLedger = require('./studentLedger');
const { computeVAT } = require('./phCompliance');
const { nextDocNumber } = require('./docNumber');

// GL control accounts for school billing.
const AR_STUDENTS   = '1110'; // Accounts Receivable — Students
const AR_SUBSIDY    = '1120'; // Receivable — DepEd ESC / SHS Voucher
const UNEARNED      = '2210'; // Unearned Tuition Income (ON_ASSESSMENT only)
const ADVANCES      = '2215'; // Advance Payments from Students
const OUTPUT_VAT    = '2030'; // Output VAT Payable
const DISCOUNTS     = '4499'; // Tuition Discounts & Scholarships (contra-revenue)

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * Next school invoice number: SI-6-000001.
 *
 * Business-scoped so school invoices never interleave with the shared
 * INV-nnnnnn series the other businesses use — a BIR sales book with two
 * unrelated document series mixed into one run is hard to defend on audit.
 */
async function nextSchoolInvoiceNo(businessId) {
  const prefix = `SI-${businessId}-`;
  const last = await prisma.invoice.findFirst({
    where:   { invoiceNo: { startsWith: prefix } },
    orderBy: { invoiceNo: 'desc' },
    select:  { invoiceNo: true },
  });
  return nextDocNumber(prefix, last?.invoiceNo, 6);
}

/**
 * Throws if the date falls before the business's books start.
 *
 * @param {number}      businessId
 * @param {Date|string} date
 */
async function assertPostable(businessId, date) {
  const biz = await prisma.business.findUnique({
    where:  { id: Number(businessId) },
    select: { booksStartDate: true },
  });
  const cutover = glPost.dateKey(biz?.booksStartDate);
  const entry   = glPost.dateKey(date);
  if (cutover && entry && entry < cutover) {
    const err = new Error(
      `Cannot bill ${entry}: the books for this business start ${cutover}. ` +
      `An invoice dated earlier would post nothing to the general ledger. ` +
      `Either move the due date on or after ${cutover}, or change the books start date in Settings.`
    );
    err.statusCode = 422;
    err.code = 'PRE_CUTOVER';
    throw err;
  }
}

/**
 * Build the GL lines for a school invoice.
 *
 * DR Accounts Receivable — Students
 *   CR each revenue account (or DR, for contra-revenue discount lines)
 *   CR Output VAT, when any line is VATable (books, uniforms)
 */
function buildSchoolInvoiceGLLines(invoice, studentLabel) {
  return [
    {
      accountCode: AR_STUDENTS,
      debit: Number(invoice.totalAmount),
      description: `AR — ${studentLabel} (${invoice.invoiceNo})`,
    },
    ...invoice.lines.map((l) => {
      const amt = Number(l.amount);
      // A negative amount is a contra-revenue line (discount): its account has
      // a DEBIT normal balance, so it belongs on the debit side.
      return amt < 0
        ? { accountId: l.accountId, debit: -amt, description: l.description }
        : { accountId: l.accountId, credit: amt, description: l.description };
    }),
    ...(Number(invoice.vatAmount) > 0
      ? [{ accountCode: OUTPUT_VAT, credit: Number(invoice.vatAmount), description: 'Output VAT' }]
      : []),
  ];
}

/**
 * Create the invoice for one installment and post it.
 *
 * @param {Object} opts
 * @param {Object} opts.installment  with .assessment loaded
 * @param {Array}  opts.lines        [{ accountId, description, amount, vatCode, feeTypeId }]
 * @param {Object} opts.student      { id, studentNo, customerId, label }
 * @param {number} opts.businessId
 * @param {number} opts.userId
 * @param {Date}   [opts.invoiceDate] defaults to the installment due date
 * @returns {Promise<Object>} the created invoice
 */
async function billInstallment({ installment, lines, student, businessId, userId, invoiceDate }) {
  const docDate = invoiceDate ? new Date(invoiceDate) : new Date(installment.dueDate);
  await assertPostable(businessId, docDate);

  // Per-line VAT. Tuition is EXEMPT; books and uniforms are VATable, so a
  // mixed installment produces both an exempt base and an output VAT credit.
  //
  // VATable fees are assessed VAT-INCLUSIVE — a school quotes "Books ₱3,500",
  // not "₱3,500 plus VAT". Treating them as exclusive would make the invoice
  // total exceed the installment the parent agreed to, so the installment could
  // never settle exactly and the printed schedule would never match the bill.
  let subtotal = 0, vatAmount = 0;
  const priced = lines.map((l) => {
    const amt = round2(l.amount);
    const v = l.vatCode === 'VAT' ? computeVAT(amt, true) : { base: amt, vat: 0 };
    subtotal  = round2(subtotal + v.base);
    vatAmount = round2(vatAmount + v.vat);
    return { ...l, amount: v.base };
  });
  const totalAmount = round2(subtotal + vatAmount);

  const revenuePolicy = await policy.getPolicy(businessId);

  const invoice = await prisma.$transaction(async (tx) => {
    const inv = await tx.invoice.create({
      data: {
        businessId,
        invoiceNo:   await nextSchoolInvoiceNo(businessId),
        customerId:  student.customerId,
        invoiceDate: docDate,
        dueDate:     new Date(installment.dueDate),
        description: `${installment.label} — ${student.label}`,
        subtotal, vatAmount, totalAmount,
        status: 'OPEN',
        lines: {
          create: priced.map((l) => ({
            accountId:   l.accountId,
            description: l.description,
            quantity:    1,
            unitPrice:   l.amount,
            amount:      l.amount,
            vatCode:     l.vatCode || 'EXEMPT',
          })),
        },
      },
      include: { lines: true },
    });

    await tx.installment.update({
      where: { id: installment.id },
      data:  { invoiceId: inv.id, status: 'BILLED', billedAt: new Date() },
    });

    await tx.assessment.update({
      where: { id: installment.assessmentId },
      data:  { billedAmount: { increment: totalAmount } },
    });

    // Under ON_BILLING the invoice IS the charge, so it belongs on the ledger.
    // Under ON_ASSESSMENT the whole year was charged when the assessment was
    // issued and this invoice is only a billing notice — adding it here would
    // charge the parent twice on their own statement.
    if (revenuePolicy === policy.ON_BILLING) {
      await studentLedger.append(tx, {
        businessId,
        studentId:    student.id,
        entryDate:    docDate,
        type:         'CHARGE',
        reference:    inv.invoiceNo,
        description:  installment.label,
        debit:        totalAmount,
        assessmentId: installment.assessmentId,
        invoiceId:    inv.id,
        createdBy:    userId,
      });
    }

    return inv;
  });

  // Under ON_ASSESSMENT the receivable and the deferred income were both booked
  // in full when the assessment was issued, and revenue is recognised by the
  // monthly amortisation run. Posting here as well would double-count both AR
  // and revenue, so the invoice stays a billing notice with no GL effect.
  if (revenuePolicy === policy.ON_BILLING) {
    await glPost.safePost({
      entryDate:   docDate,
      description: `Student Billing — ${student.label} (${invoice.invoiceNo})`,
      reference:   invoice.invoiceNo,
      lines:       buildSchoolInvoiceGLLines(invoice, student.label),
      userId:      userId || 1,
      businessId,
    });
  }

  return invoice;
}

/**
 * Book a whole year at once — the ON_ASSESSMENT opening entry.
 *
 *   DR Accounts Receivable — Students     what the parent will pay
 *   DR Tuition Discounts & Scholarships   what was given away
 *   DR Receivable — DepEd ESC             what DepEd will pay
 *     CR Unearned Tuition Income          the gross assessment
 *
 * The three debits sum to gross by construction: netPayable = gross − discount
 * − subsidy. Booking the discount as a debit here keeps gross revenue and the
 * cost of discounting both visible, which netting would hide.
 */
async function postAssessmentOpening({
  businessId, userId, date, assessmentNo, studentLabel,
  grossAmount, discountAmount, subsidyAmount, netPayable,
}) {
  const lines = [
    { accountCode: AR_STUDENTS, debit: round2(netPayable), description: `AR — ${studentLabel} (${assessmentNo})` },
  ];
  if (round2(discountAmount) > 0) {
    lines.push({ accountCode: DISCOUNTS, debit: round2(discountAmount), description: `Discounts — ${studentLabel}` });
  }
  if (round2(subsidyAmount) > 0) {
    lines.push({ accountCode: AR_SUBSIDY, debit: round2(subsidyAmount), description: `Subsidy receivable — ${studentLabel}` });
  }
  lines.push({ accountCode: UNEARNED, credit: round2(grossAmount), description: `Unearned tuition — ${studentLabel}` });

  return glPost.safePost({
    entryDate:   date,
    description: `Assessment — ${studentLabel} (${assessmentNo})`,
    reference:   assessmentNo,
    lines,
    userId: userId || 1,
    businessId,
  });
}

/**
 * Post a discount as contra-revenue against a student's receivable.
 *
 * DR Tuition Discounts & Scholarships (contra-revenue, DEBIT normal balance)
 *   CR Accounts Receivable — Students
 *
 * The school earned the full fee and then gave part of it back; showing that
 * explicitly keeps gross revenue and the cost of discounting both visible,
 * which netting it against tuition would hide.
 */
async function postDiscount({ businessId, userId, date, amount, studentLabel, reference, label }) {
  if (round2(amount) <= 0) return null;
  return glPost.safePost({
    entryDate:   date,
    description: `Student Discount — ${label} — ${studentLabel}`,
    reference,
    lines: [
      { accountCode: DISCOUNTS,   debit:  round2(amount), description: `${label} — ${studentLabel}` },
      { accountCode: AR_STUDENTS, credit: round2(amount), description: `Discount applied — ${studentLabel}` },
    ],
    userId: userId || 1,
    businessId,
  });
}

/**
 * Move a subsidised portion from the parent's receivable to DepEd's.
 *
 * DR Receivable — DepEd ESC / SHS Voucher
 *   CR Accounts Receivable — Students
 *
 * Revenue is untouched: the school still earned it. Only the payer changes.
 */
async function postSubsidy({ businessId, userId, date, amount, studentLabel, reference, type }) {
  if (round2(amount) <= 0) return null;
  return glPost.safePost({
    entryDate:   date,
    description: `${type} Subsidy — ${studentLabel}`,
    reference,
    lines: [
      { accountCode: AR_SUBSIDY,  debit:  round2(amount), description: `${type} receivable — ${studentLabel}` },
      { accountCode: AR_STUDENTS, credit: round2(amount), description: `${type} applied — ${studentLabel}` },
    ],
    userId: userId || 1,
    businessId,
  });
}

module.exports = {
  billInstallment,
  postAssessmentOpening,
  postDiscount,
  postSubsidy,
  assertPostable,
  nextSchoolInvoiceNo,
  buildSchoolInvoiceGLLines,
  AR_STUDENTS, AR_SUBSIDY, UNEARNED, ADVANCES, OUTPUT_VAT, DISCOUNTS,
};
