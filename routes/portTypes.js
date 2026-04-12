const express = require('express');
const router = express.Router();
const PortType = require('../models/PortType');
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const { parsePagination, parseSort, buildPaginatedPayload } = require('../utils/queryHelpers');

router.use(protect);

router.get('/', async (req, res) => {
  try {
    const { q, search, equipmentType } = req.query;
    const filter = {};

    const term = String(search || q || '').trim();

    if (equipmentType) filter.equipmentType = equipmentType;
    if (term) {
      filter.$or = [
        { name: { $regex: term, $options: 'i' } },
        { notes: { $regex: term, $options: 'i' } },
      ];
    }

    const { page, limit, skip } = parsePagination(req.query);
    const { sortBy, order, sort } = parseSort(req.query, ['name', 'equipmentType', 'speedGbps', 'createdAt']);

    const payload = await buildPaginatedPayload({
      model: PortType,
      filter,
      sort,
      page,
      limit,
      skip
    });

    return successResponse(res, {
      ...payload,
      filters: { search: term || null, equipmentType: equipmentType || null },
      sorting: { sortBy, order: order === 1 ? 'asc' : 'desc' }
    });
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
});

router.get('/:id', async (req, res) => {
  try {
    const item = await PortType.findById(req.params.id).lean();
    if (!item) return errorResponse(res, 'Port type not found', 404);
    return successResponse(res, item);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
});

router.post('/', authorize('admin'), async (req, res) => {
  try {
    const payload = { ...req.body, createdBy: req.user.id };
    const item = await PortType.create(payload);
    return successResponse(res, item, 'Port type created', 201);
  } catch (err) {
    if (err.name === 'ValidationError') return errorResponse(res, err.message, 400);
    if (err.code === 11000) return errorResponse(res, 'Port type already exists for this equipment', 409);
    return errorResponse(res, err.message, 500);
  }
});

router.put('/:id', authorize('admin'), async (req, res) => {
  try {
    const item = await PortType.findByIdAndUpdate(
      req.params.id,
      { ...req.body },
      { new: true, runValidators: true }
    );
    if (!item) return errorResponse(res, 'Port type not found', 404);
    return successResponse(res, item, 'Port type updated');
  } catch (err) {
    if (err.name === 'ValidationError') return errorResponse(res, err.message, 400);
    if (err.code === 11000) return errorResponse(res, 'Port type already exists for this equipment', 409);
    return errorResponse(res, err.message, 500);
  }
});

router.delete('/:id', authorize('admin'), async (req, res) => {
  try {
    const item = await PortType.findByIdAndDelete(req.params.id);
    if (!item) return errorResponse(res, 'Port type not found', 404);
    return successResponse(res, null, 'Port type deleted');
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
});

module.exports = router;
