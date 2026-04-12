const express = require('express');
const router = express.Router();
const Vlan = require('../models/Vlan');
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const { parsePagination, parseSort, buildPaginatedPayload } = require('../utils/queryHelpers');

router.use(protect);

router.get('/', async (req, res) => {
  try {
    const { q, search, vlanId } = req.query;
    const filter = {};

    const term = (search || q || '').trim();

    if (vlanId) filter.vlanId = Number(vlanId);
    if (term) {
      filter.$or = [
        { name: { $regex: term, $options: 'i' } },
        { notes: { $regex: term, $options: 'i' } },
      ];
    }

    const { page, limit, skip } = parsePagination(req.query);
    const { sortBy, order, sort } = parseSort(req.query, ['vlanId', 'name', 'createdAt']);

    const payload = await buildPaginatedPayload({
      model: Vlan,
      filter,
      sort,
      page,
      limit,
      skip
    });

    return successResponse(res, {
      ...payload,
      filters: { search: term || null, vlanId: vlanId ? Number(vlanId) : null },
      sorting: { sortBy, order: order === 1 ? 'asc' : 'desc' }
    });
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
});

router.get('/:id', async (req, res) => {
  try {
    const item = await Vlan.findById(req.params.id).lean();
    if (!item) return errorResponse(res, 'VLAN not found', 404);
    return successResponse(res, item);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
});

router.post('/', authorize('admin', 'net_operator'), async (req, res) => {
  try {
    const payload = { ...req.body, createdBy: req.user.id };
    const item = await Vlan.create(payload);
    return successResponse(res, item, 'VLAN created', 201);
  } catch (err) {
    if (err.name === 'ValidationError') return errorResponse(res, err.message, 400);
    if (err.code === 11000) return errorResponse(res, 'VLAN ID already exists', 409);
    return errorResponse(res, err.message, 500);
  }
});

router.put('/:id', authorize('admin', 'net_operator'), async (req, res) => {
  try {
    const item = await Vlan.findByIdAndUpdate(
      req.params.id,
      { ...req.body },
      { new: true, runValidators: true }
    );
    if (!item) return errorResponse(res, 'VLAN not found', 404);
    return successResponse(res, item, 'VLAN updated');
  } catch (err) {
    if (err.name === 'ValidationError') return errorResponse(res, err.message, 400);
    if (err.code === 11000) return errorResponse(res, 'VLAN ID already exists', 409);
    return errorResponse(res, err.message, 500);
  }
});

router.delete('/:id', authorize('admin', 'net_operator'), async (req, res) => {
  try {
    const item = await Vlan.findByIdAndDelete(req.params.id);
    if (!item) return errorResponse(res, 'VLAN not found', 404);
    return successResponse(res, null, 'VLAN deleted');
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
});

module.exports = router;
