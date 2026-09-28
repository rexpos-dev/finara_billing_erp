const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/authController');
const { authenticate, authorize } = require('../middleware/auth');
const validate = require('../middleware/validate');

router.post('/login',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 6 }),
  ],
  validate,
  ctrl.login
);

// Public self-signup. Creates an empty account (no business) — the user then
// creates their own company at /onboarding.
router.post('/register',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 })
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage('Password must have uppercase, lowercase, and number'),
    body('firstName').notEmpty().trim(),
    body('lastName').notEmpty().trim(),
  ],
  validate,
  ctrl.register
);

router.post('/refresh', ctrl.refreshToken);

router.post('/forgot-password',
  [ body('email').isEmail().normalizeEmail() ],
  validate,
  ctrl.forgotPassword
);

router.post('/reset-password',
  [
    body('token').notEmpty(),
    body('newPassword').isLength({ min: 8 })
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage('Password must have uppercase, lowercase, and number'),
  ],
  validate,
  ctrl.resetPassword
);

router.get('/me', authenticate, ctrl.getMe);
router.post('/logout', authenticate, ctrl.logout);
router.put('/change-password', authenticate,
  [
    body('currentPassword').notEmpty(),
    body('newPassword').isLength({ min: 8 })
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage('Password must have uppercase, lowercase, and number'),
  ],
  validate,
  ctrl.changePassword
);

// Admin only
router.get('/users', authenticate, authorize('ADMIN'), ctrl.listUsers);
router.post('/users',
  authenticate,
  authorize('ADMIN'),
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }),
    body('firstName').notEmpty().trim(),
    body('lastName').notEmpty().trim(),
    body('role').isIn(['ADMIN', 'MANAGER', 'ACCOUNTANT', 'VIEWER']),
  ],
  validate,
  ctrl.createUser
);

module.exports = router;
