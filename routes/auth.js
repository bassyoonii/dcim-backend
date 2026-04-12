const express = require('express');
const router = express.Router();
const { register, login, getMe, updateMe, updateMyAvatar, changePassword, forgotPassword, resetPassword } = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const avatarUpload = require('../middleware/avatarUpload');
const { errorResponse } = require('../utils/apiResponse');

const uploadAvatar = (req, res, next) => {
	const handler = avatarUpload.single('avatar');
	handler(req, res, (err) => {
		if (err) return errorResponse(res, err.message, 400);
		next();
	});
};

// Public routes
router.post('/register', uploadAvatar, register);
router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

// Protected routes (must be logged in)
router.get('/me', protect, getMe);
router.put('/me', protect, updateMe);
router.put('/me/avatar', protect, uploadAvatar, updateMyAvatar);
router.put('/change-password', protect, changePassword);

module.exports = router;