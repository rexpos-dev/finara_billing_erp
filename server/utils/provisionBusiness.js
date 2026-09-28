const crypto = require('crypto');
const prisma = require('../config/database');
const { cloneChartOfAccounts } = require('./cloneChartOfAccounts');
const { COMPANY_TYPES, TRADING_RETIRE_CODES } = require('./companyTypes');
const { setupSchool } = require('../../prisma/seedSchool');
const requireSchool = require('../middleware/requireSchool');

// Type-specific setup on top of the cloned COA. A school gets the school COA,
// fee types, grade levels and payment schemes; any other type has the School
// module hidden for THIS business only; TRADING also drops the agency-only
// accounts. Never touches other businesses.
async function provisionByType(businessId, companyType) {
  if (companyType === 'TRADING') {
    await prisma.account.updateMany({
      where: { businessId, accountCode: { in: TRADING_RETIRE_CODES } },
      data:  { isActive: false },
    });
  }
  if (companyType === 'SCHOOL') {
    await setupSchool(businessId, { hideFromOthers: false });
    requireSchool.clearCache(businessId);
  } else {
    await prisma.systemSetting.upsert({
      where:  { businessId_key: { businessId, key: 'disabledModules' } },
      update: { value: JSON.stringify(['school']) },
      create: { businessId, key: 'disabledModules', value: JSON.stringify(['school']) },
    });
  }
}

// Undo a half-built company so a failed setup doesn't leave an orphan behind.
async function rollbackBusiness(businessId) {
  const swallow = () => {};
  await prisma.userBusiness.deleteMany({ where: { businessId } }).catch(swallow);
  await prisma.systemSetting.deleteMany({ where: { businessId } }).catch(swallow);
  for (const m of ['feeType', 'gradeLevel', 'paymentScheme']) {
    await prisma[m].deleteMany({ where: { businessId } }).catch(swallow);
  }
  await prisma.account.deleteMany({ where: { businessId, parentId: { not: null } } }).catch(swallow);
  await prisma.account.deleteMany({ where: { businessId } }).catch(swallow);
  await prisma.business.delete({ where: { id: businessId } }).catch(swallow);
}

// A company owned by exactly one user (self-service onboarding and approved
// orders). Callers validate companyType/taxType first.
async function createProvisionedBusiness({
  name, tin, address, phone, email, companyType, taxType, booksStartDate, ownerUserId, paidUntil = null,
}) {
  const code = `BIZ-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const biz = await prisma.business.create({
    data: {
      code, name: String(name).trim(), tin, address, phone, email,
      industry: COMPANY_TYPES[companyType].label,
      taxType,
      booksStartDate: booksStartDate ? new Date(booksStartDate) : null,
      ...(paidUntil && { paidUntil }),
    },
  });

  try {
    await cloneChartOfAccounts(1, biz.id);
    await prisma.userBusiness.create({ data: { userId: ownerUserId, businessId: biz.id } });
    await provisionByType(biz.id, companyType);
  } catch (err) {
    await rollbackBusiness(biz.id);
    throw err;
  }
  return biz;
}

module.exports = { provisionByType, rollbackBusiness, createProvisionedBusiness };
