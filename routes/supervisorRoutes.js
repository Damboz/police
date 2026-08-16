const express = require('express');
const router = express.Router();
const supervisorController = require('../controllers/supervisorController');
const { isAuthenticated, authorizeRoles } = require('../middleware/authMiddleware');

// Protect all endpoints for Station Commander and Admin roles
router.use(isAuthenticated, authorizeRoles('Station Commander', 'Admin'));

// Dashboard & Case Actions
router.get('/dashboard', supervisorController.getDashboard);
router.post('/cases/assign', supervisorController.assignCase);
router.post('/cases/approve-status', supervisorController.processStatusApproval);

// Analytics & Hotspot Reports
router.get('/analytics', supervisorController.getAnalytics);
router.get('/api/analytics-data', supervisorController.getAnalyticsData);

// PDF Report Exports
router.get('/reports/station-performance', supervisorController.exportStationPerformancePDF);
router.get('/reports/crime-statistics', supervisorController.exportCrimeStatsPDF);
router.get('/reports/officer-productivity', supervisorController.exportOfficerProductivityPDF);

module.exports = router;