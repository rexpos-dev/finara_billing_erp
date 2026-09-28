const jwt = require('jsonwebtoken');
const prisma = require('../config/database');

const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// Resolves and validates businessId from x-business-id header.
// Must run AFTER authenticate. Attaches req.businessId.
// ADMIN users can access any business; others must be granted access via user_businesses.
const resolveBusiness = async (req, res, next) => {
  try {
    const headerBizId = Number(req.headers['x-business-id']);

    // If no header supplied, fall back to the first business the user has access to
    if (!headerBizId) {
      if (['ADMIN', 'SUPER_ADMIN'].includes(req.user?.role)) {
        // Admin with no header: default to business 1
        req.businessId = 1;
        return next();
      }
      const ub = await prisma.userBusiness.findFirst({
        where: { userId: req.user.id },
        orderBy: { businessId: 'asc' },
      });
      // No business yet (e.g. a fresh self-signup): never fall back to another
      // tenant's data. The client sends these users to /onboarding.
      if (!ub) return res.status(403).json({ error: 'Create your company to get started', code: 'NO_BUSINESS' });
      req.businessId = ub.businessId;
      return next();
    }

    // Admin can switch to any business
    if (['ADMIN', 'SUPER_ADMIN'].includes(req.user?.role)) {
      req.businessId = headerBizId;
      return next();
    }

    // Non-admin: verify they have access to this business
    const ub = await prisma.userBusiness.findUnique({
      where: { userId_businessId: { userId: req.user.id, businessId: headerBizId } },
    });
    if (!ub) {
      return res.status(403).json({ error: 'Access denied to this business' });
    }
    req.businessId = headerBizId;
    next();
  } catch (err) {
    // If user_businesses table doesn't exist yet (migration pending), default to business 1
    if (err.code === 'P2021' || err.message?.includes('user_businesses') || err.message?.includes('does not exist')) {
      req.businessId = 1;
      return next();
    }
    next(err);
  }
};

const authorize = (...roles) => (req, res, next) => {
  // SUPER_ADMIN is a hidden tier above ADMIN — it passes every role check
  // without needing to be listed explicitly at each call site.
  if (req.user?.role === 'SUPER_ADMIN') return next();
  if (!roles.includes(req.user?.role)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  next();
};

module.exports = { authenticate, authorize, resolveBusiness };
