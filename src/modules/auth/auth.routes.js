const express = require('express');

const router = express.Router();

const authController = require('./auth.controller');
const authMiddleware = require('../../middlewares/auth');

// ─────────────────────────────────────────────
// Public Routes
// ─────────────────────────────────────────────
router.post('/register', authController.register);
router.post('/login', authController.login);

// ─────────────────────────────────────────────
// Protected Routes
// ─────────────────────────────────────────────

// Get current logged in user
router.get(
  '/user/me',
  authMiddleware,
  authController.getMe
);

// Update profile
router.put(
  '/user/profile',
  authMiddleware,
  authController.updateProfile
);

// Change username
router.patch(
  '/user/username',
  authMiddleware,
  authController.changeUsername
);

module.exports = router;