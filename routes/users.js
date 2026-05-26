const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const {
  listUsers,
  getUserById,
  updateUser,
  deleteUser
} = require('../controllers/userController');

// All routes below require login + admin role
router.use(protect, authorize('admin'));

// GET all users
router.get('/', listUsers);

// GET single user
router.get('/:id', getUserById);

// PUT update user role or status
router.put('/:id', updateUser);

// DELETE user
router.delete('/:id', deleteUser);

module.exports = router;