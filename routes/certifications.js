const express = require('express');
const router = express.Router();
const Certification = require('../models/Certification');
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const { parsePagination, parseSort, buildPaginatedPayload } = require('../utils/queryHelpers');

router.use(protect);

router.get('/', async (req, res) => {
  try {
    const { q, search } = req.query;
    const term = String(search || q || '').trim();
    const filter = term
      ? { $or: [{ name: { $regex: term, $options: 'i' } }, { description: { $regex: term, $options: 'i' } }] }
      : {};

    const { page, limit, skip } = parsePagination(req.query);
    const { sortBy, order, sort } = parseSort(req.query, ['name', 'createdAt']);

    const payload = await buildPaginatedPayload({
      model: Certification,
      filter,
      sort,
      page,
      limit,
      skip
    });

    return successResponse(res, {
      ...payload,
      filters: { search: term || null },
      sorting: { sortBy, order: order === 1 ? 'asc' : 'desc' }
    });
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
});

router.get('/:id', async (req, res) => {
  try {
    const item = await Certification.findById(req.params.id).lean();
    if (!item) return errorResponse(res, 'Certification not found', 404);
    return successResponse(res, item);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
});

router.post('/', authorize('admin'), async (req, res) => {
  try {
    const payload = { ...req.body, createdBy: req.user.id };
    const item = await Certification.create(payload);
    return successResponse(res, item, 'Certification created', 201);
  } catch (err) {
    if (err.name === 'ValidationError') return errorResponse(res, err.message, 400);
    if (err.code === 11000) return errorResponse(res, 'Certification already exists', 409);
    return errorResponse(res, err.message, 500);
  }
});

router.put('/:id', authorize('admin'), async (req, res) => {
  try {
    const item = await Certification.findByIdAndUpdate(
      req.params.id,
      { ...req.body },
      { new: true, runValidators: true }
    );
    if (!item) return errorResponse(res, 'Certification not found', 404);
    return successResponse(res, item, 'Certification updated');
  } catch (err) {
    if (err.name === 'ValidationError') return errorResponse(res, err.message, 400);
    if (err.code === 11000) return errorResponse(res, 'Certification already exists', 409);
    return errorResponse(res, err.message, 500);
  }
});

router.delete('/:id', authorize('admin'), async (req, res) => {
  try {
    const item = await Certification.findByIdAndDelete(req.params.id);
    if (!item) return errorResponse(res, 'Certification not found', 404);
    return successResponse(res, null, 'Certification deleted');
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
});

module.exports = router;
