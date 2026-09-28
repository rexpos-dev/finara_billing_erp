/**
 * amortizationController.js — Monthly recognition of deferred tuition.
 *
 * Only meaningful under the ON_ASSESSMENT revenue policy. Issuing an
 * assessment there credits the whole year to Unearned Tuition Income; this is
 * what moves it into revenue, one month at a time:
 *
 *   DR Unearned Tuition Income
 *     CR Tuition Fees, Miscellaneous Fees, … (pro rata across the fee lines)
 *     CR Output VAT Payable                  (on VATable lines only)
 *
 * Under ON_BILLING there is nothing to amortise — revenue is already
 * recognised as each installment is billed — so the endpoints say so plainly
 * rather than posting a zero entry.
 */

const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const glPost = require('../utils/glPost');
const logger = require('../utils/logger');
const { recordAudit } = require('../utils/audit');
const { computeVAT } = require('../utils/phCompliance');
const { round2, addMonths, toDate } = require('../utils/assessmentCalc');
const schoolInvoice = require('../utils/schoolInvoice');
const policy = require('../utils/schoolPolicy');

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Whole months a school year spans, minimum one. */
function monthsInYear(schoolYear) {
  const start = toDate(schoolYear.startDate);
  const end   = toDate(schoolYear.endDate);
  const months =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - start.getUTCMonth()) + 1;
  return Math.max(1, months);
}

/** The last day of a "YYYY-MM" period — where the entry is dated. */
function periodEnd(period) {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0));
}

/** Every period a school year covers, as "YYYY-MM". */
function periodsFor(schoolYear) {
  const start = toDate(schoolYear.startDate);
  const out = [];
  for (let i = 0; i < monthsInYear(schoolYear); i++) {
    const d = addMonths(start, i);
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

/**
 * Build one month's recognition: how much of each revenue account is earned.
 *
 * Every issued assessment contributes gross ÷ months, split across its fee
 * lines. The largest line absorbs the rounding remainder so the credits always
 * sum to the debit.
 */
async function buildRecognition(businessId, schoolYear) {
  const months = monthsInYear(schoolYear);

  const assessments = await prisma.assessment.findMany({
    where: {
      businessId,
      status: { in: ['POSTED', 'PARTIALLY_PAID', 'PAID'] },
      enrollment: { schoolYearId: schoolYear.id, status: { in: ['ASSESSED', 'PARTIALLY_PAID', 'ENROLLED'] } },
    },
    include: { lines: true },
  });

  const byAccount = {};   // accountId -> { exempt, vatable }
  let total = 0;

  for (const a of assessments) {
    const gross = Number(a.grossAmount);
    if (gross <= 0) continue;

    const share = round2(gross / months);
    const parts = a.lines.map((l) => ({
      accountId: l.accountId,
      vatCode:   l.vatCode,
      amount:    round2(share * (Number(l.amount) / gross)),
    }));

    // Keep this assessment's parts summing to its monthly share.
    const allocated = round2(parts.reduce((s, p) => s + p.amount, 0));
    const drift = round2(share - allocated);
    if (drift !== 0 && parts.length) {
      let biggest = 0;
      for (let i = 1; i < parts.length; i++) if (parts[i].amount > parts[biggest].amount) biggest = i;
      parts[biggest].amount = round2(parts[biggest].amount + drift);
    }

    for (const p of parts) {
      if (p.amount === 0) continue;
      const slot = byAccount[p.accountId] || (byAccount[p.accountId] = { exempt: 0, vatable: 0 });
      if (p.vatCode === 'VAT') slot.vatable = round2(slot.vatable + p.amount);
      else                     slot.exempt  = round2(slot.exempt  + p.amount);
    }
    total = round2(total + share);
  }

  // A VATable fee was assessed VAT-inclusive, so recognising it splits the
  // gross into revenue and output VAT — the same treatment billInstallment
  // applies when an invoice is raised.
  const credits = [];
  let vatTotal = 0;
  for (const [accountId, slot] of Object.entries(byAccount)) {
    let revenue = slot.exempt;
    if (slot.vatable > 0) {
      const v = computeVAT(slot.vatable, true); // inclusive
      revenue = round2(revenue + v.base);
      vatTotal = round2(vatTotal + v.vat);
    }
    if (revenue > 0) credits.push({ accountId: Number(accountId), credit: revenue });
  }
  if (vatTotal > 0) credits.push({ accountCode: schoolInvoice.OUTPUT_VAT, credit: vatTotal, description: 'Output VAT' });

  return { total, credits, assessmentCount: assessments.length, months };
}

/**
 * What a period would recognise, without posting it.
 */
exports.previewAmortization = async (req, res, next) => {
  try {
    const { schoolYearId, period } = req.query;
    if (!period || !PERIOD_RE.test(period)) throw createError('A period in YYYY-MM form is required', 400);

    const revenuePolicy = await policy.getPolicy(req.businessId);
    if (revenuePolicy !== policy.ON_ASSESSMENT) {
      return res.json({
        applicable: false,
        policy: revenuePolicy,
        message: 'This business recognises revenue as each installment is billed, so there is nothing to amortise.',
      });
    }

    const schoolYear = schoolYearId
      ? await prisma.schoolYear.findFirst({ where: { id: Number(schoolYearId), businessId: req.businessId } })
      : await prisma.schoolYear.findFirst({ where: { businessId: req.businessId, isCurrent: true } });
    if (!schoolYear) throw createError('No school year selected and none marked as current', 400);

    const periods = periodsFor(schoolYear);
    if (!periods.includes(period)) {
      throw createError(
        `${period} falls outside ${schoolYear.code} (${periods[0]} to ${periods[periods.length - 1]})`, 400
      );
    }

    const already = await prisma.amortizationRun.findUnique({
      where: { businessId_schoolYearId_period: { businessId: req.businessId, schoolYearId: schoolYear.id, period } },
    });

    const { total, credits, assessmentCount, months } = await buildRecognition(req.businessId, schoolYear);
    const accounts = await prisma.account.findMany({
      where: { id: { in: credits.filter((c) => c.accountId).map((c) => c.accountId) } },
      select: { id: true, accountCode: true, accountName: true },
    });
    const byId = Object.fromEntries(accounts.map((a) => [a.id, a]));

    res.json({
      applicable: true,
      policy: revenuePolicy,
      schoolYear: { id: schoolYear.id, code: schoolYear.code },
      period, months, assessmentCount,
      alreadyRun: already ? { runAt: already.runAt, amount: Number(already.amount) } : null,
      total,
      lines: credits.map((c) => ({
        accountCode: c.accountId ? byId[c.accountId]?.accountCode : c.accountCode,
        accountName: c.accountId ? byId[c.accountId]?.accountName : 'Output VAT Payable',
        amount: c.credit,
      })),
      periods,
    });
  } catch (err) { next(err); }
};

/**
 * Post one month's recognition.
 *
 * Idempotent by construction: the unique (business, school year, period) row is
 * written in the same transaction as the run record, so a second attempt at the
 * same month is refused rather than doubling revenue.
 */
exports.runAmortization = async (req, res, next) => {
  try {
    const { schoolYearId, period } = req.body;
    if (!period || !PERIOD_RE.test(period)) throw createError('A period in YYYY-MM form is required', 400);

    const revenuePolicy = await policy.getPolicy(req.businessId);
    if (revenuePolicy !== policy.ON_ASSESSMENT) {
      throw createError(
        'This business recognises revenue as each installment is billed. There is no deferred tuition to amortise.', 400
      );
    }

    const schoolYear = schoolYearId
      ? await prisma.schoolYear.findFirst({ where: { id: Number(schoolYearId), businessId: req.businessId } })
      : await prisma.schoolYear.findFirst({ where: { businessId: req.businessId, isCurrent: true } });
    if (!schoolYear) throw createError('No school year selected and none marked as current', 400);

    const periods = periodsFor(schoolYear);
    if (!periods.includes(period)) {
      throw createError(`${period} falls outside ${schoolYear.code}`, 400);
    }

    const already = await prisma.amortizationRun.findUnique({
      where: { businessId_schoolYearId_period: { businessId: req.businessId, schoolYearId: schoolYear.id, period } },
    });
    if (already) {
      throw createError(
        `${period} was already recognised on ${new Date(already.runAt).toISOString().slice(0, 10)} ` +
        `for ₱${Number(already.amount).toLocaleString()}. Running it again would double the revenue.`, 409
      );
    }

    const entryDate = periodEnd(period);
    await schoolInvoice.assertPostable(req.businessId, entryDate);

    const { total, credits, assessmentCount } = await buildRecognition(req.businessId, schoolYear);
    if (total <= 0) {
      return res.json({
        recognised: 0, assessmentCount,
        message: 'Nothing to recognise — no issued assessments for this school year.',
      });
    }

    const reference = `AMORT-${schoolYear.code}-${period}`;
    const entry = await glPost.post({
      entryDate,
      description: `Tuition Revenue Recognition — ${schoolYear.code} ${period}`,
      reference,
      lines: [
        { accountCode: schoolInvoice.UNEARNED, debit: total, description: `Recognise ${period}` },
        ...credits,
      ],
      userId: req.user?.id || 1,
      businessId: req.businessId,
    });

    // glPost.post returns a skip marker instead of an entry when the date falls
    // before the books start. assertPostable above should have caught that, so
    // reaching here means something changed underneath us — do not record a run
    // that has no journal entry behind it.
    if (!entry || entry.skipped) {
      throw createError('The entry could not be posted to the general ledger. Nothing was recorded.', 422);
    }

    await prisma.amortizationRun.create({
      data: {
        businessId: req.businessId,
        schoolYearId: schoolYear.id,
        period, amount: total,
        entryCount: assessmentCount,
        reference,
        runBy: req.user?.id || null,
      },
    });

    await recordAudit({
      action: 'CREATE', entity: 'JournalEntry', entityId: String(entry.id),
      summary: `Recognised ₱${total.toLocaleString()} tuition revenue for ${period} (${assessmentCount} assessments)`,
      user: req.user, businessId: req.businessId,
    });

    res.json({
      recognised: total,
      assessmentCount,
      entryNo: entry.entryNo,
      period,
      message: `Recognised ₱${total.toLocaleString()} for ${period} across ${assessmentCount} assessment${assessmentCount === 1 ? '' : 's'}.`,
    });
  } catch (err) { next(err); }
};

/** History of what has been recognised, and what is still deferred. */
exports.listAmortization = async (req, res, next) => {
  try {
    const { schoolYearId } = req.query;
    const revenuePolicy = await policy.getPolicy(req.businessId);

    const schoolYear = schoolYearId
      ? await prisma.schoolYear.findFirst({ where: { id: Number(schoolYearId), businessId: req.businessId } })
      : await prisma.schoolYear.findFirst({ where: { businessId: req.businessId, isCurrent: true } });

    if (!schoolYear) {
      return res.json({ applicable: revenuePolicy === policy.ON_ASSESSMENT, policy: revenuePolicy, runs: [], periods: [] });
    }

    const runs = await prisma.amortizationRun.findMany({
      where: { businessId: req.businessId, schoolYearId: schoolYear.id },
      orderBy: { period: 'asc' },
    });
    const done = new Set(runs.map((r) => r.period));

    const assessed = await prisma.assessment.aggregate({
      where: {
        businessId: req.businessId,
        status: { in: ['POSTED', 'PARTIALLY_PAID', 'PAID'] },
        enrollment: { schoolYearId: schoolYear.id, status: { in: ['ASSESSED', 'PARTIALLY_PAID', 'ENROLLED'] } },
      },
      _sum: { grossAmount: true },
    });
    const totalGross = Number(assessed._sum.grossAmount || 0);
    const recognised = round2(runs.reduce((s, r) => s + Number(r.amount), 0));

    res.json({
      applicable: revenuePolicy === policy.ON_ASSESSMENT,
      policy: revenuePolicy,
      schoolYear: { id: schoolYear.id, code: schoolYear.code },
      periods: periodsFor(schoolYear).map((p) => ({
        period: p,
        run: runs.find((r) => r.period === p) || null,
        done: done.has(p),
      })),
      totals: {
        assessedGross: round2(totalGross),
        recognised,
        deferred: round2(totalGross - recognised),
      },
    });
  } catch (err) { next(err); }
};

// ── Policy ─────────────────────────────────────────────────────────────────

exports.getRevenuePolicy = async (req, res, next) => {
  try {
    const current = await policy.getPolicy(req.businessId);
    const issued = await prisma.assessment.count({
      where: { businessId: req.businessId, status: { in: ['POSTED', 'PARTIALLY_PAID', 'PAID'] } },
    });
    res.json({
      policy: current,
      locked: issued > 0,
      issuedCount: issued,
      options: [
        {
          value: policy.ON_BILLING,
          label: 'Recognise as billed',
          description:
            'The assessment posts nothing. Each installment becomes an invoice that debits receivables and ' +
            'credits revenue on its due date. AR aging stays honest and there is no deferred balance to maintain.',
        },
        {
          value: policy.ON_ASSESSMENT,
          label: 'Defer and amortise',
          description:
            'Issuing an assessment books the full year to receivables against Unearned Tuition Income. ' +
            'Invoices become billing notices only, and a monthly run moves deferred income into revenue.',
        },
      ],
    });
  } catch (err) { next(err); }
};

exports.setRevenuePolicy = async (req, res, next) => {
  try {
    const value = await policy.setPolicy(req.businessId, req.body.policy);
    await recordAudit({
      action: 'UPDATE', entity: 'SystemSetting', entityId: policy.SETTING_KEY,
      summary: `Revenue policy set to ${value}`,
      user: req.user, businessId: req.businessId,
    });
    res.json({ policy: value, message: `Revenue policy set to ${value === policy.ON_BILLING ? 'recognise as billed' : 'defer and amortise'}.` });
  } catch (err) { next(err); }
};
