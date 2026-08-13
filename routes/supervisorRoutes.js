const express = require('express');
const router = express.Router();
const supervisorController = require('../controllers/supervisorController');
const { isAuthenticated, authorizeRoles } = require('../middleware/authMiddleware');

// Protect all endpoints for SUPERVISOR and ADMIN roles
router.use(isAuthenticated, authorizeRoles('SUPERVISOR', 'ADMIN'));

// Dashboard & Case Actions
router.get('/dashboard', supervisorController.getDashboard);
router.post('/cases/assign', supervisorController.assignCase);
router.post('/cases/approve-status', supervisorController.processStatusApproval);

// Analytics & Hotspot Reports
router.get('/analytics', supervisorController.getAnalytics);
router.get('/api/analytics-data', supervisorController.getAnalyticsData);

module.exports = router;