const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { recordAudit } = require('../utils/audit');

const signTokens = (user) => {
  const payload = { id: user.id, email: user.email, role: user.role, name: `${user.firstName} ${user.lastName}` };
  const access = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '8h' });
  const refresh = jwt.sign({ id: user.id }, process.env.JWT_REFRESH_SECRET, { expiresIn: '7d' });
  return { access, refresh };
};

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });

    // Generic failure (no user / inactive) — don't reveal which.
    if (!user || !user.isActive) {
      await recordAudit({ req, action: 'LOGIN_FAILED', entity: 'User', summary: `Failed login for ${email} (unknown or inactive)` });
      throw createError('Invalid credentials', 401);
    }

    // Account lockout check
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const mins = Math.ceil((user.lockedUntil - new Date()) / 60000);
      await recordAudit({ req, action: 'LOGIN_BLOCKED', entity: 'User', entityId: user.id, userEmail: user.email, summary: `Login blocked — account locked (${mins}m remaining)` });
      throw createError(`Account locked due to too many failed attempts. Try again in ${mins} minute(s).`, 423);
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      const attempts = user.failedLoginAttempts + 1;
      const shouldLock = attempts >= MAX_FAILED_ATTEMPTS;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: attempts,
          lockedUntil: shouldLock ? new Date(Date.now() + LOCK_MINUTES * 60000) : null,
        },
      });
      await recordAudit({
        req, action: shouldLock ? 'ACCOUNT_LOCKED' : 'LOGIN_FAILED', entity: 'User',
        entityId: user.id, user: { id: user.id, email: user.email },
        summary: shouldLock
          ? `Account locked after ${attempts} failed attempts`
          : `Failed login attempt ${attempts}/${MAX_FAILED_ATTEMPTS}`,
      });
      throw createError('Invalid credentials', 401);
    }

    // Success — reset counters, stamp login
    const tokens = signTokens(user);
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), failedLoginAttempts: 0, lockedUntil: null },
    });
    await recordAudit({ req, action: 'LOGIN', entity: 'User', entityId: user.id, user: { id: user.id, email: user.email }, summary: 'Successful login' });

    res.json({
      user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role },
      accessToken: tokens.access,
      refreshToken: tokens.refresh,
    });
  } catch (err) { next(err); }
};

// Public self-signup. The role is fixed server-side — never taken from the
// request — and the account starts with no business, so it can see no data
// until it creates its own company (see businessController.onboard).
exports.register = async (req, res, next) => {
  try {
    if (process.env.ALLOW_SIGNUP === 'false') throw createError('Sign-up is disabled', 403);
    const { email, password, firstName, lastName } = req.body;

    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw createError('An account with this email already exists', 409);

    const hashed = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { email, password: hashed, firstName, lastName, role: 'MANAGER', lastLoginAt: new Date() },
    });
    await recordAudit({ req, action: 'REGISTER', entity: 'User', entityId: user.id, user: { id: user.id, email: user.email }, summary: `Self-registered ${user.email}` });

    const tokens = signTokens(user);
    res.status(201).json({
      user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role },
      accessToken: tokens.access,
      refreshToken: tokens.refresh,
    });
  } catch (err) { next(err); }
};

exports.refreshToken = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) throw createError('Refresh token required', 401);
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user || !user.isActive) throw createError('User not found', 401);
    const tokens = signTokens(user);
    res.json({ accessToken: tokens.access, refreshToken: tokens.refresh });
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return next(createError('Invalid refresh token', 401));
    }
    next(err);
  }
};

exports.getMe = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, lastLoginAt: true },
    });
    res.json(user);
  } catch (err) { next(err); }
};

exports.logout = (req, res) => {
  // Stateless JWT — client discards token; implement token blacklist for stricter needs
  recordAudit({ req, action: 'LOGOUT', entity: 'User', entityId: req.user?.id, summary: 'User logged out' });
  res.json({ message: 'Logged out successfully' });
};

exports.changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) throw createError('Current password is incorrect', 400);
    const hashed = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: req.user.id }, data: { password: hashed } });
    await recordAudit({ req, action: 'PASSWORD_CHANGE', entity: 'User', entityId: req.user.id, summary: 'User changed own password' });
    res.json({ message: 'Password changed successfully' });
  } catch (err) { next(err); }
};

// ─── Forgot / Reset Password ───────────────────────────────
// Generates a single-use, time-limited token. The raw token is returned only
// when no email transport is configured (dev) so the flow is testable; in
// production it is delivered via email and never exposed in the response.
const crypto = require('crypto');

exports.forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });

    // Always respond success to avoid email enumeration.
    if (user && user.isActive) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
      await prisma.user.update({
        where: { id: user.id },
        data: { resetToken: hashedToken, resetTokenExpiry: new Date(Date.now() + 60 * 60 * 1000) }, // 1h
      });
      await recordAudit({ req, action: 'PASSWORD_RESET_REQUEST', entity: 'User', entityId: user.id, user: { id: user.id, email: user.email }, summary: 'Password reset requested' });

      // Try to email; if no transport configured, expose token in dev only.
      let emailed = false;
      try {
        const { sendPasswordReset } = require('../utils/mailer');
        emailed = await sendPasswordReset(user, rawToken);
      } catch (_) { /* mailer optional */ }

      if (!emailed && process.env.NODE_ENV !== 'production') {
        return res.json({ message: 'Reset token generated (dev mode).', devResetToken: rawToken });
      }
    }
    res.json({ message: 'If that email exists, a password reset link has been sent.' });
  } catch (err) { next(err); }
};

exports.resetPassword = async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
    const user = await prisma.user.findFirst({
      where: { resetToken: hashedToken, resetTokenExpiry: { gt: new Date() } },
    });
    if (!user) throw createError('Invalid or expired reset token', 400);

    const hashed = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashed, resetToken: null, resetTokenExpiry: null, failedLoginAttempts: 0, lockedUntil: null },
    });
    await recordAudit({ req, action: 'PASSWORD_RESET', entity: 'User', entityId: user.id, user: { id: user.id, email: user.email }, summary: 'Password reset completed' });
    res.json({ message: 'Password has been reset. You can now log in.' });
  } catch (err) { next(err); }
};

exports.listUsers = async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true, lastLoginAt: true },
      orderBy: { firstName: 'asc' },
    });
    res.json(users);
  } catch (err) { next(err); }
};

exports.createUser = async (req, res, next) => {
  try {
    const { email, password, firstName, lastName, role } = req.body;
    const hashed = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { email, password: hashed, firstName, lastName, role },
      select: { id: true, email: true, firstName: true, lastName: true, role: true },
    });
    await recordAudit({ req, action: 'CREATE', entity: 'User', entityId: user.id, summary: `Created user ${user.email} (${user.role})` });
    res.status(201).json(user);
  } catch (err) { next(err); }
};
