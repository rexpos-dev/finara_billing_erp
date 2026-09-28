/**
 * schoolReportsController.js — Statement of account, collections, delinquency
 * and enrollment summary.
 *
 * Read-only. Every figure is derived from invoices and payments, never from a
 * cached total, so a report can never disagree with the ledger it describes.
 */

const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { round2 } = require('../utils/assessmentCalc');
const policy = require('../utils/schoolPolicy');

const studentLabel = (s) =>
  [s.lastName + ',', s.firstName, s.middleName, s.suffix].filter(Boolean).join(' ');

/**
 * Statement of account — the document a parent is handed at the window.
 *
 * Shows the full assessment, what has been billed so far, every payment, and
 * the running balance.
 */
exports.statementOfAccount = async (req, res, next) => {
  try {
    const studentId = Number(req.params.studentId);
    const { schoolYearId } = req.query;

    const student = await prisma.student.findFirst({
      where: { id: studentId, businessId: req.businessId },
      include: { guardians: { where: { isPrimaryPayer: true }, take: 1 } },
    });
    if (!student) throw createError('Student not found', 404);

    const assessment = await prisma.assessment.findFirst({
      where: {
        studentId, businessId: req.businessId,
        status: { in: ['POSTED', 'PARTIALLY_PAID', 'PAID'] },
        ...(schoolYearId && { enrollment: { schoolYearId: Number(schoolYearId) } }),
      },
      orderBy: { assessmentDate: 'desc' },
      include: {
        lines: { include: { feeType: { select: { name: true, category: true } } }, orderBy: { sortOrder: 'asc' } },
        installments: {
          orderBy: { seq: 'asc' },
          include: {
            invoice: {
              select: {
                id: true, invoiceNo: true, invoiceDate: true, status: true,
                totalAmount: true, paidAmount: true,
                payments: { orderBy: { paymentDate: 'asc' } },
              },
            },
          },
        },
        enrollment: {
          include: {
            gradeLevel: true, section: true, schoolYear: true,
            paymentScheme: true, discounts: true, subsidies: true,
          },
        },
      },
    });
    if (!assessment) {
      throw createError('No issued assessment for this student in the selected school year', 404);
    }

    const today = new Date();
    const schedule = assessment.installments.map((i) => {
      const billed  = !!i.invoice;
      const paid    = round2(Number(i.paidAmount));
      const balance = round2(Number(i.amount) - paid);
      const overdue = billed && balance > 0.01 && new Date(i.dueDate) < today;
      return {
        seq: i.seq, label: i.label, dueDate: i.dueDate,
        amount: Number(i.amount), paidAmount: paid, balance,
        status: i.status, billed,
        invoiceNo: i.invoice?.invoiceNo || null,
        daysOverdue: overdue ? Math.floor((today - new Date(i.dueDate)) / 86400000) : 0,
      };
    });

    const payments = assessment.installments
      .flatMap((i) => (i.invoice?.payments || []).map((p) => ({
        paymentNo: p.paymentNo, paymentDate: p.paymentDate, amount: Number(p.amount),
        paymentMethod: p.paymentMethod, reference: p.reference,
        invoiceNo: i.invoice.invoiceNo, appliedTo: i.label,
      })))
      .sort((a, b) => new Date(a.paymentDate) - new Date(b.paymentDate));

    const totalAssessed = round2(Number(assessment.netAmount) - Number(assessment.subsidyAmount));
    const totalPaid     = round2(payments.reduce((s, p) => s + p.amount, 0));

    res.json({
      student: {
        id: student.id, studentNo: student.studentNo, lrn: student.lrn,
        name: studentLabel(student), address: student.address,
        guardian: student.guardians[0]?.name || null,
        guardianPhone: student.guardians[0]?.phone || null,
      },
      enrollment: {
        schoolYear: assessment.enrollment.schoolYear.code,
        gradeLevel: assessment.enrollment.gradeLevel.name,
        section:    assessment.enrollment.section?.name || null,
        scheme:     assessment.enrollment.paymentScheme.name,
      },
      assessment: {
        assessmentNo:   assessment.assessmentNo,
        assessmentDate: assessment.assessmentDate,
        lines:          assessment.lines,
        grossAmount:    Number(assessment.grossAmount),
        discountAmount: Number(assessment.discountAmount),
        subsidyAmount:  Number(assessment.subsidyAmount),
        netAmount:      Number(assessment.netAmount),
        totalPayable:   totalAssessed,
        discounts:      assessment.enrollment.discounts,
        subsidies:      assessment.enrollment.subsidies,
      },
      schedule,
      payments,
      summary: {
        totalPayable: totalAssessed,
        totalBilled:  round2(Number(assessment.billedAmount)),
        totalPaid,
        balance:      round2(totalAssessed - totalPaid),
        overdue:      round2(schedule.filter((s) => s.daysOverdue > 0).reduce((t, s) => t + s.balance, 0)),
      },
    });
  } catch (err) { next(err); }
};

/**
 * Collections for a date range, broken down by payment method and by day.
 *
 * This is what reconciles against the cash drawer at close of day.
 */
exports.collectionsReport = async (req, res, next) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) throw createError('Both from and to dates are required', 400);

    const students = await prisma.student.findMany({
      where: { businessId: req.businessId },
      select: { id: true, studentNo: true, lastName: true, firstName: true, middleName: true, suffix: true, customerId: true },
    });
    const byCustomer = new Map(students.map((s) => [s.customerId, s]));
    if (byCustomer.size === 0) {
      return res.json({ items: [], byMethod: {}, byDay: [], total: 0, count: 0 });
    }

    const payments = await prisma.paymentAR.findMany({
      where: {
        paymentDate: { gte: new Date(from), lte: new Date(to) },
        invoice: { businessId: req.businessId, customerId: { in: [...byCustomer.keys()] } },
      },
      include: { invoice: { select: { invoiceNo: true, customerId: true, description: true } } },
      orderBy: { paymentDate: 'asc' },
    });

    const items = payments.map((p) => {
      const s = byCustomer.get(p.invoice.customerId);
      return {
        paymentNo: p.paymentNo, paymentDate: p.paymentDate,
        studentNo: s?.studentNo || '—',
        student:   s ? studentLabel(s) : 'Unknown',
        invoiceNo: p.invoice.invoiceNo,
        description: p.invoice.description,
        amount: Number(p.amount),
        paymentMethod: p.paymentMethod,
        reference: p.reference,
      };
    });

    const byMethod = {};
    for (const i of items) byMethod[i.paymentMethod] = round2((byMethod[i.paymentMethod] || 0) + i.amount);

    const dayMap = {};
    for (const i of items) {
      const key = new Date(i.paymentDate).toISOString().slice(0, 10);
      dayMap[key] = round2((dayMap[key] || 0) + i.amount);
    }
    const byDay = Object.entries(dayMap)
      .map(([date, amount]) => ({ date, amount }))
      .sort((a, b) => a.date.localeCompare(b.date));

    res.json({
      from, to, items, byMethod, byDay,
      total: round2(items.reduce((s, i) => s + i.amount, 0)),
      count: items.length,
    });
  } catch (err) { next(err); }
};

/**
 * Who is behind, and by how much.
 *
 * Aging buckets match the existing AR aging report so the two can be read
 * side by side without mental arithmetic.
 */
exports.delinquencyReport = async (req, res, next) => {
  try {
    const { schoolYearId, gradeLevelId, minDays = 1 } = req.query;

    const enrollments = await prisma.enrollment.findMany({
      where: {
        businessId: req.businessId,
        status: { in: ['ASSESSED', 'PARTIALLY_PAID', 'ENROLLED'] },
        ...(schoolYearId && { schoolYearId: Number(schoolYearId) }),
        ...(gradeLevelId && { gradeLevelId: Number(gradeLevelId) }),
      },
      include: {
        student:    { include: { guardians: { where: { isPrimaryPayer: true }, take: 1 } } },
        gradeLevel: { select: { code: true, name: true, sortOrder: true } },
        section:    { select: { name: true } },
      },
    });
    if (enrollments.length === 0) {
      return res.json({ items: [], summary: {}, total: 0, studentCount: 0 });
    }

    const today = new Date();
    const bucketFor = (days) =>
      days === 0 ? 'Current'
      : days <= 30 ? '1-30 days'
      : days <= 60 ? '31-60 days'
      : days <= 90 ? '61-90 days'
      : 'Over 90 days';

    // Which subledger holds the receivable depends on the revenue policy.
    //
    //   ON_BILLING     invoices are the receivable — read those.
    //   ON_ASSESSMENT  the full year was booked at issue and invoices post
    //                  nothing, so the installment schedule is the subledger.
    //                  Reading invoices here would understate what is owed by
    //                  everything not yet billed.
    const revenuePolicy = await policy.getPolicy(req.businessId);
    const byCustomer = {};

    if (revenuePolicy === policy.ON_ASSESSMENT) {
      const studentIds = enrollments.map((e) => e.student.id);
      const installments = await prisma.installment.findMany({
        where: {
          status: { in: ['SCHEDULED', 'BILLED', 'PARTIAL'] },
          assessment: {
            businessId: req.businessId,
            status: { in: ['POSTED', 'PARTIALLY_PAID', 'PAID'] },
            studentId: { in: studentIds },
          },
        },
        include: { assessment: { select: { studentId: true } } },
      });
      const customerByStudent = Object.fromEntries(enrollments.map((e) => [e.student.id, e.student.customerId]));

      for (const inst of installments) {
        const balance = round2(Number(inst.amount) - Number(inst.paidAmount));
        if (balance <= 0.01) continue;
        const days = Math.max(0, Math.floor((today - new Date(inst.dueDate)) / 86400000));
        if (days < Number(minDays)) continue;

        const customerId = customerByStudent[inst.assessment.studentId];
        const c = byCustomer[customerId] || (byCustomer[customerId] = {
          outstanding: 0, oldestDays: 0, invoiceCount: 0, buckets: {},
        });
        c.outstanding  = round2(c.outstanding + balance);
        c.oldestDays   = Math.max(c.oldestDays, days);
        c.invoiceCount += 1;
        c.buckets[bucketFor(days)] = round2((c.buckets[bucketFor(days)] || 0) + balance);
      }
    } else {
      const customerIds = enrollments.map((e) => e.student.customerId);
      const invoices = await prisma.invoice.findMany({
        where: {
          businessId: req.businessId,
          customerId: { in: customerIds },
          status: { in: ['OPEN', 'PARTIAL', 'OVERDUE'] },
        },
      });

      for (const inv of invoices) {
        const balance = round2(Number(inv.totalAmount) - Number(inv.paidAmount));
        if (balance <= 0.01) continue;
        const days = Math.max(0, Math.floor((today - new Date(inv.dueDate)) / 86400000));
        if (days < Number(minDays)) continue;

        const c = byCustomer[inv.customerId] || (byCustomer[inv.customerId] = {
          outstanding: 0, oldestDays: 0, invoiceCount: 0, buckets: {},
        });
        c.outstanding  = round2(c.outstanding + balance);
        c.oldestDays   = Math.max(c.oldestDays, days);
        c.invoiceCount += 1;
        c.buckets[bucketFor(days)] = round2((c.buckets[bucketFor(days)] || 0) + balance);
      }
    }

    const items = enrollments
      .filter((e) => byCustomer[e.student.customerId])
      .map((e) => {
        const c = byCustomer[e.student.customerId];
        return {
          studentId:   e.student.id,
          studentNo:   e.student.studentNo,
          student:     studentLabel(e.student),
          gradeLevel:  e.gradeLevel.name,
          gradeSort:   e.gradeLevel.sortOrder,
          section:     e.section?.name || null,
          guardian:      e.student.guardians[0]?.name || null,
          guardianPhone: e.student.guardians[0]?.phone || null,
          outstanding:  c.outstanding,
          oldestDays:   c.oldestDays,
          invoiceCount: c.invoiceCount,
          buckets:      c.buckets,
        };
      })
      .sort((a, b) => b.outstanding - a.outstanding);

    const buckets = ['Current', '1-30 days', '31-60 days', '61-90 days', 'Over 90 days'];
    const summary = Object.fromEntries(buckets.map((b) => [
      b, round2(items.reduce((s, i) => s + (i.buckets[b] || 0), 0)),
    ]));

    res.json({
      items, summary,
      total: round2(items.reduce((s, i) => s + i.outstanding, 0)),
      studentCount: items.length,
    });
  } catch (err) { next(err); }
};

/**
 * Headcount and billing totals per grade level.
 */
exports.enrollmentSummary = async (req, res, next) => {
  try {
    const { schoolYearId } = req.query;

    const year = schoolYearId
      ? await prisma.schoolYear.findFirst({ where: { id: Number(schoolYearId), businessId: req.businessId } })
      : await prisma.schoolYear.findFirst({ where: { businessId: req.businessId, isCurrent: true } });
    if (!year) throw createError('No school year selected and none marked as current', 400);

    const enrollments = await prisma.enrollment.findMany({
      where: { businessId: req.businessId, schoolYearId: year.id, status: { in: ['ASSESSED', 'PARTIALLY_PAID', 'ENROLLED'] } },
      include: {
        gradeLevel: true,
        section:    { select: { name: true } },
        assessment: { select: { netAmount: true, subsidyAmount: true, billedAmount: true, paidAmount: true, status: true } },
      },
    });

    const byLevel = {};
    for (const e of enrollments) {
      const key = e.gradeLevel.id;
      const g = byLevel[key] || (byLevel[key] = {
        gradeLevelId: key, code: e.gradeLevel.code, name: e.gradeLevel.name,
        stage: e.gradeLevel.stage, sortOrder: e.gradeLevel.sortOrder,
        students: 0, assessed: 0, subsidised: 0, billed: 0, collected: 0,
      });
      g.students += 1;
      if (e.assessment) {
        g.assessed   = round2(g.assessed   + Number(e.assessment.netAmount));
        g.subsidised = round2(g.subsidised + Number(e.assessment.subsidyAmount));
        g.billed     = round2(g.billed     + Number(e.assessment.billedAmount));
        g.collected  = round2(g.collected  + Number(e.assessment.paidAmount));
      }
    }

    const levels = Object.values(byLevel).sort((a, b) => a.sortOrder - b.sortOrder);
    const byStage = {};
    for (const l of levels) {
      const s = byStage[l.stage] || (byStage[l.stage] = { stage: l.stage, students: 0, assessed: 0 });
      s.students += l.students;
      s.assessed = round2(s.assessed + l.assessed);
    }

    res.json({
      schoolYear: { id: year.id, code: year.code, name: year.name },
      levels,
      byStage: Object.values(byStage),
      totals: {
        students:   enrollments.length,
        assessed:   round2(levels.reduce((s, l) => s + l.assessed, 0)),
        subsidised: round2(levels.reduce((s, l) => s + l.subsidised, 0)),
        billed:     round2(levels.reduce((s, l) => s + l.billed, 0)),
        collected:  round2(levels.reduce((s, l) => s + l.collected, 0)),
      },
    });
  } catch (err) { next(err); }
};
