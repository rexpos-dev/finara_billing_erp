/**
 * assessmentController.js — Enrollment and assessment.
 *
 * The assessment is a MEMO document. It computes what a student owes for the
 * year, applies discounts and subsidies, prints as the enrollment form the
 * parent signs, and lays out the installment schedule — but it posts nothing.
 *
 * Money only reaches the ledger when an installment is billed, which keeps AR
 * aging honest: on enrollment day a parent is not yet overdue on a payment
 * that is not due until March.
 */

const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { nextDocNumber } = require('../utils/docNumber');
const { recordAudit } = require('../utils/audit');
const { computeAssessment, buildSchedule, allocateInstallment, round2 } = require('../utils/assessmentCalc');
const schoolInvoice = require('../utils/schoolInvoice');
const policy = require('../utils/schoolPolicy');
const studentLedger = require('../utils/studentLedger');
const mailer = require('../utils/mailer');

const studentLabel = (s) =>
  `${[s.lastName + ',', s.firstName, s.middleName, s.suffix].filter(Boolean).join(' ')} (${s.studentNo})`;

async function nextAssessmentNo(businessId) {
  const prefix = `ASM-${businessId}-`;
  const last = await prisma.assessment.findFirst({
    where:   { assessmentNo: { startsWith: prefix } },
    orderBy: { assessmentNo: 'desc' },
    select:  { assessmentNo: true },
  });
  return nextDocNumber(prefix, last?.assessmentNo, 6);
}

/**
 * Load everything computeAssessment() needs, validating that each piece
 * belongs to this business along the way.
 */
async function loadInputs(businessId, { studentId, schoolYearId, gradeLevelId, feeStructureId, paymentSchemeId }) {
  const [student, schoolYear, gradeLevel, scheme] = await Promise.all([
    prisma.student.findFirst({ where: { id: Number(studentId), businessId } }),
    prisma.schoolYear.findFirst({ where: { id: Number(schoolYearId), businessId } }),
    prisma.gradeLevel.findFirst({ where: { id: Number(gradeLevelId), businessId } }),
    prisma.paymentScheme.findFirst({ where: { id: Number(paymentSchemeId), businessId } }),
  ]);
  if (!student)    throw createError('Student not found', 404);
  if (!schoolYear) throw createError('School year not found', 404);
  if (!gradeLevel) throw createError('Grade level not found', 404);
  if (!scheme)     throw createError('Payment scheme not found', 404);

  // An explicit fee structure wins; otherwise use the one for this year and
  // grade level, which is what the enrollment screen sends 99% of the time.
  const structure = feeStructureId
    ? await prisma.feeStructure.findFirst({
        where: { id: Number(feeStructureId), businessId },
        include: { lines: { include: { feeType: true }, orderBy: { sortOrder: 'asc' } } },
      })
    : await prisma.feeStructure.findFirst({
        where: { businessId, schoolYearId: schoolYear.id, gradeLevelId: gradeLevel.id, isActive: true },
        include: { lines: { include: { feeType: true }, orderBy: { sortOrder: 'asc' } } },
      });

  if (!structure) {
    throw createError(
      `No fee structure set up for ${gradeLevel.name} in ${schoolYear.code}. ` +
      `Add one under School → Setup → Fee Structures before enrolling.`, 400
    );
  }
  if (!structure.lines.length) {
    throw createError(`The fee structure for ${gradeLevel.name} has no fee lines`, 400);
  }

  return { student, schoolYear, gradeLevel, scheme, structure };
}

/**
 * Compute an assessment without saving anything.
 *
 * Drives the live preview in the enrollment wizard, so a registrar can try a
 * different payment scheme or discount and watch the schedule change before
 * committing.
 */
exports.previewAssessment = async (req, res, next) => {
  try {
    const { discounts = [], subsidies = [], assessmentDate } = req.body;
    const { student, schoolYear, gradeLevel, scheme, structure } =
      await loadInputs(req.businessId, req.body);

    const computed = computeAssessment({
      structureLines: structure.lines,
      scheme, discounts, subsidies,
    });

    const asOf = assessmentDate ? new Date(assessmentDate) : new Date();
    const schedule = buildSchedule({
      netPayable:     computed.netPayable,
      lines:          computed.lines,
      scheme,
      startDate:      schoolYear.startDate,
      assessmentDate: asOf,
    });

    res.json({
      student:     { id: student.id, studentNo: student.studentNo, label: studentLabel(student) },
      schoolYear:  { id: schoolYear.id, code: schoolYear.code },
      gradeLevel:  { id: gradeLevel.id, name: gradeLevel.name },
      scheme:      { id: scheme.id, code: scheme.code, name: scheme.name },
      feeStructure:{ id: structure.id, name: structure.name },
      ...computed,
      schedule,
    });
  } catch (err) { next(err); }
};

/**
 * Enroll a student and create the assessment in one step.
 *
 * The enrollment and its assessment are written in a single transaction: an
 * enrollment with no assessment is a student nobody will ever bill.
 */
exports.createEnrollment = async (req, res, next) => {
  try {
    const {
      studentId, schoolYearId, gradeLevelId, sectionId, paymentSchemeId,
      discounts = [], subsidies = [], enrollmentDate, remarks,
    } = req.body;

    const { student, schoolYear, gradeLevel, scheme, structure } =
      await loadInputs(req.businessId, req.body);

    const existing = await prisma.enrollment.findFirst({
      where: { studentId: student.id, schoolYearId: schoolYear.id },
      include: { schoolYear: { select: { code: true } } },
    });
    if (existing) {
      throw createError(
        `${studentLabel(student)} is already enrolled for ${existing.schoolYear.code}. ` +
        `Cancel that enrollment first if this is a re-enrollment.`, 409
      );
    }

    if (sectionId) {
      const section = await prisma.section.findFirst({
        where: { id: Number(sectionId), businessId: req.businessId, gradeLevelId: gradeLevel.id },
      });
      if (!section) throw createError('Section not found for this grade level', 400);
      if (section.capacity) {
        // A seat is taken from the moment a student is placed in the section,
        // not only once they have paid — counting ENROLLED alone would let a
        // section be over-filled while everyone is mid-payment.
        const filled = await prisma.enrollment.count({
          where: {
            sectionId: section.id,
            status: { in: ['FOR_ASSESSMENT', 'ASSESSED', 'PARTIALLY_PAID', 'ENROLLED'] },
          },
        });
        if (filled >= section.capacity) {
          throw createError(`Section ${section.name} is full (${filled}/${section.capacity})`, 400);
        }
      }
    }

    const computed = computeAssessment({ structureLines: structure.lines, scheme, discounts, subsidies });
    const enrolledOn = enrollmentDate ? new Date(enrollmentDate) : new Date();
    const schedule = buildSchedule({
      netPayable:     computed.netPayable,
      lines:          computed.lines,
      scheme,
      startDate:      schoolYear.startDate,
      assessmentDate: enrolledOn,
    });

    const assessmentNo = await nextAssessmentNo(req.businessId);

    const result = await prisma.$transaction(async (tx) => {
      const enrollment = await tx.enrollment.create({
        data: {
          businessId:      req.businessId,
          studentId:       student.id,
          schoolYearId:    schoolYear.id,
          gradeLevelId:    gradeLevel.id,
          sectionId:       sectionId ? Number(sectionId) : null,
          feeStructureId:  structure.id,
          paymentSchemeId: scheme.id,
          enrollmentDate:  enrolledOn,
          // The assessment created alongside this is still a draft, so the
          // enrollment has not been assessed yet. It advances to ASSESSED when
          // the assessment is issued, then to ENROLLED once money is in.
          status:          'FOR_ASSESSMENT',
          remarks:         remarks || null,
          createdBy:       req.user?.id || null,
          discounts: {
            create: computed.studentDiscounts.map((d) => ({
              type:  d.type || 'OTHER',
              label: d.label,
              basis: d.basis,
              value: d.value,
              amount: d.amount,
              approvedBy: req.user?.id || null,
            })),
          },
          subsidies: {
            create: subsidies.map((s) => ({
              type:        s.type || 'ESC',
              referenceNo: s.referenceNo || null,
              amount:      round2(s.amount),
              status:      'PENDING',
            })),
          },
        },
      });

      const assessment = await tx.assessment.create({
        data: {
          businessId:     req.businessId,
          assessmentNo,
          enrollmentId:   enrollment.id,
          studentId:      student.id,
          assessmentDate: enrolledOn,
          grossAmount:    computed.grossAmount,
          discountAmount: computed.discountAmount,
          subsidyAmount:  computed.subsidyAmount,
          netAmount:      computed.netAmount,
          status:         'DRAFT',
          createdBy:      req.user?.id || null,
          lines: {
            create: computed.lines.map((l, i) => ({
              feeTypeId:    l.feeTypeId,
              accountId:    l.accountId,
              description:  l.description,
              amount:       l.amount,
              vatCode:      l.vatCode,
              billingBasis: l.billingBasis,
              sortOrder:    i,
            })),
          },
          installments: {
            create: schedule.map((s) => ({
              seq: s.seq, label: s.label, dueDate: s.dueDate, amount: s.amount,
            })),
          },
        },
        include: { lines: true, installments: { orderBy: { seq: 'asc' } } },
      });

      // Update the student's status if they were previously inactive.
      if (student.status !== 'ENROLLED') {
        await tx.student.update({ where: { id: student.id }, data: { status: 'ENROLLED' } });
      }

      return { enrollment, assessment };
    });

    await recordAudit({
      action: 'CREATE', entity: 'Assessment', entityId: String(result.assessment.id),
      summary: `Enrolled ${studentLabel(student)} in ${gradeLevel.name} ${schoolYear.code} — ` +
               `assessment ${assessmentNo} for ₱${computed.netPayable.toLocaleString()}`,
      user: req.user, businessId: req.businessId,
    });

    res.status(201).json({ ...result, computed });
  } catch (err) { next(err); }
};

exports.listAssessments = async (req, res, next) => {
  try {
    const { status, schoolYearId, gradeLevelId, search, page = 1, limit = 25 } = req.query;
    const where = { businessId: req.businessId };
    if (status) where.status = status;
    if (schoolYearId || gradeLevelId) {
      where.enrollment = {
        ...(schoolYearId && { schoolYearId: Number(schoolYearId) }),
        ...(gradeLevelId && { gradeLevelId: Number(gradeLevelId) }),
      };
    }
    if (search) {
      where.OR = [
        { assessmentNo: { contains: search } },
        { student: { lastName:  { contains: search } } },
        { student: { firstName: { contains: search } } },
        { student: { studentNo: { contains: search } } },
      ];
    }

    const take = Math.min(Number(limit) || 25, 200);
    const skip = (Math.max(Number(page) || 1, 1) - 1) * take;

    const [items, total] = await Promise.all([
      prisma.assessment.findMany({
        where, take, skip,
        orderBy: { assessmentDate: 'desc' },
        include: {
          student: { select: { id: true, studentNo: true, lastName: true, firstName: true, middleName: true, suffix: true } },
          enrollment: {
            include: {
              gradeLevel: { select: { code: true, name: true } },
              section:    { select: { name: true } },
              schoolYear: { select: { code: true } },
              paymentScheme: { select: { code: true, name: true } },
            },
          },
        },
      }),
      prisma.assessment.count({ where }),
    ]);

    res.json({
      items: items.map((a) => ({ ...a, studentLabel: studentLabel(a.student) })),
      total, page: Number(page), limit: take, pages: Math.ceil(total / take),
    });
  } catch (err) { next(err); }
};

exports.getAssessment = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const assessment = await prisma.assessment.findFirst({
      where: { id, businessId: req.businessId },
      include: {
        student: true,
        lines: { include: { feeType: { select: { code: true, name: true, category: true } } }, orderBy: { sortOrder: 'asc' } },
        installments: {
          orderBy: { seq: 'asc' },
          include: { invoice: { select: { id: true, invoiceNo: true, status: true, paidAmount: true, totalAmount: true } } },
        },
        enrollment: {
          include: {
            gradeLevel: true, section: true, schoolYear: true,
            paymentScheme: true, discounts: true, subsidies: true,
          },
        },
      },
    });
    if (!assessment) throw createError('Assessment not found', 404);
    res.json({ ...assessment, studentLabel: studentLabel(assessment.student) });
  } catch (err) { next(err); }
};

/**
 * Email the assessment (fee breakdown + payment schedule) to whoever should
 * see it: the primary-payer guardian first, then any other guardian with an
 * email on file, then the student's own — matching who a registrar would
 * actually hand the printed form to at the window.
 */
exports.emailAssessment = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!mailer.getTransporter()) throw createError('Email is not configured (SMTP env vars missing)', 400);

    const assessment = await prisma.assessment.findFirst({
      where: { id, businessId: req.businessId },
      include: {
        student: { include: { guardians: true, customer: true } },
        lines: { orderBy: { sortOrder: 'asc' } },
        installments: { orderBy: { seq: 'asc' } },
      },
    });
    if (!assessment) throw createError('Assessment not found', 404);

    const { guardians } = assessment.student;
    const recipientEmail =
      guardians.find((g) => g.isPrimaryPayer && g.email)?.email
      ?? guardians.find((g) => g.email)?.email
      ?? assessment.student.email
      ?? assessment.student.customer?.email
      ?? null;
    const recipientName =
      guardians.find((g) => g.email === recipientEmail)?.name
      ?? studentLabel(assessment.student);
    if (!recipientEmail) {
      throw createError('No email address on file for a guardian, the student, or the linked customer record', 400);
    }

    const companySetting = await prisma.systemSetting.findFirst({
      where: { businessId: req.businessId, key: 'companyName' },
    });

    const sent = await mailer.sendAssessmentEmail(
      { ...assessment, studentLabel: studentLabel(assessment.student) },
      { email: recipientEmail, name: recipientName },
      { companyName: companySetting?.value }
    );
    if (!sent) throw createError('Email could not be sent. Check SMTP configuration.', 400);

    await recordAudit({
      req, action: 'EMAIL', entity: 'Assessment', entityId: id,
      summary: `Emailed assessment ${assessment.assessmentNo} to ${recipientEmail}`,
    });
    res.json({ message: `Assessment emailed to ${recipientEmail}` });
  } catch (err) { next(err); }
};

/**
 * Issue a DRAFT assessment: lock it and bill the enrollment payment.
 *
 * Installment 0 is billed immediately because that is what actually happens at
 * the window — the parent enrolls and pays the down payment the same day.
 * Everything from installment 1 onward waits for the monthly billing run.
 *
 * Discounts and subsidies post here too, since they only mean something once
 * there is a receivable for them to reduce.
 */
exports.issueAssessment = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const assessment = await prisma.assessment.findFirst({
      where: { id, businessId: req.businessId },
      include: {
        student: true,
        lines: { orderBy: { sortOrder: 'asc' } },
        installments: { orderBy: { seq: 'asc' } },
        enrollment: { include: { discounts: true, subsidies: true, schoolYear: true } },
      },
    });
    if (!assessment) throw createError('Assessment not found', 404);
    if (assessment.status !== 'DRAFT') {
      throw createError(`Assessment ${assessment.assessmentNo} is already ${assessment.status.toLowerCase()}`, 400);
    }

    const label = studentLabel(assessment.student);
    const down = assessment.installments.find((i) => i.seq === 0);
    const revenuePolicy = await policy.getPolicy(req.businessId);

    // Refuse before writing anything if the date cannot post — better a clear
    // error than an assessment issued against a ledger that ignored it.
    await schoolInvoice.assertPostable(req.businessId, assessment.assessmentDate);
    if (down) await schoolInvoice.assertPostable(req.businessId, down.dueDate);

    // ON_ASSESSMENT books the whole year up front: receivable, discounts and
    // subsidy against unearned income. The discount and subsidy entries below
    // are skipped because this single entry already carries them.
    if (revenuePolicy === policy.ON_ASSESSMENT) {
      const netPayable = Number(assessment.netAmount) - Number(assessment.subsidyAmount);
      await schoolInvoice.postAssessmentOpening({
        businessId:     req.businessId,
        userId:         req.user?.id,
        date:           assessment.assessmentDate,
        assessmentNo:   assessment.assessmentNo,
        studentLabel:   label,
        grossAmount:    Number(assessment.grossAmount),
        discountAmount: Number(assessment.discountAmount),
        subsidyAmount:  Number(assessment.subsidyAmount),
        netPayable,
      });
    }

    let invoice = null;
    if (down && Number(down.amount) > 0) {
      // The enrollment payment covers every ONE_TIME fee plus any down payment,
      // so its invoice lines are allocated across all fee lines, not just the
      // annual ones.
      const lines = allocateInstallment({
        installmentAmount: Number(down.amount),
        lines: assessment.lines.map((l) => ({
          feeTypeId: l.feeTypeId, accountId: l.accountId, description: l.description,
          vatCode: l.vatCode, amount: Number(l.amount), billingBasis: l.billingBasis,
        })),
        includeOneTime: true,
      });

      invoice = await schoolInvoice.billInstallment({
        installment: down,
        lines,
        student: { id: assessment.student.id, customerId: assessment.student.customerId, label },
        businessId: req.businessId,
        userId: req.user?.id,
        invoiceDate: assessment.assessmentDate,
      });
    }

    // Under ON_BILLING these post as their own entries, because the opening
    // entry that would otherwise carry them does not exist.
    if (revenuePolicy === policy.ON_BILLING) {
      // Discounts: contra-revenue against the student's receivable.
      for (const d of assessment.enrollment.discounts) {
        await schoolInvoice.postDiscount({
          businessId: req.businessId, userId: req.user?.id,
          date: assessment.assessmentDate, amount: Number(d.amount),
          studentLabel: label, reference: assessment.assessmentNo, label: d.label,
        });
      }

      // Subsidies: move the receivable from the parent to DepEd.
      for (const s of assessment.enrollment.subsidies) {
        await schoolInvoice.postSubsidy({
          businessId: req.businessId, userId: req.user?.id,
          date: assessment.assessmentDate, amount: Number(s.amount),
          studentLabel: label, reference: assessment.assessmentNo, type: s.type,
        });
      }
    }

    // The subsidy is now a receivable against DepEd under either policy.
    for (const s of assessment.enrollment.subsidies) {
      await prisma.studentSubsidy.update({ where: { id: s.id }, data: { status: 'BILLED' } });
    }

    // ── Ledger ──────────────────────────────────────────────────────────────
    // Written after the GL work so a posting failure cannot leave a student's
    // statement showing charges the books never recorded.
    await prisma.$transaction(async (tx) => {
      // Under ON_ASSESSMENT the whole year is charged now, one row per fee —
      // the shape the blueprint's section 11 example shows. Under ON_BILLING
      // the charges arrive with each installment invoice instead.
      if (revenuePolicy === policy.ON_ASSESSMENT) {
        for (const l of assessment.lines) {
          await studentLedger.append(tx, {
            businessId:   req.businessId,
            studentId:    assessment.studentId,
            entryDate:    assessment.assessmentDate,
            type:         'ASSESSMENT',
            reference:    assessment.assessmentNo,
            description:  l.description,
            debit:        Number(l.amount),
            assessmentId: assessment.id,
            createdBy:    req.user?.id,
          });
        }
      }

      // Discounts and subsidies reduce what the parent owes under either
      // policy, so they belong on the statement either way.
      for (const d of assessment.enrollment.discounts) {
        await studentLedger.append(tx, {
          businessId:   req.businessId,
          studentId:    assessment.studentId,
          entryDate:    assessment.assessmentDate,
          type:         d.type === 'ACADEMIC' ? 'SCHOLARSHIP' : 'DISCOUNT',
          reference:    assessment.assessmentNo,
          description:  d.label,
          credit:       Number(d.amount),
          assessmentId: assessment.id,
          createdBy:    req.user?.id,
        });
      }
      for (const s of assessment.enrollment.subsidies) {
        await studentLedger.append(tx, {
          businessId:   req.businessId,
          studentId:    assessment.studentId,
          entryDate:    assessment.assessmentDate,
          type:         'SUBSIDY',
          reference:    s.referenceNo || assessment.assessmentNo,
          description:  `${s.type.replace(/_/g, ' ')} subsidy`,
          credit:       Number(s.amount),
          assessmentId: assessment.id,
          createdBy:    req.user?.id,
        });
      }
    });

    const updated = await prisma.assessment.update({
      where: { id },
      data:  { status: 'POSTED' },
      include: { installments: { orderBy: { seq: 'asc' } } },
    });

    // The enrollment has been assessed; it becomes ENROLLED once the first
    // money is in. See recordCollection.
    await prisma.enrollment.update({
      where: { id: assessment.enrollmentId },
      data:  { status: 'ASSESSED' },
    });

    await recordAudit({
      action: 'UPDATE', entity: 'Assessment', entityId: String(id),
      summary: `Issued assessment ${assessment.assessmentNo} for ${label}` +
               (invoice ? ` — enrollment invoice ${invoice.invoiceNo}` : ''),
      user: req.user, businessId: req.businessId,
    });

    res.json({ assessment: updated, invoice });
  } catch (err) { next(err); }
};

/**
 * Cancel an enrollment and its assessment.
 *
 * Refused once anything has been billed: reversing real receivables is the
 * void-invoice path in AR, not a quiet cancel here, and doing it silently
 * would leave revenue on the books with nothing owing it.
 */
exports.cancelEnrollment = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { reason } = req.body;

    const assessment = await prisma.assessment.findFirst({
      where: { id, businessId: req.businessId },
      include: { student: true, installments: true },
    });
    if (!assessment) throw createError('Assessment not found', 404);

    const billed = assessment.installments.filter((i) => i.invoiceId);
    if (billed.length) {
      throw createError(
        `Cannot cancel — ${billed.length} installment${billed.length === 1 ? ' has' : 's have'} already been billed. ` +
        `Void the invoices in Accounts Receivable first.`, 400
      );
    }

    await prisma.$transaction([
      prisma.assessment.update({ where: { id }, data: { status: 'VOIDED', notes: reason || null } }),
      prisma.enrollment.update({ where: { id: assessment.enrollmentId }, data: { status: 'CANCELLED' } }),
      prisma.installment.updateMany({ where: { assessmentId: id }, data: { status: 'CANCELLED' } }),
    ]);

    await recordAudit({
      action: 'DELETE', entity: 'Assessment', entityId: String(id),
      summary: `Cancelled enrollment for ${studentLabel(assessment.student)} — ${reason || 'no reason given'}`,
      user: req.user, businessId: req.businessId,
    });

    res.json({ message: 'Enrollment cancelled' });
  } catch (err) { next(err); }
};
