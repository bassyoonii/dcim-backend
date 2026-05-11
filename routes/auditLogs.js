const express = require('express');
const router = express.Router();

const AuditLog = require('../models/AuditLog');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const { parsePagination, parseSort, buildPaginatedPayload } = require('../utils/queryHelpers');

// Require authentication for logs
router.use(protect);

// GET /api/audit-logs
// Restricted to admin (centralized audit logs)
router.get('/', authorize('admin'), async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const { sort } = parseSort(req.query, ['createdAt', 'action', 'entity']);

    // Build filter — allow filtering by `user` query param (name or email or id)
    const filter = {};
    const searchQ = req.query.search ? String(req.query.search).trim() : '';
    const userQ = req.query.user ? String(req.query.user).trim() : '';

    if (userQ || searchQ) {
      const q = userQ || searchQ;
      // If q looks like an ObjectId (24 hex chars) we can use it directly
      const isObjectId = /^[0-9a-fA-F]{24}$/.test(q);
      if (isObjectId) {
        filter.user = q;
      } else {
        // Find matching users by name or email (case-insensitive)
        const matched = await User.find({
          $or: [
            { name: { $regex: q, $options: 'i' } },
            { email: { $regex: q, $options: 'i' } }
          ]
        }).select('_id');
        const ids = matched.map(u => u._id);
        filter.user = { $in: ids };
      }
    }

    const payload = await buildPaginatedPayload({
      model: AuditLog,
      filter,
      populate: [{ path: 'user', select: 'name email avatar role' }],
      sort,
      page,
      limit,
      skip
    });

    return successResponse(res, payload);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
});

// DELETE /api/audit-logs/:id
// Restricted to admin
router.delete('/:id', authorize('admin'), async (req, res) => {
  try {
    const deleted = await AuditLog.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return errorResponse(res, 'Audit log not found', 404);
    }
    return successResponse(res, { id: deleted._id }, 'Audit log deleted');
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
});

module.exports = router;
