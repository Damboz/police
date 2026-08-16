const express = require('express');
const router = express.Router();

// Updated controller import matching your project structure
const adminController = require('../controllers/adminController');
const { isAuthenticated, isAdmin } = require('../middleware/authMiddleware');

// Protect all admin endpoints with authentication & role checks
router.use(isAuthenticated, isAdmin);

// Admin Dashboard
router.get('/dashboard', adminController.getAdminDashboard);

// User Management
router.get('/users', adminController.getUsers);
router.get('/users/create', adminController.getCreateUser);
router.post('/users/create', adminController.postCreateUser);

// Edit User Profile & Roles
router.get('/users/:id/edit', adminController.getEditUser);
router.post('/users/:id/edit', adminController.postEditUser);

// Password Reset
router.post('/users/:id/reset-password', adminController.postResetPassword);

// Status Toggle (Deactivate / Activate)
router.post('/users/:id/toggle-status', adminController.toggleUserStatus);

// System Audit Logs
router.get('/audit-logs', adminController.getAuditLogs);

module.exports = router;