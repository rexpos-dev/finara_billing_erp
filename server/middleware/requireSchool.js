/**
 * requireSchool.js — Refuse school billing on a business that is not set up
 * for it.
 *
 * The module toggle in Settings hides the nav for most roles, but SUPER_ADMIN
 * sees every module regardless, and the API has never enforced it at all. So an
 * admin can reach School → Students while an advertising agency is the active
 * business, register a student there, and only discover the problem when an
 * assessment is issued: glPost cannot find account 1110 in that COA, safePost
 * swallows the error into a GL_POST_FAILED audit row, and the invoice ends up
 * on the books with no journal entry behind it.
 *
 * Failing here, before anything is written, is far cheaper than unpicking that.
 */

const prisma = require('../config/database');

const SETTING_KEY = 'school.enabled';

// Cache per business; cleared by the seed's flag write on the next restart,
// which is soon enough for a value that changes once in a business's lifetime.
const _cache = {};

function clearCache(businessId) {
  if (businessId == null) {
    for (const k of Object.keys(_cache)) delete _cache[k];
  } else {
    delete _cache[businessId];
    delete _cache[Number(businessId)];
  }
}

async function isSchool(businessId) {
  if (Object.prototype.hasOwnProperty.call(_cache, businessId)) return _cache[businessId];
  const row = await prisma.systemSetting.findUnique({
    where: { businessId_key: { businessId: Number(businessId), key: SETTING_KEY } },
  });
  _cache[businessId] = row?.value === 'true';
  return _cache[businessId];
}

const requireSchool = async (req, res, next) => {
  try {
    if (await isSchool(req.businessId)) return next();

    const business = await prisma.business.findUnique({
      where:  { id: Number(req.businessId) },
      select: { code: true, name: true },
    });
    return res.status(409).json({
      error:
        `School billing is not set up for ${business ? `${business.name} (${business.code})` : `business ${req.businessId}`}. ` +
        `Switch to the school's business, or set this one up by running: ` +
        `node prisma/seedSchool.js --business=${req.businessId}`,
      code: 'SCHOOL_NOT_ENABLED',
      businessId: req.businessId,
    });
  } catch (err) { next(err); }
};

module.exports = requireSchool;
module.exports.clearCache = clearCache;
module.exports.isSchool = isSchool;
module.exports.SETTING_KEY = SETTING_KEY;
