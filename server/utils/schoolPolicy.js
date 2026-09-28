/**
 * schoolPolicy.js — Which revenue policy a school business runs on.
 *
 * Two ways to put a year of tuition on the books. They are mutually exclusive,
 * and switching mid-year would double-count, so the setting is guarded.
 *
 *   ON_BILLING (default)
 *     The assessment posts nothing. Each installment becomes an invoice that
 *     debits AR and credits revenue on its due date. Revenue is earned in the
 *     month it is billed, AR aging is honest, and no deferred balance exists.
 *
 *   ON_ASSESSMENT
 *     Issuing the assessment books the whole year at once:
 *       DR Accounts Receivable — Students   (what the parent will pay)
 *       DR Tuition Discounts & Scholarships (what was given away)
 *       DR Receivable — DepEd ESC           (what DepEd will pay)
 *         CR Unearned Tuition Income        (the gross assessment)
 *     Invoices then act purely as billing notices and post nothing, and a
 *     monthly amortisation run moves Unearned Tuition into revenue.
 *
 * Under ON_ASSESSMENT the AR control account holds the full year while the
 * invoice subledger holds only what has been billed so far, so the two do not
 * agree by design. The delinquency report reads installments instead of
 * invoices under that policy — see schoolReportsController.
 */

const prisma = require('../config/database');

const ON_BILLING    = 'ON_BILLING';
const ON_ASSESSMENT = 'ON_ASSESSMENT';
const POLICIES = [ON_BILLING, ON_ASSESSMENT];
const SETTING_KEY = 'school.revenuePolicy';

// Cache per business. Cleared whenever the policy is written.
const _cache = {};

async function getPolicy(businessId) {
  if (Object.prototype.hasOwnProperty.call(_cache, businessId)) return _cache[businessId];
  const row = await prisma.systemSetting.findUnique({
    where: { businessId_key: { businessId: Number(businessId), key: SETTING_KEY } },
  });
  const value = POLICIES.includes(row?.value) ? row.value : ON_BILLING;
  _cache[businessId] = value;
  return value;
}

function clearCache(businessId) {
  if (businessId == null) {
    for (const k of Object.keys(_cache)) delete _cache[k];
  } else {
    delete _cache[businessId];
    delete _cache[Number(businessId)];
  }
}

/**
 * Change the policy.
 *
 * Refused once anything has been issued for the business: the two policies
 * post fundamentally different entries, so switching with live assessments on
 * the books would leave revenue either double-counted or never recognised at
 * all. Cancel or finish the existing year first.
 */
async function setPolicy(businessId, value) {
  if (!POLICIES.includes(value)) {
    const err = new Error(`Unknown revenue policy "${value}"`);
    err.statusCode = 400;
    throw err;
  }

  const current = await getPolicy(businessId);
  if (current !== value) {
    const issued = await prisma.assessment.count({
      where: { businessId: Number(businessId), status: { in: ['POSTED', 'PARTIALLY_PAID', 'PAID'] } },
    });
    if (issued > 0) {
      const err = new Error(
        `Cannot switch revenue policy: ${issued} assessment${issued === 1 ? ' has' : 's have'} already been issued ` +
        `under ${current}. The two policies post different entries, so switching now would leave revenue ` +
        `double-counted or unrecognised. Cancel the outstanding assessments, or wait until the school year closes.`
      );
      err.statusCode = 409;
      throw err;
    }
  }

  await prisma.systemSetting.upsert({
    where:  { businessId_key: { businessId: Number(businessId), key: SETTING_KEY } },
    update: { value },
    create: { businessId: Number(businessId), key: SETTING_KEY, value },
  });
  clearCache(businessId);
  return value;
}

module.exports = {
  getPolicy, setPolicy, clearCache,
  ON_BILLING, ON_ASSESSMENT, POLICIES, SETTING_KEY,
};
