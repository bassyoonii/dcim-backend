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
    const { role, isActive, name, email } = req.body;
    console.log('[users] update body', { id: req.params.id, role, isActive, name, email });

    const updates = {
      ...(typeof role !== 'undefined' ? { role } : {}),
      ...(typeof isActive !== 'undefined' ? { isActive } : {}),
      ...(typeof name !== 'undefined' ? { name } : {}),
      ...(typeof email !== 'undefined' ? { email } : {}),
    };

    if (Object.keys(updates).length === 0) {
      return errorResponse(res, 'No fields to update', 400);
    }

    if (typeof email !== 'undefined') {
      const existing = await User.findOne({ email, _id: { $ne: req.params.id } });
      if (existing) {
        return errorResponse(res, 'Email already in use', 409);
      }
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true, runValidators: true, context: 'query' }
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