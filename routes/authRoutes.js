const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { isAuthenticated } = require('../middleware/authMiddleware'); // Ensures user is logged in

// ==========================================
// Public Endpoints
// ==========================================
router.get('/login', authController.getLogin);
router.post('/login', authController.postLogin);

// ==========================================
// Protected Endpoints (Any Authenticated User)
// ==========================================
// Logout Endpoint
router.get('/logout', isAuthenticated, authController.logout);

// Password Management Endpoints
router.get('/change-password', isAuthenticated, authController.getChangePassword);
router.post('/change-password', isAuthenticated, authController.postChangePassword);

module.exports = router;