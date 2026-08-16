const express = require('express');
const router = express.Router();
const caseController = require('../controllers/caseController');
const { isAuthenticated } = require('../middleware/authMiddleware');

// Case Register — accessible to ALL authenticated roles (Admin, Station Commander,
// Investigating Officer, Counter/Intake Officer). The RBAC matrix marks
// "Register New Case" as permitted for every role, so no authorizeRoles() restriction here.
router.use(isAuthenticated);

router.get('/', caseController.getCaseList);
router.get('/new', caseController.getNewCaseForm);
router.post('/', caseController.createCase);

module.exports = router;