const router = require('express').Router();
const { body, param, query } = require('express-validator');
const setup = require('../controllers/schoolSetupController');
const students = require('../controllers/studentController');
const assessments = require('../controllers/assessmentController');
const billing = require('../controllers/schoolBillingController');
const reports = require('../controllers/schoolReportsController');
const amortization = require('../controllers/amortizationController');
const adjustments = require('../controllers/billingAdjustmentController');
const { authenticate, authorize, resolveBusiness } = require('../middleware/auth');
const requireSchool = require('../middleware/requireSchool');
const validate = require('../middleware/validate');

// requireSchool runs on every route: a business with no school chart of
// accounts cannot post a single school entry, so letting one through here only
// defers the failure to somewhere far less obvious.
router.use(authenticate, resolveBusiness, requireSchool);

const canEdit = authorize('ADMIN', 'MANAGER', 'ACCOUNTANT');
const canSetup = authorize('ADMIN', 'MANAGER');

// ── Setup: school years ────────────────────────────────────────────────────
router.get('/school-years', setup.listSchoolYears);
router.post('/school-years', canSetup,
  [
    body('code').notEmpty().trim(),
    body('name').notEmpty().trim(),
    body('startDate').isISO8601(),
    body('endDate').isISO8601(),
  ],
  validate, setup.createSchoolYear);
router.put('/school-years/:id', canSetup, param('id').isInt(), validate, setup.updateSchoolYear);

// ── Setup: grade levels ────────────────────────────────────────────────────
router.get('/grade-levels', setup.listGradeLevels);
router.post('/grade-levels', canSetup,
  [
    body('code').notEmpty().trim(),
    body('name').notEmpty().trim(),
    body('stage').isIn(['PRESCHOOL', 'ELEMENTARY', 'JHS', 'SHS']),
  ],
  validate, setup.createGradeLevel);
router.put('/grade-levels/:id', canSetup, param('id').isInt(), validate, setup.updateGradeLevel);

// ── Setup: sections ────────────────────────────────────────────────────────
router.get('/sections', setup.listSections);
router.post('/sections', canSetup,
  [body('schoolYearId').isInt(), body('gradeLevelId').isInt(), body('name').notEmpty().trim()],
  validate, setup.createSection);
router.put('/sections/:id', canSetup, param('id').isInt(), validate, setup.updateSection);

// ── Setup: fee types ───────────────────────────────────────────────────────
router.get('/fee-types', setup.listFeeTypes);
router.post('/fee-types', canSetup,
  [
    body('code').notEmpty().trim(),
    body('name').notEmpty().trim(),
    body('category').isIn(['TUITION', 'MISCELLANEOUS', 'BOOKS', 'UNIFORM', 'OTHER']),
    body('accountId').isInt(),
    body('vatCode').optional().isIn(['VAT', 'EXEMPT', 'ZERO']),
  ],
  validate, setup.createFeeType);
router.put('/fee-types/:id', canSetup, param('id').isInt(), validate, setup.updateFeeType);

// ── Setup: fee structures ──────────────────────────────────────────────────
router.get('/fee-structures', setup.listFeeStructures);
router.get('/fee-structures/:id', param('id').isInt(), validate, setup.getFeeStructure);
router.post('/fee-structures', canSetup,
  [
    body('schoolYearId').isInt(),
    body('gradeLevelId').isInt(),
    body('name').notEmpty().trim(),
    body('lines').isArray({ min: 1 }),
    body('lines.*.feeTypeId').isInt(),
    body('lines.*.amount').isFloat({ min: 0 }),
  ],
  validate, setup.saveFeeStructure);
router.post('/fee-structures/clone', canSetup,
  [body('fromSchoolYearId').isInt(), body('toSchoolYearId').isInt()],
  validate, setup.cloneFeeStructures);

// ── Setup: payment schemes ─────────────────────────────────────────────────
router.get('/payment-schemes', setup.listPaymentSchemes);
router.post('/payment-schemes', canSetup,
  [body('code').notEmpty().trim(), body('name').notEmpty().trim(), body('installmentCount').isInt({ min: 1 })],
  validate, setup.createPaymentScheme);
router.put('/payment-schemes/:id', canSetup, param('id').isInt(), validate, setup.updatePaymentScheme);

// ── Students ───────────────────────────────────────────────────────────────
router.get('/students', students.listStudents);
router.get('/students/:id', param('id').isInt(), validate, students.getStudent);
router.get('/students/:id/ledger', param('id').isInt(), validate, students.getLedger);
router.post('/students', canEdit,
  [body('lastName').notEmpty().trim(), body('firstName').notEmpty().trim()],
  validate, students.createStudent);
router.put('/students/:id', canEdit, param('id').isInt(), validate, students.updateStudent);
router.put('/students/:id/guardians', canEdit,
  [param('id').isInt(), body('guardians').isArray()],
  validate, students.saveGuardians);
router.post('/students/import', canSetup,
  [body('rows').isArray({ min: 1 })],
  validate, students.importStudents);

// ── Enrollment & assessment ────────────────────────────────────────────────
router.post('/enrollments/preview',
  [
    body('studentId').isInt(),
    body('schoolYearId').isInt(),
    body('gradeLevelId').isInt(),
    body('paymentSchemeId').isInt(),
  ],
  validate, assessments.previewAssessment);
router.post('/enrollments', canEdit,
  [
    body('studentId').isInt(),
    body('schoolYearId').isInt(),
    body('gradeLevelId').isInt(),
    body('paymentSchemeId').isInt(),
  ],
  validate, assessments.createEnrollment);

router.get('/assessments', assessments.listAssessments);
router.get('/assessments/:id', param('id').isInt(), validate, assessments.getAssessment);
router.post('/assessments/:id/issue', canEdit, param('id').isInt(), validate, assessments.issueAssessment);
router.post('/assessments/:id/cancel', canSetup, param('id').isInt(), validate, assessments.cancelEnrollment);
router.post('/assessments/:id/email', canEdit, param('id').isInt(), validate, assessments.emailAssessment);

// ── Billing run ────────────────────────────────────────────────────────────
router.get('/billing/preview', query('upTo').isISO8601(), validate, billing.previewBillingRun);
router.post('/billing/run', canEdit, body('upTo').isISO8601(), validate, billing.runBilling);

// ── Cashier ────────────────────────────────────────────────────────────────
router.get('/collections/:studentId/payables', param('studentId').isInt(), validate, billing.getPayableItems);
router.post('/collections', canEdit,
  [
    body('studentId').isInt(),
    body('amount').isFloat({ min: 0.01 }),
    body('paymentMethod').notEmpty(),
  ],
  validate, billing.recordCollection);
router.post('/collections/:studentId/apply-advances', canEdit,
  param('studentId').isInt(), validate, billing.applyAdvances);

// ── Subsidies ──────────────────────────────────────────────────────────────
router.get('/subsidies', billing.listSubsidies);
router.post('/subsidies/receive', canEdit,
  body('subsidyIds').isArray({ min: 1 }), validate, billing.receiveSubsidy);

// ── Revenue policy & amortisation ──────────────────────────────────────────
router.get('/revenue-policy', amortization.getRevenuePolicy);
router.put('/revenue-policy', canSetup,
  body('policy').isIn(['ON_BILLING', 'ON_ASSESSMENT']), validate, amortization.setRevenuePolicy);

router.get('/amortization', amortization.listAmortization);
router.get('/amortization/preview', query('period').matches(/^\d{4}-(0[1-9]|1[0-2])$/), validate, amortization.previewAmortization);
router.post('/amortization/run', canEdit,
  body('period').matches(/^\d{4}-(0[1-9]|1[0-2])$/), validate, amortization.runAmortization);

// ── Student ledger ─────────────────────────────────────────────────────────
router.get('/ledger/:studentId', param('studentId').isInt(), validate, adjustments.getStudentLedger);
router.post('/ledger/:studentId/rebuild', canSetup, param('studentId').isInt(), validate, adjustments.rebuildStudentLedger);

// ── Adjustments & credit memos ─────────────────────────────────────────────
router.get('/adjustments', adjustments.listAdjustments);
router.post('/adjustments', canEdit,
  [
    body('studentId').isInt(),
    body('direction').isIn(['DEBIT', 'CREDIT']),
    body('category').optional().isIn(['CORRECTION', 'PENALTY', 'CREDIT_MEMO', 'WRITE_OFF', 'OTHER']),
    body('accountId').isInt(),
    body('amount').isFloat({ min: 0.01 }),
    body('reason').notEmpty().trim(),
  ],
  validate, adjustments.createAdjustment);
router.post('/adjustments/:id/post', canSetup, param('id').isInt(), validate, adjustments.postAdjustment);
router.post('/adjustments/:id/void', canSetup, param('id').isInt(), validate, adjustments.voidAdjustment);

// ── Refunds ────────────────────────────────────────────────────────────────
router.get('/refunds', adjustments.listRefunds);
router.post('/refunds', canEdit,
  [body('studentId').isInt(), body('amount').isFloat({ min: 0.01 }), body('reason').notEmpty().trim()],
  validate, adjustments.createRefund);
router.post('/refunds/:id/pay', canSetup, param('id').isInt(), validate, adjustments.payRefund);

// ── Gateway settlement ─────────────────────────────────────────────────────
router.get('/clearing', adjustments.getClearing);
router.post('/clearing/settle', canSetup,
  [
    body('method').notEmpty(),
    body('grossAmount').isFloat({ min: 0.01 }),
    body('bankAccountId').isInt(),
  ],
  validate, adjustments.recordSettlement);

// ── Reports ────────────────────────────────────────────────────────────────
router.get('/reports/soa/:studentId', param('studentId').isInt(), validate, reports.statementOfAccount);
router.get('/reports/collections', reports.collectionsReport);
router.get('/reports/delinquency', reports.delinquencyReport);
router.get('/reports/enrollment-summary', reports.enrollmentSummary);

module.exports = router;
