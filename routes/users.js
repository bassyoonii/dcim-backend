const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { successResponse, errorResponse } = require('../utils/apiResponse');

// All routes below require login + admin role
router.use(protect, authorize('admin'));

// GET all users
router.get('/', async (req, res) => {
  try {
    const users = await User.find().select('-password');
    return successResponse(res, users);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
});

// GET single user
router.get('/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) return errorResponse(res, 'User not found', 404);
    return successResponse(res, user);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
});

// PUT update user role or status
router.put('/:id', async (req, res) => {
  try {
    const { role, isActive, name } = req.body;
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { role, isActive, name },
      { new: true, runValidators: true }
    ).select('-password');
    if (!user) return errorResponse(res, 'User not found', 404);
    return successResponse(res, user, 'User updated');
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
});

// DELETE user
router.delete('/:id', async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return errorResponse(res, 'User not found', 404);
    return successResponse(res, null, 'User deleted');
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
});

module.exports = router;