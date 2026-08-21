const express = require('express');
const router = express.Router();
const caseController = require('../controllers/caseController');
const generalController = require('../controllers/generalController');
const { isAuthenticated } = require('../middleware/authMiddleware');

// Case Register — accessible to ALL authenticated roles (Admin, Station Commander,
// Investigating Officer, Counter/Intake Officer). Fine-grained action permissions
// (who can add notes, evidence, request status changes, etc.) are enforced inside
// generalController.js per case, since they depend on case assignment, not just role.
router.use(isAuthenticated);

// Case Register list & registration
router.get('/', caseController.getCaseList);
router.get('/new', caseController.getNewCaseForm);
router.post('/', caseController.createCase);

// Case Detail Workspace
router.get('/:id', generalController.getCaseDetail);
router.post('/:id/notes', generalController.addCaseNote);
router.post('/:id/request-status', generalController.requestStatusChange);
router.post('/:id/evidence', generalController.addEvidence);
router.post('/:id/suspects', generalController.linkSuspect);
router.post('/:id/victims', generalController.linkVictim);

module.exports = router;