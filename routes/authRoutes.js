const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Login Endpoints
router.get('/login', authController.getLogin);
router.post('/login', authController.postLogin);

// Logout Endpoint
router.get('/logout', authController.logout);

// Password Management Endpoints
router.get('/change-password', authController.getChangePassword);
router.post('/change-password', authController.postChangePassword);

module.exports = router;