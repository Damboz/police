const express = require('express');
const router = express.Router();

// Fixed: Updated to match your 'adminControllers.js' file name
const adminController = require('../controllers/adminControllers');
const { isAuthenticated, isAdmin } = require('../middleware/authMiddleware');

// Protect all admin endpoints with authentication & role checks
router.use(isAuthenticated, isAdmin);

// Admin Dashboard
router.get('/dashboard', adminController.getAdminDashboard);

// User Management
router.get('/users', adminController.getUsers);
router.get('/users/create', adminController.getCreateUser);
router.post('/users/create', adminController.postCreateUser);
router.post('/users/:id/toggle-status', adminController.toggleUserStatus);

// System Audit Logs
router.get('/audit-logs', adminController.getAuditLogs);

module.exports = router;