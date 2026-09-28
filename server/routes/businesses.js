const router = require('express').Router();
const { authenticate, authorize, resolveBusiness } = require('../middleware/auth');
const ctrl = require('../controllers/businessController');

const adminOnly = authorize('ADMIN');

// These two work before the user has a business, so they run without
// resolveBusiness (which rejects a user that has none).
router.get('/',            authenticate,     ctrl.list);
router.post('/onboard',    authenticate,     ctrl.onboard);

router.use(authenticate, resolveBusiness);

router.post('/reset-demo', adminOnly,        ctrl.resetDemo);
router.get('/:id',                           ctrl.get);
router.post('/',           adminOnly,        ctrl.create);
router.put('/:id',         adminOnly,        ctrl.update);
router.get('/:id/users',   adminOnly,        ctrl.listUsers);
router.post('/:id/users',  adminOnly,        ctrl.grantUser);
router.delete('/:id/users/:userId', adminOnly, ctrl.revokeUser);

module.exports = router;
