/**
 * schoolSetupController.js — School year, grade levels, sections, fee types,
 * fee structures and payment schemes.
 *
 * Reference data an admin touches a few times a year. Every query is scoped to
 * req.businessId so one school's setup can never leak into another business.
 */

const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { recordAudit } = require('../utils/audit');

// ── School years ───────────────────────────────────────────────────────────

exports.listSchoolYears = async (req, res, next) => {
  try {
    res.json(await prisma.schoolYear.findMany({
      where: { businessId: req.businessId },
      orderBy: { startDate: 'desc' },
    }));
  } catch (err) { next(err); }
};

exports.createSchoolYear = async (req, res, next) => {
  try {
    const { code, name, startDate, endDate, isCurrent } = req.body;
    if (new Date(endDate) <= new Date(startDate)) {
      throw createError('School year end date must be after the start date', 400);
    }

    const created = await prisma.$transaction(async (tx) => {
      // Only one year can be current, or every screen defaulting to "the
      // current year" would pick an arbitrary one.
      if (isCurrent) {
        await tx.schoolYear.updateMany({
          where: { businessId: req.businessId },
          data:  { isCurrent: false },
        });
      }
      return tx.schoolYear.create({
        data: {
          businessId: req.businessId,
          code, name,
          startDate: new Date(startDate),
          endDate:   new Date(endDate),
          isCurrent: !!isCurrent,
        },
      });
    });

    await recordAudit({
      action: 'CREATE', entity: 'SchoolYear', entityId: String(created.id),
      summary: `Created school year ${created.code}`,
      user: req.user, businessId: req.businessId,
    });
    res.status(201).json(created);
  } catch (err) { next(err); }
};

exports.updateSchoolYear = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { code, name, startDate, endDate, isCurrent, isActive } = req.body;
    const existing = await prisma.schoolYear.findFirst({ where: { id, businessId: req.businessId } });
    if (!existing) throw createError('School year not found', 404);

    const updated = await prisma.$transaction(async (tx) => {
      if (isCurrent) {
        await tx.schoolYear.updateMany({
          where: { businessId: req.businessId, id: { not: id } },
          data:  { isCurrent: false },
        });
      }
      return tx.schoolYear.update({
        where: { id },
        data: {
          ...(code !== undefined && { code }),
          ...(name !== undefined && { name }),
          ...(startDate && { startDate: new Date(startDate) }),
          ...(endDate && { endDate: new Date(endDate) }),
          ...(isCurrent !== undefined && { isCurrent: !!isCurrent }),
          ...(isActive !== undefined && { isActive: !!isActive }),
        },
      });
    });
    res.json(updated);
  } catch (err) { next(err); }
};

// ── Grade levels ───────────────────────────────────────────────────────────

exports.listGradeLevels = async (req, res, next) => {
  try {
    res.json(await prisma.gradeLevel.findMany({
      where: { businessId: req.businessId },
      orderBy: { sortOrder: 'asc' },
    }));
  } catch (err) { next(err); }
};

exports.createGradeLevel = async (req, res, next) => {
  try {
    const { code, name, stage, sortOrder } = req.body;
    res.status(201).json(await prisma.gradeLevel.create({
      data: { businessId: req.businessId, code, name, stage, sortOrder: Number(sortOrder) || 0 },
    }));
  } catch (err) { next(err); }
};

exports.updateGradeLevel = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.gradeLevel.findFirst({ where: { id, businessId: req.businessId } });
    if (!existing) throw createError('Grade level not found', 404);
    const { code, name, stage, sortOrder, isActive } = req.body;
    res.json(await prisma.gradeLevel.update({
      where: { id },
      data: {
        ...(code !== undefined && { code }),
        ...(name !== undefined && { name }),
        ...(stage !== undefined && { stage }),
        ...(sortOrder !== undefined && { sortOrder: Number(sortOrder) }),
        ...(isActive !== undefined && { isActive: !!isActive }),
      },
    }));
  } catch (err) { next(err); }
};

// ── Sections ───────────────────────────────────────────────────────────────

exports.listSections = async (req, res, next) => {
  try {
    const { schoolYearId, gradeLevelId } = req.query;
    const sections = await prisma.section.findMany({
      where: {
        businessId: req.businessId,
        ...(schoolYearId && { schoolYearId: Number(schoolYearId) }),
        ...(gradeLevelId && { gradeLevelId: Number(gradeLevelId) }),
      },
      include: { gradeLevel: true, schoolYear: { select: { code: true } } },
      orderBy: [{ gradeLevel: { sortOrder: 'asc' } }, { name: 'asc' }],
    });

    // Enrolled headcount per section, so the registrar can see capacity at a
    // glance without opening each one.
    const counts = await prisma.enrollment.groupBy({
      by: ['sectionId'],
      where: { businessId: req.businessId, status: { in: ['ASSESSED', 'PARTIALLY_PAID', 'ENROLLED'] }, sectionId: { not: null } },
      _count: { _all: true },
    });
    const byId = Object.fromEntries(counts.map((c) => [c.sectionId, c._count._all]));

    res.json(sections.map((s) => ({ ...s, enrolledCount: byId[s.id] || 0 })));
  } catch (err) { next(err); }
};

exports.createSection = async (req, res, next) => {
  try {
    const { schoolYearId, gradeLevelId, name, adviser, capacity } = req.body;
    res.status(201).json(await prisma.section.create({
      data: {
        businessId: req.businessId,
        schoolYearId: Number(schoolYearId),
        gradeLevelId: Number(gradeLevelId),
        name, adviser: adviser || null,
        capacity: capacity ? Number(capacity) : null,
      },
    }));
  } catch (err) { next(err); }
};

exports.updateSection = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.section.findFirst({ where: { id, businessId: req.businessId } });
    if (!existing) throw createError('Section not found', 404);
    const { name, adviser, capacity, isActive } = req.body;
    res.json(await prisma.section.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(adviser !== undefined && { adviser: adviser || null }),
        ...(capacity !== undefined && { capacity: capacity ? Number(capacity) : null }),
        ...(isActive !== undefined && { isActive: !!isActive }),
      },
    }));
  } catch (err) { next(err); }
};

// ── Fee types ──────────────────────────────────────────────────────────────

exports.listFeeTypes = async (req, res, next) => {
  try {
    res.json(await prisma.feeType.findMany({
      where: { businessId: req.businessId },
      include: { account: { select: { id: true, accountCode: true, accountName: true } } },
      orderBy: { sortOrder: 'asc' },
    }));
  } catch (err) { next(err); }
};

exports.createFeeType = async (req, res, next) => {
  try {
    const { code, name, category, accountId, vatCode, isRefundable, sortOrder } = req.body;

    // The account must belong to this business, or a fee would post revenue
    // into another school's books.
    const account = await prisma.account.findFirst({
      where: { id: Number(accountId), businessId: req.businessId },
    });
    if (!account) throw createError('Account not found in this business', 400);
    if (account.accountType !== 'REVENUE') {
      throw createError(`${account.accountCode} is a ${account.accountType} account — fees must post to REVENUE`, 400);
    }

    res.status(201).json(await prisma.feeType.create({
      data: {
        businessId: req.businessId,
        code, name, category,
        accountId: account.id,
        vatCode: vatCode || 'EXEMPT',
        isRefundable: !!isRefundable,
        sortOrder: Number(sortOrder) || 0,
      },
    }));
  } catch (err) { next(err); }
};

exports.updateFeeType = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.feeType.findFirst({ where: { id, businessId: req.businessId } });
    if (!existing) throw createError('Fee type not found', 404);

    const { code, name, category, accountId, vatCode, isRefundable, sortOrder, isActive } = req.body;
    if (accountId) {
      const account = await prisma.account.findFirst({
        where: { id: Number(accountId), businessId: req.businessId },
      });
      if (!account) throw createError('Account not found in this business', 400);
    }

    res.json(await prisma.feeType.update({
      where: { id },
      data: {
        ...(code !== undefined && { code }),
        ...(name !== undefined && { name }),
        ...(category !== undefined && { category }),
        ...(accountId !== undefined && { accountId: Number(accountId) }),
        ...(vatCode !== undefined && { vatCode }),
        ...(isRefundable !== undefined && { isRefundable: !!isRefundable }),
        ...(sortOrder !== undefined && { sortOrder: Number(sortOrder) }),
        ...(isActive !== undefined && { isActive: !!isActive }),
      },
    }));
  } catch (err) { next(err); }
};

// ── Fee structures ─────────────────────────────────────────────────────────

exports.listFeeStructures = async (req, res, next) => {
  try {
    const { schoolYearId } = req.query;
    const structures = await prisma.feeStructure.findMany({
      where: {
        businessId: req.businessId,
        ...(schoolYearId && { schoolYearId: Number(schoolYearId) }),
      },
      include: {
        gradeLevel: true,
        schoolYear: { select: { id: true, code: true } },
        lines: { include: { feeType: true }, orderBy: { sortOrder: 'asc' } },
      },
      orderBy: [{ gradeLevel: { sortOrder: 'asc' } }],
    });

    res.json(structures.map((s) => ({
      ...s,
      totalAmount: s.lines.reduce((t, l) => t + Number(l.amount), 0),
    })));
  } catch (err) { next(err); }
};

exports.getFeeStructure = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const structure = await prisma.feeStructure.findFirst({
      where: { id, businessId: req.businessId },
      include: {
        gradeLevel: true,
        schoolYear: true,
        lines: { include: { feeType: { include: { account: true } } }, orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!structure) throw createError('Fee structure not found', 404);
    res.json({ ...structure, totalAmount: structure.lines.reduce((t, l) => t + Number(l.amount), 0) });
  } catch (err) { next(err); }
};

exports.saveFeeStructure = async (req, res, next) => {
  try {
    const { schoolYearId, gradeLevelId, name, lines } = req.body;
    if (!Array.isArray(lines) || lines.length === 0) {
      throw createError('A fee structure needs at least one fee line', 400);
    }

    // Every fee type must be this business's own.
    const feeTypeIds = [...new Set(lines.map((l) => Number(l.feeTypeId)))];
    const feeTypes = await prisma.feeType.findMany({
      where: { id: { in: feeTypeIds }, businessId: req.businessId },
    });
    if (feeTypes.length !== feeTypeIds.length) {
      throw createError('One or more fee types do not belong to this business', 400);
    }

    // The year and the level must be this business's own too. Unchecked, a
    // stale id from a dropdown the browser loaded before the row was deleted
    // reaches MySQL as a raw foreign-key error the registrar cannot act on,
    // and a live id from another business would quietly attach this structure
    // to their school year.
    const [schoolYear, gradeLevel] = await Promise.all([
      prisma.schoolYear.findFirst({ where: { id: Number(schoolYearId), businessId: req.businessId } }),
      prisma.gradeLevel.findFirst({ where: { id: Number(gradeLevelId), businessId: req.businessId } }),
    ]);
    if (!schoolYear) {
      throw createError('That school year is not available — reload the page and pick it again', 400);
    }
    if (!gradeLevel) {
      throw createError('That grade level is not available — reload the page and pick it again', 400);
    }

    const existing = await prisma.feeStructure.findFirst({
      where: { businessId: req.businessId, schoolYearId: Number(schoolYearId), gradeLevelId: Number(gradeLevelId) },
    });

    const lineData = lines.map((l, i) => ({
      feeTypeId:    Number(l.feeTypeId),
      amount:       Number(l.amount) || 0,
      billingBasis: l.billingBasis || 'ANNUAL',
      sortOrder:    i,
    }));

    const saved = existing
      ? await prisma.$transaction(async (tx) => {
          await tx.feeStructureLine.deleteMany({ where: { feeStructureId: existing.id } });
          return tx.feeStructure.update({
            where: { id: existing.id },
            data: { name, lines: { create: lineData } },
            include: { lines: { include: { feeType: true } } },
          });
        })
      : await prisma.feeStructure.create({
          data: {
            businessId: req.businessId,
            schoolYearId: Number(schoolYearId),
            gradeLevelId: Number(gradeLevelId),
            name,
            lines: { create: lineData },
          },
          include: { lines: { include: { feeType: true } } },
        });

    await recordAudit({
      action: existing ? 'UPDATE' : 'CREATE', entity: 'FeeStructure', entityId: String(saved.id),
      summary: `${existing ? 'Updated' : 'Created'} fee structure "${saved.name}"`,
      user: req.user, businessId: req.businessId,
    });
    res.status(existing ? 200 : 201).json(saved);
  } catch (err) { next(err); }
};

/**
 * Copy every fee structure from one school year to another.
 *
 * The single biggest time saver in the module: a school with 15 grade levels
 * would otherwise retype 150 fee lines each June. Existing structures in the
 * target year are left alone rather than overwritten — re-running this must
 * never wipe prices someone has already adjusted.
 */
exports.cloneFeeStructures = async (req, res, next) => {
  try {
    const { fromSchoolYearId, toSchoolYearId, increasePct } = req.body;
    if (Number(fromSchoolYearId) === Number(toSchoolYearId)) {
      throw createError('Source and target school year must differ', 400);
    }

    const [from, to] = await Promise.all([
      prisma.schoolYear.findFirst({ where: { id: Number(fromSchoolYearId), businessId: req.businessId } }),
      prisma.schoolYear.findFirst({ where: { id: Number(toSchoolYearId), businessId: req.businessId } }),
    ]);
    if (!from || !to) throw createError('School year not found', 404);

    const source = await prisma.feeStructure.findMany({
      where: { businessId: req.businessId, schoolYearId: from.id },
      include: { lines: true },
    });
    if (source.length === 0) throw createError(`${from.code} has no fee structures to copy`, 400);

    const existing = await prisma.feeStructure.findMany({
      where: { businessId: req.businessId, schoolYearId: to.id },
      select: { gradeLevelId: true },
    });
    const alreadyThere = new Set(existing.map((e) => e.gradeLevelId));

    const factor = 1 + (Number(increasePct) || 0) / 100;
    let created = 0, skipped = 0;

    for (const s of source) {
      if (alreadyThere.has(s.gradeLevelId)) { skipped++; continue; }
      await prisma.feeStructure.create({
        data: {
          businessId:   req.businessId,
          schoolYearId: to.id,
          gradeLevelId: s.gradeLevelId,
          name:         s.name.replace(from.code, to.code),
          lines: {
            create: s.lines.map((l) => ({
              feeTypeId:    l.feeTypeId,
              amount:       Math.round(Number(l.amount) * factor * 100) / 100,
              billingBasis: l.billingBasis,
              sortOrder:    l.sortOrder,
            })),
          },
        },
      });
      created++;
    }

    await recordAudit({
      action: 'CREATE', entity: 'FeeStructure', entityId: String(to.id),
      summary: `Copied ${created} fee structures from ${from.code} to ${to.code}` +
               (Number(increasePct) ? ` with a ${increasePct}% increase` : ''),
      user: req.user, businessId: req.businessId,
    });

    res.json({
      created, skipped,
      message: `Copied ${created} fee structure${created === 1 ? '' : 's'}` +
               (skipped ? `. ${skipped} left untouched — ${to.code} already has them.` : '.'),
    });
  } catch (err) { next(err); }
};

// ── Payment schemes ────────────────────────────────────────────────────────

exports.listPaymentSchemes = async (req, res, next) => {
  try {
    res.json(await prisma.paymentScheme.findMany({
      where: { businessId: req.businessId },
      orderBy: { sortOrder: 'asc' },
    }));
  } catch (err) { next(err); }
};

exports.createPaymentScheme = async (req, res, next) => {
  try {
    const { code, name, installmentCount, downPaymentAmount, discountPct, surchargePct, sortOrder } = req.body;
    res.status(201).json(await prisma.paymentScheme.create({
      data: {
        businessId: req.businessId,
        code, name,
        installmentCount:  Number(installmentCount) || 1,
        downPaymentAmount: Number(downPaymentAmount) || 0,
        discountPct:       Number(discountPct) || 0,
        surchargePct:      Number(surchargePct) || 0,
        sortOrder:         Number(sortOrder) || 0,
      },
    }));
  } catch (err) { next(err); }
};

exports.updatePaymentScheme = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.paymentScheme.findFirst({ where: { id, businessId: req.businessId } });
    if (!existing) throw createError('Payment scheme not found', 404);

    const { name, installmentCount, downPaymentAmount, discountPct, surchargePct, isActive, sortOrder } = req.body;
    res.json(await prisma.paymentScheme.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(installmentCount !== undefined && { installmentCount: Number(installmentCount) }),
        ...(downPaymentAmount !== undefined && { downPaymentAmount: Number(downPaymentAmount) }),
        ...(discountPct !== undefined && { discountPct: Number(discountPct) }),
        ...(surchargePct !== undefined && { surchargePct: Number(surchargePct) }),
        ...(sortOrder !== undefined && { sortOrder: Number(sortOrder) }),
        ...(isActive !== undefined && { isActive: !!isActive }),
      },
    }));
  } catch (err) { next(err); }
};
